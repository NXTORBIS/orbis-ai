import { useMemo, useState } from 'react';
import { Image as ImageIcon, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Out, CopyBtn, Stat, downloadBlob } from './shared';
import ToolShell from './kit/ToolShell';

const escapeXml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const luminance = (hex) => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const int = parseInt(full.slice(0, 6), 16);
  const channel = (v) => { const n = v / 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel((int >> 16) & 255) + 0.7152 * channel((int >> 8) & 255) + 0.0722 * channel(int & 255);
};

export default function ImagePlaceholder() {
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(630);
  const [from, setFrom] = useState('#0f172a');
  const [to, setTo] = useState('#155e75');
  const [angle, setAngle] = useState(135);
  const [label, setLabel] = useState('');
  const [showLabel, setShowLabel] = useState(true);
  const [radius, setRadius] = useState(0);

  const text = showLabel ? (label.trim() || `${width} × ${height}`) : '';
  const textColor = luminance(to) > 0.42 ? '#0b1220' : '#ffffff';
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * 0.09));

  const svg = useMemo(() => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" gradientTransform="rotate(${angle} 0.5 0.5)">
      <stop offset="0%" stop-color="${from}" />
      <stop offset="100%" stop-color="${to}" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" rx="${radius}" fill="url(#bg)" />
${text ? `  <text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="${fontSize}" font-weight="600" fill="${textColor}">${escapeXml(text)}</text>\n` : ''}</svg>`, [width, height, from, to, angle, radius, text, fontSize, textColor]);

  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

  const downloadPng = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, width, height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `placeholder-${width}x${height}.png`); }, 'image/png');
    };
    image.src = dataUrl;
  };

  const presets = [
    ['Social card', 1200, 630],
    ['Open Graph', 1200, 1200],
    ['Hero banner', 1600, 900],
    ['Square', 800, 800],
    ['Story', 1080, 1920],
  ];

  return (
    <ToolShell
      toolId="image-placeholder"
      icon={ImageIcon}
      title="Image Placeholder Generator"
      desc="Make a sized placeholder as crisp SVG, then export it as SVG or PNG."
      state={{ width, height, from, to, angle, label, showLabel, radius }}
      onRestore={(saved) => {
        setWidth(saved.width); setHeight(saved.height); setFrom(saved.from); setTo(saved.to);
        setAngle(saved.angle); setLabel(saved.label); setShowLabel(saved.showLabel ?? true); setRadius(saved.radius);
      }}
      exportText={svg}
      exportName="placeholder.svg"
      exportMime="image/svg+xml"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Width (px)"><input type="number" value={width} onChange={(e) => setWidth(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Height (px)"><input type="number" value={height} onChange={(e) => setHeight(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gradient start">
          <div className="flex gap-2">
            <input type="color" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
            <input value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
          </div>
        </Field>
        <Field label="Gradient end">
          <div className="flex gap-2">
            <input type="color" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
            <input value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
          </div>
        </Field>
        <Field label={`Angle · ${angle}°`}><input type="range" min={0} max={360} value={angle} onChange={(e) => setAngle(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
        <Field label={`Corner radius · ${radius}px`}><input type="range" min={0} max={Math.round(Math.min(width, height) / 2)} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" /></Field>
      </div>
      <Field label="Caption" hint="Leave empty to show the pixel size"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`${width} × ${height}`} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
      <Seg value={showLabel ? 'on' : 'off'} onChange={(v) => setShowLabel(v === 'on')} options={[{ value: 'on', label: 'Show caption' }, { value: 'off', label: 'Clean image' }]} />
      <div className="flex flex-wrap gap-1.5">
        {presets.map(([name, w, h]) => (
          <button key={name} onClick={() => { setWidth(w); setHeight(h); }} className="rounded-lg border border-border/70 px-2.5 py-1 text-xs text-muted-foreground transition hover:border-cyan-j/50 hover:text-foreground">{name} · {w}×{h}</button>
        ))}
      </div>
      <div className="grid place-items-center rounded-xl border border-border/70 bg-secondary/25 p-3">
        <img src={dataUrl} alt="Placeholder preview" className="max-h-72 w-auto max-w-full rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Pixels" value={`${width} × ${height}`} />
        <Stat label="Aspect ratio" value={(width / height).toFixed(3)} />
        <Stat label="Megapixels" value={((width * height) / 1e6).toFixed(2)} />
      </div>
      <Out label="SVG source" value={svg}>
        <pre className="max-h-56 overflow-auto whitespace-pre font-mono-j text-[11px] text-cyan-j scrollbar-thin">{svg}</pre>
      </Out>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={svg} label="Copy SVG" />
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `placeholder-${width}x${height}.svg`)}>
          <Download className="h-3.5 w-3.5" /> Download SVG
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadPng}>
          <Download className="h-3.5 w-3.5" /> Download PNG
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">The caption switches between white and near-black automatically to stay readable against whichever end of the gradient sits behind it.</p>
    </ToolShell>
  );
}