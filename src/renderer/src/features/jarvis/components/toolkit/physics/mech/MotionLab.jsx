import { Activity } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { motionSim, accelAt } from './motionCore';

export default function MotionLab() {
  return (
    <EngShell
      sim={motionSim}
      toolId="motion-lab"
      icon={Activity}
      title="One-Dimensional Motion Laboratory"
      desc="Set the initial position, velocity and acceleration model, then watch the object move while position, velocity, acceleration and energy are measured and the three graphs are built from the motion itself."
    >
      {({ params, readings: r, api }) => {
        const span = Math.max(4, Math.abs(r.x - params.x0) * 1.4, Math.abs(params.x0) * 1.2);
        const low = Math.min(params.x0, r.x) - span * 0.15;
        const domain = [low, low + span];
        const arrowScale = Math.min(2, span / 12);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Position" value={r.x.toFixed(2)} unit="m" sub={`x₀ = ${params.x0} m · ${r.displacement >= 0 ? 'ahead' : 'behind'} start by ${Math.abs(r.displacement).toFixed(2)} m`} />
              <Stat label="Velocity" value={`${r.v.toFixed(3)} m/s`} sub={r.turning ? 'turning point — velocity crossing zero' : `average so far ${r.averageVelocity.toFixed(3)} m/s`} mono />
              <Stat label="Acceleration" value={`${r.a.toFixed(3)} m/s²`} sub={`${accelAt(params, r.t) >= 0 ? 'speeding up along +x' : 'acting along −x'}`} mono />
              <Stat label="Kinetic energy" value={`${r.kinetic.toFixed(3)} J`} sub={`momentum ${r.momentum.toFixed(3)} kg·m/s`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">The motion on the line</h3>
              <Scene
                xDomain={domain}
                yDomain={[0, 1]}
                height={140}
                xLabel="position (m)"
                ariaLabel="Object moving along a line with velocity and acceleration arrows"
                series={[{ points: [{ x: domain[0], y: 0.42 }, { x: domain[1], y: 0.42 }], tone: 'border', width: 1.5 }]}
                bands={[{ x0: params.x0 - 0.06, x1: params.x0 + 0.06, tone: 'muted', opacity: 0.6 }]}
                arrows={[
                  { x: r.x, y: 0.42, dx: r.v * arrowScale, dy: 0, tone: 'cyan', label: `v ${r.v.toFixed(2)} m/s` },
                  { x: r.x, y: 0.68, dx: r.a * arrowScale, dy: 0, tone: 'rose', label: `a ${r.a.toFixed(2)} m/s²` },
                ]}
                circles={[{ x: r.x, y: 0.42, r: 0.16, tone: 'cyan', fill: 'cyan', fillOpacity: 0.85 }]}
                texts={[{ x: params.x0, y: 0.2, text: 'start', anchor: 'middle' }]}
              />
              <p className="text-[11px] text-muted-foreground/80">The cyan marker is the object; the arrow lengths are proportional to velocity and acceleration. The dashed line marks the starting position.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Position against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'x', label: 'x (m)' }]} yLabel="position (m)" height={190} />
                <p className="text-[11px] text-muted-foreground/80">The slope of this curve is the velocity — {r.v.toFixed(3)} m/s at the moment shown.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Velocity against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'v', label: 'v (m/s)' }]} yLabel="velocity (m/s)" height={190} />
                <p className="text-[11px] text-muted-foreground/80">The slope is the acceleration and the signed area under the curve is the displacement, {r.displacement.toFixed(3)} m so far.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Acceleration against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'a', label: 'a (m/s²)', tone: 'rose' }]} yLabel="acceleration (m/s²)" height={190} />
                <p className="text-[11px] text-muted-foreground/80">{params.mode === 'constant' ? 'Constant acceleration gives a horizontal line, so velocity changes linearly.' : params.mode === 'jerk' ? 'A sloping line: the acceleration itself changes at the jerk rate.' : 'The acceleration oscillates, so velocity alternates between speeding up and slowing down.'}</p>
              </Panel>
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Kinetic energy against time</h3>
              <HistoryPlot history={api.history} defs={[{ key: 'ke', label: 'K (J)', tone: 'amber' }]} yLabel="kinetic energy (J)" height={160} />
            </Panel>
          </>
        );
      }}
    </EngShell>
  );
}