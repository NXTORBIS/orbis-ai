import { useMemo, useState } from 'react';
import { Plus, Scale, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { CopyBtn, Panel, Stat } from './shared';

const uid = () => Math.random().toString(36).slice(2, 8);

const START_CRITERIA = [
  { id: uid(), name: 'Cost', weight: 4 },
  { id: uid(), name: 'Time to set up', weight: 3 },
  { id: uid(), name: 'Long-term fit', weight: 5 },
];

const START_OPTIONS = [
  { id: uid(), name: 'Buy the ready-made option' },
  { id: uid(), name: 'Build it ourselves' },
  { id: uid(), name: 'Wait a quarter' },
];

const initialScores = (options, criteria) => {
  const grid = {};
  options.forEach((option) => {
    grid[option.id] = {};
    criteria.forEach((criterion) => { grid[option.id][criterion.id] = 5; });
  });
  return grid;
};

export default function DecisionMatrix() {
  const [criteria, setCriteria] = useState(START_CRITERIA);
  const [options, setOptions] = useState(START_OPTIONS);
  const [scores, setScores] = useState(() => initialScores(START_OPTIONS, START_CRITERIA));

  const setScore = (optionId, criterionId, value) => setScores((current) => ({
    ...current,
    [optionId]: { ...(current[optionId] || {}), [criterionId]: Number(value) },
  }));

  const analysis = useMemo(() => {
    const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 1;
    const maxPoints = totalWeight * 10;
    const ranked = options
      .map((option) => {
        const total = criteria.reduce((sum, criterion) => sum + (scores[option.id]?.[criterion.id] ?? 0) * criterion.weight, 0);
        const weakest = criteria.reduce((worst, criterion) => {
          const value = scores[option.id]?.[criterion.id] ?? 0;
          return value < (scores[option.id]?.[worst.id] ?? 0) ? criterion : worst;
        }, criteria[0] || { id: '', name: '—', weight: 1 });
        return { ...option, total, pct: (total / maxPoints) * 100, weakest };
      })
      .sort((a, b) => b.total - a.total);

    const leader = ranked[0];
    const runnerUp = ranked[1];
    const gap = leader && runnerUp ? leader.total - runnerUp.total : 0;

    const flips = runnerUp
      ? criteria
        .map((criterion) => {
          const lost = (10 - (scores[runnerUp.id]?.[criterion.id] ?? 0)) * criterion.weight;
          return { criterion, gain: lost, flips: lost > gap };
        })
        .filter((entry) => entry.flips)
        .sort((a, b) => a.gain - b.gain)
      : [];

    return { ranked, maxPoints, gap, leader, runnerUp, flips, totalWeight };
  }, [criteria, options, scores]);

  const table = useMemo(() => {
    const header = `| Criterion (weight) | ${options.map((option) => option.name).join(' | ')} |`;
    const divider = `| --- | ${options.map(() => '---').join(' | ')} |`;
    const rows = criteria.map((criterion) => `| ${criterion.name} (${criterion.weight}) | ${options.map((option) => scores[option.id]?.[criterion.id] ?? 0).join(' | ')} |`);
    const totals = `| **Weighted total** | ${analysis.ranked.map((row) => `**${row.total.toFixed(1)}**`).join(' | ')} |`;
    return [header, divider, ...rows, totals].join('\n');
  }, [criteria, options, scores, analysis]);

  const addCriterion = () => setCriteria((current) => [...current, { id: uid(), name: '', weight: 3 }].slice(0, 8));
  const addOption = () => {
    const id = uid();
    setOptions((current) => [...current, { id, name: '' }].slice(0, 8));
    setScores((current) => ({
      ...current,
      [id]: Object.fromEntries(criteria.map((criterion) => [criterion.id, 5])),
    }));
  };

  const removeOption = (id) => {
    setOptions((current) => current.filter((option) => option.id !== id));
    setScores((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const removeCriterion = (id) => {
    setCriteria((current) => current.filter((criterion) => criterion.id !== id));
    setScores((current) => Object.fromEntries(
      Object.entries(current).map(([optionId, row]) => {
        const next = { ...row };
        delete next[id];
        return [optionId, next];
      }),
    ));
  };

  const report = [
    `Decision: ${analysis.leader ? analysis.leader.name || 'unnamed option' : '—'} wins with ${analysis.leader ? analysis.leader.total.toFixed(1) : '0'} of ${analysis.maxPoints} weighted points`,
    analysis.gap ? `Margin over second place: ${analysis.gap.toFixed(1)} points` : 'The top two are level',
    analysis.flips.length ? `Fragile: ${analysis.flips[0].criterion.name} flipping would change the winner` : 'Stable: no single score change flips the winner',
    '',
    table,
  ].join('\n');

  return (
    <ToolShell
      toolId="decision-matrix"
      icon={Scale}
      title="Decision Matrix"
      desc="Weigh the criteria that matter, score every option, and see which one wins — plus how fragile that win really is."
      state={{ criteria, options, scores }}
      onRestore={(restored) => {
        if (Array.isArray(restored.criteria) && restored.criteria.length) setCriteria(restored.criteria);
        if (Array.isArray(restored.options) && restored.options.length) setOptions(restored.options);
        if (restored.scores && typeof restored.scores === 'object') setScores(restored.scores);
      }}
      exportText={report}
      exportName="decision-matrix.md"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addCriterion} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add criterion
        </button>
        <button type="button" onClick={addOption} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Plus className="h-3.5 w-3.5" /> Add option
        </button>
        <CopyBtn value={table} label="Copy as table" />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">What matters — and how much</div>
        <div className="space-y-2">
          {criteria.map((criterion) => (
            <div key={criterion.id} className="grid grid-cols-[1.6fr_1fr_auto] items-center gap-2">
              <input
                value={criterion.name}
                onChange={(e) => setCriteria((current) => current.map((row) => (row.id === criterion.id ? { ...row, name: e.target.value } : row)))}
                placeholder="Criterion"
                className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm"
              />
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={criterion.weight}
                  onChange={(e) => setCriteria((current) => current.map((row) => (row.id === criterion.id ? { ...row, weight: Number(e.target.value) } : row)))}
                  className="w-full accent-[hsl(var(--cyan))]"
                />
                <span className="font-mono-j text-[11px] text-cyan-j">{criterion.weight}×</span>
              </div>
              <button type="button" onClick={() => removeCriterion(criterion.id)} disabled={criteria.length <= 1} className="text-muted-foreground transition hover:text-rose-400 disabled:opacity-30">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const row = analysis.ranked.find((entry) => entry.id === option.id);
          const isLeader = analysis.leader?.id === option.id;
          return (
            <div key={option.id} className={`tk-card tk-depth tk-topline relative overflow-hidden rounded-xl border p-3 ${isLeader ? 'border-cyan-j/50 bg-cyan-j/5' : 'border-border/70 bg-gradient-to-b from-card/75 to-card/40'}`}>
              <span aria-hidden className="tk-shine pointer-events-none absolute inset-0" />
              <div className="relative flex items-center gap-2">
                <input
                  value={option.name}
                  onChange={(e) => setOptions((current) => current.map((row2) => (row2.id === option.id ? { ...row2, name: e.target.value } : row2)))}
                  placeholder="Option"
                  className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm"
                />
                <button type="button" onClick={() => removeOption(option.id)} disabled={options.length <= 2} className="text-muted-foreground transition hover:text-rose-400 disabled:opacity-30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="relative mt-3 space-y-2">
                {criteria.map((criterion) => (
                  <div key={criterion.id}>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate">{criterion.name || 'criterion'}</span>
                      <span className="font-mono-j text-cyan-j">{scores[option.id]?.[criterion.id] ?? 0}/10</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={10}
                      step={1}
                      value={scores[option.id]?.[criterion.id] ?? 0}
                      onChange={(e) => setScore(option.id, criterion.id, e.target.value)}
                      className="w-full accent-[hsl(var(--cyan))]"
                    />
                  </div>
                ))}
              </div>

              <div className="relative mt-3 border-t border-border/50 pt-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Weighted score</span>
                  <span className="font-mono-j text-lg font-semibold text-cyan-j">{row ? row.total.toFixed(1) : '0'}</span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-j to-cyan-j/40" style={{ width: `${Math.min(100, row?.pct || 0)}%` }} />
                </div>
                {isLeader && <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-j">Recommended</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <Hero
          label="Winner"
          value={analysis.leader?.name || '—'}
          sub={analysis.ranked.length > 1
            ? `${analysis.leader ? analysis.leader.total.toFixed(1) : 0} of ${analysis.maxPoints} points — ahead by ${analysis.gap.toFixed(1)}`
            : 'Add a second option to compare'}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Ranking</div>
          <Bars
            data={analysis.ranked.map((row) => ({ label: (row.name || 'option').slice(0, 10), value: row.total }))}
            format={(value) => value.toFixed(1)}
            highlightLast={false}
          />
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Options" value={String(options.length)} mono />
        <Stat label="Criteria" value={String(criteria.length)} mono />
        <Stat label="Win margin" value={analysis.gap.toFixed(1)} mono />
        <Stat label="Stability" value={analysis.flips.length ? 'Fragile' : 'Stable'} sub={analysis.flips.length ? 'one score flip changes the winner' : 'no single flip changes it'} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">How robust is this answer?</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {analysis.flips.length ? (
            <>
              <p>· The result is close. If “{analysis.runnerUp?.name || 'second place'}” scored 10 on <span className="text-cyan-j">{analysis.flips[0].criterion.name}</span>, it would overtake the leader — so that single criterion deserves a second look.</p>
              <p>· Ask whether you can improve your leader on <span className="text-cyan-j">{analysis.leader?.weakest?.name}</span>, its weakest criterion. A matrix is for finding the fix, not just the winner.</p>
            </>
          ) : (
            <>
              <p>· The margin is wide enough that no single score change flips the winner — you can decide with confidence.</p>
              <p>· Even so, check the leader's weakest criterion (<span className="text-cyan-j">{analysis.leader?.weakest?.name}</span>): that is where reality will bite first.</p>
            </>
          )}
          <p>· Weights are the real decision. If two criteria feel equally important, the difference between 4× and 5× rarely changes the outcome; a jump from 2× to 5× almost always does.</p>
        </div>
        <div className="mt-2">
          <Pills items={criteria.map((criterion) => ({ label: criterion.name || 'criterion', value: `${criterion.weight}×` }))} />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A decision matrix is most useful when you write the criteria <em>before</em> you look at the options — otherwise you unconsciously weight whatever
          the option you already like happens to be good at. Scores are judgements, so use the same 0–10 meaning for every cell: 10 means “as good as this
          criterion can realistically get”, 5 means “acceptable”, 0 means “disqualifying”.
        </p>
      </Panel>
    </ToolShell>
  );
}