import { useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, Seg, CopyBtn, Panel, Stat } from './shared';

const UNIT = /(\d+(?:\.\d+)?)\s*(ms|milliseconds?|d|days?|h|hrs?|hours?|m|mins?|minutes?|s|secs?|seconds?)/g;

const parseDuration = (input) => {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.includes(':')) {
    const parts = text.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  let total = 0;
  let matched = false;
  let m;
  UNIT.lastIndex = 0;
  while ((m = UNIT.exec(text))) {
    matched = true;
    const n = Number(m[1]);
    const unit = m[2];
    const factor = unit.startsWith('ms') || unit.startsWith('milli') ? 0.001
      : unit.startsWith('d') ? 86400
        : unit.startsWith('h') ? 3600
          : unit.startsWith('m') ? 60
            : 1;
    total += n * factor;
  }
  return matched ? total : null;
};

const trim = (n, digits) => Number(n.toFixed(digits)).toString();

const clock = (sec) => {
  const s = Math.abs(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  const seconds = rest % 1 ? trim(rest, 3).padStart(2, '0') : pad(rest);
  return `${sec < 0 ? '-' : ''}${d ? `${d}d ` : ''}${h || d ? `${pad(h)}:` : ''}${pad(m)}:${seconds}`;
};

const words = (sec) => {
  if (sec < 0) return `minus ${words(-sec)}`;
  let left = sec;
  const parts = [];
  [['day', 86400], ['hour', 3600], ['minute', 60]].forEach(([name, size]) => {
    const n = Math.floor(left / size);
    if (n > 0) {
      parts.push(`${n} ${name}${n === 1 ? '' : 's'}`);
      left -= n * size;
    }
  });
  if (left > 0) parts.push(`${trim(left, 3)} second${left === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : '0 seconds';
};

const compact = (sec) => {
  const s = Math.abs(sec);
  const parts = [];
  [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]].forEach(([name, size]) => {
    const n = Math.floor(s / size);
    if (n > 0) parts.push(`${n}${name}`);
  });
  return `${sec < 0 ? '-' : ''}${parts.join(' ') || '0s'}`;
};

export default function DurationConverter() {
  const [mode, setMode] = useState('single');
  const [input, setInput] = useState('1:30:00');
  const [lines, setLines] = useState('1h 45m\n25:30\n900');

  const parsed = useMemo(() => {
    if (mode === 'single') return parseDuration(input);
    const items = lines.split('\n').map((l) => l.trim()).filter(Boolean);
    const values = items.map(parseDuration);
    if (!values.length || values.some((v) => v === null)) return null;
    return values.reduce((a, b) => a + b, 0);
  }, [mode, input, lines]);

  const report = useMemo(() => {
    const s = parsed;
    if (s === null || !Number.isFinite(s)) return [];
    return [
      { label: 'Clock', value: clock(s) },
      { label: 'In words', value: words(s) },
      { label: 'Compact', value: compact(s) },
      { label: 'Decimal hours', value: trim(s / 3600, 4) },
      { label: 'Decimal minutes', value: trim(s / 60, 4) },
      { label: 'Seconds', value: trim(s, 3) },
      { label: 'Days', value: trim(s / 86400, 5) },
    ];
  }, [parsed]);

  const badLines = useMemo(() => {
    if (mode !== 'sum') return [];
    return lines.split('\n').map((l) => l.trim()).filter((l) => l && parseDuration(l) === null);
  }, [mode, lines]);

  const counted = mode === 'sum' ? lines.split('\n').map((l) => l.trim()).filter((l) => l && parseDuration(l) !== null).length : parsed === null ? 0 : 1;

  return (
    <ToolShell
      toolId="duration"
      icon={Timer}
      title="Duration Converter"
      desc="Turn any duration into clock time, words and decimals — or add a whole timesheet together."
      state={{ mode, input, lines }}
      onRestore={(saved) => { setMode(saved.mode || 'single'); setInput(saved.input); setLines(saved.lines); }}
      exportText={report.map((r) => `${r.label}: ${r.value}`).join('\n')}
      exportName="duration.txt"
    >
      <Seg
        value={mode}
        onChange={setMode}
        options={[{ value: 'single', label: 'One duration' }, { value: 'sum', label: 'Add them up' }]}
      />

      {mode === 'single' ? (
        <Area value={input} onChange={setInput} rows={3} placeholder="1:30:00, 90:30, 2h 15m, 5400…" />
      ) : (
        <Area value={lines} onChange={setLines} rows={7} placeholder={'One duration per line\n1h 45m\n25:30\n900'} />
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Total seconds" value={parsed === null ? '—' : trim(parsed, 3)} mono />
        <Stat label="Clock" value={parsed === null ? '—' : clock(parsed)} mono />
        <Stat label={mode === 'sum' ? 'Lines counted' : 'Parsed'} value={String(counted)} />
      </div>

      <Panel>
        <div className="mb-2 text-xs font-medium">Every way to write it</div>
        <div className="space-y-1">
          {report.map((r) => (
            <div key={r.label} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{r.label}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-xs">{r.value}</span>
              <CopyBtn value={r.value} />
            </div>
          ))}
          {!report.length && <p className="py-4 text-center text-[11px] text-muted-foreground">Type a duration like 1:30:00 or 2h 15m.</p>}
        </div>
      </Panel>

      {!!badLines.length && (
        <Panel className="border-amber-500/40">
          <div className="mb-1 text-xs font-medium text-amber-500">Could not read these lines</div>
          <ul className="space-y-0.5 font-mono-j text-[11px] text-muted-foreground">
            {badLines.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Accepted: <span className="font-mono-j">1:30:00</span>, <span className="font-mono-j">90:30</span> (minutes:seconds),
          <span className="font-mono-j"> 2h 15m 30s</span>, <span className="font-mono-j">1.5 hours</span>, <span className="font-mono-j">250ms</span>, or a plain number of seconds.
        </p>
      </Panel>
    </ToolShell>
  );
}