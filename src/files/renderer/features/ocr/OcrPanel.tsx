import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { call } from '../../api';
import { toast, toastError } from '../../state/app';
import { useStore } from '../../state/store';
import { langsLabel, ocr, recognizeEntry, setRunOptions } from '../../state/ocr';
import { startOperation } from '../../actions';
import { runCommand, shortcutFor } from '../../commands';
import { Button, IconButton, Pill, ProgressBar, Segmented } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { mediaUrl } from '../Preview';
import { drawPage, openPdfForThumbnails, type LoadedPdf } from '../pdfRender';
import { LOW_CONFIDENCE, boxToShown, confidenceLabel, ocrKindOf, shownSize, type OcrPageResult, type OcrResult } from '../../../shared/ocr';
import type { FileEntry } from '../../../shared/model';

/**
 * The details panel's Text tab: run text recognition on the selected image or PDF
 * and work with the result — the text with its confidence (low confidence is
 * flagged, per result and per word), word boxes over the picture with search
 * matches highlighted in the image and in the text, Copy, and Save as .txt (an
 * undoable operation that never overwrites).
 */

const tokens = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function OcrPanel({ entry }: { entry: FileEntry }) {
  const st = useStore(ocr, (s) => s.byPath[entry.path]);
  const options = useStore(ocr, (s) => s.options);
  const languages = useStore(ocr, (s) => s.languages);
  const caps = useStore(ocr, (s) => s.caps);
  const kind = ocrKindOf(entry.name) ?? 'image';
  const [showOptions, setShowOptions] = useState(false);
  const optionsId = useId();
  const running = st?.status === 'running';
  const run = () => void recognizeEntry(entry, options);
  const key = shortcutFor('ocr.recognize');

  return (
    <section className="ocr-panel" aria-label="Recognized text">
      <div className="ocr-runbar">
        <Button variant="primary" size="sm" icon="ocr" onClick={run} disabled={running} title={key ? `Recognize text (${key})` : undefined}>{st?.status === 'done' ? 'Recognize again' : 'Recognize text'}</Button>
        <button type="button" className="ocr-langs-btn" aria-expanded={showOptions} aria-controls={optionsId} onClick={() => setShowOptions((v) => !v)} title="Languages and options">
          <Icon name="languages" size={14} />
          <span className="ocr-langs-label">{langsLabel(options.langs)}</span>
          <Icon name={showOptions ? 'chevronUp' : 'chevronDown'} size={12} />
        </button>
      </div>
      {showOptions && (
        <div className="ocr-options" id={optionsId}>
          <fieldset className="ocr-lang-list">
            <legend>Languages</legend>
            {languages.map((l) => {
              const on = options.langs.includes(l.code);
              return (
                <label key={l.code} className="check">
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={on && options.langs.length === 1}
                    onChange={() => setRunOptions({ langs: on ? options.langs.filter((x) => x !== l.code) : [...options.langs, l.code].slice(0, 6) })}
                  />
                  <span>{l.name}</span>
                  {l.name !== l.code && <span className="muted small mono">{l.code}</span>}
                </label>
              );
            })}
            <button type="button" className="link-btn" onClick={() => void runCommand('ocr.settings')}>Add languages…</button>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={options.detectOrientation} onChange={(e) => setRunOptions({ detectOrientation: e.target.checked })} />
            <span>Turn upside-down or sideways pages</span>
          </label>
          {kind === 'pdf' && (
            <div className="field">
              <span className="field-label" id={`${optionsId}-pdf`}>PDF pages that already have text</span>
              <Segmented label="PDF pages that already have text" value={options.pdfTextPages} onChange={(v) => setRunOptions({ pdfTextPages: v })} options={[{ value: 'use-text', label: 'Use their text' }, { value: 'recognize', label: 'Recognize' }]} />
            </div>
          )}
        </div>
      )}

      {!st && entry.textMatch && (
        <div className="callout" role="note">
          <Icon name="imageText" size={14} />
          <span>Found by the text stored for this image{entry.textMatch.snippet ? `: “${entry.textMatch.snippet}”` : '.'} Recognize it to see the words on the picture.</span>
        </div>
      )}
      {!st && (
        <p className="ocr-intro muted">
          {kind === 'pdf' ? 'Reads the text of this PDF: scanned pages are rendered and recognized, pages that already have text use it.' : 'Finds the text in this image so you can copy it, search it or save it as a .txt file.'} Recognition runs on this computer; nothing is uploaded.
          {kind === 'pdf' && caps && !caps.pdf ? ' PDF pages cannot be rendered here.' : ''}
        </p>
      )}

      {running && (
        <div className="ocr-progress" role="status" aria-live="polite">
          <ProgressBar value={st.progress?.fraction} label="Recognizing text" />
          <div className="ocr-progress-row">
            <span className="ocr-stage-text">{st.progress?.stage ?? 'Recognizing text'}</span>
            <Button size="sm" onClick={() => st.cancel?.()}>Stop</Button>
          </div>
        </div>
      )}

      {st?.status === 'error' && (
        <div className="callout error" role="alert">
          <Icon name="error" size={14} />
          <span>{st.error?.message ?? 'The text could not be recognized.'}{st.error?.errorId ? ` (reference ${st.error.errorId})` : ''}</span>
        </div>
      )}

      {st?.status === 'done' && st.result && <OcrResultView key={`${st.result.path}:${st.result.durationMs}`} entry={entry} result={st.result} />}
    </section>
  );
}

