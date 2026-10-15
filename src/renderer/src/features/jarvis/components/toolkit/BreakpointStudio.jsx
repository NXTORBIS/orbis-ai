import { useMemo, useState } from 'react';
import { Smartphone, Plus, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Bars, Hero, Pills, Ring } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const DEVICES = [
  { label: 'Small phone', width: 360 },
  { label: 'Phone', width: 390 },
  { label: 'Large phone', width: 430 },
  { label: 'Foldable, closed', width: 500 },
  { label: 'Tablet portrait', width: 768 },
  { label: 'Tablet landscape', width: 1024 },
  { label: 'Laptop', width: 1280 },
  { label: 'Desktop', width: 1440 },
  { label: 'Large desktop', width: 1920 },
  { label: 'Ultrawide', width: 2560 },
];

export default function BreakpointStudio() {
  const [points, setPoints] = useState([
    { id: 'a', name: 'sm', min: '640' },
    { id: 'b', name: 'md', min: '768' },
    { id: 'c', name: 'lg', min: '1024' },
    { id: 'd', name: 'xl', min: '1280' },
    { id: 'e', name: '2xl', min: '1536' },
  ]);
  const [strategy, setStrategy] = useState('mobile');
  const [container, setContainer] = useState('1200');
  const [gutter, setGutter] = useState('24');
  const [viewport, setViewport] = useState('390');
  const [headingMin, setHeadingMin] = useState('28');
  const [headingMax, setHeadingMax] = useState('48');

  const set = (id, key, value) => setPoints((current) => current.map((row) => (row.id === key ? value : row)));

  const result = useMemo(() => {
    const sorted = points
      .map((row) => ({ ...row, value: Math.max(240, Number(row.min) || 0) }))
      .sort((a, b) => a.value - b.value);

    const width = Math.max(240, Number(viewport) || 390);
    const maxContainer = Number(container) || 1200;
    const pad = Number(gutter) || 24;

    const activeIndex = sorted.reduce((best, row, index) => (width >= row.value ? index : best), -1);
    const active = activeIndex >= 0 ? sorted[activeIndex] : null;
    const next = activeIndex + 1 < sorted.length ? sorted[activeIndex + 1] : null;
    const effective = Math.min(width, maxContainer);
    const columns = effective < 640 ? 1 : effective < 1024 ? 2 : effective < 1400 ? 3 : 4;
    const content = effective - pad * 2;

    const mediaQueries = sorted.map((row, index) => {
      if (strategy === 'mobile') {
        return '@media (min-width: ' + row.value + 'px) {\n  /* ' + row.name + ' and up */\n}';
      }
      const previous = index > 0 ? sorted[index - 1] : null;
      const upper = previous ? previous.value - 0.02 : row.value;
      return '@media (max-width: ' + upper + 'px) {\n  /* below ' + row.name + ' */\n}';
    });

    const containerQueries = [320, 480, 640, 800].map((size) => '@container (min-width: ' + size + 'px) {\n  /* component layout at ' + size + ' and wider */\n}');

    const shell = [
      '.container {',
      '  width: 100%;',
      '  max-width: ' + maxContainer + 'px;',
      '  margin-inline: auto;',
      '  padding-inline: ' + pad + 'px;',
      '}',
      '',
      '.grid-auto {',
      '  display: grid;',
      '  gap: ' + Math.round(pad / 2) + 'px;',
      '  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));',
      '}',
    ].join('\n');

    // Fluid type between the smallest and largest breakpoint.
    const minWidth = sorted.length ? sorted[0].value : 640;
    const maxWidth = sorted.length ? sorted[sorted.length - 1].value : 1536;
    const slope = (Number(headingMax) - Number(headingMin)) / (maxWidth - minWidth);
    const intercept = Number(headingMin) - slope * minWidth;
    const clamp = 'clamp(' + headingMin + 'px, ' + (intercept).toFixed(2) + 'px + ' + (slope * 100).toFixed(3) + 'vw, ' + headingMax + 'px)';

    const coverage = DEVICES.map((device) => {
      const match = sorted.reduce((best, row) => (device.width >= row.value ? row : best), null);
      return { ...device, breakpoint: match ? match.name : 'base', container: Math.min(device.width, maxContainer) - pad * 2 };
    });

    const gaps = sorted.slice(1).map((row, index) => row.value - sorted[index].value);

    return {
      sorted, width, active, next, columns, content, effective, mediaQueries, containerQueries, shell, clamp,
      coverage, gaps, maxContainer, pad,
      smallestGap: gaps.length ? Math.min(...gaps) : 0,
      activeLabel: active ? active.name : 'base, below the first breakpoint',
      nextLabel: next ? next.name + ' at ' + next.value + 'px' : 'the top of the range',
      distinct: new Set(sorted.map((row) => row.value)).size === sorted.length,
    };
  }, [points, strategy, container, gutter, viewport, headingMin, headingMax]);

  const css = useMemo(() => [
    '/* ' + (strategy === 'mobile' ? 'Mobile first: min-width queries, smallest first' : 'Desktop first: max-width queries, largest first') + ' */',
    '',
    ...result.mediaQueries,
    '',
    result.shell,
    '',
    '/* fluid type */',
    'h1 { font-size: ' + result.clamp + '; }',
    '',
    '/* component level, using container queries instead of the viewport */',
    '.card-wrap { container-type: inline-size; }',
    ...result.containerQueries,
  ].join('\n'), [result, strategy]);

  const report = useMemo(() => [
    'Breakpoints: ' + result.sorted.map((row) => row.name + ' ' + row.value + 'px').join(', '),
    'Strategy: ' + (strategy === 'mobile' ? 'mobile first, min-width' : 'desktop first, max-width'),
    'Container max width ' + result.maxContainer + 'px with a ' + result.pad + 'px gutter',
    '',
    css,
  ].join('\n'), [result, strategy, css]);

  return (
    <ToolShell
      toolId="breakpoints"
      icon={Smartphone}
      title="Breakpoint & Layout Studio"
      desc="Define your breakpoints, see which device widths fall into which, generate the media queries and a fluid type scale, and preview the layout as you drag the width."
      state={{ points, strategy, container, gutter, viewport, headingMin, headingMax }}
      onRestore={(restored) => {
        if (Array.isArray(restored.points) && restored.points.length) setPoints(restored.points);
        if (restored.strategy) setStrategy(restored.strategy);
        if (restored.container !== undefined) setContainer(String(restored.container));
        if (restored.gutter !== undefined) setGutter(String(restored.gutter));
        if (restored.viewport !== undefined) setViewport(String(restored.viewport));
        if (restored.headingMin !== undefined) setHeadingMin(String(restored.headingMin));
        if (restored.headingMax !== undefined) setHeadingMax(String(restored.headingMax));
      }}
      exportText={report}
      exportName="breakpoints.css"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Seg value={strategy} onChange={setStrategy} options={[{ value: 'mobile', label: 'Mobile first' }, { value: 'desktop', label: 'Desktop first' }]} />
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Breakpoints</span>
          <span className="font-mono-j text-[10px] text-muted-foreground">{result.sorted.length} defined</span>
        </div>
        <div className="space-y-2">
          {points.map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <Field label="Name"><input value={row.name} onChange={(e) => set(row.id, 'name', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="From width, px"><input value={row.min} onChange={(e) => set(row.id, 'min', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" /></Field>
              <Field label="Devices in this range">
                <div className="flex h-9 items-center font-mono-j text-[11px] text-muted-foreground">{result.coverage.filter((device) => device.breakpoint === row.name).length} of {DEVICES.length}</div>
              </Field>
              <div className="flex items-end">
                <button type="button" onClick={() => setPoints((current) => current.filter((entry) => entry.id !== row.id))} className="ml-auto inline-flex h-9 items-center rounded-lg border border-border/60 px-2 text-muted-foreground transition hover:text-rose-300">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setPoints((current) => [...current, { id: Math.random().toString(36).slice(2), name: 'bp' + (current.length + 1), min: '1440' }])}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
        >
          <Plus className="h-3.5 w-3.5" /> Add a breakpoint
        </button>
        {!result.distinct && <p className="mt-2 text-[11px] text-amber-200">Two breakpoints share the same width, so one of them will never apply.</p>}
      </Panel>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Container max width, px"><input value={container} onChange={(e) => setContainer(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Gutter, px"><input value={gutter} onChange={(e) => setGutter(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Heading at the smallest breakpoint"><input value={headingMin} onChange={(e) => setHeadingMin(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
        <Field label="Heading at the largest"><input value={headingMax} onChange={(e) => setHeadingMax(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" /></Field>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Preview — drag the width</span>
          <span className="font-mono-j text-[10px] text-cyan-j">{result.width}px · {result.activeLabel}</span>
        </div>
        <input
          type="range"
          min={280}
          max={2000}
          step={10}
          value={viewport}
          onChange={(e) => setViewport(e.target.value)}
          className="w-full accent-[hsl(var(--cyan))]"
        />
        <div className="mt-3 overflow-auto rounded-lg border border-border/60 bg-card/30 p-2">
          <div className="mx-auto" style={{ width: Math.min(result.width, 1200) + 'px', maxWidth: '100%' }}>
            <div className="rounded-lg border border-cyan-j/40 bg-cyan-j/5 p-2" style={{ padding: Math.max(8, Math.min(result.pad, 32)) + 'px' }}>
              <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>viewport {result.width}px</span>
                <span>{result.columns} column layout · content {Math.max(0, result.content).toFixed(0)}px</span>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(' + result.columns + ', minmax(0, 1fr))' }}>
                {Array.from({ length: Math.min(result.columns * 2, 8) }, (unused, index) => (
                  <div key={index} className="rounded-md border border-border/60 bg-card/60 p-2">
                    <div className="mb-1 h-1.5 w-10 rounded-full bg-cyan-j/60" />
                    <div className="mb-1 h-1.5 w-16 rounded-full bg-muted" />
                    <div className="h-1.5 w-12 rounded-full bg-muted" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          The card grid reflows by breakpoint rather than by pixel count, which is the point: a layout should change when the content needs it, not because a device list said so.
          Currently {result.activeLabel}, next change at {result.nextLabel}.
        </p>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Hero
          label="Active at this width"
          value={result.activeLabel.split(',')[0]}
          sub={'At ' + result.width + 'px the layout is in ' + result.columns + ' column mode with ' + result.content.toFixed(0) + 'px of content inside a ' + result.maxContainer + 'px container. ' + result.sorted.length + ' breakpoints generate ' + result.mediaQueries.length + ' media queries.'}
        />
        <Ring
          value={result.columns}
          max={4}
          label="Columns at this width"
          sub={'Container caps at ' + result.maxContainer + 'px, so beyond that the layout stops growing'}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Which devices land where</div>
          <div className="space-y-1.5">
            {result.coverage.map((device) => (
              <div key={device.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-32 truncate text-muted-foreground">{device.label}</span>
                <span className="w-12 text-right font-mono-j">{device.width}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-cyan-j/70" style={{ width: Math.min(100, (device.width / 2560) * 100) + '%' }} />
                </div>
                <span className="w-16 text-right font-mono-j text-cyan-j">{device.breakpoint}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Breakpoint widths</div>
          <Bars
            data={result.sorted.map((row) => ({ label: row.name, value: row.value }))}
            format={(value) => String(value)}
            suffix=" px"
            highlightLast={false}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            The narrowest gap between any two breakpoints here is {result.smallestGap}px. Gaps under about 200px rarely earn their keep — two very close breakpoints usually mean
            one of them is really the same layout.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">Generated CSS</span>
          <CopyBtn value={css} label="Copy the CSS" />
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{css}</pre>
      </Panel>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Breakpoints" value={String(result.sorted.length)} mono sub={strategy === 'mobile' ? 'min-width' : 'max-width'} />
        <Stat label="Columns now" value={String(result.columns)} mono sub={result.width + 'px'} />
        <Stat label="Content width" value={result.content.toFixed(0) + 'px'} mono sub={result.maxContainer + 'px cap'} />
        <Stat label="Fluid heading" value={headingMin + ' to ' + headingMax} mono sub="clamp() generated" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Breakpoints that survive real content</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Set them where the layout breaks, not where devices are. Drag the preview until something looks wrong; that width is the breakpoint.</p>
            <p>· Mobile first is easier to maintain: the base styles are the simple ones and each query adds capability rather than undoing it.</p>
            <p>· Four or five breakpoints is plenty for most sites. Every one you add is another layout to test.</p>
            <p>· Test at 320px and at the awkward widths between your breakpoints, not only at the round numbers.</p>
            <p>· Content length and translations change the answer. A layout that holds in English can break in German at the same width.</p>
            <p>· Use container queries for components that appear in sidebars and in full-width sections. The viewport is the wrong reference for a card.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Sizing and scale</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· The generated heading size is clamp({headingMin}px, ... , {headingMax}px), which scales smoothly between the first and last breakpoint instead of jumping at each one.</p>
            <p>· vw units do not respect zoom the way rem does. Cap the maximum with a clamp so text stops growing on huge screens.</p>
            <p>· Prefer rem for type so that a user browser setting actually changes the size.</p>
            <p>· Use minmax with auto-fit for a grid that reflows on its own: much less CSS than one rule per breakpoint.</p>
            <p>· A container max width of {result.maxContainer}px with a {result.pad}px gutter suits a reading layout. Text wider than about 75 characters is harder to read however much space you have.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Strategy', value: strategy === 'mobile' ? 'mobile first' : 'desktop first' },
                { label: 'Breakpoints', value: String(result.sorted.length) },
                { label: 'Columns', value: String(result.columns) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">The generated pieces</div>
        <div className="space-y-1 font-mono-j text-[11px] text-muted-foreground">
          <p>@media (min-width: 640px) {'{'} ... {'}'} — everything at or above</p>
          <p>@media (max-width: 767.98px) {'{'} ... {'}'} — the desktop-first equivalent, avoiding the gap at exactly 768px</p>
          <p>@container (min-width: 480px) {'{'} ... {'}'} — the same idea, measured against the parent element</p>
          <p>grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)) — reflow without any query at all</p>
          <p className="text-cyan-j">Fluid type: font-size: {result.clamp};</p>
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The preview and the generated CSS come from the same breakpoint list, so what you see at a given width is exactly what the copied queries produce. Device widths are given as
          viewport widths in CSS pixels, which is what a media query actually measures.
        </p>
      </Panel>
    </ToolShell>
  );
}