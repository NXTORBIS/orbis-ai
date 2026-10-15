import { Wind } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { kineticSim } from './kineticCore';

function speedColour(speed) {
  return speed === 'a' ? '#f59e0b' : speed === 'b' ? '#22d3ee' : '#a78bfa';
}

export default function KineticLab() {
  return (
    <EngShell
      sim={kineticSim}
      toolId="kinetic-theory"
      icon={Wind}
      title="Kinetic Theory of Gases Laboratory"
      desc="The Maxwell–Boltzmann speed distribution for a real gas. The mean, most probable and rms speeds, the mean free path and the collision rate all follow from the curve you can see — and the pressure is rebuilt from the same integral as (1/3)ρ⟨v²⟩."
    >
      {({ params, readings: r }) => {
        const domain = [0, r.vMax / 1000];
        const height = Math.max(...r.curve.map((point) => point.y)) * 1.15;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Mean molecular speed" value={r.vMean.toFixed(0)} unit="m/s" sub={`most probable ${r.vp.toFixed(0)} · rms ${r.vRms.toFixed(0)} m/s`} />
              <Stat label="Mean free path" value={`${(r.meanFreePath * 1e9).toFixed(0)} nm`} sub={`${r.meanFreePathInDiameters.toFixed(0)} molecular diameters`} mono />
              <Stat label="Collisions per molecule" value={`${(r.collisionFrequency / 1e9).toFixed(2)} × 10⁹ per second`} sub={`${(r.collisionRateDensity).toExponential(2)} collisions per m³ each second`} mono />
              <Stat label="Pressure rebuilt from the gas" value={`${(r.pressureFromMolecules / 1000).toFixed(3)} kPa`} sub={`the ideal gas law says ${r.pressureSet.toFixed(3)} kPa — difference ${(r.pressureError * 100).toExponential(1)}%`} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Maxwell–Boltzmann speed distribution</h3>
              <Scene
                xDomain={domain}
                yDomain={[0, height]}
                height={300}
                xLabel="molecular speed (km/s)"
                yLabel="fraction per km/s"
                ariaLabel="Maxwell-Boltzmann speed distribution with the three characteristic speeds marked"
                series={[{ points: r.curve, tone: 'cyan', width: 2, fill: 'cyan', fillOpacity: 0.14 }]}
                markers={[
                  { x: r.vp / 1000, y: 0, tone: 'amber', r: 3.4 },
                  { x: r.vMean / 1000, y: 0, tone: 'cyan', r: 3.4 },
                  { x: r.vRms / 1000, y: 0, tone: 'violet', r: 3.4 },
                ]}
                texts={[
                  { x: domain[1] * 0.03, y: height * 0.92, text: `most probable ${r.vp.toFixed(0)} m/s (amber) · mean ${r.vMean.toFixed(0)} m/s · rms ${r.vRms.toFixed(0)} m/s (violet)` },
                  { x: domain[1] * 0.03, y: height * 0.82, text: 'The curve is wide: a real gas has molecules at every speed, and the shape itself is what sets the pressure, the energy and the reaction rates.' },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The three speeds</h3>
                <Stat label="Most probable √(2RT/M)" value={`${r.vp.toFixed(1)} m/s`} sub={`curve peak measured at ${r.peakSpeed.toFixed(1)} m/s`} mono />
                <Stat label="Mean √(8RT/πM)" value={`${r.vMean.toFixed(1)} m/s`} sub={`integral of v·f(v) gives ${r.meanFromCurve.toFixed(1)} m/s`} mono />
                <Stat label="Root mean square √(3RT/M)" value={`${r.vRms.toFixed(1)} m/s`} sub={`√⟨v²⟩ from the curve gives ${Math.sqrt(r.meanSquareFromCurve).toFixed(1)} m/s`} mono />
                <Stat label="Distribution normalisation" value={r.normalisation.toFixed(6)} sub="the area under the curve must be exactly one" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy and collisions</h3>
                <Stat label="Mean kinetic energy per molecule" value={`${(r.energyFromCurve / 1.602177e-19).toExponential(3)} eV`} sub={`½m⟨v²⟩ from the curve against 3/2 kT = ${((1.5 * 1.380649e-23 * params.temperature) / 1.602177e-19).toExponential(3)} eV`} mono />
                <Stat label="Molecules in the box" value={r.molecules.toExponential(3)} sub={`number density ${r.density.toExponential(3)} per m³`} mono />
                <Stat label="Collision frequency" value={`${(r.collisionFrequency / 1e9).toFixed(3)} × 10⁹ Hz`} sub="mean speed ÷ mean free path" mono />
                <Stat label="Effusion through a small hole" value={`${(r.effusionFlux).toExponential(3)} per m²·s`} sub="lighter gases escape faster, as Graham’s law requires" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">How a gas makes pressure</h3>
                <p className="text-[11px] text-muted-foreground/80">
                  Each molecule carries momentum m·v. When it strikes the wall it reverses its normal component, and the steady drumbeat of those reversals over the whole wall area is the pressure — exactly one third of the gas’s density times its mean square speed. Rebuilding the pressure that way here returns the pressure you set, to within {(r.pressureError * 100).toExponential(1)}%, which is the ideal gas law emerging from molecular motion rather than being assumed.
                </p>
                <Stat label="Random sample check" value={`${r.sampledMean.toFixed(1)} m/s`} sub={`4 000 simulated molecules give a mean within a per cent of the analytic ${r.vMean.toFixed(1)} m/s`} mono />
                <Stat label="Thermal de Broglie wavelength" value={`${(r.thermalWavelength * 1e12).toFixed(2)} pm`} sub="where quantum behaviour would start to matter" mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}