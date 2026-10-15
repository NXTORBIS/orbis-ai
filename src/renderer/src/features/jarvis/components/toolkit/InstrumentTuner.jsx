import { useEffect, useMemo, useRef, useState } from 'react';
import { Music, Play, Square } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Seg, Stat, Unsupported } from './shared';

const INSTRUMENTS = {
  guitar: { label: 'Guitar', strings: [{ name: 'E2', hz: 82.41 }, { name: 'A2', hz: 110.0 }, { name: 'D3', hz: 146.83 }, { name: 'G3', hz: 196.0 }, { name: 'B3', hz: 246.94 }, { name: 'E4', hz: 329.63 }] },
  bass: { label: 'Bass', strings: [{ name: 'E1', hz: 41.2 }, { name: 'A1', hz: 55.0 }, { name: 'D2', hz: 73.42 }, { name: 'G2', hz: 98.0 }] },
  ukulele: { label: 'Ukulele', strings: [{ name: 'G4', hz: 392.0 }, { name: 'C4', hz: 261.63 }, { name: 'E4', hz: 329.63 }, { name: 'A4', hz: 440.0 }] },
  violin: { label: 'Violin', strings: [{ name: 'G3', hz: 196.0 }, { name: 'D4', hz: 293.66 }, { name: 'A4', hz: 440.0 }, { name: 'E5', hz: 659.26 }] },
  chromatic: { label: 'Any note', strings: [] },
};

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const frequencyToNote = (frequency, reference) => {
  if (!frequency) return null;
  const midi = 69 + 12 * Math.log2(frequency / reference);
  const rounded = Math.round(midi);
  const cents = Math.round((midi - rounded) * 100);
  const name = NOTES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, cents, label: `${name}${octave}` };
};

const detectPitch = (buffer, sampleRate) => {
  const size = buffer.length;
  let rms = 0;
  for (let i = 0; i < size; i += 1) rms += buffer[i] * buffer[i];
  rms = Math.sqrt(rms / size);
  if (rms < 0.008) return null;
  let start = 0;
  let end = size - 1;
  const threshold = 0.2;
  while (start < size / 2 && Math.abs(buffer[start]) < threshold) start += 1;
  while (end > size / 2 && Math.abs(buffer[end]) < threshold) end -= 1;
  const slice = buffer.slice(start, end);
  const length = slice.length;
  const correlations = new Float32Array(length);
  for (let lag = 0; lag < length; lag += 1) {
    let sum = 0;
    for (let i = 0; i < length - lag; i += 1) sum += slice[i] * slice[i + lag];
    correlations[lag] = sum;
  }
  let best = -1;
  let bestLag = -1;
  for (let lag = 2; lag < length; lag += 1) {
    if (correlations[lag] > best) {
      best = correlations[lag];
      bestLag = lag;
    }
  }
  if (bestLag <= 0) return null;
  const frequency = sampleRate / bestLag;
  return frequency > 40 && frequency < 1200 ? frequency : null;
};

