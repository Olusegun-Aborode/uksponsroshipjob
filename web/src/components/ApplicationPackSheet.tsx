import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Loader2, Copy, RotateCw, FileDown } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { api, type Opportunity, type ApplicationPack } from '@/lib/api'

const md = {
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

export function ApplicationPackSheet({ opp, open, onOpenChange, onGenerated }: {
  opp: Opportunity | null; open: boolean; onOpenChange: (o: boolean) => void; onGenerated: (id: string, at: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<ApplicationPack | null>(null)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (!open || !opp) return
    setRes(null); setError(''); setFresh(!opp.has_pack); setLoading(true)
    api.pack(opp.id).then((r) => {
      if (r.error) setError(r.error); else { setRes(r.result); onGenerated(opp.id, r.pack_at) }
    }).catch((e) => setError(String(e?.message || e))).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, opp?.id])

  async function regen() {
    if (!opp) return
    setLoading(true); setRes(null); setError('')
    try { const r = await api.pack(opp.id, true); if (r.error) setError(r.error); else { setRes(r.result); onGenerated(opp.id, r.pack_at) } }
    catch (e) { setError(String((e as Error)?.message || e)) }
    setLoading(false)
  }
  const copy = (t: string, label: string) => { navigator.clipboard.writeText(t); toast.success(label) }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8 leading-snug">{opp?.title}</SheetTitle>
          <SheetDescription>{opp?.institution} · {opp?.type}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-[hsl(258_90%_66%)]" />
              <div>{fresh ? <>Building your application pack…<br /><span className="text-xs">Academic CV, statement, supervisor email, eligibility check. ~25s</span></> : 'Loading your application pack…'}</div>
            </div>
          )}
          {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

          {res && !loading && (
            <>
              <p className="mb-1.5 font-serif text-lg leading-snug">{res.fit_summary}</p>
              <div className="mb-5 flex items-center gap-4 rounded-xl border bg-card p-4">
                <div className="text-3xl font-extrabold text-primary tabular-nums">{Math.max(0, Math.min(100, res.fit_score))}</div>
                <div className="flex-1">
                  <div className="mb-1.5 text-xs font-medium">Research fit estimate</div>
                  <Progress value={Math.max(0, Math.min(100, res.fit_score))} />
                  <div className="mt-1 text-[11px] text-muted-foreground">How well your background fits this research area.</div>
                </div>
              </div>

              <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">Funding & eligibility check</div>
                <p className="whitespace-pre-wrap text-[12.5px] text-muted-foreground">{res.eligibility_check}</p>
              </div>

              <Tabs defaultValue="cv">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="cv">Academic CV</TabsTrigger>
                  <TabsTrigger value="sop">Statement</TabsTrigger>
                  <TabsTrigger value="email">Email</TabsTrigger>
                  <TabsTrigger value="q">Questions</TabsTrigger>
                </TabsList>

                <TabsContent value="cv">
                  <div className="mb-3 flex justify-end gap-2">
                    <Button asChild size="sm"><a href={api.oppDocxUrl(opp?.id || '')} download><FileDown className="h-3.5 w-3.5" />Download .docx</a></Button>
                    <Button size="sm" variant="outline" onClick={() => copy(res.academic_cv_markdown, 'CV copied')}><Copy className="h-3.5 w-3.5" />Copy</Button>
                    <Button size="sm" variant="outline" onClick={regen}><RotateCw className="h-3.5 w-3.5" />Regenerate</Button>
                  </div>
                  <div className="rounded-xl border bg-card p-5"><Markdown remarkPlugins={[remarkGfm]} components={md}>{res.academic_cv_markdown}</Markdown></div>
                </TabsContent>

                <TabsContent value="sop">
                  <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => copy(res.statement_of_purpose, 'Statement copied')}><Copy className="h-3.5 w-3.5" />Copy</Button></div>
                  <div className="whitespace-pre-wrap rounded-xl border bg-card p-5 text-[13.5px] leading-relaxed text-muted-foreground">{res.statement_of_purpose}</div>
                </TabsContent>

                <TabsContent value="email">
                  <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => copy(res.supervisor_email, 'Email copied')}><Copy className="h-3.5 w-3.5" />Copy</Button></div>
                  <div className="whitespace-pre-wrap rounded-xl border bg-card p-5 text-[13.5px] leading-relaxed text-muted-foreground">{res.supervisor_email}</div>
                </TabsContent>

                <TabsContent value="q">
                  <ul className="list-disc space-y-2 rounded-xl border bg-card p-5 pl-9 text-[13px] text-muted-foreground">
                    {res.questions_to_ask.map((q, i) => <li key={i}>{q}</li>)}
                  </ul>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
