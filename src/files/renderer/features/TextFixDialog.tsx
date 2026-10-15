import { useEffect, useState } from 'react';
import { call, errorShape } from '../api';
import { closeDialog } from '../state/app';
import { startOperation } from '../actions';
import { Button, Dialog, Pill, Segmented } from '../ui/components';
import { formatBytes, formatCount } from '../ui/format';
import { DEFAULT_TEXT_FIX, ENCODING_LABEL, SOURCE_ENCODINGS, type SourceEncoding, type TextFixPreview, type TextFixSpec } from '../../shared/docTools';

/**
 * Text fixes for selected files, previewed per file before anything changes:
 * convert to UTF-8, line endings, trailing whitespace, final newline, BOM.
 * Applying runs a 'text-fix' operation (snapshot first, atomic replace, undo).
 */

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const SOURCE_LABEL: Record<SourceEncoding, string> = { auto: 'Detect automatically', ...ENCODING_LABEL };

function changeChips(p: TextFixPreview): string[] {
  const c = p.changes;
  if (!c) return [];
  const out: string[] = [];
  if (c.converted) out.push(`${ENCODING_LABEL[p.encoding!]} → UTF-8`);
  if (c.bomRemoved) out.push('BOM removed');
  if (c.lineEndingsChanged) out.push(`${formatCount(c.lineEndingsChanged, 'line ending')} changed`);
  if (c.linesTrimmed) out.push(`${formatCount(c.linesTrimmed, 'line')} trimmed`);
  if (c.finalNewlineAdded) out.push('Final newline added');
  return out;
}

