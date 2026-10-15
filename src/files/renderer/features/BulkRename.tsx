import React, { useEffect, useMemo, useRef, useState } from 'react';
import { call } from '../api';
import { closeDialog, toast, toastError } from '../state/app';
import { Button, Dialog, Pill, Segmented } from '../ui/components';
import { Icon } from '../ui/Icon';
import { startOperation } from '../actions';
import {
  DATE_FORMAT_HELP, RENAME_RULE_LABELS, RENAME_TOKENS, defaultRule,
  type RenamePreset, type RenamePreview, type RenameRule, type RenameRuleType, type RenameSpec, type RenameStatus,
} from '../../shared/rename';

/**
 * Bulk rename: an ordered list of rules (each can be switched off), a live
 * preview computed by the main process, saved presets, and one undoable
 * rename-batch operation for the rows that will be renamed.
 */

const STATUS: Record<RenameStatus, { label: string; tone: 'success' | 'neutral' | 'error' | 'warning' }> = {
  renamed: { label: 'Rename', tone: 'success' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  conflict: { label: 'Name taken', tone: 'error' },
  duplicate: { label: 'Same name twice', tone: 'error' },
  invalid: { label: 'Cannot rename', tone: 'warning' },
};

const RULE_TYPES = Object.keys(RENAME_RULE_LABELS) as RenameRuleType[];
const ROWS_SHOWN = 500;

function initialSpec(): RenameSpec {
  return { rules: [defaultRule('replace')], includeExtension: false, onConflict: 'block', order: 'given' };
}

export function BulkRenameDialog({ paths }: { paths: string[] }) {
  const [spec, setSpec] = useState<RenameSpec>(initialSpec);
  const [preview, setPreview] = useState<RenamePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [addType, setAddType] = useState<RenameRuleType>('insert');
  const [presets, setPresets] = useState<RenamePreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    void call<RenamePreset[]>('rename:presets').then(setPresets, () => setPresets([]));
  }, []);

  useEffect(() => {
    const n = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      void call<RenamePreview>('tool:bulkRenamePreview', { paths, spec }).then(
        (r) => n === seq.current && setPreview(r),
        (e) => n === seq.current && setPreview({ items: [], error: (e as Error).message, counts: { renamed: 0, unchanged: 0, conflict: 0, duplicate: 0, invalid: 0 } }),
      ).finally(() => n === seq.current && setLoading(false));
    }, 180);
    return () => clearTimeout(t);
  }, [paths, spec]);

  const counts = preview?.counts ?? { renamed: 0, unchanged: 0, conflict: 0, duplicate: 0, invalid: 0 };
  const blocking = counts.conflict + counts.duplicate + (skipInvalid ? 0 : counts.invalid);
  const canApply = !loading && !!preview && !preview.error && counts.renamed > 0 && blocking === 0;
  const rows = useMemo(() => (preview?.items ?? []).filter((i) => !onlyProblems || ['conflict', 'duplicate', 'invalid'].includes(i.status)), [preview, onlyProblems]);

  const setRule = (i: number, patch: Partial<RenameRule>) => setSpec((s) => ({ ...s, rules: s.rules.map((r, k) => (k === i ? ({ ...r, ...patch } as RenameRule) : r)) }));
  const moveRule = (i: number, d: -1 | 1) => setSpec((s) => {
    const rules = s.rules.slice();
    const j = i + d;
    if (j < 0 || j >= rules.length) return s;
    [rules[i], rules[j]] = [rules[j]!, rules[i]!];
    return { ...s, rules };
  });

  const apply = async () => {
    const renames = (preview?.items ?? []).filter((i) => i.status === 'renamed').map((i) => ({ from: i.from, to: i.to }));
    if (!renames.length) return;
    closeDialog();
    await startOperation({ type: 'rename-batch', sources: renames.map((r) => r.from), renames, origin: 'bulk-rename' });
  };

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    try {
      const r = await call<{ preset: RenamePreset; presets: RenamePreset[] }>('rename:savePreset', { name, spec });
      setPresets(r.presets);
      setPresetId(r.preset.id);
      setPresetName('');
      toast({ level: 'success', title: `Preset “${r.preset.name}” saved` });
    } catch (err) {
      toastError(err, 'Could not save the preset');
    }
  };
  const deletePreset = async () => {
    if (!presetId) return;
    try {
      const r = await call<{ presets: RenamePreset[] }>('rename:deletePreset', { id: presetId });
      setPresets(r.presets);
      setPresetId('');
    } catch (err) {
      toastError(err, 'Could not delete the preset');
    }
  };

  const footerText = loading ? 'Updating preview…'
    : preview?.error ? 'Fix the rule shown in red to see the result.'
      : blocking ? `${counts.conflict + counts.duplicate} name clash${counts.conflict + counts.duplicate === 1 ? '' : 'es'}${!skipInvalid && counts.invalid ? ` and ${counts.invalid} item(s) that cannot be renamed` : ''} must be resolved first.`
        : `${counts.renamed} will be renamed${counts.invalid ? `, ${counts.invalid} left out` : ''}. One operation; you can undo it.`;

  return (
    <Dialog title={`Rename ${paths.length} items`} width={1120} className="bulk-rename" onClose={closeDialog} footer={
      <>
        <span className="grow muted" role="status" aria-live="polite">{footerText}</span>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!canApply} onClick={() => void apply()}>Rename {counts.renamed}</Button>
      </>
    }>
      <div className="bulk-grid">
        <div className="form bulk-rules">
          <fieldset className="bulk-presets">
            <legend className="field-label">Presets</legend>
            <div className="input-row wrap">
              <select className="input" aria-label="Saved presets" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
                <option value="">{presets.length ? 'Choose a preset…' : 'No saved presets'}</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <Button size="sm" disabled={!presetId} onClick={() => {
                const p = presets.find((x) => x.id === presetId);
                if (p) setSpec(structuredClone(p.spec));
              }}>Apply</Button>
              <Button size="sm" variant="ghost" disabled={!presetId} onClick={() => void deletePreset()}>Delete</Button>
            </div>
            <form className="input-row wrap" onSubmit={(e) => { e.preventDefault(); void savePreset(); }}>
              <input className="input" aria-label="Preset name" placeholder="Save these rules as…" maxLength={80} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
              <Button size="sm" type="submit" disabled={!presetName.trim()}>Save</Button>
            </form>
          </fieldset>

          <ol className="rule-pipeline" aria-label="Rename rules, applied in order">
            {spec.rules.map((r, i) => (
              <li key={i} className={`rule-card ${r.enabled ? '' : 'is-disabled'}`}>
                <div className="rule-card-head">
                  <label className="check">
                    <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, { enabled: e.target.checked })} />
                    <span><span className="muted tabular">{i + 1}.</span> {RENAME_RULE_LABELS[r.type]}</span>
                  </label>
                  <span className="spacer" />
                  <button type="button" className="icon-btn" aria-label={`Move rule ${i + 1} up`} disabled={i === 0} onClick={() => moveRule(i, -1)}><Icon name="chevronUp" size={14} /></button>
                  <button type="button" className="icon-btn" aria-label={`Move rule ${i + 1} down`} disabled={i === spec.rules.length - 1} onClick={() => moveRule(i, 1)}><Icon name="chevronDown" size={14} /></button>
                  <button type="button" className="icon-btn" aria-label={`Remove rule ${i + 1}`} onClick={() => setSpec((s) => ({ ...s, rules: s.rules.filter((_, k) => k !== i) }))}><Icon name="close" size={14} /></button>
                </div>
                {r.enabled && <RuleEditor rule={r} idx={i} onChange={(patch) => setRule(i, patch)} error={preview?.error?.startsWith(`Rule ${i + 1}:`) ? preview.error.slice(`Rule ${i + 1}: `.length) : undefined} />}
              </li>
            ))}
          </ol>
          <div className="input-row wrap">
            <select className="input" aria-label="Rule to add" value={addType} onChange={(e) => setAddType(e.target.value as RenameRuleType)}>
              {RULE_TYPES.map((t) => <option key={t} value={t}>{RENAME_RULE_LABELS[t]}</option>)}
            </select>
            <Button size="sm" icon="plus" disabled={spec.rules.length >= 40} onClick={() => setSpec((s) => ({ ...s, rules: [...s.rules, defaultRule(addType)] }))}>Add rule</Button>
          </div>

          <fieldset className="bulk-options">
            <legend className="field-label">Options</legend>
            <label className="check"><input type="checkbox" checked={spec.includeExtension} onChange={(e) => setSpec({ ...spec, includeExtension: e.target.checked })} /> Apply text rules to the extension too</label>
            <label className="field"><span className="field-label">Numbering order</span>
              <select className="input" value={spec.order} onChange={(e) => setSpec({ ...spec, order: e.target.value as RenameSpec['order'] })}>
                <option value="given">As shown in the folder</option><option value="name">By name</option><option value="modified">By date modified</option>
              </select>
            </label>
            <Segmented<RenameSpec['onConflict']> label="When a name is taken" value={spec.onConflict} onChange={(v) => setSpec({ ...spec, onConflict: v })} options={[{ value: 'block', label: 'Let me resolve it' }, { value: 'suffix', label: 'Add (2), (3)…' }]} />
            <label className="check"><input type="checkbox" checked={skipInvalid} onChange={(e) => setSkipInvalid(e.target.checked)} /> Leave out items that cannot be renamed</label>
          </fieldset>
          <details className="token-help">
            <summary>Tokens for “Insert text” and “Rename with a pattern”</summary>
            <dl>{RENAME_TOKENS.map((t) => <React.Fragment key={t.token}><dt className="mono">{t.token}</dt><dd>{t.meaning}</dd></React.Fragment>)}</dl>
            <p className="muted small">Date formats: {DATE_FORMAT_HELP}.</p>
          </details>
        </div>

        <div className="bulk-preview-wrap">
          <div className="bulk-summary" aria-label="Preview summary">
            {(Object.keys(STATUS) as RenameStatus[]).filter((k) => counts[k]).map((k) => <Pill key={k} tone={STATUS[k].tone}>{counts[k]} {STATUS[k].label.toLowerCase()}</Pill>)}
            <span className="spacer" />
            <label className="check small"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only problems</label>
          </div>
          {preview?.error && <p className="field-error" role="alert">{preview.error}</p>}
          <div className="bulk-preview" tabIndex={0} aria-label="Rename preview">
            <table className="table compact">
              <thead><tr><th scope="col">Current name</th><th scope="col">New name</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {(showAll ? rows : rows.slice(0, ROWS_SHOWN)).map((i) => (
                  <tr key={i.from} className={i.status === 'unchanged' ? 'is-missing' : ''}>
                    <td className="mono" title={i.from}>{i.oldName}</td>
                    <td className="mono">{i.status === 'unchanged' ? <span className="muted">—</span> : i.newName}</td>
                    <td>
                      <Pill tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Pill>
                      {i.suffixed && <span className="muted small"> numbered</span>}
                      {i.reason && <div className="muted small">{i.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && !loading && <p className="muted small pad">{onlyProblems ? 'No problems.' : 'Nothing to preview.'}</p>}
          </div>
          {!showAll && rows.length > ROWS_SHOWN && <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all {rows.length} rows</Button>}
        </div>
      </div>
    </Dialog>
  );
}

function NumField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className="input" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Math.trunc(Number(e.target.value) || 0))))} />
    </label>
  );
}

