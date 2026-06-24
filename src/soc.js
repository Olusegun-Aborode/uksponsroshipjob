'use strict';
// Skilled Worker salary gate. Turns "licensed sponsor" into "can sponsor THIS role at a legal salary".
// A sponsor cannot issue a CoS below the higher of (general threshold, the role's SOC going rate),
// so a role advertised under that figure is very likely not sponsorable even if the employer is licensed.
// Figures live in data/soc-going-rates.json and are configurable / must be verified against gov.uk.
const fs = require('fs');
const path = require('path');

let TABLE = { general_threshold: 38700, occupations: [] };
try {
  TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'soc-going-rates.json'), 'utf8'));
} catch (e) { /* fall back to defaults below */ }

const GENERAL = Number(process.env.SALARY_THRESHOLD_GENERAL) || TABLE.general_threshold || 41700;
// New entrant (e.g. switching from a Graduate visa, or under 26): a reduced floor and ~70% of the
// going rate. Default ON because that's this board's owner — set SALARY_PROFILE=experienced to use
// the full rates. Verify your own eligibility on gov.uk.
const NEW_ENTRANT_FLOOR = Number(process.env.SALARY_NEW_ENTRANT) || 33400;
const NEW_ENTRANT_FACTOR = 0.7;
const PROFILE = (process.env.SALARY_PROFILE || 'new_entrant').toLowerCase();

// Map a job title to its most likely SOC occupation (first keyword hit wins).
function classify(title) {
  const t = (title || '').toLowerCase();
  for (const occ of TABLE.occupations || []) {
    if ((occ.keywords || []).some(k => t.includes(k))) return occ;
  }
  return null;
}

// The salary you must beat, given the applicant profile.
function requiredFor(occ) {
  const going = occ ? (occ.going_rate_annual || 0) : 0;
  return PROFILE === 'new_entrant'
    ? Math.max(NEW_ENTRANT_FLOOR, Math.round(going * NEW_ENTRANT_FACTOR))
    : Math.max(GENERAL, going);
}

// Decide whether the advertised salary clears the sponsorship floor.
//   pass       — even the bottom of the range clears the required figure
//   fail       — even the top of the range is below it (likely NOT sponsorable)
//   borderline — the range straddles the threshold
//   unknown    — no salary disclosed (most ATS / many aggregator posts)
function salaryCheck(job) {
  const occ = classify(job.title);
  const required = requiredFor(occ);
  const min = Number(job.salaryMin) || 0;
  const max = Number(job.salaryMax) || 0;
  const soc_code = occ ? occ.soc : '';
  const soc_title = occ ? occ.title : '';

  if (!min && !max) return { status: 'unknown', required, soc_code, soc_title };
  const top = max || min;
  const bottom = min || max;
  let status;
  if (top < required) status = 'fail';
  else if (bottom >= required) status = 'pass';
  else status = 'borderline';
  return { status, required, soc_code, soc_title };
}

const gbp = n => '£' + Math.round(n / 1000) + 'k';

module.exports = { classify, salaryCheck, GENERAL, gbp };
