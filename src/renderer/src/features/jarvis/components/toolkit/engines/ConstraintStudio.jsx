import { useRef, useState } from 'react';
import { Play, Shuffle, Target, X } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Area, CopyBtn, Field, Panel, Seg, Stat } from '../shared';
import { Bars, Hero, Pills } from '../kit/premium';
import ToolShell from '../kit/ToolShell';
import { makeRng } from './run';
import { EngineProgress, VerifyPanel } from './EngineUi';
import { solveAssignment, solveKnapsack, solveSchedule, verifyAssignment, verifyKnapsack, verifySchedule } from './cpCore';

const MODEL_OPTIONS = [
  { value: 'assignment', label: 'Assignment' },
  { value: 'knapsack', label: 'Packing' },
  { value: 'schedule', label: 'Scheduling' },
];

const fmtCosts = (matrix) => matrix.map((row) => row.join(', ')).join('\n');
const fmtItems = (items) => items.map((item) => `${item.name}, ${item.weight}, ${item.value}`).join('\n');
const fmtJobs = (jobs) => jobs.map((job) => [job.name, job.duration, job.machine, job.release, job.deadline ?? '', (job.predecessors ?? []).join('|')].join(', ')).join('\n');

const parseMatrix = (text) => text.split(/\n/).map((line) => line.trim()).filter(Boolean)
  .map((line) => line.split(/[,\s]+/).filter(Boolean).map(Number))
  .filter((row) => row.length && row.every(Number.isFinite));

const parsePairs = (text) => text.split(/\n/).map((line) => line.split(/[,\s]+/).filter(Boolean).map(Number))
  .filter((pair) => pair.length === 2 && pair.every(Number.isFinite)).map(([r, c]) => [r, c]);

const parseItems = (text) => text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
  const parts = line.split(',').map((part) => part.trim());
  const numbers = parts.map(Number);
  if (parts.length >= 3) return { name: parts[0] || `item ${index + 1}`, weight: numbers[1], value: numbers[2] };
  if (parts.length === 2) return { name: `item ${index + 1}`, weight: numbers[0], value: numbers[1] };
  return null;
}).filter((item) => item && Number.isFinite(item.weight) && Number.isFinite(item.value));

const parseJobs = (text) => text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
  const parts = line.split(',').map((part) => part.trim());
  const duration = Number(parts[1]);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const deadline = Number(parts[4]);
  return {
    name: parts[0] || `job ${index + 1}`,
    duration,
    machine: Number.isFinite(Number(parts[2])) ? Number(parts[2]) : 0,
    release: Number.isFinite(Number(parts[3])) ? Number(parts[3]) : 0,
    deadline: parts[4] && Number.isFinite(deadline) ? deadline : null,
    predecessors: (parts[5] ?? '').split(/[|;]/).map(Number).filter(Number.isFinite),
  };
}).filter(Boolean);

const generateCosts = (seed) => {
  const random = makeRng(seed);
  return Array.from({ length: 6 }, (_, row) => Array.from({ length: 6 }, (_, col) => row === col ? 4 + Math.floor(random() * 6) : 10 + Math.floor(random() * 90)));
};

const generateItems = (seed) => {
  const random = makeRng(seed);
  return Array.from({ length: 12 }, (_, i) => ({ name: `item ${i + 1}`, weight: 4 + Math.floor(random() * 26), value: 10 + Math.floor(random() * 190) }));
};

const generateJobs = (seed) => {
  const random = makeRng(seed);
  return Array.from({ length: 8 }, (_, i) => ({
    name: `job ${i + 1}`,
    duration: 2 + Math.floor(random() * 8),
    machine: Math.floor(random() * 2),
    release: 0,
    deadline: null,
    predecessors: i >= 2 && i % 3 === 2 ? [i - 2] : [],
  }));
};