function eolText(e?: TextFixPreview['lineEndings']): string {
  if (!e) return '';
  const parts = [e.lf ? `${e.lf} LF` : '', e.crlf ? `${e.crlf} CRLF` : '', e.cr ? `${e.cr} CR` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no line breaks';
}

export function TextFixDialog({ paths }: { paths: string[] }) {
  const [spec, setSpec] = useState<TextFixSpec>({ ...DEFAULT_TEXT_FIX, lineEndings: 'lf', trimTrailing: true, finalNewline: true });
  const [preview, setPreview] = useState<TextFixPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof TextFixSpec>(k: K, v: TextFixSpec[K]) => setSpec((s) => ({ ...s, [k]: v }));
  const nothingChosen = !spec.toUtf8 && spec.lineEndings === 'keep' && !spec.trimTrailing && !spec.finalNewline && !spec.removeBom;

  useEffect(() => {
    let live = true;
    setPreview(null);
    setError(null);
    const t = setTimeout(() => {
      call<TextFixPreview[]>('textfix:preview', { paths: paths.slice(0, 2000), spec }).then(
        (r) => live && setPreview(r),
        (err) => live && setError(errorShape(err).message),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [paths, spec]);

  const ready = preview?.filter((p) => !p.refused && p.changed) ?? [];
  const refused = preview?.filter((p) => p.refused) ?? [];
  const unchanged = preview?.filter((p) => !p.refused && !p.changed) ?? [];
  // The dialog itself is the preview: the table above lists every change before the button is pressed.
  const apply = async () => {
    if (!ready.length) return;
    setBusy(true);
    const rec = await startOperation({ type: 'text-fix', sources: ready.map((p) => p.path), params: { spec, files: ready.map((p) => ({ path: p.path, sha256: p.sha256! })) }, origin: 'text-fix' });
    setBusy(false);
    if (rec) closeDialog();
  };

  return (
    <Dialog title={paths.length === 1 ? `Fix text file · ${baseName(paths[0]!)}` : `Fix ${paths.length} text files`} width={820} className="text-fix" onClose={closeDialog} footer={
      <>
        <span className="grow muted small" role="status" aria-live="polite">
          {!preview ? (error ? '' : 'Checking the files…') : nothingChosen ? 'Choose at least one fix.' : `${formatCount(ready.length, 'file')} will change${unchanged.length ? ` · ${unchanged.length} already fine` : ''}${refused.length ? ` · ${refused.length} left alone` : ''}`}
        </span>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" icon="textFix" disabled={busy || !ready.length || nothingChosen} onClick={() => void apply()}>Fix {ready.length ? formatCount(ready.length, 'file') : 'files'}</Button>
      </>
    }>
      <div className="textfix-options">
        <fieldset className="textfix-group">
          <legend>Encoding</legend>
          <label className="check"><input type="checkbox" checked={spec.toUtf8} onChange={(e) => set('toUtf8', e.target.checked)} /> Convert to UTF-8 (without BOM)</label>
          <label className="field" htmlFor="textfix-from">
            <span className="field-label">Read the files as</span>
            <select id="textfix-from" className="input" value={spec.from} onChange={(e) => set('from', e.target.value as SourceEncoding)}>
              {SOURCE_ENCODINGS.map((x) => <option key={x} value={x}>{SOURCE_LABEL[x]}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={spec.removeBom} onChange={(e) => set('removeBom', e.target.checked)} /> Remove a UTF-8 byte-order mark (BOM)</label>
        </fieldset>
        <fieldset className="textfix-group">
          <legend>Lines</legend>
          <Segmented<TextFixSpec['lineEndings']> label="Line endings" value={spec.lineEndings} onChange={(v) => set('lineEndings', v)} options={[{ value: 'keep', label: 'Keep' }, { value: 'lf', label: 'LF (Linux, macOS)' }, { value: 'crlf', label: 'CRLF (Windows)' }]} />
          <label className="check"><input type="checkbox" checked={spec.trimTrailing} onChange={(e) => set('trimTrailing', e.target.checked)} /> Trim spaces and tabs at line ends</label>
          <label className="check"><input type="checkbox" checked={spec.finalNewline} onChange={(e) => set('finalNewline', e.target.checked)} /> End with a newline</label>
        </fieldset>
      </div>
      <p className="muted small">Nothing changes until you press Fix. Each file is then saved as a snapshot, replaced with the fixed version and checked; Undo restores the snapshots. Binary files are left alone.</p>
      {error && <div className="callout warning" role="alert">{error}</div>}
      {preview && (
        <div className="textfix-table-wrap">
          <table className="table textfix-table" aria-label="What changes in each file">
            <thead><tr><th scope="col">File</th><th scope="col">Read as</th><th scope="col" className="wide-only">Line endings</th><th scope="col">Changes</th></tr></thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.path} className={p.refused ? 'is-refused' : ''}>
                  <td className="cell-path">
                    <span className="mono">{baseName(p.path)}</span>
                    <div className="cell-sub tabular">{formatBytes(p.size)}{p.newSize !== undefined && p.newSize !== p.size ? ` → ${formatBytes(p.newSize)}` : ''}</div>
                    {p.sample !== undefined && !p.refused && <div className="cell-sub textfix-sample" title="The beginning of the file as it will be read">{p.sample || '(empty)'}</div>}
                  </td>
                  <td>{p.encoding ? <>{ENCODING_LABEL[p.encoding]}{p.bom ? ' + BOM' : ''}<div className="cell-sub">{p.encodingSource === 'bom' ? 'from its BOM' : p.encodingSource === 'chosen' ? 'as chosen' : 'detected'}</div></> : '—'}</td>
                  <td className="wide-only small tabular">{eolText(p.lineEndings)}{p.trailingWhitespaceLines ? <div className="cell-sub">{formatCount(p.trailingWhitespaceLines, 'line')} with trailing spaces</div> : null}</td>
                  <td>
                    {p.refused ? <span className="warning-text small">{p.refused}</span> : p.changed ? (
                      <span className="pill-row tight">{changeChips(p).map((c) => <Pill key={c} tone="accent">{c}</Pill>)}</span>
                    ) : <span className="muted small">Already as requested</span>}
                    <div className="narrow-only cell-sub">{eolText(p.lineEndings)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
