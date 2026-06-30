'use strict';
// AI tailoring engine. For one job + your master CV, Claude returns a highly tailored CV (markdown),
// a recruiter-stopping headline, an honest ATS match score, matched/missing keywords, a short cover
// note, and the real skill gaps — each with a course topic we turn into live search links.
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('./db');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
// Opus 4.8 pricing per 1M tokens (USD). Override if you switch models.
const PRICE_IN = 5, PRICE_OUT = 25;

let client = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set, add it to .env to enable CV generation.');
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}
function aiEnabled() { return !!process.env.ANTHROPIC_API_KEY; }

// --- spend tracking + monthly budget cap (per calendar month) ---
const getMeta = db.prepare('SELECT value FROM meta WHERE key=?');
const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key,value) VALUES (?,?)');
const monthKey = () => 'ai_spend_' + new Date().toISOString().slice(0, 7); // ai_spend_YYYY-MM

function monthSpend() { const r = getMeta.get(monthKey()); return r ? Number(r.value) : 0; }
function budget() { return Number(process.env.AI_MONTHLY_BUDGET_USD) || 0; } // 0 = no cap
function spendStatus() { const b = budget(); return { month: new Date().toISOString().slice(0, 7), spent_usd: Math.round(monthSpend() * 100) / 100, budget_usd: b, remaining_usd: b ? Math.round((b - monthSpend()) * 100) / 100 : null }; }
function assertBudget() {
  const b = budget();
  if (b && monthSpend() >= b) throw new Error(`Monthly AI budget of $${b} reached (spent $${monthSpend().toFixed(2)}). Raise AI_MONTHLY_BUDGET_USD or wait for next month.`);
}
function recordSpend(usage) {
  if (!usage) return;
  const cost = ((usage.input_tokens || 0) * PRICE_IN + (usage.output_tokens || 0) * PRICE_OUT) / 1e6;
  setMeta.run(monthKey(), String(monthSpend() + cost));
}

// Structured-output schema. (No min/max/length constraints — unsupported by structured outputs.)
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headline: { type: 'string', description: 'A punchy 1–2 line professional headline/summary tailored to THIS role that makes a recruiter stop scrolling. Specific, quantified, no fluff.' },
    fit_summary: { type: 'string', description: 'Two sentences: honest assessment of how well this candidate fits the role and the single strongest selling point.' },
    ats_score: { type: 'integer', description: 'Honest 0–100 estimate of how well the candidate (per their CV) matches the posting\'s stated requirements and keywords.' },
    tailored_cv_markdown: { type: 'string', description: 'The full tailored CV in clean Markdown, UK conventions. Reorder and re-emphasise REAL experience from the master CV to match this job; weave in the posting\'s keywords ONLY where genuinely supported. Never invent employers, titles, dates, or qualifications.' },
    cover_note: { type: 'string', description: 'A short, sharp application note / message to the recruiter (~120 words) tailored to this role — also tactfully signals visa-sponsorship need where relevant.' },
    matched_keywords: { type: 'array', items: { type: 'string' }, description: 'Key skills/requirements from the posting the candidate genuinely has.' },
    missing_keywords: { type: 'array', items: { type: 'string' }, description: 'Important skills/requirements from the posting the CV shows no clear evidence of.' },
    skill_gaps: {
      type: 'array',
      description: 'The most important gaps to close to boost chances for this role and similar ones.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          skill: { type: 'string' },
          why_it_matters: { type: 'string', description: 'One sentence: why this matters for this role.' },
          course_query: { type: 'string', description: 'A concise search phrase for finding a course on this skill, e.g. "dbt analytics engineering".' }
        },
        required: ['skill', 'why_it_matters', 'course_query']
      }
    }
  },
  required: ['headline', 'fit_summary', 'ats_score', 'tailored_cv_markdown', 'cover_note', 'matched_keywords', 'missing_keywords', 'skill_gaps']
};

const SYSTEM = `You are an elite UK CV writer and career strategist for senior data, engineering, and analytics candidates who need Skilled Worker visa sponsorship (often switching from a Graduate visa).

A recruiter must think "this person clearly knows what they are doing" within five seconds of reading.

NON-NEGOTIABLE RULES:
- NEVER use em dashes or en dashes (the — or – characters). They read as AI-generated. Use commas, full stops, colons, or parentheses instead, and the word "to" for ranges (e.g. "2023 to present", "£40k to £45k").
- LEAD WITH RESULTS. Open bullets and the headline with the outcome or a hard number wherever the master CV supports it (impact first, then how). Use the candidate's real figures (volumes processed, value indexed, users, % improvements, publications, audience).
- SHOW EXPERTISE. Name the candidate's actual tools, chains, protocols, systems, and methods. Be specific and technical. Never generic.
- BAN filler and clichés: no "results-driven", "team player", "passionate about", "detail-oriented", "proven track record", "go-getter", "synergy", or "leverage" used as fluff.
- TRUTHFUL. Use only real experience from the master CV. You may reframe, reorder, re-emphasise, surface genuine transferable skills, and mirror the posting's keywords WHERE the candidate genuinely has that experience (ATS optimisation, not fabrication). Never invent employers, titles, dates, metrics, or qualifications.
- UK conventions: no photo, no date of birth, no "References available", reverse-chronological, concise, British spelling.

Be honest in the ATS score and gap analysis. The candidate trusts you to tell them the truth about fit and exactly what to close.

Return everything via the required structured format.`;

