import { useState } from 'react';
import { Image, Upload } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, fmtBytes, readFileAsDataURL } from './shared';

export default function ImageInspector() {
  const [info, setInfo] = useState(null);
  const [src, setSrc] = useState(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const url = await readFileAsDataURL(f); setSrc(url);
    const img = new Image(); img.src = url;
    await new Promise((r) => { img.onload = r; img.onerror = r; });
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const g = gcd(img.naturalWidth, img.naturalHeight);
    setInfo({ name: f.name, size: f.size, type: f.type, w: img.naturalWidth, h: img.naturalHeight, ratio: `${img.naturalWidth / g}:${img.naturalHeight / g}`, mp: ((img.naturalWidth * img.naturalHeight) / 1e6).toFixed(1) });
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={Image} title="Image Dimension Inspector" desc="Inspect width, height, aspect ratio, megapixels and file size." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose image</Button>
        <input type="file" accept="image/*" onChange={onFile} className="hidden" />
      </label>
      {src && <img src={src} alt="inspect" className="max-h-56 rounded-lg border border-border object-contain" />}
      {info && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Dimensions" value={`${info.w} × ${info.h}`} mono />
          <Stat label="Aspect ratio" value={info.ratio} mono />
          <Stat label="Megapixels" value={`${info.mp} MP`} mono />
          <Stat label="File size" value={fmtBytes(info.size)} mono />
          <Stat label="Format" value={info.type} mono />
          <Stat label="Filename" value={info.name} />
        </div>
      )}
    </div>
  );
}