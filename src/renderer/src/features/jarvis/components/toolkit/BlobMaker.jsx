import { useMemo, useRef, useState } from 'react';
import { Shapes, Shuffle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Seg, Stat, downloadBlob } from './shared';

const buildPath = ({ points, randomness, roundness, size }) => {
  const radius = size / 2;
  const coords = [];
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2 - Math.PI / 2;
    const jitter = 1 - (randomness / 100) * (0.15 + Math.random() * 0.65);
    const r = radius * jitter;
    coords.push({ x: radius + Math.cos(angle) * r, y: radius + Math.sin(angle) * r });
  }
  const k = (roundness / 100) * 0.55;
  let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length; i += 1) {
    const p0 = coords[(i - 1 + coords.length) % coords.length];
    const p1 = coords[i];
    const p2 = coords[(i + 1) % coords.length];
    const p3 = coords[(i + 2) % coords.length];
    const c1x = p1.x + (p2.x - p0.x) * k;
    const c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k;
    const c2y = p2.y - (p3.y - p1.y) * k;
    path += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${path} Z`;
};

export default function BlobMaker() {
  const [points, setPoints] = useState(7);
  const [randomness, setRandomness] = useState(55);
  const [roundness, setRoundness] = useState(62);
  const [size, setSize] = useState(400);
  const [fill, setFill] = useState('#22d3ee');
  const [fillStyle, setFillStyle] = useState('gradient');
  const [second, setSecond] = useState('#a78bfa');
  const [seed, setSeed] = useState(1);
  const svgRef = useRef(null);

  const path = useMemo(() => buildPath({ points, randomness, roundness, size }), [points, randomness, roundness, size, seed]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">\n  <defs>\n    <linearGradient id="blob" x1="0" y1="0" x2="1" y2="1">\n      <stop offset="0%" stop-color="${fill}" />\n      <stop offset="100%" stop-color="${second}" />\n    </linearGradient>\n  </defs>\n  <path d="${path}" fill="${fillStyle === 'gradient' ? 'url(#blob)' : fill}" />\n</svg>`;

  const saveSvg = () => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'blob.svg');
  const savePng = () => {
    const image = new Image();
    const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size * 2;
      canvas.height = size * 2;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (blob) downloadBlob(blob, 'blob.png'); }, 'image/png');
      URL.revokeObjectURL(blobUrl);
    };
    image.src = blobUrl;
  };

  const copyPath = path;

  return (
    <ToolShell
      toolId="blob"
      icon={Shapes}
      title="Blob Shape Generator"
      desc="Organic SVG blobs for avatars, section backgrounds and app icons — shape it, then export a crisp SVG or a 2× PNG."
      state={{ points, randomness, roundness, size, fill, fillStyle, second }}
      onRestore={(restored) => {
        if (restored.points) setPoints(Number(restored.points));
        if (restored.randomness) setRandomness(Number(restored.randomness));
        if (restored.roundness) setRoundness(Number(restored.roundness));
        if (restored.size) setSize(Number(restored.size));
        if (restored.fill) setFill(restored.fill);
        if (restored.second) setSecond(restored.second);
        if (restored.fillStyle) setFillStyle(restored.fillStyle);
      }}
      exportText={svg}
      exportName="blob.svg"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setSeed((s) => s + 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <Shuffle className="h-3.5 w-3.5" /> New shape
        </button>
        <button type="button" onClick={saveSvg} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          Export SVG
        </button>
        <button type="button" onClick={savePng} className="rounded-lg border border-border/70 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-cyan-j/50">
          Export PNG 2×
        </button>
        <CopyBtn value={copyPath} label="Copy path" />
      </div>

      <div className="tk-card tk-depth grid place-items-center rounded-xl border border-border/70 bg-gradient-to-br from-card/70 to-card/30 p-6">
        <svg ref={svgRef} viewBox={`0 0 ${size} ${size}`} className="h-56 w-56">
          <defs>
            <linearGradient id="blobPreview" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={fill} />
              <stop offset="100%" stopColor={second} />
            </linearGradient>
          </defs>
          <path d={path} fill={fillStyle === 'gradient' ? 'url(#blobPreview)' : fill} />
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Corners · ${points}`}>
          <input type="range" min={3} max={14} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Randomness · ${randomness}%`}>
          <input type="range" min={0} max={100} value={randomness} onChange={(e) => setRandomness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Roundness · ${roundness}%`}>
          <input type="range" min={0} max={100} value={roundness} onChange={(e) => setRoundness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Colour one">
          <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Colour two">
          <input type="color" value={second} onChange={(e) => setSecond(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label="Filling">
          <Seg value={fillStyle} onChange={setFillStyle} options={[{ value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Flat' }]} />
        </Field>
      </div>

      <Field label={`Canvas size · ${size}px`}>
        <input type="range" min={160} max={1200} step={20} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Panel className="!p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">SVG</div>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words font-mono-j text-[10px] text-cyan-j">{svg}</pre>
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Anchor points" value={String(points)} mono />
        <Stat label="Path length" value={`${path.length} chars`} mono />
        <Stat label="Export" value="SVG · PNG 2×" mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The curve is built from smooth bezier segments through your points, so the outline stays soft at any scale — drop the SVG straight into
          a hero, a favicon or a print layout without it ever going fuzzy.
        </p>
      </Panel>
    </ToolShell>
  );
}