function TextIn({ id, label, value, onChange, mono, hint, error, maxLength = 512, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; mono?: boolean; hint?: string; error?: string; maxLength?: number; placeholder?: string }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`} htmlFor={id}>
      <span className="field-label">{label}</span>
      <input id={id} className={`input ${mono ? 'mono' : ''}`} value={value} maxLength={maxLength} placeholder={placeholder} spellCheck={false} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-msg` : undefined} onChange={(e) => onChange(e.target.value)} />
      {(error || hint) && <span id={`${id}-msg`} className={error ? 'field-error' : 'field-hint'}>{error ?? hint}</span>}
    </label>
  );
}

function Choice<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function RuleEditor({ rule: r, idx, onChange, error }: { rule: RenameRule; idx: number; onChange: (patch: Partial<RenameRule>) => void; error?: string }) {
  const id = (k: string) => `br-${idx}-${k}`;
  const position: Array<['start' | 'end' | 'index', string]> = [['start', 'At the start'], ['end', 'At the end'], ['index', 'At a position']];
  switch (r.type) {
    case 'replace':
      return (
        <div className="rule-body">
          <TextIn id={id('find')} label="Find" value={r.find} mono={r.regex} error={error} maxLength={1024} onChange={(v) => onChange({ find: v })} />
          <TextIn id={id('replace')} label="Replace with" value={r.replace} maxLength={1024} hint={r.regex ? 'Use $1, $2… for captured groups.' : undefined} onChange={(v) => onChange({ replace: v })} />
          <div className="check-row">
            <label className="check"><input type="checkbox" checked={r.regex} onChange={(e) => onChange({ regex: e.target.checked })} /> Regular expression</label>
            <label className="check"><input type="checkbox" checked={r.caseSensitive} onChange={(e) => onChange({ caseSensitive: e.target.checked })} /> Match case</label>
          </div>
        </div>
      );
    case 'insert':
      return (
        <div className="rule-body two-col">
          <TextIn id={id('text')} label="Text" value={r.text} error={error} placeholder="e.g. {parent} " onChange={(v) => onChange({ text: v })} />
          <Choice id={id('at')} label="Where" value={r.at} options={position} onChange={(v) => onChange({ at: v })} />
          {r.at === 'index' && <NumField id={id('index')} label="After character" value={r.index} min={0} max={1024} onChange={(v) => onChange({ index: v })} />}
        </div>
      );
    case 'remove':
      return (
        <div className="rule-body two-col">
          <Choice id={id('mode')} label="Remove" value={r.mode} options={[['range', 'Characters from a position'], ['start', 'Characters at the start'], ['end', 'Characters at the end']]} onChange={(v) => onChange({ mode: v })} />
          <NumField id={id('count')} label="How many" value={r.count} min={0} max={1024} onChange={(v) => onChange({ count: v })} />
          {r.mode === 'range' && <NumField id={id('from')} label="Starting after character" value={r.from} min={0} max={1024} onChange={(v) => onChange({ from: v })} />}
        </div>
      );
    case 'case':
      return (
        <div className="rule-body">
          <Choice id={id('mode')} label="Case" value={r.mode} options={[['lower', 'lower case'], ['upper', 'UPPER CASE'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['camel', 'camelCase'], ['kebab', 'kebab-case'], ['snake', 'snake_case']]} onChange={(v) => onChange({ mode: v })} />
        </div>
      );
    case 'number':
      return (
        <div className="rule-body two-col">
          <NumField id={id('start')} label="Start at" value={r.start} min={-1_000_000_000} max={1_000_000_000} onChange={(v) => onChange({ start: v })} />
          <NumField id={id('step')} label="Step" value={r.step} min={-1_000_000} max={1_000_000} onChange={(v) => onChange({ step: v })} />
          <NumField id={id('pad')} label="Digits (zero padding)" value={r.pad} min={0} max={10} onChange={(v) => onChange({ pad: v })} />
          <TextIn id={id('sep')} label="Separator" value={r.separator} maxLength={8} onChange={(v) => onChange({ separator: v })} />
          <Choice id={id('at')} label="Where" value={r.at} options={position} onChange={(v) => onChange({ at: v })} />
          {r.at === 'index' && <NumField id={id('index')} label="After character" value={r.index} min={0} max={1024} onChange={(v) => onChange({ index: v })} />}
          <label className="check span-2"><input type="checkbox" checked={r.perFolder} onChange={(e) => onChange({ perFolder: e.target.checked })} /> Start again in each folder</label>
        </div>
      );
    case 'date':
      return (
        <div className="rule-body two-col">
          <Choice id={id('src')} label="Date" value={r.source} options={[['modified', 'Date modified'], ['created', 'Date created'], ['exif', 'Photo taken (EXIF)']]} onChange={(v) => onChange({ source: v })} />
          <TextIn id={id('fmt')} label="Format" value={r.format} mono maxLength={64} hint={DATE_FORMAT_HELP} error={error} onChange={(v) => onChange({ format: v })} />
          <Choice id={id('at')} label="Where" value={r.at} options={[['start', 'At the start'], ['end', 'At the end']]} onChange={(v) => onChange({ at: v })} />
          <TextIn id={id('sep')} label="Separator" value={r.separator} maxLength={8} onChange={(v) => onChange({ separator: v })} />
          {r.source === 'exif' && <Choice id={id('fb')} label="Without a photo date" value={r.fallback} options={[['skip', 'Leave the item out'], ['modified', 'Use the date modified']]} onChange={(v) => onChange({ fallback: v })} />}
        </div>
      );
    case 'extension':
      return (
        <div className="rule-body two-col">
          <Choice id={id('mode')} label="Extension" value={r.mode} options={[['lower', 'lower case'], ['upper', 'UPPER CASE'], ['set', 'Change to…'], ['remove', 'Remove']]} onChange={(v) => onChange({ mode: v })} />
          {r.mode === 'set' && <TextIn id={id('value')} label="New extension" value={r.value} mono maxLength={64} error={error} placeholder="jpg" onChange={(v) => onChange({ value: v })} />}
        </div>
      );
    case 'spaces':
      return (
        <div className="rule-body">
          <div className="check-row">
            <label className="check"><input type="checkbox" checked={r.trim} onChange={(e) => onChange({ trim: e.target.checked })} /> Trim the ends</label>
            <label className="check"><input type="checkbox" checked={r.collapse} onChange={(e) => onChange({ collapse: e.target.checked })} /> Collapse repeated spaces</label>
          </div>
          <Choice id={id('us')} label="Underscores" value={r.underscores} options={[['keep', 'Leave as they are'], ['to-spaces', 'Underscores → spaces'], ['from-spaces', 'Spaces → underscores']]} onChange={(v) => onChange({ underscores: v })} />
        </div>
      );
    case 'diacritics':
      return <p className="rule-body muted small">Removes accents (é → e, ü → u) and spells out ß, æ, ø and similar letters.</p>;
    case 'template':
      return (
        <div className="rule-body">
          <TextIn id={id('pattern')} label="New name (without extension)" value={r.pattern} mono error={error} placeholder="{parent} {n:3}" onChange={(v) => onChange({ pattern: v })} />
        </div>
      );
  }
}
