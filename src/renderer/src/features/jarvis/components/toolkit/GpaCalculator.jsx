import { useMemo, useState } from 'react';
import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat, downloadBlob } from './shared';

const SCALES = [
  {
    id: 'letter', label: '4.0 letter',
    grades: ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'F'],
    points: { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, D: 1, F: 0 },
  },
  {
    id: 'ten', label: '10-point CGPA',
    grades: ['O', 'A+', 'A', 'B+', 'B', 'C', 'P', 'F'],
    points: { O: 10, 'A+': 9, A: 8, 'B+': 7, B: 6, C: 5, P: 4, F: 0 },
  },
  {
    id: 'percent', label: 'Percentage',
    grades: null,
    points: null,
  },
];

const uid = () => Math.random().toString(36).slice(2, 9);

const ROWS = [
  { id: uid(), name: 'Data structures', credits: 4, grade: 'A' },
  { id: uid(), name: 'Linear algebra', credits: 3, grade: 'B+' },
  { id: uid(), name: 'Technical writing', credits: 2, grade: 'A-' },
  { id: uid(), name: 'Operating systems', credits: 4, grade: 'B' },
];

export default function GpaCalculator() {
  const [scale, setScale] = useState('letter');
  const [rows, setRows] = useState(ROWS);

  const active = SCALES.find((s) => s.id === scale) || SCALES[0];

  const computed = useMemo(() => {
    const valid = rows
      .map((row) => {
        const credits = Number(row.credits) || 0;
        const points = active.points ? (active.points[row.grade] ?? 0) : (Number(row.grade) || 0) / (scale === 'percent' ? 10 : 1);
        return { ...row, credits, points };
      })
      .filter((row) => row.credits > 0);
    const credits = valid.reduce((sum, row) => sum + row.credits, 0);
    const weighted = valid.reduce((sum, row) => sum + row.credits * row.points, 0);
    const average = credits ? weighted / credits : 0;
    const percent = scale === 'percent' ? average * 10 : (average / (scale === 'ten' ? 10 : 4)) * 100;
    return { valid, credits, weighted, average, percent };
  }, [rows, active, scale]);

  const setRow = (id, patch) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addRow = () => setRows((current) => [...current, { id: uid(), name: '', credits: 3, grade: active.grades?.[1] ?? '80' }]);
  const removeRow = (id) => setRows((current) => (current.length > 1 ? current.filter((row) => row.id !== id) : current));

  const csv = ['course,credits,grade,points', ...computed.valid.map((row) => `"${row.name}",${row.credits},${row.grade},${row.points}`), `total,${computed.credits},,${computed.average.toFixed(3)}`].join('\n');

  const verdict = computed.percent >= 90 ? 'Outstanding' : computed.percent >= 80 ? 'Excellent' : computed.percent >= 70 ? 'Strong' : computed.percent >= 60 ? 'Solid' : computed.percent >= 50 ? 'Passing' : 'Needs work';

  return (
    <ToolShell
      toolId="gpa"
      icon={GraduationCap}
      title="GPA & CGPA Calculator"
      desc="Weight every course by its credits and see the real average — letter grades, 10-point CGPA or raw percentages, plus the CSV for your records."
      state={{ scale, rows }}
      onRestore={(restored) => {
        if (restored.scale) setScale(restored.scale);
        if (Array.isArray(restored.rows) && restored.rows.length) setRows(restored.rows);
      }}
      exportText={csv}
      exportName="gpa.csv"
    >
      <Field label="Grading scale">
        <Seg
          value={scale}
          onChange={(value) => {
            setScale(value);
            const next = SCALES.find((s) => s.id === value);
            if (next?.grades) setRows((current) => current.map((row) => ({ ...row, grade: next.points[row.grade] !== undefined ? row.grade : next.grades[1] })));
          }}
          options={SCALES.map((s) => ({ value: s.id, label: s.label }))}
        />
      </Field>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="tk-card tk-depth grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-2.5 sm:grid-cols-[1fr_84px_120px_auto] sm:items-center">
            <input
              value={row.name}
              onChange={(e) => setRow(row.id, { name: e.target.value })}
              placeholder="Course name"
              className="col-span-2 h-9 rounded-md border border-input bg-transparent px-2.5 text-sm sm:col-span-1"
            />
            <input
              value={String(row.credits)}
              onChange={(e) => setRow(row.id, { credits: e.target.value })}
              inputMode="decimal"
              placeholder="Credits"
              className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm"
            />
            {active.grades ? (
              <select
                value={row.grade}
                onChange={(e) => setRow(row.id, { grade: e.target.value })}
                className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-sm"
              >
                {active.grades.map((grade) => (
                  <option key={grade} value={grade}>{grade} · {active.points[grade]} pts</option>
                ))}
              </select>
            ) : (
              <input
                value={String(row.grade)}
                onChange={(e) => setRow(row.id, { grade: e.target.value })}
                inputMode="decimal"
                placeholder="Marks %"
                className="h-9 rounded-md border border-input bg-transparent px-2.5 text-right font-mono-j text-sm"
              />
            )}
            <button type="button" onClick={() => removeRow(row.id)} className="justify-self-end text-muted-foreground transition hover:text-red-500">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addRow} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a course
        </button>
        <CopyBtn value={csv} label="Copy table" />
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([csv], { type: 'text/csv' }), 'gpa.csv')}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Download CSV
        </button>
        <span className="text-[11px] text-muted-foreground">Drop credits to 0 to leave a course out of the average.</span>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {scale === 'letter' ? 'Grade point average' : scale === 'ten' ? 'CGPA' : 'Weighted average'}
        </div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{computed.average.toFixed(2)}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{verdict} · {computed.percent.toFixed(1)}% equivalent · {computed.credits} credits counted</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Total credits" value={String(computed.credits)} mono />
        <Stat label="Weighted points" value={computed.weighted.toFixed(2)} mono />
        <Stat label="Courses counted" value={String(computed.valid.length)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Per-course contribution</div>
        <div className="space-y-1">
          {computed.valid.map((row) => {
            const share = computed.weighted ? (row.credits * row.points) / computed.weighted : 0;
            return (
              <div key={row.id} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="truncate">{row.name || 'Untitled course'} <span className="text-muted-foreground">· {row.credits} cr · {row.grade}</span></span>
                  <span className="font-mono-j text-muted-foreground">{(share * 100).toFixed(1)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-card/60">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: `${share * 100}%` }} />
                </div>
              </div>
            );
          })}
          {!computed.valid.length && <span className="text-[11px] text-muted-foreground">Add courses with credits to see the breakdown.</span>}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The bar for each course shows how much it is pulling your average — a four-credit A outweighs a two-credit A every time. If your school
          weights honours or practical courses differently, enter the effective credits so the maths matches your transcript.
        </p>
      </Panel>
    </ToolShell>
  );
}