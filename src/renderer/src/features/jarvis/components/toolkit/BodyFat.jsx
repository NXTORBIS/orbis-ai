import { useMemo, useState } from 'react';
import { Dumbbell } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const CATEGORIES = {
  male: [
    { max: 6, label: 'Essential fat' }, { max: 14, label: 'Athletic' }, { max: 18, label: 'Fitness' },
    { max: 25, label: 'Average' }, { max: 100, label: 'Above average' },
  ],
  female: [
    { max: 14, label: 'Essential fat' }, { max: 21, label: 'Athletic' }, { max: 25, label: 'Fitness' },
    { max: 32, label: 'Average' }, { max: 100, label: 'Above average' },
  ],
};

export default function BodyFat() {
  const [sex, setSex] = useState('male');
  const [units, setUnits] = useState('metric');
  const [height, setHeight] = useState('175');
  const [weight, setWeight] = useState('72');
  const [neck, setNeck] = useState('38');
  const [waist, setWaist] = useState('84');
  const [hip, setHip] = useState('96');

  const toCm = (value) => (units === 'imperial' ? (Number(value) || 0) * 2.54 : Number(value) || 0);
  const toKg = (value) => (units === 'imperial' ? (Number(value) || 0) * 0.45359237 : Number(value) || 0);

  const result = useMemo(() => {
    const h = toCm(height);
    const w = toKg(weight);
    const n = toCm(neck);
    const waistCm = toCm(waist);
    const hipCm = toCm(hip);
    if (!h || !n || !waistCm) return null;
    let bodyFat;
    if (sex === 'male') {
      const diff = waistCm - n;
      if (diff <= 0) return { error: 'The waist measurement needs to be larger than the neck measurement.' };
      bodyFat = 495 / (1.0324 - 0.19077 * Math.log10(diff) + 0.15456 * Math.log10(h)) - 450;
    } else {
      const sum = waistCm + hipCm - n;
      if (sum <= 0) return { error: 'Check the waist, hip and neck measurements — they add up to a negative value.' };
      bodyFat = 495 / (1.29579 - 0.35004 * Math.log10(sum) + 0.22100 * Math.log10(h)) - 450;
    }
    bodyFat = Math.max(2, Math.min(70, bodyFat));
    const fatMass = w ? (bodyFat / 100) * w : 0;
    const leanMass = w ? w - fatMass : 0;
    const bmi = h && w ? w / (h / 100) ** 2 : 0;
    const category = (CATEGORIES[sex].find((c) => bodyFat <= c.max) || CATEGORIES[sex][CATEGORIES[sex].length - 1]).label;
    const healthyMax = sex === 'male' ? 20 : 27;
    const targetWeight = bodyFat > healthyMax && w ? ((leanMass) / (1 - healthyMax / 100)) : w;
    return { bodyFat, fatMass, leanMass, bmi, category, healthyMax, targetWeight, toLose: Math.max(0, w - targetWeight) };
  }, [sex, units, height, weight, neck, waist, hip]);

  const report = result && !result.error
    ? `Body fat (US Navy method): ${result.bodyFat.toFixed(1)}%\nCategory: ${result.category}\nFat mass: ${result.fatMass.toFixed(1)} kg\nLean mass: ${result.leanMass.toFixed(1)} kg\nBMI: ${result.bmi.toFixed(1)}\nWeight to reach ${result.healthyMax}%: ${result.targetWeight.toFixed(1)} kg (${result.toLose.toFixed(1)} kg down)`
    : '';

  return (
    <ToolShell
      toolId="body-fat"
      icon={Dumbbell}
      title="Body Fat & Lean Mass"
      desc="Estimate body fat from a tape measure with the US Navy method, then see fat mass, lean mass and a realistic target weight."
      state={{ sex, units, height, weight, neck, waist, hip }}
      onRestore={(restored) => {
        if (restored.sex) setSex(restored.sex);
        if (restored.units) setUnits(restored.units);
        if (restored.height !== undefined) setHeight(String(restored.height));
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.neck !== undefined) setNeck(String(restored.neck));
        if (restored.waist !== undefined) setWaist(String(restored.waist));
        if (restored.hip !== undefined) setHip(String(restored.hip));
      }}
      exportText={report}
      exportName="body-fat.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'cm / kg' }, { value: 'imperial', label: 'in / lb' }]} />
        <CopyBtn value={report} label="Copy summary" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={units === 'metric' ? 'Height (cm)' : 'Height (in)'}>
          <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Weight (kg)' : 'Weight (lb)'}>
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Neck (cm)' : 'Neck (in)'} hint="below the larynx, tape level">
          <input value={neck} onChange={(e) => setNeck(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Waist (cm)' : 'Waist (in)'} hint="at the navel, relaxed">
          <input value={waist} onChange={(e) => setWaist(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        {sex === 'female' && (
          <Field label={units === 'metric' ? 'Hips (cm)' : 'Hips (in)'} hint="widest point">
            <input value={hip} onChange={(e) => setHip(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        )}
      </div>

      {result?.error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{result.error}</Panel>}

      {result && !result.error && (
        <>
          <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Estimated body fat</div>
            <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{result.bodyFat.toFixed(1)}<span className="text-xl">%</span></div>
            <div className="mt-1 text-[11px] text-muted-foreground">{result.category} range · healthy ceiling about {result.healthyMax}%</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Fat mass" value={`${result.fatMass.toFixed(1)} kg`} mono />
            <Stat label="Lean mass" value={`${result.leanMass.toFixed(1)} kg`} mono />
            <Stat label="BMI" value={result.bmi.toFixed(1)} mono />
            <Stat label="Target weight" value={`${result.targetWeight.toFixed(1)} kg`} sub={result.toLose > 0.2 ? `${result.toLose.toFixed(1)} kg to go` : 'already in range'} mono />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Where {result.bodyFat.toFixed(1)}% sits</div>
            <div className="space-y-1">
              {CATEGORIES[sex].map((band, index) => {
                const lower = index === 0 ? 0 : CATEGORIES[sex][index - 1].max;
                const active = result.bodyFat > lower && result.bodyFat <= band.max;
                return (
                  <div key={band.label} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${active ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/50 bg-card/40 text-muted-foreground'}`}>
                    <span>{band.label}</span>
                    <span className="font-mono-j">{index === 0 ? `< ${band.max}%` : `${lower}–${band.max}%`}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
        </>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Measure first thing in the morning, tape snug but not compressing the skin, and keep the same spot each time so the trend is comparable.
          This is an estimate with roughly ±3% accuracy — excellent for tracking direction over months, less useful as an absolute number. Muscle
          weighs more than fat, so a strength-training block can hold your weight steady while this figure drops.
        </p>
      </Panel>
    </ToolShell>
  );
}