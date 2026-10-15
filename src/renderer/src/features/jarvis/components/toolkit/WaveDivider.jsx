import { useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, CopyBtn, Panel, Stat, ToggleRow, downloadBlob } from './shared';

const SHAPES = {
  Wave: 'M0 60 C 150 110 350 10 600 60 C 850 110 1050 10 1200 60 L 1200 120 L 0 120 Z',
  Curve: 'M0 120 C 320 -10 880 -10 1200 120 L 1200 120 L 0 120 Z',
  Tilt: 'M0 120 L 1200 12 L 1200 120 Z',
  Triangle: 'M0 120 L 600 12 L 1200 120 Z',
  Zigzag: 'M0 120 L 120 44 L 240 120 L 360 44 L 480 120 L 600 44 L 720 120 L 840 44 L 960 120 L 1080 44 L 1200 120 Z',
  Chevron: 'M0 120 L 600 24 L 1200 120 L 1200 74 L 600 0 L 0 74 Z',
  Steps: 'M0 120 L 0 72 L 300 72 L 300 50 L 600 50 L 600 32 L 900 32 L 900 14 L 1200 14 L 1200 120 Z',
  Arch: 'M0 120 C 380 -34 820 -34 1200 120 Z',
  Blob: 'M0 120 C 120 62 220 98 320 72 C 440 42 520 102 640 80 C 760 58 860 106 980 80 C 1090 56 1150 92 1200 64 L 1200 120 Z',
  Ramp: 'M0 120 L 1200 44 L 1200 96 L 0 120 Z',
};

const encode = (svg) => `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22')}`;

export default function WaveDivider() {
  const [shape, setShape] = useState('Wave');
  const [height, setHeight] = useState(120);
  const [fill, setFill] = useState('#22d3ee');
  const [page, setPage] = useState('#05070d');
  const [layers, setLayers] = useState(2);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);

  const svg = useMemo(() => {
    const path = SHAPES[shape];
    const transform = `translate(${flipX ? 1200 : 0} ${flipY ? 120 : 0}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})`;
    const stack = Array.from({ length: layers }, (_, i) => {
      const offset = i * 10;
      const alpha = (0.35 + (0.65 * (i + 1)) / layers).toFixed(2);
      return `<g transform="translate(0 ${-offset}) scale(1 ${1 - i * 0.04})" opacity="${i === 0 ? 1 : alpha}"><path d="${path}" fill="${fill}"/></g>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="120" viewBox="0 0 1200 120" preserveAspectRatio="none"><g transform="${transform}">${stack}</g></svg>`;
  }, [shape, fill, layers, flipX, flipY]);

  const preview = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="240" viewBox="0 0 1200 240"><rect width="1200" height="240" fill="${page}"/><g transform="translate(0 120)">${svg.replace(/<\/?svg[^>]*>/g, '')}</g></svg>`)}`;

  const section = `<section class="relative">\n  <div class="bg-page">…your content…</div>\n  <img src="/divider.svg" alt="" class="block w-full" style="height:${height}px" />\n</section>`;

  const download = () => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${shape.toLowerCase()}-divider.svg`);

  return (
    <ToolShell
      toolId="wave-divider"
      icon={Layers}
      title="Section Divider Generator"
      desc="Wave, curve and zigzag edges to soften the join between two sections — stacked, flipped and exported as SVG."
      state={{ shape, height, fill, page, layers, flipX, flipY }}
      onRestore={(saved) => {
        if (saved.shape) setShape(saved.shape);
        setHeight(saved.height ?? 120);
        if (saved.fill) setFill(saved.fill);
        if (saved.page) setPage(saved.page);
        setLayers(saved.layers ?? 2);
        setFlipX(!!saved.flipX);
        setFlipY(!!saved.flipY);
      }}
      exportText={svg}
      exportName={`${shape.toLowerCase()}-divider.svg`}
      exportMime="image/svg+xml"
    >
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(SHAPES).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setShape(name)}
            className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${shape === name ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j tk-glow-ring' : 'border-border/70 text-muted-foreground hover:border-cyan-j/50'}`}
          >
            {name}
          </button>
        ))}
      </div>

      <Panel className="!p-0 overflow-hidden">
        <div className="flex flex-col">
          <div className="grid min-h-28 place-items-center p-4 text-[11px] text-white/70" style={{ background: page }}>
            <span className="tk-card rounded-lg border border-white/10 bg-white/5 px-3 py-2">Section above · {page}</span>
          </div>
          <img src={preview} alt={`${shape} divider`} className="block w-full" style={{ height: `${height}px` }} />
          <div className="grid min-h-16 place-items-center p-4 text-[11px]" style={{ background: fill, color: '#0b1020' }}>
            Section below · {fill}
          </div>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Height · ${height}px`}>
          <input type="range" min={40} max={240} value={height} onChange={(e) => setHeight(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Divider · ${fill.toUpperCase()}`}>
          <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Other section · ${page.toUpperCase()}`}>
          <input type="color" value={page} onChange={(e) => setPage(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <Field label={`Layers · ${layers}`}>
        <Seg value={layers} onChange={(v) => setLayers(Number(v))} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Mirror horizontally" checked={flipX} onChange={setFlipX} hint="flip the wave" />
        <ToggleRow label="Flip vertically" checked={flipY} onChange={setFlipY} hint="sit along the top" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Shape" value={shape} />
        <Stat label="Layers" value={String(layers)} />
        <Stat label="Height" value={`${height}px`} mono />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={download} className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Download SVG
        </button>
        <CopyBtn value={svg} label="Copy SVG" />
      </div>

      <Panel>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">How to drop it in</span>
          <CopyBtn value={section} />
        </div>
        <pre className="overflow-auto whitespace-pre font-mono-j text-[11px] scrollbar-thin">{section}</pre>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          The SVG stretches to any width because it is drawn with a 1200-wide viewBox and scaled non-uniformly — the height stays whatever you set.
          Give the divider the colour of the section it is leading into, and it will look like the two blocks were cut from the same sheet.
        </p>
      </Panel>
    </ToolShell>
  );
}