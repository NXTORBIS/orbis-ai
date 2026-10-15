import { useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Bars, Hero, Spark } from '../kit/premium';
import { Field, Panel, Seg, Stat } from '../shared';
import { bars, bust, hostOf, jitterOf, pingVerdict, probe, stats, urlOf } from './netUtils';

const COUNTS = [
  { value: 8, label: '8 probes' },
  { value: 16, label: '16 probes' },
  { value: 30, label: '30 probes' },
];

export default function PingPanel({ target, onReport }) {
  const [count, setCount] = useState(16);
  const [running, setRunning] = useState(false);
  const [samples, setSamples] = useState([]);
  const [lost, setLost] = useState(0);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const host = hostOf(target);
  const measured = stats(samples);
  const jitter = jitterOf(samples);
  const attempted = samples.length + lost;
  const lossPct = attempted ? Math.round((lost / attempted) * 100) : 0;
  const verdict = pingVerdict(measured?.median || 0, lossPct);

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const run = async () => {
    if (!host) return;
    setRunning(true);
    setSamples([]);
    setLost(0);
    setError('');
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;
    const collected = [];
    let failed = 0;
    const url = bust(urlOf(target));

    for (let i = 0; i < count; i += 1) {
      if (signal.aborted) break;
      try {
        collected.push(await probe(url, signal));
      } catch (err) {
        if (err.name === 'AbortError') break;
        failed += 1;
      }
      setSamples([...collected]);
      setLost(failed);
    }

    setRunning(false);
    const final = stats(collected);
    if (!final) {
      setError('Nothing came back. A browser can only reach hosts that answer over HTTPS, so a mail server, a router admin page or a blocked port will look unreachable here.');
      onReport?.(`Ping ${host}: no answer from ${attempted} probes.`);
      return;
    }
    onReport?.(
      `Ping ${host}\nMedian ${Math.round(final.median)} ms · min ${Math.round(final.min)} · max ${Math.round(final.max)} · jitter ${Math.round(jitterOf(collected))} ms · loss ${lossPct}%\n${pingVerdict(final.median, lossPct).label}`,
    );
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <button type="button" onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/50 bg-rose-500/10 px-4 py-1.5 text-xs text-rose-400">
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={!host}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5" /> Ping {host || 'a host'}
          </button>
        )}
        <Field label="">
          <Seg value={count} onChange={(v) => setCount(Number(v))} options={COUNTS} />
        </Field>
      </div>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {!!samples.length && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero
              tone={verdict.tone}
              label={verdict.label}
              value={Math.round(measured.median)}
              unit="ms"
              sub={`median of ${measured.count} probes to ${host}`}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Fastest" value={`${Math.round(measured.min)} ms`} mono />
              <Stat label="Slowest" value={`${Math.round(measured.max)} ms`} mono />
              <Stat label="Jitter" value={`${Math.round(jitter)} ms`} sub="change between probes" mono />
              <Stat label="Packet loss" value={`${lossPct}%`} sub={`${lost} of ${attempted} lost`} mono />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Every probe, in order</div>
            <Bars data={bars(samples)} suffix=" ms" />
            <Spark data={samples} tone={verdict.tone === 'rose' ? 'rose' : 'cyan'} />
            <p className="mt-2 text-[11px] text-muted-foreground">{verdict.note}</p>
          </Panel>
        </>
      )}

      {running && !samples.length && <Panel className="animate-shimmer-wave !p-3 text-[11px] text-muted-foreground">Waiting for the first answer…</Panel>}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          This is a real measurement of the round trip from your device to the host, taken over HTTPS: each probe is a fresh request whose
          timing is the time until the first byte comes back. Browsers cannot send ICMP, so a host that refuses web traffic will show as loss
          rather than as a latency — the numbers here describe your path and your link, which is what you are diagnosing either way.
        </p>
      </Panel>
    </>
  );
}