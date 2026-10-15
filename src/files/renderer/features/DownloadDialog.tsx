import { useState } from 'react';
import { Button, Dialog, TextField, Toggle } from '../ui/components';
import { FolderPicker } from './views/common';
import { app, toastError, toast } from '../state/app';
import { useStore } from '../state/store';
import { startDownload, downloads } from '../state/downloads';
import type { DownloadOptions, ChecksumAlgorithm } from '../../shared/downloads';

export function DownloadDialog({ onClose }: { onClose: () => void }) {
  const defaultDir = useStore(app, (s) => s.known.find((k) => k.id === 'downloads')?.path ?? '');
  const settings = useStore(downloads, (s) => s.settings);

  const [url, setUrl] = useState('');
  const [destination, setDestination] = useState(settings?.defaultDir ?? defaultDir);
  const [filename, setFilename] = useState('');
  const [checksumEnabled, setChecksumEnabled] = useState(false);
  const [checksumAlgo, setChecksumAlgo] = useState<ChecksumAlgorithm>('sha256');
  const [checksumValue, setChecksumValue] = useState('');
  const [speedLimit, setSpeedLimit] = useState(false);
  const [speedLimitKBs, setSpeedLimitKBs] = useState(settings?.speedLimitKBs ?? 0);
  const [autoExtract, setAutoExtract] = useState(settings?.autoExtract ?? false);
  const [submitting, setSubmitting] = useState(false);

  const urlValid = /^https?:\/\/.+/.test(url.trim());
  const canSubmit = urlValid && destination.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const options: DownloadOptions = {};
    if (filename.trim()) options.filename = filename.trim();
    if (checksumEnabled && checksumValue.trim()) {
      options.checksum = { algorithm: checksumAlgo, expected: checksumValue.trim() };
    }
    if (speedLimit && speedLimitKBs > 0) options.speedLimitKBs = speedLimitKBs;
    if (autoExtract) options.autoExtract = true;

    try {
      await startDownload(url.trim(), destination, Object.keys(options).length ? options : undefined);
      toast({ level: 'success', title: 'Download started' });
      onClose();
    } catch (err) {
      toastError(err);
      setSubmitting(false);
    }
  };

  return (
    <Dialog title="Download file" onClose={onClose} width={560} footer={
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={() => void submit()}>Download</Button>
      </>
    }>
      <div className="form">
        <TextField
          label="URL"
          mono
          placeholder="https://example.com/file.zip"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
          error={url.length > 0 && !urlValid ? 'Enter a valid HTTP or HTTPS URL.' : undefined}
        />
        <FolderPicker label="Save to" value={destination} onChange={setDestination} />
        <TextField
          label="Filename (optional)"
          placeholder="Auto-detect from server"
          value={filename}
          onChange={(e) => setFilename(e.target.value)}
          hint="Leave blank to detect from the URL or server headers."
        />

        <div className="form-group">
          <Toggle id="dl-checksum" label="Verify checksum after download" checked={checksumEnabled} onChange={setChecksumEnabled} />
          {checksumEnabled && (
            <div className="form-row" style={{ display: 'flex', gap: 'var(--sp-2)' }}>
              <label className="field narrow">
                <span className="field-label">Algorithm</span>
                <select className="input" value={checksumAlgo} onChange={(e) => setChecksumAlgo(e.target.value as ChecksumAlgorithm)}>
                  <option value="sha256">SHA-256</option>
                  <option value="sha1">SHA-1</option>
                  <option value="md5">MD5</option>
                </select>
              </label>
              <TextField
                label="Expected hash"
                mono
                placeholder="Paste the expected hash"
                value={checksumValue}
                onChange={(e) => setChecksumValue(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          )}
        </div>

        <div className="form-group">
          <Toggle id="dl-speed" label="Limit download speed" checked={speedLimit} onChange={setSpeedLimit} />
          {speedLimit && (
            <label className="field narrow">
              <span className="field-label">Max speed (KB/s)</span>
              <input type="number" className="input narrow" min={1} max={1000000} value={speedLimitKBs || ''} onChange={(e) => setSpeedLimitKBs(Math.max(0, Number(e.target.value) || 0))} />
            </label>
          )}
        </div>

        <Toggle id="dl-extract" label="Auto-extract archive after download" checked={autoExtract} onChange={setAutoExtract} />
      </div>
    </Dialog>
  );
}
