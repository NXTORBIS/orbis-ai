import React, { useState } from 'react';
import { LEARN_TOPICS, getTopic } from './lib/learn.js';
import { useCSProgress } from './lib/useCSProgress.js';
import { useXp } from './lib/XpContext.jsx';
import { Code2, Layers, Workflow, Cpu, Terminal, Network, Database, Sigma, ShieldCheck, GitBranch, BookOpen, CheckCircle2, Circle, ChevronRight, Clock } from 'lucide-react';

const ICONS = { Code2, Layers, Workflow, Cpu, Terminal, Network, Database, Sigma, ShieldCheck, GitBranch };

export default function Learn() {
  const { progress, completeLesson } = useCSProgress();
  const xp = useXp();
  const [openTopic, setOpenTopic] = useState(null);
  const [openLesson, setOpenLesson] = useState(null);

  const topic = openTopic ? getTopic(openTopic) : null;
  const lesson = topic?.lessons.find((l) => l.id === openLesson);

  if (lesson) {
    const done = progress.lessonsCompleted.includes(lesson.id);
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-2xl p-6">
          <button onClick={() => setOpenLesson(null)} className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-j">
            <ChevronRight className="size-3.5 rotate-180" /> Back to {topic.title}
          </button>
          <div className="text-[11px] text-muted-foreground">{topic.title} · {lesson.estMinutes} min</div>
          <h1 className="mt-1 font-display text-xl font-bold">{lesson.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{lesson.summary}</p>
          <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{lesson.body}</div>
          <button
            onClick={() => {
              if (!done) {
                completeLesson(lesson.id);
                xp.award({ source: 'studio', activity_type: 'lesson_completed', ref_id: lesson.id, description: `Completed ${lesson.title}`, difficulty: 'standard', metadata: { lesson_id: lesson.id } }).catch(() => {});
              }
            }}
            className={`mt-6 flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition ${
              done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-cyan-j text-background hover:bg-cyan-j/90'
            }`}>
            {done ? <CheckCircle2 className="size-4" /> : <Circle className="size-4" />}
            {done ? 'Completed' : 'Mark as completed (+20 XP)'}
          </button>
        </div>
      </div>
    );
  }

  if (topic) {
    return (
      <div className="h-full overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-2xl p-6">
          <button onClick={() => setOpenTopic(null)} className="mb-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-cyan-j">
            <ChevronRight className="size-3.5 rotate-180" /> All topics
          </button>
          <h1 className="font-display text-xl font-bold">{topic.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{topic.blurb}</p>
          <div className="mt-5 space-y-2">
            {topic.lessons.map((l, i) => {
              const done = progress.lessonsCompleted.includes(l.id);
              return (
                <button key={l.id} onClick={() => setOpenLesson(l.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:border-cyan-j/40">
                  <span className="font-mono-j text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <div className="flex-1">
                    <div className="text-sm font-medium">{l.title}</div>
                    <div className="text-xs text-muted-foreground">{l.summary}</div>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="size-3" />{l.estMinutes}m</span>
                  {done ? <CheckCircle2 className="size-4 text-emerald-400" /> : <Circle className="size-4 text-muted-foreground/30" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <h1 className="font-display text-xl font-bold">Learn</h1>
      <p className="text-xs text-muted-foreground">Structured Computer Science topics with real lessons. Progress is tracked from completed lessons.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEARN_TOPICS.map((t) => {
          const Icon = ICONS[t.icon] || BookOpen;
          const total = t.lessons.length;
          const done = t.lessons.filter((l) => progress.lessonsCompleted.includes(l.id)).length;
          const pct = total ? Math.round((done / total) * 100) : 0;
          return (
            <button key={t.slug} onClick={() => setOpenTopic(t.slug)}
              className="group flex flex-col rounded-xl border border-border bg-card p-4 text-left transition hover:border-cyan-j/40">
              <div className="mb-2 flex items-center gap-2">
                <div className="grid size-9 place-items-center rounded-lg bg-cyan-j/10 text-cyan-j"><Icon className="size-5" /></div>
                <span className="text-[10px] text-muted-foreground">{t.category}</span>
              </div>
              <div className="font-semibold">{t.title}</div>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{t.blurb}</p>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>{done}/{total} lessons</span><span>{pct}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-cyan-j" style={{ width: `${pct}%` }} /></div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}