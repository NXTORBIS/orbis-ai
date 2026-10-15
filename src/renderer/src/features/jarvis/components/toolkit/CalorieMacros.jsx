import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow } from './shared';

const ACTIVITY = [
  { value: 1.2, label: 'Desk job' },
  { value: 1.375, label: 'Light' },
  { value: 1.55, label: 'Moderate' },
  { value: 1.725, label: 'Active' },
  { value: 1.9, label: 'Athlete' },
];

const SPLITS = {
  Balanced: { protein: 25, carbs: 45, fat: 30 },
  'High protein': { protein: 35, carbs: 35, fat: 30 },
  'Low carb': { protein: 30, carbs: 20, fat: 50 },
  Endurance: { protein: 20, carbs: 55, fat: 25 },
  Custom: { protein: 30, carbs: 40, fat: 30 },
};

export default function CalorieMacros() {
  const [units, setUnits] = useState('metric');
  const [sex, setSex] = useState('male');
  const [age, setAge] = useState(28);
  const [cm, setCm] = useState(175);
  const [ft, setFt] = useState(5);
  const [inch, setInch] = useState(9);
  const [kg, setKg] = useState(72);
  const [lb, setLb] = useState(159);
  const [activity, setActivity] = useState(1.55);
  const [goal, setGoal] = useState('maintain');
  const [formula, setFormula] = useState('mifflin');
  const [bodyFat, setBodyFat] = useState(18);
  const [splitName, setSplitName] = useState('Balanced');
  const [split, setSplit] = useState({ ...SPLITS.Balanced });

  const weightKg = units === 'metric' ? Number(kg) || 0 : (Number(lb) || 0) * 0.45359237;
  const heightCm = units === 'metric' ? Number(cm) || 0 : ((Number(ft) || 0) * 12 + (Number(inch) || 0)) * 2.54;

  const maths = useMemo(() => {
    const lean = weightKg * (1 - (Number(bodyFat) || 0) / 100);
    const bmr = formula === 'katch'
      ? 370 + 21.6 * lean
      : 10 * weightKg + 6.25 * heightCm - 5 * Number(age) + (sex === 'male' ? 5 : -161);
    const tdee = bmr * activity;
    const target = tdee * (goal === 'lose' ? 0.85 : goal === 'gain' ? 1.1 : 1);
    const gram = (percent, perGram) => Math.round((target * (percent / 100)) / perGram);
    const total = split.protein + split.carbs + split.fat;
    return {
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      target: Math.round(target),
      total,
      protein: gram(split.protein, 4),
      carbs: gram(split.carbs, 4),
      fat: gram(split.fat, 9),
      proteinPerKg: weightKg ? ((target * (split.protein / 100)) / 4 / weightKg).toFixed(2) : '—',
      weekly: weightKg ? (((target - tdee) * 7) / 7700).toFixed(2) : '—',
      bmi: heightCm ? (weightKg / (heightCm / 100) ** 2).toFixed(1) : '—',
    };
  }, [formula, weightKg, heightCm, age, sex, activity, goal, split, bodyFat]);

  const setSplitPart = (key, value) => {
    setSplitName('Custom');
    setSplit((s) => ({ ...s, [key]: value }));
  };

  const bars = [
    { key: 'protein', label: 'Protein', colour: 'bg-cyan-j', grams: maths.protein },
    { key: 'carbs', label: 'Carbs', colour: 'bg-amber-400', grams: maths.carbs },
    { key: 'fat', label: 'Fat', colour: 'bg-fuchsia-500', grams: maths.fat },
  ];

  const report = [
    `BMR ${maths.bmr} kcal · TDEE ${maths.tdee} kcal · target ${maths.target} kcal`,
    `Protein ${maths.protein} g · Carbs ${maths.carbs} g · Fat ${maths.fat} g (${splitName})`,
    `BMI ${maths.bmi} · protein per kg ${maths.proteinPerKg} g · weekly change ≈ ${maths.weekly} kg`,
  ].join('\n');

  return (
    <ToolShell
      toolId="calories"
      icon={Flame}
      title="Calorie & Macro Calculator"
      desc="Work out how much to eat for your goal, then split it into protein, carbs and fat."
      state={{ units, sex, age, cm, ft, inch, kg, lb, activity, goal, formula, bodyFat, splitName, split }}
      onRestore={(saved) => {
        if (saved.units) setUnits(saved.units);
        if (saved.sex) setSex(saved.sex);
        setAge(saved.age ?? 28);
        setCm(saved.cm ?? 175);
        setFt(saved.ft ?? 5);
        setInch(saved.inch ?? 9);
        setKg(saved.kg ?? 72);
        setLb(saved.lb ?? 159);
        setActivity(saved.activity ?? 1.55);
        if (saved.goal) setGoal(saved.goal);
        if (saved.formula) setFormula(saved.formula);
        setBodyFat(saved.bodyFat ?? 18);
        if (saved.splitName) setSplitName(saved.splitName);
        if (saved.split) setSplit(saved.split);
      }}
      exportText={report}
      exportName="nutrition-plan.txt"
    >
      <Panel className="text-center">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Daily target</div>
        <div className="font-mono-j text-4xl font-bold text-cyan-j">{maths.target.toLocaleString()}</div>
        <div className="text-[11px] text-muted-foreground">kcal · {goal === 'lose' ? '15% below maintenance' : goal === 'gain' ? '10% above maintenance' : 'at maintenance'}</div>
        <div className="mt-3 space-y-2">
          {bars.map((bar) => (
            <div key={bar.key}>
              <div className="flex items-center justify-between text-[11px]">
                <span>{bar.label}</span>
                <span className="font-mono-j text-muted-foreground">{bar.grams} g · {split[bar.key]}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className={`h-full rounded-full ${bar.colour}`} style={{ width: `${Math.min(100, split[bar.key])}%` }} />
              </div>
            </div>
          ))}
        </div>
        {maths.total !== 100 && (
          <p className="mt-2 text-[11px] text-amber-500">Your split adds up to {maths.total}% — the grams shown follow what you typed.</p>
        )}
      </Panel>

      <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Metric' }, { value: 'imperial', label: 'Imperial' }]} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sex">
          <Seg value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} />
        </Field>
        <Field label={`Age · ${age}`}>
          <input type="range" min={14} max={90} value={age} onChange={(e) => setAge(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      {units === 'metric' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Height · ${cm} cm`}>
            <input type="range" min={130} max={215} value={cm} onChange={(e) => setCm(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
          <Field label={`Weight · ${kg} kg`}>
            <input type="range" min={35} max={180} value={kg} onChange={(e) => setKg(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`Height · ${ft} ft ${inch} in`}>
            <div className="flex gap-2">
              <input type="range" min={4} max={6} value={ft} onChange={(e) => setFt(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
              <input type="range" min={0} max={11} value={inch} onChange={(e) => setInch(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
            </div>
          </Field>
          <Field label={`Weight · ${lb} lb`}>
            <input type="range" min={80} max={400} value={lb} onChange={(e) => setLb(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
          <Stat label="Converting to" value={`${weightKg.toFixed(1)} kg · ${heightCm.toFixed(0)} cm`} mono />
        </div>
      )}

      <Field label="How active are you, most days?">
        <Seg value={activity} onChange={setActivity} options={ACTIVITY.map((a) => ({ value: a.value, label: a.label }))} />
      </Field>

      <Field label="Goal">
        <Seg
          value={goal}
          onChange={setGoal}
          options={[{ value: 'lose', label: 'Lose fat' }, { value: 'maintain', label: 'Maintain' }, { value: 'gain', label: 'Gain muscle' }]}
        />
      </Field>

      <Field label="BMR formula">
        <Seg
          value={formula}
          onChange={setFormula}
          options={[{ value: 'mifflin', label: 'Mifflin-St Jeor' }, { value: 'katch', label: 'Katch-McArdle' }]}
        />
      </Field>

      {formula === 'katch' && (
        <Field label={`Body fat · ${bodyFat}%`}>
          <input type="range" min={5} max={45} value={bodyFat} onChange={(e) => setBodyFat(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}

      <Field label="Macro split">
        <Seg
          value={splitName}
          onChange={(name) => { setSplitName(name); setSplit({ ...SPLITS[name] }); }}
          options={Object.keys(SPLITS).map((k) => ({ value: k, label: k }))}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Protein · ${split.protein}%`}>
          <input type="range" min={10} max={50} value={split.protein} onChange={(e) => setSplitPart('protein', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Carbs · ${split.carbs}%`}>
          <input type="range" min={10} max={70} value={split.carbs} onChange={(e) => setSplitPart('carbs', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Fat · ${split.fat}%`}>
          <input type="range" min={15} max={60} value={split.fat} onChange={(e) => setSplitPart('fat', Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="BMR" value={`${maths.bmr}`} sub="kcal at rest" mono />
        <Stat label="Maintenance" value={`${maths.tdee}`} sub="kcal per day" mono />
        <Stat label="Protein per kg" value={String(maths.proteinPerKg)} sub="grams" mono />
        <Stat label="BMI" value={String(maths.bmi)} mono />
      </div>

      <Panel>
        <div className="text-xs font-medium">If you eat this every day</div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          That is roughly {maths.weekly} kg per week {Number(maths.weekly) < 0 ? 'down' : Number(maths.weekly) > 0 ? 'up' : 'of change'} —
          about {(Math.abs(Number(maths.weekly)) * 4.3).toFixed(1)} kg a month. A change of 0.5% to 1% of body weight per week is the pace most people hold on to.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          These numbers are estimates from published equations, not medical advice: they are usually within 10% of what a person actually burns.
          Track how your weight moves for two or three weeks and adjust the target by 100–150 kcal at a time rather than trusting the formula blindly.
        </p>
      </Panel>
    </ToolShell>
  );
}