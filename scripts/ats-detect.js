'use strict';
// ATS auto-detect. The register says WHO can sponsor but has no website/board column, so the
// missing piece is name -> ATS board. Give this company names; it generates slug candidates and
// probes the three public ATS APIs, printing the provider:slug lines that actually resolve.
//
//   node scripts/ats-detect.js "Monzo" "Wise" "Octopus Energy"
//   node scripts/ats-detect.js                      # uses the built-in candidate list below
//
// Paste the working lines it prints into ATS_BOARDS in .env. No scraping — these are the same
// public JSON endpoints the scanner already reads.

const CANDIDATES = [
  'Monzo', 'Wise', 'Revolut', 'Starling Bank', 'GoCardless', 'Checkout.com', 'Cleo', 'Freetrade',
  'Octopus Energy', 'Deliveroo', 'Trainline', 'Depop', 'Moonpig', 'Zego', 'Onfido', 'Tractable',
  'Multiverse', 'Snyk', 'Improbable', 'Thought Machine', 'Paddle', 'Cohere', 'Synthesia', 'PhotoRoom'
];

function slugs(name) {
  const base = name.toLowerCase().replace(/\b(ltd|limited|plc|inc|the|uk)\b/g, '').replace(/&/g, 'and').trim();
  const alnum = base.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const set = new Set([
    alnum.replace(/ /g, ''),     // monzobank
    alnum.replace(/ /g, '-'),    // monzo-bank
    alnum.split(' ')[0]          // monzo
  ]);
  return Array.from(set).filter(Boolean);
}

async function probe(provider, slug) {
  const urls = {
    greenhouse: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
    lever: `https://api.lever.co/v0/postings/${slug}?mode=json`,
    ashby: `https://api.ashbyhq.com/posting-api/job-board/${slug}`
  };
  try {
    const res = await fetch(urls[provider]);
    if (!res.ok) return 0;
    const data = await res.json();
    const jobs = provider === 'lever' ? data : (data.jobs || []);
    return Array.isArray(jobs) ? jobs.length : 0;
  } catch { return 0; }
}

async function detect(name) {
  for (const slug of slugs(name)) {
    for (const provider of ['greenhouse', 'lever', 'ashby']) {
      const n = await probe(provider, slug);
      if (n > 0) return { name, line: `${provider}:${slug}`, count: n };
    }
  }
  return { name, line: null };
}

(async () => {
  const names = process.argv.slice(2);
  const targets = names.length ? names : CANDIDATES;
  console.log(`Probing ${targets.length} compan${targets.length === 1 ? 'y' : 'ies'}…\n`);
  const found = [];
  for (const name of targets) {
    const r = await detect(name);
    if (r.line) { console.log(`  ✓ ${name.padEnd(20)} ${r.line}  (${r.count} jobs)`); found.push(r.line); }
    else console.log(`  -  ${name.padEnd(20)} no public Greenhouse/Lever/Ashby board found`);
  }
  if (found.length) {
    console.log(`\nAdd to ATS_BOARDS in .env:\n\nATS_BOARDS=${found.join(',')}\n`);
  } else {
    console.log('\nNo boards detected.');
  }
})();
