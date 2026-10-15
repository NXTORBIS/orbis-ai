import { useMemo, useState } from 'react';
import { Dumbbell } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const GOALS = {
  strength: {
    label: 'Strength',
    days: {
      3: [
        { name: 'Heavy', sets: 5, reps: 5, percent: 0.85 },
        { name: 'Volume', sets: 4, reps: 6, percent: 0.75 },
        { name: 'Speed', sets: 6, reps: 3, percent: 0.7 },
      ],
      4: [
        { name: 'Heavy', sets: 5, reps: 4, percent: 0.87 },
        { name: 'Volume', sets: 4, reps: 6, percent: 0.75 },
        { name: 'Technique', sets: 5, reps: 5, percent: 0.7 },
        { name: 'Heavy', sets: 3, reps: 3, percent: 0.9 },
      ],
    },
  },
  hypertrophy: {
    label: 'Muscle',
    days: {
      3: [
        { name: 'Heavy-ish', sets: 4, reps: 8, percent: 0.72 },
        { name: 'Volume', sets: 4, reps: 10, percent: 0.65 },
        { name: 'Pump', sets: 3, reps: 12, percent: 0.6 },
      ],
      4: [
        { name: 'Heavy-ish', sets: 4, reps: 8, percent: 0.72 },
        { name: 'Volume', sets: 4, reps: 10, percent: 0.65 },
        { name: 'Volume', sets: 5, reps: 10, percent: 0.62 },
        { name: 'Pump', sets: 3, reps: 12, percent: 0.58 },
      ],
    },
  },
  endurance: {
    label: 'Endurance',
    days: {
      3: [
        { name: 'Sets', sets: 3, reps: 15, percent: 0.55 },
        { name: 'Sets', sets: 4, reps: 15, percent: 0.5 },
        { name: 'Burn', sets: 3, reps: 20, percent: 0.45 },
      ],
      4: [
        { name: 'Sets', sets: 3, reps: 15, percent: 0.55 },
        { name: 'Sets', sets: 4, reps: 15, percent: 0.5 },
        { name: 'Burn', sets: 3, reps: 20, percent: 0.45 },
        { name: 'Light', sets: 3, reps: 18, percent: 0.48 },
      ],
    },
  },
};

const roundTo = (value, step) => Math.round(value / step) * step;