export default function ConstraintStudio() {
  const [model, setModel] = useState('assignment');
  const [seed, setSeed] = useState(42);
  const [costText, setCostText] = useState(() => fmtCosts(generateCosts(42)));
  const [blockedText, setBlockedText] = useState('');
  const [itemText, setItemText] = useState(() => fmtItems(generateItems(42)));
  const [capacity, setCapacity] = useState(60);
  const [jobText, setJobText] = useState(() => fmtJobs(generateJobs(42)));
  const [jobCapacity, setJobCapacity] = useState(2);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const controller = useRef(null);

  const costs = parseMatrix(costText);
  const forbidden = parsePairs(blockedText);
  const items = parseItems(itemText);
  const jobs = parseJobs(jobText);

  const regenerate = () => {
    const next = Math.floor(Math.random() * 100000);
    setSeed(next);
    setCostText(fmtCosts(generateCosts(next)));
    setItemText(fmtItems(generateItems(next)));
    setJobText(fmtJobs(generateJobs(next)));
    setResult(null);
  };

  const run = async () => {
    setBusy(true);
    setResult(null);
    setError('');
    setProgress({ phase: 'Starting the search' });
    const abort = new AbortController();
    controller.current = abort;
    try {
      if (model === 'assignment') {
        if ((costs[0]?.length ?? 0) < costs.length) throw new Error('The matrix needs at least as many columns as rows for a complete assignment.');
        const outcome = await solveAssignment({ costs, forbidden, onProgress: setProgress, signal: abort.signal, timeLimitMs: 6000 });
        setResult({ kind: 'assignment', outcome });
      } else if (model === 'knapsack') {
        if (!items.length) throw new Error('Give at least one item with a weight and a value.');
        const outcome = await solveKnapsack({
          weights: items.map((item) => item.weight),
          values: items.map((item) => item.value),
          capacity,
          onProgress: setProgress,
          signal: abort.signal,
          timeLimitMs: 6000,
        });
        setResult({ kind: 'knapsack', outcome });
      } else {
        if (!jobs.length) throw new Error('Give at least one job with a duration.');
        const outcome = await solveSchedule({ jobs, capacity: jobCapacity, onProgress: setProgress, signal: abort.signal, timeLimitMs: 6000 });
        setResult({ kind: 'schedule', outcome });
      }
    } catch (thrown) {
      setError(thrown.message || 'The search could not run.');
    }
    setBusy(false);
    setProgress(null);
    controller.current = null;
  };

  const exportText = result && result.kind === 'assignment' && result.outcome.best
    ? result.outcome.best.assignment.map((col, row) => `row ${row + 1} → column ${col + 1} (cost ${costs[row][col]})`).join('\n')
    : result && result.kind === 'knapsack' && result.outcome.best
      ? result.outcome.best.chosen.map((index) => `${items[index].name}: weight ${items[index].weight}, value ${items[index].value}`).join('\n')
      : result && result.kind === 'schedule' && result.outcome.best
        ? result.outcome.best.starts.map((start, i) => `${jobs[i].name}: ${start}–${start + jobs[i].duration} on machine ${jobs[i].machine + 1}`).join('\n')
        : '';

  return (
    <ToolShell
      toolId="constraint-engine"
      icon={Target}
      title="Constraint Optimization Engine"
      desc="A constraint solver with domains, propagation and branch-and-bound search, plus independent exact solvers whose answers check the search — assignment, packing and scheduling."
      state={{ model, seed, costText, blockedText, itemText, capacity, jobText, jobCapacity }}
      onRestore={(state) => {
        if (!state) return;
        if (state.model) setModel(state.model);
        if (state.seed) setSeed(state.seed);
        if (state.costText) setCostText(state.costText);
        if (state.blockedText != null) setBlockedText(state.blockedText);
        if (state.itemText) setItemText(state.itemText);
        if (state.capacity) setCapacity(state.capacity);
        if (state.jobText) setJobText(state.jobText);
        if (state.jobCapacity) setJobCapacity(state.jobCapacity);
      }}
      exportText={exportText}
      exportName="solution.txt"
      exportMime="text/plain"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={model} onChange={setModel} options={MODEL_OPTIONS} />
        <Button size="sm" variant="outline" onClick={regenerate} className="gap-1.5"><Shuffle className="h-3.5 w-3.5" /> New problem</Button>
        {busy
          ? <Button size="sm" variant="outline" onClick={() => controller.current?.abort()} className="gap-1.5"><X className="h-3.5 w-3.5" /> Stop</Button>
          : <Button size="sm" onClick={run} className="gap-1.5"><Play className="h-3.5 w-3.5" /> Solve</Button>}
      </div>

      <EngineProgress
        busy={busy}
        phase={progress?.phase}
        done={progress?.done}
        total={progress?.total}
        stats={progress?.nodes ? [`${progress.nodes.toLocaleString()} nodes`, `${progress.prunes ?? 0} pruned`, progress.incumbent != null ? `best ${progress.incumbent}` : ''].filter(Boolean) : []}
      />
      {error && <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      {model === 'assignment' && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Cost matrix (rows comma-separated — rows are workers, columns are jobs)" hint="Every row must be assigned a distinct column. Fewer rows than columns is fine; more rows is not.">
            <Area value={costText} onChange={setCostText} rows={8} mono />
          </Field>
          <Field label="Blocked pairs (optional, one r,c per line)" hint="A pair that cannot be matched — kept out of the domains before the search starts.">
            <Area value={blockedText} onChange={setBlockedText} rows={8} mono placeholder={'0,3\n4,1'} />
          </Field>
        </div>
      )}

      {model === 'knapsack' && (
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Items (name, weight, value)" hint="Integer weights. Values may be decimals.">
            <Area value={itemText} onChange={setItemText} rows={8} mono />
          </Field>
          <Field label="Capacity">
            <input
              type="number"
              value={capacity}
              min={1}
              onChange={(event) => setCapacity(Math.max(1, Number(event.target.value) || 1))}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </Field>
        </div>
      )}

      {model === 'schedule' && (
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <Field label="Jobs (name, duration, machine, release, deadline, predecessors)" hint="Predecessors are 0-based indices separated by | — e.g. a job that depends on the first and third is 0|2.">
            <Area value={jobText} onChange={setJobText} rows={8} mono />
          </Field>
          <Field label="Jobs allowed per machine at once" hint="The engine treats each machine as a resource with this capacity, so two jobs may overlap only if the capacity allows it.">
            <input
              type="number"
              value={jobCapacity}
              min={1}
              onChange={(event) => setJobCapacity(Math.max(1, Number(event.target.value) || 1))}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            />
          </Field>
        </div>
      )}

      {result?.kind === 'assignment' && <AssignmentResult outcome={result.outcome} costs={costs} forbidden={forbidden} />}
      {result?.kind === 'knapsack' && <PackingResult outcome={result.outcome} items={items} capacity={capacity} />}
      {result?.kind === 'schedule' && <ScheduleResult outcome={result.outcome} jobs={jobs} capacity={jobCapacity} />}

      <Panel className="!p-3">
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· The search is the engine: candidate values are kept in domains, propagation narrows those domains before a decision is made, and branch and bound closes any branch whose optimistic completion cannot beat the incumbent.</p>
          <p>· Each result is then checked twice over — once by re-reading the finished solution against the raw problem, and once against an exact solver (Hungarian for assignment, dynamic programming for packing). If the two disagree, the check panel says so rather than hiding it.</p>
          <p>· A status of “proven optimal” means the search exhausted or safely closed every branch it could not improve. “Time limit” and “stopped” mean a feasible solution was found but optimality was not established — the exact solver's value is still shown for comparison.</p>
          <p>· The search yields to the browser every few thousand nodes, which is what keeps the page responsive and the Stop button honest. That hand-back is the only overhead in the loop.</p>
        </div>
      </Panel>
    </ToolShell>
  );
}

