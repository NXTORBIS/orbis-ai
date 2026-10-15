import { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow } from './shared';

const TEMPOS = [
  { value: 60, label: 'Largo' },
  { value: 90, label: 'Andante' },
  { value: 120, label: 'Allegro' },
  { value: 160, label: 'Presto' },
];

const SUBDIVISIONS = [
  { value: 1, label: 'Beats' },
  { value: 2, label: 'Eighths' },
  { value: 3, label: 'Triplets' },
  { value: 4, label: 'Sixteenths' },
];

export default function Metronome() {
  const [bpm, setBpm] = useState(96);
  const [beats, setBeats] = useState(4);
  const [sub, setSub] = useState(1);
  const [accent, setAccent] = useState(true);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [taps, setTaps] = useState([]);

  const ctxRef = useRef(null);
  const timerRef = useRef(null);
  const nextRef = useRef(0);
  const indexRef = useRef(0);
  const displayTimers = useRef([]);
  const bpmRef = useRef(bpm);
  const beatsRef = useRef(beats);
  const subRef = useRef(sub);
  const accentRef = useRef(accent);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { beatsRef.current = beats; }, [beats]);
  useEffect(() => { subRef.current = sub; }, [sub]);
  useEffect(() => { accentRef.current = accent; }, [accent]);

  const click = (time, index) => {
    const ctx = ctxRef.current;
    const perBar = beatsRef.current * subRef.current;
    const isAccent = accentRef.current && index % perBar === 0;
    const isMain = index % subRef.current === 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = isAccent ? 1500 : isMain ? 1050 : 760;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(isAccent ? 0.5 : isMain ? 0.32 : 0.16, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.08);
  };

  const tick = () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    while (nextRef.current < ctx.currentTime + 0.2) {
      click(nextRef.current, indexRef.current);
      const index = indexRef.current;
      const delay = Math.max(0, (nextRef.current - ctx.currentTime) * 1000);
      displayTimers.current.push(setTimeout(() => setBeat(index % (beatsRef.current * subRef.current)), delay));
      nextRef.current += 60 / bpmRef.current / subRef.current;
      indexRef.current += 1;
    }
    if (displayTimers.current.length > 80) displayTimers.current = displayTimers.current.slice(-40);
  };

  const stop = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    displayTimers.current.forEach(clearTimeout);
    displayTimers.current = [];
    setRunning(false);
    setBeat(-1);
  };

  const start = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume();
    nextRef.current = ctx.currentTime + 0.06;
    indexRef.current = 0;
    tick();
    timerRef.current = setInterval(tick, 25);
    setRunning(true);
  };

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    displayTimers.current.forEach(clearTimeout);
    const ctx = ctxRef.current;
    if (ctx) { try { ctx.close(); } catch { /* already closed */ } }
  }, []);

  const tap = () => {
    const now = Date.now();
    const recent = [...taps.filter((t) => now - t < 3000), now].slice(-6);
    setTaps(recent);
    if (recent.length >= 2) {
      const gaps = recent.slice(1).map((t, i) => t - recent[i]);
      const average = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      setBpm(Math.round(Math.min(240, Math.max(30, 60000 / average))));
    }
  };

  const beatCount = beats * sub;
  const currentMain = beat < 0 ? -1 : Math.floor(beat / sub);

  return (
    <ToolShell
      toolId="metronome"
      icon={Activity}
      title="Metronome"
      desc="Steady time keeping with accents, subdivisions and tap tempo — the clicks are scheduled in the audio engine, so they stay even."
      state={{ bpm, beats, sub, accent }}
      onRestore={(saved) => {
        setBpm(saved.bpm ?? 96); setBeats(saved.beats ?? 4);
        setSub(saved.sub ?? 1); setAccent(saved.accent ?? true);
      }}
      exportText={`${running ? 'Running' : 'Stopped'} · ${bpm} BPM · ${beats}/4 · ${SUBDIVISIONS.find((s) => s.value === sub)?.label || 'beats'}${accent ? ' · accent on beat 1' : ''}`}
      exportName="metronome.txt"
    >
      <Panel className="text-center">
        <div className="font-mono-j text-4xl font-semibold text-cyan-j">{bpm}</div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">beats per minute</div>
        <div className="mt-3 flex items-center justify-center gap-2">
          <button type="button" onClick={() => setBpm((v) => Math.max(30, v - 1))} className="h-8 w-8 rounded-lg border border-border/70 text-sm">−</button>
          <button
            type="button"
            onClick={running ? stop : start}
            className={`rounded-lg border px-5 py-1.5 text-xs font-medium transition ${running ? 'border-red-500/60 text-red-500' : 'border-cyan-j/60 text-cyan-j hover:bg-cyan-j/10'}`}
          >
            {running ? 'Stop' : 'Start'}
          </button>
          <button type="button" onClick={() => setBpm((v) => Math.min(240, v + 1))} className="h-8 w-8 rounded-lg border border-border/70 text-sm">+</button>
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          {Array.from({ length: beats }, (_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full transition ${currentMain === i ? 'scale-125 bg-cyan-j' : 'bg-border'}`}
              style={{ boxShadow: currentMain === i ? '0 0 12px hsl(var(--cyan) / 0.8)' : 'none' }}
            />
          ))}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          beat {currentMain < 0 ? '—' : currentMain + 1} of {beats} · {SUBDIVISIONS.find((s) => s.value === sub)?.label.toLowerCase()}
        </div>
      </Panel>

      <Field label={`Tempo · ${bpm} BPM`}>
        <input type="range" min={30} max={240} value={bpm} onChange={(e) => setBpm(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Seg value={sub} onChange={setSub} options={SUBDIVISIONS} />

      <div className="flex flex-wrap gap-1.5">
        {TEMPOS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setBpm(t.value)}
            className="rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
          >
            {t.label} · {t.value}
          </button>
        ))}
        <button
          type="button"
          onClick={tap}
          className="rounded-lg border border-cyan-j/50 px-2.5 py-1.5 text-[11px] text-cyan-j transition hover:bg-cyan-j/10"
        >
          Tap tempo{taps.length >= 2 ? ` (${taps.length} taps)` : ''}
        </button>
      </div>

      <Field label="Beats in a bar">
        <select value={beats} onChange={(e) => setBeats(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
          {[2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}/4</option>)}
        </select>
      </Field>

      <ToggleRow label="Accent the first beat" checked={accent} onChange={setAccent} hint="louder click" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Subdivisions" value={String(beatCount)} />
        <Stat label="Pace" value={`${Math.round(60000 / bpm)} ms per beat`} mono />
        <Stat label="Bar length" value={`${((60 / bpm) * beats).toFixed(2)} s`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Clicks are queued a fraction of a second ahead in the audio engine, so the beat stays steady even when this tab is busy.
          Tempo, accents and subdivision can all change while it runs. Two or three taps set the tempo if you are following a recording.
        </p>
      </Panel>
    </ToolShell>
  );
}