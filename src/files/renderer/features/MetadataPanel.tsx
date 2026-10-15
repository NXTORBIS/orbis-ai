import { useEffect, useState } from 'react';
import { call } from '../api';
import { toast, toastError } from '../state/app';
import type { MetadataResult, MetadataEntry, MetadataGroup } from '../../shared/metadata';

interface Props {
  path: string;
}

const GROUP_LABELS: Record<MetadataGroup, string> = {
  camera: 'Camera',
  location: 'Location',
  image: 'Image',
  file: 'File',
  audio: 'Audio',
  document: 'Document',
};

const GROUP_ORDER: MetadataGroup[] = ['camera', 'location', 'image', 'audio', 'document', 'file'];

export function MetadataPanel({ path }: Props) {
  const [data, setData] = useState<MetadataResult | null>(null);
  const [error, setError] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = () => {
    setError(false);
    void call<MetadataResult>('metadata:read', { path }).then((r) => {
      setData(r);
      setEdits({});
    }, () => setError(true));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load depends only on path
  useEffect(() => { load(); }, [path]);

  if (error) return null;
  if (!data) return <div className="metadata-loading muted">Reading metadata…</div>;
  if (!data.entries.length) return null;

  const grouped = new Map<MetadataGroup, MetadataEntry[]>();
  for (const entry of data.entries) {
    const list = grouped.get(entry.group) ?? [];
    list.push(entry);
    grouped.set(entry.group, list);
  }

  const hasEdits = Object.keys(edits).length > 0;
  const hasGps = data.entries.some((e) => e.key === 'Latitude');
  const lat = data.entries.find((e) => e.key === 'Latitude')?.value;
  const lon = data.entries.find((e) => e.key === 'Longitude')?.value;

  const handleSave = async () => {
    if (!hasEdits) return;
    setSaving(true);
    try {
      await call('metadata:write', { path, edits });
      toast({ level: 'success', title: 'Metadata saved' });
      load();
    } catch (e) {
      toastError(e as Error);
    }
    setSaving(false);
  };

  const handleStrip = async () => {
    setSaving(true);
    try {
      await call('metadata:strip', { path });
      toast({ level: 'success', title: 'All metadata stripped' });
      load();
    } catch (e) {
      toastError(e as Error);
    }
    setSaving(false);
  };

  const copyAll = () => {
    const text = data.entries.map((e) => `${e.key}: ${e.value}`).join('\n');
    void navigator.clipboard.writeText(text).then(
      () => toast({ level: 'success', title: 'Metadata copied to clipboard' }),
      () => toastError(new Error('Failed to copy')),
    );
  };

  return (
    <div className="metadata-panel">
      <div className="metadata-header">
        <h3>Metadata <span className="muted small">— {data.format}</span></h3>
        <div className="tb-group wrap">
          <button type="button" className="btn btn-ghost btn-sm" onClick={copyAll}>Copy all</button>
          {data.canWrite && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleStrip()} disabled={saving}>Strip all metadata</button>}
        </div>
      </div>

      {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
        <div key={group} className="metadata-group">
          <h4 className="metadata-group-title">{GROUP_LABELS[group]}</h4>
          <dl className="metadata-entries">
            {grouped.get(group)!.map((entry) => (
              <div key={entry.key} className="metadata-row">
                <dt>{entry.key}</dt>
                <dd>
                  {entry.editable ? (
                    <input
                      type="text"
                      className="input input-sm"
                      value={edits[entry.key] ?? entry.value}
                      onChange={(e) => setEdits({ ...edits, [entry.key]: e.target.value })}
                    />
                  ) : (
                    <span className="break">{entry.value}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {group === 'location' && hasGps && lat && lon && (
            <a
              href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`}
              className="linklike metadata-map-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Maps
            </a>
          )}
        </div>
      ))}

      {hasEdits && (
        <div className="metadata-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>Save changes</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdits({})}>Discard</button>
        </div>
      )}
    </div>
  );
}
