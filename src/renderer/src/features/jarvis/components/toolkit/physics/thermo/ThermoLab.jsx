import { Flame } from 'lucide-react';
import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import { thermoSim } from './thermoCore';

const kJ = (value) => `${(value / 1000).toFixed(3)} kJ`;

export default function ThermoLab() {
  return (
    <EngShell
      sim={thermoSim}
      toolId="gas-processes"
      icon={Flame}
      title="Thermodynamic Process Laboratory"
      desc="Take an ideal gas through an isothermal, isobaric, isochoric or adiabatic change, or run a whole Carnot cycle. The work is computed from the process law and again by integrating p dV along the drawn path, so the first law and the entropy change are measured rather than assumed."
    >
      {({ params, readings: r }) => {
        const isCarnot = params.process === 'carnot';
        const domain = [0, Math.max(r.start.volume, r.end.volume) * 1e3 * 1.08];
        const pressureDomain = [0, Math.max(...r.path.map((point) => point.y)) * 1.12];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Hero
                label={isCarnot ? 'Cycle efficiency' : 'Work done'}
                value={isCarnot ? `${(r.efficiency * 100).toFixed(1)}%` : kJ(r.work)}
                sub={isCarnot ? `Carnot limit for these temperatures: ${(r.carnotEfficiency * 100).toFixed(1)}%` : `numeric ∫p dV agrees to ${(r.workError * 100).toExponential(1)}%`}
                tone={isCarnot ? 'emerald' : 'cyan'}
              />
              <Stat label="Heat exchanged" value={kJ(r.heat)} sub={isCarnot ? `in ${kJ(r.heatIn)} · out ${kJ(Math.abs(r.heatOut))}` : params.process === 'adiabatic' ? 'none — the process is insulated' : 'Q from the process law'} mono />
              <Stat label="Internal energy change" value={kJ(r.internalChange)} sub={`ΔU = nC_vΔT with C_v = ${(r.cv / r.moles / 8.314).toFixed(2)}R per mole`} mono />
              <Stat label="Entropy change" value={`${r.entropyChange.toFixed(3)} J/K`} sub={isCarnot ? 'zero over the complete reversible cycle' : params.process === 'adiabatic' ? 'reversible and adiabatic, so unchanged' : 'from ∫dQ/T along the path'} mono />
            </div>

            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">{isCarnot ? 'The cycle on a p–V diagram' : 'The process on a p–V diagram'}</h3>
              <Scene
                xDomain={domain}
                yDomain={pressureDomain}
                height={320}
                xLabel="volume (L)"
                yLabel="pressure (kPa)"
                ariaLabel="Pressure against volume for the chosen thermodynamic process"
                series={[{ points: r.path, tone: 'cyan', width: 2, fill: isCarnot ? 'cyan' : undefined, fillOpacity: isCarnot ? 0.1 : 0 }]}
                markers={[
                  { x: r.start.volume * 1e3, y: r.start.pressure / 1000, tone: 'amber', r: 3.4, label: `${r.start.temperature.toFixed(0)} K start` },
                  { x: r.end.volume * 1e3, y: r.end.pressure / 1000, tone: 'emerald', r: 3.4, label: `${r.end.temperature.toFixed(0)} K end` },
                ]}
                texts={[
                  { x: domain[1] * 0.04, y: pressureDomain[1] * 0.94, text: isCarnot ? 'two isotherms joined by two adiabats — the area inside is the net work' : params.process === 'isothermal' ? 'a rectangular hyperbola: pV is constant, so ΔU = 0 and all the heat becomes work' : params.process === 'isobaric' ? 'a horizontal line, so the work is simply pΔV and the heat is nC_pΔT' : params.process === 'isochoric' ? 'a vertical line: no movement, no work, so every joule of heat stays as internal energy' : 'a steeper curve than the isotherm: pV^γ is constant and no heat crosses the boundary' },
                ]}
              />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-3">
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Before and after</h3>
                <Stat label="Initial state" value={`${(r.start.pressure / 1000).toFixed(1)} kPa · ${(r.start.volume * 1e3).toFixed(1)} L · ${r.start.temperature.toFixed(1)} K`} mono />
                <Stat label="Final state" value={`${(r.end.pressure / 1000).toFixed(1)} kPa · ${(r.end.volume * 1e3).toFixed(1)} L · ${r.end.temperature.toFixed(1)} K`} mono />
                <Stat label="Gas properties" value={`C_v = ${r.cv.toFixed(2)} · C_p = ${r.cp.toFixed(2)} J/mol·K`} sub={`γ = ${r.gamma.toFixed(4)} from ${r.degrees} degrees of freedom`} mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">Energy bookkeeping</h3>
                <Stat label="Heat in (Q)" value={kJ(r.heat)} mono />
                <Stat label="Work out (W)" value={kJ(r.work)} mono />
                <Stat label="ΔU" value={kJ(r.internalChange)} mono />
                <Stat label="First-law residual Q − W − ΔU" value={`${r.firstLawResidual.toExponential(2)} J`} sub="zero to machine precision is the whole point" mono />
              </Panel>
              <Panel className="space-y-2">
                <h3 className="text-sm font-semibold">{isCarnot ? 'The four stages' : 'What the numbers mean'}</h3>
                {isCarnot ? (
                  <ul className="space-y-1 text-[11px]">
                    {r.stages.map((stage) => (
                      <li key={stage.name} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{stage.name}</span>
                        <span className="font-mono-j">{kJ(stage.work)}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-2 border-t border-border/60 pt-1">
                      <span className="text-muted-foreground">Net work</span>
                      <span className="font-mono-j text-cyan-j">{kJ(r.work)}</span>
                    </li>
                  </ul>
                ) : (
                  <p className="text-[11px] text-muted-foreground/80">
                    {params.process === 'isothermal' && 'Held at one temperature, the gas trades heat for work: Q = W = nRT ln(V₂/V₁), and because T never changes ΔU stays at zero.'}
                    {params.process === 'isobaric' && 'At constant pressure the gas does pΔV of work while its temperature rises, so the heat must cover both the work and the internal energy — which is exactly why C_p is larger than C_v by R.'}
                    {params.process === 'isochoric' && 'With the volume locked there is nowhere for the energy to go as work, so all the heat lands in the internal energy and the temperature rise is steeper for the same heat.'}
                    {params.process === 'adiabatic' && 'No heat crosses the boundary, so the work is taken straight out of the internal energy: the gas cools as it expands, along pV^γ rather than pV.'}
                  </p>
                )}
              </Panel>
            </div>
          </>
        );
      }}
    </EngShell>
  );
}