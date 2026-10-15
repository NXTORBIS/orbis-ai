import { useEffect, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat } from './shared';

const WAVES = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Saw' },
];

const NOTES = ['C4', 'E4', 'G4', 'A4', 'C5', 'E5', 'A5'];

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

const noteToFreq = (note) => {
  const letter = note[0];
  const octave = Number(note[note.length - 1]);
  const semitone = NOTE_INDEX[letter] + (note.includes('#') ? 1 : 0);
  const midi = 12 * (octave + 1) + semitone;
  return 440 * 2 ** ((midi - 69) / 12);
};

const freqToNote = (freq) => {
  if (!freq) return '—';
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

export default function ToneGenerator() {
  const [wave, setWave] = useState('sine');
  const [freq, setFreq] = useState(440);
  const [volume, setVolume] = useState(30);
  const [pan, setPan] = useState(50);
  const [mode, setMode] = useState('steady');
  const [endFreq, setEndFreq] = useState(1200);
  const [sweepSeconds, setSweepSeconds] = useState(4);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');

  const ctxRef = useRef(null);
  const nodesRef = useRef(null);
  const stopTimerRef = useRef(null);

  const teardown = () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    const nodes = nodesRef.current;
    if (nodes) {
      try {
        nodes.gain.gain.cancelScheduledValues(ctxRef.current.currentTime);
        nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, ctxRef.current.currentTime);
        nodes.gain.gain.linearRampToValueAtTime(0, ctxRef.current.currentTime + 0.04);
        nodes.osc.stop(ctxRef.current.currentTime + 0.06);
      } catch {
        /* already stopped */
      }
    }
    nodesRef.current = null;
    setPlaying(false);
  };

  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    const nodes = nodesRef.current;
    const ctx = ctxRef.current;
    if (nodes && ctx) {
      try { nodes.osc.stop(); } catch { /* already stopped */ }
    }
    if (ctx) { try { ctx.close(); } catch { /* already closed */ } }
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    const nodes = nodesRef.current;
    if (!ctx || !nodes) return;
    try {
      nodes.gain.gain.setTargetAtTime((volume / 100) * 0.35, ctx.currentTime, 0.02);
      if (nodes.panner) nodes.panner.pan.setTargetAtTime((pan - 50) / 50, ctx.currentTime, 0.02);
    } catch {
      /* node already stopped */
    }
  }, [volume, pan]);

  useEffect(() => {
    const ctx = ctxRef.current;
    const nodes = nodesRef.current;
    if (!ctx || !nodes) return;
    try {
      nodes.osc.type = wave;
      if (mode === 'steady') nodes.osc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02);
    } catch {
      /* node already stopped */
    }
  }, [wave, freq, mode]);

  const start = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      setError('This browser has no audio engine available.');
      return;
    }
    setError('');
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (mode === 'sweep') {
      osc.frequency.linearRampToValueAtTime(Math.max(20, endFreq), ctx.currentTime + sweepSeconds);
    }
    const level = (volume / 100) * 0.35;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(level, ctx.currentTime + 0.03);

    let tail = gain;
    let panner = null;
    if (ctx.createStereoPanner) {
      panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime((pan - 50) / 50, ctx.currentTime);
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(ctx.destination);

    osc.connect(gain);
    osc.start();

    nodesRef.current = { osc, gain, panner };
    setPlaying(true);

    if (mode === 'sweep') stopTimerRef.current = setTimeout(teardown, (sweepSeconds + 0.2) * 1000);
  };

  return (
    <ToolShell
      toolId="tone"
      icon={Radio}
      title="Tone & Signal Generator"
      desc="Play steady tones and sweeps for testing speakers, tuning, sound design or ear training."
      state={{ wave, freq, volume, pan, mode, endFreq, sweepSeconds }}
      onRestore={(saved) => {
        setWave(saved.wave || 'sine'); setFreq(saved.freq ?? 440); setVolume(saved.volume ?? 30);
        setPan(saved.pan ?? 50); setMode(saved.mode || 'steady');
        setEndFreq(saved.endFreq ?? 1200); setSweepSeconds(saved.sweepSeconds ?? 4);
      }}
      exportText={`${mode === 'sweep' ? 'Sweep' : 'Tone'} · ${wave} · ${freq} Hz${mode === 'sweep' ? ` → ${endFreq} Hz over ${sweepSeconds}s` : ''} · note ${freqToNote(freq)}`}
      exportName="tone.txt"
    >
      <Panel className="text-center">
        <div className="font-mono-j text-3xl font-semibold text-cyan-j">{freq} Hz</div>
        <div className="mt-1 text-xs text-muted-foreground">
          nearest note {freqToNote(freq)} · {wave} wave · {pan < 45 ? 'left' : pan > 55 ? 'right' : 'centre'}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={playing ? teardown : start}
            className={`rounded-lg border px-4 py-1.5 text-xs font-medium transition ${playing ? 'border-red-500/60 text-red-500' : 'border-cyan-j/60 text-cyan-j hover:bg-cyan-j/10'}`}
          >
            {playing ? 'Stop' : mode === 'sweep' ? 'Play sweep' : 'Play tone'}
          </button>
          <span className="text-[11px] text-muted-foreground">{playing ? 'playing — keep the volume kind' : 'starts quietly, then ramps in'}</span>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-500">{error}</p>}
      </Panel>

      <Seg value={mode} onChange={setMode} options={[{ value: 'steady', label: 'Steady tone' }, { value: 'sweep', label: 'Frequency sweep' }]} />
      <Seg value={wave} onChange={setWave} options={WAVES} />

      <Field label={`Frequency · ${freq} Hz`}>
        <input type="range" min={20} max={15000} step={1} value={freq} onChange={(e) => setFreq(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label="Quick notes">
        <div className="flex flex-wrap gap-1.5">
          {NOTES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setFreq(Math.round(noteToFreq(n)))}
              className="rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
            >
              {n} · {Math.round(noteToFreq(n))}
            </button>
          ))}
        </div>
      </Field>

      {mode === 'sweep' && (
        <>
          <Field label={`Sweep to · ${endFreq} Hz`}>
            <input type="range" min={40} max={16000} step={10} value={endFreq} onChange={(e) => setEndFreq(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
          <Field label={`Sweep length · ${sweepSeconds}s`}>
            <input type="range" min={1} max={20} value={sweepSeconds} onChange={(e) => setSweepSeconds(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        </>
      )}

      <Field label={`Volume · ${volume}%`}>
        <input type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Pan · ${pan < 45 ? 'left' : pan > 55 ? 'right' : 'centre'}`}>
        <input type="range" min={0} max={100} value={pan} onChange={(e) => setPan(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Note" value={freqToNote(freq)} mono />
        <Stat label="Wave" value={wave} />
        <Stat label="Mode" value={mode === 'sweep' ? `${sweepSeconds}s sweep` : 'steady'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Tone {freq} Hz sits {freq < 200 ? 'in the bass' : freq < 2000 ? 'in the vocal range' : freq < 5000 ? 'in the presence range' : 'high up where hearing varies most'}.
          Wave, frequency, volume and pan all change live while a tone plays. Keep levels low and give your ears a break.
        </p>
      </Panel>
    </ToolShell>
  );
}