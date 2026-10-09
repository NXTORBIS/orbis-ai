import React from 'react';
import { Link } from './ui/router.jsx';
import { useCSProgress } from './lib/useCSProgress.js';
import { useXp } from './lib/XpContext.jsx';
import { PROBLEMS, DIFFICULTY_XP } from './lib/problems.js';
import { LEARN_TOPICS } from './lib/learn.js';
import { Flame, Trophy, Code2, BookOpen, Target, TrendingUp, ChevronRight, CalendarDays, Award } from 'lucide-react';

export default function Overview() {
  const { progress, problemStatus } = useCSProgress();
  const xp = useXp();
  const level = xp.status?.level ?? xp.status?.level_info?.level ?? '—';
  const totalXp = xp.status?.total_xp ?? xp.status?.xp ?? '—';

  const solved = progress.solved.length;
  const attempted = progress.attempted.length;
  const lessons = progress.lessonsCompleted.length;
  const bookmarks = progress.bookmarked.length;

  // Continue problem: first attempted-but-unsolved, else first unsolved.
  const continueProblem =
    PROBLEMS.find((p) => progress.attempted.includes(p.id) && !progress.solved.includes(p.id)) ||
    PROBLEMS.find((p) => !progress.solved.includes(p.id));

  // Continue learning: first topic with an incomplete lesson.
  const continueLesson = (() => {
    for (const t of LEARN_TOPICS) {
      const next = t.lessons.find((l) => !progress.lessonsCompleted.includes(l.id));
      if (next) return { topic: t, lesson: next };
    }
    return null;
  })();

  // Daily challenge: deterministic by date.
  const today = new Date().toISOString().slice(0, 10);
  const daily = PROBLEMS[parseInt(today.replace(/-/g, ''), 10) % PROBLEMS.length];

  // Category progress (real): % of problems solved per topic that has problems.
  const topicProgress = (() => {
    const map = {};
    PROBLEMS.forEach((p) => p.topics.forEach((t) => {
      map[t] = map[t] || { total: 0, solved: 0 };
      map[t].total++;
      if (progress.solved.includes(p.id)) map[t].solved++;
    }));
    return Object.entries(map).map(([topic, v]) => ({ topic, ...v, pct: v.total ? Math.round((v.solved / v.total) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct).slice(0, 6);
  })();

  const stats = [
    { label: 'Problems Solved', value: solved, icon: Code2, accent: 'text-emerald-400' },
    { label: 'Attempted', value: attempted, icon: Target, accent: 'text-cyan-j' },
    { label: 'Lessons Done', value: lessons, icon: BookOpen, accent: 'text-violet-400' },
    { label: 'Bookmarks', value: bookmarks, icon: Trophy, accent: 'text-amber-400' },
  ];

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Computer Science Studio</h1>
          <p className="text-xs text-muted-foreground">A complete environment to learn, program, and practice computer science.</p>
        </div>
        <div className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-2">
          <div className="flex items-center gap-2">
            <Award className="size-5 text-cyan-j" />
            <div className="leading-tight">
              <div className="text-[10px] text-muted-foreground">Jarvis Level</div>
              <div className="font-display text-sm font-bold">{level}</div>
            </div>
          </div>
          <div className="h-8 w-px bg-border" />
          <div className="leading-tight">
            <div className="text-[10px] text-muted-foreground">Total XP</div>
            <div className="font-mono-j text-sm font-bold text-cyan-j">{typeof totalXp === 'number' ? totalXp.toLocaleString() : totalXp}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border bg-card p-4">
            <s.icon className={`mb-2 size-5 ${s.accent}`} />
            <div className="font-display text-2xl font-bold">{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {/* Continue problem */}
        <Link to={`/cs/problem/${continueProblem?.slug || PROBLEMS[0].slug}`} className="group rounded-xl border border-border bg-card p-4 transition hover:border-cyan-j/40">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Code2 className="size-3.5" /> Continue Problem
          </div>
          <div className="font-semibold">{continueProblem?.title}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${diffColor(continueProblem?.difficulty)}`}>{continueProblem?.difficulty}</span>
            <span className="text-[10px] text-muted-foreground">+{continueProblem?.xp} XP</span>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs text-cyan-j opacity-0 transition group-hover:opacity-100">Continue <ChevronRight className="size-3" /></div>
        </Link>

        {/* Continue learning */}
        <Link to="/cs/learn" className="group rounded-xl border border-border bg-card p-4 transition hover:border-cyan-j/40">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="size-3.5" /> Continue Learning
          </div>
          <div className="font-semibold">{continueLesson?.lesson.title || 'All caught up'}</div>
          <div className="text-xs text-muted-foreground">{continueLesson?.topic.title}</div>
          <div className="mt-3 flex items-center gap-1 text-xs text-cyan-j opacity-0 transition group-hover:opacity-100">Open lesson <ChevronRight className="size-3" /></div>
        </Link>

        {/* Daily challenge */}
        <Link to={`/cs/problem/${daily.slug}`} className="group rounded-xl border border-cyan-j/30 bg-cyan-j/5 p-4 transition hover:border-cyan-j/60">
          <div className="mb-1 flex items-center gap-2 text-xs text-cyan-j">
            <CalendarDays className="size-3.5" /> Daily Challenge
          </div>
          <div className="font-semibold">{daily.title}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${diffColor(daily.difficulty)}`}>{daily.difficulty}</span>
            <span className="text-[10px] text-muted-foreground">+{daily.xp} XP</span>
          </div>
          <div className="mt-3 flex items-center gap-1 text-xs text-cyan-j">Start challenge <ChevronRight className="size-3" /></div>
        </Link>
      </div>

      {/* Category progress (real) */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><TrendingUp className="size-4 text-cyan-j" /> Topic Progress</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {topicProgress.map((t) => (
            <div key={t.topic}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted-foreground">{t.topic}</span>
                <span className="font-mono-j">{t.solved}/{t.total}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-cyan-j transition-all" style={{ width: `${t.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent submissions */}
      <div className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Flame className="size-4 text-amber-400" /> Recent Submissions</div>
        {progress.submissions.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">No submissions yet. Solve a problem to see it here.</div>
        ) : (
          <div className="space-y-1.5">
            {progress.submissions.slice(0, 6).map((s) => (
              <Link key={s.id} to={`/cs/problem/${PROBLEMS.find((p) => p.id === s.problemId)?.slug || ''}`}
                className="flex items-center gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-accent">
                <span className={`size-2 rounded-full ${s.verdict === 'Accepted' ? 'bg-emerald-400' : 'bg-red-400'}`} />
                <span className="flex-1 truncate">{s.problemTitle}</span>
                <span className="text-muted-foreground">{s.language}</span>
                <span className={`font-medium ${s.verdict === 'Accepted' ? 'text-emerald-400' : 'text-red-400'}`}>{s.verdict}</span>
              </Link>
            ))}
          </div>
        )}
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