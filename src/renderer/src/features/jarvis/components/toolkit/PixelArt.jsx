import { useEffect, useMemo, useRef, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, CopyBtn, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const SIZES = [8, 16, 24, 32];

const PALETTE = [
  '#22d3ee', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7', '#ec4899',
  '#ef4444', '#f97316', '#f59e0b', '#facc15', '#22c55e', '#10b981',
  '#14b8a6', '#94a3b8', '#334155', '#ffffff',
];

const empty = (size) => Array.from({ length: size * size }, () => '');

export default function PixelArt() {
  const [size, setSize] = useState(16);
  const [pixels, setPixels] = useState(() => empty(16));
  const [colour, setColour] = useState(PALETTE[0]);
  const [erasing, setErasing] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [checkerboard, setCheckerboard] = useState(true);
  const [undoStack, setUndoStack] = useState([]);
  const [drawing, setDrawing] = useState(false);

  const canvasRef = useRef(null);

  const painted = useMemo(() => pixels.filter(Boolean).length, [pixels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.length; i++) {
      if (!pixels[i]) continue;
      ctx.fillStyle = pixels[i];
      ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
    }
  }, [pixels, size]);

  const changeSize = (next) => {
    setSize(next);
    setPixels(empty(next));
    setUndoStack([]);
  };

  const paintAt = (clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - rect.left) / rect.width) * size);
    const y = Math.floor(((clientY - rect.top) / rect.height) * size);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const value = erasing ? '' : colour;
    setPixels((grid) => {
      const next = [...grid];
      next[y * size + x] = value;
      if (mirror) next[y * size + (size - 1 - x)] = value;
      return next;
    });
  };

  const beginStroke = (event) => {
    setUndoStack((stack) => [...stack.slice(-19), pixels]);
    setDrawing(true);
    paintAt(event.clientX, event.clientY);
  };

  const undo = () => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      setPixels(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });
  };

  const exportPng = () => {
    const source = canvasRef.current;
    if (!source) return;
    const scale = 16;
    const out = document.createElement('canvas');
    out.width = size * scale;
    out.height = size * scale;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, 0, 0, out.width, out.height);
    out.toBlob((blob) => { if (blob) downloadBlob(blob, `pixel-art-${size}x${size}.png`); }, 'image/png');
  };

  const gridJson = JSON.stringify({ size, pixels }, null, 2);

  return (
    <ToolShell
      toolId="pixel-art"
      icon={Grid3x3}
      title="Pixel Art Editor"
      desc="Draw on a true pixel grid with mirror mode, undo and a scaled-up PNG export."
      state={{ size, palette: colour, erasing, mirror, pixels }}
      onRestore={(saved) => {
        if (saved.size) { setSize(saved.size); setPixels(Array.isArray(saved.pixels) ? saved.pixels : empty(saved.size)); }
        if (saved.palette) setColour(saved.palette);
        setErasing(!!saved.erasing);
        setMirror(!!saved.mirror);
      }}
      exportText={gridJson}
      exportName={`pixel-art-${size}x${size}.json`}
      exportMime="application/json"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => changeSize(s)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${size === s ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {s} × {s}
          </button>
        ))}
      </div>

      <Panel className="!p-3">
        <div
          className="relative mx-auto w-full max-w-sm overflow-hidden rounded-xl border border-border/70"
          style={checkerboard ? {
            backgroundImage: 'linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%)',
            backgroundSize: '16px 16px',
            backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
          } : undefined}
        >
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            onPointerDown={beginStroke}
            onPointerMove={(e) => { if (drawing) paintAt(e.clientX, e.clientY); }}
            onPointerUp={() => setDrawing(false)}
            onPointerLeave={() => setDrawing(false)}
            className="block aspect-square w-full cursor-crosshair touch-none"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setColour(c); setErasing(false); }}
              className={`h-7 w-7 rounded-md border transition ${!erasing && colour === c ? 'scale-110 border-cyan-j tk-glow-ring' : 'border-border/70'}`}
              style={{ background: c }}
              title={c}
            />
          ))}
          <button
            type="button"
            onClick={() => setErasing(true)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${erasing ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            Eraser
          </button>
        </div>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Mirror while drawing" checked={mirror} onChange={setMirror} hint="symmetric sprites" />
        <ToggleRow label="Checkerboard background" checked={checkerboard} onChange={setCheckerboard} hint="preview only" />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={undo} disabled={!undoStack.length} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40">
          Undo ({undoStack.length})
        </button>
        <button type="button" onClick={() => { setUndoStack((s) => [...s.slice(-19), pixels]); setPixels(empty(size)); }} className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50">
          Clear
        </button>
        <button type="button" onClick={exportPng} className="rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10">
          Download PNG
        </button>
        <CopyBtn value={gridJson} label="Copy grid JSON" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Canvas" value={`${size} × ${size}`} mono />
        <Stat label="Pixels painted" value={String(painted)} />
        <Stat label="Coverage" value={`${Math.round((painted / (size * size)) * 100)}%`} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The PNG export is scaled up 16× with smoothing off, so every pixel stays a hard square — ready for sprites, favicons or stickers.
          The grid JSON is the whole drawing, so you can paste it back into this tool later.
        </p>
      </Panel>
    </ToolShell>
  );
}