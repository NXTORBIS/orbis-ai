import { useMemo, useState } from 'react';
import { Droplets } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Gauge, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const MATERIALS = [
  { id: 'copper', label: 'Copper', roughness: 0.0015, c: 140 },
  { id: 'pex', label: 'PEX / plastic', roughness: 0.007, c: 150 },
  { id: 'steel', label: 'Steel', roughness: 0.045, c: 120 },
  { id: 'galv', label: 'Galvanised', roughness: 0.15, c: 110 },
  { id: 'pvc', label: 'PVC', roughness: 0.0015, c: 150 },
];

const SIZES = [
  { label: '12 mm / 1/2"', mm: 12 },
  { label: '16 mm', mm: 16 },
  { label: '19 mm / 3/4"', mm: 19 },
  { label: '25 mm / 1"', mm: 25 },
  { label: '32 mm / 1-1/4"', mm: 32 },
  { label: '40 mm / 1-1/2"', mm: 40 },
  { label: '50 mm / 2"', mm: 50 },
  { label: '63 mm', mm: 63 },
  { label: '75 mm / 3"', mm: 75 },
  { label: '90 mm', mm: 90 },
  { label: '110 mm / 4"', mm: 110 },
];

export default function PipeFlow() {
  const [material, setMaterial] = useState('copper');
  const [flow, setFlow] = useState('20');
  const [flowUnit, setFlowUnit] = useState('lpm');
  const [size, setSize] = useState(19);
  const [length, setLength] = useState('12');
  const [fittings, setFittings] = useState('6');
  const [temperature, setTemperature] = useState('20');
  const [inlinePressure, setInlinePressure] = useState('3');
  const [extra, setExtra] = useState({ valves: true, elbowHeavy: false });

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const mat = MATERIALS.find((entry) => entry.id === material) || MATERIALS[0];
    const t = Number(temperature) || 20;
    const lpm = flowUnit === 'lpm' ? Number(flow) || 0 : ((Number(flow) || 0) * 3.78541);
    const q = lpm / 60000;
    const run = Math.max(0.5, Number(length) || 1);

    // Water properties shift modestly with temperature.
    const rho = 1000 - 0.35 * Math.abs(t - 4) ** 1.1;
    const mu = 0.001792 * Math.exp(-0.0343 * (t - 1));

    const calc = (mm) => {
      const d = mm / 1000;
      const a = (Math.PI * d * d) / 4;
      const v = q / a;
      const re = (rho * v * d) / mu;
      const rel = mat.roughness / d;
      let f;
      if (re < 2300) {
        f = 64 / Math.max(1, re);
      } else {
        // Swamee-Jain explicit approximation of Colebrook.
        f = 0.25 / (Math.log10(rel / 3.7 + 5.74 / Math.pow(re, 0.9)) ** 2);
      }
      const perMetre = (f / d) * ((rho * v * v) / 2);
      // Fittings as equivalent length: about 30 diameters each, valves 150.
      const eqLength = run + (Number(fittings) || 0) * (extra.elbowHeavy ? 45 : 30) * d + (extra.valves ? 2 * 150 * d : 0);
      const drop = perMetre * eqLength;
      const power = drop * q;
      return { mm, d, a, v, re, f, perMetre, eqLength, drop, power, label: SIZES.find((entry) => entry.mm === mm)?.label || mm + ' mm' };
    };

    const current = calc(size);
    const options = SIZES.map((entry) => calc(entry.mm));
    const pressureBar = Math.max(0, Number(inlinePressure) || 0);
    const remaining = pressureBar * 100000 - current.drop;

    const velocityVerdict = current.v < 0.5
      ? 'too slow — air will not clear and sediment settles'
      : current.v <= 1.5
      ? 'ideal for domestic supply'
      : current.v <= 2.5
      ? 'acceptable, slightly audible in quiet rooms'
      : current.v <= 3.5
      ? 'noisy and erosive at fittings'
      : 'far too fast — hammer, noise and erosion';

    const recommended = options.find((entry) => entry.v >= 1 && entry.v <= 2.5);

    const chart = options.map((entry) => ({
      label: entry.label.split(' ')[0],
      value: Number(entry.v.toFixed(2)),
      tone: entry.v > 2.5 ? 'rose' : undefined,
    }));

    const warnings = [];
    if (current.v > 3) warnings.push('Velocity at ' + current.v.toFixed(2) + ' m/s is past the erosion limit. Fittings and elbows will wear and the noise will be audible through the wall.');
    if (current.v < 0.5) warnings.push('At ' + current.v.toFixed(2) + ' m/s the pipe is oversized: air pockets will not be pushed out and particles will settle.');
    if (remaining < 0) warnings.push('The inlet pressure does not cover the friction loss. Either shorten the run, use a larger bore or raise the supply pressure.');
    if (current.re > 4000) warnings.push('Flow is fully turbulent (Reynolds ' + Math.round(current.re) + '), so losses rise with roughly the square of the flow rate.');
    if (recommended && recommended.mm !== current.mm) warnings.push('For this flow, ' + recommended.label + ' lands in the 1 to 2.5 m/s band most engineers aim for.');

    const report = [
      'PIPE FLOW AND PRESSURE LOSS',
      'Material: ' + mat.label + ', bore ' + current.label + ', run ' + run.toFixed(1) + ' m with ' + (Number(fittings) || 0) + ' fittings',
      'Flow: ' + lpm.toFixed(1) + ' L/min (' + (lpm * 0.264172).toFixed(2) + ' US gpm), water at ' + t + ' C',
      '',
      'Velocity: ' + current.v.toFixed(2) + ' m/s — ' + velocityVerdict,
      'Reynolds number: ' + Math.round(current.re) + ' (' + (current.re < 2300 ? 'laminar' : current.re < 4000 ? 'transitional' : 'turbulent') + ')',
      'Friction factor: ' + current.f.toFixed(4),
      'Loss per metre: ' + (current.perMetre / 1000).toFixed(2) + ' kPa/m (' + (current.perMetre / 9806.65 * 100).toFixed(2) + ' m head per 100 m)',
      'Equivalent length: ' + current.eqLength.toFixed(1) + ' m',
      'Total pressure loss: ' + (current.drop / 1000).toFixed(1) + ' kPa (' + (current.drop / 9806.65).toFixed(2) + ' m head)',
      'Hydraulic power wasted: ' + current.power.toFixed(2) + ' W',
      'Inlet ' + pressureBar.toFixed(2) + ' bar leaves ' + (remaining / 1000).toFixed(1) + ' kPa at the outlet',
      '',
      'Velocity by size',
      ...options.map((entry) => '  ' + entry.label + ': ' + entry.v.toFixed(2) + ' m/s, loss ' + (entry.drop / 1000).toFixed(1) + ' kPa'),
    ].join('\n');

    return {
      mat, lpm, q, run, current, options, chart, velocityVerdict, recommended, pressureBar, remaining, rho, mu, t, size, warnings, report,
      dropPerMetre: current.perMetre,
      head: current.drop / 9806.65,
    };
  }, [material, flow, flowUnit, size, length, fittings, temperature, inlinePressure, extra]);

  const download = () => {
    const blob = new Blob([result.report], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'pipe-flow.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <ToolShell
      toolId="pipe-flow"
      icon={Droplets}
      title="Pipe Flow & Pressure Loss"
      desc="Flow rate, bore and run length into velocity, Reynolds number, friction loss and the pressure left at the outlet — with the size that lands in the quiet, non-eroding band."
      state={{ material, flow, flowUnit, size, length, fittings, temperature, inlinePressure, extra }}
      onRestore={(restored) => {
        if (restored.material) setMaterial(restored.material);
        if (restored.flow !== undefined) setFlow(String(restored.flow));
        if (restored.flowUnit) setFlowUnit(restored.flowUnit);
        if (restored.size) setSize(Number(restored.size));
        if (restored.length !== undefined) setLength(String(restored.length));
        if (restored.fittings !== undefined) setFittings(String(restored.fittings));
        if (restored.temperature !== undefined) setTemperature(String(restored.temperature));
        if (restored.inlinePressure !== undefined) setInlinePressure(String(restored.inlinePressure));
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="pipe-flow.txt"
    >
      <Seg value={material} onChange={setMaterial} options={MATERIALS.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Flow (' + (result.lpm / 3.78541).toFixed(1) + ' gpm)'}>
          <div className="flex gap-2">
            <input value={flow} onChange={(e) => setFlow(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <select value={flowUnit} onChange={(e) => setFlowUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
              <option value="lpm">L/min</option>
              <option value="gpm">gpm</option>
            </select>
          </div>
        </Field>
        <Field label="Pipe bore">
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm">
            {SIZES.map((entry) => <option key={entry.mm} value={entry.mm}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="Straight run, m"><input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fittings / elbows"><input value={fittings} onChange={(e) => setFittings(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Water temperature, °C"><input value={temperature} onChange={(e) => setTemperature(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inlet pressure, bar"><input value={inlinePressure} onChange={(e) => setInlinePressure(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Include two stop valves" checked={extra.valves} onChange={() => toggle('valves')} hint="Adds 150 diameters each" />
        <ToggleRow label="Tight bends rather than swept" checked={extra.elbowHeavy} onChange={() => toggle('elbowHeavy')} hint="Adds 45 diameters per fitting" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Flow of ' + result.lpm.toFixed(1) + ' L/min through ' + result.current.label}
          value={result.current.v.toFixed(2)}
          unit="m/s"
          sub={'That is ' + result.velocityVerdict + '. The run loses ' + (result.current.drop / 1000).toFixed(1) + ' kPa across ' + result.current.eqLength.toFixed(1) + ' m of equivalent length, and the inlet pressure leaves ' + (result.remaining / 1000).toFixed(1) + ' kPa at the outlet.'}
        />
        <Gauge
          value={Number(result.current.v.toFixed(2))}
          min={0}
          max={5}
          label="Velocity"
          unit=" m/s"
          bands={[{ to: 1.5, tone: 'cyan' }, { to: 2.5, tone: 'violet' }, { to: 5, tone: 'rose' }]}
          caption="Domestic supply is happiest between 1 and 1.5 m/s; above 3 m/s erosion and noise begin."
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Velocity by pipe size</span>
          <span className="font-mono-j text-[11px] text-muted-foreground">{result.current.label} selected</span>
        </div>
        <Bars data={result.chart} suffix=" m/s" format={(v) => v.toFixed(2)} />
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Hydraulics</span>
            <div className="flex gap-2">
              <CopyBtn value={result.report} label="Copy" />
              <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
                Download
              </button>
            </div>
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Velocity</span><span>{result.current.v.toFixed(2)} m/s</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Reynolds</span><span>{Math.round(result.current.re)} ({result.current.re < 2300 ? 'laminar' : result.current.re < 4000 ? 'transitional' : 'turbulent'})</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Friction factor</span><span>{result.current.f.toFixed(4)}</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Loss per metre</span><span>{(result.dropPerMetre / 1000).toFixed(3)} kPa</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Equivalent length</span><span>{result.current.eqLength.toFixed(1)} m</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Total loss</span><span>{(result.current.drop / 1000).toFixed(1)} kPa ({result.head.toFixed(2)} m head)</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Hydraulic power</span><span>{result.current.power.toFixed(2)} W</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outlet pressure</span><span className={result.remaining > 0 ? 'text-cyan-j' : 'text-rose-400'}>{(result.remaining / 1000).toFixed(1)} kPa</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Density', value: Math.round(result.rho) + ' kg/m³' },
                { label: 'Viscosity', value: (result.mu * 1000).toFixed(3) + ' mPa·s' },
                { label: 'Best size', value: result.recommended ? result.recommended.label : 'none in band' },
              ]}
            />
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Full report</div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Velocity" value={result.current.v.toFixed(2)} mono sub="m/s" />
        <Stat label="Friction loss" value={(result.current.drop / 1000).toFixed(1)} mono sub="kPa across the run" />
        <Stat label="Head loss" value={result.head.toFixed(2)} mono sub="metres of water" />
        <Stat label="Hydraulic power" value={result.current.power.toFixed(2)} mono sub="watts consumed by friction" />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the numbers are telling you</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizing by feel, then checking with numbers</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Domestic cold supply: 1 to 1.5 m/s. Hot supply: the same, and never below 0.5 m/s or the air will not clear.</p>
            <p>· Gravity drainage is a different calculation entirely: it runs part-full at a designed slope, and velocity is checked for self-cleansing rather than noise.</p>
            <p>· Every fitting costs length. A long sweep elbow is roughly 30 diameters, a tight 90° closer to 45, and a valve around 150.</p>
            <p>· Loss rises with the square of flow. Doubling the flow through the same pipe quadruples the pressure drop, which is why one shower switching on visibly affects another.</p>
            <p>· Hot water is thinner than cold, so the same pipe carries slightly more at lower loss — small, but not nothing on long runs.</p>
            <p>· Water hammer is a momentum problem, not a friction one. Arrestors and slower closing valves are the fix.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Equivalent length by fitting</div>
          <div className="overflow-hidden rounded-lg border border-border/60">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="bg-card/80 text-muted-foreground">
                <tr><th className="py-1 pl-2 text-left">Fitting</th><th className="py-1 text-right">Diameters</th><th className="py-1 pr-2 text-right">At 19 mm</th></tr>
              </thead>
              <tbody>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">90° swept elbow</td><td className="py-1 text-right">30</td><td className="py-1 pr-2 text-right">0.57 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">90° tight elbow</td><td className="py-1 text-right">45</td><td className="py-1 pr-2 text-right">0.86 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">45° elbow</td><td className="py-1 text-right">16</td><td className="py-1 pr-2 text-right">0.30 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Tee, straight through</td><td className="py-1 text-right">20</td><td className="py-1 pr-2 text-right">0.38 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Gate valve, open</td><td className="py-1 text-right">13</td><td className="py-1 pr-2 text-right">0.25 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Stop valve, open</td><td className="py-1 text-right">150</td><td className="py-1 pr-2 text-right">2.85 m</td></tr>
                <tr className="border-t border-border/40"><td className="py-1 pl-2">Check valve</td><td className="py-1 text-right">100</td><td className="py-1 pr-2 text-right">1.90 m</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Two stop valves in a run cost more pressure than several metres of straight pipe. That is why fully-open isolation valves, not bigger pipe, often fixes a weak supply.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Computed with the Darcy–Weisbach equation and the Swamee–Jain approximation of the Colebrook friction factor, using temperature-adjusted water properties. Internal bores are nominal; the real
          calculation uses the actual internal diameter of the pipe you buy, which for plastic pressure pipe is noticeably smaller than the outside diameter.
        </p>
      </Panel>
    </ToolShell>
  );
}