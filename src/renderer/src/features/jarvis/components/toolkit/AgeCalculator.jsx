import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { ToolHeader, Field, Stat, Panel } from './shared';

const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export default function AgeCalculator() {
  const [birth, setBirth] = useState('2000-01-15');
  const b = birth ? new Date(`${birth}T00:00:00`) : null;
  const valid = b && !Number.isNaN(b.getTime()) && b <= new Date();

  let y = 0; let m = 0; let d = 0;
  if (valid) {
    const now = new Date();
    y = now.getFullYear() - b.getFullYear();
    m = now.getMonth() - b.getMonth();
    d = now.getDate() - b.getDate();
    if (d < 0) {
      m -= 1;
      const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
      d += prevMonth;
    }
    if (m < 0) { y -= 1; m += 12; }
  }

  const msDiff = valid ? Date.now() - b.getTime() : 0;
  const totalDays = Math.floor(msDiff / 86400000);
  const nextBirthday = valid ? (() => {
    const today = new Date();
    let next = new Date(today.getFullYear(), b.getMonth(), b.getDate());
    if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) next = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
    return next;
  })() : null;
  const daysToBirthday = nextBirthday ? Math.ceil((nextBirthday - new Date()) / 86400000) : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={CalendarDays} title="Age Calculator" desc="Exact age in years, months and days — plus a live birthday countdown." />
      <Field label="Date of birth">
        <input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>
      {valid ? (
        <>
          <Panel className="text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">You are</div>
            <div className="mt-1 font-display text-3xl font-bold text-cyan-j">{y}<span className="text-base font-medium text-muted-foreground"> yrs </span>{m}<span className="text-base font-medium text-muted-foreground"> mo </span>{d}<span className="text-base font-medium text-muted-foreground"> days</span></div>
            {nextBirthday && (
              <div className="mt-2 text-xs text-muted-foreground">
                Next birthday: {nextBirthday.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })} · in {daysToBirthday} day{daysToBirthday === 1 ? '' : 's'}
              </div>
            )}
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Total days" value={totalDays.toLocaleString()} />
            <Stat label="Total weeks" value={Math.floor(totalDays / 7).toLocaleString()} />
            <Stat label="Total months" value={String(y * 12 + m)} />
            <Stat label="Total hours" value={(totalDays * 24).toLocaleString()} />
            <Stat label="Born on a" value={b.toLocaleDateString(undefined, { weekday: 'long' })} />
            <Stat label="Days to birthday" value={String(daysToBirthday)} />
            <Stat label="Next birthday" value={nextBirthday ? `${nextBirthday.getDate()}/${nextBirthday.getMonth() + 1}` : '—'} />
            <Stat label="Sleeps had" value={`${Math.floor(totalDays * 8 / 24).toLocaleString()} nights`} />
          </div>
          <p className="text-[11px] text-muted-foreground">Calculated from {toISO(b)} to today ({toISO(new Date())}) in your local timezone.</p>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Pick a birth date that is in the past.</div>
      )}
    </div>
  );
}