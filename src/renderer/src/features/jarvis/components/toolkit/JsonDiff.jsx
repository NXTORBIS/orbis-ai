import { useMemo, useState } from 'react';
import { GitCompare } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills } from './kit/premium';
import { Area, CopyBtn, Panel, Seg, Stat } from './shared';

const LEFT = `{
  "name": "Mark",
  "plan": "pro",
  "seats": 4,
  "features": ["notes", "tasks", "calendar"],
  "billing": { "cycle": "monthly", "amount": 24 },
  "active": true
}`;

const RIGHT = `{
  "name": "Mark 37",
  "plan": "pro",
  "seats": 6,
  "features": ["notes", "tasks", "calendar", "toolkit"],
  "billing": { "cycle": "annual", "amount": 240 },
  "trialEnds": "2026-11-01",
  "active": true
}`;

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
};

const walk = (left, right, path, out) => {
  const leftType = typeOf(left);
  const rightType = typeOf(right);

  if (path && leftType !== rightType) {
    out.push({ path, kind: 'changed', from: left, to: right, note: `${leftType} → ${rightType}` });
    return;
  }

  if (leftType === 'object' && rightType === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    keys.forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in left)) out.push({ path: childPath, kind: 'added', to: right[key] });
      else if (!(key in right)) out.push({ path: childPath, kind: 'removed', from: left[key] });
      else walk(left[key], right[key], childPath, out);
    });
    return;
  }

  if (leftType === 'array' && rightType === 'array') {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}[${index}]`;
      if (index >= left.length) out.push({ path: childPath, kind: 'added', to: right[index] });
      else if (index >= right.length) out.push({ path: childPath, kind: 'removed', from: left[index] });
      else walk(left[index], right[index], childPath, out);
    }
    return;
  }

  if (stable(left) !== stable(right)) {
    out.push({ path: path || '(root)', kind: 'changed', from: left, to: right });
  }
};

const preview = (value) => {
  if (value === undefined) return '—';
  const text = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
  return text === undefined ? String(value) : text.length > 60 ? `${text.slice(0, 57)}…` : text;
};

const KINDS = [
  { value: 'all', label: 'Everything' },
  { value: 'changed', label: 'Changed' },
  { value: 'added', label: 'Added' },
  { value: 'removed', label: 'Removed' },
];

export default function JsonDiff() {
  const [left, setLeft] = useState(LEFT);
  const [right, setRight] = useState(RIGHT);
  const [filter, setFilter] = useState('all');
  const [ignoreOrder, setIgnoreOrder] = useState(false);

  const result = useMemo(() => {
    let a;
    let b;
    try {
      a = JSON.parse(left || 'null');
      b = JSON.parse(right || 'null');
    } catch (err) {
      return { error: `That JSON will not parse: ${err.message}`, changes: [], counts: { added: 0, removed: 0, changed: 0 } };
    }
    const changes = [];
    walk(a, b, '', changes);
    if (ignoreOrder) {
      const seen = new Set();
      const deduped = changes.filter((change) => {
        const key = `${change.path}|${stable(change.from ?? null)}|${stable(change.to ?? null)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const counts = { added: 0, removed: 0, changed: 0 };
      deduped.forEach((change) => { counts[change.kind] += 1; });
      return { error: '', changes: deduped, counts, identical: deduped.length === 0 };
    }
    const counts = { added: 0, removed: 0, changed: 0 };
    changes.forEach((change) => { counts[change.kind] += 1; });
    return { error: '', changes, counts, identical: changes.length === 0 };
  }, [left, right, ignoreOrder]);

  const visible = filter === 'all' ? result.changes : result.changes.filter((change) => change.kind === filter);

  const report = useMemo(() => {
    if (result.error) return result.error;
    if (result.identical) return 'The two documents are identical.';
    return [
      `${result.changes.length} differences · ${result.counts.changed} changed, ${result.counts.added} added, ${result.counts.removed} removed`,
      '',
      ...result.changes.map((change) => {
        if (change.kind === 'added') return `+ ${change.path} = ${preview(change.to)}`;
        if (change.kind === 'removed') return `- ${change.path} (was ${preview(change.from)})`;
        return `~ ${change.path}: ${preview(change.from)} → ${preview(change.to)}${change.note ? ` (${change.note})` : ''}`;
      }),
    ].join('\n');
  }, [result]);

  return (
    <ToolShell
      toolId="json-diff"
      icon={GitCompare}
      title="JSON Diff"
      desc="Compare two JSON documents key by key and see exactly which paths changed, appeared or disappeared — including nested arrays."
      state={{ left, right, filter, ignoreOrder }}
      onRestore={(restored) => {
        if (typeof restored.left === 'string') setLeft(restored.left);
        if (typeof restored.right === 'string') setRight(restored.right);
        if (restored.filter) setFilter(restored.filter);
        if (typeof restored.ignoreOrder === 'boolean') setIgnoreOrder(restored.ignoreOrder);
      }}
      exportText={report}
      exportName="json-diff.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={filter} onChange={setFilter} options={KINDS} />
        <CopyBtn value={report} label="Copy diff" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Area label="Before" value={left} onChange={setLeft} rows={11} mono />
        <Area label="After" value={right} onChange={setRight} rows={11} mono />
      </div>

      {result.error ? (
        <Panel className="border-rose-500/40 text-[11px] text-rose-400">{result.error}</Panel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={result.identical ? 'emerald' : 'amber'}
              label={result.identical ? 'No differences' : 'Differences found'}
              value={result.changes.length}
              sub={result.identical ? 'the two documents match at every path' : `${result.counts.changed} changed · ${result.counts.added} added · ${result.counts.removed} removed`}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">By kind</div>
              <Bars
                data={[
                  { label: 'Changed', value: result.counts.changed },
                  { label: 'Added', value: result.counts.added },
                  { label: 'Removed', value: result.counts.removed },
                ]}
                format={(value) => String(value)}
                highlightLast={false}
              />
            </Panel>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Changed" value={String(result.counts.changed)} mono />
            <Stat label="Added" value={String(result.counts.added)} mono />
            <Stat label="Removed" value={String(result.counts.removed)} mono />
            <Stat label="Showing" value={`${visible.length}`} mono sub={`filter: ${filter}`} />
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Every difference, by path</div>
            <div className="max-h-96 space-y-1 overflow-auto">
              {visible.map((change, index) => (
                <div key={`${change.path}-${index}`} className="rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono-j text-[10px] ${change.kind === 'added' ? 'text-emerald-400' : change.kind === 'removed' ? 'text-rose-400' : 'text-amber-400'}`}>
                      {change.kind === 'added' ? '+' : change.kind === 'removed' ? '−' : '~'}
                    </span>
                    <span className="flex-1 truncate font-mono-j text-[11px] text-cyan-j">{change.path}</span>
                    {change.note && <span className="font-mono-j text-[10px] text-muted-foreground">{change.note}</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono-j text-[10px]">
                    {change.from !== undefined && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-400">{preview(change.from)}</span>}
                    {change.from !== undefined && change.to !== undefined && <span className="text-muted-foreground">→</span>}
                    {change.to !== undefined && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400">{preview(change.to)}</span>}
                  </div>
                </div>
              ))}
              {!visible.length && <span className="text-[11px] text-muted-foreground">Nothing to show for this filter.</span>}
            </div>
          </Panel>
        </>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Reading a diff without fooling yourself</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Type changes matter more than value changes: {result.changes.some((change) => change.note) ? 'at least one value changed type, which breaks comparisons and parsers downstream.' : 'no values changed type here.'}</p>
          <p>· Array indexes shift when an item is inserted, so a single insertion can look like every later element changed. Compare counts before chasing values.</p>
          <p>· Key order is irrelevant in JSON, which is why a document can look different while being equal — this compares structure, not formatting.</p>
          <p>· Null and missing are different things. A field set to <span className="font-mono-j">null</span> will show as changed, not removed, and that distinction usually matters to an API.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Total paths compared', value: result.changes.length + (result.identical ? 0 : 0) },
              { label: 'Filter', value: filter },
              { label: 'Verdict', value: result.identical ? 'identical' : 'different' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Both documents are parsed in the browser and never leave the page, so this is safe for API payloads, config files and exports with real data in
          them. Paste minified JSON straight in — the parser does not care about formatting, which is exactly why the comparison is on structure.
        </p>
      </Panel>
    </ToolShell>
  );
}