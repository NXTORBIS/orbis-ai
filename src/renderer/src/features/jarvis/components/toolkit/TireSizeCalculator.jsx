import { useMemo, useState } from 'react';
import { Cog } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const BLANK = { width: 205, aspect: 55, rim: 16 };
const READINGS = [30, 50, 70, 100, 130];

const parseSize = (text) => {
  const match = String(text).toUpperCase().match(/(\d{3})\s*\/\s*(\d{2,3})\s*(?:Z?R|-?R)?\s*(\d{2}(?:\.5)?)/);
  if (!match) return null;
  return { width: Number(match[1]), aspect: Number(match[2]), rim: Number(match[3]) };
};

const formatSize = (size) => size.width + '/' + size.aspect + 'R' + size.rim;

const measure = (size) => {
  const sidewall = (size.width * size.aspect) / 100;
  const diameter = size.rim * 25.4 + 2 * sidewall;
  const circumference = Math.PI * diameter;
  return {
    ...size,
    sidewall,
    diameter,
    circumference,
    radius: diameter / 2,
    revolutionsPerKm: 1000000 / circumference,
    revolutionsPerMile: (1609344 / circumference),
    rimWidthRange: [Math.round((size.width / 25.4) * 0.85 * 10) / 10, Math.round((size.width / 25.4) * 1.05 * 10) / 10],
  };
};

