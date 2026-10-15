import { Compass } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { relativeSim } from './relativeCore';

export default function RelativeLab() {
  return (
    <EngShell
      sim={relativeSim}
      toolId="relative-motion-lab"
      icon={Compass}
      title="Relative Motion & Reference Frames"
      desc="Steer a swimmer across a moving river, or walk through falling rain, and see the same event described in the water frame and the ground frame — with crossing time, drift and the best heading computed from the velocity triangle."
    >
      {({ params, readings: r, api }) => (r.mode === 'rain' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Apparent rain speed" value={r.apparentSpeed.toFixed(2)} unit="m/s" sub={`true fall speed ${r.trueSpeed.toFixed(1)} m/s`} />
            <Stat label="Tilt from vertical" value={`${r.tilt.toFixed(1)}°`} sub={`atan(u/v) = ${((Math.atan2(r.observerSpeed, r.trueSpeed) * 180) / Math.PI).toFixed(1)}°`} mono />
            <Stat label="Observer speed" value={`${r.observerSpeed.toFixed(1)} m/s`} sub={r.observerSpeed === 0 ? 'standing still: rain looks vertical' : 'walking through the shower'} mono />
            <Stat label="Relative velocity components" value={`(${r.rx.toFixed(1)}, ${r.ry.toFixed(1)}) m/s`} sub="rain velocity minus observer velocity" mono />
          </div>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Rain in the ground frame and the observer’s frame</h3>
            <Scene
              xDomain={[-12, 12]}
              yDomain={[0, 14]}
              height={260}
              ariaLabel="Rain streaks tilting according to the observer's motion"
              series={Array.from({ length: 9 }, (_, i) => {
                const x = -11 + i * 2.75;
                return { points: [{ x, y: 13 }, { x: x - r.rx * 0.35, y: 13 + r.ry * 0.35 }], tone: 'muted', width: 1.1, dashed: true };
              })}
              arrows={[
                { x: 0, y: 7, dx: r.rx * 0.7, dy: r.ry * 0.7, tone: 'cyan', label: 'apparent' },
                { x: 0, y: 7, dx: 0, dy: -r.trueSpeed * 0.5, tone: 'muted', label: 'true fall' },
              ]}
              markers={[{ x: 0, y: 1, tone: 'amber', label: 'observer' }]}
              polys={[{ points: [{ x: -0.6, y: 0 }, { x: 0.6, y: 0 }, { x: 0.45, y: 1.8 }, { x: -0.45, y: 1.8 }], tone: 'amber', fill: 'amber', fillOpacity: 0.25 }]}
              texts={[{ x: -11, y: 13.6, text: 'dashed streaks: apparent path of the rain · cyan: velocity relative to the observer' }]}
            />
          </Panel>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Crossing time" value={Number.isFinite(r.time) ? r.time.toFixed(2) : '∞'} unit="s" sub={`width ${params.width} m at ${r.across.toFixed(2)} m/s across`} />
            <Stat label="Downstream drift" value={`${r.drift.toFixed(2)} m`} sub={`ground speed ${r.ground.toFixed(2)} m/s`} mono />
            <Stat label="Best heading" value={`${r.bestHeading.toFixed(1)}°`} sub={`minimum drift ${r.bestDrift.toFixed(2)} m${Number.isFinite(r.bestTime) ? ` · ${r.bestTime.toFixed(1)} s` : ''}`} mono />
            <Stat label="Progress across" value={`${(r.fraction * 100).toFixed(0)}%`} sub={`${r.y.toFixed(1)} m of ${params.width} m`} mono />
          </div>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">River, swimmer and the velocity triangle</h3>
            <Scene
              xDomain={[-params.width * 0.5, Math.max(20, r.pathEnd.x * 1.3, params.width * 0.6)]}
              yDomain={[-4, params.width * 1.08]}
              height={290}
              xLabel="downstream (m)"
              yLabel="across (m)"
              ariaLabel="Swimmer crossing a river with current and velocity vectors"
              bands={[{ x0: -params.width * 0.5, x1: Math.max(20, r.pathEnd.x * 1.3, params.width * 0.6), tone: 'cyan', opacity: 0.06 }]}
              series={[
                { points: r.track, tone: 'cyan', width: 2.4 },
                { points: [{ x: r.pathEnd.x, y: 0 }, { x: r.pathEnd.x, y: params.width }], tone: 'emerald', width: 1.4, dashed: true },
                { points: [{ x: 0, y: 0 }, { x: 0, y: params.width }], tone: 'muted', width: 1.2, dashed: true },
              ]}
              arrows={[
                { x: r.s, y: r.y, dx: params.swim * Math.sin((params.heading * Math.PI) / 180) * 6, dy: params.swim * Math.cos((params.heading * Math.PI) / 180) * 6, tone: 'violet', label: 'swim' },
                { x: r.s, y: r.y, dx: params.current * 6, dy: 0, tone: 'rose', label: 'current' },
                { x: r.s, y: r.y, dx: r.along * 6, dy: r.across * 6, tone: 'amber', label: 'ground' },
              ]}
              circles={[{ x: r.s, y: r.y, r: params.width * 0.02, tone: 'cyan', fill: 'cyan', fillOpacity: 0.9 }]}
              texts={[
                { x: -params.width * 0.45, y: params.width * 1.02, text: 'dashed lines: straight across and the drift-corrected route' },
                { x: 2, y: -2, text: 'upstream is to the left' },
              ]}
            />
          </Panel>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Track recorded so far</h3>
            <HistoryPlot
              history={api.history}
              defs={[{ key: 'y', label: 'across (m)' }, { key: 's', label: 'downstream (m)', tone: 'rose' }]}
              yLabel="distance (m)"
              height={180}
            />
            <p className="text-[11px] text-muted-foreground/80">The across-river curve is straight because the swimmer’s velocity is constant; the downstream curve shows the drift accumulating at the current’s rate.</p>
          </Panel>
        </>
      ))}
    </EngShell>
  );
}