import { useCallback, useEffect, useState } from 'react'
import { Search, RefreshCw, Loader2 } from 'lucide-react'
import { Header } from '@/components/Header'
import { JobCard } from '@/components/JobCard'
import { TailorSheet } from '@/components/TailorSheet'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Job, type Stats, type ScanRun, type RegisterInfo, type AiStatus } from '@/lib/api'

const REGIONS = ['London/SE', 'Rest of England', 'Scotland', 'Wales', 'Northern Ireland', 'Remote']

type Filters = { status: string; tier: string; region: string; salary: string; q: string; includeExcluded: boolean; hideUnderpaid: boolean; hideStale: boolean }

export default function App() {
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [scans, setScans] = useState<ScanRun[]>([])
  const [reg, setReg] = useState<RegisterInfo | null>(null)
  const [scanning, setScanning] = useState(false)
  const [sheetJob, setSheetJob] = useState<Job | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [f, setF] = useState<Filters>({ status: 'all', tier: 'all', region: 'all', salary: 'all', q: '', includeExcluded: false, hideUnderpaid: false, hideStale: false })

  const loadAi = useCallback(() => api.ai().then(setAi), [])
  const loadStats = useCallback(() => api.stats().then(setStats), [])
  const loadScans = useCallback(() => api.scans().then(setScans), [])
  const loadJobs = useCallback(() => {
    const p: Record<string, string> = {}
    if (f.status !== 'all') p.status = f.status
    if (f.tier !== 'all') p.tier = f.tier
    if (f.region !== 'all') p.region = f.region
    if (f.salary !== 'all') p.salary = f.salary
    if (f.q) p.q = f.q
    if (f.includeExcluded) p.includeExcluded = '1'
    if (f.hideUnderpaid) p.hideUnderpaid = '1'
    if (f.hideStale) p.hideStale = '1'
    return api.jobs(p).then(setJobs)
  }, [f])

  useEffect(() => { loadAi(); loadStats(); loadScans(); api.register().then(setReg) }, [loadAi, loadStats, loadScans])
  useEffect(() => { loadJobs() }, [loadJobs])
  useEffect(() => { const t = setInterval(loadScans, 60000); return () => clearInterval(t) }, [loadScans])

  function openTailor(j: Job) {
    if (!ai?.cv.uploaded) return
    setSheetJob(j); setSheetOpen(true)
  }
  function onGenerated(id: string, at: string) {
    setJobs((js) => js.map((j) => (j.id === id ? { ...j, generated_at: at } : j)))
    setSheetJob((j) => (j && j.id === id ? { ...j, generated_at: at } : j))
  }

  async function runScan() {
    setScanning(true)
    await api.scan()
    const poll = setInterval(async () => {
      await loadScans()
      const runs = await api.scans()
      if (runs[0]?.finished_at) { clearInterval(poll); setScanning(false); loadJobs(); loadStats() }
    }, 2500)
  }

  const statCells: [string, string, number][] = stats ? [
    ['all', 'Total', stats.total], ['new', 'New', stats.byStatus.new || 0], ['applied', 'Applied', stats.byStatus.applied || 0],
    ['interviewing', 'Interviews', stats.byStatus.interviewing || 0], ['offer', 'Offers', stats.byStatus.offer || 0], ['A', 'Tier A', stats.byTier.A || 0],
  ] : []

  function clickStat(k: string) {
    if (k === 'A') setF((s) => ({ ...s, tier: 'A', status: 'all' }))
    else if (k === 'all') setF((s) => ({ ...s, status: 'all', tier: 'all' }))
    else setF((s) => ({ ...s, status: k, tier: 'all' }))
  }

  const latest = scans[0]

  return (
    <div className="min-h-screen">
      <Header ai={ai} onCV={loadAi} />

      <div className="mx-auto max-w-[1240px] px-6 pb-16 pt-5">
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {statCells.map(([k, label, n]) => {
            const active = (k === 'A' && f.tier === 'A') || (k !== 'A' && k !== 'all' && f.status === k) || (k === 'all' && f.status === 'all' && f.tier === 'all')
            return (
              <button key={k} onClick={() => clickStat(k)}
                className={`rounded-xl border bg-gradient-to-b from-card to-card/40 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-muted-foreground/30 ${active ? 'border-primary ring-1 ring-primary' : ''}`}>
                <div className="text-2xl font-extrabold tracking-tight tabular-nums">{n}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
              </button>
            )
          })}
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_330px]">
          <main className="space-y-3">
            <Card className="p-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search title or employer…" className="pl-9" />
                </div>
                <FilterSelect value={f.tier} onChange={(v) => setF({ ...f, tier: v })} w="w-[210px]"
                  opts={[['all', 'All tiers'], ['A', 'A, sponsorship + register'], ['B-', 'B−, claims sponsorship'], ['B', 'B, on register'], ['C', 'C, possible match'], ['unknown', 'Unknown']]} />
                <FilterSelect value={f.region} onChange={(v) => setF({ ...f, region: v })} w="w-[150px]"
                  opts={[['all', 'All locations'], ...REGIONS.map((r) => [r, r] as [string, string])]} />
                <FilterSelect value={f.status} onChange={(v) => setF({ ...f, status: v })} w="w-[140px]"
                  opts={[['all', 'Any status'], ['new', 'New'], ['interested', 'Interested'], ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'], ['rejected', 'Rejected']]} />
                <FilterSelect value={f.salary} onChange={(v) => setF({ ...f, salary: v })} w="w-[150px]"
                  opts={[['all', 'Any salary'], ['pass', '✓ Clears floor'], ['borderline', '◑ Borderline'], ['unknown', '? Not disclosed'], ['fail', '⚠ Below floor']]} />
                <Toggle label="hide underpaid" checked={f.hideUnderpaid} onChange={(v) => setF({ ...f, hideUnderpaid: v })} />
                <Toggle label="hide stale" checked={f.hideStale} onChange={(v) => setF({ ...f, hideStale: v })} />
                <Toggle label="show excluded" checked={f.includeExcluded} onChange={(v) => setF({ ...f, includeExcluded: v })} />
              </div>
            </Card>

            {jobs.length ? jobs.map((j) => <JobCard key={j.id} job={j} aiEnabled={!!ai?.enabled} onTailor={openTailor} />)
              : <div className="py-16 text-center italic text-muted-foreground">No roles match. Adjust filters, or run a scan.</div>}
          </main>

          <aside className="space-y-4 lg:sticky lg:top-[84px]">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={runScan} disabled={scanning}>
                  {scanning ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</> : <><RefreshCw className="h-4 w-4" /> Scan now</>}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {latest?.finished_at ? `Last: ${new Date(latest.finished_at).toLocaleString()} · ${latest.total_found} found · ${latest.new_jobs} new` : latest ? 'A scan is running…' : ''}
                </span>
              </div>
              {scans.slice(0, 3).map((r) => (
                <div key={r.id} className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-primary">{new Date(r.started_at).toLocaleString()}, {r.total_found || 0} found, {r.new_jobs || 0} new</div>
                  {(r.sources || []).map((s, i) => (
                    <div key={i} className="flex justify-between border-b border-dashed py-1 text-xs text-muted-foreground">
                      <span>{s.source}</span>
                      <span className={s.status === 'ok' ? 'text-success' : s.status === 'failed' ? 'text-destructive' : s.status === 'rate_limited' ? 'text-warning' : 'text-muted-foreground'}>{s.status}{s.count ? ` · ${s.count}` : ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-primary">How priority is decided</h3>
              {[['A', 'success', 'Posting states sponsorship AND on the gov.uk register. Pinned to top.'],
                ['B−', 'warning', 'Claims sponsorship, employer not yet matched, verify the legal entity.'],
                ['B', 'info', 'On the register, posting silent, ask the recruiter early.'],
                ['C', 'muted', 'Possible register match, no signal.'],
                ['✕', 'destructive', 'Says no sponsorship, kept, ranked out, never deleted.']].map(([b, v, t]) => (
                <div key={b} className="mb-2 flex items-baseline gap-2 text-[12.5px] text-muted-foreground">
                  <Badge variant={v as any} className="shrink-0">{b}</Badge><span>{t}</span>
                </div>
              ))}
              {reg && reg.total > 0 && (
                <div className="mt-3 border-t border-dashed pt-3 text-[11.5px] text-muted-foreground">
                  <b className="text-primary">{reg.total.toLocaleString()}</b> sponsors · <b className="text-primary">{(reg.skilled_worker || 0).toLocaleString()}</b> Skilled Worker · loaded{' '}
                  <span className={reg.days_old != null && reg.days_old > 40 ? 'text-warning' : ''}>{reg.loaded_at ? (reg.days_old === 0 ? 'today' : `${reg.days_old}d ago`) : 'unknown'}</span>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-primary">2026 rules, your numbers</h3>
              {[['£41,700', 'general threshold (or going rate, higher)'], ['£33,400', 'new-entrant floor / 70% going rate'], ['RQF 6', 'degree-level · B2 English ✓']].map(([a, b]) => (
                <div key={a} className="border-b border-dashed py-1.5 text-[12.5px] text-muted-foreground"><b className="text-primary">{a}</b> {b}</div>
              ))}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
                <a href="https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers" target="_blank" rel="noopener">Register ↗</a>
                <a href="https://www.gov.uk/government/publications/skilled-worker-visa-going-rates-for-eligible-occupations" target="_blank" rel="noopener">Going rates ↗</a>
              </div>
              <p className="mt-3 text-[11.5px] italic text-muted-foreground">General information, not immigration advice, verify on gov.uk and with an OISC-regulated adviser.</p>
            </Card>
          </aside>
        </div>
      </div>

      <TailorSheet job={sheetJob} open={sheetOpen} onOpenChange={setSheetOpen} onGenerated={onGenerated} />
    </div>
  )
}

function FilterSelect({ value, onChange, opts, w }: { value: string; onChange: (v: string) => void; opts: [string, string][]; w: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={w}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} /> {label}
    </label>
  )
}
