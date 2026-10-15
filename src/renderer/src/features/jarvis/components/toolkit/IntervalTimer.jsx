import { useEffect, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Stat } from './shared';

const PRESETS = {
  Tabata: { prepare: 10, work: 20, rest: 10, rounds: 8 },
  HIIT: { prepare: 10, work: 40, rest: 20, rounds: 8 },
  EMOM: { prepare: 5, work: 60, rest: 0, rounds: 10 },
  Sprint: { prepare: 8, work: 30, rest: 90, rounds: 4 },
  Custom: { prepare: 10, work: 45, rest: 15, rounds: 6 },
};

const TONES = {
  prepare: { label: 'Get ready', colour: 'text-amber-400', ring: 'from-amber-400 to-amber-200' },
  work: { label: 'Work', colour: 'text-cyan-j', ring: 'from-cyan-j to-fuchsia-500' },
  rest: { label: 'Rest', colour: 'text-violet-400', ring: 'from-violet-500 to-indigo-400' },
  done: { label: 'Finished', colour: 'text-emerald-400', ring: 'from-emerald-400 to-teal-300' },
  idle: { label: 'Ready', colour: 'text-muted-foreground', ring: 'from-border to-border' },
};

const clock = (seconds) => {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${String(minutes).padStart(2, '0')}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
};

