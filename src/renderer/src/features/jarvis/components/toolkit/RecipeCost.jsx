import { useMemo, useState } from 'react';
import { Plus, Trash2, Utensils } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const UNITS = {
  g: { base: 'g', factor: 1 },
  kg: { base: 'g', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  piece: { base: 'piece', factor: 1 },
  tbsp: { base: 'ml', factor: 15 },
  tsp: { base: 'ml', factor: 5 },
  cup: { base: 'ml', factor: 240 },
};

const money = (value) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const blank = () => ({ id: Math.random().toString(36).slice(2), name: '', packPrice: '', packSize: '', packUnit: 'g', used: '', usedUnit: 'g' });

export default function RecipeCost() {
  const [rows, setRows] = useState([
    { id: 'a', name: 'Plain flour', packPrice: '1.20', packSize: '1', packUnit: 'kg', used: '250', usedUnit: 'g' },
    { id: 'b', name: 'Butter', packPrice: '2.60', packSize: '250', packUnit: 'g', used: '120', usedUnit: 'g' },
    { id: 'c', name: 'Caster sugar', packPrice: '1.10', packSize: '1', packUnit: 'kg', used: '100', usedUnit: 'g' },
    { id: 'd', name: 'Eggs', packPrice: '2.40', packSize: '12', packUnit: 'piece', used: '3', usedUnit: 'piece' },
    { id: 'e', name: 'Vanilla extract', packPrice: '3.50', packSize: '100', packUnit: 'ml', used: '1', usedUnit: 'tsp' },
  ]);
  const [servings, setServings] = useState('8');
  const [energy, setEnergy] = useState('0.35');

  const set = (id, key, value) => setRows((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const priced = rows.map((row) => {
      const packUnit = UNITS[row.packUnit] || UNITS.g;
      const usedUnit = UNITS[row.usedUnit] || UNITS.g;
      const packPrice = Number(row.packPrice) || 0;
      const packSize = Number(row.packSize) || 0;
      const used = Number(row.used) || 0;
      const packInBase = packSize * packUnit.factor;
      const usedInBase = used * usedUnit.factor;
      const pricePerBase = packInBase ? packPrice / packInBase : 0;
      const cost = usedInBase * pricePerBase;
      const compatible = packUnit.base === usedUnit.base;
      return {
        ...row,
        cost,
        compatible,
        pricePerBase,
        baseLabel: packUnit.base,
        share: 0,
        problem: !packPrice || !packSize || !used
          ? 'Fill in the pack size, price and amount used'
          : compatible ? '' : 'Pack is measured in ' + packUnit.base + ' but the recipe uses ' + usedUnit.base,
      };
    });

    const ingredients = priced.reduce((sum, row) => sum + (row.problem ? 0 : row.cost), 0);
    const energyCost = Number(energy) || 0;
    const total = ingredients + energyCost;
    const portions = Math.max(1, Number(servings) || 1);
    const perServing = total / portions;
    const withShare = priced.map((row) => ({ ...row, share: ingredients ? (row.cost / ingredients) * 100 : 0 })).sort((a, b) => b.cost - a.cost);
    const markup = (multiplier) => total * multiplier;

    return {
      ingredients, energyCost, total, portions, perServing, rows: withShare,
      problems: withShare.filter((row) => row.problem),
      doubling: markup(2),
      halving: markup(0.5),
      foodShare: total ? (ingredients / total) * 100 : 0,
    };
  }, [rows, servings, energy]);

  const report = useMemo(() => [
    'Recipe cost — ' + result.portions + ' servings',
    '',
    ...result.rows.map((row) => row.name + ': ' + row.used + ' ' + row.usedUnit + ' = ' + money(row.cost) + (row.problem ? '  (' + row.problem + ')' : '')),
    '',
    'Ingredients ' + money(result.ingredients),
    'Energy ' + money(result.energyCost),
    'Total ' + money(result.total),
    'Per serving ' + money(result.perServing),
    'Double batch ' + money(result.doubling),
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="recipe-cost"
      icon={Utensils}
      title="Recipe Cost Calculator"
      desc="Price a recipe from what the ingredients actually cost you — pack size against amount used, per portion, with the energy of cooking counted and unit mismatches flagged."
      state={{ rows, servings, energy }}
      onRestore={(restored) => {
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
        if (restored.servings !== undefined) setServings(String(restored.servings));
        if (restored.energy !== undefined) setEnergy(String(restored.energy));
      }}
      exportText={report}
      exportName="recipe-cost.txt"
    >
      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Ingredients</span>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, blank()])}
            className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Plus className="h-3.5 w-3.5" /> Add ingredient
          </button>
        </div>

        <div className="space-y-2">
          {rows.map((row, index) => {
            const priced = result.rows.find((entry) => entry.id === row.id);
            return (
              <div key={row.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                <div className="grid gap-2 sm:grid-cols-6">
                  <Field label={index === 0 ? 'Ingredient' : ''}>
                    <input value={row.name} onChange={(e) => set(row.id, 'name', e.target.value)} placeholder="Name" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
                  </Field>
                  <Field label={index === 0 ? 'Pack price' : ''}>
                    <input value={row.packPrice} onChange={(e) => set(row.id, 'packPrice', e.target.value)} inputMode="decimal" placeholder="0.00" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
                  </Field>
                  <Field label={index === 0 ? 'Pack size' : ''}>
                    <input value={row.packSize} onChange={(e) => set(row.id, 'packSize', e.target.value)} inputMode="decimal" placeholder="1" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
                  </Field>
                  <Field label={index === 0 ? 'Pack unit' : ''}>
                    <select value={row.packUnit} onChange={(e) => set(row.id, 'packUnit', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                      {Object.keys(UNITS).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </Field>
                  <Field label={index === 0 ? 'Amount used' : ''}>
                    <input value={row.used} onChange={(e) => set(row.id, 'used', e.target.value)} inputMode="decimal" placeholder="0" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
                  </Field>
                  <Field label={index === 0 ? 'Used in' : ''}>
                    <select value={row.usedUnit} onChange={(e) => set(row.id, 'usedUnit', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                      {Object.keys(UNITS).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="font-mono-j text-cyan-j">{priced ? money(priced.cost) : money(0)}</span>
                  {priced && priced.pricePerBase > 0 && (
                    <span className="text-muted-foreground">
                      {money(priced.pricePerBase)} per {priced.baseLabel}
                    </span>
                  )}
                  {priced && priced.problem && <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-amber-300">{priced.problem}</span>}
                  <button
                    type="button"
                    onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-0.5 text-muted-foreground transition hover:text-rose-300"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="Servings this makes"><input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Energy and fuel to cook"><input value={energy} onChange={(e) => setEnergy(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Double batch"><input disabled value={money(result.doubling)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm opacity-70" /></Field>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Cost per serving · ' + result.portions + ' portions'}
          value={money(result.perServing)}
          sub={'The whole recipe comes to ' + money(result.total) + ' — ' + money(result.ingredients) + ' of ingredients and ' + money(result.energyCost) + ' of energy.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What each ingredient costs</div>
          <Bars
            data={result.rows.slice(0, 6).map((row) => ({ label: (row.name || 'Unnamed').slice(0, 12), value: Number(row.cost.toFixed(2)) }))}
            format={(value) => money(value)}
            suffix=""
            highlightLast={false}
          />
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Ranked by cost, with the share of the food bill</span>
          <CopyBtn value={report} label="Copy the costing" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">Ingredient</th>
                <th className="py-1 text-right font-medium">Used</th>
                <th className="py-1 text-right font-medium">Cost</th>
                <th className="py-1 text-right font-medium">Share</th>
                <th className="py-1 text-right font-medium">Per serving</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.rows.map((row) => (
                <tr key={row.id} className="border-t border-border/50">
                  <td className="py-1">{row.name || 'Unnamed'}</td>
                  <td className="py-1 text-right text-muted-foreground">{row.used} {row.usedUnit}</td>
                  <td className="py-1 text-right">{money(row.cost)}</td>
                  <td className="py-1 text-right text-muted-foreground">{row.share.toFixed(0)}%</td>
                  <td className="py-1 text-right text-cyan-j">{money(row.cost / result.portions)}</td>
                </tr>
              ))}
              <tr className="border-t border-cyan-j/40 bg-cyan-j/5">
                <td className="py-1" colSpan={2}>Energy and cooking</td>
                <td className="py-1 text-right">{money(result.energyCost)}</td>
                <td className="py-1 text-right text-muted-foreground">{result.total ? (100 - result.foodShare).toFixed(0) : 0}%</td>
                <td className="py-1 text-right text-cyan-j">{money(result.energyCost / result.portions)}</td>
              </tr>
              <tr className="border-t border-border/60">
                <td className="py-1" colSpan={2}>Total</td>
                <td className="py-1 text-right">{money(result.total)}</td>
                <td className="py-1 text-right text-muted-foreground">100%</td>
                <td className="py-1 text-right">{money(result.perServing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>

      {!!result.problems.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Lines that need a look</div>
          <div className="space-y-1.5">
            {result.problems.map((row) => (
              <div key={row.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-200">
                {row.name || 'Unnamed'} — {row.problem}
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the numbers</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The cost of a recipe is the cost of what you use, not what the pack cost. A kilogram of flour priced at {money(1.2)} makes 250 g worth {money(0.3)}.</p>
            <p>· Cost per serving is the number that lets you compare recipes honestly: {money(result.perServing)} a portion here.</p>
            <p>· Ingredients are {result.foodShare.toFixed(0)}% of the total, with cooking energy making up the rest. In long, slow oven recipes that split shifts noticeably.</p>
            <p>· The pack price is the shop price paid, so the leftover ingredients stay yours — this is not the cost of the meal in a commercial sense unless you charge the packs in full.</p>
            <p>· Unit mismatches are flagged rather than silently guessed, because converting a count of eggs to grams is not a calculation, it is an assumption.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where this is genuinely useful</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Pricing a bake sale or a market stall: cost per portion plus a margin sets a price you can defend.</p>
            <p>· Deciding between recipes — the one costing {money(result.perServing)} a serving may be the better choice even if its ingredients sound expensive.</p>
            <p>· Household budgeting: a week of the same five dinners costed once is worth more than guessing at the till.</p>
            <p>· Scaling cleanly: a double batch is {money(result.doubling)}, though energy rarely doubles with it — a larger tray often bakes in the same time.</p>
            <p>· Spotting the ingredient that dominates. When one line is over 40% of the food cost, substituting it is the only change worth making.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Lines', value: String(rows.length) },
                { label: 'Per serving', value: money(result.perServing) },
                { label: 'Double batch', value: money(result.doubling) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Ingredients" value={money(result.ingredients)} mono />
        <Stat label="Energy" value={money(result.energyCost)} mono />
        <Stat label="Whole recipe" value={money(result.total)} mono sub={result.portions + ' servings'} />
        <Stat label="Half batch" value={money(result.halving)} mono sub="for a smaller tin" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Units this understands</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Weight: grams and kilograms, converted exactly.</p>
          <p>· Volume: millilitres and litres, plus tablespoons (15 ml), teaspoons (5 ml) and cups (240 ml) for store-cupboard measures.</p>
          <p>· Count: pieces, for eggs, onions or anything you buy by number.</p>
          <p>· A pack and an amount only compare if they sit in the same family. The tool says so plainly rather than inventing a density.</p>
          <p>· Everything is calculated locally and saved with the tool, so the same costing is there next time you bake.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Unit conversions are handled by family, so grams against kilograms and millilitres against tablespoons both work while a count against a weight is flagged
          instead of guessed. That single guardrail keeps the total honest.
        </p>
      </Panel>
    </ToolShell>
  );
}