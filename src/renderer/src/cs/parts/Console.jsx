import React, { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Clock, Cpu, Loader2, Ban,
  Terminal, AlertCircle, CornerDownLeft,
} from 'lucide-react';

const VERDICT_META = {
  Accepted: { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  'Wrong Answer': { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  'Compilation Error': { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  'Runtime Error': { icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  'Time Limit Exceeded': { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  'Memory Limit Exceeded': { icon: Cpu, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  'Execution Error': { icon: Ban, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  Unattempted: { icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted/10', border: 'border-border' },
};

// Interactive (Pyodide) console: streaming output + live input prompts.
function InteractiveConsole({ lines, pendingPrompt, onSubmitPrompt, loading, running }) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, pendingPrompt]);

  useEffect(() => {
    if (pendingPrompt && inputRef.current) inputRef.current.focus();
  }, [pendingPrompt]);

  const submit = () => {
    if (!pendingPrompt) return;
    onSubmitPrompt(draft);
    setDraft('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-3 scrollbar-thin">
        {lines.length === 0 && !loading && !running && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Console ready. Run your code to start.
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-cyan-j">
            <Loader2 className="size-4 animate-spin" /> Loading Python runtime (first run only)…
          </div>
        )}
        <div className="space-y-0.5">
          {lines.map((l) => (
            <Line key={l.id} line={l} />
          ))}
        </div>
        {pendingPrompt && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="font-mono-j text-xs text-foreground/90">{pendingPrompt.prompt}</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="type and press Enter…"
              className="flex-1 border-b border-cyan-j/60 bg-transparent font-mono-j text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            />
            <button
              onClick={submit}
              disabled={draft.length === 0}
              className="flex items-center gap-1 rounded bg-cyan-j px-2 py-0.5 text-[10px] font-semibold text-background transition hover:bg-cyan-j/90 disabled:opacity-40"
            >
              <CornerDownLeft className="size-3" /> Send
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ line }) {
  if (line.type === 'output') {
    return <pre className="whitespace-pre-wrap font-mono-j text-xs text-foreground/90">{line.text}</pre>;
  }
  if (line.type === 'prompt') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="font-mono-j text-xs text-foreground/90">{line.prompt}</span>
        <span className="font-mono-j text-xs text-cyan-j">{line.answer}</span>
      </div>
    );
  }
  if (line.type === 'error') {
    return <pre className="whitespace-pre-wrap font-mono-j text-xs text-red-400/90">{line.text}</pre>;
  }
  return null;
}

// Batch (Judge0) console: result + stdin box.
function BatchConsole({ result, running, stdin, onStdinChange, codeUsesInput }) {
  const meta = result ? (VERDICT_META[result.verdict] || VERDICT_META['Execution Error']) : null;
  const Icon = meta?.icon;
  const stdinEmpty = !stdin || !stdin.trim();
  const showInputHint = codeUsesInput && stdinEmpty && !running;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-3 text-xs scrollbar-thin">
        {running ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="size-5 animate-spin text-cyan-j" />
            <span>Executing…</span>
          </div>
        ) : !result ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Console ready. Run your code to see output.</span>
            {showInputHint && (
              <span className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-400">
                <AlertCircle className="size-3.5" /> Your code reads input — type it in the box below before hitting Run
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className={`flex items-center gap-2 rounded-md border ${meta.border} ${meta.bg} px-2.5 py-1.5`}>
              <Icon className={`size-4 ${meta.color}`} />
              <span className={`font-semibold ${meta.color}`}>{result.verdict}</span>
              {result.message && <span className="ml-auto text-muted-foreground">{result.message}</span>}
            </div>
            {result.passed != null && result.total != null && (
              <div className="text-muted-foreground">
                Test cases: <span className="font-mono-j text-foreground">{result.passed} / {result.total}</span>
              </div>
            )}
            {result.stdout != null && result.stdout !== '' && (
              <Section label="OUTPUT"><pre className="whitespace-pre-wrap font-mono-j text-foreground/90">{result.stdout}</pre></Section>
            )}
            {result.compileOutput && (
              <Section label="COMPILATION OUTPUT"><pre className="whitespace-pre-wrap font-mono-j text-amber-400/90">{result.compileOutput}</pre></Section>
            )}
            {result.stderr && (
              <Section label="STDERR"><pre className="whitespace-pre-wrap font-mono-j text-red-400/90">{result.stderr}</pre></Section>
            )}
            <div className="mt-2 flex flex-wrap gap-4 border-t border-border pt-2 text-muted-foreground">
              {result.origin === 'ran' && (result.runtime != null || result.memory != null) && (
                <span className="text-emerald-400/90">Compiled and run in a sandbox.</span>
              )}
              {result.runtime != null && <span>Runtime: <span className="font-mono-j text-foreground">{result.runtime} ms</span></span>}
              {result.memory != null && <span>Memory: <span className="font-mono-j text-foreground">{result.memory} MB</span></span>}
              {result.exitCode != null && <span>Exit: <span className="font-mono-j text-foreground">{result.exitCode}</span></span>}
              {/*
                * Where the answer came from, which is the most important line here.
                *
                * A reading has no running time because nothing ran -- so rather than reporting the figures as
                * unavailable, as though something had failed, it says what actually happened. CHANGED FROM
                * THEIRS, whose site could only ever read.
                */}
              {result.runtime == null && result.memory == null && (
                <span className={result.origin === 'predicted' ? 'italic text-amber-400/90' : 'italic'}>
                  {result.origin === 'predicted'
                    ? 'Orion read your code and said what it would print. Nothing ran, so there is no running time.'
                    : result.origin === 'ran'
                      ? 'Ran in a sandbox. It reported no timing figures.'
                      : 'No timing figures for this run.'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col border-t border-border">
        <div className="flex items-center gap-2 bg-muted/30 px-3 py-1">
          <Terminal className="size-3.5 text-cyan-j" />
          <span className="text-[10px] font-semibold tracking-wider text-muted-foreground">
            STDIN — type input here, one value per line, then hit Run
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {stdinEmpty ? 'empty' : `${stdin.split('\n').filter(Boolean).length} line(s)`}
          </span>
        </div>
        <textarea
          value={stdin}
          onChange={(e) => onStdinChange(e.target.value)}
          placeholder={"e.g.  42\nhello\n→ first input() gets '42', second gets 'hello'"}
          spellCheck={false}
          rows={3}
          className="resize-none bg-background px-3 py-2 font-mono-j text-xs text-foreground outline-none placeholder:text-muted-foreground/50 scrollbar-thin"
        />
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted-foreground">{label}</div>
      <div className="rounded-md border border-border bg-muted/30 p-2">{children}</div>
    </div>
  );
}

export default function Console(props) {
  // Interactive mode (Python via Pyodide) takes priority when provided.
  if (props.interactive) {
    return <InteractiveConsole {...props.interactive} />;
  }
  return <BatchConsole {...props} />;
}