function OcrResultView({ entry, result }: { entry: FileEntry; result: OcrResult }) {
  const [page, setPage] = useState(0);
  const [boxes, setBoxes] = useState(true);
  const [query, setQuery] = useState('');
  const findId = useId();
  const p = result.pages[page] ?? result.pages[0]!;
  const multi = result.kind === 'pdf' && result.pages.length > 1;
  const shownText = multi ? p.text : result.text;
  const terms = tokens(query);
  const count = useMemo(() => {
    if (!query.trim()) return 0;
    return (result.text.match(new RegExp(escapeRe(query.trim()), 'gi')) ?? []).length;
  }, [query, result.text]);
  const label = confidenceLabel(result.confidence);
  const tone = label === 'High' ? 'success' : label === 'Medium' ? 'accent' : label === 'Low' ? 'warning' : 'neutral';
  const stale = entry.modifiedMs !== undefined && Math.abs(entry.modifiedMs - result.mtimeMs) > 1;
  const empty = !result.text.trim();
  const pdfKind = result.pdfKind === 'scanned' ? 'Scanned PDF' : result.pdfKind === 'has-text' ? 'PDF with text' : result.pdfKind === 'mixed' ? 'Partly scanned PDF' : undefined;
  const lowWords = p.words.filter((w) => w.conf < LOW_CONFIDENCE).length;

  const copy = async () => {
    await call('fs:copyText', { text: result.text }).then(() => toast({ level: 'success', title: 'Copied the recognized text', detail: `${result.text.length.toLocaleString()} characters${multi ? ` from ${result.pages.length} pages` : ''}.` }), toastError);
  };
  const save = async () => {
    await startOperation({ type: 'ocr-save', sources: [entry.path], params: { text: result.text }, origin: 'ocr-panel' });
  };

  return (
    <div className="ocr-result">
      <div className="ocr-summary">
        <Pill tone={tone} title="Mean confidence of the recognized words">{result.confidence === null ? (result.pages.some((x) => x.source === 'ocr') ? 'Nothing recognized' : 'Text from the PDF') : `${label} confidence · ${Math.round(result.confidence)}%`}</Pill>
        {pdfKind && <Pill>{pdfKind}</Pill>}
        <span className="ocr-meta">{langsLabel(result.langs)} · {(result.durationMs / 1000).toFixed(1)} s</span>
      </div>
      {result.lowConfidence && (
        <div className="callout warning" role="note">
          <Icon name="warning" size={14} />
          <span>Low confidence ({Math.round(result.confidence ?? 0)}%). The text below probably contains mistakes: check it against the {result.kind === 'pdf' ? 'pages' : 'image'}, or try other languages.</span>
        </div>
      )}
      {stale && (
        <div className="callout" role="note">
          <Icon name="info" size={14} />
          <span>The file changed after its text was recognized. Recognize again to update it.</span>
        </div>
      )}
      {result.notes.map((n) => <p key={n} className="ocr-note">{n}</p>)}
      {empty ? (
        <p className="ocr-empty">No text was found in this {result.kind === 'pdf' ? 'document' : 'image'}.</p>
      ) : (
        <div className="ocr-tools">
          <div className="ocr-find">
            <Icon name="search" size={14} />
            <input
              id={findId}
              type="search"
              className="input"
              placeholder="Find in text"
              aria-label="Find in the recognized text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            <span className="ocr-count" aria-live="polite">{query.trim() ? (count ? `${count} found` : 'None') : ''}</span>
          </div>
          <div className="ocr-actions">
            <Button size="sm" icon="ocrBoxes" aria-pressed={boxes} className={boxes ? 'is-on' : ''} onClick={() => setBoxes((b) => !b)} title="Outline every recognized word on the picture">Word boxes</Button>
            <Button size="sm" icon="copy" onClick={() => void copy()}>Copy</Button>
            <Button size="sm" icon="save" onClick={() => void save()} title="Saves the text next to the file; an existing file is never replaced">Save as .txt</Button>
          </div>
        </div>
      )}
      {multi && (
        <div className="ocr-pages" role="group" aria-label="Pages">
          <IconButton icon="back" label="Previous page" disabled={page === 0} onClick={() => setPage((x) => Math.max(0, x - 1))} />
          <span className="ocr-page-label tabular">Page {p.index + 1} of {result.pageCount}</span>
          <span className="ocr-page-source">{p.source === 'pdf-text' ? 'text from the PDF' : p.source === 'failed' ? 'not recognized' : `recognized${p.confidence !== null ? ` · ${Math.round(p.confidence)}%` : ''}`}</span>
          <IconButton icon="forward" label="Next page" disabled={page >= result.pages.length - 1} onClick={() => setPage((x) => Math.min(result.pages.length - 1, x + 1))} />
        </div>
      )}
      {p.source === 'failed' ? (
        <div className="callout error" role="note"><Icon name="error" size={14} /><span>{p.error}</span></div>
      ) : (
        <OcrPicture entry={entry} result={result} page={p} boxes={boxes} terms={terms} />
      )}
      {(boxes && lowWords > 0) || terms.length ? (
        <p className="ocr-legend">
          {boxes && <span><i className="sw word" />word</span>}
          {boxes && lowWords > 0 && <span><i className="sw low" />low confidence ({lowWords})</span>}
          {terms.length > 0 && <span><i className="sw hit" />match</span>}
        </p>
      ) : null}
      {!empty && <OcrText text={shownText} query={query.trim()} />}
    </div>
  );
}

