import { Thermometer } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { statmechSim } from './statmechCore';

const KB = 1.380649e-23;

export default function StatMechLab() {
  return (
    <EngShell
      sim={statmechSim}
      toolId="statistical-mechanics"
      icon={Thermometer}
      title="Statistical Mechanics & Entropy"
      desc="Where thermodynamics comes from: a Boltzmann distribution over quantum states, the partition function built from it, entropy counted both from that function and from the probabilities themselves, and heat capacity obtained both in closed form and by differentiating the mean energy. Includes the Schottky anomaly, the freeze-out of vibrations and a chemical equilibrium."
    >
      {({ params, readings: r }) => {
        const isLevel = params.system === 'two-level';
        const isOscillator = params.system === 'oscillator';
        const isGas = params.system === 'gas';
        const isEquilibrium = params.system === 'equilibrium';
        const curveTop = Math.max(...r.curve.map((point) => Math.abs(point.y)), 1e-9);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={isEquilibrium ? 'Equilibrium constant K' : 'Entropy'}
                value={isEquilibrium ? r.k.toExponential(4) : `${(r.entropy / KB).toFixed(3)} k`}
                unit=""
                sub={isEquilibrium
                  ? `ΔG° = ${(r.deltaG / 1000).toFixed(2)} kJ/mol at ${params.temperature} K`
                  : `${(r.entropy * 6.022e23).toFixed(3)} J/mol·K · the same number from ⟨ln Z + βE⟩ and from −Σp ln p`}
                tone={isEquilibrium ? 'emerald' : 'cyan'}
              />
              <Stat
                label={isEquilibrium ? 'ΔG°, ΔH°, ΔS°' : 'Mean energy per particle'}
                value={isEquilibrium ? `${(r.deltaG / 1000).toFixed(2)} kJ/mol` : isLevel ? `${(r.mean / 1.602e-22).toFixed(3)} meV` : isOscillator ? `${((r.mean * 6.022e23) / 1000).toFixed(2)} kJ/mol` : `${r.mean.toExponential(3)} J`}
                sub={isEquilibrium ? `${params.enthalpy} kJ/mol and ${params.entropyChange} J/mol·K` : isLevel ? `Δ/kT = ${r.x.toFixed(3)}, so ${(r.p1 * 100).toFixed(1)}% of the atoms sit in the excited level` : 'from the partition function'}
                mono
              />
              <Stat
                label={isEquilibrium ? 'Temperature where ΔG° crosses zero' : 'Heat capacity'}
                value={isEquilibrium ? `${(r.crossing || 0).toFixed(1)} K` : `${(r.heat / KB).toFixed(4)} k`}
                sub={isEquilibrium ? 'above this the entropy term takes over' : `closed form and d⟨E⟩/dT agree to ${(Math.abs(r.entropyDifference) < 1e-9 ? '1e-9' : 'measurement')}`}
                mono
              />
              <Stat
                label={isEquilibrium ? 'Turns into entropy at this temperature' : isLevel ? 'Population of the ground state' : isGas ? 'Thermal de Broglie wavelength' : 'Classical limit'}
                value={isEquilibrium ? `${(r.entropy).toFixed(1)} J/K` : isLevel ? `${(r.groundFraction * 100).toFixed(2)}%` : isGas ? `${(r.lambda * 1e12).toFixed(2)} pm` : `C → ${r.limit} k`}
                sub={isEquilibrium ? 'from ΔG°/T over the whole reaction' : isLevel ? `the excited level holds the other ${((1 - r.groundFraction) * 100).toFixed(2)}%` : isGas ? 'the quantum size of one particle’s wavepacket' : 'the value equipartition predicts at high temperature'}
                mono
              />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{isLevel ? 'The Schottky anomaly: heat capacity of a two-level system' : isOscillator ? 'How an oscillator’s heat capacity freezes out' : isGas ? 'How an ideal gas entropy grows with temperature' : 'The equilibrium constant against temperature'}</h3>
              <Scene
                xDomain={[r.curve[0].x, r.curve.at(-1).x]}
                yDomain={isLevel || isOscillator || !isEquilibrium ? [0, curveTop * 1.12] : [0, Math.max(...r.curve.map((point) => point.y)) * 1.2]}
                height={300}
                xLabel="temperature (K)"
                yLabel={isLevel || isOscillator ? 'heat capacity per particle (k)' : isGas ? 'entropy per particle (k)' : 'equilibrium constant'}
                ariaLabel="A thermodynamic quantity plotted against temperature"
                series={[{ points: r.curve, tone: isEquilibrium ? 'emerald' : 'cyan', width: 2.2, fill: isEquilibrium ? 'emerald' : 'cyan', fillOpacity: 0.12 }]}
                markers={[{ x: params.temperature, y: isEquilibrium ? r.k : isLevel ? r.heat / KB : isOscillator ? r.heat / KB : r.entropy / (1e23 * KB) * 1e23 / 1e23, tone: 'amber', r: 3.6, label: `${params.temperature} K` }]}
                texts={[
                  { x: r.curve[0].x, y: curveTop * 1.06, text: isLevel ? 'a hump, not a monotonic rise: at low T there is not enough energy to excite, at high T both levels are equally full' : isOscillator ? 'quantised vibrations switch off at low temperature — the reason diamond holds almost no heat at room temperature' : isGas ? 'entropy per particle grows logarithmically once the thermal wavelength shrinks' : 'K = 1 exactly where the entropy term balances the enthalpy term' },
                ]}
              />
              {isLevel && <p className="text-[11px] text-muted-foreground/80">Peak located at {r.peakTemperature.toFixed(1)} K, where Δ/kT = {r.peakX.toFixed(3)} — the famous 0.417 Δ/k. Measuring that hump is how a level splitting is found in a laboratory.</p>}
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Partition function and probabilities</h3>
                <Stat label="Partition function Z" value={Number.isFinite(r.z) ? r.z.toExponential(4) : '—'} sub={isLevel ? '1 + exp(−Δ/kT)' : isOscillator ? '1/(1 − exp(−ħω/kT))' : 'states available per particle'} mono />
                {isLevel && (
                  <>
                    <Stat label="Ground population" value={`${(r.p0 * 100).toFixed(2)}%`} mono />
                    <Stat label="Excited population" value={`${(r.p1 * 100).toFixed(2)}%`} mono />
                  </>
                )}
                <Stat label="Helmholtz free energy" value={isLevel ? `${(r.freeEnergy * 6.022e23).toFixed(0)} J/mol` : `${(r.mean * 6.022e23).toFixed(0)} J/mol`} sub={isLevel ? 'F = −kT ln Z' : 'the energy tied up per mole at this temperature'} mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The two routes to entropy</h3>
                <Stat label="From the partition function" value={`${(r.entropy / KB).toFixed(5)} k`} sub="k(ln Z + β⟨E⟩)" mono />
                <Stat label="From the probabilities" value={`${(r.shannon / KB).toFixed(5)} k`} sub="−k Σ p ln p, counted state by state" mono />
                <Stat label="Difference between them" value={`${Math.abs(r.entropyDifference).toExponential(2)}`} sub="they must agree — that agreement is the bridge from microstates to the second law" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The physics in one paragraph</h3>
                <p className="text-[11px] text-muted-foreground/80">
                  {isLevel && 'A spin, a defect, an atom with two magnetic states — anything with two close levels shows the same hump in its heat capacity. Nothing can be excited when kT is far below the gap, and nothing stands out when kT is far above it, so the heat capacity peaks somewhere in between and the position of that peak measures the gap.'}
                  {isOscillator && 'A quantised oscillator can only take energy in packets of ħω. When the temperature is high enough that kT dwarfs the packet, it behaves classically and contributes exactly k to the heat capacity, which is the law of Dulong and Petit. Cool it and the packets stop being affordable, so the heat capacity falls away to zero.'}
                  {isGas && 'For a gas, the count of available translational states rises as the volume divides by the cube of the thermal de Broglie wavelength. Entropy is the logarithm of that count, so it grows with volume and with temperature, and it is the sheer number of states rather than anything microscopic that makes a gas expand.'}
                  {isEquilibrium && 'Equilibrium is reached where the free energy is least, not where the energy is least. The enthalpy term wants to run one way and the entropy term the other; their competition gives K = exp(−ΔG°/RT), and the temperature at which ΔG° changes sign is where the balance tips.'}
                </p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}