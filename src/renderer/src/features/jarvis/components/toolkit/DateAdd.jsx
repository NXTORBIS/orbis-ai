import { useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const parse = (value) => (value ? new Date(`${value}T00:00:00`) : null);

const iso = (date) => (date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '');

const addBusinessDays = (date, days) => {
  const result = new Date(date);
  let remaining = Math.abs(days);
  const step = days >= 0 ? 1 : -1;
  while (remaining > 0) {
    result.setDate(result.getDate() + step);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
};

const weekNumber = (date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
};

export default function DateAdd() {
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('30');
  const [unit, setUnit] = useState('days');
  const [direction, setDirection] = useState('add');
  const [businessOnly, setBusinessOnly] = useState(false);
  const [intervalDays, setIntervalDays] = useState('7');
  const [count, setCount] = useState('6');

  const base = parse(start);

  const result = useMemo(() => {
    if (!base || Number.isNaN(base.getTime())) return null;
    const value = (Number(amount) || 0) * (direction === 'add' ? 1 : -1);
    let target;
    if (businessOnly && unit === 'days') {
      target = addBusinessDays(base, value);
    } else {
      target = new Date(base);
      if (unit === 'days') target.setDate(target.getDate() + value);
      if (unit === 'weeks') target.setDate(target.getDate() + value * 7);
      if (unit === 'months') target.setMonth(target.getMonth() + value);
      if (unit === 'years') target.setFullYear(target.getFullYear() + value);
    }
    const days = Math.round((target - base) / 86400000);
    let businessDays = 0;
    const cursor = new Date(Math.min(base.getTime(), target.getTime()));
    const end = new Date(Math.max(base.getTime(), target.getTime()));
    while (cursor < end) {
      cursor.setDate(cursor.getDate() + 1);
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) businessDays += 1;
    }
    return {
      target, days, businessDays,
      weekday: WD[target.getDay()],
      week: weekNumber(target),
      quarter: Math.floor(target.getMonth() / 3) + 1,
      startWeekday: WD[base.getDay()],
    };
  }, [base, amount, unit, direction, businessOnly]);

  const series = useMemo(() => {
    if (!base || Number.isNaN(base.getTime())) return [];
    const step = Math.max(1, Number(intervalDays) || 7);
    return Array.from({ length: Math.min(24, Math.max(1, Number(count) || 6)) }, (_, i) => {
      const date = new Date(base);
      date.setDate(date.getDate() + step * (i + 1));
      return { index: i + 1, date, weekday: WD[date.getDay()] };
    });
  }, [base, intervalDays, count]);

  const report = result
    ? `${iso(base)} (${result.startWeekday}) ${direction === 'add' ? '+' : '−'}${amount} ${unit}${businessOnly && unit === 'days' ? ' business days' : ''} = ${iso(result.target)} (${result.weekday})\nCalendar days: ${result.days} · weekdays crossed: ${result.businessDays}\nWeek ${result.week}, quarter Q${result.quarter}`
    : '';

  return (
    <ToolShell
      toolId="date-add"
      icon={CalendarPlus}
      title="Date Calculator"
      desc="Jump forward or back by days, weeks, months, years or working days — and build a repeating series of dates you can copy straight out."
      state={{ start, amount, unit, direction, businessOnly, intervalDays, count }}
      onRestore={(restored) => {
        if (restored.start) setStart(restored.start);
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (restored.unit) setUnit(restored.unit);
        if (restored.direction) setDirection(restored.direction);
        if (typeof restored.businessOnly === 'boolean') setBusinessOnly(restored.businessOnly);
        if (restored.intervalDays !== undefined) setIntervalDays(String(restored.intervalDays));
        if (restored.count !== undefined) setCount(String(restored.count));
      }}
      exportText={`${report}\n\n${series.map((s) => `${iso(s.date)}\t${s.weekday}\t#${s.index}`).join('\n')}`}
      exportName="dates.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={direction} onChange={setDirection} options={[{ value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }]} />
        <Seg value={unit} onChange={setUnit} options={[{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }, { value: 'years', label: 'Years' }]} />
        <CopyBtn value={report} label="Copy result" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starting date">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={`How many ${unit}`}>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      {unit === 'days' && (
        <button
          type="button"
          onClick={() => setBusinessOnly((b) => !b)}
          className={`w-full rounded-lg border px-3 py-2 text-xs transition ${businessOnly ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
        >
          {businessOnly ? 'Counting working days only — weekends skipped' : 'Counting calendar days — tap for working days only'}
        </button>
      )}

      {result && (
        <>
          <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Resulting date</div>
            <div className="tk-title-glow mt-1 font-mono-j text-3xl font-semibold text-cyan-j">{iso(result.target)}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">{result.weekday} · week {result.week} · Q{result.quarter}</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Starting on" value={result.startWeekday} />
            <Stat label="Calendar days later" value={String(result.days)} mono />
            <Stat label="Weekdays crossed" value={String(result.businessDays)} mono />
            <Stat label="Weeks between" value={(Math.abs(result.days) / 7).toFixed(1)} mono />
          </div>
        </>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Repeating series</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Every N days">
            <input value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="How many dates">
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 space-y-1">
          {series.map((entry) => (
            <div key={entry.index} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
              <span className="text-muted-foreground">#{entry.index}</span>
              <span>{iso(entry.date)}</span>
              <span className="text-muted-foreground">{entry.weekday}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Handy for renewal dates, follow-ups, invoices and syllabus planning. Working-day mode skips weekends but not public holidays, since those
          differ everywhere — check your local calendar for the holidays that matter. Month arithmetic keeps the same day of the month where it
          exists and rolls forward when it does not, which is how billing systems behave.
        </p>
      </Panel>
    </ToolShell>
  );
}