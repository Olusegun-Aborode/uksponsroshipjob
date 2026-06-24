'use strict';
const $ = s => document.querySelector(s);
const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const REGIONS = ['London/SE','Rest of England','Scotland','Wales','Northern Ireland','Remote'];
const STATUSES = [['new','New'],['interested','Interested'],['applied','Applied'],['interviewing','Interviewing'],['offer','Offer'],['rejected','Rejected'],['not_suitable','Not suitable']];
let filter = { status:'all', tier:'all', region:'all', salary:'all', q:'', includeExcluded:false, hideUnderpaid:false };

// ---- visa countdown persists in localStorage (a single date, harmless) ----
function renderCountdown(){
  const v = localStorage.getItem('visaExpiry') || '';
  let inner;
  if(v){
    const days = Math.ceil((new Date(v) - new Date())/86400000);
    const target = Math.max(days-75,0);
    const col = days<90?'var(--bad)':days<150?'var(--warn)':'var(--good)';
    inner = `<div class="big" style="color:${col}">${days} days</div><div style="font-size:11px;color:var(--chalk-dim)">until visa expires · ~${target} days to lock a CoS</div>`;
  } else inner = '<div style="font-size:12px;color:var(--chalk-dim)">Set your expiry to start the countdown</div>';
  $('#countdown').innerHTML = `<label>Graduate visa expiry</label><input type="date" id="vx" value="${esc(v)}">${inner}`;
  $('#vx').onchange = e => { localStorage.setItem('visaExpiry', e.target.value); renderCountdown(); };
}

async function loadStats(){
  const s = await (await fetch('/api/stats')).json();
  const cells = [
    ['all','Total', s.total],
    ['new','New', s.byStatus.new||0],
    ['applied','Applied', s.byStatus.applied||0],
    ['interviewing','Interviewing', s.byStatus.interviewing||0],
    ['offer','Offers', s.byStatus.offer||0],
    ['A','Tier A', s.byTier.A||0]
  ];
  $('#stats').innerHTML = cells.map(c => {
    const active = (c[0]==='A' && filter.tier==='A') || (c[0]!=='A' && filter.status===c[0]);
    return `<div class="stat ${active?'active':''}" data-k="${c[0]}"><div class="n">${c[2]}</div><div class="l">${c[1]}</div></div>`;
  }).join('');
  document.querySelectorAll('.stat').forEach(el => el.onclick = () => {
    const k = el.dataset.k;
    if(k==='A'){ filter.tier='A'; filter.status='all'; }
    else if(k==='all'){ filter.status='all'; filter.tier='all'; }
    else { filter.status=k; filter.tier='all'; }
    syncControls(); loadJobs(); loadStats();
  });
}

const SAL = { pass:['sal-pass','✓ salary clears floor'], fail:['sal-fail','⚠ below sponsorship floor'], borderline:['sal-bord','◑ salary borderline'], unknown:['sal-unk','? salary not disclosed'] };
const salTag = j => { const s = SAL[j.salary_status]; return s ? `<span class="tag ${s[0]}">${s[1]}</span>` : ''; };
const tierClass = t => t==='A'?'tA':t==='B-'?'tBminus':t==='B'?'tB':t==='excluded'?'texcluded':'tC';
const badgeClass = t => t==='A'?'A':t==='B-'?'bminus':t==='B'?'B':t==='excluded'?'excluded':t==='C'?'C':'unknown';
const badgeText = t => t==='excluded'?'✕':t;

