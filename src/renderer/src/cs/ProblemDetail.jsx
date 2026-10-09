import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from './ui/router.jsx';
import { Panel, PanelGroup, PanelResizeHandle } from './ui/panels.jsx';
// CHANGED FROM THEIRS: the library, which is their sixteen plus whatever Orion has written since.
import { getProblem, DIFFICULTY_XP } from './lib/library.js';
import { getLanguage, problemStarter } from './lib/languages.js';
import { useCSProgress } from './lib/useCSProgress.js';
import { useXp } from './lib/XpContext.jsx';
import { runCode, submitProblem } from './lib/execute.js';
import CodeEditor from './parts/CodeEditor.jsx';
import Console from './parts/Console.jsx';
import LanguageSelector from './parts/LanguageSelector.jsx';
import { Play, Send, Bookmark, BookmarkCheck, Lightbulb, ChevronLeft, Loader2, Eye, StickyNote } from 'lucide-react';

export default function ProblemDetail() {
  const { slug } = useParams();
  const problem = getProblem(slug);
  const { progress, toggleBookmark, setNote, recordHint: recordHintUsed, revealSolution, recordSubmission, problemStatus } = useCSProgress();
  const xp = useXp();

  const [lang, setLang] = useState('python');
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [hintsShown, setHintsShown] = useState(0);
  const [showSolution, setShowSolution] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  const storageKey = `cs_code_${slug}`;

  // Load saved code for this problem + language.
  useEffect(() => {
    if (!problem) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      setCode(saved[lang] ?? problem.starter[lang] ?? problem.starter.python ?? '');
    } catch {
      setCode(problem.starter[lang] ?? problem.starter.python ?? '');
    }
    setResult(null);
  }, [slug, lang, problem]);

  // Persist code.
  useEffect(() => {
    if (!problem || !code) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      saved[lang] = code;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch { /* ignore */ }
  }, [code, lang, slug, problem]);

  if (!problem) {
    return <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-sm text-muted-foreground">Problem not found.</p>
      <Link to="/cs/problems" className="text-xs text-cyan-j">← Back to problems</Link>
    </div>;
  }

  const language = getLanguage(lang);
  const bookmarked = progress.bookmarked.includes(problem.id);
  const status = problemStatus(problem.id);
  const note = progress.notes[problem.id] || '';

  const handleRun = async () => {
    setRunning(true); setResult(null);
    const res = await runCode({ language: lang, sourceCode: code, stdin });
    setResult(res); setRunning(false);
  };

  const handleSubmit = async () => {
    setRunning(true); setResult(null);
    const res = await submitProblem({ problemId: problem.id, language: lang, sourceCode: code });
    recordSubmission({
      id: `${problem.id}-${Date.now()}`, problemId: problem.id, problemTitle: problem.title,
      language: language?.label || lang, verdict: res.verdict, passed: res.passed, total: res.total,
      runtime: res.runtime, memory: res.memory, source: code, timestamp: new Date().toISOString(),
    });
    if (res.verdict === 'Accepted' && !progress.solved.includes(problem.id)) {
      // Award via the global Jarvis XP system (no separate CS XP). Fails gracefully
      // while workspace credits are exhausted — local progress still records the solve.
      xp.award({
        source: 'challenge', activity_type: 'problem_solved', ref_id: problem.id,
        description: `Solved ${problem.title}`, difficulty: problem.difficulty.toLowerCase(),
        metadata: { problem_id: problem.id, language: lang, xp: problem.xp },
      }).catch(() => {});
    }
    setResult(res); setRunning(false);
  };

  const revealHint = () => {
    if (hintsShown < problem.hints.length) {
      setHintsShown(hintsShown + 1);
      recordHintUsed(problem.id);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-card/50 px-4 py-2.5">
        <Link to="/cs/problems" className="text-muted-foreground transition hover:text-foreground"><ChevronLeft className="size-4" /></Link>
        <span className="font-mono-j text-xs text-muted-foreground">#{problem.id}</span>
        <h1 className="flex-1 truncate font-display text-sm font-bold">{problem.title}</h1>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${diffColor(problem.difficulty)}`}>{problem.difficulty}</span>
        <span className="text-[11px] text-muted-foreground">+{problem.xp} XP</span>
        {status === 'Solved' && <span className="text-[10px] font-medium text-emerald-400">✓ Solved</span>}
        <button onClick={() => toggleBookmark(problem.id)} className="text-muted-foreground transition hover:text-cyan-j">
          {bookmarked ? <BookmarkCheck className="size-4 text-cyan-j" /> : <Bookmark className="size-4" />}
        </button>
      </div>

      {/* Body: resizable 3-panel */}
      <div className="flex-1 min-h-0">
        <PanelGroup direction="horizontal">
          {/* Left: problem statement */}
          <Panel defaultSize={38} minSize={25} className="overflow-y-auto scrollbar-thin">
            <div className="p-4 text-sm">
              <p className="whitespace-pre-wrap text-foreground/90">{problem.description}</p>

              <div className="mt-4 space-y-3">
                {problem.examples.map((ex, i) => (
                  <div key={i} className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Example {i + 1}</div>
                    <div className="font-mono-j text-xs"><span className="text-muted-foreground">Input: </span>{ex.input}</div>
                    <div className="font-mono-j text-xs"><span className="text-muted-foreground">Output: </span>{ex.output}</div>
                    {ex.explanation && <div className="mt-1 text-xs text-muted-foreground">{ex.explanation}</div>}
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Constraints</div>
                <ul className="list-inside list-disc space-y-0.5 text-xs text-foreground/80">
                  {problem.constraints.map((c, i) => <li key={i} className="font-mono-j">{c}</li>)}
                </ul>
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {problem.topics.map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>)}
              </div>

              {/* Hints */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">Hints</span>
                  {hintsShown < problem.hints.length && (
                    <button onClick={revealHint} className="flex items-center gap-1 text-[11px] text-cyan-j hover:underline">
                      <Lightbulb className="size-3" /> Reveal hint ({hintsShown}/{problem.hints.length})
                    </button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {problem.hints.slice(0, hintsShown).map((h, i) => (
                    <div key={i} className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200/90">
                      <span className="font-semibold">Hint {i + 1}:</span> {h}
                    </div>
                  ))}
                </div>
              </div>

              {/* Solution */}
              <div className="mt-4">
                {!showSolution ? (
                  <button onClick={() => { setShowSolution(true); revealSolution(problem.id); }}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/40 hover:text-cyan-j">
                    <Eye className="size-3.5" /> View Solution
                  </button>
                ) : (
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Approach</div>
                    <p className="text-xs text-foreground/80">{problem.hints.join(' ')}</p>
                    <div className="mt-2 flex gap-4 text-xs">
                      <span><span className="text-muted-foreground">Time:</span> <span className="font-mono-j">{problem.complexity.time}</span></span>
                      <span><span className="text-muted-foreground">Space:</span> <span className="font-mono-j">{problem.complexity.space}</span></span>
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <button onClick={() => setShowNotes((v) => !v)} className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-cyan-j">
                <StickyNote className="size-3.5" /> {showNotes ? 'Hide notes' : 'My notes'}
              </button>
              {showNotes && (
                <textarea value={note} onChange={(e) => setNote(problem.id, e.target.value)} placeholder="Write your notes here… (auto-saved)"
                  className="mt-1.5 h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs focus:border-cyan-j focus:outline-none" />
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-border hover:bg-cyan-j/40" />

          {/* Right: editor + console (vertical split) */}
          <Panel minSize={30}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={65} minSize={20} className="flex flex-col">
                <div className="flex items-center gap-2 border-b border-border bg-card/50 px-3 py-1.5">
                  <LanguageSelector value={lang} onChange={setLang} />
                  {/* CHANGED FROM THEIRS: see the note in Playground.jsx. */}
              <span className="text-[10px] text-muted-foreground">
                {language?.canReallyRun ? 'runs in a sandbox, or is read' : 'read by Orion'}
              </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={handleRun} disabled={running}
                      className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium transition hover:border-cyan-j/40 disabled:opacity-50">
                      {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run
                    </button>
                    <button onClick={handleSubmit} disabled={running}
                      className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1.5 text-xs font-semibold text-background transition hover:bg-cyan-j/90 disabled:opacity-50">
                      {running ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Submit
                    </button>
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  <CodeEditor value={code} language={language?.monaco} onChange={setCode} />
                </div>
              </Panel>

              <PanelResizeHandle className="h-px bg-border hover:bg-cyan-j/40" />

              <Panel defaultSize={35} minSize={15} className="flex flex-col">
                <div className="flex items-center gap-2 border-b border-border bg-card/50 px-3 py-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">Console</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">Custom stdin (optional)</span>
                </div>
                <div className="flex flex-1 min-h-0 flex-col">
                  <textarea value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="stdin…"
                    className="h-16 shrink-0 resize-none border-b border-border bg-background p-2 font-mono-j text-xs focus:outline-none" />
                  <div className="flex-1 min-h-0">
                    <Console result={result} running={running} />
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
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