function AssignmentResult({ outcome, costs, forbidden }) {
  const assignment = outcome.best?.assignment ?? [];
  const check = verifyAssignment({ costs, forbidden }, assignment);
  const statusLabel = outcome.status === 'optimal' ? 'proven optimal' : outcome.status;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
        <Hero label="Total cost" value={outcome.best ? outcome.best.cost : '—'} tone={check.ok ? 'emerald' : 'amber'}
          sub={outcome.best ? `found by ${outcome.source}` : 'no feasible assignment'} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Search status" value={statusLabel} sub={`${outcome.nodes.toLocaleString()} nodes · ${outcome.prunes.toLocaleString()} pruned`} mono />
          <Stat label="Exact solver optimum" value={outcome.exact.feasible ? outcome.exact.cost : 'infeasible'} sub={`Hungarian algorithm — search ${outcome.agreement}`} mono />
        </div>
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Assignment</span>
          <CopyBtn value={assignment.map((col, row) => `row ${row + 1} → column ${col + 1}`).join('\n')} />
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {assignment.map((col, row) => (
            <div key={row} className="tk-glass-panel flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono-j text-[11px]">
              <span>row {row + 1} → col {col + 1}</span>
              <span className="text-cyan-j">{costs[row]?.[col]}</span>
            </div>
          ))}
        </div>
      </Panel>

      {assignment.length > 0 && (
        <Panel>
          <div className="mb-2 text-xs font-semibold">Cost of each row's choice</div>
          <Bars data={assignment.map((col, row) => ({ label: `R${row + 1}`, value: costs[row]?.[col] ?? 0 }))} />
        </Panel>
      )}

      <VerifyPanel
        items={[
          { label: 'Every row has a distinct column', ok: check.ok, detail: check.violations[0] ?? '' },
          { label: 'No blocked pair used', ok: !check.violations.some((v) => v.includes('blocked')) },
          { label: 'Total cost recomputed from the matrix', ok: check.ok, detail: check.ok ? `= ${check.cost}` : '' },
          { label: 'Search matches the exact solver', ok: outcome.agreement === 'agree', detail: outcome.agreement },
        ]}
        note={outcome.status === 'optimal'
          ? 'The search proved optimality, and the Hungarian algorithm independently arrives at the same cost.'
          : 'The search did not finish within its budget, so optimality rests on the exact solver rather than on the search.'}
      />
    </div>
  );
}

