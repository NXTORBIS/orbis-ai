import { useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import ToolShell from './kit/ToolShell';
import { Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_CODES = { Monday: 'MO', Tuesday: 'TU', Wednesday: 'WE', Thursday: 'TH', Friday: 'FR', Saturday: 'SA', Sunday: 'SU' };
const DAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const NTH = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' };

const startOfWeek = (date) => {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const shift = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - shift);
  return copy;
};
const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();

const matches = (date, config, start) => {
  const interval = Math.max(1, Number(config.interval) || 1);
  if (config.freq === 'daily') return daysBetween(start, date) % interval === 0;
  if (config.freq === 'weekly') {
    const weeks = Math.floor(daysBetween(startOfWeek(start), startOfWeek(date)) / 7);
    if (weeks % interval !== 0) return false;
    if (config.days.length) return config.days.includes(DAY_NAMES[date.getDay()]);
    return date.getDay() === start.getDay();
  }
  if (config.freq === 'monthly') {
    if (monthsBetween(start, date) % interval !== 0) return false;
    if (config.monthlyMode === 'date') {
      const target = Number(config.monthDay);
      return target === -1 ? date.getDate() === daysInMonth(date) : date.getDate() === target;
    }
    if (date.getDay() !== DAY_INDEX[config.day]) return false;
    if (Number(config.nth) === -1) return date.getDate() + 7 > daysInMonth(date);
    return Math.floor((date.getDate() - 1) / 7) + 1 === Number(config.nth);
  }
  if (config.freq === 'yearly') {
    const months = monthsBetween(start, date);
    return months % (12 * interval) === 0 && date.getMonth() === start.getMonth() && date.getDate() === start.getDate();
  }
  return false;
};

const occurencesFor = (config) => {
  const start = new Date(config.dtstart + 'T00:00:00');
  if (Number.isNaN(start.getTime())) return [];
  const until = config.end === 'until' && config.until ? new Date(config.until + 'T23:59:59') : null;
  const limit = config.end === 'count' ? Math.max(1, Number(config.count) || 1) : 12;
  const found = [];
  const cursor = new Date(start.getTime());
  let guard = 0;
  while (found.length < limit && guard < 20000) {
    guard += 1;
    if (matches(cursor, config, start)) {
      if (until && cursor > until) break;
      found.push(new Date(cursor.getTime()));
    }
    if (until && cursor > until) break;
    cursor.setDate(cursor.getDate() + 1);
    if (until && cursor > until) break;
  }
  return found;
};

const buildRule = (config) => {
  const parts = ['FREQ=' + config.freq.toUpperCase()];
  const interval = Number(config.interval) || 1;
  if (interval > 1) parts.push('INTERVAL=' + interval);
  if (config.freq === 'weekly' && config.days.length) parts.push('BYDAY=' + config.days.map((day) => DAY_CODES[day]).join(','));
  if (config.freq === 'monthly') {
    if (config.monthlyMode === 'date') parts.push('BYMONTHDAY=' + config.monthDay);
    else parts.push('BYDAY=' + (Number(config.nth) === -1 ? '-1' : config.nth) + DAY_CODES[config.day]);
  }
  if (config.end === 'count') parts.push('COUNT=' + (Number(config.count) || 1));
  if (config.end === 'until' && config.until) parts.push('UNTIL=' + config.until.replace(/-/g, '') + 'T235959Z');
  return parts.join(';');
};

const describe = (config) => {
  const interval = Number(config.interval) || 1;
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[config.freq];
  let text = interval === 1 ? 'Every ' + unit : 'Every ' + interval + ' ' + unit + 's';
  if (config.freq === 'weekly' && config.days.length) {
    text += ' on ' + config.days.map((day) => day.slice(0, 3)).join(', ');
  }
  if (config.freq === 'monthly') {
    text += config.monthlyMode === 'date'
      ? (Number(config.monthDay) === -1 ? ' on the last day' : ' on day ' + config.monthDay)
      : ' on the ' + NTH[config.nth] + ' ' + config.day;
  }
  if (config.end === 'count') text += ', ' + config.count + ' times';
  if (config.end === 'until') text += ', until ' + config.until;
  if (config.end === 'never') text += ', repeating forever';
  if (config.freq === 'yearly') text += ' on ' + config.dtstart.slice(8) + '/' + config.dtstart.slice(5, 7);
  return text + '.';
};

const explain = (rule) => {
  if (!rule.trim()) return [];
  const known = {
    FREQ: 'The base unit of repetition.',
    INTERVAL: 'How many base units to skip between occurrences.',
    COUNT: 'Total number of occurrences, counted from the start date.',
    UNTIL: 'The moment the rule stops. In UTC in a valid ics file.',
    BYDAY: 'Which weekdays, or the nth weekday of the month when preceded by a number.',
    BYMONTHDAY: 'Which day of the month; -1 means the last day.',
    BYMONTH: 'Which months, numbered 1 to 12.',
    BYSETPOS: 'Which of the days matched in a period to use — 1 is the first, -1 the last.',
    WKST: 'Which day starts the week, used when counting intervals.',
    BYHOUR: 'Which hour of the day.',
    BYMINUTE: 'Which minute of the hour.',
  };
  return rule.split(';').filter(Boolean).map((part) => {
    const key = part.split('=')[0];
    const label = known[key?.toUpperCase()] || 'Not a standard part — most calendar apps will ignore it.';
    return { key: part, label };
  });
};

export default function RecurrenceBuilder() {
  const [config, setConfig] = useState({
    freq: 'weekly',
    interval: 2,
    days: ['Monday', 'Wednesday'],
    monthlyMode: 'date',
    monthDay: 1,
    nth: 1,
    day: 'Monday',
    end: 'count',
    count: 10,
    until: '2027-06-30',
    dtstart: '2026-10-13',
  });
  const [ruleText, setRuleText] = useState('FREQ=MONTHLY;BYDAY=-1FR');

  const set = (key, value) => setConfig((current) => ({ ...current, [key]: value }));
  const toggleDay = (day) => set('days', config.days.includes(day) ? config.days.filter((entry) => entry !== day) : [...config.days, day]);

  const rule = useMemo(() => buildRule(config), [config]);
  const description = useMemo(() => describe(config), [config]);
  const occurrences = useMemo(() => occurencesFor(config), [config]);
  const explained = useMemo(() => explain(ruleText), [ruleText]);

  const report = [
    description,
    '',
    'RRULE:' + rule,
    'DTSTART:' + config.dtstart.replace(/-/g, '') + 'T090000Z',
    '',
    'Next occurrences:',
    ...occurrences.map((date, index) => (index + 1) + '. ' + date.toDateString()),
  ].join('\n');

  return (
    <ToolShell
      toolId="recurrence-builder"
      icon={CalendarRange}
      title="Recurrence Rule Builder"
      desc="Build an iCal RRULE by choosing what repeats, then read it back in plain English and see the real dates it produces. Paste an existing rule to have it explained part by part."
      state={{ config, ruleText }}
      onRestore={(restored) => {
        if (restored.config && typeof restored.config === 'object') setConfig({ ...config, ...restored.config });
        if (typeof restored.ruleText === 'string') setRuleText(restored.ruleText);
      }}
      exportText={report}
      exportName="recurrence-rule.txt"
    >
      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What repeats</div>
          <div className="flex flex-wrap items-center gap-2">
            <Seg
              value={config.freq}
              onChange={(value) => set('freq', value)}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
                { value: 'yearly', label: 'Yearly' },
              ]}
            />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              every
              <Input type="number" min="1" value={config.interval} onChange={(event) => set('interval', event.target.value)} className="w-16" />
              {{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[config.freq]}{Number(config.interval) === 1 ? '' : 's'}
            </div>
          </div>

          {config.freq === 'weekly' && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] text-muted-foreground">On which days</div>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={config.days.includes(day)
                      ? 'rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2.5 py-1 text-xs text-cyan-j'
                      : 'rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition hover:text-foreground'}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {config.freq === 'monthly' && (
            <div className="mt-3 space-y-2">
              <Seg
                value={config.monthlyMode}
                onChange={(value) => set('monthlyMode', value)}
                options={[{ value: 'date', label: 'On a day number' }, { value: 'weekday', label: 'On a weekday position' }]}
              />
              {config.monthlyMode === 'date' ? (
                <Field label="Day of the month" hint="Use -1 for the last day of the month.">
                  <Input type="number" value={config.monthDay} onChange={(event) => set('monthDay', event.target.value)} />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Which one">
                    <select value={String(config.nth)} onChange={(event) => set('nth', event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                      <option value="1">First</option>
                      <option value="2">Second</option>
                      <option value="3">Third</option>
                      <option value="4">Fourth</option>
                      <option value="-1">Last</option>
                    </select>
                  </Field>
                  <Field label="Weekday">
                    <select value={config.day} onChange={(event) => set('day', event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                      {DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
                    </select>
                  </Field>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Field label="Starts on"><Input type="date" value={config.dtstart} onChange={(event) => set('dtstart', event.target.value)} /></Field>
            <Field label="Ends">
              <select value={config.end} onChange={(event) => set('end', event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="never">Never</option>
                <option value="count">After a number of times</option>
                <option value="until">On a date</option>
              </select>
            </Field>
            {config.end === 'count' && <Field label="Occurrences"><Input type="number" min="1" value={config.count} onChange={(event) => set('count', event.target.value)} /></Field>}
            {config.end === 'until' && <Field label="Last possible date"><Input type="date" value={config.until} onChange={(event) => set('until', event.target.value)} /></Field>}
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel className="!p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium">The rule</span>
              <CopyBtn value={'RRULE:' + rule} label="Copy RRULE" />
            </div>
            <div className="break-all rounded-lg border border-border/70 bg-card/60 p-3 font-mono-j text-xs text-cyan-j">RRULE:{rule}</div>
            <p className="mt-2 text-[11px] text-muted-foreground">{description}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              In a calendar file this sits under an event alongside <span className="font-mono-j">DTSTART:{config.dtstart.replace(/-/g, '')}T090000Z</span>, which fixes
              the time of day and the starting point the interval counts from.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">The dates it actually produces</div>
            <div className="space-y-1">
              {occurrences.length === 0 && <p className="text-[11px] text-muted-foreground">No occurrences — check the start date and the weekday selection.</p>}
              {occurrences.map((date, index) => (
                <div key={date.toISOString()} className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">#{index + 1}</span>
                  <span>{date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="font-mono-j text-[11px] text-muted-foreground">{DAY_CODES[DAY_NAMES[date.getDay()]]}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Showing the first {config.end === 'count' ? Math.min(Number(config.count) || 1, occurrences.length) : occurrences.length} occurrences. Daily stepping means the
              first match can be later than the start date when the weekday does not line up.
            </p>
          </Panel>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Repeats" value={description.replace(/^Every /, '').split(',')[0]} mono sub="human reading" />
        <Stat label="First occurrence" value={occurrences[0] ? occurrences[0].toLocaleDateString() : '—'} mono sub="from the start date" />
        <Stat label="Total shown" value={String(occurrences.length)} mono sub={config.end === 'never' ? 'the next twelve' : 'up to the end rule'} />
        <Stat label="Parts in rule" value={String(rule.split(';').length)} mono sub="semicolon separated" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Explain an existing rule</div>
        <Field label="Paste an RRULE without the RRULE: prefix">
          <Input value={ruleText} onChange={(event) => setRuleText(event.target.value)} className="font-mono-j" />
        </Field>
        <div className="mt-2 space-y-1.5">
          {explained.map((entry) => (
            <div key={entry.key} className="flex flex-wrap items-baseline gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
              <span className="font-mono-j text-xs text-cyan-j">{entry.key}</span>
              <span className="text-[11px] text-muted-foreground">{entry.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Try <span className="font-mono-j">FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=12</span> or <span className="font-mono-j">FREQ=MONTHLY;BYDAY=-1FR</span>. Unknown parts are
          listed rather than guessed at, because silently ignoring a part is exactly how a recurrence ends up wrong in the calendar.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Getting recurrence right</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The interval counts from the start date, not from the first match. A fortnightly rule starting on a Tuesday never fires on a Thursday, even if Thursday is selected.</p>
            <p>· Month-end handling is where most rules break. Day 31 does not exist in eleven months; <span className="font-mono-j">BYMONTHDAY=-1</span> means the last day instead.</p>
            <p>· Weekly rules should always name the days explicitly. Left out, the day is inherited from the start date, which is easy to lose track of.</p>
            <p>· All-day events and time zones are separate from the recurrence. A UTC <span className="font-mono-j">UNTIL</span> with a local start time can stop a day early or late in some clients.</p>
            <p>· Google Calendar, Outlook and Apple Calendar all accept RRULE, but a few applications rewrite it on save. Round-trip your rule through the real client before trusting it.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Common patterns</div>
          <div className="space-y-2 text-[11px] text-muted-foreground">
            {[
              { label: 'Every weekday', value: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
              { label: 'Payday, last working day', value: 'FREQ=MONTHLY;BYDAY=-1MO' },
              { label: 'Second Tuesday, monthly', value: 'FREQ=MONTHLY;BYDAY=2TU' },
              { label: 'Quarterly', value: 'FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=1' },
              { label: 'Every other Friday, ten times', value: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR;COUNT=10' },
            ].map((pattern) => (
              <div key={pattern.label} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
                <span>{pattern.label}</span>
                <button type="button" onClick={() => setRuleText(pattern.value)} className="font-mono-j text-[10px] text-cyan-j hover:underline">{pattern.value}</button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Pills items={[{ label: 'FREQ', value: config.freq }, { label: 'COUNT', value: config.end === 'count' ? String(config.count) : '—' }]} />
          </div>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The rule is assembled from the RFC 5545 parts you select, and the occurrence list is produced by stepping through calendar days and testing each against the
          same rule — so what you see is what the parts actually mean, not a separate calculation. Time of day is not part of a recurrence rule, which is why the
          start datetime is shown separately.
        </p>
      </Panel>
    </ToolShell>
  );
}