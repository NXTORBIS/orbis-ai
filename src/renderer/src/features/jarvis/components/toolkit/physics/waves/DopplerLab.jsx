import { Radio } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { dopplerSim } from './dopplerCore';

export default function DopplerLab() {
  return (
    <EngShell
      sim={dopplerSim}
      toolId="doppler-lab"
      icon={Radio}
      title="Doppler Effect Laboratory"
      desc="A moving source emits crests every 1/f seconds and they travel outwards at the speed of sound. Watch the crests bunch ahead of the source and stretch behind it, and read the frequency that actually arrives at the observer."
    >
      {({ params, readings: r, api }) => {
        const halfSpan = 60;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Observed frequency" value={((r.measured || r.observed) || 0).toFixed(1)} unit="Hz" sub={`emitted ${params.frequency} Hz · shift ${r.shift >= 0 ? '+' : ''}${r.shift.toFixed(1)} Hz`} tone={r.shift >= 0 ? 'cyan' : 'rose'} />
              <Stat label="Frequency ratio" value={`${r.ratio.toFixed(4)}×`} sub={r.ratio > 1 ? 'raised: source and observer closing' : r.ratio < 1 ? 'lowered: source and observer separating' : 'no relative motion along the line'} mono />
              <Stat label="Wavelength in the medium" value={`${r.wavelengthInMedium.toFixed(3)} m`} sub={`arrival spacing ${r.arrivalWavelength.toFixed(3)} m at the observer`} mono />
              <Stat label="Mach number" value={r.mach.toFixed(3)} sub={r.supersonic ? `shock cone half-angle ${r.machAngle.toFixed(1)}°` : 'slower than sound: no shock'} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Wavefronts, source and observer</h3>
              <Scene
                xDomain={[-halfSpan, halfSpan]}
                yDomain={[-halfSpan * 0.75, halfSpan * 0.75]}
                height={300}
                xLabel="distance (m)"
                ariaLabel="Expanding wavefronts from a moving source with the observer"
                series={r.supersonic ? [
                  { points: [{ x: r.sourceX - 24, y: Math.tan((r.machAngle * Math.PI) / 180) * -24 }, { x: r.sourceX, y: 0 }, { x: r.sourceX - 24, y: Math.tan((r.machAngle * Math.PI) / 180) * 24 }], tone: 'rose', width: 1.8, dashed: true },
                ] : []}
                circles={[
                  ...r.crests.map((crest, i) => ({ x: crest.x, y: 0, r: crest.r, tone: i === r.crests.length - 1 ? 'cyan' : 'muted', fill: 'none', fillOpacity: 0, width: i === r.crests.length - 1 ? 1.8 : 1 })),
                  { x: r.sourceX, y: 0, r: 2.2, tone: 'amber', fill: 'amber', fillOpacity: 0.95 },
                  { x: r.observerX, y: 0, r: 2.2, tone: 'violet', fill: 'violet', fillOpacity: 0.95 },
                ]}
                texts={[
                  { x: -halfSpan * 0.95, y: halfSpan * 0.62, text: `source ${r.approachingSource ? 'approaching' : r.sourceSpeed === 0 ? 'stationary' : 'receding'} · observer ${r.recedingObserver ? 'receding' : r.observerSpeed === 0 ? 'stationary' : 'approaching'}` },
                  { x: -halfSpan * 0.95, y: halfSpan * 0.5, text: `crest spacing ahead ${r.gapAhead.toFixed(2)} m · behind ${r.gapBehind.toFixed(2)} m` },
                ]}
              />
              <p className="text-[11px] text-muted-foreground/80">Each ring is one emitted crest. Crowding on one side is the whole Doppler effect: more crests reach the observer per second on the crowded side and fewer on the stretched side.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">Frequency actually arriving</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'measured', label: 'observed (Hz)' }, { key: 'ratio', label: 'ratio ×100', tone: 'violet' }]} yLabel="Hz" height={200} />
                <p className="text-[11px] text-muted-foreground/80">The measured curve is timed from crest arrivals, not from the formula, so it settles onto the analytic value once the crests have crossed the gap.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The formula in numbers</h3>
                <Stat label="Observed frequency" value={`${r.observed.toFixed(2)} Hz`} sub="f (c − v_obs)/(c − v_source)" mono />
                <Stat label="Source speed" value={`${r.sourceSpeed.toFixed(0)} m/s`} sub={r.approachingSource ? 'towards the observer' : 'away from the observer'} mono />
                <Stat label="Observer speed" value={`${r.observerSpeed.toFixed(0)} m/s`} sub={r.recedingObserver ? 'receding' : 'approaching'} mono />
                <Stat label="Speed of sound" value={`${params.soundSpeed} m/s`} sub={`Mach ${r.mach.toFixed(3)}`} mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}