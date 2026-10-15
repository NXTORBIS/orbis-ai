import { useEffect, useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Panel, Stat, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const STORAGE_KEY = 'toolkit_countdown_target';
const STORAGE_LABEL = 'toolkit_countdown_label';

const toInput = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const nextMidnight = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d; };
const newYear = () => new Date(new Date().getFullYear() + 1, 0, 1, 0, 0, 0);

export default function CountdownTimer() {
  const [target, setTarget] = useState(() => localStorage.getItem(STORAGE_KEY) || toInput(nextMidnight()));
  const [label, setLabel] = useState(() => localStorage.getItem(STORAGE_LABEL) || 'Midnight');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, target); }, [target]);
  useEffect(() => { localStorage.setItem(STORAGE_LABEL, label); }, [label]);

  const targetDate = useMemo(() => new Date(target), [target]);
  const valid = !Number.isNaN(targetDate.getTime());

  const parts = useMemo(() => {
    if (!valid) return null;
    const diff = targetDate.getTime() - now;
    const past = diff < 0;
    const abs = Math.abs(diff);
    return {
      past,
      diff,
      days: Math.floor(abs / 86400000),
      hours: Math.floor((abs % 86400000) / 3600000),
      minutes: Math.floor((abs % 3600000) / 60000),
      seconds: Math.floor((abs % 60000) / 1000),
      milliseconds: abs % 1000,
    };
  }, [targetDate, now, valid]);

  const presets = [
    ['Next midnight', nextMidnight(), 'Midnight'],
    ['In 1 hour', new Date(Date.now() + 3600000), 'One hour from now'],
    ['In 1 day', new Date(Date.now() + 86400000), 'Tomorrow'],
    ['In 1 week', new Date(Date.now() + 7 * 86400000), 'One week from now'],
    ['New Year', newYear(), 'Happy New Year'],
  ];

  const shareText = parts ? `${parts.past ? 'Since' : 'Until'} ${label || 'the target'}: ${parts.days}d ${parts.hours}h ${parts.minutes}m ${parts.seconds}s${parts.past ? ' ago' : ''} (${targetDate.toLocaleString()})` : '';

  const cards = parts ? [
    ['Days', parts.days],
    ['Hours', parts.hours],
    ['Minutes', parts.minutes],
    ['Seconds', parts.seconds],
  ] : [];

  return (
    <ToolShell
      toolId="countdown"
      icon={Timer}
      title="Countdown Timer"
      desc="Count down to any moment — it keeps running and remembers your target."
      state={{ target, label }}
      onRestore={(saved) => { setTarget(saved.target); setLabel(saved.label || 'Countdown'); }}
      exportText={JSON.stringify({ target, label, parts }, null, 2)}
      exportName="countdown.json"
      exportMime="application/json"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Target date and time">
          <input type="datetime-local" value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" />
        </Field>
        <Field label="What are you counting to?">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Launch day" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([name, date, presetLabel]) => (
          <button
            key={name}
            onClick={() => { setTarget(toInput(date)); setLabel(presetLabel); }}
            className="rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground"
          >
            {name}
          </button>
        ))}
      </div>
      {parts ? (
        <>
          <Panel className="text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{parts.past ? 'Time since' : 'Time until'} {label || 'your target'}</div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {cards.map(([unit, value]) => (
                <div key={unit} className="rounded-xl border border-border/70 bg-background/40 px-1 py-3">
                  <div className="font-display text-2xl font-bold tabular-nums text-cyan-j sm:text-4xl">{String(value).padStart(2, '0')}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{unit}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 font-mono-j text-[11px] text-muted-foreground">{targetDate.toLocaleString()}{parts.past ? ' · already passed' : ''}</div>
          </Panel>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total hours" value={String(Math.floor(Math.abs(parts.diff) / 3600000))} />
            <Stat label="Total minutes" value={String(Math.floor(Math.abs(parts.diff) / 60000))} />
            <Stat label="Total seconds" value={String(Math.floor(Math.abs(parts.diff) / 1000))} />
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyBtn value={shareText} label="Copy summary" />
            <Button size="sm" variant="outline" onClick={() => { setTarget(toInput(new Date())); setLabel('Right now'); }}>Count from now</Button>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Pick a valid date and time.</div>
      )}
      <p className="text-[11px] text-muted-foreground">Milliseconds tick too: {parts ? `${Math.floor(parts.milliseconds)} ms into the current second` : '—'}.</p>
    </ToolShell>
  );
}