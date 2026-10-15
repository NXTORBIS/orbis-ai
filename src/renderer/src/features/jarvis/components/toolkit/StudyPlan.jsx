import { useMemo, useState } from 'react';
import { CalendarRange, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

const START = [
  { id: uid(), name: 'Mathematics', hours: '8', priority: 'high' },
  { id: uid(), name: 'Physics', hours: '6', priority: 'high' },
  { id: uid(), name: 'History', hours: '4', priority: 'medium' },
  { id: uid(), name: 'Spanish', hours: '3', priority: 'low' },
];

export default function StudyPlan() {
  const [subjects, setSubjects] = useState(START);
  const [daysPerWeek, setDaysPerWeek] = useState('5');
  const [hoursPerDay, setHoursPerDay] = useState('3');
  const [session, setSession] = useState('45');
  const [breakMin, setBreakMin] = useState('10');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [restDay, setRestDay] = useState('Sunday');

  const plan = useMemo(() => {
    const active = subjects.filter((subject) => Number(subject.hours) > 0 && subject.name.trim());
    const totalNeeded = active.reduce((sum, subject) => sum + (Number(subject.hours) || 0), 0);
    const blockCount = Math.max(1, Math.floor((Number(hoursPerDay) * 60) / (Number(session) + Number(breakMin))));
    const daysAvailable = Math.max(1, Number(daysPerWeek) || 1);
    const capacityHours = (blockCount * Number(session) * daysAvailable) / 60;
    const totalWeight = active.reduce((sum, subject) => sum + PRIORITY_WEIGHT[subject.priority], 0) || 1;

    const start = new Date(`${startDate}T00:00:00`);
    const studyDays = [];
    for (let i = 0; studyDays.length < daysAvailable && i < 14; i += 1) {
      const date = new Date(start.getTime() + i * 86400000);
      const name = date.toLocaleDateString(undefined, { weekday: 'long' });
      if (name !== restDay) studyDays.push({ date, name, short: name.slice(0, 3) });
    }

    const allocation = active.map((subject) => ({
      ...subject,
      target: (totalNeeded * PRIORITY_WEIGHT[subject.priority]) / totalWeight,
      scheduled: 0,
    }));

    const timetable = studyDays.map((day, dayIndex) => {
      const blocks = [];
      for (let block = 0; block < blockCount; block += 1) {
        const pool = [...allocation]
          .map((subject) => ({ subject, need: subject.target - subject.scheduled }))
          .sort((a, b) => b.need - a.need);
        const chosen = pool.find((entry) => entry.need > 0.01) || pool[0];
        if (!chosen) break;
        chosen.subject.scheduled += Number(session) / 60;
        blocks.push({ name: chosen.subject.name, minutes: Number(session) });
      }
      return { ...day, blocks, index: dayIndex };
    });

    const perSubject = allocation.map((subject) => ({
      name: subject.name,
      needed: Number(subject.hours) || 0,
      scheduled: subject.scheduled,
      priority: subject.priority,
      weeks: (Number(subject.hours) || 0) / Math.max(0.01, subject.scheduled || 0.01),
    }));

    return { active, totalNeeded, blockCount, studyDays, timetable, perSubject, capacityHours, sessions: timetable.reduce((sum, day) => sum + day.blocks.length, 0) };
  }, [subjects, daysPerWeek, hoursPerDay, session, breakMin, startDate, restDay]);

  const weeksToFinish = plan.perSubject.length ? Math.max(...plan.perSubject.map((subject) => subject.weeks)) : 0;

  const report = [
    `Study plan from ${startDate} · ${daysPerWeek} days a week, ${hoursPerDay} hours a day, ${session} minute blocks`,
    `Capacity ${plan.capacityHours.toFixed(1)} hours a week against ${plan.totalNeeded} hours of work to cover`,
    '',
    ...plan.timetable.map((day) => `${day.short}: ${day.blocks.map((block) => block.name).join(' · ') || 'rest'}`),
    '',
    'Hours this week per subject:',
    ...plan.perSubject.map((subject) => `${subject.name}: ${subject.scheduled.toFixed(1)} h scheduled of ${subject.needed} h wanted (${subject.priority} priority)`),
  ].join('\n');

  const setSubject = (id, patch) => setSubjects((current) => current.map((subject) => (subject.id === id ? { ...subject, ...patch } : subject)));

  return (
    <ToolShell
      toolId="study-plan"
      icon={CalendarRange}
      title="Study Timetable Builder"
      desc="Turn a pile of subjects into a week you can actually follow — priority-weighted blocks, real breaks and the weeks-to-finish maths."
      state={{ subjects, daysPerWeek, hoursPerDay, session, breakMin, startDate, restDay }}
      onRestore={(restored) => {
        if (Array.isArray(restored.subjects) && restored.subjects.length) setSubjects(restored.subjects);
        if (restored.daysPerWeek !== undefined) setDaysPerWeek(String(restored.daysPerWeek));
        if (restored.hoursPerDay !== undefined) setHoursPerDay(String(restored.hoursPerDay));
        if (restored.session !== undefined) setSession(String(restored.session));
        if (restored.breakMin !== undefined) setBreakMin(String(restored.breakMin));
        if (restored.startDate) setStartDate(restored.startDate);
        if (restored.restDay) setRestDay(restored.restDay);
      }}
      exportText={report}
      exportName="study-plan.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={session} onChange={setSession} options={[{ value: '25', label: '25 min blocks' }, { value: '45', label: '45 min' }, { value: '60', label: '60 min' }, { value: '90', label: '90 min' }]} />
        <CopyBtn value={report} label="Copy timetable" />
      </div>

      <div className="space-y-2">
        {subjects.map((subject) => (
          <div key={subject.id} className="tk-card tk-depth grid grid-cols-[1.4fr_0.8fr_auto_auto] items-center gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <input value={subject.name} onChange={(e) => setSubject(subject.id, { name: e.target.value })} placeholder="Subject" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm" />
            <input value={subject.hours} onChange={(e) => setSubject(subject.id, { hours: e.target.value })} inputMode="decimal" placeholder="Hours" className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm" />
            <div className="flex gap-1">
              {['high', 'medium', 'low'].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setSubject(subject.id, { priority: level })}
                  className={`rounded-lg border px-2 py-1 text-[10px] capitalize transition ${subject.priority === level ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
                >
                  {level}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setSubjects(subjects.filter((row) => row.id !== subject.id))} disabled={subjects.length <= 1} className="text-muted-foreground transition hover:text-red-500 disabled:opacity-30">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSubjects((current) => [...current, { id: uid(), name: '', hours: '3', priority: 'medium' }].slice(0, 10))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a subject
        </button>
        <span className="text-[11px] text-muted-foreground">{plan.totalNeeded} hours of work to place this week</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Study days a week">
          <Seg value={daysPerWeek} onChange={setDaysPerWeek} options={[{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }, { value: '6', label: '6' }]} />
        </Field>
        <Field label={`Hours available each day · ${hoursPerDay}`}>
          <input type="range" min={1} max={10} step={0.5} value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Break between blocks · ${breakMin} min`}>
          <input type="range" min={0} max={30} step={5} value={breakMin} onChange={(e) => setBreakMin(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Starting from">
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="Rest day">
          <select value={restDay} onChange={(e) => setRestDay(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            {DAYS.map((day) => <option key={day} value={day}>{day}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label="Finish the list in"
          value={weeksToFinish ? weeksToFinish.toFixed(1) : '0'}
          unit="weeks"
          sub={`${plan.sessions} sessions a week · ${plan.capacityHours.toFixed(1)} hours of capacity against ${plan.totalNeeded} hours wanted`}
        />
        <Ring
          value={Math.min(plan.capacityHours, plan.totalNeeded)}
          max={plan.totalNeeded || 1}
          tone={plan.capacityHours >= plan.totalNeeded ? 'emerald' : 'amber'}
          label="Wanted vs available this week"
          sub={`${plan.capacityHours.toFixed(1)} h available`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {plan.timetable.map((day) => (
          <div key={day.short} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">{day.name}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{day.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            </div>
            <div className="space-y-1">
              {day.blocks.map((block, index) => (
                <div key={`${day.short}-${index}`} className="flex items-center gap-2 rounded-lg border border-cyan-j/40 bg-cyan-j/5 px-2 py-1.5 text-[11px]">
                  <span className="font-mono-j text-[10px] text-muted-foreground">{index + 1}</span>
                  <span className="flex-1 truncate">{block.name}</span>
                  <span className="font-mono-j text-[10px] text-cyan-j">{block.minutes}m</span>
                </div>
              ))}
              {!day.blocks.length && <span className="text-[11px] text-muted-foreground">Nothing scheduled</span>}
            </div>
            <div className="mt-2 font-mono-j text-[10px] text-muted-foreground">
              {day.blocks.length} blocks · {((day.blocks.length * Number(session)) / 60).toFixed(1)} h study + {((day.blocks.length * Number(breakMin)) / 60).toFixed(1)} h breaks
            </div>
          </div>
        ))}
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Hours landing on each subject</div>
        <Bars data={plan.perSubject.map((subject) => ({ label: subject.name.slice(0, 9), value: subject.scheduled }))} format={(value) => value.toFixed(1)} suffix=" h" />
        <div className="mt-2 space-y-1">
          {plan.perSubject.map((subject) => {
            const covered = subject.needed ? (subject.scheduled / subject.needed) * 100 : 100;
            return (
              <div key={subject.name} className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="flex-1 truncate">{subject.name}</span>
                <span className="font-mono-j text-muted-foreground capitalize">{subject.priority}</span>
                <span className="font-mono-j text-muted-foreground">{subject.scheduled.toFixed(1)} / {subject.needed} h</span>
                <span className={`font-mono-j ${covered >= 99 ? 'text-emerald-400' : 'text-amber-400'}`}>{covered.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Sessions a week" value={String(plan.sessions)} mono />
        <Stat label="Weekly hours" value={`${plan.capacityHours.toFixed(1)} h`} mono />
        <Stat label="Subjects" value={String(plan.active.length)} mono />
        <Stat label="Rest day" value={restDay} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Making it stick</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· {plan.capacityHours >= plan.totalNeeded ? 'Your week has enough room — resist adding more subjects until these are steady for two weeks.' : 'The plan asks for more hours than you have, so it prioritises high-priority subjects and stretches the rest over extra weeks.'}</p>
          <p>· Keep the hardest subject in your first block of the day; {session}-minute sessions work because starting is the hard part.</p>
          <p>· Review what you studied the previous day in the first ten minutes — retrieval beats re-reading by a wide margin.</p>
          <p>· Miss a day and shift the week rather than doubling up; a plan you dread is a plan you will abandon.</p>
          <div className="mt-2">
            <Pills
              items={[
                { label: 'Blocks each day', value: plan.blockCount },
                { label: 'Block length', value: `${session} min` },
                { label: 'Breaks', value: `${breakMin} min` },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Spaced repetition is built into the shape of this plan: shorter, more frequent sessions beat one long cram, which is why the scheduler spreads
          subjects across the week rather than stacking them. Priority weighting simply decides who gets the leftover blocks — a low-priority subject
          still gets covered, just over more weeks.
        </p>
      </Panel>
    </ToolShell>
  );
}