import { useMemo, useState } from 'react';
import { Dumbbell } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const FORMULAS = {
  epley: (w, r) => w * (1 + r / 30),
  brzycki: (w, r) => w * (36 / (37 - r)),
  lombardi: (w, r) => w * r ** 0.1,
  lander: (w, r) => (100 * w) / (101.3 - 2.67123 * r),
};

export default function OneRepMax() {
  const [weight, setWeight] = useState('80');
  const [reps, setReps] = useState('5');
  const [units, setUnits] = useState('kg');
  const [barWeight, setBarWeight] = useState('20');
  const [plates, setPlates] = useState('25,20,15,10,5,2.5,1.25');

  const result = useMemo(() => {
    const w = Number(weight) || 0;
    const r = Math.max(1, Math.min(20, Number(reps) || 1));
    const estimates = Object.entries(FORMULAS).map(([key, fn]) => {
      let value = fn(w, r);
      if (!Number.isFinite(value) || value <= 0 || value > w * 3) value = w;
      return { key, value };
    });
    const average = estimates.reduce((sum, e) => sum + e.value, 0) / (estimates.length || 1);
    const rounded = Math.round(average / 2.5) * 2.5;
    return { estimates, average, rounded, oneRm: r === 1 ? w : rounded };
  }, [weight, reps]);

  const loading = useMemo(() => {
    const bar = Number(barWeight) || 0;
    const available = String(plates).split(',').map((p) => Number(p.trim())).filter((p) => p > 0).sort((a, b) => b - a);
    const results = [];
    [1, 0.9, 0.85, 0.8, 0.75, 0.7].forEach((percent) => {
      let target = result.oneRm * percent;
      target = Math.round(target / 2.5) * 2.5;
      let perSide = (target - bar) / 2;
      const chosen = [];
      available.forEach((plate) => {
        while (perSide >= plate - 1e-6) {
          chosen.push(plate);
          perSide -= plate;
        }
      });
      const actual = bar + chosen.reduce((sum, p) => sum + p, 0) * 2;
      results.push({ percent, target, actual, plates: chosen, achievable: perSide < 1e-6 });
    });
    return results;
  }, [result.oneRm, barWeight, plates]);

  const report = [
    `Estimated 1RM from ${weight} ${units} × ${reps} reps: ${result.oneRm} ${units}`,
    ...result.estimates.map((e) => `${e.key}: ${e.value.toFixed(1)} ${units}`),
    '',
    'Loading:',
    ...loading.map((l) => `${Math.round(l.percent * 100)}% → ${l.actual} ${units} (per side: ${l.plates.join(' + ') || 'bar only'})`),
  ].join('\n');

  return (
    <ToolShell
      toolId="one-rep-max"
      icon={Dumbbell}
      title="One-Rep Max & Plate Loader"
      desc="Estimate your true max from a set you actually did, see what each training percentage weighs, and get the exact plates to load."
      state={{ weight, reps, units, barWeight, plates }}
      onRestore={(restored) => {
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.reps !== undefined) setReps(String(restored.reps));
        if (restored.units) setUnits(restored.units);
        if (restored.barWeight !== undefined) setBarWeight(String(restored.barWeight));
        if (typeof restored.plates === 'string') setPlates(restored.plates);
      }}
      exportText={report}
      exportName="one-rep-max.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'kg', label: 'Kilograms' }, { value: 'lb', label: 'Pounds' }]} />
        <CopyBtn value={report} label="Copy numbers" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Weight lifted (${units})`}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Reps completed" hint="Keep it under 12 — accuracy drops fast beyond that">
          <input value={reps} onChange={(e) => setReps(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Estimated one-rep max</div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{result.oneRm}<span className="text-lg"> {units}</span></div>
        <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">average of four formulas · rounded to the nearest 2.5 {units}</div>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What each formula says</div>
        <div className="space-y-1">
          {result.estimates.map((estimate) => (
            <div key={estimate.key} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="capitalize">{estimate.key}</span>
              <span className="font-mono-j">{estimate.value.toFixed(1)} {units}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Bar weight (${units})`}>
          <input value={barWeight} onChange={(e) => setBarWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Plates you own per side" hint="Comma separated, largest first">
          <input value={plates} onChange={(e) => setPlates(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Training percentages and what to load</div>
        <div className="space-y-1.5">
          {loading.map((row) => (
            <div key={row.percent} className={`rounded-lg border px-2.5 py-2 text-[11px] ${row.percent === 0.9 ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/50 bg-card/40'}`}>
              <div className="flex items-center justify-between">
                <span className="font-medium">{Math.round(row.percent * 100)}% · {row.actual} {units}</span>
                <span className="font-mono-j text-muted-foreground">{row.percent === 0.9 ? 'typical work sets' : row.percent >= 0.9 ? 'heavy singles / doubles' : 'volume work'}</span>
              </div>
              <div className="mt-1 font-mono-j text-muted-foreground">
                {row.plates.length ? `per side: ${row.plates.join(' + ')}` : 'bar only'}{row.achievable ? '' : ' · not exactly reachable with your plates'}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="1RM" value={`${result.oneRm} ${units}`} mono />
        <Stat label="90% work weight" value={`${loading.find((l) => l.percent === 0.9)?.actual ?? '—'} ${units}`} mono />
        <Stat label="Formulas used" value={String(result.estimates.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These formulas get less reliable the further you go from a true single — a set of 3–6 reps gives a much better estimate than a set of 12,
          and high-rep sets flatter some lifters badly. Test a real single only with a spotter and a warm-up, and remember the number is a training
          target, not a trophy.
        </p>
      </Panel>
    </ToolShell>
  );
}