import { useEffect, useState } from 'react';
import { Type } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow, CopyBtn, readFileAsDataURL, downloadBlob } from './shared';

const CHARSETS = {
  Classic: '@%#*+=-:. ',
  Blocks: '█▓▒░ ',
  Dense: "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. ",
  Minimal: '#. ',
  Binary: '10 ',
};

const SAMPLE = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=900&q=70';

export default function ImageToAscii() {
  const [src, setSrc] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [width, setWidth] = useState(96);
  const [charset, setCharset] = useState('Classic');
  const [invert, setInvert] = useState(false);
  const [colour, setColour] = useState(false);
  const [contrast, setContrast] = useState(1.15);
  const [art, setArt] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!src) { setArt(null); return undefined; }
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      try {
        const cols = Math.max(24, Math.min(colour ? 90 : 200, width));
        const rows = Math.max(8, Math.round((img.height / img.width) * cols * 0.5));
        const canvas = document.createElement('canvas');
        canvas.width = cols;
        canvas.height = rows;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cols, rows);
        const { data } = ctx.getImageData(0, 0, cols, rows);
        const chars = CHARSETS[charset];
        const lines = [];
        for (let y = 0; y < rows; y++) {
          const line = [];
          for (let x = 0; x < cols; x++) {
            const i = (y * cols + x) * 4;
            let lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
            lum = Math.min(1, Math.max(0, (lum - 0.5) * contrast + 0.5));
            if (invert) lum = 1 - lum;
            const index = Math.min(chars.length - 1, Math.floor(lum * chars.length));
            line.push({ ch: chars[index], color: `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})` });
          }
          lines.push(line);
        }
        setArt({ lines, cols, rows });
        setError('');
      } catch {
        setError('That image could not be read pixel by pixel — try one from your device instead.');
      }
    };
    img.onerror = () => setError('That image could not be loaded.');
    img.src = src;
    return () => { cancelled = true; };
  }, [src, width, charset, invert, colour, contrast]);

  const text = art ? art.lines.map((line) => line.map((c) => c.ch).join('')).join('\n') : '';

  const upload = async (file) => {
    if (!file) return;
    setSourceName(file.name);
    setSrc(await readFileAsDataURL(file));
  };

  return (
    <ToolShell
      toolId="ascii"
      icon={Type}
      title="Image to ASCII Art"
      desc="Turn any picture into text art — mono or in colour, sized to fit wherever you paste it."
      state={{ width, charset, invert, colour, contrast, sourceName }}
      onRestore={(saved) => {
        if (saved.width) setWidth(saved.width);
        if (saved.charset) setCharset(saved.charset);
        setInvert(!!saved.invert);
        setColour(!!saved.colour);
        if (saved.contrast) setContrast(saved.contrast);
      }}
      exportText={text}
      exportName="ascii-art.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/10">
          Choose an image
          <input type="file" accept="image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        <button
          type="button"
          onClick={() => { setSrc(SAMPLE); setSourceName('sample.jpg'); }}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50"
        >
          Use the sample
        </button>
        {sourceName && <span className="text-[11px] text-muted-foreground">{sourceName}</span>}
      </div>

      <Field label={`Columns · ${width}`}>
        <input type="range" min={40} max={200} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <Field label="Character set">
        <Seg value={charset} onChange={setCharset} options={Object.keys(CHARSETS).map((k) => ({ value: k, label: k }))} />
      </Field>

      <Field label={`Contrast · ${contrast.toFixed(2)}`}>
        <input type="range" min={0.4} max={2.4} step={0.05} value={contrast} onChange={(e) => setContrast(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
      </Field>

      <div className="grid gap-2 sm:grid-cols-2">
        <ToggleRow label="Invert" checked={invert} onChange={setInvert} hint="for light backgrounds" />
        <ToggleRow label="Colour characters" checked={colour} onChange={setColour} hint="capped at 90 columns" />
      </div>

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <Panel className="overflow-hidden !p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
          <span className="text-xs text-muted-foreground">{art ? `${art.cols} × ${art.rows} characters` : 'Waiting for an image'}</span>
          {text && <CopyBtn value={text} />}
        </div>
        {art ? (
          <pre className="max-h-96 overflow-auto whitespace-pre bg-card p-3 font-mono-j text-[6px] leading-[1.05] scrollbar-thin sm:text-[8px]">
            {colour
              ? art.lines.map((line, y) => (
                  <div key={y}>{line.map((c, x) => <span key={x} style={{ color: c.color }}>{c.ch}</span>)}</div>
                ))
              : text}
          </pre>
        ) : (
          <div className="grid min-h-40 place-items-center p-6 text-center text-[11px] text-muted-foreground">
            Pick an image and the art appears here.
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Columns" value={art ? String(art.cols) : '—'} mono />
        <Stat label="Rows" value={art ? String(art.rows) : '—'} mono />
        <Stat label="Characters" value={art ? String(art.cols * art.rows) : '—'} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), 'ascii-art.txt')}
          disabled={!text}
          className="rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40"
        >
          Download .txt
        </button>
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each character stands for one block of the picture: dark areas get dense glyphs, light areas get thin ones. Fewer columns means a coarser,
          more readable result — around 80 fits a terminal or a code comment nicely. Nothing is uploaded; the picture is read in this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}