import { useMemo, useState } from 'react';
import { Clock } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PRESETS = [
  { label: 'Every minute', fields: ['*', '*', '*', '*', '*'] },
  { label: 'Every 5 minutes', fields: ['*/5', '*', '*', '*', '*'] },
  { label: 'Every 15 minutes', fields: ['*/15', '*', '*', '*', '*'] },
  { label: 'Hourly', fields: ['0', '*', '*', '*', '*'] },
  { label: 'Nightly at 02:00', fields: ['0', '2', '*', '*', '*'] },
  { label: 'Weekdays at 09:00', fields: ['0', '9', '*', '*', '1-5'] },
  { label: 'Every Monday 08:30', fields: ['30', '8', '*', '*', '1'] },
  { label: 'First of the month', fields: ['0', '0', '1', '*', '*'] },
  { label: 'Every 6 hours', fields: ['0', '*/6', '*', '*', '*'] },
];

const FIELD_INFO = [
  { key: 'minute', label: 'Minute', min: 0, max: 59, hint: '0–59, or * for every minute' },
  { key: 'hour', label: 'Hour', min: 0, max: 23, hint: '0–23, or * for every hour' },
  { key: 'dom', label: 'Day of month', min: 1, max: 31, hint: '1–31, or * for every day' },
  { key: 'month', label: 'Month', min: 1, max: 12, hint: '1–12, or * for every month' },
  { key: 'dow', label: 'Day of week', min: 0, max: 6, hint: '0–6 where 0 is Sunday, or * for every day' },
];

const explainField = (value, info) => {
  if (value === '*') return 'every ' + info.label.toLowerCase().replace('day of ', '');
  if (value.startsWith('*/')) return 'every ' + value.slice(2) + ' ' + info.label.toLowerCase() + 's';
  if (value.includes('-')) {
    const [from, to] = value.split('-');
    if (info.key === 'dow') return WEEKDAYS[Number(from) % 7] + ' to ' + WEEKDAYS[Number(to) % 7];
    if (info.key === 'month') return 'months ' + from + ' to ' + to;
    return info.label.toLowerCase() + 's ' + from + ' to ' + to;
  }
  if (value.includes(',')) {
    const parts = value.split(',').map((part) => (info.key === 'dow' ? WEEKDAYS[Number(part) % 7] : part));
    return parts.join(', ');
  }
  if (info.key === 'dow') return WEEKDAYS[Number(value) % 7] || value;
  return info.label.toLowerCase() + ' ' + value;
};

const matches = (fields, date) => {
  const [minute, hour, dom, month, dow] = fields;
  const test = (field, value) => {
    if (field === '*') return true;
    if (field.startsWith('*/')) return value % Number(field.slice(2)) === 0;
    return field.split(',').some((part) => {
      if (part.includes('-')) {
        const [from, to] = part.split('-').map(Number);
        return value >= from && value <= to;
      }
      return Number(part) === value;
    });
  };
  const domMatch = test(dom, date.getDate());
  const dowMatch = test(dow, date.getDay());
  const domRestricted = dom !== '*';
  const dowRestricted = dow !== '*';
  return test(minute, date.getMinutes())
    && test(hour, date.getHours())
    && test(month, date.getMonth() + 1)
    && (domRestricted && dowRestricted ? domMatch || dowMatch : domMatch && dowMatch);
};

