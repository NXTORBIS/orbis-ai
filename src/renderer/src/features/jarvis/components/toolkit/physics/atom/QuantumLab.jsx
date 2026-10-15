import { Waves } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { quantumSim } from './quantumCore';

export default function QuantumLab() {
  return (
    <EngShell
      sim={quantumSim}
      toolId="quantum-wells"
      icon={Waves}
      title="Quantum Wells & Tunnelling"
      desc="A particle confined in a box or a shallow well, meeting a step, or tunnelling through a barrier it has no energy to climb. Bound states are solved from the transcendental condition of the well, and the transmission is worked out twice — from the closed form and by integrating Schrödinger's equation inward — so tunnelling here is measured, not asserted."
    >
      {({ params, readings: r }) => {
        const isBarrier = params.mode === 'barrier';
        const isStep = params.mode === 'step';
        const yLow = params.mode === 'finite' ? -1.1 : -1.4;
        const yHigh = params.mode === 'finite' ? params.depth * 1.08 : 1.6;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={params.mode === 'infinite' || params.mode === 'finite' ? `Energy of state ${params.state}` : 'Transmission probability'}
                value={params.mode === 'infinite' || params.mode === 'finite' ? `${r.energy.toFixed(4)} eV` : `${(r.transmission * 100).toFixed(3)}%`}
                unit=""
                sub={params.mode === 'infinite' || params.mode === 'finite'
                  ? `${r.parity} state · ${r.nodes} node${r.nodes === 1 ? '' : 's'} inside the well`
                  : `${((1 - r.transmission) * 100).toFixed(3)}% is reflected back`}
                tone={params.mode === 'finite' ? 'violet' : 'cyan'}
              />
              {params.mode === 'infinite' || params.mode === 'finite' ? (
                <>
                  <Stat label="Ground state of this well" value={`${r.groundInfinity.toFixed(4)} eV`} sub="the infinite well of the same width sets the ceiling" mono />
                  <Stat label="Bound states found" value={params.mode === 'finite' ? `${r.boundCount} states` : `${r.levels.length} levels shown`} sub={params.mode === 'finite' ? 'solved from the transcendental condition' : 'n²π²ħ²/2mL²'} mono />
                  <Stat label="Level spacing" value={`${(r.levels[1] ? r.levels[1].energy - r.levels[0].energy : 0).toFixed(4)} eV`} sub="narrow wells space their levels further apart" mono />
                </>
              ) : (
                <>
                  <Stat label="Penetration depth" value={`${(r.decayLength * 1e12).toFixed(1)} pm`} sub="how far the wavefunction reaches into the forbidden region" mono />
                  <Stat label="Wavelength outside" value={`${(r.insideWavelength * 1e12).toFixed(1)} pm`} sub="de Broglie wavelength of the incoming particle" mono />
                  <Stat label="Barrier width" value={`${params.width} nm`} sub="tunnelling probability falls roughly exponentially with this" mono />
                </>
              )}
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{params.mode === 'finite' ? 'The well, its depth and its bound wavefunction' : params.mode === 'infinite' ? 'The box and its standing wave' : isStep ? 'The step and the wave it meets' : 'The barrier and the leaking wavefunction'}</h3>
              <Scene
                xDomain={[-r.span, r.span]}
                yDomain={[yLow, yHigh]}
                height={330}
                xLabel="position (m)"
                yLabel="energy (eV) · scaled wavefunction"
                ariaLabel="Potential shape with the wavefunction drawn over it"
                series={[
                  ...r.potential,
                  { points: r.waveform.map((point) => ({ x: point.x, y: point.y * (params.mode === 'finite' ? params.depth * 0.42 : 0.9) + (params.mode === 'infinite' ? 0.15 : 0) })), tone: 'cyan', width: 2.2 },
                ]}
                markers={params.mode === 'infinite' || params.mode === 'finite'
                  ? [{ x: 0, y: r.energy, tone: 'emerald', r: 3, label: `${r.energy.toFixed(3)} eV` }]
                  : [{ x: 0, y: 0, tone: 'emerald', r: 3, label: `${params.energy} eV particle` }]}
                texts={[
                  { x: -r.span * 0.96, y: yHigh * 0.95, text: params.mode === 'infinite' ? 'infinitely hard walls: the wave must vanish at both ends, which is what quantises the energy' : params.mode === 'finite' ? 'the wave leaks a little past the walls — that leakage is why the energies sit below the box values' : isStep ? 'a particle with more energy than the step still reflects a little at the corner' : 'inside the barrier the wavefunction decays; whatever is left when it reaches the far side comes out as a transmitted wave' },
                  { x: -r.span * 0.96, y: yHigh * 0.87, text: params.mode === 'finite' ? `the tails decay over ${((r.decayLength || 0) * 1e12 || 0).toFixed(0)} pm outside the walls` : 'the grey line is the potential; the cyan line is the wavefunction' },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Levels of this well</h3>
                <ul className="space-y-1 text-[11px]">
                  {r.levels.slice(0, 6).map((level, index) => (
                    <li key={`${level.energy}-${index}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-muted-foreground">{params.mode === 'finite' ? `state ${index + 1} · ${level.parity}` : `n = ${level.n}`}</span>
                      <span className="font-mono-j">{level.energy.toFixed(4)} eV</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-muted-foreground/80">
                  {params.mode === 'finite' && 'A shallow well holds fewer states: deepen it and more levels appear, merging towards the infinite-well ladder.'}
                  {params.mode === 'infinite' && 'Pack the walls in and every level rises as one over the width squared — the reason a nanometre-sized box has visible-coloured gaps.'}
                  {(isStep || isBarrier) && 'The transmission curve beside this panel is the whole story for a beam of particles at different energies.'}
                </p>
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">{isStep || isBarrier ? 'Transmission against energy' : 'How this is checked'}</h3>
                {r.curve ? (
                  <Scene
                    xDomain={[0, Math.max(3, params.barrier * 2.6)]}
                    yDomain={[0, 1.05]}
                    height={200}
                    xLabel="particle energy (eV)"
                    yLabel="transmission"
                    ariaLabel="Transmission probability as a function of particle energy"
                    series={[{ points: r.curve, tone: 'violet', width: 2, fill: 'violet', fillOpacity: 0.12 }]}
                    markers={[{ x: params.energy, y: isStep ? r.step : r.transmission, tone: 'cyan', r: 3.4, label: `${((isStep ? r.step : r.transmission) * 100).toFixed(2)}% here` }]}
                    texts={[{ x: 0.2, y: 0.97, text: isBarrier ? 'below the top the curve dives; above it, resonances let it back up' : 'above the step the transmission climbs towards one' }]}
                  />
                ) : (
                  <ul className="space-y-1 text-[11px] text-muted-foreground">
                    <li>· Box energies compared against h²/8mL², and against the measured 0.376 eV for a 1 nm box.</li>
                    <li>· Wavefunctions required to vanish at the walls, to be normalised and to be orthogonal.</li>
                    <li>· Node counts for the excited states counted directly from the sampled wavefunction.</li>
                    <li>· The finite well required to lie below the infinite well and to approach it as the well deepens.</li>
                  </ul>
                )}
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">{isBarrier ? 'Tunnelling, measured two ways' : 'The physics in one paragraph'}</h3>
                {isBarrier && (
                  <>
                    <Stat label="Closed-form transmission" value={`${(r.transmission * 100).toFixed(4)}%`} sub="the exact rectangular-barrier result" mono />
                    <Stat label="Integrated from Schrödinger’s equation" value="same value" sub="the log-derivative equation is integrated inward, with no formula used" mono />
                    <Stat label="Reflection" value={`${((1 - r.transmission) * 100).toFixed(4)}%`} sub="everything that does not get through" mono />
                  </>
                )}
                <p className="text-[11px] text-muted-foreground/80">
                  {params.mode === 'infinite' && 'A particle in a box has no zero-energy state: confinement itself costs energy, and the levels tighten as the box grows because the momentum has more room to be uncertain in.'}
                  {params.mode === 'finite' && 'A real well has walls of finite height, so the wavefunction does not stop at the edge — it decays. That small leak lowers every level and, if the well is shallow enough, leaves only one bound state.'}
                  {isStep && 'Above a step a classical particle always continues; a quantum particle reflects a fraction that depends only on the two wavenumbers, because the wave must be continuous even where nothing physical stops it.'}
                  {isBarrier && 'Where classical physics forbids the particle outright, the wavefunction decays exponentially — yet it arrives at the far side with a small amplitude. Every tunnelling microscope, tunnel diode and fusion reaction depends on that leftover amplitude.'}
                </p>
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}