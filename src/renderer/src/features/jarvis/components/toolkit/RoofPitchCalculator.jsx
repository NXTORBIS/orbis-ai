import { useMemo, useState } from 'react';
import { Home } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PITCHES = [
  { label: '1:12', rise: 1, note: 'minimum for most tiled and profiled roofs' },
  { label: '2:12', rise: 2, note: 'shingles need at least two layers of underlay here' },
  { label: '3:12', rise: 3, note: 'common for sheds and low-profile extensions' },
  { label: '4:12', rise: 4, note: 'the most common residential pitch' },
  { label: '5:12', rise: 5, note: 'comfortable walkable roof' },
  { label: '6:12', rise: 6, note: 'standard in snowy regions' },
  { label: '8:12', rise: 8, note: 'steep, needs roof jacks for safety' },
  { label: '10:12', rise: 10, note: 'very steep, specialist access' },
];

export default function RoofPitchCalculator() {
  const [units, setUnits] = useState('metric');
  const [rise, setRise] = useState('5');
  const [run, setRun] = useState('12');
  const [buildingWidth, setBuildingWidth] = useState('8000');
  const [buildingLength, setBuildingLength] = useState('12000');
  const [overhang, setOverhang] = useState('450');
  const [waste, setWaste] = useState('10');
  const [includeRidge, setIncludeRidge] = useState('true');

  const result = useMemo(() => {
    const riseValue = Math.max(0.1, Number(rise) || 5);
    const runValue = Math.max(0.1, Number(run) || 12);
    const ratio = riseValue / runValue;
    const angle = (Math.atan(ratio) * 180) / Math.PI;
    const multiplier = Math.sqrt(1 + ratio * ratio);

    const metric = units === 'metric';
    const width = Math.max(1, Number(buildingWidth) || 8000);
    const length = Math.max(1, Number(buildingLength) || 12000);
    const over = Math.max(0, Number(overhang) || 0);
    const wastePercent = Math.max(0, Math.min(30, Number(waste) || 10));

    const span = width;
    const halfSpan = span / 2 + over;
    const rafterLength = halfSpan * multiplier;
    const roofHeight = (span / 2) * ratio;
    const slopeLength = rafterLength * 2;
    const slopeAreaM2 = (slopeLength * length) / 1e6;
    const planAreaM2 = (span * length) / 1e6;
    const ridgeLength = length + over * 2;
    const eaveLength = length + over * 2;
    const gableArea = ratio * halfSpan * halfSpan;
    const fasciaLength = (eaveLength * 2 + slopeLength * 2);
    const gutterLength = eaveLength * 2;

    const wasteFactor = 1 + wastePercent / 100;
    const withWaste = slopeAreaM2 * wasteFactor;

    const imperial = !metric;
    const convert = (mm) => (imperial ? (mm / 304.8).toFixed(1) + ' ft' : (mm / 1000).toFixed(2) + ' m');
    const areaOut = (m2) => (imperial ? (m2 * 10.7639).toFixed(0) + ' ft²' : m2.toFixed(1) + ' m²');

    const bundles = imperial ? Math.ceil((withWaste * 10.7639) / 33.3) : Math.ceil(withWaste / 1.2);
    const underlayRolls = Math.ceil(withWaste / 65);
    const nailKg = (withWaste * 0.2).toFixed(1);
    const ridgeUnits = Math.ceil(ridgeLength / 1000 / 0.3);
    const fasciaBoards = Math.ceil(fasciaLength / 3600);
    const gutterLengthOut = gutterLength / 1000;

    const pitchRows = PITCHES.map((entry) => ({
      label: entry.label,
      value: Number((Math.sqrt(1 + Math.pow(entry.rise / 12, 2))).toFixed(3)),
      note: entry.note,
    }));

    const warnings = [];
    if (angle < 10) warnings.push('At ' + angle.toFixed(1) + '° the pitch is very low. Most roofing materials below 10° need a sealed membrane rather than simple underlay.');
    if (angle > 45) warnings.push('At ' + angle.toFixed(1) + '° the roof is steep enough that fall protection is mandatory and every job takes longer. Add labour to the estimate.');
    if (over > halfSpan * 0.2) warnings.push('The overhang of ' + convert(over) + ' is generous. Deep eaves shade well but need more support, and uplift at the edge rises sharply in wind.');
    if (wastePercent < 8) warnings.push('At ' + wastePercent + '% waste the estimate is tight. Hips, valleys and cut courses consume more material than a plain gable, and 10 to 15% is normal.');
    if (!warnings.length) warnings.push('At ' + angle.toFixed(1) + '° the pitch is normal for residential work, with cutting waste at ' + wastePercent + '% and a sensible overhang of ' + convert(over) + '.');

    const report = [
      'Roof pitch ' + riseValue + ':' + runValue + ' — that is ' + angle.toFixed(2) + '° or ' + (ratio * 12).toFixed(1) + ' in 12',
      'Pitch multiplier ' + multiplier.toFixed(4) + ': every unit of horizontal run is ' + multiplier.toFixed(3) + ' units up the slope',
      '',
      'Span ' + convert(span) + ' × length ' + convert(length) + ', overhang ' + convert(over),
      'Rafter length ' + convert(rafterLength) + ' (half span plus overhang, multiplied by the pitch factor)',
      'Roof height above the wall plate ' + convert(roofHeight),
      'Plan area ' + areaOut(planAreaM2) + ' · sloped surface area ' + areaOut(slopeAreaM2),
      'With ' + wastePercent + '% cutting waste: ' + areaOut(withWaste),
      'Gable area ' + areaOut(gableArea),
      '',
      'Ridge ' + convert(ridgeLength) + ' · eaves ' + convert(eaveLength) + ' · fascia run ' + convert(fasciaLength) + ' · gutter ' + gutterLengthOut.toFixed(1) + ' m',
      '',
      'Materials: ' + bundles + ' bundles of shingles, ' + underlayRolls + ' rolls of underlay, about ' + nailKg + ' kg of nails, ' + ridgeUnits + ' ridge units, ' + fasciaBoards + ' fascia boards',
      '',
      ...warnings,
    ].join('\n');

    return {
      riseValue, runValue, ratio, angle, multiplier, span, length, over, wastePercent, halfSpan, rafterLength, roofHeight,
      slopeLength, slopeAreaM2, planAreaM2, ridgeLength, eaveLength, gableArea, fasciaLength, gutterLength, withWaste,
      bundles, underlayRolls, nailKg, ridgeUnits, fasciaBoards, gutterLengthOut, pitchRows, warnings, report, convert, areaOut,
      chart: pitchRows,
      slopeChart: [
        { label: 'Plan', value: Number(planAreaM2.toFixed(1)) },
        { label: 'Sloped', value: Number(slopeAreaM2.toFixed(1)) },
        { label: 'With waste', value: Number(withWaste.toFixed(1)) },
      ],
    };
  }, [units, rise, run, buildingWidth, buildingLength, overhang, waste, includeRidge]);

  return (
    <ToolShell
      toolId="roof-pitch"
      icon={Home}
      title="Roof Pitch & Rafter Calculator"
      desc="Rise and run into the pitch angle, the multiplier, rafter and ridge lengths, true sloped area, gable area, and the material quantities to order with cutting waste included."
      state={{ units, rise, run, buildingWidth, buildingLength, overhang, waste, includeRidge }}
      onRestore={(restored) => {
        if (restored.units) setUnits(restored.units);
        if (restored.rise !== undefined) setRise(String(restored.rise));
        if (restored.run !== undefined) setRun(String(restored.run));
        if (restored.buildingWidth !== undefined) setBuildingWidth(String(restored.buildingWidth));
        if (restored.buildingLength !== undefined) setBuildingLength(String(restored.buildingLength));
        if (restored.overhang !== undefined) setOverhang(String(restored.overhang));
        if (restored.waste !== undefined) setWaste(String(restored.waste));
        if (restored.includeRidge) setIncludeRidge(restored.includeRidge);
      }}
      exportText={result.report}
      exportName="roof-pitch.txt"
    >
      <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet' }]} />

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={'Rise — ' + rise}><input value={rise} onChange={(e) => setRise(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Run — ' + run}><input value={run} onChange={(e) => setRun(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={units === 'metric' ? 'Building width, mm' : 'Building width, feet (in inches below)'}>
          <input value={buildingWidth} onChange={(e) => setBuildingWidth(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={units === 'metric' ? 'Building length, mm' : 'Building length, mm equivalent'}>
          <input value={buildingLength} onChange={(e) => setBuildingLength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label="Overhang past the wall, mm"><input value={overhang} onChange={(e) => setOverhang(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Cutting waste — ' + waste + '%'}><input type="range" min="0" max="25" value={waste} onChange={(e) => setWaste(e.target.value)} className="w-full accent-cyan-j" /></Field>
        <Field label="Ridge and hip material">
          <select value={includeRidge} onChange={(e) => setIncludeRidge(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="true">Include ridge units</option>
            <option value="false">Surface only</option>
          </select>
        </Field>
        <Field label="Set the pitch">
          <div className="flex flex-wrap gap-1.5">
            {PITCHES.slice(0, 4).map((entry) => (
              <button key={entry.label} type="button" onClick={() => { setRise(String(entry.rise)); setRun('12'); }} className="rounded-lg border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j">
                {entry.label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Pitch angle"
          value={result.angle.toFixed(1)}
          unit="°"
          sub={'A pitch of ' + result.riseValue + ' in ' + result.runValue + ', which is ' + (result.ratio * 12).toFixed(1) + ' in 12. The multiplier is ' + result.multiplier.toFixed(3) + ', so every metre of horizontal run is ' + result.multiplier.toFixed(3) + ' metres up the slope. Roof height above the wall plate is ' + result.convert(result.roofHeight) + ' and each rafter is ' + result.convert(result.rafterLength) + ' long.'}
        />
        <Ring
          value={result.angle}
          max={60}
          tone={result.angle < 10 ? 'amber' : result.angle > 45 ? 'amber' : 'emerald'}
          label="Pitch"
          sub={result.angle < 10 ? 'Very low — check the material allows it' : result.angle > 45 ? 'Steep — access and labour cost more' : 'A normal working pitch for residential roofing'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Plan area against sloped area</div>
          <Bars data={result.slopeChart} format={(value) => value.toFixed(1)} suffix=" m²" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Material is bought for the sloped area, never the plan area. At this pitch the slope adds {(((result.multiplier - 1) * 100)).toFixed(0)}% to the plan area, and wasting
            that step is the most common estimating mistake in roofing.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Lengths and materials</span>
            <CopyBtn value={result.report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pitch multiplier</span><span>{result.multiplier.toFixed(4)}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Rafter length</span><span className="text-cyan-j">{result.convert(result.rafterLength)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Roof height</span><span>{result.convert(result.roofHeight)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Sloped surface area</span><span>{result.areaOut(result.slopeAreaM2)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">With cutting waste</span><span>{result.areaOut(result.withWaste)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gable end area</span><span>{result.areaOut(result.gableArea)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Ridge length</span><span>{result.convert(result.ridgeLength)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Fascia run</span><span>{result.convert(result.fasciaLength)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gutter run</span><span>{result.gutterLengthOut.toFixed(1)} m</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Pitch multiplier at every common pitch</div>
        <Bars data={result.chart} format={(value) => value.toFixed(3)} suffix="" highlightLast={false} />
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {result.pitchRows.map((entry) => (
            <p key={entry.label} className="text-[11px] text-muted-foreground">· <span className="font-mono-j text-cyan-j">{entry.label}</span> — {entry.note}</p>
          ))}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Pitch" value={result.angle.toFixed(1) + '°'} mono sub={(result.ratio * 12).toFixed(1) + ' in 12'} />
        <Stat label="Rafter" value={result.convert(result.rafterLength)} mono sub="half span plus overhang" />
        <Stat label="Sloped area" value={result.areaOut(result.withWaste)} mono sub="with waste included" />
        <Stat label="Shingle bundles" value={String(result.bundles)} mono sub={result.underlayRolls + ' rolls of underlay'} />
      </div>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· Material quantities assume a simple gable roof with two equal planes. A hip roof adds four cut hips and a valley roof adds two, both of which consume noticeably more material per square metre.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Measuring and cutting</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Check the roof is actually symmetrical before cutting in pairs. Older buildings are often a few centimetres out, and assuming symmetry wastes every rafter.</p>
            <p>· Cut one rafter, test it, and use it as the pattern for the rest. It is faster than arithmetic on every board and catches mistakes on one piece instead of forty.</p>
            <p>· Measure the pitch on site with a level and a rule rather than trusting drawings. The as-built pitch is what the material has to fit.</p>
            <p>· Birdsmouth cuts at the wall plate change the effective rise, so mark from the plate up rather than from the wall.</p>
            <p>· Order the underlay before the shingles, and remember that low pitches need two layers with the laps doubled.</p>
            <p>· Keep the ridge and hip units to the end, and count them from the finished runs rather than the drawing.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What pitch means beyond roofing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· At {result.angle.toFixed(1)}°, rain sheds at roughly {Math.sin((result.angle * Math.PI) / 180).toFixed(2)} of the vertical rate while wind uplift on the eave rises with the square of pitch.</p>
            <p>· Anything below 20° behaves very differently to anything above 40°. Drainage, snow retention, wind loading and walkability all change at those thresholds.</p>
            <p>· Snow sheds above roughly 30° in most conditions and accumulates below it, which is why snowy regions use 6:12 and above.</p>
            <p>· Solar yield falls away above about 45° unless the array faces the winter sun, and steep roofs are harder to work on for both installers and maintenance.</p>
            <p>· The multiplier of {result.multiplier.toFixed(3)} applies to any sloped surface: roof sheathing, solar mounting rails, and the wire run up the slope.</p>
            <p>· Flat roofs are not flat. Even 1:40 matters, because water that stands on a roof destroys it slowly and completely.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Pitch', value: result.angle.toFixed(1) + '°' },
                { label: 'Multiplier', value: result.multiplier.toFixed(3) },
                { label: 'Area', value: result.areaOut(result.withWaste) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>pitch ratio = rise ÷ run · angle = arctan(rise ÷ run)</p>
          <p>multiplier = √(1 + ratio²), sometimes called the secant of the pitch angle</p>
          <p>rafter length = (half span + overhang) × multiplier</p>
          <p>roof height = half span × ratio</p>
          <p>sloped area = rafter length × 2 × building length · plan area = span × length</p>
          <p>gable end area = ratio × half span²</p>
          <p>materials use the sloped area increased by the cutting waste percentage</p>
          <p className="text-cyan-j">Check: half span plus overhang is {result.convert(result.halfSpan)}, and {(result.halfSpan / (units === 'metric' ? 1000 : 304.8)).toFixed(2)} × {result.multiplier.toFixed(3)} gives the rafter length of {result.convert(result.rafterLength)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Straight-line geometry for a symmetrical gable. Real roofs add ridge boards, purlins, valleys, dormers and structural checks for rafter spans, none of which are
          covered by pitch arithmetic. Confirm spans and fixings against local building requirements before ordering.
        </p>
      </Panel>
    </ToolShell>
  );
}