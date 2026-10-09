import React from 'react';
import { Link } from './ui/router.jsx';
import { PROBLEMS } from './lib/problems.js';
import { useCSProgress } from './lib/useCSProgress.js';
import { CalendarDays, ChevronRight } from 'lucide-react';

// Deterministic daily challenge: same problem for everyone on a given date.
export default function DailyChallenge() {
  const { problemStatus } = useCSProgress();
  const today = new Date().toISOString().slice(0, 10);
  const problem = PROBLEMS[parseInt(today.replace(/-/g, ''), 10) % PROBLEMS.length];
  const status = problemStatus(problem.id);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <div className="mx-auto max-w-xl">
        <div className="mb-2 flex items-center gap-2 text-xs text-cyan-j"><CalendarDays className="size-4" /> Daily Challenge · {today}</div>
        <h1 className="font-display text-2xl font-bold">{problem.title}</h1>
        <div className="mt-2 flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${diffColor(problem.difficulty)}`}>{problem.difficulty}</span>
          <span className="text-[11px] text-muted-foreground">+{problem.xp} XP</span>
          {status === 'Solved' && <span className="text-[11px] font-medium text-emerald-400">✓ Already solved today</span>}
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm text-foreground/90">{problem.description}</p>
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Example</div>
          <div className="font-mono-j text-xs"><span className="text-muted-foreground">Input: </span>{problem.examples[0].input}</div>
          <div className="font-mono-j text-xs"><span className="text-muted-foreground">Output: </span>{problem.examples[0].output}</div>
        </div>
        <Link to={`/cs/problem/${problem.slug}`}
          className="mt-5 inline-flex items-center gap-1.5 rounded-md bg-cyan-j px-4 py-2 text-sm font-semibold text-background transition hover:bg-cyan-j/90">
          Start challenge <ChevronRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function diffColor(d) {
  return d === 'Easy' ? 'bg-emerald-500/15 text-emerald-400' :
    d === 'Medium' ? 'bg-amber-500/15 text-amber-400' :
    d === 'Hard' ? 'bg-orange-500/15 text-orange-400' :
    'bg-red-500/15 text-red-400';
}