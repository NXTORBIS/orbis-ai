import { useEffect, useRef, useState } from 'react';
import { Stamp } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow, readFileAsDataURL, downloadBlob } from './shared';

const SAMPLE = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1100&q=75';

const SPOTS = {
  'top-left': [0.06, 0.10, 'left'],
  'top-centre': [0.5, 0.10, 'center'],
  'top-right': [0.94, 0.10, 'right'],
  'middle-left': [0.06, 0.5, 'left'],
  centre: [0.5, 0.5, 'center'],
  'middle-right': [0.94, 0.5, 'right'],
  'bottom-left': [0.06, 0.90, 'left'],
  'bottom-centre': [0.5, 0.90, 'center'],
  'bottom-right': [0.94, 0.90, 'right'],
};

export default function Watermark() {
  const [src, setSrc] = useState(SAMPLE);
  const [name, setName] = useState('sample.jpg');
  const [text, setText] = useState('© Mark32');
  const [spot, setSpot] = useState('bottom-right');
  const [sizePct, setSizePct] = useState(5);
  const [colour, setColour] = useState('#ffffff');
  const [opacity, setOpacity] = useState(72);
  const [rotation, setRotation] = useState(0);
  const [shadow, setShadow] = useState(true);
  const [tile, setTile] = useState(false);
  const [gap, setGap] = useState(22);
  const [format, setFormat] = useState('png');
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageRef.current = img; draw(); };
    img.onerror = () => setError('That image could not be loaded.');
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, spot, sizePct, colour, opacity, rotation, shadow, tile, gap]);

  function draw() {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const fontSize = Math.max(8, Math.round((sizePct / 100) * img.height));
    ctx.font = `600 ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = opacity / 100;
    ctx.fillStyle = colour;
    if (shadow) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = fontSize * 0.22;
      ctx.shadowOffsetY = fontSize * 0.06;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    const radians = (rotation * Math.PI) / 180;

    if (tile) {
      const stepX = Math.round((gap / 100) * img.width) + ctx.measureText(text).width;
      const stepY = Math.round((gap / 100) * img.height) + fontSize * 2;
      ctx.textAlign = 'left';
      for (let y = stepY * 0.6; y < img.height; y += stepY) {
        for (let x = -stepX * 0.2; x < img.width; x += stepX) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(radians);
          ctx.fillText(text, 0, 0);
          ctx.restore();
        }
      }
    } else {
      const [fx, fy, align] = SPOTS[spot];
      ctx.textAlign = align;
      ctx.save();
      ctx.translate(fx * img.width, fy * img.height);
      ctx.rotate(radians);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    setError('');
  }

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const ext = format === 'png' ? 'png' : 'jpg';
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${(name || 'image').replace(/\.[^.]+$/, '')}-marked.${ext}`); }, type, 0.92);
  };

  const summary = `${text} · ${spot} · ${sizePct}% of height · ${opacity}% opacity · ${rotation}°${tile ? ' · tiled' : ''}${shadow ? ' · shadowed' : ''} · ${format.toUpperCase()}`;

  return (
    <ToolShell
      toolId="watermark"
      icon={Stamp}
      title="Image Watermark"
      desc="Put your name, handle or notice on a picture — placed, sized, tiled and exported without leaving the browser."
      state={{ text, spot, sizePct, colour, opacity, rotation, shadow, tile, gap, format, name }}
      onRestore={(saved) => {
        if (saved.text !== undefined) setText(saved.text);
        if (saved.spot) setSpot(saved.spot);
        setSizePct(saved.sizePct ?? 5);
        if (saved.colour) setColour(saved.colour);
        setOpacity(saved.opacity ?? 72);
        setRotation(saved.rotation ?? 0);
        setShadow(saved.shadow ?? true);
        setTile(!!saved.tile);
        setGap(saved.gap ?? 22);
        if (saved.format) setFormat(saved.format);
      }}
      exportText={summary}
      exportName="watermark-settings.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10">
          Choose an image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setName(file.name);
              setSrc(await readFileAsDataURL(file));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => { setSrc(SAMPLE); setName('sample.jpg'); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50"
        >
          Use the sample
        </button>
        <span className="text-[11px] text-muted-foreground">{name}</span>
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <Panel className="!p-3">
        <canvas ref={canvasRef} className="mx-auto max-h-96 w-auto max-w-full rounded-lg border border-border/70" />
      </Panel>

      <Field label="Watermark text">
        <input value={text} onChange={(e) => setText(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
      </Field>

      <Field label="Position">
        <div className="grid grid-cols-3 gap-1.5">
          {Object.keys(SPOTS).map((key) => (
            <button
              key={key}
              type="button"
              disabled={tile}
              onClick={() => setSpot(key)}
              className={`rounded-lg border px-2 py-1.5 text-[10px] capitalize transition disabled:opacity-30 ${spot === key && !tile ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
            >
              {key.replace('-', ' ')}
            </button>
          ))}
        </div>
      </Field>

      <Field label={`Size · ${sizePct}% of image height`}>
        <input type="range" min={2} max={20} step={0.5} value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Opacity · ${opacity}%`}>
        <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Rotation · ${rotation}°`}>
        <input type="range" min={-90} max={90} value={rotation} onChange={(e) => setRotation(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>
      <Field label={`Colour · ${colour.toUpperCase()}`}>
        <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-14 cursor-pointer rounded-md border border-input bg-transparent" />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Drop shadow" checked={shadow} onChange={setShadow} hint="keeps it readable on light areas" />
        <ToggleRow label="Tile across the image" checked={tile} onChange={setTile} hint="harder to crop out" />
      </div>

      {tile && (
        <Field label={`Tile spacing · ${gap}%`}>
          <input type="range" min={8} max={60} value={gap} onChange={(e) => setGap(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      )}

      <Field label="Download format">
        <Seg value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPEG' }]} />
      </Field>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Placement" value={tile ? 'Tiled' : spot.replace('-', ' ')} />
        <Stat label="Size" value={`${sizePct}%`} mono />
        <Stat label="Opacity" value={`${opacity}%`} mono />
      </div>

      <button
        type="button"
        onClick={download}
        className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20"
      >
        Download watermarked image
      </button>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The watermark is drawn onto a copy of the picture at full resolution, so what you download keeps the original size.
          A tiled, semi-transparent mark is much harder to crop out than a single corner stamp. Your image never leaves this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}