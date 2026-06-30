'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const multer = require('multer');
const { db } = require('./db');
const { runScan } = require('./scan');
const { updateRegister } = require('./register');
const { saveCV, getCVText, cvStatus } = require('./cv');
const { tailorForJob, interviewPrep, aiEnabled, spendStatus, MODEL } = require('./ai');
const { cvDocx } = require('./docx');
const { runBackup } = require('./backup');
const { runReminders } = require('./reminders');
const { runResearchScan } = require('./research/scan');
const { generatePack } = require('./research/ai');
const { buildDossier } = require('./research/dossier');

const fs = require('fs');
const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// Public health check (must be reachable without auth so the host's health probe doesn't 401).
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Optional password gate (set APP_PASSWORD before deploying publicly, so nobody else can burn your
// Claude credits or read your CV). Unset = open, which is fine for local use. HTTP Basic; any username.
const APP_PASSWORD = process.env.APP_PASSWORD || '';
if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const hdr = req.headers.authorization || '';
    const [, b64] = hdr.split(' ');
    const pass = b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
    if (pass === APP_PASSWORD) return next();
    res.set('WWW-Authenticate', 'Basic realm="Sponsorship Job Board"').status(401).send('Authentication required.');
  });
}

// Serve the built React (shadcn) frontend from web/dist; fall back to the legacy public/ if not built.
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');
const STATIC_DIR = fs.existsSync(path.join(WEB_DIST, 'index.html')) ? WEB_DIST : path.join(__dirname, '..', 'public');
app.use(express.static(STATIC_DIR));

// A role not seen across recent scans has likely been delisted from the feeds.
const STALE_DAYS = Number(process.env.STALE_DAYS) || 21;
const FOLLOWUP_DAYS = Number(process.env.REMINDER_FOLLOWUP_DAYS) || 10;
const DEADLINE_DAYS = Number(process.env.REMINDER_DEADLINE_DAYS) || 4;
const daysOld = ts => ts ? Math.floor((Date.now() - Date.parse(ts)) / 86400000) : null;
const daysUntil = ts => ts ? Math.ceil((Date.parse(ts) - Date.now()) / 86400000) : null;
// Blended "best match" score: sponsorship confidence weighted with profile fit, so a strong-fit
// Tier B can out-rank a weak-fit Tier A. Excluded roles always sink.
const matchScore = j => j.tier === 'excluded' ? -1 : Math.round(0.65 * (j.confidence || 0) + 0.35 * (j.fit_score || 0));

