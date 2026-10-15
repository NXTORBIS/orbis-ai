import { useMemo, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DIVISIONS = [
  { id: 'whole', label: 'Whole note', beats: 4, note: 'Four beats. Long, washy repeats that sit under everything.' },
  { id: 'half', label: 'Half note', beats: 2, note: 'The classic slow delay for ballads and ambient parts.' },
  { id: 'quarter', label: 'Quarter note', beats: 1, note: 'Locks the repeats to the beat. Great for rhythmic stabs, muddy on dense parts.' },
  { id: 'dotted-eighth', label: 'Dotted eighth', beats: 0.75, note: 'The signature delay: repeats fall between the beat and create movement.' },
  { id: 'eighth', label: 'Eighth note', beats: 0.5, note: 'Tighter repeats that thicken a part without smearing it.' },
  { id: 'eighth-triplet', label: 'Eighth triplet', beats: 0.3333, note: 'Swung feel. Use when the groove shuffles.' },
  { id: 'sixteenth', label: 'Sixteenth note', beats: 0.25, note: 'Slapback and rockabilly territory — short, percussive repeats.' },
  { id: 'sixteenth-triplet', label: 'Sixteenth triplet', beats: 0.1667, note: 'Very short. Useful as a doubler rather than an audible echo.' },
  { id: 'thirty-second', label: 'Thirty-second', beats: 0.125, note: 'Doubling and thickening only, not a repeat you hear as a repeat.' },
];

export default function DelayCalculator() {
  const [bpm, setBpm] = useState('120');
  const [units, setUnits] = useState('ms');
  const [taps, setTaps] = useState([]);
  const lastTap = useRef(0);

  const tap = () => {
    const now = Date.now();
    if (lastTap.current && now - lastTap.current < 2000) {
      setTaps((current) => [...current.slice(-5), now - lastTap.current]);
    } else {
      setTaps([]);
    }
    lastTap.current = now;
  };

  const tappedBpm = useMemo(() => {
    if (!taps.length) return null;
    const average = taps.reduce((sum, value) => sum + value, 0) / taps.length;
    return average ? 60000 / average : null;
  }, [taps]);

  const result = useMemo(() => {
    const tempo = Math.max(20, Math.min(300, Number(bpm) || 120));
    const beat = 60000 / tempo;

    const rows = DIVISIONS.map((entry) => {
      const ms = beat * entry.beats;
      return {
        ...entry,
        ms: Number(ms.toFixed(2)),
        hz: Number((1000 / ms).toFixed(3)),
        label2: entry.label,
        display: units === 'ms' ? ms.toFixed(1) + ' ms' : (ms / 1000).toFixed(3) + ' s',
      };
    });

    const quarter = beat;
    const reverb = {
      preDelayLow: Math.round(quarter * 0.08),
      preDelayHigh: Math.round(quarter * 0.12),
      decayLow: (quarter * 0.9 / 1000).toFixed(2),
      decayHigh: (quarter * 1.6 / 1000).toFixed(2),
      hallDecay: (quarter * 2.4 / 1000).toFixed(2),
    };
    const haas = { low: Math.round(quarter * 0.05), high: Math.round(quarter * 0.1) };

    const feedbackNote = (() => {
      if (tempo < 70) return 'At this tempo the repeats are long, so keep feedback around 20 to 30% to avoid a wash that buries the playing.';
      if (tempo < 130) return 'Mid tempo suits feedback around 30 to 45% for a clear rhythmic delay without mud.';
      return 'Fast tempo means short repeats. Feedback can go higher, around 40 to 55%, before the part turns to mush.';
    })();

    const sixteenth = rows.find((entry) => entry.id === 'sixteenth');

    return {
      tempo, beat, rows, reverb, haas, feedbackNote, sixteenth,
      chart: rows.map((entry) => ({ label: entry.label.split(' ')[0].slice(0, 8), value: entry.ms })),
      beatHz: Number((1000 / beat).toFixed(3)),
      barMs: Number((beat * 4).toFixed(1)),
      taps: taps.length,
    };
  }, [bpm, units, taps.length]);

  const report = useMemo(() => [
    'Tempo ' + result.tempo + ' BPM · one beat is ' + result.beat.toFixed(2) + ' ms',
    '',
    ...result.rows.map((row) => row.label.padEnd(20, ' ') + row.ms.toFixed(2) + ' ms  (' + row.hz.toFixed(2) + ' Hz)'),
    '',
    'Reverb pre-delay: ' + result.reverb.preDelayLow + ' to ' + result.reverb.preDelayHigh + ' ms',
    'Reverb decay: ' + result.reverb.decayLow + ' to ' + result.reverb.decayHigh + ' s, a hall around ' + result.reverb.hallDecay + ' s',
    'Haas widening between channels: ' + result.haas.low + ' to ' + result.haas.high + ' ms',
    '',
    result.feedbackNote,
  ].join('\n'), [result]);

  return (
    <ToolShell
      toolId="delay-times"
      icon={Timer}
      title="Delay Time & Tempo Calculator"
      desc="BPM into every synced delay time, with tap tempo, LFO rates in Hz, reverb pre-delay and decay suggestions, and guidance on feedback that will not turn a mix to mud."
      state={{ bpm, units }}
      onRestore={(restored) => {
        if (restored.bpm !== undefined) setBpm(String(restored.bpm));
        if (restored.units) setUnits(restored.units);
      }}
      exportText={report}
      exportName="delay-times.txt"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tempo, BPM"><input value={bpm} onChange={(e) => setBpm(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Display">
          <Seg value={units} onChange={setUnits} options={[{ value: 'ms', label: 'Milliseconds' }, { value: 's', label: 'Seconds' }]} />
        </Field>
        <Field label="Tap tempo">
          <button
            type="button"
            onClick={tap}
            className="h-9 w-full rounded-md border border-cyan-j/50 bg-cyan-j/10 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            {tappedBpm ? 'Tapped ' + tappedBpm.toFixed(1) + ' BPM — tap again' : 'Tap four times in time'}
          </button>
        </Field>
      </div>

      {tappedBpm && (
        <Panel className="!p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              Tapped tempo is {tappedBpm.toFixed(1)} BPM from {result.taps} interval{result.taps === 1 ? '' : 's'}. Tap a few more times for a steadier reading.
            </span>
            <button
              type="button"
              onClick={() => { setBpm(tappedBpm.toFixed(1)); setTaps([]); lastTap.current = 0; }}
              className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
            >
              Use {tappedBpm.toFixed(1)} BPM
            </button>
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="One beat at this tempo"
          value={result.beat.toFixed(1)}
          unit="ms"
          sub={'That is ' + result.beatHz.toFixed(2) + ' Hz and a bar of four beats runs ' + result.barMs + ' ms. Every delay time below is a multiple of this beat, which is what keeps the repeats locked to the track.'}
        />
        <Ring
          value={result.tempo}
          max={300}
          label="Tempo"
          sub={result.tempo < 70 ? 'Slow — long delays, low feedback' : result.tempo < 130 ? 'Mid tempo — the usual range for rhythmic delay' : 'Fast — keep repeats short so they stay clear'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Synced delay times</span>
          <CopyBtn value={report} label="Copy the table" />
        </div>
        <div className="space-y-1.5">
          {result.rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
              <span className="w-36 text-[11px]">{row.label}</span>
              <span className="font-mono-j text-[12px] text-cyan-j">{row.display}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{row.hz} Hz</span>
              <CopyBtn value={row.ms.toFixed(2)} label="Copy" />
              <span className="hidden text-[10px] text-muted-foreground sm:block">{row.note}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Subdivision lengths at a glance</div>
          <Bars data={result.chart} format={(value) => value.toFixed(0)} suffix=" ms" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The bars show why short delay times double a part rather than echo it. Below about {result.sixteenth ? result.sixteenth.ms.toFixed(0) : 100} ms the ear stops hearing a
            repeat and starts hearing thickness.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Reverb and width settings that match the tempo</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pre-delay suggestion</span><span>{result.reverb.preDelayLow} to {result.reverb.preDelayHigh} ms</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Room decay</span><span>{result.reverb.decayLow} to {result.reverb.decayHigh} s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Hall decay</span><span>{result.reverb.hallDecay} s</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Haas widening</span><span>{result.haas.low} to {result.haas.high} ms</span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">One bar</span><span>{result.barMs} ms</span></div>
            <div className="flex justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2.5 py-1.5"><span>Beat</span><span className="text-cyan-j">{result.beat.toFixed(1)} ms</span></div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{result.feedbackNote}</p>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Beat" value={result.beat.toFixed(1) + ' ms'} mono sub={result.beatHz.toFixed(2) + ' Hz'} />
        <Stat label="Dotted eighth" value={(result.beat * 0.75).toFixed(1) + ' ms'} mono sub="the signature delay" />
        <Stat label="Eighth" value={(result.beat * 0.5).toFixed(1) + ' ms'} mono sub="tight doubling" />
        <Stat label="Bar" value={result.barMs + ' ms'} mono sub="four beats" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing a delay for the part</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Rhythmic parts want a synced delay. The repeats land on the grid, so the effect adds motion rather than smearing timing.</p>
            <p>· The dotted eighth is the one to try first on a clean guitar: the repeats fall between the beats and create a pulse of their own without doubling the rhythm.</p>
            <p>· Use triplets only when the groove swings. Straight triplets over a straight part read as sloppy rather than interesting.</p>
            <p>· Slapback is a delay under about {result.sixteenth ? result.sixteenth.ms.toFixed(0) : 120} ms with almost no feedback. It fattens a vocal or a rockabilly guitar without being heard as an echo.</p>
            <p>· Longer delays — half and whole notes — need a low mix and low feedback, or they fill the gaps between phrases with the previous phrase.</p>
            <p>· Try stereo offset: shorter delay on one side, slightly longer on the other, for a wide repeat that does not collide with itself.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Keeping delay out of the mud</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· High-pass the delay return. Removing everything below about 200 Hz stops the repeats competing with the bass and the kick.</p>
            <p>· Low-pass the return as well, especially for long delays. Real echoes lose high frequencies, and dulling the repeats keeps them behind the dry signal.</p>
            <p>· Feedback is the number of repeats. Above about 60% the tail runs into the next bar and the part becomes a wash.</p>
            <p>· Duck the delay with the dry signal so the repeats step back whenever the instrument is playing. This buys a louder delay without losing clarity.</p>
            <p>· Keep the delay in time with the track even after a tempo change. A synced delay drifting out is one of the most common mixing mistakes.</p>
            <p>· {result.tempo < 70 ? 'At this slow tempo, prefer half or whole note delays with feedback under 30%.' : result.tempo > 150 ? 'At this fast tempo, stick to eighth and sixteenth delays, and keep feedback low so repeats do not crowd each other.' : 'At this tempo the dotted eighth and eighth both sit comfortably; let the arrangement decide which.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Tempo', value: result.tempo + ' BPM' },
                { label: 'Beat', value: result.beat.toFixed(1) + ' ms' },
                { label: 'Dotted 8th', value: (result.beat * 0.75).toFixed(1) + ' ms' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The arithmetic in use</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>beat in ms = 60000 ÷ BPM, so {result.tempo} BPM gives {result.beat.toFixed(2)} ms</p>
          <p>whole = 4 beats · half = 2 · quarter = 1 · eighth = 0.5 · sixteenth = 0.25</p>
          <p>dotted = value × 1.5 · triplet = value × ⅔</p>
          <p>LFO rate in Hz = 1000 ÷ delay time in ms</p>
          <p className="text-cyan-j">Check: the dotted eighth is {result.beat.toFixed(1)} × 0.75 = {(result.beat * 0.75).toFixed(1)} ms.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The delay maths is exact and matches how a synced delay is implemented. The reverb and feedback suggestions are starting points drawn from how the values behave in a mix,
          not from any particular plugin.
        </p>
      </Panel>
    </ToolShell>
  );
}