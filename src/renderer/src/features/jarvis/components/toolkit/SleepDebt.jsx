import { useMemo, useState } from 'react';
import { Moon } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function SleepDebt() {
  const [hours, setHours] = useState(['7', '6.5', '5.5', '7.5', '6', '8', '7']);
  const [target, setTarget] = useState('8');
  const [wakeTime, setWakeTime] = useState('07:00');
  const [units, setUnits] = useState('hours');

  const result = useMemo(() => {
    const values = hours.map((value) => Number(value) || 0);
    const goal = Number(target) || 8;
    const total = values.reduce((sum, value) => sum + value, 0);
    const average = total / values.length;
    const debt = Math.max(0, values.reduce((sum, value) => sum + Math.max(0, goal - value), 0));
    const surplus = Math.max(0, values.reduce((sum, value) => sum + Math.max(0, value - goal), 0));
    const worst = Math.min(...values);
    const best = Math.max(...values);
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const consistency = Math.max(0, 100 - (stdDev / (goal || 1)) * 250);
    const shortfallNights = values.filter((value) => value < goal - 0.25).length;
    const recoveryNights = debt > 0 ? Math.max(1, Math.ceil(debt / 1.5)) : 0;
    const napMinutes = debt > 0 ? Math.min(45, Math.round((debt * 60) / Math.max(1, recoveryNights))) : 0;
    const score = Math.max(0, Math.min(100, Math.round(consistency * 0.55 + Math.min(100, (average / (goal || 8)) * 100) * 0.45)));
    return { values, goal, total, average, debt, surplus, worst, best, stdDev, consistency, shortfallNights, recoveryNights, napMinutes, score };
  }, [hours, target]);

  const setHour = (index, value) => setHours((current) => current.map((entry, i) => (i === index ? value : entry)));

  const plan = useMemo(() => {
    const [h, m] = wakeTime.split(':').map(Number);
    const cycles = [4, 5, 6];
    return cycles.map((cycle) => {
      const minutes = cycle * 90 + 15;
      const totalMinutes = h * 60 + m - minutes;
      const hour = Math.floor(((totalMinutes % 1440) + 1440) % 1440 / 60);
      const minute = ((totalMinutes % 60) + 60) % 60;
      return { cycle, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, hours: cycle * 1.5 };
    });
  }, [wakeTime]);

  const report = [
    `Target ${target} hours · average ${result.average.toFixed(1)} hours this week`,
    `Sleep debt: ${result.debt.toFixed(1)} hours across ${result.shortfallNights} short night(s)`,
    `Range ${result.worst}–${result.best} hours · consistency ${Math.round(result.consistency)}%`,
    result.debt > 0
      ? `Recovery: add about ${(result.debt / Math.max(1, result.recoveryNights)).toFixed(1)} hours a night for ${result.recoveryNights} nights, or a ${result.napMinutes}-minute early-afternoon nap`
      : 'No debt — you are sleeping at or above target',
    '',
    ...DAYS.map((day, index) => `${day}: ${hours[index]} h`),
  ].join('\n');

  return (
    <ToolShell
      toolId="sleep-debt"
      icon={Moon}
      title="Sleep Debt Tracker"
      desc="Log a week of sleep and see the debt, your consistency, and the most efficient way to pay it back — including exact bedtimes."
      state={{ hours, target, wakeTime, units }}
      onRestore={(restored) => {
        if (Array.isArray(restored.hours) && restored.hours.length === 7) setHours(restored.hours);
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (restored.wakeTime) setWakeTime(restored.wakeTime);
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="sleep-week.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'hours', label: 'Hours' }, { value: 'hm', label: 'Hours + minutes' }]} />
        <CopyBtn value={report} label="Copy week" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Hours slept each night</div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {DAYS.map((day, index) => (
            <div key={day} className={`rounded-lg border p-2 ${Number(hours[index]) >= Number(target) ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border/60 bg-card/40'}`}>
              <div className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">{day}</div>
              <input
                value={hours[index]}
                onChange={(e) => setHour(index, e.target.value)}
                inputMode="decimal"
                className="mt-1 h-8 w-full rounded-md border border-input bg-transparent px-1 text-center font-mono-j text-sm"
              />
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Target sleep each night · ${target} hours`}>
          <input type="range" min={5} max={11} step={0.25} value={target} onChange={(e) => setTarget(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Usual wake-up time" hint="Used to work out exact bedtimes">
          <input type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          tone={result.debt > 0 ? 'amber' : 'emerald'}
          label={result.debt > 0 ? 'Sleep debt this week' : 'Fully rested'}
          value={result.debt > 0 ? `${result.debt.toFixed(1)}` : '0'}
          unit={result.debt > 0 ? 'hours' : undefined}
          sub={`averaging ${result.average.toFixed(1)} of your ${target} hour target · ${result.shortfallNights} short night${result.shortfallNights === 1 ? '' : 's'}`}
        />
        <Gauge
          value={result.score}
          min={0}
          max={100}
          label="Sleep health score"
          bands={[
            { label: 'Needs work', min: 0, max: 60, stroke: 'hsl(350 89% 60%)' },
            { label: 'Fair', min: 60, max: 80, stroke: 'hsl(38 92% 55%)' },
            { label: 'Good', min: 80, max: 100, stroke: 'hsl(160 84% 52%)' },
          ]}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Weekly average" value={`${result.average.toFixed(1)} h`} mono />
        <Stat label="Range" value={`${result.worst}–${result.best} h`} mono />
        <Stat label="Consistency" value={`${Math.round(result.consistency)}%`} mono sub={`±${result.stdDev.toFixed(1)} h`} />
        <Stat label="Nights on target" value={`${7 - result.shortfallNights}/7`} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Your week against the target</div>
          <Bars data={DAYS.map((day, index) => ({ label: day, value: Number(hours[index]) || 0, tone: Number(hours[index]) < Number(target) ? 'rose' : undefined }))} format={(value) => value.toFixed(1)} suffix=" h" />
          <p className="mt-2 text-[11px] text-muted-foreground">Rose bars are nights below target — those are what build the debt.</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Pay it back efficiently</div>
          {result.debt > 0 ? (
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Add roughly {(result.debt / Math.max(1, result.recoveryNights)).toFixed(1)} hours a night for {result.recoveryNights} night{result.recoveryNights === 1 ? '' : 's'} — spreading it works far better than one long lie-in.</p>
              <p>· A {result.napMinutes}-minute nap between 1pm and 3pm takes the edge off without disturbing the night.</p>
              <p>· Going to bed 30 minutes earlier is easier to sustain than it sounds, and it removes about {(0.5 * 7).toFixed(1)} hours of debt a week.</p>
              <p>· Do not try to erase it in one weekend: sleeping four hours past your usual wake time shifts your body clock later and makes Monday harder.</p>
            </div>
          ) : (
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· No debt this week — you averaged {result.average.toFixed(1)} hours against a {target} hour target.</p>
              <p>· Your {Math.round(result.consistency)}% consistency is {result.consistency > 85 ? 'excellent — a steady schedule is worth more than a long one' : 'the thing to improve next: aim for a wake-up time that varies by less than an hour'}. </p>
              <p>· Keep the same wake time at weekends; that is what protects the weekdays.</p>
            </div>
          )}
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Debt', value: `${result.debt.toFixed(1)} h`, tone: result.debt > 4 ? 'amber' : undefined },
                { label: 'Surplus', value: `${result.surplus.toFixed(1)} h` },
                { label: 'Total slept', value: `${result.total.toFixed(1)} h` },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Bedtimes that land on a full sleep cycle</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {plan.map((option) => (
            <div key={option.cycle} className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-3 py-2 text-center">
              <div className="font-mono-j text-xl text-cyan-j">{option.time}</div>
              <div className="text-[10px] text-muted-foreground">{option.cycle} cycles · about {option.hours} hours asleep</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Based on a {(15)} minute average to fall asleep and 90-minute cycles — waking between cycles rather than mid-way through one is what stops that
          groggy feeling.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Sleep debt is real but not precisely countable: the body repays it at a limited rate, roughly an hour a night, and consistently short sleep
          harms attention long before it feels bad. Consistency matters as much as duration — an eight-hour average built from fours and twelves is
          worse than seven steady hours. Persistent insomnia or daytime sleepiness is worth a conversation with a doctor.
        </p>
      </Panel>
    </ToolShell>
  );
}