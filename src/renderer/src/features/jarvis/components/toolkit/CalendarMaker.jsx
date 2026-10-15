import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const isoWeek = (date) => {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil(((target - yearStart) / 86400000 + 1) / 7);
};

export default function CalendarMaker() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [weekNumbers, setWeekNumbers] = useState(true);
  const [monday, setMonday] = useState(true);
  const [notes, setNotes] = useState('');

  const data = useMemo(() => {
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = monday ? (first.getDay() + 6) % 7 : first.getDay();
    const cells = [];
    for (let i = 0; i < startOffset; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const weekdayCounts = WD.map((label, index) => {
      const target = monday ? (index + 1) % 7 : index;
      const count = Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)).filter((d) => d.getDay() === target).length;
      return { label: WD[index], count };
    });
    return { weeks, daysInMonth, weekdayCounts };
  }, [year, month, monday]);

  const name = new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const shift = (delta) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  const asText = useMemo(() => {
    const lines = [`${name}`, WD.join('\t')];
    data.weeks.forEach((week) => lines.push(week.map((day) => (day ? String(day.getDate()) : '')).join('\t')));
    return lines.join('\n');
  }, [data, name]);

  const svg = useMemo(() => {
    const columns = 7 + (weekNumbers ? 1 : 0);
    const cellW = 96;
    const cellH = 74;
    const width = columns * cellW;
    const height = 60 + data.weeks.length * cellH;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
    parts.push('<rect width="100%" height="100%" fill="#ffffff"/>');
    parts.push(`<text x="24" y="40" font-family="system-ui" font-size="26" font-weight="700" fill="#0f172a">${name}</text>`);
    const left = weekNumbers ? cellW : 0;
    WD.forEach((label, index) => {
      parts.push(`<text x="${left + index * cellW + cellW / 2}" y="56" text-anchor="middle" font-family="system-ui" font-size="13" fill="#64748b">${label.slice(0, 3)}</text>`);
    });
    data.weeks.forEach((week, rowIndex) => {
      const y = 62 + rowIndex * cellH;
      parts.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e2e8f0"/>`);
      if (weekNumbers && week[0]) {
        parts.push(`<text x="${cellW / 2}" y="${y + 30}" text-anchor="middle" font-family="system-ui" font-size="11" fill="#94a3b8">w${isoWeek(week[0])}</text>`);
      }
      week.forEach((day, index) => {
        const x = left + index * cellW;
        parts.push(`<line x1="${x}" y1="${y}" x2="${x}" y2="${y + cellH}" stroke="#e2e8f0"/>`);
        if (day) {
          const isToday = day.toDateString() === today.toDateString();
          if (isToday) parts.push(`<circle cx="${x + 22}" cy="${y + 26}" r="14" fill="#0ea5e9"/>`);
          parts.push(`<text x="${x + 22}" y="${y + 31}" text-anchor="middle" font-family="system-ui" font-size="14" font-weight="${isToday ? 700 : 500}" fill="${isToday ? '#ffffff' : '#0f172a'}">${day.getDate()}</text>`);
        }
      });
    });
    parts.push(`<line x1="0" y1="${62 + data.weeks.length * cellH}" x2="${width}" y2="${62 + data.weeks.length * cellH}" stroke="#e2e8f0"/>`);
    parts.push('</svg>');
    return parts.join('');
  }, [data, name, weekNumbers, today]);

  return (
    <ToolShell
      toolId="calendar-month"
      icon={CalendarDays}
      title="Month Calendar Maker"
      desc="Generate a clean, printable month — with week numbers, weekday counts and a plain-text version you can paste anywhere."
      state={{ year, month, weekNumbers, monday, notes }}
      onRestore={(restored) => {
        if (restored.year) setYear(Number(restored.year));
        if (restored.month !== undefined) setMonth(Number(restored.month));
        if (typeof restored.weekNumbers === 'boolean') setWeekNumbers(restored.weekNumbers);
        if (typeof restored.monday === 'boolean') setMonday(restored.monday);
        if (typeof restored.notes === 'string') setNotes(restored.notes);
      }}
      exportText={asText}
      exportName="calendar.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-cyan-j/50">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tk-card tk-depth min-w-[11rem] rounded-lg border border-cyan-j/40 bg-card/50 px-3 py-1.5 text-center font-display text-sm text-cyan-j">{name}</span>
          <button type="button" onClick={() => shift(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:border-cyan-j/50">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <Seg
          value={month}
          onChange={setMonth}
          options={Array.from({ length: 12 }, (_, i) => ({ value: i, label: new Date(2024, i, 1).toLocaleDateString(undefined, { month: 'short' }) }))}
        />
        <CopyBtn value={asText} label="Copy as text" />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${name.replace(/\s/g, '-').toLowerCase()}.svg`)}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          Download SVG
        </button>
        <button
          type="button"
          onClick={() => { window.print(); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Print
        </button>
      </div>

      <div className="tk-card tk-depth overflow-hidden rounded-xl border border-border/70">
        <div className={`grid ${weekNumbers ? 'grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]' : 'grid-cols-7'} border-b border-border/60 bg-card/60 text-[10px] uppercase tracking-wider text-muted-foreground`}>
          {weekNumbers && <div className="px-1 py-2 text-center">Wk</div>}
          {WD.map((label) => <div key={label} className="px-1 py-2 text-center">{label}</div>)}
        </div>
        {data.weeks.map((week, rowIndex) => (
          <div key={rowIndex} className={`grid ${weekNumbers ? 'grid-cols-[2.5rem_repeat(7,minmax(0,1fr))]' : 'grid-cols-7'} border-b border-border/40 last:border-b-0`}>
            {weekNumbers && (
              <div className="flex items-center justify-center border-r border-border/40 py-3 font-mono-j text-[10px] text-muted-foreground">
                {week[0] ? isoWeek(week[0]) : ''}
              </div>
            )}
            {week.map((day, index) => {
              const isToday = day && day.toDateString() === today.toDateString();
              return (
                <div key={index} className={`min-h-[3.5rem] border-r border-border/30 p-1.5 last:border-r-0 ${isToday ? 'bg-cyan-j/10' : ''}`}>
                  {day && (
                    <span className={`inline-grid h-7 w-7 place-items-center rounded-full font-mono-j text-xs ${isToday ? 'bg-cyan-j font-bold text-[hsl(var(--background))]' : ''}`}>
                      {day.getDate()}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Week numbers" checked={weekNumbers} onChange={setWeekNumbers} />
        <ToggleRow label="Week starts on Monday" checked={monday} onChange={setMonday} hint="ISO standard" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Weekdays in {name}</div>
        <div className="flex flex-wrap gap-1.5">
          {data.weekdayCounts.map((item) => (
            <span key={item.label} className="rounded-lg border border-border/60 px-2 py-1 font-mono-j text-[10px]">
              {item.label} <span className="text-cyan-j">{item.count}</span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{data.daysInMonth} days this month — useful when counting working days for a project or a pay period.</p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Plain text</div>
          <pre className="max-h-48 overflow-auto whitespace-pre font-mono-j text-[10px] text-cyan-j">{asText}</pre>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Notes for the month</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={7}
            placeholder="Term dates, deadlines, travel…"
            className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 text-xs"
          />
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Month" value={name} />
        <Stat label="Days" value={String(data.daysInMonth)} mono />
        <Stat label="Weeks shown" value={String(data.weeks.length)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The SVG export scales cleanly at any size, so it prints as sharply as a vector always does — great for a wall planner or a syllabus. Week
          numbers follow the ISO rule where week 1 contains the first Thursday of the year, which is what most payroll and school systems use.
        </p>
      </Panel>
    </ToolShell>
  );
}