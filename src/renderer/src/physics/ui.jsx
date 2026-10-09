import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Pause, SkipForward, RotateCcw, Download, Camera, Save, Upload } from 'lucide-react';
import { Button } from './ui/button.jsx';

// DPR-aware canvas that fills its container and exposes the DOM node via ref.
export const CanvasStage = forwardRef(function CanvasStage({ className = '' }, ref) {
  const inner = useRef(null);
  useEffect(() => {
    const cv = inner.current; if (!cv) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, Math.floor(cv.clientWidth * dpr));
      cv.height = Math.max(1, Math.floor(cv.clientHeight * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    return () => ro.disconnect();
  }, []);
  useImperativeHandle(ref, () => inner.current, []);
  return <canvas ref={inner} className={`w-full h-full block ${className}`} />;
});

export function stageBg(ctx, w, h) {
  ctx.fillStyle = 'hsl(222 47% 6%)';
  ctx.fillRect(0, 0, w, h);
}

export function TransportBar({ playing, onToggle, onStep, onReset, speed, onSpeed, t, unit = 's' }) {
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border/60 bg-card/40 px-3 py-2">
      <Button size="icon" variant={playing ? 'default' : 'outline'} onClick={onToggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button size="icon" variant="outline" onClick={onStep} aria-label="Step"><SkipForward /></Button>
      <Button size="icon" variant="outline" onClick={onReset} aria-label="Reset"><RotateCcw /></Button>
      <div className="flex items-center gap-2 ml-1">
        <span className="text-xs text-muted-foreground">Speed</span>
        <input type="range" min={0.1} max={4} step={0.1} value={speed} onChange={(e) => onSpeed(parseFloat(e.target.value))} className="w-28 accent-cyan-500" />
        <span className="text-xs font-mono w-12">{speed.toFixed(1)}×</span>
      </div>
      <span className="text-xs text-muted-foreground ml-auto font-mono">t = {t.toFixed(2)} {unit}</span>
    </div>
  );
}

function ParamField({ p, value, onChange }) {
  if (p.type === 'toggle') {
    return (
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{p.label}</span>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-500" />
      </label>
    );
  }
  if (p.type === 'select') {
    return (
      <label className="block text-sm">
        <span className="text-muted-foreground">{p.label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm">
          {p.options.map((o) => <option key={o.value} value={o.value} className="bg-background">{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label className="block text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{p.label}</span>
        <span className="font-mono text-xs">{typeof value === 'number' ? value.toFixed(p.step < 1 ? 2 : 0) : value}</span>
      </div>
      <input type="range" min={p.min} max={p.max} step={p.step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-cyan-500" />
    </label>
  );
}

export function ParamPanel({ schema, params, onChange }) {
  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parameters</div>
      {schema.map((p) => <ParamField key={p.key} p={p} value={params[p.key]} onChange={(v) => onChange({ ...params, [p.key]: v })} />)}
    </div>
  );
}

export function LiveGraph({ data, series, height = 160, xKey = 't', yLabel }) {
  if (!data || !data.length) return <div className="flex items-center justify-center text-xs text-muted-foreground rounded-xl border border-border/60 bg-card/40" style={{ height }}>Run the simulation to see graphs</div>;
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-2" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 10, bottom: 4, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
          <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
          {series.map((s) => <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} dot={false} strokeWidth={1.6} isAnimationActive={false} />)}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StatGrid({ stats }) {
  const entries = Object.entries(stats || {});
  if (!entries.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
          <div className="font-mono text-sm">{v}</div>
        </div>
      ))}
    </div>
  );
}

function download(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  return [keys.join(','), ...rows.map((r) => keys.map((k) => r[k]).join(','))].join('\n');
}

export function ExportBar({ graphData, config, canvasRef, name = 'simulation' }) {
  return (
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" onClick={() => download(toCSV(graphData), `${name}.csv`, 'text/csv')}><Download className="size-3.5" />CSV</Button>
      <Button size="sm" variant="outline" onClick={() => download(JSON.stringify({ config, data: graphData }, null, 2), `${name}.json`, 'application/json')}><Download className="size-3.5" />JSON</Button>
      <Button size="sm" variant="outline" onClick={() => { const cv = canvasRef.current; if (cv) { const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = `${name}.png`; a.click(); } }}><Camera className="size-3.5" />PNG</Button>
    </div>
  );
}

export function CameraControls({ cameraMode, setCameraMode, onRecenter, enabled, targets, targetIndex, setTargetIndex }) {
  if (!enabled) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground font-semibold uppercase tracking-wide">Viewport</span>
      <select value={cameraMode} onChange={(e) => setCameraMode(e.target.value)} className="rounded-md border border-input bg-transparent px-2 py-1">
        <option value="none" className="bg-background">Fixed</option>
        <option value="edge" className="bg-background">Follow (edge)</option>
        <option value="continuous" className="bg-background">Follow (centered)</option>
        <option value="follow-until-stop" className="bg-background">Follow until stop</option>
      </select>
      {targets && targets.length > 1 && (
        <select value={targetIndex} onChange={(e) => setTargetIndex(parseInt(e.target.value, 10))} className="rounded-md border border-input bg-transparent px-2 py-1">
          {targets.map((t, i) => <option key={i} value={i} className="bg-background">{t}</option>)}
        </select>
      )}
      <Button size="sm" variant="ghost" onClick={onRecenter}>Recenter</Button>
      <span className="text-muted-foreground/70 hidden sm:inline">Drag canvas to pan</span>
    </div>
  );
}

export function ConfigSaver({ name, config, onLoad }) {
  const key = `phys:${name}`;
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSaved(!!localStorage.getItem(key)); }, [key]);
  return (
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" onClick={() => { localStorage.setItem(key, JSON.stringify(config)); setSaved(true); }}><Save className="size-3.5" />Save config</Button>
      <Button size="sm" variant="ghost" disabled={!saved} onClick={() => { const s = localStorage.getItem(key); if (s) onLoad(JSON.parse(s)); }}><Upload className="size-3.5" />Load</Button>
    </div>
  );
}

export function SimLayout({ title, params, schema, setParams, configName, canvasRef, controls, graph, stats, exportBar, extra }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr_300px]">
      <div className="space-y-3">
        <ParamPanel schema={schema} params={params} onChange={setParams} />
        <ConfigSaver name={configName} config={params} onLoad={setParams} />
        {extra}
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden" style={{ height: 420 }}>
          <CanvasStage ref={canvasRef} />
        </div>
        {controls}
        {exportBar}
      </div>
      <div className="space-y-3">
        {stats}
        {graph}
      </div>
    </div>
  );
}