export default function InstrumentTuner() {
  const [instrument, setInstrument] = useState('guitar');
  const [reference, setReference] = useState(440);
  const [running, setRunning] = useState(false);
  const [frequency, setFrequency] = useState(null);
  const [stable, setStable] = useState(null);
  const [error, setError] = useState(false);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const historyRef = useRef([]);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.close?.().catch(() => {});
    streamRef.current = null;
    audioRef.current = null;
    setRunning(false);
    setFrequency(null);
    setStable(null);
  };

  useEffect(() => () => stop(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      streamRef.current = stream;
      audioRef.current = { context, analyser };
      setRunning(true);
      const buffer = new Float32Array(analyser.fftSize);

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        const detected = detectPitch(buffer, context.sampleRate);
        if (detected) {
          setFrequency(detected);
          historyRef.current = [...historyRef.current, detected].slice(-5);
          const average = historyRef.current.reduce((sum, f) => sum + f, 0) / historyRef.current.length;
          setStable(average);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setError(true);
      setRunning(false);
    }
  };

  const note = useMemo(() => frequencyToNote(stable ?? frequency, reference), [stable, frequency, reference]);
  const strings = INSTRUMENTS[instrument].strings;
  const closest = useMemo(() => {
    if (!strings.length || !frequency) return null;
    const match = strings.reduce((best, current) => (Math.abs(1200 * Math.log2(frequency / current.hz)) < Math.abs(1200 * Math.log2(frequency / best.hz)) ? current : best), strings[0]);
    const cents = Math.round(1200 * Math.log2(frequency / match.hz));
    return { ...match, cents };
  }, [strings, frequency]);

  const cents = closest?.cents ?? note?.cents ?? 0;
  const inTune = Math.abs(cents) <= 5;
  const needle = Math.max(-50, Math.min(50, cents));

  return (
    <ToolShell
      toolId="tuner"
      icon={Music}
      title="Instrument Tuner"
      desc="Tune a guitar, bass, ukulele or violin by ear-free accuracy — the microphone hears the note, this tells you how far off you are in cents."
      state={{ instrument, reference }}
      onRestore={(restored) => {
        if (restored.instrument) setInstrument(restored.instrument);
        if (restored.reference) setReference(Number(restored.reference));
      }}
      exportText={frequency ? `Detected ${frequency.toFixed(1)} Hz · nearest note ${note?.label ?? '—'} (${cents} cents)\nReference A4 = ${reference} Hz` : ''}
      exportName="tuning.txt"
    >
      {error ? (
        <Unsupported msg="The browser would not let this page use your microphone. Allow microphone access, or open the app over https in Chrome, Edge or Safari." />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-red-500/50">
              <Square className="h-3.5 w-3.5" /> Stop listening
            </button>
          ) : (
            <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              <Play className="h-3.5 w-3.5" /> Start tuning
            </button>
          )}
          <Seg value={instrument} onChange={setInstrument} options={Object.entries(INSTRUMENTS).map(([id, value]) => ({ value: id, label: value.label }))} />
        </div>
      )}

      <div className={`tk-card tk-glow-ring rounded-xl border p-4 text-center ${inTune && running ? 'border-emerald-500/60' : 'border-cyan-j/40'} bg-gradient-to-br from-cyan-j/10 to-transparent`}>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Nearest note</div>
        <div className={`tk-title-glow mt-1 font-display text-4xl font-bold ${inTune && running ? 'text-emerald-400' : 'text-cyan-j'}`}>
          {running && frequency ? note?.label || '—' : '—'}
        </div>
        <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">
          {running && frequency ? `${frequency.toFixed(1)} Hz · ${cents > 0 ? '+' : ''}${cents} cents ${inTune ? '· in tune' : cents > 0 ? '· sharp' : '· flat'}` : 'Play a single note clearly'}
        </div>

        <div className="relative mx-auto mt-4 h-3 w-full max-w-sm overflow-hidden rounded-full border border-border/70 bg-card/60">
          <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border/80 bg-card" />
          {running && frequency && (
            <div
              className={`absolute top-0 h-full w-2 rounded-full ${inTune ? 'bg-emerald-400' : 'bg-cyan-j'}`}
              style={{ left: `calc(50% + ${(needle / 50) * 50}% - 4px)` }}
            />
          )}
        </div>
        <div className="mt-1 flex justify-between font-mono-j text-[9px] text-muted-foreground">
          <span>−50 flat</span><span>0</span><span>+50 sharp</span>
        </div>
      </div>

      {!!strings.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Strings to aim for</div>
          <div className="space-y-1">
            {strings.map((string) => {
              const active = closest && closest.name === string.name;
              const deviation = frequency ? Math.round(1200 * Math.log2(frequency / string.hz)) : null;
              return (
                <div key={string.name} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${active ? 'border-cyan-j/50 bg-cyan-j/5 text-cyan-j' : 'border-border/50 bg-card/40'}`}>
                  <span className="font-mono-j">{string.name}</span>
                  <span className="font-mono-j text-muted-foreground">{string.hz.toFixed(2)} Hz</span>
                  <span className="font-mono-j">{active && deviation !== null ? `${deviation > 0 ? '+' : ''}${deviation} cents` : ''}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Reference pitch · A4 = ${reference} Hz`} hint="440 is standard; orchestras sometimes tune to 442 or 415">
          <input type="range" min={415} max={446} value={reference} onChange={(e) => setReference(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Note" value={note?.label || '—'} mono />
          <Stat label="Cents" value={frequency ? `${cents > 0 ? '+' : ''}${cents}` : '—'} mono />
          <Stat label="Stability" value={historyRef.current.length >= 4 ? 'good' : 'listening'} mono />
        </div>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Pluck or bow one string at a time and let it ring — the reading settles fastest on a clean single note and jumps around if two strings sound
          together. Being within five cents is as in-tune as most ears can hear; the meter shows whether you should tighten or loosen. Tune up to
          pitch where you can, since strings hold tuning better when the last turn was upward.
        </p>
      </Panel>
    </ToolShell>
  );
}