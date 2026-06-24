'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const { db } = require('./db');
const { runScan } = require('./scan');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- jobs feed, filterable ---
app.get('/api/jobs', (req, res) => {
  const { status, tier, region, category, q, includeExcluded, salary, hideUnderpaid } = req.query;
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
  const sql = `SELECT * FROM jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE tier WHEN 'A' THEN 0 WHEN 'B-' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'unknown' THEN 4 ELSE 5 END,
    confidence DESC, last_seen DESC`;
  res.json(db.prepare(sql).all(...args));
});

// --- counts for the stat bar ---
app.get('/api/stats', (req, res) => {
  const by = col => db.prepare(`SELECT ${col} k, COUNT(*) n FROM jobs GROUP BY ${col}`).all()
    .reduce((a, r) => (a[r.k] = r.n, a), {});
  res.json({ total: db.prepare("SELECT COUNT(*) n FROM jobs WHERE tier != 'excluded'").get().n,
    excluded: db.prepare("SELECT COUNT(*) n FROM jobs WHERE tier = 'excluded'").get().n,
    byStatus: by('status'), byTier: by('tier') });
});

// --- scan log: what was scanned, when, and how it went ---
app.get('/api/scans', (req, res) => {
  const runs = db.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 12').all();
  const srcStmt = db.prepare('SELECT source,query,status,count,error FROM source_results WHERE run_id = ?');
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Board running at http://localhost:${PORT}`));

// Built-in scheduler: every 3 hours while the server is up.
cron.schedule('0 */3 * * *', async () => {
  if (scanning) return;
  scanning = true;
  try { const r = await runScan(); console.log('Scheduled scan:', r); }
  catch (e) { console.error('Scheduled scan failed:', e); }
  finally { scanning = false; }
});
