import { useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PRESETS = {
  'four-on-four': { label: '4 on, 4 off', pattern: 'DDDD OOOO' },
  'two-two-three': { label: '2 days, 2 nights, 4 off', pattern: 'DD NN OOOO' },
  'three-three-three': { label: '3 on, 3 off, 3 on, 3 off', pattern: 'DDD OOO NNN OOO' },
  panama: { label: 'Panama 2-2-3', pattern: 'DD OO NNN OO DDD OO NN OO' },
  weekdays: { label: 'Five days, two off', pattern: 'DDDDD OO' },
  'seven-seven': { label: '7 on, 7 off', pattern: 'DDDDDDD OOOOOOO' },
  'twelve-hour': { label: 'Two days, two nights, four off', pattern: 'D D N N O O O O' },
};

const CODES = {
  D: { label: 'Day', colour: 'bg-amber-400/25 text-amber-200 border-amber-400/50' },
  N: { label: 'Night', colour: 'bg-indigo-400/25 text-indigo-200 border-indigo-400/50' },
  O: { label: 'Off', colour: 'bg-card/40 text-muted-foreground border-border/60' },
  A: { label: 'Annual leave', colour: 'bg-emerald-400/20 text-emerald-200 border-emerald-400/50' },
  S: { label: 'Sick or standby', colour: 'bg-rose-400/20 text-rose-200 border-rose-400/50' },
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const parsePattern = (text) => {
  const tokens = String(text).toUpperCase().replace(/[^DNSAO]/g, '').split('');
  return tokens.length ? tokens : ['D'];
};

const startOfWeek = (date) => {
  const copy = new Date(date.getTime());
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

export default function ShiftPlanner() {
  const [pattern, setPattern] = useState('DD NN OOOO');
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [weeks, setWeeks] = useState('8');
  const [hours, setHours] = useState({ day: '12', night: '12', off: '0' });
  const [rate, setRate] = useState('22');
  const [nightPremium, setNightPremium] = useState('20');
  const [overtime, setOvertime] = useState('1');

  const result = useMemo(() => {
    const cycle = parsePattern(pattern);
    const startDate = new Date(start);
    const valid = !Number.isNaN(startDate.getTime());
    const weekCount = Math.max(1, Math.min(52, Number(weeks) || 1));
    const first = valid ? startOfWeek(startDate) : startOfWeek(new Date());

    const days = [];
    for (let index = 0; index < weekCount * 7; index += 1) {
      const date = new Date(first.getTime());
      date.setDate(first.getDate() + index);
      const offset = valid ? Math.round((date - startDate) / 86400000) : 0;
      const code = cycle[((offset % cycle.length) + cycle.length) % cycle.length];
      days.push({ date, code, weekend: date.getDay() === 0 || date.getDay() === 6 });
    }

    const grid = [];
    for (let week = 0; week < weekCount; week += 1) {
      grid.push(days.slice(week * 7, week * 7 + 7));
    }

    const counts = days.reduce((totals, day) => {
      totals[day.code] = (totals[day.code] || 0) + 1;
      if (day.weekend && day.code !== 'O') totals.weekendWorked = (totals.weekendWorked || 0) + 1;
      return totals;
    }, { weekendWorked: 0 });

    const dayHours = Number(hours.day) || 0;
    const nightHours = Number(hours.night) || 0;
    const offHours = Number(hours.off) || 0;
    const totalHours = (counts.D || 0) * dayHours + (counts.N || 0) * nightHours + ((counts.A || 0) + (counts.S || 0) + (counts.O || 0)) * offHours;
    const baseRate = Number(rate) || 0;
    const premium = baseRate * (Number(nightPremium) || 0) / 100;
    const gross = (counts.D || 0) * dayHours * baseRate
      + (counts.N || 0) * nightHours * (baseRate + premium)
      + (counts.A || 0) * dayHours * baseRate;
    const weeksPerYear = 52 / weekCount;
    const annualHours = totalHours * weeksPerYear;
    const annualGross = gross * weeksPerYear;
    const nightShare = days.length ? ((counts.N || 0) / days.length) * 100 : 0;

    const upcoming = days.filter((day) => day.code !== 'O' && day.date >= new Date()).slice(0, 6);

    return {
      cycle, days, grid, counts, totalHours, gross, baseRate, premium, annualHours, annualGross,
      nightShare, upcoming, dayHours, nightHours, weekCount,
      weekendShare: ((counts.weekendWorked || 0) / (days.filter((day) => day.weekend).length || 1)) * 100,
      overtimeRate: baseRate * (1 + (Number(overtime) || 1)) * 1,
    };
  }, [pattern, start, weeks, hours, rate, nightPremium, overtime]);

  const report = useMemo(() => [
    'Pattern: ' + pattern + ' (' + result.cycle.length + ' day cycle)',
    'Starting ' + start + ' for ' + result.weekCount + ' weeks',
    '',
    'Day shifts ' + (result.counts.D || 0) + ' · nights ' + (result.counts.N || 0) + ' · off ' + (result.counts.O || 0) + ' · leave ' + (result.counts.A || 0),
    'Weekend days worked: ' + (result.counts.weekendWorked || 0),
    'Total hours in this window: ' + result.totalHours.toFixed(1),
    'Estimated gross pay: ' + result.gross.toFixed(2),
    '',
    'Projected a year: ' + result.annualHours.toFixed(0) + ' hours, ' + result.annualGross.toFixed(0) + ' gross',
    '',
    ...result.upcoming.map((day) => day.date.toDateString() + ' — ' + (CODES[day.code] ? CODES[day.code].label : day.code)),
  ].join('\n'), [result, pattern, start]);

  return (
    <ToolShell
      toolId="shift-planner"
      icon={CalendarClock}
      title="Shift Pattern Planner"
      desc="Turn a rotating shift pattern into a real calendar — counts of days, nights, weekends and hours, with an earnings estimate and the next shifts listed out."
      state={{ pattern, start, weeks, hours, rate, nightPremium, overtime }}
      onRestore={(restored) => {
        if (typeof restored.pattern === 'string') setPattern(restored.pattern);
        if (typeof restored.start === 'string') setStart(restored.start);
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
        if (restored.hours) setHours((current) => ({ ...current, ...restored.hours }));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.nightPremium !== undefined) setNightPremium(String(restored.nightPremium));
        if (restored.overtime !== undefined) setOvertime(String(restored.overtime));
      }}
      exportText={report}
      exportName="shift-pattern.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPattern(preset.pattern)}
            className={preset.pattern === pattern
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:text-foreground'}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Pattern — D day, N night, O off, A leave">
          <input value={pattern} onChange={(e) => setPattern(e.target.value)} spellCheck={false} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
        </Field>
        <Field label="Pattern starts on"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Weeks to show"><input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Day shift hours"><input value={hours.day} onChange={(e) => setHours((current) => ({ ...current, day: e.target.value }))} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Night shift hours"><input value={hours.night} onChange={(e) => setHours((current) => ({ ...current, night: e.target.value }))} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Pay per hour"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Night premium, %"><input value={nightPremium} onChange={(e) => setNightPremium(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Overtime multiplier"><input value={overtime} onChange={(e) => setOvertime(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Gross for ' + result.weekCount + ' weeks'}
          value={result.gross.toFixed(0)}
          sub={result.totalHours.toFixed(0) + ' hours · ' + (result.counts.D || 0) + ' day shifts, ' + (result.counts.N || 0) + ' nights, ' + (result.counts.O || 0) + ' off days. Nights carry a ' + nightPremium + '% premium here.'}
        />
        <Ring
          value={result.nightShare}
          max={100}
          label="Share of nights"
          sub={result.nightShare.toFixed(0) + '% of days in this window are night shifts — worth watching for fatigue, not just for pay'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The rota, week by week</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">cycle of {result.cycle.length} days</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Week</th>
                {DAY_LABELS.map((day) => <th key={day} className="py-1 text-center font-medium">{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.grid.map((week, index) => (
                <tr key={index} className="border-t border-border/50">
                  <td className="py-1 font-mono-j text-muted-foreground">{week[0].date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}</td>
                  {week.map((day) => {
                    const code = CODES[day.code] || CODES.O;
                    return (
                      <td key={day.date.toISOString()} className="py-1 text-center">
                        <div className={'mx-auto w-9 rounded-md border px-1 py-1 font-mono-j text-[10px] ' + code.colour}>{day.code}</div>
                        <div className="mt-0.5 font-mono-j text-[9px] text-muted-foreground">{day.date.getDate()}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(CODES).map(([key, code]) => (
            <span key={key} className={'rounded-md border px-2 py-0.5 text-[10px] ' + code.colour}>{key} · {code.label}</span>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Next shifts</div>
          {result.upcoming.length ? (
            <div className="space-y-1.5">
              {result.upcoming.map((day) => (
                <div key={day.date.toISOString()} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                  <span>{day.date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                  <span className="font-mono-j text-cyan-j">{CODES[day.code] ? CODES[day.code].label : day.code}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No upcoming shifts in this window.</p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Only working days are listed, so the next stretch of shifts is easy to read off without scanning the whole grid.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Counts and pay</span>
            <CopyBtn value={report} label="Copy the plan" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Day shifts</span><span>{result.counts.D || 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Night shifts</span><span>{result.counts.N || 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Off days</span><span>{result.counts.O || 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Leave days</span><span>{result.counts.A || 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Weekend days worked</span><span>{result.counts.weekendWorked || 0}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Hours in window</span><span>{result.totalHours.toFixed(1)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Night premium per hour</span><span>{result.premium.toFixed(2)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Overtime rate</span><span>{result.overtimeRate.toFixed(2)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Gross for the window</span><span className="text-cyan-j">{result.gross.toFixed(2)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Projected a year</span><span className="text-cyan-j">{result.annualGross.toFixed(0)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Planning around a rotating pattern</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Count the weekends first — {result.counts.weekendWorked || 0} in this window, {result.weekendShare.toFixed(0)}% of the weekend days available.</p>
            <p>· A cycle length that is a multiple of seven keeps the same weekdays every week; anything else rotates, which is fairer but harder to plan around.</p>
            <p>· Set the start date to the real first day of a rotation. Getting it one day out shifts every subsequent shift.</p>
            <p>· Night premiums move the number more than most people expect at this night share, so check the gross against a payslip before relying on it.</p>
            <p>· Plan leave against the off blocks, not against the days you feel like. A week of leave placed after four off days buys nine days away.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why patterns are built the way they are</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Forward rotation — days then nights — is easier on the body than shifting backwards through the clock.</p>
            <p>· Blocks of two or three nights balance coverage against recovery; single nights are widely disliked because the day before and after are both lost.</p>
            <p>· Four or more off days after a night block is the usual recovery allowance in continuous-coverage rotas.</p>
            <p>· Patterns that give whole weekends off occasionally are the ones that last; every-weekend coverage is the main reason staff leave shift work.</p>
            <p>· Fatigue accumulates across a run of nights even when each one is legal, which is why rest days are counted in the pattern rather than treated as spare capacity.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Cycle', value: result.cycle.length + ' days' },
                { label: 'Nights', value: String(result.counts.N || 0) },
                { label: 'Hours', value: result.totalHours.toFixed(0) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Cycle" value={result.cycle.length + ' days'} mono sub={pattern} />
        <Stat label="Shifts worked" value={String((result.counts.D || 0) + (result.counts.N || 0) + (result.counts.A || 0))} mono sub={'of ' + result.days.length + ' days'} />
        <Stat label="Hours" value={result.totalHours.toFixed(0)} mono sub="in this window" />
        <Stat label="Gross" value={result.gross.toFixed(0)} mono sub={result.weekCount + ' weeks'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reading the grid</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Each cell shows the shift code and the date underneath, with the week beginning on Monday.</p>
          <p>· The pattern repeats from the start date, so day one of the grid is the first day of the cycle as written.</p>
          <p>· Change the pattern text and the whole rota redraws — spaces are ignored, so you can write DDNNOOOO or DD NN OOOO.</p>
          <p>· A and S stand for leave and sick or standby; they count as non-working days in the totals but are shown separately so you can see where they fall.</p>
        </div>
        <div className="mt-2">
          <Seg value="D" onChange={() => {}} options={[{ value: 'D', label: 'Codes: D day · N night · O off · A leave · S standby' }]} />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The rota is generated by walking forward from the start date and cycling through the pattern, so any cycle length works and the alignment stays true
          however many weeks you project. Counts, hours and pay are derived from that same walk rather than from the pattern text alone.
        </p>
      </Panel>
    </ToolShell>
  );
}