import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Play, Download, Trash2, Pause } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Unsupported, downloadBlob, fmtBytes } from './shared';

export default function AudioRecorder() {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [dur, setDur] = useState(0);
  const [url, setUrl] = useState(null);
  const [size, setSize] = useState(0);
  const [err, setErr] = useState(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && navigator.mediaDevices && window.MediaRecorder);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const startRef = useRef(0);
  const rafRef = useRef(null);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' });
        setSize(blob.size);
        if (url) URL.revokeObjectURL(url);
        setUrl(URL.createObjectURL(blob));
      };
      mr.start();
      recRef.current = mr;
      setRecording(true); setPaused(false); setDur(0); startRef.current = Date.now();
      const tick = () => { setDur(Math.floor((Date.now() - startRef.current) / 1000)); rafRef.current = requestAnimationFrame(tick); };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) { setErr(e.message); }
  };
  const pause = () => { if (recRef.current?.state === 'recording') { recRef.current.pause(); setPaused(true); } else if (recRef.current?.state === 'paused') { recRef.current.resume(); setPaused(false); } };
  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false); setPaused(false);
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); if (rafRef.current) cancelAnimationFrame(rafRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, [url]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  if (!supported) return <div className="space-y-4"><ToolHeader icon={Mic} title="Audio Recorder" desc="Record microphone audio locally." /><Unsupported /></div>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Mic} title="Audio Recorder" desc="Record from your microphone. Audio is processed locally in your browser — nothing is uploaded." />
      <div className="flex flex-wrap gap-2">
        {!recording ? <Button size="sm" onClick={start} className="gap-1.5"><Mic className="h-4 w-4" /> Start recording</Button>
          : <><Button size="sm" variant="outline" onClick={pause} className="gap-1.5">{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused ? 'Resume' : 'Pause'}</Button>
            <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button></>}
      </div>
      {err && <Unsupported msg={err} />}
      {recording && <div className="font-mono-j text-3xl font-bold tabular-nums">{fmt(dur)}{paused && <span className="ml-2 text-sm text-amber-500">paused</span>}</div>}
      {url && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/50 p-4">
          <audio src={url} controls className="w-full" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmt(dur)} · {fmtBytes(size)}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob(chunksRef.current), 'recording.webm')}><Download className="h-3.5 w-3.5" /> Download</Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { URL.revokeObjectURL(url); setUrl(null); setSize(0); setDur(0); }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}