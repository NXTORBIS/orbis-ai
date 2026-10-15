import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import { ToolHeader, Field, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parseField(spec, min, max, names) {
  const set = new Set();
  spec.split(',').forEach((rawPart) => {
    const part = rawPart.trim();
    if (!part) throw new Error('Empty value in a comma list.');
    const [rangeText, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`"${part}" has an invalid step.`);
    const valueOf = (token) => {
      const t = token.trim().toUpperCase();
      const idx = names ? names.indexOf(t) : -1;
      if (idx >= 0) return names.length === 12 ? idx + 1 : idx;
      const num = Number(t);
      if (!Number.isInteger(num) || num < min || num > max) throw new Error(`"${token}" is outside the allowed range ${min}–${max}.`);
      return num;
    };
    let start;
    let end;
    if (rangeText === '*') { start = min; end = max; }
    else if (rangeText.includes('-')) {
      const [a, b] = rangeText.split('-');
      start = valueOf(a);
      end = valueOf(b);
      if (start > end) throw new Error(`Range "${rangeText}" runs backwards.`);
    } else {
      start = valueOf(rangeText);
      end = stepText !== undefined ? max : start;
    }
    for (let v = start; v <= end; v += step) set.add(v);
  });
  if (!set.size) throw new Error('A field matched no values.');
  return set;
}

function sentence(raw) {
  const [m, h, dom, mon, dow] = raw;
  const bits = [];
  bits.push(m === '*' ? 'every minute' : m.startsWith('*/') ? `every ${m.slice(2)} minutes` : /^\d+$/.test(m) ? `at minute ${m}` : `at minutes ${m}`);
  bits.push(h === '*' ? 'of every hour' : h.startsWith('*/') ? `of every ${h.slice(2)} hours` : /^\d+$/.test(h) ? `of hour ${h.padStart(2, '0')}` : `of hours ${h}`);
  if (dom !== '*') bits.push(`on day ${dom} of the month`);
  if (mon !== '*') bits.push(`in month ${mon}`);
  if (dow !== '*') bits.push(`on ${dow}`);
  return `Runs ${bits.join(' ')}.`;
}

const rel = (date) => {
  const mins = Math.round((date - new Date()) / 60000);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  if (mins < 1440) return `in ${Math.round(mins / 60)} hours`;
  return `in ${(mins / 1440).toFixed(1)} days`;
};

const PRESETS = [
  ['Every 15 min', '*/15 * * * *'],
  ['Hourly', '0 * * * *'],
  ['Midnight daily', '0 0 * * *'],
  ['Weekdays 9am', '0 9 * * MON-FRI'],
  ['Every 5 min (work hrs)', '*/5 9-17 * * MON-FRI'],
  ['First of month', '0 0 1 * *'],
];

export default function CronExplainer() {
  const [expr, setExpr] = useState('*/5 9-17 * * MON-FRI');

  const result = useMemo(() => {
    try {
      const parts = expr.trim().split(/\s+/);
      if (parts.length !== 5) throw new Error(`A schedule needs 5 fields (minute hour day-of-month month day-of-week) — found ${parts.length}.`);
      const [m, h, dom, mon, dow] = parts;
      const minute = parseField(m, 0, 59);
      const hour = parseField(h, 0, 23);
      const dayOfMonth = parseField(dom, 1, 31);
      const month = parseField(mon, 1, 12, MONTH_NAMES);
      const dayOfWeek = parseField(dow, 0, 6, DOW_NAMES);
      const domStar = dom === '*';
      const dowStar = dow === '*';
      const runs = [];
      const cursor = new Date();
      cursor.setSeconds(0, 0);
      cursor.setMinutes(cursor.getMinutes() + 1);
      for (let i = 0; i < 88000 && runs.length < 5; i++) {
        let dayOk;
        if (domStar && dowStar) dayOk = true;
        else if (!domStar && !dowStar) dayOk = dayOfMonth.has(cursor.getDate()) || dayOfWeek.has(cursor.getDay());
        else if (!domStar) dayOk = dayOfMonth.has(cursor.getDate());
        else dayOk = dayOfWeek.has(cursor.getDay());
        if (dayOk && month.has(cursor.getMonth() + 1) && hour.has(cursor.getHours()) && minute.has(cursor.getMinutes())) runs.push(new Date(cursor));
        cursor.setMinutes(cursor.getMinutes() + 1);
      }
      const fields = [
        ['Minute', m, minute.size],
        ['Hour', h, hour.size],
        ['Day of month', dom, dayOfMonth.size],
        ['Month', mon, month.size],
        ['Day of week', dow, dayOfWeek.size],
      ];
      return { ok: true, runs, fields, raw: parts, note: !domStar && !dowStar ? 'Both day fields are set, so the schedule fires when either one matches (classic cron behaviour).' : null };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, [expr]);

  return (
    <ToolShell
      toolId="cron"
      icon={Clock}
      title="Cron Schedule Explainer"
      desc="Paste a crontab expression to see what it means and when it next runs."
      state={{ expr }}
      onRestore={(saved) => { if (saved.expr !== undefined) setExpr(saved.expr); }}
      exportText={JSON.stringify(result, null, 2)}
      exportName="cron.json"
      exportMime="application/json"
    >
      <Field label="Cron expression" hint="minute hour day-of-month month day-of-week">
        <input value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map(([label, value]) => (
          <button key={value} onClick={() => setExpr(value)} className={`rounded-lg border px-2.5 py-1 text-xs transition ${expr === value ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{label}</button>
        ))}
      </div>

      {result.ok ? (
        <>
          <Panel>
            <div className="text-sm font-medium">{sentence(result.raw)}</div>
            {result.note && <p className="mt-1 text-[11px] text-muted-foreground">{result.note}</p>}
          </Panel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {result.fields.map(([label, value, count]) => (
              <Stat key={label} label={`${label} · ${count} match${count === 1 ? '' : 'es'}`} value={value} mono />
            ))}
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Next 5 runs (your local time)</div>
            {result.runs.length ? (
              <ol className="space-y-1.5">
                {result.runs.map((d, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <span className="font-mono-j text-xs">{d.toLocaleString(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="text-[11px] text-cyan-j">{rel(d)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">No run found in the next two months — check the month and day fields.</p>
            )}
          </Panel>
          <p className="text-[11px] text-muted-foreground">Standard 5-field crontab syntax: <span className="font-mono-j">*</span> any value, <span className="font-mono-j">,</span> a list, <span className="font-mono-j">-</span> a range, <span className="font-mono-j">/n</span> every n. Month names (JAN–DEC) and weekdays (SUN–SAT) also work.</p>
        </>
      ) : (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{result.error}</div>
      )}
      <div className="text-[11px] text-muted-foreground">Day of week runs Sunday (0) to Saturday (6); {DOW_FULL[1]} is 1.</div>
    </ToolShell>
  );
}