'use strict';
// Master CVs. Two profiles: 'self' (jobs + data/tech research) and 'partner' (health/nutrition/public
// health research). Uploaded as PDF/DOCX, parsed to plain text, stored in meta. 'self' uses the legacy
// keys so the jobs flow keeps working unchanged.
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { db } = require('./db');

const getMeta = db.prepare('SELECT value FROM meta WHERE key=?');
const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)');

const KEYS = {
  self: { text: 'cv_text', name: 'cv_filename', at: 'cv_uploaded_at' },
  partner: { text: 'cv_text_partner', name: 'cv_filename_partner', at: 'cv_uploaded_at_partner' },
};
const keysFor = p => KEYS[p] || KEYS.self;

async function extractText(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    try { const r = await parser.getText(); return (r.text || '').trim(); }
    finally { try { await parser.destroy(); } catch {} }
  }
  if (name.endsWith('.docx')) {
    const r = await mammoth.extractRawText({ buffer });
    return (r.value || '').trim();
  }
  if (name.endsWith('.txt') || name.endsWith('.md')) return buffer.toString('utf8').trim();
  throw new Error('Unsupported file type, upload a PDF, DOCX, TXT or MD.');
}

async function saveCV(buffer, filename, profile = 'self') {
  const text = await extractText(buffer, filename);
  if (text.length < 50) throw new Error('Could not read enough text from that file, is it a scanned image? Try a text-based PDF or DOCX.');
  const k = keysFor(profile);
  setMeta.run(k.text, text);
  setMeta.run(k.name, filename || 'cv');
  setMeta.run(k.at, new Date().toISOString());
  return { filename, chars: text.length, profile };
}

function getCVText(profile = 'self') { const r = getMeta.get(keysFor(profile).text); return r ? r.value : null; }

function profileStatus(profile) {
  const k = keysFor(profile);
  const text = getCVText(profile);
  return {
    uploaded: !!text,
    filename: (getMeta.get(k.name) || {}).value || null,
    chars: text ? text.length : 0,
    uploaded_at: (getMeta.get(k.at) || {}).value || null,
  };
}

// Back-compat: top-level fields are the 'self' profile (jobs Header reads ai.cv.uploaded);
// `profiles` carries both for the research section.
function cvStatus() {
  return Object.assign(profileStatus('self'), { profiles: { self: profileStatus('self'), partner: profileStatus('partner') } });
}

module.exports = { saveCV, getCVText, cvStatus };
