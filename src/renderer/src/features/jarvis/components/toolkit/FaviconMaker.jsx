import { useCallback, useEffect, useRef, useState } from 'react';
import { Star, Download } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Field, Seg, Panel, CopyBtn, Out } from './shared';
import ToolShell from './kit/ToolShell';

const SIZES = [512, 192, 180, 32];

function roundedRect(ctx, size, radius) {
  const r = Math.max(0, Math.min(size / 2, radius));
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

const isEmoji = (text) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text);

export default function FaviconMaker() {
  const [glyph, setGlyph] = useState('🚀');
  const [bg, setBg] = useState('#0f172a');
  const [color, setColor] = useState('#22d3ee');
  const [shape, setShape] = useState('squircle');
  const [padding, setPadding] = useState(18);
  const canvasRef = useRef(null);

  const radiusPct = shape === 'circle' ? 100 : shape === 'square' ? 0 : shape === 'rounded' ? 18 : 42;

  const draw = useCallback((canvas, size) => {
    const ctx = canvas.getContext('2d');
    canvas.width = size;
    canvas.height = size;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = bg;
    roundedRect(ctx, size, (radiusPct / 100) * (size / 2));
    ctx.fill();
    const inset = (padding / 100) * size;
    const box = size - inset * 2;
    const text = glyph.slice(0, 2) || 'M';
    const emoji = isEmoji(text);
    const fontStack = emoji
      ? '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
      : '"Inter", ui-sans-serif, system-ui, sans-serif';
    const sizeFactor = text.length > 1 ? 0.62 : emoji ? 0.78 : 0.82;
    ctx.font = `700 ${Math.round(box * sizeFactor)}px ${fontStack}`;
    ctx.fillStyle = emoji ? '#ffffff' : color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size / 2, size / 2 + size * 0.02);
  }, [bg, color, glyph, padding, radiusPct]);

  useEffect(() => {
    if (canvasRef.current) draw(canvasRef.current, 256);
  }, [draw]);

  const download = (size) => {
    const canvas = document.createElement('canvas');
    draw(canvas, size);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `favicon-${size}x${size}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png');
  };

  const dataUrl = (() => {
    const canvas = document.createElement('canvas');
    draw(canvas, 512);
    return canvas.toDataURL('image/png');
  })();

  const snippet = `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />\n<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />\n<link rel="apple-touch-icon" sizes="180x180" href="/favicon-180x180.png" />\n<link rel="mask-icon" href="/safari-pinned-tab.svg" color="${bg}" />\n<meta name="theme-color" content="${bg}" />`;

  return (
    <ToolShell
      toolId="favicon"
      icon={Star}
      title="Favicon Maker"
      desc="Turn an emoji, letter or initials into a favicon and download every size."
      state={{ glyph, bg, color, shape, padding }}
      onRestore={(saved) => {
        setGlyph(saved.glyph); setBg(saved.bg); setColor(saved.color);
        setShape(saved.shape); setPadding(saved.padding);
      }}
      exportText={snippet}
      exportName="favicon-links.html"
      exportMime="text/html"
    >
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <canvas ref={canvasRef} className="h-40 w-40 rounded-2xl border border-border/70" />
          <div className="flex gap-2">
            {[16, 32, 48].map((s) => {
              const c = document.createElement('canvas');
              draw(c, s);
              return <img key={s} src={c.toDataURL()} alt={`${s}px preview`} style={{ width: s, height: s }} className="rounded border border-border/60" />;
            })}
          </div>
        </div>
        <div className="grid gap-3">
          <Field label="Emoji, letter or initials" hint="Up to two characters"><input value={glyph} onChange={(e) => setGlyph(e.target.value)} maxLength={4} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" /></Field>
          <Seg value={shape} onChange={setShape} options={[{ value: 'square', label: 'Square' }, { value: 'rounded', label: 'Rounded' }, { value: 'squircle', label: 'Squircle' }, { value: 'circle', label: 'Circle' }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Background">
              <div className="flex gap-2">
                <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
                <input value={bg} onChange={(e) => setBg(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
              </div>
            </Field>
            <Field label="Letter colour">
              <div className="flex gap-2">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 rounded-md border border-input bg-transparent" />
                <input value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-xs" />
              </div>
            </Field>
          </div>
          <Field label={`Glyph size · ${100 - padding * 2}% of the tile`}>
            <input type="range" min={4} max={40} value={padding} onChange={(e) => setPadding(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        </div>
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">Download</div>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((size) => (
            <Button key={size} size="sm" variant="outline" onClick={() => download(size)} className="gap-1.5"><Download className="h-3.5 w-3.5" /> {size}px PNG</Button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">192px is the Android/PWA icon, 180px is the iOS home-screen icon, 32px is the browser tab.</p>
      </Panel>
      <Out label="Base64 PNG (512px)" value={dataUrl}>
        <div className="break-all font-mono-j text-[10px] text-muted-foreground">{dataUrl.slice(0, 300)}…</div>
      </Out>
      <Out label="Link tags for your site" value={snippet}>
        <pre className="overflow-x-auto font-mono-j text-[11px] text-cyan-j">{snippet}</pre>
      </Out>
      <div className="flex flex-wrap gap-2">
        <CopyBtn value={dataUrl} label="Copy 512px data URL" />
        <CopyBtn value={snippet} label="Copy link tags" />
      </div>
    </ToolShell>
  );
}