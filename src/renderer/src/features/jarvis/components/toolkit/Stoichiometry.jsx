import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';
import { splitEquation } from './kit/chem';

const SAMPLE = '2H2 + O2 -> 2H2O';

export default function Stoichiometry() {
  const [equation, setEquation] = useState(SAMPLE);
  const [amounts, setAmounts] = useState({ 0: '8', 1: '40' });
  const [actual, setActual] = useState('6.5');

  const parsed = useMemo(() => splitEquation(equation), [equation]);

  const result = useMemo(() => {
    if (parsed.error) return { error: parsed.error };
    const reactants = parsed.reactants.map((entry, index) => {
      const grams = Number(amounts[index]) || 0;
      const moles = entry.mass ? grams / entry.mass : 0;
      return { ...entry, index, grams, moles, molesPerCoefficient: entry.coefficient ? moles / entry.coefficient : 0 };
    });
    const supplied = reactants.filter((entry) => entry.grams > 0);
    if (!supplied.length) return { error: 'Enter the mass of at least one reactant.' };
    const limiting = [...supplied].sort((a, b) => a.molesPerCoefficient - b.molesPerCoefficient)[0];
    const extent = limiting.molesPerCoefficient;

    const products = parsed.products.map((entry) => ({
      ...entry,
      theoreticalMoles: extent * entry.coefficient,
      theoreticalGrams: extent * entry.coefficient * entry.mass,
    }));

    const consumed = reactants.map((entry) => {
      const used = extent * entry.coefficient;
      const usedGrams = used * entry.mass;
      return {
        ...entry,
        used,
        usedGrams,
        left: Math.max(0, entry.moles - used),
        leftGrams: Math.max(0, entry.moles - used) * entry.mass,
        excess: entry.index !== limiting.index,
      };
    });

    const theoreticalTotal = products.reduce((sum, entry) => sum + entry.theoreticalGrams, 0);
    const measured = Number(actual) || 0;
    const yieldPercent = theoreticalTotal ? (measured / theoreticalTotal) * 100 : 0;
    const massIn = supplied.reduce((sum, entry) => sum + entry.grams, 0);
    const massOut = consumed.reduce((sum, entry) => sum + entry.usedGrams, 0);
    const atomEconomy = massIn ? (products[0].theoreticalGrams / massIn) * 100 : 0;

    return {
      reactants: consumed, products, limiting, extent, theoreticalTotal, measured, yieldPercent,
      massIn, massOut, atomEconomy, error: '',
      balanced: supplied.length > 1,
    };
  }, [parsed, amounts, actual]);

  const report = useMemo(() => {
    if (result.error) return result.error;
    return [
      equation,
      '',
      ...result.reactants.map((row) => row.formula + (row.excess ? ' (excess)' : ' (limiting)') + ': ' + row.grams + ' g = ' + row.moles.toFixed(4) + ' mol, uses ' + row.used.toFixed(4) + ' mol, ' + row.left.toFixed(4) + ' mol left (' + row.leftGrams.toFixed(2) + ' g)'),
      '',
      ...result.products.map((row) => row.formula + ': theoretical ' + row.theoreticalMoles.toFixed(4) + ' mol = ' + row.theoreticalGrams.toFixed(3) + ' g'),
      '',
      'Limiting reagent: ' + result.limiting.formula,
      'Percent yield: ' + result.yieldPercent.toFixed(1) + '%',
    ].join('\n');
  }, [result, equation]);

  return (
    <ToolShell
      toolId="stoichiometry"
      icon={FlaskConical}
      title="Stoichiometry & Limiting Reagent"
      desc="Enter a balanced equation and the grams you have — this finds the limiting reagent, the theoretical yield, what is left over and the percentage yield."
      state={{ equation, amounts, actual }}
      onRestore={(restored) => {
        if (typeof restored.equation === 'string') setEquation(restored.equation);
        if (restored.amounts && typeof restored.amounts === 'object') setAmounts(restored.amounts);
        if (restored.actual !== undefined) setActual(String(restored.actual));
      }}
      exportText={report}
      exportName="stoichiometry.txt"
    >
      <Field label="Balanced equation" hint="Use + between species and -> between the two sides, for example 2H2 + O2 -> 2H2O">
        <input
          value={equation}
          onChange={(e) => setEquation(e.target.value)}
          spellCheck={false}
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j"
        />
      </Field>

      <div className="flex flex-wrap gap-1.5">
        {[SAMPLE, 'CH4 + 2O2 -> CO2 + 2H2O', 'N2 + 3H2 -> 2NH3', '2NaOH + H2SO4 -> Na2SO4 + 2H2O', 'CaCO3 -> CaO + CO2', 'Fe2O3 + 3CO -> 2Fe + 3CO2'].map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => setEquation(sample)}
            className={sample === equation
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 font-mono-j text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 font-mono-j text-[11px] text-muted-foreground transition hover:text-foreground'}
          >
            {sample}
          </button>
        ))}
      </div>

      {result.error ? (
        <Panel className="border-rose-500/40 text-[12px] text-rose-400">{result.error}</Panel>
      ) : (
        <>
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What you have — grams of each reactant</div>
            <div className="grid gap-2 sm:grid-cols-4">
              {result.reactants.map((row) => (
                <Field key={row.index} label={row.formula + ' · ' + row.coefficient + ' mol needed'}>
                  <input
                    value={amounts[row.index] === undefined ? '' : amounts[row.index]}
                    onChange={(e) => setAmounts((current) => ({ ...current, [row.index]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0"
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm"
                  />
                </Field>
              ))}
              <Field label="Product actually made (g)">
                <input value={actual} onChange={(e) => setActual(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={result.yieldPercent >= 80 ? 'emerald' : result.yieldPercent >= 50 ? 'amber' : 'rose'}
              label={result.balanced ? 'Limiting reagent: ' + result.limiting.formula : 'The only reactant: ' + result.limiting.formula}
              value={result.products[0].theoreticalGrams.toFixed(2)}
              unit={'g of ' + result.products[0].formula}
              sub={'Theoretical yield from ' + result.limiting.grams + ' g of ' + result.limiting.formula + ' — the reaction can run ' + result.extent.toFixed(4) + ' times at the equation\'s proportions.'}
            />
            <Ring
              value={Math.max(0, Math.min(100, result.yieldPercent))}
              max={100}
              tone={result.yieldPercent >= 80 ? 'emerald' : result.yieldPercent >= 50 ? 'amber' : 'rose'}
              label="Percentage yield"
              sub={result.measured + ' g made against ' + result.theoreticalTotal.toFixed(2) + ' g possible'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Reactants, mole by mole</div>
              <div className="space-y-1.5">
                {result.reactants.map((row) => (
                  <div key={row.index} className={row.excess ? 'rounded-lg border border-amber-500/40 bg-amber-500/5 px-2.5 py-2' : 'rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-2'}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono-j">{row.formula}</span>
                      <span className={row.excess ? 'text-amber-400' : 'text-cyan-j'}>{row.excess ? 'in excess' : 'limiting'}</span>
                    </div>
                    <div className="mt-1 grid grid-cols-3 gap-2 font-mono-j text-[10px] text-muted-foreground">
                      <span>{row.moles.toFixed(4)} mol in</span>
                      <span>{row.used.toFixed(4)} mol used</span>
                      <span>{row.leftGrams.toFixed(3)} g left</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-cyan-j/70" style={{ width: Math.min(100, row.grams ? (row.usedGrams / row.grams) * 100 : 0) + '%' }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                The bar shows how much of each reactant the reaction actually consumes. The limiting reagent is the one that runs out first —{' '}
                {result.limiting.formula} here — and everything else is left over, however much you started with.
              </p>
            </Panel>

            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Products at completion</div>
              <div className="space-y-1.5">
                {result.products.map((row) => (
                  <div key={row.formula} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-mono-j">{row.formula}</span>
                      <span className="font-mono-j text-cyan-j">{row.theoreticalGrams.toFixed(3)} g</span>
                    </div>
                    <div className="mt-1 font-mono-j text-[10px] text-muted-foreground">
                      {row.theoreticalMoles.toFixed(4)} mol × {row.mass.toFixed(2)} g/mol · coefficient {row.coefficient}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <Bars
                  data={result.products.map((row) => ({ label: row.formula.slice(0, 8), value: Number(row.theoreticalGrams.toFixed(2)) }))}
                  format={(value) => value.toFixed(1)}
                  suffix=" g"
                  highlightLast={false}
                />
              </div>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">The working, line by line</span>
              <CopyBtn value={report} label="Copy the working" />
            </div>
            <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
              {result.reactants.map((row) => (
                <p key={row.index}>
                  {row.formula}: {row.grams} g ÷ {row.mass.toFixed(3)} g/mol = {row.moles.toFixed(4)} mol ÷ {row.coefficient} = {row.molesPerCoefficient.toFixed(4)} reaction equivalents
                </p>
              ))}
              <p className="text-cyan-j">Smallest equivalent wins: {result.limiting.formula} limits the reaction to {result.extent.toFixed(4)} times.</p>
              {result.products.map((row) => (
                <p key={row.formula}>
                  {row.formula}: {result.extent.toFixed(4)} × coefficient {row.coefficient} = {row.theoreticalMoles.toFixed(4)} mol × {row.mass.toFixed(3)} g/mol = {row.theoreticalGrams.toFixed(3)} g
                </p>
              ))}
              <p>Yield: {result.measured} g ÷ {result.theoreticalTotal.toFixed(3)} g × 100 = {result.yieldPercent.toFixed(1)}%</p>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Reading the result</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· The equation must be balanced first. The coefficients are what tell you the ratio the reaction actually runs at.</p>
                <p>· {result.balanced ? 'Two reactants supplied, so one runs out first — that one sets every number below it.' : 'Only one reactant supplied, so it is limiting by definition.'}</p>
                <p>· Mass of reactants used here is {result.massOut.toFixed(2)} g, and the products account for {result.theoreticalTotal.toFixed(2)} g — equal if the equation is balanced properly, which is a good check.</p>
                <p>· Percent yield compares what you actually isolated against the theoretical maximum. Above 100% means an impurity or water in the sample, not a better reaction.</p>
                <p>· Atom economy of the first product is {result.atomEconomy.toFixed(0)}% — how much of the reactant mass ends up in the product you want.</p>
                <p>· Real yields drop through incomplete reaction, side reactions and losses in transferring. 70–90% is a normal laboratory outcome.</p>
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Doing this by hand, reliably</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· Write the balanced equation and check it: the same atom counts on both sides, no exceptions.</p>
                <p>· Convert every quantity to moles early. Grams cannot be compared across species; moles can.</p>
                <p>· Divide each reactant's moles by its coefficient. The smallest answer is the limiting reagent — this single step is where most mistakes happen.</p>
                <p>· Carry the limiting value through the coefficients to get product moles, then convert to grams at the very end.</p>
                <p>· Keep units attached to every number. Almost all stoichiometry errors are a grams-versus-moles slip.</p>
                <p>· Compare the total mass in against the theoretical mass out. If they disagree, the equation or a molar mass is wrong.</p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Limiting" value={result.limiting.formula} mono sub={result.limiting.grams + ' g supplied'} />
            <Stat label="Extent" value={result.extent.toFixed(4)} mono sub="reaction equivalents" />
            <Stat label="Theoretical" value={result.theoreticalTotal.toFixed(2)} mono sub="g total product" />
            <Stat label="Yield" value={result.yieldPercent.toFixed(1) + '%'} mono sub={result.measured + ' g measured'} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What happens when the numbers surprise you</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Yield over 100% almost always means the product is still wet or contaminated — dry it and weigh again before recording.</p>
              <p>· Yield far below 50% is worth investigating: check the limiting reagent by hand, then look for product lost in filtration or left in the flask.</p>
              <p>· A reaction that produces less than the calculation predicts while the excess reactant is barely touched usually means the reaction stopped, not that the maths is wrong.</p>
              <p>· When two reactants are needed in equal measure, changing one mass changes nothing until it crosses the ratio — worth testing here by moving a slider one gram at a time.</p>
            </div>
            <div className="mt-2">
              <Pills
                items={[
                  { label: 'Equation', value: equation.length > 22 ? equation.slice(0, 22) + '…' : equation },
                  { label: 'Limiting', value: result.limiting.formula },
                  { label: 'Yield', value: result.yieldPercent.toFixed(0) + '%' },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Molar masses come from the standard atomic weights, worked out from the formulas as written, and the limiting reagent is found by comparing moles per
              coefficient rather than moles alone — the only comparison that respects the balanced equation. Everything runs locally and updates as you type.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}