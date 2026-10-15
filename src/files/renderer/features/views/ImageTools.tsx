// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useEffect, useMemo, useState } from 'react';
import { call } from '../../api';
import { closeDialog, toast, toastError } from '../../state/app';
import { Button, Dialog, Pill, Segmented, Select, TextField } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { startOperation } from '../../actions';
import { loadImage } from '../videoThumbs';
import { FolderPicker } from './common';
import { crop as cropPx, flattenOnWhite, flip, resize, rotate, type Bitmap } from '../../../shared/pixels';
import { ImageToolSpecSchema, SUFFIX_RE, type ImagePlan, type ImagePreset, type ImageToolSpec, type OutputFormat } from '../../../shared/imageTools';

/**
 * Batch image tools: resize, crop to an aspect ratio, rotate/flip, remove
 * metadata, convert — previewed per image (output name, size, notes) before
 * anything is written, then run as one operation. JPEG/PNG are processed by
 * the platform codec in the main process; WebP output and formats only
 * Chromium can read are prepared here with a canvas (same pixel code).
 */

interface PlanRow { path: string; name: string; width?: number; height?: number; orientation?: number; format?: string; plan: ImagePlan; target?: string; renamed: boolean }

const DEFAULT_SPEC: ImageToolSpec = ImageToolSpecSchema.parse({ resize: { mode: 'fit', width: 1920, height: 1920 } });
const ASPECTS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'No crop' }, { value: '1:1', label: 'Square 1:1' }, { value: '4:3', label: '4:3' }, { value: '3:2', label: '3:2' }, { value: '16:9', label: '16:9' },
  { value: '3:4', label: '3:4 (portrait)' }, { value: '2:3', label: '2:3 (portrait)' }, { value: '9:16', label: '9:16 (portrait)' }, { value: '4:5', label: '4:5 (portrait)' },
];
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));

/** Decode with Chromium (camera orientation applied by the browser), transform with the shared pixel code, encode with a canvas. */
async function prepareInWindow(row: PlanRow, spec: ImageToolSpec): Promise<{ source: string; format: OutputFormat; data: Uint8Array; width: number; height: number }> {
  const img = await loadImage(row.path, 60000);
  const p = row.plan;
  const swap = spec.rotate === 90 || spec.rotate === 270;
  const expectW = swap ? p.orientedHeight : p.orientedWidth;
  const expectH = swap ? p.orientedWidth : p.orientedHeight;
  if (img.naturalWidth !== expectW || img.naturalHeight !== expectH) throw new Error(`Decoded as ${img.naturalWidth} × ${img.naturalHeight}, expected ${expectW} × ${expectH}; nothing was saved.`);
  const c0 = document.createElement('canvas');
  c0.width = img.naturalWidth;
  c0.height = img.naturalHeight;
  const g0 = c0.getContext('2d', { willReadFrequently: true });
  if (!g0) throw new Error('No drawing surface is available.');
  g0.drawImage(img, 0, 0);
  const id = g0.getImageData(0, 0, c0.width, c0.height);
  let b: Bitmap = { data: id.data, width: id.width, height: id.height };
  if (spec.rotate) b = rotate(b, spec.rotate);
  if (spec.flipH) b = flip(b, 'horizontal');
  if (spec.flipV) b = flip(b, 'vertical');
  if (p.crop) b = cropPx(b, p.crop.x, p.crop.y, p.crop.w, p.crop.h);
  if (p.scaleTo) b = resize(b, p.scaleTo.w, p.scaleTo.h);
  if (p.format === 'jpeg') b = flattenOnWhite(b, false);
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  const g = c.getContext('2d');
  if (!g) throw new Error('No drawing surface is available.');
  g.putImageData(new ImageData(new Uint8ClampedArray(b.data.buffer, b.data.byteOffset, b.data.byteLength), b.width, b.height), 0, 0);
  const mimeType = `image/${p.format}` as string;
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, mimeType, spec.quality / 100));
  if (!blob || blob.type !== mimeType) throw new Error(`This system cannot encode ${p.format.toUpperCase()} images.`);
  return { source: row.path, format: p.format, data: new Uint8Array(await blob.arrayBuffer()), width: b.width, height: b.height };
}

/** Whole-number field that lets the user clear and retype; only valid values reach the settings. */
function NumField({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText((t) => (Number(t) === value ? t : String(value))), [value]);
  const n = Number(text);
  const bad = !text || !Number.isInteger(n) || n < min || n > max;
  return (
    <TextField id={id} label={label} inputMode="numeric" value={text} error={bad ? `${min}–${max}` : undefined}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
        setText(t);
        const v = Number(t);
        if (t && v >= min && v <= max) onChange(v);
      }} />
  );
}

