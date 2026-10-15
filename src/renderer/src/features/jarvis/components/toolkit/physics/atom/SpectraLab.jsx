import { Atom } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { spectraSim, GROUND } from './spectraCore';

const nm = (value) => `${(value * 1e9).toFixed(3)} nm`;

export default function SpectraLab() {
  return (
    <EngShell
      sim={spectraSim}
      toolId="atomic-spectra"
      icon={Atom}
      title="Atomic Spectra Laboratory"
      desc="The energy levels of a hydrogen-like atom and the light it emits when an electron drops between them. Every line is worked out twice — from the Rydberg wavenumber and from the difference of the quantised levels — and the two are compared with the laboratory wavelengths, including the series limits, the Z² scaling of ions and the Doppler shift of a moving gas."
    >
      {({ params, readings: r }) => {
        const top = r.levels.at(-1).energy;
        const energyDomain = [top * 1.08, 0.4];
        const stripLow = Math.min(...r.lines.map((line) => line.wavelength)) * 1e9 * 0.92;
        const stripHigh = Math.max(r.limit * 1e9 * 1.06, Math.max(...r.lines.map((line) => line.wavelength)) * 1e9 * 1.02);
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={`Line ${r.ni} → ${r.nf} of this series`}
                value={`${(r.wavelength * 1e9).toFixed(2)} nm`}
                unit=""
                sub={`${r.energy.toFixed(4)} eV photon · ${(r.energy / GROUND).toFixed(4)} of the ionisation energy`}
                tone={r.visible ? 'cyan' : 'violet'}
              />
              <Stat label="Frequency and wavenumber" value={`${(r.frequency / 1e12).toFixed(1)} THz · ${r.wavenumber.toFixed(0)} cm⁻¹`} sub={r.visible ? 'inside the visible band' : 'outside the visible band'} mono />
              <Stat label="Series limit" value={nm(r.limit)} sub={`the shortest line this series can produce, a free electron landing on n = ${r.nf}`} mono />
              <Stat label="Doppler shift" value={`${(r.shift * r.wavelength * 1e9).toFixed(4)} nm`} sub={`at ${params.velocity} km/s the line reads ${(r.shifted * 1e9).toFixed(3)} nm`} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy levels and the transition</h3>
                <Scene
                  xDomain={[0, 1]}
                  yDomain={energyDomain}
                  height={300}
                  xLabel=""
                  yLabel="energy (eV)"
                  ariaLabel="Hydrogen-like energy levels with the chosen transition drawn as an arrow"
                  series={r.levels.map((level) => ({ points: [{ x: 0.12, y: level.energy }, { x: 0.62, y: level.energy }], tone: level.n === r.nf || level.n === r.ni ? 'cyan' : 'slate', width: level.n === r.nf || level.n === r.ni ? 2.6 : 1.4 }))}
                  markers={r.levels.map((level) => ({ x: 0.62, y: level.energy, tone: 'slate', r: 2.4, label: `n = ${level.n}   ${level.energy.toFixed(3)} eV` }))}
                  arrows={[{ x: 0.86, y: r.level, dx: 0, dy: r.energy, tone: 'amber', label: `${(r.wavelength * 1e9).toFixed(1)} nm` }]}
                  texts={[
                    { x: 0.12, y: energyDomain[0] * 0.94, text: `Z = ${r.z} hydrogen-like ion · ionisation from n = ${r.ni}: ${r.ionisation.toFixed(3)} eV` },
                    { x: 0.12, y: energyDomain[0] * 0.86, text: 'the arrow is the photon: its length is the energy gap it carries away' },
                  ]}
                />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The spectrum of this series</h3>
                <Scene
                  xDomain={[stripLow, stripHigh]}
                  yDomain={[0, 1]}
                  height={300}
                  xLabel="wavelength (nm)"
                  yLabel="each line of the series"
                  ariaLabel="Line positions of the chosen series against wavelength, ending at the series limit"
                  series={r.lines.map((line) => ({
                    points: [{ x: line.wavelength * 1e9, y: 0.06 }, { x: line.wavelength * 1e9, y: 0.06 + 0.86 * (line.energy / r.lines[0].energy) }],
                    tone: line.upper === r.ni ? 'amber' : 'cyan',
                    width: line.upper === r.ni ? 3 : 1.8,
                  }))}
                  markers={[{ x: r.limit * 1e9, y: 0.95, tone: 'rose', r: 3.4, label: `series limit ${(r.limit * 1e9).toFixed(2)} nm` }]}
                  texts={[
                    { x: stripLow + (stripHigh - stripLow) * 0.02, y: 0.99, text: 'the brightest line is the one you have selected; the series piles up against its limit' },
                  ]}
                />
                <p className="text-[11px] text-muted-foreground/80">
                  In a real discharge tube the line brightness also follows how many atoms sit in the upper level, which the Boltzmann factor sets — a hot gas shows the higher members of a series far more strongly.
                </p>
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The Bohr orbit behind the line</h3>
                <Stat label="Orbit radius" value={`${(r.radius * 1e12).toFixed(2)} pm`} sub={`${(r.radius / 5.29177e-11).toFixed(2)} Bohr radii for n = ${r.ni}`} mono />
                <Stat label="Orbit speed" value={`${(r.speed / 1e6).toFixed(4)} × 10⁶ m/s`} sub={`${(r.speedFraction * 100).toFixed(3)}% of light — the fine-structure constant divided by n`} mono />
                <Stat label="Angular momentum" value={`${r.angularMomentum} ħ`} sub={`${r.levels.at(-1).degeneracy > 0 ? `2n² = ${2 * r.ni * r.ni} states at this level once spin is counted` : ''}`} mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Line shape</h3>
                <Stat label="Thermal line width" value={nm(r.thermalWidth)} sub={`${(r.thermalFraction * 1e6).toFixed(1)} parts per million at ${params.temperature} K`} mono />
                <Stat label="Photon momentum" value={`${(r.photonMomentum * 1e27).toFixed(4)} × 10⁻²⁷ kg·m/s`} sub="the recoil the atom takes when it emits" mono />
                <Stat label="Series members computed" value={`${r.lineCount} lines`} sub="every one cross-checked between the Rydberg and level-difference routes" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">What the two routes mean</h3>
                <p className="text-[11px] text-muted-foreground/80">
                  The Rydberg formula 1/λ = R(1/n_f² − 1/n_i²) was found empirically long before quantum theory; the level model Eₙ = −13.6 Z²/n² explains it, because a photon carries exactly the energy the electron loses. This page computes both and demands that they agree line by line — which is the check that ties the historical spectrum to the modern picture.
                </p>
                <Stat label="Ground state" value={`−${GROUND.toFixed(4)} eV`} sub="derived here from the Rydberg constant, h, c and the electron charge" mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}