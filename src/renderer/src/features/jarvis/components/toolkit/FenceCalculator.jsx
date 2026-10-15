import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const money = (value, currency) => currency + Math.round(value).toLocaleString();

export default function FenceCalculator() {
  const [units, setUnits] = useState('metric');
  const [length, setLength] = useState('24');
  const [spacing, setSpacing] = useState('2.4');
  const [height, setHeight] = useState('1.8');
  const [railsPerBay, setRailsPerBay] = useState('3');
  const [gates, setGates] = useState('1');
  const [gateWidth, setGateWidth] = useState('1');
  const [postDepth, setPostDepth] = useState('0.6');
  const [holeDiameter, setHoleDiameter] = useState('0.25');
  const [bagYield, setBagYield] = useState('0.01');
  const [wastage, setWastage] = useState('8');
  const [prices, setPrices] = useState({ panel: '45', post: '12', rail: '6', concrete: '6', gate: '120' });
  const [currency, setCurrency] = useState('£');

  const setPrice = (key, value) => setPrices((current) => ({ ...current, [key]: value }));

  const result = useMemo(() => {
    const metric = units === 'metric';
    const runLength = Math.max(0, Number(length) || 0);
    const bayWidth = Math.max(0.3, Number(spacing) || 2.4);
    const gateCount = Math.max(0, Math.floor(Number(gates) || 0));
    const oneGate = Math.max(0.5, Number(gateWidth) || 1);
    const wasteFactor = 1 + Math.max(0, Number(wastage) || 0) / 100;

    const gateTotal = gateCount * oneGate;
    const fencedLength = Math.max(0, runLength - gateTotal);
    const bays = Math.ceil(fencedLength / bayWidth);
    const posts = bays + 1 + gateCount * 2 - (gateCount > 0 ? gateCount : 0);
    const rails = bays * Math.max(1, Number(railsPerBay) || 3);

    const holeVolume = Math.PI * Math.pow(Math.max(0.05, Number(holeDiameter) || 0.25) / 2, 2) * Math.max(0.1, Number(postDepth) || 0.6);
    const yield1000 = Math.max(0.002, Number(bagYield) || 0.01);
    const concreteVolume = holeVolume * posts;
    const bags = Math.ceil((concreteVolume / yield1000) * 1.05);

    const panels = Math.ceil(bays * wasteFactor);
    const railCount = Math.ceil(rails / (metric ? 1 : 1) * wasteFactor);
    const postCount = Math.ceil(posts * wasteFactor);

    const cost = {
      panels: panels * (Number(prices.panel) || 0),
      posts: postCount * (Number(prices.post) || 0),
      rails: railCount * (Number(prices.rail) || 0),
      concrete: bags * (Number(prices.concrete) || 0),
      gates: gateCount * (Number(prices.gate) || 0),
    };
    const totalCost = Object.values(cost).reduce((sum, value) => sum + value, 0);
    const costPerLength = runLength ? totalCost / runLength : 0;

    const heightValue = Math.max(0.3, Number(height) || 1.8);
    const depthGuide = Math.max(0.45, heightValue / 3 + 0.06);
    const bayLength = runLength ? fencedLength / Math.max(1, bays) : 0;

    const warnings = [];
    if (depthGuide > (Number(postDepth) || 0.6)) warnings.push('Post holes should be about ' + depthGuide.toFixed(2) + ' ' + (metric ? 'm' : 'units') + ' deep for a ' + heightValue + ' ' + (metric ? 'm' : 'unit') + ' fence — a third of the height plus a hand width. Yours are shallower.');
    if (bayLength > bayWidth * 1.2) warnings.push('The bays work out at ' + bayLength.toFixed(2) + ' each, noticeably wider than the posts are designed to carry in high wind.');
    if (heightValue > 2 && metric) warnings.push('Above 2 m a fence usually needs planning permission in many jurisdictions, and wind loading rises sharply.');
    if (posts < 2) warnings.push('A fence needs at least two posts.');

    const materials = [
      { label: 'Panels or bays', value: panels, unit: 'panels' },
      { label: 'Posts', value: postCount, unit: 'posts' },
      { label: 'Rails', value: railCount, unit: 'rails' },
      { label: 'Concrete', value: bags, unit: 'bags' },
      { label: 'Gates', value: gateCount, unit: 'gates' },
    ];

    return {
      metric, runLength, bayWidth, bays, posts, rails, panels, railCount, postCount, bags, gates: gateCount, gateTotal,
      fencedLength, bayLength, concreteVolume, holeVolume, totalCost, costPerLength, cost, materials, warnings,
      depthGuide, heightValue, costChart: Object.entries(cost).map(([key, value]) => ({ label: key, value: Math.round(value) })),
      postPositions: Array.from({ length: Math.min(12, postCount) }, (unused, index) => (metric ? (index * bayLength).toFixed(2) + ' m' : (index * bayLength).toFixed(1))),
    };
  }, [units, length, spacing, height, railsPerBay, gates, gateWidth, postDepth, holeDiameter, bagYield, wastage, prices, currency]);

  const report = useMemo(() => [
    'Fence run ' + result.runLength + (result.metric ? ' m' : '') + ' with ' + result.gates + ' gate' + (result.gates === 1 ? '' : 's'),
    result.bays + ' bays at ' + result.bayLength.toFixed(2) + ' each · ' + result.postCount + ' posts · ' + result.railCount + ' rails',
    '',
    'Concrete: ' + result.bags + ' bags for ' + result.postCount + ' post holes of ' + result.holeVolume.toFixed(4) + ' m³ each',
    'Hole depth guideline: ' + result.depthGuide.toFixed(2) + ' m for this height',
    '',
    'Materials: ' + result.materials.map((entry) => entry.value + ' ' + entry.unit).join(', '),
    '',
    'Cost: ' + money(result.totalCost, currency) + ' total, ' + money(result.costPerLength, currency) + ' per ' + (result.metric ? 'metre' : 'foot'),
    ...Object.entries(result.cost).map(([key, value]) => '  ' + key + ': ' + money(value, currency)),
    '',
    ...result.warnings.map((line) => '· ' + line),
  ].join('\n'), [result, currency]);

  return (
    <ToolShell
      toolId="fence-calculator"
      icon={Layers}
      title="Fence & Post Calculator"
      desc="A run length into bay count, posts, rails, panels and bags of concrete, with hole depth guidance for the height, wind-loading warnings and a full cost breakdown."
      state={{ units, length, spacing, height, railsPerBay, gates, gateWidth, postDepth, holeDiameter, bagYield, wastage, prices, currency }}
      onRestore={(restored) => {
        if (restored.units) setUnits(restored.units);
        if (restored.length !== undefined) setLength(String(restored.length));
        if (restored.spacing !== undefined) setSpacing(String(restored.spacing));
        if (restored.height !== undefined) setHeight(String(restored.height));
        if (restored.railsPerBay !== undefined) setRailsPerBay(String(restored.railsPerBay));
        if (restored.gates !== undefined) setGates(String(restored.gates));
        if (restored.gateWidth !== undefined) setGateWidth(String(restored.gateWidth));
        if (restored.postDepth !== undefined) setPostDepth(String(restored.postDepth));
        if (restored.holeDiameter !== undefined) setHoleDiameter(String(restored.holeDiameter));
        if (restored.bagYield !== undefined) setBagYield(String(restored.bagYield));
        if (restored.wastage !== undefined) setWastage(String(restored.wastage));
        if (restored.prices) setPrices((current) => ({ ...current, ...restored.prices }));
        if (typeof restored.currency === 'string') setCurrency(restored.currency);
      }}
      exportText={report}
      exportName="fence-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Total run length"><input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Post spacing (bay width)"><input value={spacing} onChange={(e) => setSpacing(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Fence height"><input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Rails per bay"><input value={railsPerBay} onChange={(e) => setRailsPerBay(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Number of gates"><input value={gates} onChange={(e) => setGates(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gate width each"><input value={gateWidth} onChange={(e) => setGateWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Post depth in the ground"><input value={postDepth} onChange={(e) => setPostDepth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Hole diameter"><input value={holeDiameter} onChange={(e) => setHoleDiameter(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Concrete per bag, m³"><input value={bagYield} onChange={(e) => setBagYield(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Wastage, %"><input value={wastage} onChange={(e) => setWastage(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Panel price"><input value={prices.panel} onChange={(e) => setPrice('panel', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Post price"><input value={prices.post} onChange={(e) => setPrice('post', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Rail price"><input value={prices.rail} onChange={(e) => setPrice('rail', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Concrete bag price"><input value={prices.concrete} onChange={(e) => setPrice('concrete', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gate price"><input value={prices.gate} onChange={(e) => setPrice('gate', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <Field label="Currency">
        <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-9 w-24 rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>

      {result.warnings.length > 0 && (
        <Panel className="!p-3 !border-amber-400/50">
          <div className="space-y-1 text-[11px] text-amber-200">
            {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Posts needed"
          value={String(result.postCount)}
          sub={result.bays + ' bays at ' + result.bayLength.toFixed(2) + ' each' + (result.gates ? ', with ' + result.gates + ' gate' + (result.gates === 1 ? '' : 's') + ' taking ' + result.gateTotal.toFixed(2) + ' out of the run' : '') + '. That is ' + result.panels + ' panels or bays, ' + result.railCount + ' rails and ' + result.bags + ' bags of concrete, allowing ' + wastage + '% wastage.'}
        />
        <Ring
          value={result.totalCost}
          max={Math.max(100, result.totalCost * 1.2)}
          label="Total materials cost"
          sub={money(result.costPerLength, currency) + ' per ' + (result.metric ? 'metre' : 'unit') + ' of fence'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Materials list</span>
            <CopyBtn value={report} label="Copy the plan" />
          </div>
          <div className="space-y-1.5">
            {result.materials.map((entry) => (
              <div key={entry.label} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground">{entry.label}</span>
                <span className="font-mono-j text-cyan-j">{entry.value} {entry.unit}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="text-muted-foreground">Concrete to mix</span>
              <span className="font-mono-j">{result.concreteVolume.toFixed(3)} m³</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5 text-[11px]">
              <span>Total cost</span>
              <span className="font-mono-j text-cyan-j">{money(result.totalCost, currency)}</span>
            </div>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the money goes</div>
          <Bars data={result.costChart} format={(value) => money(value, currency)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Panels dominate a panel fence, posts dominate a post-and-rail fence, and concrete is usually the smallest line. If the total looks wrong, the material choice is the
            place to look rather than the quantities.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Bays" value={String(result.bays)} mono sub={result.bayLength.toFixed(2) + ' each'} />
        <Stat label="Posts" value={String(result.postCount)} mono sub="including gate posts" />
        <Stat label="Rails" value={String(result.railCount)} mono sub={railsPerBay + ' per bay'} />
        <Stat label="Concrete" value={result.bags + ' bags'} mono sub={result.concreteVolume.toFixed(3) + ' m³'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Post positions along the run</div>
        <div className="flex flex-wrap gap-1.5">
          {result.postPositions.map((position, index) => (
            <span key={position + index} className="rounded-lg border border-border/60 bg-card/40 px-2 py-1 font-mono-j text-[11px]">
              {index + 1} · {position}
            </span>
          ))}
          {result.postCount > 12 && <span className="rounded-lg border border-border/60 px-2 py-1 font-mono-j text-[11px] text-muted-foreground">and {result.postCount - 12} more at the same spacing</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          These are centres, not hole edges. Measure from one end and mark every centre before digging anything, because a run of holes in the wrong place is the most expensive
          mistake in fencing.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Setting posts that stay put</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A third of the post in the ground, plus a hand width. For this height that works out at about {result.depthGuide.toFixed(2)}. Shallow holes are the only reason a fence ever leans.</p>
            <p>· Widen the hole at the base rather than making it a straight tube. A bell-shaped concrete collar resists lifting far better than a smooth cylinder.</p>
            <p>· Concrete should sit slightly proud and slope away from the post so water runs off rather than pooling at the base.</p>
            <p>· Put a little gravel in first for drainage, unless you are using post-mix that sets by absorbing ground moisture.</p>
            <p>· Brace the posts while the concrete cures. Twenty-four hours of setting is undone in a minute by a post knocked out of plumb.</p>
            <p>· Treat cut ends of timber posts. The base is the wettest part of the fence and the part nobody sees rotting.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Gates, wind and the awkward bits</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Gates need heavier posts than the rest of the run, concreted deeper, because every swing loads the hinge post in a way a panel never does.</p>
            <p>· Allow the gate to open fully in both directions and clear the ground by a couple of centimetres. Gravel boards and uneven ground are what jam them.</p>
            <p>· Wind is the structural load on a fence. Solid panels catch nearly all of it, so consider gaps or a slatted design on an exposed boundary.</p>
            <p>· {result.metric ? 'Height above 2 m often needs permission, and any height above 1 m next to a highway is usually restricted.' : 'Check local height limits — fences next to a road are commonly restricted to about 3 feet.'}</p>
            <p>· Leave expansion space on timber. Boards butt-jointed tight will buckle in the first wet week.</p>
            <p>· Order 5 to 10% spare panels. You will cut one wrong, and a matching replacement months later is rarely the same shade.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Bays', value: String(result.bays) },
                { label: 'Posts', value: String(result.postCount) },
                { label: 'Total', value: money(result.totalCost, currency) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>fenced length = total run − gates × gate width</p>
          <p>bays = ceil(fenced length ÷ post spacing)</p>
          <p>posts = bays + 1, adjusted for the extra posts a gate needs</p>
          <p>rails = bays × rails per bay</p>
          <p>hole volume = π × r² × depth, bags = total volume ÷ yield per bag × 1.05</p>
          <p className="text-cyan-j">Check: {result.bays} bays × {railsPerBay} rails = {result.rails} rails before wastage.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Quantities are geometric and assume a straight run on level ground with even spacing. Slopes, corners and existing obstructions all add posts, and a corner post carries
          load from two directions at once.
        </p>
      </Panel>
    </ToolShell>
  );
}