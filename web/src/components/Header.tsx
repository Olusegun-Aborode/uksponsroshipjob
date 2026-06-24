import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Upload, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Countdown } from './Countdown'
import { api, type AiStatus } from '@/lib/api'

export function Header({ ai, onCV }: { ai: AiStatus | null; onCV: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const hasCV = !!ai?.cv.uploaded

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true)
    try {
      const r = await api.uploadCV(f)
      if (r.error) toast.error(r.error)
      else { toast.success('CV uploaded'); onCV() }
    } catch { toast.error('Upload failed') }
    setBusy(false)
    e.target.value = ''
  }

  return (
    <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-4 border-b bg-background/80 px-6 py-3 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-[hsl(155_70%_45%)] text-sm font-extrabold text-primary-foreground shadow-lg shadow-primary/30">SJ</div>
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Sponsorship Job Board</h1>
          <p className="text-[11px] text-muted-foreground">Graduate → Skilled Worker · UK-wide · ranked by CoS confidence</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5 rounded-full border bg-card py-1 pl-3.5 pr-1.5">
          {hasCV
            ? <Badge variant="success" className="gap-1 font-medium"><FileText className="h-3 w-3" />{ai?.cv.filename}</Badge>
            : <span className="text-xs text-muted-foreground">{ai?.enabled ? 'No CV uploaded' : 'AI off, add API key'}</span>}
          <Button size="sm" variant="outline" className="h-7 rounded-full" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {hasCV ? 'Replace' : 'Upload CV'}
          </Button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={upload} />
        </div>
        <Countdown />
      </div>
    </header>
  )
}
