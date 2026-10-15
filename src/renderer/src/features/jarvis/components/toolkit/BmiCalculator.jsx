import { useState } from 'react';
import { Heart } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel } from './shared';

const BANDS = [
  { max: 16, label: 'Severely underweight', tone: 'text-sky-400', bar: 'bg-sky-400' },
  { max: 18.5, label: 'Underweight', tone: 'text-cyan-j', bar: 'bg-cyan-j' },
  { max: 25, label: 'Healthy weight', tone: 'text-green-500', bar: 'bg-green-500' },
  { max: 30, label: 'Overweight', tone: 'text-amber-500', bar: 'bg-amber-500' },
  { max: 100, label: 'Obese', tone: 'text-red-500', bar: 'bg-red-500' },
];

export default function BmiCalculator() {
  const [unit, setUnit] = useState('metric');
  const [cm, setCm] = useState(172);
  const [kg, setKg] = useState(68);
  const [ft, setFt] = useState(5);
  const [inch, setInch] = useState(8);
  const [lb, setLb] = useState(150);

  const heightM = unit === 'metric' ? Number(cm) / 100 : (Number(ft) * 12 + Number(inch)) * 0.0254;
  const weightKg = unit === 'metric' ? Number(kg) : Number(lb) * 0.45359237;
  const bmi = heightM > 0 ? weightKg / (heightM * heightM) : 0;
  const band = BANDS.find((b) => bmi < b.max) || BANDS[BANDS.length - 1];
  const healthyMin = 18.5 * heightM * heightM;
  const healthyMax = 24.9 * heightM * heightM;
  const display = (v) => (unit === 'metric' ? `${v.toFixed(1)} kg` : `${(v / 0.45359237).toFixed(1)} lb`);

  return (
    <div className="space-y-4">
      <ToolHeader icon={Heart} title="BMI Calculator" desc="Body-mass index with your healthy weight range, in metric or imperial." />
      <Seg value={unit} onChange={setUnit} options={[{ value: 'metric', label: 'Metric (cm / kg)' }, { value: 'imperial', label: 'Imperial (ft / lb)' }]} />
      {unit === 'metric' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Height (cm)"><input type="number" value={cm} onChange={(e) => setCm(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Weight (kg)"><input type="number" value={kg} onChange={(e) => setKg(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Height (ft)"><input type="number" value={ft} onChange={(e) => setFt(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Height (in)"><input type="number" value={inch} onChange={(e) => setInch(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Weight (lb)"><input type="number" value={lb} onChange={(e) => setLb(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
      )}
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Your BMI</div>
        <div className="font-display text-4xl font-bold tabular-nums text-cyan-j">{Number.isFinite(bmi) ? bmi.toFixed(1) : '—'}</div>
        <div className={`mt-1 text-sm font-semibold ${band.tone}`}>{band.label}</div>
        <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-secondary">
          <div className={`h-full rounded-full transition-all ${band.bar}`} style={{ width: `${Math.min(100, Math.max(3, ((bmi - 10) / 30) * 100))}%` }} />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>10</span><span>18.5</span><span>25</span><span>30</span><span>40</span></div>
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Healthy min" value={display(healthyMin)} />
        <Stat label="Healthy max" value={display(healthyMax)} />
        <Stat label="To healthy range" value={bmi < 18.5 ? `${display(healthyMin - weightKg)} to gain` : bmi > 24.9 ? `${display(weightKg - healthyMax)} to lose` : 'Already in range'} />
        <Stat label="Height" value={`${heightM.toFixed(2)} m`} />
      </div>
      <p className="text-[11px] text-muted-foreground">BMI is a rough screening measure only — it does not account for muscle mass, age or body composition.</p>
    </div>
  );
}