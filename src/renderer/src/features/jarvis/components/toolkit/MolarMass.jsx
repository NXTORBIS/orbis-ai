import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const WEIGHTS = "H 1.008 He 4.0026 Li 6.94 Be 9.0122 B 10.81 C 12.011 N 14.007 O 15.999 F 18.998 Ne 20.18 Na 22.99 Mg 24.305 Al 26.982 Si 28.085 P 30.974 S 32.06 Cl 35.45 Ar 39.95 K 39.098 Ca 40.078 Sc 44.956 Ti 47.867 V 50.942 Cr 51.996 Mn 54.938 Fe 55.845 Co 58.933 Ni 58.693 Cu 63.546 Zn 65.38 Ga 69.723 Ge 72.63 As 74.922 Se 78.971 Br 79.904 Kr 83.798 Rb 85.468 Sr 87.62 Y 88.906 Zr 91.224 Nb 92.906 Mo 95.95 Ag 107.87 Cd 112.41 In 114.82 Sn 118.71 Sb 121.76 Te 127.6 I 126.9 Xe 131.29 Cs 132.91 Ba 137.33 La 138.91 Ce 140.12 Pt 195.08 Au 196.97 Hg 200.59 Pb 207.2 Bi 208.98 U 238.03";

const ATOMS = (() => {
  const parts = WEIGHTS.split(' ');
  const map = {};
  for (let index = 0; index + 1 < parts.length; index += 2) map[parts[index]] = Number(parts[index + 1]);
  return map;
})();

const parseFormula = (formula) => {
  const text = String(formula).replace(/\s+/g, '').replace(/[·.*+]/g, '·');
  if (!text) return { error: 'Enter a formula, for example C6H12O6.' };
  const unknown = new Set();

  const merge = (target, source, multiplier) => {
    Object.entries(source).forEach(([symbol, count]) => {
      target[symbol] = (target[symbol] || 0) + count * multiplier;
    });
  };

  const parseBody = (body) => {
    const root = {};
    const stack = [root];
    let index = 0;
    while (index < body.length) {
      const char = body[index];
      if (char === '(' || char === '[' || char === '{') {
        stack.push({});
        index += 1;
        continue;
      }
      if (char === ')' || char === ']' || char === '}') {
        if (stack.length < 2) return { error: 'Unbalanced brackets in the formula.' };
        const inner = stack.pop();
        index += 1;
        let digits = '';
        while (index < body.length && /\d/.test(body[index])) {
          digits += body[index];
          index += 1;
        }
        merge(stack[stack.length - 1], inner, digits ? Number(digits) : 1);
        continue;
      }
      const symbol = body.slice(index).match(/^[A-Z][a-z]*/);
      if (!symbol) return { error: 'Could not read "' + char + '" in the formula.' };
      index += symbol[0].length;
      let digits = '';
      while (index < body.length && /\d/.test(body[index])) {
        digits += body[index];
        index += 1;
      }
      if (!ATOMS[symbol[0]]) unknown.add(symbol[0]);
      merge(stack[stack.length - 1], { [symbol[0]]: digits ? Number(digits) : 1 }, 1);
    }
    if (stack.length !== 1) return { error: 'Unbalanced brackets in the formula.' };
    return { counts: root };
  };

  const total = {};
  const parts = text.split('·').filter(Boolean);
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    const part = parts[partIndex];
    const lead = part.match(/^(\d+(?:\.\d+)?)(.*)$/);
    const multiplier = lead ? Number(lead[1]) : 1;
    const body = lead ? lead[2] : part;
    const parsed = parseBody(body);
    if (parsed.error) return { error: parsed.error };
    merge(total, parsed.counts, multiplier);
  }
  return { counts: total, unknown: [...unknown] };
};

