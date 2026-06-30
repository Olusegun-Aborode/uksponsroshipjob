'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'db.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,         -- stable hash of source+employer+title+location
  title         TEXT NOT NULL,
  employer      TEXT NOT NULL,
  location      TEXT,
  region        TEXT,
  category      TEXT,
  salary        TEXT,
  url           TEXT,
  source        TEXT,                     -- adzuna | reed | greenhouse:slug | ...
  description   TEXT,
  -- machine-owned scoring (refreshed every scan) --
  tier          TEXT,                     -- A | B | B- | C | excluded | unknown
  confidence    INTEGER,                  -- 0-100
  reason        TEXT,                     -- human-readable explanation of the tier
  fit_score     INTEGER,                  -- 0-100 match to your profile
  register_match TEXT,                    -- exact | fuzzy | none
  register_name TEXT,                     -- the matched legal entity, if any
  salary_min    INTEGER DEFAULT 0,        -- numeric, for the sponsorship salary gate
  salary_max    INTEGER DEFAULT 0,
  salary_status TEXT,                     -- pass | fail | borderline | unknown
  soc_code      TEXT,                     -- matched SOC 2020 occupation code
  soc_title     TEXT,
  fingerprint   TEXT,                     -- source-agnostic key for cross-source dedup
  first_seen    TEXT,
  last_seen     TEXT,
  -- user-owned (NEVER overwritten by a scan) --
  status        TEXT DEFAULT 'new',       -- new|interested|applied|interviewing|offer|rejected|not_suitable
  user_notes    TEXT DEFAULT '',
  date_applied  TEXT DEFAULT '',
  deadline      TEXT DEFAULT '',
  user_verified INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS register (
  norm_name      TEXT PRIMARY KEY,        -- normalised legal entity name
  legal_name     TEXT,
  rating         TEXT,                    -- e.g. "Worker (A rating)"
  routes         TEXT,                    -- all licensed routes, "; " joined
  skilled_worker INTEGER DEFAULT 0        -- 1 if they hold a Skilled Worker licence
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT DEFAULT 'jobs',           -- jobs | research
  started_at  TEXT,
  finished_at TEXT,
  total_found INTEGER DEFAULT 0,
  new_jobs    INTEGER DEFAULT 0,
  employers_checked INTEGER DEFAULT 0
);

-- Funded research opportunities (PhD studentships, postdocs/fellows, fellowships & scholarships).
-- A funded PhD = Student visa; salaried research roles = Skilled Worker. Scored on funding + eligibility.
CREATE TABLE IF NOT EXISTS opportunities (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  institution   TEXT NOT NULL,
  department    TEXT,
  supervisor    TEXT,
  type          TEXT,                        -- phd | postdoc | fellowship | scholarship
  area_cluster  TEXT,                        -- tech | health | other
  location      TEXT,
  url           TEXT,
  source        TEXT,                        -- adzuna | scheme | scraper | ...
  description   TEXT,
  deadline      TEXT,                        -- machine-extracted closing date, if any
  -- machine-owned scoring (refreshed every scan) --
  funding_status        TEXT,               -- fully | partial | unfunded | unknown | salaried
  funding_source        TEXT,
  stipend               TEXT,
  fees_cover            TEXT,               -- international | home | unknown
  international_eligible TEXT,              -- yes | no | unknown
  tier          TEXT,                        -- A | B | C | excluded
  confidence    INTEGER,
  reason        TEXT,
  fit_score     INTEGER,
  fingerprint   TEXT,
  first_seen    TEXT,
  last_seen     TEXT,
  -- user-owned (NEVER overwritten by a scan) --
  status        TEXT DEFAULT 'new',          -- new|interested|applied|interviewing|offer|rejected|not_suitable
  user_notes    TEXT DEFAULT '',
  date_applied  TEXT DEFAULT '',
  deadline_user TEXT DEFAULT '',
  user_flagged  INTEGER DEFAULT 0,
  -- AI cache --
  pack_json     TEXT,
  pack_at       TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS source_results (
  run_id   INTEGER,
  source   TEXT,
  query    TEXT,
  status   TEXT,                          -- ok | failed | rate_limited | skipped
  count    INTEGER DEFAULT 0,
  error    TEXT,
  FOREIGN KEY(run_id) REFERENCES scan_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_tier ON jobs(tier);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`);

// Migrate an existing DB created before these columns existed (must run before indexing them).
const have = new Set(db.prepare("PRAGMA table_info(jobs)").all().map(c => c.name));
for (const [col, ddl] of [
  ['salary_min', 'INTEGER DEFAULT 0'], ['salary_max', 'INTEGER DEFAULT 0'],
  ['salary_status', 'TEXT'], ['soc_code', 'TEXT'], ['soc_title', 'TEXT'], ['fingerprint', 'TEXT'],
  ['generated_cv', 'TEXT'], ['generated_analysis', 'TEXT'], ['generated_at', 'TEXT'],
  ['prep_json', 'TEXT'], ['prep_at', 'TEXT']
]) {
  if (!have.has(col)) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${ddl}`);
}
db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_fingerprint ON jobs(fingerprint)');

