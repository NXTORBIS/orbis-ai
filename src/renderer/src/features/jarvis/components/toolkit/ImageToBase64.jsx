import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { ToolHeader, Stat, Out, CopyBtn, Panel, ToggleRow, readFileAsDataURL } from './shared';

export default function ImageToBase64() {
  const [dataUrl, setDataUrl] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState(0);
  const [stripPrefix, setStripPrefix] = useState(false);
  const [err, setErr] = useState(null);

  const onFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please choose an image file (PNG, JPG, WebP, GIF or SVG).'); return; }
    setErr(null);
    setName(file.name);
    setSize(file.size);
    try { setDataUrl(await readFileAsDataURL(file)); } catch { setErr('Could not read that file.'); }
  };

  const payload = stripPrefix ? dataUrl.split(',')[1] || '' : dataUrl;
  const mime = (dataUrl.match(/^data:(.*?);/) || [])[1] || '';

  return (
    <div className="space-y-4">
      <ToolHeader icon={ImageIcon} title="Image to Base64" desc="Inline any image as a data URL for CSS, HTML or JSON — no server needed." />
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-8 text-center transition hover:border-cyan-j/50">
        <ImageIcon className="h-6 w-6 text-cyan-j" strokeWidth={1.5} />
        <span className="text-sm">Click to choose an image</span>
        <span className="text-[11px] text-muted-foreground">PNG, JPG, WebP, GIF or SVG — converted locally in your browser</span>
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {err && <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-600 dark:text-amber-400">{err}</div>}
      {dataUrl && (
        <>
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <img src={dataUrl} alt={name} className="h-40 w-full rounded-xl border border-border/70 bg-secondary/40 object-contain" />
            <div className="grid grid-cols-2 gap-2">
              <Stat label="File name" value={name} />
              <Stat label="Type" value={mime || 'image'} mono />
              <Stat label="Original size" value={`${(size / 1024).toFixed(1)} KB`} />
              <Stat label="Base64 size" value={`${(dataUrl.length / 1024).toFixed(1)} KB`} />
            </div>
          </div>
          <ToggleRow label="Copy without the data: prefix" checked={stripPrefix} onChange={setStripPrefix} />
          <Out label="Data URL" value={payload}>
            <div className="max-h-32 overflow-y-auto break-all font-mono-j text-[11px] scrollbar-thin">{dataUrl.slice(0, 600)}{dataUrl.length > 600 ? '…' : ''}</div>
          </Out>
          <div className="flex flex-wrap gap-2">
            <CopyBtn value={payload} label="Copy Base64" />
            <CopyBtn value={`background-image: url("${dataUrl}");`} label="Copy CSS" />
            <CopyBtn value={`<img src="${dataUrl}" alt="${name}" />`} label="Copy HTML" />
          </div>
        </>
      )}
      {!dataUrl && (
        <Panel>
          <p className="text-xs text-muted-foreground">Base64 images are handy for small icons and email signatures, but they inflate file size by about a third — keep large photos as separate files.</p>
        </Panel>
      )}
    </div>
  );
}