import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Link } from './ui/router.jsx';
import { PROBLEMS, WRITTEN_PROBLEMS, ALL_TOPICS, filterProblems, generatedProblems, onLibraryChange, dropProblem } from './lib/library.js';
import { makeProblem } from './lib/makeProblem.js';
import { LANGUAGES } from './lib/languages.js';
import { useCSProgress } from './lib/useCSProgress.js';
import { Search, Bookmark, BookmarkCheck, CheckCircle2, Circle, Clock, Sparkles, Loader2, Trash2, X } from 'lucide-react';

// CHANGED FROM THEIRS: two things.
//
// 1. The list comes from the library rather than from their sixteen, so problems Orion has written appear in the
//    same list with the same filters, marked as generated and never pretending to be written.
// 2. There is a way to ask for a new one. Their sixteen were the whole studio -- solve them and it was finished.
//
// `acceptance` is the detail worth knowing about: a written problem has a real percentage from real attempts,
// and a generated one has none. It shows a dash rather than a number, because an invented percentage would be
// the easiest thing on this screen to fake and the hardest to notice.

const DIFFICULTIES = ['All', 'Easy', 'Medium', 'Hard', 'Expert'];
const STATUSES = ['All', 'Solved', 'Attempted', 'Bookmarked'];
const ORIGINS = ['All', 'Written', 'Generated'];

