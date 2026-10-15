import { useMemo, useState } from 'react';
import { Braces } from 'lucide-react';
import { ToolHeader, Area, Field, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const SAMPLE = JSON.stringify({
  team: 'Platform',
  users: [
    { id: 1, name: 'Ada', role: 'admin', contact: { email: 'ada@example.com', city: 'London' } },
    { id: 2, name: 'Grace', role: 'member', contact: { email: 'grace@example.com', city: 'New York' } },
  ],
  meta: { page: 1, total: 2 },
}, null, 2);

const tokenize = (path) => path
  .trim()
  .replace(/^\$\.?/, '')
  .split(/\.|\[/)
  .map((t) => t.replace(/\]$/, '').replace(/^['"]|['"]$/g, '').trim())
  .filter((t) => t !== '');

const run = (data, tokens) => {
  let current = [{ value: data, path: '$' }];
  for (const token of tokens) {
    const next = [];
    current.forEach(({ value, path }) => {
      if (value === null || value === undefined) return;
      if (token === '*') {
        if (Array.isArray(value)) value.forEach((v, i) => next.push({ value: v, path: `${path}[${i}]` }));
        else if (typeof value === 'object') Object.entries(value).forEach(([k, v]) => next.push({ value: v, path: `${path}.${k}` }));
        return;
      }
      if (Array.isArray(value) && /^\d+$/.test(token)) {
        const index = Number(token);
        if (index < value.length) next.push({ value: value[index], path: `${path}[${index}]` });
        return;
      }
      if (typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, token)) {
        next.push({ value: value[token], path: `${path}.${token}` });
      }
    });
    current = next;
    if (!current.length) break;
  }
  return current;
};

const preview = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return JSON.stringify(value);
  return JSON.stringify(value);
};

export default function JsonQuery() {
  const [json, setJson] = useState(SAMPLE);
  const [path, setPath] = useState('users[*].contact.email');

  const result = useMemo(() => {
    let data;
    try { data = JSON.parse(json); } catch (e) { return { error: e.message }; }
    const tokens = tokenize(path);
    const matches = run(data, tokens);
    const keys = new Set();
    matches.forEach(({ value }) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) Object.keys(value).forEach((k) => keys.add(k));
    });
    return { matches, keys: [...keys].slice(0, 14), tokens };
  }, [json, path]);

  const output = useMemo(() => {
    if (result.error || !result.matches) return '';
    return JSON.stringify(result.matches.length === 1 ? result.matches[0].value : result.matches.map((m) => m.value), null, 2);
  }, [result]);

  const suggestions = useMemo(() => {
    if (result.error || !result.tokens?.length) return [];
    const base = result.tokens.join('.');
    return (result.keys || []).map((k) => `${base}.${k}`);
  }, [result]);

  return (
    <ToolShell
      toolId="json-query"
      icon={Braces}
      title="JSON Query Tester"
      desc="Walk into any JSON with dot paths, indexes and wildcards — then copy what you found."
      state={{ json, path }}
      onRestore={(saved) => { setJson(saved.json); setPath(saved.path); }}
      exportText={output}
      exportName="query-result.json"
      exportMime="application/json"
    >
      <Field label="Path" hint="Use . for keys, [0] for an index and [*] to fan out across every item">
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="users[*].name" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {['users[0].name', 'users[*].role', 'meta.page', 'users[*].contact.city', '*'].map((p) => (
          <button key={p} onClick={() => setPath(p)} className="rounded-lg border border-border/70 px-2.5 py-1 font-mono-j text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground">{p}</button>
        ))}
      </div>
      <Area value={json} onChange={setJson} rows={9} mono placeholder="Paste JSON here" />
      {result.error && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">Invalid JSON: {result.error}</div>}
      {!result.error && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Matches" value={String(result.matches.length)} />
            <Stat label="Path steps" value={String(result.tokens.length)} />
            <Stat label="Wildcards" value={String(result.tokens.filter((t) => t === '*').length)} />
          </div>
          {result.matches.length === 0 && <div className="rounded-lg border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground">Nothing matches that path — check the key names or widen it with [*].</div>}
          {result.matches.length > 0 && (
            <Panel>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Matches</div>
              <div className="max-h-80 space-y-1 overflow-auto scrollbar-thin">
                {result.matches.map((m, i) => (
                  <div key={`${m.path}-${i}`} className="flex items-start gap-3 rounded-lg border border-border/60 px-2.5 py-1.5">
                    <span className="w-40 shrink-0 truncate font-mono-j text-[11px] text-cyan-j">{m.path}</span>
                    <span className="min-w-0 flex-1 break-all font-mono-j text-[11px] text-muted-foreground">{preview(m.value)}</span>
                    <CopyBtn value={typeof m.value === 'string' ? m.value : JSON.stringify(m.value)} label="" />
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {suggestions.length > 0 && (
            <Panel>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Go deeper — keys available here</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => setPath(s)} className="rounded-lg border border-border/70 px-2 py-1 font-mono-j text-[11px] transition hover:border-cyan-j/50 hover:text-cyan-j">+ {s.split('.').pop()}</button>
                ))}
              </div>
            </Panel>
          )}
          <Out label="Result" value={output}>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono-j text-xs text-cyan-j scrollbar-thin">{output}</pre>
          </Out>
        </>
      )}
    </ToolShell>
  );
}