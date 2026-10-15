import { useMemo, useRef, useState } from 'react';
import { Squircle } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow } from './shared';

const PRESETS = {
  triangle: [[50, 0], [100, 100], [0, 100]],
  diamond: [[50, 0], [100, 50], [50, 100], [0, 50]],
  pentagon: [[50, 0], [98, 35], [80, 95], [20, 95], [2, 35]],
  hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
  octagon: [[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]],
  star: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]],
  cross: [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]],
  arrow: [[0, 30], [60, 30], [60, 0], [100, 50], [60, 100], [60, 70], [0, 70]],
  chevron: [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]],
  message: [[0, 0], [100, 0], [100, 75], [30, 75], [12, 100], [12, 75], [0, 75]],
  rhombus: [[50, 0], [95, 50], [50, 100], [5, 50]],
  parallelogram: [[25, 0], [100, 0], [75, 100], [0, 100]],
  trapezoid: [[20, 0], [80, 0], [100, 100], [0, 100]],
  circle: [[50, 50]],
};

export default function ClipPathGenerator() {
  const [type, setType] = useState('polygon');
  const [points, setPoints] = useState(PRESETS.hexagon);
  const [circle, setCircle] = useState({ size: 50, x: 50, y: 50 });
  const [ellipse, setEllipse] = useState({ rx: 50, ry: 35, x: 50, y: 50 });
  const [inset, setInset] = useState({ top: 10, right: 10, bottom: 10, left: 10, radius: 12 });
  const [showOutline, setShowOutline] = useState(true);
  const [drag, setDrag] = useState(null);
  const stageRef = useRef(null);

  const css = useMemo(() => {
    if (type === 'circle') return `circle(${circle.size}% at ${circle.x}% ${circle.y}%)`;
    if (type === 'ellipse') return `ellipse(${ellipse.rx}% ${ellipse.ry}% at ${ellipse.x}% ${ellipse.y}%)`;
    if (type === 'inset') return `inset(${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}% round ${inset.radius}px)`;
    return `polygon(${points.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
  }, [type, points, circle, ellipse, inset]);

  const onMove = (event) => {
    if (drag === null || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100)));
    setPoints((current) => current.map((p, i) => (i === drag ? [x, y] : p)));
  };

  const updatePoint = (index, axis, value) => {
    const n = Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
    setPoints((current) => current.map((p, i) => (i === index ? (axis === 'x' ? [n, p[1]] : [p[0], n]) : p)));
  };

  return (
    <ToolShell
      toolId="clip-path"
      icon={Squircle}
      title="CSS Clip-Path Generator"
      desc="Shape an element with polygons, circles, ellipses or rounded insets — drag the handles and copy the CSS."
      state={{ type, points, circle, ellipse, inset }}
      onRestore={(saved) => {
        setType(saved.type || 'polygon');
        if (Array.isArray(saved.points) && saved.points.length) setPoints(saved.points);
        if (saved.circle) setCircle(saved.circle);
        if (saved.ellipse) setEllipse(saved.ellipse);
        if (saved.inset) setInset(saved.inset);
      }}
      exportText={`clip-path: ${css};`}
      exportName="clip-path.css"
      exportMime="text/css"
    >
      <Seg
        value={type}
        onChange={setType}
        options={[
          { value: 'polygon', label: 'Polygon' },
          { value: 'circle', label: 'Circle' },
          { value: 'ellipse', label: 'Ellipse' },
          { value: 'inset', label: 'Inset' },
        ]}
      />

      <div
        ref={stageRef}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
        className="relative mx-auto aspect-square w-full max-w-sm touch-none select-none rounded-xl border border-border/70 bg-gradient-to-br from-cyan-j/25 via-fuchsia-500/20 to-amber-400/20"
      >
        <div
          className={`absolute inset-0 rounded-xl bg-gradient-to-br from-cyan-j/70 via-fuchsia-500/60 to-amber-400/70 ${showOutline ? 'outline outline-1 outline-cyan-j/50' : ''}`}
          style={{ clipPath: css }}
        />
        {type === 'polygon' &&
          points.map(([x, y], i) => (
            <button
              key={i}
              type="button"
              onPointerDown={() => setDrag(i)}
              className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition ${drag === i ? 'border-white bg-cyan-j scale-110' : 'border-cyan-j bg-background/80'}`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`Point ${i + 1}`}
            />
          ))}
      </div>

      <ToggleRow label="Outline the shape" checked={showOutline} onChange={setShowOutline} />

      {type === 'polygon' && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PRESETS).filter(([, pts]) => pts.length > 1).map(([name, pts]) => (
              <button
                key={name}
                type="button"
                onClick={() => setPoints(pts)}
                className="rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] capitalize text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
              >
                {name}
              </button>
            ))}
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">{points.length} points</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPoints((p) => [...p, [50, 50]])}
                  className="text-[11px] text-cyan-j transition hover:underline"
                >
                  Add point
                </button>
                <button
                  type="button"
                  onClick={() => setPoints((p) => (p.length > 3 ? p.slice(0, -1) : p))}
                  className="text-[11px] text-muted-foreground transition hover:text-red-500"
                >
                  Remove last
                </button>
              </div>
            </div>
            <div className="max-h-56 space-y-1 overflow-auto scrollbar-thin">
              {points.map(([x, y], i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1">
                  <span className="w-14 text-[11px] text-muted-foreground">P{i + 1}</span>
                  <input type="number" min={0} max={100} value={x} onChange={(e) => updatePoint(i, 'x', e.target.value)} className="h-7 w-16 rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
                  <input type="number" min={0} max={100} value={y} onChange={(e) => updatePoint(i, 'y', e.target.value)} className="h-7 w-16 rounded-md border border-input bg-transparent px-2 font-mono-j text-[11px]" />
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
              ))}
            </div>
          </Panel>
        </>
      )}

      {type === 'circle' && (
        <Panel className="space-y-3">
          {[['Radius', 'size'], ['Centre X', 'x'], ['Centre Y', 'y']].map(([label, key]) => (
            <Field key={key} label={`${label} · ${circle[key]}%`}>
              <input type="range" min={5} max={type === 'circle' && key === 'size' ? 75 : 100} value={circle[key]} onChange={(e) => setCircle({ ...circle, [key]: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          ))}
        </Panel>
      )}

      {type === 'ellipse' && (
        <Panel className="space-y-3">
          {[['Radius X', 'rx'], ['Radius Y', 'ry'], ['Centre X', 'x'], ['Centre Y', 'y']].map(([label, key]) => (
            <Field key={key} label={`${label} · ${ellipse[key]}%`}>
              <input type="range" min={5} max={100} value={ellipse[key]} onChange={(e) => setEllipse({ ...ellipse, [key]: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          ))}
        </Panel>
      )}

      {type === 'inset' && (
        <Panel className="space-y-3">
          {['top', 'right', 'bottom', 'left'].map((key) => (
            <Field key={key} label={`${key[0].toUpperCase()}${key.slice(1)} · ${inset[key]}%`}>
              <input type="range" min={0} max={45} value={inset[key]} onChange={(e) => setInset({ ...inset, [key]: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
            </Field>
          ))}
          <Field label={`Corner radius · ${inset.radius}px`}>
            <input type="range" min={0} max={120} value={inset.radius} onChange={(e) => setInset({ ...inset, radius: Number(e.target.value) })} className="w-full accent-[hsl(var(--cyan))]" />
          </Field>
        </Panel>
      )}

      <Stat label="Shape" value={type === 'polygon' ? `${points.length} points` : type} />

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">CSS</span>
          <CopyBtn value={`clip-path: ${css};`} />
        </div>
        <pre className="overflow-auto whitespace-pre-wrap font-mono-j text-[11px] scrollbar-thin">{`clip-path: ${css};`}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Percentages are relative to the element's own box, so the shape scales with whatever you apply it to.
          Remember to keep a fallback for browsers without clip-path support.
        </p>
      </Panel>
    </ToolShell>
  );
}