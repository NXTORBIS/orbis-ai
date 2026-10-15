import { Sun } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { radiationSim } from './radiationCore';

const power = (value) => (value >= 1000 ? `${(value / 1000).toFixed(2)} kW` : `${value.toFixed(value < 10 ? 2 : 1)} W`);

export default function RadiationLab() {
  return (
    <EngShell
      sim={radiationSim}
      toolId="thermal-radiation"
      icon={Sun}
      title="Thermal Radiation & Black-Body Laboratory"
      desc="The full Planck spectrum of a hot surface, integrated on screen: the area under the curve is the emitted flux, its peak gives Wien’s law, and the share falling in the visible, infrared and ultraviolet bands is measured from the same distribution."
    >
      {({ params, readings: r }) => {
        const domain = [0, params.maxWavelength];
        const height = Math.max(...r.curve.map((point) => point.y)) * 1.2;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Peak wavelength" value={r.peakWavelength.toFixed(2)} unit="µm" sub={`Wien’s law predicts ${r.wienPeak.toFixed(2)} µm — the curve’s own maximum is measured`} />
              <Stat label="Emitted flux" value={`${(r.flux / 1000).toFixed(2)} kW/m²`} sub={`σT⁴ from the integral: difference ${(r.stefanError * 100).toExponential(1)}%`} mono />
              <Stat label="Radiated power" value={power(r.power)} sub={`from ${params.area} m² of surface at ε = ${params.emissivity}`} mono />
              <Stat label="Net loss to the room" value={power(Math.abs(r.netPower))} sub={r.net >= 0 ? `radiating away ${params.ambient} K surroundings` : 'gaining heat from warmer surroundings'} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Spectral exitance</h3>
              <Scene
                xDomain={domain}
                yDomain={[0, height]}
                height={300}
                xLabel="wavelength (µm)"
                yLabel="spectral exitance (10¹² W/m²/µm)"
                ariaLabel="Planck black-body spectrum with the visible band marked"
                series={[{ points: r.curve, tone: 'amber', width: 2, fill: 'amber', fillOpacity: 0.18 }]}
                markers={[
                  { x: r.peakWavelength, y: height * 0.02, tone: 'violet', r: 3.4 },
                  { x: 0.38, y: height * 0.02, tone: 'violet', r: 3, label: 'violet edge of visible' },
                  { x: 0.75, y: height * 0.02, tone: 'rose', r: 3, label: 'red edge' },
                ]}
                texts={[
                  { x: domain[1] * 0.04, y: height * 0.93, text: `peak at ${r.peakWavelength.toFixed(2)} µm, photon energy there ${(r.photonEnergy / 1.602177e-19).toFixed(2)} eV` },
                  { x: domain[1] * 0.04, y: height * 0.84, text: `visible ${(r.visible * 100).toFixed(1)}% · infrared ${(r.infrared * 100).toFixed(1)}% · ultraviolet ${(r.ultraviolet * 100).toFixed(1)}%` },
                ]}
              />
              <p className="text-[11px] text-muted-foreground/80">Integrating this curve from 0 to infinity returns σT⁴, which is exactly how the Stefan–Boltzmann constant is measured here — the two radiation laws come out of one distribution rather than being quoted separately.</p>
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl border border-border/60" style={{ background: r.colour, boxShadow: `0 0 24px -4px ${r.colour}` }} />
                  <div>
                    <div className="text-sm font-semibold">Colour at {params.temperature} K</div>
                    <div className="text-[11px] text-muted-foreground">the approximate glow this temperature produces</div>
                  </div>
                </div>
                <Stat label="Band split" value={`UV ${(r.ultraviolet * 100).toFixed(1)}% · visible ${(r.visible * 100).toFixed(1)}% · IR ${(r.infrared * 100).toFixed(1)}%`} mono />
                <Stat label="Recovered Stefan–Boltzmann constant" value={`${(r.integral / Math.pow(params.temperature, 4)).toExponential(4)} W/m²K⁴`} sub="the real value is 5.6704 × 10⁻⁸" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Where the energy sits</h3>
                <Stat label="Visible light emitted" value={power(r.power * r.visible)} sub="only this part can be seen" mono />
                <Stat label="Infrared emitted" value={power(r.power * r.infrared)} sub="heat you feel rather than see" mono />
                <Stat label="Ultraviolet emitted" value={power(r.power * r.ultraviolet)} sub="the part that tans and burns skin" mono />
                <Stat label="Peak radiance" value={`${(r.peakRadiance / 1e12).toFixed(3)} × 10¹² W/m²/µm`} sub="per steradian, at the peak wavelength" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The two laws falling out of one curve</h3>
                <Stat label="Stefan–Boltzmann" value={`T⁴ scaling: 2T gives ${(Math.pow(2, 4)).toFixed(0)}× the power`} sub="measured by integrating the same distribution at two temperatures" mono />
                <Stat label="Wien displacement" value={`λ_max·T = ${(r.peakWavelength * params.temperature).toFixed(0)} µm·K`} sub="measured from the curve’s maximum, b = 2898 µm·K" mono />
                <Stat label="Long-wavelength limit" value={`Rayleigh–Jeans is within ${(Math.abs(1 - r.planckAtEdge / r.rayleighJeansAtEdge) * 100).toFixed(2)}% at the far edge`} sub="Planck and the classical formula only agree far from the peak — the ultraviolet catastrophe is where they part" mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}