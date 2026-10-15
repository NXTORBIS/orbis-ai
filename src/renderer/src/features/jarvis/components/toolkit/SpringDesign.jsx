import { useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const MATERIALS = [
  { id: 'music', label: 'Music wire', g: 79.3, tensile: 1900, note: 'Standard spring steel, great fatigue life' },
  { id: 'stainless', label: '302 stainless', g: 69, tensile: 1500, note: 'Corrosion resistance, slightly softer' },
  { id: 'chrome', label: 'Chrome silicon', g: 77.2, tensile: 1750, note: 'High temperature and shock loads' },
  { id: 'phosphor', label: 'Phosphor bronze', g: 41.4, tensile: 800, note: 'Non-magnetic and conductive' },
];

const ENDS = [
  { id: 'closed', label: 'Closed, ground', activeAdd: 2, solidExtra: 0, note: 'Loads evenly, flat seats' },
  { id: 'closedPlain', label: 'Closed, not ground', activeAdd: 2, solidExtra: 0.5, note: 'Cheaper, seats less flat' },
  { id: 'open', label: 'Open ends', activeAdd: 0, solidExtra: 0, note: 'Loads less evenly, more travel' },
];

export default function SpringDesign() {
  const [material, setMaterial] = useState('music');
  const [ends, setEnds] = useState('closed');
  const [wire, setWire] = useState('1.2');
  const [outerDia, setOuterDia] = useState('12');
  const [coils, setCoils] = useState('10');
  const [freeLength, setFreeLength] = useState('40');
  const [load, setLoad] = useState('50');
  const [cycles, setCycles] = useState('1000000');
  const [safety, setSafety] = useState('1.5');
  const [extra, setExtra] = useState({ guided: false, hot: false, parallel: false });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const mat = MATERIALS.find((entry) => entry.id === material) || MATERIALS[0];
    const end = ENDS.find((entry) => entry.id === ends) || ENDS[0];
    const d = Math.max(0.1, Number(wire) || 1);
    const od = Math.max(d * 1.2, Number(outerDia) || 12);
    const D = od - d;
    const n = Math.max(1, Number(coils) || 10);
    const Lf = Math.max(d * 3, Number(freeLength) || 40);
    const F = Math.max(0, Number(load) || 0);
    const targetCycles = Math.max(1, Number(cycles) || 1e6);
    const sf = Math.max(1, Number(safety) || 1.5);

    const index = D / d;
    const k = (mat.g * 1000 * d ** 4) / (8 * D ** 3 * n); // N/mm
    const ratePerMm = extra.parallel ? k * 2 : k;
    const totalCoils = n + end.activeAdd;
    const solidLength = (totalCoils + end.solidExtra) * d;
    const deflection = F / ratePerMm;
    const lengthAtLoad = Lf - deflection;
    const travel = Lf - solidLength;
    const travelUsed = travel > 0 ? deflection / travel : 1;

    // Wahl factor accounts for both direct shear and coil curvature.
    const wahl = (4 * index - 1) / (4 * index - 4) + 0.615 / index;
    const rawStress = (8 * F * D) / (Math.PI * d ** 3);
    const stress = rawStress * wahl;
    const allowable = mat.tensile * 0.45;
    const temperatureFactor = extra.hot ? 0.85 : 1;
    const effectiveAllowable = allowable * temperatureFactor;
    const stressRatio = stress / Math.max(1, effectiveAllowable);

    // Compression springs buckle when the free length is more than about four times the mean diameter unguided.
    const slenderness = Lf / D;
    const buckleLimit = extra.guided ? 8 : 4;
    const buckles = slenderness > buckleLimit;

    // Fatigue estimate: Goodman style reduction for a million cycles and beyond.
    const fatigueFactor = targetCycles > 1e6 ? 0.42 : targetCycles > 1e5 ? 0.5 : targetCycles > 1e4 ? 0.6 : 0.75;
    const fatigueAllowable = effectiveAllowable * fatigueFactor;
    const fatigueMargin = fatigueAllowable / Math.max(0.01, stress / Math.max(1, sf));

    const energy = (0.5 * ratePerMm * deflection ** 2) / 1000; // joules
    const mass = ((Math.PI * d * d) / 4) * (Math.PI * D * totalCoils) * (mat.g > 70 ? 7.85e-6 : 6.2e-6) * 1000;
    const weight = (mass / 1000) * 9.81;

    const loadTable = [0.25, 0.5, 0.75, 1, 1.25].map((factor) => ({
      label: (factor * 100).toFixed(0) + '%',
      value: Number(((F * factor)).toFixed(1)),
      deflection: deflection * factor,
      stress: stress * factor,
    }));

    const travelChart = [
      { label: 'Solid', value: Number(solidLength.toFixed(1)) },
      { label: 'At load', value: Number(lengthAtLoad.toFixed(1)) },
      { label: 'Free', value: Number(Lf.toFixed(1)) },
    ];

    const warnings = [];
    if (index < 4) warnings.push('Spring index is ' + index.toFixed(2) + '. Below four the coils are hard to form and stress concentrates sharply — aim for 5 to 12.');
    if (index > 14) warnings.push('Spring index of ' + index.toFixed(2) + ' is very high. The spring will tangle easily and may buckle sideways under load.');
    if (stressRatio > 1) warnings.push('Working stress ' + stress.toFixed(0) + ' MPa exceeds the allowable ' + effectiveAllowable.toFixed(0) + ' MPa. Increase the wire diameter or reduce the load.');
    if (lengthAtLoad < solidLength) warnings.push('The spring goes solid before it reaches your working load. Solid height is ' + solidLength.toFixed(1) + ' mm and the length at load works out at ' + lengthAtLoad.toFixed(1) + ' mm.');
    if (travelUsed > 0.8 && travelUsed <= 1) warnings.push('You are using ' + Math.round(travelUsed * 100) + '% of the available travel. Springs kept below about 75% live far longer.');
    if (buckles) warnings.push('Free length is ' + slenderness.toFixed(1) + ' times the mean diameter, past the buckling limit of ' + buckleLimit + '. Guide it on a rod or inside a bore, or shorten it.');
    if (fatigueMargin < 1) warnings.push('At ' + targetCycles.toLocaleString() + ' cycles the fatigue allowance is ' + fatigueAllowable.toFixed(0) + ' MPa against a working stress of ' + (stress / sf).toFixed(0) + ' MPa. Expect a short life.');
    if (F > 0 && extra.parallel) warnings.push('Two identical springs side by side double the rate but share the load; each must still be checked at half the load, not the full figure.');

    const report = [
      'COMPRESSION SPRING DESIGN',
      mat.label + ', ' + end.label + ', wire ' + d + ' mm, outer diameter ' + od + ' mm, ' + n + ' active coils',
      '',
      'Spring index: ' + index.toFixed(2) + ' (mean diameter ' + D.toFixed(2) + ' mm)',
      'Rate: ' + ratePerMm.toFixed(3) + ' N/mm' + (extra.parallel ? ' per pair' : ''),
      'Solid height: ' + solidLength.toFixed(1) + ' mm',
      'Free length: ' + Lf.toFixed(1) + ' mm, available travel ' + travel.toFixed(1) + ' mm',
      '',
      'At ' + F.toFixed(1) + ' N: deflection ' + deflection.toFixed(2) + ' mm, length ' + lengthAtLoad.toFixed(1) + ' mm',
      'Wahl factor: ' + wahl.toFixed(3),
      'Stress: ' + stress.toFixed(0) + ' MPa against an allowable of ' + effectiveAllowable.toFixed(0) + ' MPa (' + Math.round(stressRatio * 100) + '% used)',
      'Fatigue allowable at ' + targetCycles.toLocaleString() + ' cycles: ' + fatigueAllowable.toFixed(0) + ' MPa',
      '',
      'Spring rate target: ' + (k).toFixed(3) + ' N/mm',
      'Energy stored at working load: ' + energy.toFixed(3) + ' J',
      'Estimated mass: ' + mass.toFixed(1) + ' g',
      'Buckling: ' + (buckles ? 'risk — guide or shorten' : 'safe at this slenderness'),
      '',
      'Load table',
      ...loadTable.map((row) => '  ' + row.label + ': ' + row.value.toFixed(1) + ' N, ' + row.deflection.toFixed(2) + ' mm, ' + row.stress.toFixed(0) + ' MPa'),
    ].join('\n');

    return {
      mat, end, d, od, D, n, Lf, F, index, k, ratePerMm, totalCoils, solidLength, deflection, lengthAtLoad, travel,
      travelUsed, wahl, stress, allowable, effectiveAllowable, stressRatio, slenderness, buckleLimit, buckles,
      fatigueFactor, fatigueAllowable, fatigueMargin, energy, mass, weight, loadTable, travelChart, warnings, report, targetCycles, sf,
    };
  }, [material, ends, wire, outerDia, coils, freeLength, load, cycles, safety, extra]);

  return (
    <ToolShell
      toolId="spring-design"
      icon={Waves}
      title="Compression Spring Designer"
      desc="Rate, solid height, deflection and Wahl-corrected stress for a helical compression spring — with buckling, travel use and a fatigue allowance built in."
      state={{ material, ends, wire, outerDia, coils, freeLength, load, cycles, safety, extra }}
      onRestore={(restored) => {
        const map = { wire: setWire, outerDia: setOuterDia, coils: setCoils, freeLength: setFreeLength, load: setLoad, cycles: setCycles, safety: setSafety };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.material) setMaterial(restored.material);
        if (restored.ends) setEnds(restored.ends);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="spring-design.txt"
    >
      <Seg value={material} onChange={setMaterial} options={MATERIALS.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={ends} onChange={setEnds} options={ENDS.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Wire diameter, mm"><input value={wire} onChange={(e) => setWire(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Outer diameter, mm"><input value={outerDia} onChange={(e) => setOuterDia(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Active coils"><input value={coils} onChange={(e) => setCoils(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Free length, mm"><input value={freeLength} onChange={(e) => setFreeLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Working load, N"><input value={load} onChange={(e) => setLoad(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Cycles expected"><input value={cycles} onChange={(e) => setCycles(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Design safety factor"><input value={safety} onChange={(e) => setSafety(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Guided on a rod or in a bore" checked={extra.guided} onChange={() => toggle('guided')} hint="Raises the buckling limit" />
        <ToggleRow label="Hot environment" checked={extra.hot} onChange={() => toggle('hot')} hint="Derates allowable stress 15%" />
        <ToggleRow label="Two springs side by side" checked={extra.parallel} onChange={() => toggle('parallel')} hint="Doubles the rate" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={result.mat.label + ', index ' + result.index.toFixed(2)}
          value={result.ratePerMm.toFixed(2)}
          unit="N/mm"
          sub={'A working load of ' + result.F.toFixed(0) + ' N deflects it ' + result.deflection.toFixed(2) + ' mm, down to ' + result.lengthAtLoad.toFixed(1) + ' mm from a free length of ' + result.Lf.toFixed(0) + ' mm. Working stress is ' + result.stress.toFixed(0) + ' MPa, which is ' + Math.round(result.stressRatio * 100) + '% of the allowable.'}
        />
        <Ring
          value={Math.round(Math.min(120, result.stressRatio * 100))}
          max={120}
          label="Stress used"
          sub={result.stress.toFixed(0) + ' of ' + result.effectiveAllowable.toFixed(0) + ' MPa'}
          unit="%"
          tone={result.stressRatio > 1 ? 'rose' : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Lengths through the working range</div>
          <Bars data={result.travelChart} suffix=" mm" format={(v) => v.toFixed(1)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Solid height is the hard floor. Running near it coils the spring to a block, which is what actually breaks springs, and travel used above 80% shortens life sharply.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Design summary</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Spring index</span><span>{result.index.toFixed(2)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Mean diameter</span><span>{result.D.toFixed(2)} mm</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Rate</span><span className="text-cyan-j">{result.ratePerMm.toFixed(3)} N/mm</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Total coils</span><span>{result.totalCoils.toFixed(1)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Solid height</span><span>{result.solidLength.toFixed(1)} mm</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Travel used</span><span className={result.travelUsed > 0.8 ? 'text-amber-400' : ''}>{Math.round(result.travelUsed * 100)}%</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Wahl factor</span><span>{result.wahl.toFixed(3)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Energy stored</span><span>{result.energy.toFixed(3)} J</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Mass</span><span>{result.mass.toFixed(1)} g</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Ends', value: result.end.label },
                { label: 'Fatigue', value: result.fatigueAllowable.toFixed(0) + ' MPa', tone: result.fatigueMargin < 1 ? 'amber' : undefined },
                { label: 'Slenderness', value: result.slenderness.toFixed(1) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Load and stress through the range</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Load</th><th className="py-1 text-right">Force</th><th className="py-1 text-right">Deflection</th><th className="py-1 text-right">Length</th><th className="py-1 pr-2 text-right">Stress</th></tr>
              </thead>
              <tbody>
                {result.loadTable.map((row) => (
                  <tr key={row.label} className="border-t border-border/40">
                    <td className="py-1 pl-2">{row.label}</td>
                    <td className="py-1 text-right">{row.value.toFixed(1)} N</td>
                    <td className="py-1 text-right">{row.deflection.toFixed(2)} mm</td>
                    <td className="py-1 text-right">{(result.Lf - row.deflection).toFixed(1)} mm</td>
                    <td className={`py-1 pr-2 text-right ${row.stress > result.effectiveAllowable ? 'text-rose-400' : 'text-cyan-j'}`}>{row.stress.toFixed(0)} MPa</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Stress scales linearly with load, so the highest row is the one that decides the wire size. Check it, not the nominal working point.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full design report</div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Rate" value={result.ratePerMm.toFixed(2)} mono sub="N/mm" />
        <Stat label="Solid height" value={result.solidLength.toFixed(1)} mono sub="mm" />
        <Stat label="Stress" value={result.stress.toFixed(0)} mono sub={Math.round(result.stressRatio * 100) + '% of allowable'} />
        <Stat label="Travel used" value={Math.round(result.travelUsed * 100) + '%'} mono sub={result.travel.toFixed(1) + ' mm available'} />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What to change first</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Design rules that save prototypes</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Rate goes with the fourth power of wire diameter and the cube of the coil diameter. A 10% thicker wire stiffens the spring by about 46%, which is why small changes have large effects.</p>
            <p>· Keep the spring index between five and twelve. Below four the coils crack during forming; above fourteen the spring tangles and behaves unpredictably.</p>
            <p>· The Wahl factor exists because the inside of a coil carries more shear than the average. Ignoring it underestimates stress by 10 to 30% at typical indexes.</p>
            <p>· A spring that buckles does not simply bend — it walks sideways and rubs, and friction destroys the rate you calculated.</p>
            <p>· Working stress at about 45% of tensile is the common static limit. Cyclic duty wants far less, sometimes as low as 30%.</p>
            <p>· Set a length tolerance on the drawing. Rate varies with wire diameter tolerance, and a batch at the top of the range can be noticeably stiffer.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Typical materials</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Material</th><th className="py-1 text-right">G, GPa</th><th className="py-1 text-right">Tensile</th><th className="py-1 pr-2 text-left">Use</th></tr>
              </thead>
              <tbody>
                {MATERIALS.map((entry) => (
                  <tr key={entry.id} className={`border-t border-border/40 ${entry.id === result.mat.id ? 'text-cyan-j' : ''}`}>
                    <td className="py-1 pl-2">{entry.label}</td>
                    <td className="py-1 text-right">{entry.g}</td>
                    <td className="py-1 text-right">{entry.tensile}</td>
                    <td className="py-1 pr-2">{entry.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Shear modulus decides the rate. Tensile strength decides how much stress the wire can take before it yields or fatigues.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Calculated from the standard helical compression spring equations with the Wahl correction, a 45% static stress limit and a fatigue reduction based on the cycle count you enter. Real springs
          also depend on wire tolerance, surface finish, set and shot peening — treat this as a design starting point to take to a spring maker.
        </p>
      </Panel>
    </ToolShell>
  );
}