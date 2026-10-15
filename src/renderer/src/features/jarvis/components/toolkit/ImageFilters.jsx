import { useEffect, useRef, useState } from 'react';
import { WandSparkles, Download, RotateCcw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Panel, downloadBlob, readFileAsDataURL } from './shared';

const DEFAULTS = { brightness: 100, contrast: 100, saturate: 100, blur: 0, grayscale: 0, sepia: 0, hue: 0, invert: 0, opacity: 100 };
const SLIDERS = [['brightness', 'Brightness', 0, 200, '%'], ['contrast', 'Contrast', 0, 200, '%'], ['saturate', 'Saturation', 0, 200, '%'], ['blur', 'Blur', 0, 10, 'px'], ['grayscale', 'Grayscale', 0, 100, '%'], ['sepia', 'Sepia', 0, 100, '%'], ['hue', 'Hue rotate', 0, 360, 'deg'], ['invert', 'Invert', 0, 100, '%'], ['opacity', 'Opacity', 0, 100, '%']];

export default function ImageFilters() {
  const [src, setSrc] = useState('');
  const [name, setName] = useState('image');
  const [f, setF] = useState(DEFAULTS);
  const imgRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; draw(); };
    img.src = src;
  }, [src]);

  const filterString = () => `brightness(${f.brightness}%) contrast(${f.contrast}%) saturate(${f.saturate}%) blur(${f.blur}px) grayscale(${f.grayscale}%) sepia(${f.sepia}%) hue-rotate(${f.hue}deg) invert(${f.invert}%) opacity(${f.opacity}%)`;

  const draw = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const scale = Math.min(1, 1000 / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.filter = filterString();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  useEffect(() => { draw(); }, [f, src]);

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setName(file.name.replace(/\.[^.]+$/, '') || 'image');
    setF(DEFAULTS);
    setSrc(await readFileAsDataURL(file));
  };

  const download = () => {
    canvasRef.current?.toBlob((blob) => { if (blob) downloadBlob(blob, `${name}-filtered.png`); }, 'image/png');
  };

  const presets = [
    ['Original', DEFAULTS],
    ['Mono', { ...DEFAULTS, grayscale: 100, contrast: 115 }],
    ['Vintage', { ...DEFAULTS, sepia: 45, saturate: 85, contrast: 110 }],
    ['Vivid', { ...DEFAULTS, saturate: 160, contrast: 120 }],
    ['Cool', { ...DEFAULTS, hue: 200, saturate: 120 }],
    ['Dreamy', { ...DEFAULTS, blur: 1, brightness: 110, saturate: 130 }],
  ];

  return (
    <div className="space-y-4">
      <ToolHeader icon={WandSparkles} title="Image Filters" desc="Nine live filters and preset looks — then save the result as a PNG." />
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-6 text-center transition hover:border-cyan-j/50">
        <WandSparkles className="h-5 w-5 text-cyan-j" strokeWidth={1.5} />
        <span className="text-sm">{src ? 'Choose a different image' : 'Click to choose an image'}</span>
        <span className="text-[11px] text-muted-foreground">Everything is processed on your device — nothing is uploaded</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      <div className="grid place-items-center rounded-xl border border-border/70 bg-secondary/30 p-3">
        {src ? <canvas ref={canvasRef} className="max-h-80 w-auto rounded-lg" /> : <span className="py-10 text-sm text-muted-foreground">Your preview appears here</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([label, preset]) => (
          <button key={label} onClick={() => setF(preset)} className="rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground">{label}</button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SLIDERS.map(([key, label, min, max, unit]) => (
          <Field key={key} label={`${label} · ${f[key]}${unit}`}>
            <input type="range" min={min} max={max} value={f[key]} onChange={(e) => setF((cur) => ({ ...cur, [key]: Number(e.target.value) }))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={download} disabled={!src} className="gap-1.5"><Download className="h-3.5 w-3.5" /> Download PNG</Button>
        <Button size="sm" variant="outline" onClick={() => setF(DEFAULTS)} className="gap-1.5"><RotateCcw className="h-3.5 w-3.5" /> Reset filters</Button>
      </div>
      <Panel>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Filter CSS</div>
        <code className="break-all font-mono-j text-[11px] text-cyan-j">filter: {filterString()};</code>
      </Panel>
    </div>
  );
}