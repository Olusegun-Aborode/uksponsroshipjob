'use strict';
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { db } = require('./db');

const REGISTER_PAGE = 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers';
const DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_CSV = path.join(DATA_DIR, 'register.csv');

// Normalise a company name so "Monzo Bank Ltd." and "MONZO BANK LIMITED" match.
function norm(name) {
  return (name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(ltd|limited|plc|llp|llc|inc|incorporated|uk|gb|group|holdings|the|t\/a)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Find the current CSV asset link on the gov.uk publication page (URL changes each update).
async function findCsvUrl() {
  const res = await fetch(REGISTER_PAGE, { headers: { 'User-Agent': 'sponsorship-board/1.0' } });
  if (!res.ok) throw new Error('register page HTTP ' + res.status);
  const html = await res.text();
  const m = html.match(/https:\/\/assets\.publishing\.service\.gov\.uk\/[^"']+\.csv/);
  if (!m) throw new Error('could not locate register CSV link on gov.uk page');
  return m[0];
}

// Precedence: explicit REGISTER_CSV path  ->  bundled data/register.csv  ->  auto-download from gov.uk
async function getCsvText(source) {
  if (source && source !== 'AUTO') {
    if (!fs.existsSync(source)) throw new Error('REGISTER_CSV not found at ' + source);
    return fs.readFileSync(source, 'utf8');
  }
  if (fs.existsSync(LOCAL_CSV)) return fs.readFileSync(LOCAL_CSV, 'utf8');
  const url = await findCsvUrl();
  const res = await fetch(url, { headers: { 'User-Agent': 'sponsorship-board/1.0' } });
  if (!res.ok) throw new Error('register CSV HTTP ' + res.status);
  const text = await res.text();
  fs.writeFileSync(LOCAL_CSV, text);
  return text;
}

// Load the register into SQLite, aggregating multiple route-rows per organisation.
async function updateRegister(source = process.env.REGISTER_CSV || 'AUTO') {
  const text = await getCsvText(source);
  const records = parse(text, { columns: true, skip_empty_lines: true, relax_column_count: true, bom: true });
  const sample = records[0] || {};
  const nameKey = Object.keys(sample).find(k => /organisation|name/i.test(k)) || Object.keys(sample)[0];
  const ratingKey = Object.keys(sample).find(k => /rating/i.test(k));
  const routeKey = Object.keys(sample).find(k => /route/i.test(k));

  const map = new Map(); // norm_name -> { legal, rating, routes:Set, sw }
  for (const r of records) {
    const legal = (r[nameKey] || '').trim();
    if (!legal) continue;
    const n = norm(legal);
    if (!n) continue;
    const route = ((routeKey ? r[routeKey] : '') || '').trim();
    const rating = ((ratingKey ? r[ratingKey] : '') || '').trim();
    let e = map.get(n);
    if (!e) { e = { legal, rating, routes: new Set(), sw: 0 }; map.set(n, e); }
    if (route) e.routes.add(route);
    if (/^skilled worker$/i.test(route)) e.sw = 1;
  }

  const insert = db.prepare('INSERT OR REPLACE INTO register (norm_name,legal_name,rating,routes,skilled_worker) VALUES (?,?,?,?,?)');
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM register').run();
    for (const [n, e] of map) insert.run(n, e.legal, e.rating, Array.from(e.routes).join('; '), e.sw);
  });
  tx();

  const skilled = Array.from(map.values()).filter(e => e.sw).length;
  return { total: map.size, skilledWorker: skilled };
}

// --- matching ------------------------------------------------------------
const exact = db.prepare('SELECT legal_name,rating,routes,skilled_worker FROM register WHERE norm_name = ?');
const toks = s => s.split(' ').filter(t => t.length >= 2);

// Lazily build a token index: first-token -> [{ norm, tokens, set, legal, rating, routes, sw }].
// Only candidates sharing a token with the employer are scored, so 125k rows stay cheap.
let INDEX = null;
function buildIndex() {
  INDEX = new Map();
  const rows = db.prepare('SELECT norm_name,legal_name,rating,routes,skilled_worker FROM register').all();
  for (const r of rows) {
    const tokens = toks(r.norm_name);
    if (!tokens.length) continue;
    const entry = { norm: r.norm_name, tokens, set: new Set(tokens),
      legal: r.legal_name, rating: r.rating, routes: r.routes, sw: !!r.skilled_worker };
    for (const t of tokens) {
      let bucket = INDEX.get(t);
      if (!bucket) { bucket = []; INDEX.set(t, bucket); }
      bucket.push(entry);
    }
  }
}

// Token-set (Jaccard) + containment match, gated on a DISTINCTIVE shared token. A token's document
// frequency (how many register entries contain it) is just its bucket size, so common words like
// "research", "tech", "group", "services" can't carry a match on their own — that kills the
// "G-Research -> A.S.I. (Research) Ltd" class of false positive while still catching "Monzo ->
// Monzo Bank Limited" on the rare token "monzo".
const RARE_DF = 40;
const df = t => { const b = INDEX.get(t); return b ? b.length : 0; };

function fuzzyMatch(jobTokens) {
  if (!INDEX) buildIndex();
  const jset = new Set(jobTokens);
  const seen = new Set();
  let best = null, bestScore = 0;
  for (const t of jobTokens) {
    const bucket = INDEX.get(t);
    if (!bucket) continue;
    for (const e of bucket) {
      if (seen.has(e.norm)) continue;
      seen.add(e.norm);
      const shared = jobTokens.filter(x => e.set.has(x));
      if (!shared.length) continue;
      const inter = shared.length;
      const union = jset.size + e.set.size - inter;
      const jaccard = inter / union;
      const containsAll = inter === jset.size;          // every employer token appears in the entry
      const distinctive = shared.some(x => df(x) <= RARE_DF);
      if (!distinctive) continue;                        // a common word alone can't justify a match
      let ok = jaccard >= 0.6 || (containsAll && e.tokens.length <= jobTokens.length + 2);
      if (jobTokens.length === 1 && e.tokens.length > 3) ok = false; // one-word name vs a long entity: too loose
      if (ok && jaccard > bestScore) { best = e; bestScore = jaccard; }
    }
  }
  return best;
}

function lookup(employer) {
  const n = norm(employer);
  if (!n) return { match: 'none' };
  const row = exact.get(n);
  if (row) return { match: 'exact', name: row.legal_name, rating: row.rating, routes: row.routes, skilledWorker: !!row.skilled_worker };
  const jobTokens = toks(n);
  if (jobTokens.length) {
    const e = fuzzyMatch(jobTokens);
    if (e) return { match: 'fuzzy', name: e.legal, rating: e.rating, routes: e.routes, skilledWorker: e.sw };
  }
  return { match: 'none' };
}

module.exports = { updateRegister, lookup, norm };
