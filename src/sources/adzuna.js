'use strict';
// Adzuna UK job search. Free developer tier: https://developer.adzuna.com/
// Paginates: the search API returns one page at a time (max 50/page), so we walk pages
// until a short/empty page or ADZUNA_MAX_PAGES — turning a ~50-job ceiling into hundreds.
const crypto = require('crypto');

function jobId(source, employer, title, location) {
  return crypto.createHash('sha1').update([source, employer, title, location].join('|').toLowerCase()).digest('hex').slice(0, 16);
}

const PER_PAGE = 50;

// Adzuna embeds your APP_ID in redirect URLs as utm_source — strip the tracking params so the
// app_id never leaks into the committed data/jobs.json snapshot. The signing params (se, v) stay.
function cleanUrl(u) {
  try {
    const url = new URL(u);
    url.searchParams.delete('utm_source');
    url.searchParams.delete('utm_medium');
    return url.toString();
  } catch { return u || ''; }
}

function mapResult(r, where) {
  const employer = (r.company && r.company.display_name) || 'Unknown';
  const location = (r.location && r.location.display_name) || where || '';
  const title = r.title || '';
  const salaryMin = r.salary_min || 0, salaryMax = r.salary_max || 0;
  const salary = salaryMin ? `£${Math.round(salaryMin / 1000)}k–£${Math.round((salaryMax || salaryMin) / 1000)}k` : '';
  return {
    id: jobId('adzuna', employer, title, location),
    title, employer, location, salary, salaryMin, salaryMax,
    url: cleanUrl(r.redirect_url || ''), source: 'adzuna',
    description: (r.description || '').slice(0, 2000)
  };
}

async function fetchAdzuna(keyword, where) {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) return { status: 'skipped', error: 'no ADZUNA keys', jobs: [] };
  const maxPages = Math.max(1, Number(process.env.ADZUNA_MAX_PAGES) || 5);

  const jobs = [];
  let rateLimited = false;
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      app_id: id, app_key: key, results_per_page: String(PER_PAGE), what: keyword,
      'content-type': 'application/json'
    });
    if (where && where !== 'uk') params.set('where', where);
    const url = `https://api.adzuna.com/v1/api/jobs/gb/search/${page}?${params.toString()}`;
    try {
      const res = await fetch(url);
      if (res.status === 429) { rateLimited = true; break; }
      if (!res.ok) {
        if (page === 1) return { status: 'failed', error: 'HTTP ' + res.status, jobs: [] };
        break; // keep what we already have from earlier pages
      }
      const data = await res.json();
      const results = data.results || [];
      for (const r of results) jobs.push(mapResult(r, where));
      if (results.length < PER_PAGE) break; // last page reached
    } catch (e) {
      if (page === 1) return { status: 'failed', error: String(e.message || e), jobs: [] };
      break;
    }
  }
  // Partial coverage from a rate limit is still useful; flag it so the scan log is honest.
  if (rateLimited) return { status: jobs.length ? 'ok' : 'rate_limited', error: jobs.length ? 'partial: HTTP 429' : 'HTTP 429', jobs };
  return { status: 'ok', jobs };
}

module.exports = { fetchAdzuna, jobId };
