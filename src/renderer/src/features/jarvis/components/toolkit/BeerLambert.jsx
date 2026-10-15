import { useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const TEST_POINTS = [0.1, 0.3, 0.5, 0.75, 1, 1.5, 2];

const sci = (value, digits = 4) => {
  if (!Number.isFinite(value) || value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e4 || size < 1e-3) return value.toExponential(digits);
  return value.toPrecision(digits);
};

export default function BeerLambert() {
  const [mode, setMode] = useState('absorbance');
  const [epsilon, setEpsilon] = useState('15000');
  const [path, setPath] = useState('1');
  const [absorbance, setAbsorbance] = useState('0.65');
  const [concentration, setConcentration] = useState('0.0000433');
  const [molarMass, setMolarMass] = useState('180.16');
  const [stockConc, setStockConc] = useState('0.01');
  const [stockVolume, setStockVolume] = useState('1');
  const [targetConc, setTargetConc] = useState('0.0002');
  const [targetVolume, setTargetVolume] = useState('10');
  const [steps, setSteps] = useState('4');
  const [factor, setFactor] = useState('10');

  const result = useMemo(() => {
    const e = Math.max(1e-6, Number(epsilon) || 0);
    const l = Math.max(1e-4, Number(path) || 1);
    const m = Math.max(1e-6, Number(molarMass) || 1);

    const inputAbsorbance = Math.max(0, Number(absorbance) || 0);
    const inputConcentration = Math.max(0, Number(concentration) || 0);

    const resolvedConcentration = mode === 'concentration' ? inputAbsorbance / (e * l) : inputConcentration;
    const resolvedAbsorbance = mode === 'concentration' ? inputAbsorbance : e * resolvedConcentration * l;
    const transmittance = Math.pow(10, -resolvedAbsorbance);
    const massConcentration = resolvedConcentration * m;

    const reliability = resolvedAbsorbance <= 0 ? 'none'
      : resolvedAbsorbance < 0.1 ? 'low'
      : resolvedAbsorbance <= 1 ? 'ideal'
      : resolvedAbsorbance <= 2 ? 'stretched'
      : 'unreliable';

    const reliabilityNote = {
      none: 'Nothing is absorbing, so there is no signal to measure.',
      low: 'The absorbance is very low, so the relative error in the reading is large. Use a longer path length or a more concentrated sample.',
      ideal: 'This sits in the region where absorbance is most nearly proportional to concentration, which is where quantitative work belongs.',
      stretched: 'Above about 1 the relationship starts to bend. Still usable for a rough figure, but not for careful quantitation.',
      unreliable: 'Above 2 the detector is near its limit and stray light dominates. Dilute the sample and measure again.',
    }[reliability];

    const curve = TEST_POINTS.map((value) => ({
      label: String(value),
      value: Number((Math.pow(10, -value) * 100).toFixed(1)),
    }));

    const stock = Math.max(1e-9, Number(stockConc) || 0);
    const available = Math.max(0, Number(stockVolume) || 0);
    const wanted = Math.max(1e-9, Number(targetConc) || 0);
    const finalVolume = Math.max(0, Number(targetVolume) || 0);
    const fold = stock / wanted;
    const stockNeeded = (wanted * finalVolume) / stock;
    const diluent = Math.max(0, finalVolume - stockNeeded);
    const enoughStock = stockNeeded <= available;
    const stepCount = Math.max(1, Math.min(8, Number(steps) || 1));
    const stepFactor = Math.max(2, Number(factor) || 10);
    const series = Array.from({ length: stepCount }, (unused, index) => ({
      step: index + 1,
      concentration: stock / Math.pow(stepFactor, index + 1),
      fold: Math.pow(stepFactor, index + 1),
    }));

    return {
      mode, e, l, m, resolvedConcentration, resolvedAbsorbance, transmittance, massConcentration, reliability, reliabilityNote, curve,
      fold, stockNeeded, diluent, enoughStock, available, series, stepFactor, stepCount,
      percentageTransmitted: transmittance * 100,
      linearMargin: resolvedAbsorbance > 1 ? resolvedAbsorbance - 1 : 0,
    };
  }, [mode, epsilon, path, absorbance, concentration, molarMass, stockConc, stockVolume, targetConc, targetVolume, steps, factor]);

  const report = useMemo(() => (mode === 'dilution'
    ? [
      'Dilution: ' + sci(Number(stockConc)) + ' M stock to ' + sci(Number(targetConc)) + ' M',
      'Take ' + result.stockNeeded.toFixed(4) + ' volume units of stock, make up to ' + Number(targetVolume) + ' with diluent',
      'Diluent needed: ' + result.diluent.toFixed(4) + ' volume units',
      'Dilution factor: ' + result.fold.toFixed(2) + ' fold',
      result.enoughStock ? 'Stock available is sufficient.' : 'Warning: only ' + result.available + ' volume units of stock available.',
      '',
      'Serial dilution at ' + result.stepFactor + ' fold per step:',
      ...result.series.map((row) => '  step ' + row.step + ': ' + sci(row.concentration) + ' M (' + row.fold + ' fold)'),
    ].join('\n')
    : [
      'Beer-Lambert calculation',
      'Molar absorptivity ' + sci(result.e) + ' L mol⁻¹ cm⁻¹ at a path length of ' + result.l + ' cm',
      'Absorbance ' + result.resolvedAbsorbance.toFixed(4),
      'Concentration ' + sci(result.resolvedConcentration) + ' mol/L',
      'Mass concentration ' + sci(result.massConcentration) + ' g/L',
      'Transmittance ' + (result.percentageTransmitted).toFixed(2) + '%',
      'Reliability: ' + result.reliability + ' — ' + result.reliabilityNote,
    ].join('\n')), [mode, result, stockConc, targetConc, targetVolume]);

  return (
    <ToolShell
      toolId="beer-lambert"
      icon={FlaskConical}
      title="Beer-Lambert & Dilution Lab"
      desc="Absorbance, concentration, molar absorptivity and path length solved in any direction, with transmittance, the reliable measurement window and a dilution and serial dilution planner."
      state={{ mode, epsilon, path, absorbance, concentration, molarMass, stockConc, stockVolume, targetConc, targetVolume, steps, factor }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.epsilon !== undefined) setEpsilon(String(restored.epsilon));
        if (restored.path !== undefined) setPath(String(restored.path));
        if (restored.absorbance !== undefined) setAbsorbance(String(restored.absorbance));
        if (restored.concentration !== undefined) setConcentration(String(restored.concentration));
        if (restored.molarMass !== undefined) setMolarMass(String(restored.molarMass));
        if (restored.stockConc !== undefined) setStockConc(String(restored.stockConc));
        if (restored.stockVolume !== undefined) setStockVolume(String(restored.stockVolume));
        if (restored.targetConc !== undefined) setTargetConc(String(restored.targetConc));
        if (restored.targetVolume !== undefined) setTargetVolume(String(restored.targetVolume));
        if (restored.steps !== undefined) setSteps(String(restored.steps));
        if (restored.factor !== undefined) setFactor(String(restored.factor));
      }}
      exportText={report}
      exportName="lab-calculation.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[{ value: 'absorbance', label: 'Concentration to absorbance' }, { value: 'concentration', label: 'Absorbance to concentration' }, { value: 'dilution', label: 'Dilution planner' }]}
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Molar absorptivity ε, L mol⁻¹ cm⁻¹"><input value={epsilon} onChange={(e) => setEpsilon(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Path length, cm"><input value={path} onChange={(e) => setPath(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        {mode === 'concentration'
          ? <Field label="Measured absorbance"><input value={absorbance} onChange={(e) => setAbsorbance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          : <Field label="Concentration, mol/L"><input value={concentration} onChange={(e) => setConcentration(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>}
        <Field label="Molar mass, g/mol"><input value={molarMass} onChange={(e) => setMolarMass(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      {mode === 'dilution' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Stock concentration, mol/L"><input value={stockConc} onChange={(e) => setStockConc(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Stock volume available"><input value={stockVolume} onChange={(e) => setStockVolume(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Target concentration, mol/L"><input value={targetConc} onChange={(e) => setTargetConc(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Final volume wanted"><input value={targetVolume} onChange={(e) => setTargetVolume(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Serial dilution steps"><input value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Fold per step"><input value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={result.enoughStock ? 'emerald' : 'rose'}
              label="Stock to take"
              value={result.stockNeeded.toFixed(3)}
              unit="volume units"
              sub={'Add ' + result.diluent.toFixed(3) + ' volume units of diluent to reach ' + Number(targetVolume) + '. That is a ' + result.fold.toFixed(1) + ' fold dilution.' + (result.enoughStock ? ' You have enough stock.' : ' You only have ' + result.available + ' available, which is not enough.')}
            />
            <Ring
              value={result.fold}
              max={Math.max(10, result.fold)}
              tone={result.enoughStock ? 'emerald' : 'rose'}
              label="Dilution factor"
              sub={'One part stock to ' + (result.fold - 1).toFixed(2) + ' parts diluent'}
            />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">Serial dilution ladder</span>
              <CopyBtn value={report} label="Copy" />
            </div>
            <div className="space-y-1.5">
              {result.series.map((row) => (
                <div key={row.step} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                  <span className="text-muted-foreground">Step {row.step} · 1 in {row.fold}</span>
                  <span className="text-cyan-j">{sci(row.concentration)} mol/L</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Serial dilution is more accurate than one large dilution because each step keeps the volumes comfortably pipettable. Ten steps of 10 fold reach 10⁻¹⁰, which no single
              transfer could deliver reliably.
            </p>
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={result.reliability === 'ideal' ? 'emerald' : result.reliability === 'unreliable' || result.reliability === 'low' ? 'rose' : 'amber'}
              label={mode === 'concentration' ? 'Concentration' : 'Absorbance'}
              value={mode === 'concentration' ? sci(result.resolvedConcentration) : result.resolvedAbsorbance.toFixed(4)}
              unit={mode === 'concentration' ? 'mol/L' : ''}
              sub={'Transmittance ' + result.percentageTransmitted.toFixed(2) + '%, and the mass concentration is ' + sci(result.massConcentration) + ' g/L. ' + result.reliabilityNote}
            />
            <Ring
              value={result.percentageTransmitted}
              max={100}
              tone={result.reliability === 'ideal' ? 'emerald' : 'amber'}
              label="Light transmitted"
              sub={result.reliability === 'ideal' ? 'Inside the reliable measurement window' : 'Outside the ideal window of 0.1 to 1.0 absorbance'}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Transmittance falls fast with absorbance</div>
              <Bars
                data={result.curve}
                format={(value) => value.toFixed(1)}
                suffix="%"
                highlightLast={false}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Absorbance is logarithmic, so an absorbance of 1 means nine tenths of the light is gone. At an absorbance of 2 only 1% of the light arrives, which is why the
                measurement becomes unreliable up there.
              </p>
            </Panel>
            <Panel className="!p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium">The calculation</span>
                <CopyBtn value={report} label="Copy" />
              </div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Molar absorptivity</span><span>{sci(result.e)}</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Path length</span><span>{result.l} cm</span></div>
                <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Absorbance</span><span className="text-cyan-j">{result.resolvedAbsorbance.toFixed(4)}</span></div>
                <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Concentration</span><span className="text-cyan-j">{sci(result.resolvedConcentration)} mol/L</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Mass concentration</span><span>{sci(result.massConcentration)} g/L</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Transmittance</span><span>{result.percentageTransmitted.toFixed(3)}%</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Molar mass used</span><span>{result.m} g/mol</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Reliability</span><span>{result.reliability}</span></div>
              </div>
            </Panel>
          </div>
        </>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Absorbance" value={result.resolvedAbsorbance.toFixed(4)} mono />
        <Stat label="Transmittance" value={result.percentageTransmitted.toFixed(1) + '%'} mono sub="of the incident light" />
        <Stat label="Concentration" value={sci(result.resolvedConcentration, 3)} mono sub="mol/L" />
        <Stat label="Reliable window" value={result.reliability} mono sub={result.linearMargin > 0 ? result.linearMargin.toFixed(2) + ' above 1.0' : 'inside 0.1 to 1.0'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Measuring absorbance properly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Always blank against pure solvent at the same wavelength, in the same cuvette, before reading samples. The blank removes the cuvette, solvent and instrument offset.</p>
            <p>· Measure at the wavelength of maximum absorbance. The signal is largest there and small errors in wavelength matter least.</p>
            <p>· Keep readings between about 0.1 and 1.0. Below 0.1 the relative error grows sharply; above 1 the response bends away from linear.</p>
            <p>· The path length is part of the equation. A 1 cm cuvette is standard, but a 1 mm cuvette in a microplate changes the arithmetic by ten.</p>
            <p>· Match cuvettes: scratches, fingerprints and bubbles all scatter light and all raise the apparent absorbance.</p>
            <p>· Temperature and pH shift the spectrum of many analytes, so hold them constant between samples and standards.</p>
            <p>· A calibration curve of known standards is still the standard practice. The absorptivity is a useful estimate, but the curve is what proves linearity in your own instrument.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Units and pitfalls</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Absorbance is dimensionless. Molar absorptivity carries units of L mol⁻¹ cm⁻¹, and both concentration in mol/L and path length in cm must match them.</p>
            <p>· Concentration in mol/L times molar mass in g/mol gives g/L, which is often the more useful number in a lab protocol.</p>
            <p>· Percent transmittance and absorbance are not linearly related. Averaging transmittance readings is a common error; convert each to absorbance first.</p>
            <p>· {result.linearMargin > 0 ? 'This reading is ' + result.linearMargin.toFixed(2) + ' absorbance units above the linear ceiling. Dilute tenfold and measure again for a trustworthy figure.' : 'The reading sits inside the linear region, so the concentration figure can be trusted to normal instrument precision.'}</p>
            <p>· Turbidity, not absorption, is often what a high reading actually reflects. Centrifuge or filter a cloudy sample before concluding anything about concentration.</p>
            <p>· Report the wavelength, path length and solvent whenever you quote an absorbance. Without them the number cannot be reproduced.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'Absorbance', value: result.resolvedAbsorbance.toFixed(3) },
                { label: 'Window', value: result.reliability },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>A = ε × c × l</p>
          <p>T = 10⁻ᴬ · percentage transmittance = 100 × T</p>
          <p>c = A ÷ (ε × l) · mass concentration = c × molar mass</p>
          <p>C₁V₁ = C₂V₂ for a single dilution · V of stock = C₂V₂ ÷ C₁</p>
          <p>serial dilution: C = C_stock ÷ factorⁿ</p>
          <p className="text-cyan-j">Check: {sci(result.e, 3)} × {sci(result.resolvedConcentration, 3)} × {result.l} = {result.resolvedAbsorbance.toFixed(4)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Beer-Lambert holds for dilute solutions of a single absorbing species with no scattering and no chemical change on dilution. Real samples break one of those assumptions
          more often than not, which is why a calibration curve from standards is the measurement of record.
        </p>
      </Panel>
    </ToolShell>
  );
}