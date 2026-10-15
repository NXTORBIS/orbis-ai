import { Radio } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import HistoryPlot from '@jarvis/components/toolkit/physics/HistoryPlot';
import { resonanceSim, amplitudeAt, response } from './resonanceCore';

export default function ResonanceLab() {
  return (
    <EngShell
      sim={resonanceSim}
      toolId="driven-oscillator"
      icon={Radio}
      title="Driven Oscillator & Resonance"
      desc="Push a damped mass-spring with a sinusoidal force and sweep the driving frequency. The response curve, the phase lag and the power balance update with the damping, and the animation shows the transient ringing up towards the steady state."
    >
      {({ params, readings: r, api }) => {
        const sweep = Array.from({ length: 120 }, (_, i) => {
          const omega = 0.1 + (i / 119) * 12;
          return { x: omega, y: amplitudeAt(params, omega) };
        });
        const phaseSweep = Array.from({ length: 120 }, (_, i) => {
          const omega = 0.1 + (i / 119) * 12;
          const stiffness = params.stiffness - params.mass * omega * omega;
          return { x: omega, y: (Math.atan2(params.damping * omega, stiffness) * 180) / Math.PI };
        });
        const phasePath = api.history.xs.map((x, i) => ({ x: api.history.data.drive?.[i] ?? 0, y: api.history.data.x?.[i] ?? 0 }));
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Response amplitude" value={r.amplitude.toFixed(4)} unit="m" sub={`measured envelope ${r.measuredAmplitude.toFixed(4)} m`} tone={r.nearResonance ? 'amber' : 'cyan'} />
              <Stat label="Phase lag" value={`${r.phaseDegrees.toFixed(1)}°`} sub={r.phaseDegrees < 89 ? 'stiffness controlled' : r.phaseDegrees < 91 ? 'at resonance: a quarter cycle behind' : 'mass controlled'} mono />
              <Stat label="Natural frequency" value={`${r.omega0.toFixed(3)} rad/s`} sub={`peak at ${r.peakFrequency.toFixed(3)} rad/s · ζ = ${r.zeta.toFixed(4)}`} mono />
              <Stat label="Quality factor" value={r.quality.toFixed(2)} sub={`bandwidth ${r.bandwidth.toFixed(3)} rad/s`} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Response across frequency</h3>
                <ScientificPlot
                  series={[{ label: 'amplitude (m)', points: sweep }, { label: 'operating point', points: [{ x: params.driveFrequency, y: r.amplitude }] }]}
                  xLabel="driving frequency (rad/s)"
                  yLabel="amplitude (m)"
                  height={240}
                />
                <p className="text-[11px] text-muted-foreground/80">The operating point rides the curve as you sweep ω. Lower the damping to sharpen the peak: at ζ = {r.zeta.toFixed(4)} the magnification is {r.gain.toFixed(2)}× the static response.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Phase lag across frequency</h3>
                <ScientificPlot series={[{ label: 'phase (°)', points: phaseSweep }]} xLabel="driving frequency (rad/s)" yLabel="lag (°)" height={240} />
                <p className="text-[11px] text-muted-foreground/80">The lag passes through 90° exactly at the natural frequency {r.omega0.toFixed(3)} rad/s, where the drive and the motion are a quarter cycle apart.</p>
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">Displacement and driving force</h3>
                <HistoryPlot history={api.history} defs={[{ key: 'x', label: 'x (m)' }, { key: 'drive', label: 'F (N)', tone: 'rose' }, { key: 'envelope', label: 'envelope (m)', tone: 'amber' }]} yLabel="m / N" height={210} />
                <p className="text-[11px] text-muted-foreground/80">Where the two curves cross peak together the drive is doing positive work every cycle; the envelope rises while the transient is being built and flattens once the energy in per cycle matches the energy lost to damping.</p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Power and energy</h3>
                <Stat label="Average drive power" value={`${r.drivePower.toFixed(4)} W`} sub={`damping power ${r.dampingPower.toFixed(4)} W`} mono />
                <Stat label="Static response" value={`${r.staticAmplitude.toFixed(4)} m`} sub={`F₀/k at zero frequency`} mono />
                <Stat label="Dynamic magnification" value={`${r.dynamicMagnification.toFixed(3)}×`} sub="amplitude divided by the static response" mono />
                <Stat label="Stored energy" value={`${(r.kinetic + r.potential).toFixed(4)} J`} sub={`kinetic ${r.kinetic.toFixed(4)} · spring ${r.potential.toFixed(4)}`} mono />
              </Panel>
            </div>

            {phasePath.length > 3 && (
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Displacement against driving force</h3>
                <ScientificPlot series={[{ label: 'force against displacement', points: phasePath }]} xLabel="driving force (N)" yLabel="displacement (m)" height={240} />
                <p className="text-[11px] text-muted-foreground/80">Off resonance this trace is a tilted ellipse; at resonance it opens into a circle, which is the geometric statement that the motion lags the force by a quarter cycle.</p>
              </Panel>
            )}
          </>
        );
      }}
    </EngShell>
  );
}