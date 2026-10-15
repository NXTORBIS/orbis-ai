import { useMemo, useState } from 'react';
import { Flame } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const INSULATION = [
  { id: 'poor', label: 'Old / single glazed', u: 1.4, ach: 1.2 },
  { id: 'average', label: 'Average', u: 0.8, ach: 0.7 },
  { id: 'good', label: 'Double glazed, insulated', u: 0.45, ach: 0.4 },
  { id: 'passive', label: 'High performance', u: 0.25, ach: 0.25 },
];

const ORIENTATION = [
  { id: 'north', label: 'North', factor: 0.4 },
  { id: 'east', label: 'East', factor: 0.9 },
  { id: 'south', label: 'South', factor: 0.6 },
  { id: 'west', label: 'West', factor: 1.15 },
];

export default function HeatLoad() {
  const [length, setLength] = useState('5');
  const [width, setWidth] = useState('4');
  const [height, setHeight] = useState('2.6');
  const [insulation, setInsulation] = useState('average');
  const [orientation, setOrientation] = useState('west');
  const [windowArea, setWindowArea] = useState('4');
  const [people, setPeople] = useState('2');
  const [applianceWatts, setApplianceWatts] = useState('450');
  const [outdoor, setOutdoor] = useState('35');
  const [indoor, setIndoor] = useState('24');
  const [lightingWatts, setLightingWatts] = useState('60');
  const [shading, setShading] = useState('0.7');
  const [extra, setExtra] = useState({ kitchen: false, topFloor: true, ductLoss: false });
  const [unit, setUnit] = useState('metric');

  const toggle = (key) => setExtra((current) => ({ ...current, [key]: !current[key] }));

  const result = useMemo(() => {
    const metric = unit === 'metric';
    const l = Math.max(0.5, (Number(length) || 5) * (metric ? 1 : 1));
    const w = Math.max(0.5, (Number(width) || 4) * (metric ? 1 : 1));
    const h = Math.max(0.5, (Number(height) || 2.6) * (metric ? 1 : 1));
    const floorM2 = metric ? l * w : (Number(length) || 5) / 3.28084 * ((Number(width) || 4) / 3.28084);
    const volumeM3 = floorM2 * (metric ? h : (Number(height) || 2.6) / 3.28084);
    const floorArea = metric ? floorM2 : floorM2 * 10.7639;
    const volume = metric ? volumeM3 : volumeM3 * 35.3147;
    const ins = INSULATION.find((entry) => entry.id === insulation) || INSULATION[1];
    const orient = ORIENTATION.find((entry) => entry.id === orientation) || ORIENTATION[3];

    const dT_c = (Number(outdoor) || 35) - (Number(indoor) || 24);
    const dT_f = dT_c * 1.8;
    const glazingArea = Math.max(0, Number(windowArea) || 0);
    const shade = Math.min(1, Math.max(0.2, Number(shading) || 0.7));

    // Fabric gain through the envelope and glazing.
    const envelopeArea = metric
      ? 2 * (l + w) * h + 2 * floorM2
      : 2 * ((Number(length) || 5) + (Number(width) || 4)) * (Number(height) || 2.6) + 2 * ((Number(length) || 5) * (Number(width) || 4));
    const wallArea = Math.max(0, envelopeArea - glazingArea * (metric ? 1 : 1));
    const fabricW = ins.u * wallArea * dT_c;
    const solarW = glazingArea * 620 * orient.factor * shade;
    const envelopeTotal = fabricW + solarW;

    // Internal gains.
    const peopleW = Math.max(0, Number(people) || 0) * 120;
    const applianceW = Math.max(0, Number(applianceWatts) || 0);
    const lightW = Math.max(0, Number(lightingWatts) || 0);
    const internalTotal = peopleW + applianceW + lightW;

    // Infiltration: 0.33 Wh per m3 per K, or 1.08 BTU per cfm per F.
    const infiltrationW = metric
      ? 0.33 * volumeM3 * ins.ach * dT_c
      : 1.08 * (volume) * ins.ach * dT_f;
    const subtotalW = envelopeTotal + internalTotal + infiltrationW;
    const multiplier = (extra.kitchen ? 1.1 : 1) * (extra.topFloor ? 1.08 : 1) * (extra.ductLoss ? 1.12 : 1);
    const totalW = subtotalW * multiplier;
    const totalBtu = totalW * 3.412;
    const tons = totalBtu / 12000;
    const sensible = envelopeTotal + applianceW + lightW + infiltrationW;
    const latent = peopleW * 0.4;
    const shr = sensible / Math.max(1, sensible + latent + peopleW * 0.2);

    const recommendedKw = Math.ceil((totalW / 1000) * 2) / 2;
    const recommendedBtu = Math.ceil(totalBtu / 1000) * 1000;

    const breakdown = [
      { label: 'Walls', value: Number(fabricW.toFixed(0)) },
      { label: 'Glazing', value: Number(solarW.toFixed(0)) },
      { label: 'People', value: Number(peopleW.toFixed(0)) },
      { label: 'Appliance', value: Number(applianceW.toFixed(0)) },
      { label: 'Lighting', value: Number(lightW.toFixed(0)) },
      { label: 'Air leak', value: Number(infiltrationW.toFixed(0)) },
    ];
    const top = [...breakdown].sort((a, b) => b.value - a.value);

    const warnings = [];
    if (dT_c <= 0) warnings.push('Indoor temperature is at or above outdoor, so there is no cooling load to calculate.');
    if (ins.ach >= 1) warnings.push('At ' + ins.ach + ' air changes an hour, air leakage is usually the cheapest gain to fix — sealing beats buying a bigger unit.');
    if (glazingArea > floorArea * 0.3) warnings.push('Glazing is more than 30% of the floor area, so solar gain dominates. External shading pays back faster than extra cooling capacity.');
    if (shr < 0.75) warnings.push('The sensible heat ratio is ' + shr.toFixed(2) + ', which is low. A unit rated mostly for sensible capacity may leave the room clammy.');
    if (tons > 5) warnings.push('Above about five tons, two smaller units or a ducted system give far better part-load efficiency than one large machine.');

    const report = [
      'ROOM COOLING LOAD',
      'Room: ' + (metric ? l.toFixed(1) + ' x ' + w.toFixed(1) + ' x ' + h.toFixed(1) + ' m' : (Number(length) || 5) + ' x ' + (Number(width) || 4) + ' x ' + (Number(height) || 2.6) + ' ft'),
      'Floor area ' + floorArea.toFixed(1) + (metric ? ' m²' : ' ft²') + ', volume ' + volume.toFixed(1) + (metric ? ' m³' : ' ft³'),
      'Design: ' + (Number(outdoor) || 35) + ' C outside, ' + (Number(indoor) || 24) + ' C inside, ΔT ' + dT_c.toFixed(1) + ' C',
      'Envelope: ' + ins.label + ', ' + ins.ach + ' air changes an hour',
      '',
      'Fabric gain: ' + fabricW.toFixed(0) + ' W',
      'Solar through glazing: ' + solarW.toFixed(0) + ' W',
      'People: ' + peopleW.toFixed(0) + ' W',
      'Appliances and lighting: ' + (applianceW + lightW).toFixed(0) + ' W',
      'Infiltration: ' + infiltrationW.toFixed(0) + ' W',
      'Diversity multiplier: ' + multiplier.toFixed(2),
      '',
      'TOTAL: ' + totalW.toFixed(0) + ' W  |  ' + totalBtu.toFixed(0) + ' BTU/h  |  ' + tons.toFixed(2) + ' tons',
      'Sensible heat ratio: ' + shr.toFixed(2),
      'Recommended unit: ' + recommendedKw.toFixed(1) + ' kW / ' + recommendedBtu.toLocaleString() + ' BTU/h',
    ].join('\n');

    return {
      metric, l, w, h, floorArea, volume, ins, orient, dT_c, dT_f, glazingArea, shade, envelopeArea, wallArea, fabricW, solarW,
      peopleW, applianceW, lightW, internalTotal, infiltrationW, subtotalW, multiplier, totalW, totalBtu, tons, sensible, latent,
      shr, recommendedKw, recommendedBtu, breakdown, top, warnings, report,
    };
  }, [length, width, height, insulation, orientation, windowArea, people, applianceWatts, outdoor, indoor, lightingWatts, shading, extra, unit]);

  return (
    <ToolShell
      toolId="heat-load"
      icon={Flame}
      title="Room Heat Load & AC Sizing"
      desc="Work out what a room actually gains from walls, glazing, people, appliances and air leakage — then size the cooling unit in kW, BTU and tons with a real diversity margin."
      state={{ length, width, height, insulation, orientation, windowArea, people, applianceWatts, outdoor, indoor, lightingWatts, shading, extra, unit }}
      onRestore={(restored) => {
        const map = { length: setLength, width: setWidth, height: setHeight, windowArea: setWindowArea, people: setPeople, applianceWatts: setApplianceWatts, outdoor: setOutdoor, indoor: setIndoor, lightingWatts: setLightingWatts, shading: setShading };
        Object.entries(map).forEach(([key, setter]) => { if (restored[key] !== undefined) setter(String(restored[key])); });
        if (restored.insulation) setInsulation(restored.insulation);
        if (restored.orientation) setOrientation(restored.orientation);
        if (restored.unit) setUnit(restored.unit);
        if (restored.extra) setExtra((current) => ({ ...current, ...restored.extra }));
      }}
      exportText={result.report}
      exportName="room-heat-load.txt"
    >
      <Seg value={unit} onChange={setUnit} options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={result.metric ? 'Length, m' : 'Length, ft'}><input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Width, m' : 'Width, ft'}><input value={width} onChange={(e) => setWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Ceiling height, m' : 'Ceiling height, ft'}><input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={result.metric ? 'Glazing area, m²' : 'Glazing area, ft²'}><input value={windowArea} onChange={(e) => setWindowArea(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Outdoor design °C"><input value={outdoor} onChange={(e) => setOutdoor(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Indoor target °C"><input value={indoor} onChange={(e) => setIndoor(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Occupants"><input value={people} onChange={(e) => setPeople(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Appliances, W"><input value={applianceWatts} onChange={(e) => setApplianceWatts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Lighting, W"><input value={lightingWatts} onChange={(e) => setLightingWatts(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Shading factor"><input value={shading} onChange={(e) => setShading(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Construction"><Seg value={insulation} onChange={setInsulation} options={INSULATION.map((entry) => ({ value: entry.id, label: entry.label.split(' ')[0] }))} /></Field>
        <Field label="Main glazing faces"><Seg value={orientation} onChange={setOrientation} options={ORIENTATION.map((entry) => ({ value: entry.id, label: entry.label }))} /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <ToggleRow label="Kitchen in the room" checked={extra.kitchen} onChange={() => toggle('kitchen')} hint="+10% diversity" />
        <ToggleRow label="Top floor or roof exposed" checked={extra.topFloor} onChange={() => toggle('topFloor')} hint="+8%" />
        <ToggleRow label="Long duct runs" checked={extra.ductLoss} onChange={() => toggle('ductLoss')} hint="+12% for duct gain" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={'Room of ' + result.floorArea.toFixed(0) + (result.metric ? ' m²' : ' ft²') + ' with ' + result.glazingArea.toFixed(1) + (result.metric ? ' m²' : ' ft²') + ' of glazing'}
          value={result.recommendedKw.toFixed(1)}
          unit="kW cooling"
          sub={'Total load ' + result.totalW.toFixed(0) + ' W, which is ' + Math.round(result.totalBtu).toLocaleString() + ' BTU/h or ' + result.tons.toFixed(2) + ' tons. Glazing faces ' + result.orient.label.toLowerCase() + ', and the sensible heat ratio works out at ' + result.shr.toFixed(2) + '.'}
        />
        <Gauge
          value={Number(result.tons.toFixed(2))}
          min={0}
          max={5}
          label="Tons of cooling"
          unit=" ton"
          bands={[{ to: 1, tone: 'cyan' }, { to: 2.5, tone: 'violet' }, { to: 5, tone: 'rose' }]}
          caption="Typical residential split units run from about 0.75 ton for a small bedroom to 3 tons for a large open living area."
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the heat comes from</div>
          <Bars data={result.breakdown} suffix=" W" format={(v) => v.toFixed(0)} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sun through glass and air leakage are the two gains you can remove cheaply. Everything else is either the envelope or the people using the room.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Sizing sheet</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <pre className="max-h-64 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{result.report}</pre>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Total load" value={(result.totalW / 1000).toFixed(2)} mono sub="kW thermal" />
        <Stat label="Recommended" value={result.recommendedBtu.toLocaleString()} mono sub="BTU/h" />
        <Stat label="Diversity" value={result.multiplier.toFixed(2)} mono sub="× applied to subtotal" />
        <Stat label="Air changes" value={String(result.ins.ach)} mono sub="per hour, uncontrolled" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Ranked by what you can fix</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.top.map((item) => <p key={item.label}>· {item.label}: {item.value.toFixed(0)} W ({Math.round((item.value / Math.max(1, result.totalW)) * 100)}% of the load)</p>)}
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'ΔT', value: result.dT_c.toFixed(1) + ' K' },
                { label: 'SHR', value: result.shr.toFixed(2), tone: result.shr < 0.75 ? 'amber' : undefined },
                { label: 'Design day', value: result.dT_f.toFixed(0) + ' °F' },
              ]}
            />
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What actually changes the answer</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Every degree of lower indoor setpoint adds roughly 4 to 6% to the load. Setting the thermostat to 18 instead of 24 can add a whole size step.</p>
            <p>· West-facing glass is usually the worst case in the late afternoon, which is exactly when the room is already warm and the unit is least efficient.</p>
            <p>· Oversizing is not harmless. A unit that short-cycles removes sensible heat while leaving humidity behind, so the room feels damp and cold at once.</p>
            <p>· Internal gains from equipment are steady and predictable, and they matter far more in a small well-sealed room than in a large leaky one.</p>
            <p>· Real units are rated at specific indoor and outdoor conditions. A nominal three-ton machine rarely delivers three tons on a 40 °C afternoon.</p>
            <p>· In humid climates the latent load can be a third of the total; a unit sized only on sensible heat will underperform all summer.</p>
          </div>
        </Panel>
      </div>

      {result.warnings.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Watch these</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
          </div>
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A steady-state estimate using typical U values, an internal gain of about 120 W per person and a solar factor for unshaded glazing. A proper room-by-room manual J calculation accounts for
          thermal mass, duct design, ventilation requirements and local design conditions — this gets you to within a size step or so.
        </p>
      </Panel>
    </ToolShell>
  );
}