'use strict';
// Time-sensitive nudges for a visa-deadline job hunt:
//  - deadlines coming up within DEADLINE_DAYS
//  - applications with no movement for FOLLOWUP_DAYS (chase the recruiter)
// Pushed over the same Telegram/webhook channel as new-role alerts. Run daily.
const { db } = require('./db');
const { send } = require('./notify');

const DEADLINE_DAYS = Number(process.env.REMINDER_DEADLINE_DAYS) || 4;
const FOLLOWUP_DAYS = Number(process.env.REMINDER_FOLLOWUP_DAYS) || 10;
const days = ts => ts ? Math.floor((Date.now() - Date.parse(ts)) / 86400000) : null;
const until = ts => ts ? Math.ceil((Date.parse(ts) - Date.now()) / 86400000) : null;

// Jobs the user is actively pursuing with a deadline inside the window.
function dueSoon() {
  return db.prepare("SELECT id,title,employer,deadline FROM jobs WHERE deadline != '' AND status NOT IN ('rejected','not_suitable','offer')").all()
    .map(j => ({ ...j, d: until(j.deadline) }))
    .filter(j => j.d !== null && j.d >= 0 && j.d <= DEADLINE_DAYS)
    .sort((a, b) => a.d - b.d);
}

// Applied roles with no status change for a while.
function needFollowup() {
  return db.prepare("SELECT id,title,employer,date_applied FROM jobs WHERE status = 'applied' AND date_applied != ''").all()
    .map(j => ({ ...j, age: days(j.date_applied) }))
    .filter(j => j.age !== null && j.age >= FOLLOWUP_DAYS)
    .sort((a, b) => b.age - a.age);
}

// Research opportunities the user is pursuing with a deadline inside the window.
function oppsDueSoon() {
  return db.prepare("SELECT id,title,institution,COALESCE(NULLIF(deadline_user,''),deadline) AS dl FROM opportunities WHERE COALESCE(NULLIF(deadline_user,''),deadline) != '' AND status NOT IN ('rejected','not_suitable','offer')").all()
    .map(o => ({ ...o, d: until(o.dl) }))
    .filter(o => o.d !== null && o.d >= 0 && o.d <= DEADLINE_DAYS)
    .sort((a, b) => a.d - b.d);
}

async function runReminders() {
  const due = dueSoon(), follow = needFollowup(), opps = oppsDueSoon();
  if (!due.length && !follow.length && !opps.length) return { due: 0, followup: 0, opps: 0, sent: false };
  let msg = '';
  if (due.length) msg += `⏰ Job deadlines within ${DEADLINE_DAYS} days\n` + due.slice(0, 10).map(j => `• ${j.title}, ${j.employer} (in ${j.d}d, ${j.deadline})`).join('\n') + '\n\n';
  if (opps.length) msg += `🎓 Funding/PhD deadlines within ${DEADLINE_DAYS} days\n` + opps.slice(0, 10).map(o => `• ${o.title}, ${o.institution} (in ${o.d}d, ${o.dl})`).join('\n') + '\n\n';
  if (follow.length) msg += `📮 Follow up (applied, no movement)\n` + follow.slice(0, 10).map(j => `• ${j.title}, ${j.employer} (applied ${j.age}d ago)`).join('\n');
  const sent = await send(msg.trim());
  return { due: due.length, followup: follow.length, opps: opps.length, sent };
}

if (require.main === module) {
  runReminders().then(r => { console.log('Reminders:', r); process.exit(0); }).catch(e => { console.error(e); process.exit(1); });
}

module.exports = { runReminders, dueSoon, needFollowup, oppsDueSoon };
