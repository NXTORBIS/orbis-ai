import { useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

// Copper resistance in ohms per 1000 ft at about 75 C, plus the common ampacity for 60 C insulation.
const AWG = [
  { awg: '20', area: 1020, ohm: 12.3, amp: 5 },
  { awg: '18', area: 1620, ohm: 7.77, amp: 7 },
  { awg: '16', area: 2580, ohm: 4.89, amp: 10 },
  { awg: '14', area: 4110, ohm: 3.07, amp: 15 },
  { awg: '12', area: 6530, ohm: 1.93, amp: 20 },
  { awg: '10', area: 10380, ohm: 1.21, amp: 30 },
  { awg: '8', area: 16510, ohm: 0.764, amp: 40 },
  { awg: '6', area: 26240, ohm: 0.491, amp: 55 },
  { awg: '4', area: 41740, ohm: 0.308, amp: 70 },
  { awg: '2', area: 66360, ohm: 0.194, amp: 95 },
  { awg: '1', area: 83690, ohm: 0.154, amp: 110 },
  { awg: '1/0', area: 105600, ohm: 0.122, amp: 125 },
  { awg: '2/0', area: 133100, ohm: 0.0967, amp: 145 },
  { awg: '3/0', area: 167800, ohm: 0.0766, amp: 165 },
  { awg: '4/0', area: 211600, ohm: 0.0608, amp: 195 },
  { awg: '250 kcmil', area: 250000, ohm: 0.0515, amp: 215 },
  { awg: '350 kcmil', area: 350000, ohm: 0.0367, amp: 260 },
  { awg: '500 kcmil', area: 500000, ohm: 0.0258, amp: 320 },
];

const MATERIALS = [
  { id: 'cu', label: 'Copper', k: 12.9, rho: 1.72e-8, ampFactor: 1 },
  { id: 'al', label: 'Aluminium', k: 21.2, rho: 2.82e-8, ampFactor: 0.78 },
];

const SYSTEMS = [
  { id: 'dc', label: 'DC two-wire' },
  { id: 'ac1', label: 'AC single phase' },
  { id: 'ac3', label: 'AC three phase' },
];

export default function WireGauge() {
  const [system, setSystem] = useState('dc');
  const [material, setMaterial] = useState('cu');
  const [current, setCurrent] = useState('30');
  const [volts, setVolts] = useState('24');
  const [length, setLength] = useState('10');
  const [dropLimit, setDropLimit] = useState('3');
  const [powerFactor, setPowerFactor] = useState('1');
  const [pricePerM, setPricePerM] = useState('6');
  const [cableSize, setCableSize] = useState('10');
  const [extra, setExtra] = useState({ conduit: true, bundling: false, breaker: true });
  const [unit, setUnit] = useState('m');

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const mat = MATERIALS.find((entry) => entry.id === material) || MATERIALS[0];
    const amps = Math.max(0.1, Number(current) || 1);
    const voltage = Math.max(1, Number(volts) || 12);
    const metres = Math.max(0.1, Number(length) || 1);
    const limit = Math.max(0.5, Number(dropLimit) || 3);
    const pf = Math.min(1, Math.max(0.5, Number(powerFactor) || 1));
    // Circular mils from the standard voltage drop formula, then pick the nearest cable that fits.
    const effectiveK = mat.id === 'al' ? 21.2 : 12.9;
    const factor = system === 'dc' ? 2 : system === 'ac1' ? 2 : 1.732;
    const feet = metres * 3.28084;
    const circularMils = (factor * feet * amps * effectiveK) / (limit * 1);
    const requiredArea = circularMils / 1000;

    const selected = AWG.find((entry) => entry.area >= requiredArea) || AWG[AWG.length - 1];
    const checked = AWG.find((entry) => entry.awg === String(cableSize).replace(/[^0-9kcmi/.]/g, '')) || selected;

    const ohmPerMetre = (entry) => (entry.ohm / 1000) / 3.28084;
    const dropFor = (entry) => {
      const resistance = ohmPerMetre(entry) * metres;
      const currentLeg = system === 'ac3' ? amps : amps;
      return factor * currentLeg * resistance;
    };

    const selectedDrop = dropFor(selected);
    const checkedDrop = dropFor(checked);
    const dropPercent = (selectedDrop / voltage) * 100;
    const checkedPercent = (checkedDrop / voltage) * 100;
    const delivered = voltage - selectedDrop;
    const wattsLost = selectedDrop * amps * (system === 'ac3' ? Math.sqrt(3) : 1);
    const lossPercent = (wattsLost / Math.max(1, voltage * amps * (system === 'ac3' ? Math.sqrt(3) : 1) * pf)) * 100;

    // Ampacity with the adjustment factors real installations apply.
    const derate = (extra.conduit ? 0.9 : 1) * (extra.bundling ? 0.8 : 1);
    const ampacity = selected.amp * mat.ampFactor * derate;
    const ampacityOk = ampacity >= amps;
    const breaker = extra.breaker ? Math.ceil((amps * 1.25) / 5) * 5 : null;
    const breakerOk = !breaker || breaker <= ampacity;

    const table = AWG.map((entry) => {
      const drop = dropFor(entry);
      const pct = (drop / voltage) * 100;
      return {
        label: entry.awg,
        value: Number(pct.toFixed(2)),
        tone: pct <= limit ? undefined : 'rose',
        passes: pct <= limit,
        drop,
        ampacity: entry.amp * mat.ampFactor * derate,
        area: entry.area,
        toneKey: pct <= limit ? 'ok' : 'fail',
      };
    });

    const smallest = AWG.find((entry) => {
      const drop = dropFor(entry);
      return (drop / voltage) * 100 <= limit && entry.amp * mat.ampFactor * derate >= amps;
    });

    const cost = ohmPerMetre(checked) * 0 + Number(pricePerM) * metres;

    const warnings = [];
    if (!ampacityOk) warnings.push('At ' + amps + ' A this cable carries ' + ampacity.toFixed(0) + ' A after derating. Overheating is a fire risk, not a performance question — go up a size.');
    if (!breakerOk) warnings.push('A ' + breaker + ' A breaker will not protect a cable rated ' + ampacity.toFixed(0) + ' A at these conditions.');
    if (checkedPercent > limit) warnings.push('The cable on the wire you checked drops ' + checkedPercent.toFixed(2) + '%, past your ' + limit + '% limit. Required size is ' + selected.awg + '.');
    if (material === 'al') warnings.push('Aluminium needs larger cross-section for the same current and wants an antioxidant compound on every termination.');
    if (system === 'dc' && voltage <= 48) warnings.push('Low voltage DC is unforgiving: doubling the voltage or halving the run does more good than buying a bigger cable.');
    if (dropPercent > limit) warnings.push('Voltage drop ' + dropPercent.toFixed(2) + '% exceeds the target. Long runs fail on drop long before they fail on ampacity.');

    const report = [
      'CABLE SIZING',
      'System: ' + SYSTEMS.find((entry) => entry.id === system).label + ', ' + mat.label,
      'Load: ' + amps + ' A at ' + voltage + ' V over ' + metres + ' m one way, limit ' + limit + '%',
      '',
      'Required cross-section: ' + requiredArea.toFixed(1) + ' kcmil / ' + (requiredArea / 1000 * 0.5067).toFixed(1) + ' mm^2',
      'Recommended cable: ' + selected.awg + ' AWG',
      'Voltage drop: ' + selectedDrop.toFixed(2) + ' V (' + dropPercent.toFixed(2) + '%), delivered ' + delivered.toFixed(2) + ' V',
      'Ampacity after derating: ' + ampacity.toFixed(0) + ' A',
      breaker ? 'Breaker: ' + breaker + ' A' : 'No breaker shown',
      'Power lost in the cable: ' + wattsLost.toFixed(1) + ' W (' + lossPercent.toFixed(1) + '% of delivered power)',
      'Estimated cable cost: ' + cost.toFixed(0),
      '',
      'Size table by voltage drop',
      ...table.map((row) => '  ' + row.label + ' AWG: ' + row.value.toFixed(2) + '% drop, ' + row.ampacity.toFixed(0) + ' A ampacity'),
    ].join('\n');

    return {
      mat, amps, voltage, metres, limit, requiredArea, selected, checked, selectedDrop, checkedDrop, dropPercent, checkedPercent,
      delivered, wattsLost, lossPercent, ampacity, ampacityOk, breaker, breakerOk, table, smallest, cost, warnings, report,
      factor, ohmPerMetre,
    };
  }, [system, material, current, volts, length, dropLimit, powerFactor, pricePerM, cableSize, extra]);

  const verdict = result.dropPercent <= result.limit && result.ampacityOk;

  return (
    <ToolShell
      toolId="wire-gauge"
      icon={Zap}
      title="Cable & Voltage Drop Calculator"
      desc="Size DC, single-phase and three-phase cable from current, run length and an allowable voltage drop — then check ampacity, derating and breaker protection on the size you already have."
      state={{ system, material, current, volts, length, dropLimit, powerFactor, pricePerM, cableSize, extra, unit }}
      onRestore={(restored) => {
        if (restored.system) setSystem(restored.system);
        if (restored.material) setMaterial(restored.material);
        if (restored.current !== undefined) setCurrent(String(restored.current));
        if (restored.volts !== undefined) setVolts(String(restored.volts));
        if (restored.length !== undefined) setLength(String(restored.length));
        if (restored.dropLimit !== undefined) setDropLimit(String(restored.dropLimit));
        if (restored.powerFactor !== undefined) setPowerFactor(String(restored.powerFactor));
        if (restored.pricePerM !== undefined) setPricePerM(String(restored.pricePerM));
        if (restored.cableSize !== undefined) setCableSize(String(restored.cableSize));
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="cable-sizing.txt"
    >
      <Seg value={system} onChange={setSystem} options={SYSTEMS.map((entry) => ({ value: entry.id, label: entry.label }))} />
      <Seg value={material} onChange={setMaterial} options={MATERIALS.map((entry) => ({ value: entry.id, label: entry.label }))} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Current, A"><input value={current} onChange={(e) => setCurrent(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="System voltage, V"><input value={volts} onChange={(e) => setVolts(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Run length, ' + unit}><input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Max drop, %"><input value={dropLimit} onChange={(e) => setDropLimit(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Power factor"><input value={powerFactor} onChange={(e) => setPowerFactor(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Cable price per metre"><input value={pricePerM} onChange={(e) => setPricePerM(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Cable you have (AWG)'}><input value={cableSize} onChange={(e) => setCableSize(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Length unit">
          <Seg value={unit} onChange={setUnit} options={[{ value: 'm', label: 'metres' }, { value: 'ft', label: 'feet' }]} />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="In conduit" checked={extra.conduit} onChange={() => toggle('conduit')} hint="Reduces ampacity" />
        <ToggleRow label="Bundled with other cables" checked={extra.bundling} onChange={() => toggle('bundling')} hint="Reduces ampacity further" />
        <ToggleRow label="Size a breaker" checked={extra.breaker} onChange={() => toggle('breaker')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={verdict ? 'Recommended cable' : 'Cable needs to be larger'}
          value={result.selected.awg}
          unit="AWG"
          sub={'A ' + result.metres.toFixed(1) + ' m run at ' + result.amps + ' A on ' + result.voltage + ' V drops ' + result.selectedDrop.toFixed(2) + ' V — ' + result.dropPercent.toFixed(2) + '% — leaving ' + result.delivered.toFixed(1) + ' V at the load. Ampacity after derating is ' + result.ampacity.toFixed(0) + ' A.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">On the cable you already have</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Size</span><span>{result.checked.awg} AWG</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Voltage drop</span><span className={result.checkedPercent <= result.limit ? 'text-cyan-j' : 'text-rose-400'}>{result.checkedDrop.toFixed(2)} V ({result.checkedPercent.toFixed(2)}%)</span></div>
            <div className="flex justify-between border-b border-border/40 pb-1"><span className="text-muted-foreground">Ampacity</span><span className={result.checked.amp * result.mat.ampFactor >= result.amps ? 'text-cyan-j' : 'text-rose-400'}>{(result.checked.amp * result.mat.ampFactor).toFixed(0)} A</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Verdict</span><span className={result.checkedPercent <= result.limit && result.checked.amp * result.mat.ampFactor >= result.amps ? 'text-cyan-j' : 'text-rose-400'}>{result.checkedPercent <= result.limit && result.checked.amp * result.mat.ampFactor >= result.amps ? 'Suitable' : 'Too small'}</span></div>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Smallest that works', value: result.smallest ? result.smallest.awg + ' AWG' : '500 kcmil+' },
                { label: 'Power lost', value: result.wattsLost.toFixed(0) + ' W', tone: result.lossPercent > 4 ? 'amber' : undefined },
                { label: 'Cable cost', value: result.cost.toFixed(0) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Voltage drop by cable size</span>
          <span className="font-mono-j text-[11px] text-muted-foreground">limit {result.limit}%</span>
        </div>
        <Bars data={result.table} suffix="%" format={(v) => v.toFixed(2)} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Red bars are past the limit. Drop falls with the square of the diameter, so one size up usually fixes an over-long run for far less than re-routing it.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Full sizing sheet</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizing table</div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full font-mono-j text-[10px]">
              <thead className="sticky top-0 bg-card/80 text-muted-foreground">
                <tr>
                  <th className="py-1 text-left">AWG</th>
                  <th className="py-1 text-right">kcmil</th>
                  <th className="py-1 text-right">Ω/1000ft</th>
                  <th className="py-1 text-right">Drop</th>
                  <th className="py-1 text-right">Amps</th>
                </tr>
              </thead>
              <tbody>
                {result.table.map((row) => (
                  <tr key={row.label} className={row.label === result.selected.awg ? 'text-cyan-j' : row.passes ? '' : 'text-rose-400/80'}>
                    <td className="py-0.5">{row.label}</td>
                    <td className="py-0.5 text-right">{row.area.toLocaleString()}</td>
                    <td className="py-0.5 text-right">{AWG.find((entry) => entry.awg === row.label).ohm}</td>
                    <td className="py-0.5 text-right">{row.value.toFixed(2)}%</td>
                    <td className="py-0.5 text-right">{row.ampacity.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Required area" value={result.requiredArea.toFixed(1)} mono sub="kcmil minimum" />
        <Stat label="Recommended" value={result.selected.awg} mono sub="AWG" />
        <Stat label="Drop" value={result.dropPercent.toFixed(2) + '%'} mono sub={result.selectedDrop.toFixed(2) + ' V lost'} />
        <Stat label="Ampacity" value={result.ampacity.toFixed(0) + ' A'} mono sub={result.ampacityOk ? 'covers the load' : 'below the load'} />
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Things that will bite</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Why drop beats temperature most of the time</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Ampacity keeps the insulation from melting. Voltage drop keeps the equipment from working. Both have to pass, and on long low-voltage runs drop is usually the binding one.</p>
            <p>· The factor of two in the calculation is the return path. A run of ten metres contains twenty metres of copper, which is why long DC runs get fat fast.</p>
            <p>· Three-phase carries the square root of three rather than two, sharing the current across three conductors — the same power moves on thinner cable, but all three must be sized.</p>
            <p>· Copper has roughly 60% of the resistivity of aluminium. Aluminium is cheaper and lighter, which is why it appears on service entries and rarely on a boat.</p>
            <p>· Derating in conduit and in bundles is real and additive. A cable that is fine in free air can fail in a hot roof space.</p>
            <p>· Terminations matter as much as the cable. A loose screw terminal adds resistance exactly where it will heat up and eventually char.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Practical targets</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· 12 V DC circuits in boats and vehicles: aim for 2 to 3% total, and count every fuse, switch and connector in that budget.</p>
            <p>· 230 V single-phase branch circuits: 3% at the outlet is the usual code figure, with 5% total from origin to load.</p>
            <p>· Motor starters and inverters see more than resistance drop; a poor connection causes nuisance trips long before a light dims.</p>
            <p>· Solar array strings tolerate 1 to 2% — inverter efficiency is measured at the terminals, so anything lost in the cable is simply lost.</p>
            <p>· Sensitive audio and instrumentation lines want shielded cable, and the shield should be bonded at one end only.</p>
            <p>· Use a fused or breakered positive on every DC circuit; size the device to protect the cable, not the appliance.</p>
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Resistance values are typical copper and aluminium figures at around 75 °C, and ampacity figures are a common 60 °C insulation column. Codes differ between countries and applications, so treat
          the result as a design calculation to be checked against the wiring rules that apply to your installation.
        </p>
      </Panel>
    </ToolShell>
  );
}