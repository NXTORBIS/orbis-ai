import { useEffect, useRef, useState } from 'react';
import { Ruler, Grid3x3 } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, CopyBtn, Field, Stat } from './shared';

export default function ScreenRuler() {
  const canvasRef = useRef(null);
  const [orientation, setOrientation] = useState('horizontal');
  const [unit, setUnit] = useState('px');
  const [showGrid, setShowGrid] = useState(true);
  const [measure, setMeasure] = useState(null);
  const drag = useRef(null);
  const [dpi, setDpi] = useState(96);

  const PX_PER = { px: 1, cm: dpi / 2.54, in: dpi, mm: dpi / 25.4 };
  const toUnit = (px) => px / PX_PER[unit];
  const fmt = (px) => `${toUnit(px).toFixed(unit === 'px' ? 0 : 2)} ${unit}`;

  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'width:1in;height:1in;position:absolute;left:-100%;top:-100%';
    document.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width;
    if (w && w > 0) setDpi(Math.round(w));
    document.body.removeChild(probe);
  }, []);

  const draw = () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);
    const styles = window.getComputedStyle(document.documentElement);
    const fg = styles.getPropertyValue('--foreground').trim();
    const muted = styles.getPropertyValue('--muted-foreground').trim();
    const border = styles.getPropertyValue('--border').trim();
    ctx.strokeStyle = `hsl(${border})`;
    ctx.fillStyle = `hsl(${fg})`;
    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    const horizontal = orientation === 'horizontal';
    const len = horizontal ? w : h;
    const thick = horizontal ? h : w;
    for (let px = 0; px <= len; px += 10) {
      const major = px % 100 === 0, mid = px % 50 === 0;
      const t = major ? thick * 0.5 : mid ? thick * 0.35 : thick * 0.2;
      ctx.beginPath();
      if (horizontal) { ctx.moveTo(px, 0); ctx.lineTo(px, t); }
      else { ctx.moveTo(0, px); ctx.lineTo(t, px); }
      ctx.stroke();
      if (major && px > 0) {
        ctx.fillStyle = `hsl(${muted})`;
        if (horizontal) ctx.fillText(fmt(px), px + 2, thick * 0.62);
        else { ctx.save(); ctx.translate(thick * 0.62, px - 2); ctx.rotate(-Math.PI / 2); ctx.fillText(fmt(px), 0, 0); ctx.restore(); }
      }
    }
    if (showGrid) {
      ctx.strokeStyle = `hsl(${border} / 0.25)`;
      ctx.lineWidth = 1;
      for (let x = 0; x <= w; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      for (let y = 0; y <= h; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    }
    if (drag.current && drag.current.start) {
      const s = drag.current.start, e = drag.current.cur;
      ctx.strokeStyle = `hsl(var(--cyan))`;
      ctx.fillStyle = `hsl(var(--cyan) / 0.12)`;
      ctx.lineWidth = 2;
      if (horizontal) {
        const x = Math.min(s.x, e.x);
        ctx.fillRect(x, 0, Math.abs(e.x - s.x), h);
        ctx.strokeRect(x, 0, Math.abs(e.x - s.x), h);
      } else {
        const y = Math.min(s.y, e.y);
        ctx.fillRect(0, y, w, Math.abs(e.y - s.y));
        ctx.strokeRect(0, y, w, Math.abs(e.y - s.y));
      }
    }
  };

  useEffect(() => { draw(); }, [orientation, unit, showGrid, dpi, measure]);

  const onDown = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    drag.current = { start: { x: e.clientX - r.left, y: e.clientY - r.top }, cur: { x: e.clientX - r.left, y: e.clientY - r.top } };
  };
  const onMove = (e) => {
    if (!drag.current?.start) return;
    const r = canvasRef.current.getBoundingClientRect();
    drag.current.cur = { x: e.clientX - r.left, y: e.clientY - r.top };
    const horizontal = orientation === 'horizontal';
    const d = Math.abs(drag.current.cur[horizontal ? 'x' : 'y'] - drag.current.start[horizontal ? 'x' : 'y']);
    setMeasure(d);
    draw();
  };
  const onUp = () => { draw(); };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Ruler} title="Screen Ruler" desc="Pixel-accurate ruler with drag-to-measure, grid overlay and unit switching." />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={orientation === 'horizontal' ? 'default' : 'outline'} onClick={() => setOrientation('horizontal')}>Horizontal</Button>
        <Button size="sm" variant={orientation === 'vertical' ? 'default' : 'outline'} onClick={() => setOrientation('vertical')}>Vertical</Button>
        <Button size="sm" variant={showGrid ? 'default' : 'outline'} onClick={() => setShowGrid((v) => !v)} className="gap-1.5"><Grid3x3 className="h-4 w-4" />Grid</Button>
        <Field label="Unit">
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
            <option value="px">px</option><option value="cm">cm</option><option value="mm">mm</option><option value="in">in</option>
          </select>
        </Field>
        <span className="text-[11px] text-muted-foreground">DPI: {dpi}</span>
      </div>
      <div className="overflow-auto rounded-xl border border-border/70 bg-card/40 p-2">
        <canvas
          ref={canvasRef}
          width={orientation === 'horizontal' ? 900 : 120}
          height={orientation === 'horizontal' ? 120 : 560}
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
          className="cursor-crosshair touch-none"
          style={{ width: orientation === 'horizontal' ? '100%' : '120px', maxWidth: '100%' }}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Measured" value={measure != null ? fmt(measure) : 'Drag on ruler'} mono />
        <Stat label="Orientation" value={orientation} />
        <div className="flex items-end"><CopyBtn value={measure != null ? fmt(measure) : ''} label="Copy value" /></div>
      </div>
      <p className="text-[11px] text-muted-foreground">Tip: click and drag along the ruler to measure a distance. DPI is auto-detected from the browser; switch units for physical measurements.</p>
    </div>
  );
}