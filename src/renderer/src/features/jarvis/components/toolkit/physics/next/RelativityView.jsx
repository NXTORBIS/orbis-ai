import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';

export default function RelativityView({ params: p, r, a }) {
  const twin = p.mode === 'twins', velocity = p.mode === 'velocity', events = p.mode === 'events';
  const total = twin ? r.twinTotal ?? 10 : p.duration;
  const extent = twin ? p.distance * 1.3 : events ? Math.max(8, Math.abs(p.eventX) * 1.5, Math.abs(p.eventT) * 1.2) : total;
  const endTime = events ? extent : total;
  const worldline = twin ? [{ x: 0, y: 0 }, { x: p.distance, y: total / 2 }, { x: 0, y: total }] : [{ x: 0, y: 0 }, { x: (velocity ? r.velocity : p.beta) * total, y: total }];
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label="Lorentz factor γ" value={r.gamma.toFixed(5)} sub={`v = ${(p.beta * 100).toFixed(1)}% of light speed`} />
      <Stat label={twin ? 'Earth / traveller ages' : velocity ? 'Combined speed u/c' : events ? 'Boosted event time t′' : 'Lab / moving clock'} value={twin ? r.twinTotal === null ? 'No finite trip at v = 0' : `${r.twinTime.toFixed(3)} / ${r.twinProper.toFixed(3)} yr` : velocity ? r.velocity.toFixed(6) : events ? `${r.event.t.toFixed(4)} s` : `${r.labTime.toFixed(3)} / ${r.properTime.toFixed(3)} s`} mono />
      <Stat label={events ? 'Boosted position x′' : twin ? 'Final age difference' : 'Contracted proper length'} value={events ? `${r.event.x.toFixed(4)} light-s` : twin ? r.twinTotal === null ? '—' : `${(r.twinTotal * (1 - 1 / r.gamma)).toFixed(3)} yr` : `${r.contractedLength.toFixed(4)} m`} sub={events ? 'x′ = γ(x − vt)' : twin ? 'instantaneous turnaround approximation' : 'L = L₀ / γ'} mono />
      <Stat label={events ? 'Invariant interval t² − x²' : 'Kinetic energy'} value={events ? `${r.interval.toFixed(4)} s²` : `${r.kineticEnergy.toExponential(4)} J`} sub={events ? r.interval > 0 ? 'Timelike separation' : r.interval < 0 ? 'Spacelike separation' : 'Lightlike separation' : 'K = (γ − 1)mc²'} mono />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{twin ? 'The two paths through spacetime' : events ? 'Event and light cone in the lab frame' : 'A moving worldline inside the light cone'}</h3>
        <Scene height={300} xDomain={[-extent, extent]} yDomain={events ? [-extent, extent] : [0, endTime]} xLabel={twin ? 'position (light-years)' : 'position (light-s)'} yLabel={twin ? 'time (years)' : 'time (s)'} ariaLabel="Spacetime worldline and light cones" series={[
          { points: [{ x: -endTime, y: endTime }, { x: 0, y: 0 }, { x: endTime, y: endTime }], tone: 'amber', dashed: true },
          { points: [{ x: 0, y: 0 }, { x: 0, y: endTime }], tone: 'muted' },
          ...(!events && (!twin || r.twinTotal !== null) ? [{ points: worldline, tone: 'cyan', width: 2.5 }] : []),
        ]} markers={events ? [{ x: p.eventX, y: p.eventT, label: 'Event', tone: 'violet' }] : twin ? r.twinTotal === null ? [] : [{ x: r.twinPosition, y: r.twinTime, label: 'Traveller', tone: 'cyan' }] : [{ x: (velocity ? r.velocity : p.beta) * r.labTime, y: r.labTime, label: 'Moving object', tone: 'cyan' }]} />
        <p className="text-xs leading-relaxed text-muted-foreground">{twin ? 'The inertial home clock follows the vertical path. The traveller changes frame at turnaround; comparing entire paths removes the apparent clock paradox.' : events ? 'Boosts preserve t²−x², even though they change position and time separately. A light-second is the distance travelled by light in one second.' : velocity ? 'u = (u′ + v)/(1 + u′v/c²). Even adding two very fast subluminal velocities never exceeds c.' : 'τ = t/γ. The worldline shows the lab frame; the two readouts compare accumulated lab time with the proper time on board.'}</p>
      </Panel>
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{velocity ? 'Velocity composition — not a simple sum' : 'How time dilation grows near light speed'}</h3>
        <ScientificPlot series={[{ label: velocity ? 'u/c' : 'γ', points: velocity ? a.additions : a.boost }]} xLabel={velocity ? 'u′/c' : 'v/c'} yLabel={velocity ? 'u/c' : 'Lorentz factor'} height={300} />
        {!twin && !events && <div className="grid gap-2 sm:grid-cols-2"><Stat label="Total energy" value={`${r.energy.toExponential(4)} J`} mono /><Stat label="Momentum" value={`${r.momentum.toExponential(4)} kg·m/s`} mono /></div>}
        {events && <Stat label="Interval in boosted frame" value={`${(r.event.t ** 2 - r.event.x ** 2).toFixed(4)} s²`} sub="Compare with the lab-frame invariant above" mono />}
      </Panel>
    </div>
  </>;
}