// --- jobs feed, filterable + sortable ---
app.get('/api/jobs', (req, res) => {
  const { status, tier, region, category, q, includeExcluded, salary, hideUnderpaid, sort } = req.query;
  const where = [];
  const args = [];
  if (status && status !== 'all') { where.push('status = ?'); args.push(status); }
  if (tier && tier !== 'all') { where.push('tier = ?'); args.push(tier); }
  if (region && region !== 'all') { where.push('region = ?'); args.push(region); }
  if (category && category !== 'all') { where.push('category = ?'); args.push(category); }
  if (salary && salary !== 'all') { where.push('salary_status = ?'); args.push(salary); }
  if (hideUnderpaid) where.push("salary_status != 'fail'");
  if (!includeExcluded) where.push("tier != 'excluded'");
  if (q) { where.push('(lower(title) LIKE ? OR lower(employer) LIKE ?)'); const t = '%' + q.toLowerCase() + '%'; args.push(t, t); }
  let rows = db.prepare(`SELECT * FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...args).map(j => {
    const d = daysOld(j.last_seen);
    const dl = daysUntil(j.deadline);
    return Object.assign(j, {
      days_old: d, stale: d !== null && d >= STALE_DAYS,
      match_score: matchScore(j),
      deadline_days: dl,
      deadline_soon: dl !== null && dl >= 0 && dl <= DEADLINE_DAYS,
      needs_followup: j.status === 'applied' && daysOld(j.date_applied) !== null && daysOld(j.date_applied) >= FOLLOWUP_DAYS,
    });
  });
  if (req.query.hideStale) rows = rows.filter(j => !j.stale || j.status !== 'new');

  const tierRank = { A: 0, 'B-': 1, B: 2, C: 3, unknown: 4, excluded: 5 };
  if (sort === 'tier') {
    rows.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.confidence - a.confidence) || (b.last_seen > a.last_seen ? 1 : -1));
  } else { // default: best match (sponsorship x fit)
    rows.sort((a, b) => (b.match_score - a.match_score) || (b.last_seen > a.last_seen ? 1 : -1));
  }
  res.json(rows);
});

// --- register freshness: when was the sponsor list last loaded, and how big ---
app.get('/api/register', (req, res) => {
  const get = k => { const r = db.prepare('SELECT value FROM meta WHERE key=?').get(k); return r ? r.value : null; };
  const loaded = get('register_loaded_at');
  res.json({
    loaded_at: loaded,
    days_old: daysOld(loaded),
    total: Number(get('register_total')) || db.prepare('SELECT COUNT(*) n FROM register').get().n,
    skilled_worker: Number(get('register_skilled_worker')) || 0
  });
});

// --- counts for the stat bar ---
app.get('/api/stats', (req, res) => {
  const by = col => db.prepare(`SELECT ${col} k, COUNT(*) n FROM jobs GROUP BY ${col}`).all()
    .reduce((a, r) => (a[r.k] = r.n, a), {});
  res.json({ total: db.prepare("SELECT COUNT(*) n FROM jobs WHERE tier != 'excluded'").get().n,
    excluded: db.prepare("SELECT COUNT(*) n FROM jobs WHERE tier = 'excluded'").get().n,
    byStatus: by('status'), byTier: by('tier') });
});

// --- scan log: what was scanned, when, and how it went (jobs scans only) ---
const srcStmt = db.prepare('SELECT source,query,status,count,error FROM source_results WHERE run_id = ?');
app.get('/api/scans', (req, res) => {
  const runs = db.prepare("SELECT * FROM scan_runs WHERE kind='jobs' ORDER BY id DESC LIMIT 12").all();
  res.json(runs.map(r => Object.assign({}, r, { sources: srcStmt.all(r.id) })));
});

// --- update user-owned fields (never touched by a scan) ---
app.post('/api/jobs/:id', (req, res) => {
  const { status, user_notes, date_applied, deadline, user_verified } = req.body;
  const sets = [], args = [];
  if (status !== undefined) { sets.push('status=?'); args.push(status); }
  if (user_notes !== undefined) { sets.push('user_notes=?'); args.push(user_notes); }
  if (date_applied !== undefined) { sets.push('date_applied=?'); args.push(date_applied); }
  if (deadline !== undefined) { sets.push('deadline=?'); args.push(deadline); }
  if (user_verified !== undefined) { sets.push('user_verified=?'); args.push(user_verified ? 1 : 0); }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  db.prepare(`UPDATE jobs SET ${sets.join(',')} WHERE id=?`).run(...args);
  res.json({ ok: true });
});

// --- AI / CV: status of the assistant (key present?) and the uploaded master CV ---
app.get('/api/ai', (req, res) => {
  res.json({ enabled: aiEnabled(), model: MODEL, cv: cvStatus(), spend: spendStatus() });
});

// --- upload / replace a master CV (PDF, DOCX, TXT, MD). ?profile=self|partner ---
app.post('/api/cv', upload.single('cv'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const profile = req.query.profile === 'partner' ? 'partner' : 'self';
  try {
    const r = await saveCV(req.file.buffer, req.file.originalname, profile);
    res.json(Object.assign({ ok: true }, r, cvStatus()));
  } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
});

// --- generate (or return cached) tailored CV + analysis for one job ---
app.post('/api/jobs/:id/tailor', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI not configured — add ANTHROPIC_API_KEY to .env.' });
  const cvText = getCVText();
  if (!cvText) return res.status(400).json({ error: 'Upload your CV first.' });
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  if (!req.query.force && job.generated_analysis) {
    return res.json({ cached: true, generated_at: job.generated_at, result: JSON.parse(job.generated_analysis) });
  }
  try {
    const result = await tailorForJob(job, cvText);
    const now = new Date().toISOString();
    db.prepare('UPDATE jobs SET generated_cv=?, generated_analysis=?, generated_at=? WHERE id=?')
      .run(result.tailored_cv_markdown || '', JSON.stringify(result), now, job.id);
    res.json({ cached: false, generated_at: now, result });
  } catch (e) { console.error('tailor failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

// --- download the tailored CV as a Word document ---
app.get('/api/jobs/:id/cv.docx', async (req, res) => {
  const job = db.prepare('SELECT generated_cv, title, employer FROM jobs WHERE id=?').get(req.params.id);
  if (!job || !job.generated_cv) return res.status(404).json({ error: 'No tailored CV yet, generate one first.' });
  try {
    const buf = await cvDocx(job.generated_cv);
    const safe = ('Olusegun Aborode - ' + (job.employer || '') + ' ' + (job.title || '')).replace(/[^a-z0-9 .-]/gi, '').slice(0, 80).trim() || 'CV';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
    res.send(buf);
  } catch (e) { console.error('docx failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

// --- interview prep + company brief for one job (cached) ---
app.post('/api/jobs/:id/prep', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI not configured, add ANTHROPIC_API_KEY to .env.' });
  const cvText = getCVText();
  if (!cvText) return res.status(400).json({ error: 'Upload your CV first.' });
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  if (!req.query.force && job.prep_json) return res.json({ cached: true, prep_at: job.prep_at, result: JSON.parse(job.prep_json) });
  try {
    const result = await interviewPrep(job, cvText);
    const now = new Date().toISOString();
    db.prepare('UPDATE jobs SET prep_json=?, prep_at=? WHERE id=?').run(JSON.stringify(result), now, job.id);
    res.json({ cached: false, prep_at: now, result });
  } catch (e) { console.error('prep failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

// ===================== RESEARCH & FUNDING (funded PhDs, postdocs, fellowships) =====================
const oppMatch = o => o.tier === 'excluded' ? -1 : Math.round(0.6 * (o.confidence || 0) + 0.4 * (o.fit_score || 0));

// --- opportunities feed, filterable + sortable. Hard gate (fully-funded + international-open) by default. ---
app.get('/api/opportunities', (req, res) => {
  const { type, area, funding, eligibility, q, sort, includeIneligible } = req.query;
  const where = [], args = [];
  if (type && type !== 'all') { where.push('type = ?'); args.push(type); }
  if (area && area !== 'all') { where.push('area_cluster = ?'); args.push(area); }
  if (funding && funding !== 'all') { where.push('funding_status = ?'); args.push(funding); }
  if (eligibility && eligibility !== 'all') { where.push('international_eligible = ?'); args.push(eligibility); }
  // Default hard gate: only Tier A (fully funded + international-open, or open salaried research) and B
  // (funded, eligibility unstated). The toggle reveals Home-only / unfunded.
  if (!includeIneligible) where.push("tier IN ('A','B')");
  if (q) { where.push('(lower(title) LIKE ? OR lower(institution) LIKE ?)'); const t = '%' + q.toLowerCase() + '%'; args.push(t, t); }
  let rows = db.prepare(`SELECT * FROM opportunities ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...args).map(o => {
    const dl = daysUntil(o.deadline_user || o.deadline);
    return Object.assign(o, {
      match_score: oppMatch(o), deadline_days: dl,
      deadline_soon: dl !== null && dl >= 0 && dl <= DEADLINE_DAYS,
      needs_followup: o.status === 'applied' && daysOld(o.date_applied) !== null && daysOld(o.date_applied) >= FOLLOWUP_DAYS,
      has_pack: !!o.pack_at, has_dossier: !!o.dossier_at,
    });
  });
  const tierRank = { A: 0, B: 1, C: 2, excluded: 3 };
  if (sort === 'tier') rows.sort((a, b) => (tierRank[a.tier] - tierRank[b.tier]) || (b.confidence - a.confidence));
  else rows.sort((a, b) => (b.match_score - a.match_score) || (b.last_seen > a.last_seen ? 1 : -1));
  res.json(rows);
});

