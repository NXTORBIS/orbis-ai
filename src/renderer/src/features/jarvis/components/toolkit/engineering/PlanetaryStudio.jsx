import { useMemo } from 'react';
import { Cog } from 'lucide-react';
import { Panel, Stat, Seg } from '@jarvis/components/toolkit/shared';
import { Hero, Gauge, Pills } from '@jarvis/components/toolkit/kit/premium';
import EngShell from '@jarvis/components/toolkit/engineering/sim/EngShell';
import PlanetaryView from '@jarvis/components/toolkit/engineering/PlanetaryView';
import { planetarySolution, planetaryVerify, spinMembers, MODES, gearGeometry } from '@jarvis/components/toolkit/engineering/planetaryCore';

const sim = {
  id: 'planetary-gearbox',
  unit: 's',
  digits: 2,
  note: 'The Willis equation Ns·ωs + Nr·ωr = (Ns+Nr)·ωc fixes every speed and a roll-without-slip balance at the sun mesh fixes the planet spin; ratios, torque split, mesh frequency and the assembly and adjacency constraints all follow from tooth counts. Ideal kinematic model with one lumped efficiency — no tooth deflection, bearing drag or lubricant churn.',
  checkNote: 'Willis residuals, the three textbook ratios, roll without slip at both meshes, torque and power balance, the differential case and the assembly constraints.',
  params: {
    sun: 12, planet: 15, planets: 3, mode: 'ring-fixed',
    sunSpeed: 300, ringSpeed: 0, carrierSpeed: 0,
    inputTorque: 40, efficiency: 97, module: 2,
  },
  fields: [
    { key: 'sun', label: 'Sun teeth', min: 8, max: 40, step: 1 },
    { key: 'planet', label: 'Planet teeth', min: 8, max: 30, step: 1 },
    { key: 'planets', label: 'Planet count', min: 2, max: 5, step: 1 },
    { key: 'module', label: 'Module (mm per tooth)', min: 1, max: 6, step: 0.5 },
    { key: 'sunSpeed', label: 'Sun speed (rpm)', min: -3000, max: 3000, step: 25 },
    { key: 'ringSpeed', label: 'Ring speed (rpm)', min: -3000, max: 3000, step: 25 },
    { key: 'inputTorque', label: 'Input torque (N·m)', min: 0, max: 300, step: 5 },
    { key: 'efficiency', label: 'Stage efficiency (%)', min: 80, max: 100, step: 0.5 },
  ],
  options: { maxStep: 0.002, sampleEvery: 1, resetOn: ['mode', 'sun', 'planet', 'planets', 'module'] },

  init: () => ({ sunAngle: 0, ringAngle: 0, carrierAngle: 0, planetAngle: 0 }),
  step: (y, dt, p) => spinMembers(y, dt, p),
  read: (y, p) => {
    const s = planetarySolution(p);
    return {
      ...s,
      sunAngle: y.sunAngle, ringAngle: y.ringAngle, carrierAngle: y.carrierAngle,
      planets: Array.from({ length: p.planets }, (_, i) => ({
        position: y.carrierAngle + (i / p.planets) * Math.PI * 2,
        spin: y.planetAngle,
        rpm: s.planetRpm,
      })),
    };
  },
  series: [],
  verify: planetaryVerify,
};

export default function PlanetaryStudio() {
  return (
    <EngShell
      sim={sim}
      toolId="planetary-gearbox"
      icon={Cog}
      title="Planetary Gearbox Simulator"
      desc="Drive any two of sun, ring and carrier and watch the third follow, with tooth-accurate rotation, planet spin, mesh velocity, torque split and the assembly constraint solved from the tooth counts."
    >
      {({ params, setParams, readings: r }) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Hero label="Overall ratio" value={Math.abs(r.ratio).toFixed(3)} unit=": 1" sub={`${MODES[params.mode]} · sun ${r.sunSpeed.toFixed(0)} rpm`} />
            <Stat label="Carrier output" value={`${r.carrierSpeed.toFixed(0)} rpm`} sub={`${r.outputRpm.toFixed(0)} rpm magnitude`} mono />
            <Stat label="Output torque" value={`${r.outputTorque.toFixed(1)} N·m`} sub={`from ${params.inputTorque} N·m at ${params.efficiency}%`} mono />
            <Stat label="Planet spin" value={`${r.planetRpm.toFixed(0)} rpm`} sub={`${r.planetRelRpm.toFixed(0)} rpm relative to carrier`} mono />
          </div>

          <Panel className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Gear set</h3>
              <Seg value={params.mode} onChange={(mode) => setParams({ ...params, mode })} options={Object.entries(MODES).map(([value, label]) => ({ value, label }))} />
            </div>
            <Pills items={[
              { label: 'Sun', value: `${r.sunSpeed.toFixed(0)} rpm` },
              { label: 'Ring', value: `${r.ringSpeed.toFixed(0)} rpm` },
              { label: 'Carrier', value: `${r.carrierSpeed.toFixed(0)} rpm` },
              { label: 'Teeth', value: `${r.teeth.sun}/${r.teeth.planet}/${r.teeth.ring}` },
              { label: 'Mesh', value: `${r.meshHz.toFixed(0)} Hz` },
            ]} />
            <PlanetaryView solution={r} geometry={gearGeometry(params)} />
            <p className="text-[11px] text-muted-foreground">{r.modeNote}</p>
          </Panel>

          <div className="grid gap-3 lg:grid-cols-3">
            <Gauge value={Math.min(100, r.meshHz)} min={0} max={100} label="Sun mesh frequency" unit=" Hz" caption={`${r.meshHz.toFixed(1)} tooth engagements per second`} />
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Torque split</h3>
              <Stat label="Sun" value={`${r.sunTorque.toFixed(2)} N·m`} mono />
              <Stat label="Ring" value={`${r.ringTorque.toFixed(2)} N·m`} mono />
              <Stat label="Carrier" value={`${r.carrierTorque.toFixed(2)} N·m`} mono />
            </Panel>
            <Panel className="space-y-2">
              <h3 className="text-sm font-semibold">Geometry and assembly</h3>
              <Stat label="Pitch radii sun / planet / ring" value={`${r.pitch.sun.toFixed(2)} / ${r.pitch.planet.toFixed(2)} / ${r.pitch.ring.toFixed(2)} mm`} mono />
              <Stat label="Pitch-line speeds sun / ring" value={`${r.pitchSpeed.sun.toFixed(2)} / ${r.pitchSpeed.ring.toFixed(2)} m/s`} mono />
              <Stat label="Assembly condition" value={r.assembly.ok ? `(Ns+Nr)/n = ${r.assembly.value.toFixed(0)} — satisfied` : `(Ns+Nr)/n = ${r.assembly.value.toFixed(3)} — will not index`} />
              <Stat label="Adjacent planets" value={r.assembly.adjacent ? 'Clear of each other' : 'They overlap — reduce the count'} />
            </Panel>
          </div>

          <Panel className="space-y-2">
            <h3 className="text-sm font-semibold">Solved relation</h3>
            <p className="font-mono-j text-xs">Ns·ωs + Nr·ωr = (Ns + Nr)·ωc → {r.teeth.sun}·{r.sunSpeed.toFixed(0)} + {r.teeth.ring}·{r.ringSpeed.toFixed(0)} = ({r.teeth.sun} + {r.teeth.ring})·{r.carrierSpeed.toFixed(0)}</p>
          </Panel>
        </>
      )}
    </EngShell>
  );
}