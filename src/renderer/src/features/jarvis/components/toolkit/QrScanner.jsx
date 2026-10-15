import { useEffect, useRef, useState } from 'react';
import { QrCode, Camera, Upload, Trash2 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn, Unsupported, readFileAsDataURL } from './shared';

const HIST_KEY = 'toolkit:qr-history';

export default function QrScanner() {
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(() => { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } });
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState(null);
  const [supported] = useState(() => 'BarcodeDetector' in window || typeof document.createElement('video').srcObject !== 'undefined');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);

  const pushHistory = (text) => {
    const h = [{ text, ts: Date.now() }, ...history.filter((x) => x.text !== text)].slice(0, 20);
    setHistory(h); localStorage.setItem(HIST_KEY, JSON.stringify(h));
  };

  const detectFromCanvas = async (canvas) => {
    if (window.BarcodeDetector) {
      if (!detectorRef.current) {
        try { detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'] }); }
        catch { detectorRef.current = new window.BarcodeDetector(); }
      }
      const codes = await detectorRef.current.detect(canvas);
      if (codes.length) return { text: codes[0].rawValue, format: codes[0].format };
    }
    return null;
  };

  const tick = async () => {
    const v = videoRef.current, c = canvasRef.current;
    if (v && c && v.readyState >= 2) {
      const ctx = c.getContext('2d');
      c.width = v.videoWidth || 320; c.height = v.videoHeight || 240;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      try {
        const r = await detectFromCanvas(c);
        if (r) { setResult(r); pushHistory(r.text); stop(); return; }
      } catch {}
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const start = async () => {
    setErr(null); setResult(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      const v = videoRef.current; v.srcObject = stream; await v.play();
      setScanning(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) { setErr(e.message); setScanning(false); }
  };
  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null; setScanning(false);
  };

  useEffect(() => () => stop(), []);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(null);
    const url = await readFileAsDataURL(f);
    const img = new Image(); img.src = url;
    await new Promise((r) => (img.onload = r));
    const c = canvasRef.current; c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    try {
      const r = await detectFromCanvas(c);
      if (r) { setResult(r); pushHistory(r.text); } else setErr('No QR/barcode detected in image.');
    } catch { setErr('Detection failed. Your browser may not support the BarcodeDetector API.'); }
  };

  const canvasRef = useRef(null);

  return (
    <div className="space-y-4">
      <ToolHeader icon={QrCode} title="QR & Barcode Scanner" desc="Scan QR codes and barcodes using the camera or an uploaded image. Uses the native BarcodeDetector API." />
      {!window.BarcodeDetector && <Unsupported msg="BarcodeDetector API is not supported in this browser — image/camera scanning may be unavailable. Chrome/Edge on desktop and Android support it." />}
      <div className="flex flex-wrap gap-2">
        {!scanning ? <Button size="sm" onClick={start} className="gap-1.5"><Camera className="h-4 w-4" /> Start camera</Button>
          : <Button size="sm" variant="destructive" onClick={stop}>Stop</Button>}
        <label className="inline-flex">
          <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Scan image</Button>
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
      </div>
      <video ref={videoRef} className={scanning ? 'w-full max-w-md rounded-xl border border-border' : 'hidden'} playsInline muted />
      <canvas ref={canvasRef} className="hidden" />
      {err && <Unsupported msg={err} />}
      {result && (
        <div className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Detected ({result.format})</div>
          <div className="mt-1 break-all font-mono-j text-sm">{result.text}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyBtn value={result.text} />
            {/^https?:\/\//i.test(result.text) && <a href={result.text} target="_blank" rel="noreferrer" className="text-xs text-cyan-j hover:underline">Open link ↗</a>}
          </div>
        </div>
      )}
      {history.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Scan history</span>
            <Button size="sm" variant="ghost" onClick={() => { setHistory([]); localStorage.removeItem(HIST_KEY); }} className="h-7 gap-1 text-xs"><Trash2 className="h-3 w-3" />Clear</Button></div>
          <div className="space-y-1">{history.map((h) => (
            <div key={h.ts} className="flex items-center justify-between rounded-md border border-border/60 bg-card/40 px-2 py-1 text-xs">
              <span className="truncate font-mono-j">{h.text}</span>
              <CopyBtn value={h.text} label="" size="sm" />
            </div>
          ))}</div>
        </div>
      )}
    </div>
  );
}