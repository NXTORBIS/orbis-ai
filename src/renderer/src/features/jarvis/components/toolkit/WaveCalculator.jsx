import { useMemo, useState } from 'react';
import { Waves } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const MEDIA = [
  { label: 'Air, 20 °C', speed: 343 },
  { label: 'Helium', speed: 972 },
  { label: 'Water', speed: 1482 },
  { label: 'Wood', speed: 3850 },
  { label: 'Steel', speed: 5960 },
  { label: 'Light in vacuum', speed: 299792458 },
];

const BANDS = [
  { label: 'Radio', from: 0, to: 3e9, colour: '#64748b' },
  { label: 'Microwave', from: 3e9, to: 3e11, colour: '#38bdf8' },
  { label: 'Infrared', from: 3e11, to: 4.3e14, colour: '#f87171' },
  { label: 'Visible', from: 4.3e14, to: 7.5e14, colour: '#facc15' },
  { label: 'Ultraviolet', from: 7.5e14, to: 3e16, colour: '#a78bfa' },
  { label: 'X-ray', from: 3e16, to: 3e19, colour: '#34d399' },
  { label: 'Gamma', from: 3e19, to: 1e24, colour: '#f472b6' },
];

const nice = (value) => {
  if (!Number.isFinite(value) || value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e6 || size < 1e-3) return value.toExponential(4);
  if (size >= 1000) return value.toFixed(0);
  if (size >= 1) return value.toFixed(4);
  return value.toFixed(6);
};

