import { useState, useMemo, useCallback } from 'react';
import { Icon } from '../../ui/Icon';

type DiffLine = { type: 'same' | 'add' | 'remove'; line: string; lineA?: number; lineB?: number };

function computeLCS(a: string[], b: string[], norm: (s: string) => string = (s) => s): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const na = a.map(norm);
  const nb = b.map(norm);
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = (na[i] === nb[j]) ? (t[(i + 1) * w + j + 1]! + 1) : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      out.push({ type: 'same', line: b[j]!, lineA: i + 1, lineB: j + 1 });
      i++; j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) {
      out.push({ type: 'remove', line: a[i]!, lineA: i + 1 });
      i++;
    } else {
      out.push({ type: 'add', line: b[j]!, lineB: j + 1 });
      j++;
    }
  }
  while (i < n) { out.push({ type: 'remove', line: a[i]!, lineA: i + 1 }); i++; }
  while (j < m) { out.push({ type: 'add', line: b[j]!, lineB: j + 1 }); j++; }
  return out;
}

function toUnified(diff: DiffLine[]): string {
  const lines = ['--- original', '+++ modified'];
  const nA = diff.filter((d) => d.type !== 'add').length;
  const nB = diff.filter((d) => d.type !== 'remove').length;
  lines.push(`@@ -1,${nA} +1,${nB} @@`);
  for (const d of diff) lines.push((d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' ') + d.line);
  return lines.join('\n');
}

export function TextDiffView() {
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [ignoreWs, setIgnoreWs] = useState(false);
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [result, setResult] = useState<DiffLine[] | null>(null);
  const [copied, setCopied] = useState(false);

  const compare = useCallback(() => {
    const norm = (s: string) => {
      let r = s;
      if (ignoreWs) r = r.replace(/\s+/g, ' ').trim();
      if (ignoreCase) r = r.toLowerCase();
      return r;
    };
    const split = (s: string) => (s === '' ? [] : s.replace(/\r\n/g, '\n').split('\n'));
    setResult(computeLCS(split(left), split(right), norm));
  }, [left, right, ignoreWs, ignoreCase]);

  const swap = useCallback(() => {
    setLeft(right);
    setRight(left);
    setResult(null);
  }, [left, right]);

  const clear = useCallback(() => {
    setLeft('');
    setRight('');
    setResult(null);
  }, []);

  const stats = useMemo(() => {
    const s = { add: 0, remove: 0, same: 0 };
    if (result) for (const d of result) s[d.type]++;
    return s;
  }, [result]);

  const copyDiff = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(toUnified(result));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [result]);

  return (
    <div className="tool-view scroll-y text-diff">
      <header className="view-header">
        <h1><Icon name="diff" /> Text Diff</h1>
      </header>

      <div className="text-diff-inputs" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="text-diff-pane">
          <div className="text-diff-pane-header">Original</div>
          <textarea
            className="text-diff-textarea"
            style={{ width: '100%', minHeight: 160, fontFamily: 'monospace', boxSizing: 'border-box' }}
            value={left}
            onChange={(e) => setLeft(e.target.value)}
            spellCheck={false}
            placeholder="Original text"
          />
        </div>
        <div className="text-diff-pane">
          <div className="text-diff-pane-header">Modified</div>
          <textarea
            className="text-diff-textarea"
            style={{ width: '100%', minHeight: 160, fontFamily: 'monospace', boxSizing: 'border-box' }}
            value={right}
            onChange={(e) => setRight(e.target.value)}
            spellCheck={false}
            placeholder="Modified text"
          />
        </div>
      </div>

      <div className="text-diff-toolbar" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
        <button className="btn btn-primary" onClick={compare}><Icon name="compare" /> Compare</button>
        <button className="btn" onClick={swap}><Icon name="swap" /> Swap</button>
        <button className="btn" onClick={clear}><Icon name="x" /> Clear</button>
        <button className="btn" onClick={copyDiff} disabled={!result}>
          <Icon name={copied ? 'check' : 'copy'} /> {copied ? 'Copied' : 'Copy diff'}
        </button>
        <label className="text-diff-toggle">
          <input type="checkbox" checked={ignoreWs} onChange={(e) => setIgnoreWs(e.target.checked)} /> Ignore whitespace
        </label>
        <label className="text-diff-toggle">
          <input type="checkbox" checked={ignoreCase} onChange={(e) => setIgnoreCase(e.target.checked)} /> Ignore case
        </label>
      </div>

      {result && (
        <>
          <div className="text-diff-stats" style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <span className="text-diff-stat add" style={{ color: '#2ea043' }}>+{stats.add} added</span>
            <span className="text-diff-stat remove" style={{ color: '#f85149' }}>-{stats.remove} removed</span>
            <span className="text-diff-stat same">{stats.same} unchanged</span>
          </div>
          <div className="text-diff-output" style={{ fontFamily: 'monospace', fontSize: 12, overflowX: 'auto' }}>
            {result.length === 0 && <div className="text-diff-empty">Nothing to compare.</div>}
            {result.map((d, k) => (
              <div
                key={k}
                className={`text-diff-line ${d.type}`}
                style={{
                  display: 'flex',
                  background: d.type === 'add' ? 'rgba(46,160,67,0.18)' : d.type === 'remove' ? 'rgba(248,81,73,0.18)' : undefined,
                }}
              >
                <span className="text-diff-num" style={{ width: 44, textAlign: 'right', opacity: 0.6, paddingRight: 8, flexShrink: 0 }}>{d.lineA ?? ''}</span>
                <span className="text-diff-num" style={{ width: 44, textAlign: 'right', opacity: 0.6, paddingRight: 8, flexShrink: 0 }}>{d.lineB ?? ''}</span>
                <span className="text-diff-sign" style={{ width: 16, flexShrink: 0 }}>{d.type === 'add' ? '+' : d.type === 'remove' ? '-' : ' '}</span>
                <span className="text-diff-text" style={{ whiteSpace: 'pre' }}>{d.line}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
