import { useEffect, useRef, useState } from 'react';
import { PenTool, Trash2, Undo2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { CopyBtn, Field, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const WIDTH = 900;
const HEIGHT = 320;

export default function SignaturePad() {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [colour, setColour] = useState('#0b1120');
  const [thickness, setThickness] = useState(3.4);
  const [smooth, setSmooth] = useState(true);
  const [baseline, setBaseline] = useState(true);
  const [strokes, setStrokes] = useState([]);
  const [current, setCurrent] = useState([]);

  const redraw = (allStrokes, liveStroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    [...allStrokes, liveStroke].filter(Boolean).forEach((stroke) => {
      if (stroke.points.length < 2) return;
      ctx.strokeStyle = stroke.colour;
      ctx.lineWidth = stroke.thickness;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i += 1) {
        const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        if (smooth) ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
        else ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    });
  };

  useEffect(() => { redraw(strokes, null); }, [strokes, smooth]);

  const position = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const point = event.touches ? event.touches[0] : event;
    return {
      x: ((point.clientX - rect.left) / rect.width) * canvas.width,
      y: ((point.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const start = (event) => {
    event.preventDefault();
    drawing.current = true;
    setCurrent([position(event)]);
  };

  const move = (event) => {
    if (!drawing.current) return;
    event.preventDefault();
    const point = position(event);
    setCurrent((points) => {
      const next = [...points, point];
      redraw(strokes, { points: next, colour, thickness });
      return next;
    });
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (current.length > 1) setStrokes((all) => [...all, { points: current, colour, thickness }]);
    setCurrent([]);
  };

  const clear = () => {
    setStrokes([]);
    setCurrent([]);
  };

  const undo = () => setStrokes((all) => all.slice(0, -1));

  const isEmpty = !strokes.length;
  const savePng = () => {
    const canvas = canvasRef.current;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, 'signature.png'); }, 'image/png');
  };

  const pointCount = strokes.reduce((sum, s) => sum + s.points.length, 0);

  return (
    <ToolShell
      toolId="signature"
      icon={PenTool}
      title="Signature Pad"
      desc="Sign with a finger, stylus or mouse and take away a transparent PNG — sized for contracts, invoices and forms."
      state={{ colour, thickness, smooth, baseline }}
      onRestore={(restored) => {
        if (restored.colour) setColour(restored.colour);
        if (restored.thickness) setThickness(Number(restored.thickness));
        if (typeof restored.smooth === 'boolean') setSmooth(restored.smooth);
        if (typeof restored.baseline === 'boolean') setBaseline(restored.baseline);
      }}
      exportText={isEmpty ? '' : 'signature.png exported from Mark32 Signature Pad'}
      exportName="signature.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={undo} disabled={isEmpty} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40">
          <Undo2 className="h-3.5 w-3.5" /> Undo
        </button>
        <button type="button" onClick={clear} disabled={isEmpty} className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-red-500/50 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </button>
        <button type="button" onClick={savePng} disabled={isEmpty} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40">
          Save transparent PNG
        </button>
      </div>

      <div className="tk-card tk-depth relative overflow-hidden rounded-xl border border-border/70 bg-white">
        <canvas
          ref={canvasRef}
          width={WIDTH}
          height={HEIGHT}
          className="h-40 w-full cursor-crosshair touch-none sm:h-56"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {baseline && (
          <div aria-hidden className="pointer-events-none absolute inset-x-10 bottom-10 border-b border-dashed border-slate-300" />
        )}
        {isEmpty && !current.length && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-slate-400">
            Sign here — use a finger, stylus or mouse
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ink colour">
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Stroke width · ${thickness.toFixed(1)}px`}>
          <input type="range" min={1} max={10} step={0.2} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Smooth curves" checked={smooth} onChange={setSmooth} hint="natural pen feel" />
        <ToggleRow label="Baseline guide" checked={baseline} onChange={setBaseline} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {['#0b1120', '#1d4ed8', '#0f766e', '#b91c1c', '#7c3aed', '#334155'].map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setColour(preset)}
            title={preset}
            className={`h-7 w-7 rounded-full border-2 transition ${colour === preset ? 'border-cyan-j' : 'border-border/60'}`}
            style={{ backgroundColor: preset }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Strokes" value={String(strokes.length)} mono />
        <Stat label="Points drawn" value={String(pointCount)} mono />
        <Stat label="Export size" value={`${WIDTH}×${HEIGHT}`} mono sub="transparent PNG" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The PNG keeps a transparent background, so it drops cleanly onto a document without a white box around it. Undo removes one stroke at a
          time, which is far kinder than starting over when the last loop of a signature goes wrong.
        </p>
      </Panel>

      <CopyBtn value={isEmpty ? '' : canvasRef.current?.toDataURL('image/png') || ''} label="Copy as data URI" />
    </ToolShell>
  );
}