'use strict';
// Convert the AI-tailored CV (markdown) into a clean, ATS-friendly Word document.
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

// Split a markdown line into bold/normal runs on **...**.
function runs(line) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map(p => {
    const bold = /^\*\*[^*]+\*\*$/.test(p);
    return new TextRun({ text: bold ? p.slice(2, -2) : p, bold });
  });
}

function mdToParagraphs(md) {
  const out = [];
  for (const raw of (md || '').split(/\r?\n/)) {
    const l = raw.replace(/\s+$/, '');
    if (!l.trim()) continue;
    if (/^#\s/.test(l)) out.push(new Paragraph({ children: runs(l.replace(/^#\s/, '')), heading: HeadingLevel.TITLE }));
    else if (/^##\s/.test(l)) out.push(new Paragraph({ children: runs(l.replace(/^##\s/, '')), heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 80 } }));
    else if (/^###\s/.test(l)) out.push(new Paragraph({ children: runs(l.replace(/^###\s/, '')), heading: HeadingLevel.HEADING_2, spacing: { before: 120, after: 40 } }));
    else if (/^(-{3,}|_{3,}|\*{3,})$/.test(l.trim())) out.push(new Paragraph({ border: { bottom: { color: 'CCCCCC', space: 1, style: 'single', size: 6 } } }));
    else if (/^\s*[-*+]\s+/.test(l)) out.push(new Paragraph({ children: runs(l.replace(/^\s*[-*+]\s+/, '')), bullet: { level: 0 } }));
    else out.push(new Paragraph({ children: runs(l) }));
  }
  return out;
}

async function cvDocx(markdown) {
  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } }, // 10.5pt
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children: mdToParagraphs(markdown) }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { cvDocx };
