import { useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import { Input } from '@jarvis/components/ui/input';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, CopyBtn } from './shared';

const parse = (s) => s.split(/[\s,;]+/).filter(Boolean).map(Number);
const fmt = (n) => (typeof n === 'number' && isFinite(n) ? (Math.abs(n) < 1e-9 ? '0' : n.toFixed(3)) : String(n));

export default function MatrixCalculator() {
  const [a, setA] = useState('1 2 3; 4 5 6; 7 8 10');
  const [b, setB] = useState('1 0 0; 0 1 0; 0 0 1');
  const [op, setOp] = useState('multiply');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const toMat = (s) => { const rows = s.split(';').map((r) => r.trim().split(/[\s,]+/).filter(Boolean).map(Number)); if (rows.some((r) => r.some((v) => isNaN(v)))) throw new Error('Invalid matrix'); return rows; };
  const dims = (m) => `${m.length}×${m[0]?.length || 0}`;

  const matMul = (A, B) => { if (A[0].length !== B.length) throw new Error('Incompatible dimensions'); return A.map((row) => B[0].map((_, j) => row.reduce((s, _, k) => s + row[k] * B[k][j], 0))); };
  const matAdd = (A, B, sign = 1) => { if (A.length !== B.length || A[0].length !== B[0].length) throw new Error('Same dimensions required'); return A.map((r, i) => r.map((v, j) => v + sign * B[i][j])); };
  const transpose = (A) => A[0].map((_, j) => A.map((r) => r[j]));
  const det = (m) => { const n = m.length; if (n !== m[0].length) throw new Error('Square required'); if (n === 1) return m[0][0]; if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0]; let d = 0; for (let j = 0; j < n; j++) { const sub = m.slice(1).map((r) => r.filter((_, c) => c !== j)); d += ((j % 2 ? -1 : 1) * m[0][j] * det(sub)); } return d; };
  const inverse = (m) => { const n = m.length; const D = det(m); if (Math.abs(D) < 1e-12) throw new Error('Not invertible'); const cof = m.map((row, i) => row.map((_, j) => { const sub = m.filter((_, r) => r !== i).map((r) => r.filter((_, c) => c !== j)); return ((i + j) % 2 ? -1 : 1) * (n === 1 ? 1 : det(sub)); })); const adj = transpose(cof); return adj.map((r) => r.map((v) => v / D)); };

  const run = () => {
    setErr(null); setResult(null);
    try {
      const A = toMat(a); let r;
      if (op === 'add') r = matAdd(A, toMat(b));
      else if (op === 'sub') r = matAdd(A, toMat(b), -1);
      else if (op === 'multiply') r = matMul(A, toMat(b));
      else if (op === 'transpose') r = transpose(A);
      else if (op === 'det') { const d = det(A); setResult({ scalar: d, label: 'Determinant' }); return; }
      else if (op === 'inverse') r = inverse(A);
      setResult({ matrix: r });
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Grid3x3} title="Matrix Calculator" desc="Add, subtract, multiply, transpose, determinant and inverse. Enter rows separated by ;." />
      <div className="flex flex-wrap gap-2">
        {['add', 'sub', 'multiply', 'transpose', 'det', 'inverse'].map((o) => <Button key={o} size="sm" variant={op === o ? 'default' : 'outline'} onClick={() => setOp(o)}>{o}</Button>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Matrix A (rows with ;)"><textarea value={a} onChange={(e) => setA(e.target.value)} className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono-j text-sm" /></Field>
        {(op === 'add' || op === 'sub' || op === 'multiply') && <Field label="Matrix B"><textarea value={b} onChange={(e) => setB(e.target.value)} className="h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono-j text-sm" /></Field>}
      </div>
      <Button size="sm" onClick={run}>Compute</Button>
      {err && <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-500">{err}</div>}
      {result && (result.scalar !== undefined ? (
        <div className="flex items-center justify-between rounded-lg border border-cyan-j/40 bg-cyan-j/5 p-3"><span><span className="text-xs text-muted-foreground">{result.label}</span><div className="font-mono-j text-2xl">{fmt(result.scalar)}</div></span><CopyBtn value={fmt(result.scalar)} /></div>
      ) : (
        <div><div className="mb-1 text-xs text-muted-foreground">Result ({result.matrix.length}×{result.matrix[0].length})</div>
          <div className="inline-block rounded-md border border-border/70 bg-card/60 p-2 font-mono-j text-sm">
            {result.matrix.map((r, i) => <div key={i} className="flex gap-3">{r.map((v, j) => <span key={j} className="w-14 text-right">{fmt(v)}</span>)}</div>)}
          </div></div>
      ))}
    </div>
  );
}