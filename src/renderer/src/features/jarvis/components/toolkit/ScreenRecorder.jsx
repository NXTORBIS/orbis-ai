import { useEffect, useRef, useState } from 'react';
import { Monitor, Square, Download, Trash2, Mic, MicOff } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Unsupported, downloadBlob, fmtBytes } from './shared';

export default function ScreenRecorder() {
  const [recording, setRecording] = useState(false);
  const [url, setUrl] = useState(null);
  const [size, setSize] = useState(0);
  const [withMic, setWithMic] = useState(false);
  const [err, setErr] = useState(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const micRef = useRef(null);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      streamRef.current = stream;
      if (withMic) {
        try { micRef.current = await navigator.mediaDevices.getUserMedia({ audio: true }); micRef.current.getAudioTracks().forEach((t) => stream.addTrack(t)); } catch {}
      }
      const mr = new MediaRecorder(stream, { mimeType: 'video/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => { const blob = new Blob(chunksRef.current, { type: 'video/webm' }); setSize(blob.size); if (url) URL.revokeObjectURL(url); setUrl(URL.createObjectURL(blob)); };
      stream.getVideoTracks()[0].addEventListener('ended', () => stop());
      mr.start();
      recRef.current = mr;
      setRecording(true);
    } catch (e) { setErr(e.message); }
  };
  const stop = () => {
    if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    micRef.current?.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); streamRef.current?.getTracks().forEach((t) => t.stop()); }, [url]);

  if (!supported) return <div className="space-y-4"><ToolHeader icon={Monitor} title="Screen Recorder" desc="Record your screen, window or tab." /><Unsupported msg="Screen capture (getDisplayMedia) is not available. Requires Chrome/Edge over HTTPS." /></div>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Monitor} title="Screen Recorder" desc="Capture your screen, window or browser tab. Optionally include microphone audio. Processed locally." />
      <div className="flex flex-wrap gap-2">
        {!recording ? <>
          <Button size="sm" variant={withMic ? 'default' : 'outline'} onClick={() => setWithMic((v) => !v)} className="gap-1.5">{withMic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}{withMic ? 'Mic on' : 'Mic off'}</Button>
          <Button size="sm" onClick={start} className="gap-1.5"><Monitor className="h-4 w-4" /> Start recording</Button>
        </> : <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button>}
      </div>
      {err && <Unsupported msg={err} />}
      {url && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/50 p-4">
          <video src={url} controls className="w-full rounded-lg" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmtBytes(size)}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob(chunksRef.current), 'screen-recording.webm')}><Download className="h-3.5 w-3.5" /> Download</Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { URL.revokeObjectURL(url); setUrl(null); setSize(0); }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}