import { useCallback, useEffect, useState } from 'react';
import { call } from '../../api';
import { openDialog, toast } from '../../state/app';
import { activePane, selectedEntries } from '../../state/workspace';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { categoryOfEntry } from '../../ui/format';
import { type ImageToolSpec, type ImagePreset, BUILTIN_IMAGE_PRESETS } from '../../../shared/imageTools';

/**
 * Bulk Image Tools: a dedicated tool view for batch processing images.
 * Provides quick access to resize, convert, compress, rotate/flip, and strip
 * EXIF metadata. Users select images in the file pane, then open this view
 * to configure and run batch operations.
 */

export function BulkImageToolView() {
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [presets, setPresets] = useState<ImagePreset[]>([]);

  useEffect(() => {
    void call<ImagePreset[]>('images:presets').then((p) => setPresets([...BUILTIN_IMAGE_PRESETS, ...p]));
  }, []);

  const refreshSelection = useCallback(() => {
    const pane = activePane();
    const sel = selectedEntries(pane.id).filter((e) => categoryOfEntry(e) === 'image');
    setSelectedPaths(sel.map((e) => e.path));
  }, []);

  useEffect(() => { refreshSelection(); }, [refreshSelection]);

  const openBatch = (paths: string[]) => {
    if (paths.length === 0) { toast({ level: 'info', title: 'Select images in the file pane first.' }); return; }
    openDialog('imageTools', { paths });
  };

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Bulk Image Tools</h1>
      </header>
      <div className="bulk-image-content">
        <section className="bulk-image-section">
          <h2>Quick Actions</h2>
          <p className="muted">Select images in the file listing, then choose an action or preset below.</p>
          <div className="bulk-image-actions">
            <Button variant="primary" icon="imageTools" onClick={() => openBatch(selectedPaths)} disabled={selectedPaths.length === 0}>
              Open Batch Tool ({selectedPaths.length} image{selectedPaths.length !== 1 ? 's' : ''})
            </Button>
            <Button variant="default" icon="refresh" onClick={refreshSelection}>Refresh Selection</Button>
          </div>
        </section>

        <section className="bulk-image-section">
          <h2>Presets</h2>
          <div className="bulk-image-presets">
            {presets.map((p) => (
              <button key={p.id} type="button" className="bulk-image-preset" onClick={() => openBatch(selectedPaths)}>
                <div className="bulk-image-preset-name">
                  {p.builtIn && <Icon name="star" size={12} />}
                  <span>{p.name}</span>
                </div>
                <span className="bulk-image-preset-desc muted">{describeSpec(p.spec)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="bulk-image-section">
          <h2>Supported Formats</h2>
          <div className="bulk-image-formats">
            {['JPEG', 'PNG', 'WebP', 'AVIF', 'BMP', 'GIF', 'TIFF', 'SVG', 'ICO', 'HEIC'].map((f) => (
              <span key={f} className="bulk-image-format-badge">{f}</span>
            ))}
          </div>
          <p className="muted">Input formats above can be converted to JPEG, PNG, WebP, AVIF or BMP.</p>
        </section>

        <section className="bulk-image-section">
          <h2>Tips</h2>
          <ul className="muted">
            <li>Select multiple images in the file pane, then press the Open Batch Tool button above.</li>
            <li>Use keyboard shortcut or the File menu to access Batch Image Tools from any folder.</li>
            <li>The live preview shows the first selected image with your chosen transformations applied.</li>
            <li>Processed images are saved next to the originals with a suffix (e.g. -web), or in a folder you choose.</li>
            <li>No originals are overwritten unless the suffix is empty and no output folder is set.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function describeSpec(spec: ImageToolSpec): string {
  const parts: string[] = [];
  if (spec.resize.mode !== 'none') {
    if (spec.resize.mode === 'fit') parts.push(`Fit ${spec.resize.width}×${spec.resize.height}`);
    else if (spec.resize.mode === 'exact') parts.push(`Exact ${spec.resize.width}×${spec.resize.height}`);
    else if (spec.resize.mode === 'percent') parts.push(`${spec.resize.percent}%`);
  }
  if (spec.format !== 'keep') parts.push(spec.format.toUpperCase());
  if (spec.quality !== 85) parts.push(`Q${spec.quality}`);
  if (spec.stripMetadata) parts.push('Strip EXIF');
  if (spec.rotate) parts.push(`Rotate ${spec.rotate}°`);
  if (spec.flipH) parts.push('Flip H');
  if (spec.flipV) parts.push('Flip V');
  if (spec.crop) parts.push(`Crop ${spec.crop.w}:${spec.crop.h}`);
  return parts.join(' · ') || 'No changes';
}
