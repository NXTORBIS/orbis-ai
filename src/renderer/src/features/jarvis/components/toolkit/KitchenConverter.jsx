import { useMemo, useState } from 'react';
import { Utensils } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const INGREDIENTS = {
  'Plain flour': { perCup: 125, density: 0.53 },
  'Granulated sugar': { perCup: 200, density: 0.85 },
  'Brown sugar (packed)': { perCup: 213, density: 0.9 },
  'Butter': { perCup: 227, density: 0.96 },
  'Rice (uncooked)': { perCup: 185, density: 0.78 },
  'Rolled oats': { perCup: 90, density: 0.38 },
  'Honey': { perCup: 340, density: 1.42 },
  'Milk': { perCup: 240, density: 1.03 },
  'Cocoa powder': { perCup: 85, density: 0.36 },
  'Breadcrumbs': { perCup: 108, density: 0.45 },
};

const OVEN_TABLE = [
  { gas: '1', c: 140, f: 275, fan: 120, note: 'Very low — meringues, slow bakes' },
  { gas: '2', c: 150, f: 300, fan: 130, note: 'Low — rich fruit cake' },
  { gas: '3', c: 170, f: 325, fan: 150, note: 'Warm — casseroles, slow roasting' },
  { gas: '4', c: 180, f: 350, fan: 160, note: 'Moderate — biscuits, sponges' },
  { gas: '5', c: 190, f: 375, fan: 170, note: 'Moderate — cakes, tray bakes' },
  { gas: '6', c: 200, f: 400, fan: 180, note: 'Moderately hot — roast chicken' },
  { gas: '7', c: 220, f: 425, fan: 200, note: 'Hot — roast potatoes, pizza' },
  { gas: '8', c: 230, f: 450, fan: 210, note: 'Very hot — bread, fast browning' },
  { gas: '9', c: 240, f: 475, fan: 220, note: 'Extremely hot — searing, crisp' },
];

