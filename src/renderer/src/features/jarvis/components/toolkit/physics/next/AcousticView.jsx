import { Panel, Stat } from '@jarvis/components/toolkit/shared';
import { Hero } from '@jarvis/components/toolkit/kit/premium';
import Scene from '@jarvis/components/toolkit/physics/Scene';
import ScientificPlot from '@jarvis/components/toolkit/engines/ScientificPlot';
import SoundPreview from '@jarvis/components/toolkit/physics/next/SoundPreview';

export default function AcousticView({ params: p, r, a }) {
  const tube = p.mode === 'tube', room = p.mode === 'room';
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Hero label={tube ? 'Resonant frequency' : room ? 'Eyring reverberation RT60' : 'Beat frequency'} value={tube ? r.frequency.toFixed(3) : room ? r.room.eyring.toFixed(3) : r.beat.toFixed(2)} unit={room ? 's' : 'Hz'} tone={room ? 'violet' : 'cyan'} sub={tube ? `Mode ${p.harmonic} · ${p.boundary === 'closed' ? 'closed / open' : 'open / open'} tube` : room ? 'Time for a 60 dB energy-level decay' : '|f₁ − f₂|'} />
      <Stat label={tube ? 'Wavelength' : room ? 'Sabine RT60' : 'Beat period'} value={tube ? `${r.wavelength.toFixed(4)} m` : room ? `${r.room.sabine.toFixed(4)} s` : r.beatPeriod === null ? 'No beating: equal frequencies' : `${r.beatPeriod.toFixed(5)} s`} mono />
      <Stat label={room ? 'Room volume / surface' : tube ? 'Speed of sound' : 'Mean carrier frequency'} value={room ? `${r.room.volume.toFixed(2)} m³ / ${r.room.surface.toFixed(2)} m²` : tube ? `${r.c.toFixed(3)} m/s` : `${((p.f1 + p.f2) / 2).toFixed(3)} Hz`} mono />
      <Stat label={room ? 'Current decay level' : tube ? 'Pressure boundary condition' : 'Current envelope'} value={room ? `${r.db.toFixed(2)} dB` : tube ? p.boundary === 'closed' ? 'Antinode → node' : 'Node → node' : `${(r.amplitude * 100).toFixed(2)}%`} sub={room ? `${r.roomTime.toFixed(3)} s elapsed` : tube ? 'Displacement boundary conditions are opposite' : 'Envelope animation at 1/10 real speed'} mono />
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{tube ? 'Pressure standing wave' : room ? 'Diffuse-field sound decay' : 'The summed pressure waveform'}</h3>
        {tube ? <Scene height={250} xDomain={[0, p.length]} yDomain={[-1.3, 1.3]} xLabel="position (m)" yLabel="relative pressure" ariaLabel="Pressure standing-wave shape with the selected end conditions" bands={[{ y0: -1.2, y1: 1.2, tone: 'cyan', opacity: 0.04 }]} series={[{ points: a.shape, tone: 'muted', dashed: true }, { points: a.shape.map((point) => ({ x: point.x, y: point.y * Math.cos(r.phase) })), tone: 'cyan', width: 2.5 }]} texts={[{ x: 0, y: 1.14, text: p.boundary === 'closed' ? 'Closed end' : 'Open end' }, { x: p.length, y: 1.14, text: 'Open end', anchor: 'end' }]} /> : <ScientificPlot series={room ? a.curves : [{ label: 'Combined pressure', points: a.waveform }]} xLabel="Physical time (s)" yLabel={room ? 'Level change (dB)' : 'Relative pressure'} height={250} />}
        {!room && <SoundPreview frequencies={tube ? [r.frequency] : [p.f1, p.f2]} />}
      </Panel>
      <Panel className="space-y-3">
        <h3 className="text-sm font-semibold">{tube ? 'The air-column mode ladder' : room ? 'Absorption and model limits' : 'The beat envelope'}</h3>
        {tube ? <div className="grid gap-2 sm:grid-cols-2">{a.modes.map((mode) => <Stat key={mode.mode} label={`Mode ${mode.mode}`} value={`${mode.frequency.toFixed(2)} Hz`} mono />)}</div> : room ? <>
          <Stat label="Equivalent absorbing area" value={`${r.room.absorption.toFixed(3)} m² sabins`} sub="Mean α times total room surface" mono />
          <Stat label="Echo across the long dimension" value={`${(2 * p.roomLength / r.c * 1000).toFixed(2)} ms`} sub="Two-way travel time, not a ray-traced echo" mono />
          <p className="text-xs leading-relaxed text-muted-foreground">Sabine uses RT60 = 0.161V/(Sα). Eyring replaces α with −ln(1−α), giving a shorter reverberation time at higher absorption. Neither captures individual early reflections, room modes or nonuniform absorption.</p>
        </> : <ScientificPlot series={[{ label: 'Absolute envelope', points: a.envelope }]} xLabel="Physical time (s)" yLabel="Normalised envelope" height={250} />}
        {!room && <p className="text-xs leading-relaxed text-muted-foreground">{tube ? 'Open ends are pressure nodes. A closed end is a pressure antinode, so only odd harmonics fit in a closed/open tube. Real instruments require end corrections and loss models.' : 'The sum becomes 2 sin(2πf̄t) cos(πΔft). Taking the absolute envelope gives |f₁−f₂| loudness pulses each second. Equal frequencies produce a constant envelope.'}</p>}
      </Panel>
    </div>
  </>;
}