export function ImageToolsDialog({ paths }: { paths: string[] }) {
  const [spec, setSpec] = useState<ImageToolSpec>(DEFAULT_SPEC);
  const [presets, setPresets] = useState<ImagePreset[]>([]);
  const [presetId, setPresetId] = useState('custom');
  const [rows, setRows] = useState<PlanRow[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (patch: Partial<ImageToolSpec>) => {
    setSpec((s) => ({ ...s, ...patch }));
    setPresetId('custom');
  };
  useEffect(() => void call<ImagePreset[]>('images:presets').then(setPresets, toastError), []);
  useEffect(() => {
    const t = setTimeout(() => {
      void call<PlanRow[]>('images:plan', { paths, spec }).then((r) => {
        setRows(r);
        setPlanError(null);
      }, (e) => setPlanError((e as Error).message));
    }, 180);
    return () => clearTimeout(t);
  }, [paths, spec]);

  const ok = rows?.filter((r) => !r.plan.error && !r.plan.unchanged) ?? [];
  const failing = rows?.filter((r) => r.plan.error) ?? [];
  const unchanged = rows?.filter((r) => r.plan.unchanged) ?? [];
  const suffixBad = !SUFFIX_RE.test(spec.suffix);
  const sameNames = !spec.suffix && spec.format === 'keep' && !spec.outputFolder;
  const reencodes = ok.some((r) => r.plan.reencode);

  const applyPreset = (id: string) => {
    setPresetId(id);
    const p = presets.find((x) => x.id === id);
    if (p) setSpec({ ...p.spec, outputFolder: spec.outputFolder });
  };
  // Naming happens inline: the app's prompt dialog would replace this dialog.
  const [naming, setNaming] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>();
  const savePreset = async () => {
    const name = (naming ?? '').trim();
    if (!name) {
      setNameError('Enter a name.');
      return;
    }
    const r = await call<{ preset: ImagePreset; presets: ImagePreset[] }>('images:savePreset', { name, spec: { ...spec, outputFolder: null } }).catch((e) => {
      setNameError((e as Error).message);
      return null;
    });
    if (!r) return;
    setPresets(r.presets);
    setNaming(null);
    setNameError(undefined);
    setTimeout(() => setPresetId(r.preset.id));
    toast({ level: 'success', title: `Saved preset “${r.preset.name}”` });
  };
  const deletePreset = async () => {
    const p = presets.find((x) => x.id === presetId);
    if (!p || p.builtIn) return;
    const r = await call<{ presets: ImagePreset[] }>('images:deletePreset', { id: p.id }).catch((e) => {
      toastError(e);
      return null;
    });
    if (r) {
      setPresets(r.presets);
      setPresetId('custom');
      toast({ level: 'info', title: `Deleted preset “${p.name}”`, detail: 'Only the saved settings were deleted; the current settings stay in the dialog.' });
    }
  };

  const go = async () => {
    if (!ok.length) return;
    const encoded: Awaited<ReturnType<typeof prepareInWindow>>[] = [];
    const sources: string[] = [];
    const problems: string[] = [];
    const inWindow = ok.filter((r) => r.plan.reencode && r.plan.engine === 'renderer');
    let i = 0;
    for (const r of ok) {
      if (r.plan.reencode && r.plan.engine === 'renderer') {
        i++;
        setBusy(`Preparing ${i} of ${inWindow.length}…`);
        try {
          encoded.push(await prepareInWindow(r, spec));
        } catch (err) {
          problems.push(`${r.name}: ${(err as Error).message}`);
          continue;
        }
      }
      sources.push(r.path);
    }
    setBusy(null);
    if (problems.length) toast({ level: 'warning', title: `${problems.length} image${problems.length === 1 ? '' : 's'} could not be prepared`, detail: problems.slice(0, 3).join(' ') });
    if (!sources.length) return;
    const dirs = new Set(sources.map(dirOf));
    const destination = spec.outputFolder ?? (dirs.size === 1 ? [...dirs][0] : undefined);
    if (await startOperation({ type: 'image-batch', sources, destination, params: { spec, encoded }, origin: 'image-tools' })) closeDialog();
  };

  const resizeMode = spec.resize.mode;
  const userPreset = presets.find((p) => p.id === presetId && !p.builtIn);
  const summary = useMemo(() => {
    if (!rows) return 'Checking the images…';
    const parts = [`${ok.length} new image${ok.length === 1 ? '' : 's'}`];
    if (unchanged.length) parts.push(`${unchanged.length} unchanged (skipped)`);
    if (failing.length) parts.push(`${failing.length} cannot be processed`);
    return parts.join(' · ');
  }, [rows, ok.length, unchanged.length, failing.length]);

  return (
    <Dialog title={`Batch image tools · ${paths.length === 1 ? base(paths[0]!) : `${paths.length} images`}`} onClose={closeDialog} width={820} className="image-tools-dialog" footer={
      <>
        <span className="muted small grow" aria-live="polite">{busy ?? summary}</span>
        <Button onClick={closeDialog}>Cancel</Button>
        <Button variant="primary" disabled={!!busy || !ok.length || suffixBad || !!planError} onClick={() => void go()}>{busy ? 'Working…' : `Create ${ok.length} image${ok.length === 1 ? '' : 's'}`}</Button>
      </>
    }>
      <div className="imgt">
        <div className="imgt-settings">
          <div className="imgt-presets">
            <Select<string> id="imgt-preset" label="Preset" value={presetId} onChange={applyPreset}
              options={[{ value: 'custom', label: 'Custom settings' }, ...presets.map((p) => ({ value: p.id, label: p.builtIn ? p.name : `${p.name} (saved)` }))]} />
            {naming === null && (
              <div className="imgt-preset-actions">
                <Button size="sm" variant="ghost" icon="save" onClick={() => setNaming('')}>Save as preset…</Button>
                {userPreset && <Button size="sm" variant="ghost" onClick={() => void deletePreset()}>Delete preset</Button>}
              </div>
            )}
          </div>
          {naming !== null && (
            <div className="imgt-preset-name">
              <TextField id="imgt-preset-name" label="Preset name" value={naming} error={nameError} autoFocus maxLength={80}
                onChange={(e) => { setNaming(e.target.value); setNameError(undefined); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void savePreset(); }
                  if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); }
                }} />
              <Button size="sm" variant="primary" onClick={() => void savePreset()}>Save preset</Button>
              <Button size="sm" onClick={() => setNaming(null)}>Cancel</Button>
            </div>
          )}

          <fieldset className="imgt-group">
            <legend>Size</legend>
            <Segmented<ImageToolSpec['resize']['mode']> label="Resize" value={resizeMode} onChange={(mode) => set({ resize: mode === 'none' ? { mode } : mode === 'percent' ? { mode, percent: 50 } : { mode, width: 'width' in spec.resize ? spec.resize.width : 1600, height: 'height' in spec.resize ? spec.resize.height : 1600 } })}
              options={[{ value: 'none', label: 'Keep' }, { value: 'fit', label: 'Fit within' }, { value: 'exact', label: 'Exact' }, { value: 'percent', label: 'Percent' }]} />
            {(spec.resize.mode === 'fit' || spec.resize.mode === 'exact') && (() => {
              const rz = spec.resize;
              return (
                <div className="imgt-dims">
                  <NumField id="imgt-w" label="Width (px)" value={rz.width} min={1} max={30000} onChange={(width) => set({ resize: { ...rz, width } })} />
                  <span className="imgt-times" aria-hidden>×</span>
                  <NumField id="imgt-h" label="Height (px)" value={rz.height} min={1} max={30000} onChange={(height) => set({ resize: { ...rz, height } })} />
                </div>
              );
            })()}
            {spec.resize.mode === 'percent' && <NumField id="imgt-pct" label="Percent of the original size" value={spec.resize.percent} min={1} max={1000} onChange={(percent) => set({ resize: { mode: 'percent', percent } })} />}
            <label className="check"><input type="checkbox" checked={spec.noUpscale} onChange={(e) => set({ noUpscale: e.target.checked })} /> Never enlarge</label>
            <Select<string> id="imgt-crop" label="Crop to aspect ratio (centred)" value={spec.crop ? `${spec.crop.w}:${spec.crop.h}` : 'none'} options={ASPECTS}
              onChange={(v) => set({ crop: v === 'none' ? null : { w: Number(v.split(':')[0]), h: Number(v.split(':')[1]) } })} />
          </fieldset>

          <fieldset className="imgt-group">
            <legend>Rotate and flip</legend>
            <Segmented<string> label="Rotate clockwise" value={String(spec.rotate)} onChange={(v) => set({ rotate: Number(v) as ImageToolSpec['rotate'] })}
              options={[{ value: '0', label: 'None' }, { value: '90', label: '90°' }, { value: '180', label: '180°' }, { value: '270', label: '270°' }]} />
            <div className="imgt-checks">
              <label className="check"><input type="checkbox" checked={spec.flipH} onChange={(e) => set({ flipH: e.target.checked })} /> <Icon name="flipH" size={14} /> Flip horizontally</label>
              <label className="check"><input type="checkbox" checked={spec.flipV} onChange={(e) => set({ flipV: e.target.checked })} /> <Icon name="flipV" size={14} /> Flip vertically</label>
            </div>
          </fieldset>

          <fieldset className="imgt-group">
            <legend>Format and metadata</legend>
            <Select<ImageToolSpec['format']> id="imgt-format" label="Save as" value={spec.format} onChange={(format) => set({ format })}
              options={[{ value: 'keep', label: 'Same format (JPEG, PNG, WebP; others as PNG)' }, { value: 'jpeg', label: 'JPEG — photos, small files' }, { value: 'png', label: 'PNG — lossless, transparency' }, { value: 'webp', label: 'WebP — modern, small' }]} />
            {(spec.format === 'jpeg' || spec.format === 'webp' || (spec.format === 'keep' && rows?.some((r) => r.plan.format !== 'png'))) && (
              <label className="field" htmlFor="imgt-q"><span className="field-label">Quality ({spec.quality})</span><input id="imgt-q" type="range" min={30} max={100} value={spec.quality} onChange={(e) => set({ quality: Number(e.target.value) })} /></label>
            )}
            <label className="check"><input type="checkbox" checked={spec.stripMetadata || reencodes} disabled={reencodes} onChange={(e) => set({ stripMetadata: e.target.checked })} /> Remove EXIF, location and text metadata</label>
            {reencodes && <p className="muted small">Re-encoded images never keep EXIF, location, text or colour-profile data.</p>}
          </fieldset>

          <fieldset className="imgt-group">
            <legend>Output</legend>
            <Segmented<string> label="Save new images" value={spec.outputFolder ? 'folder' : 'next'} onChange={(v) => set({ outputFolder: v === 'folder' ? dirOf(paths[0]!) : null })}
              options={[{ value: 'next', label: 'Next to originals' }, { value: 'folder', label: 'In a folder' }]} />
            {spec.outputFolder && <FolderPicker label="Output folder" id="imgt-out" value={spec.outputFolder} onChange={(outputFolder) => set({ outputFolder })} />}
            <TextField id="imgt-suffix" label="Add to names" value={spec.suffix} error={suffixBad ? 'Remove / \\ : * ? " < > | from the suffix.' : undefined}
              hint={sameNames ? 'Without a suffix, new images get a numbered name such as “photo (2).jpg”. Originals are never replaced.' : 'Originals are never replaced; a taken name gets a number.'}
              onChange={(e) => set({ suffix: e.target.value.slice(0, 64) })} />
          </fieldset>
        </div>

        <div className="imgt-preview">
          <h3 className="imgt-preview-head">Preview</h3>
          {planError ? <p className="error-text">{planError}</p> : !rows ? <p className="muted small">Reading image sizes…</p> : (
            <ul className="imgt-rows" aria-label="Planned results">
              {rows.map((r) => (
                <li key={r.path} className={`imgt-row ${r.plan.error ? 'is-error' : r.plan.unchanged ? 'is-skip' : ''}`}>
                  <span className="imgt-row-names">
                    <span className="ellipsis" title={r.path}>{r.name}</span>
                    {r.target && <span className="imgt-arrow"><Icon name="forward" size={12} /> <span className="mono small ellipsis" title={r.target}>{base(r.target)}</span></span>}
                  </span>
                  <span className="imgt-row-dims tabular small">
                    {r.width && r.height ? `${r.width} × ${r.height}` : '—'}
                    {!r.plan.error && !r.plan.unchanged && <> → <strong>{r.plan.width} × {r.plan.height}</strong> {r.plan.format.toUpperCase()}</>}
                  </span>
                  <span className="imgt-row-notes small">
                    {r.plan.error ? <Pill tone="error">cannot process</Pill> : r.plan.unchanged ? <Pill>unchanged</Pill> : r.plan.engine === 'renderer' && r.plan.reencode ? <Pill tone="accent" title="Decoded and encoded by Chromium in this window">in window</Pill> : null}
                    {r.renamed && <Pill tone="warning" title="The name is taken; a numbered name is used">numbered</Pill>}
                    <span className="muted">{r.plan.error ?? r.plan.notes.filter((n) => !/^Re-encoded/.test(n)).join(' ')}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  );
}
