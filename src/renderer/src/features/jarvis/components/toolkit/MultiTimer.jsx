import { useEffect, useRef, useState } from 'react';
import { Clock, Play, Pause, Trash2, Plus } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Field } from './shared';

const STORE_KEY = 'toolkit:multi-timers';

export default function MultiTimer() {
  const [timers, setTimers] = useState(() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } });
  const [name, setName] = useState('');
  const [secs, setSecs] = useState(300);
  const rafRef = useRef(null);

  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(timers.map((t) => ({ id: t.id, name: t.name, total: t.total })))); }, [timers]);

  useEffect(() => {
    const tick = () => {
      setTimers((ts) => ts.map((t) => {
        if (!t.running || t.remaining <= 0) return t;
        const r = Math.max(0, t.remaining - 1);
        if (r === 0 && t.remaining > 0) notify(t.name);
        return { ...t, remaining: r, running: r > 0 ? t.running : false };
      }));
      rafRef.current = requestAnimationFrame(() => setTimeout(tick, 1000));
    };
    rafRef.current = requestAnimationFrame(() => setTimeout(tick, 1000));
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const notify = (n) => {
    try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6); o.start(); o.stop(ctx.currentTime + 0.6); } catch {}
    if (Notification?.permission === 'granted') new Notification('Timer finished', { body: n || 'Your timer is done.' });
  };

  const add = () => {
    const s = Math.max(1, +secs || 1);
    setTimers((ts) => [...ts, { id: crypto.randomUUID(), name: name.trim() || `Timer ${ts.length + 1}`, total: s, remaining: s, running: false }]);
    setName('');
  };
  const toggle = (id) => setTimers((ts) => ts.map((t) => t.id === id ? { ...t, running: !t.running } : t));
  const reset = (id) => setTimers((ts) => ts.map((t) => t.id === id ? { ...t, remaining: t.total, running: false } : t));
  const remove = (id) => setTimers((ts) => ts.filter((t) => t.id !== id));

  const fmt = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return `${h ? h + ':' : ''}${String(m).padStart(h ? 2 : 0, '0')}:${String(sec).padStart(2, '0')}`; };
  const pct = (t) => t.total ? ((t.total - t.remaining) / t.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Clock} title="Multi-Timer" desc="Run several independent named timers at once, with sound and notification on completion." />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Oven" className="w-32" /></Field>
        <Field label="Seconds"><Input type="number" value={secs} onChange={(e) => setSecs(+e.target.value || 0)} className="w-24" /></Field>
        <Button size="sm" onClick={add} className="gap-1.5 mb-0.5"><Plus className="h-4 w-4" /> Add timer</Button>
        <Button size="sm" variant="ghost" onClick={() => Notification?.requestPermission?.()} className="mb-0.5">Enable notifications</Button>
      </div>
      <div className="space-y-2">
        {timers.length === 0 && <p className="text-sm text-muted-foreground">No timers yet. Add one above.</p>}
        {timers.map((t) => (
          <div key={t.id} className="rounded-lg border border-border/70 bg-card/50 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t.name}</span>
              <span className={`font-mono-j text-2xl font-bold tabular-nums ${t.remaining === 0 ? 'text-cyan-j' : ''}`}>{fmt(t.remaining)}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-cyan-j transition-all" style={{ width: `${pct(t)}%` }} /></div>
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" variant={t.running ? 'default' : 'outline'} onClick={() => toggle(t.id)} className="gap-1.5">{t.running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{t.running ? 'Pause' : 'Start'}</Button>
              <Button size="sm" variant="ghost" onClick={() => reset(t.id)}>Reset</Button>
              <Button size="sm" variant="ghost" onClick={() => remove(t.id)} className="gap-1.5"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}