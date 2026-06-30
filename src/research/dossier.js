'use strict';
// Deep, on-demand research for one opportunity. Uses Claude's web-search tool to find the things a
// listing usually omits: the exact school + department, the scholarship type, a supervisor/contact
// email to write to, whether the funding genuinely covers an international applicant, the deadline,
// how to apply, and a quick legitimacy/risk read. One-stop dossier, cached per opportunity.
const { getClient, assertBudget, recordSpend, noDashes, MODEL } = require('../ai');

const SYSTEM = `You are a meticulous research-funding analyst for an international applicant (needs full funding that covers overseas fees). Use web search to verify everything. Be accurate and specific, cite source URLs, and never invent an email or a deadline. If something cannot be confirmed, say "not found" rather than guessing.

Never use em dashes or en dashes. After researching, respond with ONLY a single JSON object (no prose before or after) using exactly these keys:
{
  "school": string,                      // the university/school offering it (confirmed)
  "department": string,                  // department/school/centre, or "not found"
  "scholarship_type": string,            // e.g. "Commonwealth PhD Scholarship", "UKRI DTP studentship", "MSCA", "self-funded", "departmental studentship"
  "supervisor": string,                  // potential supervisor or programme lead, or "not found"
  "contact_email": string,               // the best email to send an enquiry/application to, or "not found"
  "fully_funded": boolean,
  "covers_international_fees": boolean,   // does the funding cover OVERSEAS (international) fees + stipend?
  "stipend": string,                     // amount/rate if found, else "not found"
  "funding_details": string,             // one or two sentences
  "deadline": string,                    // application deadline (a date if found) or "not found"
  "how_to_apply": string[],              // concrete steps
  "eligibility_note": string,            // international eligibility specifics
  "legitimacy_note": string,             // is this a credible, real opportunity? any red flags or "looks legitimate"
  "sources": string[]                    // source URLs you used
}`;

function buildPrompt(o) {
  return `Research this UK research opportunity thoroughly and fill the dossier.

Title: ${o.title}
Institution (as listed): ${o.institution}
Type: ${o.type}
Listing URL: ${o.url}
What we already parsed: funding=${o.funding_status}, international_eligible=${o.international_eligible}, deadline=${o.deadline || 'unknown'}

Search the web (the listing page, the university/department/scholarship pages, the supervisor's profile) to confirm: the exact school and department, the scholarship type, a real contact or supervisor email to write to, whether the funding covers an INTERNATIONAL applicant (overseas fees + stipend), the application deadline, and how to apply. Then assess whether it is a legitimate, currently-open opportunity.`;
}

function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a === -1 || b === -1 || b < a) throw new Error('No JSON found in research result.');
  return JSON.parse(text.slice(a, b + 1));
}

async function buildDossier(opp) {
  assertBudget();
  const client = getClient();
  let messages = [{ role: 'user', content: buildPrompt(opp) }];
  let res;
  // Stream (keeps the connection alive through several web searches), continuing past pause_turn.
  for (let i = 0; i < 3; i++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 5000,
      system: SYSTEM,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages,
    });
    res = await stream.finalMessage();
    recordSpend(res.usage);
    if (res.stop_reason !== 'pause_turn') break;
    messages = messages.concat([{ role: 'assistant', content: res.content }]);
  }
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
  const d = extractJson(text);
  // Scrub dashes from the string fields.
  for (const k of ['school', 'department', 'scholarship_type', 'supervisor', 'contact_email', 'stipend', 'funding_details', 'deadline', 'eligibility_note', 'legitimacy_note']) {
    if (typeof d[k] === 'string') d[k] = noDashes(d[k]);
  }
  d.how_to_apply = (d.how_to_apply || []).map(s => noDashes(String(s)));
  d.sources = (d.sources || []).map(String);
  return d;
}

module.exports = { buildDossier };
