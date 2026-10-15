import { Mountain } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Bars } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { inclineSim } from './inclineCore';

const DEG = Math.PI / 180;

export default function InclineLab() {
  return (
    <EngShell
      sim={inclineSim}
      toolId="inclined-plane-forces"
      icon={Mountain}
      title="Inclined Plane & Friction Laboratory"
      desc="A block on a slope with static and kinetic friction and a force you apply along the plane. Watch the free-body diagram, the friction regime and the energy ledger change as the angle, the coefficients and the applied force are moved."
    >
      {({ params, readings: r, api }) => {
        const theta = params.angle * DEG;
        const slope = 12;
        const along = { x: Math.cos(theta), y: Math.sin(theta) };
        const normalDir = { x: -Math.sin(theta), y: Math.cos(theta) };
        const scale = 2.2 / Math.max(1, r.weight);
        const px = r.s * Math.cos(theta);
        const py = r.s * Math.sin(theta);
        const xMax = slope * Math.cos(theta) + 2;
        const yMax = Math.max(3, slope * Math.sin(theta) + 2);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Acceleration" value={r.acceleration.toFixed(3)} unit="m/s²" sub={r.state} tone={r.sliding ? 'amber' : 'emerald'} />
              <Stat label="Normal force" value={`${r.normal.toFixed(2)} N`} sub={`mg·cos θ = ${(r.weight * Math.cos(theta)).toFixed(2)} N`} mono />
              <Stat label="Friction" value={`${r.friction.toFixed(2)} N`} sub={`limit μs·N = ${r.staticLimit.toFixed(2)} N`} mono />
              <Stat label="Speed along the plane" value={`${r.v.toFixed(3)} m/s`} sub={`${r.s.toFixed(2)} m from the base · heat ${r.heat.toFixed(2)} J`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Free-body diagram on the slope</h3>
              <Scene
                xDomain={[-1.5, xMax]}
                yDomain={[-1.5, yMax]}
                height={300}
                xLabel="horizontal (m)"
                yLabel="height (m)"
                ariaLabel="Block on an inclined plane with weight, normal, friction and applied force arrows"
                polys={[
                  { points: [{ x: 0, y: 0 }, { x: slope * Math.cos(theta), y: 0 }, { x: slope * Math.cos(theta), y: slope * Math.sin(theta) }], tone: 'border', fill: 'card', fillOpacity: 0.5 },
                ]}
                arrows={[
                  { x: px, y: py, dx: 0, dy: -r.weight * scale, tone: 'rose', label: `mg ${r.weight.toFixed(0)} N` },
                  { x: px, y: py, dx: normalDir.x * r.normal * scale, dy: normalDir.y * r.normal * scale, tone: 'cyan', label: `N ${r.normal.toFixed(0)} N` },
                  { x: px, y: py, dx: along.x * r.friction * scale, dy: along.y * r.friction * scale, tone: 'violet', label: `f ${r.friction.toFixed(0)} N` },
                  ...(params.applied ? [{ x: px, y: py, dx: along.x * params.applied * scale, dy: along.y * params.applied * scale, tone: 'emerald', label: `F ${params.applied.toFixed(0)} N` }] : []),
                ]}
                circles={[{ x: px, y: py, r: 0.35, tone: params.applied ? 'emerald' : 'border', fill: 'foreground', fillOpacity: 0.25 }]}
                texts={[
                  { x: 0.3, y: 0.6, text: `${params.angle}°` },
                  { x: -1.3, y: yMax * 0.92, text: `friction limit μs·N = ${r.staticLimit.toFixed(1)} N · atan μs = ${r.criticalAngle.toFixed(1)}°` },
                ]}
              />
              <p className="text-[11px] text-muted-foreground/80">Arrow lengths share one scale. When the friction arrow has to exceed the μs·N limit the block breaks away and the arrow switches to the kinetic value μk·N opposing the motion.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Weight resolved along the plane</h3>
                <Bars
                  data={[
                    { label: 'mg sin θ', value: r.weightComponents.along },
                    { label: 'mg cos θ', value: r.weightComponents.normal },
                    { label: 'mg', value: r.weightComponents.total },
                  ]}
                  suffix=" N"
                  format={(v) => v.toFixed(1)}
                />
                <Stat label="Force needed to hold the block" value={`${r.requiredHoldForce.toFixed(2)} N`} sub="mg sin θ, before any friction allowance" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy ledger</h3>
                <Stat label="Kinetic energy" value={`${r.kineticEnergy.toFixed(3)} J`} mono />
                <Stat label="Height energy" value={`${r.potentialEnergy.toFixed(3)} J`} sub={`height gained ${r.height.toFixed(3)} m`} mono />
                <Stat label="Heat from friction" value={`${r.heat.toFixed(3)} J`} sub={`sliding distance ${r.slidingDistance.toFixed(3)} m`} mono />
                <Stat label="Work by the applied force" value={`${r.workApplied.toFixed(3)} J`} mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Friction regime</h3>
                <Stat label="State" value={r.state} sub={r.staysPut ? 'the driving force is inside the friction limit' : 'the driving force exceeds the limit, so kinetic friction sets in'} />
                <Stat label="Driving force along the plane" value={`${r.drive.toFixed(2)} N`} sub={`applied ${params.applied} N ${params.applied >= 0 ? 'up' : 'down'} the plane plus mg sin θ`} mono />
                <Stat label="Net force" value={`${r.net.toFixed(2)} N`} mono />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Motion along the plane</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'v', label: 'speed (m/s)' }, { key: 's', label: 'distance (m)', tone: 'violet' }]} yLabel="m / (m·s⁻¹)" height={200} />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'ke', label: 'kinetic (J)' }, { key: 'heat', label: 'friction heat (J)', tone: 'rose' }]} yLabel="energy (J)" height={200} />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}