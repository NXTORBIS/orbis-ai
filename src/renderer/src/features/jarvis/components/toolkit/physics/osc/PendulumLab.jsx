import { Compass } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { pendulumSim } from './pendulumCore';

export default function PendulumLab() {
  return (
    <EngShell
      sim={pendulumSim}
      toolId="pendulum-lab"
      icon={Compass}
      title="Pendulum Laboratory"
      desc="A point bob on a rod or a uniform rod on a pivot, integrated without the small-angle approximation. The period is measured from the swing itself, so the growth of the period with amplitude and the difference between a simple and a physical pendulum can both be seen."
    >
      {({ params, readings: r, api }) => {
        const L = params.length;
        const pivot = { x: 0, y: 3.0 };
        const bob = { x: pivot.x + L * Math.sin(r.theta), y: pivot.y - L * Math.cos(r.theta) };
        const rodEnd = params.mode === 'physical'
          ? { x: pivot.x + L * Math.sin(r.theta), y: pivot.y - L * Math.cos(r.theta) }
          : bob;
        const tangent = { x: Math.cos(r.theta), y: Math.sin(r.theta) };
        const radial = { x: Math.sin(r.theta), y: -Math.cos(r.theta) };
        const scale = L * 0.55;
        const xExtent = L * 1.25;
        const arc = Array.from({ length: 25 }, (_, i) => {
          const angle = (-Math.PI / 2) + (i / 24) * (r.theta + Math.PI / 2) * 2 - (r.theta > 0 ? 0 : (r.theta + Math.PI / 2) * 2) * 0;
          return { x: pivot.x + (L * 0.55) * Math.sin(angle), y: pivot.y - (L * 0.55) * Math.cos(angle) };
        });
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Measured period" value={r.measuredPeriod ? r.measuredPeriod.toFixed(3) : '—'} unit="s" sub={`2π√(I/mgd) = ${r.smallPeriod.toFixed(3)} s`} />
              <Stat label="Angle" value={`${r.degrees.toFixed(1)}°`} sub={`${r.omega.toFixed(3)} rad/s angular velocity`} mono />
              <Stat label="Period ratio" value={`${r.periodRatio.toFixed(4)} T₀`} sub={`amplitude correction ${r.amplitudeCorrection.toFixed(4)}`} mono />
              <Stat label="Energy" value={`${r.total.toFixed(4)} J`} sub={`kinetic ${r.kinetic.toFixed(4)} · potential ${r.potential.toFixed(4)} J`} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">The swing</h3>
                <Scene
                  xDomain={[-xExtent, xExtent]}
                  yDomain={[pivot.y - L * 1.15, pivot.y + 0.45]}
                  height={300}
                  ariaLabel="Pendulum swinging with velocity, tension and weight arrows"
                  series={[
                    { points: [{ x: pivot.x, y: pivot.y }, rodEnd], tone: params.mode === 'physical' ? 'cyan' : 'muted', width: params.mode === 'physical' ? 5 : 1.6 },
                    { points: arc, tone: 'border', width: 1, dashed: true },
                    { points: [{ x: pivot.x, y: pivot.y }, { x: pivot.x, y: pivot.y - L }], tone: 'muted', width: 1, dashed: true },
                  ]}
                  circles={[
                    { x: bob.x, y: bob.y, r: Math.max(0.06, L * 0.075), tone: 'cyan', fill: 'cyan', fillOpacity: 0.85 },
                    { x: pivot.x, y: pivot.y, r: Math.max(0.04, L * 0.04), tone: 'amber', fill: 'amber', fillOpacity: 0.9 },
                  ]}
                  arrows={[
                    { x: bob.x, y: bob.y, dx: tangent.x * r.omega * L * scale, dy: tangent.y * r.omega * L * scale, tone: 'violet', label: `v ${(r.omega * L).toFixed(2)} m/s` },
                    { x: bob.x, y: bob.y, dx: radial.x * (r.tension || 0) * 0.012, dy: radial.y * (r.tension || 0) * 0.012, tone: 'emerald', label: r.tension ? `T ${r.tension.toFixed(1)} N` : '' },
                    { x: bob.x, y: bob.y, dx: 0, dy: -params.mass * params.gravity * 0.02, tone: 'rose', label: 'mg' },
                  ]}
                  texts={[
                    { x: -xExtent * 0.95, y: pivot.y + 0.35, text: `${params.mode === 'physical' ? 'uniform rod on a pivot' : 'point bob'} · L = ${L} m · g = ${params.gravity} m/s²` },
                    { x: xExtent * 0.35, y: pivot.y + 0.35, text: `I = ${r.inertia.toFixed(4)} kg·m²` },
                  ]}
                />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Period and energy</h3>
                <Stat label="Small-angle period" value={`${r.smallPeriod.toFixed(3)} s`} sub={`ω₀ = ${r.omega0.toFixed(3)} rad/s`} mono />
                <Stat label="Moment of inertia" value={`${r.inertia.toFixed(4)} kg·m²`} sub={`centre of mass at ${r.com.toFixed(3)} m`} mono />
                <Stat label="Equivalent simple length" value={`${r.equivalentLength.toFixed(3)} m`} sub="I/(md) — same period as a simple pendulum of this length" mono />
                <Stat label="Restoring torque" value={`${r.restoreTorque.toFixed(3)} N·m`} sub="−mgd sin θ" mono />
                <Stat label="Tension in the rod" value={r.tension ? `${r.tension.toFixed(2)} N` : '—'} sub={r.tension ? `peak at the bottom ${r.lowestTension.toFixed(2)} N` : 'a rigid rod carries shear as well as tension'} mono />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">Angle and angular velocity</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'theta', label: 'θ (rad)' }, { key: 'omega', label: 'ω (rad/s)', tone: 'violet' }]} yLabel="rad / (rad·s⁻¹)" height={200} />
                <p className="text-[11px] text-muted-foreground/80">Large amplitudes stretch the oscillation away from a sine — the crests flatten and the period lengthens, which is what the amplitude series in the checks describes.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'energy', label: 'total (J)', tone: 'emerald' }]} yLabel="energy (J)" height={200} />
                <p className="text-[11px] text-muted-foreground/80">With the pivot damping at zero this is a flat line; raise it and the pendulum hands its energy to the pivot.</p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}