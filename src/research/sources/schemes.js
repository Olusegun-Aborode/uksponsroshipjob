'use strict';
// Curated funding schemes (international-eligible UK PhD/research funding). Static, hand-maintained.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function fetchSchemes() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schemes.json'), 'utf8'));
    const opportunities = (data.schemes || []).map(s => ({
      id: s.id || crypto.createHash('sha1').update('scheme|' + s.title).digest('hex').slice(0, 16),
      title: s.title, institution: s.institution, type: s.type, url: s.url,
      source: 'scheme', description: s.description, deadline: ''
    }));
    return { status: 'ok', opportunities };
  } catch (e) {
    return { status: 'failed', error: String(e.message || e), opportunities: [] };
  }
}

module.exports = { fetchSchemes };
