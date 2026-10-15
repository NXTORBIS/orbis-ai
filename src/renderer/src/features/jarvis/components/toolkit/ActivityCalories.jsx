import { useMemo, useState } from 'react';
import { Footprints } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const ACTIVITIES = [
  { id: 'walk-slow', label: 'Walking, casual (4 km/h)', met: 3.0, steps: true },
  { id: 'walk', label: 'Walking, brisk (5.5 km/h)', met: 4.3, steps: true },
  { id: 'hike', label: 'Hiking, hills', met: 6.0, steps: true },
  { id: 'run-easy', label: 'Running, easy (8 km/h)', met: 8.3, steps: true },
  { id: 'run-fast', label: 'Running, fast (12 km/h)', met: 11.8, steps: true },
  { id: 'cycle-easy', label: 'Cycling, easy', met: 6.8 },
  { id: 'cycle-fast', label: 'Cycling, vigorous', met: 10.0 },
  { id: 'swim', label: 'Swimming, laps', met: 8.0 },
  { id: 'weights', label: 'Weight training', met: 5.0 },
  { id: 'yoga', label: 'Yoga', met: 2.5 },
  { id: 'dance', label: 'Dancing', met: 5.0 },
  { id: 'row', label: 'Rowing machine', met: 7.0 },
  { id: 'stairs', label: 'Stair climbing', met: 8.8, steps: true },
  { id: 'house', label: 'Housework, active', met: 3.5 },
];

const STEP_LENGTH = 0.415;

export default function ActivityCalories() {
  const [activity, setActivity] = useState('walk');
  const [minutes, setMinutes] = useState('45');
  const [weight, setWeight] = useState('72');
  const [height, setHeight] = useState('172');
  const [units, setUnits] = useState('metric');
  const [perWeek, setPerWeek] = useState('5');

  const result = useMemo(() => {
    const info = ACTIVITIES.find((item) => item.id === activity) || ACTIVITIES[1];
    const kg = units === 'metric' ? Number(weight) || 0 : (Number(weight) || 0) * 0.45359237;
    const cm = units === 'metric' ? Number(height) || 0 : (Number(height) || 0) * 2.54;
    const duration = Number(minutes) || 0;
    const calories = ((info.met * 3.5 * kg) / 200) * duration;
    const caloriesPerMinute = duration ? calories / duration : 0;
    const stride = (cm * STEP_LENGTH) / 100;
    const speedKmh = info.met > 6 ? (info.met * 1.1) : (info.met * 1.25);
    const distanceKm = (speedKmh * duration) / 60;
    const steps = info.steps ? Math.round((distanceKm * 1000) / Math.max(0.4, stride)) : Math.round((speedKmh * 1000 / 60 / Math.max(0.4, stride)) * duration);
    const weekly = calories * (Number(perWeek) || 0);
    const comparison = ACTIVITIES.map((item) => ({ label: item.label.split(',')[0].slice(0, 9), value: ((item.met * 3.5 * kg) / 200) * duration }));
    return { info, kg, cm, calories, caloriesPerMinute, distanceKm, steps, weekly, stride, comparison };
  }, [activity, minutes, weight, height, units, perWeek]);

  const report = [
    `${result.info.label} for ${minutes} minutes at ${weight} ${units === 'metric' ? 'kg' : 'lb'}`,
    `≈ ${Math.round(result.calories)} kcal (${result.caloriesPerMinute.toFixed(1)} kcal a minute)`,
    `Distance ≈ ${result.distanceKm.toFixed(2)} km · steps ≈ ${result.steps.toLocaleString()}`,
    `Repeated ${perWeek}× a week: ${Math.round(result.weekly).toLocaleString()} kcal, ${(result.distanceKm * Number(perWeek || 0)).toFixed(1)} km a week`,
  ].join('\n');

  return (
    <ToolShell
      toolId="activity"
      icon={Footprints}
      title="Activity & Calorie Calculator"
      desc="Turn any activity into calories, distance and steps — and see how it compares hour for hour with everything else you could do instead."
      state={{ activity, minutes, weight, height, units, perWeek }}
      onRestore={(restored) => {
        if (restored.activity) setActivity(restored.activity);
        if (restored.minutes !== undefined) setMinutes(String(restored.minutes));
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.height !== undefined) setHeight(String(restored.height));
        if (restored.units) setUnits(restored.units);
        if (restored.perWeek !== undefined) setPerWeek(String(restored.perWeek));
      }}
      exportText={report}
      exportName="activity.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'kg / cm' }, { value: 'imperial', label: 'lb / in' }]} />
        <CopyBtn value={report} label="Copy summary" />
      </div>

      <Field label="Activity">
        <select value={activity} onChange={(e) => setActivity(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
          {ACTIVITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Duration (minutes)">
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Body weight (kg)' : 'Body weight (lb)'}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Height (cm)' : 'Height (in)'} hint="Used for stride length and steps">
          <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Times a week">
          <input value={perWeek} onChange={(e) => setPerWeek(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <Field label={`Fine tune the duration · ${minutes} minutes`}>
        <input type="range" min={5} max={180} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label="Calories burned"
          value={Math.round(result.calories).toLocaleString()}
          unit="kcal"
          sub={`${result.caloriesPerMinute.toFixed(1)} a minute · ${result.info.met} MET · ${minutes} minutes of ${result.info.label.toLowerCase()}`}
        />
        <Ring value={result.weekly} max={Math.max(result.weekly, 1)} label="Weekly total at this rate" sub={`${Math.round(result.weekly).toLocaleString()} kcal a week`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Calories" value={`${Math.round(result.calories)} kcal`} mono />
        <Stat label="Distance" value={`${result.distanceKm.toFixed(2)} km`} mono />
        <Stat label="Steps" value={result.steps.toLocaleString()} mono />
        <Stat label="Stride used" value={`${(result.stride * 100).toFixed(0)} cm`} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The same {minutes} minutes, other ways</div>
          <Bars data={result.comparison} format={(value) => Math.round(value).toString()} suffix=" kcal" />
          <p className="mt-2 text-[11px] text-muted-foreground">Calories for your body weight across every activity in the list — useful when choosing between two options.</p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What this number means</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A 500 kcal daily deficit is about 0.5 kg of fat loss a week — but activity is only part of the equation; what you eat dominates it.</p>
            <p>· Roughly a third of the energy from exercise can be compensated by eating more without noticing, which is why tracking beats guessing.</p>
            <p>· {result.steps > 8000 ? `${result.steps.toLocaleString()} steps is comfortably above the 8,000-step mark where mortality benefits plateau in most studies.` : 'Building toward 7,000–8,000 steps a day captures most of the health benefit of walking.'}</p>
            <p>· MET values are averages: fitness, terrain, technique and effort can shift the real figure by 20% either way.</p>
            <p>· At {Number(perWeek) || 0}× a week you would cover {(result.distanceKm * (Number(perWeek) || 0)).toFixed(1)} km and {Math.round(result.weekly).toLocaleString()} kcal weekly.</p>
          </div>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'MET', value: result.info.met },
                { label: 'Weight used', value: `${Math.round(result.kg)} kg` },
                { label: 'Per minute', value: `${result.caloriesPerMinute.toFixed(1)} kcal` },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These figures come from the standard MET formula — one MET is the energy you use sitting still, so a 5 MET activity burns roughly five times
          your resting rate. It is accurate enough for planning and comparison, but it is an estimate rather than a measurement; if a number matters,
          a heart-rate strap or power meter will beat any equation.
        </p>
      </Panel>
    </ToolShell>
  );
}