export default function Problems() {
  const { progress, toggleBookmark, problemStatus } = useCSProgress();
  const [q, setQ] = useState('');
  const [difficulty, setDifficulty] = useState('All');
  const [topic, setTopic] = useState('All');
  const [status, setStatus] = useState('All');
  const [origin, setOrigin] = useState('All');
  const [sort, setSort] = useState('number');
  const [asking, setAsking] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [said, setSaid] = useState(null);
  const [library, setLibrary] = useState(0);

  // The library is not React state, so the list has to hear about a problem being kept or removed.
  useEffect(() => onLibraryChange(() => setLibrary((n) => n + 1)), []);

  const results = useMemo(() => {
    let list = filterProblems({ q, difficulty, topic, origin });
    if (status === 'Solved') list = list.filter((p) => progress.solved.includes(p.id));
    else if (status === 'Attempted') list = list.filter((p) => progress.attempted.includes(p.id) && !progress.solved.includes(p.id));
    else if (status === 'Bookmarked') list = list.filter((p) => progress.bookmarked.includes(p.id));
    // A generated problem has no acceptance rate, so sorting by it puts those last rather than treating a
    // missing number as a zero.
    if (sort === 'acceptance') list = [...list].sort((a, b) => (b.acceptance ?? -1) - (a.acceptance ?? -1));
    else if (sort === 'difficulty') list = [...list].sort((a, b) => diffRank(a.difficulty) - diffRank(b.difficulty));
    else list = [...list].sort((a, b) => a.number - b.number);
    return list;
  }, [q, difficulty, topic, status, origin, sort, progress, library]);

  const made = generatedProblems();
  const writtenSolved = WRITTEN_PROBLEMS.filter((p) => progress.solved.includes(p.id)).length;
  const allWrittenDone = writtenSolved === WRITTEN_PROBLEMS.length && WRITTEN_PROBLEMS.length > 0;

  const ask = useCallback(async ({ about, level, language }) => {
    setAsking(true);
    setSaid({ kind: 'working', text: 'Asking Orion for a problem…' });
    const got = await makeProblem({
      about,
      difficulty: level,
      language,
      say: (text) => setSaid({ kind: 'working', text })
    });
    setAsking(false);
    if (got.ok) {
      setSaid({ kind: 'done', text: got.says, slug: got.problem.slug });
      setAskOpen(false);
    } else {
      setSaid({ kind: 'refused', text: got.says, fix: got.fix });
    }
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card/50 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-bold">Problems</h1>
          <p className="text-xs text-muted-foreground">
            {WRITTEN_PROBLEMS.length} written{made.length > 0 ? ` · ${made.length} written by Orion` : ''} · {progress.solved.length} solved
          </p>
        </div>
        <button
          onClick={() => { setAskOpen((open) => !open); setSaid(null); }}
          disabled={asking}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-cyan-j/40 bg-cyan-j/10 px-2.5 py-1.5 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-50"
        >
          {asking ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {asking ? 'Writing…' : 'New problem from Orion'}
        </button>
      </div>

      {allWrittenDone && made.length === 0 && (
        <p className="border-b border-border bg-cyan-j/5 px-4 py-2 text-xs text-muted-foreground">
          You have solved all {WRITTEN_PROBLEMS.length} written problems. Orion can write more — each one is
          checked against its own reference solution before you see it.
        </p>
      )}

      {askOpen && <AskPanel onAsk={ask} busy={asking} onClose={() => setAskOpen(false)} />}

      {said && (
        <div className={`flex items-start gap-2 border-b border-border px-4 py-2 text-xs ${
          said.kind === 'refused' ? 'bg-red-500/10 text-red-300' : said.kind === 'done' ? 'bg-emerald-500/10 text-emerald-300' : 'text-muted-foreground'
        }`}>
          {said.kind === 'working' && <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />}
          <div className="min-w-0 flex-1">
            <div>{said.text}</div>
            {said.fix && <div className="mt-0.5 text-muted-foreground">{said.fix}</div>}
            {said.slug && (
              <Link to={`/cs/problem/${said.slug}`} className="mt-0.5 inline-block underline">Open it</Link>
            )}
          </div>
          {said.kind !== 'working' && (
            <button onClick={() => setSaid(null)} title="Dismiss" className="shrink-0 opacity-60 hover:opacity-100">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[180px] flex-1">
          <Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search problems…"
            className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-xs focus:border-cyan-j focus:outline-none" />
        </div>
        <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Difficulty" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="All">All Topics</option>
          {ALL_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Who wrote it" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {ORIGINS.map((s) => <option key={s} value={s}>{s === 'All' ? 'Anyone' : s}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by" className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          <option value="number">Newest</option>
          <option value="acceptance">Acceptance</option>
          <option value="difficulty">Difficulty</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {results.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">No problems match your filters.</div>
        ) : (
          <div className="divide-y divide-border">
            {results.map((p) => {
              const st = problemStatus(p.id);
              const bookmarked = progress.bookmarked.includes(p.id);
              return (
                <div key={p.id} className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-accent/40">
                  <Link to={`/cs/problem/${p.slug}`} className="flex flex-1 items-center gap-3 min-w-0">
                    <span className="w-12 shrink-0 font-mono-j text-xs text-muted-foreground">#{p.id}</span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{p.title}</span>
                      {p.generated && (
                        <span title={`Written by Orion, and checked against its own reference solution${p.checkedBy === 'ran' ? ' by running it' : ' by reading it'}`}
                          className="shrink-0 rounded bg-cyan-j/15 px-1.5 py-0.5 text-[10px] font-medium text-cyan-j">Orion</span>
                      )}
                    </span>
                    <span className="hidden gap-1 sm:flex">
                      {p.topics.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>
                      ))}
                    </span>
                    {/* A dash, not a number: a problem nobody has attempted has no acceptance rate. */}
                    <span className="w-16 text-right text-[11px] text-muted-foreground" title={p.acceptance === null ? 'No acceptance rate — nobody has attempted this one yet' : undefined}>
                      {typeof p.acceptance === 'number' ? `${p.acceptance.toFixed(1)}%` : '—'}
                    </span>
                    <span className={`w-16 rounded px-1.5 py-0.5 text-center text-[10px] font-medium ${diffColor(p.difficulty)}`}>{p.difficulty}</span>
                  </Link>
                  <span className="w-20 text-right text-[11px] text-muted-foreground">+{p.xp} XP</span>
                  <span className="w-6 text-center">
                    {st === 'Solved' ? <CheckCircle2 className="mx-auto size-4 text-emerald-400" /> :
                      st === 'Attempted' ? <Clock className="mx-auto size-4 text-amber-400" /> :
                      <Circle className="mx-auto size-4 text-muted-foreground/30" />}
                  </span>
                  <button onClick={() => toggleBookmark(p.id)} className="shrink-0 text-muted-foreground transition hover:text-cyan-j" title="Bookmark">
                    {bookmarked ? <BookmarkCheck className="size-4 text-cyan-j" /> : <Bookmark className="size-4" />}
                  </button>
                  {p.generated ? (
                    <button
                      onClick={() => { const got = dropProblem(p.slug); if (!got.ok) setSaid({ kind: 'refused', text: got.says }); }}
                      className="shrink-0 text-muted-foreground transition hover:text-red-400"
                      title="Remove this generated problem"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : (
                    // The written sixteen cannot be removed, and the space is held so the rows stay aligned.
                    <span className="size-4 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AskPanel({ onAsk, busy, onClose }) {
  const [about, setAbout] = useState('');
  const [level, setLevel] = useState('Medium');
  const [language, setLanguage] = useState('python');

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!busy) onAsk({ about: about.trim(), level, language }); }}
      className="flex flex-wrap items-end gap-2 border-b border-border bg-card/40 px-4 py-3"
    >
      <label className="min-w-[200px] flex-1 text-xs">
        <span className="mb-1 block text-muted-foreground">What should it be about?</span>
        <input value={about} onChange={(e) => setAbout(e.target.value)} autoFocus
          placeholder="Sliding windows, graphs, strings — or leave it to Orion"
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs focus:border-cyan-j focus:outline-none" />
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">How hard</span>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {['Easy', 'Medium', 'Hard', 'Expert'].map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block text-muted-foreground">Checked in</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-xs">
          {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={busy}
        className="rounded-md bg-cyan-j px-3 py-1.5 text-xs font-medium text-black transition hover:brightness-110 disabled:opacity-50">
        Write it
      </button>
      <button type="button" onClick={onClose} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
        Cancel
      </button>
      <p className="w-full text-[11px] text-muted-foreground">
        Orion writes the problem and a solution to it, and the solution is checked against the problem's own tests
        before you see it. If the two disagree the problem is thrown away rather than shown. The XP comes from the
        studio's own table, not from Orion.
      </p>
    </form>
  );
}

function diffColor(d) {
  return d === 'Easy' ? 'bg-emerald-500/15 text-emerald-400' :
    d === 'Medium' ? 'bg-amber-500/15 text-amber-400' :
    d === 'Hard' ? 'bg-orange-500/15 text-orange-400' :
    'bg-red-500/15 text-red-400';
}
function diffRank(d) { return { Easy: 0, Medium: 1, Hard: 2, Expert: 3 }[d] ?? 9; }
