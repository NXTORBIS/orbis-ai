import { useRef, useState } from 'react';
import { Crop, FlipHorizontal, FlipVertical, RotateCcw, RotateCw, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Seg, Stat, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

const RATIOS = [
  { value: 'free', label: 'Free', ratio: null },
  { value: '1:1', label: 'Square', ratio: 1 },
  { value: '4:3', label: '4:3', ratio: 4 / 3 },
  { value: '3:2', label: '3:2', ratio: 3 / 2 },
  { value: '16:9', label: '16:9', ratio: 16 / 9 },
  { value: '9:16', label: 'Story', ratio: 9 / 16 },
];

export default function ImageCropper() {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [meta, setMeta] = useState({ width: 0, height: 0, size: 0 });
  const [crop, setCrop] = useState({ x: 8, y: 10, w: 84, h: 80 });
  const [ratio, setRatio] = useState('free');
  const [format, setFormat] = useState('image/png');
  const [quality, setQuality] = useState(90);
  const [maxWidth, setMaxWidth] = useState(0);
  const [status, setStatus] = useState('');
  const canvasRef = useRef(null);
  const dragRef = useRef(null);

  const workCanvas = useRef(null);
  const boxRef = useRef(null);

  const loadFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setStatus('Pick an image file — PNG, JPEG, WebP or GIF.'); return; }
    const dataUrl = await readFileAsDataURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      workCanvas.current = canvas;
      setUrl(canvas.toDataURL('image/png'));
      setMeta({ width: canvas.width, height: canvas.height, size: file.size });
      setName(file.name);
      setCrop({ x: 8, y: 10, w: 84, h: 80 });
      setStatus('');
    };
    image.src = dataUrl;
  };

  const applyTransform = (kind) => {
    const source = workCanvas.current;
    if (!source) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (kind === 'rotate' || kind === 'rotate-back') {
      canvas.width = source.height;
      canvas.height = source.width;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(((kind === 'rotate' ? 90 : -90) * Math.PI) / 180);
      ctx.drawImage(source, -source.width / 2, -source.height / 2);
    } else {
      canvas.width = source.width;
      canvas.height = source.height;
      ctx.translate(kind === 'flip-x' ? canvas.width : 0, kind === 'flip-y' ? canvas.height : 0);
      ctx.scale(kind === 'flip-x' ? -1 : 1, kind === 'flip-y' ? -1 : 1);
      ctx.drawImage(source, 0, 0);
    }
    workCanvas.current = canvas;
    setUrl(canvas.toDataURL('image/png'));
    setMeta((m) => ({ ...m, width: canvas.width, height: canvas.height }));
  };

  const applyRatio = (value) => {
    setRatio(value);
    const found = RATIOS.find((r) => r.value === value);
    if (!found?.ratio || !meta.width) return;
    const imageRatio = meta.width / meta.height;
    let w = 90;
    let h = 90;
    if (found.ratio > imageRatio) h = Math.round((w / found.ratio) * (meta.width / meta.height) * 100) / 100;
    else w = Math.round((h * found.ratio * (meta.height / meta.width)) * 100) / 100;
    const maxW = 100;
    const maxH = 100;
    w = Math.min(w || 90, maxW);
    h = Math.min(h || 90, maxH);
    setCrop({ x: (100 - w) / 2, y: (100 - h) / 2, w, h });
  };

  const startDrag = (event, mode) => {
    event.preventDefault();
    const rect = boxRef.current.getBoundingClientRect();
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, box: { ...crop }, rect };
  };

  const onMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = ((event.clientX - drag.startX) / drag.rect.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.rect.height) * 100;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    if (drag.mode === 'move') {
      setCrop({ ...drag.box, x: clamp(drag.box.x + dx, 0, 100 - drag.box.w), y: clamp(drag.box.y + dy, 0, 100 - drag.box.h) });
    } else {
      const w = clamp(drag.box.w + dx, 8, 100 - drag.box.x);
      const h = clamp(drag.box.h + dy, 8, 100 - drag.box.y);
      const fixed = RATIOS.find((r) => r.value === ratio)?.ratio;
      if (fixed && meta.width) {
        const wanted = w / ((fixed * meta.height) / meta.width);
        setCrop({ ...drag.box, w, h: clamp(wanted, 8, 100 - drag.box.y) });
      } else {
        setCrop({ ...drag.box, w, h });
      }
    }
  };

  const endDrag = () => { dragRef.current = null; };

  const exportCrop = () => {
    const source = workCanvas.current;
    if (!source) { setStatus('Add an image first.'); return; }
    const sx = Math.round((crop.x / 100) * source.width);
    const sy = Math.round((crop.y / 100) * source.height);
    const sw = Math.max(1, Math.round((crop.w / 100) * source.width));
    const sh = Math.max(1, Math.round((crop.h / 100) * source.height));
    let outW = sw;
    let outH = sh;
    if (maxWidth && sw > maxWidth) {
      outW = maxWidth;
      outH = Math.round((sh * maxWidth) / sw);
    }
    const canvas = canvasRef.current;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (format === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, outW, outH);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const base = (name || 'image').replace(/\.[^.]+$/, '');
      downloadBlob(blob, `${base}-crop.${format === 'image/png' ? 'png' : 'jpg'}`);
      setStatus(`Saved a ${outW}×${outH} crop (${fmtBytes(blob.size)}${format === 'image/jpeg' ? ` at ${quality}% quality` : ''}).`);
    }, format, quality / 100);
  };

  return (
    <ToolShell
      toolId="image-crop"
      icon={Crop}
      title="Image Cropper & Rotator"
      desc="Crop to any shape or a fixed ratio, straighten with rotations and flips, then export at the size you actually need."
      state={{ crop, ratio, format, quality, maxWidth }}
      onRestore={(restored) => {
        if (restored.crop) setCrop(restored.crop);
        if (restored.ratio) setRatio(restored.ratio);
        if (restored.format) setFormat(restored.format);
        if (restored.quality) setQuality(Number(restored.quality));
        if (restored.maxWidth !== undefined) setMaxWidth(Number(restored.maxWidth));
      }}
      exportText={`${name || 'image'} · crop ${Math.round(crop.w)}% × ${Math.round(crop.h)}% at ${Math.round(crop.x)}%,${Math.round(crop.y)}%`}
      exportName="crop.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Choose image</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />
        </label>
        <button type="button" onClick={() => applyTransform('rotate')} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          <RotateCw className="h-3.5 w-3.5" /> Rotate
        </button>
        <button type="button" onClick={() => applyTransform('rotate-back')} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          <RotateCcw className="h-3.5 w-3.5" /> Left
        </button>
        <button type="button" onClick={() => applyTransform('flip-x')} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          <FlipHorizontal className="h-3.5 w-3.5" /> Flip
        </button>
        <button type="button" onClick={() => applyTransform('flip-y')} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          <FlipVertical className="h-3.5 w-3.5" /> Flip
        </button>
      </div>

      {url ? (
        <div
          ref={boxRef}
          className="tk-card tk-depth relative select-none overflow-hidden rounded-xl border border-border/70 bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:20px_20px]"
          onMouseMove={onMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchMove={onMove}
          onTouchEnd={endDrag}
        >
          <img src={url} alt="Working" className="pointer-events-none w-full" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/45" />
          <div
            className="absolute cursor-move border-2 border-cyan-j shadow-[0_0_0_9999px_rgba(0,0,0,0)]"
            style={{ left: `${crop.x}%`, top: `${crop.y}%`, width: `${crop.w}%`, height: `${crop.h}%` }}
            onMouseDown={(e) => startDrag(e, 'move')}
            onTouchStart={(e) => startDrag(e, 'move')}
          >
            <img
              src={url}
              alt="Crop preview"
              className="pointer-events-none absolute"
              style={{ left: `${-(crop.x / crop.w) * 100}%`, top: `${-(crop.y / crop.h) * 100}%`, width: `${(100 / crop.w) * 100}%` }}
            />
            <div className="absolute bottom-0 right-0 h-6 w-6 cursor-se-resize" onMouseDown={(e) => startDrag(e, 'resize')} onTouchStart={(e) => startDrag(e, 'resize')}>
              <span className="absolute bottom-0.5 right-0.5 h-3 w-3 border-b-2 border-r-2 border-cyan-j" />
            </div>
          </div>
        </div>
      ) : (
        <Panel className="grid h-44 place-items-center text-center text-[11px] text-muted-foreground">
          <div>
            <Crop className="mx-auto mb-2 h-6 w-6 text-cyan-j" />
            Add an image to start cropping — everything happens on your device, nothing is uploaded.
          </div>
        </Panel>
      )}

      <Field label="Shape">
        <Seg value={ratio} onChange={applyRatio} options={RATIOS.map((r) => ({ value: r.value, label: r.label }))} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Crop width · ${Math.round(crop.w)}%`}>
          <input type="range" min={8} max={100 - crop.x} value={crop.w} onChange={(e) => setCrop({ ...crop, w: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Crop height · ${Math.round(crop.h)}%`}>
          <input type="range" min={8} max={100 - crop.y} value={crop.h} onChange={(e) => setCrop({ ...crop, h: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Format">
          <Seg value={format} onChange={setFormat} options={[{ value: 'image/png', label: 'PNG' }, { value: 'image/jpeg', label: 'JPEG' }]} />
        </Field>
        <Field label={`Quality · ${quality}%`} hint="JPEG only">
          <input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Max output width" hint="0 keeps full size">
          <input
            value={String(maxWidth)}
            onChange={(e) => setMaxWidth(Math.max(0, Number(e.target.value) || 0))}
            inputMode="numeric"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportCrop} disabled={!url} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40">
          Export crop
        </button>
        {status && <span className="text-[11px] text-cyan-j">{status}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Working image" value={meta.width ? `${meta.width}×${meta.height}` : '—'} mono />
        <Stat label="Output" value={meta.width ? `${Math.round((crop.w / 100) * meta.width)}×${Math.round((crop.h / 100) * meta.height)}` : '—'} mono />
        <Stat label="Original size" value={meta.size ? fmtBytes(meta.size) : '—'} mono />
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Drag the box to frame your crop and pull its corner to resize; pick a ratio first and the resize keeps that shape. Rotating or flipping
          rewrites the working image, so what you export is exactly what the box shows.
        </p>
      </Panel>
    </ToolShell>
  );
}