import { useEffect, useMemo, useRef, useState } from 'react';
import { Image as ImageIcon, Upload } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Hero, Pills } from './kit/premium';
import { CopyBtn, Field, Panel, Seg, Stat, ToggleRow, downloadBlob } from './shared';

const MAX_SIDE = 1400;

const loadImage = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => resolve({ url: reader.result, img });
    img.onerror = () => reject(new Error('That file is not an image the browser can read.'));
    img.src = reader.result;
  };
  reader.onerror = () => reject(new Error('That file could not be read.'));
  reader.readAsDataURL(file);
});

const sample = (img) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
};

const emptySlot = { url: null, name: '', size: 0 };

export default function ImageDiff() {
  const [slotA, setSlotA] = useState(emptySlot);
  const [slotB, setSlotB] = useState(emptySlot);
  const [samples, setSamples] = useState({ a: null, b: null });
  const [threshold, setThreshold] = useState('24');
  const [view, setView] = useState('diff');
  const [blend, setBlend] = useState('50');
  const [error, setError] = useState('');
  const [diffUrl, setDiffUrl] = useState('');
  const canvasRef = useRef(null);

  const pick = async (which, file) => {
    if (!file) return;
    setError('');
    try {
      const loaded = await loadImage(file);
      const data = sample(loaded.img);
      if (which === 'a') {
        setSlotA({ url: loaded.url, name: file.name, size: file.size });
        setSamples((current) => ({ ...current, a: data }));
      } else {
        setSlotB({ url: loaded.url, name: file.name, size: file.size });
        setSamples((current) => ({ ...current, b: data }));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const diff = useMemo(() => {
    const { a, b } = samples;
    if (!a || !b) return null;
    const width = Math.min(a.width, b.width);
    const height = Math.min(a.height, b.height);
    const total = width * height;
    const limit = Number(threshold) || 0;
    const output = new Uint8ClampedArray(width * height * 4);
    let changed = 0;
    let sumDelta = 0;
    let maxDelta = 0;
    const histogram = new Array(8).fill(0);
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const indexA = (y * a.width + x) * 4;
        const indexB = (y * b.width + x) * 4;
        const index = (y * width + x) * 4;
        const dr = a.data[indexA] - b.data[indexB];
        const dg = a.data[indexA + 1] - b.data[indexB + 1];
        const db = a.data[indexA + 2] - b.data[indexB + 2];
        const delta = (Math.abs(dr) + Math.abs(dg) + Math.abs(db)) / 3;
        sumDelta += delta;
        maxDelta = Math.max(maxDelta, delta);
        histogram[Math.min(7, Math.floor(delta / 32))] += 1;
        const isChanged = delta > limit;
        if (isChanged) {
          changed += 1;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        const lum = 0.299 * b.data[indexB] + 0.587 * b.data[indexB + 1] + 0.114 * b.data[indexB + 2];
        if (isChanged) {
          output[index] = 255;
          output[index + 1] = Math.round(60 + lum * 0.2);
          output[index + 2] = Math.round(80 + lum * 0.2);
        } else {
          const faded = 210 + lum * 0.18;
          output[index] = faded;
          output[index + 1] = faded;
          output[index + 2] = faded;
        }
        output[index + 3] = 255;
      }
    }

    return {
      width, height, total, changed, meanDelta: sumDelta / total, maxDelta, histogram,
      percent: (changed / total) * 100,
      region: changed ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
      sizeMismatch: a.width !== b.width || a.height !== b.height,
      pixels: output,
    };
  }, [samples, threshold]);

  useEffect(() => {
    if (!diff || !canvasRef.current) {
      setDiffUrl('');
      return;
    }
    const canvas = canvasRef.current;
    canvas.width = diff.width;
    canvas.height = diff.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(diff.pixels, diff.width, diff.height), 0, 0);
    setDiffUrl(canvas.toDataURL('image/png'));
  }, [diff]);

  const report = diff
    ? [
      `${slotA.name || 'image A'} vs ${slotB.name || 'image B'}`,
      `${diff.changed} of ${diff.total} pixels differ by more than ${threshold} (${diff.percent.toFixed(2)}%)`,
      `Mean difference ${diff.meanDelta.toFixed(1)} · largest difference ${diff.maxDelta.toFixed(0)}`,
      diff.region ? `Change region: ${diff.region.w}×${diff.region.h} at (${diff.region.x}, ${diff.region.y})` : 'No change region',
      diff.sizeMismatch ? 'The two images are different sizes — compared on the overlapping area.' : 'Both images are the same size.',
    ].join('\n')
    : 'Load two images to compare them.';

  return (
    <ToolShell
      toolId="image-diff"
      icon={ImageIcon}
      title="Image Diff & Compare"
      desc="Put two versions of a picture side by side and see exactly which pixels changed, where, and by how much — all on your own device."
      state={{ threshold, view, blend }}
      onRestore={(restored) => {
        if (restored.threshold !== undefined) setThreshold(String(restored.threshold));
        if (restored.view) setView(restored.view);
        if (restored.blend !== undefined) setBlend(String(restored.blend));
      }}
      exportText={report}
      exportName="image-diff.txt"
    >
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap items-center gap-2">
        <Seg value={view} onChange={setView} options={[{ value: 'diff', label: 'Differences' }, { value: 'blend', label: 'Blend' }, { value: 'side', label: 'Side by side' }]} />
        <CopyBtn value={report} label="Copy summary" />
        {diffUrl && (
          <button
            type="button"
            onClick={() => {
              fetch(diffUrl).then((response) => response.blob()).then((blob) => downloadBlob(blob, 'image-diff.png'));
            }}
            className="rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20"
          >
            Download diff PNG
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {[{ which: 'a', slot: slotA, label: 'Before' }, { which: 'b', slot: slotB, label: 'After' }].map((entry) => (
          <div key={entry.which} className="tk-card tk-depth rounded-xl border border-border/70 bg-gradient-to-b from-card/75 to-card/40 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium">{entry.label}</span>
              <span className="font-mono-j text-[10px] text-muted-foreground">{entry.slot.name || 'nothing loaded'}</span>
            </div>
            <label className="flex h-32 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-border/70 bg-card/40 transition hover:border-cyan-j/50">
              {entry.slot.url ? (
                <img src={entry.slot.url} alt={entry.label} className="max-h-32 w-full object-contain" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground">
                  <Upload className="h-4 w-4" />
                  Choose an image
                </span>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => pick(entry.which, e.target.files?.[0])} />
            </label>
            {!!entry.slot.size && <div className="mt-1 font-mono-j text-[10px] text-muted-foreground">{(entry.slot.size / 1024).toFixed(0)} KB</div>}
          </div>
        ))}
      </div>

      {error && <Panel className="border-rose-500/40 text-[11px] text-rose-400">{error}</Panel>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={`Ignore differences under · ${threshold}`} hint="Higher values hide compression noise and anti-aliasing">
          <input type="range" min={0} max={80} step={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Blend · ${blend}%`}>
          <input type="range" min={0} max={100} step={1} value={blend} onChange={(e) => setBlend(e.target.value)} className="w-full accent-[hsl(var(--cyan))]" disabled={view !== 'blend'} />
        </Field>
        <div className="self-end">
          <ToggleRow label="Ignore differences under threshold" checked={Number(threshold) > 0} onChange={() => {}} hint="toggle by moving the slider" />
        </div>
      </div>

      {diff ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[1.3fr_1fr]">
            <Hero
              tone={diff.percent > 5 ? 'rose' : diff.percent > 0.5 ? 'amber' : 'emerald'}
              label="Pixels changed"
              value={`${diff.percent.toFixed(2)}%`}
              sub={`${diff.changed.toLocaleString()} of ${diff.total.toLocaleString()} pixels differ by more than ${threshold} · mean difference ${diff.meanDelta.toFixed(1)}`}
            />
            <Panel className="!p-3">
              <div className="mb-2 text-xs font-medium">How big the differences are</div>
              <div className="space-y-1">
                {diff.histogram.map((count, index) => (
                  <div key={index} className="flex items-center gap-2 text-[11px]">
                    <span className="w-16 font-mono-j text-muted-foreground">{index * 32}–{index * 32 + 31}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-cyan-j" style={{ width: `${(count / diff.total) * 100}%` }} />
                    </div>
                    <span className="w-14 text-right font-mono-j text-muted-foreground">{((count / diff.total) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel className="!p-3">
            <div className="mb-2 text-xs font-medium">
              {view === 'diff' ? 'Where it changed — red marks every difference' : view === 'blend' ? `Both images blended at ${blend}%` : 'Side by side'}
            </div>
            <div className="flex justify-center">
              {view === 'diff' && (
                <div className="relative inline-block max-w-full">
                  <img src={diffUrl} alt="Difference map" className="max-h-[26rem] w-auto max-w-full rounded-lg border border-border/70" />
                  {diff.region && (
                    <div
                      className="pointer-events-none absolute border-2 border-cyan-j"
                      style={{
                        left: `${(diff.region.x / diff.width) * 100}%`,
                        top: `${(diff.region.y / diff.height) * 100}%`,
                        width: `${(diff.region.w / diff.width) * 100}%`,
                        height: `${(diff.region.h / diff.height) * 100}%`,
                      }}
                    />
                  )}
                </div>
              )}
              {view === 'blend' && (
                <div className="relative inline-block max-w-full">
                  <img src={slotA.url} alt="Before" className="max-h-[26rem] w-auto max-w-full rounded-lg border border-border/70" />
                  <img
                    src={slotB.url}
                    alt="After"
                    className="absolute inset-0 h-full w-full rounded-lg object-contain"
                    style={{ opacity: Number(blend) / 100 }}
                  />
                </div>
              )}
              {view === 'side' && (
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {[slotA, slotB].map((slot, index) => (
                    <figure key={index} className="space-y-1">
                      <img src={slot.url} alt={index ? 'After' : 'Before'} className="max-h-80 w-full rounded-lg border border-border/70 object-contain" />
                      <figcaption className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">{index ? 'After' : 'Before'}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
            {diff.region && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                The cyan outline marks the full extent of the change: {diff.region.w} × {diff.region.h} pixels starting at ({diff.region.x}, {diff.region.y}).
              </p>
            )}
          </Panel>

          <div className="grid gap-2 sm:grid-cols-4">
            <Stat label="Compared size" value={`${diff.width} × ${diff.height}`} mono />
            <Stat label="Max difference" value={diff.maxDelta.toFixed(0)} mono />
            <Stat label="Mean difference" value={diff.meanDelta.toFixed(1)} mono />
            <Stat label="Same size" value={diff.sizeMismatch ? 'no' : 'yes'} mono sub={diff.sizeMismatch ? 'compared on the overlap' : 'both dimensions match'} />
          </div>
        </>
      ) : (
        <Panel className="!p-3 text-[11px] text-muted-foreground">
          Load a pair of images above — two exports of the same design, a screenshot before and after a change, or a photo next to its retouched version.
        </Panel>
      )}

      <Panel className="!p-3">
        <div className="mb-2 text-xs font-medium">Getting a useful answer</div>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>· A few tenths of a percent is normal between two JPEG exports; anything above about 1% is a real visual change.</p>
          <p>· Raise the threshold to ignore anti-aliasing and compression noise, lower it to catch a subtle colour shift in a logo or chart.</p>
          <p>· Different image sizes are compared on the overlapping area only — crop to matching dimensions first if the whole frame moved.</p>
          <p>· Use the blend view at 50% to spot a shift of a pixel or two, which a pure diff can make look dramatic.</p>
          <p>· Nothing is uploaded: both files are decoded and compared inside this page, so it is fine for unreleased artwork or client screenshots.</p>
        </div>
        <div className="mt-2">
          <Pills
            items={[
              { label: 'Mode', value: view },
              { label: 'Threshold', value: threshold },
              { label: 'Change level', value: diff ? (diff.percent > 1 ? 'significant' : diff.percent > 0.1 ? 'minor' : 'negligible') : '—' },
            ]}
          />
        </div>
      </Panel>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Each pixel is compared channel by channel against the threshold, and the difference is measured as the average of the red, green and blue gaps,
          which matches how visible a change is to the eye far better than comparing a single channel. The diff image keeps unchanged areas in a light grey so
          the red changes stand out even in a small thumbnail.
        </p>
      </Panel>
    </ToolShell>
  );
}