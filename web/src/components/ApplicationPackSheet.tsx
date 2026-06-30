import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Loader2, Copy, RotateCw, FileDown, Search, Mail, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { api, type Opportunity, type ApplicationPack, type Dossier } from '@/lib/api'

const mdc = {
  h1: (p: any) => <h1 className="font-serif text-xl font-semibold mb-1" {...p} />,
  h2: (p: any) => <h2 className="mt-5 mb-2 border-b pb-1 text-xs font-bold uppercase tracking-wider text-primary" {...p} />,
  h3: (p: any) => <h3 className="mt-3 mb-0.5 text-sm font-semibold text-foreground" {...p} />,
  p: (p: any) => <p className="my-1.5 text-[13.5px] leading-relaxed text-muted-foreground" {...p} />,
  ul: (p: any) => <ul className="my-1.5 list-disc pl-5 space-y-1" {...p} />,
  li: (p: any) => <li className="text-[13px] text-muted-foreground" {...p} />,
  strong: (p: any) => <strong className="font-semibold text-foreground" {...p} />,
  a: (p: any) => <a className="text-[hsl(212_90%_70%)] underline" target="_blank" rel="noopener" {...p} />,
  hr: () => <hr className="my-3 border-border" />,
}
const copy = (t: string, label: string) => { navigator.clipboard.writeText(t); toast.success(label) }
const YesNo = ({ v, label }: { v: boolean; label: string }) => (
  <div className={`flex items-center gap-1.5 text-[12.5px] ${v ? 'text-success' : 'text-destructive'}`}>
    {v ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{label}
  </div>
)

export function ApplicationPackSheet({ opp, open, onOpenChange, onGenerated }: {
  opp: Opportunity | null; open: boolean; onOpenChange: (o: boolean) => void; onGenerated: (id: string) => void
}) {
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [dLoading, setDLoading] = useState(false)
  const [dErr, setDErr] = useState('')
  const [pack, setPack] = useState<ApplicationPack | null>(null)
  const [pLoading, setPLoading] = useState(false)
  const [pErr, setPErr] = useState('')
  const [applicant, setApplicant] = useState<'self' | 'partner'>('partner')

  useEffect(() => {
    if (!open || !opp) return
    setDossier(null); setDErr(''); setPack(null); setPErr('')
    setApplicant(opp.for_applicant === 'self' ? 'self' : 'partner')
    if (opp.has_dossier) { setDLoading(true); api.dossier(opp.id).then(r => !r.error && setDossier(r.result)).finally(() => setDLoading(false)) }
    if (opp.has_pack) { setPLoading(true); api.pack(opp.id).then(r => { if (!r.error) { setPack(r.result); if (r.applicant) setApplicant(r.applicant as any) } }).finally(() => setPLoading(false)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opp?.id])

  async function runDossier(force = false) {
    if (!opp) return
    setDLoading(true); setDErr(''); if (force) setDossier(null)
    try { const r = await api.dossier(opp.id, force); if (r.error) setDErr(r.error); else { setDossier(r.result); onGenerated(opp.id) } }
    catch (e) { setDErr(String((e as Error)?.message || e)) }
    setDLoading(false)
  }
  async function runPack(force = false) {
    if (!opp) return
    setPLoading(true); setPErr(''); if (force) setPack(null)
    try { const r = await api.pack(opp.id, { force, applicant }); if (r.error) setPErr(r.error); else { setPack(r.result); onGenerated(opp.id) } }
    catch (e) { setPErr(String((e as Error)?.message || e)) }
    setPLoading(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[700px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8 leading-snug">{opp?.title}</SheetTitle>
          <SheetDescription>{opp?.institution} · {opp?.type} · for {opp?.for_applicant === 'self' ? 'you' : opp?.for_applicant === 'partner' ? 'your partner' : 'either of you'}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <Tabs defaultValue="research">
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="research">Research</TabsTrigger>
              <TabsTrigger value="cv">CV</TabsTrigger>
              <TabsTrigger value="sop">Statement</TabsTrigger>
              <TabsTrigger value="email">Email</TabsTrigger>
              <TabsTrigger value="q">Questions</TabsTrigger>
            </TabsList>

            {/* ---- Deep research / dossier ---- */}
            <TabsContent value="research">
              {!dossier && !dLoading && (
                <div className="rounded-xl border bg-card p-5 text-center">
                  <p className="mb-3 text-sm text-muted-foreground">Run a deep web search to confirm the school, scholarship type, a contact email, the funding (incl. overseas fees), the deadline, and how to apply.</p>
                  <Button onClick={() => runDossier(false)}><Search className="h-4 w-4" />Research this opportunity</Button>
                </div>
              )}
              {dLoading && <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin text-[hsl(258_90%_66%)]" /><span className="text-xs">Researching the web… ~45s</span></div>}
              {dErr && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{dErr}</div>}
              {dossier && !dLoading && (
                <div className="space-y-3">
                  <div className="rounded-xl border bg-card p-4">
                    <Row k="School" v={dossier.school} />
                    <Row k="Department" v={dossier.department} />
                    <Row k="Scholarship type" v={dossier.scholarship_type} />
                    <Row k="Supervisor / contact" v={dossier.supervisor} />
                    <div className="flex items-center gap-2 py-1.5 text-[13px]">
                      <span className="w-32 shrink-0 text-muted-foreground">Email</span>
                      {dossier.contact_email && dossier.contact_email !== 'not found'
                        ? <><a href={`mailto:${dossier.contact_email}`} className="text-[hsl(212_90%_70%)] underline">{dossier.contact_email}</a>
                            <button onClick={() => copy(dossier.contact_email, 'Email copied')} className="text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
                            <a href={`mailto:${dossier.contact_email}`} className="text-muted-foreground hover:text-foreground"><Mail className="h-3.5 w-3.5" /></a></>
                        : <span className="text-muted-foreground">not found</span>}
                    </div>
                    <Row k="Deadline" v={dossier.deadline} />
                    <Row k="Stipend" v={dossier.stipend} />
                  </div>
                  <div className="flex flex-wrap gap-4 rounded-xl border bg-card p-4">
                    <YesNo v={dossier.fully_funded} label="Fully funded" />
                    <YesNo v={dossier.covers_international_fees} label="Covers international fees" />
                  </div>
                  {dossier.funding_details && <Block title="Funding" body={dossier.funding_details} />}
                  {dossier.eligibility_note && <Block title="Eligibility" body={dossier.eligibility_note} />}
                  {dossier.how_to_apply?.length > 0 && (
                    <div className="rounded-xl border bg-card p-4">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-primary">How to apply</div>
                      <ol className="list-decimal space-y-1 pl-5 text-[12.5px] text-muted-foreground">{dossier.how_to_apply.map((s, i) => <li key={i}>{s}</li>)}</ol>
                    </div>
                  )}
                  <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-warning">Legitimacy / risk</div>
                    <p className="text-[12.5px] text-muted-foreground">{dossier.legitimacy_note}</p>
                  </div>
                  {dossier.sources?.length > 0 && (
                    <div className="text-[11.5px] text-muted-foreground">
                      Sources: {dossier.sources.slice(0, 5).map((s, i) => <a key={i} href={s} target="_blank" rel="noopener" className="mr-2 inline-flex items-center gap-0.5 text-[hsl(212_90%_70%)] underline">{new URL(s).hostname.replace('www.', '')}<ExternalLink className="h-3 w-3" /></a>)}
                    </div>
                  )}
                  <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => runDossier(true)}><RotateCw className="h-3.5 w-3.5" />Re-research</Button></div>
                </div>
              )}
            </TabsContent>

            {/* ---- Application pack tabs ---- */}
            {(['cv', 'sop', 'email', 'q'] as const).map((tab) => (
              <TabsContent key={tab} value={tab}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1 rounded-lg border bg-card p-1 text-xs">
                    <button onClick={() => setApplicant('self')} className={`rounded px-2.5 py-1 ${applicant === 'self' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>You</button>
                    <button onClick={() => setApplicant('partner')} className={`rounded px-2.5 py-1 ${applicant === 'partner' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground'}`}>Partner</button>
                  </div>
                  {pack && <Button size="sm" variant="outline" onClick={() => runPack(true)}><RotateCw className="h-3.5 w-3.5" />Regenerate</Button>}
                </div>
                {pLoading && <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin text-[hsl(258_90%_66%)]" /><span className="text-xs">Building the application pack… ~25s</span></div>}
                {pErr && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{pErr}</div>}
                {!pack && !pLoading && (
                  <div className="rounded-xl border bg-card p-5 text-center">
                    <p className="mb-3 text-sm text-muted-foreground">Generate a tailored academic CV, statement of purpose, supervisor email, and fit read using {applicant === 'self' ? 'your' : "your partner's"} CV.</p>
                    <Button onClick={() => runPack(false)}>Generate application pack</Button>
                  </div>
                )}
                {pack && !pLoading && tab === 'cv' && (
                  <>
                    <div className="mb-4 flex items-center gap-4 rounded-xl border bg-card p-4">
                      <div className="text-3xl font-extrabold text-primary tabular-nums">{Math.max(0, Math.min(100, pack.fit_score))}</div>
                      <div className="flex-1"><div className="mb-1 text-xs font-medium">Research fit</div><Progress value={Math.max(0, Math.min(100, pack.fit_score))} /><div className="mt-1 text-[11px] text-muted-foreground">{pack.fit_summary}</div></div>
                    </div>
                    {pack.eligibility_check && <div className="mb-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-[12.5px] text-muted-foreground whitespace-pre-wrap">{pack.eligibility_check}</div>}
                    <div className="mb-3 flex justify-end gap-2">
                      <Button asChild size="sm"><a href={api.oppDocxUrl(opp?.id || '')} download><FileDown className="h-3.5 w-3.5" />Download .docx</a></Button>
                      <Button size="sm" variant="outline" onClick={() => copy(pack.academic_cv_markdown, 'CV copied')}><Copy className="h-3.5 w-3.5" />Copy</Button>
                    </div>
                    <div className="rounded-xl border bg-card p-5"><Markdown remarkPlugins={[remarkGfm]} components={mdc}>{pack.academic_cv_markdown}</Markdown></div>
                  </>
                )}
                {pack && !pLoading && tab === 'sop' && (<><div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => copy(pack.statement_of_purpose, 'Statement copied')}><Copy className="h-3.5 w-3.5" />Copy</Button></div><div className="whitespace-pre-wrap rounded-xl border bg-card p-5 text-[13.5px] leading-relaxed text-muted-foreground">{pack.statement_of_purpose}</div></>)}
                {pack && !pLoading && tab === 'email' && (<><div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => copy(pack.supervisor_email, 'Email copied')}><Copy className="h-3.5 w-3.5" />Copy</Button></div><div className="whitespace-pre-wrap rounded-xl border bg-card p-5 text-[13.5px] leading-relaxed text-muted-foreground">{pack.supervisor_email}</div></>)}
                {pack && !pLoading && tab === 'q' && (<ul className="list-disc space-y-2 rounded-xl border bg-card p-5 pl-9 text-[13px] text-muted-foreground">{pack.questions_to_ask.map((q, i) => <li key={i}>{q}</li>)}</ul>)}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex gap-2 py-1.5 text-[13px]"><span className="w-32 shrink-0 text-muted-foreground">{k}</span><span className="text-foreground">{v || 'not found'}</span></div>
}
function Block({ title, body }: { title: string; body: string }) {
  return <div className="rounded-xl border bg-card p-4"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{title}</div><p className="text-[12.5px] text-muted-foreground">{body}</p></div>
}
