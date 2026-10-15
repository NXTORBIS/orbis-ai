import { Activity } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Ring } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import { shmSim } from './shmCore';

export default function ShmLab() {
  return (
    <EngShell
      sim={shmSim}
      toolId="shm-lab"
      icon={Activity}
      title="Mass–Spring Oscillator Laboratory"
      desc="Set the mass, the spring stiffness, the damping and the starting conditions, then watch the spring stretch and compress while the period is measured from the motion, the energy ledger is kept and the phase-space path is traced."
    >
      {({ params, readings: r, api }) => {
        const stretch = Math.min(1.2, Math.abs(r.x)) * (r.x < 0 ? -1 : 1);
        const coils = Array.from({ length: 26 }, (_, i) => {
          const t = i / 25;
          const x = 1 + t * 6;
          const y = 2.4 + (i % 2 ? 0.22 : -0.22) * (1 + 0.5 * stretch);
          return { x, y };
        });
        const phase = api.history.xs.map((x, i) => ({ x: api.history.data.x?.[i] ?? 0, y: api.history.data.v?.[i] ?? 0 }));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Displacement" value={r.x.toFixed(3)} unit="m" sub={`amplitude so far ${Math.abs(r.peakX).toFixed(3)} m`} />
              <Stat label="Velocity" value={`${r.v.toFixed(3)} m/s`} sub={`acceleration ${r.a.toFixed(3)} m/s²`} mono />
              <Stat label="Measured period" value={`${r.measuredPeriod ? r.measuredPeriod.toFixed(3) : '—'} s`} sub={`2π√(m/k) = ${r.undampedPeriod.toFixed(3)} s`} mono />
              <Stat label="Energy" value={`${r.total.toFixed(4)} J`} sub={`kinetic ${r.kinetic.toFixed(4)} · spring ${r.potential.toFixed(4)} J`} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">The oscillator</h3>
                <Scene
                  xDomain={[-0.4, 9.4]}
                  yDomain={[0, 4.6]}
                  height={210}
                  ariaLabel="Mass on a spring stretching and compressing"
                  series={[
                    { points: coils, tone: 'cyan', width: 2 },
                    { points: [{ x: 1, y: 0.6 }, { x: 1, y: 4 }, { x: 0.85, y: 4 }, { x: 0.85, y: 0.6 }, { x: 1, y: 0.6 }], tone: 'border', width: 1.5 },
                    { points: [{ x: r.x * 4 + 7, y: 1.75 }, { x: r.x * 4 + 7, y: 3.05 }], tone: 'border', width: 1.2, dashed: true },
                    { points: [{ x: 7, y: 0.9 }, { x: 7, y: 3.9 }], tone: 'muted', width: 1, dashed: true },
                  ]}
                  polys={[{ points: [{ x: r.x * 4 + 6.45, y: 1.75 }, { x: r.x * 4 + 7.55, y: 1.75 }, { x: r.x * 4 + 7.55, y: 3.05 }, { x: r.x * 4 + 6.45, y: 3.05 }], tone: 'cyan', fill: 'cyan', fillOpacity: 0.3 }]}
                  arrows={[{ x: r.x * 4 + 7, y: 2.4, dx: r.v * 0.5, dy: 0, tone: 'violet', label: `v ${r.v.toFixed(2)} m/s` }]}
                  texts={[
                    { x: 0.2, y: 4.4, text: `k = ${params.stiffness} N/m · m = ${params.mass} kg · c = ${params.damping} N·s/m` },
                    { x: 5.2, y: 4.4, text: r.regime },
                  ]}
                />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Damping</h3>
                <Ring value={Math.min(1, r.zeta) * 100} max={100} label={`ζ = ${r.zeta.toFixed(3)}`} sub={`critical c = ${r.critical.toFixed(3)} N·s/m`} unit="of critical damping" />
                <Stat label="Angular frequency" value={`${r.omega0.toFixed(3)} rad/s`} sub={`damped ${r.omegaD.toFixed(3)} rad/s`} mono />
                <Stat label="Quality factor" value={r.quality.toFixed(2)} sub={`log decrement ${Number.isFinite(r.logDecrement) ? r.logDecrement.toFixed(4) : '—'}`} mono />
                <Stat label="Energy dissipated" value={`${r.dissipated.toFixed(4)} J`} sub={r.regime} mono />
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Displacement and velocity against time</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'x', label: 'x (m)' }, { key: 'v', label: 'v (m/s)', tone: 'violet' }]} yLabel="m / (m·s⁻¹)" height={210} />
                <p className="text-[11px] text-muted-foreground/80">Velocity peaks when the displacement passes through zero — the two curves are a quarter of a period apart.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy ledger</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'ke', label: 'kinetic (J)' }, { key: 'pe', label: 'spring (J)', tone: 'amber' }, { key: 'total', label: 'total (J)', tone: 'emerald' }, { key: 'heat', label: 'dissipated (J)', tone: 'rose' }]} yLabel="energy (J)" height={210} />
                <p className="text-[11px] text-muted-foreground/80">Kinetic and spring energy trade places twice per cycle; with damping the total slides into the dissipated curve, and without it the total is flat.</p>
              </Panel>
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Phase-space path</h3>
              {phase.length > 2
                ? <ScientificPlot series={[{ label: 'v against x', points: phase }]} xLabel="displacement (m)" yLabel="velocity (m/s)" height={230} />
                : <div className="grid h-32 place-items-center text-xs text-muted-foreground">Run the oscillator to trace the phase path.</div>}
              <p className="text-[11px] text-muted-foreground/80">An undamped oscillator circles the same ellipse for ever; damping spirals the path inwards towards the origin.</p>
            </Panel>
          </>
        );
      }}
    </EngShell>
  );
}