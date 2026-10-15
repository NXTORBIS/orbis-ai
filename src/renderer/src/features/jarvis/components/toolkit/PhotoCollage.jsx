import { useEffect, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, readFileAsDataURL, downloadBlob } from './shared';

const LAYOUTS = [
  { value: '2x1', label: '2 across', cells: [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] },
  { value: '3x1', label: '3 across', cells: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]] },
  { value: '2x2', label: '2 × 2', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]] },
  { value: '1+2', label: 'One + two', cells: [[0, 0, 0.66, 1], [0.66, 0, 0.34, 0.5], [0.66, 0.5, 0.34, 0.5]] },
  { value: '2+3', label: 'Two + three', cells: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
  { value: '3x2', label: '3 × 2', cells: [[0, 0, 1 / 3, 0.5], [1 / 3, 0, 1 / 3, 0.5], [2 / 3, 0, 1 / 3, 0.5], [0, 0.5, 1 / 3, 0.5], [1 / 3, 0.5, 1 / 3, 0.5], [2 / 3, 0.5, 1 / 3, 0.5]] },
];

const ASPECTS = [
  { value: '1', label: 'Square' },
  { value: '1.3333', label: '4:3' },
  { value: '1.7778', label: '16:9' },
  { value: '0.75', label: 'Portrait' },
];

const roundedRect = (ctx, x, y, w, h, r) => {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

export default function PhotoCollage() {
  const [images, setImages] = useState([]);
  const [layout, setLayout] = useState('2x2');
  const [gap, setGap] = useState(12);
  const [padding, setPadding] = useState(16);
  const [background, setBackground] = useState('#0b1220');
  const [radius, setRadius] = useState(14);
  const [aspect, setAspect] = useState('1');

  const canvasRef = useRef(null);

  const cells = (LAYOUTS.find((l) => l.value === layout) || LAYOUTS[2]).cells;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = 1200;
    const height = Math.round(width / Number(aspect));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    cells.forEach((cell, index) => {
      const [fx, fy, fw, fh] = cell;
      const x = padding + fx * innerW + gap / 2;
      const y = padding + fy * innerH + gap / 2;
      const w = fw * innerW - gap;
      const h = fh * innerH - gap;
      const entry = images[index];
      ctx.save();
      roundedRect(ctx, x, y, w, h, radius);
      ctx.clip();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x, y, w, h);
      if (entry && entry.img) {
        const img = entry.img;
        const scale = Math.max(w / img.width, h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '600 20px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Slot ${index + 1}`, x + w / 2, y + h / 2);
      }
      ctx.restore();
    });
  }, [images, cells, gap, padding, background, radius, aspect]);

  const addImages = async (fileList) => {
    const files = Array.from(fileList || []).slice(0, 6);
    const loaded = await Promise.all(files.map(async (file) => {
      const uri = await readFileAsDataURL(file);
      const img = new Image();
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = uri; });
      return { name: file.name, img };
    }));
    setImages((list) => [...list, ...loaded].slice(0, 6));
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, 'collage.png'); }, 'image/png');
  };

  return (
    <ToolShell
      toolId="collage"
      icon={LayoutGrid}
      title="Photo Collage"
      desc="Drop in up to six pictures, pick a grid, and get one clean image out — gaps, corners and background all yours."
      state={{ layout, gap, padding, background, radius, aspect, count: images.length }}
      onRestore={(saved) => {
        if (saved.layout) setLayout(saved.layout);
        setGap(saved.gap ?? 12);
        setPadding(saved.padding ?? 16);
        if (saved.background) setBackground(saved.background);
        setRadius(saved.radius ?? 14);
        if (saved.aspect) setAspect(saved.aspect);
      }}
      exportText={`Collage · ${layout} · gap ${gap} · padding ${padding} · radius ${radius} · ${aspect}:1 · ${images.length} images`}
      exportName="collage.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Add pictures
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addImages(e.target.files)} />
        </label>
        <span className="text-[11px] text-muted-foreground">{images.map((i) => i.name).join(', ') || 'No pictures yet'}</span>
        {!!images.length && (
          <button type="button" onClick={() => setImages([])} className="text-[11px] text-muted-foreground transition hover:text-red-500">
            Clear all
          </button>
        )}
      </div>

      <Panel className="!p-3">
        <canvas ref={canvasRef} className="mx-auto max-h-[26rem] w-auto max-w-full rounded-lg border border-border/70" />
      </Panel>

      <Field label="Layout">
        <Seg value={layout} onChange={setLayout} options={LAYOUTS.map((l) => ({ value: l.value, label: l.label }))} />
      </Field>

      <Field label="Shape">
        <Seg value={aspect} onChange={setAspect} options={ASPECTS} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Gap · ${gap}px`}>
          <input type="range" min={0} max={60} value={gap} onChange={(e) => setGap(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Outer padding · ${padding}px`}>
          <input type="range" min={0} max={80} value={padding} onChange={(e) => setPadding(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Corner radius · ${radius}px`}>
          <input type="range" min={0} max={60} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Background · ${background.toUpperCase()}`}>
          <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Slots in layout" value={String(cells.length)} />
        <Stat label="Pictures loaded" value={String(images.length)} />
        <Stat label="Output" value={`1200 × ${Math.round(1200 / Number(aspect))}`} mono />
      </div>

      <button
        type="button"
        onClick={download}
        className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20"
      >
        Download collage
      </button>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each picture is cropped to fill its cell without stretching, so mixed portrait and landscape shots still line up.
          Empty slots stay as placeholders until you add more. Nothing is uploaded — the collage is assembled in this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}