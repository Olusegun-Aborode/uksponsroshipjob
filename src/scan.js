'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, upsertJob } = require('./db');
const { score } = require('./score');
const { norm } = require('./register');
const { notifyNewJobs } = require('./notify');
const { fetchAdzuna } = require('./sources/adzuna');
const { fetchReed } = require('./sources/reed');
const { fetchATS } = require('./sources/ats');
const { fetchNHS, fetchCivilService } = require('./sources/stubs');

function list(env, fallback) {
  return (process.env[env] || fallback || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Source-agnostic identity so the same role from Adzuna and Reed collapses into one card.
function fingerprint(employer, title) {
  return crypto.createHash('sha1').update(norm(employer) + '|' + norm(title)).digest('hex').slice(0, 16);
}

// On a fresh checkout (e.g. the GitHub Action) the SQLite DB is empty but data/jobs.json carries the
// last run's roles. Seed their ids so a cloud scan computes "new" against what was already seen —
// otherwise every job looks new and the alerts spam on every run. User tracking is irrelevant here
// (the cloud runner doesn't keep it); only "have we seen this id before" matters.
function seedFromSnapshot() {
  if (db.prepare('SELECT COUNT(*) n FROM jobs').get().n > 0) return 0;
  const snap = path.join(__dirname, '..', 'data', 'jobs.json');
  if (!fs.existsSync(snap)) return 0;
  let jobs = [];
  try { jobs = (JSON.parse(fs.readFileSync(snap, 'utf8')).jobs) || []; } catch { return 0; }
  const ins = db.prepare('INSERT OR IGNORE INTO jobs (id,title,employer,first_seen,last_seen) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    for (const j of jobs) ins.run(j.id, j.title || '', j.employer || '', j.first_seen || '', j.last_seen || '');
  });
  tx();
  return jobs.length;
}

async function runScan() {
  const seeded = seedFromSnapshot();
  if (seeded) console.log(`Seeded ${seeded} known roles from data/jobs.json (cold start).`);
  const started = new Date().toISOString();
  const run = db.prepare('INSERT INTO scan_runs (started_at) VALUES (?)').run(started);
  const runId = run.lastInsertRowid;
  const recordSource = db.prepare('INSERT INTO source_results (run_id,source,query,status,count,error) VALUES (?,?,?,?,?,?)');

  const keywords = list('SEARCH_KEYWORDS', 'data analyst');
  const locations = list('SEARCH_LOCATIONS', 'uk');
  const atsBoards = list('ATS_BOARDS', '');

  // --- phase 1: collect every source, recording what each returned (honest scan log) ---
  const candidates = []; // { raw, priority }
  const employers = new Set();
  async function collect(label, query, result, priority) {
    recordSource.run(runId, label, query || '', result.status, result.jobs.length, result.error || null);
    if (result.status !== 'ok') return;
    for (const raw of result.jobs) {
      employers.add((raw.employer || '').toLowerCase());
      candidates.push({ raw, priority });
    }
  }

  for (const where of locations) {
    for (const kw of keywords) {
      await collect('adzuna', `${kw} @ ${where}`, await fetchAdzuna(kw, where), 1);
      await collect('reed', `${kw} @ ${where}`, await fetchReed(kw, where), 2);
    }
  }
  for (const board of atsBoards) {                       // ATS = full descriptions, straight from employer
    await collect(board, board, await fetchATS(board), 3);
  }
  await collect('nhs', 'nationwide', await fetchNHS(), 0);
  await collect('civilservice', 'nationwide', await fetchCivilService(), 0);

  // --- phase 2: dedup. Keep the richest version: highest source priority, then longest text. ---
  const best = new Map(); // fingerprint -> { raw, priority }
  for (const c of candidates) {
    const fp = fingerprint(c.raw.employer, c.raw.title);
    c.raw.fingerprint = fp;
    const cur = best.get(fp);
    if (!cur) { best.set(fp, c); continue; }
    const better = c.priority > cur.priority ||
      (c.priority === cur.priority && (c.raw.description || '').length > (cur.raw.description || '').length);
    if (better) best.set(fp, c);
  }

  // --- phase 3: score + persist; gather freshly-inserted roles for alerting ---
  let totalFound = 0, newJobs = 0;
  const inserted = [];
  for (const { raw } of best.values()) {
    const scored = score(raw);
    const outcome = upsertJob(scored);
    totalFound++;
    if (outcome === 'inserted') { newJobs++; inserted.push(scored); }
  }

  db.prepare('UPDATE scan_runs SET finished_at=?, total_found=?, new_jobs=?, employers_checked=? WHERE id=?')
    .run(new Date().toISOString(), totalFound, newJobs, employers.size, runId);

  exportJson();
  const alerted = await notifyNewJobs(inserted);
  return { runId, totalFound, newJobs, employers: employers.size, alerted };
}

// Portable snapshot for git diffing / static viewing. Machine fields only.
function exportJson() {
  const rows = db.prepare(`SELECT id,title,employer,location,region,category,salary,salary_status,soc_code,url,source,
    tier,confidence,reason,fit_score,register_match,register_name,first_seen,last_seen
    FROM jobs ORDER BY confidence DESC, last_seen DESC`).all();
  const out = path.join(__dirname, '..', 'data', 'jobs.json');
  fs.writeFileSync(out, JSON.stringify({ generated_at: new Date().toISOString(), count: rows.length, jobs: rows }, null, 2));
}

if (require.main === module) {
  runScan().then(r => { console.log('Scan complete:', r); process.exit(0); })
    .catch(e => { console.error('Scan failed:', e); process.exit(1); });
}

module.exports = { runScan };
