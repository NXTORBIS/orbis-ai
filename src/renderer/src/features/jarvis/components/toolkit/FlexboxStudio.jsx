import { useMemo, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat } from './shared';

const PRESETS = {
  navbar: {
    label: 'Navigation bar',
    container: { direction: 'row', justify: 'space-between', align: 'center', wrap: 'nowrap', gap: '12' },
    items: [1, 1, 1],
  },
  hero: {
    label: 'Centred hero',
    container: { direction: 'column', justify: 'center', align: 'center', wrap: 'nowrap', gap: '16' },
    items: [1, 1, 1],
  },
  cards: {
    label: 'Card row',
    container: { direction: 'row', justify: 'flex-start', align: 'stretch', wrap: 'wrap', gap: '16' },
    items: [1, 1, 1, 1],
  },
  sidebar: {
    label: 'Sidebar and content',
    container: { direction: 'row', justify: 'flex-start', align: 'stretch', wrap: 'nowrap', gap: '16' },
    items: [0, 3, 0],
  },
  footer: {
    label: 'Sticky footer column',
    container: { direction: 'column', justify: 'space-between', align: 'stretch', wrap: 'nowrap', gap: '12' },
    items: [0, 1],
  },
};

const JUSTIFY = ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'];
const ALIGN = ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'];
const CONTENT = ['normal', 'stretch', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around'];

export default function FlexboxStudio() {
  const [container, setContainer] = useState({ direction: 'row', wrap: 'wrap', justify: 'space-between', align: 'stretch', content: 'normal', gap: '12' });
  const [items, setItems] = useState([
    { grow: '1', self: 'auto', order: '0' },
    { grow: '1', self: 'auto', order: '0' },
    { grow: '1', self: 'auto', order: '0' },
    { grow: '0', self: 'auto', order: '0' },
  ]);
  const [count, setCount] = useState('4');

  const setItem = (index, key, value) => setItems((current) => current.map((item, position) => (position === index ? { ...item, [key]: value } : item)));

  const visible = useMemo(() => {
    const wanted = Math.max(1, Math.min(8, Number(count) || 1));
    if (wanted <= items.length) return items.slice(0, wanted);
    return [...items, ...Array.from({ length: wanted - items.length }, () => ({ grow: '1', self: 'auto', order: '0' }))];
  }, [count, items]);

  const css = useMemo(() => {
    const lines = [
      '.container {',
      '  display: flex;',
      '  flex-direction: ' + container.direction + ';',
      '  flex-wrap: ' + container.wrap + ';',
      '  justify-content: ' + container.justify + ';',
      '  align-items: ' + container.align + ';',
      '  align-content: ' + container.content + ';',
      '  gap: ' + container.gap + 'px;',
      '}',
      '',
      ...visible.map((item, index) => [
        '.item-' + (index + 1) + ' {',
        '  flex-grow: ' + item.grow + ';',
        '  flex-shrink: 1;',
        '  flex-basis: auto;',
        '  align-self: ' + item.self + ';',
        '  order: ' + item.order + ';',
        '}',
        '',
      ].join('\n')),
    ];
    return lines.join('\n').trim();
  }, [container, visible]);

  const applyPreset = (key) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setContainer((current) => ({ ...current, ...preset.container }));
    setItems(preset.items.map((grow) => ({ grow: String(grow), self: 'auto', order: '0' })));
    setCount(String(preset.items.length));
  };

  const report = useMemo(() => [
    'Container: ' + container.direction + ', wrap ' + container.wrap + ', justify ' + container.justify + ', align ' + container.align + ', gap ' + container.gap + 'px',
    visible.length + ' items',
    '',
    css,
  ].join('\n'), [container, visible, css]);

  return (
    <ToolShell
      toolId="flexbox-studio"
      icon={LayoutGrid}
      title="Flexbox Playground"
      desc="Dial in direction, wrapping, alignment and gaps, then copy the CSS — with presets for the layouts you actually build and an explanation of every property."
      state={{ container, items, count }}
      onRestore={(restored) => {
        if (restored.container) setContainer((current) => ({ ...current, ...restored.container }));
        if (Array.isArray(restored.items) && restored.items.length) setItems(restored.items);
        if (restored.count !== undefined) setCount(String(restored.count));
      }}
      exportText={report}
      exportName="flexbox.css"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            onClick={() => applyPreset(key)}
            className="rounded-lg border border-border/70 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-cyan-j/50 hover:text-cyan-j"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Container</div>
          <div className="space-y-3">
            <Field label="flex-direction">
              <select value={container.direction} onChange={(e) => setContainer((current) => ({ ...current, direction: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {['row', 'row-reverse', 'column', 'column-reverse'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="justify-content — along the main axis">
              <select value={container.justify} onChange={(e) => setContainer((current) => ({ ...current, justify: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {JUSTIFY.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <Field label="align-items — across the main axis">
              <select value={container.align} onChange={(e) => setContainer((current) => ({ ...current, align: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                {ALIGN.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="flex-wrap">
                <select value={container.wrap} onChange={(e) => setContainer((current) => ({ ...current, wrap: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {['nowrap', 'wrap', 'wrap-reverse'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="align-content — wrapped lines">
                <select value={container.content} onChange={(e) => setContainer((current) => ({ ...current, content: e.target.value }))} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {CONTENT.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={'gap · ' + container.gap + 'px'}>
                <input type="range" min={0} max={48} step={2} value={container.gap} onChange={(e) => setContainer((current) => ({ ...current, gap: e.target.value }))} className="w-full accent-[hsl(var(--cyan))]" />
              </Field>
              <Field label="Items">
                <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-3 font-mono-j text-sm" />
              </Field>
            </div>
          </div>
        </Panel>

        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Live preview</div>
          <div
            className="rounded-lg border border-dashed border-border/70 bg-card/30 p-2"
            style={{
              display: 'flex',
              flexDirection: container.direction,
              flexWrap: container.wrap,
              justifyContent: container.justify,
              alignItems: container.align,
              alignContent: container.content,
              gap: container.gap + 'px',
              minHeight: 220,
            }}
          >
            {visible.map((item, index) => (
              <div
                key={index}
                className="grid place-items-center rounded-lg border border-cyan-j/40 bg-cyan-j/10 px-3 py-2 text-xs text-cyan-j"
                style={{
                  flexGrow: Number(item.grow) || 0,
                  flexShrink: 1,
                  flexBasis: 'auto',
                  alignSelf: item.self,
                  order: Number(item.order) || 0,
                  minWidth: 54,
                  minHeight: 40,
                }}
              >
                <span className="font-mono-j">{index + 1}</span>
                <span className="font-mono-j text-[9px] text-muted-foreground">grow {item.grow}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Drag the gap slider and switch the axis to see how the same items rearrange. Wrapped lines answer to align-content; a single line ignores it.
          </p>
        </Panel>
      </div>

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Per-item controls</div>
        <div className="space-y-2">
          {visible.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-2.5 sm:grid-cols-4">
              <div className="flex items-center font-mono-j text-[11px] text-muted-foreground">Item {index + 1}</div>
              <Field label="flex-grow">
                <input value={item.grow} onChange={(e) => setItem(index, 'grow', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
              <Field label="align-self">
                <select value={item.self} onChange={(e) => setItem(index, 'self', e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm">
                  {['auto', 'stretch', 'flex-start', 'center', 'flex-end', 'baseline'].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </Field>
              <Field label="order">
                <input value={item.order} onChange={(e) => setItem(index, 'order', e.target.value)} inputMode="numeric" className="h-9 w-full rounded-md border border-input bg-transparent px-2 font-mono-j text-sm" />
              </Field>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
        <Panel className="!p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Generated CSS</span>
            <CopyBtn value={css} label="Copy the CSS" />
          </div>
          <pre className="max-h-72 overflow-auto rounded-lg border border-border/60 bg-card/40 p-2.5 font-mono-j text-[11px] leading-relaxed">{css}</pre>
        </Panel>
        <div className="space-y-3">
          <Hero
            label="Layout"
            value={container.direction + ' · ' + container.justify}
            sub={visible.length + ' items with ' + container.gap + 'px gaps, wrapped ' + container.wrap + ', aligned ' + container.align + ' across the axis.'}
          />
          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">What each property does</div>
            <div className="space-y-1 text-[11px] text-muted-foreground">
              <p>· flex-direction decides which axis is the main one — row is horizontal, column vertical.</p>
              <p>· justify-content distributes free space along that main axis.</p>
              <p>· align-items positions items on the cross axis; align-self overrides it for one item.</p>
              <p>· flex-wrap lets items move onto new lines, and align-content spreads those lines.</p>
              <p>· gap spaces items without margin hacks and works in both axes.</p>
              <p>· flex-grow shares leftover space; with three items at grow 1 they stay equal, and an item at 0 keeps its natural size.</p>
            </div>
          </Panel>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Patterns worth remembering</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Perfect centring: display flex, justify-content center, align-items center — two lines, both axes.</p>
            <p>· Push the last item to the far end: justify-content space-between, or give that item margin-left auto.</p>
            <p>· A sidebar that keeps its width and a main area that fills: sidebar flex 0 0 240px, main flex 1.</p>
            <p>· Equal-height cards: align-items stretch is the default for a reason — remove the heights and let flexbox do it.</p>
            <p>· Space around a wrapped grid: gap plus flex-wrap, which is nearly always simpler than margins and negative margins.</p>
            <p>· Sticky footer in a column: justify-content space-between with min-height 100vh.</p>
          </div>
        </Panel>
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Where flexbox is the wrong tool</div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>· Two-dimensional layouts with aligned rows and columns belong to CSS Grid. Flexbox is one axis at a time.</p>
            <p>· Flex items can shrink below their content size unless min-width is set — that is the classic reason text overflows.</p>
            <p>· A wrapped flex row makes each line's items independent, so columns do not line up across lines.</p>
            <p>· If you find yourself nesting four flex containers to fake a grid, stop and reach for grid-template-columns instead.</p>
            <p>· Order changes appearance without changing the document, so keyboard and screen-reader order can diverge from what is seen — check it matters before using it.</p>
          </div>
          <div className="mt-3">
            <Pills
              items={[
                { label: 'Items', value: String(visible.length) },
                { label: 'Gap', value: container.gap + 'px' },
                { label: 'Wrap', value: container.wrap },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <Stat label="Direction" value={container.direction} mono />
        <Stat label="Main axis" value={container.justify} mono sub="justify-content" />
        <Stat label="Cross axis" value={container.align} mono sub="align-items" />
        <Stat label="Items" value={String(visible.length)} mono sub={container.gap + 'px gap'} />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The preview and the generated CSS come from the same state, so anything you see on screen is exactly what the copied rule produces. Every value is a real
          CSS keyword rather than a shorthand invented here, which means it can be pasted straight into a stylesheet.
        </p>
      </Panel>
    </ToolShell>
  );
}