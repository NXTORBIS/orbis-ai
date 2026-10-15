import { useEffect, useMemo, useState } from 'react';
import { Globe, RefreshCw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat, CopyBtn, Panel } from './shared';
import { toLocalInput } from './TimestampConverter';

const ZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'Asia/Kolkata', label: 'India · IST' },
  { id: 'Asia/Dubai', label: 'Dubai' },
  { id: 'Asia/Singapore', label: 'Singapore' },
  { id: 'Asia/Tokyo', label: 'Tokyo' },
  { id: 'Europe/London', label: 'London' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'America/New_York', label: 'New York' },
  { id: 'America/Los_Angeles', label: 'Los Angeles' },
  { id: 'Australia/Sydney', label: 'Sydney' },
];

function offsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return (asUTC - date.getTime()) / 60000;
}

function zonedToUtc(value, timeZone) {
  const [d, t] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, min);
  let utc = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  utc = guess - offsetMinutes(new Date(utc), timeZone) * 60000;
  return new Date(utc);
}

const fmtOffset = (mins) => {
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
};

export default function TimezoneConverter() {
  const [from, setFrom] = useState('Asia/Kolkata');
  const [value, setValue] = useState(toLocalInput(new Date()));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const rows = useMemo(() => {
    if (!value) return [];
    const utc = zonedToUtc(value, from);
    const baseDate = new Intl.DateTimeFormat('en-CA', { timeZone: from, dateStyle: 'short' }).format(utc);
    return ZONES.map((z) => {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: z.id, hour: '2-digit', minute: '2-digit', hour12: false }).format(utc);
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: z.id, dateStyle: 'short' }).format(utc);
      const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: z.id, weekday: 'short' }).format(utc);
      const dayShift = Math.round((new Date(`${date}T00:00:00Z`) - new Date(`${baseDate}T00:00:00Z`)) / 86400000);
      return { ...z, time, date, weekday, dayShift, offset: fmtOffset(offsetMinutes(utc, z.id)) };
    });
  }, [value, from, tick]);

  const utc = value ? zonedToUtc(value, from) : null;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Globe} title="Time Zone Converter" desc="Pick a moment in one city and see it across ten zones at once." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date & time">
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="From zone">
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {ZONES.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
          </select>
        </Field>
      </div>
      <Button size="sm" variant="outline" onClick={() => setValue(toLocalInput(new Date()))} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" /> Use current time
      </Button>
      {utc && !Number.isNaN(utc.getTime()) ? (
        <>
          <Panel>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Reference instant</div>
            <div className="font-mono-j text-sm text-cyan-j">{utc.toISOString()}</div>
          </Panel>
          <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 last:border-0 hover:bg-accent/40">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{r.label}</div>
                  <div className="text-[11px] text-muted-foreground">{r.weekday} {r.date} · {r.offset}</div>
                </div>
                <div className="flex items-center gap-2">
                  {r.dayShift !== 0 && (
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${r.dayShift > 0 ? 'bg-cyan-j/15 text-cyan-j' : 'bg-amber-500/15 text-amber-500'}`}>
                      {r.dayShift > 0 ? `+${r.dayShift}d` : `${r.dayShift}d`}
                    </span>
                  )}
                  <span className="font-display text-base tabular-nums">{r.time}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Zones shown" value={String(rows.length)} />
            <Stat label="Your zone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />
          </div>
          <CopyBtn value={rows.map((r) => `${r.label}: ${r.time} (${r.date})`).join('\n')} label="Copy all times" />
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Pick a valid date and time.</div>
      )}
    </div>
  );
}