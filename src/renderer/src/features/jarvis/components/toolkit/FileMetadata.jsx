import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Button } from '@jarvis/components/ui/button';
import { ToolHeader, Stat, CopyBtn, fmtBytes } from './shared';

export default function FileMetadata() {
  const [meta, setMeta] = useState(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    const m = { name: f.name, size: f.size, type: f.type || 'unknown', ext: f.name.split('.').pop() || 'none', lastModified: new Date(f.lastModified).toLocaleString() };
    if (f.type.startsWith('image/')) {
      const url = URL.createObjectURL(f);
      const img = new Image(); img.src = url;
      await new Promise((r) => { img.onload = r; img.onerror = r; });
      m.dimensions = `${img.naturalWidth} × ${img.naturalHeight}`;
      m.aspect = (img.naturalWidth / img.naturalHeight).toFixed(3);
      URL.revokeObjectURL(url);
    }
    if (f.type.startsWith('audio/') || f.type.startsWith('video/')) {
      const url = URL.createObjectURL(f);
      const el = document.createElement(f.type.startsWith('audio') ? 'audio' : 'video');
      el.src = url;
      await new Promise((r) => { el.onloadedmetadata = r; el.onerror = r; });
      if (el.duration) m.duration = `${Math.round(el.duration)}s`;
      if (el.videoWidth) m.videoSize = `${el.videoWidth}×${el.videoHeight}`;
      URL.revokeObjectURL(url);
    }
    setMeta(m);
  };

  return (
    <div className="space-y-4">
      <ToolHeader icon={FileText} title="File Metadata Viewer" desc="Inspect filename, type, size, dates and media dimensions without uploading anything." />
      <label className="inline-flex">
        <Button size="sm" variant="outline" className="gap-1.5 pointer-events-none"><Upload className="h-4 w-4" /> Choose file</Button>
        <input type="file" onChange={onFile} className="hidden" />
      </label>
      {meta && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Filename" value={meta.name} />
          <Stat label="Extension" value={meta.ext} mono />
          <Stat label="MIME type" value={meta.type} mono />
          <Stat label="Size" value={fmtBytes(meta.size)} mono />
          <Stat label="Modified" value={meta.lastModified} />
          {meta.dimensions && <Stat label="Dimensions" value={meta.dimensions} mono />}
          {meta.aspect && <Stat label="Aspect ratio" value={meta.aspect} mono />}
          {meta.duration && <Stat label="Duration" value={meta.duration} mono />}
          {meta.videoSize && <Stat label="Video size" value={meta.videoSize} mono />}
          <div className="col-span-2 sm:col-span-3"><CopyBtn value={JSON.stringify(meta, null, 2)} label="Copy metadata JSON" /></div>
        </div>
      )}
    </div>
  );
}