export default function WaveCalculator() {
  const [kind, setKind] = useState('sound');
  const [solve, setSolve] = useState('speed');
  const [frequency, setFrequency] = useState('440');
  const [wavelength, setWavelength] = useState('0.78');
  const [speed, setSpeed] = useState('343');
  const [amplitude, setAmplitude] = useState('1');

  const result = useMemo(() => {
    const f = Number(frequency) || 0;
    const lambda = Number(wavelength) || 0;
    const v = Number(speed) || 0;

    let resolvedSpeed = v;
    let resolvedFrequency = f;
    let resolvedWavelength = lambda;

    if (solve === 'speed') {
      resolvedSpeed = f * lambda;
    } else if (solve === 'frequency') {
      resolvedFrequency = lambda ? v / lambda : 0;
    } else {
      resolvedWavelength = f ? v / f : 0;
    }

    const period = resolvedFrequency ? 1 / resolvedFrequency : 0;
    const omega = 2 * Math.PI * resolvedFrequency;
    const waveNumber = resolvedWavelength ? (2 * Math.PI) / resolvedWavelength : 0;
    const photonEnergy = 6.62607015e-34 * resolvedFrequency;
    const photonEv = photonEnergy / 1.602176634e-19;
    const band = BANDS.find((entry) => resolvedFrequency >= entry.from && resolvedFrequency < entry.to);
    const audible = resolvedFrequency >= 20 && resolvedFrequency <= 20000;
    const amplitudeNumber = Number(amplitude) || 0;
    // Intensity for a sound wave scales with the square of the amplitude and frequency.
    const intensity = 0.5 * 1.204 * resolvedSpeed * Math.pow(omega * amplitudeNumber, 2);
    const decibels = intensity > 0 ? 10 * Math.log10(intensity / 1e-12) : 0;

    const harmonics = [1, 2, 3, 4, 5].map((multiple) => ({
      multiple,
      frequency: resolvedFrequency * multiple,
      wavelength: resolvedWavelength ? resolvedWavelength / multiple : 0,
    }));

    const octaves = [-2, -1, 0, 1, 2].map((step) => {
      const octaveFrequency = resolvedFrequency * Math.pow(2, step);
      return { step, frequency: octaveFrequency, wavelength: resolvedSpeed && octaveFrequency ? resolvedSpeed / octaveFrequency : 0 };
    });

    const antenna = resolvedWavelength ? { half: resolvedWavelength / 2, quarter: resolvedWavelength / 4 } : { half: 0, quarter: 0 };

    return {
      f: resolvedFrequency, lambda: resolvedWavelength, v: resolvedSpeed, period, omega, waveNumber,
      photonEnergy, photonEv, band, audible, intensity, decibels, harmonics, octaves, antenna,
      amplitude: amplitudeNumber,
      phase: resolvedWavelength ? (360 * 0.25) / resolvedWavelength : 0,
    };
  }, [kind, solve, frequency, wavelength, speed, amplitude]);

  const sine = useMemo(() => {
    const points = [];
    for (let index = 0; index <= 120; index += 1) {
      const x = (index / 120) * 3;
      points.push((20 + (index / 120) * 300).toFixed(1) + ',' + (60 - Math.sin(x * 2 * Math.PI) * 32).toFixed(1));
    }
    return points.join(' ');
  }, []);

  const report = useMemo(() => [
    'Wave: ' + nice(result.f) + ' Hz, wavelength ' + nice(result.lambda) + ' m, speed ' + nice(result.v) + ' m/s',
    'Period ' + nice(result.period) + ' s · angular frequency ' + nice(result.omega) + ' rad/s · wave number ' + nice(result.waveNumber) + ' rad/m',
    '',
    'Wavelength is ' + nice(result.lambda) + ' m, so a half-wave antenna would be about ' + nice(result.antenna.half) + ' m.',
    kind === 'em' ? 'Photon energy ' + result.photonEv.toExponential(3) + ' eV (' + result.photonEnergy.toExponential(3) + ' J)' : 'Audible: ' + (result.audible ? 'yes' : 'no'),
    '',
    'Harmonics: ' + result.harmonics.map((row) => row.multiple + '× ' + nice(row.frequency) + ' Hz').join(', '),
    '',
    'Octaves: ' + result.octaves.map((row) => (row.step > 0 ? '+' : '') + row.step + ' → ' + nice(row.frequency) + ' Hz').join(', '),
  ].join('\n'), [result, kind]);

  return (
    <ToolShell
      toolId="wave-calculator"
      icon={Waves}
      title="Wave Calculator"
      desc="Frequency, wavelength and speed solved in any direction, with the period, harmonic series, octave steps, photon energy for light and where the wave sits in the spectrum."
      state={{ kind, solve, frequency, wavelength, speed, amplitude }}
      onRestore={(restored) => {
        if (restored.kind) setKind(restored.kind);
        if (restored.solve) setSolve(restored.solve);
        if (restored.frequency !== undefined) setFrequency(String(restored.frequency));
        if (restored.wavelength !== undefined) setWavelength(String(restored.wavelength));
        if (restored.speed !== undefined) setSpeed(String(restored.speed));
        if (restored.amplitude !== undefined) setAmplitude(String(restored.amplitude));
      }}
      exportText={report}
      exportName="wave.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={kind} onChange={(value) => { setKind(value); if (value === 'em') setSpeed('299792458'); else setSpeed('343'); }} options={[{ value: 'sound', label: 'Sound' }, { value: 'em', label: 'Light and radio' }, { value: 'water', label: 'On water' }]} />
        <Seg value={solve} onChange={setSolve} options={[{ value: 'speed', label: 'Find speed' }, { value: 'frequency', label: 'Find frequency' }, { value: 'wavelength', label: 'Find wavelength' }]} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {MEDIA.map((entry) => (
          <button
            key={entry.label}
            type="button"
            onClick={() => setSpeed(String(entry.speed))}
            className={Number(speed) === entry.speed
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label} · {entry.speed} m/s
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Frequency, Hz"><input value={frequency} onChange={(e) => setFrequency(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Wavelength, m"><input value={wavelength} onChange={(e) => setWavelength(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Speed, m/s"><input value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Amplitude, for sound level"><input value={amplitude} onChange={(e) => setAmplitude(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">The waveform</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{nice(result.lambda)} m per cycle</span>
        </div>
        <svg viewBox="0 0 340 120" className="h-auto w-full rounded-lg border border-border/60 bg-card/30">
          <line x1="20" x2="320" y1="60" y2="60" stroke="hsl(var(--border))" strokeWidth="1" />
          <polyline points={sine} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2" />
          <line x1="20" x2="120" y1="88" y2="88" stroke="hsl(var(--muted-foreground))" strokeWidth="0.75" />
          <text x="20" y="100" fontSize="9" fill="hsl(var(--muted-foreground))">three cycles</text>
          <text x="320" y="100" textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">{nice(result.period)} s each</text>
        </svg>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The shape never changes with frequency — only the spacing along the axis. Faster oscillation means shorter wavelength for the same speed, which is the whole of the wave equation.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={solve === 'speed' ? 'Wave speed' : solve === 'frequency' ? 'Frequency' : 'Wavelength'}
          value={nice(solve === 'speed' ? result.v : solve === 'frequency' ? result.f : result.lambda)}
          unit={solve === 'speed' ? 'm/s' : solve === 'frequency' ? 'Hz' : 'm'}
          sub={'At ' + nice(result.f) + ' Hz and ' + nice(result.lambda) + ' m the period is ' + nice(result.period) + ' s' + (kind === 'em' && result.band ? ', which places it in the ' + result.band.label.toLowerCase() + ' band' : '') + (kind === 'sound' ? (result.audible ? ' — inside the range a person can hear.' : ' — outside the audible range of 20 Hz to 20 kHz.') : '.')}
        />
        <Ring
          value={result.f}
          max={kind === 'sound' ? 20000 : 1e15}
          label={kind === 'sound' ? 'Against the audible range' : 'Against the electromagnetic spectrum'}
          sub={kind === 'sound' ? (result.audible ? 'Inside 20 Hz to 20 kHz' : 'Outside the audible range') : 'Light at ' + nice(result.v) + ' m/s'}
        />
      </div>

      {kind === 'em' && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where this sits in the spectrum</div>
          <div className="flex overflow-hidden rounded-lg border border-border/60">
            {BANDS.map((entry) => (
              <div
                key={entry.label}
                className="flex-1 px-1 py-2 text-center text-[9px]"
                style={{ backgroundColor: entry.colour + '33', outline: result.band && result.band.label === entry.label ? '2px solid hsl(var(--cyan))' : 'none', outlineOffset: '-2px' }}
              >
                {entry.label}
              </div>
            ))}
          </div>
          <div className="mt-2 space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <div className="flex justify-between"><span>Photon energy</span><span className="text-cyan-j">{result.photonEnergy.toExponential(4)} J · {result.photonEv.toExponential(4)} eV</span></div>
            <div className="flex justify-between"><span>Band</span><span className="text-cyan-j">{result.band ? result.band.label : 'outside the usual bands'}</span></div>
            <div className="flex justify-between"><span>Half-wave antenna length</span><span>{nice(result.antenna.half)} m</span></div>
            <div className="flex justify-between"><span>Quarter-wave antenna length</span><span>{nice(result.antenna.quarter)} m</span></div>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers behind the wave</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Frequency</span><span className="text-cyan-j">{nice(result.f)} Hz</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wavelength</span><span className="text-cyan-j">{nice(result.lambda)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Speed</span><span>{nice(result.v)} m/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Period</span><span>{nice(result.period)} s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Angular frequency ω</span><span>{nice(result.omega)} rad/s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Wave number k</span><span>{nice(result.waveNumber)} rad/m</span></div>
            {kind === 'sound' && (
              <>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Intensity at this amplitude</span><span>{result.intensity.toExponential(3)} W/m²</span></div>
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Indicative level</span><span>{result.decibels > 0 ? result.decibels.toFixed(1) + ' dB' : '—'}</span></div>
              </>
            )}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            The wave equation has three quantities and any two determine the third. Pin the speed to a medium, then frequency and wavelength can never both be free.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Harmonics above this frequency</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            {result.harmonics.map((row) => (
              <div key={row.multiple} className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                <span className="text-muted-foreground">{row.multiple === 1 ? 'Fundamental' : 'Harmonic ' + row.multiple}</span>
                <span>{nice(row.frequency)} Hz · {nice(row.wavelength)} m</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Harmonics are whole-number multiples of the fundamental and set the timbre of a sound. The wavelength of each is the fundamental wavelength divided by the same number, which is why a shorter string sounds higher.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Octave steps — doubling and halving</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {result.octaves.map((row) => (
            <div key={row.step} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
              <span className="text-muted-foreground">{row.step > 0 ? '+' : ''}{row.step} octaves</span>
              <span>{nice(row.frequency)} Hz · {nice(row.wavelength)} m</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          An octave is a factor of two in frequency, so it is a factor of two in wavelength the other way. Everything about pitch, resonance and instrument design follows from that single relationship.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Frequency" value={nice(result.f) + ' Hz'} mono />
        <Stat label="Wavelength" value={nice(result.lambda) + ' m'} mono />
        <Stat label="Speed" value={nice(result.v)} mono sub="m/s" />
        <Stat label="Period" value={nice(result.period)} mono sub="seconds" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading waves correctly</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Sound needs a medium; light does not. That is why the speed of sound changes with the medium and the speed of light in a vacuum is a constant.</p>
            <p>· When a wave moves into a new medium the frequency stays the same and the wavelength changes. The source is still oscillating at the same rate.</p>
            <p>· Amplitude carries energy, not pitch. A louder sound has a bigger amplitude and exactly the same frequency.</p>
            <p>· Wavelength decides how the wave interacts with obstacles: comparable to the obstacle means diffraction, much smaller means it travels straight on.</p>
            <p>· Antennas scale with wavelength, which is the practical reason radio bands matter. A half-wave antenna here is {nice(result.antenna.half)} m.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reference points worth remembering</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Concert A is 440 Hz, which in air is a wavelength of about 0.78 m — roughly the length of a forearm.</p>
            <p>· Human hearing spans 20 Hz to 20 kHz, about ten octaves. Below 20 Hz is felt rather than heard; above 20 kHz belongs to bats and dogs.</p>
            <p>· Visible light runs from about 400 nm of violet to 700 nm of red, a range of less than one octave.</p>
            <p>· FM radio sits around 100 MHz, giving wavelengths of a few metres and antennas you can actually fit on a car.</p>
            <p>· Sound in water travels at about 1482 m/s, more than four times its speed in air, which is why sonar works and why voices sound wrong underwater.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Solving for', value: solve },
                { label: 'Medium', value: String(speed) + ' m/s' },
                { label: 'Band', value: result.band ? result.band.label : '—' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>v = f × λ</p>
          <p>T = 1 ÷ f · ω = 2πf · k = 2π ÷ λ</p>
          <p>E = h × f, with h = 6.62607015 × 10⁻³⁴ J·s and 1 eV = 1.602176634 × 10⁻¹⁹ J</p>
          <p>harmonic n: f × n with wavelength λ ÷ n</p>
          <p className="text-cyan-j">Check: {nice(result.f)} Hz × {nice(result.lambda)} m = {nice(result.v)} m/s.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Sound speeds are quoted at room temperature and atmospheric pressure; the value roughly rises by 0.6 m/s for every degree of temperature. The sound level figure treats
          the amplitude as a physical displacement in air and is intended as an illustration of the relationship rather than a calibrated measurement.
        </p>
      </Panel>
    </ToolShell>
  );
}