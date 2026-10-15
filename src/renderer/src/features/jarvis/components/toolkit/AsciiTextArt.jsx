import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { Type } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Area, CopyBtn, Field, Panel, Seg, Stat, ToggleRow } from './shared';

const RAMP = ' .:-=+*#%@';
const RAMP_DENSE = ' .\'`^",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

const FONTS = [
  { id: 'sans', label: 'Sans', stack: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
  { id: 'serif', label: 'Serif', stack: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Mono', stack: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
];

export default function AsciiTextArt() {
  const [text, setText] = useState('MARK32');
  const [font, setFont] = useState('sans');
  const [weight, setWeight] = useState(900);
  const [columns, setColumns] = useState(118);
  const [dense, setDense] = useState(false);
  const [invert, setInvert] = useState(false);
  const [art, setArt] = useState('');
  const canvasRef = useRef(null);
  const deferred = useDeferredValue(text);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const stack = (FONTS.find((f) => f.id === font) || FONTS[0]).stack;
    const rows = Math.max(8, Math.round(columns * 0.29));
    const width = columns * 10;
    const height = rows * 10;
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const lines = String(deferred).split('\n').slice(0, 4);
    let size = height;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let step = 0; step < 24; step += 1) {
      ctx.font = `${weight} ${size}px ${stack}`;
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width || 0));
      const tallest = size * 0.72 * lines.length;
      if (widest <= width * 0.92 && tallest <= height * 0.86) break;
      size -= Math.max(2, size * 0.06);
      if (size < 12) { size = 12; break; }
    }
    ctx.font = `${weight} ${size}px ${stack}`;
    ctx.fillStyle = '#fff';
    const lineHeight = size * 0.78;
    const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => ctx.fillText(line, width / 2, startY + i * lineHeight));

    const data = ctx.getImageData(0, 0, width, height).data;
    const ramp = dense ? RAMP_DENSE : RAMP;
    const out = [];
    for (let y = 0; y < rows; y += 1) {
      let row = '';
      for (let x = 0; x < columns; x += 1) {
        const px = Math.floor((x / columns) * width);
        const py = Math.floor((y / rows) * height);
        const idx = (py * width + px) * 4;
        const lum = data[idx] / 255;
        const value = invert ? 1 - lum : lum;
        const scaled = Math.min(ramp.length - 1, Math.max(0, Math.round(value * (ramp.length - 1))));
        row += ramp[scaled];
      }
      out.push(row.replace(/\s+$/, ''));
    }
    setArt(out.join('\n'));
  }, [deferred, font, weight, columns, dense, invert]);

  const stats = {
    lines: art.split('\n').length,
    chars: art.replace(/\n/g, '').length,
    width: art.split('\n')[0]?.length || 0,
  };

  return (
    <ToolShell
      toolId="ascii-banner"
      icon={Type}
      title="ASCII Text Art"
      desc="Type a headline and get it back as text art you can drop into a README, a code comment or a terminal — crisp mono output, any weight."
      state={{ text, font, weight, columns, dense, invert }}
      onRestore={(restored) => {
        if (typeof restored.text === 'string') setText(restored.text);
        if (restored.font) setFont(restored.font);
        if (restored.weight) setWeight(Number(restored.weight));
        if (restored.columns) setColumns(Number(restored.columns));
        if (typeof restored.dense === 'boolean') setDense(restored.dense);
        if (typeof restored.invert === 'boolean') setInvert(restored.invert);
      }}
      exportText={art}
      exportName="ascii-art.txt"
    >
      <Field label="Your words" hint="Up to four lines — each line becomes its own band of art">
        <Area value={text} onChange={setText} rows={3} placeholder="MARK32" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Letter style">
          <Seg value={font} onChange={setFont} options={FONTS.map((f) => ({ value: f.id, label: f.label }))} />
        </Field>
        <Field label={`Weight · ${weight}`}>
          <input type="range" min={300} max={900} step={100} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Width · ${columns} characters`}>
          <input type="range" min={40} max={200} value={columns} onChange={(e) => setColumns(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <div className="space-y-2">
          <ToggleRow label="Denser character ramp" checked={dense} onChange={setDense} hint="more detail" />
          <ToggleRow label="Invert (light letters, dark paper)" checked={invert} onChange={setInvert} />
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap items-center gap-2">
        <CopyBtn value={art} label="Copy art" />
        <span className="text-[11px] text-muted-foreground">Paste into a code block (monospace) so it keeps its shape.</span>
      </div>

      <div className="tk-card tk-depth overflow-auto rounded-xl border border-border/70 bg-[#0b1120] p-3">
        <pre className="whitespace-pre font-mono-j text-[9px] leading-[1.05] text-cyan-j sm:text-[11px]">{art || ' '}</pre>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Width" value={`${stats.width} chars`} mono />
        <Stat label="Lines" value={String(stats.lines)} mono />
        <Stat label="Characters" value={String(stats.chars)} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Your words are drawn here in the browser at the size that fits best, then each pixel becomes a character — so the art is only ever as
          wide as you asked for and never breaks when pasted into a strict text box.
        </p>
      </Panel>
    </ToolShell>
  );
}