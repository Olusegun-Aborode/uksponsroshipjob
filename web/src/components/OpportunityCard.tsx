import { useState } from 'react'
import { Sparkles, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Opportunity } from '@/lib/api'

const STATUSES = [['new', 'New'], ['interested', 'Interested'], ['applied', 'Applied'], ['interviewing', 'In process'], ['offer', 'Offer'], ['rejected', 'Rejected'], ['not_suitable', 'Not suitable']]
const TIER_VARIANT: Record<string, any> = { A: 'success', B: 'info', C: 'warning', excluded: 'destructive' }
const TIER_ACCENT: Record<string, string> = { A: 'bg-success', B: 'bg-[hsl(212_90%_60%)]', C: 'bg-warning', excluded: 'bg-destructive' }
const FUND: Record<string, { label: string; cls: string }> = {
  fully: { label: '✓ fully funded', cls: 'text-success border-success/40' },
  salaried: { label: 'salaried role', cls: 'text-[hsl(212_90%_70%)] border-[hsl(212_90%_60%)]/40' },
  partial: { label: '◑ partial funding', cls: 'text-warning border-warning/40' },
  unfunded: { label: '⚠ unfunded', cls: 'text-destructive border-destructive/40' },
  unknown: { label: '? funding unclear', cls: 'text-muted-foreground' },
}
const ELIG: Record<string, { label: string; cls: string }> = {
  yes: { label: '🌍 international-open', cls: 'text-success border-success/40' },
  no: { label: '⚠ Home-only', cls: 'text-destructive border-destructive/40' },
  unknown: { label: '? eligibility unstated', cls: 'text-muted-foreground' },
}
const FOR: Record<string, { label: string; cls: string }> = {
  partner: { label: '👩‍🔬 for Partner', cls: 'text-[hsl(330_80%_72%)] border-[hsl(330_80%_66%)]/40' },
  self: { label: '👨‍💻 for You', cls: 'text-[hsl(212_90%_70%)] border-[hsl(212_90%_60%)]/40' },
  either: { label: '👥 for Either', cls: 'text-muted-foreground' },
}

export function OpportunityCard({ opp, aiEnabled, onPack }: { opp: Opportunity; aiEnabled: boolean; onPack: (o: Opportunity) => void }) {
  const [status, setStatus] = useState(opp.status)
  const [notes, setNotes] = useState(opp.user_notes || '')
  const [flagged, setFlagged] = useState(!!opp.user_flagged)
  const [deadline, setDeadline] = useState(opp.deadline_user || '')
  const fund = FUND[opp.funding_status] || FUND.unknown
  const elig = ELIG[opp.international_eligible] || ELIG.unknown

  const tag = (txt: string, cls = '') => <span className={`rounded-full border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground ${cls}`}>{txt}</span>

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-4 transition-all hover:border-muted-foreground/30 hover:shadow-md">
      <div className={`absolute left-0 top-3.5 bottom-3.5 w-[3px] rounded ${TIER_ACCENT[opp.tier] || 'bg-border'}`} />
      <div className="pl-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge variant={TIER_VARIANT[opp.tier] || 'muted'}>{opp.tier}</Badge>
              <h3 className="truncate text-[15px] font-semibold tracking-tight">{opp.title}</h3>
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">{opp.institution}{opp.supervisor ? ` · ${opp.supervisor}` : ''}</div>
          </div>
          <div className="flex shrink-0 gap-2">
            {aiEnabled && (
              <Button size="sm" className="h-8 bg-[hsl(258_90%_66%)] text-white hover:bg-[hsl(258_90%_60%)]" onClick={() => onPack(opp)}>
                <Sparkles className="h-3.5 w-3.5" />{opp.has_dossier || opp.has_pack ? 'View' : 'Research & apply'}
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="h-8">
              <a href={opp.url} target="_blank" rel="noopener">Open <ExternalLink className="h-3.5 w-3.5" /></a>
            </Button>
          </div>
        </div>

        <p className="my-2.5 text-[12.5px] leading-relaxed text-muted-foreground">{opp.reason}</p>

        <div className="flex flex-wrap gap-1.5">
          {tag(opp.type)}
          {tag((FOR[opp.for_applicant] || FOR.either).label, (FOR[opp.for_applicant] || FOR.either).cls)}
          {tag(fund.label, fund.cls)}
          {tag(elig.label, elig.cls)}
          {opp.scholarship_type && tag(opp.scholarship_type, 'text-success border-success/30')}
          {opp.contact_email && tag(`✉ ${opp.contact_email}`, 'text-[hsl(212_90%_70%)]')}
          {opp.fit_score ? tag(`fit ${opp.fit_score}`, 'text-primary') : null}
          {opp.deadline_soon && tag(`closes in ${opp.deadline_days}d`, 'text-warning border-warning/40')}
          {opp.needs_followup && tag('follow up', 'text-[hsl(258_90%_72%)] border-[hsl(258_90%_66%)]/40')}
          {tag(`via ${opp.source}`)}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t pt-3">
          <Select value={status} onValueChange={(v) => { setStatus(v); const body: any = { status: v }; if (v === 'applied') body.date_applied = new Date().toISOString().slice(0, 10); api.updateOpp(opp.id, body) }}>
            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={flagged} onCheckedChange={(c) => { setFlagged(!!c); api.updateOpp(opp.id, { user_flagged: !!c }) }} /> shortlist
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            deadline
            <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} onBlur={() => api.updateOpp(opp.id, { deadline_user: deadline })}
              className="rounded-md border bg-background px-2 py-1 text-xs text-foreground" />
          </label>
        </div>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => api.updateOpp(opp.id, { user_notes: notes })}
          placeholder="Notes: supervisor, funding to confirm, eligibility check..." className="mt-2 min-h-[34px] text-xs" />
      </div>
    </div>
  )
}
