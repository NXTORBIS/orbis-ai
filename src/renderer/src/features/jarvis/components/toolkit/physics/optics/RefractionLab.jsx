import { Gem } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import { refractionSim, tracePrism, prismGeometry, interfaceSolution } from './refractionCore';

const DEG = Math.PI / 180;

export default function RefractionLab() {
  return (
    <EngShell
      sim={refractionSim}
      toolId="refraction-dispersion"
      icon={Gem}
      title="Refraction, Total Internal Reflection & Prisms"
      desc="Send a ray at a plane interface or through a prism: the refracted angle, the critical angle, the Fresnel split between reflection and transmission, Brewster’s angle and the prism deviation update from Snell’s law as you turn the ray."
    >
      {({ params, readings: r }) => {
        if (params.mode === 'prism') {
          const geometry = prismGeometry(params.apexAngle);
          const main = tracePrism(params, params.n2);
          const red = tracePrism(params, Math.max(1, params.n2 - params.dispersion));
          const violet = tracePrism(params, params.n2 + params.dispersion);
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Hero label="Deviation" value={Number.isFinite(r.deviation) ? r.deviation.toFixed(2) : 'trapped'} unit="°" sub={`apex angle ${params.apexAngle}°, n = ${params.n2}`} />
                <Stat label="Angles inside the prism" value={`r₁ ${Number.isFinite(r.r1) ? r.r1.toFixed(2) : '—'}° → r₂ ${Number.isFinite(r.r2) ? r.r2.toFixed(2) : '—'}°`} sub={`exit angle i₂ = ${Number.isFinite(r.i2) ? r.i2.toFixed(2) : '—'}°`} mono />
                <Stat label="Minimum deviation" value={`${r.minimumDeviation.toFixed(2)}°`} sub={`reached at i₁ = ${((r.minimumDeviation + params.apexAngle) / 2).toFixed(2)}°`} mono />
                <Stat label="Colour spread" value={`${r.spread.toFixed(3)}°`} sub={`Δn = ${params.dispersion} across the spectrum`} mono />
              </div>

              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">The prism path, red to violet</h3>
                <Scene
                  xDomain={[-3, 3]}
                  yDomain={[-0.4, 3]}
                  height={320}
                  ariaLabel="Ray traced through a prism with red and violet rays separated by dispersion"
                  polys={[{ points: [geometry.apex, geometry.left, geometry.right], tone: 'cyan', fill: 'cyan', fillOpacity: 0.1 }]}
                  series={[
                    ...(params.dispersion > 0 ? [
                      { points: red.points, tone: 'rose', width: 1.4 },
                      { points: violet.points, tone: 'violet', width: 1.4 },
                    ] : []),
                    { points: main.points, tone: 'cyan', width: 2.2 },
                  ]}
                  texts={[
                    { x: -2.9, y: 2.75, text: `incident at ${params.incidence}° to the left face normal` },
                    { x: 0.4, y: 2.75, text: main.trapped ? 'total internal reflection inside the prism' : `deviation ${r.deviation.toFixed(2)}°` },
                    { x: -2.9, y: 0.25, text: params.dispersion > 0 ? 'violet is deviated more than red' : 'no dispersion set: the ray is a single line' },
                  ]}
                />
              </Panel>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel className="space-y-2">
                  <h3 className="text-sm font-semibold">Deviation against incidence angle</h3>
                  <ScientificPlot
                    series={[{
                      label: 'deviation (°)',
                      points: Array.from({ length: 120 }, (_, i) => {
                        const angle = 20 + (i / 119) * 65;
                        const solution = refractionSim.verify ? null : null;
                        const value = (() => {
                          const sineR1 = Math.sin(angle * DEG) / params.n2;
                          if (Math.abs(sineR1) > 1) return null;
                          const r1 = Math.asin(sineR1);
                          const r2 = (params.apexAngle * DEG) - r1;
                          const sineR2 = params.n2 * Math.sin(r2);
                          if (Math.abs(sineR2) > 1) return null;
                          return ((angle * DEG) + Math.asin(sineR2) - params.apexAngle * DEG) * (180 / Math.PI);
                        })();
                        return { x: angle, y: value };
                      }).filter((point) => point.y !== null),
                    }]}
                    xLabel="incidence angle (°)"
                    yLabel="deviation (°)"
                    height={230}
                  />
                  <p className="text-[11px] text-muted-foreground/80">The curve has a minimum — that is the minimum-deviation condition n = sin((A + δ)/2)/sin(A/2), and it is what a prism spectrometer is set to.</p>
                </Panel>
                <Panel className="space-y-2">
                  <h3 className="text-sm font-semibold">Reading the numbers</h3>
                  <Stat label="Refractive index" value={`n = ${params.n2}`} sub={`apex angle A = ${params.apexAngle}°`} mono />
                  <Stat label="Total internal reflection inside" value={Number.isFinite(r.deviation) ? 'no' : 'yes'} sub={Number.isFinite(r.deviation) ? 'the ray leaves the second face' : 'the ray cannot leave the second face at this angle and is reflected back inside'} />
                  <Stat label="Dispersion model" value={`n(λ) spread ${params.dispersion}`} sub="idealised Cauchy dispersion: the two indices stand for the red and violet ends of the spectrum" mono />
                </Panel>
              </div>
            </>
          );
        }

        const incidentStart = { x: -3 * Math.sin(r.incidence), y: 3 * Math.cos(r.incidence) };
        const reflectedEnd = { x: 3 * Math.sin(r.incidence), y: 3 * Math.cos(r.incidence) };
        const refractedEnd = r.totalInternal ? null : { x: 3 * Math.sin(r.refraction), y: -3 * Math.cos(r.refraction) };
        const fresnelCurve = (which) => Array.from({ length: 120 }, (_, i) => {
          const angle = (i / 119) * 89;
          const solution = interfaceSolution({ ...params, incidence: angle });
          return { x: angle, y: which === 'avg' ? solution.reflectance : which === 'p' ? solution.reflectanceP : solution.reflectanceS };
        });
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero label="Angle of refraction" value={r.totalInternal ? 'total internal reflection' : `${r.refractionDegrees.toFixed(2)}°`} unit={r.totalInternal ? '' : 'from the normal'} sub={`incident at ${r.incidence.toFixed(1)}° from a medium of index ${params.n1} into ${params.n2}`} tone={r.totalInternal ? 'amber' : 'cyan'} />
              <Stat label="Critical angle" value={r.critical === null ? 'none: n₁ < n₂' : `${r.critical.toFixed(2)}°`} sub="beyond it all the light is reflected back" mono />
              <Stat label="Reflected / transmitted" value={`${(r.reflectance * 100).toFixed(1)}% / ${(r.transmittance * 100).toFixed(1)}%`} sub={`Rs ${(r.reflectanceS * 100).toFixed(1)}% · Rp ${(r.reflectanceP * 100).toFixed(1)}%`} mono />
              <Stat label="Brewster angle" value={`${r.brewsterDegrees.toFixed(2)}°`} sub={r.atBrewster ? 'the parallel component is fully transmitted' : 'where the parallel reflectance vanishes'} mono />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">The ray at the interface</h3>
                <Scene
                  xDomain={[-3, 3]}
                  yDomain={[-3, 3]}
                  height={300}
                  ariaLabel="Incident, reflected and refracted rays at a plane interface"
                  bands={[
                    { y0: 0, y1: 3, tone: 'cyan', opacity: 0.07, label: `medium 1 · n = ${params.n1}` },
                    { y0: -3, y1: 0, tone: 'violet', opacity: 0.09, label: `medium 2 · n = ${params.n2}` },
                  ]}
                  series={[
                    { points: [{ x: -3, y: 0 }, { x: 3, y: 0 }], tone: 'foreground', width: 1.6 },
                    { points: [{ x: 0, y: -3 }, { x: 0, y: 3 }], tone: 'muted', width: 1, dashed: true },
                    { points: [incidentStart, { x: 0, y: 0 }], tone: 'cyan', width: 2.2 },
                    { points: [{ x: 0, y: 0 }, reflectedEnd], tone: 'rose', width: 1.8 },
                    ...(refractedEnd ? [{ points: [{ x: 0, y: 0 }, refractedEnd], tone: 'amber', width: 2.2 }] : []),
                  ]}
                  arrows={[]}
                  texts={[
                    { x: -2.9, y: 2.7, text: `normal and angles measured from it` },
                    { x: -2.9, y: -2.7, text: r.totalInternal ? 'no transmitted ray: the light is totally internally reflected' : `n₁ sin θ₁ = n₂ sin θ₂ → ${params.n1}·sin ${r.incidence.toFixed(1)}° = ${params.n2}·sin ${r.refractionDegrees.toFixed(2)}°` },
                    { x: 0.2, y: 2.7, text: `reflected at ${r.reflectedAngle.toFixed(1)}°` },
                  ]}
                />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">How much light turns back</h3>
                <ScientificPlot
                  series={[
                    { label: 'unpolarised R', points: fresnelCurve('avg') },
                    { label: 'Rs (perpendicular)', points: fresnelCurve('s') },
                    { label: 'Rp (parallel)', points: fresnelCurve('p') },
                  ]}
                  xLabel="incidence angle (°)"
                  yLabel="reflectance"
                  height={230}
                />
                <p className="text-[11px] text-muted-foreground/80">The parallel component dips to zero at Brewster’s angle ({r.brewsterDegrees.toFixed(1)}°), which is why reflected glare from glass or water is strongly polarised.</p>
              </Panel>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Gauge value={r.reflectance * 100} min={0} max={100} label="Reflectance" unit="%" bands={[{ min: 0, max: r.reflectance * 100, label: r.totalInternal ? 'everything reflected' : 'partial reflection', stroke: 'hsl(350 89% 60%)' }]} />
              <Panel className="space-y-2 lg:col-span-2">
                <h3 className="text-sm font-semibold">The rules in numbers</h3>
                <Stat label="Snell’s law" value={`${params.n1} · sin ${r.incidence.toFixed(1)}° = ${params.n2} · sin ${Number.isFinite(r.refractionDegrees) ? r.refractionDegrees.toFixed(2) : '—'}°`} mono />
                <Stat label="Critical angle" value={r.critical === null ? 'not applicable' : `sin θc = n₂/n₁ = ${(params.n2 / params.n1).toFixed(4)}`} sub="only exists when light goes from denser to rarer" mono />
                <Stat label="Brewster’s law" value={`tan θB = n₂/n₁ = ${(params.n2 / params.n1).toFixed(4)}`} sub={`θB = ${r.brewsterDegrees.toFixed(2)}°`} mono />
                <Stat label="Fresnel energy split" value={`R + T = ${(r.reflectance + r.transmittance).toFixed(6)}`} sub="energy is conserved at the surface" mono />
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}