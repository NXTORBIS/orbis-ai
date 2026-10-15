import { useMemo, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SENSORS = {
  fullframe: { label: 'Full frame 36 × 24 mm', width: 36, height: 24 },
  canonapsc: { label: 'APS-C Canon 22.3 × 14.9 mm', width: 22.3, height: 14.9 },
  nikonapsc: { label: 'APS-C Nikon 23.6 × 15.7 mm', width: 23.6, height: 15.7 },
  mft: { label: 'Micro four thirds 17.3 × 13 mm', width: 17.3, height: 13 },
  oneinch: { label: 'One inch 13.2 × 8.8 mm', width: 13.2, height: 8.8 },
  medium: { label: 'Medium format 44 × 33 mm', width: 44, height: 33 },
};

const PRESETS = [
  { label: 'Head and shoulders portrait', focal: 85, aperture: 1.8, distance: 2, sensor: 'fullframe' },
  { label: 'Group portrait', focal: 35, aperture: 4, distance: 3, sensor: 'fullframe' },
  { label: 'Landscape, front to back sharp', focal: 24, aperture: 11, distance: 5, sensor: 'fullframe' },
  { label: 'Macro at close range', focal: 100, aperture: 8, distance: 0.35, sensor: 'fullframe' },
  { label: 'Street with context', focal: 35, aperture: 5.6, distance: 4, sensor: 'canonapsc' },
];

const band = (value) => {
  if (value < 0.02) return 'millimetres — focus stacking territory';
  if (value < 0.15) return 'razor thin, one eye at most';
  if (value < 0.6) return 'shallow, a face but not the shoulders';
  if (value < 2) return 'moderate, a person or a small group';
  if (value < 10) return 'generous, foreground to background in a room';
  return 'effectively everything sharp';
};

export default function DepthOfField() {
  const [sensor, setSensor] = useState('fullframe');
  const [focal, setFocal] = useState('85');
  const [aperture, setAperture] = useState('1.8');
  const [distance, setDistance] = useState('2');
  const [pixelPitch, setPixelPitch] = useState('6');
  const [units, setUnits] = useState('metric');

  const result = useMemo(() => {
    const spec = SENSORS[sensor] || SENSORS.fullframe;
    const f = Math.max(1, Number(focal) || 50);
    const n = Math.max(0.7, Number(aperture) || 4);
    const subjectMm = Math.max(50, (Number(distance) || 2) * 1000);
    const pitch = Math.max(1, Number(pixelPitch) || 6);

    const diagonal = Math.sqrt(spec.width * spec.width + spec.height * spec.height);
    const coc = diagonal / 1500;

    const hyperfocalMm = (f * f) / (n * coc) + f;
    const near = (subjectMm * (hyperfocalMm - f)) / (hyperfocalMm + subjectMm - 2 * f);
    const far = hyperfocalMm > subjectMm ? (subjectMm * (hyperfocalMm - f)) / (hyperfocalMm - subjectMm) : Infinity;
    const dofMm = Number.isFinite(far) ? far - near : Infinity;
    const dofFront = subjectMm - near;
    const dofBehind = Number.isFinite(far) ? far - subjectMm : Infinity;
    const magnification = f / (subjectMm - f);
    const fovWidth = spec.width * (subjectMm / f) / 1000;
    const fovHeight = spec.height * (subjectMm / f) / 1000;
    const airy = 2.44 * 0.55 * n;
    const diffractionLimited = airy > pitch * 1.8;
    const diffractionAperture = (pitch * 1.8) / (2.44 * 0.55);
    const equivalentAperture = n * (43.27 / diagonal);

    const format = (mm) => (units === 'metric' ? (mm / 1000).toFixed(3) + ' m' : (mm / 304.8).toFixed(2) + ' ft');

    const apertures = [1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16, 22].map((value) => {
      const hyper = (f * f) / (value * coc) + f;
      const nearValue = (subjectMm * (hyper - f)) / (hyper + subjectMm - 2 * f);
      const farValue = hyper > subjectMm ? (subjectMm * (hyper - f)) / (hyper - subjectMm) : Infinity;
      const total = Number.isFinite(farValue) ? farValue - nearValue : 9999;
      return { label: 'f/' + value, value: Number((total / 1000).toFixed(3)), raw: total, aperture: value };
    });

    const depthBands = [
      { label: 'f/1.4', value: apertures[0].value },
      { label: 'f/4', value: apertures[4].value },
      { label: 'f/8', value: apertures[6].value },
      { label: 'f/16', value: apertures[8].value },
    ];

    const warnings = [];
    if (diffractionLimited) warnings.push('At f/' + n + ' the Airy disk is ' + airy.toFixed(1) + ' µm against a pixel pitch of ' + pitch + ' µm. Diffraction is already softening fine detail, so stopping down further will not add real sharpness.');
    else warnings.push('Diffraction only becomes visible beyond about f/' + diffractionAperture.toFixed(1) + ' on this pixel pitch, so you have room to stop down for more depth of field.');

    return {
      spec, f, n, subjectMm, pitch, coc, hyperfocalMm, near, far, dofMm, dofFront, dofBehind, magnification, fovWidth, fovHeight,
      airy, diffractionLimited, diffractionAperture, equivalentAperture, apertures, depthBands, warnings, diagonal, format,
      hyperfocalDistance: hyperfocalMm / 1000,
      bandLabel: band(dofMm / 1000),
      behindRatio: Number.isFinite(far) && dofMm > 0 ? dofBehind / dofMm : 1,
    };
  }, [sensor, focal, aperture, distance, pixelPitch, units]);

  const applyPreset = (preset) => {
    setFocal(String(preset.focal));
    setAperture(String(preset.aperture));
    setDistance(String(preset.distance));
    setSensor(preset.sensor);
  };

  const report = useMemo(() => [
    result.spec.label + ', ' + result.f + ' mm at f/' + result.n + ', focused at ' + (result.subjectMm / 1000).toFixed(2) + ' m',
    '',
    'Depth of field: ' + result.format(result.dofMm) + ' — ' + result.bandLabel,
    'Near limit ' + result.format(result.near) + ' · far limit ' + (Number.isFinite(result.far) ? result.format(result.far) : 'infinity'),
    'In front ' + result.format(result.dofFront) + ' · behind ' + (Number.isFinite(result.dofBehind) ? result.format(result.dofBehind) : 'unlimited'),
    '',
    'Hyperfocal distance: ' + result.hyperfocalDistance.toFixed(2) + ' m',
    'Circle of confusion used: ' + result.coc.toFixed(4) + ' mm',
    'Magnification: 1:' + (result.magnification ? (1 / result.magnification).toFixed(1) : '0'),
    'Field of view at the subject: ' + result.fovWidth.toFixed(2) + ' × ' + result.fovHeight.toFixed(2) + ' m',
    'Aperture in full frame terms: f/' + result.equivalentAperture.toFixed(1),
    '',
    ...result.warnings,
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="depth-of-field"
      icon={ImageIcon}
      title="Depth of Field & Hyperfocal"
      desc="Focal length, aperture, distance and sensor into the near and far limits, the hyperfocal distance, the diffraction ceiling and the aperture that gets you there."
      state={{ sensor, focal, aperture, distance, pixelPitch, units }}
      onRestore={(restored) => {
        if (restored.sensor) setSensor(restored.sensor);
        if (restored.focal !== undefined) setFocal(String(restored.focal));
        if (restored.aperture !== undefined) setAperture(String(restored.aperture));
        if (restored.distance !== undefined) setDistance(String(restored.distance));
        if (restored.pixelPitch !== undefined) setPixelPitch(String(restored.pixelPitch));
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="depth-of-field.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <Field label="Camera sensor">
        <select value={sensor} onChange={(e) => setSensor(e.target.value)} className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm">
          {Object.keys(SENSORS).map((key) => <option key={key} value={key}>{SENSORS[key].label}</option>)}
        </select>
      </Field>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Focal length, mm"><input value={focal} onChange={(e) => setFocal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Aperture, f-number"><input value={aperture} onChange={(e) => setAperture(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Focus distance, m"><input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Pixel pitch, µm"><input value={pixelPitch} onChange={(e) => setPixelPitch(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Depth of field"
          value={result.format(result.dofMm)}
          sub={result.bandLabel + '. The zone runs from ' + result.format(result.near) + ' to ' + (Number.isFinite(result.far) ? result.format(result.far) : 'infinity') + ', with ' + (result.behindRatio * 100).toFixed(0) + '% of it behind the focus point. Magnification is about 1:' + (result.magnification ? (1 / result.magnification).toFixed(1) : '0') + '.'}
        />
        <Ring
          value={Number.isFinite(result.dofMm) ? result.dofMm / 1000 : 20}
          max={20}
          label="Depth in metres"
          sub={'Against a hyperfocal distance of ' + result.hyperfocalDistance.toFixed(2) + ' m'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Depth of field at each aperture</div>
          <Bars data={result.apertures} format={(value) => (value >= 9999 ? '∞' : value.toFixed(2))} suffix=" m" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Depth grows roughly with the f-number, so f/8 gives about twice the depth of f/4 and four times that of f/2. The curve flattens at the top because the far limit is
            already running off to infinity.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Near limit</span><span>{result.format(result.near)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Far limit</span><span>{Number.isFinite(result.far) ? result.format(result.far) : 'infinity'}</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Total depth</span><span className="text-cyan-j">{result.format(result.dofMm)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">In front of the subject</span><span>{result.format(result.dofFront)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Behind the subject</span><span>{Number.isFinite(result.dofBehind) ? result.format(result.dofBehind) : 'unlimited'}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Hyperfocal distance</span><span>{result.hyperfocalDistance.toFixed(2)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Circle of confusion</span><span>{result.coc.toFixed(4)} mm</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Frame at the subject</span><span>{result.fovWidth.toFixed(2)} × {result.fovHeight.toFixed(2)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Full frame equivalent aperture</span><span>f/{result.equivalentAperture.toFixed(1)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Airy disk at this aperture</span><span>{result.airy.toFixed(1)} µm</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Diffraction limit for this pitch</span><span>f/{result.diffractionAperture.toFixed(1)}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Depth of field" value={result.format(result.dofMm)} mono sub={result.bandLabel.split(',')[0]} />
        <Stat label="Hyperfocal" value={result.hyperfocalDistance.toFixed(1) + ' m'} mono sub="focus here for infinity to the near limit" />
        <Stat label="Behind vs in front" value={(result.behindRatio * 100).toFixed(0) + '%'} mono sub="of the depth sits behind" />
        <Stat label="Diffraction" value={result.diffractionLimited ? 'at the limit' : 'headroom'} mono sub={'ceiling near f/' + result.diffractionAperture.toFixed(1)} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Depth at a few useful apertures</div>
        <div className="grid gap-2 sm:grid-cols-4">
          {result.depthBands.map((entry) => (
            <div key={entry.label} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-2">
              <div className="font-mono-j text-[11px] text-cyan-j">{entry.label}</div>
              <div className="mt-0.5 font-mono-j text-sm">{entry.value >= 9999 ? 'infinity' : entry.value.toFixed(2) + ' m'}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {result.n === 8 ? 'You are already at f/8, which the old advice treats as the sweet spot for sharpness across formats.' : 'Stopping down raises depth but also raises diffraction. The useful range on modern sensors is usually between wide open and somewhere near f/8 to f/11.'}
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {result.warnings.map((line) => <p key={line}>· {line}</p>)}
          <p>· The hyperfocal distance of {result.hyperfocalDistance.toFixed(2)} m is where you focus to get everything from half that distance to infinity acceptably sharp. It buys depth at the cost of the far distance being only just acceptable.</p>
          <p>· Depth of field is not a hard edge. It is a judgement about what looks sharp at a given print size and viewing distance, which is exactly what the circle of confusion encodes.</p>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting more depth when you need it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Stop down first, but only until diffraction starts to bite. Beyond f/' + result.diffractionAperture.toFixed(1) + ' on this sensor you are trading real sharpness for theoretical depth.</p>
            <p>· Move back. Depth grows with distance, so repositioning two steps can solve what no aperture setting will.</p>
            <p>· Use a shorter focal length. A 24 mm lens at the same framing has far more depth than an 85 mm one.</p>
            <p>· Focus on the hyperfocal distance for landscapes rather than at the horizon, which throws away the foreground.</p>
            <p>· Focus stack for macro and architecture. Three to five frames at different focus points beat any single aperture.</p>
            <p>· Consider a smaller sensor if depth is the goal. Micro four thirds at f/' + (result.n / 2).toFixed(1) + ' gives roughly what full frame does at f/' + result.n.toFixed(1) + '.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting less depth deliberately</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Open up and get closer. Distance is the strongest lever on depth of field, stronger than aperture in most situations.</p>
            <p>· Use a longer focal length and stand back to keep the framing. A 135 mm at f/2 separates a subject from a busy background far more than a 50 mm at f/2.</p>
            <p>· Put distance between the subject and the background. Separation does most of the visual work; shallow depth only finishes the job.</p>
            <p>· Focus on the near eye, not the centre of the face. A few centimetres forward makes the difference between a sharp portrait and a soft one.</p>
            <p>· Remember depth extends further behind than in front — about two thirds behind at normal distances.</p>
            <p>· Check focus on the back screen at maximum magnification. Autofocus picks what it likes, and at f/' + result.n + ' there is no depth to hide the mistake.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Lens', value: result.f + ' mm' },
                { label: 'Aperture', value: 'f/' + result.n },
                { label: 'Depth', value: result.format(result.dofMm) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>circle of confusion = sensor diagonal ÷ 1500, giving {result.coc.toFixed(4)} mm here</p>
          <p>hyperfocal H = f² ÷ (N × c) + f</p>
          <p>near limit = s(H − f) ÷ (H + s − 2f) · far limit = s(H − f) ÷ (H − s)</p>
          <p>magnification = f ÷ (s − f) · diffraction: Airy disk = 2.44 λN with λ = 0.55 µm</p>
          <p className="text-cyan-j">Check: with H = {(result.hyperfocalMm / 1000).toFixed(2)} m and s = {(result.subjectMm / 1000).toFixed(2)} m, the near limit lands at {(result.near / 1000).toFixed(2)} m.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is the standard geometric model with a circle of confusion tied to the sensor diagonal, which assumes a print of about A4 viewed at arm length. View larger or
          closer and the depth you actually perceive will be narrower.
        </p>
      </Panel>
    </ToolShell>
  );
}