export default function MolarMass() {
  const [formula, setFormula] = useState('CuSO4·5H2O');
  const [grams, setGrams] = useState('25');
  const [volume, setVolume] = useState('500');

  const result = useMemo(() => {
    const parsed = parseFormula(formula);
    if (parsed.error) return { error: parsed.error };
    const entries = Object.entries(parsed.counts).map(([symbol, count]) => {
      const weight = ATOMS[symbol] || 0;
      return { symbol, count, weight, mass: weight * count };
    });
    const total = entries.reduce((sum, entry) => sum + entry.mass, 0);
    if (!total) return { error: 'No recognised elements — check the symbols.' };
    const composition = entries
      .map((entry) => ({ ...entry, percent: (entry.mass / total) * 100 }))
      .sort((a, b) => b.percent - a.percent);
    const mass = Number(grams) || 0;
    const moles = mass / total;
    const litres = (Number(volume) || 0) / 1000;
    return {
      entries: composition,
      total,
      unknown: parsed.unknown,
      atomCount: entries.reduce((sum, entry) => sum + entry.count, 0),
      mass,
      moles,
      millimoles: moles * 1000,
      molarity: litres ? moles / litres : 0,
      molecules: moles * 6.02214076e23,
      heaviest: composition[0],
    };
  }, [formula, grams, volume]);

  const report = useMemo(() => {
    if (result.error) return result.error;
    const lines = [
      formula + ' — molar mass ' + result.total.toFixed(3) + ' g/mol',
      '',
      ...result.entries.map((entry) => '  ' + entry.symbol + ' × ' + entry.count + ' = ' + entry.mass.toFixed(3) + ' g/mol  (' + entry.percent.toFixed(2) + '%)'),
      '',
      result.mass + ' g ÷ ' + result.total.toFixed(3) + ' g/mol = ' + result.moles.toFixed(5) + ' mol',
    ];
    if (result.molarity) lines.push('In ' + volume + ' mL that is a ' + result.molarity.toFixed(4) + ' mol/L solution');
    return lines.join('\n');
  }, [result, formula, grams, volume]);

  const massNote = 'from ' + result.mass + ' g';
  const netNote = result.heaviest ? result.heaviest.symbol + ' dominant' : 'composition';

  return (
    <ToolShell
      toolId="molar-mass"
      icon={FlaskConical}
      title="Molar Mass & Solution Calculator"
      desc="Any chemical formula — brackets, hydrates and all — turned into molar mass, percentage composition by element, and the grams-to-moles-to-molarity chain."
      state={{ formula, grams, volume }}
      onRestore={(restored) => {
        if (typeof restored.formula === 'string') setFormula(restored.formula);
        if (restored.grams !== undefined) setGrams(String(restored.grams));
        if (restored.volume !== undefined) setVolume(String(restored.volume));
      }}
      exportText={report}
      exportName="molar-mass.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <Field label="Formula" hint="Use brackets for groups and · for hydrates">
          <input
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            spellCheck={false}
            placeholder="Ca(OH)2"
            className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j"
          />
        </Field>
        <Field label="Mass in grams">
          <input value={grams} onChange={(e) => setGrams(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Dissolved in mL (optional)">
          <input value={volume} onChange={(e) => setVolume(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {['H2O', 'NaCl', 'C6H12O6', 'Ca(OH)2', 'H2SO4', 'CaCO3', 'CuSO4·5H2O', 'KMnO4', 'Fe2(SO4)3', 'C2H5OH', 'Mg(NO3)2', 'NaHCO3'].map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => setFormula(sample)}
            className={sample === formula
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
          {result.unknown.length > 0 && (
            <Panel className="border-amber-500/40 text-[11px] text-amber-400">
              Unknown symbol{result.unknown.length > 1 ? 's' : ''}: {result.unknown.join(', ')} — those elements contributed no mass.
            </Panel>
          )}

          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              label={'Molar mass of ' + formula}
              value={result.total.toFixed(3)}
              unit="g/mol"
              sub={result.atomCount + ' atoms per formula unit · heaviest element is ' + result.heaviest.symbol + ' at ' + result.heaviest.percent.toFixed(1) + '% of the mass'}
            />
            <Ring
              value={result.heaviest.percent}
              max={100}
              label={result.heaviest.symbol + ' share of mass'}
              sub={result.heaviest.symbol + ' contributes ' + result.heaviest.mass.toFixed(2) + ' of ' + result.total.toFixed(2) + ' g/mol'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Where the mass actually comes from</div>
            <Bars
              data={result.entries.slice(0, 8).map((entry) => ({ label: entry.symbol, value: Number(entry.percent.toFixed(2)) }))}
              format={(value) => value.toFixed(1)}
              suffix="%"
              highlightLast={false}
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              A formula unit is one part by definition; the percentages above are the mass each element brings to it. That is why water is not two thirds
              hydrogen by weight even though it is two thirds hydrogen by count — oxygen is simply sixteen times heavier.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Element by element</span>
              <CopyBtn value={report} label="Copy working" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 text-left font-medium">Element</th>
                    <th className="py-1 text-right font-medium">Atoms</th>
                    <th className="py-1 text-right font-medium">g/mol each</th>
                    <th className="py-1 text-right font-medium">Contribution</th>
                    <th className="py-1 text-right font-medium">Mass %</th>
                  </tr>
                </thead>
                <tbody className="font-mono-j">
                  {result.entries.map((entry) => (
                    <tr key={entry.symbol} className="border-t border-border/50">
                      <td className="py-1 text-cyan-j">{entry.symbol}</td>
                      <td className="py-1 text-right">{entry.count}</td>
                      <td className="py-1 text-right text-muted-foreground">{entry.weight}</td>
                      <td className="py-1 text-right">{entry.mass.toFixed(3)}</td>
                      <td className="py-1 text-right">{entry.percent.toFixed(2)}%</td>
                    </tr>
                  ))}
                  <tr className="border-t border-cyan-j/40">
                    <td className="py-1 text-cyan-j">Total</td>
                    <td className="py-1 text-right">{result.atomCount}</td>
                    <td className="py-1 text-right text-muted-foreground">—</td>
                    <td className="py-1 text-right">{result.total.toFixed(3)}</td>
                    <td className="py-1 text-right">100%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Grams, moles and particles</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Moles in {result.mass} g</span>
                  <span className="text-cyan-j">{result.moles.toFixed(5)} mol</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Millimoles</span>
                  <span>{result.millimoles.toFixed(3)} mmol</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Formula units</span>
                  <span>{result.molecules.toExponential(3)}</span>
                </div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Molarity in {volume || 0} mL</span>
                  <span className="text-cyan-j">{result.molarity.toFixed(4)} mol/L</span>
                </div>
              </div>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">How the parser reads a formula</div>
              <div className="space-y-1 text-[11px] text-muted-foreground">
                <p>· A bare symbol is one atom: <span className="font-mono-j text-cyan-j">O</span> is one oxygen.</p>
                <p>· A trailing number multiplies it: <span className="font-mono-j text-cyan-j">H2</span> is two hydrogens.</p>
                <p>· Brackets group and multiply everything inside: <span className="font-mono-j text-cyan-j">Ca(OH)2</span> means one calcium, two oxygen, two hydrogen.</p>
                <p>· A dot starts a hydrate: <span className="font-mono-j text-cyan-j">CuSO4·5H2O</span> adds five waters on top of the salt.</p>
                <p>· A leading number multiplies a whole part: <span className="font-mono-j text-cyan-j">2H2O</span> is two waters, doubled again.</p>
                <p>· Molar mass is the sum of every standard atomic weight: {result.total.toFixed(3)} g/mol here.</p>
              </div>
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Molar mass" value={result.total.toFixed(2)} mono sub="g/mol" />
            <Stat label="Atoms" value={String(result.atomCount)} mono sub="per unit" />
            <Stat label="Moles" value={result.moles.toFixed(4)} mono sub={massNote} />
            <Stat label="Elements" value={String(result.entries.length)} mono sub={netNote} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Standards used</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Atomic weights are the IUPAC standard values rounded for coursework; heavier synthetic elements use their most stable isotope mass.</p>
              <p>· Moles use 6.02214076 × 10²³ particles, the exact 2019 SI definition.</p>
              <p>· Molarity assumes the solute adds no volume of its own — the usual assumption for lab work at these concentrations.</p>
              <p>· Percentage composition is by mass, which is what gravimetric analysis and yield calculations need.</p>
              <p>· A hydrate's water is included in the molar mass, so CuSO4·5H2O weighs more than anhydrous CuSO4 — weigh carefully when a method assumes the dry salt.</p>
            </div>
            <div className="mt-2">
              <Pills
                items={[
                  { label: 'Formula', value: formula },
                  { label: 'Molar mass', value: result.total.toFixed(2) + ' g/mol' },
                  { label: 'Elements', value: result.entries.map((entry) => entry.symbol).join(' ') },
                ]}
              />
            </div>
          </Panel>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              Everything is computed from the formula you type: the parser walks brackets, multipliers and hydrate dots, counts each element, and multiplies the
              counts by standard atomic weights. Nothing is looked up from a table of known compounds, so an unusual or hypothetical formula works exactly the
              same as a common one.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}