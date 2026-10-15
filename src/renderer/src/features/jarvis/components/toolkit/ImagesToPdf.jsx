import { useRef, useState } from 'react';
import { jsPDF } from 'jspdf';
import { ArrowDown, ArrowUp, FileText, Loader2, Upload, X } from 'lucide-react';
import ToolShell from './kit/ToolShell';
import { Field, Panel, Seg, Stat, ToggleRow, downloadBlob, fmtBytes, readFileAsDataURL } from './shared';

const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };

const loadImage = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = dataUrl;
});

export default function ImagesToPdf() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState('a4');
  const [orientation, setOrientation] = useState('auto');
  const [margin, setMargin] = useState(24);
  const [quality, setQuality] = useState(0.88);
  const [maxEdge, setMaxEdge] = useState(1800);
  const [numbered, setNumbered] = useState(false);
  const [fitMode, setFitMode] = useState('contain');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pending = useRef(false);

  const addFiles = async (fileList) => {
    const list = Array.from(fileList || []).filter((f) => f.type.startsWith('image/')).slice(0, 30);
    if (!list.length) { setError('Choose image files (PNG, JPEG, WebP) to build the PDF from.'); return; }
    const loaded = await Promise.all(list.map(async (file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      size: file.size,
      dataUrl: await readFileAsDataURL(file),
      width: 0,
      height: 0,
    })));
    const measured = await Promise.all(loaded.map(async (item) => {
      try {
        const image = await loadImage(item.dataUrl);
        return { ...item, width: image.naturalWidth, height: image.naturalHeight };
      } catch {
        return { ...item, width: 0, height: 0 };
      }
    }));
    setItems((current) => [...current, ...measured].slice(0, 30));
    setError('');
    setStatus('');
  };

  const move = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setItems(next);
  };

  const build = async () => {
    if (!items.length) { setError('Add at least one image.'); return; }
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setStatus('Preparing pages…');
    try {
      const [baseWidth, baseHeight] = PAGE_SIZES[page] || PAGE_SIZES.a4;
      let doc = null;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const image = await loadImage(item.dataUrl);
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (quality >= 1) {
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        const data = canvas.toDataURL(quality >= 1 ? 'image/png' : 'image/jpeg', quality);
        const landscape = orientation === 'landscape' || (orientation === 'auto' && canvas.width > canvas.height);
        const pageWidth = landscape ? baseHeight : baseWidth;
        const pageHeight = landscape ? baseWidth : baseHeight;
        if (index === 0) doc = new jsPDF({ unit: 'pt', format: [pageWidth, pageHeight], orientation: landscape ? 'landscape' : 'portrait' });
        else doc.addPage([pageWidth, pageHeight], landscape ? 'landscape' : 'portrait');

        const usableWidth = pageWidth - margin * 2;
        const usableHeight = pageHeight - margin * 2;
        let drawWidth = usableWidth;
        let drawHeight = (canvas.height / canvas.width) * usableWidth;
        if (fitMode === 'contain' ? drawHeight > usableHeight : fitMode === 'contain') {
          drawHeight = usableHeight;
          drawWidth = (canvas.width / canvas.height) * usableHeight;
        }
        if (fitMode === 'fill') {
          if (drawHeight < usableHeight) {
            drawHeight = usableHeight;
            drawWidth = (canvas.width / canvas.height) * usableHeight;
          }
        }
        const x = margin + (usableWidth - drawWidth) / 2;
        const y = margin + (usableHeight - drawHeight) / 2;
        doc.addImage(data, quality >= 1 ? 'PNG' : 'JPEG', x, y, drawWidth, drawHeight, undefined, 'FAST');
        if (numbered) {
          doc.setFontSize(9);
          doc.setTextColor(150);
          doc.text(`${index + 1} / ${items.length}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        }
        setStatus(`Composing page ${index + 1} of ${items.length}…`);
      }
      const blob = doc.output('blob');
      downloadBlob(blob, 'images.pdf');
      setStatus(`Your PDF is ready — ${items.length} page${items.length === 1 ? '' : 's'}, ${fmtBytes(blob.size)}.`);
    } catch (e) {
      setError('One of the images could not be read. Try re-saving it as PNG or JPEG.');
    } finally {
      setBusy(false);
      pending.current = false;
    }
  };

  const totalSize = items.reduce((sum, item) => sum + item.size, 0);

  return (
    <ToolShell
      toolId="images-to-pdf"
      icon={FileText}
      title="Images → PDF"
      desc="Turn photos, scans and screenshots into one tidy PDF — page-per-image, your choice of paper, margins and quality."
      state={{ page, orientation, margin, quality, maxEdge, numbered, fitMode }}
      onRestore={(restored) => {
        if (restored.page) setPage(restored.page);
        if (restored.orientation) setOrientation(restored.orientation);
        if (restored.margin !== undefined) setMargin(Number(restored.margin));
        if (restored.quality) setQuality(Number(restored.quality));
        if (restored.maxEdge) setMaxEdge(Number(restored.maxEdge));
        if (typeof restored.numbered === 'boolean') setNumbered(restored.numbered);
        if (restored.fitMode) setFitMode(restored.fitMode);
      }}
      exportText={items.length ? `${items.length} images → PDF\n${items.map((i, n) => `${n + 1}. ${i.name} (${i.width}×${i.height})`).join('\n')}` : ''}
      exportName="images-to-pdf.txt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-3 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20">
          <span className="inline-flex items-center gap-1.5"><Upload className="h-3.5 w-3.5" /> Add images</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
        </label>
        {!!items.length && (
          <button type="button" onClick={() => { setItems([]); setStatus(''); setError(''); }} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition hover:text-red-500">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
        <button
          type="button"
          onClick={build}
          disabled={!items.length || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-j/50 bg-cyan-j/10 px-4 py-1.5 text-xs text-cyan-j transition hover:bg-cyan-j/20 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />} Build PDF
        </button>
        {status && <span className="text-[11px] text-cyan-j">{status}</span>}
      </div>

      {!!items.length && (
        <Panel className="!p-3">
          <div className="space-y-1.5">
            {items.map((item, index) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-2 py-1.5">
                <img src={item.dataUrl} alt="" className="h-9 w-9 rounded-md border border-border/60 object-cover" />
                <span className="min-w-0 flex-1 truncate text-[11px]" title={item.name}>{index + 1}. {item.name}</span>
                <span className="shrink-0 font-mono-j text-[10px] text-muted-foreground">{item.width ? `${item.width}×${item.height}` : '—'} · {fmtBytes(item.size)}</span>
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="text-muted-foreground transition hover:text-cyan-j disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === items.length - 1} className="text-muted-foreground transition hover:text-cyan-j disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))} className="text-muted-foreground transition hover:text-red-500">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {error && <Panel className="border-amber-500/40 text-[11px] text-amber-500">{error}</Panel>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Paper size">
          <Seg value={page} onChange={setPage} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
        </Field>
        <Field label="Page direction">
          <Seg value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
        </Field>
        <Field label="Image fit">
          <Seg value={fitMode} onChange={setFitMode} options={[{ value: 'contain', label: 'Fit inside' }, { value: 'fill', label: 'Fill page' }]} />
        </Field>
        <Field label={`Margin · ${margin}pt`}>
          <input type="range" min={0} max={80} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label={`Quality · ${Math.round(quality * 100)}%`}>
          <input type="range" min={0.4} max={1} step={0.02} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="w-full accent-[hsl(var(--cyan))]" />
        </Field>
        <Field label="Max image edge">
          <Seg value={maxEdge} onChange={setMaxEdge} options={[{ value: 1200, label: '1200' }, { value: 1800, label: '1800' }, { value: 2400, label: '2400' }]} />
        </Field>
      </div>

      <ToggleRow label="Stamp page numbers" checked={numbered} onChange={setNumbered} />

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Images" value={String(items.length)} mono />
        <Stat label="Input size" value={totalSize ? fmtBytes(totalSize) : '—'} mono />
        <Stat label="Pages" value={String(items.length)} mono sub="one image each" />
      </div>

      <Panel>
        <p className="text-[11px] text-muted-foreground">
          Images are re-encoded in the browser at the size you choose, which is what keeps scans small enough to email — everything is composed and
          saved on your device, and nothing is uploaded.
        </p>
      </Panel>
    </ToolShell>
  );
}