export default function IntervalTimer() {
  const [preset, setPreset] = useState('Tabata');
  const [cfg, setCfg] = useState({ ...PRESETS.Tabata });
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [round, setRound] = useState(1);
  const [remaining, setRemaining] = useState(0);

  const endRef = useRef(0);
  const ctxRef = useRef(null);
  const lastWholeRef = useRef(-1);

  const beep = (freq, length) => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.005);
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

  const durationFor = (name, config) => (name === 'prepare' ? config.prepare : name === 'work' ? config.work : config.rest);

  const advance = () => {
    if (phase === 'prepare') {
      beep(1240, 0.14);
      setPhase('work');
    } else if (phase === 'work') {
      if (round >= cfg.rounds) {
        beep(880, 0.35);
        setPhase('done');
        setRunning(false);
      } else if (cfg.rest > 0) {
        beep(520, 0.14);
        setPhase('rest');
      } else {
        setRound((r) => r + 1);
        beep(1240, 0.14);
      }
    } else if (phase === 'rest') {
      setRound((r) => r + 1);
      beep(1240, 0.14);
      setPhase('work');
    } else {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (!running || phase === 'idle' || phase === 'done') return undefined;
    const total = durationFor(phase, cfg);
    endRef.current = Date.now() + total * 1000;
    setRemaining(total);
    lastWholeRef.current = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, round]);

  useEffect(() => {
    if (!running || phase === 'idle' || phase === 'done') return undefined;
    const id = setInterval(() => {
      const left = Math.max(0, (endRef.current - Date.now()) / 1000);
      setRemaining(left);
      const whole = Math.ceil(left);
      if (whole <= 3 && whole >= 1 && whole !== lastWholeRef.current) {
        lastWholeRef.current = whole;
        beep(760, 0.06);
      }
      if (left <= 0.02) advance();
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, phase, round, cfg]);

  const start = () => {
    ensureAudio();
    const first = phase === 'idle' || phase === 'done' ? 'prepare' : phase;
    setRound(1);
    beep(980, 0.1);
    setPhase(first);
    setRunning(true);
  };

  const pause = () => setRunning(false);

  const reset = () => {
    setRunning(false);
    setPhase('idle');
    setRound(1);
    setRemaining(0);
  };

  const skip = () => { if (phase !== 'idle' && phase !== 'done') advance(); };

  const applyPreset = (name) => {
    setPreset(name);
    setCfg({ ...PRESETS[name] });
    reset();
  };

  const total = durationFor(phase, cfg) || 1;
  const progress = phase === 'idle' ? 0 : phase === 'done' ? 1 : 1 - remaining / total;
  const tone = TONES[phase] || TONES.idle;

  return (
    <ToolShell
      toolId="interval-timer"
      icon={Timer}
      title="Interval Timer"
      desc="Work and rest rounds with spoken-plan style beeps — Tabata, HIIT, EMOM or your own numbers."
      state={{ preset, cfg }}
      onRestore={(saved) => {
        if (saved.cfg) setCfg(saved.cfg);
        if (saved.preset) setPreset(saved.preset);
      }}
      exportText={`${preset}: prepare ${cfg.prepare}s · work ${cfg.work}s · rest ${cfg.rest}s · ${cfg.rounds} rounds (total ${Math.round((cfg.prepare + cfg.rounds * cfg.work + Math.max(0, cfg.rounds - 1) * cfg.rest) / 6) / 10} min)`}
      exportName="interval-workout.txt"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(PRESETS).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => applyPreset(name)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${preset === name ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {name}
          </button>
        ))}
      </div>

      <Panel className="text-center">
        <div className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${tone.colour}`}>{tone.label}</div>
        <div className="mt-1 font-mono-j text-5xl font-bold tabular-nums">{clock(phase === 'idle' ? cfg.work : remaining)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          round {phase === 'done' ? cfg.rounds : round} of {cfg.rounds}
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className={`h-full rounded-full bg-gradient-to-r ${tone.ring} transition-[width] duration-100`} style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={running ? pause : start}
            className={`rounded-lg border px-5 py-1.5 text-xs font-medium transition ${running ? 'border-amber-500/60 text-amber-500' : 'border-cyan-j/60 text-cyan-j hover:bg-cyan-j/10'}`}
          >
            {running ? 'Pause' : phase === 'idle' || phase === 'done' ? 'Start' : 'Resume'}
          </button>
          <button type="button" onClick={skip} disabled={phase === 'idle' || phase === 'done'} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40">
            Skip
          </button>
          <button type="button" onClick={reset} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
            Reset
          </button>
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {Array.from({ length: cfg.rounds }, (_, i) => (
            <span key={i} className={`h-2 w-2 rounded-full transition ${i + 1 < round || phase === 'done' ? 'bg-cyan-j' : i + 1 === round ? 'scale-125 bg-cyan-j/70' : 'bg-border'}`} />
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Prepare · ${cfg.prepare}s`}>
          <input type="range" min={0} max={30} value={cfg.prepare} onChange={(e) => { setCfg((c) => ({ ...c, prepare: Number(e.target.value) })); setPreset('Custom'); }} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Work · ${cfg.work}s`}>
          <input type="range" min={5} max={180} step={5} value={cfg.work} onChange={(e) => { setCfg((c) => ({ ...c, work: Number(e.target.value) })); setPreset('Custom'); }} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Rest · ${cfg.rest}s`}>
          <input type="range" min={0} max={180} step={5} value={cfg.rest} onChange={(e) => { setCfg((c) => ({ ...c, rest: Number(e.target.value) })); setPreset('Custom'); }} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <Field label={`Rounds · ${cfg.rounds}`}>
        <input type="range" min={1} max={30} value={cfg.rounds} onChange={(e) => { setCfg((c) => ({ ...c, rounds: Number(e.target.value) })); setPreset('Custom'); }} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Work time" value={`${(cfg.work * cfg.rounds / 60).toFixed(1)} min`} mono />
        <Stat label="Rest time" value={`${(cfg.rest * Math.max(0, cfg.rounds - 1) / 60).toFixed(1)} min`} mono />
        <Stat label="Whole session" value={`${((cfg.prepare + cfg.work * cfg.rounds + cfg.rest * Math.max(0, cfg.rounds - 1)) / 60).toFixed(1)} min`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A tone marks each change of phase, with three short ticks counting you into every work block. Tabata's 20 seconds on, 10 off for eight rounds is
          the classic; EMOM gives each round a full minute. Keep the tab in view — browsers slow timers in background tabs.
        </p>
      </Panel>
    </ToolShell>
  );
}