export default function KitchenConverter() {
  const [mode, setMode] = useState('oven');
  const [temperature, setTemperature] = useState('180');
  const [tempUnit, setTempUnit] = useState('C');
  const [ingredient, setIngredient] = useState('Plain flour');
  const [direction, setDirection] = useState('cups');
  const [amount, setAmount] = useState('1.5');
  const [unit, setUnit] = useState('cup');
  const [panA, setPanA] = useState('20');
  const [panB, setPanB] = useState('23');
  const [round, setRound] = useState(true);

  const temp = useMemo(() => {
    const value = Number(temperature) || 0;
    const celsius = tempUnit === 'C' ? value : tempUnit === 'F' ? ((value - 32) * 5) / 9 : (value === 1 ? 140 : 150 + (value - 2) * 10);
    const fahrenheit = (celsius * 9) / 5 + 32;
    const nearest = OVEN_TABLE.reduce((best, row) => (Math.abs(row.c - celsius) < Math.abs(best.c - celsius) ? row : best), OVEN_TABLE[0]);
    return { celsius, fahrenheit, nearest };
  }, [temperature, tempUnit]);

  const weights = useMemo(() => {
    const info = INGREDIENTS[ingredient] || INGREDIENTS['Plain flour'];
    const value = Number(amount) || 0;
    const grams = direction === 'cups'
      ? value * (unit === 'cup' ? info.perCup : unit === 'tbsp' ? info.perCup / 16 : info.perCup / 48)
      : value;
    const cups = direction === 'cups' ? value : grams / info.perCup;
    return {
      info,
      grams,
      cups,
      tbsp: (grams / info.perCup) * 16,
      tsp: (grams / info.perCup) * 48,
      ml: grams / (info.density || 1),
      rounded: round ? Math.round(grams / 5) * 5 : grams,
    };
  }, [ingredient, direction, amount, unit, round]);

  const pans = useMemo(() => {
    const diameter = (value) => Math.PI * (value / 2) ** 2;
    const areaA = diameter(Number(panA) || 0);
    const areaB = diameter(Number(panB) || 0);
    const factor = areaA ? areaB / areaA : 1;
    const timeFactor = factor > 1 ? 0.9 : 1.1;
    return { areaA, areaB, factor, timeFactor };
  }, [panA, panB]);

  const report = mode === 'oven'
    ? `${temperature}°${tempUnit} = ${temp.celsius.toFixed(0)}°C / ${temp.fahrenheit.toFixed(0)}°F / fan ${(temp.celsius - 20).toFixed(0)}°C\ngas mark ${temp.nearest.gas} (${temp.nearest.note})`
    : mode === 'weight'
      ? `${amount} ${unit}(s) ${ingredient} = ${weights.grams.toFixed(1)} g · ${weights.tbsp.toFixed(1)} tbsp · ${weights.ml.toFixed(0)} ml`
      : `Pan ${panA} cm → ${panB} cm: recipe ×${pans.factor.toFixed(2)}, bake time ×${pans.timeFactor.toFixed(2)}`;

  return (
    <ToolShell
      toolId="kitchen"
      icon={Utensils}
      title="Kitchen Converter"
      desc="Oven temperatures, cup-to-gram weights by ingredient, and pan-size maths — the three conversions that actually ruin a bake."
      state={{ mode, temperature, tempUnit, ingredient, direction, amount, unit, panA, panB, round }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.temperature !== undefined) setTemperature(String(restored.temperature));
        if (restored.tempUnit) setTempUnit(restored.tempUnit);
        if (restored.ingredient) setIngredient(restored.ingredient);
        if (restored.direction) setDirection(restored.direction);
        if (restored.amount !== undefined) setAmount(String(restored.amount));
        if (restored.unit) setUnit(restored.unit);
        if (restored.panA !== undefined) setPanA(String(restored.panA));
        if (restored.panB !== undefined) setPanB(String(restored.panB));
        if (typeof restored.round === 'boolean') setRound(restored.round);
      }}
      exportText={report}
      exportName="kitchen.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={mode}
          onChange={setMode}
          options={[{ value: 'oven', label: 'Oven temperature' }, { value: 'weight', label: 'Cups ⇄ grams' }, { value: 'pan', label: 'Pan sizes' }]}
        />
        <CopyBtn value={report} label="Copy answer" />
      </div>

      {mode === 'oven' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Temperature">
              <input value={temperature} onChange={(e) => setTemperature(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
            </Field>
            <Field label="Unit">
              <Seg value={tempUnit} onChange={setTempUnit} options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }, { value: 'gas', label: 'Gas' }]} />
            </Field>
            <Panel className="!p-3 text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Nearest gas mark</div>
              <div className="mt-1 font-mono-j text-lg text-cyan-j">{temp.nearest.gas}</div>
            </Panel>
          </div>

          <Hero
            label={`${temperature}°${tempUnit} converts to`}
            value={`${temp.celsius.toFixed(0)}°C`}
            sub={`${temp.fahrenheit.toFixed(0)}°F · fan oven ${(temp.celsius - 20).toFixed(0)}°C · ${temp.nearest.note}`}
          />

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The whole oven scale</div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full border-collapse text-left font-mono-j text-[11px]">
                <thead className="sticky top-0 bg-card/95 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1.5">Gas</th>
                    <th className="py-1.5">°C</th>
                    <th className="py-1.5">°F</th>
                    <th className="py-1.5">Fan °C</th>
                    <th className="py-1.5">Usual for</th>
                  </tr>
                </thead>
                <tbody>
                  {OVEN_TABLE.map((row) => (
                    <tr key={row.gas} className={`border-t border-border/40 ${row.gas === temp.nearest.gas ? 'bg-cyan-j/5 text-cyan-j' : ''}`}>
                      <td className="py-1">{row.gas}</td>
                      <td className="py-1">{row.c}</td>
                      <td className="py-1">{row.f}</td>
                      <td className="py-1">{row.fan}</td>
                      <td className="py-1 font-body text-muted-foreground">{row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      {mode === 'weight' && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Ingredient">
              <select value={ingredient} onChange={(e) => setIngredient(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {Object.keys(INGREDIENTS).map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </Field>
            <Field label="Direction">
              <Seg value={direction} onChange={setDirection} options={[{ value: 'cups', label: 'Cups → grams' }, { value: 'grams', label: 'Grams → cups' }]} />
            </Field>
            <Field label="Amount">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
            </Field>
            {direction === 'cups' && (
              <Field label="Measure">
                <Seg value={unit} onChange={setUnit} options={[{ value: 'cup', label: 'Cup' }, { value: 'tbsp', label: 'Tbsp' }, { value: 'tsp', label: 'Tsp' }]} />
              </Field>
            )}
          </div>

          <Hero
            label={`${amount} ${direction === 'cups' ? `${unit}(s)` : 'g'} of ${ingredient}`}
            value={direction === 'cups' ? `${weights.rounded} g` : `${weights.cups.toFixed(2)} cups`}
            sub={`${weights.tbsp.toFixed(1)} tbsp · ${weights.tsp.toFixed(1)} tsp · ${weights.ml.toFixed(0)} ml · ${weights.info.perCup} g per cup`}
          />

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Grams" value={weights.grams.toFixed(1)} mono />
            <Stat label="Cups" value={weights.cups.toFixed(3)} mono />
            <Stat label="Tablespoons" value={weights.tbsp.toFixed(1)} mono />
            <Stat label="Millilitres" value={weights.ml.toFixed(0)} mono />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">One cup of each ingredient, in grams</div>
            <div className="space-y-1">
              {Object.entries(INGREDIENTS).map(([name, info]) => (
                <div key={name} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${name === ingredient ? 'border-cyan-j/50 bg-cyan-j/5 text-cyan-j' : 'border-border/50 bg-card/40'}`}>
                  <span>{name}</span>
                  <span className="font-mono-j">{info.perCup} g</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              A cup is a volume measure, so the same cup weighs wildly different amounts depending on what is in it — which is why weighing is the
              single biggest upgrade to baking accuracy. Scooping flour straight from the bag can add 20% more than the recipe intends.
            </p>
          </Panel>
        </>
      )}

      {mode === 'pan' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Recipe's pan diameter (cm)">
              <input value={panA} onChange={(e) => setPanA(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
            </Field>
            <Field label="Your pan diameter (cm)">
              <input value={panB} onChange={(e) => setPanB(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
            </Field>
            <Field label="Round pan — measured across the middle">
              <div className="text-[11px] text-muted-foreground">For square tins, measure across and this still works for area.</div>
            </Field>
          </div>

          <Hero
            label="Scale the recipe by"
            value={`×${pans.factor.toFixed(2)}`}
            sub={`Area ${pans.areaA.toFixed(0)} cm² → ${pans.areaB.toFixed(0)} cm² · bake time ×${pans.timeFactor.toFixed(2)}`}
          />

          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Recipe pan area" value={`${pans.areaA.toFixed(0)} cm²`} mono />
            <Stat label="Your pan area" value={`${pans.areaB.toFixed(0)} cm²`} mono />
            <Stat label="Bake time" value={`×${pans.timeFactor.toFixed(2)}`} mono sub={pans.factor > 1 ? 'shallower batter, shorter bake' : 'deeper batter, longer bake'} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">How to use it</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Multiply every ingredient by the factor — a 20 cm tin to a 23 cm tin means ×1.32 of everything.</p>
              <p>· Change both diameter and depth and the volume factor scales again: {pans.factor > 1 ? 'a wider tin with the same batter makes a thinner cake, so it bakes faster' : 'a smaller tin makes a deeper cake, so it needs a little longer'}.</p>
              <p>· Start checking the bake about 10% before the original time and trust the skewer or a spring-back test over the clock.</p>
              <p>· Keep the temperature the same; only time and quantity change.</p>
            </div>
          </Panel>

          <Panel className="!p-3">
            <Pills
              items={[
                { label: 'From', value: `${panA} cm` },
                { label: 'To', value: `${panB} cm` },
                { label: 'Factor', value: `×${pans.factor.toFixed(2)}`, tone: pans.factor > 1.3 || pans.factor < 0.7 ? 'amber' : undefined },
              ]}
            />
            {(pans.factor > 1.5 || pans.factor < 0.6) && (
              <p className="mt-2 text-[11px] text-amber-500">
                That is a big jump in area — batters behave differently at very different depths, so expect the texture to change a little even with
                perfect scaling.
              </p>
            )}
          </Panel>
        </>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Fan ovens run about 20°C cooler than the dial suggests because moving air transfers heat far more efficiently, which is why recipes now print
          both. And a gas mark is not a precise temperature — it is a band, so if a bake is browning too fast, drop a mark rather than fiddling with
          seconds.
        </p>
      </Panel>
    </ToolShell>
  );
}