function buildUserPrompt(job, cvText) {
  const j = job;
  return `# TARGET JOB
Title: ${j.title || ''}
Employer: ${j.employer || ''}
Location: ${j.location || ''}${j.region ? ` (${j.region})` : ''}
Salary: ${j.salary || 'not stated'}
Sponsorship tier (our system): ${j.tier || ''} — ${j.reason || ''}

## Job description
${(j.description || '').slice(0, 6000) || '(no description captured — tailor from the title and employer)'}

# CANDIDATE MASTER CV (source of truth — do not fabricate beyond this)
${cvText.slice(0, 20000)}

# TASK
Produce a highly tailored CV and analysis for THIS job, following all your rules. Make the headline recruiter-stopping. Be honest about the ATS score and the gaps.`;
}

const enc = s => encodeURIComponent(s || '');
function courseLinks(query) {
  return {
    coursera: `https://www.coursera.org/search?query=${enc(query)}`,
    udemy: `https://www.udemy.com/courses/search/?q=${enc(query)}`,
    linkedin: `https://www.linkedin.com/learning/search?keywords=${enc(query)}`
  };
}

// Safety net: strip em/en dashes from generated text (the prompt forbids them, this guarantees it).
// Ranges become "to"; clause-joining dashes become commas.
function noDashes(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/(\d{4}|present|current)\s*[–—]\s*(\d{4}|present|current)/gi, '$1 to $2')
    .replace(/(\d)\s*[–—]\s*(\d)/g, '$1 to $2')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}

async function tailorForJob(job, cvText) {
  assertBudget();
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(job, cvText) }]
  });
  recordSpend(res.usage);
  const block = res.content.find(b => b.type === 'text');
  if (!block) throw new Error('No content returned from the model.');
  const data = JSON.parse(block.text);
  // Scrub dashes everywhere they could surface.
  data.headline = noDashes(data.headline);
  data.fit_summary = noDashes(data.fit_summary);
  data.tailored_cv_markdown = noDashes(data.tailored_cv_markdown);
  data.cover_note = noDashes(data.cover_note);
  data.matched_keywords = (data.matched_keywords || []).map(noDashes);
  data.missing_keywords = (data.missing_keywords || []).map(noDashes);
  // Turn each gap's course_query into live search links (no hallucinated URLs).
  data.skill_gaps = (data.skill_gaps || []).map(g => Object.assign({}, g, {
    skill: noDashes(g.skill), why_it_matters: noDashes(g.why_it_matters), courses: courseLinks(g.course_query)
  }));
  return data;
}

// --- interview prep + company brief ---
const PREP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    company_brief: { type: 'string', description: 'A sharp 3 to 4 sentence brief on the employer: what they do, business model, and anything notable. If unknown from the posting, say what can be inferred and flag what to research.' },
    why_you_fit: { type: 'string', description: 'Two sentences on why this candidate is a credible fit for THIS role, grounded in their real experience.' },
    likely_questions: { type: 'array', description: 'The most likely interview questions for this specific role.', items: { type: 'object', additionalProperties: false, properties: { question: { type: 'string' }, how_to_answer: { type: 'string', description: 'A concrete angle using the candidate\'s real experience, with a metric or example where possible.' } }, required: ['question', 'how_to_answer'] } },
    talking_points: { type: 'array', items: { type: 'string' }, description: 'Punchy, quantified achievements from the CV to land during the interview.' },
    questions_to_ask: { type: 'array', items: { type: 'string' }, description: 'Smart questions for the candidate to ask the interviewer.' },
    sponsorship_tip: { type: 'string', description: 'One tactful tip on raising visa sponsorship at the right moment for this employer.' }
  },
  required: ['company_brief', 'why_you_fit', 'likely_questions', 'talking_points', 'questions_to_ask', 'sponsorship_tip']
};
const PREP_SYSTEM = `You are an interview coach for a versatile UK technology candidate who needs Skilled Worker sponsorship. Be specific, practical, and grounded in the candidate's real CV. Lead with results. Never use em dashes or en dashes (use commas, full stops, colons). No generic filler.`;

async function interviewPrep(job, cvText) {
  assertBudget();
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PREP_SCHEMA } },
    system: PREP_SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(job, cvText) }]
  });
  recordSpend(res.usage);
  const block = res.content.find(b => b.type === 'text');
  if (!block) throw new Error('No content returned from the model.');
  const d = JSON.parse(block.text);
  d.company_brief = noDashes(d.company_brief); d.why_you_fit = noDashes(d.why_you_fit); d.sponsorship_tip = noDashes(d.sponsorship_tip);
  d.talking_points = (d.talking_points || []).map(noDashes);
  d.questions_to_ask = (d.questions_to_ask || []).map(noDashes);
  d.likely_questions = (d.likely_questions || []).map(q => ({ question: noDashes(q.question), how_to_answer: noDashes(q.how_to_answer) }));
  return d;
}

module.exports = { tailorForJob, interviewPrep, aiEnabled, spendStatus, MODEL, getClient, assertBudget, recordSpend, noDashes };