function jobCard(j){
  const opts = STATUSES.map(s => `<option value="${s[0]}" ${j.status===s[0]?'selected':''}>${s[1]}</option>`).join('');
  return `<div class="job ${tierClass(j.tier)}">
    <div class="row1">
      <div><span class="badge ${badgeClass(j.tier)}">${badgeText(j.tier)}</span>
        <span class="jt"> ${esc(j.title)}</span><div class="emp">${esc(j.employer)}</div></div>
      <a href="${esc(j.url)}" target="_blank" rel="noopener"><button class="ghost tiny">Open ↗</button></a>
    </div>
    <div class="reason">${esc(j.reason)}</div>
    <div class="meta">
      <span class="tag">${esc(j.region||'')}</span>
      <span class="tag">${esc(j.category||'')}</span>
      ${j.salary?`<span class="tag sal">${esc(j.salary)}</span>`:''}
      ${salTag(j)}
      ${j.soc_code?`<span class="tag">SOC ${esc(j.soc_code)}</span>`:''}
      ${j.register_name?`<span class="tag reg">register: ${esc(j.register_name)}</span>`:''}
      ${j.fit_score?`<span class="tag fit">fit ${j.fit_score}</span>`:''}
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
  Object.entries(filter).forEach(([k,v]) => { if(v && v!=='all' && v!==false) p.set(k, v); });
  if(filter.includeExcluded) p.set('includeExcluded','1');
  const jobs = await (await fetch('/api/jobs?'+p.toString())).json();
  $('#jobs').innerHTML = jobs.length ? jobs.map(jobCard).join('')
    : '<div class="empty">No roles match. Adjust filters, or run a scan.</div>';
  bindCards();
}

function bindCards(){
  document.querySelectorAll('.statusSel').forEach(el => el.onchange = async () => {
    const body = { status: el.value };
    if(el.value==='applied') body.date_applied = new Date().toISOString().slice(0,10);
    await save(el.dataset.id, body); loadStats();
  });
  document.querySelectorAll('.verSel').forEach(el => el.onchange = () => save(el.dataset.id, { user_verified: el.checked }));
  document.querySelectorAll('.notes').forEach(el => el.onchange = () => save(el.dataset.id, { user_notes: el.value }));
}
const save = (id, body) => fetch('/api/jobs/'+id, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });

async function loadScans(){
  const runs = await (await fetch('/api/scans')).json();
  if(!runs.length){ $('#scanLog').innerHTML = '<p class="note">No scans yet. Hit “Scan now”, or wait for the scheduled run.</p>'; return; }
  const latest = runs[0];
  $('#scanInfo').textContent = latest.finished_at
    ? `Last: ${new Date(latest.finished_at).toLocaleString()} · ${latest.total_found} found · ${latest.new_jobs} new · ${latest.employers_checked} employers checked`
    : 'A scan is running…';
  $('#scanLog').innerHTML = runs.slice(0,4).map(r => {
    const head = `<div class="runhead">${new Date(r.started_at).toLocaleString()} — ${r.total_found||0} found, ${r.new_jobs||0} new</div>`;
    const rows = (r.sources||[]).map(s =>
      `<div class="srcrow"><span>${esc(s.source)} <span class="note">${esc(s.query||'')}</span></span>
       <span class="${s.status}">${s.status}${s.count?` · ${s.count}`:''}${s.error?` · ${esc(s.error)}`:''}</span></div>`).join('');
    return head + rows;
  }).join('');
}

function syncControls(){
  $('#fTier').value = filter.tier; $('#fStatus').value = filter.status; $('#fRegion').value = filter.region;
}

function init(){
  $('#fRegion').innerHTML = '<option value="all">All locations</option>' + REGIONS.map(r=>`<option>${r}</option>`).join('');
  $('#q').oninput = e => { filter.q = e.target.value; loadJobs(); };
  $('#fTier').onchange = e => { filter.tier = e.target.value; loadJobs(); loadStats(); };
  $('#fStatus').onchange = e => { filter.status = e.target.value; loadJobs(); };
  $('#fRegion').onchange = e => { filter.region = e.target.value; loadJobs(); };
  $('#fSalary').onchange = e => { filter.salary = e.target.value; loadJobs(); };
  $('#hideUnderpaid').onchange = e => { filter.hideUnderpaid = e.target.checked; loadJobs(); };
  $('#showExcluded').onchange = e => { filter.includeExcluded = e.target.checked; loadJobs(); };
  $('#scanBtn').onclick = async () => {
    const b = $('#scanBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span> Scanning…';
    await fetch('/api/scan', { method:'POST' });
    const poll = setInterval(async () => {
      await loadScans();
      const runs = await (await fetch('/api/scans')).json();
      if(runs[0] && runs[0].finished_at){ clearInterval(poll); b.disabled=false; b.textContent='⟳ Scan now'; loadJobs(); loadStats(); }
    }, 2500);
  };
  renderCountdown(); loadStats(); loadJobs(); loadScans();
  setInterval(loadScans, 60000);
}
init();
