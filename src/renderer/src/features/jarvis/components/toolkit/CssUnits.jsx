import { useMemo, useState } from 'react';
import { Ruler } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const UNITS = [
  { id: 'px', label: 'px' },
  { id: 'rem', label: 'rem' },
  { id: 'em', label: 'em' },
  { id: 'vw', label: 'vw' },
  { id: 'vh', label: 'vh' },
  { id: 'percent', label: '%' },
];

const SCALE = [4, 8, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96];

export default function CssUnits() {
  const [value, setValue] = useState('24');
  const [unit, setUnit] = useState('px');
  const [base, setBase] = useState('16');
  const [parent, setParent] = useState('16');
  const [viewportW, setViewportW] = useState(() => String(typeof window === 'undefined' ? 1440 : window.innerWidth));
  const [viewportH, setViewportH] = useState(() => String(typeof window === 'undefined' ? 900 : window.innerHeight));
  const [container, setContainer] = useState('960');
  const [clampMin, setClampMin] = useState('16');
  const [clampMax, setClampMax] = useState('24');
  const [minVw, setMinVw] = useState('360');
  const [maxVw, setMaxVw] = useState('1440');

  const baseNum = Number(base) || 16;
  const parentNum = Number(parent) || 16;
  const viewportWidth = Number(viewportW) || 1440;
  const viewportHeight = Number(viewportH) || 900;
  const containerWidth = Number(container) || 960;
  const current = Number(value) || 0;

  const conversions = useMemo(() => {
    const toPx = {
      px: current,
      rem: current * baseNum,
      em: current * parentNum,
      vw: (current / 100) * viewportWidth,
      vh: (current / 100) * viewportHeight,
      percent: (current / 100) * containerWidth,
    }[unit] ?? current;

    const safe = (number) => (Number.isFinite(number) ? number : 0);
    const fromPx = {
      px: toPx,
      rem: toPx / baseNum,
      em: toPx / parentNum,
      vw: (toPx / viewportWidth) * 100,
      vh: (toPx / viewportHeight) * 100,
      percent: (toPx / containerWidth) * 100,
    };

    return { toPx, fromPx };
  }, [current, unit, baseNum, parentNum, viewportWidth, viewportHeight, containerWidth]);

  const clamp = useMemo(() => {
    const minPx = Number(clampMin) || 16;
    const maxPx = Number(clampMax) || 24;
    const minViewport = Number(minVw) || 360;
    const maxViewport = Number(maxVw) || 1440;
    const minRem = minPx / 16;
    const maxRem = maxPx / 16;
    const slope = (maxPx - minPx) / (maxViewport - minViewport);
    const vwCoefficient = slope * 100;
    const intercept = (minPx - slope * minViewport) / 16;
    const preferred = `${vwCoefficient.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}vw`;
    const value = `clamp(${minRem.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}rem, ${preferred} ${intercept >= 0 ? '+' : '−'} ${Math.abs(intercept).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}rem, ${maxRem.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}rem)`;
    const at = (width) => Math.min(maxPx, Math.max(minPx, minPx + slope * (width - minViewport)));
    return { value, at, atMin: at(minViewport), atMid: at((minViewport + maxViewport) / 2), atMax: at(maxViewport), minPx, maxPx, minViewport, maxViewport };
  }, [clampMin, clampMax, minVw, maxVw]);

  const css = unit === 'px'
    ? `${conversions.toPx.toFixed(2)}px`
    : `${current}${unit === 'percent' ? '%' : unit}`;

  const report = [
    `${current}${unit === 'percent' ? '%' : unit} = ${conversions.toPx.toFixed(2)}px`,
    `Base font ${baseNum}px · parent font ${parentNum}px · viewport ${viewportWidth}×${viewportHeight}`,
    `rem ${conversions.fromPx.rem.toFixed(4)} · em ${conversions.fromPx.em.toFixed(4)} · vw ${conversions.fromPx.vw.toFixed(3)} · % ${conversions.fromPx.percent.toFixed(3)}`,
    '',
    `font-size: ${clamp.value};`,
    `→ ${clamp.atMin.toFixed(1)}px at ${clamp.minViewport}px, ${clamp.atMid.toFixed(1)}px at ${Math.round((clamp.minViewport + clamp.maxViewport) / 2)}px, ${clamp.atMax.toFixed(1)}px at ${clamp.maxViewport}px`,
  ].join('\n');

  const previewPx = Math.max(1, Math.min(360, conversions.toPx));

  return (
    <ToolShell
      toolId="css-units"
      icon={Ruler}
      title="CSS Units & Clamp"
      desc="Convert between px, rem, em, vw, vh and percentages with your real base and viewport, and generate fluid clamp() values that actually compute."
      state={{ value, unit, base, parent, container, clampMin, clampMax, minVw, maxVw }}
      onRestore={(restored) => {
        if (restored.value !== undefined) setValue(String(restored.value));
        if (restored.unit) setUnit(restored.unit);
        if (restored.base !== undefined) setBase(String(restored.base));
        if (restored.parent !== undefined) setParent(String(restored.parent));
        if (restored.container !== undefined) setContainer(String(restored.container));
        if (restored.clampMin !== undefined) setClampMin(String(restored.clampMin));
        if (restored.clampMax !== undefined) setClampMax(String(restored.clampMax));
        if (restored.minVw !== undefined) setMinVw(String(restored.minVw));
        if (restored.maxVw !== undefined) setMaxVw(String(restored.maxVw));
      }}
      exportText={report}
      exportName="css-units.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={unit} onChange={setUnit} options={UNITS} />
        <button
          type="button"
          onClick={() => { setViewportW(String(window.innerWidth)); setViewportH(String(window.innerHeight)); }}
          className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          Use my current viewport
        </button>
        <CopyBtn value={css} label="Copy value" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Value">
          <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Base font size (html)" hint="rem is relative to this">
          <input value={base} onChange={(e) => setBase(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Parent font size" hint="em is relative to this">
          <input value={parent} onChange={(e) => setParent(e.target.value)} inputMode="decimal" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Container width" hint="what 100% refers to here">
          <input value={container} onChange={(e) => setContainer(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Viewport width">
          <input value={viewportW} onChange={(e) => setViewportW(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Viewport height">
          <input value={viewportH} onChange={(e) => setViewportH(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label={`${current}${unit === 'percent' ? '%' : unit} in pixels`}
          value={conversions.toPx.toFixed(2)}
          unit="px"
          sub={`at ${baseNum}px base, ${parentNum}px parent and a ${viewportWidth}px viewport`}
        />
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Every other unit at this value</div>
          <div className="space-y-1">
            {Object.entries(conversions.fromPx).map(([key, amount]) => (
              <div key={key} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/40 px-2.5 py-1.5 text-[11px]">
                <span className="text-muted-foreground">{key === 'percent' ? '%' : key}</span>
                <span className="font-mono-j text-cyan-j">
                  {amount.toFixed(amount < 10 ? 4 : 2)}{key === 'percent' ? '%' : key === 'px' ? '' : ''}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Actual size on screen</div>
        <div className="flex items-end gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
          <div className="flex flex-col items-center">
            <div className="rounded-t bg-gradient-to-t from-cyan-j/20 to-cyan-j/60" style={{ width: `${previewPx}px`, height: '48px' }} />
            <span className="mt-1 font-mono-j text-[10px] text-cyan-j">{conversions.toPx.toFixed(1)}px</span>
          </div>
          <div className="flex-1 text-[11px] text-muted-foreground">
            <p>· The cyan block is that measurement rendered at true pixel size on this display.</p>
            <p>· {unit === 'rem' ? 'A rem scales with the root font size — change the browser default and every rem measurement moves with it, which is what makes layouts accessible.' : unit === 'em' ? 'An em compounds: nested elements each multiply by their own font size, which is why padding in em can surprise you.' : unit === 'vh' || unit === 'vw' ? 'Viewport units follow the window, so they are perfect for full-height sections and terrible where the browser chrome changes size on mobile.' : 'Pixels are absolute and predictable, but they ignore the user\'s font-size preference.'}</p>
          </div>
        </div>
      </Panel>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">A useful scale in every unit</div>
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-right font-mono-j text-[11px]">
            <thead className="sticky top-0 bg-card/95 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="border-b border-border/50 px-2 py-1 text-left">px</th>
                <th className="border-b border-border/50 px-2 py-1">rem</th>
                <th className="border-b border-border/50 px-2 py-1">em</th>
                <th className="border-b border-border/50 px-2 py-1">vw</th>
                <th className="border-b border-border/50 px-2 py-1">%</th>
              </tr>
            </thead>
            <tbody>
              {SCALE.map((size) => (
                <tr key={size} className="border-b border-border/30">
                  <td className="px-2 py-1 text-left text-muted-foreground">{size}</td>
                  <td className="px-2 py-1 text-cyan-j">{(size / baseNum).toFixed(3)}</td>
                  <td className="px-2 py-1">{(size / parentNum).toFixed(3)}</td>
                  <td className="px-2 py-1">{(size / viewportWidth * 100).toFixed(3)}</td>
                  <td className="px-2 py-1">{(size / containerWidth * 100).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Minimum size (px)">
          <input value={clampMin} onChange={(e) => setClampMin(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Maximum size (px)">
          <input value={clampMax} onChange={(e) => setClampMax(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Below this viewport (px)">
          <input value={minVw} onChange={(e) => setMinVw(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
        <Field label="Above this viewport (px)">
          <input value={maxVw} onChange={(e) => setMaxVw(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-right font-mono-j text-sm" />
        </Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Fluid value</span>
          <CopyBtn value={`font-size: ${clamp.value};`} label="Copy the declaration" />
        </div>
        <pre className="whitespace-pre-wrap break-all font-mono-j text-[11px] text-cyan-j">{`font-size: ${clamp.value};`}</pre>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Stat label={`At ${clamp.minViewport}px`} value={`${clamp.atMin.toFixed(1)}px`} mono />
          <Stat label={`At ${Math.round((clamp.minViewport + clamp.maxViewport) / 2)}px`} value={`${clamp.atMid.toFixed(1)}px`} mono />
          <Stat label={`At ${clamp.maxViewport}px`} value={`${clamp.atMax.toFixed(1)}px`} mono />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          This is the pattern that replaces media queries for type: a size that grows with the viewport but never goes below {clamp.minPx}px or above{' '}
          {clamp.maxPx}px. Keep the middle term in vw plus a rem offset — mixing in percentages or vh makes it unpredictable.
        </p>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="px" value={conversions.fromPx.px.toFixed(2)} mono />
        <Stat label="rem" value={conversions.fromPx.rem.toFixed(4)} mono />
        <Stat label="vw" value={conversions.fromPx.vw.toFixed(3)} mono />
        <Stat label="%" value={conversions.fromPx.percent.toFixed(3)} mono />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Choosing a unit without guessing</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· Use rem for anything that should respect the user's font-size setting — type, spacing, radii. That is most of a UI.</p>
          <p>· Use px for hairlines, borders and things that must not scale, like a 1px focus ring.</p>
          <p>· Use % for widths inside a layout and vw/vh for full-bleed sections; on mobile, prefer dvh over vh so the browser bar does not cut off the layout.</p>
          <p>· Use em only where compounding is what you want — icon sizes that track their label, for instance.</p>
          <p>· A 1.25 major-third scale gives you {SCALE.slice(3, 10).join(', ')} — pick a handful and stop inventing new numbers.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Input', value: `${current}${unit === 'percent' ? '%' : unit}` },
              { label: 'Base', value: `${baseNum}px` },
              { label: 'Result', value: `${conversions.toPx.toFixed(1)}px` },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The conversions use the numbers you give them rather than an assumed 16px root, because the two mistakes that break a rem-based layout are a root
          font size that is not 16 and an em value nested inside something that already changed the font size. Set both fields to your real values and the
          table above becomes a reference you can trust.
        </p>
      </Panel>
    </ToolShell>
  );
}