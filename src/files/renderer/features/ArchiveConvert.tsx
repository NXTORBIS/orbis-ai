import { useState } from 'react';
import { call } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { Button, Dialog } from '../ui/components';
import { CONVERT_FORMATS, type ConvertFormat, type ArchiveConvertResult } from '../../shared/archiveEdit';
import { formatBytes } from '../ui/format';

/**
 * Archive format conversion dialog. Lets the user pick a target format and
 * optionally a destination folder, then calls archive:convert. The password
 * (if the archive needs one) is passed in from the ArchiveView's memory.
 */
export function ArchiveConvertDialog({ archivePath, currentFormat, password }: { archivePath: string; currentFormat: string; password?: string }) {
  const [target, setTarget] = useState<ConvertFormat>(
    CONVERT_FORMATS.find((f) => f.id !== currentFormat)?.id ?? 'zip',
  );
  const [destination, setDestination] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const pickDestination = async () => {
    const dir = await call<string | null>('fs:pickDirectory', { title: 'Save converted archive to...' }).catch(() => null);
    if (dir) setDestination(dir);
  };

  const convert = async () => {
    setBusy(true);
    try {
      const result = await call<ArchiveConvertResult>('archive:convert', {
        archivePath,
        targetFormat: target,
        destination,
        ...(password !== undefined ? { password } : {}),
      });
      toast({
        level: 'success',
        title: 'Archive converted',
        detail: `Created ${result.path.split(/[\\/]/).pop()} (${formatBytes(result.size)})`,
      });
      closeDialog();
    } catch (err) {
      toastError(err, 'Could not convert the archive');
      setBusy(false);
    }
  };

  const archiveName = archivePath.split(/[\\/]/).pop() ?? archivePath;

  return (
    <Dialog title="Convert archive" onClose={closeDialog} width={480} footer={
      <>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={busy || target === currentFormat} onClick={() => void convert()}>
          {busy ? 'Converting...' : 'Convert'}
        </Button>
      </>
    }>
      <p className="muted small">Create a new archive from the contents of <strong>{archiveName}</strong> in a different format. The original is not modified.</p>
      <div className="form-grid">
        <label htmlFor="archive-convert-format" className="form-label">Target format</label>
        <select id="archive-convert-format" className="form-select" value={target} disabled={busy}
          onChange={(e) => setTarget(e.target.value as ConvertFormat)}>
          {CONVERT_FORMATS.filter((f) => f.id !== currentFormat).map((f) => (
            <option key={f.id} value={f.id}>{f.label} ({f.ext})</option>
          ))}
        </select>
        <label className="form-label">Destination</label>
        <div>
          <span className="muted small">{destination ?? 'Same folder as the original'}</span>
          {' '}
          <button type="button" className="link-btn" disabled={busy} onClick={() => void pickDestination()}>Choose...</button>
        </div>
      </div>
    </Dialog>
  );
}
