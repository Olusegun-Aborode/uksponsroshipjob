'use strict';
// Bring-your-own scraper slot for deeper funded-PhD coverage (jobs.ac.uk / FindAPhD via a paid,
// terms-compliant service like Apify). Dormant unless RESEARCH_SCRAPER_URL is set, so it ships safely.
//
// Point RESEARCH_SCRAPER_URL at an endpoint that returns a JSON array of items, e.g. an Apify
// "run-sync-get-dataset-items" URL. Optional RESEARCH_SCRAPER_TOKEN is sent as a Bearer header.
// Each item is mapped flexibly from common field names.
const crypto = require('crypto');

function pick(o, keys) { for (const k of keys) if (o[k]) return o[k]; return ''; }

async function fetchScraper() {
  const url = process.env.RESEARCH_SCRAPER_URL;
  if (!url) return { status: 'skipped', error: 'no RESEARCH_SCRAPER_URL', opportunities: [] };
  const headers = { Accept: 'application/json' };
  if (process.env.RESEARCH_SCRAPER_TOKEN) headers.Authorization = 'Bearer ' + process.env.RESEARCH_SCRAPER_TOKEN;
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return { status: 'failed', error: 'HTTP ' + res.status, opportunities: [] };
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items || data.results || []);
    const opportunities = items.map(it => {
      const title = pick(it, ['title', 'jobTitle', 'name', 'role']);
      const institution = pick(it, ['institution', 'employer', 'organisation', 'organization', 'company', 'university']);
      return {
        id: crypto.createHash('sha1').update('scraper|' + institution + '|' + title).digest('hex').slice(0, 16),
        title, institution,
        type: pick(it, ['type']) || '',
        url: pick(it, ['url', 'link', 'jobUrl', 'href']),
        source: 'scraper',
        description: pick(it, ['description', 'summary', 'content', 'jobDescription']).slice(0, 4000),
        deadline: pick(it, ['deadline', 'closingDate', 'closes'])
      };
    }).filter(o => o.title && o.url);
    return { status: 'ok', opportunities };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e), opportunities: [] };
  }
}

module.exports = { fetchScraper };
