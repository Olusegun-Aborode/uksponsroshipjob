// Typed client for the Express backend (same-origin in production, proxied in dev).

export type Job = {
  id: string
  title: string
  employer: string
  location: string
  region: string
  category: string
  salary: string
  salary_status: 'pass' | 'fail' | 'borderline' | 'unknown' | null
  soc_code: string
  url: string
  source: string
  tier: string
  confidence: number
  reason: string
  fit_score: number
  register_match: string
  register_name: string
  status: string
  user_notes: string
  date_applied: string
  deadline: string
  user_verified: number
  days_old: number | null
  stale: boolean
  generated_at: string | null
  prep_at: string | null
  match_score: number
  deadline_days: number | null
  deadline_soon: boolean
  needs_followup: boolean
}

export type Stats = {
  total: number
  excluded: number
  byStatus: Record<string, number>
  byTier: Record<string, number>
}

export type ScanRun = {
  id: number
  started_at: string
  finished_at: string | null
  total_found: number
  new_jobs: number
  employers_checked: number
  sources: { source: string; query: string; status: string; count: number; error: string | null }[]
}

export type RegisterInfo = { loaded_at: string | null; days_old: number | null; total: number; skilled_worker: number }
export type Spend = { month: string; spent_usd: number; budget_usd: number; remaining_usd: number | null }
export type AiStatus = { enabled: boolean; model: string; cv: { uploaded: boolean; filename: string | null; chars: number; uploaded_at: string | null }; spend?: Spend }

export type PrepQuestion = { question: string; how_to_answer: string }
export type InterviewPrep = {
  company_brief: string; why_you_fit: string; sponsorship_tip: string
  likely_questions: PrepQuestion[]; talking_points: string[]; questions_to_ask: string[]
}

export type SkillGap = { skill: string; why_it_matters: string; course_query: string; courses: { coursera: string; udemy: string; linkedin: string } }
export type TailorResult = {
  headline: string
  fit_summary: string
  ats_score: number
  tailored_cv_markdown: string
  cover_note: string
  matched_keywords: string[]
  missing_keywords: string[]
  skill_gaps: SkillGap[]
}

const j = (r: Response) => r.json()

export const api = {
  jobs: (params: Record<string, string>) => fetch('/api/jobs?' + new URLSearchParams(params)).then(j) as Promise<Job[]>,
  stats: () => fetch('/api/stats').then(j) as Promise<Stats>,
  scans: () => fetch('/api/scans').then(j) as Promise<ScanRun[]>,
  register: () => fetch('/api/register').then(j) as Promise<RegisterInfo>,
  ai: () => fetch('/api/ai').then(j) as Promise<AiStatus>,
  updateJob: (id: string, body: Record<string, unknown>) =>
    fetch('/api/jobs/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(j),
  scan: () => fetch('/api/scan', { method: 'POST' }).then(j),
  uploadCV: (file: File) => { const fd = new FormData(); fd.append('cv', file); return fetch('/api/cv', { method: 'POST', body: fd }).then(j) },
  tailor: (id: string, force = false) =>
    fetch(`/api/jobs/${id}/tailor${force ? '?force=1' : ''}`, { method: 'POST' }).then(j) as Promise<{ cached: boolean; generated_at: string; result: TailorResult; error?: string }>,
  prep: (id: string, force = false) =>
    fetch(`/api/jobs/${id}/prep${force ? '?force=1' : ''}`, { method: 'POST' }).then(j) as Promise<{ cached: boolean; prep_at: string; result: InterviewPrep; error?: string }>,
  docxUrl: (id: string) => `/api/jobs/${id}/cv.docx`,
}
