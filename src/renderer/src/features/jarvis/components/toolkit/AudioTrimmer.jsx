import { useEffect, useRef, useState } from 'react';
import { Music, Play, Scissors, Square, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Stat, fmtBytes, downloadBlob } from './shared';

const writeString = (view, offset, text) => {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
};

const encodeWav = (channels, sampleRate) => {
  const length = channels[0].length;
  const channelCount = channels.length;
  const buffer = new ArrayBuffer(44 + length * channelCount * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * channelCount * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * channelCount * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < channelCount; c += 1) {
      const sample = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
};

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export default function AudioTrimmer() {
  const [name, setName] = useState('');
  const [buffer, setBuffer] = useState(null);
  const [peaks, setPeaks] = useState([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const contextRef = useRef(null);
  const sourceRef = useRef(null);
  const bufferRef = useRef(null);

  useEffect(() => () => {
    try { sourceRef.current?.stop(); } catch { /* stopped */ }
    contextRef.current?.close?.().catch(() => {});
  }, []);

  const load = async (file) => {
    if (!file) return;
    setError('');
    setName(file.name);
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = contextRef.current || new AudioContext();
      contextRef.current = context;
      const arrayBuffer = await file.arrayBuffer();
      const decoded = await context.decodeAudioData(arrayBuffer);
      bufferRef.current = decoded;
      setBuffer(decoded);
      setStart(0);
      setEnd(decoded.duration);
      const channel = decoded.getChannelData(0);
      const buckets = 240;
      const size = Math.floor(channel.length / buckets) || 1;
      const values = [];
      for (let i = 0; i < buckets; i += 1) {
        let peak = 0;
        for (let j = 0; j < size; j += 1) {
          const value = Math.abs(channel[i * size + j] || 0);
          if (value > peak) peak = value;
        }
        values.push(peak);
      }
      const max = Math.max(...values, 0.0001);
      setPeaks(values.map((value) => value / max));
    } catch (err) {
      setError(`That file could not be decoded in this browser (${String(err.message || err)}). Try WAV, MP3, M4A or OGG.`);
    }
  };

  const stopPlayback = () => {
    try { sourceRef.current?.stop(); } catch { /* already stopped */ }
    setPlaying(false);
  };

  const preview = () => {
    const context = contextRef.current;
    const decoded = bufferRef.current;
    if (!context || !decoded) return;
    stopPlayback();
    const source = context.createBufferSource();
    source.buffer = decoded;
    source.connect(context.destination);
    source.onended = () => setPlaying(false);
    source.start(0, start, Math.max(0.05, end - start));
    sourceRef.current = source;
    setPlaying(true);
  };

  const trim = () => {
    const decoded = bufferRef.current;
    const context = contextRef.current;
    if (!decoded || !context) return;
    const from = Math.floor(start * decoded.sampleRate);
    const to = Math.floor(end * decoded.sampleRate);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index).slice(from, to));
    const blob = encodeWav(channels, decoded.sampleRate);
    const base = name.replace(/\.[^.]+$/, '') || 'clip';
    downloadBlob(blob, `${base}-trimmed.wav`);
  };

  const selection = end - start;

  const report = buffer
    ? `File: ${name}\nDuration: ${formatTime(buffer.duration)} · ${buffer.sampleRate} Hz · ${buffer.numberOfChannels} channel(s)\nTrim: ${formatTime(start)} → ${formatTime(end)} (${formatTime(selection)})`
    : '';

  return (
    <ToolShell
      toolId="audio-trim"
      icon={Music}
      title="Audio Trimmer"
      desc="Cut a clip down to the part you need and save it as a WAV — everything happens on your device, and nothing is uploaded."
      exportText={report}
      exportName="trim.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Choose an audio file</span>
          <input type="file" accept="audio/*" className="hidden" onChange={(e) => load(e.target.files?.[0])} />
        </label>
        {buffer && (
          <>
            <button type="button" onClick={playing ? stopPlayback : preview} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
              {playing ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {playing ? 'Stop' : 'Preview selection'}
            </button>
            <button
              type="button"
              onClick={trim}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
            >
              <Scissors className="h-3.5 w-3.5" /> Save trimmed WAV
            </button>
          </>
        )}
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      {buffer ? (
        <>
          <div className="tk-card tk-depth overflow-hidden rounded-xl border border-border/70 bg-card/40 p-3">
            <div className="flex h-28 items-end gap-[1px]">
              {peaks.map((peak, index) => {
                const position = index / peaks.length;
                const selected = position >= start / buffer.duration && position <= end / buffer.duration;
                return (
                  <div
                    key={index}
                    className={`flex-1 rounded-t ${selected ? 'bg-gradient-to-t from-cyan-j/40 to-cyan-j' : 'bg-border'}`}
                    style={{ height: `${Math.max(3, peak * 100)}%` }}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`Start · ${formatTime(start)}`}>
              <input
                type="range"
                min={0}
                max={buffer.duration}
                step={0.01}
                value={start}
                onChange={(e) => { const value = Number(e.target.value); setStart(Math.min(value, end - 0.05)); }}
                className="w-full accent-[hsl(var(--cyan))]"
              />
            </Field>
            <Field label={`End · ${formatTime(end)}`}>
              <input
                type="range"
                min={0}
                max={buffer.duration}
                step={0.01}
                value={end}
                onChange={(e) => { const value = Number(e.target.value); setEnd(Math.max(value, start + 0.05)); }}
                className="w-full accent-[hsl(var(--cyan))]"
              />
            </Field>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: 'Select all', run: () => { setStart(0); setEnd(buffer.duration); } },
              { label: 'First 30s', run: () => { setStart(0); setEnd(Math.min(30, buffer.duration)); } },
              { label: 'Middle third', run: () => { const third = buffer.duration / 3; setStart(third); setEnd(third * 2); } },
              { label: 'Last 15s', run: () => { setStart(Math.max(0, buffer.duration - 15)); setEnd(buffer.duration); } },
            ].map((preset) => (
              <button key={preset.label} type="button" onClick={preset.run} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Duration" value={formatTime(buffer.duration)} mono />
            <Stat label="Selection" value={formatTime(selection)} mono />
            <Stat label="Sample rate" value={`${buffer.sampleRate} Hz`} mono />
            <Stat label="WAV export ≈" value={fmtBytes(selection * buffer.sampleRate * buffer.numberOfChannels * 2)} mono />
          </div>

          <Panel className="border-amber-500/30">
            <p className="text-[11px] text-amber-500">
              The export is uncompressed 16-bit PCM WAV, which is ideal for editing and voice notes but roughly ten times larger than an MP3 of the same
              audio. Use the size estimate above before trimming a long recording.
            </p>
          </Panel>
        </>
      ) : (
        <Panel className="text-[11px] text-muted-foreground">
          Pick any audio file your browser can play. It is decoded locally for the waveform, so a long podcast will take a moment and use memory, but
          nothing leaves your device.
        </Panel>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-1 text-xs font-medium">Where this is handy</div>
          <p className="text-[11px] text-muted-foreground">
            Ringtone excerpts, the good ten seconds from a voice memo, a clean clip for a slideshow, or splitting a long recording into chapter files.
          </p>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-1 text-xs font-medium">A tip before you cut</div>
          <p className="text-[11px] text-muted-foreground">
            Leave a fraction of a second of silence at each end — starting exactly on the first syllable makes the clip sound abrupt when it plays.
          </p>
        </Panel>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Trimming is a slice of the decoded samples, so it is lossless with respect to the source: WAV has no further compression to lose. Only the
          channels, sample rate and duration you see above are carried over, which is why the estimate is exact rather than approximate.
        </p>
      </Panel>
    </ToolShell>
  );
}