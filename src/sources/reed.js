'use strict';
// Reed.co.uk API. Free key: https://www.reed.co.uk/developers
const { jobId } = require('./adzuna');

async function fetchReed(keyword, where) {
  const key = process.env.REED_API_KEY;
  if (!key) return { status: 'skipped', error: 'no REED_API_KEY', jobs: [] };
  const params = new URLSearchParams({ keywords: keyword, resultsToTake: '50' });
  if (where && where !== 'uk') params.set('locationName', where);
  const url = `https://www.reed.co.uk/api/1.0/search?${params.toString()}`;
  const auth = Buffer.from(key + ':').toString('base64');
  try {
    const res = await fetch(url, { headers: { Authorization: 'Basic ' + auth } });
    if (res.status === 429) return { status: 'rate_limited', error: 'HTTP 429', jobs: [] };
    if (!res.ok) return { status: 'failed', error: 'HTTP ' + res.status, jobs: [] };
    const data = await res.json();
    const jobs = (data.results || []).map(r => {
      const employer = r.employerName || 'Unknown';
      const location = r.locationName || where || '';
      const title = r.jobTitle || '';
      const salaryMin = r.minimumSalary || 0, salaryMax = r.maximumSalary || 0;
      const salary = salaryMin ? `£${Math.round(salaryMin / 1000)}k–£${Math.round((salaryMax || salaryMin) / 1000)}k` : '';
      return {
        id: jobId('reed', employer, title, location),
        title, employer, location, salary, salaryMin, salaryMax,
        url: r.jobUrl || '', source: 'reed',
        description: (r.jobDescription || '').slice(0, 2000)
      };
    });
    return { status: 'ok', jobs };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e), jobs: [] };
  }
}

module.exports = { fetchReed };
