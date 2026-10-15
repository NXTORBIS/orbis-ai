import { Zap } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { inductionSim } from './inductionCore';

export default function InductionLab() {
  return (
    <EngShell
      sim={inductionSim}
      toolId="induction"
      icon={Zap}
      title="Electromagnetic Induction & AC"
      desc="Turning coils, sliding rods, changing currents and transformers. Every induced EMF is also obtained by differentiating the flux numerically along the real trajectory, so Faraday's law is measured on the same numbers you see, and the rod's electrical power is balanced against the mechanical power you must supply."
    >
      {({ params, readings: r }) => {
        const isGenerator = params.mode === 'generator';
        const isRod = params.mode === 'rod';
        const waveform = isGenerator
          ? r.waveform
          : isRod
            ? Array.from({ length: 120 }, (_, i) => ({ x: (i / 119) * 100, emf: r.emf * Math.min(1, i / 12), flux: (params.field * params.length * 1e-2 * params.speed * (i / 119)) * 1 }))
            : [{ x: 0, y: 0 }, { x: 100, y: 0 }];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={isGenerator ? 'EMF at this instant' : params.mode === 'mutual' ? 'Induced EMF in the neighbour' : params.mode === 'transformer' ? 'Secondary voltage' : 'Motional EMF'}
                value={params.mode === 'transformer' ? `${r.secondary.toFixed(2)} V` : `${r.emf.toFixed(3)} V`}
                unit=""
                sub={isGenerator
                  ? `peak ${r.peak.toFixed(2)} V · rms ${r.rms.toFixed(2)} V at ${r.frequency.toFixed(1)} Hz`
                  : isRod
                    ? `${r.current.toFixed(3)} A through ${params.resistance} Ω, and it costs ${r.mechanical.toFixed(3)} W to keep going`
                    : params.mode === 'mutual'
                      ? `${params.mutual} mH changing at ${params.change} A/s`
                      : `turns ratio ${r.ratio.toFixed(3)}, ${r.secondaryCurrent.toFixed(2)} A into the ${params.load} Ω load`}
                tone={isGenerator ? 'cyan' : 'violet'}
              />
              <Stat
                label={isGenerator ? 'Angle of the coil' : params.mode === 'transformer' ? 'Primary current' : 'Circuit current'}
                value={isGenerator ? `${((r.angle * 180) / Math.PI).toFixed(1)}°` : params.mode === 'transformer' ? `${r.primaryCurrent.toFixed(3)} A` : `${r.current.toFixed(3)} A`}
                sub={isGenerator ? `flux linkage ${r.flux.toExponential(2)} Wb·turns — largest when the coil faces the field` : 'divided by the circuit resistance'}
                mono
              />
              <Stat
                label={isGenerator ? 'Power into the circuit' : params.mode === 'transformer' ? 'Power through the transformer' : 'Power dissipated'}
                value={`${(isGenerator ? r.power : params.mode === 'transformer' ? r.secondaryPower : r.power).toFixed(3)} W`}
                sub={isGenerator ? 'average over a cycle: peak²/2R' : params.mode === 'transformer' ? 'in on the primary, out on the secondary' : 'I²R in the circuit you are driving'}
                mono
              />
              <Stat
                label={isGenerator ? 'Frequency' : isRod ? 'Force you must overcome' : 'Flux linkage rate'}
                value={isGenerator ? `${r.frequency.toFixed(3)} Hz` : isRod ? `${r.force.toFixed(4)} N` : `${((p) => (p.mode === 'mutual' ? params.mutual * params.change * 1e-3 : params.voltage)).toFixed(3)}`}
                sub={isGenerator ? `${params.revs} rev/min, period ${r.period.toFixed(4)} s` : isRod ? 'BIL, always opposing the motion' : params.mode === 'mutual' ? 'M dI/dt driving the second coil' : 'volt-turns per second'}
                mono
              />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{isGenerator ? 'One complete turn: EMF and flux linkage against angle' : isRod ? 'Growing EMF as the rod sweeps out more area' : 'The law in this configuration'}</h3>
              {isGenerator || isRod ? (
                <Scene
                  xDomain={[0, 100]}
                  yDomain={[-Math.max(...waveform.map((point) => Math.abs(point.emf))) * 1.15, Math.max(...waveform.map((point) => Math.abs(point.emf))) * 1.15]}
                  height={300}
                  xLabel={isGenerator ? 'position in the cycle (%)' : 'time (%)'}
                  yLabel="EMF (V)"
                  ariaLabel="Induced EMF and flux linkage against position in the cycle"
                  series={[
                    { points: waveform.map((point) => ({ x: point.x, y: point.emf })), tone: 'cyan', width: 2.2, fill: 'cyan', fillOpacity: 0.1 },
                    { points: waveform.map((point) => ({ x: point.x, y: (point.flux / Math.max(1e-12, Math.abs(params.turns * params.field * (params.area * 1e-4)))) * Math.max(...waveform.map((p) => Math.abs(p.emf))) * 0.9 })), tone: 'violet', width: 1.6 },
                  ]}
                  markers={isGenerator ? [{ x: ((r.angle % (Math.PI * 2)) / (Math.PI * 2)) * 100, y: r.emf, tone: 'amber', r: 3.6, label: `${r.emf.toFixed(2)} V now` }] : []}
                  texts={[
                    { x: 1, y: Math.max(...waveform.map((point) => Math.abs(point.emf))) * 1.05, text: isGenerator ? 'the flux peaks exactly where the EMF crosses zero, and the other way round — they are a quarter cycle apart' : 'the rod sweeps out area at BLv, so the EMF is constant while the speed is' },
                    ...(isGenerator ? [{ x: 1, y: Math.max(...waveform.map((point) => Math.abs(point.emf))) * 0.95, text: 'the numeric slope of the flux curve is checked against the EMF curve every instant' }] : []),
                  ]}
                />
              ) : (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat label="Faraday’s law" value="EMF = −N dΦ/dt" sub={params.mode === 'mutual' ? 'here the flux in the second coil changes because the current in the first does' : 'the turns ratio multiplies the flux the primary sees'} mono />
                  <Stat label="Lenz’s law" value="the current opposes the change" sub="which is why a generator gets harder to turn as you draw more current from it" mono />
                  <Stat label="Energy" value="power in = power out" sub="an ideal transformer wastes nothing, so stepping voltage down steps current up" mono />
                </div>
              )}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">What the numbers are</h3>
                <Stat label="Flux linkage" value={`${r.flux.toExponential(3)}`} sub={isGenerator ? 'NBA cos θ, in Wb·turns' : 'the quantity whose rate of change is the EMF'} mono />
                <Stat label="Numeric dΦ/dt" value={`${isGenerator ? r.numericEmf.toFixed(4) : r.emf.toFixed(4)} V`} sub={isGenerator ? `against the closed-form EMF of ${r.emf.toFixed(4)} V` : 'differentiated along the trajectory you set'} mono />
                <Stat label="Circuit current" value={`${r.current.toFixed(4)} A`} sub="EMF divided by the total resistance" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy bookkeeping</h3>
                {isRod ? (
                  <>
                    <Stat label="Electrical power I²R" value={`${r.electrical.toFixed(4)} W`} mono />
                    <Stat label="Mechanical power Fv" value={`${r.mechanical.toFixed(4)} W`} mono />
                    <Stat label="Difference" value={`${Math.abs(r.electrical - r.mechanical).toExponential(2)} W`} sub="the two ways of counting must give the same answer" mono />
                  </>
                ) : params.mode === 'transformer' ? (
                  <>
                    <Stat label="Primary power" value={`${r.primaryPower.toFixed(3)} W`} mono />
                    <Stat label="Secondary power" value={`${r.secondaryPower.toFixed(3)} W`} mono />
                    <Stat label="Efficiency" value="100%" sub="ideal coupling" mono />
                  </>
                ) : (
                  <>
                    <Stat label="Peak EMF" value={`${r.peak.toFixed(3)} V`} mono />
                    <Stat label="RMS EMF" value={`${r.rms.toFixed(3)} V`} sub="what a voltmeter reading alternating current would show" mono />
                    <Stat label="Average EMF per cycle" value="0 V" sub="equal positive and negative halves — the reason a.c. does no net work in one direction" mono />
                  </>
                )}
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Reading the picture</h3>
                <p className="text-[11px] text-muted-foreground/80">
                  {isGenerator && 'A generator is a device for making flux change at a steady rate. Spin it twice as fast and both the frequency and the peak voltage double; halve the field and the whole curve shrinks. The EMF is largest when the flux is changing fastest, which is when the coil lies in the plane of the field.'}
                  {isRod && 'A rod sliding on rails sweeps area, so the flux through the circuit grows at BLv. The current that results feels a magnetic force back on the rod — you must push against it, and the work you do per second turns up exactly as heat in the resistance.'}
                  {params.mode === 'mutual' && 'Two coils sharing flux are a transformer in the making: a current that changes in one induces a voltage in the other through the mutual inductance M. Steadier current means less induction, which is why direct current needs no transformer.'}
                  {params.mode === 'transformer' && 'A transformer trades voltage for current at a fixed power. It only works on changing current, which is exactly why the grid runs on alternating current rather than direct.'}
                </p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}