import { useRef, useState } from 'react';
import { Gauge as GaugeIcon, Play, Square } from 'lucide-react';
import { Bars, Hero, Pills } from '../kit/premium';
import { Panel, Stat } from '../shared';
import { bars, bloatGrade, bust, jitterOf, probe, stats } from './netUtils';

const ENDPOINT = 'https://speed.cloudflare.com/__down';
const IDLE_PROBES = 8;
const STREAMS = 5;
const LOAD_BYTES = 25_000_000;
const LOAD_MS = 16000;

export default function BufferbloatPanel({ onReport }) {
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('idle');
  const [idle, setIdle] = useState(null);
  const [loaded, setLoaded] = useState([]);
  const [error, setError] = useState('');
  const abortRef = useRef(null);

  const idleStats = idle ? stats(idle) : null;
  const loadedStats = stats(loaded);
  const grade = idleStats && loadedStats ? bloatGrade(idleStats.median, loadedStats.median) : null;

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
    setPhase('idle');
  };

  const run = async () => {
    setRunning(true);
    setError('');
    setIdle(null);
    setLoaded([]);
    setPhase('idle-latency');
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      const quiet = [];
      for (let i = 0; i < IDLE_PROBES; i += 1) {
        if (signal.aborted) return;
        try {
          quiet.push(await probe(bust(`${ENDPOINT}?bytes=0`), signal));
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      if (!quiet.length) {
        setError('The reference endpoint did not answer. Check your connection and try again.');
        return;
      }
      setIdle(quiet);
      setPhase('under-load');

      const streams = Array.from({ length: STREAMS }, () =>
        fetch(bust(`${ENDPOINT}?bytes=${LOAD_BYTES}`), { cache: 'no-store', signal })
          .then((res) => res.arrayBuffer())
          .catch(() => null),
      );

      const under = [];
      const deadline = performance.now() + LOAD_MS;
      while (performance.now() < deadline && under.length < 24 && !signal.aborted) {
        try {
          under.push(await probe(bust(`${ENDPOINT}?bytes=0`), signal));
          setLoaded([...under]);
        } catch (err) {
          if (err.name === 'AbortError') break;
        }
      }

      abortRef.current.abort();
      await Promise.allSettled(streams);
      setPhase('done');

      const quietMedian = stats(quiet).median;
      const loadedMedian = stats(under).median;
      if (loadedMedian) {
        const result = bloatGrade(quietMedian, loadedMedian);
        const jitter = jitterOf(under);
        onReport?.(
          `Bufferbloat\nIdle latency ${Math.round(quietMedian)} ms · under load ${Math.round(loadedMedian)} ms · +${Math.round(result.increase)} ms · jitter ${Math.round(jitter)} ms\nGrade ${result.grade} — ${result.label}`,
        );
      }
    } catch {
      setError('The test stopped early. Something on the path refused the requests.');
    } finally {
      setRunning(false);
    }
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            <Play className="h-3.5 w-3.5" /> Run bufferbloat test
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">
          {phase === 'idle-latency' ? 'Measuring quiet latency…' : phase === 'under-load' ? `Measuring latency while ${STREAMS} downloads run…` : `Saturates your link for ${LOAD_MS / 1000} seconds using Cloudflare's speed endpoints.`}
        </span>
      </div>

      {error && <Panel className="border-amber-500/30 text-[11px] text-amber-500">{error}</Panel>}

      {grade && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr]">
            <Hero tone={grade.tone} label={`Grade ${grade.grade}`} value={Math.round(grade.increase)} unit="ms" sub={grade.label} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Stat label="Latency when quiet" value={`${Math.round(idleStats.median)} ms`} mono />
              <Stat label="Latency under load" value={`${Math.round(loadedStats.median)} ms`} mono />
              <Stat label="Added by load" value={`+${Math.round(grade.increase)} ms`} mono />
              <Stat label="Jitter under load" value={`${Math.round(jitterOf(loaded))} ms`} mono />
            </div>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">Latency while the link was saturated</div>
            <Bars data={bars(loaded, 3)} suffix=" ms" height={96} />
            <Pills
              items={[
                { label: 'quiet', value: `${Math.round(idleStats.median)} ms` },
                { label: 'loaded', value: `${Math.round(loadedStats.median)} ms` },
                { label: 'peak', value: `${Math.round(loadedStats.max)} ms`, tone: grade.tone === 'rose' ? 'rose' : undefined },
              ]}
            />
          </Panel>
        </>
      )}

      {!running && !grade && (
        <Panel className="!p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
            <GaugeIcon className="h-3.5 w-3.5 text-cyan-j" /> What this measures
          </div>
          <p className="text-[11px] text-muted-foreground">
            Speed tests report a quiet line. This one fills the line first, then keeps pinging, so it shows what your connection does when
            someone else is downloading — the reason a call stutters while a big file transfers.
          </p>
        </Panel>
      )}

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          An increase under 30 ms is a well-behaved link. Anything past 100 ms means the buffer in your router or modem is queueing packets
          instead of forwarding them; the usual cures are enabling SQM or fq_codel shaping on the router, or capping the upload slightly below
          its maximum. Grading is against the same thresholds the public bufferbloat tests use.
        </p>
      </Panel>
    </>
  );
}