export default function WorkoutPlan() {
  const [lift, setLift] = useState('Back squat');
  const [oneRm, setOneRm] = useState('120');
  const [goal, setGoal] = useState('strength');
  const [weeks, setWeeks] = useState('4');
  const [days, setDays] = useState('3');
  const [increment, setIncrement] = useState('2.5');
  const [rounding, setRounding] = useState('2.5');
  const [warmup, setWarmup] = useState(true);
  const [units, setUnits] = useState('kg');

  const plan = useMemo(() => {
    const max = Number(oneRm) || 0;
    const step = Number(rounding) || 2.5;
    const sessions = GOALS[goal].days[Number(days) === 4 ? 4 : 3];
    const weekCount = Number(weeks) || 4;
    const bump = Number(increment) || 0;

    const schedule = [];
    for (let week = 1; week <= weekCount; week += 1) {
      const isDeload = weekCount > 3 && week === weekCount;
      const weekBump = (week - 1) * bump;
      const sessionsForWeek = sessions.map((session, index) => {
        const percent = isDeload ? 0.55 + index * 0.03 : session.percent;
        const target = max + weekBump;
        return {
          name: session.name,
          sets: isDeload ? Math.max(2, session.sets - 2) : session.sets,
          reps: session.reps,
          percent: Math.round(percent * 100),
          weight: roundTo(target * percent, step),
        };
      });
      schedule.push({ week, label: isDeload ? `Week ${week} · deload` : `Week ${week}`, sessions: sessionsForWeek, deload: isDeload });
    }

    const warmupSets = warmup
      ? [
          { percent: 40, reps: 8 },
          { percent: 55, reps: 5 },
          { percent: 70, reps: 3 },
          { percent: 80, reps: 2 },
        ].map((set) => ({ ...set, weight: roundTo((max || 0) * (set.percent / 100), step) }))
      : [];

    const volume = schedule.map((week) => ({
      label: `W${week.week}`,
      value: week.sessions.reduce((sum, session) => sum + session.sets * session.reps * session.weight, 0),
    }));

    const totalSets = schedule.reduce((sum, week) => sum + week.sessions.reduce((inner, session) => inner + session.sets, 0), 0);

    return { schedule, warmupSets, volume, totalSets, sessions };
  }, [oneRm, goal, weeks, days, increment, rounding, warmup]);

  const report = [
    `${lift} — ${GOALS[goal].label} plan, ${weeks} weeks × ${days} sessions, training max ${oneRm} ${units}`,
    '',
    ...plan.schedule.flatMap((week) => [
      week.label,
      ...week.sessions.map((session) => `  ${session.name}: ${session.sets} × ${session.reps} @ ${session.percent}% → ${session.weight} ${units}`),
    ]),
    '',
    `Warm-up before work sets: ${plan.warmupSets.map((set) => `${set.weight}${units} × ${set.reps}`).join(', ')}`,
  ].join('\n');

  return (
    <ToolShell
      toolId="workout-plan"
      icon={Dumbbell}
      title="Strength Plan Builder"
      desc="Turn one honest max into a week-by-week percentage plan — warm-ups, work sets, a deload at the end and the volume to expect."
      state={{ lift, oneRm, goal, weeks, days, increment, rounding, warmup, units }}
      onRestore={(restored) => {
        if (typeof restored.lift === 'string') setLift(restored.lift);
        if (restored.oneRm !== undefined) setOneRm(String(restored.oneRm));
        if (restored.goal) setGoal(restored.goal);
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
        if (restored.days !== undefined) setDays(String(restored.days));
        if (restored.increment !== undefined) setIncrement(String(restored.increment));
        if (restored.rounding !== undefined) setRounding(String(restored.rounding));
        if (typeof restored.warmup === 'boolean') setWarmup(restored.warmup);
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="training-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={goal} onChange={setGoal} options={Object.entries(GOALS).map(([id, value]) => ({ value: id, label: value.label }))} />
        <Seg value={units} onChange={setUnits} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} />
        <Seg value={days} onChange={setDays} options={[{ value: '3', label: '3 days' }, { value: '4', label: '4 days' }]} />
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Lift">
          <input value={lift} onChange={(e) => setLift(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={`Training max (${units})`} hint="Use a weight you could lift once on a good day, not a lucky one">
          <input value={oneRm} onChange={(e) => setOneRm(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Plan length">
          <Seg value={weeks} onChange={setWeeks} options={[{ value: '4', label: '4 weeks' }, { value: '6', label: '6 weeks' }, { value: '8', label: '8 weeks' }]} />
        </Field>
        <Field label={`Add each week · ${increment} ${units}`}>
          <input type="range" min={0} max={5} step={0.5} value={increment} onChange={(e) => setIncrement(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Round weights to">
          <Seg value={rounding} onChange={setRounding} options={[{ value: '1.25', label: '1.25' }, { value: '2.5', label: '2.5' }, { value: '5', label: '5' }]} />
        </Field>
        <ToggleRow label="Show warm-up ramp" checked={warmup} onChange={setWarmup} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label={`Top set of the block`}
          value={plan.schedule[plan.schedule.length - 1]?.sessions[0]?.weight || 0}
          unit={units}
          sub={`${plan.schedule.flatMap((week) => week.sessions).length} sessions · ${plan.totalSets} work sets · based on ${oneRm} ${units}`}
        />
        <Ring
          value={plan.warmupSets.length}
          max={plan.warmupSets.length || 1}
          tone="violet"
          label="Warm-up ramp before work sets"
          sub={plan.warmupSets.map((set) => `${set.weight}`).join(' · ')}
        />
      </div>

      {!!plan.warmupSets.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Warm-up before every session</div>
          <div className="flex flex-wrap gap-1.5">
            {plan.warmupSets.map((set) => (
              <span key={set.percent} className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-2.5 py-1.5 font-mono-j text-[11px] text-violet-400">
                {set.weight} {units} × {set.reps} <span className="opacity-70">({set.percent}%)</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The plan</div>
        <div className="space-y-3">
          {plan.schedule.map((week) => (
            <div key={week.week} className={`rounded-xl border p-2.5 ${week.deload ? 'border-violet-500/40 bg-violet-500/5' : 'border-border/70 bg-card/40'}`}>
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-xs font-medium ${week.deload ? 'text-violet-400' : ''}`}>{week.label}</span>
                {week.deload && <span className="font-mono-j text-[10px] text-violet-400">back off — this is where progress consolidates</span>}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                {week.sessions.map((session, index) => (
                  <div key={`${week.week}-${index}`} className="rounded-lg border border-border/50 bg-card/50 px-2.5 py-2 text-center">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{session.name}</div>
                    <div className="mt-1 font-mono-j text-lg text-cyan-j">{session.weight}<span className="text-[10px]"> {units}</span></div>
                    <div className="font-mono-j text-[10px] text-muted-foreground">{session.sets} × {session.reps} @ {session.percent}%</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Training volume per week</div>
          <Bars data={plan.volume} format={(value) => Math.round(value).toLocaleString()} />
          <p className="mt-2 text-[11px] text-muted-foreground">Volume here is sets × reps × weight — the deload week visibly drops, which is the point of it.</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How to run it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Rest 3–4 minutes between heavy sets — strength work is about quality, not fatigue.</p>
            <p>· If the top set moves slowly but cleanly, keep the plan; if technique breaks, hold the weight another week rather than forcing the increment.</p>
            <p>· Add {increment} {units} a week only while every rep lands with the same speed. Miss twice in a row and repeat the previous week.</p>
            <p>· {plan.warmupSets.length ? 'The warm-up ramp is deliberately short — it prepares the joints without eating the work sets.' : 'Warm up however you normally would; a couple of ramp sets make the first work set feel far lighter.'}</p>
            <p>· Sleep and protein do more for this plan than any extra set you might add.</p>
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Goal', value: GOALS[goal].label },
                { label: 'Sessions', value: plan.sessions.length },
                { label: 'Work sets', value: plan.totalSets },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Training max" value={`${oneRm} ${units}`} mono />
        <Stat label="Weekly increment" value={`${increment} ${units}`} mono />
        <Stat label="Rounding" value={`${rounding} ${units}`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Percentage plans only work if the max is honest — inflate it by 10% and every heavy set becomes a grinder. If you have only a recent set of
          3–5 reps, that is enough to estimate from; the One-Rep Max tool does that conversion. And a plan is a hypothesis: repeat a week when form
          breaks, and take the deload even when you feel strong.
        </p>
      </Panel>
    </ToolShell>
  );
}