app.get('/api/research/stats', (req, res) => {
  const by = col => db.prepare(`SELECT ${col} k, COUNT(*) n FROM opportunities GROUP BY ${col}`).all().reduce((a, r) => (a[r.k] = r.n, a), {});
  res.json({
    total: db.prepare("SELECT COUNT(*) n FROM opportunities WHERE tier IN ('A','B')").get().n,
    byTier: by('tier'), byType: by('type'), byStatus: by('status'),
  });
});

app.get('/api/research/scans', (req, res) => {
  const runs = db.prepare("SELECT * FROM scan_runs WHERE kind='research' ORDER BY id DESC LIMIT 8").all();
  res.json(runs.map(r => Object.assign({}, r, { sources: srcStmt.all(r.id) })));
});

app.post('/api/opportunities/:id', (req, res) => {
  const { status, user_notes, date_applied, deadline_user, user_flagged } = req.body;
  const sets = [], args = [];
  if (status !== undefined) { sets.push('status=?'); args.push(status); }
  if (user_notes !== undefined) { sets.push('user_notes=?'); args.push(user_notes); }
  if (date_applied !== undefined) { sets.push('date_applied=?'); args.push(date_applied); }
  if (deadline_user !== undefined) { sets.push('deadline_user=?'); args.push(deadline_user); }
  if (user_flagged !== undefined) { sets.push('user_flagged=?'); args.push(user_flagged ? 1 : 0); }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  db.prepare(`UPDATE opportunities SET ${sets.join(',')} WHERE id=?`).run(...args);
  res.json({ ok: true });
});

