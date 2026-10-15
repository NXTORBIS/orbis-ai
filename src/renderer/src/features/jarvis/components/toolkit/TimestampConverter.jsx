import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Stat, Out, CopyBtn, Panel } from './shared';

function relative(date) {
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const units = [[31536000000, 'year'], [2592000000, 'month'], [86400000, 'day'], [3600000, 'hour'], [60000, 'minute'], [1000, 'second']];
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.floor(abs / ms);
      return `${n} ${name}${n === 1 ? '' : 's'} ${diff >= 0 ? 'ago' : 'from now'}`;
    }
  }
  return 'just now';
}

export function epochToDate(raw) {
  const s = String(raw).trim().replace(/,/g, '');
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return new Date(Math.abs(n) >= 1e11 ? n : n * 1000);
}

const pad = (n) => String(n).padStart(2, '0');
export function toLocalInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TimestampConverter() {
  const [mode, setMode] = useState('epoch');
  const [epoch, setEpoch] = useState(String(Math.floor(Date.now() / 1000)));
  const [local, setLocal] = useState(toLocalInput(new Date()));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const fromEpoch = epochToDate(epoch);
  const fromLocal = local ? new Date(local) : null;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Clock} title="Unix Timestamp Converter" desc="Switch between epoch seconds, milliseconds and readable dates." />
      <Panel className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Live clock</div>
          <div className="font-display text-lg tabular-nums text-cyan-j">{new Date(now).toLocaleTimeString()}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Now</div>
          <div className="font-mono-j text-xs">{Math.floor(now / 1000)} · {now}</div>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setEpoch(String(Math.floor(Date.now() / 1000))); setLocal(toLocalInput(new Date())); }}>Use now</Button>
      </Panel>
      <Seg value={mode} onChange={setMode} options={[{ value: 'epoch', label: 'Epoch → Date' }, { value: 'date', label: 'Date → Epoch' }]} />
      {mode === 'epoch' ? (
        <>
          <Field label="Epoch value" hint="Seconds or milliseconds — detected automatically.">
            <input value={epoch} onChange={(e) => setEpoch(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
          </Field>
          {fromEpoch && !Number.isNaN(fromEpoch.getTime()) ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Out label="Your local time" value={fromEpoch.toLocaleString()}>{fromEpoch.toLocaleString()}</Out>
                <Out label="ISO 8601 (UTC)" value={fromEpoch.toISOString()}>{fromEpoch.toISOString()}</Out>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Relative" value={relative(fromEpoch)} />
                <Stat label="Day of week" value={fromEpoch.toLocaleDateString(undefined, { weekday: 'long' })} />
                <Stat label="Milliseconds" value={String(fromEpoch.getTime())} mono />
                <Stat label="Seconds" value={String(Math.floor(fromEpoch.getTime() / 1000))} mono />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Enter a numeric epoch value.</div>
          )}
        </>
      ) : (
        <>
          <Field label="Date & time (your timezone)">
            <input type="datetime-local" value={local} onChange={(e) => setLocal(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
          {fromLocal && !Number.isNaN(fromLocal.getTime()) ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Out label="Epoch seconds" value={String(Math.floor(fromLocal.getTime() / 1000))}>
                  <span className="font-mono-j text-cyan-j">{Math.floor(fromLocal.getTime() / 1000)}</span>
                </Out>
                <Out label="Epoch milliseconds" value={String(fromLocal.getTime())}>
                  <span className="font-mono-j text-cyan-j">{fromLocal.getTime()}</span>
                </Out>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="ISO" value={fromLocal.toISOString()} mono />
                <Stat label="UTC" value={fromLocal.toUTCString()} mono />
                <Stat label="Relative" value={relative(fromLocal)} />
                <Stat label="Offset" value={`UTC${-fromLocal.getTimezoneOffset() / 60 >= 0 ? '+' : ''}${-fromLocal.getTimezoneOffset() / 60}`} />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Pick a valid date and time.</div>
          )}
        </>
      )}
      <CopyBtn value={mode === 'epoch' ? String(fromEpoch?.getTime() ?? '') : String(fromLocal?.getTime() ?? '')} label="Copy epoch milliseconds" />
    </div>
  );
}