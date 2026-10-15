import { useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const GRAVITY = [
  { label: 'Earth', value: 9.81 },
  { label: 'Moon', value: 1.62 },
  { label: 'Mars', value: 3.72 },
  { label: 'Jupiter', value: 24.79 },
];

const VIEW = { width: 340, height: 190, pad: 26 };

export default function ProjectileMotion() {
  const [speed, setSpeed] = useState('25');
  const [angle, setAngle] = useState('45');
  const [height, setHeight] = useState('0');
  const [gravity, setGravity] = useState('9.81');
  const [preset, setPreset] = useState('Earth');

  const flight = useMemo(() => {
    const v = Number(speed) || 0;
    const theta = (Number(angle) || 0) * Math.PI / 180;
    const h0 = Number(height) || 0;
    const g = Math.max(0.01, Number(gravity) || 9.81);

    const vx = v * Math.cos(theta);
    const vy = v * Math.sin(theta);
    const apexTime = vy / g;
    const apexHeight = h0 + (vy * vy) / (2 * g);
    const flightTime = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h0))) / g;
    const range = vx * flightTime;
    const impactVy = vy - g * flightTime;
    const impactSpeed = Math.sqrt(vx * vx + impactVy * impactVy);
    const impactAngle = Math.atan2(Math.abs(impactVy), Math.abs(vx) || 1) * 180 / Math.PI;

    const samples = [];
    const steps = 60;
    for (let index = 0; index <= steps; index += 1) {
      const t = (flightTime * index) / steps;
      samples.push({ t, x: vx * t, y: h0 + vy * t - 0.5 * g * t * t });
    }

    const sweep = [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75].map((degrees) => {
      const rad = degrees * Math.PI / 180;
      const sx = v * Math.cos(rad);
      const sy = v * Math.sin(rad);
      const time = (sy + Math.sqrt(Math.max(0, sy * sy + 2 * g * h0))) / g;
      return { degrees, range: sx * time, apex: h0 + (sy * sy) / (2 * g) };
    });
    const best = [...sweep].sort((a, b) => b.range - a.range)[0];

    return { v, theta, h0, g, vx, vy, apexTime, apexHeight, flightTime, range, impactSpeed, impactAngle, samples, sweep, best };
  }, [speed, angle, height, gravity]);

  const path = useMemo(() => {
    const plotW = VIEW.width - VIEW.pad * 2;
    const plotH = VIEW.height - VIEW.pad * 2;
    const maxX = Math.max(flight.range, 1);
    const maxY = Math.max(flight.apexHeight, flight.h0, 1);
    const toX = (x) => VIEW.pad + (x / maxX) * plotW;
    const toY = (y) => VIEW.height - VIEW.pad - (y / maxY) * plotH;
    const points = flight.samples.map((point) => toX(point.x).toFixed(1) + ',' + toY(point.y).toFixed(1)).join(' ');
    return {
      points, toX, toY, maxX, maxY,
      apex: { x: toX(flight.vx * flight.apexTime), y: toY(flight.apexHeight) },
      impact: { x: toX(flight.range), y: toY(0) },
      launch: { x: toX(0), y: toY(flight.h0) },
      ground: toY(0),
    };
  }, [flight]);

  const report = useMemo(() => [
    'Launch speed ' + flight.v + ' at ' + angle + ' degrees, from ' + flight.h0 + ' m, gravity ' + flight.g + ' m/s²',
    '',
    'Horizontal velocity: ' + flight.vx.toFixed(2) + ' m/s',
    'Vertical velocity: ' + flight.vy.toFixed(2) + ' m/s',
    'Time to apex: ' + flight.apexTime.toFixed(2) + ' s',
    'Apex height: ' + flight.apexHeight.toFixed(2) + ' m',
    'Flight time: ' + flight.flightTime.toFixed(2) + ' s',
    'Range: ' + flight.range.toFixed(2) + ' m',
    'Impact speed: ' + flight.impactSpeed.toFixed(2) + ' m/s at ' + flight.impactAngle.toFixed(1) + ' degrees below horizontal',
    '',
    'Best angle in the sweep: ' + flight.best.degrees + ' degrees for ' + flight.best.range.toFixed(2) + ' m',
  ].join('\n'), [flight, angle]);

  return (
    <ToolShell
      toolId="projectile-motion"
      icon={Target}
      title="Projectile Motion Lab"
      desc="Launch speed and angle into range, apex, flight time and impact — with the trajectory drawn, an angle sweep and the standard physics explained alongside the numbers."
      state={{ speed, angle, height, gravity, preset }}
      onRestore={(restored) => {
        if (restored.speed !== undefined) setSpeed(String(restored.speed));
        if (restored.angle !== undefined) setAngle(String(restored.angle));
        if (restored.height !== undefined) setHeight(String(restored.height));
        if (restored.gravity !== undefined) setGravity(String(restored.gravity));
        if (restored.preset) setPreset(restored.preset);
      }}
      exportText={report}
      exportName="projectile.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {GRAVITY.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => { setPreset(entry.label); setGravity(String(entry.value)); }}
            className={entry.label === preset
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label} · {entry.value}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Launch speed, m/s"><input value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={'Launch angle · ' + angle + '°'}><input type="range" min={1} max={89} step={1} value={angle} onChange={(e) => setAngle(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" /></Field>
        <Field label="Launch height, m"><input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gravity, m/s²"><input value={gravity} onChange={(e) => setGravity(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Trajectory</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">range {flight.range.toFixed(1)} m · apex {flight.apexHeight.toFixed(1)} m</span>
        </div>
        <svg viewBox={'0 0 ' + VIEW.width + ' ' + VIEW.height} className="h-auto w-full rounded-lg border border-border/60 bg-card/30">
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={'h' + fraction} x1={VIEW.pad} x2={VIEW.width - VIEW.pad} y1={VIEW.height - VIEW.pad - fraction * (VIEW.height - VIEW.pad * 2)} y2={VIEW.height - VIEW.pad - fraction * (VIEW.height - VIEW.pad * 2)} stroke="hsl(var(--border))" strokeWidth="0.5" strokeDasharray="3 4" />
          ))}
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line key={'v' + fraction} y1={VIEW.pad} y2={VIEW.height - VIEW.pad} x1={VIEW.pad + fraction * (VIEW.width - VIEW.pad * 2)} x2={VIEW.pad + fraction * (VIEW.width - VIEW.pad * 2)} stroke="hsl(var(--border))" strokeWidth="0.5" strokeDasharray="3 4" />
          ))}
          <line x1={VIEW.pad} x2={VIEW.width - VIEW.pad} y1={path.ground} y2={path.ground} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
          <polyline points={path.points} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2" strokeLinejoin="round" />
          <circle cx={path.launch.x} cy={path.launch.y} r="3.5" fill="hsl(var(--cyan))" />
          <circle cx={path.apex.x} cy={path.apex.y} r="3.5" fill="hsl(var(--amber, 38 100% 50%))" />
          <circle cx={path.impact.x} cy={path.impact.y} r="3.5" fill="hsl(var(--cyan))" />
          <text x={path.apex.x} y={path.apex.y - 8} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">apex</text>
          <text x={VIEW.pad} y={VIEW.height - 8} fontSize="9" fill="hsl(var(--muted-foreground))">launch {flight.h0} m</text>
          <text x={VIEW.width - VIEW.pad} y={VIEW.height - 8} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">{flight.range.toFixed(1)} m</text>
        </svg>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The curve is a parabola. Horizontal velocity is constant and vertical velocity changes by gravity every second — the two are completely independent, which
          is the whole trick of projectile problems.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Range"
          value={flight.range.toFixed(1)}
          unit="m"
          sub={'Flight time ' + flight.flightTime.toFixed(2) + ' s, apex ' + flight.apexHeight.toFixed(1) + ' m at ' + flight.apexTime.toFixed(2) + ' s, landing at ' + flight.impactSpeed.toFixed(1) + ' m/s and ' + flight.impactAngle.toFixed(0) + '° below horizontal.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Horizontal velocity</span><span>{flight.vx.toFixed(2)} m/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Vertical velocity</span><span>{flight.vy.toFixed(2)} m/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Time to apex</span><span>{flight.apexTime.toFixed(2)} s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Apex height</span><span className="text-cyan-j">{flight.apexHeight.toFixed(2)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Flight time</span><span className="text-cyan-j">{flight.flightTime.toFixed(2)} s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Range</span><span className="text-cyan-j">{flight.range.toFixed(2)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Impact speed</span><span>{flight.impactSpeed.toFixed(2)} m/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Impact angle</span><span>{flight.impactAngle.toFixed(1)}°</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Best angle here</span><span className="text-cyan-j">{flight.best.degrees}°</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Angle sweep at {flight.v} m/s from {flight.h0} m</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {flight.sweep.map((row) => (
            <div key={row.degrees} className="flex items-center gap-2">
              <span className="w-10 font-mono-j text-[11px] text-muted-foreground">{row.degrees}°</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={row.degrees === flight.best.degrees ? 'h-full rounded-full bg-cyan-j' : 'h-full rounded-full bg-cyan-j/35'}
                  style={{ width: (flight.best.range ? (row.range / flight.best.range) * 100 : 0) + '%' }}
                />
              </div>
              <span className="w-20 text-right font-mono-j text-[11px]">{row.range.toFixed(1)} m</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {flight.h0 > 0
            ? 'Because you are launching from a height, the best angle is below 45° — the extra fall time lets a flatter, faster launch cover more ground.'
            : 'On level ground the range peaks at 45°, and complementary angles pair up: 30° and 60° land in the same place, though the steeper one hangs longer.'}
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Range" value={flight.range.toFixed(1) + ' m'} mono />
        <Stat label="Apex" value={flight.apexHeight.toFixed(1) + ' m'} mono sub={flight.apexTime.toFixed(2) + ' s in'} />
        <Stat label="Flight time" value={flight.flightTime.toFixed(2) + ' s'} mono />
        <Stat label="Impact" value={flight.impactSpeed.toFixed(1) + ' m/s'} mono sub={flight.impactAngle.toFixed(0) + '° below'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The physics in one screen</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>x(t) = v·cosθ · t</p>
            <p>y(t) = h + v·sinθ · t − ½·g·t²</p>
            <p>apex when vertical velocity = 0 → t = v·sinθ ÷ g</p>
            <p>range = v·cosθ × flight time</p>
            <p className="text-cyan-j">Here: {flight.vy.toFixed(1)} ÷ {flight.g} = {flight.apexTime.toFixed(2)} s to the top, and the fall from {flight.apexHeight.toFixed(1)} m supplies the rest of the {flight.flightTime.toFixed(2)} s.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Assumptions and where they break</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· No air resistance. For a golf ball or a cricket ball this shaves 10 to 40% off the real range, and the peak of the real path is lower and closer.</p>
            <p>· Constant gravity. Correct for a few kilometres, not for an orbital launch.</p>
            <p>· Flat ground and no wind. Both change the answer materially outside a lab.</p>
            <p>· Release height matters more than people expect: dropping the launch from 1 m to 0 m changes the range noticeably at low angles.</p>
            <p>· The impact angle is where the trajectory enters the ground, which is why a flatter launch lands at a shallower angle.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Speed', value: flight.v + ' m/s' },
                { label: 'Angle', value: angle + '°' },
                { label: 'Range', value: flight.range.toFixed(1) + ' m' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Patterns worth knowing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Range scales with the square of speed. Double the launch speed and you roughly quadruple the distance.</p>
            <p>· Air time is symmetric on flat ground: time up equals time down, and the impact speed equals the launch speed.</p>
            <p>· The apex is decided only by the vertical component, so a slow steep throw can peak higher than a fast flat one.</p>
            <p>· Maximum height and maximum range are different problems: 90° maximises height, 45° maximises range on level ground.</p>
            <p>· Complementary angles share a range but not a flight time, which matters whenever a hit needs to arrive before something else does.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where this is used</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Sport: release angle for a shot put, a football pass or a jump serve, and why the ideal angle is never textbook 45° once release height counts.</p>
            <p>· Engineering: water jets, firefighting monitors and sprinkler throw, where range at a given pressure is the design number.</p>
            <p>· Gaming and animation: a believable arc needs the vertical and horizontal components to move independently, exactly as here.</p>
            <p>· Safety: drop and throw distances for debris, and the launch speed implied by a known landing point.</p>
            <p>· Teaching: the single clearest demonstration that two independent motions combine into one curve.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reversing the problem</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Known range and angle? Speed needed = √(range × g ÷ sin(2θ)) for a level launch. Set the angle and read the range here, then adjust speed until it matches.</p>
          <p>· Known range and speed? This is the same pair of complementary angles — the sweep above shows both ends of the pairing.</p>
          <p>· Known apex and speed? Vertical velocity is √(2 g apex), which gives the angle directly.</p>
          <p>· Anything launched from a height makes the algebra messier but the method identical: solve the vertical equation for the time that reaches the ground, then multiply by the horizontal velocity.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          One set of equations drives the drawing, the sweep and the tables, so the picture and the numbers always agree. Gravity is a single input rather than a
          constant, which is what lets the same screen serve a classroom on Earth and a thought experiment on the Moon.
        </p>
      </Panel>
    </ToolShell>
  );
}