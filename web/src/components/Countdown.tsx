import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'

export function Countdown() {
  const [expiry, setExpiry] = useState(() => localStorage.getItem('visaExpiry') || '2027-01-07')
  useEffect(() => { if (expiry) localStorage.setItem('visaExpiry', expiry) }, [expiry])

  const days = expiry ? Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000) : null
  const target = days != null ? Math.max(days - 75, 0) : 0
  const color = days == null ? '' : days < 90 ? 'text-destructive' : days < 150 ? 'text-warning' : 'text-success'

  return (
    <div className="rounded-lg border bg-card px-3.5 py-2 min-w-[176px]">
      <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Graduate visa expiry</label>
      <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)}
        className="h-6 border-0 border-b rounded-none px-0 shadow-none text-xs focus-visible:ring-0" />
      {days != null ? (
        <div className="mt-1">
          <div className={`text-xl font-extrabold leading-none ${color}`}>{days} days</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">until expiry · ~{target}d to lock a CoS</div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground mt-1">Set expiry to start countdown</div>
      )}
    </div>
  )
}
