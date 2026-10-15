import { Zap } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { fieldSim } from './fieldCore';

export default function FieldLab() {
  return (
    <EngShell
      sim={fieldSim}
      toolId="electrostatic-field"
      icon={Zap}
      title="Electric Field & Potential Laboratory"
      desc="Place charges and inspect the field they produce: the arrows follow the summed field, the probe measures the field, potential, force and energy at a point, and the flux through the Gaussian sphere is integrated from the same field to test Gauss’s law."
    >
      {({ params, readings: r }) => {
        const span = r.span;
        const arrowScale = span * 0.11;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Field at the probe" value={(r.magnitude / 1000).toFixed(3)} unit="kV/m" sub={`${r.probeDistance.toFixed(2)} m from the origin in the chosen arrangement`} />
              <Stat label="Potential at the probe" value={`${r.potential.toFixed(1)} V`} sub={`energy of the test charge ${r.energy.toExponential(2)} J`} mono />
              <Stat label="Force on the test charge" value={`${(r.forceMagnitude * 1000).toFixed(4)} mN`} sub={`q = ${params.testCharge} nC · qE`} mono />
              <Stat label="Gauss flux check" value={`${(r.measuredFlux / 1000).toFixed(3)} kV·m`} sub={`enclosed ${(r.enclosedCharge * 1e9).toFixed(1)} nC → q/ε₀ ${(r.expectedFlux / 1000).toFixed(3)} kV·m`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Field, charges and the Gaussian surface</h3>
              <Scene
                xDomain={[-span, span]}
                yDomain={[-span, span]}
                height={330}
                xLabel="x (m)"
                yLabel="y (m)"
                ariaLabel="Electric field arrows around the charges, with the probe point and Gaussian sphere"
                field={{ points: r.arrows, scale: arrowScale }}
                circles={[
                  ...r.charges.map((charge) => ({
                    x: charge.x,
                    y: charge.y,
                    r: span * (0.03 + Math.min(0.05, Math.abs(charge.q) * 1e8)),
                    tone: charge.q > 0 ? 'rose' : 'cyan',
                    fill: charge.q > 0 ? 'rose' : 'cyan',
                    fillOpacity: 0.85,
                    label: charge.q > 0 ? '+' : '−',
                  })),
                  { x: 0, y: 0, r: params.gaussRadius, tone: 'amber', fill: 'none', fillOpacity: 0, width: 1.2 },
                  { x: params.probeX, y: params.probeY, r: span * 0.018, tone: 'emerald', fill: 'emerald', fillOpacity: 0.9 },
                ]}
                arrows={[{
                  x: params.probeX,
                  y: params.probeY,
                  dx: Math.cos(Math.atan2(r.probe.y, r.probe.x)) * arrowScale * 1.2,
                  dy: Math.sin(Math.atan2(r.probe.y, r.probe.x)) * arrowScale * 1.2,
                  tone: 'violet',
                  label: `E ${(r.magnitude / 1000).toFixed(2)} kV/m`,
                }, {
                  x: params.probeX,
                  y: params.probeY,
                  dx: r.force.x / Math.max(1e-12, r.forceMagnitude) * arrowScale * 0.8,
                  dy: r.force.y / Math.max(1e-12, r.forceMagnitude) * arrowScale * 0.8,
                  tone: 'emerald',
                  label: 'force',
                }]}
                texts={[
                  { x: -span * 0.95, y: span * 0.93, text: `arrows show the direction of E; their length is a logarithmic measure of strength` },
                  { x: -span * 0.95, y: span * 0.84, text: `amber circle: Gaussian sphere of radius ${params.gaussRadius} m` },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Probe measurements</h3>
                <Stat label="Field components" value={`(${(r.probe.x / 1000).toFixed(3)}, ${(r.probe.y / 1000).toFixed(3)}) kV/m`} mono />
                <Stat label="Potential" value={`${r.potential.toFixed(2)} V`} sub="sum of k·q/r over the charges" mono />
                <Stat label="Force" value={`${(r.forceMagnitude * 1000).toFixed(4)} mN`} sub={params.testCharge < 0 ? 'opposite to the field for a negative charge' : 'along the field for a positive charge'} mono />
                <Stat label="Energy of the test charge" value={`${r.energy.toExponential(3)} J`} sub="qV" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Gauss’s law</h3>
                <Stat label="Enclosed charge" value={`${(r.enclosedCharge * 1e9).toFixed(2)} nC`} sub={`inside a sphere of radius ${params.gaussRadius} m`} mono />
                <Stat label="Measured flux" value={`${(r.measuredFlux / 1000).toFixed(4)} kV·m`} sub="E·dA integrated over the closed surface" mono />
                <Stat label="Expected q/ε₀" value={`${(r.expectedFlux / 1000).toFixed(4)} kV·m`} sub={`relative difference ${(r.fluxError * 100).toFixed(3)}%`} mono />
                <p className="text-[11px] text-muted-foreground/80">Move the sphere so that it swallows a different number of charges and the flux jumps by exactly the charge it encloses — the surface integral knows nothing about the charges outside.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Charges in play</h3>
                <ul className="space-y-1 text-xs">
                  {r.charges.map((charge, index) => (
                    <li key={index} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">({charge.x.toFixed(2)}, {charge.y.toFixed(2)}) m</span>
                      <span className="font-mono-j">{(charge.q * 1e9).toFixed(2)} nC</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground/80">The total charge sets the far-away behaviour: a net charge gives a 1/r² field, a dipole a 1/r³ field, and a quadrupole falls off faster still.</p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}