export default function TireSizeCalculator() {
  const [unit, setUnit] = useState('metric');
  const [current, setCurrent] = useState(BLANK);
  const [next, setNext] = useState({ width: 215, aspect: 50, rim: 17 });
  const [text, setText] = useState('205/55R16 → 215/50R17');

  const parsed = useMemo(() => {
    const parts = text.split(/→|->|to/i);
    if (parts.length !== 2) return null;
    const from = parseSize(parts[0]);
    const to = parseSize(parts[1]);
    return from && to ? { from, to } : null;
  }, [text]);

  const a = useMemo(() => measure(current), [current]);
  const b = useMemo(() => measure(next), [next]);

  const comparison = useMemo(() => {
    const diameterDelta = b.diameter - a.diameter;
    const diameterPct = a.diameter ? (diameterDelta / a.diameter) * 100 : 0;
    const circumferencePct = a.circumference ? ((b.circumference - a.circumference) / a.circumference) * 100 : 0;
    const radiusDelta = (b.diameter - a.diameter) / 2;
    const widthDelta = b.width - a.width;
    const ratio = a.diameter ? b.diameter / a.diameter : 1;
    return {
      diameterDelta, diameterPct, circumferencePct, radiusDelta, widthDelta, ratio,
      speedError: (ratio - 1) * 100,
      readings: READINGS.map((indicated) => ({ indicated, actual: indicated * ratio })),
      loadCapacityPct: null,
      rimDelta: b.rim - a.rim,
    };
  }, [a, b]);

  const verdict = useMemo(() => {
    const pct = Math.abs(comparison.diameterPct);
    if (pct < 0.6) return { tone: 'emerald', label: 'Effectively identical', note: 'Under 0.6% difference — speedometer, gearing and clearances are unchanged for practical purposes.' };
    if (pct < 2.5) return { tone: 'amber', label: 'Within typical tolerance', note: 'Most tyre fitters accept up to about 2.5%. The speedometer will read slightly out, and you should check for rubbing on full lock.' };
    if (pct < 4) return { tone: 'amber', label: 'Noticeable change', note: 'Gearing and clearance both shift. Check calliper and strut clearance, and expect the speedometer to be out by more than the usual few per cent.' };
    return { tone: 'rose', label: 'Too far from standard', note: 'Beyond roughly 4% the change affects ABS, traction control and gearing accuracy as well as clearance. Not recommended without recalibration.' };
  }, [comparison]);

  const report = [
    'Tyre size comparison',
    '',
    formatSize(a) + (unit === 'metric' ? ' → ' + formatSize(b) : ''),
    'Sidewall ' + a.sidewall.toFixed(1) + ' mm → ' + b.sidewall.toFixed(1) + ' mm',
    'Diameter ' + a.diameter.toFixed(1) + ' mm → ' + b.diameter.toFixed(1) + ' mm (' + comparison.diameterPct.toFixed(2) + '%)',
    'Circumference ' + a.circumference.toFixed(1) + ' mm → ' + b.circumference.toFixed(1) + ' mm',
    'Revs per km ' + a.revolutionsPerKm.toFixed(0) + ' → ' + b.revolutionsPerKm.toFixed(0),
    'Radial clearance change ' + (comparison.radiusDelta).toFixed(1) + ' mm',
    'Speedometer error ' + comparison.speedError.toFixed(2) + '%',
    '',
    ...comparison.readings.map((row) => 'Shows ' + row.indicated + ' km/h → actual ' + row.actual.toFixed(1) + ' km/h'),
    '',
    verdict.label,
  ].join('\n');

  const apply = () => {
    if (!parsed) return;
    setCurrent(parsed.from);
    setNext(parsed.to);
  };

  const speedFactor = unit === 'metric' ? 1 : 1.609344;
  const speedUnit = unit === 'metric' ? 'km/h' : 'mph';

  return (
    <ToolShell
      toolId="tire-size"
      icon={Cog}
      title="Tyre Size & Speedometer Change"
      desc="Compare a new wheel and tyre size against the standard fit: overall diameter, revs per kilometre, clearance, gearing and exactly how far your speedometer will be out."
      state={{ unit, current, next, text }}
      onRestore={(restored) => {
        if (typeof restored.unit === 'string') setUnit(restored.unit);
        if (restored.current && typeof restored.current === 'object') setCurrent({ ...BLANK, ...restored.current });
        if (restored.next && typeof restored.next === 'object') setNext(restored.next);
        if (typeof restored.text === 'string') setText(restored.text);
      }}
      exportText={report}
      exportName="tyre-size-comparison.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={unit} onChange={setUnit} options={[{ value: 'metric', label: 'km/h' }, { value: 'imperial', label: 'mph' }]} />
        <div className="flex flex-1 items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Field label="Type two sizes to load them" hint="For example 205/55R16 → 215/50R17">
              <Input value={text} onChange={(event) => setText(event.target.value)} />
            </Field>
          </div>
          <button
            type="button"
            onClick={apply}
            disabled={!parsed}
            className="h-9 rounded-lg border border-border/70 px-3 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
          >
            Load
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[{ label: 'Standard fit', size: current, set: setCurrent }, { label: 'Proposed fit', size: next, set: setNext }].map((entry) => (
          <Panel key={entry.label} className="!p-3">
            <div className="mb-2 text-xs font-medium">{entry.label}</div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Width (mm)"><Input type="number" value={entry.size.width} onChange={(e) => entry.set({ ...entry.size, width: e.target.value })} /></Field>
              <Field label="Profile (%)"><Input type="number" value={entry.size.aspect} onChange={(e) => entry.set({ ...entry.size, aspect: e.target.value })} /></Field>
              <Field label="Rim (in)"><Input type="number" step="0.5" value={entry.size.rim} onChange={(e) => entry.set({ ...entry.size, rim: e.target.value })} /></Field>
            </div>
            <div className="mt-2 font-mono-j text-[11px] text-cyan-j">
              {formatSize(entry.size)} · sidewall {((Number(entry.size.width) * Number(entry.size.aspect)) / 100).toFixed(1)} mm · Ø {((Number(entry.size.rim) * 25.4) + (2 * Number(entry.size.width) * Number(entry.size.aspect)) / 100).toFixed(1)} mm
            </div>
          </Panel>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-3">
          <Hero
            tone={verdict.tone}
            label="Overall diameter change"
            value={(comparison.diameterPct >= 0 ? '+' : '') + comparison.diameterPct.toFixed(2)}
            unit="%"
            sub={comparison.diameterDelta >= 0
              ? 'The new tyre is ' + comparison.diameterDelta.toFixed(1) + ' mm taller, so the car sits ' + (comparison.radiusDelta).toFixed(1) + ' mm higher'
              : 'The new tyre is ' + Math.abs(comparison.diameterDelta).toFixed(1) + ' mm smaller, riding ' + Math.abs(comparison.radiusDelta).toFixed(1) + ' mm lower'}
          />
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Verdict</div>
            <p className={verdict.tone === 'emerald' ? 'text-xs text-emerald-400' : verdict.tone === 'amber' ? 'text-xs text-amber-400' : 'text-xs text-rose-400'}>{verdict.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{verdict.note}</p>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              <p>· A {comparison.diameterPct.toFixed(2)}% diameter change alters the effective final drive by the same amount — {comparison.diameterPct > 0 ? 'taller gearing, slightly slower acceleration and lower revs at speed' : 'shorter gearing, quicker acceleration and higher revs at speed'}.</p>
              <p>· Clearance changes by {comparison.radiusDelta.toFixed(1)} mm at the top of the arch and on the strut. Anything above about 10 mm needs a physical check with the wheels turned on full lock.</p>
              <p>· Width changes by {comparison.widthDelta} mm, which affects rubbing on the inner arch and whether the tyre still sits inside the bodywork.</p>
            </div>
          </Panel>
        </div>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Speedometer readings after the change</div>
          <div className="space-y-1.5">
            {comparison.readings.map((row) => (
              <div key={row.indicated} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">Shows {Math.round(row.indicated * speedFactor)} {speedUnit}</span>
                <span className="font-mono-j text-cyan-j">actually {Math.round(row.actual * speedFactor)} {speedUnit}</span>
                <span className="font-mono-j text-[11px] text-muted-foreground">{((row.actual - row.indicated) * speedFactor).toFixed(1)} {speedUnit} out</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Speedometers are legally required to never under-read, so most cars already show a few per cent more than the real speed. {comparison.diameterPct > 0
              ? 'A taller tyre happens to cancel some of that, which is why the reading can end up closer to the truth.'
              : 'A smaller tyre compounds it, and the gap between indicated and actual speed grows.'}
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Diameter" value={b.diameter.toFixed(1) + ' mm'} mono sub={a.diameter.toFixed(1) + ' mm standard'} />
        <Stat label="Circumference" value={b.circumference.toFixed(0) + ' mm'} mono sub={comparison.circumferencePct.toFixed(2) + '% change'} />
        <Stat label="Revs per km" value={Math.round(b.revolutionsPerKm).toLocaleString()} mono sub={Math.round(a.revolutionsPerKm).toLocaleString() + ' standard'} />
        <Stat label="Gearing effect" value={(comparison.ratio).toFixed(4) + '×'} mono sub={comparison.ratio > 1 ? 'numerically lower' : 'numerically higher'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the numbers come from</div>
          <Bars
            data={[
              { label: 'Sidewall', value: b.sidewall },
              { label: 'Rim, mm', value: b.rim * 25.4 },
              { label: 'Radius', value: b.radius },
            ]}
            format={(value) => String(Math.round(value))}
            suffix=" mm"
            highlightLast={false}
          />
          <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
            <p>· Sidewall height is width × profile ÷ 100, so a 215/50 is 107.5 mm while a 205/55 is 112.75 mm — the wider tyre has the shorter sidewall.</p>
            <p>· Overall diameter is rim inches × 25.4 plus twice the sidewall. That is why changing rim size by an inch usually needs a profile change to stay close.</p>
            <p>· Recommended rim widths for this tyre are about {b.rimWidthRange[0]}–{b.rimWidthRange[1]} inches. Outside that range the sidewall distorts and wear becomes uneven.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before you buy</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Check load index and speed rating against the vehicle plate. A lower load index than the plate requires can be an insurance issue, not just a safety one.</p>
            <p>· Four tyres changing together keeps the differential happy. On all-wheel drive, more than about 2% mismatch between axles is the usual limit.</p>
            <p>· Mismatched diameters on one axle can upset ABS and traction control. Change in pairs at minimum, and check the handbook for the limit.</p>
            <p>· Wider tyres on the same rim can foul the inner arch and the brake caliper, and they increase unsprung mass and road noise.</p>
            <p>· Speedometer error is usually correctable in software on modern cars, so the reading can be brought back within a per cent or two.</p>
            <p>· Verify the fit physically before driving hard — a wheel that clears in a car park can still rub under compression on the road.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Diameter', value: comparison.diameterPct.toFixed(2) + '%' },
                { label: 'Speedo', value: comparison.speedError.toFixed(1) + '%' },
                { label: 'Fit', value: verdict.label.split(' ')[0].toLowerCase() },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          All figures are pure geometry from the size markings plus the fixed 25.4 mm per inch conversion. Real tyres vary by manufacturer from the nominal size by a
          few millimetres, so treat the comparison as the design intent rather than the measured result. Load ratings, speed ratings and legal fitment rules are not
          covered here and should be checked against the vehicle plate.
        </p>
      </Panel>
    </ToolShell>
  );
}