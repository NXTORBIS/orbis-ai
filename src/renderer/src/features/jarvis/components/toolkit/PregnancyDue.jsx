import { useMemo, useState } from 'react';
import { Baby, CalendarDays } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const MILESTONES = [
  { week: 8, label: 'First scan window opens' },
  { week: 12, label: 'End of the first trimester' },
  { week: 16, label: 'Many feel first movements' },
  { week: 20, label: 'Anatomy scan' },
  { week: 24, label: 'Viability milestone' },
  { week: 28, label: 'Third trimester begins' },
  { week: 32, label: 'Growth scans often start' },
  { week: 37, label: 'Early term — full term next' },
  { week: 40, label: 'Estimated due date' },
];

const formatDate = (date) => (Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }));

export default function PregnancyDue() {
  const [mode, setMode] = useState('lmp');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [cycle, setCycle] = useState('28');
  const [dueInput, setDueInput] = useState('');

  const computed = useMemo(() => {
    const cycleLength = Math.max(20, Math.min(45, Number(cycle) || 28));
    let dueDate;
    let conception;
    if (mode === 'due' && dueInput) {
      dueDate = new Date(`${dueInput}T00:00:00`);
      conception = new Date(dueDate.getTime() - 266 * 86400000);
    } else if (mode === 'conception' && date) {
      conception = new Date(`${date}T00:00:00`);
      dueDate = new Date(conception.getTime() + 266 * 86400000);
    } else {
      const lmp = new Date(`${date}T00:00:00`);
      const adjustment = cycleLength - 28;
      dueDate = new Date(lmp.getTime() + (280 + adjustment) * 86400000);
      conception = new Date(lmp.getTime() + (14 + adjustment) * 86400000);
    }
    if (Number.isNaN(dueDate.getTime())) return null;
    const now = new Date();
    const days = Math.floor((now - dueDate) / 86400000);
    const daysToGo = -days;
    const gestationDays = 280 - daysToGo;
    const weeks = Math.floor(gestationDays / 7);
    const remDays = gestationDays % 7;
    const trimester = weeks < 13 ? 1 : weeks < 28 ? 2 : 3;
    const progress = Math.max(0, Math.min(100, (gestationDays / 280) * 100));
    return { dueDate, conception, daysToGo, weeks, remDays, trimester, progress, gestationDays };
  }, [mode, date, cycle, dueInput]);

  const report = computed
    ? `Due date: ${formatDate(computed.dueDate)}\nEstimated conception: ${formatDate(computed.conception)}\nCurrently ${computed.weeks} weeks ${computed.remDays} days · trimester ${computed.trimester}\n${computed.daysToGo > 0 ? `${computed.daysToGo} days to go` : `${Math.abs(computed.daysToGo)} days past the due date`}`
    : '';

  return (
    <ToolShell
      toolId="pregnancy-due"
      icon={Baby}
      title="Pregnancy Due Date"
      desc="Work out the due date and how far along you are — from your last period, a known conception date, or a date you have already been given."
      state={{ mode, date, cycle, dueInput }}
      onRestore={(restored) => {
        if (restored.mode) setMode(restored.mode);
        if (restored.date) setDate(restored.date);
        if (restored.cycle !== undefined) setCycle(String(restored.cycle));
        if (restored.dueInput) setDueInput(restored.dueInput);
      }}
      exportText={report}
      exportName="due-date.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { value: 'lmp', label: 'From last period' },
            { value: 'conception', label: 'From conception' },
            { value: 'due', label: 'From a given due date' },
          ]}
        />
        <CopyBtn value={report} label="Copy dates" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'due' ? (
          <Field label="Due date you were given">
            <input type="date" value={dueInput} onChange={(e) => setDueInput(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
        ) : (
          <Field label={mode === 'lmp' ? 'First day of your last period' : 'Estimated conception date'}>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
          </Field>
        )}
        {mode === 'lmp' && (
          <Field label="Typical cycle length (days)" hint="28 is the average — longer cycles shift the date">
            <input value={cycle} onChange={(e) => setCycle(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        )}
      </div>

      {computed ? (
        <>
          <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Estimated due date</div>
            <div className="tk-title-glow mt-1 font-display text-2xl font-semibold text-cyan-j">{formatDate(computed.dueDate)}</div>
            <div className="mt-1 font-mono-j text-[11px] text-muted-foreground">
              {computed.daysToGo > 0
                ? `${computed.daysToGo} days to go · ${Math.round(computed.daysToGo / 7)} weeks`
                : `${Math.abs(computed.daysToGo)} days past the date — talk to your midwife`}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="How far along" value={`${computed.weeks}w ${computed.remDays}d`} mono />
            <Stat label="Trimester" value={String(computed.trimester)} mono />
            <Stat label="Days pregnant" value={String(Math.max(0, computed.gestationDays))} mono />
            <Stat label="Conception ~" value={formatDate(computed.conception)} mono />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <CalendarDays className="h-3.5 w-3.5 text-cyan-j" /> Timeline
            </div>
            <div className="space-y-1">
              {MILESTONES.map((milestone) => {
                const milestoneDate = new Date(computed.dueDate.getTime() - (280 - milestone.week * 7) * 86400000);
                const passed = computed.weeks > milestone.week;
                return (
                  <div key={milestone.week} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${passed ? 'border-border/40 bg-card/40 text-muted-foreground' : 'border-cyan-j/30 bg-cyan-j/5'}`}>
                    <span>Week {milestone.week} · {milestone.label}</span>
                    <span className="font-mono-j">{formatDate(milestoneDate).replace(/^\w+, /, '')}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <div className="h-2.5 overflow-hidden rounded-full border border-border/70 bg-card/60">
            <div className="h-full rounded-full bg-gradient-to-r from-cyan-j/60 to-cyan-j" style={{ width: `${computed.progress}%` }} />
          </div>
          <p className="text-center font-mono-j text-[11px] text-muted-foreground">{computed.progress.toFixed(0)}% of 40 weeks</p>
        </>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">Enter a date to see the timeline.</Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Only about 4% of babies arrive exactly on the estimated date — it is a statistical midpoint, and anything from 37 to 42 weeks is normal.
          Naegele's rule assumes a 28-day cycle, so if yours is longer the date shifts accordingly, which this tool accounts for. Always confirm dates
          with your midwife or doctor.
        </p>
      </Panel>
    </ToolShell>
  );
}