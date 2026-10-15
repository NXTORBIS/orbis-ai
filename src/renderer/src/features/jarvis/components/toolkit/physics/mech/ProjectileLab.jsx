import { Target } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { projectileSim } from './projectileCore';

export default function ProjectileLab() {
  return (
    <EngShell
      sim={projectileSim}
      toolId="drag-projectile"
      icon={Target}
      title="Projectile Motion with Air Resistance"
      desc="Launch at any speed, angle and height, then compare the flight against the exact drag-free prediction. Three drag laws are available, so the shortening of the range and the loss of energy can be measured rather than assumed."
    >
      {({ params, readings: r, api }) => {
        const path = api.history.xs.map((t, i) => ({ x: api.history.data.x?.[i] ?? 0, y: api.history.data.y?.[i] ?? 0 }));
        const xMax = Math.max(r.vacuumRange, r.range, 1) * 1.06;
        const yMax = Math.max(r.vacuumApex, r.apex, 1) * 1.12;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Range" value={r.range.toFixed(2)} unit="m" sub={`vacuum prediction ${r.vacuumRange.toFixed(2)} m`} />
              <Stat label="Apex height" value={`${r.apex.toFixed(2)} m`} sub={`vacuum ${r.vacuumApex.toFixed(2)} m`} mono />
              <Stat label="Flight time" value={`${r.flightTime.toFixed(2)} s`} sub={r.landed ? 'landed' : 'still airborne'} mono />
              <Stat label="Speed now" value={`${r.speed.toFixed(2)} m/s`} sub={`energy lost to drag ${r.energyLost.toFixed(2)} J`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Flight path against the drag-free prediction</h3>
              <Scene
                xDomain={[0, xMax]}
                yDomain={[0, yMax]}
                height={300}
                xLabel="downrange (m)"
                yLabel="height (m)"
                ariaLabel="Projectile trajectory with a comparison curve for motion without drag"
                series={[
                  { points: r.path, tone: 'muted', width: 1.6, dashed: true },
                  { points: path, tone: 'cyan', width: 2.4 },
                ]}
                markers={[
                  { x: r.apex ? r.range * 0 : r.x, y: r.apex, tone: 'amber', label: `apex ${r.apex.toFixed(1)} m` },
                  ...(r.landed ? [{ x: r.range, y: 0, tone: 'emerald', label: `range ${r.range.toFixed(1)} m` }] : []),
                ]}
                arrows={[
                  { x: r.x, y: r.y, dx: r.vx * 0.12, dy: r.vy * 0.12, tone: 'violet', label: `${r.speed.toFixed(1)} m/s` },
                ]}
                circles={[{ x: r.x, y: r.y, r: xMax * 0.008, tone: 'cyan', fill: 'cyan', fillOpacity: 0.9 }]}
                texts={[{ x: xMax * 0.02, y: yMax * 0.94, text: 'dashed: no drag · solid: simulated flight' }]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Height against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'y', label: 'height (m)' }]} yLabel="height (m)" height={210} />
                <p className="text-[11px] text-muted-foreground/80">Drag tilts the descent earlier and shortens the flight — the range falls by {r.rangePenalty.toFixed(1)}% against the vacuum prediction.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Mechanical energy against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'energy', label: 'E (J)', tone: 'amber' }]} yLabel="total energy (J)" height={210} />
                <p className="text-[11px] text-muted-foreground/80">{params.drag === 'none' ? 'With drag switched off the total is a horizontal line: energy is conserved.' : 'The downward slope is the work done against air resistance, which leaves the projectile as heat in the air.'}</p>
              </Panel>
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Speed against time</h3>
              <HistoryPlot history={api.history} defs={[{ key: 'speed', label: 'speed (m/s)', tone: 'violet' }]} yLabel="speed (m/s)" height={170} />
              <p className="text-[11px] text-muted-foreground/80">On the way up gravity and drag both oppose the motion; on the way down drag acts upwards, which is why the speed never returns to its launch value with drag switched on.</p>
            </Panel>
          </>
        );
      }}
    </EngShell>
  );
}