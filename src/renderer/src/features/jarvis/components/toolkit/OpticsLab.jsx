import { useMemo, useState } from 'react';
import { Telescope } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Field, Panel, Seg, Stat } from './shared';

const SENSORS = [
  { value: 'ff', label: 'Full frame 36 × 24 mm', w: 36, h: 24 },
  { value: 'apsc', label: 'APS-C 23.6 × 15.7 mm', w: 23.6, h: 15.7 },
  { value: 'apsc-canon', label: 'APS-C Canon 22.3 × 14.9 mm', w: 22.3, h: 14.9 },
  { value: 'mft', label: 'Micro Four Thirds 17.3 × 13 mm', w: 17.3, h: 13 },
  { value: 'one', label: '1 inch 13.2 × 8.8 mm', w: 13.2, h: 8.8 },
  { value: 'phone', label: 'Phone 1/1.28 in 9.8 × 7.3 mm', w: 9.8, h: 7.3 },
];

const MODES = [
  { value: 'image', label: 'Where the image forms' },
  { value: 'fov', label: 'Field of view' },
  { value: 'macro', label: 'Macro & extension' },
];

export default function OpticsLab() {
  const [mode, setMode] = useState('image');
  const [v, setV] = useState({
    objectDistance: 30,
    focal: 50,
    imageDistance: 75,
    solve: 'image',
    mirror: 'lens',
    sensor: 'ff',
    focalFov: 35,
    distance: 5,
    subjectWidth: 1,
    extension: 36,
    lensMagnification: 0.15,
    aperture: 8,
  });

  const set = (key, value) => setV((current) => ({ ...current, [key]: value }));
  const num = (key) => Number(v[key]) || 0;

  const result = useMemo(() => {
    if (mode === 'image') {
      const isMirror = v.mirror === 'mirror';
      let f = num('focal');
      let doValue = num('objectDistance');
      let di = num('imageDistance');
      let hero = { value: '—', unit: '', label: 'Answer', sub: '' };
      const rows = [];
      let steps = [];

      if (v.solve === 'focal') {
        if (doValue && di) {
          f = (doValue * di) / (doValue + di);
          hero = { value: f.toFixed(2), unit: 'cm', label: 'Focal length', sub: 'f = do·di ÷ (do + di)' };
          steps = ['1/f = 1/do + 1/di', 'f = (' + doValue + ' × ' + di + ') ÷ (' + doValue + ' + ' + di + ')', 'f = ' + f.toFixed(4) + ' cm'];
        }
      } else if (v.solve === 'object') {
        if (di && f) {
          doValue = (di * f) / (di - f);
          hero = { value: doValue.toFixed(2), unit: 'cm', label: 'Object distance', sub: 'the distance that focuses at ' + di + ' cm' };
          steps = ['do = di·f ÷ (di − f)', 'do = (' + di + ' × ' + f + ') ÷ (' + di + ' − ' + f + ')', 'do = ' + doValue.toFixed(4) + ' cm'];
        }
      } else {
        if (doValue && f) {
          const denominator = doValue - f;
          di = denominator !== 0 ? (doValue * f) / denominator : 0;
          hero = { value: Math.abs(di).toFixed(2), unit: 'cm', label: di > 0 ? 'Real image distance' : 'Virtual image distance', sub: di > 0 ? 'on the far side of the ' + (isMirror ? 'mirror' : 'lens') : 'on the same side as the object' };
          steps = ['1/di = 1/f − 1/do', 'di = (' + doValue + ' × ' + f + ') ÷ (' + doValue + ' − ' + f + ')', 'di = ' + di.toFixed(4) + ' cm'];
        }
      }

      const magnification = doValue ? -di / doValue : 0;
      const real = di > 0;
      const valid = Number.isFinite(di) && Number.isFinite(doValue) && doValue > 0;

      rows.push(
        { label: 'Object distance', value: doValue.toFixed(3) + ' cm' },
        { label: 'Focal length', value: f.toFixed(3) + ' cm' },
        { label: 'Image distance', value: Number.isFinite(di) ? di.toFixed(3) + ' cm' : '—' },
        { label: 'Magnification', value: magnification.toFixed(4) + '×' },
        { label: 'Image height for a 1 cm object', value: Math.abs(magnification).toFixed(3) + ' cm' },
        { label: 'Image type', value: valid ? (real ? 'Real and inverted' : 'Virtual and upright') : 'no image' },
        { label: 'Optical power', value: (1 / (f / 100)).toFixed(2) + ' dioptres' },
      );

      const warnings = [];
      if (doValue <= f) warnings.push(doValue === f ? 'The object is at the focal point, so no image forms — the rays leave parallel.' : 'The object is inside the focal length, so the image is virtual, upright and behind the ' + (isMirror ? 'mirror' : 'lens') + '. That is how a magnifying glass works.');
      if (!Number.isFinite(di)) warnings.push('Check the inputs: with these numbers the equation does not produce a finite image distance.');

      return { hero, rows, steps, warnings, magnification, real: valid && real };
    }

    if (mode === 'fov') {
      const sensor = SENSORS.find((entry) => entry.value === v.sensor) || SENSORS[0];
      const focal = num('focalFov');
      const distance = num('distance') * 100;
      const hFov = focal > 0 ? 2 * Math.atan(sensor.w / (2 * focal)) * (180 / Math.PI) : 0;
      const vFov = focal > 0 ? 2 * Math.atan(sensor.h / (2 * focal)) * (180 / Math.PI) : 0;
      const dFov = focal > 0 ? 2 * Math.atan(Math.hypot(sensor.w, sensor.h) / (2 * focal)) * (180 / Math.PI) : 0;
      const frameW = focal > 0 ? (sensor.w * distance) / focal : 0;
      const frameH = focal > 0 ? (sensor.h * distance) / focal : 0;
      const neededFocal = distance > 0 && num('subjectWidth') > 0 ? (sensor.w * distance) / (num('subjectWidth') * 100) : 0;
      const fullFrameEquivalent = focal * (43.27 / Math.hypot(sensor.w, sensor.h));

      const hero = { value: hFov.toFixed(2), unit: '°', label: 'Horizontal angle of view', sub: 'vertical ' + vFov.toFixed(2) + '° · diagonal ' + dFov.toFixed(2) + '°' };
      const rows = [
        { label: 'Horizontal field', value: frameW.toFixed(1) + ' cm at ' + num('distance') + ' m' },
        { label: 'Vertical field', value: frameH.toFixed(1) + ' cm at ' + num('distance') + ' m' },
        { label: 'Pixel density implication', value: frameW.toFixed(1) + ' cm across the frame' },
        { label: 'Focal length to fill with ' + v.subjectWidth + ' m', value: neededFocal.toFixed(1) + ' mm' },
        { label: 'Full-frame equivalent', value: fullFrameEquivalent.toFixed(1) + ' mm' },
        { label: 'Crop factor', value: (43.27 / Math.hypot(sensor.w, sensor.h)).toFixed(3) + '×' },
      ];
      return {
        hero,
        rows,
        steps: ['Angle = 2·arctan(sensor ÷ (2 × focal))', 'Frame width at distance = sensor × distance ÷ focal', 'Wider focal length: wider angle, more scene, smaller subject.'],
        warnings: neededFocal > 0 && Math.abs(neededFocal - focal) / focal > 0.25
          ? ['Your current focal length frames about ' + frameW.toFixed(0) + ' cm; you asked for ' + (num('subjectWidth') * 100).toFixed(0) + ' cm, which wants roughly ' + neededFocal.toFixed(0) + ' mm.']
          : [],
        frameW,
        frameH,
      };
    }

    const sensor = SENSORS.find((entry) => entry.value === v.sensor) || SENSORS[0];
    const focal = num('focal');
    const extension = num('extension');
    const baseMag = num('lensMagnification');
    const magnification = extension > 0 && focal > 0 ? baseMag + extension / focal : baseMag;
    const stopsLost = 2 * Math.log2(1 + magnification);
    const effectiveAperture = num('aperture') * (1 + magnification);
    const frameW = magnification > 0 ? sensor.w / magnification : 0;
    const frameH = magnification > 0 ? sensor.h / magnification : 0;
    const workingDistance = magnification > 0 ? focal * (1 + 1 / magnification) : focal;

    const hero = { value: magnification.toFixed(3), unit: '×', label: 'Magnification', sub: magnification >= 1 ? 'true macro — the subject is at least lifesize on the sensor' : 'close-up rather than true macro' };
    const rows = [
      { label: 'Magnification', value: magnification.toFixed(4) + '×' },
      { label: 'Field of view', value: frameW.toFixed(1) + ' × ' + frameH.toFixed(1) + ' mm' },
      { label: 'Light lost', value: stopsLost.toFixed(2) + ' stops' },
      { label: 'Effective aperture', value: 'f/' + effectiveAperture.toFixed(1) + ' (set f/' + num('aperture') + ')' },
      { label: 'Working distance', value: '≈ ' + workingDistance.toFixed(1) + ' mm (rough)' },
      { label: 'Extension needed for 1:1', value: (focal * (1 - baseMag)).toFixed(1) + ' mm' },
      { label: 'Extension needed for 2:1', value: (focal * (2 - baseMag)).toFixed(1) + ' mm' },
    ];

    const warnings = [];
    if (magnification > 0 && effectiveAperture > 45) warnings.push('The effective aperture is beyond f/45, where diffraction softens everything — expect to stop around f/11 to f/16 for the sharpest result.');
    if (extension > 0 && extension > focal * 2) warnings.push('Extension beyond twice the focal length gives huge magnification but very little working distance, and light falls off fast.');

    return { hero, rows, steps: ['Magnification ≈ base magnification + extension ÷ focal length', 'Light falls off as (1 + m)², which is ' + stopsLost.toFixed(2) + ' stops here', 'Field of view = sensor ÷ magnification'], warnings };
  }, [mode, v]);

  const report = [
    'Optics — ' + (MODES.find((entry) => entry.value === mode) || {}).label,
    '',
    result.hero.label + ': ' + result.hero.value + ' ' + result.hero.unit,
    result.hero.sub,
    '',
    ...result.rows.map((row) => row.label.padEnd(34) + row.value),
    '',
    ...result.steps,
    ...(result.warnings || []).map((warning) => '· ' + warning),
  ].join('\n');

  return (
    <ToolShell
      toolId="optics-lab"
      icon={Telescope}
      title="Optics, Lenses & Field of View"
      desc="Solve thin-lens and mirror imaging for any missing quantity, work out the angle of view and the frame you get from a sensor and focal length, and see what extension tubes really do to magnification, light and working distance."
      state={{ mode, v }}
      onRestore={(restored) => {
        if (typeof restored.mode === 'string') setMode(restored.mode);
        if (restored.v && typeof restored.v === 'object') setV({ ...v, ...restored.v });
      }}
      exportText={report}
      exportName="optics-calculation.txt"
    >
      <Seg value={mode} onChange={setMode} options={MODES} />

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Panel className="!p-3">
          {mode === 'image' && (
            <>
              <div className="mb-2">
                <Seg value={v.mirror} onChange={(value) => set('mirror', value)} options={[{ value: 'lens', label: 'Lens' }, { value: 'mirror', label: 'Mirror' }]} />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Object distance (cm)"><Input type="number" step="any" value={v.objectDistance} onChange={(event) => set('objectDistance', event.target.value)} disabled={v.solve === 'object'} /></Field>
                <Field label="Focal length (cm)"><Input type="number" step="any" value={v.focal} onChange={(event) => set('focal', event.target.value)} disabled={v.solve === 'focal'} /></Field>
                <Field label="Image distance (cm)"><Input type="number" step="any" value={v.imageDistance} onChange={(event) => set('imageDistance', event.target.value)} disabled={v.solve !== 'focal'} /></Field>
              </div>
              <div className="mt-2">
                <Field label="Solve for">
                  <Seg
                    value={v.solve}
                    onChange={(value) => set('solve', value)}
                    options={[
                      { value: 'image', label: 'Image distance' },
                      { value: 'focal', label: 'Focal length' },
                      { value: 'object', label: 'Object distance' },
                    ]}
                  />
                </Field>
              </div>
            </>
          )}

          {(mode === 'fov' || mode === 'macro') && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="Sensor">
                  <select value={v.sensor} onChange={(event) => set('sensor', event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                    {SENSORS.map((sensor) => <option key={sensor.value} value={sensor.value}>{sensor.label}</option>)}
                  </select>
                </Field>
              </div>
              {mode === 'fov' ? (
                <>
                  <Field label="Focal length (mm)"><Input type="number" step="any" value={v.focalFov} onChange={(event) => set('focalFov', event.target.value)} /></Field>
                  <Field label="Subject distance (m)"><Input type="number" step="any" value={v.distance} onChange={(event) => set('distance', event.target.value)} /></Field>
                  <Field label="Subject width to fill (m)"><Input type="number" step="any" value={v.subjectWidth} onChange={(event) => set('subjectWidth', event.target.value)} /></Field>
                </>
              ) : (
                <>
                  <Field label="Focal length (mm)"><Input type="number" step="any" value={v.focal} onChange={(event) => set('focal', event.target.value)} /></Field>
                  <Field label="Extension tube (mm)"><Input type="number" step="any" value={v.extension} onChange={(event) => set('extension', event.target.value)} /></Field>
                  <Field label="Lens magnification at closest focus"><Input type="number" step="0.01" value={v.lensMagnification} onChange={(event) => set('lensMagnification', event.target.value)} /></Field>
                  <Field label="Aperture set (f-number)"><Input type="number" step="0.1" value={v.aperture} onChange={(event) => set('aperture', event.target.value)} /></Field>
                </>
              )}
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            {result.rows.map((row) => (
              <div key={row.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="font-mono-j text-cyan-j">{row.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-3">
          <Hero tone={mode === 'image' && result.real === false ? 'amber' : 'cyan'} label={result.hero.label} value={result.hero.value} unit={result.hero.unit} sub={result.hero.sub} />

          {mode === 'fov' && result.frameW > 0 && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">What fits in the frame</div>
              <Bars
                data={[
                  { label: 'Width', value: result.frameW },
                  { label: 'Height', value: result.frameH },
                ]}
                format={(value) => String(Math.round(value))}
                suffix=" cm"
                highlightLast={false}
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                At {v.distance} m this lens fills the frame with {result.frameW.toFixed(0)} × {result.frameH.toFixed(0)} cm. Halve the distance and you halve the width;
                double the focal length and you halve it again — the frame size scales linearly with distance and inversely with focal length.
              </p>
            </Panel>
          )}

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The working</div>
            <div className="space-y-1">
              {result.steps.map((step) => (
                <div key={step} className="rounded-lg border border-border/70 bg-card/50 px-3 py-2 font-mono-j text-[11px] text-muted-foreground">{step}</div>
              ))}
            </div>
            {(result.warnings || []).length > 0 && (
              <div className="mt-2 space-y-1 text-[11px] text-amber-600 dark:text-amber-400">
                {result.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
              </div>
            )}
          </Panel>

          <div className="grid gap-2 sm:grid-cols-2">
            <Stat label="Sensor diagonal" value={(SENSORS.find((entry) => entry.value === v.sensor) ? Math.hypot(SENSORS.find((entry) => entry.value === v.sensor).w, SENSORS.find((entry) => entry.value === v.sensor).h).toFixed(2) : '—') + ' mm'} mono sub="used for the equivalence" />
            <Stat label="Sign convention" value="real = +" mono sub="virtual distances are negative" />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">How the image behaves</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Object further than twice the focal length: a real, inverted, reduced image — this is the camera case.</p>
            <p>· Object between one and two focal lengths: real, inverted and magnified — a projector or enlarger.</p>
            <p>· Object closer than the focal length: virtual, upright and magnified. That is a magnifying glass, and the image cannot be caught on a screen.</p>
            <p>· Object exactly at the focal point: the rays leave parallel and no image forms at any distance.</p>
            <p>· A negative image distance means the image sits on the object side — it is virtual, whatever the sign of the magnification.</p>
            <p>· Magnification is the ratio of image to object size, and it scales exactly as the ratio of the two distances.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Field of view and crop factors</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Angle of view depends only on the sensor size and the focal length. A 35 mm lens on a phone sensor and on full frame are very different pictures.</p>
            <p>· The crop factor compares diagonals against 36 × 24 mm — about 1.5× for APS-C, 2× for Four Thirds and roughly 3.5× for a typical phone sensor.</p>
            <p>· Equivalence is about framing, not exposure. A full-frame equivalent focal length tells you what the picture looks like, not what f-number to use.</p>
            <p>· Depth of field and diffraction scale with the real focal length and aperture, so the equivalent numbers do not transfer directly.</p>
            <p>· Extension tubes change magnification without touching the optics, but they cost light: at 1:1 you lose two stops and the effective aperture is double what is set.</p>
            <p>· Stacked extension tubes add up. Two 12 mm tubes on a 50 mm lens behave like one 24 mm tube.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Mode', value: mode },
                { label: 'Sensor', value: SENSORS.find((entry) => entry.value === v.sensor)?.w + ' mm wide' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Imaging uses the thin-lens equation with the usual sign convention, so a negative image distance is a virtual image. Field of view is the exact pinhole
          relation between sensor size, focal length and distance. The macro figures are the standard extension approximation — real lenses change working distance and
          effective aperture in ways that only a specific design can predict, so treat the working distance as indicative.
        </p>
      </Panel>
    </ToolShell>
  );
}