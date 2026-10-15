import { useRef, useState } from 'react';
import { Pipette, Download, RotateCcw } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, Panel, CopyBtn, Out, readFileAsDataURL, downloadBlob } from './shared';
import ToolShell from './kit/ToolShell';

const toHex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

export default function ImageColorExtractor() {
  const [src, setSrc] = useState('');
  const [name, setName] = useState('image');
  const [colors, setColors] = useState([]);
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState(null);
  const canvasRef = useRef(null);

  const analyse = (canvas) => {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const buckets = new Map();
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 125) continue;
      const r = data[i] & 0xf0;
      const g = data[i + 1] & 0xf0;
      const b = data[i + 2] & 0xf0;
      const key = `${r},${g},${b}`;
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count += 1;
      entry.r += data[i];
      entry.g += data[i + 1];
      entry.b += data[i + 2];
      buckets.set(key, entry);
      total += 1;
    }
    const top = [...buckets.entries()]
      .map(([key, e]) => ({ key, count: e.count, r: Math.round(e.r / e.count), g: Math.round(e.g / e.count), b: Math.round(e.b / e.count) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map((c) => ({ hex: toHex(c.r, c.g, c.b), share: (c.count / (total || 1)) * 100, rgb: `rgb(${c.r}, ${c.g}, ${c.b})` }));
    setColors(top);
  };

  const onFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) { setErr('Please choose an image file.'); return; }
    setErr(null);
    setPicked(null);
    setName(file.name.replace(/\.[^.]+$/, '') || 'image');
    const dataUrl = await readFileAsDataURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      const scale = Math.min(1, 420 / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      analyse(canvas);
      setSrc(dataUrl);
    };
    img.onerror = () => setErr('That image could not be read.');
    img.src = dataUrl;
  };

  const pickFromCanvas = (event) => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    const ctx = canvas.getContext('2d');
    const [r, g, b] = ctx.getImageData(Math.min(x, canvas.width - 1), Math.min(y, canvas.height - 1), 1, 1).data;
    setPicked({ hex: toHex(r, g, b), rgb: `rgb(${r}, ${g}, ${b})`, x, y });
  };

  const paletteCss = colors.length ? `:root {\n${colors.map((c, i) => `  --color-${i + 1}: ${c.hex};`).join('\n')}\n}` : '';

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ image: name, colors: colors.map(({ hex, rgb, share }) => ({ hex, rgb, share: Number(share.toFixed(2)) })) }, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${name}-palette.json`);
  };

  return (
    <ToolShell
      toolId="image-colours"
      icon={Pipette}
      title="Image Colour Extractor"
      desc="Pull the dominant palette out of any image — or tap a pixel to grab its exact colour."
      state={{ name, colors }}
      onRestore={(saved) => { setName(saved.name || 'image'); setColors(saved.colors || []); }}
      exportText={colors.length ? JSON.stringify(colors, null, 2) : ''}
      exportName="palette.json"
      exportMime="application/json"
    >
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-6 text-center transition hover:border-cyan-j/50">
        <Pipette className="h-5 w-5 text-cyan-j" strokeWidth={1.5} />
        <span className="text-sm">{src ? 'Choose a different image' : 'Click to choose an image'}</span>
        <span className="text-[11px] text-muted-foreground">Analysed entirely in your browser — the file never leaves your device</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {err && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{err}</div>}
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">{src ? 'Tap anywhere to pick that pixel' : 'Your image appears here'}</span>
          {picked && (
            <button onClick={() => setPicked(null)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"><RotateCcw className="h-3 w-3" /> clear pick</button>
          )}
        </div>
        <div className="grid place-items-center rounded-xl border border-border/60 bg-secondary/25 p-2">
          <canvas
            ref={canvasRef}
            onClick={pickFromCanvas}
            className={`max-h-72 w-auto max-w-full rounded-lg ${src ? 'cursor-crosshair' : 'hidden'}`}
          />
          {!src && <span className="py-12 text-sm text-muted-foreground">No image yet</span>}
        </div>
      </Panel>
      {picked && (
        <Panel>
          <div className="flex items-center gap-3">
            <span className="h-12 w-12 shrink-0 rounded-lg border border-border/70" style={{ background: picked.hex }} />
            <div className="min-w-0 flex-1">
              <div className="font-mono-j text-sm text-cyan-j">{picked.hex}</div>
              <div className="font-mono-j text-[11px] text-muted-foreground">{picked.rgb} · pixel {picked.x}, {picked.y}</div>
            </div>
            <CopyBtn value={picked.hex} label="" />
          </div>
        </Panel>
      )}
      {colors.length > 0 && (
        <>
          <div className="h-8 overflow-hidden rounded-lg border border-border/70">
            <div className="flex h-full">
              {colors.map((c) => <div key={c.hex} className="h-full flex-1" style={{ background: c.hex }} title={c.hex} />)}
            </div>
          </div>
          <div className="space-y-2">
            {colors.map((c, i) => (
              <div key={`${c.hex}-${i}`} className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-3 py-2">
                <span className="h-8 w-8 shrink-0 rounded-md border border-border/70" style={{ background: c.hex }} />
                <span className="w-20 shrink-0 font-mono-j text-xs text-cyan-j">{c.hex}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: `${Math.min(100, c.share * 3)}%` }} />
                </div>
                <span className="w-12 shrink-0 text-right text-[11px] text-muted-foreground">{c.share.toFixed(1)}%</span>
                <CopyBtn value={c.hex} label="" />
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Stat label="Colours found" value={String(colors.length)} />
            <Stat label="Most common" value={colors[0].hex} mono />
            <Stat label="Coverage of top 12" value={`${Math.min(100, colors.reduce((sum, c) => sum + c.share, 0)).toFixed(1)}%`} />
          </div>
          <Out label="Palette as CSS variables" value={paletteCss}>
            <pre className="font-mono-j text-[11px] text-cyan-j">{paletteCss}</pre>
          </Out>
          <div className="flex flex-wrap gap-2">
            <CopyBtn value={paletteCss} label="Copy palette CSS" />
            <Button size="sm" variant="outline" onClick={downloadJson} className="gap-1.5"><Download className="h-3.5 w-3.5" /> Download palette JSON</Button>
            <CopyBtn value={colors.map((c) => c.hex).join('\n')} label="Copy hex list" />
          </div>
        </>
      )}
      <p className="text-[11px] text-muted-foreground">Colours are grouped into similar shades before ranking, so the palette reflects what the eye sees rather than single stray pixels.</p>
    </ToolShell>
  );
}