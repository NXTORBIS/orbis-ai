import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const BODIES = [
  { label: 'Earth', mass: 5.9722e24, radius: 6371, day: 23.9345 },
  { label: 'Moon', mass: 7.342e22, radius: 1737.4, day: 655.72 },
  { label: 'Mars', mass: 6.4171e23, radius: 3389.5, day: 24.6229 },
  { label: 'Jupiter', mass: 1.8982e27, radius: 69911, day: 9.925 },
];

const ORBITS = [
  { label: 'ISS', altitude: 420 },
  { label: 'Starlink', altitude: 550 },
  { label: 'Sun-synchronous', altitude: 700 },
  { label: 'GPS', altitude: 20200 },
  { label: 'Geostationary', altitude: 35786 },
  { label: 'Lunar distance', altitude: 384400 },
];

const G = 6.674e-11;

export default function OrbitCalculator() {
  const [bodyIndex, setBodyIndex] = useState(0);
  const [altitude, setAltitude] = useState('420');
  const [mass, setMass] = useState('1000');
  const [inclination, setInclination] = useState('51.6');

  const result = useMemo(() => {
    const body = BODIES[bodyIndex];
    const altitudeKm = Number(altitude) || 0;
    const radius = (body.radius + altitudeKm) * 1000;
    const mu = G * body.mass;
    const surfaceGravity = (G * body.mass) / Math.pow(body.radius * 1000, 2);
    const gravity = mu / Math.pow(radius, 2);
    const velocity = Math.sqrt(mu / radius);
    const escape = Math.sqrt((2 * mu) / radius);
    const period = 2 * Math.PI * radius / velocity;
    const orbitsPerDay = (body.day * 3600) / period;
    const energyPerKg = -mu / (2 * radius);
    const satelliteMass = Number(mass) || 0;
    const kinetic = 0.5 * satelliteMass * Math.pow(velocity, 2);
    const potential = -(mu * satelliteMass) / radius;
    const geostationaryRadius = Math.cbrt((mu * Math.pow(body.day * 3600, 2)) / (4 * Math.PI * Math.PI));
    const geostationaryAltitude = geostationaryRadius / 1000 - body.radius;
    const circumference = 2 * Math.PI * radius;
    const belowSurface = altitudeKm < 0;
    const dragRelevant = altitudeKm > 0 && altitudeKm < 600;

    const ladder = ORBITS.map((entry) => {
      const entryRadius = (body.radius + entry.altitude) * 1000;
      const entryVelocity = Math.sqrt(mu / entryRadius);
      const entryPeriod = (2 * Math.PI * entryRadius) / entryVelocity;
      return {
        ...entry,
        velocity: entryVelocity,
        periodMinutes: entryPeriod / 60,
        orbitsPerDay: (body.day * 3600) / entryPeriod,
      };
    });

    const escapeProfile = [1, 1.5, 2, 4, 8].map((multiple) => {
      const entryRadius = (body.radius * multiple) * 1000;
      return { multiple, velocity: Math.sqrt(mu / entryRadius), escape: Math.sqrt((2 * mu) / entryRadius) };
    });

    return {
      body, altitudeKm, radius, mu, gravity, surfaceGravity, velocity, escape, period, orbitsPerDay, energyPerKg,
      satelliteMass, kinetic, potential, geostationaryAltitude, circumference, belowSurface, dragRelevant, ladder, escapeProfile,
      gravitationalRatio: surfaceGravity ? gravity / surfaceGravity : 0,
    };
  }, [bodyIndex, altitude, mass, inclination]);

  const geometry = useMemo(() => {
    const size = 190;
    const centre = size / 2;
    const bodyRadius = 22;
    const ratio = Math.min(1, Math.log10(1 + result.altitudeKm / 100) / Math.log10(1 + 400000 / 100));
    const orbitRadius = bodyRadius + 8 + ratio * (centre - bodyRadius - 18);
    return { size, centre, bodyRadius, orbitRadius };
  }, [result.altitudeKm]);

  const report = useMemo(() => [
    'Orbit around ' + result.body.label + ' at ' + result.altitudeKm + ' km altitude',
    '',
    'Orbital radius: ' + (result.radius / 1000).toFixed(1) + ' km',
    'Orbital velocity: ' + result.velocity.toFixed(3) + ' km/s (' + (result.velocity * 3.6).toFixed(1) + ' km/h)',
    'Orbital period: ' + (result.period / 60).toFixed(2) + ' minutes (' + result.orbitsPerDay.toFixed(2) + ' orbits per day)',
    'Escape velocity at this altitude: ' + result.escape.toFixed(3) + ' km/s',
    'Gravity here: ' + result.gravity.toFixed(3) + ' m/s² (' + (result.gravitationalRatio * 100).toFixed(1) + '% of surface gravity)',
    '',
    'Energy for ' + result.satelliteMass + ' kg: kinetic ' + (result.kinetic / 1e6).toFixed(1) + ' MJ, potential ' + (result.potential / 1e6).toFixed(1) + ' MJ, total ' + ((result.kinetic + result.potential) / 1e6).toFixed(1) + ' MJ',
    'Specific orbital energy: ' + (result.energyPerKg / 1e6).toFixed(2) + ' MJ/kg',
    '',
    'Geostationary altitude for ' + result.body.label + ': ' + result.geostationaryAltitude.toFixed(1) + ' km',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="orbit-calculator"
      icon={Globe}
      title="Orbit & Satellite Calculator"
      desc="An altitude above any body into orbital velocity, period, escape velocity and how many orbits a day — with the altitude ladder from the space station to geostationary."
      state={{ bodyIndex, altitude, mass, inclination }}
      onRestore={(restored) => {
        if (restored.bodyIndex !== undefined) setBodyIndex(Number(restored.bodyIndex) || 0);
        if (restored.altitude !== undefined) setAltitude(String(restored.altitude));
        if (restored.mass !== undefined) setMass(String(restored.mass));
        if (restored.inclination !== undefined) setInclination(String(restored.inclination));
      }}
      exportText={report}
      exportName="orbit.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {BODIES.map((entry, index) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => setBodyIndex(index)}
            className={index === bodyIndex
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {ORBITS.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => setAltitude(String(entry.altitude))}
            className={Number(altitude) === entry.altitude
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label} · {entry.altitude} km
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Altitude above the surface, km"><input value={altitude} onChange={(e) => setAltitude(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Satellite mass, kg"><input value={mass} onChange={(e) => setMass(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Inclination, degrees"><input value={inclination} onChange={(e) => setInclination(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Orbital radius">
          <div className="flex h-9 items-center font-mono-j text-sm text-cyan-j">{(result.radius / 1000).toFixed(0)} km</div>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="grid gap-3 sm:grid-cols-[190px_1fr]">
          <svg viewBox={'0 0 ' + geometry.size + ' ' + geometry.size} className="mx-auto h-auto w-[190px] rounded-lg border border-border/60 bg-card/30">
            <circle cx={geometry.centre} cy={geometry.centre} r={geometry.bodyRadius} fill="hsl(var(--cyan) / 0.18)" stroke="hsl(var(--cyan))" strokeWidth="1.5" />
            <text x={geometry.centre} y={geometry.centre + 4} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">{result.body.label}</text>
            <circle cx={geometry.centre} cy={geometry.centre} r={geometry.orbitRadius} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="4 4" />
            <circle cx={geometry.centre + geometry.orbitRadius} cy={geometry.centre} r="4" fill="hsl(var(--cyan))" />
            <line x1={geometry.centre} x2={geometry.centre - geometry.orbitRadius * 0.7} y1={geometry.centre} y2={geometry.centre - geometry.orbitRadius * 0.7} stroke="hsl(var(--cyan))" strokeWidth="0.75" strokeDasharray="2 3" />
            <text x={geometry.centre + 6} y={geometry.centre - 8} fontSize="9" fill="hsl(var(--muted-foreground))">{result.altitudeKm} km up</text>
          </svg>
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Orbital velocity" value={result.velocity.toFixed(2) + ' km/s'} mono sub={(result.velocity * 3.6).toFixed(0) + ' km/h'} />
              <Stat label="Orbital period" value={(result.period / 60).toFixed(1) + ' min'} mono sub={result.orbitsPerDay.toFixed(2) + ' orbits a day'} />
            </div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· Gravity here is {result.gravity.toFixed(2)} m/s², or {((1 - result.gravitationalRatio) * 100).toFixed(0)}% less than at the surface. Astronauts float because they are falling, not because gravity has gone.</p>
              <p>· Escape velocity at this altitude is {result.escape.toFixed(2)} km/s — always exactly √2 times the orbital velocity, which is why leaving orbit costs so much more than reaching it.</p>
              <p>· {result.dragRelevant ? 'Below about 600 km there is still enough atmosphere to slow a satellite down, so low orbits need regular boosting.' : 'At this altitude the atmosphere is negligible, so the orbit can persist without station-keeping.'}</p>
              <p>· {result.belowSurface ? 'That altitude is below the surface — this is a suborbital trajectory, not an orbit.' : 'The geometric altitude is measured from the mean surface, with the radius used as ' + (result.radius / 1000).toFixed(0) + ' km.'}</p>
            </div>
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Orbital velocity"
          value={result.velocity.toFixed(2)}
          unit="km/s"
          sub={'A complete circuit takes ' + (result.period / 60).toFixed(1) + ' minutes, so this orbit repeats ' + result.orbitsPerDay.toFixed(2) + ' times every ' + result.body.label.toLowerCase() + ' day. Escape from here needs ' + result.escape.toFixed(2) + ' km/s.'}
        />
        <Ring
          value={result.orbitsPerDay}
          max={Math.max(1, Math.ceil(result.orbitsPerDay))}
          label="Orbits per body day"
          sub={result.orbitsPerDay.toFixed(2) + ' revolutions per ' + (result.body.day / 24).toFixed(2) + ' Earth days'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The altitude ladder around {result.body.label}</div>
          <Bars
            data={result.ladder.map((entry) => ({ label: entry.label.split(' ')[0].slice(0, 9), value: Number(entry.velocity.toFixed(2)) }))}
            format={(value) => value.toFixed(1)}
            suffix=" km/s"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Velocity falls as altitude rises, but the period grows because the circumference grows faster. That trade is Kepler in one sentence: higher orbits are slower and much longer.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Energy and gravity</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Orbital radius</span><span>{(result.radius / 1000).toFixed(1)} km</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Velocity</span><span className="text-cyan-j">{result.velocity.toFixed(3)} km/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Escape velocity</span><span>{result.escape.toFixed(3)} km/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Period</span><span>{(result.period / 60).toFixed(2)} min</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Orbit circumference</span><span>{(result.circumference / 1000).toFixed(0)} km</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Gravity here</span><span>{result.gravity.toFixed(3)} m/s²</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Surface gravity</span><span>{result.surfaceGravity.toFixed(3)} m/s²</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Kinetic energy</span><span>{(result.kinetic / 1e6).toFixed(1)} MJ</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Potential energy</span><span>{(result.potential / 1e6).toFixed(1)} MJ</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Total energy</span><span className="text-cyan-j">{((result.kinetic + result.potential) / 1e6).toFixed(1)} MJ</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Geostationary altitude</span><span>{result.geostationaryAltitude.toFixed(0)} km</span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Velocity as the orbit grows</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {result.escapeProfile.map((row) => (
            <div key={row.multiple} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
              <span className="text-muted-foreground">{row.multiple} × body radius</span>
              <span>orbit {row.velocity.toFixed(2)} km/s · escape {row.escape.toFixed(2)} km/s</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Escape velocity is always √2 times the circular velocity at the same radius, whatever the altitude. That constant ratio is why reaching orbit is hard but leaving it
          entirely is only 41% more speed.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Velocity" value={result.velocity.toFixed(2) + ' km/s'} mono sub={(result.velocity * 3.6).toFixed(0) + ' km/h'} />
        <Stat label="Period" value={(result.period / 60).toFixed(1) + ' min'} mono />
        <Stat label="Orbits a day" value={result.orbitsPerDay.toFixed(2)} mono />
        <Stat label="Gravity" value={result.gravity.toFixed(2)} mono sub="m/s² here" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What each orbit is for</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Around 400 to 600 km gives a 90 minute orbit and a good view of the ground. It is also where the atmosphere still drags, so the orbit decays and needs boosting.</p>
            <p>· Sun-synchronous orbits near 700 km are inclined so that the satellite crosses each latitude at the same local time, which is why Earth observation images stay comparable.</p>
            <p>· The geostationary altitude for {result.body.label} works out at {result.geostationaryAltitude.toFixed(0)} km, where the orbit period matches the rotation of the body and the satellite appears fixed in the sky.</p>
            <p>· A geostationary orbit must sit over the equator. Any inclination makes the satellite trace a figure of eight instead.</p>
            <p>· Navigation constellations sit higher than the space station precisely so that several satellites are always in view.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Assumptions worth knowing</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· These are circular orbits only. A real launch ends in an ellipse and is circularised with a second burn at apogee.</p>
            <p>· The body is treated as a perfect sphere with a point mass at the centre. Earth is slightly flattened, which perturbs real orbits over time.</p>
            <p>· No drag, no solar pressure and no third-body effects. All three matter for long-lived satellites, particularly at low altitude.</p>
            <p>· The delta-v actually needed is far larger than the orbital velocity, because a launch starts from the surface with a gravity loss and a rotation bonus.</p>
            <p>· Inclination does not change the speed or the period in a circular orbit; it changes which part of the ground the satellite passes over.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Body', value: result.body.label },
                { label: 'Altitude', value: result.altitudeKm + ' km' },
                { label: 'Orbits a day', value: result.orbitsPerDay.toFixed(2) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>μ = G × M, with G = 6.674 × 10⁻¹¹</p>
          <p>v = √(μ ÷ r) · T = 2πr ÷ v · v_escape = √(2μ ÷ r)</p>
          <p>g = μ ÷ r² · specific energy = −μ ÷ 2r</p>
          <p>geostationary radius = ∛(μ T² ÷ 4π²) with T the rotation period</p>
          <p className="text-cyan-j">Here: μ = {result.mu.toExponential(3)} and r = {(result.radius / 1000).toFixed(0)} km gives v = {result.velocity.toFixed(3)} km/s.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Two-body mechanics only, with circular orbits and a spherical central body. That is the same model used for mission planning at the first pass, and it predicts
          real orbits to within a fraction of a percent for the low Earth orbits shown here.
        </p>
      </Panel>
    </ToolShell>
  );
}