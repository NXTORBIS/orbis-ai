import { useMemo, useState } from 'react';
import { Gauge } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SOUND_MEDIA = [
  { label: 'Air, 20 °C', speed: 343 },
  { label: 'Air, 0 °C', speed: 331 },
  { label: 'Water', speed: 1482 },
  { label: 'Steel', speed: 5960 },
];
const LIGHT = 299792458;
const freq = (value) => {
  if (!Number.isFinite(value) || value === 0) return '0';
  const size = Math.abs(value);
  if (size >= 1e9 || size < 1e-2) return value.toExponential(4);
  if (size >= 1000) return Math.round(value).toLocaleString();
  return value.toFixed(3);
};

export default function DopplerCalculator() {
  const [kind, setKind] = useState('sound');
  const [mode, setMode] = useState('shift');
  const [direction, setDirection] = useState('approach');
  const [source, setSource] = useState('440');
  const [observed, setObserved] = useState('470');
  const [speed, setSpeed] = useState('30');
  const [medium, setMedium] = useState('343');

  const result = useMemo(() => {
    const mediumSpeed = kind === 'light' ? LIGHT : Math.max(1, Number(medium) || 343);
    const sourceFrequency = Math.max(0, Number(source) || 0);
    const observerFrequency = Math.max(0, Number(observed) || 0);
    const speedValue = Math.max(0, Number(speed) || 0);
    const approaching = direction === 'approach';

    let resolvedSpeed = speedValue;
    let resolvedObserved = observerFrequency;
    let beta = 0;
    let redshift = 0;
    let mach = 0;
    let radarSpeed = 0;

    if (mode === 'shift') {
      if (kind === 'light') {
        beta = Math.min(0.999999, speedValue / LIGHT);
        const factor = Math.sqrt((1 + beta) / (1 - beta));
        resolvedObserved = approaching ? sourceFrequency * factor : sourceFrequency / factor;
        redshift = resolvedObserved ? sourceFrequency / resolvedObserved - 1 : 0;
      } else {
        mach = speedValue / mediumSpeed;
        const denom = approaching ? mediumSpeed - speedValue : mediumSpeed + speedValue;
        resolvedObserved = denom > 0 ? (sourceFrequency * mediumSpeed) / denom : 0;
      }
    } else if (kind === 'light') {
      const z = sourceFrequency && resolvedObserved ? sourceFrequency / resolvedObserved - 1 : 0;
      const ratio = 1 + z;
      beta = Math.abs((ratio * ratio - 1) / (ratio * ratio + 1));
      resolvedSpeed = beta * LIGHT;
      redshift = z;
      radarSpeed = (resolvedSpeed * LIGHT) / (2 * LIGHT);
    } else {
      mach = 0;
      resolvedSpeed = observerFrequency ? mediumSpeed * Math.abs(1 - sourceFrequency / observerFrequency) : 0;
      if (resolvedSpeed > mediumSpeed) resolvedSpeed = mediumSpeed;
      mach = resolvedSpeed / mediumSpeed;
    }

    const shiftHz = resolvedObserved - sourceFrequency;
    const shiftPercent = sourceFrequency ? (shiftHz / sourceFrequency) * 100 : 0;
    const sourceWavelength = resolvedObserved ? mediumSpeed / sourceFrequency : 0;
    const observedWavelength = resolvedObserved ? mediumSpeed / resolvedObserved : 0;
    const semitones = sourceFrequency && resolvedObserved ? 12 * Math.log2(resolvedObserved / sourceFrequency) : 0;
    const cents = (semitones - Math.round(semitones)) * 100;
    const note = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const noteIndex = Math.round(semitones) + 9;
    const nearestNote = note[((noteIndex % 12) + 12) % 12] + (4 + Math.floor((semitones + 9) / 12));

    const profile = [0, 0.1, 0.25, 0.5].map((fraction) => {
      const v = mediumSpeed * fraction;
      if (kind === 'light') {
        const b = Math.min(0.999999, v / LIGHT);
        const factor = Math.sqrt((1 + b) / (1 - b));
        return { label: fraction === 0 ? 'still' : Math.round(fraction * 100) + '% c', value: approaching ? sourceFrequency * factor : sourceFrequency / factor };
      }
      const denom = approaching ? mediumSpeed - v : mediumSpeed + v;
      return { label: fraction === 0 ? 'still' : 'Mach ' + fraction.toFixed(2), value: denom > 0 ? (sourceFrequency * mediumSpeed) / denom : 0 };
    });

    return {
      kind, mediumSpeed, sourceFrequency, resolvedObserved, speed: resolvedSpeed, shiftHz, shiftPercent,
      sourceWavelength, observedWavelength, semitones, cents, nearestNote, mach, beta, redshift, radarSpeed, profile,
      supersonic: kind === 'sound' && mach >= 1,
      approaching,
    };
  }, [kind, mode, direction, source, observed, speed, medium]);

  const report = useMemo(() => [
    (kind === 'sound' ? 'Sound' : 'Light') + ', ' + (result.approaching ? 'approaching' : 'receding'),
    'Source ' + freq(result.sourceFrequency) + ' Hz · observed ' + freq(result.resolvedObserved) + ' Hz',
    'Shift ' + freq(result.shiftHz) + ' Hz (' + result.shiftPercent.toFixed(2) + '%)',
    'Wavelength ' + result.sourceWavelength.toFixed(4) + ' m to ' + result.observedWavelength.toFixed(4) + ' m',
    kind === 'sound' ? 'Mach ' + result.mach.toFixed(3) + ' at ' + (result.mediumSpeed === LIGHT ? '' : result.speed.toFixed(2) + ' m/s') : 'Beta ' + result.beta.toFixed(6) + ' · redshift z ' + result.redshift.toFixed(6),
    'Pitch change ' + result.semitones.toFixed(2) + ' semitones (' + Math.round(result.cents) + ' cents), nearest note ' + result.nearestNote,
  ].join('\n'), [result, kind]);

  return (
    <ToolShell
      toolId="doppler"
      icon={Gauge}
      title="Doppler Shift Calculator"
      desc="A siren, a speed gun or a receding galaxy: source frequency, motion and direction into the observed frequency, the wavelength shift, the Mach number and the change in pitch."
      state={{ kind, mode, direction, source, observed, speed, medium }}
      onRestore={(restored) => {
        if (restored.kind) setKind(restored.kind);
        if (restored.mode) setMode(restored.mode);
        if (restored.direction) setDirection(restored.direction);
        if (restored.source !== undefined) setSource(String(restored.source));
        if (restored.observed !== undefined) setObserved(String(restored.observed));
        if (restored.speed !== undefined) setSpeed(String(restored.speed));
        if (restored.medium !== undefined) setMedium(String(restored.medium));
      }}
      exportText={report}
      exportName="doppler.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={kind} onChange={(value) => { setKind(value); setMedium(value === 'light' ? String(LIGHT) : '343'); }} options={[{ value: 'sound', label: 'Sound' }, { value: 'light', label: 'Light and radio' }]} />
        <Seg value={mode} onChange={setMode} options={[{ value: 'shift', label: 'Given the speed' }, { value: 'solve', label: 'Given the shift' }]} />
        <Seg value={direction} onChange={setDirection} options={[{ value: 'approach', label: 'Approaching' }, { value: 'recede', label: 'Receding' }]} />
      </div>

      {kind === 'sound' && (
        <div className="flex flex-wrap gap-1.5">
          {SOUND_MEDIA.map((entry) => (
            <button
              key={entry.label}
              type="button"
              onClick={() => setMedium(String(entry.speed))}
              className={Number(medium) === entry.speed
                ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-[11px] text-cyan-j'
                : 'rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
            >
              {entry.label} · {entry.speed} m/s
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Source frequency, Hz"><input value={source} onChange={(e) => setSource(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={mode === 'shift' ? 'Observed frequency, Hz' : 'Observed frequency, Hz (from measurement)'}><input value={observed} onChange={(e) => setObserved(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label={kind === 'light' ? 'Speed, m/s' : 'Source speed, m/s'}><input value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Wave speed in the medium, m/s">
          {kind === 'light'
            ? <div className="flex h-9 items-center font-mono-j text-sm text-cyan-j">299 792 458</div>
            : <input value={medium} onChange={(e) => setMedium(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />}
        </Field>
      </div>

      {result.supersonic && (
        <Panel className="!p-3 !border-amber-400/50">
          <p className="text-[11px] text-amber-200">
            The source is at Mach {result.mach.toFixed(2)}, faster than sound in this medium. In front of it the wavefronts pile into a shock wave, and the neat Doppler formula
            breaks down — a supersonic aircraft is heard as a boom after it has passed, not as a rising pitch before it.
          </p>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Observed frequency"
          value={freq(result.resolvedObserved)}
          unit="Hz"
          sub={result.sourceFrequency
            ? 'A shift of ' + freq(result.shiftHz) + ' Hz, or ' + result.shiftPercent.toFixed(1) + '% ' + (result.approaching ? 'upwards' : 'downwards') + '. That is ' + Math.abs(result.semitones).toFixed(2) + ' semitones, nearest note ' + result.nearestNote + '.'
            : 'Enter a source frequency to see the shift.'}
        />
        <Ring
          value={kind === 'sound' ? Math.min(2, result.mach) : Math.min(1, result.beta)}
          max={kind === 'sound' ? 2 : 1}
          tone={(kind === 'sound' ? result.mach : result.beta) > 0.5 ? 'amber' : 'emerald'}
          label={kind === 'sound' ? 'Mach number' : 'Fraction of the speed of light'}
          sub={kind === 'sound'
            ? 'Mach ' + result.mach.toFixed(3) + ', or ' + result.speed.toFixed(1) + ' m/s against ' + result.mediumSpeed + ' m/s in the medium'
            : 'Beta ' + result.beta.toFixed(6) + ', with a redshift of z = ' + result.redshift.toFixed(6)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">The numbers</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Source frequency</span><span>{freq(result.sourceFrequency)} Hz</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Observed frequency</span><span className="text-cyan-j">{freq(result.resolvedObserved)} Hz</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Shift</span><span>{freq(result.shiftHz)} Hz</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Shift percentage</span><span>{result.shiftPercent.toFixed(3)}%</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Source wavelength</span><span>{result.sourceWavelength.toFixed(4)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Observed wavelength</span><span>{result.observedWavelength.toFixed(4)} m</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pitch change</span><span>{result.semitones.toFixed(2)} semitones · {Math.round(result.cents)} cents</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Nearest musical note</span><span>{result.nearestNote}</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Implied speed</span><span>{result.speed >= 1000 ? (result.speed / 1000).toFixed(2) + ' km/s' : result.speed.toFixed(2) + ' m/s'}</span></div>
            {kind === 'light' && (
              <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Redshift z</span><span className="text-cyan-j">{result.redshift.toFixed(6)}</span></div>
            )}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Observed pitch as the source speeds up</div>
          <Bars
            data={result.profile.map((entry) => ({ label: entry.label, value: Number(entry.value.toFixed(0)) }))}
            format={(value) => String(value)}
            suffix=" Hz"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The shift grows without limit as the source approaches the wave speed. At exactly the wave speed the observed frequency doubles on approach, which is the moment the
            neat formula stops applying in practice.
          </p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Observed" value={freq(result.resolvedObserved) + ' Hz'} mono />
        <Stat label="Shift" value={result.shiftPercent.toFixed(2) + '%'} mono sub={freq(result.shiftHz) + ' Hz'} />
        <Stat label="Pitch change" value={result.semitones.toFixed(2)} mono sub="semitones" />
        <Stat label={kind === 'sound' ? 'Mach' : 'Redshift z'} value={kind === 'sound' ? result.mach.toFixed(3) : result.redshift.toFixed(5)} mono sub={result.approaching ? 'approaching' : 'receding'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the Doppler effect shows up</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· An ambulance siren drops in pitch the instant it passes you. You hear the higher pitch as it approaches and the lower one as it recedes, and nothing at all changes in the siren itself.</p>
            <p>· Radar speed guns work by reflection, so the shift doubles: the wave is shifted on the way out and again on the way back. That doubling is why the target speed works out at exactly half the implied single-shift speed.</p>
            <p>· Weather radar reads the shift from raindrops to measure wind inside a storm, which is how rotation is spotted before a tornado forms.</p>
            <p>· Medical ultrasound uses the same trick to measure blood flow speed in arteries and veins.</p>
            <p>· Astronomers read redshift as distance: a galaxy receding faster shows its spectral lines further towards the red end, and that shift is the measurement everything else hangs on.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reading the result carefully</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The medium matters. The same 30 m/s gives a different Mach number in air than in water, because the wave speed is different by a factor of four.</p>
            <p>· For sound, the shift depends on motion relative to the medium, not just relative to you. Wind therefore counts.</p>
            <p>· For light there is no medium, so only the relative speed matters and the relativistic formula is the correct one at any speed.</p>
            <p>· A negative redshift means approaching; a positive one means receding. The sign convention is worth stating whenever you quote a figure.</p>
            <p>· {kind === 'sound' && result.semitones !== 0 ? 'A change of ' + result.semitones.toFixed(2) + ' semitones is easily audible: about ' + Math.abs(result.semitones).toFixed(1) + ' notes on a piano, which is why the siren effect is so obvious.' : kind === 'light' ? 'Redshift is tiny for everyday speeds and large for cosmology, so the sixth decimal place is where the real information sits.' : 'Enter a speed to see the pitch change in musical terms.'}</p>
            <p>· Sound shifts are symmetrical for source and observer motion only in the non-relativistic approximation used here; at high speed the two are genuinely different.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Wave', value: kind === 'sound' ? 'sound' : 'light' },
                { label: 'Direction', value: result.approaching ? 'approaching' : 'receding' },
                { label: 'Shift', value: result.shiftPercent.toFixed(2) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The equations in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>sound, approaching: f′ = f × v ÷ (v − v_source)</p>
          <p>sound, receding: f′ = f × v ÷ (v + v_source)</p>
          <p>light, approaching: f′ = f × √((1 + β) ÷ (1 − β)) · receding the reciprocal</p>
          <p>redshift z = f ÷ f′ − 1 · β = (z² + 2z) ÷ (z² + 2z + 2) from z = √((1+β)/(1−β)) − 1</p>
          <p>radar on reflection: Δf = 2 × v × f ÷ c</p>
          <p className="text-cyan-j">Here {freq(result.sourceFrequency)} Hz at {result.speed.toFixed(2)} m/s gives {freq(result.resolvedObserved)} Hz.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The sound formulas treat the source as moving through the medium and the observer as stationary, which is the standard introductory case and matches a vehicle passing a
          listener. The light formulas are fully relativistic, so they remain valid up to any speed.
        </p>
      </Panel>
    </ToolShell>
  );
}