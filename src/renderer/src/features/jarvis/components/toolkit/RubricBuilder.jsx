import { useMemo, useState } from 'react';
import { GraduationCap, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Stat } from './shared';

const LEVELS = ['Exemplary', 'Proficient', 'Developing', 'Beginning'];

const DEFAULT_CRITERIA = [
  { id: 'a', name: 'Research and evidence', weight: '30' },
  { id: 'b', name: 'Analysis and reasoning', weight: '30' },
  { id: 'c', name: 'Structure and clarity', weight: '20' },
  { id: 'd', name: 'Sources and referencing', weight: '20' },
];

const DEFAULT_STUDENTS = [
  { id: 's1', name: 'Student A', scores: { a: 3, b: 3, c: 2, d: 3 } },
  { id: 's2', name: 'Student B', scores: { a: 4, b: 3, c: 3, d: 4 } },
  { id: 's3', name: 'Student C', scores: { a: 2, b: 2, c: 3, d: 2 } },
];

const blankCriterion = () => ({ id: Math.random().toString(36).slice(2), name: 'New criterion', weight: '10' });

export default function RubricBuilder() {
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [students, setStudents] = useState(DEFAULT_STUDENTS);
  const [mode, setMode] = useState('rubric');
  const [scale, setScale] = useState('4');
  const [totalPoints, setTotalPoints] = useState('100');
  const [passMark, setPassMark] = useState('50');
  const [levelLabels, setLevelLabels] = useState(LEVELS);

  const setCriterion = (id, key, value) => setCriteria((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  const setStudent = (id, key, value) => setStudents((current) => current.map((row) => (row.id === id ? { ...row, [key]: value } : row)));

  const result = useMemo(() => {
    const maxLevel = Math.max(2, Number(scale) || 4);
    const points = Math.max(10, Number(totalPoints) || 100);
    const pass = Math.max(0, Number(passMark) || 50);

    const parsed = criteria.map((row) => ({ ...row, weight: Math.max(0, Number(row.weight) || 0) }));
    const weightSum = parsed.reduce((sum, row) => sum + row.weight, 0);
    const normalised = parsed.map((row) => ({
      ...row,
      share: weightSum ? (row.weight / weightSum) * 100 : 0,
      points: weightSum ? (row.weight / weightSum) * points : 0,
      perLevel: weightSum ? ((row.weight / weightSum) * points) / maxLevel : 0,
    }));

    const graded = students.map((student) => {
      const breakdown = normalised.map((row) => {
        const level = Math.max(0, Math.min(maxLevel, Number(student.scores[row.id]) || 0));
        return { criterion: row.name, id: row.id, level, earned: (row.perLevel * level) };
      });
      const earned = breakdown.reduce((sum, row) => sum + row.earned, 0);
      const percentage = points ? (earned / points) * 100 : 0;
      const grade = percentage >= 90 ? 'A' : percentage >= 80 ? 'B' : percentage >= 70 ? 'C' : percentage >= 60 ? 'D' : percentage >= pass ? 'E' : 'F';
      return { ...student, breakdown, earned, percentage, grade, passed: percentage >= pass };
    });

    const classAverage = graded.length ? graded.reduce((sum, row) => sum + row.percentage, 0) / graded.length : 0;
    const highest = graded.reduce((best, row) => (row.percentage > (best.percentage || -1) ? row : best), {});
    const lowest = graded.reduce((worst, row) => (row.percentage < (worst.percentage === undefined ? 101 : worst.percentage) ? row : worst), {});
    const passCount = graded.filter((row) => row.passed).length;

    const criterionAverages = normalised.map((row) => {
      const values = students.map((student) => Number(student.scores[row.id]) || 0);
      const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      return { label: row.name.split(' ')[0].slice(0, 12), value: Number(average.toFixed(2)), average, points: row.points };
    });

    const distribution = LEVELS.slice(0, maxLevel).map((label, index) => ({
      label: label,
      value: students.reduce((sum, student) => sum + (normalised.filter((row) => (Number(student.scores[row.id]) || 0) === index + 1).length), 0),
    }));

    const rubricText = [
      'Rubric: ' + points + ' points total, ' + maxLevel + ' levels per criterion',
      'Pass mark ' + pass + '%',
      '',
      'Criteria (weight normalised to 100%):',
      ...normalised.map((row) => '  ' + row.name.padEnd(28, ' ') + row.share.toFixed(1) + '%  → ' + row.points.toFixed(1) + ' points'),
      '',
      'Levels:',
      ...LEVELS.slice(0, maxLevel).map((label, index) => '  ' + (index + 1) + '. ' + label + ' — worth ' + (maxLevel - index - 1) + ' of ' + (maxLevel - 1) + ' marks available at the top'),
      '',
      'Results:',
      ...graded.map((row) => '  ' + row.name + ': ' + row.earned.toFixed(1) + ' / ' + points + ' (' + row.percentage.toFixed(1) + '%, grade ' + row.grade + ')'),
      '',
      'Class average ' + classAverage.toFixed(1) + '% · pass rate ' + (graded.length ? ((passCount / graded.length) * 100).toFixed(0) : 0) + '%',
    ].join('\n');

    return {
      normalised, graded, weightSum, classAverage, passCount, criterionAverages, distribution, rubricText, maxLevel, points, pass,
      highest, lowest,
      weightWarning: Math.abs(weightSum - 100) > 0.1,
      chart: criterionAverages,
    };
  }, [criteria, students, scale, totalPoints, passMark, levelLabels, mode]);

  const report = result.rubricText;

  return (
    <ToolShell
      toolId="rubric-builder"
      icon={GraduationCap}
      title="Rubric Builder & Grader"
      desc="Weighted criteria, clear level descriptors and a grading grid in one place — score students against the rubric and see criterion averages, pass rate and grade distribution."
      state={{ criteria, students, mode, scale, totalPoints, passMark, levelLabels }}
      onRestore={(restored) => {
        if (Array.isArray(restored.criteria) && restored.criteria.length) setCriteria(restored.criteria);
        if (Array.isArray(restored.students) && restored.students.length) setStudents(restored.students);
        if (restored.mode) setMode(restored.mode);
        if (restored.scale !== undefined) setScale(String(restored.scale));
        if (restored.totalPoints !== undefined) setTotalPoints(String(restored.totalPoints));
        if (restored.passMark !== undefined) setPassMark(String(restored.passMark));
        if (Array.isArray(restored.levelLabels) && restored.levelLabels.length) setLevelLabels(restored.levelLabels);
      }}
      exportText={report}
      exportName="rubric.txt"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Levels on the scale">
          <select value={scale} onChange={(e) => setScale(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="3">3 levels</option>
            <option value="4">4 levels</option>
          </select>
        </Field>
        <Field label="Total points"><input value={totalPoints} onChange={(e) => setTotalPoints(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Pass mark, %"><input value={passMark} onChange={(e) => setPassMark(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Weight total">
          <div className={'flex h-9 items-center font-mono-j text-sm ' + (result.weightWarning ? 'text-amber-300' : 'text-emerald-300')}>
            {result.weightSum.toFixed(0)}% {result.weightWarning ? '· normalised' : '· balanced'}
          </div>
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Level names</div>
        <div className={'grid gap-2 ' + (result.maxLevel === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
          {levelLabels.slice(0, result.maxLevel).map((label, index) => (
            <Field key={label + index} label={'Level ' + (index + 1)}>
              <input
                value={label}
                onChange={(e) => setLevelLabels((current) => current.map((entry, position) => (position === index ? e.target.value : entry)))}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Level 1 is the highest standard. The top level should be achievable but rare; if every submission reaches it, the descriptors are describing competence rather than excellence.
        </p>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Criteria and weights</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.normalised.length} criteria</span>
        </div>
        <div className="space-y-2">
          {criteria.map((row) => {
            const computed = result.normalised.find((entry) => entry.id === row.id) || {};
            return (
              <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
                <Field label="Criterion"><input value={row.name} onChange={(e) => setCriterion(row.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm" /></Field>
                <Field label="Weight, %"><input value={row.weight} onChange={(e) => setCriterion(row.id, 'weight', e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
                <Field label="Worth in points">
                  <div className="flex h-9 items-center font-mono-j text-[11px] text-cyan-j">{(computed.points || 0).toFixed(1)} pts · {(computed.perLevel || 0).toFixed(1)} per level</div>
                </Field>
                <div className="flex items-end">
                  <button type="button" onClick={() => setCriteria((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => setCriteria((current) => [...current, blankCriterion()])} className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add a criterion
        </button>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Class average"
          value={result.classAverage.toFixed(1)}
          unit="%"
          sub={result.graded.length + ' submissions scored against ' + result.normalised.length + ' criteria worth ' + result.points + ' points. ' + result.passCount + ' of ' + result.graded.length + ' passed at the ' + result.pass + '% mark, so the pass rate is ' + (result.graded.length ? ((result.passCount / result.graded.length) * 100).toFixed(0) : 0) + '%.'}
        />
        <Ring
          value={result.passCount}
          max={Math.max(1, result.graded.length)}
          tone={result.passCount === result.graded.length ? 'emerald' : result.passCount === 0 ? 'rose' : 'amber'}
          label="Passing submissions"
          sub={result.passCount + ' of ' + result.graded.length + ' at or above ' + result.pass + '%'}
        />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Grading grid</span>
          <CopyBtn value={report} label="Copy the results" />
        </div>
        <div className="space-y-2">
          {students.map((student) => {
            const computed = result.graded.find((entry) => entry.id === student.id) || {};
            return (
              <div key={student.id} className="rounded-lg border border-border/60 bg-card/40 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={student.name} onChange={(e) => setStudent(student.id, 'name', e.target.value)} className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-sm" />
                  <span className="font-mono-j text-[11px] text-cyan-j">{(computed.earned || 0).toFixed(1)} pts · {(computed.percentage || 0).toFixed(1)}% · grade {computed.grade || '—'}</span>
                  <button type="button" onClick={() => setStudents((current) => current.filter((entry) => entry.id !== student.id))} className="ml-auto inline-flex items-center rounded-lg border border-border/60 px-2 py-1 text-muted-foreground transition hover:text-rose-300">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {result.normalised.map((row) => (
                    <div key={row.id} className="rounded-lg border border-border/50 bg-card/30 px-2 py-1.5">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>{row.name}</span>
                        <span className="font-mono-j">{(row.perLevel * (Number(student.scores[row.id]) || 0)).toFixed(1)} pts</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {levelLabels.slice(0, result.maxLevel).map((label, index) => (
                          <button
                            key={label + index}
                            type="button"
                            onClick={() => setStudents((current) => current.map((entry) => (entry.id === student.id ? { ...entry, scores: { ...entry.scores, [row.id]: index + 1 } } : entry)))}
                            className={(Number(student.scores[row.id]) || 0) === index + 1
                              ? 'rounded border border-cyan-j/50 bg-cyan-j/10 px-1.5 py-0.5 text-[10px] text-cyan-j'
                              : 'rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground'}
                          >
                            {index + 1}. {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setStudents((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'Student ' + String.fromCharCode(65 + current.length), scores: {} }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a submission
        </button>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Average level per criterion</div>
          <Bars data={result.chart} format={(value) => value.toFixed(2)} suffix="" highlightLast={false} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            A criterion averaging below the midpoint across the class usually means either the teaching or the descriptors need attention, not that the class is weak. If one
            criterion alone drags the average down, look there first.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Level distribution</div>
          <Bars
            data={result.distribution.map((entry) => ({ label: entry.label, value: entry.value }))}
            format={(value) => String(value)}
            suffix=""
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Levels used across the whole class. If every mark sits at the top level the rubric cannot discriminate; if everything sits at the bottom, the top descriptors are
            unreachable in practice.
          </p>
        </Panel>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Writing a rubric that marks consistently</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Describe what each level looks like in observable terms. Quality of argument is vague; uses three independent sources and addresses counter-arguments is not.</p>
            <p>· Weight by what matters, not by how long the task takes to mark. A short piece of reasoning can be worth more than a long list of facts.</p>
            <p>· Keep four levels at most. More levels than a marker can hold in mind produce inconsistent marks rather than finer ones.</p>
            <p>· Avoid criteria that overlap. If analysis and reasoning are marked separately, describe what belongs to each.</p>
            <p>· Weight to a round total: {result.points} points across {result.normalised.length} criteria is easy to explain, and the weights here normalise to 100%.</p>
            <p>· Publish it with the task. Students who know what the top level looks like aim for it, and marking disputes drop sharply.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Marking and moderation</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Mark one criterion across every submission rather than one submission across every criterion. Consistency improves measurably.</p>
            <p>· Mark anonymously where you can. Knowing the name changes the mark in both directions.</p>
            <p>· Keep a note of borderline cases and revisit them together at the end rather than deciding each in isolation.</p>
            <p>· Give feedback against the descriptor, not a general comment. The rubric already says what was expected.</p>
            <p>· Second-mark a sample. A colleague marking four submissions independently shows whether the descriptors are clear enough to be shared.</p>
            <p>· {result.classAverage < 60 ? 'The class average here is ' + result.classAverage.toFixed(1) + '%. Before assuming the cohort is weak, check whether the criteria were clear and whether one criterion is doing all the damage.' : result.classAverage > 85 ? 'The class average here is ' + result.classAverage.toFixed(1) + '%. That is achievable but worth a second look: a rubric everyone aces may not be distinguishing between submissions.' : 'The class average of ' + result.classAverage.toFixed(1) + '% looks like a rubric doing its job across the range.'}</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Points', value: String(result.points) },
                { label: 'Average', value: result.classAverage.toFixed(1) + '%' },
                { label: 'Pass rate', value: (result.graded.length ? ((result.passCount / result.graded.length) * 100).toFixed(0) : 0) + '%' },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Criteria" value={String(result.normalised.length)} mono sub={result.weightSum.toFixed(0) + '% total weight'} />
        <Stat label="Points" value={String(result.points)} mono sub={result.maxLevel + ' levels'} />
        <Stat label="Highest" value={(result.highest.percentage || 0).toFixed(1) + '%'} mono sub={result.highest.name || ''} />
        <Stat label="Lowest" value={(result.lowest.percentage || 0).toFixed(1) + '%'} mono sub={result.lowest.name || ''} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How the marks are calculated</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>criterion points = weight ÷ total weight × {result.points} points</p>
          <p>points per level = criterion points ÷ {result.maxLevel} levels</p>
          <p>submission earned = the sum of level points across every criterion</p>
          <p>percentage = earned ÷ {result.points} × 100 · pass at {result.pass}%</p>
          <p className="text-cyan-j">Check: {result.normalised[0] ? result.normalised[0].name + ' at ' + result.normalised[0].share.toFixed(1) + '% is worth ' + result.normalised[0].points.toFixed(1) + ' points, so each level is ' + result.normalised[0].perLevel.toFixed(1) + ' points.' : ''}</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The grading here treats each level as equally spaced, which is the simple and defensible assumption. If your descriptors are deliberately non-linear, weight the levels
          by editing the criterion weights rather than trying to encode it in the scale.
        </p>
      </Panel>
    </ToolShell>
  );
}