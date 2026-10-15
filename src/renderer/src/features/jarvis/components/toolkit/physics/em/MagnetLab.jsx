import { Magnet } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { magnetSim, biotSavart, currentPath } from './magnetCore';

const microTesla = (value) => `${(value * 1e6).toFixed(3)} µT`;

export default function MagnetLab() {
  return (
    <EngShell
      sim={magnetSim}
      toolId="magnetic-fields"
      icon={Magnet}
      title="Magnetic Field Laboratory"
      desc="Current paths and the fields they make. Every arrow is summed from the Biot–Savart law along the real geometry, and the same field is integrated around a closed loop and over a closed surface to put Ampère’s law and the absence of magnetic monopoles to the test."
    >
      {({ params, readings: r }) => {
        const span = r.span;
        const arrowScale = span * 0.12;
        const axis = Array.from({ length: 90 }, (_, index) => {
          const x = (-span + (index / 89) * 2 * span);
          const field = params.configuration === 'solenoid'
            ? { x: r.idealSolenoidField * (1 / (1 + Math.pow((x * 2) / (params.length * 0.01), 6))), y: 0 }
            : biotSavart(currentPath(params.configuration, params), params.current, { x, y: 0 });
          return { x, y: Math.abs(field.x + field.y) * 1e6 };
        });
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Field at the probe" value={microTesla(r.magnitude)} sub={`${r.directionAngle.toFixed(1)}° from the x axis at (${params.probeX}, ${params.probeY}) cm`} />
              <Stat label="Force on a moving charge" value={`${(r.forceMagnitude * 1e9).toFixed(4)} nN`} sub={`q = ${params.charge} nC at ${(params.speed / 1e3).toFixed(0)} km/s, ${params.angle}° to the field`} mono />
              <Stat label="Energy density in the field" value={`${r.energyDensity.toFixed(4)} J/m³`} sub="B²/2μ₀" mono />
              <Stat label="Loop moment and torque" value={`${(r.moment * 1e3).toFixed(3)} mA·m²`} sub={`torque ${(r.torque * 1e6).toFixed(2)} µN·m at this angle and field`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Field around the conductor</h3>
              <Scene
                xDomain={[-span, span]}
                yDomain={[-span, span]}
                height={330}
                xLabel="x (m)"
                yLabel="y (m)"
                ariaLabel="Magnetic field arrows around the current path, with the probe and the force on a moving charge"
                field={{ points: r.arrows, scale: arrowScale }}
                series={r.displayPath.length > 1 ? [{ points: r.displayPath, tone: 'amber', width: 2.4 }] : []}
                markers={[
                  { x: params.probeX * 1e-2, y: params.probeY * 1e-2, tone: 'emerald', r: span * 0.02, label: 'probe' },
                  ...(r.wireEndOn ? [{ x: 0, y: 0, tone: 'amber', r: span * 0.03, label: 'current out of the screen' }] : []),
                ]}
                arrows={[
                  {
                    x: params.probeX * 1e-2,
                    y: params.probeY * 1e-2,
                    dx: (r.field.x / Math.max(1e-15, r.magnitude)) * arrowScale * 1.1,
                    dy: (r.field.y / Math.max(1e-15, r.magnitude)) * arrowScale * 1.1,
                    tone: 'cyan',
                    label: `B = ${microTesla(r.magnitude)}`,
                  },
                  {
                    x: params.probeX * 1e-2,
                    y: params.probeY * 1e-2,
                    dx: Math.cos(((r.forceDirection - 90) * Math.PI) / 180) * arrowScale * 0.7,
                    dy: Math.sin(((r.forceDirection - 90) * Math.PI) / 180) * arrowScale * 0.7,
                    tone: 'violet',
                    label: 'force on a moving charge',
                  },
                ]}
                texts={[
                  { x: -span * 0.95, y: span * 0.93, text: 'arrows show the direction of the field; their length is a logarithmic measure of strength' },
                  { x: -span * 0.95, y: span * 0.85, text: `the field loops around the conductor and closes on itself — no magnetic charge is needed` },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Field along the axis</h3>
                <Scene
                  xDomain={[-span, span]}
                  yDomain={[0, Math.max(...axis.map((point) => point.y)) * 1.15]}
                  height={160}
                  xLabel="position along the axis (m)"
                  yLabel="|B| (µT)"
                  ariaLabel="Magnetic field magnitude along the axis"
                  series={[
                    { points: axis, tone: 'cyan', width: 2, fill: 'cyan', fillOpacity: 0.12 },
                  ]}
                />
                <p className="text-[11px] text-muted-foreground/80">
                  {params.configuration === 'helmholtz' && 'Two coils a radius apart give the famous flat top: the field barely changes across the middle, which is why they are used to make uniform fields.'}
                  {params.configuration === 'solenoid' && 'Inside a coil with length much larger than its radius the field is nearly flat and equals μ₀nI; a short coil shows a clear dip in the middle instead.'}
                  {params.configuration === 'loop' && 'A single loop peaks in its own plane and falls away as the inverse cube of the distance along the axis.'}
                  {params.configuration === 'wire' && 'A long wire gives a field that falls as one over the distance — the classic inverse-distance form of Ampère’s law.'}
                </p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Geometry and current</h3>
                <Stat label="Conductor drawn" value={`${(r.pathLength * 100).toFixed(1)} cm of current path`} sub={params.configuration === 'solenoid' ? `${params.turns} turns, ${r.turnsPerMetre.toFixed(0)} per metre` : 'the path the field is summed along'} mono />
                <Stat label="Ideal solenoid field" value={microTesla(r.idealSolenoidField)} sub="μ₀nI, approached when the coil is long and thin" mono />
                <Stat label="Field scaling" value="linear in the current" sub="double the current and every arrow doubles, which the checks confirm" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The laws behind the picture</h3>
                <Stat label="Ampère’s law" value="∮B·dl = μ₀I" sub="integrated numerically around a circle enclosing the wire" mono />
                <Stat label="No monopoles" value="∮B·dA = 0" sub="flux through a closed surface, summed over the same field" mono />
                <Stat label="Lorentz force" value="F = qv × B" sub={`zero when the charge moves along the field, largest at right angles`} mono />
                <p className="text-[11px] text-muted-foreground/80">Nothing here is drawn from a formula alone: the arrows, the check on Ampère’s law and the check on magnetic monopoles all come from the same segment-by-segment sum of the field of the current you have configured.</p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}