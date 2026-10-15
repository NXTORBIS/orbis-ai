import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const R = 8.314462618;
const AVOGADRO = 6.02214076e23;

const PRESSURE_UNITS = [
  { value: 'kPa', label: 'kPa' },
  { value: 'atm', label: 'atm' },
  { value: 'mmHg', label: 'mmHg' },
  { value: 'bar', label: 'bar' },
];

const toKpa = (value, unit) => ({ kPa: 1, atm: 101.325, mmHg: 0.1333224, bar: 100 }[unit] * value);
const fromKpa = (value, unit) => value / { kPa: 1, atm: 101.325, mmHg: 0.1333224, bar: 100 }[unit];
const fromLitres = (value, unit) => value * { L: 1, mL: 0.001, m3: 1000 }[unit];
const toLitres = (value, unit) => value / { L: 1, mL: 0.001, m3: 1000 }[unit];
const toKelvin = (value, unit) => (unit === 'C' ? value + 273.15 : value);

const MODES = [
  { value: 'ideal', label: 'PV = nRT' },
  { value: 'combined', label: 'Combined gas law' },
  { value: 'molar', label: 'Molar volume & density' },
  { value: 'dalton', label: 'Partial pressures' },
  { value: 'graham', label: 'Effusion' },
];

export default function GasLaws() {
  const [mode, setMode] = useState('ideal');
  const [v, setV] = useState({
    p: 101.325, pUnit: 'kPa', volume: 22.4, vUnit: 'L', moles: 1, temp: 0, tUnit: 'C', solve: 'volume',
    p1: 1, p1Unit: 'atm', v1: 2, t1: 25, p2: 1, p2Unit: 'atm', v2: 1, t2: 25, solve2: 'v2',
    molarMass: 44.01, targetVolume: 1,
    gasA: 2, gasB: 1, gasC: 0, molarB: 32, molarC: 28,
    molar1: 44.01, molar2: 2.016,
  });

  const set = (key, value) => setV((current) => ({ ...current, [key]: value }));
  const num = (key) => Number(v[key]) || 0;

  const result = useMemo(() => {
    if (mode === 'ideal') {
      const P = toKpa(num('p'), v.pUnit);
      const V = toLitres(num('volume'), v.vUnit);
      const n = num('moles');
      const T = toKelvin(num('temp'), v.tUnit);
      const rows = [];
      let hero = { value: '—', unit: '', label: 'Answer', sub: '' };
      let steps = [];

      if (v.solve === 'volume') {
        const answer = (n * R * T) / (P || 1);
        const answerL = fromLitres(answer, v.vUnit);
        hero = { value: answerL.toPrecision(4), unit: v.vUnit, label: 'Volume', sub: 'nRT ÷ P' };
        steps = ['V = nRT ÷ P', 'V = (' + n + ' mol × ' + R.toFixed(5) + ' × ' + T.toFixed(2) + ' K) ÷ ' + P.toFixed(3) + ' kPa', 'V = ' + answer.toFixed(6) + ' L'];
        rows.push({ label: 'Volume', value: answer.toFixed(6) + ' L' });
      } else if (v.solve === 'pressure') {
        const answer = (n * R * T) / (V || 1);
        hero = { value: fromKpa(answer, v.pUnit).toPrecision(4), unit: v.pUnit, label: 'Pressure', sub: 'nRT ÷ V' };
        steps = ['P = nRT ÷ V', 'P = (' + n + ' × ' + R.toFixed(5) + ' × ' + T.toFixed(2) + ') ÷ ' + V.toFixed(4) + ' L', 'P = ' + answer.toFixed(4) + ' kPa'];
        rows.push({ label: 'Pressure', value: answer.toFixed(4) + ' kPa' });
      } else if (v.solve === 'moles') {
        const answer = (P * V) / (R * (T || 1));
        hero = { value: answer.toPrecision(4), unit: 'mol', label: 'Amount', sub: 'PV ÷ RT' };
        steps = ['n = PV ÷ RT', 'n = (' + P.toFixed(3) + ' × ' + V.toFixed(4) + ') ÷ (' + R.toFixed(5) + ' × ' + T.toFixed(2) + ')', 'n = ' + answer.toFixed(6) + ' mol'];
        rows.push({ label: 'Amount', value: answer.toFixed(6) + ' mol' });
      } else {
        const answer = (P * V) / (n * R || 1);
        hero = { value: answer.toPrecision(4), unit: 'K', label: 'Temperature', sub: (answer - 273.15).toFixed(2) + ' °C' };
        steps = ['T = PV ÷ nR', 'T = (' + P.toFixed(3) + ' × ' + V.toFixed(4) + ') ÷ (' + n + ' × ' + R.toFixed(5) + ')', 'T = ' + answer.toFixed(4) + ' K'];
        rows.push({ label: 'Temperature', value: answer.toFixed(4) + ' K (' + (answer - 273.15).toFixed(2) + ' °C)' });
      }

      rows.push(
        { label: 'Standard conditions', value: P === 101.325 && Math.abs(toKelvin(num('temp'), v.tUnit) - 273.15) < 0.5 ? 'yes — 0 °C, 1 atm' : 'no' },
        { label: 'Molar volume here', value: ((R * T) / (P || 1)).toFixed(4) + ' L/mol' },
        { label: 'Molecules', value: (((P * V) / (R * (T || 1))) * AVOGADRO).toExponential(3) },
        { label: 'Density of air at this state', value: (((P * 28.97) / (R * T))).toFixed(4) + ' g/L' },
      );
      return { hero, rows, steps, warnings: T <= 0 ? ['Temperature must be above absolute zero — check that you did not enter kelvin in a Celsius field.'] : [] };
    }

    if (mode === 'combined') {
      const P1 = toKpa(num('p1'), v.p1Unit);
      const V1 = toLitres(num('v1'), 'L');
      const T1 = toKelvin(num('t1'), 'C');
      const P2 = toKpa(num('p2'), v.p2Unit);
      const V2 = toLitres(num('v2'), 'L');
      const T2 = toKelvin(num('t2'), 'C');
      let hero = { value: '—', unit: '', label: 'Answer', sub: '' };
      let steps = [];
      const rows = [];

      if (v.solve2 === 'v2') {
        const answer = (P1 * V1 * T2) / (T1 * (P2 || 1));
        hero = { value: answer.toPrecision(4), unit: 'L', label: 'Volume after', sub: 'P₁V₁/T₁ = P₂V₂/T₂' };
        steps = ['V₂ = P₁V₁T₂ ÷ (T₁P₂)', 'V₂ = (' + P1.toFixed(2) + ' × ' + V1.toFixed(3) + ' × ' + T2.toFixed(2) + ') ÷ (' + T1.toFixed(2) + ' × ' + P2.toFixed(2) + ')', 'V₂ = ' + answer.toFixed(6) + ' L'];
        rows.push({ label: 'Volume', value: answer.toFixed(6) + ' L' });
      } else if (v.solve2 === 'p2') {
        const answer = (P1 * V1 * T2) / (T1 * (V2 || 1));
        hero = { value: fromKpa(answer, v.p2Unit).toPrecision(4), unit: v.p2Unit, label: 'Pressure after', sub: 'P₁V₁/T₁ = P₂V₂/T₂' };
        steps = ['P₂ = P₁V₁T₂ ÷ (T₁V₂)', 'P₂ = (' + P1.toFixed(2) + ' × ' + V1.toFixed(3) + ' × ' + T2.toFixed(2) + ') ÷ (' + T1.toFixed(2) + ' × ' + V2.toFixed(3) + ')', 'P₂ = ' + answer.toFixed(4) + ' kPa'];
        rows.push({ label: 'Pressure', value: answer.toFixed(4) + ' kPa' });
      } else {
        const answer = (P2 * V2 * T1) / ((P1 * V1) || 1);
        hero = { value: answer.toPrecision(4), unit: 'K', label: 'Temperature after', sub: (answer - 273.15).toFixed(2) + ' °C' };
        steps = ['T₂ = P₂V₂T₁ ÷ (P₁V₁)', 'T₂ = (' + P2.toFixed(2) + ' × ' + V2.toFixed(3) + ' × ' + T1.toFixed(2) + ') ÷ (' + P1.toFixed(2) + ' × ' + V1.toFixed(3) + ')', 'T₂ = ' + answer.toFixed(4) + ' K'];
        rows.push({ label: 'Temperature', value: answer.toFixed(4) + ' K (' + (answer - 273.15).toFixed(2) + ' °C)' });
      }

      rows.push(
        { label: 'Before', value: P1.toFixed(2) + ' kPa · ' + V1.toFixed(3) + ' L · ' + T1.toFixed(2) + ' K' },
        { label: 'After', value: P2.toFixed(2) + ' kPa · ' + V2.toFixed(3) + ' L · ' + T2.toFixed(2) + ' K' },
        { label: 'Ratio P₁V₁/T₁', value: ((P1 * V1) / T1).toFixed(6) },
      );
      return { hero, rows, steps, warnings: [T1 <= 0 || T2 <= 0 ? 'Temperatures must be in kelvin and above zero.' : 'The combined law assumes the amount of gas is unchanged and the gas behaves ideally — close enough for air at ordinary pressures.'] };
    }

    if (mode === 'molar') {
      const molarMass = num('molarMass');
      const P = toKpa(num('p'), v.pUnit);
      const T = toKelvin(num('temp'), v.tUnit);
      const molarVolume = (R * T) / (P || 1);
      const density = molarVolume > 0 ? molarMass / molarVolume : 0;
      const targetVolume = toLitres(num('targetVolume'), v.vUnit);
      const mass = density * targetVolume;
      const moles = targetVolume / molarVolume;
      const hero = { value: molarVolume.toPrecision(4), unit: 'L/mol', label: 'Molar volume', sub: density.toFixed(4) + ' g/L at ' + T.toFixed(2) + ' K and ' + P.toFixed(2) + ' kPa' };
      const rows = [
        { label: 'Molar volume', value: molarVolume.toFixed(4) + ' L/mol' },
        { label: 'At 0 °C, 1 atm (STP)', value: '22.414 L/mol' },
        { label: 'At 25 °C, 1 atm (SATP)', value: '24.465 L/mol' },
        { label: 'Density', value: density.toFixed(4) + ' g/L' },
        { label: 'Moles in ' + targetVolume.toFixed(3) + ' L', value: moles.toFixed(5) + ' mol' },
        { label: 'Mass in ' + targetVolume.toFixed(3) + ' L', value: mass.toFixed(4) + ' g' },
        { label: 'Volume of 1 g', value: (density > 0 ? 1 / density : 0).toFixed(4) + ' L' },
      ];
      return { hero, rows, steps: ['Vₘ = RT ÷ P', 'Vₘ = (' + R.toFixed(5) + ' × ' + T.toFixed(2) + ') ÷ ' + P.toFixed(3), 'Vₘ = ' + molarVolume.toFixed(5) + ' L/mol'], warnings: [] };
    }

    if (mode === 'dalton') {
      const T = toKelvin(num('temp'), v.tUnit);
      const V = toLitres(num('volume'), v.vUnit);
      const gases = [
        { label: 'Gas A', moles: num('gasA') },
        { label: 'Gas B', moles: num('gasB') },
        { label: 'Gas C', moles: num('gasC') },
      ].filter((gas) => gas.moles > 0);
      const totalMoles = gases.reduce((sum, gas) => sum + gas.moles, 0);
      const partials = gases.map((gas) => {
        const pressure = (gas.moles * R * T) / (V || 1);
        return { ...gas, pressure, fraction: totalMoles > 0 ? (gas.moles / totalMoles) * 100 : 0 };
      });
      const totalPressure = partials.reduce((sum, gas) => sum + gas.pressure, 0);
      const averageMolar = totalMoles > 0 ? (num('gasA') * 0 + num('gasB') * num('molarB') + num('gasC') * num('molarC')) / totalMoles : 0;
      const hero = { value: fromKpa(totalPressure, v.pUnit).toPrecision(4), unit: v.pUnit, label: 'Total pressure', sub: totalMoles.toFixed(3) + ' mol in ' + V.toFixed(2) + ' L at ' + T.toFixed(2) + ' K' };
      const rows = [
        ...partials.map((gas) => ({ label: gas.label + ' partial pressure', value: fromKpa(gas.pressure, v.pUnit).toFixed(4) + ' ' + v.pUnit + ' · ' + gas.fraction.toFixed(1) + '%' })),
        { label: 'Total pressure', value: fromKpa(totalPressure, v.pUnit).toFixed(4) + ' ' + v.pUnit },
        { label: 'Total moles', value: totalMoles.toFixed(5) + ' mol' },
        { label: 'Average molar mass', value: averageMolar.toFixed(3) + ' g/mol' },
        { label: 'Gas density', value: T > 0 && V > 0 ? ((averageMolar * totalMoles) / V).toFixed(3) + ' g/L' : '—' },
      ];
      return { hero, rows, steps: ['P(total) = n(total)RT ÷ V', 'Each gas contributes in proportion to its mole fraction, independent of the others.'], warnings: gases.length < 2 ? ['Add a second gas to see partial pressures add up to the total.'] : [] };
    }

    const molar1 = num('molar1');
    const molar2 = num('molar2');
    const rate = Math.sqrt(molar2 / (molar1 || 1));
    const faster = molar1 < molar2 ? 'Gas 1' : 'Gas 2';
    const hero = {
      value: rate.toPrecision(4),
      unit: '×',
      label: 'Relative effusion rate',
      sub: faster + ' escapes about ' + Math.abs((rate - 1) * 100).toFixed(1) + '% ' + (rate > 1 ? 'faster' : 'slower') + ' than the other',
    };
    const rows = [
      { label: 'Rate ratio (gas 1 ÷ gas 2)', value: rate.toFixed(5) },
      { label: 'Time ratio', value: (1 / (rate || 1)).toFixed(5) },
      { label: 'Molar mass ratio', value: (molar2 / (molar1 || 1)).toFixed(5) },
      { label: 'Square root of mass ratio', value: Math.sqrt(molar2 / (molar1 || 1)).toFixed(5) },
      { label: 'Molar masses', value: molar1 + ' and ' + molar2 + ' g/mol' },
    ];
    return {
      hero,
      rows,
      steps: ['rate₁ ÷ rate₂ = √(M₂ ÷ M₁)', '√(' + molar2 + ' ÷ ' + molar1 + ') = ' + rate.toFixed(5), 'Lighter molecules effuse faster — the rate scales with the inverse square root of molar mass.'],
      warnings: [],
    };
  }, [mode, v]);

  const report = [
    'Gas law calculation — ' + (MODES.find((entry) => entry.value === mode) || {}).label,
    '',
    result.hero.label + ': ' + result.hero.value + ' ' + result.hero.unit,
    result.hero.sub,
    '',
    ...result.rows.map((row) => row.label.padEnd(30) + row.value),
    '',
    ...result.steps,
  ].join('\n');

  return (
    <ToolShell
      toolId="gas-laws"
      icon={FlaskConical}
      title="Gas Laws Calculator"
      desc="Ideal gas, the combined law, molar volume and gas density, partial pressures and effusion — in the units a lab actually uses, with the rearranged equation and the substituted numbers shown rather than just an answer."
      state={{ mode, v }}
      onRestore={(restored) => {
        if (typeof restored.mode === 'string') setMode(restored.mode);
        if (restored.v && typeof restored.v === 'object') setV({ ...v, ...restored.v });
      }}
      exportText={report}
      exportName="gas-calculation.txt"
    >
      <Seg value={mode} onChange={setMode} options={MODES} />

      <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel className="!p-3">
          {(mode === 'ideal' || mode === 'molar' || mode === 'dalton') && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Pressure">
                <div className="flex gap-2">
                  <Input type="number" step="any" value={v.p} onChange={(event) => set('p', event.target.value)} />
                  <select value={v.pUnit} onChange={(event) => set('pUnit', event.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    {PRESSURE_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                  </select>
                </div>
              </Field>
              <Field label="Temperature">
                <div className="flex gap-2">
                  <Input type="number" step="any" value={v.temp} onChange={(event) => set('temp', event.target.value)} />
                  <Seg value={v.tUnit} onChange={(value) => set('tUnit', value)} options={[{ value: 'C', label: '°C' }, { value: 'K', label: 'K' }]} />
                </div>
              </Field>
            </div>
          )}

          {(mode === 'ideal' || mode === 'dalton' || mode === 'molar') && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="Volume">
                <div className="flex gap-2">
                  <Input type="number" step="any" value={v.volume} onChange={(event) => set('volume', event.target.value)} />
                  <select value={v.vUnit} onChange={(event) => set('vUnit', event.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                    <option value="L">L</option>
                    <option value="mL">mL</option>
                    <option value="m3">m³</option>
                  </select>
                </div>
              </Field>
              {mode === 'ideal' && (
                <Field label="Amount (mol)"><Input type="number" step="any" value={v.moles} onChange={(event) => set('moles', event.target.value)} /></Field>
              )}
              {mode === 'molar' && (
                <Field label="Molar mass (g/mol)"><Input type="number" step="any" value={v.molarMass} onChange={(event) => set('molarMass', event.target.value)} /></Field>
              )}
            </div>
          )}

          {mode === 'ideal' && (
            <div className="mt-2">
              <Field label="Solve for">
                <Seg
                  value={v.solve}
                  onChange={(value) => set('solve', value)}
                  options={[
                    { value: 'volume', label: 'V' },
                    { value: 'pressure', label: 'P' },
                    { value: 'moles', label: 'n' },
                    { value: 'temp', label: 'T' },
                  ]}
                />
              </Field>
            </div>
          )}

          {mode === 'dalton' && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Moles of A"><Input type="number" step="any" value={v.gasA} onChange={(event) => set('gasA', event.target.value)} /></Field>
              <Field label="Moles of B"><Input type="number" step="any" value={v.gasB} onChange={(event) => set('gasB', event.target.value)} /></Field>
              <Field label="Moles of C"><Input type="number" step="any" value={v.gasC} onChange={(event) => set('gasC', event.target.value)} /></Field>
              <Field label="Molar mass B (g/mol)"><Input type="number" step="any" value={v.molarB} onChange={(event) => set('molarB', event.target.value)} /></Field>
              <Field label="Molar mass C (g/mol)"><Input type="number" step="any" value={v.molarC} onChange={(event) => set('molarC', event.target.value)} /></Field>
            </div>
          )}

          {mode === 'graham' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Molar mass of gas 1 (g/mol)"><Input type="number" step="any" value={v.molar1} onChange={(event) => set('molar1', event.target.value)} /></Field>
              <Field label="Molar mass of gas 2 (g/mol)"><Input type="number" step="any" value={v.molar2} onChange={(event) => set('molar2', event.target.value)} /></Field>
            </div>
          )}

          {mode === 'combined' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Initial pressure (atm)"><Input type="number" step="any" value={v.p1} onChange={(event) => set('p1', event.target.value)} /></Field>
              <Field label="Initial volume (L)"><Input type="number" step="any" value={v.v1} onChange={(event) => set('v1', event.target.value)} /></Field>
              <Field label="Initial temperature (°C)"><Input type="number" step="any" value={v.t1} onChange={(event) => set('t1', event.target.value)} /></Field>
              <Field label="Final pressure (atm)"><Input type="number" step="any" value={v.p2} onChange={(event) => set('p2', event.target.value)} disabled={v.solve2 === 'p2'} /></Field>
              <Field label="Final volume (L)"><Input type="number" step="any" value={v.v2} onChange={(event) => set('v2', event.target.value)} disabled={v.solve2 === 'v2'} /></Field>
              <Field label="Final temperature (°C)"><Input type="number" step="any" value={v.t2} onChange={(event) => set('t2', event.target.value)} disabled={v.solve2 === 't2'} /></Field>
              <div className="sm:col-span-2">
                <Field label="Solve for">
                  <Seg
                    value={v.solve2}
                    onChange={(value) => set('solve2', value)}
                    options={[
                      { value: 'p2', label: 'Final P' },
                      { value: 'v2', label: 'Final V' },
                      { value: 't2', label: 'Final T' },
                    ]}
                  />
                </Field>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            {result.rows.map((row) => (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-mono-j text-cyan-j">{row.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-3">
          <Hero tone="cyan" label={result.hero.label} value={result.hero.value} unit={result.hero.unit} sub={result.hero.sub} />

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The working</div>
            <div className="space-y-1">
              {result.steps.map((step) => (
                <div key={step} className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 font-mono-j text-[11px] text-muted-foreground">{step}</div>
              ))}
            </div>
            {result.warnings.length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
                {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
              </div>
            )}
          </Panel>

          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Gas constant" value="8.31446" mono sub="kPa·L/mol·K" />
            <Stat label="Absolute zero" value="−273.15 °C" mono sub="0 K, never reached" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Units that trip people up</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The gas constant depends on the units. 8.314 works with kPa and litres; 0.08206 works with atmospheres and litres. Mixing them is the most common error in these problems.</p>
            <p>· Temperature must be absolute. Doubling 20 °C does not double the volume, because 20 °C is 293 K — and 0 °C is 273 K, not zero.</p>
            <p>· Molar volume is not a constant. It is 22.414 L/mol at 0 °C and 1 atm, and 24.465 L/mol at the 25 °C standard many labs use now.</p>
            <p>· One atmosphere is 101.325 kPa, 760 mmHg, or 1.01325 bar. mmHg (torr) and millibar differ by a factor of about 1.333, which is easy to miss in weather data.</p>
            <p>· A litre is a thousandth of a cubic metre, so m³ figures look a thousand times smaller and errors hide easily.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where real gases stop agreeing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Ideal behaviour assumes no molecular volume and no attraction between molecules. Both are wrong, and both matter more as pressure rises.</p>
            <p>· Near condensation, or above a few atmospheres, the ideal result drifts by several per cent. Van der Waals corrections or a compressibility factor are needed there.</p>
            <p>· At ordinary room conditions for air, nitrogen or oxygen, the ideal law is accurate to well under a per cent — which is why it is used everywhere in practice.</p>
            <p>· Dalton's law of partial pressures holds well for non-reacting mixtures. For gases that dissociate or react, the equilibrium changes the mole count.</p>
            <p>· Graham's law describes effusion through a small hole. Through a porous plug or a membrane, the mechanism changes and so does the answer.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'R', value: '8.31446' },
                { label: 'Units', value: 'kPa · L · mol · K' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every answer is the ideal gas law rearranged for whichever quantity you are missing, with the substitution shown so you can check the unit handling yourself.
          Densities use the molar mass you enter, and partial pressures come from the moles of each gas in the mixture. Real-gas corrections, reaction equilibria and
          non-ideal behaviour at high pressure are outside what this calculates.
        </p>
      </Panel>
    </ToolShell>
  );
}