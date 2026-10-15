import { useEffect, useMemo, useState } from 'react';
import { Clock, Plus, Trash2, RotateCcw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Out, CopyBtn, Stat, Panel } from './shared';
import ToolShell from './kit/ToolShell';

const STORAGE = 'toolkit_time_card_v1';

const minutesOf = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
};

const emptyRow = () => ({ id: Math.random().toString(36).slice(2), label: '', start: '09:00', end: '17:30', breakMin: 30 });

const defaults = () => ({
  rows: [
    { ...emptyRow(), id: '1', label: 'Monday' },
    { ...emptyRow(), id: '2', label: 'Tuesday' },
    { ...emptyRow(), id: '3', label: 'Wednesday' },
  ],
  rate: '25',
  threshold: '40',
  multiplier: '1.5',
  symbol: '$',
});

export default function TimeCard() {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      return saved ? { ...defaults(), ...JSON.parse(saved) } : defaults();
    } catch {
      return defaults();
    }
  });

  useEffect(() => { localStorage.setItem(STORAGE, JSON.stringify(state)); }, [state]);

  const totals = useMemo(() => {
    const rows = state.rows.map((row) => {
      const start = minutesOf(row.start);
      const end = minutesOf(row.end);
      let minutes = null;
      if (start !== null && end !== null) {
        minutes = end - start;
        if (minutes < 0) minutes += 24 * 60;
        minutes -= Math.max(0, Number(row.breakMin) || 0);
        if (minutes < 0) minutes = 0;
      }
      return { ...row, minutes };
    });
    const worked = rows.reduce((sum, r) => sum + (r.minutes || 0), 0);
    const hours = worked / 60;
    const threshold = Number(state.threshold) || 0;
    const overtime = Math.max(0, hours - threshold);
    const regular = hours - overtime;
    const rate = Number(state.rate) || 0;
    const multiplier = Number(state.multiplier) || 1;
    return {
      rows,
      hours,
      overtime,
      regular,
      pay: regular * rate + overtime * rate * multiplier,
      overtimePay: overtime * rate * multiplier,
      average: rows.length ? hours / rows.length : 0,
      days: rows.length,
    };
  }, [state]);

  const update = (id, patch) => setState((cur) => ({ ...cur, rows: cur.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const set = (patch) => setState((cur) => ({ ...cur, ...patch }));

  const summary = [
    `Time card${state.rows.length ? ` — ${totals.days} entries` : ''}`,
    ...totals.rows.map((r) => `${r.label || 'Entry'}  ${r.start}–${r.end}${r.breakMin ? ` (−${r.breakMin}m break)` : ''}  = ${r.minutes === null ? '—' : `${Math.floor(r.minutes / 60)}h ${String(r.minutes % 60).padStart(2, '0')}m`}`),
    '',
    `Total: ${Math.floor(totals.hours)}h ${String(Math.round((totals.hours % 1) * 60)).padStart(2, '0')}m`,
    `Overtime beyond ${state.threshold}h: ${totals.overtime.toFixed(2)}h`,
    Number(state.rate) ? `Pay: ${state.symbol}${totals.pay.toFixed(2)}` : null,
  ].filter(Boolean).join('\n');

  return (
    <ToolShell
      toolId="time-card"
      icon={Clock}
      title="Time Card & Hours Calculator"
      desc="Add your shifts, get daily hours, weekly overtime and pay — kept on this device."
      state={{ card: state }}
      onRestore={(saved) => { if (saved.card) setState(saved.card); }}
      exportText={JSON.stringify(totals, null, 2)}
      exportName="time-card.json"
      exportMime="application/json"
    >
      <div className="space-y-2">
        {state.rows.map((row) => {
          const calc = totals.rows.find((r) => r.id === row.id);
          return (
            <Panel key={row.id} className="p-3">
              <div className="grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_1fr_auto] sm:items-end">
                <Field label="Day / label"><input value={row.label} onChange={(e) => update(row.id, { label: e.target.value })} placeholder="Monday" className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                <Field label="Start"><input type="time" value={row.start} onChange={(e) => update(row.id, { start: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="End"><input type="time" value={row.end} onChange={(e) => update(row.id, { end: e.target.value })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Break (min)"><input type="number" value={row.breakMin} onChange={(e) => update(row.id, { breakMin: Number(e.target.value) })} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <div className="flex items-center gap-2">
                  <span className="min-w-16 rounded-lg border border-border/70 bg-card/60 px-2 py-2 text-center font-mono-j text-xs">
                    {calc?.minutes === null || calc?.minutes === undefined ? '—' : `${Math.floor(calc.minutes / 60)}h${String(calc.minutes % 60).padStart(2, '0')}`}
                  </span>
                  <Button size="icon" variant="outline" onClick={() => set({ rows: state.rows.filter((r) => r.id !== row.id) })}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => set({ rows: [...state.rows, emptyRow()] })}><Plus className="h-3.5 w-3.5" /> Add entry</Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setState(defaults())}><RotateCcw className="h-3.5 w-3.5" /> Reset week</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Hourly rate"><input value={state.rate} onChange={(e) => set({ rate: e.target.value })} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Currency">
          <div className="flex flex-wrap gap-1.5">
            {['$', '₹', '€', '£'].map((s) => (
              <button key={s} onClick={() => set({ symbol: s })} className={`h-9 w-9 rounded-lg border text-sm transition ${state.symbol === s ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{s}</button>
            ))}
          </div>
        </Field>
        <Field label="Overtime after (hours)"><input value={state.threshold} onChange={(e) => set({ threshold: e.target.value })} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Overtime multiplier"><input value={state.multiplier} onChange={(e) => set({ multiplier: e.target.value })} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <Out label="Summary" value={summary}>
        <pre className="whitespace-pre-wrap font-mono-j text-[11px] text-cyan-j">{summary}</pre>
      </Out>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Total hours" value={`${totals.hours.toFixed(2)} h`} />
        <Stat label="Entries" value={String(totals.days)} />
        <Stat label="Average per entry" value={`${totals.average.toFixed(2)} h`} />
        <Stat label="Overtime" value={`${totals.overtime.toFixed(2)} h`} />
        <Stat label="Regular pay" value={`${state.symbol}${(totals.regular * (Number(state.rate) || 0)).toFixed(2)}`} />
        <Stat label="Overtime pay" value={`${state.symbol}${totals.overtimePay.toFixed(2)}`} />
        <Stat label="Total pay" value={`${state.symbol}${totals.pay.toFixed(2)}`} />
        <Stat label="Effective hourly" value={`${state.symbol}${totals.hours ? (totals.pay / totals.hours).toFixed(2) : '0.00'}`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={summary} label="Copy summary" />
      </div>
      <p className="text-[11px] text-muted-foreground">Shifts that run past midnight are handled automatically — a 22:00 to 06:00 entry counts as eight hours. Everything stays in this browser.</p>
    </ToolShell>
  );
}