import { useMemo, useState } from 'react';
import { Plus, Trash2, Wine } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DRINKS = [
  { label: 'Beer, 330 ml 5%', volume: 330, abv: 5 },
  { label: 'Beer pint, 568 ml 4.5%', volume: 568, abv: 4.5 },
  { label: 'Wine, 175 ml 12%', volume: 175, abv: 12 },
  { label: 'Wine, 250 ml 13%', volume: 250, abv: 13 },
  { label: 'Spirit, 25 ml 40%', volume: 25, abv: 40 },
  { label: 'Double spirit, 50 ml 40%', volume: 50, abv: 40 },
  { label: 'Cider pint, 568 ml 5%', volume: 568, abv: 5 },
  { label: 'Cocktail, 200 ml 12%', volume: 200, abv: 12 },
  { label: 'Liqueur, 50 ml 20%', volume: 50, abv: 20 },
];

const LIMITS = [
  { label: 'Zero tolerance', value: 0.0 },
  { label: 'Strict · 0.02%', value: 0.02 },
  { label: 'Common · 0.05%', value: 0.05 },
  { label: 'US and UK · 0.08%', value: 0.08 },
];

export default function BloodAlcoholCalculator() {
  const [sex, setSex] = useState('male');
  const [weight, setWeight] = useState('75');
  const [unit, setUnit] = useState('kg');
  const [drinks, setDrinks] = useState([
    { id: 'a', label: 'Beer, 330 ml 5%', volume: '330', abv: '5', time: '20:00' },
    { id: 'b', label: 'Wine, 175 ml 12%', volume: '175', abv: '12', time: '21:00' },
  ]);
  const [elapsed, setElapsed] = useState('1.5');
  const [rate, setRate] = useState('0.015');
  const [limit, setLimit] = useState(0.08);
  const [hours, setHours] = useState('0');

  const set = (id, key, value) => setDrinks((current) => current.map((drink) => (drink.id === id ? { ...drink, [key]: value } : drink)));

  const result = useMemo(() => {
    const r = sex === 'male' ? 0.68 : 0.55;
    const weightKg = unit === 'kg' ? (Number(weight) || 0) : (Number(weight) || 0) * 0.453592;
    const sinceStart = Math.max(0, Number(elapsed) || 0);

    const loaded = drinks.map((drink) => {
      const volume = Number(drink.volume) || 0;
      const abv = Number(drink.abv) || 0;
      const grams = volume * (abv / 100) * 0.789;
      return { ...drink, volume, abv, grams };
    });

    const grams = loaded.reduce((sum, drink) => sum + drink.grams, 0);
    const peak = weightKg && r ? grams / (weightKg * r * 10) : 0;
    const elimination = Math.max(0, Number(rate) || 0.015);
    const current = Math.max(0, peak - elimination * Math.max(0, sinceStart - 0.5));
    const projected = Math.max(0, current - elimination * (Number(hours) || 0));
    const toZero = elimination ? current / elimination : 0;
    const hoursUnder = (level) => (current > level && elimination ? (current - level) / elimination : 0);

    const band = current >= 0.2 ? 'severe' : current >= 0.15 ? 'very high' : current >= 0.08 ? 'over the common limit' : current >= 0.05 ? 'over the strict limit' : current >= 0.02 ? 'low but measurable' : 'traces';

    const chart = [];
    for (let offset = 0; offset <= 10; offset += 1) {
      chart.push({ label: '+' + offset + 'h', value: Math.round(Math.max(0, current - elimination * offset) * 1000) });
    }

    return {
      loaded, grams, peak, current, projected, toZero, hoursUnder, r, weightKg, band, elimination, chart,
      units10: grams / 10,
      units14: grams / 14,
      mgdl: current * 1000,
      promille: current * 10,
      mmol: current * 217,
      overLimit: current > limit,
      limitLabel: (LIMITS.find((entry) => entry.value === limit) || { label: String(limit) }).label,
    };
  }, [sex, weight, unit, drinks, elapsed, rate, limit, hours]);

  const report = useMemo(() => [
    'Estimated blood alcohol: ' + result.current.toFixed(3) + '% (' + result.mgdl.toFixed(0) + ' mg/dL, ' + result.promille.toFixed(2) + ' per mille, ' + result.mmol.toFixed(1) + ' mmol/L)',
    'Band: ' + result.band,
    '',
    'Alcohol consumed: ' + result.grams.toFixed(1) + ' g, ' + result.units10.toFixed(1) + ' UK units of 10 g, ' + result.units14.toFixed(1) + ' US standard drinks',
    'Assumptions: ' + sex + ', ' + result.weightKg.toFixed(1) + ' kg, Widmark factor ' + result.r,
    'Time since the first drink: ' + elapsed + ' hours',
    'Elimination: ' + result.elimination + ' percent per hour after a 30 minute absorption lag',
    '',
    'Theoretical peak with all alcohol absorbed and none eliminated: ' + result.peak.toFixed(3) + '%',
    'Time until back to zero: about ' + result.toZero.toFixed(1) + ' hours',
    'Time under ' + limit.toFixed(2) + ': about ' + result.hoursUnder(limit).toFixed(1) + ' hours',
    'In ' + hours + ' hours: ' + result.projected.toFixed(3) + '%',
    '',
    'This is a Widmark estimate with an error of roughly 20 percent. Never use it to decide whether to drive.',
  ].join('\n'), [result, sex, elapsed, limit, hours]);

  return (
    <ToolShell
      toolId="blood-alcohol"
      icon={Wine}
      title="Blood Alcohol Estimator"
      desc="Standard drinks into an estimated blood alcohol level using the Widmark equation, with the elimination curve, time to zero and the limits in each country."
      state={{ sex, weight, unit, drinks, elapsed, rate, limit, hours }}
      onRestore={(restored) => {
        if (restored.sex) setSex(restored.sex);
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.unit) setUnit(restored.unit);
        if (Array.isArray(restored.drinks) && restored.drinks.length) setDrinks(restored.drinks);
        if (restored.elapsed !== undefined) setElapsed(String(restored.elapsed));
        if (restored.rate !== undefined) setRate(String(restored.rate));
        if (restored.limit !== undefined) setLimit(Number(restored.limit) || 0.08);
        if (restored.hours !== undefined) setHours(String(restored.hours));
      }}
      exportText={report}
      exportName="blood-alcohol.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Sex, which sets the body water fraction">
          <Seg value={sex} onChange={setSex} options={[{ value: 'male', label: 'Male · 0.68' }, { value: 'female', label: 'Female · 0.55' }]} />
        </Field>
        <Field label={'Weight (' + unit + ')'}><input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Weight unit"><Seg value={unit} onChange={setUnit} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} /></Field>
        <Field label="Hours since the first drink"><input value={elapsed} onChange={(e) => setElapsed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">What you have had</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.grams.toFixed(0)} g of alcohol · {result.units10.toFixed(1)} units</span>
        </div>
        <div className="space-y-2">
          {drinks.map((drink) => (
            <div key={drink.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-5">
              <Field label="Drink"><input value={drink.label} onChange={(e) => set(drink.id, 'label', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
              <Field label="Volume, ml"><input value={drink.volume} onChange={(e) => set(drink.id, 'volume', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="ABV, %"><input value={drink.abv} onChange={(e) => set(drink.id, 'abv', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Time"><input type="time" value={drink.time} onChange={(e) => set(drink.id, 'time', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <div className="flex items-end gap-2">
                <span className="font-mono-j text-[11px] text-cyan-j">{(Number(drink.volume) * (Number(drink.abv) / 100) * 0.789).toFixed(1)} g</span>
                <button type="button" onClick={() => setDrinks((current) => current.filter((entry) => entry.id !== drink.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {DRINKS.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => setDrinks((current) => [...current, {
                id: Math.random().toString(36).slice(2),
                label: entry.label,
                volume: String(entry.volume),
                abv: String(entry.abv),
                time: '',
              }])}
              className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
            >
              <Plus className="h-3 w-3" /> {entry.label}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.overLimit ? 'rose' : result.current > 0.02 ? 'amber' : 'emerald'}
          label="Estimated blood alcohol now"
          value={result.current.toFixed(3)}
          unit="%"
          sub={'That is ' + result.mgdl.toFixed(0) + ' mg/dL, ' + result.promille.toFixed(2) + ' per mille or ' + result.mmol.toFixed(1) + ' mmol/L — ' + result.band + '. The estimate carries roughly 20% error, so treat it as a range rather than a reading.'}
        />
        <Ring
          value={result.mgdl}
          max={Math.max(80, result.mgdl * 1.3)}
          tone={result.overLimit ? 'rose' : 'amber'}
          label={'Against the ' + limit.toFixed(2) + '% limit'}
          sub={(result.overLimit ? 'Above ' : 'Below ') + result.limitLabel + ' on this estimate — but read the warning below'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Elimination from now, at {result.elimination} per hour</div>
          <Bars data={result.chart} format={(value) => (value / 1000).toFixed(3)} suffix="%" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The fall is a straight line, not a curve — elimination happens at a roughly constant rate regardless of how much is in the blood. That is why the last stretch
            before zero takes as long as the first, and why the total is impossible to hurry.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Key figures</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Alcohol consumed</span><span>{result.grams.toFixed(1)} g</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">UK units of 10 g</span><span>{result.units10.toFixed(1)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">US drinks of 14 g</span><span>{result.units14.toFixed(1)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Theoretical peak</span><span>{result.peak.toFixed(3)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Now</span><span className="text-cyan-j">{result.current.toFixed(3)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">In {hours} hour(s)</span><span>{result.projected.toFixed(3)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Under {limit.toFixed(2)}% after</span><span>{result.hoursUnder(limit).toFixed(1)} h</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Back to zero</span><span>{result.toZero.toFixed(1)} h</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Widmark factor used</span><span>{result.r}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Elimination rate, % per hour"><input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Hours ahead"><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Compare against a limit">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {LIMITS.map((entry) => <option key={entry.label} value={entry.value}>{entry.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Estimate now" value={result.current.toFixed(3) + '%'} mono sub={result.mgdl.toFixed(0) + ' mg/dL'} />
        <Stat label="Band" value={result.band} mono />
        <Stat label="To zero" value={result.toZero.toFixed(1) + ' h'} mono />
        <Stat label="Alcohol" value={result.grams.toFixed(0) + ' g'} mono sub={result.units10.toFixed(1) + ' units'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How the estimate is built</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>grams = volume in ml × ABV ÷ 100 × 0.789</p>
            <p>peak BAC% = grams ÷ (weight kg × r × 10)</p>
            <p>current = peak − elimination × (hours − 0.5)</p>
            <p>r = 0.68 male, 0.55 female — the body water fraction</p>
            <p className="text-cyan-j">Here: {result.grams.toFixed(0)} g ÷ ({result.weightKg.toFixed(0)} kg × {result.r} × 10) = {result.peak.toFixed(3)}%, then {result.elimination} per hour comes off after the first half hour.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Standard drinks, side by side</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· UK unit: 10 ml of pure alcohol, about 8 g. A pint of 4.5% beer is roughly 2.6 units.</p>
            <p>· US standard drink: 14 g, which is a 355 ml beer at 5%, a 148 ml glass of wine at 12%, or a 44 ml spirit at 40%.</p>
            <p>· Your total is {result.units10.toFixed(1)} UK units, which is {result.units14.toFixed(1)} US standard drinks — the same alcohol described two ways.</p>
            <p>· A drink poured at home is usually larger than a measured one. A large glass of wine can be three units without looking like it.</p>
            <p>· Strength varies more than people assume: the same style of beer ranges from 3.5% to 8%, which more than doubles the alcohol in the same glass.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why this number cannot be trusted for decisions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Widmark is an average. Individual results scatter by roughly 20%, which at 0.08% is a spread wide enough to cross any legal limit.</p>
            <p>· Absorption is delayed by food and slowed by the rate of drinking. The peak can arrive an hour or more after the last drink, not half an hour.</p>
            <p>· Habitual drinking, liver health, medication, illness and body composition all shift the numbers in ways this formula cannot see.</p>
            <p>· Elimination rates range from about 0.010 to 0.020 per hour. The difference over four hours is the difference between legal and not.</p>
            <p>· Impairment begins well below every legal limit, and reaction time, judgement and attention are affected before anyone feels drunk. There is no safe estimate, only a legal one.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Points people get wrong</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Coffee, a shower, food and fresh air do nothing to the level. They change how you feel, not how much alcohol is in the blood.</p>
            <p>· Time is the only thing that lowers it, and it cannot be hurried.</p>
            <p>· A late night means a high morning reading. Someone well over the limit at 2 am is still over it at 8 am.</p>
            <p>· Very roughly, one standard drink per hour keeps a moderate drinker near a steady low level; more than that accumulates.</p>
            <p>· The morning after, a reading can still be above the limit even though the effects feel gone. If in doubt, do not drive.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Estimate', value: result.current.toFixed(3) + '%' },
                { label: 'Band', value: result.band },
                { label: 'To zero', value: result.toZero.toFixed(1) + ' h' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is a Widmark calculation for interest and planning, using population average factors. It is not a breathalyser, it is not evidence, and it must never be
          used to decide whether it is safe or legal to drive. If there is any doubt, the answer is not to.
        </p>
      </Panel>
    </ToolShell>
  );
}