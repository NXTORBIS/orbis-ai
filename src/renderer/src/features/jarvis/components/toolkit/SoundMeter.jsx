import { useEffect, useRef, useState } from 'react';
import { Activity, Play, Square } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Stat, Unsupported } from './shared';

const HISTORY = 90;

export default function SoundMeter() {
  const [running, setRunning] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [level, setLevel] = useState(-100);
  const [peak, setPeak] = useState(-100);
  const [offset, setOffset] = useState(94);
  const [hold, setHold] = useState(true);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ min: null, max: null, sum: 0, count: 0 });

  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.close?.().catch(() => {});
    streamRef.current = null;
    audioRef.current = null;
    setRunning(false);
  };

  useEffect(() => () => stop(), []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      streamRef.current = stream;
      audioRef.current = { context, analyser };
      const buffer = new Float32Array(analyser.fftSize);
      setRunning(true);
      setStats({ min: null, max: null, sum: 0, count: 0 });

      const tick = () => {
        analyser.getFloatTimeDomainData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
        const rms = Math.sqrt(sum / buffer.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        const value = Math.round((db + offset) * 10) / 10;
        setLevel(value);
        setPeak((current) => (value > current ? value : hold ? current : value));
        setHistory((current) => [...current, value].slice(-HISTORY));
        setStats((current) => ({
          min: current.min === null ? value : Math.min(current.min, value),
          max: current.max === null ? value : Math.max(current.max, value),
          sum: current.sum + value,
          count: current.count + 1,
        }));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (error) {
      setUnsupported(true);
      setRunning(false);
    }
  };

  const average = stats.count ? stats.sum / stats.count : 0;
  const barPercent = Math.min(100, Math.max(0, ((level - 30) / 70) * 100));

  return (
    <ToolShell
      toolId="sound-meter"
      icon={Activity}
      title="Sound Level Meter"
      desc="Measure how loud a room actually is — live level, peak hold and a rolling trace, straight from your microphone."
      state={{ offset, hold }}
      onRestore={(restored) => {
        if (restored.offset) setOffset(Number(restored.offset));
        if (typeof restored.hold === 'boolean') setHold(restored.hold);
      }}
      exportText={`Sound reading\nCurrent: ${level} dB\nPeak: ${peak} dB\nAverage: ${average.toFixed(1)} dB\nMin: ${stats.min ?? '—'} dB\nMax: ${stats.max ?? '—'} dB\nCalibration offset: ${offset}`}
      exportName="sound-meter.txt"
    >
      {unsupported ? (
        <Unsupported msg="This browser will not give the page access to your microphone, so the meter cannot run here. Try Chrome, Edge or Safari over https." />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <button type="button" onClick={stop} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-red-500/50">
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <button type="button" onClick={start} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
              <Play className="h-3.5 w-3.5" /> Start listening
            </button>
          )}
          <button
            type="button"
            onClick={() => { setPeak(-100); setHistory([]); setStats({ min: null, max: null, sum: 0, count: 0 }); }}
            className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50"
          >
            Reset readings
          </button>
          {!running && !level && <span className="text-[11px] text-muted-foreground">Nothing is recorded until you start.</span>}
        </div>
      )}

      <div className="tk-card tk-glow-ring rounded-xl border border-cyan-j/40 bg-gradient-to-br from-cyan-j/10 to-transparent p-4 text-center">
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Current level</div>
        <div className="tk-title-glow font-mono-j text-4xl font-semibold text-cyan-j">{running ? `${level.toFixed(1)}` : '—⁻'}<span className="text-lg"> dB</span></div>
        <div className="mt-3 h-3 overflow-hidden rounded-full border border-border/70 bg-card/60">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-[width] duration-100" style={{ width: `${barPercent}%` }} />
        </div>
        <div className="mt-2 flex justify-between font-mono-j text-[9px] text-muted-foreground">
          <span>30</span><span>50</span><span>70</span><span>85</span><span>100</span>
        </div>
      </div>

      <Field label="Live trace">
        <div className="tk-card tk-depth flex h-28 items-end gap-[2px] overflow-hidden rounded-xl border border-border/70 bg-card/40 p-2">
          {history.length ? history.map((value, index) => (
            <div
              key={index}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-cyan-j/30 to-cyan-j"
              style={{ height: `${Math.min(100, Math.max(2, ((value - 30) / 70) * 100))}%` }}
            />
          )) : <span className="text-[11px] text-muted-foreground">Start the meter to draw a trace.</span>}
        </div>
      </Field>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Peak (held)" value={running || peak > -100 ? `${peak.toFixed(1)} dB` : '—'} mono />
        <Stat label="Average" value={stats.count ? `${average.toFixed(1)} dB` : '—'} mono />
        <Stat label="Quietest" value={stats.min === null ? '—' : `${stats.min.toFixed(1)} dB`} mono />
        <Stat label="Loudest" value={stats.max === null ? '—' : `${stats.max.toFixed(1)} dB`} mono />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Calibration offset · ${offset} dB`} hint="nudge until it matches a reference meter">
          <input type="range" min={70} max={120} value={offset} onChange={(e) => setOffset(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setHold((h) => !h)}
            className={`w-full rounded-lg border px-3 py-2 text-xs transition ${hold ? 'border-cyan-j/50 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground'}`}
          >
            Peak hold {hold ? 'on' : 'off'}
          </button>
        </div>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Phone and laptop microphones are not calibrated instruments, so treat the number as a good relative reading: great for “is this room too
          loud for a call”, not for a legal noise report. Useful reference points — a library sits near 35 dB, conversation 60, a busy restaurant 75,
          and anything sustained above 85 dB is hearing-damage territory.
        </p>
      </Panel>
    </ToolShell>
  );
}