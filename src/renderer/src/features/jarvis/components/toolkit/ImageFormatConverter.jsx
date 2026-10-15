import { useState } from 'react';
import { Download, ImageDown, RefreshCw, Repeat, Trash2 } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Seg, Panel, Stat, ToggleRow, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

const FORMATS = [
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/webp', label: 'WebP' },
];

const WIDTHS = [
  { value: 0, label: 'Original' },
  { value: 1920, label: '1920' },
  { value: 1280, label: '1280' },
  { value: 800, label: '800' },
  { value: 400, label: '400' },
];

const extension = (mime) => (mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp');

export default function ImageFormatConverter() {
  const [files, setFiles] = useState([]);
  const [format, setFormat] = useState('image/webp');
  const [quality, setQuality] = useState(0.85);
  const [maxWidth, setMaxWidth] = useState(0);
  const [flatten, setFlatten] = useState(true);
  const [background, setBackground] = useState('#ffffff');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadFiles = async (fileList) => {
    const list = Array.from(fileList || []).slice(0, 12);
    const loaded = await Promise.all(list.map(async (file) => {
      const uri = await readFileAsDataURL(file);
      const img = new Image();
      await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = uri; });
      return { name: file.name, size: file.size, uri, img, width: img.naturalWidth, height: img.naturalHeight };
    }));
    setFiles(loaded);
    setResults([]);
  };

  const convert = async () => {
    if (!files.length) return;
    setBusy(true);
    const out = [];
    for (const file of files) {
      const source = file.img;
      const scale = maxWidth && source.naturalWidth > maxWidth ? maxWidth / source.naturalWidth : 1;
      const width = Math.round(source.naturalWidth * scale);
      const height = Math.round(source.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (format === 'image/jpeg' || flatten) {
        ctx.fillStyle = format === 'image/jpeg' ? background : 'rgba(0,0,0,0)';
        if (format === 'image/jpeg') ctx.fillRect(0, 0, width, height);
      }
      ctx.drawImage(source, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, format, format === 'image/png' ? undefined : quality));
      if (!blob) continue;
      out.push({
        name: `${file.name.replace(/\.[^.]+$/, '')}.${extension(format)}`,
        blob,
        size: blob.size,
        before: file.size,
        width,
        height,
        url: URL.createObjectURL(blob),
      });
    }
    setResults(out);
    setBusy(false);
  };

  const downloadAll = () => {
    results.forEach((result, index) => {
      setTimeout(() => downloadBlob(result.blob, result.name), index * 350);
    });
  };

  const totalBefore = results.reduce((sum, r) => sum + r.before, 0);
  const totalAfter = results.reduce((sum, r) => sum + r.size, 0);
  const saving = totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;

  const report = results.length
    ? results.map((r) => `${r.name} · ${r.width}×${r.height} · ${fmtBytes(r.before)} → ${fmtBytes(r.size)}`).join('\n')
    : 'No conversions run yet';

  return (
    <ToolShell
      toolId="image-format"
      icon={Repeat}
      title="Image Format Converter"
      desc="Turn PNG, JPEG and WebP into each other in batches, with quality, resize and transparent-background control."
      state={{ format, quality, maxWidth, flatten, background }}
      onRestore={(saved) => {
        if (saved.format) setFormat(saved.format);
        setQuality(saved.quality ?? 0.85);
        setMaxWidth(saved.maxWidth ?? 0);
        setFlatten(saved.flatten ?? true);
        if (saved.background) setBackground(saved.background);
      }}
      exportText={report}
      exportName="conversion.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          Add images
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => loadFiles(e.target.files)} />
        </label>
        <button
          type="button"
          onClick={convert}
          disabled={!files.length || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border/70 px-3 py-1.5 text-xs text-muted-foreground transition hover:border-cyan-j/50 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Converting…' : 'Convert'}
        </button>
        {!!results.length && (
          <button type="button" onClick={downloadAll} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
            <Download className="h-3.5 w-3.5" /> Download all
          </button>
        )}
        {!!files.length && (
          <button type="button" onClick={() => { setFiles([]); setResults([]); }} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-red-500">
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <span className="text-[11px] text-muted-foreground">{files.length ? `${files.length} image${files.length > 1 ? 's' : ''} loaded` : 'Nothing loaded yet'}</span>
      </div>

      <Field label="Convert to">
        <Seg value={format} onChange={setFormat} options={FORMATS} />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Longest side">
          <Seg value={maxWidth} onChange={(v) => setMaxWidth(Number(v))} options={WIDTHS} />
        </Field>
        <Field label={`Quality · ${Math.round(quality * 100)}%${format === 'image/png' ? ' (PNG is lossless)' : ''}`}>
          <input type="range" min={0.4} max={1} step={0.05} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" disabled={format === 'image/png'} />
        </Field>
      </div>

      {format === 'image/jpeg' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow label="Fill transparent areas" checked={flatten} onChange={setFlatten} hint="JPEG has no transparency" />
          <Field label={`Fill colour · ${background.toUpperCase()}`}>
            <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} className="h-9 w-full cursor-pointer rounded-md border border-input bg-transparent" />
          </Field>
        </div>
      )}

      {!!files.length && (
        <Panel className="!p-3">
          <div className="mb-2 text-xs font-medium">Loaded</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {files.map((file) => (
              <div key={file.name} className="tk-card overflow-hidden rounded-lg border border-border/70 bg-card/50">
                <img src={file.uri} alt={file.name} className="h-24 w-full object-cover" />
                <div className="p-2">
                  <div className="truncate text-[11px]" title={file.name}>{file.name}</div>
                  <div className="font-mono-j text-[10px] text-muted-foreground">{file.width}×{file.height} · {fmtBytes(file.size)}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {!!results.length && (
        <Panel>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">Converted</span>
            <span className={`text-[11px] ${saving > 0 ? 'text-cyan-j' : 'text-muted-foreground'}`}>
              {saving > 0 ? `${saving}% smaller overall` : `${Math.abs(saving)}% larger overall`}
            </span>
          </div>
          <div className="space-y-2">
            {results.map((result) => (
              <div key={result.name} className="flex items-center gap-3 rounded-lg border border-border/60 p-2">
                <img src={result.url} alt={result.name} className="h-12 w-12 shrink-0 rounded-md border border-border/60 object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{result.name}</div>
                  <div className="font-mono-j text-[10px] text-muted-foreground">
                    {result.width}×{result.height} · {fmtBytes(result.before)} → {fmtBytes(result.size)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadBlob(result.blob, result.name)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-2 py-1 text-[10px] text-cyan-j transition hover:bg-cyan-j/20"
                >
                  <ImageDown className="h-3 w-3" /> Save
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Images" value={String(files.length)} />
        <Stat label="Converted" value={String(results.length)} />
        <Stat label="Output total" value={results.length ? fmtBytes(totalAfter) : '—'} mono />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          WebP is usually the smallest of the three and is supported by every current browser; JPEG wins when a service refuses anything else, and
          PNG stays the choice for flat graphics and transparency. Images never leave the device — each one is redrawn on a canvas in this tab.
        </p>
      </Panel>
    </ToolShell>
  );
}