// Which person's CV powers an opportunity's pack: explicit ?applicant wins, else the auto-tag
// (health → partner, tech → self, either → partner if hers is uploaded). Falls back if one is missing.
function resolveApplicant(opp, override) {
  const order = override ? [override]
    : opp.for_applicant === 'self' ? ['self', 'partner']
    : opp.for_applicant === 'partner' ? ['partner', 'self']
    : ['partner', 'self']; // 'either' defaults to her (research is primarily hers)
  for (const a of order) { const t = getCVText(a); if (t) return { applicant: a, cvText: t }; }
  return { applicant: order[0], cvText: null };
}

app.post('/api/opportunities/:id/pack', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI not configured, add ANTHROPIC_API_KEY.' });
  const opp = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found.' });
  const override = req.query.applicant === 'partner' ? 'partner' : req.query.applicant === 'self' ? 'self' : null;
  const { applicant, cvText } = resolveApplicant(opp, override);
  if (!cvText) return res.status(400).json({ error: `Upload the ${applicant === 'partner' ? "partner's" : 'your'} CV first.` });
  // Cache is per applicant.
  if (!req.query.force && opp.pack_json) { const c = JSON.parse(opp.pack_json); if (c._applicant === applicant) return res.json({ cached: true, pack_at: opp.pack_at, applicant, result: c }); }
  try {
    const result = await generatePack(opp, cvText);
    result._applicant = applicant;
    const now = new Date().toISOString();
    db.prepare('UPDATE opportunities SET pack_json=?, pack_at=? WHERE id=?').run(JSON.stringify(result), now, opp.id);
    res.json({ cached: false, pack_at: now, applicant, result });
  } catch (e) { console.error('pack failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

// --- deep research dossier (Claude + web search), cached. The one-stop-shop info. ---
app.post('/api/opportunities/:id/dossier', async (req, res) => {
  if (!aiEnabled()) return res.status(400).json({ error: 'AI not configured, add ANTHROPIC_API_KEY.' });
  const opp = db.prepare('SELECT * FROM opportunities WHERE id=?').get(req.params.id);
  if (!opp) return res.status(404).json({ error: 'Opportunity not found.' });
  if (!req.query.force && opp.dossier_json) return res.json({ cached: true, dossier_at: opp.dossier_at, result: JSON.parse(opp.dossier_json) });
  try {
    const result = await buildDossier(opp);
    const now = new Date().toISOString();
    db.prepare('UPDATE opportunities SET dossier_json=?, dossier_at=?, scholarship_type=?, contact_email=? WHERE id=?')
      .run(JSON.stringify(result), now, result.scholarship_type || '', result.contact_email || '', opp.id);
    res.json({ cached: false, dossier_at: now, result });
  } catch (e) { console.error('dossier failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

app.get('/api/opportunities/:id/cv.docx', async (req, res) => {
  const opp = db.prepare('SELECT pack_json, title, institution FROM opportunities WHERE id=?').get(req.params.id);
  if (!opp || !opp.pack_json) return res.status(404).json({ error: 'No application pack yet, generate one first.' });
  try {
    const md = JSON.parse(opp.pack_json).academic_cv_markdown || '';
    const buf = await cvDocx(md);
    const safe = ('Olusegun Aborode - ' + (opp.institution || '') + ' ' + (opp.title || '')).replace(/[^a-z0-9 .-]/gi, '').slice(0, 80).trim() || 'CV';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.docx"`);
    res.send(buf);
  } catch (e) { console.error('opp docx failed:', e); res.status(500).json({ error: String(e.message || e) }); }
});

let researchScanning = false;
app.post('/api/research/scan', async (req, res) => {
  if (researchScanning) return res.status(409).json({ error: 'research scan already running' });
  researchScanning = true;
  res.json({ started: true });
  try { const r = await runResearchScan(); console.log('On-demand research scan:', r); }
  catch (e) { console.error(e); }
  finally { researchScanning = false; }
});

// --- trigger a scan on demand ---
let scanning = false;
app.post('/api/scan', async (req, res) => {
  if (scanning) return res.status(409).json({ error: 'scan already running' });
  scanning = true;
  res.json({ started: true });
  try { const r = await runScan(); console.log('On-demand scan:', r); }
  catch (e) { console.error(e); }
  finally { scanning = false; }
});

// SPA fallback — any non-API GET serves the app shell.
app.get(/^(?!\/api).+/, (req, res) => res.sendFile(path.join(STATIC_DIR, 'index.html')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Board running at http://localhost:${PORT} (serving ${STATIC_DIR.endsWith('dist') ? 'web/dist' : 'public'})`));

// First-boot bootstrap (fresh persistent disk): load the sponsor register, then run one scan so the
// board is usable immediately instead of waiting for the first 3-hourly cron.
(async () => {
  try {
    if (db.prepare('SELECT COUNT(*) n FROM register').get().n === 0) {
      console.log('First boot: loading sponsor register…');
      await updateRegister();
    }
    if (db.prepare('SELECT COUNT(*) n FROM jobs').get().n === 0 && !scanning) {
      console.log('First boot: running initial scan…');
      scanning = true;
      runScan().then(r => console.log('Initial scan:', r)).catch(e => console.error('Initial scan failed:', e)).finally(() => { scanning = false; });
    }
    if (db.prepare('SELECT COUNT(*) n FROM opportunities').get().n === 0 && !researchScanning) {
      console.log('First boot: running initial research scan…');
      researchScanning = true;
      runResearchScan().then(r => console.log('Initial research scan:', r)).catch(e => console.error('Initial research scan failed:', e)).finally(() => { researchScanning = false; });
    }
  } catch (e) { console.error('Bootstrap failed:', e.message); }
})();

// Built-in scheduler: every 3 hours while the server is up.
cron.schedule('0 */3 * * *', async () => {
  if (scanning) return;
  scanning = true;
  try { const r = await runScan(); console.log('Scheduled scan:', r); }
  catch (e) { console.error('Scheduled scan failed:', e); }
  finally { scanning = false; }
});

// Research opportunities move slower than jobs: scan once a day (06:30).
cron.schedule('30 6 * * *', async () => {
  if (researchScanning) return;
  researchScanning = true;
  try { const r = await runResearchScan(); console.log('Scheduled research scan:', r); }
  catch (e) { console.error('Research scan failed:', e); }
  finally { researchScanning = false; }
});

// Daily DB backup (07:50) so tracking + generated CVs survive a disk loss.
cron.schedule('50 7 * * *', () => runBackup().then(r => console.log('Backup:', r.file)).catch(e => console.error('Backup failed:', e)));

// Daily reminders (08:00): deadlines coming up + applications needing a follow-up.
cron.schedule('0 8 * * *', () => runReminders().then(r => r.sent && console.log('Reminders sent:', r)).catch(e => console.error('Reminders failed:', e)));
