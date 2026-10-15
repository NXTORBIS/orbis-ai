import { useMemo, useState } from 'react';
import { Sliders } from 'lucide-react';
import { ToolHeader, Field, Out, CopyBtn, Panel, Stat } from './shared';
import ToolShell from './kit/ToolShell';

const STEPS = [['2xs', 0.5], ['xs', 0.75], ['sm', 0.875], ['base', 1], ['lg', 1.25], ['xl', 1.5], ['2xl', 2], ['3xl', 2.5]];

export default function ClampGenerator() {
  const [minSize, setMinSize] = useState(16);
  const [maxSize, setMaxSize] = useState(28);
  const [minVp, setMinVp] = useState(360);
  const [maxVp, setMaxVp] = useState(1280);
  const [preview, setPreview] = useState(768);

  const calc = useMemo(() => {
    const slopePxPerPx = (maxSize - minSize) / Math.max(1, maxVp - minVp);
    const slope = slopePxPerPx * 100;
    const intercept = (minSize - slopePxPerPx * minVp) / 16;
    const expression = `clamp(${minSize}px, calc(${slope.toFixed(3)}vw + ${intercept.toFixed(3)}rem), ${maxSize}px)`;
    const px = Math.min(maxSize, Math.max(minSize, minSize + slopePxPerPx * (preview - minVp)));
    return { slope, intercept, expression, px };
  }, [minSize, maxSize, minVp, maxVp, preview]);

  const scale = useMemo(() => STEPS.map(([name, factor]) => {
    const lo = Math.round(minSize * factor * 10) / 10;
    const hi = Math.round(maxSize * factor * 10) / 10;
    const slopePxPerPx = (hi - lo) / Math.max(1, maxVp - minVp);
    const slope = slopePxPerPx * 100;
    const intercept = (lo - slopePxPerPx * minVp) / 16;
    return { name, lo, hi, css: `clamp(${lo}px, calc(${slope.toFixed(3)}vw + ${intercept.toFixed(3)}rem), ${hi}px)` };
  }), [minSize, maxSize, minVp, maxVp]);

  const cssBlock = `:root {\n  --fluid-base: ${calc.expression};\n${scale.map((s) => `  --fluid-${s.name}: ${s.css};`).join('\n')}\n}`;

  return (
    <ToolShell
      toolId="fluid-size"
      icon={Sliders}
      title="Fluid Size Generator"
      desc="Type that scales smoothly between two viewport widths — no media queries needed."
      state={{ minSize, maxSize, minVp, maxVp, preview }}
      onRestore={(saved) => {
        setMinSize(saved.minSize); setMaxSize(saved.maxSize);
        setMinVp(saved.minVp); setMaxVp(saved.maxVp); setPreview(saved.preview);
      }}
      exportText={JSON.stringify({ calc, scale }, null, 2)}
      exportName="fluid-scale.json"
      exportMime="application/json"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Smallest size (px)"><input type="number" value={minSize} onChange={(e) => setMinSize(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Largest size (px)"><input type="number" value={maxSize} onChange={(e) => setMaxSize(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="From viewport (px)"><input type="number" value={minVp} onChange={(e) => setMinVp(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="To viewport (px)"><input type="number" value={maxVp} onChange={(e) => setMaxVp(Number(e.target.value))} className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>
      <Out label="CSS" value={`font-size: ${calc.expression};`}>
        <pre className="break-all font-mono-j text-xs text-cyan-j">font-size: {calc.expression};</pre>
      </Out>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Slope" value={`${calc.slope.toFixed(3)} vw`} mono />
        <Stat label="Intercept" value={`${calc.intercept.toFixed(3)} rem`} mono />
        <Stat label="Scales by" value={`${(maxSize - minSize).toFixed(0)}px`} />
      </div>
      <Panel>
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Live preview</span>
          <span className="font-mono-j text-cyan-j">{preview}px viewport · {calc.px.toFixed(1)}px text</span>
        </div>
        <input type="range" min={Math.max(240, minVp - 120)} max={Math.min(2560, maxVp + 240)} value={preview} onChange={(e) => setPreview(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-secondary/30 p-4">
          <div style={{ fontSize: `${calc.px}px`, lineHeight: 1.2 }} className="font-display font-bold">Fluid type</div>
          <div style={{ fontSize: `${(calc.px * 0.5).toFixed(1)}px` }} className="mt-1 text-muted-foreground">Body copy scales with the heading, holding the same visual rhythm at every width.</div>
        </div>
      </Panel>
      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">Whole scale from the same curve</span>
          <CopyBtn value={cssBlock} label="Copy CSS variables" />
        </div>
        <div className="space-y-1.5">
          {scale.map((s) => (
            <div key={s.name} className="flex items-center gap-3 rounded-lg border border-border/60 px-2.5 py-2">
              <span className="w-14 font-mono-j text-[11px] text-cyan-j">{s.name}</span>
              <span className="flex-1 truncate font-mono-j text-[10px] text-muted-foreground">{s.css}</span>
              <span className="text-[11px]">{s.lo}–{s.hi}px</span>
            </div>
          ))}
        </div>
      </Panel>
      <p className="text-[11px] text-muted-foreground">The maths: slope = (max − min) ÷ (max viewport − min viewport), and the intercept keeps both endpoints exact — the value never leaves the min–max range.</p>
    </ToolShell>
  );
}