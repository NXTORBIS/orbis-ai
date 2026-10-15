import { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel, ToggleRow } from './shared';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function businessDays(from, to, includeEnd) {
  let count = 0;
  const start = new Date(from);
  const end = includeEnd ? to : new Date(to.getTime() - 86400000);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

export default function DateDifference() {
  const [from, setFrom] = useState(toISO(new Date()));
  const [to, setTo] = useState(toISO(new Date(Date.now() + 30 * 86400000)));
  const [includeEnd, setIncludeEnd] = useState(false);
  const [weekends, setWeekends] = useState(false);

  const a = from ? new Date(`${from}T00:00:00`) : null;
  const b = to ? new Date(`${to}T00:00:00`) : null;
  const valid = a && b && !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime());
  const [start, end] = valid && a > b ? [b, a] : [a, b];

  let days = 0; let breakdown = { y: 0, m: 0, d: 0 };
  if (valid) {
    days = Math.round((end - start) / 86400000) + (includeEnd ? 1 : 0);
    let y = end.getFullYear() - start.getFullYear();
    let m = end.getMonth() - start.getMonth();
    let d = end.getDate() - start.getDate();
    if (d < 0) { m -= 1; d += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
    if (m < 0) { y -= 1; m += 12; }
    breakdown = { y, m, d };
  }

  const work = valid ? businessDays(start, end, includeEnd) : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={CalendarRange} title="Date Difference" desc="Count the days, weeks and working days between two dates." />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
        <Field label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Include the end date" checked={includeEnd} onChange={setIncludeEnd} />
        <ToggleRow label="Working days only (Mon–Fri)" checked={weekends} onChange={setWeekends} />
      </div>
      {valid ? (
        <>
          <Panel className="text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{weekends ? 'Working days' : 'Total days'}</div>
            <div className="font-display text-4xl font-bold tabular-nums text-cyan-j">{(weekends ? work : days).toLocaleString()}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {start.toLocaleDateString()} → {end.toLocaleDateString()}
            </div>
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Weeks" value={(days / 7).toFixed(2)} />
            <Stat label="Months (approx)" value={(days / 30.44).toFixed(2)} />
            <Stat label="Years (approx)" value={(days / 365.25).toFixed(3)} />
            <Stat label="Hours" value={(days * 24).toLocaleString()} />
            <Stat label="Calendar span" value={`${breakdown.y}y ${breakdown.m}m ${breakdown.d}d`} />
            <Stat label="Working days" value={String(work)} />
            <Stat label="Weekend days" value={String(days - work)} />
            <Stat label="Weeks & days" value={`${Math.floor(days / 7)}w ${days % 7}d`} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="From (weekday)" value={start.toLocaleDateString(undefined, { weekday: 'long' })} />
            <Stat label="To (weekday)" value={end.toLocaleDateString(undefined, { weekday: 'long' })} />
            <Stat label="Direction" value={a > b ? 'Reversed (auto-corrected)' : 'Forward'} />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Pick two valid dates.</div>
      )}
    </div>
  );
}