/** The picture (image, or the PDF page drawn by PDF.js) with word boxes and matches on top. */
function OcrPicture({ entry, result, page, boxes, terms }: { entry: FileEntry; result: OcrResult; page: OcrPageResult; boxes: boolean; terms: string[] }) {
  const frame = { width: page.width, height: page.height };
  const shown = shownSize(frame, page.turn);
  const [failed, setFailed] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfRef = useRef<LoadedPdf | null>(null);
  const isPdf = result.kind === 'pdf';
  useEffect(() => {
    if (!isPdf) return;
    let cancelled = false;
    void (async () => {
      try {
        pdfRef.current ??= await openPdfForThumbnails(entry.path);
        if (cancelled || !canvasRef.current) return;
        await drawPage(pdfRef.current.doc, page.index, canvasRef.current, 900);
        canvasRef.current.style.width = '';
        canvasRef.current.style.height = '';
      } catch (err) {
        if (!cancelled) setFailed((err as Error).message ?? 'The page could not be drawn.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPdf, entry.path, page.index]);
  useEffect(() => () => pdfRef.current?.close(), []);
  if (!shown.width || !shown.height) return null;
  const skewDeg = (page.skew * 180) / Math.PI;
  const hit = (t: string) => {
    const w = t.toLowerCase();
    return terms.some((q) => w.includes(q));
  };
  const words = page.words.map((w, i) => ({ ...boxToShown(w, page.turn, frame), i, low: w.conf < LOW_CONFIDENCE, hit: terms.length > 0 && hit(w.text), text: w.text, conf: w.conf }));
  const showOverlay = boxes || terms.length > 0;
  return (
    <div className="ocr-stage">
      {/* Width from the panel, at most 52 % of the window height tall, proportions kept (so the boxes line up). */}
      <div className="ocr-frame" style={{ aspectRatio: `${shown.width} / ${shown.height}`, width: `min(100%, calc(52vh * ${(shown.width / shown.height).toFixed(4)}))` }}>
        {isPdf ? <canvas ref={canvasRef} className="ocr-page" aria-label={`Page ${page.index + 1}`} /> : <img src={mediaUrl(entry.path)} alt={entry.name} draggable={false} onError={() => setFailed('The picture could not be shown.')} />}
        {showOverlay && words.length > 0 && (
          <svg className="ocr-overlay" viewBox={`0 0 ${shown.width} ${shown.height}`} preserveAspectRatio="none" aria-hidden="true">
            {/* The engine straightened a slight skew before reading; its boxes follow that. */}
            <g transform={skewDeg ? `rotate(${-skewDeg} ${shown.width / 2} ${shown.height / 2})` : undefined}>
              {words.filter((w) => boxes || w.hit).map((w) => (
                <rect key={w.i} className={`ocr-box${w.low ? ' low' : ''}${w.hit ? ' hit' : ''}`} x={w.x0} y={w.y0} width={Math.max(1, w.x1 - w.x0)} height={Math.max(1, w.y1 - w.y0)} rx={2}>
                  <title>{`${w.text} · ${Math.round(w.conf)}%`}</title>
                </rect>
              ))}
            </g>
          </svg>
        )}
      </div>
      {failed && <p className="ocr-note">{failed}</p>}
    </div>
  );
}

/** The recognized text, selectable, with matches marked (the first one is scrolled into view). */
function OcrText({ text, query }: { text: string; query: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const parts = useMemo(() => (query ? text.split(new RegExp(`(${escapeRe(query)})`, 'gi')) : [text]), [text, query]);
  useEffect(() => {
    ref.current?.querySelector('mark')?.scrollIntoView({ block: 'nearest' });
  }, [query]);
  return (
    <pre ref={ref} className="ocr-text" tabIndex={0} aria-label="Recognized text">
      {parts.map((s, i) => (i % 2 === 1 ? <mark key={i}>{s}</mark> : <React.Fragment key={i}>{s}</React.Fragment>))}
    </pre>
  );
}
