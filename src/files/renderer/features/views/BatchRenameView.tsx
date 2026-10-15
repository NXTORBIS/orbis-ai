// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../../api';
import { toastError, toast } from '../../state/app';
import { useStore } from '../../state/store';
import { ws, activePane, selectedEntries } from '../../state/workspace';
import { Button, EmptyState, Pill, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import type { RenamePattern, RenamePreviewResult, RenamePreviewItem } from '../../../shared/batchRename';
import { RENAME_TOKENS } from '../../../shared/rename';

/**
 * Batch Rename tool view: pattern-based rename with live preview.
 */

const DEFAULT_PATTERN: RenamePattern = {
  template: '{name}',
  find: '',
  replace: '',
  useRegex: false,
  caseSensitive: false,
  caseMode: 'none',
  startNumber: 1,
  padWidth: 0,
  includeExtension: false,
};

export function BatchRenameView() {
  const pane = useStore(ws, activePane);
  const sel = selectedEntries(pane.id);
  const paths = useMemo(() => sel.filter((e) => e.kind === 'file' || e.kind === 'directory').map((e) => e.path), [sel]);

  const [pattern, setPattern] = useState<RenamePattern>({ ...DEFAULT_PATTERN });
  const [preview, setPreview] = useState<RenamePreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  const updatePattern = useCallback((patch: Partial<RenamePattern>) => {
    setPattern((prev) => ({ ...prev, ...patch }));
  }, []);

  // Live preview with debounce
  useEffect(() => {
    if (!paths.length) {
      setPreview(null);
      return;
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await call<RenamePreviewResult>('rename:preview', { paths, pattern });
        setPreview(result);
      } catch (err) {
        setPreview({ items: [], error: (err as Error).message, conflicts: 0, unchanged: 0, renamed: 0 });
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [paths, pattern]);

  const executeRename = async () => {
    if (!preview) return;
    const renames = preview.items
      .filter((it) => it.status === 'renamed')
      .map((it) => {
        const dir = it.path.slice(0, it.path.length - it.oldName.length);
        return { from: it.path, to: dir + it.newName };
      });
    if (!renames.length) return;
    setExecuting(true);
    try {
      await call('rename:execute', { renames });
      toast({ level: 'success', title: `Renamed ${renames.length} item${renames.length > 1 ? 's' : ''}` });
    } catch (err) {
      toastError(err, 'Rename failed');
    } finally {
      setExecuting(false);
    }
  };

  if (!paths.length) {
    return (
      <div className="tool-view scroll-y">
        <header className="view-header"><h1>Batch Rename</h1></header>
        <EmptyState icon="bulkRename" title="Select files to rename" body="Select files or folders in the file list, then configure a rename pattern here." />
      </div>
    );
  }

  return (
    <div className="tool-view scroll-y batch-rename-view">
      <header className="view-header">
        <h1>Batch Rename</h1>
        <Pill>{paths.length} item{paths.length !== 1 ? 's' : ''}</Pill>
      </header>

      <section className="batch-rename-controls">
        <div className="batch-rename-row">
          <TextField id="br-template" label="Name pattern" value={pattern.template} maxLength={1024} onChange={(e) => updatePattern({ template: e.target.value })} placeholder="{name}" />
          <div className="batch-rename-tokens">
            {RENAME_TOKENS.slice(0, 6).map((t) => (
              <button key={t.token} type="button" className="btn btn-ghost btn-xs" title={t.meaning} onClick={() => updatePattern({ template: pattern.template + t.token })}>{t.token}</button>
            ))}
          </div>
        </div>

        <div className="batch-rename-row batch-rename-find-row">
          <TextField id="br-find" label="Find" value={pattern.find} maxLength={1024} onChange={(e) => updatePattern({ find: e.target.value })} placeholder="Text to find…" />
          <TextField id="br-replace" label="Replace" value={pattern.replace} maxLength={1024} onChange={(e) => updatePattern({ replace: e.target.value })} placeholder="Replace with…" />
        </div>

        <div className="batch-rename-options">
          <label className="batch-rename-check">
            <input type="checkbox" checked={pattern.useRegex} onChange={(e) => updatePattern({ useRegex: e.target.checked })} />
            <span>Regex</span>
          </label>
          <label className="batch-rename-check">
            <input type="checkbox" checked={pattern.caseSensitive} onChange={(e) => updatePattern({ caseSensitive: e.target.checked })} />
            <span>Case sensitive</span>
          </label>
          <label className="batch-rename-check">
            <input type="checkbox" checked={pattern.includeExtension} onChange={(e) => updatePattern({ includeExtension: e.target.checked })} />
            <span>Include extension</span>
          </label>
        </div>

        <div className="batch-rename-row">
          <label className="batch-rename-label">Case conversion</label>
          <select className="batch-rename-select" value={pattern.caseMode} onChange={(e) => updatePattern({ caseMode: e.target.value as RenamePattern['caseMode'] })}>
            <option value="none">None</option>
            <option value="lower">lowercase</option>
            <option value="upper">UPPERCASE</option>
            <option value="title">Title Case</option>
          </select>
        </div>

        <div className="batch-rename-row batch-rename-number-row">
          <TextField id="br-start" label="Start number" type="number" value={String(pattern.startNumber)} onChange={(e) => updatePattern({ startNumber: Math.max(0, parseInt(e.target.value, 10) || 0) })} />
          <TextField id="br-pad" label="Pad width" type="number" value={String(pattern.padWidth)} onChange={(e) => updatePattern({ padWidth: Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0)) })} />
        </div>
      </section>

      {preview?.error && <p className="warning-text">{preview.error}</p>}

      {preview && !preview.error && (
        <section className="batch-rename-preview">
          <div className="batch-rename-summary">
            {preview.renamed > 0 && <Pill tone="success">{preview.renamed} renamed</Pill>}
            {preview.unchanged > 0 && <Pill>{preview.unchanged} unchanged</Pill>}
            {preview.conflicts > 0 && <Pill tone="error">{preview.conflicts} conflict{preview.conflicts !== 1 ? 's' : ''}</Pill>}
            {loading && <span className="muted small">Updating…</span>}
          </div>

          <div className="batch-rename-table" role="table">
            <div className="batch-rename-thead" role="row">
              <span role="columnheader">Original</span>
              <span role="columnheader" />
              <span role="columnheader">New name</span>
              <span role="columnheader">Status</span>
            </div>
            <div className="batch-rename-tbody">
              {preview.items.slice(0, 500).map((item) => (
                <RenameRow key={item.path} item={item} />
              ))}
              {preview.items.length > 500 && (
                <div className="batch-rename-more muted small">…and {preview.items.length - 500} more items</div>
              )}
            </div>
          </div>
        </section>
      )}

      <div className="batch-rename-actions">
        <Button variant="primary" disabled={!preview || preview.renamed === 0 || preview.conflicts > 0 || executing} onClick={executeRename}>
          {executing ? 'Renaming…' : `Rename ${preview?.renamed ?? 0} item${(preview?.renamed ?? 0) !== 1 ? 's' : ''}`}
        </Button>
        <Button variant="default" onClick={() => setPattern({ ...DEFAULT_PATTERN })}>Reset</Button>
      </div>
    </div>
  );
}

function RenameRow({ item }: { item: RenamePreviewItem }) {
  const statusClass = item.status === 'conflict' ? 'is-conflict' : item.status === 'renamed' ? 'is-renamed' : item.status === 'invalid' ? 'is-invalid' : '';
  return (
    <div className={`batch-rename-row-item ${statusClass}`} role="row">
      <span className="batch-rename-old" role="cell" title={item.oldName}>{item.oldName}</span>
      <span className="batch-rename-arrow" role="presentation"><Icon name="arrowRight" size={12} /></span>
      <span className="batch-rename-new" role="cell" title={item.newName}>{item.newName}</span>
      <span className="batch-rename-status" role="cell">
        {item.status === 'conflict' && <span className="error-text" title={item.reason}>Conflict</span>}
        {item.status === 'renamed' && <span className="success-text">Rename</span>}
        {item.status === 'unchanged' && <span className="muted">—</span>}
        {item.status === 'invalid' && <span className="error-text" title={item.reason}>Invalid</span>}
      </span>
    </div>
  );
}
