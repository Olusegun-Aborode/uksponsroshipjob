# Sponsorship Job Board

A live UK Skilled Worker sponsorship job board. It scans **legitimate** job feeds, cross-references every employer against the **gov.uk Register of Licensed Sponsors**, scores each role by **sponsorship confidence** (with a visible reason), and tracks your applications — all ranked so explicit-CoS roles sit at the top.

Built to be opened and extended in **Claude Code**.

---

## What it does

- **Prioritises explicit-CoS roles.** Every job gets a tier with a plain-English reason:
  - **A** — posting states sponsorship *and* the employer is on the register → pinned to top
  - **B−** — posting claims sponsorship, employer not yet matched → verify the legal entity
  - **B** — on the register, posting silent → ask the recruiter early
  - **C** — possible register match, no signal
  - **excluded** — posting says *no* sponsorship → kept but ranked out, never deleted
- **Shows what it scanned.** A scan log records every source hit (Adzuna, Reed, each ATS board, the stubs), its status (ok / failed / rate-limited / skipped), counts, and timestamps — so coverage gaps are visible, not silent.
- **Tracks applications.** Status, notes, applied date, register-verified flag — and a scan **never overwrites** your tracking fields.
- **Recall-first.** It casts wide and ranks; it doesn't throw borderline roles away.

## Data sources (all legitimate — no scraping of LinkedIn/Indeed)

- **Adzuna API** (free dev tier) — UK-wide backbone
- **Reed API** (free key) — optional second feed
- **Company ATS boards** — Greenhouse / Lever / Ashby public JSON endpoints, straight from the source
- **gov.uk Register of Licensed Sponsors** — the cross-reference that turns "a job" into "a *sponsorable* job"
- **NHS / Civil Service** — honest stubs; many of those roles already arrive via Adzuna/Reed. Complete in Claude Code if you want full coverage.

---

## Quick start

```bash
npm install
cp .env.example .env          # add your Adzuna keys (and Reed if you have one)
npm run register:update       # downloads + loads the gov.uk sponsor register
npm run scan                  # first scan
npm start                     # dashboard at http://localhost:3000
```

The running server scans every 3 hours by itself. You can also hit **Scan now** in the UI.

## Always-on scanning (the default, laptop-off)

`.github/workflows/scan.yml` runs the scan in the cloud every 3 hours for free and commits `data/jobs.json`.

1. Push this repo to GitHub.
2. Settings → Secrets and variables → Actions:
   - **Secrets:** `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `REED_API_KEY`
   - **Variables:** `SEARCH_KEYWORDS`, `SEARCH_LOCATIONS`, `ATS_BOARDS`
3. The Actions tab will show each run. Discovery (the jobs feed) happens in the cloud; your application tracking stays in your local DB.

> Want one always-on place for both feed *and* tracking? Deploy `npm start` to Render/Railway/Fly with a persistent disk — then the built-in cron does everything and there's no split. Claude Code can wire that up with you.

---

## Architecture

```
src/
  server.js        Express API + serves the dashboard + 3-hourly cron
  scan.js          orchestrates sources → dedup → score → DB → jobs.json
  score.js         sponsorship tiering (A/B-/B/C/excluded) + reasons + fit
  register.js      downloads & matches the gov.uk sponsor register
  db.js            SQLite schema; protects your tracking fields on re-scan
  sources/
    adzuna.js  reed.js  ats.js  stubs.js
public/            the dashboard (index.html / styles.css / app.js)
.github/workflows/scan.yml   cloud scanner
```

## Can we just crawl all ~125k sponsors directly?

Short answer: no — and you don't want to. Crawling 125,000 company career sites every few hours isn't feasible, polite, or legal at scale, and most of those sites expose nothing machine-readable. So the register is the **authority on who counts**, not a list of crawl targets. Coverage is layered instead:

1. **Register = the gate.** Every job from every feed is cross-referenced against the 125k list, route-aware (Skilled Worker vs other licences).
2. **Broad discovery via aggregator APIs** (Adzuna, Reed) — these already index a large share of UK sponsor jobs nationwide. Cross-referencing their results gives you Tier A/B at national scale without crawling anyone.
3. **Deep discovery via ATS for a growing curated subset.** For sponsors you actually care about, pull their Greenhouse/Lever/Ashby public JSON board directly (add them to `ATS_BOARDS`). This is the legitimate way to read jobs *straight from* registered sponsors.

The right mental model: **register filters, feeds discover broadly, ATS pulls discover deeply.** Good Claude Code next step: an ATS auto-detect that, for a priority sponsor + its domain, probes known ATS endpoints — scaling layer 3 without a generic web crawler. (The register CSV has no website column, so name→domain is the missing piece to solve there.)

## Honest limitations (because the stakes are real)

- **No scanner catches 100% of sponsored jobs.** Many roles never mention sponsorship even when the employer would; some employers only post on their own careers page. This tool **narrows and ranks** the funnel — it doesn't guarantee completeness.
- **"On the register" ≠ "will sponsor this role."** Always confirm the exact legal entity on gov.uk before applying, and run your shortlist past an **OISC-regulated** adviser before committing.
- The register CSV link on gov.uk changes each update; `register.js` finds it automatically but if gov.uk changes its page layout, download the CSV manually and set `REGISTER_CSV=/path/to/file.csv`.

## Good first things to build in Claude Code

- Add your real target companies to `ATS_BOARDS` (find slugs in their careers URLs).
- Implement the NHS / Civil Service adapters in `src/sources/stubs.js`.
- Add an email/Telegram alert when a new **Tier A** role appears.
- Add SOC-code mapping + salary-threshold pass/fail per role.
- Improve register name-matching (fuzzy / alias handling) in `register.js`.

*General information, not immigration advice.*
