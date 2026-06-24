'use strict';
// Your master CV. Uploaded once (PDF or DOCX), parsed to plain text, stored in the meta table,
// and used as the source material the AI tailors per job. Plain text is all the model needs.
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');
const { db } = require('./db');

const getMeta = db.prepare('SELECT value FROM meta WHERE key=?');
const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)');

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
  throw new Error('Unsupported file type — upload a PDF, DOCX, TXT or MD.');
}

async function saveCV(buffer, filename) {
  const text = await extractText(buffer, filename);
  if (text.length < 50) throw new Error('Could not read enough text from that file — is it a scanned image? Try a text-based PDF or DOCX.');
  setMeta.run('cv_text', text);
  setMeta.run('cv_filename', filename || 'cv');
  setMeta.run('cv_uploaded_at', new Date().toISOString());
  return { filename, chars: text.length };
}

function getCVText() { const r = getMeta.get('cv_text'); return r ? r.value : null; }

function cvStatus() {
  const text = getCVText();
  return {
    uploaded: !!text,
    filename: (getMeta.get('cv_filename') || {}).value || null,
    chars: text ? text.length : 0,
    uploaded_at: (getMeta.get('cv_uploaded_at') || {}).value || null
  };
}

module.exports = { saveCV, getCVText, cvStatus };
