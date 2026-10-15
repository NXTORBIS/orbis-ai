import { useEffect, useRef, useState } from 'react';
import { Video, Square, Download, Trash2, Pause, Play } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Unsupported, downloadBlob, fmtBytes } from './shared';

export default function WebcamRecorder() {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [url, setUrl] = useState(null);
  const [size, setSize] = useState(0);
  const [err, setErr] = useState(null);
  const [supported] = useState(() => typeof navigator !== 'undefined' && navigator.mediaDevices && window.MediaRecorder);
  const videoRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);

  const start = async () => {
    setErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      videoRef.current.srcObject = stream; await videoRef.current.play();
      const mr = new MediaRecorder(stream, { mimeType: 'video/webm' });
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => { const blob = new Blob(chunksRef.current, { type: 'video/webm' }); setSize(blob.size); if (url) URL.revokeObjectURL(url); setUrl(URL.createObjectURL(blob)); };
      mr.start();
      recRef.current = mr;
      setRecording(true); setPaused(false);
    } catch (e) { setErr(e.message); }
  };
  const pause = () => { if (recRef.current?.state === 'recording') { recRef.current.pause(); setPaused(true); } else if (recRef.current?.state === 'paused') { recRef.current.resume(); setPaused(false); } };
  const stop = () => { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); streamRef.current?.getTracks().forEach((t) => t.stop()); setRecording(false); };
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); streamRef.current?.getTracks().forEach((t) => t.stop()); }, [url]);

  if (!supported) return <div className="space-y-4"><ToolHeader icon={Video} title="Webcam Recorder" desc="Record video from your camera." /><Unsupported /></div>;

  return (
    <div className="space-y-4">
      <ToolHeader icon={Video} title="Webcam Recorder" desc="Record video and audio from your webcam. Preview, pause, and download — all locally." />
      <div className="flex flex-wrap gap-2">
        {!recording ? <Button size="sm" onClick={start} className="gap-1.5"><Video className="h-4 w-4" /> Start recording</Button>
          : <><Button size="sm" variant="outline" onClick={pause} className="gap-1.5">{paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{paused ? 'Resume' : 'Pause'}</Button>
            <Button size="sm" variant="destructive" onClick={stop} className="gap-1.5"><Square className="h-4 w-4" /> Stop</Button></>}
      </div>
      {err && <Unsupported msg={err} />}
      <video ref={videoRef} muted playsInline className={recording ? 'w-full max-w-md rounded-xl border border-border' : 'hidden'} />
      {url && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-card/50 p-4">
          <video src={url} controls className="w-full rounded-lg" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{fmtBytes(size)}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob(chunksRef.current), 'webcam-recording.webm')}><Download className="h-3.5 w-3.5" /> Download</Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { URL.revokeObjectURL(url); setUrl(null); setSize(0); }}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}