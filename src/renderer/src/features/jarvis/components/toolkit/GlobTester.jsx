import { useMemo, useState } from 'react';
import { Code2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, Field, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const SAMPLE_PATTERNS = `src/**/*.{js,jsx}
!**/*.test.jsx
!**/*.stories.jsx
*.md`;

const SAMPLE_PATHS = `src/App.jsx
src/pages/Home.jsx
src/pages/Home.test.jsx
src/components/Button.stories.jsx
README.md
public/logo.png
src/lib/utils/format.js`;

const globToRegex = (glob, caseSensitive) => {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') i++;
        out += '.*';
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') out += '[^/]';
    else if (ch === '[') {
      const close = glob.indexOf(']', i);
      if (close > i) {
        let body = glob.slice(i + 1, close);
        if (body.startsWith('!')) body = `^${body.slice(1)}`;
        out += `[${body}]`;
        i = close;
      } else out += '\\[';
    } else if (ch === '{') {
      const close = glob.indexOf('}', i);
      if (close > i) {
        out += `(${glob.slice(i + 1, close).split(',').map((part) => part.trim()).join('|')})`;
        i = close;
      } else out += '\\{';
    } else if ('\\^$+.()|'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`^${out}$`, caseSensitive ? '' : 'i');
};

export default function GlobTester() {
  const [patterns, setPatterns] = useState(SAMPLE_PATTERNS);
  const [paths, setPaths] = useState(SAMPLE_PATHS);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [basename, setBasename] = useState(false);

  const rules = useMemo(() => patterns.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const negate = line.startsWith('!');
    const body = negate ? line.slice(1) : line;
    try {
      return { source: line, negate, regex: globToRegex(body, caseSensitive) };
    } catch {
      return { source: line, negate, error: true };
    }
  }), [patterns, caseSensitive]);

  const results = useMemo(() => paths.split('\n').map((line) => line.trim()).filter(Boolean).map((path) => {
    const target = basename && !path.includes('/') ? path : path;
    const matches = rules.filter((rule) => !rule.error && rule.regex.test(target));
    const included = matches.filter((r) => !r.negate);
    const excluded = matches.filter((r) => r.negate);
    return { path, matches, included, excluded, pass: included.length > 0 && excluded.length === 0 };
  }), [paths, rules, basename]);

  const passing = results.filter((r) => r.pass);
  const broken = rules.filter((r) => r.error);

  return (
    <ToolShell
      toolId="glob"
      icon={Code2}
      title="Glob Pattern Tester"
      desc="Check which files a glob set really matches — including the negations that always bite in .gitignore files."
      state={{ patterns, paths, caseSensitive, basename }}
      onRestore={(saved) => {
        if (saved.patterns !== undefined) setPatterns(saved.patterns);
        if (saved.paths !== undefined) setPaths(saved.paths);
        setCaseSensitive(saved.caseSensitive ?? true);
        setBasename(!!saved.basename);
      }}
      exportText={passing.map((r) => r.path).join('\n')}
      exportName="matched-files.txt"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Patterns (one per line, ! excludes)">
          <Area value={patterns} onChange={setPatterns} rows={7} mono />
        </Field>
        <Field label="Paths to test (one per line)">
          <Area value={paths} onChange={setPaths} rows={7} mono />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Case sensitive" checked={caseSensitive} onChange={setCaseSensitive} />
        <ToggleRow label="Match the full path only" checked={basename} onChange={setBasename} hint="off = as written" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Patterns" value={String(rules.length)} />
        <Stat label="Paths tested" value={String(results.length)} />
        <Stat label="Matched" value={String(passing.length)} />
      </div>

      {!!broken.length && (
        <Panel className="border-amber-500/40">
          <div className="text-[11px] text-amber-500">These patterns could not be parsed: {broken.map((r) => r.source).join(', ')}</div>
        </Panel>
      )}

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Results</span>
          <CopyBtn value={passing.map((r) => r.path).join('\n')} label="Copy matches" />
        </div>
        <div className="space-y-1">
          {results.map((r) => (
            <div key={r.path} className="rounded-lg border border-border/60 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${r.pass ? 'bg-cyan-j/15 text-cyan-j' : 'bg-muted text-muted-foreground'}`}>
                  {r.pass ? 'KEEP' : 'SKIP'}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono-j text-[11px]">{r.path}</span>
              </div>
              {!!r.matches.length && (
                <div className="mt-1 flex flex-wrap gap-1 pl-1">
                  {r.matches.map((m) => (
                    <span
                      key={m.source}
                      className={`rounded-md px-1.5 py-0.5 font-mono-j text-[10px] ${m.negate ? 'bg-red-500/10 text-red-500' : 'bg-cyan-j/10 text-cyan-j'}`}
                    >
                      {m.source}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="mb-2 text-xs font-medium">How each pattern was read</div>
        <div className="space-y-1">
          {rules.map((r) => (
            <div key={r.source} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5">
              <span className="w-40 shrink-0 truncate font-mono-j text-[11px]">{r.source}</span>
              <span className="min-w-0 flex-1 truncate font-mono-j text-[10px] text-muted-foreground">{r.error ? 'unparsed' : String(r.regex)}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          <span className="font-mono-j">*</span> stops at a slash, <span className="font-mono-j">**</span> crosses them,
          <span className="font-mono-j"> ?</span> is a single character, and braces are alternatives.
          A file is kept when at least one plain pattern matches and no negated pattern does — the same rule git and most build tools use.
        </p>
      </Panel>
    </ToolShell>
  );
}