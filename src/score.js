'use strict';
const { lookup } = require('./register');
const { salaryCheck, gbp } = require('./soc');

const POSITIVE = [
  'visa sponsorship', 'sponsorship available', 'we sponsor', 'will sponsor',
  'skilled worker visa', 'certificate of sponsorship', 'cos available',
  'tier 2 sponsor', 'sponsorship is available', 'happy to sponsor', 'able to sponsor',
  'sponsorship provided', 'visa sponsorship available', 'offer sponsorship',
  'sponsorship offered', 'sponsorship considered', 'can provide sponsorship',
  'eligible for sponsorship', 'skilled worker sponsorship', 'sponsor a visa', 'sponsor your visa'
];
const NEGATIVE = [
  'no sponsorship', 'not able to sponsor', 'cannot sponsor', "can't sponsor",
  'unable to sponsor', 'no visa sponsorship', 'we do not sponsor', 'do not offer sponsorship',
  'must have the right to work', 'must already have', 'right to work in the uk is required',
  'no visa', 'without the need for sponsorship', 'not provide sponsorship',
  'sponsorship is not available', 'sponsorship not available', 'unable to provide sponsorship',
  'we are unable to offer sponsorship', 'no visa sponsorship is available'
];
const PROFILE = [
  'sql', 'python', 'data', 'analytics', 'analyst', 'business intelligence', 'power bi',
  'tableau', 'etl', 'pipeline', 'dashboard', 'crm', 'product manager', 'growth', 'snowflake'
];

function findPhrase(text, list) {
  const t = ' ' + text.toLowerCase().replace(/[^a-z0-9'’ ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  return list.find(p => t.includes(' ' + p + ' ') || t.includes(p)) || null;
}

function regionFromLocation(loc) {
  const l = (loc || '').toLowerCase();
  if (/remote|anywhere|home.?based/.test(l)) return 'Remote';
  if (/scotland|edinburgh|glasgow|aberdeen|dundee/.test(l)) return 'Scotland';
  if (/wales|cardiff|swansea|newport/.test(l)) return 'Wales';
  if (/northern ireland|belfast|derry/.test(l)) return 'Northern Ireland';
  if (/london|greater london|croydon|romford|bromley/.test(l)) return 'London/SE';
  return 'Rest of England';
}

function categoryFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (/crm|loyalty|lifecycle|email market/.test(t)) return 'Product & Growth/CRM';
  if (/product manager|product owner|growth/.test(t)) return 'Product & Growth/CRM';
  if (/engineer|developer|software|devops/.test(t)) return 'Software/Data Eng';
  if (/delivery|programme|project manager|scrum|agile/.test(t)) return 'Project/Delivery';
  if (/analyst|analytics|data|business intelligence|bi /.test(t)) return 'Data & Analytics';
  return 'Data & Analytics';
}

// Score a job into a tier with a transparent reason. Route-aware: a register match only counts as
// real sponsorship potential if the employer holds the SKILLED WORKER licence. Salary-aware: a role
// advertised below the sponsorship floor is flagged and ranked down even if the employer is licensed.
function score(job) {
  const text = (job.title || '') + ' ' + (job.description || '');
  const pos = findPhrase(text, POSITIVE);
  const neg = findPhrase(text, NEGATIVE);
  const reg = lookup(job.employer);
  const onSW = reg.match !== 'none' && reg.skilledWorker;       // licensed for Skilled Worker
  const onOther = reg.match !== 'none' && !reg.skilledWorker;   // licensed, but not Skilled Worker
  const strong = reg.match === 'exact';                          // exact name vs fuzzy match
  const matchNote = reg.match === 'fuzzy' ? ' (fuzzy name match — confirm the legal entity)' : '';

  let tier, confidence, reason;

  if (neg) {
    tier = 'excluded'; confidence = 0;
    reason = `Posting states no sponsorship ("${neg}"). Kept for review, ranked out.`;
  } else if (pos && onSW && strong) {
    tier = 'A'; confidence = 96;
    reason = `Top priority: posting states sponsorship ("${pos}") AND ${reg.name} holds a Skilled Worker licence (${reg.rating || 'listed'}).`;
  } else if (pos && onSW) {
    tier = 'A'; confidence = 84;
    reason = `Posting states sponsorship ("${pos}"); likely Skilled Worker sponsor (${reg.name})${matchNote} — confirm the exact legal entity.`;
  } else if (pos && onOther) {
    tier = 'B-'; confidence = 50;
    reason = `Posting claims sponsorship, but ${reg.name} is licensed only for: ${reg.routes}. Confirm they can sponsor a Skilled Worker for this role.`;
  } else if (pos) {
    tier = 'B-'; confidence = 60;
    reason = `Posting claims sponsorship ("${pos}") but employer not found on the register — verify the legal entity name before applying.`;
  } else if (onSW && strong) {
    tier = 'B'; confidence = 55;
    reason = `${reg.name} holds a Skilled Worker licence (${reg.rating || 'listed'}), but this posting doesn't mention sponsorship — ask the recruiter early.`;
  } else if (onSW) {
    tier = 'C'; confidence = 35;
    reason = `Likely Skilled Worker sponsor (${reg.name})${matchNote}; posting silent. Verify the entity before investing time.`;
  } else if (onOther) {
    tier = 'C'; confidence = 22;
    reason = `${reg.name} is a licensed sponsor but NOT for the Skilled Worker route (${reg.routes}) — probably not usable for this role.`;
  } else {
    tier = 'unknown'; confidence = 15;
    reason = `No sponsorship signal and employer not matched on the register. Low confidence — confirm manually.`;
  }

  // --- salary gate: can they legally sponsor THIS role at the advertised pay? ---
  const sc = salaryCheck(job);
  if (tier !== 'excluded') {
    if (sc.status === 'fail') {
      confidence = Math.min(confidence, 20);
      reason += ` ⚠ Advertised pay is below the ~${gbp(sc.required)} Skilled Worker floor${sc.soc_title ? ` for ${sc.soc_title}` : ''} — likely NOT sponsorable at this salary.`;
    } else if (sc.status === 'pass') {
      confidence = Math.min(100, confidence + 4);
      reason += ` ✓ Salary clears the ~${gbp(sc.required)} sponsorship floor.`;
    } else if (sc.status === 'borderline') {
      reason += ` ◑ Salary range straddles the ~${gbp(sc.required)} floor — confirm the offer clears it.`;
    }
  }

  const t = text.toLowerCase();
  const hits = PROFILE.filter(k => t.includes(k)).length;
  const fit_score = Math.min(100, Math.round((hits / 6) * 100));

  return Object.assign({}, job, {
    tier, confidence, reason, fit_score,
    register_match: reg.match,
    register_name: reg.name || '',
    salary_status: sc.status,
    soc_code: sc.soc_code || '',
    soc_title: sc.soc_title || '',
    region: job.region || regionFromLocation(job.location),
    category: job.category || categoryFromTitle(job.title)
  });
}

module.exports = { score, regionFromLocation, categoryFromTitle };
