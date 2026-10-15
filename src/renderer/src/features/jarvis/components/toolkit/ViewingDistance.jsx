import { useMemo, useState } from 'react';
import { Monitor } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const RESOLUTIONS = [
  { label: '1280 × 720', width: 1280, height: 720 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '2560 × 1440', width: 2560, height: 1440 },
  { label: '3840 × 2160', width: 3840, height: 2160 },
  { label: '7680 × 4320', width: 7680, height: 4320 },
];

const SIZES = [24, 27, 32, 43, 50, 55, 65, 75, 85, 100];

export default function ViewingDistance() {
  const [kind, setKind] = useState('tv');
  const [diagonal, setDiagonal] = useState('55');
  const [aspect, setAspect] = useState('16:9');
  const [resolution, setResolution] = useState('1920 × 1080');
  const [units, setUnits] = useState('metric');

  const result = useMemo(() => {
    const size = Number(diagonal) || 0;
    const parts = aspect.split(':').map(Number);
    const ratio = parts.length === 2 && parts[1] ? parts[0] / parts[1] : 16 / 9;
    const height = size / Math.sqrt(1 + Math.pow(ratio, 2));
    const width = height * ratio;
    const res = RESOLUTIONS.find((entry) => entry.label === resolution) || RESOLUTIONS[1];
    const pixelPitch = width / res.width;
    const ppi = size ? res.width / width : 0;

    // 20/20 vision resolves about one arcminute, so pixels merge at roughly pitch / 0.000291 inches.
    const pixelMerge = pixelPitch / 0.000291;
    const thxDistance = size * 1.19;
    const smpteDistance = size * 1.62;
    const immersive = size * 0.75;

    const toDisplay = (inches) => (units === 'metric' ? (inches * 2.54).toFixed(2) + ' m' : (inches / 12).toFixed(2) + ' ft');
    const monitorArm = kind === 'monitor' ? Math.max(20, Math.min(40, size * 1.2)) : 0;

    const ladder = [
      { label: 'Immersive', value: immersive },
      { label: 'THX 40°', value: thxDistance },
      { label: 'SMPTE 30°', value: smpteDistance },
      { label: 'Pixel merge', value: pixelMerge },
    ];

    return {
      size, ratio, width, height, res, pixelPitch, ppi, pixelMerge, thxDistance, smpteDistance, immersive, monitorArm,
      ladder, toDisplay,
      fieldImmersive: 40,
      fieldSmpte: 30,
      fovAtThx: 2 * Math.atan((width / 2) / thxDistance) * 180 / Math.PI,
      fovAtSmpte: 2 * Math.atan((width / 2) / smpteDistance) * 180 / Math.PI,
      eyeLevelFromFloor: kind === 'tv' ? size * 0.16 : 0,
      fourKBenefit: pixelMerge / smpteDistance,
      screenArea: (width * height) / 144,
      seats: Math.max(1, Math.floor((width / 12) * 1.2)),
    };
  }, [kind, diagonal, aspect, resolution, units]);

  const report = useMemo(() => [
    (kind === 'tv' ? 'Screen' : 'Monitor') + ': ' + result.size + ' inch diagonal, ' + aspect + ', ' + result.res.label,
    'Visible area ' + result.width.toFixed(1) + ' × ' + result.height.toFixed(1) + ' inches (' + result.screenArea.toFixed(0) + ' square inches)',
    'Pixel density ' + result.ppi.toFixed(0) + ' ppi · pixel pitch ' + (result.pixelPitch * 1000).toFixed(2) + ' mm',
    '',
    'Comfortable cinematic distance, about 40 degrees: ' + result.toDisplay(result.thxDistance),
    'Minimum recommended distance, about 30 degrees: ' + result.toDisplay(result.smpteDistance),
    'Immersive distance, about 45 to 50 degrees: ' + result.toDisplay(result.immersive),
    'Distance where individual pixels stop being visible: ' + result.toDisplay(result.pixelMerge),
    '',
    kind === 'monitor' ? 'Desk monitor seating is usually ' + result.toDisplay(result.monitorArm) + ' — roughly arm length.' : 'Screen centre about ' + result.toDisplay(result.eyeLevelFromFloor) + ' above seated eye level is a common mounting guide.',
    '',
    'At the 30 degree distance the field of view is ' + result.fovAtSmpte.toFixed(1) + ' degrees; at the THX distance it is ' + result.fovAtThx.toFixed(1) + ' degrees.',
  ].join('\n'), [result, kind, aspect, units]);

  return (
    <ToolShell
      toolId="viewing-distance"
      icon={Monitor}
      title="Screen Viewing Distance"
      desc="How far to sit from a TV or monitor for a given size, resolution and aspect ratio — with the THX and SMPTE angles, the point where pixels stop being visible, and the mounting height."
      state={{ kind, diagonal, aspect, resolution, units }}
      onRestore={(restored) => {
        if (restored.kind) setKind(restored.kind);
        if (restored.diagonal !== undefined) setDiagonal(String(restored.diagonal));
        if (restored.aspect) setAspect(restored.aspect);
        if (restored.resolution) setResolution(restored.resolution);
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="viewing-distance.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={kind} onChange={setKind} options={[{ value: 'tv', label: 'Television' }, { value: 'monitor', label: 'Desk monitor' }, { value: 'cinema', label: 'Projector' }]} />
        <Seg value={units} onChange={setUnits} options={[{ value: 'metric', label: 'Metres' }, { value: 'imperial', label: 'Feet' }]} />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Diagonal, inches"><input value={diagonal} onChange={(e) => setDiagonal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Aspect ratio">
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {['16:9', '21:9', '4:3', '32:9'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </Field>
        <Field label="Resolution">
          <select value={resolution} onChange={(e) => setResolution(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {RESOLUTIONS.map((entry) => <option key={entry.label} value={entry.label}>{entry.label}</option>)}
          </select>
        </Field>
        <Field label="Common sizes">
          <div className="flex flex-wrap gap-1">
            {SIZES.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setDiagonal(String(entry))}
                className={Number(diagonal) === entry
                  ? 'rounded border border-cyan-j/50 bg-cyan-j/10 px-1.5 py-0.5 text-[10px] text-cyan-j'
                  : 'rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground'}
              >
                {entry}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1.1fr]">
          <svg viewBox="0 0 300 150" className="h-auto w-full rounded-lg border border-border/60 bg-card/30">
            <rect x="30" y="30" width={(result.width / Math.max(result.width, result.smpteDistance * 1.2)) * 210 + 30} height={Math.max(24, (result.height / Math.max(result.width, result.smpteDistance * 1.2)) * 210)} rx="3" fill="hsl(var(--cyan) / 0.15)" stroke="hsl(var(--cyan))" strokeWidth="1.5" />
            <text x="40" y={30 + Math.max(24, (result.height / Math.max(result.width, result.smpteDistance * 1.2)) * 210) / 2 + 3} fontSize="9" fill="hsl(var(--muted-foreground))">{result.size}" screen</text>
            <circle cx="290" cy="130" r="4" fill="hsl(var(--cyan))" />
            <text x="284" y="120" textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">you</text>
            <line x1="250" y1="130" x2="250" y2="90" stroke="hsl(var(--cyan))" strokeWidth="0.75" strokeDasharray="3 3" />
            <text x="246" y="86" textAnchor="end" fontSize="8" fill="hsl(var(--cyan))">{result.toDisplay(result.thxDistance)}</text>
          </svg>
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Comfortable distance" value={result.toDisplay(result.thxDistance)} mono sub="about 40 degrees" />
              <Stat label="Minimum distance" value={result.toDisplay(result.smpteDistance)} mono sub="about 30 degrees" />
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· The 40 degree angle is the cinematic recommendation: it makes the screen fill your vision without eye movement to follow the action.</p>
              <p>· The 30 degree angle is the minimum for a comfortable experience in a living room, and it is the one most people can actually achieve with furniture.</p>
              <p>· {result.ppi >= 200 ? 'At ' + result.ppi.toFixed(0) + ' ppi the pixels are dense enough that you will not see them from any normal seating distance.' : 'At ' + result.ppi.toFixed(0) + ' ppi you would need to sit within ' + result.toDisplay(result.pixelMerge) + ' before individual pixels became visible, which is closer than anyone actually sits.'}</p>
              <p>· Screen area works out at {result.screenArea.toFixed(0)} square inches, so it comfortably seats about {result.seats} people at the cinematic angle.</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={kind === 'monitor' ? 'Comfortable desk distance' : 'Comfortable viewing distance'}
          value={result.toDisplay(result.thxDistance)}
          sub={'For a ' + result.size + ' inch ' + aspect + ' panel at ' + result.res.label + '. Sitting closer than ' + result.toDisplay(result.smpteDistance) + ' makes the edges harder to take in; sitting much further back wastes the resolution you paid for.'}
        />
        <Ring
          value={result.fovAtThx}
          max={60}
          label="Field of view at that distance"
          sub={result.fovAtThx.toFixed(0) + ' degrees at the recommended distance, ' + result.fovAtSmpte.toFixed(0) + ' degrees at the minimum'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Distances that make sense, in order</div>
          <Bars data={result.ladder} format={(value) => value.toFixed(1)} suffix=" in" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The pixel-merge distance is where the screen stops looking like a grid of dots. If it sits well beyond your actual seating distance, the extra resolution is
            being spent on detail your eye cannot resolve from there.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Visible width</span><span>{result.width.toFixed(1)} in · {result.toDisplay(result.width)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Visible height</span><span>{result.height.toFixed(1)} in · {result.toDisplay(result.height)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pixel density</span><span>{result.ppi.toFixed(0)} ppi</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pixel pitch</span><span>{(result.pixelPitch * 1000).toFixed(2)} mm</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">THX 40 degrees</span><span className="text-cyan-j">{result.toDisplay(result.thxDistance)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">SMPTE 30 degrees</span><span className="text-cyan-j">{result.toDisplay(result.smpteDistance)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pixels stop resolving</span><span>{result.toDisplay(result.pixelMerge)}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Screen area</span><span>{result.screenArea.toFixed(0)} sq in</span></div>
            {kind === 'monitor' && (
              <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Desk seating</span><span>{result.toDisplay(result.monitorArm)}</span></div>
            )}
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Seats at that angle</span><span className="text-cyan-j">{result.seats}</span></div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Comfortable" value={result.toDisplay(result.thxDistance)} mono sub="40 degrees" />
        <Stat label="Minimum" value={result.toDisplay(result.smpteDistance)} mono sub="30 degrees" />
        <Stat label="Pixel density" value={result.ppi.toFixed(0) + ' ppi'} mono sub={result.res.label} />
        <Stat label="Screen area" value={result.screenArea.toFixed(0) + ' in²'} mono sub={result.width.toFixed(0) + ' × ' + result.height.toFixed(0) + ' in'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing between size and resolution</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· A bigger screen at the same distance always beats more pixels, because you see the whole image larger. Resolution only helps if you sit close enough to resolve it.</p>
            <p>· 1080p up to about 50 inches at 2.5 m is fine. Beyond that 4K becomes visible, mostly in text and sharp edges.</p>
            <p>· 8K needs you within roughly a metre of a large panel before it does anything at all. From a sofa it is indistinguishable from 4K.</p>
            <p>· For a desk monitor, density matters more than size: a 27 inch 4K panel at arm's length gives noticeably crisper text than 1080p at the same size.</p>
            <p>· Aspect ratio changes the maths: a 21:9 panel is the same diagonal but a wider, shallower image, so the comfortable distance is slightly closer for the same height.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Comfort, ergonomics and the room</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Mount a television so the centre sits roughly at seated eye level — typically {result.toDisplay(result.eyeLevelFromFloor)} above seated eye height. Above a fireplace is the single most common mistake.</p>
            <p>· At a desk, the top of the screen should be at or just below eye level, with the monitor about an arm's length away.</p>
            <p>· Follow 20-20-20: every 20 minutes, look at something 20 feet away for 20 seconds. Distance is not the only factor in eye strain; duration is.</p>
            <p>· Ambient light should roughly match the screen brightness. A bright screen in a dark room causes more fatigue than the wrong distance.</p>
            <p>· Audio seats differently from video. If you have a surround setup, the seating distance is often set by the speakers rather than by the screen.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Screen', value: result.size + ' in' },
                { label: 'Resolution', value: result.res.label },
                { label: 'Comfortable', value: result.toDisplay(result.thxDistance) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The geometry in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>height = diagonal ÷ √(1 + ratio²) · width = height × ratio</p>
          <p>ppi = horizontal pixels ÷ width in inches</p>
          <p>pixel pitch = width ÷ horizontal pixels</p>
          <p>pixels merge at pitch ÷ 0.000291 inches, from one arcminute of visual acuity</p>
          <p>field of view = 2 × atan((width ÷ 2) ÷ distance)</p>
          <p className="text-cyan-j">Check: {result.size} ÷ √(1 + {(result.ratio * result.ratio).toFixed(2)}) gives a height of {result.height.toFixed(1)} inches and a width of {result.width.toFixed(1)}.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The pixel-merge distance assumes 20/20 vision and a 16:9 style flat panel at full resolution. Real rooms have seating that already exists, and glare, speaker
          placement and walking space usually decide the answer before the geometry does — so treat these figures as the target rather than a fixed rule.
        </p>
      </Panel>
    </ToolShell>
  );
}