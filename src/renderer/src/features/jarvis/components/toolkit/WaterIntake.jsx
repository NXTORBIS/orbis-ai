import { useMemo, useState } from 'react';
import { Droplets, Minus, Plus } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CLIMATES = [
  { id: 'cool', label: 'Cool', extra: 0 },
  { id: 'temperate', label: 'Temperate', extra: 0.3 },
  { id: 'hot', label: 'Hot', extra: 0.7 },
  { id: 'veryhot', label: 'Very hot / humid', extra: 1.1 },
];

export default function WaterIntake() {
  const [weight, setWeight] = useState('72');
  const [units, setUnits] = useState('metric');
  const [activity, setActivity] = useState(45);
  const [climate, setClimate] = useState('temperate');
  const [pregnant, setPregnant] = useState(false);
  const [glasses, setGlasses] = useState(0);
  const [glassSize, setGlassSize] = useState('250');

  const result = useMemo(() => {
    const kg = units === 'metric' ? Number(weight) || 0 : (Number(weight) || 0) * 0.45359237;
    const base = kg * 0.033;
    const climateExtra = CLIMATES.find((c) => c.id === climate)?.extra ?? 0;
    const exercise = (activity / 30) * 0.35;
    const pregnancy = pregnant ? 0.4 : 0;
    const litres = Math.max(1.2, base + climateExtra + exercise + pregnancy);
    const size = (Number(glassSize) || 250) / 1000;
    const glassesNeeded = Math.round(litres / size);
    const schedule = [];
    const start = 7;
    const end = 21;
    const span = end - start;
    for (let i = 0; i < glassesNeeded; i += 1) {
      const hour = start + (span * i) / Math.max(1, glassesNeeded - 1);
      const h = Math.floor(hour);
      const m = Math.round((hour - h) * 60 / 15) * 15;
      schedule.push(`${String(m === 60 ? h + 1 : h).padStart(2, '0')}:${m === 60 ? '00' : String(m).padStart(2, '0')}`);
    }
    return { kg, base, litres, glassesNeeded, schedule, progress: Math.min(100, (glasses * size / litres) * 100), consumed: glasses * size };
  }, [weight, units, activity, climate, pregnant, glassSize, glasses]);

  const report = [
    `Target: ${result.litres.toFixed(1)} L a day (${result.glassesNeeded} glasses of ${glassSize} ml)`,
    `Baseline ${result.base.toFixed(1)} L · activity ${activity} min · ${climate} climate${pregnant ? ' · pregnancy +0.4 L' : ''}`,
    '',
    'Suggested times:',
    result.schedule.join(' · '),
  ].join('\n');

  return (
    <ToolShell
      toolId="water-intake"
      icon={Droplets}
      title="Hydration Planner"
      desc="A daily water target built from your body weight, activity, climate and glass size — with a drinking schedule and a tap counter."
      state={{ weight, units, activity, climate, pregnant, glasses, glassSize }}
      onRestore={(restored) => {
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.units) setUnits(restored.units);
        if (restored.activity !== undefined) setActivity(Number(restored.activity));
        if (restored.climate) setClimate(restored.climate);
        if (typeof restored.pregnant === 'boolean') setPregnant(restored.pregnant);
        if (restored.glasses !== undefined) setGlasses(Number(restored.glasses));
        if (restored.glassSize) setGlassSize(String(restored.glassSize));
      }}
      exportText={report}
      exportName="hydration.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'kg' }, { value: 'imperial', label: 'lb' }]} />
        <Seg value={climate} onChange={setClimate} options={CLIMATES.map((c) => ({ value: c.id, label: c.label }))} />
        <CopyBtn value={report} label="Copy plan" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={units === 'metric' ? 'Weight (kg)' : 'Weight (lb)'}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={`Exercise today · ${activity} min`}>
          <input type="range" min={0} max={180} step={5} value={activity} onChange={(e) => setActivity(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Glass size (ml)">
          <Seg value={glassSize} onChange={setGlassSize} options={[{ value: '200', label: '200' }, { value: '250', label: '250' }, { value: '330', label: '330' }, { value: '500', label: '500' }]} />
        </Field>
      </div>

      <button
        type="button"
        onClick={() => setPregnant((p) => !p)}
        className={`w-full rounded-lg border px-3 py-2 text-xs transition ${pregnant ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
      >
        {pregnant ? 'Pregnant or breastfeeding: adding 0.4 L' : 'Not pregnant — tap if you are pregnant or breastfeeding'}
      </button>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Daily target</div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{result.litres.toFixed(1)}<span className="text-lg"> L</span></div>
        <div className="mt-1 text-[11px] text-muted-foreground">{result.glassesNeeded} glasses of {glassSize} ml · baseline {result.base.toFixed(1)} L</div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-border/70 bg-card/60">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-cyan-j transition-[width]" style={{ width: `${result.progress}%` }} />
        </div>
      </div>

      <Panel className="!p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium">Today so far</div>
            <div className="text-[11px] text-muted-foreground">{(Math.round(result.consumed * 100) / 100).toFixed(2)} L of {result.litres.toFixed(1)} L ({Math.round(result.progress)}%)</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setGlasses((g) => Math.max(0, g - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-cyan-j/50">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-10 text-center font-mono-j text-lg">{glasses}</span>
            <button type="button" onClick={() => setGlasses((g) => g + 1)} className="grid h-9 w-9 place-items-center rounded-lg border border-cyan-j/50 bg-cyan-j/10 text-cyan-j transition hover:bg-cyan-j/20">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Suggested drinking times</div>
        <div className="flex flex-wrap gap-1.5">
          {result.schedule.map((time, index) => (
            <span key={`${time}-${index}`} className={`rounded-lg border px-2 py-1 font-mono-j text-[11px] ${index < glasses ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/60 text-muted-foreground'}`}>
              {time}
            </span>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Target" value={`${result.litres.toFixed(1)} L`} mono />
        <Stat label="Glasses" value={String(result.glassesNeeded)} mono />
        <Stat label="Weight used" value={`${Math.round(result.kg)} kg`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The common 8-glasses rule ignores body size entirely; this uses roughly 33 ml per kilogram as a baseline, then adds for sweat, heat and
          pregnancy. Food supplies about a fifth of your water, so treat the target as guidance — and check the colour of your urine: pale straw is on
          track, dark amber means drink. Anyone with kidney or heart conditions should follow their doctor's limit instead.
        </p>
      </Panel>
    </ToolShell>
  );
}