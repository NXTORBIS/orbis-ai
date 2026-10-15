import { useMemo, useState } from 'react';
import { Container } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const PERMUTATIONS = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

const metricDivisors = [4000, 5000, 6000, 8000];
const imperialDivisors = [139, 166, 200];

const PALLETS = [
  { id: 'euro', label: 'Euro pallet 120 × 80 cm', l: 120, w: 80 },
  { id: 'industrial', label: 'Industrial 120 × 100 cm', l: 120, w: 100 },
  { id: 'us', label: 'US 48 × 40 in', l: 121.92, w: 101.6 },
];

export default function BoxShipping() {
  const [unit, setUnit] = useState('cm');
  const [item, setItem] = useState({ l: 24, w: 16, h: 9, weight: 0.45 });
  const [box, setBox] = useState({ l: 40, w: 30, h: 24 });
  const [divisor, setDivisor] = useState(5000);
  const [rate, setRate] = useState(120);
  const [palletId, setPalletId] = useState('euro');
  const [stackHeight, setStackHeight] = useState(150);

  const factor = unit === 'cm' ? 1 : 2.54;
  const weightUnit = unit === 'cm' ? 'kg' : 'lb';

  const divisors = unit === 'cm' ? metricDivisors : imperialDivisors;
  const activeDivisor = divisors.includes(divisor) ? divisor : divisors[1];

  const result = useMemo(() => {
    const i = [Number(item.l) * factor, Number(item.w) * factor, Number(item.h) * factor];
    const b = [Number(box.l) * factor, Number(box.w) * factor, Number(box.h) * factor];
    const itemWeight = Number(item.weight) || 0;
    const itemVolume = i[0] * i[1] * i[2];
    const boxVolume = b[0] * b[1] * b[2];

    const orientations = PERMUTATIONS.map((order) => {
      const dims = [i[order[0]], i[order[1]], i[order[2]]];
      const fits = dims.every((dim, axis) => dim <= b[axis] + 1e-6);
      const counts = dims.map((dim, axis) => (dim > 0 ? Math.floor(b[axis] / dim) : 0));
      const total = fits ? counts.reduce((product, value) => product * value, 1) : 0;
      return { dims, fits, counts, total };
    });

    const best = orientations.reduce((top, current) => (current.total > top.total ? current : top), orientations[0]);
    const fits = orientations.some((orientation) => orientation.fits);
    const perBox = fits ? Math.max(1, best.total) : 0;
    const packedVolume = perBox * itemVolume;
    const fill = boxVolume > 0 ? (packedVolume / boxVolume) * 100 : 0;
    const volumetric = boxVolume > 0 ? boxVolume / activeDivisor : 0;
    const grossPerBox = perBox * itemWeight;
    const billable = Math.max(volumetric, grossPerBox);
    const chargeable = billable > volumetric * 1.01 && grossPerBox > volumetric ? 'gross' : 'volume';
    const perItemCost = perBox > 0 ? (billable * (Number(rate) || 0)) / perBox : 0;
    const itemPerCost = billable > 0 && perBox > 0 ? perBox / billable : 0;

    const pallet = PALLETS.find((entry) => entry.id === palletId) || PALLETS[0];
    const carton = [Number(box.l) * factor, Number(box.w) * factor, Number(box.h) * factor];
    const palletPermutations = PERMUTATIONS.map((order) => {
      const dims = [carton[order[0]], carton[order[1]], carton[order[2]]];
      const perLayer = Math.floor(pallet.l / dims[0]) * Math.floor(pallet.w / dims[1]);
      const layers = dims[2] > 0 ? Math.floor((Number(stackHeight) || 0) / dims[2]) : 0;
      return { perLayer, layers, total: Math.max(0, perLayer) * Math.max(0, layers), dims };
    });
    const bestPallet = palletPermutations.reduce((top, current) => (current.total > top.total ? current : top), palletPermutations[0]);
    const realistic = Math.floor(bestPallet.total * 0.85);

    const volumeSavings = boxVolume > 0 && itemVolume > 0 ? (1 - packedVolume / boxVolume) * 100 : 0;

    return {
      orientations, best, fits, perBox, fill, volumetric, grossPerBox, billable, chargeable,
      perItemCost, itemPerCost, bestPallet, realistic, volumeSavings, itemVolume, boxVolume,
      itemDims: i, boxDims: b, pallet,
    };
  }, [item, box, factor, activeDivisor, rate, palletId, stackHeight]);

  const u = unit;
  const n = (value) => (Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(2));

  const suggestions = useMemo(() => {
    if (result.fits) return [];
    const dims = [Number(item.l) * factor, Number(item.w) * factor, Number(item.h) * factor].sort((a, b) => a - b);
    const padded = dims.map((dim) => Math.ceil(dim + 1));
    return [
      { label: 'Smallest practical carton', value: padded.join(' × ') + ' ' + u },
      { label: 'Adds volume', value: n(padded[0] * padded[1] * padded[2]) + ' ' + (u === 'cm' ? 'cm³' : 'in³') },
    ];
  }, [result.fits, item, factor, u]);

  const report = [
    'Carton fit & volumetric weight',
    '',
    'Item ' + item.l + ' × ' + item.w + ' × ' + item.h + ' ' + u + ' · ' + item.weight + ' ' + weightUnit,
    'Carton ' + box.l + ' × ' + box.w + ' × ' + box.h + ' ' + u,
    'Divisor ' + activeDivisor + ' ' + (u === 'cm' ? 'cm³/' + weightUnit : 'in³/' + weightUnit),
    '',
    result.fits ? 'Fits — up to ' + result.perBox + ' per carton, carton ' + result.fill.toFixed(0) + '% full' : 'Does not fit in any orientation',
    'Carton volume ' + n(result.boxVolume) + ' · item volume ' + n(result.itemVolume),
    'Volumetric weight ' + result.volumetric.toFixed(3) + ' ' + weightUnit + ' · gross ' + result.grossPerBox.toFixed(3) + ' ' + weightUnit,
    'Billable weight ' + result.billable.toFixed(3) + ' ' + weightUnit + ' (' + (result.chargeable === 'gross' ? 'actual weight governs' : 'volume governs') + ')',
    'Cost per carton at ' + rate + '/kg: ' + n(result.billable * (Number(rate) || 0)) + ' · per item ' + n(result.perItemCost),
    '',
    result.pallet.label + ': ' + result.bestPallet.perLayer + ' per layer × ' + result.bestPallet.layers + ' layers = ' + result.bestPallet.total + ' cartons (' + result.realistic + ' in practice)',
  ].join('\n');

  return (
    <ToolShell
      toolId="box-shipping"
      icon={Container}
      title="Carton Fit & Volumetric Weight"
      desc="Does the product fit the box, how many go in, and what will the courier actually charge for? Works out the best orientation, the empty space you are paying for, the billable weight after the divisor and how many cartons a pallet holds."
      state={{ unit, item, box, divisor, rate, palletId, stackHeight }}
      onRestore={(restored) => {
        if (typeof restored.unit === 'string') setUnit(restored.unit);
        if (restored.item && typeof restored.item === 'object') setItem(restored.item);
        if (restored.box && typeof restored.box === 'object') setBox(restored.box);
        if (restored.divisor !== undefined) setDivisor(restored.divisor);
        if (restored.rate !== undefined) setRate(restored.rate);
        if (typeof restored.palletId === 'string') setPalletId(restored.palletId);
        if (restored.stackHeight !== undefined) setStackHeight(restored.stackHeight);
      }}
      exportText={report}
      exportName="carton-fit.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={unit} onChange={(value) => { setUnit(value); setDivisor(value === 'cm' ? 5000 : 139); }} options={[{ value: 'cm', label: 'cm / kg' }, { value: 'in', label: 'in / lb' }]} />
        <Seg value={String(activeDivisor)} onChange={(value) => setDivisor(Number(value))} options={divisors.map((value) => ({ value: String(value), label: String(value) }))} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Product and carton</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="text-[11px] text-muted-foreground">Product ({u})</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="L"><Input type="number" step="0.1" value={item.l} onChange={(e) => setItem({ ...item, l: e.target.value })} /></Field>
                <Field label="W"><Input type="number" step="0.1" value={item.w} onChange={(e) => setItem({ ...item, w: e.target.value })} /></Field>
                <Field label="H"><Input type="number" step="0.1" value={item.h} onChange={(e) => setItem({ ...item, h: e.target.value })} /></Field>
              </div>
              <Field label={'Unit weight (' + weightUnit + ')'}>
                <Input type="number" step="0.01" value={item.weight} onChange={(e) => setItem({ ...item, weight: e.target.value })} />
              </Field>
            </div>
            <div className="space-y-2">
              <div className="text-[11px] text-muted-foreground">Carton ({u})</div>
              <div className="grid grid-cols-3 gap-2">
                <Field label="L"><Input type="number" step="0.1" value={box.l} onChange={(e) => setBox({ ...box, l: e.target.value })} /></Field>
                <Field label="W"><Input type="number" step="0.1" value={box.w} onChange={(e) => setBox({ ...box, w: e.target.value })} /></Field>
                <Field label="H"><Input type="number" step="0.1" value={box.h} onChange={(e) => setBox({ ...box, h: e.target.value })} /></Field>
              </div>
              <Field label={'Rate per ' + weightUnit} hint="Optional — used for the cost per item.">
                <Input type="number" step="1" value={rate} onChange={(e) => setRate(e.target.value)} />
              </Field>
            </div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Pallet base">
              <select
                value={palletId}
                onChange={(event) => setPalletId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                {PALLETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>
            </Field>
            <Field label="Maximum stack height (cm)">
              <Input type="number" step="5" value={stackHeight} onChange={(e) => setStackHeight(e.target.value)} />
            </Field>
          </div>
        </Panel>

        <div className="grid gap-3 sm:grid-cols-2">
          <Hero
            tone={result.fits ? (result.fill > 70 ? 'emerald' : 'amber') : 'rose'}
            label={result.fits ? 'Units per carton' : 'Does not fit'}
            value={result.fits ? String(result.perBox) : '—'}
            unit={result.fits ? 'units' : ''}
            sub={result.fits ? result.fill.toFixed(0) + '% of the carton volume used' : 'No orientation of the product fits this carton'}
          />
          <Ring
            value={result.fits ? result.fill : 0}
            max={100}
            tone={result.fill > 70 ? 'emerald' : result.fill > 45 ? 'amber' : 'rose'}
            label="Carton filled"
            sub={result.fits ? result.volumeSavings.toFixed(0) + '% is air' : 'change the carton'}
          />
        </div>
      </div>

      {!result.fits && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">
          The product does not fit in any of the six rotations. The smallest carton that would take it is roughly {suggestions[0]?.value} — see the suggestions below.
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Volumetric weight" value={result.volumetric.toFixed(2) + ' ' + weightUnit} mono sub={'volume ÷ ' + activeDivisor} />
        <Stat label="Actual weight" value={result.grossPerBox.toFixed(2) + ' ' + weightUnit} mono sub="per packed carton" />
        <Stat label="Billable weight" value={result.billable.toFixed(2) + ' ' + weightUnit} mono sub={result.chargeable === 'gross' ? 'actual governs' : 'volume governs'} />
        <Stat label="Per unit shipped" value={n(result.perItemCost)} mono sub={'at ' + rate + ' per ' + weightUnit} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Every orientation, and what it gives you</div>
        <Bars
          data={result.orientations.map((orientation, index) => ({
            label: '#' + (index + 1),
            value: orientation.total,
            tone: orientation.total === 0 ? 'rose' : undefined,
          }))}
          format={(value) => String(Math.round(value))}
          highlightLast={false}
        />
        <div className="mt-3 space-y-1.5">
          {result.orientations.map((orientation, index) => (
            <div key={index} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-1.5 text-[11px]">
              <span className="font-mono-j">{orientation.dims.map((dim) => dim.toFixed(1)).join(' × ')} {u}</span>
              <span className="text-muted-foreground">{orientation.counts.join(' × ')} across the axes</span>
              <span className={orientation.fits ? 'font-mono-j text-cyan-j' : 'font-mono-j text-rose-400'}>
                {orientation.fits ? orientation.total + ' per carton' : 'does not fit'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          These counts assume one orientation per carton. Mixing orientations — some units on their side, some upright — can fit more in the same box, but only
          packing software or a test pack will tell you how many. Treat the best number here as the conservative plan.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What the courier will charge</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Volume is divided by {activeDivisor} to give a notional weight. Couriers charge whichever is greater, so light bulky goods are priced on space, not mass.</p>
            <p>· The billable weight here is {result.billable.toFixed(2)} {weightUnit} — {result.chargeable === 'gross' ? 'your product weight is the driver, so packing tighter does not reduce cost.' : 'volume is the driver, so a smaller carton is the cheapest change you can make.'}</p>
            <p>· This carton is {result.fill.toFixed(0)}% full. Moving to a carton a couple of centimetres tighter usually cuts the billable weight more than any negotiation.</p>
            <p>· Each unit currently costs {n(result.perItemCost)} to ship at {rate} per {weightUnit}, and one billable {weightUnit} carries {result.itemPerCost.toFixed(2)} units.</p>
            <p>· Add packaging mass, dunnage and the carton itself to the gross weight — the courier weighs what is handed over, not the product.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Pallets and practical packing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Best case on a {result.pallet.label.toLowerCase()} is {result.bestPallet.perLayer} cartons per layer across {result.bestPallet.layers} layers, {result.bestPallet.total} in total.</p>
            <p>· Plan on about {result.realistic} cartons. Real pallets lose 10–20% to overhang limits, slip sheets, mixed SKUs and the last layer not closing flush.</p>
            <p>· Stack height must include the pallet itself — typically 14–15 cm for a Euro pallet — and any height limit the carrier applies.</p>
            <p>· Never stack heavier cartons on lighter ones. Crush damage shows up at the customer, not the warehouse.</p>
            <p>· If the product can be shipped flat or knocked down, model that variant as a separate item. Reducing one dimension can change both the units per carton and the volumetric weight.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Per carton', value: String(result.perBox) },
                { label: 'Billable', value: result.billable.toFixed(2) + ' ' + weightUnit },
                { label: 'Pallet', value: String(result.realistic) },
              ]}
            />
          </div>
        </Panel>
      </div>

      {!result.fits && suggestions.length > 0 && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Carton suggestions</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            {suggestions.map((entry) => (
              <p key={entry.label}>· {entry.label}: <span className="font-mono-j text-cyan-j">{entry.value}</span></p>
            ))}
            <p>· Anything smaller than these cannot take the product in any orientation. Add a centimetre of clearance for wrapping, foam or a poly bag.</p>
            <p>· Once you have a candidate, put it back in the calculator above and check the fill percentage — the best carton usually lands between 70% and 90% full.</p>
          </div>
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Volume is length × width × height in your chosen units, volumetric weight is that volume divided by the carrier's divisor, and billable weight is the
          greater of volumetric and actual. Fit counts come from testing all six rotations of the product against the carton axes; pallet figures use the same method
          on the carton against the pallet base. Divisors vary by carrier, service and lane — confirm yours before quoting a customer.
        </p>
      </Panel>
    </ToolShell>
  );
}