function PackingResult({ outcome, items, capacity }) {
  const chosen = outcome.best?.chosen ?? [];
  const check = verifyKnapsack({ weights: items.map((i) => i.weight), values: items.map((i) => i.value), capacity }, chosen);
  const excluded = items.map((item, index) => ({ item, index })).filter(({ index }) => !chosen.includes(index));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
        <Hero label="Best value found" value={outcome.best ? outcome.best.value : '—'} tone={check.ok ? 'emerald' : 'amber'} sub={`${chosen.length} of ${items.length} items`} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Weight used" value={`${check.weight} / ${capacity}`} sub={check.weight > capacity ? 'over capacity' : `${capacity - check.weight} left`} mono />
          <Stat label="Exact optimum (DP)" value={outcome.exact.value} sub={`search ${outcome.agreement}`} mono />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold">Chosen</span>
            <CopyBtn value={chosen.map((index) => `${items[index].name} (w ${items[index].weight}, v ${items[index].value})`).join('\n')} />
          </div>
          <div className="space-y-1.5">
            {chosen.map((index) => (
              <div key={index} className="tk-glass-panel flex items-center justify-between rounded-lg px-2.5 py-1.5 font-mono-j text-[11px]">
                <span>{items[index].name}</span>
                <span className="text-muted-foreground">w {items[index].weight} · v {items[index].value}</span>
              </div>
            ))}
            {!chosen.length && <div className="text-xs text-muted-foreground">Nothing fits the capacity.</div>}
          </div>
        </Panel>
        <Panel>
          <div className="mb-2 text-xs font-semibold">Left out ({excluded.length})</div>
          <div className="space-y-1.5">
            {excluded.slice(0, 12).map(({ item, index }) => (
              <div key={index} className="flex items-center justify-between rounded-lg border border-border/50 px-2.5 py-1.5 font-mono-j text-[11px] text-muted-foreground">
                <span>{item.name}</span>
                <span>w {item.weight} · v {item.value}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <VerifyPanel
        items={[
          { label: 'Total weight within capacity', ok: check.weight <= capacity, detail: `${check.weight} ≤ ${capacity}` },
          { label: 'No item counted twice', ok: !check.violations.some((v) => v.includes('more than once')) },
          { label: 'Value recomputed from the item list', ok: check.ok, detail: `= ${check.value}` },
          { label: 'Search matches dynamic programming', ok: outcome.agreement === 'agree', detail: outcome.agreement },
        ]}
        note="The packing bound relaxes the remaining items into fractions, which can never understate what is still reachable — that is why closing a branch on it is safe."
      />
    </div>
  );
}

function ScheduleResult({ outcome, jobs, capacity }) {
  const starts = outcome.best?.starts ?? [];
  const check = verifySchedule(jobs, starts, capacity);
  const machines = [...new Set(jobs.map((job) => job.machine ?? 0))].sort((a, b) => a - b);
  const span = Math.max(1, check.makespan);
  const gap = outcome.best && outcome.lowerBound ? outcome.best.makespan / outcome.lowerBound : null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.6fr]">
        <Hero label="Makespan" value={outcome.best ? outcome.best.makespan : '—'} unit="units" tone={check.ok ? 'emerald' : 'amber'} sub={outcome.best ? `lower bound ${outcome.lowerBound}` : 'no feasible schedule'} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Search status" value={outcome.status === 'optimal' ? 'proven optimal' : outcome.status} sub={`${outcome.nodes.toLocaleString()} nodes · ${outcome.prunes.toLocaleString()} pruned`} mono />
          <Stat label="Lower bound / makespan" value={gap ? gap.toFixed(3) : '—'} sub="1.000 means the schedule meets the bound" mono />
        </div>
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold">Schedule</span>
          <CopyBtn value={starts.map((start, i) => `${jobs[i].name}: ${start}–${start + jobs[i].duration} (machine ${jobs[i].machine + 1})`).join('\n')} />
        </div>
        <div className="space-y-2">
          {machines.map((machine) => (
            <div key={machine}>
              <div className="mb-1 font-mono-j text-[10px] text-muted-foreground">machine {machine + 1} · capacity {capacity}</div>
              <div className="relative h-9 rounded-lg border border-border/60 bg-card/40">
                {jobs.map((job, index) => {
                  if ((job.machine ?? 0) !== machine || starts[index] == null) return null;
                  return (
                    <div
                      key={job.name}
                      title={`${job.name}: ${starts[index]}–${starts[index] + job.duration}`}
                      className="absolute top-1 bottom-1 overflow-hidden rounded border border-cyan-j/50 bg-gradient-to-br from-cyan-j/25 to-cyan-j/5 px-1.5 text-[10px] leading-7"
                      style={{ left: `${(starts[index] / span) * 100}%`, width: `${Math.max(1.5, (job.duration / span) * 100)}%` }}
                    >
                      <span className="block truncate font-mono-j">{job.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-semibold">Machine load</div>
        <Bars data={machines.map((machine) => ({ label: `M${machine + 1}`, value: jobs.filter((job) => (job.machine ?? 0) === machine).reduce((sum, job) => sum + job.duration, 0) }))} />
      </Panel>

      <div className="flex flex-wrap gap-1.5">
        <Pills items={[
          { label: 'jobs', value: jobs.length },
          { label: 'machines', value: machines.length },
          { label: 'capacity', value: capacity },
          { label: 'makespan', value: check.makespan },
        ]} />
      </div>

      <VerifyPanel
        items={[
          { label: 'No machine exceeds its capacity at any time', ok: !check.violations.some((v) => v.includes('capacity')) },
          { label: 'Every precedence respected', ok: !check.violations.some((v) => v.includes('before')) },
          { label: 'Every release and deadline respected', ok: !check.violations.some((v) => v.includes('release') || v.includes('deadline')) },
          { label: 'Makespan recomputed from the schedule', ok: check.ok, detail: check.ok ? `= ${check.makespan}` : check.violations[0] },
        ]}
        note="The lower bound is the larger of the critical path and the busiest machine's load divided by its capacity. A schedule that reaches it cannot be improved on, whatever the search does next."
      />
    </div>
  );
}