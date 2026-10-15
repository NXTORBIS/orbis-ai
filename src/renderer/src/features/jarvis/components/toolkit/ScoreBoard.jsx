import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw, Star } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const formatClock = (seconds) => {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

export default function ScoreBoard() {
  const [leftName, setLeftName] = useState('Home');
  const [rightName, setRightName] = useState('Away');
  const [left, setLeft] = useState(0);
  const [right, setRight] = useState(0);
  const [period, setPeriod] = useState(1);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [countUp, setCountUp] = useState(true);
  const [limit, setLimit] = useState('10');
  const [history, setHistory] = useState([]);
  const timer = useRef(null);

  useEffect(() => {
    clearInterval(timer.current);
    if (!running) return undefined;
    timer.current = setInterval(() => {
      setSeconds((current) => {
        if (countUp) return current + 1;
        if (current <= 1) {
          setRunning(false);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer.current);
  }, [running, countUp]);

  const score = (side, delta) => {
    const stamp = new Date().toLocaleTimeString();
    if (side === 'left') {
      setLeft((value) => Math.max(0, value + delta));
      setHistory((log) => [{ side: leftName, delta, stamp, left: Math.max(0, left + delta), right }, ...log].slice(0, 30));
    } else {
      setRight((value) => Math.max(0, value + delta));
      setHistory((log) => [{ side: rightName, delta, stamp, left, right: Math.max(0, right + delta) }, ...log].slice(0, 30));
    }
  };

  const reset = () => {
    setLeft(0);
    setRight(0);
    setPeriod(1);
    setSeconds(countUp ? 0 : (Number(limit) || 10) * 60);
    setRunning(false);
    setHistory([]);
  };

  const startClock = () => {
    if (!countUp && seconds === 0) setSeconds((Number(limit) || 10) * 60);
    setRunning(true);
  };

  const report = [
    `${leftName} ${left} — ${right} ${rightName}`,
    `Period ${period} · clock ${formatClock(seconds)}${running ? ' (running)' : ''}`,
    '',
    ...history.slice(0, 12).map((entry) => `${entry.stamp}  ${entry.side} ${entry.delta > 0 ? '+' : ''}${entry.delta}  →  ${entry.left}-${entry.right}`),
  ].join('\n');

  return (
    <ToolShell
      toolId="scoreboard"
      icon={Star}
      title="Match Scoreboard"
      desc="A big, readable scoreboard for any game — home and away, periods, a match clock, and every change logged so nobody argues about it later."
      state={{ leftName, rightName, left, right, period, countUp, limit, history }}
      onRestore={(restored) => {
        if (typeof restored.leftName === 'string') setLeftName(restored.leftName);
        if (typeof restored.rightName === 'string') setRightName(restored.rightName);
        if (restored.left !== undefined) setLeft(Number(restored.left));
        if (restored.right !== undefined) setRight(Number(restored.right));
        if (restored.period) setPeriod(Number(restored.period));
        if (typeof restored.countUp === 'boolean') setCountUp(restored.countUp);
        if (restored.limit !== undefined) setLimit(String(restored.limit));
        if (Array.isArray(restored.history)) setHistory(restored.history);
      }}
      exportText={report}
      exportName="scoreboard.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
        {[
          { key: 'left', name: leftName, setName: setLeftName, value: left },
          { key: 'right', name: rightName, setName: setRightName, value: right },
        ].map((side, index) => (
          <div key={side.key} className={`tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br ${index === 0 ? 'from-cyan-j/10' : 'from-fuchsia-500/10'} to-transparent p-3 text-center ${index === 0 ? 'sm:order-1' : 'sm:order-3'}`}>
            <input
              value={side.name}
              onChange={(e) => side.setName(e.target.value)}
              className="w-full bg-transparent text-center text-xs uppercase tracking-widest text-muted-foreground outline-none"
            />
            <div className="tk-title-glow font-mono-j text-6xl font-bold text-cyan-j">{side.value}</div>
            <div className="mt-2 flex justify-center gap-1.5">
              <button type="button" onClick={() => score(side.key, 1)} className="inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
                <Plus className="h-3.5 w-3.5" /> 1
              </button>
              <button type="button" onClick={() => score(side.key, 2)} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs transition hover:border-cyan-j/50">+2</button>
              <button type="button" onClick={() => score(side.key, 3)} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs transition hover:border-cyan-j/50">+3</button>
              <button type="button" onClick={() => score(side.key, -1)} className="grid h-8 w-8 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-red-500/50">
                <Minus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        <div className="sm:order-2">
          <Panel className="!p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Period</div>
            <div className="mt-1 flex items-center justify-center gap-1.5">
              <button type="button" onClick={() => setPeriod((p) => Math.max(1, p - 1))} className="grid h-7 w-7 place-items-center rounded-lg border border-border/70 text-muted-foreground">−</button>
              <span className="font-mono-j text-2xl">{period}</span>
              <button type="button" onClick={() => setPeriod((p) => p + 1)} className="grid h-7 w-7 place-items-center rounded-lg border border-border/70 text-muted-foreground">+</button>
            </div>
            <div className={`mt-2 font-mono-j text-3xl ${running ? 'text-cyan-j' : 'text-muted-foreground'}`}>{formatClock(seconds)}</div>
            <div className="mt-2 flex justify-center gap-1.5">
              <button type="button" onClick={running ? () => setRunning(false) : startClock} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j">
                {running ? 'Pause' : 'Start'}
              </button>
              <button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground">
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => { setCountUp((v) => !v); setSeconds(!countUp ? 0 : (Number(limit) || 10) * 60); setRunning(false); }}
          className={`rounded-lg border px-3 py-2 text-xs transition ${countUp ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
        >
          {countUp ? 'Clock counting up' : 'Clock counting down'}
        </button>
        {!countUp && (
          <Field label="Countdown length (minutes)">
            <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        )}
        <CopyBtn value={report} label="Copy match log" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Scoring log</div>
        <div className="max-h-56 space-y-1 overflow-auto">
          {history.map((entry, index) => (
            <div key={`${entry.stamp}-${index}`} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
              <span className="font-mono-j text-muted-foreground">{entry.stamp}</span>
              <span>{entry.side} {entry.delta > 0 ? `+${entry.delta}` : entry.delta}</span>
              <span className="font-mono-j text-cyan-j">{entry.left}–{entry.right}</span>
            </div>
          ))}
          {!history.length && <span className="text-[11px] text-muted-foreground">No scores yet — every change will appear here with a timestamp.</span>}
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Score" value={`${left} – ${right}`} mono />
        <Stat label="Period" value={String(period)} mono />
        <Stat label="Changes" value={String(history.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Built for the kitchen table: the numbers are large enough to read across a room, and the log settles disputes about whether that third
          point was really scored. The clock keeps running if you switch tabs, and pausing stops it exactly where it stands.
        </p>
      </Panel>
    </ToolShell>
  );
}