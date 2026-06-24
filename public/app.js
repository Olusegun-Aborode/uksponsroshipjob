'use strict';
const $ = s => document.querySelector(s);
const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const REGIONS = ['London/SE','Rest of England','Scotland','Wales','Northern Ireland','Remote'];
const STATUSES = [['new','New'],['interested','Interested'],['applied','Applied'],['interviewing','Interviewing'],['offer','Offer'],['rejected','Rejected'],['not_suitable','Not suitable']];
let filter = { status:'all', tier:'all', region:'all', salary:'all', q:'', includeExcluded:false, hideUnderpaid:false, hideStale:false };
let AI = { enabled:false, cv:{ uploaded:false } };
let JOBS = {}; // id -> job, for the drawer

// ---- toast ----
let toastTimer;
function toast(msg){
  let t = $('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}
function copy(text, label){ navigator.clipboard.writeText(text).then(()=>toast((label||'Copied')+' ✓')); }

// ---- tiny markdown -> html (headings, bold, lists, hr, links, paragraphs) ----
function md(src){
  const lines = (src||'').split(/\r?\n/); let out=[], inList=false;
  const inline = t => esc(t)
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  const closeList = ()=>{ if(inList){ out.push('</ul>'); inList=false; } };
  for(let raw of lines){
    const l = raw.replace(/\s+$/,'');
    if(/^\s*[-*+]\s+/.test(l)){ if(!inList){ out.push('<ul>'); inList=true; } out.push('<li>'+inline(l.replace(/^\s*[-*+]\s+/,''))+'</li>'); continue; }
    closeList();
    if(/^#{1,6}\s/.test(l)){ const n=l.match(/^#+/)[0].length; out.push(`<h${Math.min(n,3)}>`+inline(l.replace(/^#+\s/,''))+`</h${Math.min(n,3)}>`); }
    else if(/^(-{3,}|_{3,}|\*{3,})$/.test(l.trim())) out.push('<hr>');
    else if(l.trim()==='') {}
    else out.push('<p>'+inline(l)+'</p>');
  }
  closeList(); return out.join('');
}

// ---- visa countdown ----
function renderCountdown(){
  const v = localStorage.getItem('visaExpiry') || '';
  let inner;
  if(v){
    const days = Math.ceil((new Date(v) - new Date())/86400000);
    const target = Math.max(days-75,0);
    const col = days<90?'var(--bad)':days<150?'var(--warn)':'var(--good)';
    inner = `<div class="big" style="color:${col}">${days} days</div><div style="font-size:10.5px;color:var(--ink-faint)">until visa expires · ~${target}d to lock a CoS</div>`;
  } else inner = '<div style="font-size:12px;color:var(--ink-faint)">Set expiry to start countdown</div>';
  $('#countdown').innerHTML = `<label>Graduate visa expiry</label><input type="date" id="vx" value="${esc(v)}">${inner}`;
  $('#vx').onchange = e => { localStorage.setItem('visaExpiry', e.target.value); renderCountdown(); };
}

// ---- AI / CV status ----
async function loadAI(){
  AI = await (await fetch('/api/ai')).json();
  const chip = $('#cvChip'), label = $('#cvChipLabel');
  if(AI.cv && AI.cv.uploaded){ chip.classList.add('ok'); label.textContent = '📄 ' + (AI.cv.filename||'CV'); $('#cvUploadBtn').textContent='Replace'; }
  else { chip.classList.remove('ok'); label.textContent = AI.enabled ? 'No CV uploaded' : 'AI off — add API key'; }
}
function initCVUpload(){
  $('#cvUploadBtn').onclick = ()=> $('#cvFile').click();
  $('#cvFile').onchange = async e => {
    const f = e.target.files[0]; if(!f) return;
    const btn = $('#cvUploadBtn'); btn.disabled=true; btn.innerHTML='<span class="spin"></span>';
    const fd = new FormData(); fd.append('cv', f);
    try{
      const r = await (await fetch('/api/cv',{method:'POST',body:fd})).json();
      if(r.error) toast(r.error); else { toast('CV uploaded ✓'); await loadAI(); }
    }catch(err){ toast('Upload failed'); }
    btn.disabled=false; await loadAI(); e.target.value='';
  };
}

async function loadStats(){
  const s = await (await fetch('/api/stats')).json();
  const cells = [['all','Total',s.total],['new','New',s.byStatus.new||0],['applied','Applied',s.byStatus.applied||0],
    ['interviewing','Interviews',s.byStatus.interviewing||0],['offer','Offers',s.byStatus.offer||0],['A','Tier A',s.byTier.A||0]];
  $('#stats').innerHTML = cells.map(c=>{
    const active=(c[0]==='A'&&filter.tier==='A')||(c[0]!=='A'&&filter.status===c[0]);
    return `<div class="stat ${active?'active':''}" data-k="${c[0]}"><div class="n">${c[2]}</div><div class="l">${c[1]}</div></div>`;
  }).join('');
  document.querySelectorAll('.stat').forEach(el=>el.onclick=()=>{
    const k=el.dataset.k;
    if(k==='A'){filter.tier='A';filter.status='all';} else if(k==='all'){filter.status='all';filter.tier='all';}
    else {filter.status=k;filter.tier='all';}
    syncControls(); loadJobs(); loadStats();
  });
}

const tierClass = t => t==='A'?'tA':t==='B-'?'tBminus':t==='B'?'tB':t==='excluded'?'texcluded':'tC';
const badgeClass = t => t==='A'?'A':t==='B-'?'bminus':t==='B'?'B':t==='excluded'?'excluded':t==='C'?'C':'unknown';
const badgeText = t => t==='excluded'?'✕':t;
const SAL = { pass:['sal-pass','✓ clears floor'], fail:['sal-fail','⚠ below floor'], borderline:['sal-bord','◑ borderline'], unknown:['sal-unk','? salary n/a'] };
const salTag = j => { const s=SAL[j.salary_status]; return s?`<span class="tag ${s[0]}">${s[1]}</span>`:''; };

function jobCard(j){
  const opts = STATUSES.map(s=>`<option value="${s[0]}" ${j.status===s[0]?'selected':''}>${s[1]}</option>`).join('');
  const has = !!j.generated_at;
  const tailorBtn = AI.enabled
    ? `<button class="btn-tailor ${has?'has':''}" data-tailor="${j.id}">✨ ${has?'View CV':'Tailor CV'}</button>` : '';
  return `<div class="job ${tierClass(j.tier)}">
    <div class="row1">
      <div><span class="badge ${badgeClass(j.tier)}">${badgeText(j.tier)}</span>
        <span class="jt"> ${esc(j.title)}</span><div class="emp">${esc(j.employer)}</div></div>
      <div class="acts">${tailorBtn}
        <a href="${esc(j.url)}" target="_blank" rel="noopener"><button class="btn-ghost tiny">Open ↗</button></a></div>
    </div>
    <div class="reason">${esc(j.reason)}</div>
    <div class="meta">
      <span class="tag">${esc(j.region||'')}</span><span class="tag">${esc(j.category||'')}</span>
      ${j.salary?`<span class="tag sal">${esc(j.salary)}</span>`:''}${salTag(j)}
      ${j.register_name?`<span class="tag reg">register: ${esc(j.register_name)}</span>`:''}
      ${j.fit_score?`<span class="tag fit">fit ${j.fit_score}</span>`:''}
      ${j.stale?`<span class="tag stale">stale · ${j.days_old}d</span>`:''}
      <span class="tag">via ${esc(j.source)}</span>
      ${j.date_applied?`<span class="tag">applied ${esc(j.date_applied)}</span>`:''}
    </div>
    <div class="ctrls">
      <select data-id="${j.id}" class="statusSel">${opts}</select>
      <label class="chk"><input type="checkbox" class="verSel" data-id="${j.id}" ${j.user_verified?'checked':''}> verified on register</label>
    </div>
    <textarea class="notes" data-id="${j.id}" placeholder="Notes — recruiter, follow-up date, SOC check…">${esc(j.user_notes||'')}</textarea>
  </div>`;
}

async function loadJobs(){
  const p = new URLSearchParams();
  Object.entries(filter).forEach(([k,v])=>{ if(v && v!=='all' && v!==false) p.set(k,v); });
  if(filter.includeExcluded) p.set('includeExcluded','1');
  const jobs = await (await fetch('/api/jobs?'+p.toString())).json();
  JOBS = {}; jobs.forEach(j=>JOBS[j.id]=j);
  $('#jobs').innerHTML = jobs.length ? jobs.map(jobCard).join('') : '<div class="empty">No roles match. Adjust filters, or run a scan.</div>';
  bindCards();
}

function bindCards(){
  document.querySelectorAll('.statusSel').forEach(el=>el.onchange=async()=>{
    const body={status:el.value}; if(el.value==='applied') body.date_applied=new Date().toISOString().slice(0,10);
    await save(el.dataset.id,body); loadStats();
  });
  document.querySelectorAll('.verSel').forEach(el=>el.onchange=()=>save(el.dataset.id,{user_verified:el.checked}));
  document.querySelectorAll('.notes').forEach(el=>el.onchange=()=>save(el.dataset.id,{user_notes:el.value}));
  document.querySelectorAll('[data-tailor]').forEach(el=>el.onclick=()=>openTailor(el.dataset.tailor));
}
const save = (id,body)=>fetch('/api/jobs/'+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

// ---- drawer / tailoring ----
function closeDrawer(){ $('#drawer').classList.remove('show'); $('#overlay').classList.remove('show'); }
function openDrawerShell(job){
  const d=$('#drawer');
  d.innerHTML = `<div class="dr-head">
      <div><h2>${esc(job.title)}</h2><div class="sub">${esc(job.employer)} · ${esc(job.region||job.location||'')}</div></div>
      <button class="dr-close" id="drClose">✕</button></div>
    <div class="dr-body" id="drBody"></div>`;
  d.classList.add('show'); $('#overlay').classList.add('show');
  $('#drClose').onclick=closeDrawer;
}

async function openTailor(id){
  if(!AI.cv || !AI.cv.uploaded){ toast('Upload your CV first ↑'); return; }
  const job = JOBS[id]; if(!job) return;
  openDrawerShell(job);
  const body = $('#drBody');
  const cached = !!job.generated_at;
  body.innerHTML = `<div class="dr-loading"><span class="spin"></span>
    <div>${cached?'Loading your tailored CV…':'Tailoring your CV for this role…<br><span class="note">Claude is rewriting against the job description — ~20s</span>'}</div></div>`;
  try{
    const r = await (await fetch('/api/jobs/'+id+'/tailor'+(cached?'':''),{method:'POST'})).json();
    if(r.error){ body.innerHTML = `<div class="dr-error">${esc(r.error)}</div>`; return; }
    job.generated_at = r.generated_at; // mark as generated so the card flips to "View"
    renderResult(body, r.result, id);
    loadJobs();
  }catch(e){ body.innerHTML = `<div class="dr-error">Generation failed. ${esc(String(e.message||e))}</div>`; }
}

function renderResult(body, res, id){
  const score = Math.max(0,Math.min(100, res.ats_score||0));
  const have = (res.matched_keywords||[]).map(k=>`<span class="kw have">${esc(k)}</span>`).join('') || '<span class="note">—</span>';
  const miss = (res.missing_keywords||[]).map(k=>`<span class="kw miss">${esc(k)}</span>`).join('') || '<span class="note">none — strong match</span>';
  const gaps = (res.skill_gaps||[]).map(g=>`<div class="gap"><h4>${esc(g.skill)}</h4><p>${esc(g.why_it_matters)}</p>
      <div class="courses">
        <a href="${g.courses.coursera}" target="_blank">Coursera ↗</a>
        <a href="${g.courses.udemy}" target="_blank">Udemy ↗</a>
        <a href="${g.courses.linkedin}" target="_blank">LinkedIn ↗</a>
      </div></div>`).join('') || '<p class="note">No major gaps flagged.</p>';

  body.innerHTML = `
    <p class="headline">${esc(res.headline)}</p>
    <p class="fit">${esc(res.fit_summary)}</p>
    <div class="scorebar">
      <div class="ring" style="--p:${score}"><i>${score}</i></div>
      <div class="lbl"><b>ATS match estimate</b>How well your CV matches this posting's stated requirements.</div>
    </div>
    <div class="tabs">
      <button class="tab active" data-pane="cv">Tailored CV</button>
      <button class="tab" data-pane="cover">Cover note</button>
      <button class="tab" data-pane="kw">Keywords</button>
      <button class="tab" data-pane="gaps">Courses</button>
    </div>
    <div class="tabpane active" data-pane="cv">
      <div class="copybar"><button class="btn-ghost sm" id="copyCv">Copy CV</button>
        <button class="btn-ghost sm" id="regen" style="margin-left:8px">↻ Regenerate</button></div>
      <div class="cvdoc">${md(res.tailored_cv_markdown)}</div>
    </div>
    <div class="tabpane" data-pane="cover">
      <div class="copybar"><button class="btn-ghost sm" id="copyCover">Copy note</button></div>
      <div class="cover">${esc(res.cover_note)}</div>
    </div>
    <div class="tabpane" data-pane="kw">
      <div class="kw-group"><h4>✓ You have these</h4><div class="kw-wrap">${have}</div></div>
      <div class="kw-group"><h4>✗ Missing / unproven</h4><div class="kw-wrap">${miss}</div></div>
    </div>
    <div class="tabpane" data-pane="gaps">${gaps}</div>`;

  body.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
    body.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    body.querySelectorAll('.tabpane').forEach(x=>x.classList.remove('active'));
    t.classList.add('active'); body.querySelector(`.tabpane[data-pane="${t.dataset.pane}"]`).classList.add('active');
  });
  $('#copyCv').onclick=()=>copy(res.tailored_cv_markdown,'CV copied');
  $('#copyCover').onclick=()=>copy(res.cover_note,'Note copied');
  $('#regen').onclick=async()=>{
    body.innerHTML = `<div class="dr-loading"><span class="spin"></span><div>Regenerating…</div></div>`;
    try{ const r=await (await fetch('/api/jobs/'+id+'/tailor?force=1',{method:'POST'})).json();
      if(r.error){ body.innerHTML=`<div class="dr-error">${esc(r.error)}</div>`; return; }
      renderResult(body, r.result, id); }catch(e){ body.innerHTML=`<div class="dr-error">Failed.</div>`; }
  };
}

async function loadScans(){
  const runs = await (await fetch('/api/scans')).json();
  if(!runs.length){ $('#scanLog').innerHTML='<p class="note">No scans yet. Hit "Scan now".</p>'; return; }
  const latest = runs[0];
  $('#scanInfo').textContent = latest.finished_at
    ? `Last: ${new Date(latest.finished_at).toLocaleString()} · ${latest.total_found} found · ${latest.new_jobs} new`
    : 'A scan is running…';
  $('#scanLog').innerHTML = runs.slice(0,3).map(r=>{
    const head=`<div class="runhead">${new Date(r.started_at).toLocaleString()} — ${r.total_found||0} found, ${r.new_jobs||0} new</div>`;
    const rows=(r.sources||[]).map(s=>`<div class="srcrow"><span>${esc(s.source)}</span><span class="${s.status}">${s.status}${s.count?` · ${s.count}`:''}</span></div>`).join('');
    return head+rows;
  }).join('');
}

async function loadRegister(){
  try{
    const r = await (await fetch('/api/register')).json();
    if(!r.total){ $('#regInfo').textContent=''; return; }
    const when = r.loaded_at ? (r.days_old===0?'today':r.days_old+'d ago') : 'unknown';
    const warn = (r.days_old!==null && r.days_old>40)?' style="color:var(--warn)"':'';
    $('#regInfo').innerHTML = `<b>${r.total.toLocaleString()}</b> sponsors · <b>${(r.skilled_worker||0).toLocaleString()}</b> Skilled Worker · loaded <span${warn}>${when}</span>`;
  }catch(e){ $('#regInfo').textContent=''; }
}

function syncControls(){ $('#fTier').value=filter.tier; $('#fStatus').value=filter.status; $('#fRegion').value=filter.region; }

function init(){
  $('#fRegion').innerHTML='<option value="all">All locations</option>'+REGIONS.map(r=>`<option>${r}</option>`).join('');
  $('#q').oninput=e=>{filter.q=e.target.value;loadJobs();};
  $('#fTier').onchange=e=>{filter.tier=e.target.value;loadJobs();loadStats();};
  $('#fStatus').onchange=e=>{filter.status=e.target.value;loadJobs();};
  $('#fRegion').onchange=e=>{filter.region=e.target.value;loadJobs();};
  $('#fSalary').onchange=e=>{filter.salary=e.target.value;loadJobs();};
  $('#hideUnderpaid').onchange=e=>{filter.hideUnderpaid=e.target.checked;loadJobs();};
  $('#hideStale').onchange=e=>{filter.hideStale=e.target.checked;loadJobs();};
  $('#showExcluded').onchange=e=>{filter.includeExcluded=e.target.checked;loadJobs();};
  $('#overlay').onclick=closeDrawer;
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });
  $('#scanBtn').onclick=async()=>{
    const b=$('#scanBtn'); b.disabled=true; b.innerHTML='<span class="spin"></span> Scanning…';
    await fetch('/api/scan',{method:'POST'});
    const poll=setInterval(async()=>{
      await loadScans(); const runs=await (await fetch('/api/scans')).json();
      if(runs[0]&&runs[0].finished_at){ clearInterval(poll); b.disabled=false; b.textContent='⟳ Scan now'; loadJobs(); loadStats(); }
    },2500);
  };
  initCVUpload();
  renderCountdown(); loadAI().then(loadJobs); loadStats(); loadScans(); loadRegister();
  setInterval(loadScans,60000);
}
init();
