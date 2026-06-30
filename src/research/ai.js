'use strict';
// Per-opportunity academic application pack: research-fit read, academic CV, statement of purpose,
// a cold email to the supervisor, an honest funding/eligibility check, and questions to ask.
// Reuses the jobs AI engine's client, spend cap, and dash sanitiser.
const { getClient, assertBudget, recordSpend, noDashes, aiEnabled, MODEL } = require('../ai');
const { getCVText } = require('../cv');

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    fit_summary: { type: 'string', description: 'Two honest sentences on how well the candidate fits THIS research area. If the topic is far from the candidate\'s background (e.g. pure dietetics vs their data/tech CV), say so plainly and point to the transferable angle (e.g. health-data, quantitative methods).' },
    fit_score: { type: 'integer', description: 'Honest 0-100 fit of the candidate to this specific research project/area.' },
    academic_cv_markdown: { type: 'string', description: 'An academic-format CV in Markdown tailored to this opportunity: research output, publications, technical skills, education. Lead with results and real figures. UK conventions, British spelling. Use only the candidate\'s real experience.' },
    statement_of_purpose: { type: 'string', description: 'A tailored statement of purpose / research interest (~350 words) connecting the candidate\'s real experience to this project, supervisor, and institution.' },
    supervisor_email: { type: 'string', description: 'A concise, specific cold email to the potential supervisor expressing interest, showing you understand their work, and asking about funded/international-eligible places. ~150 words.' },
    eligibility_check: { type: 'string', description: 'A short, blunt checklist read: is it fully funded? does the funding cover overseas (international) fees + stipend? what is the deadline? what to verify on the listing before applying.' },
    questions_to_ask: { type: 'array', items: { type: 'string' }, description: 'Smart questions to ask the supervisor or programme about funding, eligibility, and the project.' }
  },
  required: ['fit_summary', 'fit_score', 'academic_cv_markdown', 'statement_of_purpose', 'supervisor_email', 'eligibility_check', 'questions_to_ask']
};

const SYSTEM = `You are an academic application strategist for an international applicant who needs full funding (overseas fees + stipend) to study or research in the UK. You write research CVs and statements that make an admissions tutor or supervisor take the candidate seriously.

Rules:
- NEVER use em dashes or en dashes (the — or – characters). Use commas, full stops, colons, parentheses; "to" for ranges.
- Lead with results and real figures from the candidate's CV. Be specific and technical. No generic filler.
- Be HONEST about fit. If the research area is far from the candidate's background, say so and pivot to the genuine transferable angle (data, quantitative methods, health-data) rather than overselling.
- Use only the candidate's real experience. Never invent publications, degrees, or affiliations.
- UK academic conventions, British spelling. Funding and international eligibility matter most: always sanity-check them.`;

function buildPrompt(o, cvText) {
  return `# TARGET OPPORTUNITY
Title: ${o.title || ''}
Institution: ${o.institution || ''}
Type: ${o.type || ''}
Research area cluster: ${o.area_cluster || ''}
Funding (our read): ${o.funding_status || ''}; international eligibility: ${o.international_eligible || 'unknown'}; fees cover: ${o.fees_cover || 'unknown'}
Deadline: ${o.deadline || 'not stated'}
Link: ${o.url || ''}

## Description
${(o.description || '').slice(0, 6000) || '(no description captured)'}

# CANDIDATE MASTER CV (source of truth, do not fabricate beyond this)
${cvText.slice(0, 20000)}

# TASK
Produce the application pack for THIS opportunity per your rules. Be honest about fit and about whether the funding actually covers an international applicant.`;
}

async function generatePack(opp, cvText) {
  assertBudget();
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(opp, cvText) }]
  });
  recordSpend(res.usage);
  const block = res.content.find(b => b.type === 'text');
  if (!block) throw new Error('No content returned from the model.');
  const d = JSON.parse(block.text);
  for (const k of ['fit_summary', 'academic_cv_markdown', 'statement_of_purpose', 'supervisor_email', 'eligibility_check']) d[k] = noDashes(d[k]);
  d.questions_to_ask = (d.questions_to_ask || []).map(noDashes);
  return d;
}

module.exports = { generatePack, aiEnabled, getCVText };
