import React, { useState, useEffect, useRef } from 'react';
import { getLanguage } from './lib/languages.js';
import { runCode } from './lib/execute.js';
import { runPythonInteractive } from './lib/pyRunner.js';
import { runJsInteractive } from './lib/jsRunner.js';
import CodeEditor from './parts/CodeEditor.jsx';
import Console from './parts/Console.jsx';
import LanguageSelector from './parts/LanguageSelector.jsx';
import { Play, Loader2, Save, FolderOpen, Trash2 } from 'lucide-react';

const SNIPPETS_KEY = 'cs_playground_snippets_v1';

let lineId = 0;
const nextId = () => `l${++lineId}`;

export default function Playground() {
  const [lang, setLang] = useState('python');
  const [code, setCode] = useState('');
  const [stdin, setStdin] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  // Interactive (Pyodide) state — used when lang === 'python'
  const [intLines, setIntLines] = useState([]);
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [pyLoading, setPyLoading] = useState(false);
  const promptResolverRef = useRef(null);

  const [snippets, setSnippets] = useState(() => {
    try { return JSON.parse(localStorage.getItem(SNIPPETS_KEY) || '{}'); } catch { return {}; }
  });
  const [snippetName, setSnippetName] = useState('');

  const language = getLanguage(lang);
  /*
   * CHANGED FROM THEIRS, and deliberately not a setting.
   *
   * Their interactive path ran the code inside this window: Pyodide fetched from a CDN for Python, the code
   * evaluated directly for JavaScript. Both put a program somebody pasted in into the same global scope as
   * `window.api` -- Orbis's bridge to the secrets vault, the file pickers and the browser. It is also the third
   * route Orbis's execution rule says does not exist: a sandbox elsewhere, or a model that reads the code, and
   * nothing on this computer.
   *
   * So every language now goes through the service. What is lost is pausing on `input()` to type a value, which
   * was genuinely nice; the input panel beside the editor takes its place, one value per line. `lib/pyRunner.js`
   * and `lib/jsRunner.js` say the same thing if anything still reaches them.
   */
  const isInteractive = false;
  const isPython = lang === 'python';
  const isJsLike = lang === 'javascript' || lang === 'typescript';

  useEffect(() => {
    const saved = localStorage.getItem('cs_playground_last');
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p.lang) setLang(p.lang);
        if (p.code != null) setCode(p.code);
      } catch { /* ignore */ }
    } else {
      setCode(language?.starter('playground') || '');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('cs_playground_last', JSON.stringify({ lang, code }));
  }, [lang, code]);

  const onLangChange = (newLang) => {
    const prev = getLanguage(lang);
    const next = getLanguage(newLang);
    if (code === (prev?.starter('playground') || '') || code === '') {
      setCode(next?.starter('playground') || '');
    }
    setLang(newLang);
    // Reset console state on language switch
    setResult(null);
    setIntLines([]);
    setPendingPrompt(null);
  };

  const handleRun = async () => {
    if (isInteractive) {
      // Real-time interactive execution (Python via Pyodide, JS/TS native).
      setRunning(true);
      setResult(null);
      setIntLines([]);
      setPendingPrompt(null);

      const handlers = {
        onLoading: setPyLoading,
        onOutput: (text) => setIntLines((prev) => [...prev, { id: nextId(), type: 'output', text }]),
        onPrompt: (prompt) =>
          new Promise((resolve) => {
            const id = nextId();
            setIntLines((prev) => [...prev, { id, type: 'prompt', prompt, answer: null }]);
            setPendingPrompt({ id, prompt });
            promptResolverRef.current = { id, resolve };
          }),
        onError: (text) => setIntLines((prev) => [...prev, { id: nextId(), type: 'error', text }]),
        onDone: () => {
          setRunning(false);
          setPendingPrompt(null);
          promptResolverRef.current = null;
        },
      };

      if (isPython) await runPythonInteractive(code, handlers);
      else await runJsInteractive(code, handlers, lang === 'typescript');
      return;
    }

    // Batch execution via Judge0 (server → fallback to direct CE).
    setRunning(true);
    setResult(null);
    const res = await runCode({ language: lang, sourceCode: code, stdin });
    setResult(res);
    setRunning(false);
  };

  const submitPrompt = (value) => {
    const r = promptResolverRef.current;
    if (!r) return;
    setIntLines((prev) => prev.map((l) => (l.id === r.id ? { ...l, answer: value } : l)));
    setPendingPrompt(null);
    promptResolverRef.current = null;
    r.resolve(value);
  };

  const saveSnippet = () => {
    const name = snippetName.trim() || `snippet ${Object.keys(snippets).length + 1}`;
    const next = { ...snippets, [name]: { lang, code, ts: Date.now() } };
    setSnippets(next);
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(next));
    setSnippetName('');
  };

  const loadSnippet = (name) => {
    const s = snippets[name];
    if (!s) return;
    setLang(s.lang);
    setCode(s.code);
    setResult(null);
    setIntLines([]);
    setPendingPrompt(null);
  };

  const deleteSnippet = (name) => {
    const next = { ...snippets };
    delete next[name];
    setSnippets(next);
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(next));
  };

  const interactiveProps = isInteractive
    ? {
        interactive: {
          lines: intLines,
          pendingPrompt,
          onSubmitPrompt: submitPrompt,
          loading: pyLoading,
          running,
        },
      }
    : {};

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card/50 px-4 py-2.5">
        <h1 className="font-display text-sm font-bold">Playground</h1>
        <LanguageSelector value={lang} onChange={onLangChange} />
        <span className="text-[10px] text-muted-foreground">
          {/*
            * CHANGED FROM THEIRS: every language said "execution unavailable", because their site could not run
            * anything. Here the question is not whether a language is allowed but how it is handled.
            */}
          {language?.canReallyRun ? 'runs in a sandbox, or is read' : 'read by Orion'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <input value={snippetName} onChange={(e) => setSnippetName(e.target.value)} placeholder="snippet name"
            className="w-32 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-cyan-j focus:outline-none" />
          <button onClick={saveSnippet} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-cyan-j/40"><Save className="size-3.5" /> Save</button>
          <button onClick={handleRun} disabled={running}
            className="flex items-center gap-1.5 rounded-md bg-cyan-j px-3 py-1 text-xs font-semibold text-background transition hover:bg-cyan-j/90 disabled:opacity-50">
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex-1 min-h-0">
            <CodeEditor value={code} language={language?.monaco} onChange={setCode} />
          </div>
          <div className="h-72 shrink-0 border-t border-border">
            <Console
              result={result}
              running={running}
              stdin={stdin}
              onStdinChange={setStdin}
              codeUsesInput={/\b(input|scanf|readLine|readline|gets|cin|Scanner|BufferedReader|nextLine|nextInt|readInt|readFloat)\b/.test(code)}
              {...interactiveProps}
            />
          </div>
        </div>
        <aside className="hidden w-52 shrink-0 flex-col border-l border-border bg-card/50 lg:flex">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold text-muted-foreground">Saved Snippets</div>
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {Object.keys(snippets).length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-muted-foreground">No snippets saved.</div>
            ) : Object.entries(snippets).map(([name, s]) => (
              <div key={name} className="group flex items-center gap-1 px-2 py-1.5 hover:bg-accent">
                <button onClick={() => loadSnippet(name)} className="flex flex-1 flex-col text-left min-w-0">
                  <span className="truncate text-xs">{name}</span>
                  <span className="text-[10px] text-muted-foreground">{s.lang}</span>
                </button>
                <button onClick={() => deleteSnippet(name)} className="text-muted-foreground opacity-0 transition hover:text-red-400 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}