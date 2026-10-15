import { useMemo, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat } from './shared';

const BANDS = [
  { min: 90, label: 'A — excellent', tone: 'text-emerald-400' },
  { min: 80, label: 'B — very good', tone: 'text-cyan-j' },
  { min: 70, label: 'C — good', tone: 'text-cyan-j' },
  { min: 60, label: 'D — pass', tone: 'text-amber-400' },
  { min: 50, label: 'E — borderline', tone: 'text-amber-400' },
  { min: 0, label: 'F — fail', tone: 'text-red-400' },
];

export default function ExamScore() {
  const [scored, setScored] = useState('47');
  const [total, setTotal] = useState('75');
  const [weight, setWeight] = useState('40');
  const [target, setTarget] = useState('80');
  const [coursework, setCoursework] = useState('68');
  const [courseworkWeight, setCourseworkWeight] = useState('60');

  const result = useMemo(() => {
    const gained = Number(scored) || 0;
    const outOf = Number(total) || 0;
    const percent = outOf ? (gained / outOf) * 100 : 0;
    const band = BANDS.find((b) => percent >= b.min) || BANDS[BANDS.length - 1];
    const w = Math.min(100, Math.max(0, Number(weight) || 0)) / 100;
    const markNeeded = w > 0 ? (Number(target) || 0) * 100 : 0;
    const requiredPercent = (Number(target) || 0) - percent * (1 - w);
    const needed = w > 0 ? (requiredPercent / w) : 0;
    const cw = Number(coursework) || 0;
    const cwWeight = Math.min(100, Math.max(0, Number(courseworkWeight) || 0)) / 100;
    const examWeight = 1 - cwWeight;
    const finalPercent = cw * cwWeight + percent * examWeight;
    const neededOnExam = examWeight > 0 ? ((Number(target) || 0) - cw * cwWeight) / examWeight : 0;
    return { gained, outOf, percent, band, needed, markNeeded, finalPercent, neededOnExam, examWeight };
  }, [scored, total, weight, target, coursework, courseworkWeight]);

  const report = [
    `Score: ${result.gained}/${result.outOf} = ${result.percent.toFixed(1)}% — ${result.band.label}`,
    `To reach ${target}% overall with this worth ${weight}%: you need ${result.needed.toFixed(1)}% on this component.`,
    `Coursework ${coursework}% at ${courseworkWeight}% weight → current overall ${result.finalPercent.toFixed(1)}%`,
    `Final exam worth ${(result.examWeight * 100).toFixed(1)}% needs ${result.neededOnExam.toFixed(1)}% to hit ${target}%.`,
  ].join('\n');

  return (
    <ToolShell
      toolId="exam-score"
      icon={GraduationCap}
      title="Exam Score & Grade Planner"
      desc="Turn a raw mark into a percentage and grade, then work backwards: what you need on the remaining exam, and where the weighted average lands."
      state={{ scored, total, weight, target, coursework, courseworkWeight }}
      onRestore={(restored) => {
        if (restored.scored !== undefined) setScored(String(restored.scored));
        if (restored.total !== undefined) setTotal(String(restored.total));
        if (restored.weight !== undefined) setWeight(String(restored.weight));
        if (restored.target !== undefined) setTarget(String(restored.target));
        if (restored.coursework !== undefined) setCoursework(String(restored.coursework));
        if (restored.courseworkWeight !== undefined) setCourseworkWeight(String(restored.courseworkWeight));
      }}
      exportText={report}
      exportName="exam-score.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={report} label="Copy summary" />
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Marks scored">
          <input value={scored} onChange={(e) => setScored(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Out of">
          <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="This paper is worth % of the grade">
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Target overall %">
          <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">This paper</div>
        <div className="tk-title-glow mt-1 font-mono-j text-4xl font-semibold text-cyan-j">{result.percent.toFixed(1)}%</div>
        <div className={`mt-1 text-[11px] ${result.band.tone}`}>{result.band.label}</div>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Marks scored" value={`${result.gained} / ${result.outOf}`} mono />
        <Stat label="Percentage" value={`${result.percent.toFixed(1)}%`} mono />
        <Stat label="Needed on this component" value={`${result.needed.toFixed(1)}%`} mono sub={`for ${target}% overall`} />
        <Stat label="Cushion" value={`${(result.percent - result.needed).toFixed(1)} pts`} mono sub="above the requirement" />
      </div>

      {result.needed > 100 && (
        <Panel className="border-amber-500/40 text-[11px] text-amber-500">
          Reaching {target}% would need more than 100% on this component — the overall target is out of reach from here, so aim the next target a
          little lower or check whether there is a resit or a redemption route.
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Weighted average planner</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Coursework / other marks so far %">
            <input value={coursework} onChange={(e) => setCoursework(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
          <Field label="That part is worth % of the final grade">
            <input value={courseworkWeight} onChange={(e) => setCourseworkWeight(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label="Current weighted grade" value={`${result.finalPercent.toFixed(1)}%`} mono />
          <Stat label="Final exam worth" value={`${(result.examWeight * 100).toFixed(1)}%`} mono />
          <Stat label={`Needed on final exam for ${target}%`} value={`${result.neededOnExam.toFixed(1)}%`} mono />
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Grade bands</div>
        <div className="space-y-1">
          {BANDS.map((band) => {
            const active = band === result.band;
            return (
              <div key={band.label} className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px] ${active ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/50 bg-card/40'}`}>
                <span className={active ? band.tone : 'text-muted-foreground'}>{band.label}</span>
                <span className="font-mono-j text-muted-foreground">{band.min}% and above</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Bands differ by country and institution — most UK universities use 70% for a first, while many US systems set the A at 90%. Treat this as a
          quick sanity check and confirm against your own handbook.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The useful number here is the one you cannot see on your marksheet: the exam score you must reach for the grade you actually want. Working
          backwards from the target early in the term is how you decide where to spend effort, rather than discovering the maths at the end.
        </p>
      </Panel>
    </ToolShell>
  );
}