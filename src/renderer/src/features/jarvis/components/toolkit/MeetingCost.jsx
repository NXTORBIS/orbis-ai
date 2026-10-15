import { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START = [
  { id: uid(), role: 'You', rate: '60' },
  { id: uid(), role: 'Manager', rate: '75' },
  { id: uid(), role: 'Engineer', rate: '70' },
  { id: uid(), role: 'Engineer', rate: '70' },
];

const money = (value) => `$${value.toLocaleString(undefined, { maximumFractionDigits: value < 100 ? 2 : 0 })}`;

export default function MeetingCost() {
  const [people, setPeople] = useState(START);
  const [minutes, setMinutes] = useState('45');
  const [prep, setPrep] = useState('10');
  const [perWeek, setPerWeek] = useState('1');
  const [weeks, setWeeks] = useState('46');
  const [isRecurring, setIsRecurring] = useState(true);
  const [includePrep, setIncludePrep] = useState(true);

  const result = useMemo(() => {
    const rates = people.filter((person) => Number(person.rate) > 0);
    const totalRate = rates.reduce((sum, person) => sum + (Number(person.rate) || 0), 0);
    const meetingHours = (Number(minutes) || 0) / 60;
    const prepHours = includePrep ? (Number(prep) || 0) / 60 : 0;
    const paidHours = meetingHours + prepHours;
    const cost = totalRate * paidHours;
    const attendeeMinutes = rates.length * (Number(minutes) || 0);
    const occurrences = isRecurring ? (Number(perWeek) || 0) * (Number(weeks) || 0) : 1;
    const yearly = cost * occurrences;
    const personHoursYearly = (occurrences * paidHours * rates.length);
    const durationCompare = [15, 30, 45, 60, 90].map((slot) => ({
      label: `${slot}m`,
      value: totalRate * (slot / 60 + prepHours),
    }));
    const contributions = rates.map((person) => ({ label: person.role.slice(0, 8), value: (Number(person.rate) || 0) * paidHours }));
    const verdict = attendeeMinutes > 400 && Number(minutes) > 45
      ? { tone: 'rose', label: 'Justify it' }
      : attendeeMinutes > 200
        ? { tone: 'amber', label: 'Trim it' }
        : { tone: 'emerald', label: 'Reasonable' };
    return {
      rates, totalRate, cost, yearly, occurrences, attendeeMinutes, durationCompare, contributions,
      verdict, personHoursYearly, perMinute: totalRate / 60, paidHours,
      workDays: personHoursYearly / 8,
    };
  }, [people, minutes, prep, perWeek, weeks, isRecurring, includePrep]);

  const setPerson = (id, patch) => setPeople((current) => current.map((person) => (person.id === id ? { ...person, ...patch } : person)));

  const report = [
    `${people.length} people · ${minutes} minutes${includePrep ? ` + ${prep} minutes prep each` : ''}`,
    `Cost per meeting: ${money(result.cost)}`,
    isRecurring ? `${result.occurrences} times a year: ${money(result.yearly)}` : 'One-off',
    `${result.attendeeMinutes} attendee-minutes · ${result.personHoursYearly.toFixed(1)} person-hours a year (${result.workDays.toFixed(1)} working days)`,
    `Verdict: ${result.verdict.label}`,
  ].join('\n');

  return (
    <ToolShell
      toolId="meeting-cost"
      icon={Users}
      title="Meeting Cost Calculator"
      desc="What this meeting actually costs in salaries and person-hours — and the number that makes everyone's eyes widen when it is shown in the room."
      state={{ people, minutes, prep, perWeek, weeks, isRecurring, includePrep }}
      onRestore={(restored) => {
        if (Array.isArray(restored.people) && restored.people.length) setPeople(restored.people);
        if (restored.minutes !== undefined) setMinutes(String(restored.minutes));
        if (restored.prep !== undefined) setPrep(String(restored.prep));
        if (restored.perWeek !== undefined) setPerWeek(String(restored.perWeek));
        if (restored.weeks !== undefined) setWeeks(String(restored.weeks));
        if (typeof restored.isRecurring === 'boolean') setIsRecurring(restored.isRecurring);
        if (typeof restored.includePrep === 'boolean') setIncludePrep(restored.includePrep);
      }}
      exportText={report}
      exportName="meeting-cost.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={isRecurring ? 'recurring' : 'once'} onChange={(value) => setIsRecurring(value === 'recurring')} options={[{ value: 'recurring', label: 'Recurring' }, { value: 'once', label: 'One-off' }]} />
        <CopyBtn value={report} label="Copy cost" />
      </div>

      <div className="space-y-2">
        {people.map((person) => (
          <div key={person.id} className="grid grid-cols-[1.6fr_1fr_auto] items-center gap-2">
            <input value={person.role} onChange={(e) => setPerson(person.id, { role: e.target.value })} placeholder="Role" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono-j text-xs text-muted-foreground">$</span>
              <input
                value={person.rate}
                onChange={(e) => setPerson(person.id, { rate: e.target.value })}
                inputMode="decimal"
                placeholder="per hour"
                className="h-9 w-full rounded-md border border-input bg-transparent pl-6 pr-2 text-right font-mono-j text-sm"
              />
            </div>
            <button type="button" onClick={() => setPeople(people.filter((row) => row.id !== person.id))} disabled={people.length <= 1} className="text-muted-foreground transition hover:text-rose-400 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPeople((current) => [...current, { id: uid(), role: '', rate: '65' }].slice(0, 40))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add attendee
        </button>
        <span className="text-[11px] text-muted-foreground">{people.length} people · {money(result.totalRate)} per hour combined</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label={`Length · ${minutes} min`}>
          <input type="range" min={5} max={180} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Prep per person · ${prep} min`}>
          <input type="range" min={0} max={60} step={5} value={prep} onChange={(e) => setPrep(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Times a week">
          <input value={perWeek} onChange={(e) => setPerWeek(e.target.value)} inputMode="decimal" disabled={!isRecurring} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm disabled:opacity-40" />
        </Field>
        <Field label="Working weeks a year">
          <input value={weeks} onChange={(e) => setWeeks(e.target.value)} inputMode="numeric" disabled={!isRecurring} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm disabled:opacity-40" />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Include preparation time for each person" checked={includePrep} onChange={setIncludePrep} hint="Usually the hidden half of a meeting's cost" />
        <span className="self-center text-[11px] text-muted-foreground">{money(result.perMinute)} of salary burns every minute this meeting runs.</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={result.verdict.tone}
          label="This meeting costs"
          value={money(result.cost)}
          sub={`${people.length} people for ${minutes} minutes${includePrep ? ` plus ${prep} minutes of prep each` : ''} · ${result.verdict.label.toLowerCase()}`}
        />
        <Ring
          value={Math.min(90, Number(minutes))}
          max={90}
          tone={result.verdict.tone}
          label="Length"
          sub={`${minutes} of 90 minutes · ${result.attendeeMinutes} attendee-minutes`}
        />
      </div>

      {isRecurring && (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label="Times a year" value={String(result.occurrences)} mono />
          <Stat label="Cost a year" value={money(result.yearly)} mono />
          <Stat label="Person-hours a year" value={`${result.personHoursYearly.toFixed(0)} h`} mono />
          <Stat label="Equal to" value={`${result.workDays.toFixed(1)} days`} mono sub="of one person's work" />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Who is paying for it</div>
          <Bars data={result.contributions} format={(value) => money(value)} highlightLast={false} />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">The same meeting at other lengths</div>
          <Bars data={result.durationCompare} format={(value) => money(value)} highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The 15-minute column is the number to remember: if the meeting can be done in fifteen minutes, shortening it saves {money(result.durationCompare[0] ? result.cost - result.durationCompare[0].value : 0)} each time.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Make it cheaper without cancelling it</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Halve the room. Dropping one attendee at {money(Number(people[1]?.rate) || 70)} an hour saves {money(((Number(people[1]?.rate) || 70)) * result.paidHours * result.occurrences)} a year on this cadence.</p>
          <p>· Cut the length by fifteen minutes: it removes {money(result.cost - (result.durationCompare[1]?.value || 0))} per occurrence.</p>
          <p>· Kill prep with a written agenda and decisions-before-data — prep is {includePrep && Number(prep) > 0 ? `${Math.round((prepHoursShare(result.paidHours, prep, minutes) * 100))}% of the cost` : 'currently not counted'}.</p>
          <p>· Move status updates to a written thread and keep the meeting only for decisions. Anything that could be a comment should be a comment.</p>
          <p>· Send the number around before you start. Meetings shrink by themselves when the price is on the screen.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Per minute', value: money(result.perMinute) },
              { label: 'Per attendee', value: money(result.cost / Math.max(1, people.length)) },
              { label: 'Verdict', value: result.verdict.label },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Use the fully loaded hourly rate if you can — salary plus benefits, tax and overhead is typically 1.25 to 1.4 times the salary figure divided by
          about 1,800 working hours a year. The point is not guilt, it is comparison: a {money(result.cost)} meeting is worth it if it makes a decision worth
          more than that, and worth cancelling if it would have been a two-line message.
        </p>
      </Panel>
    </ToolShell>
  );
}

const prepHoursShare = (paid, prep, minutes) => {
  const prepPart = paid - (Number(minutes) || 0) / 60;
  return paid > 0 ? Math.max(0, prepPart / paid) : 0;
};