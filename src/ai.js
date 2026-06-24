'use strict';
// AI tailoring engine. For one job + your master CV, Claude returns a highly tailored CV (markdown),
// a recruiter-stopping headline, an honest ATS match score, matched/missing keywords, a short cover
// note, and the real skill gaps — each with a course topic we turn into live search links.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';

let client = null;
function getClient() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set — add it to .env to enable CV generation.');
  if (!client) client = new Anthropic({ apiKey: key });
  return client;
}
function aiEnabled() { return !!process.env.ANTHROPIC_API_KEY; }

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

const SYSTEM = `You are an elite UK CV writer and career strategist. You specialise in candidates who need a Skilled Worker visa (often switching from a Graduate visa) for data, analytics, BI, engineering, and product roles.

Your tailored CVs make recruiters stop and read. You:
- Use ONLY the candidate's real experience from their master CV. Never invent employers, job titles, dates, degrees, or certifications. You may rephrase, reorder, re-emphasise, quantify, and surface genuine transferable skills.
- Mirror the exact terminology and keywords from the job posting WHERE the candidate genuinely has that experience — this is ATS optimisation, not fabrication.
- Lead with impact and quantified achievements; cut filler. Follow UK conventions (no photo, no date of birth, no "References available", concise, reverse-chronological).
- Are honest in scoring and gap analysis — a candidate trusts you to tell them the truth about fit.
- Identify the real gaps between the posting's requirements and the candidate's evidence, and suggest specific, current course topics to close them.

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

async function tailorForJob(job, cvText) {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(job, cvText) }]
  });
  const block = res.content.find(b => b.type === 'text');
  if (!block) throw new Error('No content returned from the model.');
  const data = JSON.parse(block.text);
  // Turn each gap's course_query into live search links (no hallucinated URLs).
  data.skill_gaps = (data.skill_gaps || []).map(g => Object.assign({}, g, { courses: courseLinks(g.course_query) }));
  return data;
}

module.exports = { tailorForJob, aiEnabled, MODEL };
