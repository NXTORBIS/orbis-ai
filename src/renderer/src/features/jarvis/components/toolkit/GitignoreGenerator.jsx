import { useMemo, useState } from 'react';
import { FileCode } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, downloadBlob } from './shared';

const GROUPS = [
  { id: 'node', label: 'Node', lines: ['node_modules/', 'npm-debug.log*', 'yarn-error.log*', 'pnpm-debug.log*', '.npm/', '.yarn/cache', '.pnp.*', 'coverage/', 'dist/', 'build/'] },
  { id: 'env', label: 'Secrets & env', lines: ['.env', '.env.*', '!.env.example', '*.pem', '*.key', '*.p12', 'secrets.json', '.dev.vars'] },
  { id: 'python', label: 'Python', lines: ['__pycache__/', '*.py[cod]', '.venv/', 'venv/', 'env/', '*.egg-info/', '.pytest_cache/', '.mypy_cache/', '.ruff_cache/'] },
  { id: 'java', label: 'Java / Kotlin', lines: ['target/', '*.class', '*.jar', '!gradle/wrapper/gradle-wrapper.jar', '.gradle/', 'build/'] },
  { id: 'go', label: 'Go', lines: ['bin/', '*.test', '*.out', 'vendor/'] },
  { id: 'rust', label: 'Rust', lines: ['target/', '**/*.rs.bk', 'Cargo.lock'] },
  { id: 'php', label: 'PHP / Laravel', lines: ['vendor/', 'storage/*.key', 'public/storage', '.phpunit.result.cache'] },
  { id: 'ruby', label: 'Ruby / Rails', lines: ['.bundle/', 'log/', 'tmp/', 'storage/', 'vendor/bundle'] },
  { id: 'mobile', label: 'iOS / Android / Flutter', lines: ['Pods/', '*.xcworkspace/xcuserdata/', 'DerivedData/', '.gradle/', 'local.properties', '.dart_tool/', 'build/'] },
  { id: 'framework', label: 'Front-end builds', lines: ['.next/', '.nuxt/', '.svelte-kit/', '.vite/', '.turbo/', 'out/', '.parcel-cache/'] },
  { id: 'docs', label: 'Docs & tooling', lines: ['_site/', '.jekyll-cache/', '.cache/', 'public/build/', '.hugo_build.lock'] },
  { id: 'os', label: 'Operating systems', lines: ['.DS_Store', '._*', 'Thumbs.db', 'ehthumbs.db', 'Desktop.ini', '$RECYCLE.BIN/'] },
  { id: 'editors', label: 'Editors & IDEs', lines: ['.vscode/*', '!.vscode/extensions.json', '.idea/', '*.iml', '*.swp', '*.swo', '*~'] },
  { id: 'logs', label: 'Logs & temp', lines: ['*.log', 'logs/', 'tmp/', 'temp/', '*.tmp', '.eslintcache', '.stylelintcache'] },
  { id: 'db', label: 'Databases & dumps', lines: ['*.sqlite', '*.sqlite3', '*.db', 'dump.sql', '*.dump'] },
];

const HEADER = `# ---------------------------------------------------------------
# .gitignore — generated with Mark32 Toolkit
# Patterns are relative to this file. A leading ! re-includes.
# ---------------------------------------------------------------`;

export default function GitignoreGenerator() {
  const [selected, setSelected] = useState(['node', 'env', 'os', 'editors', 'logs']);
  const [extra, setExtra] = useState('');

  const lines = useMemo(() => {
    const chosen = GROUPS.filter((group) => selected.includes(group.id));
    const unique = new Set();
    chosen.forEach((group) => group.lines.forEach((line) => unique.add(line)));
    String(extra).split('\n').map((line) => line.trim()).filter(Boolean).forEach((line) => unique.add(line));
    return [...unique];
  }, [selected, extra]);

  const output = `${HEADER}\n\n${lines.join('\n')}\n`;

  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  return (
    <ToolShell
      toolId="gitignore"
      icon={FileCode}
      title=".gitignore Generator"
      desc="Pick your stacks and editors, and get a .gitignore that covers the noise — dependencies, builds, secrets, OS clutter and IDE state."
      state={{ selected, extra }}
      onRestore={(restored) => {
        if (Array.isArray(restored.selected)) setSelected(restored.selected);
        if (typeof restored.extra === 'string') setExtra(restored.extra);
      }}
      exportText={output}
      exportName=".gitignore"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([output], { type: 'text/plain' }), '.gitignore')}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          Download .gitignore
        </button>
        <CopyBtn value={output} label="Copy file" />
        <button
          type="button"
          onClick={() => setSelected(GROUPS.map((g) => g.id))}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
        >
          Select everything
        </button>
        <button
          type="button"
          onClick={() => setSelected([])}
          className="text-[11px] text-muted-foreground transition hover:text-red-500"
        >
          Clear
        </button>
      </div>

      <Field label="Your stacks and environments">
        <div className="flex flex-wrap gap-1.5">
          {GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => toggle(group.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                selected.includes(group.id) ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/30'
              }`}
            >
              {group.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Anything else to ignore" hint="One pattern per line">
        <textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={3}
          placeholder="media/large-videos/\n*.psd"
          className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 font-mono-j text-xs"
        />
      </Field>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">.gitignore</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{lines.length} patterns</span>
        </div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[11px] text-cyan-j">{output}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Groups chosen" value={String(selected.length)} mono />
        <Stat label="Patterns" value={String(lines.length)} mono />
        <Stat label="File size" value={`${output.length} bytes`} mono />
      </div>

      <Panel className="border-amber-500/30">
        <p className="text-[11px] text-amber-500">
          Secrets first: if a key or .env file has ever been committed, add the pattern here and rotate the credential — ignoring it now does not
          remove it from history, and a rewrite of published history is a separate job.
        </p>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Order matters in this file — a later <span className="font-mono-j">!</span> line can re-include something an earlier pattern excluded,
          which is why patterns like <span className="font-mono-j">!.env.example</span> sit after{' '}
          <span className="font-mono-j">.env.*</span>. Commit the example file so the next person knows which variables to set.
        </p>
      </Panel>
    </ToolShell>
  );
}