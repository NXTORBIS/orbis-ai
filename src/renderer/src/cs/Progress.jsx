import React, { useState } from 'react';
// CHANGED FROM THEIRS: the library, so generated problems count -- and are counted apart.
import { PROBLEMS, WRITTEN_PROBLEMS, generatedProblems, DIFFICULTY_XP } from './lib/library.js';
import { LEARN_TOPICS } from './lib/learn.js';
import { useCSProgress } from './lib/useCSProgress.js';
import { useXp } from './lib/XpContext.jsx';
import { Code2, CheckCircle2, XCircle, Clock, TrendingUp, Award } from 'lucide-react';

export default function Progress() {
  const { progress } = useCSProgress();
  const xp = useXp();
  const [openSub, setOpenSub] = useState(null);

  const solved = progress.solved.map((id) => PROBLEMS.find((p) => p.id === id)).filter(Boolean);
  // Written and generated are counted apart on purpose: a problem somebody wrote and a problem a model wrote
  // are different things, and one number covering both would make the total look bigger than the work behind it.
  const solvedWritten = solved.filter((p) => !p.generated).length;
  const solvedGenerated = solved.length - solvedWritten;
  const generatedCount = generatedProblems().length;
  const byDiff = { Easy: 0, Medium: 0, Hard: 0, Expert: 0 };
  solved.forEach((p) => { byDiff[p.difficulty] = (byDiff[p.difficulty] || 0) + 1; });
  const totalSub = progress.submissions.length;
  const acceptedSub = progress.submissions.filter((s) => s.verdict === 'Accepted').length;
  const accRate = totalSub ? Math.round((acceptedSub / totalSub) * 100) : 0;
  const lessonsDone = progress.lessonsCompleted.length;
  const totalLessons = LEARN_TOPICS.reduce((n, t) => n + t.lessons.length, 0);

  const openSubmission = openSub ? progress.submissions.find((s) => s.id === openSub) : null;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <h1 className="font-display text-xl font-bold">Progress</h1>
      <p className="text-xs text-muted-foreground">All statistics are computed from your real activity — no fabricated numbers.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CheckCircle2} label="Solved" value={`${solvedWritten}/${WRITTEN_PROBLEMS.length}`} accent="text-emerald-400" />
        <Stat icon={Clock} label="Submissions" value={totalSub} accent="text-cyan-j" />
        <Stat icon={TrendingUp} label="Acceptance" value={`${accRate}%`} accent="text-violet-400" />
        <Stat icon={Award} label="Lessons" value={`${lessonsDone}/${totalLessons}`} accent="text-amber-400" />
      </div>

      {generatedCount > 0 && (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Orion has written {generatedCount} more problem{generatedCount === 1 ? '' : 's'}, and you have solved{' '}
          {solvedGenerated} of them. They are counted here separately from the {WRITTEN_PROBLEMS.length} written
          ones, so the figures above stay comparable.
        </p>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Solved by Difficulty</div>
          <div className="space-y-2">
            {Object.entries(byDiff).map(([d, n]) => (
              <div key={d} className="flex items-center gap-3">
                <span className={`w-16 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${diffColor(d)}`}>{d}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j" style={{ width: `${PROBLEMS.length ? Math.min(100, (n / PROBLEMS.length) * 100) : 0}%` }} />
                </div>
                <span className="w-8 text-right font-mono-j text-xs">{n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Jarvis XP</div>
          <div className="flex items-center gap-3">
            <Award className="size-8 text-cyan-j" />
            <div className="leading-tight">
              <div className="text-[10px] text-muted-foreground">Level</div>
              <div className="font-display text-lg font-bold">{xp.status?.level ?? '—'}</div>
            </div>
            <div className="ml-auto text-right leading-tight">
              <div className="text-[10px] text-muted-foreground">Total XP</div>
              <div className="font-mono-j text-sm font-bold text-cyan-j">{(xp.status?.total_xp ?? xp.status?.xp ?? 0).toLocaleString()}</div>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">Computer Science contributes to your single global Jarvis level — there is no separate CS XP system.</p>
        </div>
      </div>

      {/* Submission history */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 text-sm font-semibold">Submission History</div>
        {progress.submissions.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">No submissions yet.</div>
        ) : (
          <div className="space-y-1">
            {progress.submissions.map((s) => (
              <button key={s.id} onClick={() => setOpenSub(openSub === s.id ? null : s.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent">
                <span className={`size-2 rounded-full ${s.verdict === 'Accepted' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="flex-1 truncate">{s.problemTitle}</span>
                <span className="text-muted-foreground">{s.language}</span>
                {s.runtime != null && <span className="text-muted-foreground">{s.runtime}ms</span>}
                <span className={`font-medium ${s.verdict === 'Accepted' ? 'text-emerald-400' : 'text-red-400'}`}>{s.verdict}</span>
              </button>
            ))}
          </div>
        )}
        {openSubmission && (
          <div className="mt-3 rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">{openSubmission.problemTitle} · {openSubmission.language}</span>
              <span className="text-muted-foreground">{new Date(openSubmission.timestamp).toLocaleString()}</span>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/30 p-2 font-mono-j text-xs scrollbar-thin">{openSubmission.source}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <Icon className={`mb-2 size-5 ${accent}`} />
      <div className="font-display text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function diffColor(d) {
  return d === 'Easy' ? 'bg-emerald-500/15 text-emerald-400' :
    d === 'Medium' ? 'bg-amber-500/15 text-amber-400' :
    d === 'Hard' ? 'bg-orange-500/15 text-orange-400' :
    'bg-red-500/15 text-red-400';
}