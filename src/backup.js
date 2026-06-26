'use strict';
// Your tracking (statuses, notes, applied dates) and generated CVs live in data/db.sqlite.
// This snapshots the whole DB to data/backups/ so a restart can't wipe your application history,
// and (if BACKUP_S3_* is configured) pushes each snapshot off-box to Cloudflare R2 / S3 so even a
// disk failure can't lose it.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const BACKUP_DIR = path.join(__dirname, '..', 'data', 'backups');
const KEEP = Number(process.env.BACKUP_KEEP) || 14;

function s3Configured() {
  return !!(process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_ACCESS_KEY_ID && process.env.BACKUP_S3_SECRET_ACCESS_KEY);
}

// Upload one file to R2/S3 and prune remote copies to the most recent KEEP. Off by default.
async function uploadToS3(localPath, name) {
  if (!s3Configured()) return null;
  const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
  const Bucket = process.env.BACKUP_S3_BUCKET;
  const prefix = process.env.BACKUP_S3_PREFIX || 'backups/';
  const s3 = new S3Client({
    region: process.env.BACKUP_S3_REGION || 'auto',          // R2 uses "auto"
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,    // R2: https://<account>.r2.cloudflarestorage.com
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY },
  });
  await s3.send(new PutObjectCommand({ Bucket, Key: prefix + name, Body: fs.readFileSync(localPath) }));
  // Prune remote to the most recent KEEP (timestamped names sort lexicographically).
  const list = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
  const keys = (list.Contents || []).map(o => o.Key).filter(k => k.endsWith('.sqlite')).sort();
  const drop = keys.slice(0, Math.max(0, keys.length - KEEP));
  if (drop.length) await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: drop.map(Key => ({ Key })) } }));
  return `${Bucket}/${prefix}${name}`;
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `db-${stamp}.sqlite`;
  const dest = path.join(BACKUP_DIR, name);
  await db.backup(dest); // better-sqlite3 online backup (safe while running)
  // Prune local, keep the most recent KEEP.
  const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-') && f.endsWith('.sqlite')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));

  let remote = null;
  try { remote = await uploadToS3(dest, name); }
  catch (e) { console.error('Off-box backup upload failed:', e.message); }

  return { file: name, kept: Math.min(files.length, KEEP), remote };
}

if (require.main === module) {
  runBackup().then(r => { console.log('Backup written:', r.file, r.remote ? '(off-box: ' + r.remote + ')' : '(local only)'); process.exit(0); })
    .catch(e => { console.error('Backup failed:', e); process.exit(1); });
}

module.exports = { runBackup, s3Configured };
