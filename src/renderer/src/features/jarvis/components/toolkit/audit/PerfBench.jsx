import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Zap } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import ToolShell from '../kit/ToolShell';
import { Bars, Hero, Pills } from '../kit/premium';
import { Panel, Seg, Stat } from '../shared';
import { useStoredState } from '../kit/hooks';

const WORDS = 'the quick brown fox jumps over a lazy dog and keeps on running'.split(' ');

// Nominal reference: a mid-range laptop of 2023 running Chromium. The absolute index is an
// approximation, because every engine and machine differs; its real value is comparing two
// devices, or the same device before and after a change.
const REFERENCE = {
  integer: 150e6, float: 40e6, string: 250e3, sort: 25e3, json: 5e3,
  dom: 400e3, canvas: 300e3, crypto: 30e3, memory: 25e3,
};

const TESTS = [
  {
    id: 'integer', label: 'Integer maths', group: 'cpu', start: 2e5,
    run: (n) => { let x = 123456789; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; } return x; },
    note: 'Tight bit-mixing loop — the raw instruction throughput of the engine.',
  },
  {
    id: 'float', label: 'Floating point', group: 'cpu', start: 2e5,
    run: (n) => { let s = 0; for (let i = 0; i < n; i++) { const v = i * 0.00013; s += Math.sqrt(v) + Math.sin(v); } return s; },
    note: 'Square roots and sines — the expensive transcendental path.',
  },
  {
    id: 'string', label: 'String work', group: 'cpu', start: 400,
    run: (n) => { let out = ''; for (let i = 0; i < n; i++) out = WORDS.join(' ').replace(/the/g, 'a').slice(1, 60); return out.length; },
    note: 'Join, regular-expression replace and slice — ordinary text handling.',
  },
  {
    id: 'sort', label: 'Array sorting', group: 'cpu', start: 8,
    run: (n) => { let sum = 0; for (let i = 0; i < n; i++) { const arr = new Array(600); for (let j = 0; j < 600; j++) arr[j] = ((j * 9301 + i * 49297) % 233280) / 233280; arr.sort((a, b) => a - b); sum += arr[599]; } return sum; },
    note: 'Six hundred numbers sorted per pass, the work behind tables and rankings.',
  },
  {
    id: 'json', label: 'JSON round trip', group: 'cpu', start: 4,
    run: (n) => { const data = []; for (let i = 0; i < 200; i++) data.push({ id: i, name: 'item ' + i, active: i % 2 === 0, tags: ['alpha', 'beta', 'gamma'] }); let s = 0; for (let i = 0; i < n; i++) s += JSON.parse(JSON.stringify(data)).length; return s; },
    note: 'Stringify plus parse of a two-hundred record payload — one API response.',
  },
  {
    id: 'dom', label: 'DOM churn', group: 'browser', start: 300,
    run: (n) => { const host = document.createElement('div'); let count = 0; for (let i = 0; i < n; i++) { const el = document.createElement('span'); el.textContent = 'x' + i; host.appendChild(el); host.removeChild(el); count += 1; } return count; },
    note: 'Creating, attaching and removing nodes — the cost of a list that re-renders.',
  },
  {
    id: 'canvas', label: 'Canvas 2D paints', group: 'graphics', start: 300,
    prepare: () => {
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 320;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      return (n) => { for (let i = 0; i < n; i++) { ctx.fillStyle = 'hsl(' + ((i * 7) % 360) + ' 80% 50%)'; ctx.fillRect((i * 13) % 420, (i * 29) % 280, 22, 22); } return n; };
    },
    note: 'Filled rectangles with a colour change each time — real 2D drawing speed.',
  },
  {
    id: 'memory', label: 'Memory bandwidth', group: 'browser', start: 1e3,
    run: (n) => { let s = 0; for (let i = 0; i < n; i++) { const buf = new Float64Array(65536); buf.fill(i); s += buf[0]; } return s; },
    note: 'Allocating and filling a half-megabyte typed array per pass.',
  },
  {
    id: 'crypto', label: 'SHA-256 hashing', group: 'browser', start: 4, async: true,
    run: async (n) => { const buf = new Uint8Array(1024); for (let i = 0; i < n; i++) { buf[0] = i & 255; await crypto.subtle.digest('SHA-256', buf); } return n; },
    note: 'Web Crypto digests of a kilobyte — the cost of hashing files and passwords.',
  },
];

const SUITES = {
  full: 'All nine tests',
  cpu: 'Compute only',
};

