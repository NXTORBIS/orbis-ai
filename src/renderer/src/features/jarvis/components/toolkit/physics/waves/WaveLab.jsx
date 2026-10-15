import { Waves } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { waveSim } from './waveCore';

export default function WaveLab() {
  return (
    <EngShell
      sim={waveSim}
      toolId="wave-lab"
      icon={Waves}
      title="Mechanical Waves & Sound Laboratory"
      desc="Add two travelling waves and watch them interfere, hold a string at its resonances, listen to the beats between two close frequencies, and compare the harmonic series of strings and air columns."
    >
      {({ params, readings: r }) => {
        const isBeats = params.mode === 'beats';
        const span = isBeats ? Math.max(2, r.profile[r.profile.length - 1]?.x || 2) : params.length;
        const amplitude = params.mode === 'superposition' ? params.amplitude + params.amplitude2 : 2 * params.amplitude;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label={isBeats ? 'Beat frequency' : 'Phase speed'} value={isBeats ? r.beatFrequency.toFixed(3) : r.phaseSpeed.toFixed(3)} unit={isBeats ? 'Hz' : 'm/s'} sub={isBeats ? `envelope repeats every ${Number.isFinite(r.envelopePeriod) ? r.envelopePeriod.toFixed(2) : '—'} s` : 'v = fλ from the drawn wave'} />
              <Stat label="Harmonic frequency" value={`${r.harmonicFrequency.toFixed(2)} Hz`} sub={`wavelength ${r.harmonicWavelength.toFixed(3)} m`} mono />
              <Stat label="String fundamental" value={`${r.stringFundamental.toFixed(2)} Hz`} sub={`speed √(T/μ) = ${r.stringSpeed.toFixed(2)} m/s`} mono />
              <Stat label="Air column fundamentals" value={`${r.openPipeFundamental.toFixed(1)} / ${r.closedPipeFundamental.toFixed(1)} Hz`} sub="open at both ends / closed at one end" mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{isBeats ? 'Beats at a fixed point' : 'The wave on the medium'}</h3>
              <Scene
                xDomain={[0, span]}
                yDomain={[-amplitude * 1.15, amplitude * 1.15]}
                height={280}
                xLabel={isBeats ? 'time (s)' : 'distance along the medium (m)'}
                yLabel="displacement (m)"
                ariaLabel="Wave profile with nodes, component waves and the superposed shape"
                series={[
                  ...(params.mode === 'superposition'
                    ? [
                      { points: r.first, tone: 'muted', width: 1.4, dashed: true },
                      { points: r.second, tone: 'violet', width: 1.4, dashed: true },
                    ]
                    : []),
                  { points: r.profile, tone: 'cyan', width: 2.4 },
                ]}
                markers={(params.mode === 'standing' || params.mode === 'harmonics')
                  ? r.nodes.slice(0, 12).map((node) => ({ x: node, y: 0, tone: 'amber', r: 2.6, label: node === r.nodes[0] ? 'nodes' : '' }))
                  : []}
                texts={[
                  { x: span * 0.02, y: amplitude * 1.02, text: params.mode === 'superposition' ? 'dashed: the two waves · solid: their sum' : params.mode === 'standing' ? `fixed string · λ = ${params.wavelength} m` : params.mode === 'beats' ? `f₁ = ${params.frequency} Hz, f₂ = ${params.frequency2} Hz` : `${params.source === 'string' ? 'stretched string' : 'air column'} · harmonic ${params.harmonic}` },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Harmonics available</h3>
                <div className="space-y-1">
                  {Array.from({ length: 6 }, (_, i) => {
                    const n = i + 1;
                    const value = params.source === 'string'
                      ? (n / (2 * params.length)) * Math.sqrt(params.tension / params.density)
                      : (n * params.soundSpeed) / (params.pipe === 'both-open' ? 2 * params.length : 4 * params.length);
                    const missing = params.source === 'pipe' && params.pipe === 'one-closed' && n % 2 === 0;
                    return (
                      <div key={n} className="flex items-center justify-between gap-2 text-xs">
                        <span className={missing ? 'text-muted-foreground/60 line-through' : 'text-foreground'}>harmonic {n}</span>
                        <span className="font-mono-j">{value.toFixed(2)} Hz</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground/80">{params.source === 'pipe' && params.pipe === 'one-closed' ? 'A closed pipe has a node at the closed end and an antinode at the open end, so only odd harmonics fit.' : 'Every harmonic fits, and the series is 1 : 2 : 3 for the open pipe and the string.'}</p>
              </Panel>
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">What the experiment shows</h3>
                <Stat label="Nodes" value={r.nodes.length ? r.nodes.map((n) => n.toFixed(2)).join(' · ') + ' m' : 'none in this mode'} sub="points that never move" mono />
                <Stat label="Beat period" value={Number.isFinite(r.envelopePeriod) ? `${r.envelopePeriod.toFixed(3)} s` : '—'} sub="time between successive loud-and-quiet cycles" mono />
                <Stat label="Crest spacing" value={`${(r.harmonicWavelength).toFixed(3)} m`} sub={params.mode === 'standing' ? 'equal to the standing-wave wavelength' : 'wavelength of the drawn harmonic'} mono />
                <p className="text-[11px] text-muted-foreground/80">Superposition is drawn point by point, which is why the solid curve is exactly the sum of the dashed pair and why, at two equal waves travelling opposite ways, the nodes stand still.</p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}