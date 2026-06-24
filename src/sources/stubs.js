'use strict';
// NHS Jobs and Civil Service Jobs do not publish clean open APIs.
// These are honest stubs so the architecture is ready. Two ways to complete them in Claude Code:
//   1) Many NHS trusts post the SAME roles to Adzuna/Reed — so you already catch a lot indirectly.
//   2) For full coverage, add an RSS/HTML adapter here (respect each site's robots.txt and terms),
//      or have Claude Code build a saved-search-import flow.
// Returning [] keeps scans green while signalling the source was intentionally not queried.

async function fetchNHS() {
  return { status: 'skipped', error: 'NHS adapter not implemented — see src/sources/stubs.js', jobs: [] };
}
async function fetchCivilService() {
  return { status: 'skipped', error: 'Civil Service adapter not implemented — see src/sources/stubs.js', jobs: [] };
}

module.exports = { fetchNHS, fetchCivilService };