function measure(fn, start, targetMs = 260) {
  let n = start;
  let elapsed = 0;
  let rounds = 0;
  while (true) {
    const t0 = performance.now();
    fn(n);
    elapsed = performance.now() - t0;
    rounds += 1;
    if (elapsed >= targetMs || rounds >= 12 || n >= 1e9) break;
    const factor = Math.max(2, Math.min(24, targetMs / Math.max(elapsed, 0.3)));
    n = Math.min(1e9, Math.ceil(n * factor));
  }
  return { n, elapsed, perSec: elapsed > 0 ? (n / elapsed) * 1000 : 0 };
}

async function measureAsync(fn, start, targetMs = 300) {
  let n = start;
  let elapsed = 0;
  let rounds = 0;
  while (true) {
    const t0 = performance.now();
    await fn(n);
    elapsed = performance.now() - t0;
    rounds += 1;
    if (elapsed >= targetMs || rounds >= 8 || n >= 2e5) break;
    const factor = Math.max(2, Math.min(16, targetMs / Math.max(elapsed, 0.5)));
    n = Math.min(2e5, Math.ceil(n * factor));
  }
  return { n, elapsed, perSec: elapsed > 0 ? (n / elapsed) * 1000 : 0 };
}

function readGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'not exposed by this browser';
  } catch {
    return 'unavailable';
  }
}

function compact(n) {
  if (!isFinite(n) || n <= 0) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(1);
}

function perOp(ns) {
  if (!isFinite(ns) || ns <= 0) return '—';
  if (ns < 1000) return ns.toFixed(0) + ' ns';
  if (ns < 1e6) return (ns / 1000).toFixed(1) + ' µs';
  return (ns / 1e6).toFixed(2) + ' ms';
}

const band = (score) => {
  if (score >= 240) return { verdict: 'Very fast', tone: 'violet' };
  if (score >= 140) return { verdict: 'Fast', tone: 'emerald' };
  if (score >= 80) return { verdict: 'Typical', tone: 'cyan' };
  if (score >= 45) return { verdict: 'Modest', tone: 'amber' };
  return { verdict: 'Slow', tone: 'rose' };
};

