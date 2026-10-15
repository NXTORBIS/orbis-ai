import { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat, ToggleRow } from './shared';

const WAVES = [
  { id: 'square', label: 'Square', series: 'odd', power: 1 },
  { id: 'sawtooth', label: 'Sawtooth', series: 'all', power: 1 },
  { id: 'triangle', label: 'Triangle', series: 'odd', power: 2 },
  { id: 'pulse', label: 'Pulse, 25%', series: 'all', power: 1 },
];

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const noteFor = (frequency) => {
  if (!frequency) return '—';
  const semitones = 12 * Math.log2(frequency / 440);
  const index = Math.round(semitones) + 9;
  const note = NOTES[((index % 12) + 12) % 12] + (4 + Math.floor((index + 9) / 12) / 1);
  const cents = Math.round((semitones - Math.round(semitones)) * 100);
  return note + (cents ? ' ' + (cents > 0 ? '+' : '') + cents + ' cents' : ' exactly');
};

export default function FourierBuilder() {
  const [wave, setWave] = useState('square');
  const [harmonics, setHarmonics] = useState(9);
  const [fundamental, setFundamental] = useState('220');
  const [amplitude, setAmplitude] = useState('1');
  const [showComponents, setShowComponents] = useState(false);
  const [showResidual, setShowResidual] = useState(false);

  const result = useMemo(() => {
    const chosen = WAVES.find((entry) => entry.id === wave) || WAVES[0];
    const count = Math.max(1, Math.min(40, Number(harmonics) || 1));
    const f0 = Math.max(1, Number(fundamental) || 0);
    const amp = Math.max(0.05, Number(amplitude) || 1);
    const duty = 0.25;

    const coefficient = (n) => {
      if (chosen.series === 'odd' && n % 2 === 0) return 0;
      if (wave === 'square') return (1 / n);
      if (wave === 'sawtooth') return (Math.pow(-1, n + 1) / n);
      if (wave === 'triangle') return (Math.pow(-1, (n - 1) / 2) / Math.pow(n, chosen.power));
      return (Math.sin(n * Math.PI * duty) / (n * Math.PI)) * 2;
    };

    const samples = 240;
    const periods = 2;
    const sumTo = (limit) => {
      const points = [];
      for (let index = 0; index <= samples; index += 1) {
        const x = (index / samples) * periods * 2 * Math.PI;
        let total = 0;
        for (let n = 1; n <= limit; n += 1) {
          const c = coefficient(n);
          if (!c) continue;
          total += c * Math.sin(n * x);
        }
        points.push(total * amp);
      }
      return points;
    };

    const partial = sumTo(count);
    const reference = sumTo(400);
    const peak = Math.max(0.0001, ...reference.map((value) => Math.abs(value)), ...partial.map((value) => Math.abs(value)));
    const normalised = partial.map((value) => value / peak);
    const ideal = reference.map((value) => value / peak);

    const error = Math.sqrt(partial.reduce((sum, value, index) => sum + Math.pow(value - reference[index], 2), 0) / partial.length);
    const idealRms = Math.sqrt(reference.reduce((sum, value) => sum + value * value, 0) / reference.length);
    const closeness = Math.max(0, Math.min(100, 100 - (error / (idealRms || 1)) * 100));
    const overshoot = Math.max(...normalised.map((value) => Math.abs(value)));

    const spectrum = Array.from({ length: Math.min(14, count + (count % 2 === 0 ? 1 : 0)) }, (unused, index) => {
      const n = index + 1;
      return { label: String(n), value: Number((Math.abs(coefficient(n)) * 100).toFixed(1)), harmonic: n, frequency: n * f0 };
    }).filter((entry) => entry.value > 0);

    const path = normalised.map((value, index) => {
      const x = 20 + (index / samples) * 620;
      const y = 70 - value * 58;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    const idealPath = ideal.map((value, index) => {
      const x = 20 + (index / samples) * 620;
      const y = 70 - value * 58;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    const components = showComponents
      ? Array.from({ length: Math.min(4, count) }, (unused, index) => {
        const n = index * (chosen.series === 'odd' ? 2 : 1) + 1;
        const points = Array.from({ length: samples + 1 }, (unused, sample) => {
          const x = (sample / samples) * periods * 2 * Math.PI;
          const value = coefficient(n) * Math.sin(n * x) * amp;
          return (20 + (sample / samples) * 620).toFixed(1) + ',' + (70 - (value / peak) * 58).toFixed(1);
        }).join(' ');
        return { n, points };
      })
      : [];

    const bandwidth = count * f0;
    const riseTime = bandwidth ? (0.35 / bandwidth) * 1e6 : 0;

    return {
      chosen, count, f0, amp, partial, normalised, ideal, idealPath, path, closeness, overshoot: (overshoot - 1) * 100,
      spectrum, components, bandwidth, riseTime, note: noteFor(f0), harmonicsAbove20k: Math.ceil(20000 / f0),
      oddOnly: chosen.series === 'odd',
    };
  }, [wave, harmonics, fundamental, amplitude, showComponents, showResidual]);

  const report = useMemo(() => [
    result.chosen.label + ' wave from ' + result.count + ' harmonics',
    'Fundamental ' + result.f0 + ' Hz (' + result.note + ') · bandwidth to ' + result.bandwidth + ' Hz',
    'Closeness to the ideal shape: ' + result.closeness.toFixed(2) + '%',
    'Overshoot at the edges: ' + result.overshoot.toFixed(2) + '%',
    '',
    'Harmonic amplitudes:',
    ...result.spectrum.map((row) => '  n=' + row.harmonic + ' at ' + row.frequency + ' Hz: ' + row.value + '% of the fundamental'),
    '',
    'A true ' + result.chosen.label.toLowerCase() + ' wave would need infinite harmonics. Audio stops mattering around ' + result.harmonicsAbove20k + ' harmonics for this fundamental.',
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="fourier-builder"
      icon={Activity}
      title="Waveform & Harmonic Builder"
      desc="Build a square, sawtooth, triangle or pulse wave from its harmonics and watch the shape assemble — with the harmonic spectrum, the overshoot and how much bandwidth the edge needs."
      state={{ wave, harmonics, fundamental, amplitude, showComponents, showResidual }}
      onRestore={(restored) => {
        if (restored.wave) setWave(restored.wave);
        if (restored.harmonics !== undefined) setHarmonics(Number(restored.harmonics) || 1);
        if (restored.fundamental !== undefined) setFundamental(String(restored.fundamental));
        if (restored.amplitude !== undefined) setAmplitude(String(restored.amplitude));
        if (restored.showComponents !== undefined) setShowComponents(!!restored.showComponents);
        if (restored.showResidual !== undefined) setShowResidual(!!restored.showResidual);
      }}
      exportText={report}
      exportName="harmonics.txt"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {WAVES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setWave(entry.id)}
            className={entry.id === wave
              ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1 text-[11px] text-cyan-j'
              : 'rounded-lg border border-border/70 px-3 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j'}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Harmonics in the sum</span>
          <span className="font-mono-j text-[10px] text-cyan-j">{result.count} harmonic{result.count === 1 ? '' : 's'}</span>
        </div>
        <input
          type="range"
          min={1}
          max={40}
          value={harmonics}
          onChange={(e) => setHarmonics(Number(e.target.value))}
          className="w-full accent-[hsl(var(--cyan))]"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[1, 3, 5, 9, 15, 25, 40].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setHarmonics(value)}
              className={value === harmonics
                ? 'rounded border border-cyan-j/50 bg-cyan-j/10 px-2 py-0.5 font-mono-j text-[10px] text-cyan-j'
                : 'rounded border border-border/70 px-2 py-0.5 font-mono-j text-[10px] text-muted-foreground transition hover:text-foreground'}
            >
              {value}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Start at one and drag upwards. The shape begins as a pure sine and sharpens as each harmonic is added — the same process your ear hears as a flute turning into a violin.
        </p>
      </Panel>

      <Panel className="!p-3">
        <svg viewBox="0 0 660 140" className="h-auto w-full rounded-lg border border-border/60 bg-card/30">
          <line x1="20" x2="640" y1="70" y2="70" stroke="hsl(var(--border))" strokeWidth="1" />
          <polyline points={result.idealPath} fill="none" stroke="hsl(var(--muted-foreground) / 0.5)" strokeWidth="1" strokeDasharray="4 4" />
          {result.components.map((component) => (
            <polyline key={component.n} points={component.points} fill="none" stroke="hsl(var(--cyan) / 0.35)" strokeWidth="1" />
          ))}
          <polyline points={result.path} fill="none" stroke="hsl(var(--cyan))" strokeWidth="2" />
          <text x="20" y="16" fontSize="9" fill="hsl(var(--muted-foreground))">{result.chosen.label} from {result.count} harmonics · dashed line is the ideal shape</text>
          <text x="640" y="132" textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">two periods at {result.f0} Hz</text>
        </svg>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <ToggleRow label="Show the first few harmonics separately" checked={showComponents} onChange={() => setShowComponents((current) => !current)} />
          <ToggleRow label="Mark the overshoot at the edges" checked={showResidual} onChange={() => setShowResidual((current) => !current)} />
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Closeness to the ideal shape"
          value={result.closeness.toFixed(2)}
          unit="%"
          sub={'With ' + result.count + ' harmonics the sum is within ' + result.closeness.toFixed(2) + '% of the true ' + result.chosen.label.toLowerCase() + ' wave. The overshoot at the corners settles at about ' + result.overshoot.toFixed(1) + '% and never fully disappears.'}
        />
        <Ring
          value={result.count}
          max={40}
          label="Harmonics used"
          sub={'Bandwidth reaches ' + result.bandwidth.toLocaleString() + ' Hz for this fundamental, which sets how fast the edge can rise'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The harmonic spectrum</div>
          <Bars data={result.spectrum} format={(value) => value.toFixed(1)} suffix="%" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.oddOnly
              ? 'Only odd harmonics appear in this waveform. That absence of even harmonics is exactly what gives a clarinet its hollow, woody tone compared with a brighter instrument.'
              : 'This waveform uses every harmonic, which is why it sounds bright and buzzy — a rich spectrum from the very first overtone upwards.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Harmonics in Hz</span>
            <CopyBtn value={report} label="Copy" />
          </div>
          <div className="max-h-64 space-y-1 overflow-auto">
            {result.spectrum.map((row) => (
              <div key={row.harmonic} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 font-mono-j text-[11px]">
                <span className="text-muted-foreground">n = {row.harmonic}</span>
                <span>{row.frequency.toLocaleString()} Hz</span>
                <span className="text-cyan-j">{row.value.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Harmonics" value={String(result.count)} mono sub={result.oddOnly ? 'odd only' : 'every harmonic'} />
        <Stat label="Bandwidth" value={result.bandwidth.toLocaleString() + ' Hz'} mono sub={result.harmonicsAbove20k + ' to 20 kHz'} />
        <Stat label="Overshoot" value={result.overshoot.toFixed(1) + '%'} mono sub="at the corners" />
        <Stat label="Rise time" value={result.riseTime.toFixed(1) + ' µs'} mono sub="0.35 over bandwidth" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What this explains about sound</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Timbre is the harmonic recipe. Two instruments playing {result.f0} Hz differ only in how much of each harmonic they produce and when.</p>
            <p>· A square wave needs odd harmonics only; a sawtooth needs every harmonic, which is why a bowed string sounds brighter than a clarinet.</p>
            <p>· The overshoot of about 9% at a step never vanishes, however many harmonics you add. It is a property of the sum, not a calculation artefact.</p>
            <p>· Sharper edges need more high frequencies. That is bandwidth, and it is why a cymbal needs a much wider recording chain than a bass guitar.</p>
            <p>· Audio above 20 kHz does not reach anyone, so a digital square wave is always slightly rounded at the edges. The ideal does not exist in practice.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where harmonics matter beyond audio</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Mains harmonics are what causes transformers to hum and motors to lose efficiency. The 50 or 60 Hz fundamental plus its odd multiples is the signature.</p>
            <p>· Power quality meters separate the fundamental from the distortion, and that distortion figure is a harmonic sum like the one above.</p>
            <p>· Vibration analysis uses harmonic peaks to identify a failing bearing: the frequencies present name the fault.</p>
            <p>· Radio transmissions must not spill power into harmonics, since a harmonic sits on a different channel and interferes with somebody else.</p>
            <p>· Sampling theory connects directly: to represent harmonics up to {result.bandwidth.toLocaleString()} Hz faithfully, the sample rate must be at least {Math.round(result.bandwidth * 2).toLocaleString()} Hz.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Waveform', value: result.chosen.label },
                { label: 'Fundamental', value: result.f0 + ' Hz' },
                { label: 'Closeness', value: result.closeness.toFixed(1) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The maths being drawn</div>
          <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
            <p>square: (4 ÷ π) Σ sin(nωt) ÷ n over odd n</p>
            <p>sawtooth: (2 ÷ π) Σ (−1)ⁿ⁺¹ sin(nωt) ÷ n over all n</p>
            <p>triangle: (8 ÷ π²) Σ (−1)⁽ⁿ⁻¹⁾ᐟ² sin(nωt) ÷ n² over odd n</p>
            <p>pulse: (2 ÷ π) Σ sin(nπd) cos(nωt) ÷ n with duty d</p>
            <p className="text-cyan-j">The ideal reference here uses 400 harmonics, so the comparison is against something visually exact.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Play with it</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Set one harmonic and step upwards one at a time. Watching the square wave develop its flat top is the clearest demonstration of what a Fourier series means.</p>
            <p>· Compare the square and sawtooth spectra at the same harmonic count. The even harmonics in the sawtooth are the entire audible difference.</p>
            <p>· Lower the fundamental and the same harmonic count covers less bandwidth, so the edges round off more.</p>
            <p>· Raise the fundamental to 4,000 Hz and only five harmonics fit below 20 kHz, yet the shape still looks reasonable — the eye and the ear disagree about what enough means.</p>
            <p>· Turn on the component overlay to see how each sine contributes its own small share of the final shape.</p>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fundamental frequency, Hz"><input value={fundamental} onChange={(e) => setFundamental(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          <Field label="Amplitude"><input value={amplitude} onChange={(e) => setAmplitude(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The fundamental here is {result.f0} Hz, which is {result.note}. Amplitude only scales the picture; the shape comes entirely from the harmonic recipe.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each waveform is summed from its standard Fourier coefficients, drawn over two periods, and compared against a 400 harmonic reference so the closeness figure means something.
          Everything is computed in the page from a few trigonometric sums.
        </p>
      </Panel>
    </ToolShell>
  );
}