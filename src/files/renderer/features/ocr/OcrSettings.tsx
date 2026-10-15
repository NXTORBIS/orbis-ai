import { useEffect, useState } from 'react';
import { call } from '../../api';
import { confirm, toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { loadCapabilities, ocr, refreshLanguages } from '../../state/ocr';
import { Button, Pill, Segmented, Toggle } from '../../ui/components';
import { formatBytes, formatDate } from '../../ui/format';
import type { OcrIndexSettings, OcrIndexStatus, OcrLanguageInfo } from '../../../shared/ocr';

/**
 * Settings → Text recognition: the installed languages (English is built in;
 * others are .traineddata files the user adds from their computer, never
 * downloaded) and "Make text in images searchable" (opt-in background job with
 * its folders, limits, threads and languages; turning it off deletes the text).
 */

export function OcrSettings() {
  const languages = useStore(ocr, (s) => s.languages);
  const index = useStore(ocr, (s) => s.index);
  const caps = useStore(ocr, (s) => s.caps);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    void loadCapabilities();
    void call<OcrIndexStatus>('ocr:indexStatus').then((st) => ocr.set({ index: st }), () => undefined);
  }, []);

  const add = async () => {
    const file = await call<string | null>('ocr:pickLanguageFile').catch(() => null);
    if (!file) return;
    setAdding(true);
    try {
      const info = await call<OcrLanguageInfo>('ocr:addLanguage', { path: file });
      await refreshLanguages();
      toast({ level: 'success', title: `Added ${info.name}`, detail: `${info.code}.traineddata (${formatBytes(info.bytes)}) was checked and copied into this profile.` });
    } catch (err) {
      toastError(err, 'The language was not added');
    } finally {
      setAdding(false);
    }
  };
  const remove = async (l: OcrLanguageInfo) => {
    if (!(await confirm({ title: `Remove ${l.name}?`, body: `The copy of ${l.code}.traineddata in this profile is deleted. Your own file is not affected; you can add it again.`, confirmLabel: 'Remove' }))) return;
    await call('ocr:removeLanguage', { code: l.code }).then(() => refreshLanguages(), toastError);
  };
  const update = (patch: Partial<OcrIndexSettings>) => call<OcrIndexStatus>('ocr:indexSettings', patch).then((st) => ocr.set({ index: st }), toastError);
  const s = index?.settings;
  const busy = index?.state === 'scanning' || index?.state === 'paused';

  return (
    <section className="settings-group ocr-settings" id="settings-ocr" aria-labelledby="settings-ocr-title">
      <h2 id="settings-ocr-title" tabIndex={-1}>Text recognition</h2>
      <p className="muted">Text in images and PDFs is recognized on this computer by the Tesseract engine (tesseract.js, built in). Nothing is uploaded, and nothing is downloaded: English is included, and you can add other languages from files you have.</p>

      <h3>Languages</h3>
      <div className="ocr-lang-table" role="list" aria-label="Installed languages">
        {languages.map((l) => (
          <div key={l.code} className="list-row" role="listitem">
            <span className="ocr-lang-name">{l.name}</span>
            {l.name !== l.code && <span className="muted mono small">{l.code}</span>}
            <Pill tone={l.source === 'bundled' ? 'accent' : 'neutral'}>{l.source === 'bundled' ? 'built in' : 'added'}</Pill>
            <span className="muted tabular small">{formatBytes(l.bytes)}</span>
            <span className="spacer" />
            {l.source === 'added' && <Button size="sm" variant="ghost" onClick={() => void remove(l)} aria-label={`Remove ${l.name}`}>Remove</Button>}
          </div>
        ))}
      </div>
      <div className="setting-actions">
        <Button icon="plus" onClick={() => void add()} disabled={adding}>{adding ? 'Checking the file…' : 'Add language file…'}</Button>
      </div>
      <p className="muted small">Choose a <span className="mono">.traineddata</span> file you already have (for example from Tesseract’s tessdata, tessdata_fast or tessdata_best collections); its name is the language code, such as <span className="mono">deu.traineddata</span>. Each file is checked by starting the engine with it before it is copied. Several languages can be used together (for example English + German) from the Text tab and the extract dialog.</p>

      <h3>Search by the text in images</h3>
      {s && (
        <>
          <Toggle
            id="ocr-index-on"
            label="Make text in images searchable"
            description="Recognizes the images in the folders below in the background and keeps their text in this profile, so content:“…” searches find pictures by the words in them (shown with a “text in image” badge). Changed images are read again. Turning this off deletes all the stored text."
            checked={s.enabled}
            onChange={(v) => void update({ enabled: v })}
          />
          {s.enabled && index && (
            <div className="ocr-index-status" role="status" aria-live="polite">
              <Pill tone={index.state === 'scanning' ? 'accent' : index.state === 'paused' ? 'warning' : 'success'}>{index.state === 'scanning' ? 'Working' : index.state === 'paused' ? 'Paused' : 'Up to date'}</Pill>
              <span className="tabular">{index.stored.toLocaleString()} image{index.stored === 1 ? '' : 's'} with text</span>
              {busy && <span className="muted tabular">{index.recognized.toLocaleString()} recognized · {index.pending.toLocaleString()} waiting{index.skipped ? ` · ${index.skipped.toLocaleString()} over the limits` : ''}{index.failed ? ` · ${index.failed.toLocaleString()} unreadable` : ''}</span>}
              {!busy && index.lastRunMs && <span className="muted">checked {formatDate(index.lastRunMs)}</span>}
              {index.lastError && <Pill tone="error">{index.lastError}</Pill>}
              <span className="spacer" />
              {index.state === 'scanning' && <Button size="sm" icon="pause" onClick={() => void call('ocr:indexPause')}>Pause</Button>}
              {index.state === 'paused' && <Button size="sm" icon="play" onClick={() => void call('ocr:indexResume')}>Resume</Button>}
              {busy && <Button size="sm" icon="stop" onClick={() => void call('ocr:indexCancel')}>Stop</Button>}
              {!busy && <Button size="sm" icon="refresh" onClick={() => void call('ocr:indexRun')}>Check now</Button>}
            </div>
          )}
          {s.enabled && (
            <>
              <div className="index-roots" role="list" aria-label="Folders whose images are recognized">
                {!s.folders.length ? <p className="muted">No folders are chosen.</p> : s.folders.map((f) => (
                  <div key={f} className="list-row" role="listitem">
                    <span className="mono ocr-folder">{f}</span>
                    <span className="spacer" />
                    <Button size="sm" variant="ghost" aria-label={`Stop recognizing images in ${f}`} onClick={() => void update({ folders: s.folders.filter((x) => x !== f) })}>Remove</Button>
                  </div>
                ))}
              </div>
              <div className="setting-actions">
                <Button icon="plus" onClick={async () => {
                  const p = await call<string | null>('fs:pickDirectory', { title: 'Recognize the images in…' }).catch(() => null);
                  if (p && !s.folders.includes(p)) await update({ folders: [...s.folders, p] });
                }}>Add folder</Button>
              </div>
              <div className="setting-line">
                <span className="setting-label">Skip images over</span>
                <div className="setting-control">
                  <NumberSetting value={s.maxFileMB} min={1} max={200} label="Largest image file, in MB" onCommit={(v) => void update({ maxFileMB: v })} />
                  <span className="muted small">MB or</span>
                  <NumberSetting value={s.maxMegapixels} min={1} max={100} label="Largest image, in megapixels" onCommit={(v) => void update({ maxMegapixels: v })} />
                  <span className="muted small">megapixels</span>
                </div>
              </div>
              <div className="setting-line">
                <span className="setting-label" id="ocr-threads-label">Images at a time</span>
                <div className="setting-control">
                  <Segmented label="Images recognized at a time" value={String(s.workers) as '1' | '2'} onChange={(v) => void update({ workers: Number(v) as 1 | 2 })} options={[{ value: '1', label: 'One' }, { value: '2', label: 'Two' }]} />
                </div>
                <p className="setting-hint">{index?.priorityNote ?? caps?.priorityNote} Each thread holds its own copy of the engine and language data (about 50–150 MB).</p>
              </div>
              <div className="setting-line">
                <span className="setting-label">Languages</span>
                <div className="setting-control" role="group" aria-label="Languages for images made searchable">
                  {languages.map((l) => {
                    const on = s.langs.includes(l.code);
                    return (
                      <label key={l.code} className="check">
                        <input type="checkbox" checked={on} disabled={on && s.langs.length === 1} onChange={() => void update({ langs: on ? s.langs.filter((x) => x !== l.code) : [...s.langs, l.code].slice(0, 6) })} />
                        <span>{l.name}</span>
                      </label>
                    );
                  })}
                </div>
                <p className="setting-hint">Changing languages reads every image again.</p>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** A number field that applies its value when it is left or Enter is pressed (each change re-checks the folders). */
function NumberSetting({ value, min, max, label, onCommit }: { value: number; min: number; max: number; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Math.max(min, Math.min(max, Math.round(Number(text) || min)));
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  return <input type="number" className="input num" min={min} max={max} value={text} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />;
}
