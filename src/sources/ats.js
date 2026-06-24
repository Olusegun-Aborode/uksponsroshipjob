'use strict';
// Pull jobs straight from company Applicant Tracking System public JSON boards.
// No scraping, no ToS issues — these endpoints are published for exactly this.
const { jobId } = require('./adzuna');

function strip(html) { return (html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim(); }

async function greenhouse(slug) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.jobs || []).map(j => ({
    id: jobId('greenhouse:' + slug, slug, j.title || '', (j.location && j.location.name) || ''),
    title: j.title || '', employer: slug, location: (j.location && j.location.name) || '',
    salary: '', url: j.absolute_url || '', source: 'greenhouse:' + slug,
    description: strip(j.content).slice(0, 2000)
  }));
}

async function lever(slug) {
  const url = `https://api.lever.co/v0/postings/${slug}?mode=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data || []).map(j => ({
    id: jobId('lever:' + slug, slug, j.text || '', (j.categories && j.categories.location) || ''),
    title: j.text || '', employer: slug, location: (j.categories && j.categories.location) || '',
    salary: '', url: j.hostedUrl || '', source: 'lever:' + slug,
    description: strip(j.descriptionPlain || j.description).slice(0, 2000)
  }));
}

async function ashby(slug) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.jobs || []).map(j => ({
    id: jobId('ashby:' + slug, slug, j.title || '', j.location || ''),
    title: j.title || '', employer: slug, location: j.location || '',
    salary: '', url: j.jobUrl || j.applyUrl || '', source: 'ashby:' + slug,
    description: strip(j.descriptionPlain).slice(0, 2000)
  }));
}

const providers = { greenhouse, lever, ashby };

// board = "greenhouse:monzo"
async function fetchATS(board) {
  const [provider, slug] = board.split(':');
  const fn = providers[provider];
  if (!fn) return { status: 'skipped', error: 'unknown ATS provider ' + provider, jobs: [] };
  try {
    const jobs = await fn(slug);
    // The employer name from a slug is rough; prettify for register matching.
    jobs.forEach(j => { j.employer = slug.replace(/[-_]/g, ' '); });
    return { status: 'ok', jobs };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e), jobs: [] };
  }
}

module.exports = { fetchATS };
