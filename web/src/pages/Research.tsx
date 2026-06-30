import { useCallback, useEffect, useState } from 'react'
import { Search, RefreshCw, Loader2 } from 'lucide-react'
import { Header } from '@/components/Header'
import { OpportunityCard } from '@/components/OpportunityCard'
import { ApplicationPackSheet } from '@/components/ApplicationPackSheet'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type Opportunity, type ResearchStats, type ScanRun, type AiStatus } from '@/lib/api'

type Filters = { type: string; area: string; funding: string; eligibility: string; q: string; sort: string; includeIneligible: boolean }

export default function Research() {
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [opps, setOpps] = useState<Opportunity[]>([])
  const [stats, setStats] = useState<ResearchStats | null>(null)
  const [scans, setScans] = useState<ScanRun[]>([])
  const [scanning, setScanning] = useState(false)
  const [sheetOpp, setSheetOpp] = useState<Opportunity | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [f, setF] = useState<Filters>({ type: 'all', area: 'all', funding: 'all', eligibility: 'all', q: '', sort: 'match', includeIneligible: false })

  const loadAi = useCallback(() => api.ai().then(setAi), [])
  const loadStats = useCallback(() => api.researchStats().then(setStats), [])
  const loadScans = useCallback(() => api.researchScans().then(setScans), [])
  const loadOpps = useCallback(() => {
    const p: Record<string, string> = {}
    if (f.type !== 'all') p.type = f.type
    if (f.area !== 'all') p.area = f.area
    if (f.funding !== 'all') p.funding = f.funding
    if (f.eligibility !== 'all') p.eligibility = f.eligibility
    if (f.q) p.q = f.q
    if (f.sort) p.sort = f.sort
    if (f.includeIneligible) p.includeIneligible = '1'
    return api.opportunities(p).then(setOpps)
  }, [f])

  useEffect(() => { loadAi(); loadStats(); loadScans() }, [loadAi, loadStats, loadScans])
  useEffect(() => { loadOpps() }, [loadOpps])

  function openPack(o: Opportunity) { if (!ai?.cv.uploaded) return; setSheetOpp(o); setSheetOpen(true) }
  function onGenerated(id: string, at: string) {
    setOpps((xs) => xs.map((o) => (o.id === id ? { ...o, pack_at: at, has_pack: true } : o)))
    setSheetOpp((o) => (o && o.id === id ? { ...o, pack_at: at, has_pack: true } : o))
  }

  async function runScan() {
    setScanning(true)
    await api.researchScan()
    const poll = setInterval(async () => {
      await loadScans()
      const runs = await api.researchScans()
      if (runs[0]?.finished_at) { clearInterval(poll); setScanning(false); loadOpps(); loadStats() }
    }, 3000)
  }

  const cells: [string, number][] = stats ? [
    ['Funded + open', stats.total], ['Tier A', stats.byTier.A || 0], ['PhD', stats.byType.phd || 0],
    ['Postdoc', stats.byType.postdoc || 0], ['Schemes', (stats.byType.scholarship || 0) + (stats.byType.fellowship || 0)], ['Applied', stats.byStatus.applied || 0],
  ] : []
  const latest = scans[0]

  return (
    <div className="min-h-screen">
      <Header ai={ai} onCV={loadAi} />
      <div className="mx-auto max-w-[1240px] px-6 pb-16 pt-5">
        <div className="mb-2 text-sm text-muted-foreground">Funded PhDs, postdocs & fellowships open to international students. A funded PhD is a Student-visa route; salaried research roles use Skilled Worker.</div>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {cells.map(([label, n]) => (
            <div key={label} className="rounded-xl border bg-gradient-to-b from-card to-card/40 p-4">
              <div className="text-2xl font-extrabold tracking-tight tabular-nums">{n}</div>
              <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_330px]">
          <main className="space-y-3">
            <Card className="p-3.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative min-w-[180px] flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search title or institution…" className="pl-9" />
                </div>
                <Sel value={f.type} onChange={(v) => setF({ ...f, type: v })} w="w-[140px]" opts={[['all', 'All types'], ['phd', 'PhD'], ['postdoc', 'Postdoc'], ['fellowship', 'Fellowship'], ['scholarship', 'Scholarship']]} />
                <Sel value={f.area} onChange={(v) => setF({ ...f, area: v })} w="w-[140px]" opts={[['all', 'All areas'], ['tech', 'Data / tech'], ['health', 'Health / nutrition'], ['other', 'Other']]} />
                <Sel value={f.funding} onChange={(v) => setF({ ...f, funding: v })} w="w-[160px]" opts={[['all', 'Any funding'], ['fully', '✓ Fully funded'], ['salaried', 'Salaried role'], ['unknown', '? Unclear']]} />
                <Sel value={f.eligibility} onChange={(v) => setF({ ...f, eligibility: v })} w="w-[170px]" opts={[['all', 'Any eligibility'], ['yes', '🌍 International-open'], ['unknown', '? Unstated'], ['no', 'Home-only']]} />
                <Sel value={f.sort} onChange={(v) => setF({ ...f, sort: v })} w="w-[150px]" opts={[['match', 'Sort: best match'], ['tier', 'Sort: funding']]} />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={f.includeIneligible} onCheckedChange={(c) => setF({ ...f, includeIneligible: !!c })} /> include Home-only / unfunded
                </label>
              </div>
            </Card>

            {opps.length ? opps.map((o) => <OpportunityCard key={o.id} opp={o} aiEnabled={!!ai?.enabled} onPack={openPack} />)
              : <div className="py-16 text-center italic text-muted-foreground">No opportunities match. Adjust filters, or run a scan.</div>}
          </main>

          <aside className="space-y-4 lg:sticky lg:top-[84px]">
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={runScan} disabled={scanning}>
                  {scanning ? <><Loader2 className="h-4 w-4 animate-spin" /> Scanning…</> : <><RefreshCw className="h-4 w-4" /> Scan now</>}
                </Button>
                <span className="text-xs text-muted-foreground">{latest?.finished_at ? `Last: ${new Date(latest.finished_at).toLocaleString()} · ${latest.total_found} found · ${latest.new_jobs} new` : latest ? 'Scanning…' : ''}</span>
              </div>
              {scans.slice(0, 2).map((r) => (
                <div key={r.id} className="mt-3">
                  <div className="mb-1 text-xs font-semibold text-primary">{new Date(r.started_at).toLocaleString()} — {r.total_found || 0} found, {r.new_jobs || 0} new</div>
                  {(r.sources || []).map((s, i) => (
                    <div key={i} className="flex justify-between border-b border-dashed py-1 text-xs text-muted-foreground">
                      <span>{s.source} <span className="opacity-60">{s.query}</span></span>
                      <span className={s.status === 'ok' ? 'text-success' : s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{s.status}{s.count ? ` · ${s.count}` : ''}</span>
                    </div>
                  ))}
                </div>
              ))}
            </Card>

            <Card className="p-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-primary">How opportunities are ranked</h3>
              {[['A', 'success', 'Fully funded + open to international students, or an open salaried research role. Top priority.'],
                ['B', 'info', 'Funded, but international eligibility is not stated. Verify it covers overseas fees.'],
                ['C', 'warning', 'Funded but Home-fee only, or eligibility unclear. Likely not usable as an international applicant.'],
                ['✕', 'destructive', 'Self-funded or unfunded. Kept, ranked out.']].map(([b, v, t]) => (
                <div key={b} className="mb-2 flex items-baseline gap-2 text-[12.5px] text-muted-foreground">
                  <Badge variant={v as any} className="shrink-0">{b}</Badge><span>{t}</span>
                </div>
              ))}
              <p className="mt-3 text-[11.5px] italic text-muted-foreground">Eligibility wording is often missing from listings, so always confirm funding and international fee cover on the link. General information, not advice.</p>
            </Card>
          </aside>
        </div>
      </div>
      <ApplicationPackSheet opp={sheetOpp} open={sheetOpen} onOpenChange={setSheetOpen} onGenerated={onGenerated} />
    </div>
  )
}

function Sel({ value, onChange, opts, w }: { value: string; onChange: (v: string) => void; opts: [string, string][]; w: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={w}><SelectValue /></SelectTrigger>
      <SelectContent>{opts.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  )
}
