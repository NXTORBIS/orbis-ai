import { useMemo, useState } from 'react';
import { Ruler } from 'lucide-react';
import { ToolHeader, Field, Seg, Stat, Panel, CopyBtn } from './shared';
import ToolShell from './kit/ToolShell';

const DPIS = [72, 96, 150, 300, 600];

const round = (value, digits = 2) => Number(value.toFixed(digits));

export default function PrintSize() {
  const [mode, setMode] = useState('px2size');
  const [px, setPx] = useState(3000);
  const [dpi, setDpi] = useState(300);
  const [unit, setUnit] = useState('cm');
  const [sizeCm, setSizeCm] = useState(25);
  const [targetDpi, setTargetDpi] = useState(300);

  const inchesFor = (pixels, d) => (d > 0 ? pixels / d : 0);

  const result = useMemo(() => {
    if (mode === 'px2size') {
      const inches = inchesFor(px, dpi);
      return { inches, cm: inches * 2.54, mm: inches * 25.4, dpiUsed: dpi, px };
    }
    if (mode === 'size2px') {
      const inches = unit === 'cm' ? sizeCm / 2.54 : unit === 'mm' ? sizeCm / 25.4 : sizeCm;
      return { inches, px: Math.round(inches * dpi), dpiUsed: dpi, pxAt300: Math.round(inches * 300) };
    }
    const inches = inchesFor(px, dpi);
    const newPx = Math.round(inches * targetDpi);
    return { inches, cm: inches * 2.54, mm: inches * 25.4, currentPx: px, newPx, factor: targetDpi / dpi, dpiUsed: dpi };
  }, [mode, px, dpi, unit, sizeCm, targetDpi]);

  const table = useMemo(() => DPIS.map((d) => ({ dpi: d, inches: round(inchesFor(px, d)), cm: round((inchesFor(px, d)) * 2.54) })), [px]);

  return (
    <ToolShell
      toolId="print-size"
      icon={Ruler}
      title="PPI / DPI & Print Size"
      desc="Convert between pixels and printed dimensions, and see what a target DPI demands."
      state={{ mode, px, dpi, unit, sizeCm, targetDpi }}
      onRestore={(saved) => {
        setMode(saved.mode); setPx(saved.px); setDpi(saved.dpi);
        setUnit(saved.unit); setSizeCm(saved.sizeCm); setTargetDpi(saved.targetDpi);
      }}
      exportText={JSON.stringify({ result, table }, null, 2)}
      exportName="print-size.json"
      exportMime="application/json"
    >
      <Seg value={mode} onChange={setMode} options={[{ value: 'px2size', label: 'Pixels → size' }, { value: 'size2px', label: 'Size → pixels' }, { value: 'resample', label: 'Change DPI' }]} />
      <div className="grid gap-3 sm:grid-cols-2">
        {mode !== 'size2px' && (
          <Field label="Image width (pixels)"><input type="number" value={px} onChange={(e) => setPx(Math.max(0, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        )}
        {mode === 'size2px' && (
          <>
            <Field label={`Printed size (${unit})`}><input type="number" value={sizeCm} onChange={(e) => setSizeCm(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
            <Field label="Unit">
              <Seg value={unit} onChange={setUnit} options={[{ value: 'cm', label: 'Centimetres' }, { value: 'mm', label: 'Millimetres' }, { value: 'in', label: 'Inches' }]} />
            </Field>
          </>
        )}
        <Field label="Resolution (DPI / PPI)">
          <div className="space-y-2">
            <input type="number" value={dpi} onChange={(e) => setDpi(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
            <div className="flex flex-wrap gap-1.5">
              {DPIS.map((d) => (
                <button key={d} onClick={() => setDpi(d)} className={`rounded-lg border px-2 py-0.5 text-[11px] transition ${dpi === d ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{d}</button>
              ))}
            </div>
          </div>
        </Field>
        {mode === 'resample' && (
          <Field label="Target DPI">
            <div className="space-y-2">
              <input type="number" value={targetDpi} onChange={(e) => setTargetDpi(Math.max(1, Number(e.target.value)))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              <div className="flex flex-wrap gap-1.5">
                {[150, 300].map((d) => (
                  <button key={d} onClick={() => setTargetDpi(d)} className={`rounded-lg border px-2 py-0.5 text-[11px] transition ${targetDpi === d ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/70 text-muted-foreground hover:border-cyan-j/40'}`}>{d} dpi</button>
                ))}
              </div>
            </div>
          </Field>
        )}
      </div>
      <Panel className="text-center">
        {mode === 'px2size' && (
          <>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Print size at {dpi} dpi</div>
            <div className="mt-1 font-display text-3xl font-bold text-cyan-j">{result.cm.toFixed(2)} cm</div>
            <div className="mt-1 text-xs text-muted-foreground">{result.inches.toFixed(2)} in · {result.mm.toFixed(1)} mm</div>
          </>
        )}
        {mode === 'size2px' && (
          <>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Pixels needed at {dpi} dpi</div>
            <div className="mt-1 font-display text-3xl font-bold text-cyan-j">{result.px.toLocaleString()} px</div>
            <div className="mt-1 text-xs text-muted-foreground">A 300 dpi version would need {result.pxAt300.toLocaleString()} px</div>
          </>
        )}
        {mode === 'resample' && (
          <>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Size after hitting {targetDpi} dpi</div>
            <div className="mt-1 font-display text-3xl font-bold text-cyan-j">{px.toLocaleString()} → {result.newPx.toLocaleString()} px</div>
            <div className="mt-1 text-xs text-muted-foreground">scale ×{result.factor.toFixed(3)} · same print size, {result.cm.toFixed(2)} cm wide</div>
          </>
        )}
      </Panel>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Width in pixels" value={String(mode === 'resample' ? result.newPx : mode === 'size2px' ? result.px : px)} />
        <Stat label="Inches" value={result.inches.toFixed(2)} />
        <Stat label="Centimetres" value={result.cm.toFixed(2)} />
        <Stat label="Millimetres" value={result.mm.toFixed(1)} />
      </div>
      <Panel>
        <div className="mb-2 text-xs font-medium text-muted-foreground">This pixel width at every common resolution</div>
        <div className="space-y-1.5">
          {table.map((row) => (
            <div key={row.dpi} className="flex items-center gap-3 text-xs">
              <span className="w-14 font-mono-j text-cyan-j">{row.dpi} dpi</span>
              <span className="flex-1 text-muted-foreground">{row.cm} cm</span>
              <span className="w-16 text-right text-muted-foreground">{row.inches} in</span>
            </div>
          ))}
        </div>
      </Panel>
      <CopyBtn
        value={mode === 'px2size'
          ? `${result.cm.toFixed(2)} cm (${result.inches.toFixed(2)} in) at ${dpi} dpi`
          : mode === 'size2px'
            ? `${result.px} px at ${dpi} dpi`
            : `${px} px → ${result.newPx} px for ${targetDpi} dpi`}
        label="Copy result"
      />
      <p className="text-[11px] text-muted-foreground">300 dpi is the usual print standard, 150 dpi suits large-format posters, and screens display between 72 and 96 dpi — the pixel count matters more than the DPI tag on the file.</p>
    </ToolShell>
  );
}