const nextRuns = (fields, count = 8) => {
  const results = [];
  const cursor = new Date();
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  for (let step = 0; step < 200000 && results.length < count; step += 1) {
    if (matches(fields, cursor)) results.push(new Date(cursor));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return results;
};

export default function CronBuilder() {
  const [mode, setMode] = useState('build');
  const [fields, setFields] = useState(['0', '9', '*', '*', '1-5']);
  const [raw, setRaw] = useState('0 9 * * 1-5');

  const expression = fields.join(' ');

  const parsed = useMemo(() => {
    const parts = raw.trim().split(/\s+/);
    if (parts.length !== 5) return { error: 'A cron expression needs exactly five fields: minute, hour, day of month, month, day of week.' };
    if (parts.some((part) => !/^[0-9*,\-/]+$/.test(part))) return { error: 'Only numbers, *, /, - and , are allowed in a cron field.' };
    return { parts, runs: nextRuns(parts, 8) };
  }, [raw]);

  const built = useMemo(() => nextRuns(fields, 8), [fields]);

  const description = useMemo(() => DESCRIPTION(fields), [fields]);
  const runs = mode === 'build' ? built : (parsed.runs || []);
  const problem = mode === 'explain' ? parsed.error : '';

  const report = useMemo(() => [
    expression,
    description,
    '',
    'Next runs:',
    ...runs.map((date) => '  ' + date.toLocaleString()),
  ].join('\n'), [expression, description, runs]);

  const setField = (index, value) => setFields((current) => current.map((field, position) => (position === index ? value : field)));
  const setPart = (index, value) => setFields((current) => {
    const next = [...current];
    next[index] = value;
    return next;
  });

  return (
    <ToolShell
      toolId="cron-build"
      icon={Clock}
      title="Cron Schedule Builder"
      desc="Compose a cron expression from readable choices, check the next eight runs for real, and paste an existing line to see what it means."
      state={{ mode, fields, raw }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (Array.isArray(restored.fields) && restored.fields.length === 5) setFields(restored.fields);
        if (typeof restored.raw === 'string') setRaw(restored.raw);
      }}
      exportText={report}
      exportName="cron.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={mode} onChange={setMode} options={[{ value: 'build', label: 'Build one' }, { value: 'explain', label: 'Read one' }]} />
        <CopyBtn value={expression} label="Copy expression" />
        <CopyBtn value={report} label="Copy with next runs" />
      </div>

      {mode === 'build' ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => setFields(preset.fields)}
                className={
                  preset.fields.join(' ') === expression
                    ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j'
                    : 'rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground'
                }
              >
                {preset.label}
              </button>
            ))}
          </div>

          <Panel className="!p-3">
            <div className="mb-3 font-mono-j text-xl tracking-wider text-cyan-j">
              {fields.map((field, index) => (
                <span key={FIELD_INFO[index].key}>
                  <span className={field === '*' ? 'text-muted-foreground' : ''}>{field}</span>
                  {index < 4 ? ' ' : ''}
                </span>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-5">
              {FIELD_INFO.map((info, index) => (
                <Field key={info.key} label={info.label} hint={info.hint}>
                  <input
                    value={fields[index]}
                    onChange={(e) => setField(index, e.target.value)}
                    spellCheck={false}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-center font-mono-j text-sm"
                  />
                  {info.key === 'hour' && (
                    <div className="mt-1 flex gap-1">
                      {['0', '6', '9', '12', '18'].map((hour) => (
                        <button key={hour} type="button" onClick={() => setPart(1, hour)} className="flex-1 rounded border border-border/60 py-0.5 font-mono-j text-[10px] text-muted-foreground transition hover:text-cyan-j">
                          {hour}
                        </button>
                      ))}
                    </div>
                  )}
                  {info.key === 'dow' && (
                    <div className="mt-1 flex gap-0.5">
                      {['1-5', '0', '6', '*'].map((value) => (
                        <button key={value} type="button" onClick={() => setPart(4, value)} className="flex-1 rounded border border-border/60 py-0.5 font-mono-j text-[10px] text-muted-foreground transition hover:text-cyan-j">
                          {value}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
              ))}
            </div>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">In plain English</div>
            <p className="text-[12px] text-cyan-j">{description}</p>
            <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
              {FIELD_INFO.map((info, index) => (
                <p key={info.key}>· {info.label}: {explainField(fields[index], info)}</p>
              ))}
            </div>
          </Panel>
        </>
      ) : (
        <>
          <Field label="Cron expression">
            <input value={raw} onChange={(e) => setRaw(e.target.value)} spellCheck={false} className="h-10 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm text-cyan-j" />
          </Field>
          {problem && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{problem}</Panel>}
          {!problem && (
            <>
              <Panel className="!p-3">
                <div className="mb-2 font-mono-j text-lg tracking-wider text-cyan-j">{parsed.parts.join(' ')}</div>
                <p className="text-[12px]">{DESCRIPTION(parsed.parts)}</p>
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  {FIELD_INFO.map((info, index) => (
                    <p key={info.key}>· {info.label}: {explainField(parsed.parts[index], info)}</p>
                  ))}
                </div>
              </Panel>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.slice(0, 6).map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setRaw(preset.fields.join(' '))}
                    className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Next run"
          value={runs[0] ? runs[0].toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—'}
          sub={runs[0] ? runs[0].toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + runs.length + ' upcoming runs listed below' : 'No run found in the next few months'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The next eight runs</div>
          <div className="space-y-1">
            {runs.map((date, index) => (
              <div key={index} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="font-mono-j text-cyan-j">{date.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                <span className="font-mono-j text-muted-foreground">{date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
            {!runs.length && <span className="text-[11px] text-muted-foreground">Nothing in the search window — check the month and day fields.</span>}
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Fields" value="5" mono sub="min hr dom mon dow" />
        <Stat label="Next run in" value={runs[0] ? relative(runs[0]) : '—'} mono />
        <Stat label="Runs checked" value={runs.length ? String(runs.length) : '0'} mono />
        <Stat label="Expression" value={expression.length > 12 ? expression.slice(0, 12) + '…' : expression} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Getting the details right</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Cron fields are minute, hour, day-of-month, month, day-of-week — in that exact order, and Sunday is 0.</p>
          <p>· <span className="font-mono-j">*/5</span> means every fifth value from the start of the range, so in the minute field it fires at :00, :05, :10 and so on.</p>
          <p>· Day-of-month and day-of-week are combined with OR when both are restricted, not AND — <span className="font-mono-j">0 0 1 * 1</span> runs on the 1st and on every Monday.</p>
          <p>· Servers usually run cron in their own timezone. For anything user-facing, schedule in UTC and convert in the job itself.</p>
          <p>· Long-running jobs need overlap protection: a job that takes 20 minutes on a <span className="font-mono-j">*/5</span> schedule will pile up.</p>
          <p>· Five fields is standard; many systems also accept a sixth for seconds and a seventh for years. This builder sticks to the portable five.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Mode', value: mode },
              { label: 'Expression', value: expression },
              { label: 'Timezone', value: 'your local time' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The next-run list is computed by walking forward a minute at a time and testing the expression against real dates, so it accounts for short months,
          leap years and the way cron treats day-of-month and day-of-week together. Nothing is estimated — if a run is listed, it will happen at that moment in
          your local timezone.
        </p>
      </Panel>
    </ToolShell>
  );
}

function relative(date) {
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (minutes < 60) return 'in ' + minutes + ' min';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return 'in ' + hours + ' h ' + (minutes % 60) + ' m';
  return 'in ' + Math.floor(hours / 24) + ' days';
}

function DESCRIPTION(fields) {
  const [minute, hour, dom, month, dow] = fields;
  const every = (field, word) => (field === '*' ? 'every ' + word : null);
  const time = () => {
    if (minute.startsWith('*/')) return 'every ' + minute.slice(2) + ' minutes';
    if (hour === '*' && minute === '0') return 'every hour on the hour';
    if (hour === '*') return 'every hour at minute ' + minute;
    const h = String(hour).padStart(2, '0');
    const m = String(minute).padStart(2, '0');
    if (hour.startsWith('*/')) return 'every ' + hour.slice(2) + ' hours at minute ' + m;
    if (hour.includes('-') || hour.includes(',')) return 'at minute ' + m + ' during hours ' + hour;
    return 'at ' + h + ':' + m;
  };
  const days = () => {
    if (dom === '*' && dow === '*') return 'every day';
    if (dow !== '*') {
      if (dow === '1-5') return 'on weekdays';
      if (dow.includes(',')) return 'on ' + dow.split(',').map((day) => WEEKDAYS[Number(day) % 7]).join(' and ');
      return 'every ' + (WEEKDAYS[Number(dow) % 7] || dow);
    }
    if (dom.startsWith('*/')) return 'every ' + dom.slice(2) + ' days';
    return 'on day ' + dom + ' of the month';
  };
  const months = month === '*' ? '' : ' in month ' + month;
  const base = time() + ' ' + days() + months;
  const everyMinute = every(minute, 'minute');
  const leading = everyMinute && hour === '*' && dom === '*' && month === '*' && dow === '*';
  return (leading ? 'Runs every minute, every day' : 'Runs ' + base) + '.';
}