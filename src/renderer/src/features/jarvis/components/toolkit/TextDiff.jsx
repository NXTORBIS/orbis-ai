import { useState } from 'react';
import { GitCompare } from 'lucide-react';
import { ToolHeader } from './shared';

function diffLines(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const n = la.length, m = lb.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = la[i] === lb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) { rows.push({ type: 'eq', text: la[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: la[i] }); i++; }
    else { rows.push({ type: 'add', text: lb[j] }); j++; }
  }
  while (i < n) rows.push({ type: 'del', text: la[i++] });
  while (j < m) rows.push({ type: 'add', text: lb[j++] });
  return rows;
}

export default function TextDiff() {
  const [a, setA] = useState('Hello world\nThis is line two\nThird line');
  const [b, setB] = useState('Hello world\nThis is the second line\nThird line\nFourth line');
  const rows = diffLines(a, b);

  return (
    <div className="space-y-4">
      <ToolHeader icon={GitCompare} title="Text Diff Checker" desc="Compare two texts line-by-line. Added, removed and unchanged lines are highlighted." />
      <div className="grid gap-3 md:grid-cols-2">
        <textarea value={a} onChange={(e) => setA(e.target.value)} className="h-40 rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" placeholder="Original text" />
        <textarea value={b} onChange={(e) => setB(e.target.value)} className="h-40 rounded-md border border-input bg-transparent p-3 font-mono-j text-sm" placeholder="Changed text" />
      </div>
      <div className="overflow-auto rounded-md border border-border/70 bg-card/60">
        {rows.map((r, i) => (
          <div key={i} className={`flex gap-2 px-3 py-0.5 font-mono-j text-xs ${r.type === 'add' ? 'bg-green-500/10 text-green-600 dark:text-green-400' : r.type === 'del' ? 'bg-red-500/10 text-red-600 dark:text-red-400' : ''}`}>
            <span className="select-none text-muted-foreground">{r.type === 'add' ? '+' : r.type === 'del' ? '-' : ' '}</span>
            <span className="whitespace-pre-wrap break-all">{r.text || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  );
}