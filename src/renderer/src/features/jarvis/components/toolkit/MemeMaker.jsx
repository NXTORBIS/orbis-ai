import { useEffect, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow, readFileAsDataURL, downloadBlob } from './shared';

const SAMPLE = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1100&q=75';

const STACKS = {
  impact: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  black: '"Arial Black", "Helvetica Neue", sans-serif',
  sans: 'Inter, system-ui, sans-serif',
  mono: 'ui-monospace, "JetBrains Mono", monospace',
};

const wrapText = (ctx, text, maxWidth) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
};

export default function MemeMaker() {
  const [src, setSrc] = useState(SAMPLE);
  const [name, setName] = useState('sample.jpg');
  const [top, setTop] = useState('WHEN THE TOOLKIT');
  const [bottom, setBottom] = useState('JUST KEEPS GROWING');
  const [place, setPlace] = useState('both');
  const [sizePct, setSizePct] = useState(8);
  const [font, setFont] = useState('impact');
  const [colour, setColour] = useState('#ffffff');
  const [outline, setOutline] = useState('#000000');
  const [band, setBand] = useState(false);
  const [error, setError] = useState('');

  const canvasRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imageRef.current = img; draw(); };
    img.onerror = () => setError('That image could not be loaded.');
    img.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => { draw(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [top, bottom, place, sizePct, font, colour, outline, band]);

  function draw() {
    const img = imageRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const size = Math.max(14, Math.round((sizePct / 100) * img.height));
    const lineHeight = size * 1.15;
    const padding = img.width * 0.04;
    ctx.font = `700 ${size}px ${STACKS[font]}`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(2, size / 7);
    ctx.strokeStyle = outline;
    ctx.fillStyle = colour;

    const upper = String(top).toUpperCase();
    const lower = String(bottom).toUpperCase();
    const topLines = upper && place !== 'bottom' && place !== 'centre' ? wrapText(ctx, upper, img.width - padding * 2) : [];
    const bottomLines = lower && place !== 'top' && place !== 'centre' ? wrapText(ctx, lower, img.width - padding * 2) : [];
    const centreLines = place === 'centre'
      ? [...wrapText(ctx, upper, img.width - padding * 2), ...wrapText(ctx, lower, img.width - padding * 2)]
      : [];

    if (band && (topLines.length || bottomLines.length)) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      if (topLines.length) ctx.fillRect(0, 0, img.width, topLines.length * lineHeight + padding);
      if (bottomLines.length) ctx.fillRect(0, img.height - (bottomLines.length * lineHeight + padding), img.width, bottomLines.length * lineHeight + padding);
      ctx.restore();
    }

    const paint = (line, y) => {
      ctx.strokeText(line, img.width / 2, y);
      ctx.fillText(line, img.width / 2, y);
    };

    topLines.forEach((line, i) => paint(line, padding + size + i * lineHeight));
    bottomLines.forEach((line, i) => {
      const fromBottom = bottomLines.length - i;
      paint(line, img.height - padding - (fromBottom - 1) * lineHeight - size * 0.12);
    });
    const start = img.height / 2 - ((centreLines.length - 1) * lineHeight) / 2;
    centreLines.forEach((line, i) => paint(line, start + i * lineHeight));
    setError('');
  }

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `${(name || 'meme').replace(/\.[^.]+$/, '')}-meme.png`); }, 'image/png');
  };

  const summary = `${top || '—'} / ${bottom || '—'} · ${place} · ${sizePct}% text · ${font} · ${colour} on ${outline}`;

  return (
    <ToolShell
      toolId="meme"
      icon={Smile}
      title="Meme & Caption Maker"
      desc="Classic caption treatment on any picture — outlined, wrapped and sized to the image itself."
      state={{ top, bottom, place, sizePct, font, colour, outline, band, name }}
      onRestore={(saved) => {
        if (saved.top !== undefined) setTop(saved.top);
        if (saved.bottom !== undefined) setBottom(saved.bottom);
        if (saved.place) setPlace(saved.place);
        setSizePct(saved.sizePct ?? 8);
        if (saved.font) setFont(saved.font);
        if (saved.colour) setColour(saved.colour);
        if (saved.outline) setOutline(saved.outline);
        setBand(!!saved.band);
      }}
      exportText={summary}
      exportName="meme-caption.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Choose an image
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setName(file.name);
              setSrc(await readFileAsDataURL(file));
            }}
          />
        </label>
        <button
          type="button"
          onClick={() => { setSrc(SAMPLE); setName('sample.jpg'); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50"
        >
          Use the sample
        </button>
        <span className="text-[11px] text-muted-foreground">{name}</span>
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <Panel className="!p-3">
        <canvas ref={canvasRef} className="mx-auto max-h-[26rem] w-auto max-w-full rounded-lg border border-border/70" />
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Top caption">
          <input value={top} onChange={(e) => setTop(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
        <Field label="Bottom caption">
          <input value={bottom} onChange={(e) => setBottom(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
        </Field>
      </div>

      <Field label="Where the words sit">
        <Seg
          value={place}
          onChange={setPlace}
          options={[
            { value: 'both', label: 'Top & bottom' },
            { value: 'top', label: 'Top' },
            { value: 'bottom', label: 'Bottom' },
            { value: 'centre', label: 'Centre' },
          ]}
        />
      </Field>

      <Field label="Font">
        <Seg
          value={font}
          onChange={setFont}
          options={[
            { value: 'impact', label: 'Impact' },
            { value: 'black', label: 'Black' },
            { value: 'sans', label: 'Sans' },
            { value: 'mono', label: 'Mono' },
          ]}
        />
      </Field>

      <Field label={`Text size · ${sizePct}% of image height`}>
        <input type="range" min={3} max={16} step={0.5} value={sizePct} onChange={(e) => setSizePct(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Text colour · ${colour.toUpperCase()}`}>
          <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
        <Field label={`Outline · ${outline.toUpperCase()}`}>
          <input type="color" value={outline} onChange={(e) => setOutline(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
        </Field>
      </div>

      <ToggleRow label="Dark band behind the captions" checked={band} onChange={setBand} hint="for busy photos" />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Placement" value={place} />
        <Stat label="Type size" value={`${sizePct}%`} mono />
        <Stat label="Captions" value={[top, bottom].filter((t) => t.trim()).length ? `${[top, bottom].filter((t) => t.trim()).length}` : '0'} />
      </div>

      <button
        type="button"
        onClick={download}
        className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-2 text-xs font-medium text-cyan-j transition hover:bg-cyan-j/20"
      >
        Download PNG
      </button>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Captions are wrapped to the picture's width and scaled from its height, so the same settings hold up on a tall phone shot and a wide photo.
          The outlines are drawn as strokes first, which is what keeps the letters readable over any background. Everything happens in this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}