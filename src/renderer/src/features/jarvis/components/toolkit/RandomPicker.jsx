import { useEffect, useRef, useState } from 'react';
import { Shuffle, Sparkles } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Area, Stat, Panel, ToggleRow } from './shared';

export default function RandomPicker() {
  const [text, setText] = useState('Pizza\nSushi\nBurgers\nTacos\nRamen\nSalad');
  const [allowRepeats, setAllowRepeats] = useState(true);
  const [result, setResult] = useState('');
  const [rolling, setRolling] = useState(false);
  const [used, setUsed] = useState([]);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const options = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const remaining = options.filter((o) => allowRepeats || !used.includes(o));

  const draw = () => {
    const pool = remaining.length ? remaining : options;
    if (!pool.length) return;
    setRolling(true);
    timers.current.forEach(clearTimeout);
    timers.current = [];
    let delay = 60;
    const total = 14;
    for (let i = 0; i < total; i++) {
      delay += i * 12;
      timers.current.push(setTimeout(() => {
        setResult(pool[Math.floor(Math.random() * pool.length)]);
        if (i === total - 1) {
          const winner = pool[Math.floor(Math.random() * pool.length)];
          setResult(winner);
          setRolling(false);
          setUsed((u) => (allowRepeats ? u : [winner, ...u]));
        }
      }, delay));
    }
  };

  const reset = () => { setUsed([]); setResult(''); };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Shuffle} title="Random Picker" desc="Let chance decide — draw one item from a list, with an optional no-repeat mode." />
      <Area value={text} onChange={setText} rows={8} placeholder="One option per line…" />
      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Allow repeats between draws" checked={allowRepeats} onChange={setAllowRepeats} />
        <ToggleRow label={`No-repeat pool — ${remaining.length} left`} checked={!allowRepeats} onChange={(v) => { setAllowRepeats(!v); reset(); }} />
      </div>
      <div className="grid place-items-center rounded-2xl border border-border/70 bg-card/50 px-6 py-10">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{rolling ? 'Picking…' : result ? 'Winner' : 'Ready'}</div>
        <div className={`mt-2 text-center font-display text-2xl font-bold tracking-tight transition sm:text-3xl ${rolling ? 'text-muted-foreground blur-[1px]' : 'text-cyan-j'}`}>
          {result || '—'}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={draw} disabled={rolling || options.length === 0} className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" /> {rolling ? 'Picking…' : 'Draw a winner'}
        </Button>
        {!allowRepeats && used.length > 0 && <Button size="sm" variant="outline" onClick={reset}>Reset pool</Button>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Options" value={String(options.length)} />
        <Stat label="Drawn this session" value={String(used.length)} />
      </div>
      {!allowRepeats && used.length > 0 && (
        <Panel>
          <div className="mb-1.5 text-xs text-muted-foreground">Already drawn</div>
          <div className="flex flex-wrap gap-1.5">
            {used.map((u, i) => <span key={`${u}-${i}`} className="rounded-md bg-secondary px-2 py-0.5 text-xs">{u}</span>)}
          </div>
        </Panel>
      )}
    </div>
  );
}