export default function PerfBench() {
  const [suite, setSuite] = useState('full');
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState('');
  const [done, setDone] = useState(0);
  const [result, setResult] = useState(null);
  const [compare, setCompare] = useState(null);
  const [previous, setPrevious] = useStoredState('tk:perf-bench:last', null);
  const [gpu, setGpu] = useState(null);
  const stopRef = useRef(false);

  useEffect(() => { setGpu(readGpu()); }, []);

  const list = suite === 'full' ? TESTS : TESTS.filter((t) => t.group === 'cpu');

  const start = async () => {
    stopRef.current = false;
    setCompare(previous);
    setResult(null);
    setRunning(true);
    setDone(0);
    const rows = [];
    const prepared = list.map((t) => ({ ...t, fn: t.prepare ? t.prepare() : t.run })).filter((t) => typeof t.fn === 'function');
    for (let i = 0; i < prepared.length; i++) {
      const test = prepared[i];
      if (stopRef.current) break;
      setStage(test.label);
      setDone(i);
      // Let the label paint before a long synchronous test blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 32));
      const measured = test.async ? await measureAsync(test.fn, test.start) : measure(test.fn, test.start);
      rows.push({
        id: test.id,
        label: test.label,
        note: test.note,
        perSec: measured.perSec,
        ops: measured.n,
        ms: measured.elapsed,
        index: measured.perSec / (REFERENCE[test.id] || 1),
      });
    }
    setStage('');
    setDone(prepared.length);
    setRunning(false);
    if (stopRef.current || !rows.length) return;
    const clamped = rows.map((r) => Math.min(8, Math.max(0.05, r.index)));
    const score = Math.round(Math.exp(clamped.reduce((a, b) => a + Math.log(b), 0) / clamped.length) * 100);
    const finished = {
      score,
      rows,
      cores: navigator.hardwareConcurrency || null,
      memory: navigator.deviceMemory || null,
      gpu,
      at: Date.now(),
    };
    setResult(finished);
    setPrevious(finished);
  };

  const report = result
    ? [
      'Benchmark index ' + result.score + ' (' + band(result.score).verdict + ')',
      'Logical cores ' + (result.cores || 'not exposed') + ' · device memory ' + (result.memory ? result.memory + ' GB' : 'not exposed'),
      'Renderer ' + (result.gpu || 'unknown'),
      '',
      ...result.rows.map((r) => r.label + ': ' + compact(r.perSec) + ' ops/s · ' + perOp(1e9 / r.perSec) + ' per op · index ' + r.index.toFixed(2)),
      '',
      'Index 100 is the nominal reference machine. Compare runs on the same device, or two devices side by side.',
    ].join('\n')
    : '';

  return (
    <ToolShell
      toolId="perf-bench"
      icon={Zap}
      title="Performance Benchmark"
      desc="Nine real workloads — integer, float, strings, sorting, JSON, DOM, canvas, memory and hashing — scored against a nominal reference, with the previous run on this device kept for comparison."
      state={{ suite }}
      onRestore={(restored) => { if (restored.suite) setSuite(restored.suite); }}
      exportText={report}
      exportName="performance-benchmark.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={start} disabled={running} className="gap-1.5">
          {running ? <RotateCcw className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          {running ? 'Measuring ' + stage + '…' : result ? 'Run again' : 'Run the benchmark'}
        </Button>
        {running && (
          <Button size="sm" variant="outline" onClick={() => { stopRef.current = true; }}>Stop</Button>
        )}
        <Seg value={suite} onChange={setSuite} options={[{ value: 'full', label: SUITES.full }, { value: 'cpu', label: SUITES.cpu }]} />
        <span className="text-[11px] text-muted-foreground">A few seconds, on this device only. Nothing is uploaded.</span>
      </div>

      {running && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-j to-violet-400 transition-all" style={{ width: (done / Math.max(1, list.length)) * 100 + '%' }} />
        </div>
      )}

      {!result && !running && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">What gets measured</div>
          <div className="space-y-1.5">
            {list.map((test) => (
              <div key={test.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 pb-1.5 text-[11px] last:border-0">
                <span className="text-cyan-j">{test.label}</span>
                <span className="text-muted-foreground">{test.note}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
            <Hero
              label="Benchmark index"
              value={result.score}
              sub={band(result.score).verdict + ' · 100 is the nominal reference machine'}
              tone={band(result.score).tone}
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Logical cores" value={result.cores ? String(result.cores) : 'not exposed'} mono />
              <Stat label="Device memory" value={result.memory ? result.memory + ' GB' : 'not exposed'} mono />
              <Stat label="Slowest index" value={Math.min(...result.rows.map((r) => r.index)).toFixed(2) + '×'} mono sub={result.rows.reduce((a, b) => (a.index < b.index ? a : b)).label} />
              <Stat label="Fastest index" value={Math.max(...result.rows.map((r) => r.index)).toFixed(2) + '×'} mono sub={result.rows.reduce((a, b) => (a.index > b.index ? a : b)).label} />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Each test against the reference</div>
            <Bars
              data={result.rows.map((row) => ({ label: row.label.split(' ')[0], value: Number(row.index.toFixed(2)) }))}
              format={(value) => value.toFixed(2) + '×'}
              suffix=""
            />
            <p className="mt-2 text-[11px] text-muted-foreground">
              A bar above 1.00 means faster than the reference in that specific job. The gaps matter more than the height: a machine can be quick at integer work and
              slow at canvas painting, which is exactly what tells you where an app will feel sluggish.
            </p>
          </Panel>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Raw numbers</div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] text-left font-mono-j text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/60">
                    <th className="py-1.5 font-normal">Test</th>
                    <th className="py-1.5 text-right font-normal">Throughput</th>
                    <th className="py-1.5 text-right font-normal">Per operation</th>
                    <th className="py-1.5 text-right font-normal">Index</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 last:border-0">
                      <td className="py-1.5 pr-3">{row.label}</td>
                      <td className="py-1.5 text-right">{compact(row.perSec)} ops/s</td>
                      <td className="py-1.5 text-right text-muted-foreground">{perOp(1e9 / row.perSec)}</td>
                      <td className="py-1.5 text-right text-cyan-j">{row.index.toFixed(2)}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {compare && compare.rows && (
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">Against the previous run on this device</div>
              <div className="space-y-1.5 font-mono-j text-[11px]">
                <div className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Index then → now</span>
                  <span>{compare.score} → {result.score} <span className={result.score >= compare.score ? 'text-emerald-400' : 'text-rose-400'}>({result.score >= compare.score ? '+' : ''}{result.score - compare.score})</span></span>
                </div>
                {result.rows.map((row) => {
                  const before = compare.rows.find((r) => r.id === row.id);
                  if (!before) return null;
                  const delta = ((row.perSec - before.perSec) / before.perSec) * 100;
                  return (
                    <div key={row.id} className="flex justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className={delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Anything beyond a few percent between runs on the same device is noise or thermal throttling, not a real change. Run it twice before believing a difference.
              </p>
            </Panel>
          )}

          <div className="grid gap-2 sm:grid-cols-4">
            <Pills items={[{ label: 'Renderer', value: (gpu || '').slice(0, 40) || 'unknown' }]} />
          </div>

          <Panel>
            <p className="text-[11px] text-muted-foreground">
              The index is a geometric mean of the nine ratios, so no single test can carry it. It is calibrated against a nominal mid-range machine, not against a
              measured population, so treat the absolute number as approximate and the relative comparison as the real signal. Background tabs, thermal throttling,
              battery saver modes and a browser update can all move these numbers.
            </p>
          </Panel>
        </>
      )}
    </ToolShell>
  );
}