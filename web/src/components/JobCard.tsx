import { useState } from 'react'
import { Sparkles, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Job } from '@/lib/api'

const STATUSES = [['new', 'New'], ['interested', 'Interested'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['not_suitable', 'Not suitable']]
const TIER_VARIANT: Record<string, any> = { A: 'success', 'B-': 'warning', B: 'info', C: 'muted', excluded: 'destructive', unknown: 'muted' }
const TIER_ACCENT: Record<string, string> = { A: 'bg-success', 'B-': 'bg-warning', B: 'bg-[hsl(212_90%_60%)]', C: 'bg-border', excluded: 'bg-destructive', unknown: 'bg-border' }
const SAL: Record<string, { label: string; cls: string }> = {
  pass: { label: '✓ clears floor', cls: 'text-success border-success/40' },
  fail: { label: '⚠ below floor', cls: 'text-destructive border-destructive/40' },
  borderline: { label: '◑ borderline', cls: 'text-warning border-warning/40' },
  unknown: { label: '? salary n/a', cls: 'text-muted-foreground' },
}

export function JobCard({ job, aiEnabled, onTailor }: { job: Job; aiEnabled: boolean; onTailor: (j: Job) => void }) {
  const [status, setStatus] = useState(job.status)
  const [notes, setNotes] = useState(job.user_notes || '')
  const [verified, setVerified] = useState(!!job.user_verified)
  const sal = job.salary_status ? SAL[job.salary_status] : null

  const tag = (txt: string, cls = '') => (
    <span className={`rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground ${cls}`}>{txt}</span>
  )

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:border-muted-foreground/30 hover:shadow-md">
      <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded ${TIER_ACCENT[job.tier] || 'bg-border'} ${job.tier === 'excluded' ? 'opacity-60' : ''}`} />
      <div className={`pl-3 ${job.tier === 'excluded' ? 'opacity-60' : ''}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={TIER_VARIANT[job.tier] || 'muted'}>{job.tier === 'excluded' ? '✕' : job.tier}</Badge>
              <h3 className="truncate text-[15px] font-semibold tracking-tight">{job.title}</h3>
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{job.employer}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            {aiEnabled && (
              <Button size="sm" className={`h-8 ${job.generated_at ? 'bg-[hsl(258_90%_66%)] hover:bg-[hsl(258_90%_60%)]' : 'bg-[hsl(258_90%_66%)] hover:bg-[hsl(258_90%_60%)]'} text-white`} onClick={() => onTailor(job)}>
                <Sparkles className="h-3.5 w-3.5" />{job.generated_at ? 'View CV' : 'Tailor CV'}
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={job.url} target="_blank" rel="noopener">Open <ExternalLink className="h-3.5 w-3.5" /></a>
            </Button>
          </div>
        </div>

        <p className="my-2.5 text-[12.5px] leading-relaxed text-muted-foreground">{job.reason}</p>

        <div className="flex flex-wrap gap-1.5">
          {job.region && tag(job.region)}
          {job.category && tag(job.category)}
          {job.salary && tag(job.salary, 'text-warning')}
          {sal && tag(sal.label, sal.cls)}
          {job.register_name && tag(`register: ${job.register_name}`, 'text-[hsl(212_90%_70%)]')}
          {job.fit_score ? tag(`fit ${job.fit_score}`, 'text-primary') : null}
          {job.stale && tag(`stale · ${job.days_old}d`, 'text-destructive border-destructive/30')}
          {tag(`via ${job.source}`)}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); const body: any = { status: v }; if (v === 'applied') body.date_applied = new Date().toISOString().slice(0, 10); api.updateJob(job.id, body) }}>
            <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={verified} onCheckedChange={(c) => { setVerified(!!c); api.updateJob(job.id, { user_verified: !!c }) }} />
            verified on register
          </label>
        </div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => api.updateJob(job.id, { user_notes: notes })}
          placeholder="Notes, recruiter, follow-up date, SOC check…" className="mt-2 min-h-[34px] text-xs" />
      </div>
    </div>
  )
}
