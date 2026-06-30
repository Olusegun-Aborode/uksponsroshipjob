'use strict';
// Score a funded research opportunity. Two routes: a funded PhD studentship (Student visa, needs full
// funding + international eligibility) and salaried research roles (postdoc/fellow, Skilled Worker).
// Hard gate: surface fully-funded + international-open studentships, plus open salaried research roles.

const FUNDED = [
  'fully funded', 'fully-funded', 'full funding', 'funded phd', 'funded studentship', 'stipend',
  'tax-free stipend', 'ukri rate', 'fees and stipend', 'tuition fees covered', 'covers fees',
  'fees and a stipend', 'maintenance grant', 'fully-funded studentship', 'studentship covering',
  'scholarship covering', 'fee waiver and stipend', 'bursary'
];
const UNFUNDED = [
  'self-funded', 'self funded', 'no funding', 'fees not covered', 'unfunded', 'funding not available',
  'students must secure', 'must secure their own funding', 'no stipend', 'fees only payable'
];
const INTL_OPEN = [
  'international students', 'overseas students', 'open to all nationalities', 'home and overseas',
  'international and home', 'available to international', 'eligible regardless of nationality',
  'all nationalities', 'home or overseas', 'open to international', 'including international'
];
const HOME_ONLY = [
  'home students only', 'uk students only', 'home fee status', 'home fees only', 'home fee only',
  'restricted to home', 'not available to international', 'uk/home students', 'home-rated', 'home rate only'
];

const TECH = ['data science', 'data scientist', 'machine learning', 'artificial intelligence', ' ai ', 'deep learning',
  'blockchain', 'distributed ledger', 'fintech', 'computer science', 'software', 'data engineering', 'analytics',
  'informatics', 'quantitative', 'statistics', 'statistical', 'nlp', 'computer vision', 'data-driven'];
const HEALTH = ['nutrition', 'nutritional', 'dietetic', 'dietitian', 'dietary', 'public health', 'epidemiolog',
  'health data', 'digital health', 'health informatics', 'food science', 'food security', 'obesity', 'metabolic',
  'wellbeing', 'clinical', 'diet ', 'maternal', 'community health', 'global health', 'eating', 'malnutrition', 'nutrient'];

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function findPhrase(t, list) { return list.find(p => t.includes(p)) || null; }

function classifyType(title, given) {
  if (given) return given;
  const t = (title || '').toLowerCase();
  if (/phd|studentship|doctoral|dphil/.test(t)) return 'phd';
  if (/post[- ]?doc|research fellow|research associate|research assistant/.test(t)) return 'postdoc';
  if (/fellowship/.test(t)) return 'fellowship';
  if (/scholarship|bursary/.test(t)) return 'scholarship';
  return 'phd';
}

function score(o) {
  const type = classifyType(o.title, o.type);
  const t = ' ' + (((o.title || '') + ' ' + (o.description || '')).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')) + ' ';
  const salaried = type === 'postdoc' || o.source === 'adzuna' && /research|postdoc|fellow|associate/.test((o.title || '').toLowerCase());

  const funded = findPhrase(t, FUNDED);
  const unfunded = findPhrase(t, UNFUNDED);
  const intlOpen = findPhrase(t, INTL_OPEN);
  const homeOnly = findPhrase(t, HOME_ONLY);

  let funding_status, international_eligible, fees_cover, tier, confidence, reason;

  if (salaried && type !== 'scholarship') {
    funding_status = 'salaried'; international_eligible = 'yes'; fees_cover = 'n/a';
    tier = 'A'; confidence = 80;
    reason = `Salaried research role (postdoc/fellow). Open to apply; check whether the employer can sponsor a Skilled Worker visa (see the Jobs tab logic).`;
  } else if (unfunded && !funded) {
    funding_status = 'unfunded'; international_eligible = homeOnly ? 'no' : 'unknown'; fees_cover = 'unknown';
    tier = 'excluded'; confidence = 0;
    reason = `Self-funded or no funding stated ("${unfunded}"). Kept for review, ranked out.`;
  } else if (funded && homeOnly) {
    funding_status = 'fully'; international_eligible = 'no'; fees_cover = 'home';
    tier = 'C'; confidence = 25;
    reason = `Funded, but Home-fee students only ("${homeOnly}"). Likely not usable as an international applicant. Confirm before applying.`;
  } else if (funded && intlOpen) {
    funding_status = 'fully'; international_eligible = 'yes'; fees_cover = 'international';
    tier = 'A'; confidence = 95;
    reason = `Fully funded ("${funded}") AND open to international students ("${intlOpen}"). Covers overseas fees + stipend. Top priority.`;
  } else if (funded) {
    funding_status = 'fully'; international_eligible = 'unknown'; fees_cover = 'unknown';
    tier = 'B'; confidence = 60;
    reason = `Funded ("${funded}"), but international eligibility is not stated. Verify it covers overseas fees before investing time.`;
  } else {
    funding_status = 'unknown'; international_eligible = homeOnly ? 'no' : (intlOpen ? 'yes' : 'unknown'); fees_cover = 'unknown';
    tier = homeOnly ? 'C' : 'B'; confidence = homeOnly ? 20 : 40;
    reason = homeOnly
      ? `Funding unclear and appears Home-only. Confirm international eligibility and funding.`
      : `Funding not clearly stated. Confirm it is fully funded and open to international students.`;
  }

  // Topic fit across the two clusters; the intersection (health-data) scores highest.
  const techHits = TECH.filter(k => t.includes(k)).length;
  const healthHits = HEALTH.filter(k => t.includes(k)).length;
  let fit = Math.min(100, Math.round(((techHits + healthHits) / 4) * 100));
  if (techHits > 0 && healthHits > 0) fit = Math.min(100, fit + 20);
  const area_cluster = techHits === 0 && healthHits === 0 ? 'other' : (techHits >= healthHits ? 'tech' : 'health');
  // Who is this opportunity for? Health/nutrition/public-health → partner; data/tech → self;
  // intersection (e.g. health-data science) or unknown → either.
  const for_applicant = (techHits > 0 && healthHits > 0) ? 'either'
    : area_cluster === 'health' ? 'partner' : area_cluster === 'tech' ? 'self' : 'either';

  return Object.assign({}, o, {
    type, funding_status, international_eligible, fees_cover, tier, confidence, reason,
    fit_score: fit, area_cluster, for_applicant
  });
}

module.exports = { score, norm };
