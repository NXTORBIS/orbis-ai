import { useMemo, useState } from 'react';
import { ChartColumn } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from './shared';

const SAMPLE = '78, 92, 45, 61, 84, 55, 39, 71, 88, 66, 49, 95, 58, 73, 82, 41, 67, 90, 53, 76';

const METHODS = [
  { value: 'raw', label: 'No curve' },
  { value: 'add', label: 'Add points' },
  { value: 'linear', label: 'Scale to top' },
  { value: 'sqrt', label: 'Square root' },
  { value: 'zscore', label: 'T-score' },
];

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const standardDeviation = (values, mean) => {
  if (values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
};

export default function GradeCurve() {
  const [scores, setScores] = useState(SAMPLE);
  const [method, setMethod] = useState('sqrt');
  const [addPoints, setAddPoints] = useState('10');
  const [targetTop, setTargetTop] = useState('100');
  const [passMark, setPassMark] = useState('60');
  const [cutoffs, setCutoffs] = useState({ a: '90', b: '80', c: '70', d: '60' });

  const result = useMemo(() => {
    const values = String(scores)
      .split(/[\s,;]+/)
      .map((entry) => Number(entry.replace(/[^\d.]/g, '')))
      .filter((value) => Number.isFinite(value));

    const count = values.length;
    const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : 0;
    const deviation = standardDeviation(values, mean);
    const highest = count ? Math.max(...values) : 0;

    const curved = values.map((value) => {
      if (method === 'add') return Math.min(100, value + (Number(addPoints) || 0));
      if (method === 'linear') return highest ? Math.min(100, (value / highest) * (Number(targetTop) || 100)) : value;
      if (method === 'sqrt') return 10 * Math.sqrt(Math.max(0, value));
      if (method === 'zscore') return Math.min(100, Math.max(0, 50 + 10 * (deviation ? (value - mean) / deviation : 0)));
      return value;
    });

    const rounded = curved.map((value) => Math.round(value * 10) / 10);
    const newMean = count ? rounded.reduce((sum, value) => sum + value, 0) / count : 0;
    const newDeviation = standardDeviation(rounded, newMean);
    const newHighest = count ? Math.max(...rounded) : 0;
    const newLowest = count ? Math.min(...rounded) : 0;

    const grade = (value) => {
      const a = Number(cutoffs.a) || 90;
      const b = Number(cutoffs.b) || 80;
      const c = Number(cutoffs.c) || 70;
      const d = Number(cutoffs.d) || 60;
      if (value >= a) return 'A';
      if (value >= b) return 'B';
      if (value >= c) return 'C';
      if (value >= d) return 'D';
      return 'F';
    };

    const rows = values.map((value, index) => ({
      index, original: value, curved: rounded[index], before: grade(value), after: grade(rounded[index]),
    }));

    const distribution = ['A', 'B', 'C', 'D', 'F'].map((letter) => ({
      label: letter,
      value: rounded.filter((value) => grade(value) === letter).length,
      before: values.filter((value) => grade(value) === letter).length,
    }));

    const histogram = Array.from({ length: 10 }, (unused, bucket) => ({
      label: bucket * 10 + 's',
      value: rounded.filter((value) => value >= bucket * 10 && (bucket === 9 ? value <= 100 : value < bucket * 10 + 10)).length,
    }));

    const pass = Number(passMark) || 60;

    return {
      values, rows, count, mean, deviation, highest, newMean, newDeviation, newHighest, newLowest,
      distribution, histogram, medianOriginal: median(values), medianCurved: median(rounded),
      passBefore: count ? (values.filter((value) => value >= pass).length / count) * 100 : 0,
      passAfter: count ? (rounded.filter((value) => value >= pass).length / count) * 100 : 0,
      meanShift: newMean - mean,
      improved: rows.filter((row) => row.after > row.before).length,
      dropped: rows.filter((row) => row.after < row.before).length,
      pass,
    };
  }, [scores, method, addPoints, targetTop, passMark, cutoffs]);

  const report = useMemo(() => [
    result.count + ' scores · method: ' + (METHODS.find((entry) => entry.value === method) || {}).label,
    '',
    'Before — mean ' + result.mean.toFixed(2) + ', median ' + result.medianOriginal.toFixed(1) + ', standard deviation ' + result.deviation.toFixed(2) + ', top ' + result.highest.toFixed(1) + ', pass rate ' + result.passBefore.toFixed(1) + '%',
    'After — mean ' + result.newMean.toFixed(2) + ', median ' + result.medianCurved.toFixed(1) + ', standard deviation ' + result.newDeviation.toFixed(2) + ', top ' + result.newHighest.toFixed(1) + ', lowest ' + result.newLowest.toFixed(1) + ', pass rate ' + result.passAfter.toFixed(1) + '%',
    'Mean shift: ' + (result.meanShift >= 0 ? '+' : '') + result.meanShift.toFixed(2) + ' points',
    '',
    'Grade distribution after: ' + result.distribution.map((entry) => entry.label + ' ' + entry.value).join(', '),
    '',
    'Student by student:',
    ...result.rows.map((row) => row.original + ' → ' + row.curved + ' (' + row.before + ' → ' + row.after + ')'),
  ].join('\n'), [result, method]);

  return (
    <ToolShell
      toolId="grade-curve"
      icon={ChartColumn}
      title="Grade Curve Calculator"
      desc="Paste a set of scores and curve them four different ways, with the distribution, pass rate and grade count before and after — so the choice is made on evidence."
      state={{ scores, method, addPoints, targetTop, passMark, cutoffs }}
      onRestore={(restored) => {
        if (typeof restored.scores === 'string') setScores(restored.scores);
        if (restored.method) setMethod(restored.method);
        if (restored.addPoints !== undefined) setAddPoints(String(restored.addPoints));
        if (restored.targetTop !== undefined) setTargetTop(String(restored.targetTop));
        if (restored.passMark !== undefined) setPassMark(String(restored.passMark));
        if (restored.cutoffs) setCutoffs((current) => ({ ...current, ...restored.cutoffs }));
      }}
      exportText={report}
      exportName="grade-curve.txt"
    >
      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Raw scores — comma, space or line separated</span>
            <span className="font-mono-j text-[10px] text-muted-foreground">{result.count} scores</span>
          </div>
          <Area value={scores} onChange={setScores} rows={7} mono placeholder="78, 92, 45, 61" />
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Curve method</div>
          <Seg value={method} onChange={setMethod} options={METHODS.slice(0, 3)} />
          <div className="mt-2">
            <Seg value={method} onChange={setMethod} options={METHODS.slice(3)} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {method === 'add' && (
              <Field label="Points to add"><input value={addPoints} onChange={(e) => setAddPoints(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            )}
            {method === 'linear' && (
              <Field label="Scale the top score to"><input value={targetTop} onChange={(e) => setTargetTop(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            )}
            <Field label="Pass mark"><input value={passMark} onChange={(e) => setPassMark(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {method === 'raw' && 'No curve applied. This is the baseline every other method is measured against.'}
            {method === 'add' && 'Simple and visible, but it lifts everyone equally, including those who were already at the top.'}
            {method === 'linear' && 'Scales so the strongest score reaches the target. The gap between students grows rather than shrinks.'}
            {method === 'sqrt' && 'The classic curve: 10 × √score. It lifts the lower scores far more than the higher ones.'}
            {method === 'zscore' && 'Re-centres the class on 50 with a standard deviation of 10, so the shape is preserved and only the position moves.'}
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="A from"><input value={cutoffs.a} onChange={(e) => setCutoffs((current) => ({ ...current, a: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="B from"><input value={cutoffs.b} onChange={(e) => setCutoffs((current) => ({ ...current, b: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="C from"><input value={cutoffs.c} onChange={(e) => setCutoffs((current) => ({ ...current, c: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="D from"><input value={cutoffs.d} onChange={(e) => setCutoffs((current) => ({ ...current, d: e.target.value }))} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Mean score"
          value={result.newMean.toFixed(1)}
          sub={result.count
            ? 'From ' + result.mean.toFixed(1) + ' before, a shift of ' + (result.meanShift >= 0 ? '+' : '') + result.meanShift.toFixed(1) + ' points. Pass rate ' + result.passBefore.toFixed(0) + '% becomes ' + result.passAfter.toFixed(0) + '%, and the standard deviation moves from ' + result.deviation.toFixed(1) + ' to ' + result.newDeviation.toFixed(1) + '.'
            : 'Paste some scores to see the curve.'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Grade distribution</div>
          <div className="space-y-1.5">
            {result.distribution.map((entry) => (
              <div key={entry.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-4 font-mono-j">{entry.label}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: (result.count ? (entry.value / result.count) * 100 : 0) + '%' }} />
                </div>
                <span className="w-24 text-right font-mono-j text-muted-foreground">{entry.before} → <span className="text-cyan-j">{entry.value}</span></span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {result.improved} students move up a grade band and {result.dropped} move down. A curve that moves anyone down is usually the wrong curve.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Distribution of curved scores</div>
          <Bars data={result.histogram} format={(value) => String(value)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A healthy spread uses most of the width without a single spike. If almost everyone lands in two buckets, the assessment is not discriminating between students —
            which is a question about the paper, not about the grading.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Before and after</div>
          <div className="space-y-1.5 font-mono-j text-[11px]">
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Mean</span><span>{result.mean.toFixed(2)} → <span className="text-cyan-j">{result.newMean.toFixed(2)}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Median</span><span>{result.medianOriginal.toFixed(1)} → <span className="text-cyan-j">{result.medianCurved.toFixed(1)}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Standard deviation</span><span>{result.deviation.toFixed(2)} → <span className="text-cyan-j">{result.newDeviation.toFixed(2)}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Highest</span><span>{result.highest.toFixed(1)} → <span className="text-cyan-j">{result.newHighest.toFixed(1)}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Lowest</span><span>{result.values.length ? result.values[0] === undefined ? '—' : Math.min(...result.values).toFixed(1) : '—'} → <span className="text-cyan-j">{result.newLowest.toFixed(1)}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Pass rate at {result.pass}</span><span>{result.passBefore.toFixed(1)}% → <span className="text-cyan-j">{result.passAfter.toFixed(1)}%</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Scores above 90</span><span>{result.values.filter((value) => value >= 90).length} → <span className="text-cyan-j">{result.rows.filter((row) => row.curved >= 90).length}</span></span></div>
            <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5"><span className="text-muted-foreground">Scores below 50</span><span>{result.values.filter((value) => value < 50).length} → <span className="text-cyan-j">{result.rows.filter((row) => row.curved < 50).length}</span></span></div>
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Every score, before and after</span>
          <CopyBtn value={report} label="Copy the sheet" />
        </div>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="py-1 text-left font-medium">#</th>
                <th className="py-1 text-right font-medium">Raw</th>
                <th className="py-1 text-right font-medium">Curved</th>
                <th className="py-1 text-right font-medium">Change</th>
                <th className="py-1 text-right font-medium">Grade</th>
              </tr>
            </thead>
            <tbody className="font-mono-j">
              {result.rows.map((row) => (
                <tr key={row.index} className="border-t border-border/50">
                  <td className="py-1 text-muted-foreground">{row.index + 1}</td>
                  <td className="py-1 text-right">{row.original}</td>
                  <td className="py-1 text-right text-cyan-j">{row.curved}</td>
                  <td className={'py-1 text-right ' + (row.curved - row.original > 0 ? 'text-emerald-300' : row.curved - row.original < 0 ? 'text-rose-300' : 'text-muted-foreground')}>
                    {row.curved - row.original > 0 ? '+' : ''}{(row.curved - row.original).toFixed(1)}
                  </td>
                  <td className="py-1 text-right">{row.before} → <span className="text-cyan-j">{row.after}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.count > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            The smallest raw score here is {Math.min(...result.values)} and the largest is {result.highest}. Across the class the mean moved {result.meanShift >= 0 ? 'up' : 'down'} by {Math.abs(result.meanShift).toFixed(1)} points.
          </p>
        )}
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Mean" value={result.newMean.toFixed(1)} mono sub={'from ' + result.mean.toFixed(1)} />
        <Stat label="Pass rate" value={result.passAfter.toFixed(0) + '%'} mono sub={'from ' + result.passBefore.toFixed(0) + '%'} />
        <Stat label="Spread" value={result.newDeviation.toFixed(1)} mono sub={'sd from ' + result.deviation.toFixed(1)} />
        <Stat label="Moved down" value={String(result.dropped)} mono sub={result.improved + ' moved up'} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Choosing a method rather than reaching for one</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· If the paper was simply too long, curving hides the problem. Shorten it for the next cohort instead of compensating forever.</p>
            <p>· Adding a flat number of points is transparent and defensible, but it changes nothing about the ranking and hands the top students a bonus they did not need.</p>
            <p>· The square root curve compresses the bottom half upwards, which helps when the paper was unexpectedly hard rather than when the class is weak.</p>
            <p>· The T-score curve assumes the class is a normal sample of the population. In a small cohort that assumption does not hold, and it forces a fixed proportion into every grade band.</p>
            <p>· Scaling to the top score is the most common and the most distorting: it makes the strongest student the definition of full marks and stretches everyone else apart.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Doing it in a way students accept</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Say what was done and why, before the results are published. A curve explained is a policy; a curve discovered is a grievance.</p>
            <p>· Apply the same method to every section taught by the same paper, or the comparison between classes becomes meaningless.</p>
            <p>· Never move anyone down. If a curve lowers a score that was already marked, the assessment itself needs re-checking first.</p>
            <p>· Keep the raw marks on record alongside the curved ones. Curved results are for reporting, raw marks are for feedback.</p>
            <p>· Check whether the distribution tells you the paper was too hard, too easy or too narrow. Each has a different fix, and only one of them is a curve.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Scores', value: String(result.count) },
                { label: 'Method', value: method },
                { label: 'Mean shift', value: (result.meanShift >= 0 ? '+' : '') + result.meanShift.toFixed(1) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The methods, as formulas</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>add points: curved = min(100, raw + p)</p>
          <p>scale to top: curved = raw ÷ highest × target</p>
          <p>square root: curved = 10 × √raw</p>
          <p>T-score: curved = 50 + 10 × (raw − mean) ÷ sd</p>
          <p className="text-cyan-j">With this class: mean {result.mean.toFixed(1)}, sd {result.deviation.toFixed(1)}, top {result.highest.toFixed(1)} — the same inputs every method above uses.</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Every method is applied to the scores exactly as entered, with the pass mark and grade bands you set, so the before-and-after columns always describe the same
          cohort. Nothing is stored beyond this page.
        </p>
      </Panel>
    </ToolShell>
  );
}