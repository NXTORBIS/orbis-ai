import { useRef, useState } from 'react';
import { Stamp, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Seg, Stat, ToggleRow, downloadBlob, readFileAsDataURL } from './shared';

const loadImage = (src) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});

export default function PhotoFrame() {
  const [url, setUrl] = useState('');
  const [style, setStyle] = useState('mat');
  const [matColour, setMatColour] = useState('#ffffff');
  const [matSize, setMatSize] = useState(36);
  const [borderWidth, setBorderWidth] = useState(0);
  const [borderColour, setBorderColour] = useState('#0b1120');
  const [radius, setRadius] = useState(4);
  const [shadow, setShadow] = useState(true);
  const [caption, setCaption] = useState('');
  const [captionSize, setCaptionSize] = useState(18);
  const [captionColour, setCaptionColour] = useState('#334155');
  const [maxWidth, setMaxWidth] = useState(1400);
  const canvasRef = useRef(null);

  const pick = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUrl(await readFileAsDataURL(file));
  };

  const styles = {
    none: { pad: 0, fill: 'transparent' },
    thin: { pad: 10, fill: matColour },
    mat: { pad: matSize, fill: matColour },
    polaroid: { pad: 26, fill: matColour },
  };
  const current = styles[style] || styles.mat;
  const bottomPad = style === 'polaroid' ? current.pad + (caption ? captionSize * 2.4 : captionSize * 1.4) : current.pad + (caption ? captionSize * 1.8 : 0);

  const exportPng = async () => {
    if (!url) return;
    const image = await loadImage(url);
    const scale = Math.min(1, maxWidth / image.naturalWidth);
    const innerWidth = Math.round(image.naturalWidth * scale);
    const innerHeight = Math.round(image.naturalHeight * scale);
    const pad = Math.round(current.pad * scale);
    const bottom = Math.round(bottomPad * scale);
    const canvas = canvasRef.current;
    canvas.width = innerWidth + pad * 2;
    canvas.height = innerHeight + pad + bottom;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = style === 'none' ? 'rgba(0,0,0,0)' : current.fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (style === 'none') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, pad, pad, innerWidth, innerHeight);
    if (borderWidth) {
      ctx.strokeStyle = borderColour;
      ctx.lineWidth = borderWidth * scale;
      ctx.strokeRect(pad, pad, innerWidth, innerHeight);
    }
    if (caption) {
      ctx.fillStyle = captionColour;
      ctx.font = `${Math.round(captionSize * scale)}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(caption, canvas.width / 2, innerHeight + pad + (bottom - pad) / 2, canvas.width - pad);
    }
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, 'framed.png'); }, 'image/png');
  };

  const report = `${style} frame · mat ${current.pad}px ${matColour} · border ${borderWidth}px · radius ${radius}px${caption ? ` · caption "${caption}"` : ''}`;

  return (
    <ToolShell
      toolId="photo-frame"
      icon={Stamp}
      title="Photo Frame & Border"
      desc="Give a picture a proper mat, border, rounded corners and caption, then export the framed result as a ready-to-post PNG."
      state={{ style, matColour, matSize, borderWidth, borderColour, radius, shadow, caption, captionSize, captionColour, maxWidth }}
      onRestore={(restored) => {
        if (restored.style) setStyle(restored.style);
        if (restored.matColour) setMatColour(restored.matColour);
        if (restored.matSize) setMatSize(Number(restored.matSize));
        if (restored.borderWidth !== undefined) setBorderWidth(Number(restored.borderWidth));
        if (restored.borderColour) setBorderColour(restored.borderColour);
        if (restored.radius !== undefined) setRadius(Number(restored.radius));
        if (typeof restored.shadow === 'boolean') setShadow(restored.shadow);
        if (typeof restored.caption === 'string') setCaption(restored.caption);
        if (restored.captionSize) setCaptionSize(Number(restored.captionSize));
        if (restored.captionColour) setCaptionColour(restored.captionColour);
        if (restored.maxWidth) setMaxWidth(Number(restored.maxWidth));
      }}
      exportText={report}
      exportName="frame-settings.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Choose a photo</span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        <Seg value={style} onChange={setStyle} options={[{ value: 'none', label: 'Clean' }, { value: 'thin', label: 'Thin edge' }, { value: 'mat', label: 'Matted' }, { value: 'polaroid', label: 'Polaroid' }]} />
        <button
          type="button"
          onClick={exportPng}
          disabled={!url}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          Export framed PNG
        </button>
      </div>

      <div className="tk-card tk-depth grid place-items-center rounded-xl border border-border/70 bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)] bg-[length:22px_22px] p-5">
        {url ? (
          <div
            className="max-w-full"
            style={{
              background: style === 'none' ? 'transparent' : current.fill,
              padding: current.pad,
              paddingBottom: bottomPad,
              borderRadius: `${radius + 2}px`,
              boxShadow: shadow ? '0 18px 40px -18px rgba(0,0,0,0.6)' : 'none',
            }}
          >
            <img
              src={url}
              alt="Framed preview"
              className="max-h-64"
              style={{ borderRadius: `${radius}px`, border: borderWidth ? `${borderWidth}px solid ${borderColour}` : 'none' }}
            />
            {caption && (
              <div className="pt-2 text-center" style={{ color: captionColour, fontSize: `${Math.min(captionSize, 20)}px` }}>
                {caption}
              </div>
            )}
          </div>
        ) : (
          <p className="py-10 text-center text-[11px] text-muted-foreground">
            <Stamp className="mx-auto mb-2 h-6 w-6 text-cyan-j" />
            Add a photo to frame it — your image stays on your device.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Mat colour">
          <input type="color" value={matColour} onChange={(e) => setMatColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Mat size · ${matSize}px`}>
          <input type="range" min={6} max={90} value={matSize} onChange={(e) => setMatSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Corner rounding · ${radius}px`}>
          <input type="range" min={0} max={40} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Border · ${borderWidth}px`}>
          <input type="range" min={0} max={16} value={borderWidth} onChange={(e) => setBorderWidth(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Border colour">
          <input type="color" value={borderColour} onChange={(e) => setBorderColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Largest export edge (px)">
          <Seg value={maxWidth} onChange={setMaxWidth} options={[{ value: 1000, label: '1000' }, { value: 1400, label: '1400' }, { value: 2000, label: '2000' }]} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Caption" hint="Optional — becomes a polaroid style label">
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Summer, 2026" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label={`Caption size · ${captionSize}px`}>
          <input type="range" min={11} max={34} value={captionSize} onChange={(e) => setCaptionSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Caption colour">
          <input type="color" value={captionColour} onChange={(e) => setCaptionColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <ToggleRow label="Drop shadow on the frame" checked={shadow} onChange={setShadow} />

      <canvas ref={canvasRef} className="hidden" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Style" value={style} />
        <Stat label="Mat" value={`${current.pad}px`} mono />
        <Stat label="Border" value={`${borderWidth}px`} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          A mat is the single easiest way to make a phone photo look considered — the white space gives the eye somewhere to rest. The export is drawn
          at your chosen size with the frame baked in, so it uploads anywhere as one neat image.
        </p>
      </Panel>
    </ToolShell>
  );
}