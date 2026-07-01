'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, upsertOpportunity } = require('../db');
const { score, norm } = require('./score');
const { send } = require('../notify');
const { fetchAdzuna } = require('../sources/adzuna');
const { fetchSchemes } = require('./sources/schemes');
const { fetchScraper } = require('./sources/scraper');

function list(env, fallback) {
  return (process.env[env] || fallback || '').split(',').map(s => s.trim()).filter(Boolean);
}
function fingerprint(institution, title) {
  return crypto.createHash('sha1').update(norm(institution) + '|' + norm(title)).digest('hex').slice(0, 16);
}

// Research-flavoured Adzuna queries (role x topic), tuned to the user's clusters.
const DEFAULT_QUERIES = [
  'phd studentship', 'funded phd', 'postdoctoral researcher', 'research fellow', 'research associate',
  'doctoral researcher',
  // his cluster (data / tech)
  'phd data science', 'phd machine learning', 'research fellow health data',
  // her cluster (nutrition / dietetics / public health) — the majority of research is for her
  'phd nutrition', 'phd dietetics', 'phd public health', 'phd epidemiology', 'phd food science',
  'postdoctoral public health', 'research fellow nutrition', 'research associate public health',
  'phd nutritional sciences', 'phd dietitian', 'phd global health', 'phd health services research',
  'phd maternal child nutrition', 'phd obesity', 'phd diabetes nutrition', 'phd food policy',
  'phd biostatistics', 'phd health economics', 'phd community health', 'phd population health',
  'postdoctoral nutrition', 'postdoctoral epidemiology', 'research fellow dietetics',
  'research fellow public health', 'research associate nutrition', 'clinical research nutrition',
  'phd sports nutrition', 'phd physical activity health', 'phd non-communicable disease'
];

async function runResearchScan() {
  const started = new Date().toISOString();
  const run = db.prepare("INSERT INTO scan_runs (kind, started_at) VALUES ('research', ?)").run(started);
  const runId = run.lastInsertRowid;
  const recordSource = db.prepare('INSERT INTO source_results (run_id,source,query,status,count,error) VALUES (?,?,?,?,?,?)');

  const queries = list('RESEARCH_KEYWORDS', '').length ? list('RESEARCH_KEYWORDS', '') : DEFAULT_QUERIES;
  const where = (process.env.SEARCH_LOCATIONS || 'uk').split(',')[0].trim() || 'uk';

  const candidates = [];
  function collect(label, query, result) {
    const items = result.opportunities || result.jobs || [];
    recordSource.run(runId, label, query || '', result.status, items.length, result.error || null);
    if (result.status !== 'ok') return;
    for (const raw of items) {
      candidates.push({
        id: raw.id, title: raw.title, institution: raw.institution || raw.employer || 'Unknown',
        location: raw.location || '', url: raw.url || '', source: raw.source || label,
        description: raw.description || '', type: raw.type || '', deadline: raw.deadline || ''
      });
    }
  }

  for (const q of queries) collect('adzuna', q, await fetchAdzuna(q, where));
  collect('scheme', 'curated schemes', fetchSchemes());
  collect('scraper', 'paid scraper', await fetchScraper());

  // Dedup by fingerprint (richest/longest description wins), then score + persist.
  const best = new Map();
  for (const c of candidates) {
    const fp = fingerprint(c.institution, c.title);
    c.fingerprint = fp;
    const cur = best.get(fp);
    if (!cur || (c.description || '').length > (cur.description || '').length) best.set(fp, c);
  }

  let total = 0, fresh = 0;
  const inserted = [];
  for (const c of best.values()) {
    const scored = score(c);
    const outcome = upsertOpportunity(scored);
    total++;
    if (outcome === 'inserted') { fresh++; inserted.push(scored); }
  }

  db.prepare('UPDATE scan_runs SET finished_at=?, total_found=?, new_jobs=? WHERE id=?')
    .run(new Date().toISOString(), total, fresh, runId);

  exportJson();
  // Alert on new top-tier funded + international-open opportunities.
  const worthy = inserted.filter(o => o.tier === 'A').sort((a, b) => b.confidence - a.confidence);
  if (worthy.length) {
    const body = `🎓 ${worthy.length} new funded research opportunit${worthy.length > 1 ? 'ies' : 'y'} (fully funded / international-open)\n\n`
      + worthy.slice(0, 12).map(o => `[${o.tier}] ${o.title} — ${o.institution}\n${o.url}`).join('\n\n');
    await send(body);
  }
  return { runId, total, fresh, alerted: worthy.length };
}

function exportJson() {
  const rows = db.prepare(`SELECT id,title,institution,type,area_cluster,location,url,source,deadline,
    funding_status,fees_cover,international_eligible,tier,confidence,reason,fit_score,first_seen,last_seen
    FROM opportunities ORDER BY tier, confidence DESC, last_seen DESC`).all();
  fs.writeFileSync(path.join(__dirname, '..', '..', 'data', 'opportunities.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), count: rows.length, opportunities: rows }, null, 2));
}

if (require.main === module) {
  runResearchScan().then(r => { console.log('Research scan complete:', r); process.exit(0); })
    .catch(e => { console.error('Research scan failed:', e); process.exit(1); });
}

module.exports = { runResearchScan };
