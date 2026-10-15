import { useRef, useState } from 'react';
import { Activity, Play, Square } from 'lucide-react';
import { Bars, Hero, Pills } from '../kit/premium';
import { Field, Panel, Seg, Stat } from '../shared';
import { bars, hostOf, stats, urlOf } from './netUtils';

const COUNTS = [
  { value: 10, label: '10 requests' },
  { value: 25, label: '25 requests' },
  { value: 50, label: '50 requests' },
];

export default function BenchPanel({ target, onReport }) {
  const [method, setMethod] = useState('GET');
  const [count, setCount] = useState(10);
  const [running, setRunning] = useState(false);
  const [latencies, setLatencies] = useState([]);
  const [bytes, setBytes] = useState(0);
  const [cold, setCold] = useState(null);
  const [failures, setFailures] = useState([]);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const url = urlOf(target);
  const timed = stats(latencies);
  const total = latencies.reduce((a, b) => a + b, 0);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const run = async () => {
    setRunning(true);
    setError('');
    setLatencies([]);
    setFailures([]);
    setBytes(0);
    setCold(null);
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    const samples = [];
    const problems = [];
    let transferred = 0;

    const once = async () => {
      const started = performance.now();
      const res = await fetch(url, { method, cache: 'no-store', signal });
      const ttfb = performance.now() - started;
      let size = Number(res.headers.get('content-length') || 0);
      if (method === 'GET') {
        const body = await res.arrayBuffer();
        size = size || body.byteLength;
      }
      const done = performance.now() - started;
      return { ttfb, done, size, status: res.status };
    };

    try {
      const first = await once();
      setCold({ ttfb: first.ttfb, done: first.done });
      transferred += first.size;

      for (let i = 0; i < count; i += 1) {
        if (signal.aborted) break;
        try {
          const result = await once();
          samples.push(result.ttfb);
          transferred += result.size;
        } catch (err) {
          if (err.name === 'AbortError') break;
          problems.push(err.message);
        }
        setLatencies([...samples]);
        setBytes(transferred);
        setFailures([...problems]);
      }

      if (!samples.length) {
        setError('No request completed. Either the address is wrong, or the server does not allow browser origins — check it in the Headers tab, which asks our server to read it instead.');
      } else {
        const final = stats(samples);
        onReport?.(
          `${method} ${url}\n${samples.length} of ${count} completed · p50 ${Math.round(final.median)} ms · p95 ${Math.round(final.p95)} ms · min ${Math.round(final.min)} · max ${Math.round(final.max)}\nThroughput ${(transferred * 8 / (total / 1000) / 1e6).toFixed(2)} Mbps across ${(transferred / 1024).toFixed(1)} KB`,
        );
      }
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Stopped.' : `${err.message}. This is usually CORS rather than a broken endpoint.`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="URL to repeat">
          <input
            value={url}
            readOnly
            className="h-9 w-72 cursor-default rounded-md border border-input bg-transparent px-3 font-mono-j text-xs text-muted-foreground"
          />
        </Field>
        <Field label="Method">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 font-mono-j text-xs">
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
          </select>
        </Field>
        <Field label="">
          <Seg value={count} onChange={(v) => setCount(Number(v))} options={COUNTS} />
        </Field>
        {running ? (
          <button type="button" onClick={stop} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 text-xs text-rose-400">
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={!hostOf(target)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" /> Run bench
          </button>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        The first request is measured separately: it carries DNS, TCP and TLS setup, and it is usually ten times slower than the ones after it.
        The rest are run one after another on the warm connection, which is what an API client actually sees.
      </p>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {!!timed && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero
              tone={timed.p95 < 300 ? 'emerald' : timed.p95 < 800 ? 'amber' : 'rose'}
              label="Median response"
              value={Math.round(timed.median)}
              unit="ms"
              sub={`p95 ${Math.round(timed.p95)} ms over ${timed.count} requests`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Fastest" value={`${Math.round(timed.min)} ms`} mono />
              <Stat label="Slowest" value={`${Math.round(timed.max)} ms`} mono />
              <Stat label="Cold first request" value={cold ? `${Math.round(cold.ttfb)} ms` : '—'} sub="DNS + TCP + TLS included" mono />
              <Stat label="Throughput" value={`${(bytes * 8 / (total / 1000) / 1e6).toFixed(2)} Mbps`} sub={`${(bytes / 1024).toFixed(1)} KB received`} mono />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Time to first byte, request by request</div>
            <Bars data={bars(latencies, 5)} suffix=" ms" height={96} />
            <Pills
              items={[
                { label: 'p50', value: `${Math.round(timed.median)} ms` },
                { label: 'p95', value: `${Math.round(timed.p95)} ms` },
                { label: 'failed', value: failures.length, tone: failures.length ? 'rose' : undefined },
              ]}
            />
          </Panel>
        </>
      )}

      {!!failures.length && (
        <Panel className="border-rose-500/30 !p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium"><Activity className="h-3.5 w-3.5 text-rose-400" /> {failures.length} request(s) failed</div>
          <p className="font-mono-j text-[10px] text-rose-400">{failures[0]}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            A failure here is almost always the browser blocking a cross-origin reply, not a slow endpoint — the request left and the timing you
            see in the bars is still real.
          </p>
        </Panel>
      )}
    </>
  );
}