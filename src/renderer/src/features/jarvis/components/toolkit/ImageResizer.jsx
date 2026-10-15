import { useRef, useState } from 'react';
import { Scaling, Upload, Download, Lock } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { Input } from '@jarvis/components/ui/input';
import { ToolHeader, Field, Stat, downloadBlob, readFileAsDataURL } from './shared';

const PRESETS = { 'HD 720p': { w: 1280, h: 720 }, 'Square 1080': { w: 1080, h: 1080 }, 'Thumbnail': { w: 320, h: 240 }, 'Avatar': { w: 256, h: 256 } };

export default function ImageResizer() {
  const [src, setSrc] = useState(null);
  const [img, setImg] = useState(null);
  const [w, setW] = useState(800);
  const [h, setH] = useState(600);
  const [lock, setLock] = useState(true);
  const [out, setOut] = useState(null);
  const canvasRef = useRef(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await readFileAsDataURL(f);
    setSrc(url); setOut(null);
    const i = new Image(); i.src = url; i.onload = () => { setImg(i); setW(i.naturalWidth); setH(i.naturalHeight); };
  };
  const onW = (v) => { setW(v); if (lock && img) setH(Math.round((v / img.naturalWidth) * img.naturalHeight)); };
  const onH = (v) => { setH(v); if (lock && img) setW(Math.round((v / img.naturalHeight) * img.naturalWidth)); };

  const resize = (targetW, targetH) => {
    if (!img) return;
    const c = canvasRef.current; c.width = targetW; c.height = targetH;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, targetW, targetH);
    c.toBlob((blob) => setOut(blob ? URL.createObjectURL(blob) : null), 'image/png');
  };
  const scale = (pct) => { if (img) { const nw = Math.round(img.naturalWidth * pct / 100), nh = Math.round(img.naturalHeight * pct / 100); setW(nw); setH(nh); resize(nw, nh); } };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Scaling} title="Image Resizer" desc="Resize images to exact dimensions, presets or percentages with optional aspect-ratio lock." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose image</Button>
        <input type="file" accept="image/*" onChange={onFile} className="hidden" />
      </label>
      {src && <img src={src} alt="src" className="max-h-40 rounded-lg border border-border" />}
      {img && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Width"><Input type="number" value={w} onChange={(e) => onW(+e.target.value || 0)} className="w-24" /></Field>
          <Field label="Height"><Input type="number" value={h} onChange={(e) => onH(+e.target.value || 0)} className="w-24" /></Field>
          <Button size="sm" variant={lock ? 'default' : 'outline'} onClick={() => setLock((v) => !v)} className="mb-0.5 gap-1.5"><Lock className="h-3.5 w-3.5" />{lock ? 'Locked' : 'Free'}</Button>
          <Button size="sm" onClick={() => resize(w, h)} className="mb-0.5">Resize</Button>
        </div>
      )}
      {img && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([k, v]) => <Button key={k} size="sm" variant="ghost" onClick={() => { setW(v.w); setH(v.h); resize(v.w, v.h); }}>{k}</Button>)}
          {[50, 75, 150, 200].map((p) => <Button key={p} size="sm" variant="ghost" onClick={() => scale(p)}>{p}%</Button>)}
        </div>
      )}
      {out && (
        <div className="flex items-center gap-3 rounded-lg border border-border/70 bg-card/50 p-3">
          <img src={out} alt="resized" className="max-h-32 rounded border border-border" />
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fetch(out).then((r) => r.blob()).then((b) => downloadBlob(b, 'resized.png'))}><Download className="h-4 w-4" /> Download</Button>
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}