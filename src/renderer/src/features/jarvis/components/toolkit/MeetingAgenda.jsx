import { useMemo, useState } from 'react';
import { Hourglass, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Gauge, Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const TYPES = [
  { id: 'decision', label: 'Decision', colour: '#34d399' },
  { id: 'discussion', label: 'Discussion', colour: '#22d3ee' },
  { id: 'update', label: 'Update', colour: '#fbbf24' },
  { id: 'blocked', label: 'Blocked', colour: '#fb7185' },
];

const START = [
  { id: uid(), title: 'Progress since last week', minutes: '5', type: 'update', owner: 'Alex' },
  { id: uid(), title: 'Decide: launch date', minutes: '10', type: 'decision', owner: 'Sam' },
  { id: uid(), title: 'Pricing concerns raised by support', minutes: '8', type: 'discussion', owner: 'Jordan' },
  { id: uid(), title: 'Blocked: analytics access', minutes: '5', type: 'blocked', owner: 'Alex' },
  { id: uid(), title: 'Actions and owners', minutes: '5', type: 'decision', owner: 'Sam' },
];

const pad = (value) => String(value).padStart(2, '0');

const clockFrom = (baseMinutes, offset) => {
  const total = baseMinutes + offset;
  const hours = Math.floor((total / 60) % 24);
  const minutes = Math.round(total % 60);
  return pad(hours) + ':' + pad(minutes);
};

export default function MeetingAgenda() {
  const [items, setItems] = useState(START);
  const [startTime, setStartTime] = useState('10:00');
  const [slot, setSlot] = useState('30');
  const [buffer, setBuffer] = useState('2');
  const [view, setView] = useState('timed');

  const plan = useMemo(() => {
    const [hoursRaw, minutesRaw] = startTime.split(':');
    const base = (Number(hoursRaw) || 0) * 60 + (Number(minutesRaw) || 0);
    let cursor = 0;
    let overrun = false;

    const scheduled = items.map((item) => {
      const minutes = Number(item.minutes) || 0;
      const start = cursor;
      cursor += minutes + (Number(buffer) || 0);
      const type = TYPES.find((entry) => entry.id === item.type) || TYPES[2];
      const row = {
        ...item,
        typeLabel: type.label,
        colour: type.colour,
        minutes,
        startOffset: start,
        startClock: clockFrom(base, start),
        endClock: clockFrom(base, start + minutes),
      };
      if (cursor - (Number(buffer) || 0) > (Number(slot) || 0)) overrun = true;
      return row;
    });

    const totalMinutes = items.reduce((sum, item) => sum + (Number(item.minutes) || 0), 0);
    const withBuffers = totalMinutes + Math.max(0, items.length - 1) * (Number(buffer) || 0);
    const available = Number(slot) || 0;
    const byType = TYPES.map((type) => ({
      label: type.label,
      value: items.filter((item) => item.type === type.id).reduce((sum, item) => sum + (Number(item.minutes) || 0), 0),
    })).filter((row) => row.value > 0);

    const decisionShare = totalMinutes ? ((byType.find((row) => row.label === 'Decision')?.value || 0) / totalMinutes) * 100 : 0;
    const updateShare = totalMinutes ? ((byType.find((row) => row.label === 'Update')?.value || 0) / totalMinutes) * 100 : 0;
    const longest = [...scheduled].sort((a, b) => b.minutes - a.minutes)[0];
    const owners = [...new Set(items.map((item) => item.owner).filter(Boolean))];

    const verdict = withBuffers > available
      ? { tone: 'rose', label: 'Over the slot', note: 'cut ' + (withBuffers - available) + ' minutes to fit' }
      : withBuffers > available * 0.9
        ? { tone: 'amber', label: 'Tight', note: 'no room for a slow start' }
        : { tone: 'emerald', label: 'Fits comfortably', note: (available - withBuffers) + ' minutes spare' };

    return { scheduled, totalMinutes, withBuffers, available, byType, decisionShare, updateShare, longest, owners, verdict, overrun };
  }, [items, startTime, slot, buffer]);

  const report = useMemo(() => [
    'Agenda · ' + startTime + ' · ' + slot + ' minute slot' + (Number(buffer) ? ' · ' + buffer + ' minute buffer between items' : ''),
    '',
    ...plan.scheduled.map((item) => item.startClock + '–' + item.endClock + '  ' + item.title + (item.owner ? '  (' + item.owner + ')' : '') + '  [' + item.typeLabel + ', ' + item.minutes + ' min]'),
    '',
    'Total ' + plan.totalMinutes + ' minutes of agenda + ' + (plan.withBuffers - plan.totalMinutes) + ' minutes of buffers = ' + plan.withBuffers + ' of ' + plan.available,
    'Decision time ' + plan.decisionShare.toFixed(0) + '% · update time ' + plan.updateShare.toFixed(0) + '%',
    plan.verdict.label + ' — ' + plan.verdict.note,
  ].join('\n'), [plan, startTime, slot, buffer]);

  const setItem = (id, patch) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  return (
    <ToolShell
      toolId="meeting-agenda"
      icon={Hourglass}
      title="Meeting Agenda Timer"
      desc="Build an agenda that fits its slot, see the clock for every item, and find out whether the meeting is actually spending its time on decisions."
      state={{ items, startTime, slot, buffer, view }}
      onRestore={(restored) => {
        if (Array.isArray(restored.items) && restored.items.length) setItems(restored.items);
        if (restored.startTime) setStartTime(restored.startTime);
        if (restored.slot !== undefined) setSlot(String(restored.slot));
        if (restored.buffer !== undefined) setBuffer(String(restored.buffer));
        if (restored.view) setView(restored.view);
      }}
      exportText={report}
      exportName="agenda.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={view} onChange={setView} options={[{ value: 'timed', label: 'With clock times' }, { value: 'plain', label: 'Minutes only' }]} />
        <CopyBtn value={report} label="Copy the agenda" />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Start time">
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
        </Field>
        <Field label={'Slot · ' + slot + ' minutes'}>
          <input type="range" min={10} max={120} step={5} value={slot} onChange={(e) => setSlot(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={'Buffer between items · ' + buffer + ' min'}>
          <input type="range" min={0} max={5} step={1} value={buffer} onChange={(e) => setBuffer(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Minutes on updates">
          <div className="flex h-9 items-center justify-end font-mono-j text-sm" style={{ color: plan.updateShare > 30 ? '#fbbf24' : undefined }}>
            {plan.updateShare.toFixed(0)}%
          </div>
        </Field>
      </div>

      <div className="space-y-2">
        {plan.scheduled.map((item) => (
          <div key={item.id} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="grid gap-2 sm:grid-cols-[4.5rem_1.6fr_1fr_6rem_1fr_auto] sm:items-center">
              {view === 'timed' ? (
                <div className="font-mono-j text-[11px] text-cyan-j">{item.startClock}<span className="text-muted-foreground">–{item.endClock}</span></div>
              ) : (
                <div className="font-mono-j text-[11px] text-muted-foreground">+{item.startOffset}m</div>
              )}
              <input value={item.title} onChange={(e) => setItem(item.id, { title: e.target.value })} placeholder="Agenda item" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={item.owner} onChange={(e) => setItem(item.id, { owner: e.target.value })} placeholder="Owner" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
              <input value={item.minutes} onChange={(e) => setItem(item.id, { minutes: e.target.value })} inputMode="numeric" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
              <select value={item.type} onChange={(e) => setItem(item.id, { type: e.target.value })} className="h-9 rounded-md border border-input bg-transparent px-2 text-[11px]">
                {TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
              </select>
              <button type="button" onClick={() => setItems((current) => current.filter((row) => row.id !== item.id))} className="text-muted-foreground transition hover:text-rose-400">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: Math.min(100, (item.minutes / Math.max(1, plan.totalMinutes)) * 100) + '%', backgroundColor: item.colour }} />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setItems((current) => [...current, { id: uid(), title: '', minutes: '5', type: 'discussion', owner: '' }].slice(0, 20))}
        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
      >
        <Plus className="h-3.5 w-3.5" /> Add agenda item
      </button>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          tone={plan.verdict.tone}
          label="Agenda against the slot"
          value={plan.withBuffers}
          unit={'of ' + plan.available + ' min'}
          sub={plan.verdict.label + ' — ' + plan.verdict.note}
        />
        <Gauge
          value={plan.decisionShare}
          min={0}
          max={100}
          unit="%"
          label="Time spent on decisions"
          caption={plan.decisionShare < 20 ? 'Under a fifth of the meeting is making decisions — most of this could be written.' : plan.decisionShare > 60 ? 'Most of the meeting is decisions, which is exactly what a meeting is for.' : 'A reasonable balance of deciding and informing.'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where the minutes go</div>
          <Bars
            data={plan.byType.map((row) => {
              const type = TYPES.find((entry) => entry.label === row.label);
              return { label: row.label, value: row.value, colour: type ? type.colour : undefined };
            })}
            format={(value) => String(value)}
            suffix=" min"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {plan.updateShare > 30
              ? 'Updates take ' + plan.updateShare.toFixed(0) + '% of the meeting. Move them into a written thread and the meeting shrinks by about ' + Math.round(plan.totalMinutes * (plan.updateShare / 100)) + ' minutes.'
              : 'Update time is under a third of the meeting, so most of it is being used for discussion and decisions.'}
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Running the meeting from this</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Send the agenda with times before the meeting; people arrive prepared or they notice why they were not needed.</p>
            <p>· The longest item is <span className="text-cyan-j">{plan.longest ? plan.longest.title : '—'}</span> at {plan.longest ? plan.longest.minutes : 0} minutes. Start with the decision, not the update.</p>
            <p>· Use the buffer: {Number(buffer) ? buffer + ' minutes between items is what stops one overrun from eating the rest.' : 'with no buffer, one overrun cascades through the whole agenda.'}</p>
            <p>· End with actions, owners and a date — an agenda without an owner per item is a list, not a plan.</p>
            <p>· Owners on this agenda: {plan.owners.length ? plan.owners.join(', ') : 'nobody yet'}. Every item should have one name against it.</p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Items" value={String(items.length)} mono />
        <Stat label="Agenda minutes" value={String(plan.totalMinutes)} mono />
        <Stat label="With buffers" value={String(plan.withBuffers)} mono />
        <Stat label="Left over" value={String(plan.available - plan.withBuffers)} mono sub={(plan.available - plan.withBuffers) < 0 ? 'over the slot' : 'minutes spare'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The four kinds of agenda item</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· <span className="text-emerald-400">Decision</span> — needs the right people in the room and ends with a recorded answer. These earn the meeting.</p>
          <p>· <span className="text-cyan-j">Discussion</span> — worth live only when it needs back-and-forth; otherwise write it down.</p>
          <p>· <span className="text-amber-400">Update</span> — almost always better as a message. Keep it to five minutes, at the end, if at all.</p>
          <p>· <span className="text-rose-400">Blocked</span> — an unblocking item. Give it time early; nothing else moves while someone is stuck.</p>
          <p>· {plan.overrun ? 'This agenda exceeds the slot — trim the longest update item first, since that is the cheapest cut.' : 'This agenda stays inside its slot, with room for one surprise.'}</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Slot', value: slot + ' min' },
              { label: 'Buffer', value: buffer + ' min' },
              { label: 'Decisions', value: plan.decisionShare.toFixed(0) + '%' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Times are computed from the start time and the running total, so reordering items or changing one duration re-times the whole agenda. The clock
          column is what you show in the meeting: knowing an item ends at 10:12 is what keeps a conversation honest, far more than a duration does.
        </p>
      </Panel>
    </ToolShell>
  );
}