// scan_runs.kind for DBs created before the research section existed.
const srCols = new Set(db.prepare('PRAGMA table_info(scan_runs)').all().map(c => c.name));
if (!srCols.has('kind')) db.exec("ALTER TABLE scan_runs ADD COLUMN kind TEXT DEFAULT 'jobs'");
db.exec('CREATE INDEX IF NOT EXISTS idx_opps_tier ON opportunities(tier)');
db.exec('CREATE INDEX IF NOT EXISTS idx_opps_fingerprint ON opportunities(fingerprint)');

// Insert a job if new; if it already exists, refresh ONLY machine-owned fields.
const insertStmt = db.prepare(`
INSERT INTO jobs (id,title,employer,location,region,category,salary,salary_min,salary_max,url,source,description,
  tier,confidence,reason,fit_score,register_match,register_name,salary_status,soc_code,soc_title,fingerprint,first_seen,last_seen)
VALUES (@id,@title,@employer,@location,@region,@category,@salary,@salary_min,@salary_max,@url,@source,@description,
  @tier,@confidence,@reason,@fit_score,@register_match,@register_name,@salary_status,@soc_code,@soc_title,@fingerprint,@now,@now)
`);
const updateMachineStmt = db.prepare(`
UPDATE jobs SET
  title=@title, employer=@employer, location=@location, region=@region, category=@category,
  salary=@salary, salary_min=@salary_min, salary_max=@salary_max, url=@url, source=@source, description=@description,
  tier=@tier, confidence=@confidence, reason=@reason, fit_score=@fit_score,
  register_match=@register_match, register_name=@register_name,
  salary_status=@salary_status, soc_code=@soc_code, soc_title=@soc_title, fingerprint=@fingerprint, last_seen=@now
WHERE id=@id
`);
const existsStmt = db.prepare('SELECT id FROM jobs WHERE id = ?');

function upsertJob(job) {
  const now = new Date().toISOString();
  const exists = existsStmt.get(job.id);
  const row = Object.assign({
    now, salary_min: job.salaryMin || 0, salary_max: job.salaryMax || 0,
    salary_status: job.salary_status || 'unknown', soc_code: job.soc_code || '',
    soc_title: job.soc_title || '', fingerprint: job.fingerprint || ''
  }, job);
  row.salary_min = job.salaryMin || 0;          // ensure camelCase source fields win
  row.salary_max = job.salaryMax || 0;
  if (exists) { updateMachineStmt.run(row); return 'updated'; }
  insertStmt.run(row); return 'inserted';
}

// --- opportunities: insert if new; on re-scan refresh ONLY machine fields (protect user + AI cache) ---
const oppInsert = db.prepare(`
INSERT INTO opportunities (id,title,institution,department,supervisor,type,area_cluster,location,url,source,description,deadline,
  funding_status,funding_source,stipend,fees_cover,international_eligible,tier,confidence,reason,fit_score,fingerprint,first_seen,last_seen)
VALUES (@id,@title,@institution,@department,@supervisor,@type,@area_cluster,@location,@url,@source,@description,@deadline,
  @funding_status,@funding_source,@stipend,@fees_cover,@international_eligible,@tier,@confidence,@reason,@fit_score,@fingerprint,@now,@now)
`);
const oppUpdate = db.prepare(`
UPDATE opportunities SET
  title=@title, institution=@institution, department=@department, supervisor=@supervisor, type=@type,
  area_cluster=@area_cluster, location=@location, url=@url, source=@source, description=@description, deadline=@deadline,
  funding_status=@funding_status, funding_source=@funding_source, stipend=@stipend, fees_cover=@fees_cover,
  international_eligible=@international_eligible, tier=@tier, confidence=@confidence, reason=@reason, fit_score=@fit_score,
  fingerprint=@fingerprint, last_seen=@now
WHERE id=@id
`);
const oppExists = db.prepare('SELECT id FROM opportunities WHERE id = ?');

function upsertOpportunity(o) {
  const now = new Date().toISOString();
  const row = Object.assign({
    now, department: '', supervisor: '', location: '', description: '', deadline: '',
    funding_source: '', stipend: '', fingerprint: ''
  }, o);
  if (oppExists.get(o.id)) { oppUpdate.run(row); return 'updated'; }
  oppInsert.run(row); return 'inserted';
}

module.exports = { db, upsertJob, upsertOpportunity };
