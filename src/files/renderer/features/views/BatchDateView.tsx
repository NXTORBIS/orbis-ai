// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, selectedEntries } from '../../state/workspace';
import { Button, EmptyState, Pill, Segmented } from '../../ui/components';
import type { DateModifySpec, DateModifyResult, DateField } from '../../../shared/batchDate';

type Mode = DateModifySpec['mode'];

function formatDate(ms: number | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

export function BatchDateView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const paths = useMemo(() => sel.filter((e) => e.kind === 'file' || e.kind === 'directory').map((e) => e.path), [sel]);

  const [mode, setMode] = useState<Mode>('set');
  const [dateValue, setDateValue] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 16);
  });
  const [shiftAmount, setShiftAmount] = useState(0);
  const [shiftUnit, setShiftUnit] = useState<'hours' | 'days' | 'months'>('days');
  const [fields, setFields] = useState<DateField[]>(['modified']);
  const [preview, setPreview] = useState<DateModifyResult[] | null>(null);
  const [original, setOriginal] = useState<DateModifyResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const shiftMs = useMemo(() => {
    const v = shiftAmount;
    switch (shiftUnit) {
      case 'hours': return v * 3600_000;
      case 'days': return v * 86400_000;
      case 'months': return v * 30 * 86400_000;
    }
  }, [shiftAmount, shiftUnit]);

  const spec = useMemo((): DateModifySpec => ({
    mode,
    date: mode === 'set' ? dateValue : undefined,
    shiftMs: mode === 'shift' ? shiftMs : undefined,
    fields,
  }), [mode, dateValue, shiftMs, fields]);

  const toggleField = (f: DateField) => {
    setFields((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  };

  // Live preview
  useEffect(() => {
    if (!paths.length || !fields.length) {
      setPreview(null);
      return;
    }
    setApplied(false);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await call<DateModifyResult[]>('date:preview', { paths, spec });
        setPreview(result);
      } catch (err) {
        toastError(err);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [paths, spec, fields]);

  const apply = useCallback(async () => {
    if (!paths.length) return;
    try {
      setOriginal(preview);
      const result = await call<DateModifyResult[]>('date:modify', { paths, spec });
      const ok = result.filter((r) => !r.error).length;
      const errors = result.filter((r) => r.error).length;
      toast({ level: 'success', title: `${ok} file${ok === 1 ? '' : 's'} updated${errors ? `, ${errors} error${errors === 1 ? '' : 's'}` : ''}` });
      setPreview(result);
      setApplied(true);
    } catch (err) {
      toastError(err);
    }
  }, [paths, spec, preview]);

  const undo = useCallback(async () => {
    if (!original) return;
    for (const r of original) {
      if (r.error) continue;
      try {
        await call('date:modify', {
          paths: [r.path],
          spec: { mode: 'set' as const, date: new Date(r.oldModifiedMs).toISOString(), fields: ['modified' as const, 'accessed' as const] },
        });
      } catch { /* best effort */ }
    }
    toast({ level: 'success', title: 'Dates restored' });
    setApplied(false);
    setOriginal(null);
    if (paths.length) {
      const result = await call<DateModifyResult[]>('date:preview', { paths, spec });
      setPreview(result);
    }
  }, [original, paths, spec]);

  if (!paths.length) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Batch Date Modifier</h1></header>
        <EmptyState icon="clock" title="Select files" body="Select files in the file list to change their timestamps." />
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y">
      <header className="view-header">
        <h1>Batch Date Modifier</h1>
        <span className="muted">{paths.length} file{paths.length === 1 ? '' : 's'} selected</span>
      </header>

      <div className="batchdate-controls">
        <div className="batchdate-mode">
          <label className="batchdate-label">Mode</label>
          <Segmented
            label="Date mode"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { value: 'set', label: 'Set date' },
              { value: 'shift', label: 'Shift' },
              { value: 'fromName', label: 'From filename' },
              { value: 'fromExif', label: 'From EXIF' },
            ]}
          />
        </div>

        {mode === 'set' && (
          <div className="batchdate-input">
            <label className="batchdate-label">Date and time</label>
            <input type="datetime-local" className="batchdate-datetime" value={dateValue} onChange={(e) => setDateValue(e.target.value)} />
          </div>
        )}

        {mode === 'shift' && (
          <div className="batchdate-shift">
            <label className="batchdate-label">Shift by</label>
            <div className="batchdate-shift-row">
              <input type="number" className="batchdate-number" value={shiftAmount} onChange={(e) => setShiftAmount(Number(e.target.value))} />
              <Segmented
                label="Shift unit"
                value={shiftUnit}
                onChange={(v) => setShiftUnit(v as 'hours' | 'days' | 'months')}
                options={[
                  { value: 'hours', label: 'Hours' },
                  { value: 'days', label: 'Days' },
                  { value: 'months', label: 'Months' },
                ]}
              />
            </div>
          </div>
        )}

        <div className="batchdate-fields">
          <label className="batchdate-label">Fields to modify</label>
          <div className="batchdate-checkboxes">
            {(['modified', 'accessed', 'created'] as DateField[]).map((f) => (
              <label key={f} className="symlink-checkbox">
                <input type="checkbox" checked={fields.includes(f)} onChange={() => toggleField(f)} />
                <span>{f.charAt(0).toUpperCase() + f.slice(1)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      {preview && preview.length > 0 && (
        <section className="batchdate-preview">
          <h2 className="batchdate-preview-title">Preview</h2>
          <div className="symlink-table">
            <div className="symlink-row symlink-header">
              <span>File</span><span>Current modified</span><span>New modified</span><span>Source</span><span>Status</span>
            </div>
            {preview.map((r) => (
              <div key={r.path} className={`symlink-row ${r.error ? 'symlink-broken' : ''}`}>
                <span className="ellipsis mono" title={r.path}>{r.name}</span>
                <span className="tabular small">{formatDate(r.oldModifiedMs)}</span>
                <span className="tabular small">{r.error ? '—' : formatDate(r.newModifiedMs)}</span>
                <span className="small muted">{r.source ?? ''}</span>
                <span>{r.error ? <Pill tone="error" title={r.error}>error</Pill> : <Pill>ok</Pill>}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="batchdate-actions">
        {applied && original && (
          <Button size="sm" onClick={undo}>Undo</Button>
        )}
        <Button size="sm" variant="primary" onClick={apply} disabled={loading || !preview?.some((r) => !r.error && r.newModifiedMs !== undefined)}>
          {loading ? 'Loading...' : `Apply to ${paths.length} file${paths.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </div>
  );
}
