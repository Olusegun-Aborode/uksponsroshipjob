'use strict';
// Push alerts for newly-discovered high-tier roles. Time-sensitive visa hunt => you shouldn't
// have to keep reloading the board. Every channel is optional and silently skipped if unconfigured.
//   Telegram:  TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   (free, no dependency)
//   Webhook:   ALERT_WEBHOOK_URL                       (Slack / Discord / Zapier — posts {text})
// What counts as alert-worthy is configurable:
//   ALERT_TIERS=A,B-,B        ALERT_MIN_CONFIDENCE=55

function alertTiers() {
  return (process.env.ALERT_TIERS || 'A,B-,B').split(',').map(s => s.trim()).filter(Boolean);
}
function minConfidence() {
  return Number(process.env.ALERT_MIN_CONFIDENCE) || 55;
}

// Should this freshly-inserted job trigger an alert?
function isAlertWorthy(job) {
  return alertTiers().includes(job.tier) && (job.confidence || 0) >= minConfidence();
}

function line(j) {
  const sal = j.salary ? ` · ${j.salary}` : '';
  return `[${j.tier} ${j.confidence}] ${j.title} — ${j.employer}${sal}\n${j.url || ''}`;
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
    });
    return res.ok;
  } catch { return false; }
}

async function sendWebhook(text) {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    return res.ok;
  } catch { return false; }
}

// Called by the scan with the list of newly-inserted jobs. Returns how many were alerted.
async function notifyNewJobs(jobs) {
  const worthy = (jobs || []).filter(isAlertWorthy)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  if (!worthy.length) return 0;

  const header = `🟢 ${worthy.length} new sponsorship-likely role${worthy.length > 1 ? 's' : ''}`;
  const body = header + '\n\n' + worthy.slice(0, 15).map(line).join('\n\n')
    + (worthy.length > 15 ? `\n\n…and ${worthy.length - 15} more on the board.` : '');

  console.log('\n' + body + '\n');               // always at least logged
  await Promise.all([sendTelegram(body), sendWebhook(body)]);
  return worthy.length;
}

module.exports = { notifyNewJobs, isAlertWorthy };
