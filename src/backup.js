'use strict';
// Your tracking (statuses, notes, applied dates) and generated CVs live in data/db.sqlite.
// This snapshots the whole DB to data/backups/ so a disk loss can't wipe your application history.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `db-${stamp}.sqlite`);
  await db.backup(dest); // better-sqlite3 online backup (safe while running)
  // Prune oldest, keep the most recent KEEP.
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-') && f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  return { file: path.basename(dest), kept: Math.min(files.length, KEEP) };
}

if (require.main === module) {
  runBackup().then(r => { console.log('Backup written:', r.file, '(keeping', r.kept + ')'); process.exit(0); })
    .catch(e => { console.error('Backup failed:', e); process.exit(1); });
}

module.exports = { runBackup };
