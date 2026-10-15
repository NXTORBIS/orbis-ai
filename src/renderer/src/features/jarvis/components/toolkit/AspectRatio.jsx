import { useMemo, useState } from 'react';
import { Scaling } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const COMMON = [
  ['16:9', 16, 9], ['4:3', 4, 3], ['3:2', 3, 2], ['1:1', 1, 1], ['21:9', 21, 9], ['5:4', 5, 4],
  ['9:16', 9, 16], ['2:3', 2, 3], ['3:4', 3, 4], ['1.85:1', 1.85, 1], ['2.39:1', 2.39, 1],
];

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

export default function AspectRatio() {
  const [mode, setMode] = useState('missing');
  const [width, setWidth] = useState(1280);
  const [ratioValue, setRatioValue] = useState('16:9');
  const [customW, setCustomW] = useState(16);
  const [customH, setCustomH] = useState(9);
  const [contentW, setContentW] = useState(1200);
  const [contentH, setContentH] = useState(630);
  const [boxW, setBoxW] = useState(800);
  const [boxH, setBoxH] = useState(800);

  const ratio = useMemo(() => {
    if (ratioValue === 'custom') return { w: Math.max(1, customW), h: Math.max(1, customH) };
    const found = COMMON.find(([label]) => label === ratioValue);
    return found ? { w: found[1], h: found[2] } : { w: 16, h: 9 };
  }, [ratioValue, customW, customH]);

  const missing = useMemo(() => {
    const height = Math.round((width * ratio.h) / ratio.w);
    return { width, height, decimal: ratio.w / ratio.h, megapixels: (width * height) / 1e6 };
  }, [width, ratio]);

  const fit = useMemo(() => {
    const scaleContain = Math.min(boxW / contentW, boxH / contentH);
    const scaleCover = Math.max(boxW / contentW, boxH / contentH);
    const contain = { w: Math.round(contentW * scaleContain), h: Math.round(contentH * scaleContain) };
    const cover = { w: Math.round(contentW * scaleCover), h: Math.round(contentH * scaleCover) };
    return {
      contain,
      cover,
      marginX: Math.round((boxW - contain.w) / 2),
      marginY: Math.round((boxH - contain.h) / 2),
      cropX: Math.round((cover.w - boxW) / 2),
      cropY: Math.round((cover.h - boxH) / 2),
    };
  }, [contentW, contentH, boxW, boxH]);

  const identify = useMemo(() => {
    const divisor = gcd(contentW, contentH) || 1;
    const decimal = contentW / contentH;
    const nearest = COMMON.map(([label, w, h]) => ({ label, w, h, delta: Math.abs(w / h - decimal) })).sort((a, b) => a.delta - b.delta)[0];
    return { divisor, simpleW: contentW / divisor, simpleH: contentH / divisor, decimal, nearest, delta: Math.abs(nearest.w / nearest.h - decimal) };
  }, [contentW, contentH]);

  return (
    <ToolShell
      toolId="aspect-ratio"
      icon={Scaling}
      title="Aspect Ratio & Fit Calculator"
      desc="Find the missing side, fit an image into a box, or identify the ratio of any size."
      state={{ mode, width, ratioValue, customW, customH, contentW, contentH, boxW, boxH }}
      onRestore={(saved) => {
        setMode(saved.mode); setWidth(saved.width); setRatioValue(saved.ratioValue);
        setCustomW(saved.customW); setCustomH(saved.customH); setContentW(saved.contentW);
        setContentH(saved.contentH); setBoxW(saved.boxW); setBoxH(saved.boxH);
      }}
      exportText={JSON.stringify({ ratio, missing, fit, identify }, null, 2)}
      exportName="aspect-ratio.json"
      exportMime="application/json"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'missing', label: 'Missing side' }, { value: 'fit', label: 'Fit in a box' }, { value: 'identify', label: 'Identify ratio' }]} />
      {mode === 'missing' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Known width (px)"><input type="number" value={width} onChange={(e) => setWidth(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Aspect ratio">
              <select value={ratioValue} onChange={(e) => setRatioValue(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {COMMON.map(([label]) => <option key={label} value={label}>{label}</option>)}
                <option value="custom">Custom…</option>
              </select>
            </Field>
            {ratioValue === 'custom' && (
              <>
                <Field label="Ratio width part"><input type="number" value={customW} onChange={(e) => setCustomW(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
                <Field label="Ratio height part"><input type="number" value={customH} onChange={(e) => setCustomH(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Width" value={`${missing.width} px`} />
            <Stat label="Height" value={`${missing.height} px`} />
            <Stat label="Ratio value" value={missing.decimal.toFixed(3)} />
            <Stat label="Megapixels" value={missing.megapixels.toFixed(2)} />
          </div>
          <Panel className="grid place-items-center">
            <div className="w-full max-w-xs rounded-lg border border-cyan-j/40 bg-cyan-j/10" style={{ aspectRatio: `${ratio.w} / ${ratio.h}` }} />
          </Panel>
          <CopyBtn value={`${missing.width}×${missing.height}`} label="Copy size" />
        </>
      )}
      {mode === 'fit' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Content width (px)"><input type="number" value={contentW} onChange={(e) => setContentW(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Content height (px)"><input type="number" value={contentH} onChange={(e) => setContentH(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Box width (px)"><input type="number" value={boxW} onChange={(e) => setBoxW(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Box height (px)"><input type="number" value={boxH} onChange={(e) => setBoxH(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Contain size" value={`${fit.contain.w} × ${fit.contain.h}`} />
            <Stat label="Letterbox" value={`${fit.marginX} × ${fit.marginY} px`} />
            <Stat label="Cover size" value={`${fit.cover.w} × ${fit.cover.h}`} />
            <Stat label="Cropped off" value={`${fit.cropX} × ${fit.cropY} px`} />
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Preview inside the box</div>
            <div className="mx-auto flex items-center justify-center rounded-lg border border-border/70 bg-secondary/30" style={{ width: '100%', maxWidth: 320, aspectRatio: `${boxW} / ${boxH}` }}>
              <div className="flex items-center justify-center rounded border border-dashed border-cyan-j/60 bg-cyan-j/15 text-[10px] text-cyan-j" style={{ width: `${(fit.contain.w / boxW) * 100}%`, aspectRatio: `${contentW} / ${contentH}` }}>
                contain
              </div>
            </div>
          </Panel>
          <p className="text-[11px] text-muted-foreground">Contain keeps the whole picture visible and pads the leftover space; cover fills the box completely and trims the overflow — the two numbers you need for CSS <span className="font-mono-j">object-fit</span>.</p>
        </>
      )}
      {mode === 'identify' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Width (px)"><input type="number" value={contentW} onChange={(e) => setContentW(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Height (px)"><input type="number" value={contentH} onChange={(e) => setContentH(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Simplified" value={`${identify.simpleW}:${identify.simpleH}`} />
            <Stat label="Decimal" value={identify.decimal.toFixed(4)} />
            <Stat label="Closest standard" value={identify.nearest.label} />
            <Stat label="Difference" value={`${((identify.delta / (identify.nearest.w / identify.nearest.h)) * 100).toFixed(2)}%`} />
          </div>
          <Panel>
            <div className="mb-2 text-xs font-medium text-muted-foreground">Standard ratios ranked for this size</div>
            <div className="space-y-1.5">
              {COMMON.map(([label, w, h]) => {
                const delta = Math.abs(w / h - identify.decimal);
                return (
                  <div key={label} className="flex items-center gap-3 text-xs">
                    <span className="w-16 font-mono-j text-cyan-j">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-cyan-j/60" style={{ width: `${Math.max(2, 100 - Math.min(100, delta * 120))}%` }} />
                    </div>
                    <span className="w-20 text-right text-muted-foreground">{h === 1 ? `${w}:1` : `${h} high`}</span>
                  </div>
                );
              })}
            </div>
          </Panel>
          <CopyBtn value={`${identify.simpleW}:${identify.simpleH}`} label="Copy simplified ratio" />
        </>
      )}
    </ToolShell>
  );
}