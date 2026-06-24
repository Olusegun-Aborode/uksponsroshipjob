import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { Loader2, Copy, RotateCw } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { api, type Job, type TailorResult } from '@/lib/api'

const mdComponents = {
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

export function TailorSheet({ job, open, onOpenChange, onGenerated }: {
  job: Job | null; open: boolean; onOpenChange: (o: boolean) => void; onGenerated: (id: string, at: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [res, setRes] = useState<TailorResult | null>(null)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (!open || !job) return
    setRes(null); setError(''); setFresh(!job.generated_at); setLoading(true)
    api.tailor(job.id).then((r) => {
      if (r.error) setError(r.error)
      else { setRes(r.result); onGenerated(job.id, r.generated_at) }
    }).catch((e) => setError(String(e?.message || e))).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, job?.id])

  async function regen() {
    if (!job) return
    setLoading(true); setRes(null); setError('')
    try {
      const r = await api.tailor(job.id, true)
      if (r.error) setError(r.error); else { setRes(r.result); onGenerated(job.id, r.generated_at) }
    } catch (e) { setError(String((e as Error)?.message || e)) }
    setLoading(false)
  }
  const copy = (text: string, label: string) => { navigator.clipboard.writeText(text); toast.success(label) }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[680px]">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="pr-8 leading-snug">{job?.title}</SheetTitle>
          <SheetDescription>{job?.employer} · {job?.region || job?.location}</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-[hsl(258_90%_66%)]" />
              <div>{fresh ? <>Tailoring your CV for this role…<br /><span className="text-xs">Claude is rewriting against the job description, ~20s</span></> : 'Loading your tailored CV…'}</div>
            </div>
          )}
          {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>}

          {res && !loading && (
            <>
              <p className="mb-1.5 font-serif text-lg leading-snug">{res.headline}</p>
              <p className="mb-4 text-[13px] text-muted-foreground">{res.fit_summary}</p>

              <div className="mb-5 flex items-center gap-4 rounded-xl border bg-card p-4">
                <div className="text-3xl font-extrabold text-primary tabular-nums">{Math.max(0, Math.min(100, res.ats_score))}</div>
                <div className="flex-1">
                  <div className="mb-1.5 text-xs font-medium">ATS match estimate</div>
                  <Progress value={Math.max(0, Math.min(100, res.ats_score))} />
                  <div className="mt-1 text-[11px] text-muted-foreground">How well your CV matches this posting's stated requirements.</div>
                </div>
              </div>

              <Tabs defaultValue="cv">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="cv">Tailored CV</TabsTrigger>
                  <TabsTrigger value="cover">Cover note</TabsTrigger>
                  <TabsTrigger value="kw">Keywords</TabsTrigger>
                  <TabsTrigger value="gaps">Courses</TabsTrigger>
                </TabsList>

                <TabsContent value="cv">
                  <div className="mb-3 flex justify-end gap-2">
                    <Button size="sm" variant="outline" onClick={() => copy(res.tailored_cv_markdown, 'CV copied')}><Copy className="h-3.5 w-3.5" />Copy CV</Button>
                    <Button size="sm" variant="outline" onClick={regen}><RotateCw className="h-3.5 w-3.5" />Regenerate</Button>
                  </div>
                  <div className="rounded-xl border bg-card p-5">
                    <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>{res.tailored_cv_markdown}</Markdown>
                  </div>
                </TabsContent>

                <TabsContent value="cover">
                  <div className="mb-3 flex justify-end"><Button size="sm" variant="outline" onClick={() => copy(res.cover_note, 'Note copied')}><Copy className="h-3.5 w-3.5" />Copy note</Button></div>
                  <div className="whitespace-pre-wrap rounded-xl border bg-card p-5 text-[13.5px] leading-relaxed text-muted-foreground">{res.cover_note}</div>
                </TabsContent>

                <TabsContent value="kw">
                  <div className="mb-5">
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">✓ You have these</div>
                    <div className="flex flex-wrap gap-2">
                      {res.matched_keywords.length ? res.matched_keywords.map((k) => <Badge key={k} variant="outline" className="border-success/40 bg-success/10 text-success font-normal">{k}</Badge>) : <span className="text-xs text-muted-foreground">none</span>}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">✗ Missing / unproven</div>
                    <div className="flex flex-wrap gap-2">
                      {res.missing_keywords.length ? res.missing_keywords.map((k) => <Badge key={k} variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive font-normal">{k}</Badge>) : <span className="text-xs text-muted-foreground">none, strong match</span>}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="gaps">
                  {res.skill_gaps.length ? res.skill_gaps.map((g, i) => (
                    <div key={i} className="mb-3 rounded-xl border bg-card p-4">
                      <div className="text-sm font-semibold">{g.skill}</div>
                      <p className="mb-2.5 mt-0.5 text-[12.5px] text-muted-foreground">{g.why_it_matters}</p>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline"><a href={g.courses.coursera} target="_blank" rel="noopener">Coursera</a></Button>
                        <Button asChild size="sm" variant="outline"><a href={g.courses.udemy} target="_blank" rel="noopener">Udemy</a></Button>
                        <Button asChild size="sm" variant="outline"><a href={g.courses.linkedin} target="_blank" rel="noopener">LinkedIn</a></Button>
                      </div>
                    </div>
                  )) : <p className="text-sm text-muted-foreground">No major gaps flagged.</p>}
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
