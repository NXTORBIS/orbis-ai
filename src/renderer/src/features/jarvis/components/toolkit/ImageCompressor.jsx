import { useRef, useState } from 'react';
import { ImageDown, Upload, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Stat, Unsupported, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

export default function ImageCompressor() {
  const [src, setSrc] = useState(null);
  const [quality, setQuality] = useState(0.7);
  const [format, setFormat] = useState('image/jpeg');
  const [out, setOut] = useState(null);
  const [origSize, setOrigSize] = useState(0);
  const [newSize, setNewSize] = useState(0);
  const [img, setImg] = useState(null);
  const canvasRef = useRef(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    setOrigSize(f.size);
    const url = await readFileAsDataURL(f);
    setSrc(url); setOut(null); setNewSize(0);
    const i = new Image(); i.src = url; i.onload = () => setImg(i);
  };

  const compress = () => {
    if (!img) return;
    const c = canvasRef.current; c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    if (format === 'image/jpeg') ctx.fillStyle = '#fff', ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      setNewSize(blob.size);
      setOut(URL.createObjectURL(blob));
    }, format, quality);
  };

  const saving = origSize && newSize ? Math.round((1 - newSize / origSize) * 100) : 0;

  return (
    <div className="space-y-4">
      <ToolHeader icon={ImageDown} title="Image Compressor" desc="Reduce image file size by re-encoding at a chosen quality. Runs locally in your browser." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose image</Button>
        <input type="file" accept="image/*" onChange={onFile} className="hidden" />
      </label>
      {src && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div><div className="mb-1 text-xs text-muted-foreground">Original ({fmtBytes(origSize)})</div><img src={src} alt="original" className="max-h-56 w-full rounded-lg border border-border object-contain" /></div>
          <div>{out ? <><div className="mb-1 text-xs text-cyan-j">Compressed ({fmtBytes(newSize)}) · {saving}% smaller</div><img src={out} alt="compressed" className="max-h-56 w-full rounded-lg border border-border object-contain" /></> : <div className="grid h-56 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">Preview appears here</div>}</div>
        </div>
      )}
      {src && (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Quality: ${Math.round(quality * 100)}%`}><input type="range" min="0.1" max="1" step="0.05" value={quality} onChange={(e) => setQuality(+e.target.value)} className="w-40" /></Field>
          <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></Field>
          <Button size="sm" onClick={compress} className="mb-0.5">Compress</Button>
          {out && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fetch(out).then((r) => r.blob()).then((b) => downloadBlob(b, `compressed.${format === 'image/webp' ? 'webp' : 'jpg'}`))}><Download className="h-4 w-4" /> Download</Button>}
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
      {!window.HTMLCanvasElement?.prototype.toBlob && <Unsupported msg="Canvas toBlob is not supported." />}
    </div>
  );
}