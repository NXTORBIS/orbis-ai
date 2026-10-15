import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Stat, ToggleRow } from './shared';

const PRESETS = [
  { label: 'Bullet 1+0', base: 1, inc: 0 },
  { label: 'Blitz 3+2', base: 3, inc: 2 },
  { label: 'Blitz 5+3', base: 5, inc: 3 },
  { label: 'Rapid 10+0', base: 10, inc: 0 },
  { label: 'Rapid 15+10', base: 15, inc: 10 },
  { label: 'Classical 30+30', base: 30, inc: 30 },
];

const show = (ms) => {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
};

export default function ChessClock() {
  const [base, setBase] = useState(3);
  const [inc, setInc] = useState(2);
  const [times, setTimes] = useState({ white: 3 * 60000, black: 3 * 60000 });
  const [active, setActive] = useState(null);
  const [running, setRunning] = useState(false);
  const [moves, setMoves] = useState({ white: 0, black: 0 });
  const [flagged, setFlagged] = useState('');
  const [sound, setSound] = useState(true);

  const lastRef = useRef(0);
  const ctxRef = useRef(null);
  const warnedRef = useRef({ white: false, black: false });

  const beep = (freq, length) => {
    const ctx = ctxRef.current;
    if (!ctx || !sound) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length + 0.02);
  };

  const ensureAudio = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
  };

  useEffect(() => () => {
    const ctx = ctxRef.current;
    if (ctx) { try { ctx.close(); } catch { /* already closed */ } }
  }, []);

  useEffect(() => {
    if (!running || !active || flagged) return undefined;
    lastRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = now - lastRef.current;
      lastRef.current = now;
      setTimes((t) => ({ ...t, [active]: Math.max(0, t[active] - delta) }));
    }, 100);
    return () => clearInterval(id);
  }, [running, active, flagged]);

  useEffect(() => {
    ['white', 'black'].forEach((side) => {
      const left = times[side];
      if (left <= 0) {
        if (!flagged) {
          setFlagged(side);
          setRunning(false);
          setActive(null);
          ensureAudio();
          beep(300, 0.4);
        }
        return;
      }
      if (left <= 10000 && !warnedRef.current[side]) {
        warnedRef.current[side] = true;
        beep(880, 0.08);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times]);

  const applyPreset = (preset) => {
    setBase(preset.base);
    setInc(preset.inc);
    setTimes({ white: preset.base * 60000, black: preset.base * 60000 });
    setActive(null);
    setRunning(false);
    setMoves({ white: 0, black: 0 });
    setFlagged('');
    warnedRef.current = { white: false, black: false };
  };

  const reset = () => {
    setTimes({ white: base * 60000, black: base * 60000 });
    setActive(null);
    setRunning(false);
    setMoves({ white: 0, black: 0 });
    setFlagged('');
    warnedRef.current = { white: false, black: false };
  };

  const tap = (side) => {
    ensureAudio();
    if (flagged) return;
    if (active === side) {
      setRunning((r) => !r);
      return;
    }
    const previous = active;
    setMoves((m) => (previous ? { ...m, [previous]: m[previous] + 1 } : m));
    if (previous && inc > 0) setTimes((t) => ({ ...t, [previous]: t[previous] + inc * 1000 }));
    setActive(side);
    setRunning(true);
    beep(660, 0.05);
  };

  const low = (side) => times[side] <= 10000;

  const side = (name, label) => (
    <button
      type="button"
      onClick={() => tap(name)}
      className={`w-full rounded-2xl border p-4 text-left transition ${active === name ? 'border-cyan-j bg-cyan-j/10 tk-glow-ring' : 'border-border/70 bg-card/60'} ${flagged === name ? 'border-red-500/60 bg-red-500/10' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{moves[name]} moves</span>
      </div>
      <div className={`mt-1 font-mono-j text-4xl font-bold tabular-nums ${low(name) ? 'text-red-500' : active === name ? 'text-cyan-j' : ''}`}>
        {show(times[name])}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {flagged === name ? 'time is up' : active === name ? 'running — tap to pause' : 'tap to start this clock'}
      </div>
    </button>
  );

  return (
    <ToolShell
      toolId="chess-clock"
      icon={Timer}
      title="Chess Clock"
      desc="A two-player clock with increments for over-the-board games — tap a side to hand the turn over."
      state={{ base, inc, sound }}
      onRestore={(saved) => {
        if (saved.base !== undefined) { setBase(saved.base); setTimes({ white: saved.base * 60000, black: saved.base * 60000 }); }
        if (saved.inc !== undefined) setInc(saved.inc);
        setSound(saved.sound ?? true);
      }}
      exportText={`${base}+${inc} · white ${show(times.white)} (${moves.white} moves) · black ${show(times.black)} (${moves.black} moves)${flagged ? ` · ${flagged} flagged` : ''}`}
      exportName="chess-clock.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => applyPreset(p)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${base === p.base && inc === p.inc ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3">
        {side('black', 'Black')}
        {side('white', 'White')}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { ensureAudio(); setRunning((r) => (active ? !r : r)); }}
          disabled={!active || !!flagged}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40"
        >
          {running ? 'Pause' : 'Resume'}
        </button>
        <button type="button" onClick={reset} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
          Reset to {base}+{inc}
        </button>
        <button
          type="button"
          onClick={() => setTimes((t) => ({ white: t.black, black: t.white }))}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50"
        >
          Swap sides
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Start time · ${base} min`}>
          <input type="range" min={1} max={60} value={base} onChange={(e) => { setBase(Number(e.target.value)); }} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Increment · ${inc}s per move`}>
          <input type="range" min={0} max={60} value={inc} onChange={(e) => setInc(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <ToggleRow label="Clicks and flag warnings" checked={sound} onChange={setSound} hint="soft tones" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Time control" value={`${base}+${inc}`} mono />
        <Stat label="Moves played" value={String(moves.white + moves.black)} />
        <Stat label="Status" value={flagged ? `${flagged} flagged` : running ? `${active} to move` : 'paused'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Tap the clock of the side whose turn it now is — the opponent's time stops and gains its increment. Tap the running side to pause.
          The tenths appear so bullet games stay honest; keep this tab open, since browsers throttle background timers.
        </p>
      </Panel>
    </ToolShell>
  );
}