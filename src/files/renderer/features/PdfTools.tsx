import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { call, errorShape } from '../api';
import { closeDialog } from '../state/app';
import { startOperation } from '../actions';
import { Button, Dialog, IconButton, Loading, Pill, Segmented, TextField, Tabs, tabId } from '../ui/components';
import { Icon } from '../ui/Icon';
import { formatBytes, formatCount } from '../ui/format';
import { FolderPicker } from './views/common';
import { describePages, parsePageRanges, pdfOutputName, rangesToIndexes, type PdfJob, type Rotation } from '../../shared/docTools';
import { drawPage, openPdfForThumbnails, type LoadedPdf } from './pdfRender';

/**
 * PDF tools for selected PDFs: a page grid (delete, rotate, reorder by drag,
 * buttons or keyboard), merge, split and extract. Every action makes new PDF
 * files in the chosen folder through a 'pdf-tools' operation; the selected
 * files are never changed.
 */

export type PdfTab = 'pages' | 'merge' | 'split' | 'extract';

interface PdfInfo { path: string; size: number; encrypted: boolean; pageCount: number; pages: Array<{ width: number; height: number; rotation: number }>; title?: string }
type InfoState = { info?: PdfInfo; error?: string };

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const stemOf = (p: string) => baseName(p).replace(/\.pdf$/i, '');

export function PdfToolsDialog({ paths, dir, tab: initialTab = 'pages' }: { paths: string[]; dir: string; tab?: PdfTab }) {
  const [tab, setTab] = useState<PdfTab>(initialTab);
  const [infos, setInfos] = useState<Record<string, InfoState>>({});
  const [current, setCurrent] = useState(paths[0]!);
  const [dest, setDest] = useState(dir);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    for (const p of paths.slice(0, 50)) {
      call<PdfInfo>('pdf:info', { path: p }).then(
        (info) => live && setInfos((s) => ({ ...s, [p]: { info } })),
        (err) => live && setInfos((s) => ({ ...s, [p]: { error: errorShape(err).message } })),
      );
    }
    return () => {
      live = false;
    };
  }, [paths]);

  const start = async (sources: string[], job: PdfJob) => {
    setBusy(true);
    const rec = await startOperation({ type: 'pdf-tools', sources, destination: dest, params: { job }, origin: 'pdf-tools' });
    setBusy(false);
    if (rec) closeDialog();
  };

  const cur = infos[current];
  const tabs: Array<{ value: PdfTab; label: React.ReactNode }> = [
    { value: 'pages', label: <><Icon name="pages" size={14} /> Pages</> },
    { value: 'merge', label: <><Icon name="merge" size={14} /> Merge</> },
    { value: 'split', label: <><Icon name="splitDoc" size={14} /> Split</> },
    { value: 'extract', label: <><Icon name="extractPages" size={14} /> Extract</> },
  ];
  return (
    <Dialog title={paths.length === 1 ? `PDF tools · ${baseName(paths[0]!)}` : `PDF tools · ${paths.length} PDFs`} width={940} className="pdf-tools" onClose={closeDialog}>
      <Tabs<PdfTab> value={tab} onChange={setTab} tabs={tabs} label="PDF tool" idPrefix="pdf-tools" />
      <div role="tabpanel" id="pdf-tools-panel" aria-labelledby={tabId('pdf-tools', tab)} className="pdf-panel">
        {tab !== 'merge' && paths.length > 1 && (
          <label className="field pdf-doc-pick" htmlFor="pdf-doc">
            <span className="field-label">Document</span>
            <select id="pdf-doc" className="input" value={current} onChange={(e) => setCurrent(e.target.value)}>
              {paths.map((p) => <option key={p} value={p}>{baseName(p)}</option>)}
            </select>
          </label>
        )}
        {tab === 'merge' ? (
          <MergePanel paths={paths} infos={infos} busy={busy} dest={dest} setDest={setDest} onRun={(sources, output) => void start(sources, { action: 'merge', output })} />
        ) : !cur ? (
          <Loading label="Reading the PDF…" />
        ) : cur.error ? (
          <div className="callout warning" role="alert"><Icon name="warning" size={16} /><span>{cur.error}</span></div>
        ) : cur.info!.encrypted ? (
          <div className="callout warning" role="alert"><Icon name="lock" size={16} /><span>“{baseName(current)}” is encrypted (password-protected or restricted). Orbis Files does not decrypt PDFs, so it cannot make new PDFs from it.</span></div>
        ) : tab === 'pages' ? (
          <PagesPanel key={current} info={cur.info!} busy={busy} dest={dest} setDest={setDest} onRun={(plan, output) => void start([current], { action: 'pages', plan, output })} />
        ) : tab === 'split' ? (
          <SplitPanel key={current} info={cur.info!} busy={busy} dest={dest} setDest={setDest} onRun={(job) => void start([current], job)} />
        ) : (
          <ExtractPanel key={current} info={cur.info!} busy={busy} dest={dest} setDest={setDest} onRun={(ranges, output) => void start([current], { action: 'extract', ranges, output })} />
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- output row */

function OutputRow({ dest, setDest, name, setName, nameLabel, error, children, busy, runLabel, onRun, disabled, hint }: {
  dest: string; setDest: (v: string) => void; name: string; setName: (v: string) => void; nameLabel: string; error?: string;
  children?: React.ReactNode; busy: boolean; runLabel: string; onRun: () => void; disabled?: boolean | string; hint?: string;
}) {
  const reason = typeof disabled === 'string' ? disabled : undefined;
  return (
    <div className="pdf-output">
      <div className="pdf-output-fields">
        <TextField id={`pdf-name-${nameLabel.replace(/\W+/g, '-').toLowerCase()}`} label={nameLabel} mono value={name} onChange={(e) => setName(e.target.value)} error={error} hint={hint ?? 'A new file; an existing name gets a number added. The original is not changed.'} />
        <FolderPicker value={dest} onChange={setDest} label="Save in" id="pdf-dest" />
      </div>
      <div className="pdf-output-actions">
        {children}
        <span className="grow muted small" role="status">{reason}</span>
        <Button variant="primary" icon="save" disabled={busy || !!disabled || !!error} onClick={onRun}>{runLabel}</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- thumbnails */

type DocState = { loaded?: LoadedPdf; error?: string };

/** Load the document for thumbnails once per panel; failures are shown, never hidden. */
function useThumbDoc(path: string): DocState {
  const [state, setState] = useState<DocState>({});
  useEffect(() => {
    let live = true;
    let loaded: LoadedPdf | undefined;
    openPdfForThumbnails(path).then(
      (l) => {
        loaded = l;
        if (live) setState({ loaded: l });
        else l.close();
      },
      (err) => live && setState({ error: errorShape(err).message }),
    );
    return () => {
      live = false;
      loaded?.close();
    };
  }, [path]);
  return state;
}

function Thumb({ doc, index, rotate, size, label }: { doc?: PDFDocumentProxy; index: number; rotate: number; size: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'drawn' | 'failed'>('idle');
  useEffect(() => {
    const canvas = ref.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      drawPage(doc, index, canvas, size).then(() => !cancelled && setState('drawn'), () => !cancelled && setState('failed'));
    }, { rootMargin: '200px' });
    io.observe(canvas);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [doc, index, size]);
  return (
    <span className="pdf-thumb" style={{ width: size, height: size }} aria-hidden>
      <canvas ref={ref} className={state === 'drawn' ? 'is-drawn' : ''} style={{ transform: rotate ? `rotate(${rotate}deg)` : undefined }} />
      {state !== 'drawn' && <span className="pdf-thumb-num">{state === 'failed' ? 'No preview' : label}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- pages */

interface PlanItem { page: number; rotate: Rotation }

function PagesPanel({ info, busy, dest, setDest, onRun }: { info: PdfInfo; busy: boolean; dest: string; setDest: (v: string) => void; onRun: (plan: PlanItem[], output: string) => void }) {
  const initial = useMemo(() => Array.from({ length: info.pageCount }, (_, i) => ({ page: i, rotate: 0 as Rotation })), [info.pageCount]);
  const [plan, setPlan] = useState<PlanItem[]>(initial);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState<string | undefined>();
  const [name, setName] = useState(`${stemOf(info.path)} (edited)`);
  const [drag, setDrag] = useState<{ from: number[]; over?: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const thumbs = useThumbDoc(info.path);
  const big = info.pageCount > 2000;

  const targets = (): number[] => (selected.size ? plan.map((p, i) => (selected.has(p.page) ? i : -1)).filter((i) => i >= 0) : plan.length ? [Math.min(active, plan.length - 1)] : []);
  const say = (s: string) => setAnnounce(s);
  const pagesText = (idx: number[]) => describePages(idx.map((i) => plan[i]!.page));

  const rotate = (delta: 90 | 180 | 270) => {
    const t = new Set(targets());
    if (!t.size) return;
    setPlan(plan.map((p, i) => (t.has(i) ? { ...p, rotate: (((p.rotate + delta) % 360) as Rotation) } : p)));
    say(`Turned page ${pagesText([...t])} ${delta === 270 ? 'left' : delta === 90 ? 'right' : '180°'}.`);
  };
  const remove = () => {
    const t = new Set(targets());
    if (!t.size) return;
    if (t.size >= plan.length) {
      say('A PDF needs at least one page; not every page can be deleted.');
      return;
    }
    say(`Deleted page ${pagesText([...t])}.`);
    setPlan(plan.filter((_, i) => !t.has(i)));
    setSelected(new Set());
    setActive(Math.min(Math.min(...t), plan.length - t.size - 1));
  };
  const moveTo = (idx: number[], to: number) => {
    const set = new Set(idx);
    const moving = plan.filter((_, i) => set.has(i));
    const rest = plan.filter((_, i) => !set.has(i));
    const before = idx.filter((i) => i < to).length;
    const at = Math.max(0, Math.min(rest.length, to - before));
    const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
    setPlan(next);
    setActive(at);
    say(`Moved page ${describePages(moving.map((m) => m.page))} to position ${at + 1}.`);
  };
  const move = (d: -1 | 1) => {
    const t = targets().sort((a, b) => a - b);
    if (!t.length) return;
    if (d < 0 && t[0] === 0) return;
    if (d > 0 && t[t.length - 1] === plan.length - 1) return;
    moveTo(t, d < 0 ? t[0]! - 1 : t[t.length - 1]! + 2);
  };
  const selectRange = () => {
    const r = parsePageRanges(rangeText, info.pageCount);
    if (!r.ok) {
      setRangeError(r.error);
      return;
    }
    setRangeError(undefined);
    const want = new Set(rangesToIndexes(r.ranges));
    const present = plan.filter((p) => want.has(p.page)).map((p) => p.page);
    setSelected(new Set(present));
    say(present.length ? `Selected ${formatCount(present.length, 'page')}.` : 'Those pages were deleted already.');
  };

  const cols = () => {
    const items = grid.current ? [...grid.current.querySelectorAll<HTMLElement>('[role="option"]')] : [];
    if (items.length < 2) return 1;
    const top = items[0]!.offsetTop;
    const n = items.findIndex((el) => el.offsetTop !== top);
    return n < 0 ? items.length : n;
  };
  const focusItem = (i: number) => {
    const n = Math.max(0, Math.min(plan.length - 1, i));
    setActive(n);
    grid.current?.querySelector<HTMLElement>(`#pdf-page-${n}`)?.scrollIntoView({ block: 'nearest' });
    return n;
  };
  const onKey = (e: React.KeyboardEvent) => {
    const c = cols();
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -c, ArrowDown: c, Home: -Infinity, End: Infinity, PageUp: -c * 3, PageDown: c * 3 };
    if (e.key in step && e.altKey && !e.ctrlKey) {
      e.preventDefault();
      move(step[e.key]! < 0 ? -1 : 1);
      return;
    }
    if (e.key in step) {
      e.preventDefault();
      const to = step[e.key] === -Infinity ? 0 : step[e.key] === Infinity ? plan.length - 1 : active + step[e.key]!;
      const n = focusItem(to);
      if (e.shiftKey) {
        const [a, b] = [Math.min(anchor, n), Math.max(anchor, n)];
        setSelected(new Set(plan.slice(a, b + 1).map((p) => p.page)));
      } else setAnchor(n);
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      const p = plan[active];
      if (!p) return;
      const next = new Set(selected);
      if (next.has(p.page)) next.delete(p.page);
      else next.add(p.page);
      setSelected(next);
      setAnchor(active);
    } else if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      setSelected(new Set(plan.map((p) => p.page)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      rotate(e.shiftKey ? 270 : 90);
    }
  };
  const click = (i: number, e: React.MouseEvent) => {
    const p = plan[i]!;
    setActive(i);
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSelected(new Set(plan.slice(a, b + 1).map((x) => x.page)));
      return;
    }
    setAnchor(i);
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(p.page)) next.delete(p.page);
      else next.add(p.page);
      setSelected(next);
    } else setSelected(new Set([p.page]));
  };

  const deleted = info.pageCount - plan.length;
  const rotated = plan.filter((p) => p.rotate).length;
  const reordered = plan.some((p, i) => i > 0 && p.page < plan[i - 1]!.page);
  const changed = deleted > 0 || rotated > 0 || reordered;
  const out = pdfOutputName(name);
  const t = targets();
  const tLabel = selected.size ? `On ${formatCount(selected.size, 'selected page')}` : plan[active] ? `On page ${plan[active]!.page + 1}` : '';
  const size = big ? 64 : 112;

  return (
    <div className="pdf-pages">
      <div className="pdf-toolbar" role="toolbar" aria-label="Page actions">
        <IconButton icon="rotateLeft" label="Turn left (Shift+R)" disabled={!t.length} onClick={() => rotate(270)} />
        <IconButton icon="rotateRight" label="Turn right (R)" disabled={!t.length} onClick={() => rotate(90)} />
        <Button size="sm" disabled={!t.length} onClick={() => rotate(180)}>Turn 180°</Button>
        <Button size="sm" icon="back" disabled={!t.length || Math.min(...t) === 0} onClick={() => move(-1)} aria-label="Move earlier (Alt+Left)">Earlier</Button>
        <Button size="sm" icon="forward" disabled={!t.length || Math.max(...t) === plan.length - 1} onClick={() => move(1)} aria-label="Move later (Alt+Right)">Later</Button>
        <Button size="sm" icon="trash" disabled={!t.length || t.length >= plan.length} onClick={remove} aria-label="Delete pages (Delete)">Delete</Button>
        <span className="pdf-toolbar-target muted small">{tLabel}</span>
        <span className="grow" />
        <form className="pdf-range-select" onSubmit={(e) => { e.preventDefault(); selectRange(); }}>
          <label className="pdf-range-label small" htmlFor="pdf-select-range">Select pages</label>
          <input id="pdf-select-range" className={`input mono ${rangeError ? 'is-invalid' : ''}`} placeholder="e.g. 1-3, 6" value={rangeText} aria-invalid={!!rangeError} aria-describedby={rangeError ? 'pdf-select-range-err' : undefined} onChange={(e) => { setRangeText(e.target.value); setRangeError(undefined); }} />
          <Button size="sm" type="submit" disabled={!rangeText.trim()}>Select</Button>
        </form>
        <Button size="sm" variant="ghost" disabled={!changed} onClick={() => { setPlan(initial); setSelected(new Set()); say('All changes undone.'); }}>Reset</Button>
      </div>
      {rangeError && <p id="pdf-select-range-err" className="field-error small" role="alert">{rangeError}</p>}
      {thumbs.error && <p className="muted small" role="status">Page thumbnails could not be drawn ({thumbs.error}); pages are shown by number.</p>}
      <div
        ref={grid}
        className={`pdf-grid ${big ? 'is-small' : ''}`}
        role="listbox"
        aria-multiselectable="true"
        aria-label={`Pages of ${baseName(info.path)}. Arrow keys move, Space selects, R turns, Delete removes, Alt+Arrow moves the page.`}
        aria-activedescendant={plan.length ? `pdf-page-${Math.min(active, plan.length - 1)}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {plan.map((p, i) => {
          const dim = info.pages[p.page];
          const sel = selected.has(p.page);
          return (
            <div
              key={p.page}
              id={`pdf-page-${i}`}
              role="option"
              aria-selected={sel}
              aria-label={`Page ${p.page + 1}${p.rotate ? `, turned ${p.rotate}°` : ''}, position ${i + 1} of ${plan.length}`}
              className={`pdf-page ${sel ? 'is-selected' : ''} ${i === active ? 'is-active' : ''} ${drag?.over === i ? 'is-drop' : ''}`}
              draggable
              onClick={(e) => { click(i, e); grid.current?.focus(); }}
              onDragStart={(e) => {
                const from = sel ? plan.map((x, j) => (selected.has(x.page) ? j : -1)).filter((j) => j >= 0) : [i];
                setDrag({ from });
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', `pdf-pages:${from.join(',')}`);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDragLeave={() => drag?.over === i && setDrag({ ...drag, over: undefined })}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  moveTo(drag.from, e.clientX > r.left + r.width / 2 ? i + 1 : i);
                }
                setDrag(null);
              }}
              onDragEnd={() => setDrag(null)}
              title={dim ? `${Math.round(dim.width)} × ${Math.round(dim.height)} pt` : undefined}
            >
              <Thumb doc={thumbs.loaded?.doc} index={p.page} rotate={p.rotate} size={size} label={String(p.page + 1)} />
              <span className="pdf-page-label">
                <span className="tabular">{p.page + 1}</span>
                {p.rotate ? <Pill tone="accent">{p.rotate}°</Pill> : null}
              </span>
            </div>
          );
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <OutputRow
        dest={dest}
        setDest={setDest}
        name={name}
        setName={setName}
        nameLabel="New PDF name"
        error={out.ok ? undefined : out.error}
        busy={busy}
        runLabel="Save as new PDF"
        disabled={changed ? false : 'Delete, turn or move pages first.'}
        onRun={() => out.ok && onRun(plan, out.name)}
      >
        <span className="muted small tabular">{formatCount(plan.length, 'page')}{deleted ? ` · ${deleted} deleted` : ''}{rotated ? ` · ${rotated} turned` : ''}{reordered ? ' · order changed' : ''}</span>
      </OutputRow>
    </div>
  );
}

/* ---------------------------------------------------------------- merge */

function MergePanel({ paths, infos, busy, dest, setDest, onRun }: { paths: string[]; infos: Record<string, InfoState>; busy: boolean; dest: string; setDest: (v: string) => void; onRun: (sources: string[], output: string) => void }) {
  const [order, setOrder] = useState(paths);
  const [included, setIncluded] = useState<Set<string>>(new Set(paths));
  const [name, setName] = useState('Merged');
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const move = useCallback((from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    setOrder(next);
    setAnnounce(`${baseName(x!)} moved to position ${to + 1} of ${next.length}.`);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#pdf-merge-${to} .pdf-merge-grip`)?.focus());
  }, [order]);
  const chosen = order.filter((p) => included.has(p));
  const problems = chosen.map((p) => [p, infos[p]] as const).filter(([, s]) => s?.error || s?.info?.encrypted);
  const loading = chosen.some((p) => !infos[p]);
  const pages = chosen.reduce((n, p) => n + (infos[p]?.info?.pageCount ?? 0), 0);
  const out = pdfOutputName(name);
  const reason = chosen.length < 2 ? 'Choose two or more PDFs to merge (select them in the folder first).' : problems.length ? `${baseName(problems[0]![0])} cannot be used: ${problems[0]![1]?.error ?? 'it is encrypted.'}` : loading ? 'Reading the PDFs…' : undefined;
  return (
    <div className="pdf-merge">
      <p className="muted small">The PDFs are joined in this order. Drag a row, use its arrows, or focus its handle and press Alt+Up / Alt+Down.</p>
      <ol className="pdf-merge-list" aria-label="PDFs to merge, in order">
        {order.map((p, i) => {
          const s = infos[p];
          return (
            <li
              key={p}
              id={`pdf-merge-${i}`}
              className={`pdf-merge-row ${dragFrom === i ? 'is-dragging' : ''}`}
              draggable
              onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', `pdf-merge:${i}`); }}
              onDragOver={(e) => dragFrom !== null && e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              onDragEnd={() => setDragFrom(null)}
            >
              <button type="button" className="pdf-merge-grip icon-btn" aria-label={`${baseName(p)}, position ${i + 1} of ${order.length}. Alt+Up or Alt+Down moves it.`} onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
                if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
              }}><Icon name="grip" size={14} /></button>
              <span className="pdf-merge-pos tabular">{i + 1}</span>
              <label className="check pdf-merge-name">
                <input type="checkbox" checked={included.has(p)} onChange={(e) => {
                  const next = new Set(included);
                  if (e.target.checked) next.add(p);
                  else next.delete(p);
                  setIncluded(next);
                }} />
                <span className="ellipsis" title={p}>{baseName(p)}</span>
              </label>
              <span className="pdf-merge-meta muted small tabular">
                {!s ? 'Reading…' : s.error ? <span className="error-text">{s.error}</span> : s.info!.encrypted ? <span className="warning-text">Encrypted</span> : `${formatCount(s.info!.pageCount, 'page')} · ${formatBytes(s.info!.size)}`}
              </span>
              <span className="pdf-merge-move">
                <IconButton icon="chevronUp" label={`Move ${baseName(p)} up`} disabled={i === 0} onClick={() => move(i, i - 1)} />
                <IconButton icon="chevronDown" label={`Move ${baseName(p)} down`} disabled={i === order.length - 1} onClick={() => move(i, i + 1)} />
              </span>
            </li>
          );
        })}
      </ol>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <OutputRow dest={dest} setDest={setDest} name={name} setName={setName} nameLabel="Merged PDF name" error={out.ok ? undefined : out.error} busy={busy} runLabel="Merge into new PDF" disabled={reason ?? false} onRun={() => out.ok && onRun(chosen, out.name)}>
        {chosen.length >= 2 && <span className="muted small tabular">{formatCount(chosen.length, 'PDF')} · {formatCount(pages, 'page')}</span>}
      </OutputRow>
    </div>
  );
}

/* ---------------------------------------------------------------- split / extract */

function SplitPanel({ info, busy, dest, setDest, onRun }: { info: PdfInfo; busy: boolean; dest: string; setDest: (v: string) => void; onRun: (job: PdfJob) => void }) {
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [ranges, setRanges] = useState('');
  const [base, setBase] = useState(stemOf(info.path));
  const parsed = mode === 'ranges' && ranges.trim() ? parsePageRanges(ranges, info.pageCount) : undefined;
  const files = mode === 'every' ? info.pageCount : parsed?.ok ? parsed.ranges.length : 0;
  const baseCheck = pdfOutputName(base);
  const example = mode === 'every' ? `${base} - page 1.pdf` : parsed?.ok ? parsed.ranges.map((r) => (r.from === r.to ? `${base} - page ${r.from}.pdf` : `${base} - pages ${r.from}-${r.to}.pdf`)).slice(0, 3).join(', ') : '';
  return (
    <div className="pdf-split form">
      <p className="muted small">{baseName(info.path)} has {formatCount(info.pageCount, 'page')}.</p>
      <Segmented<'every' | 'ranges'> label="Split into" value={mode} onChange={setMode} options={[{ value: 'every', label: 'One PDF per page' }, { value: 'ranges', label: 'One PDF per range' }]} />
      {mode === 'ranges' && (
        <TextField id="pdf-split-ranges" label="Page ranges (one new PDF each)" mono placeholder="1-3, 5, 7-" value={ranges} onChange={(e) => setRanges(e.target.value)} error={parsed && !parsed.ok ? parsed.error : undefined} hint={'Separate with commas. "7-" runs to the last page.'} />
      )}
      {files > 0 && <p className="small" role="status">Makes {formatCount(files, 'PDF')}{example ? `: ${example}${files > 3 ? ', …' : ''}` : ''}</p>}
      <OutputRow dest={dest} setDest={setDest} name={base} setName={setBase} nameLabel="Name the new PDFs after" error={baseCheck.ok ? undefined : baseCheck.error} hint="Each new PDF gets this name plus its pages. The original is not changed." busy={busy} runLabel="Split into new PDFs" disabled={files ? (files > 5000 ? 'More than 5,000 files: split by ranges instead.' : false) : mode === 'ranges' ? 'Enter page ranges.' : 'This PDF has no pages.'} onRun={() => baseCheck.ok && onRun({ action: 'split', mode, ranges: mode === 'ranges' ? ranges : undefined, baseName: base })} />
    </div>
  );
}

function ExtractPanel({ info, busy, dest, setDest, onRun }: { info: PdfInfo; busy: boolean; dest: string; setDest: (v: string) => void; onRun: (ranges: string, output: string) => void }) {
  const [ranges, setRanges] = useState('');
  const [name, setName] = useState(`${stemOf(info.path)} (extract)`);
  const parsed = ranges.trim() ? parsePageRanges(ranges, info.pageCount) : undefined;
  const out = pdfOutputName(name);
  const count = parsed?.ok ? rangesToIndexes(parsed.ranges).length : 0;
  return (
    <div className="pdf-extract form">
      <p className="muted small">{baseName(info.path)} has {formatCount(info.pageCount, 'page')}. The pages are copied in the order you write them.</p>
      <TextField id="pdf-extract-ranges" label="Pages to extract" mono placeholder="1-3, 5, 7-" value={ranges} onChange={(e) => setRanges(e.target.value)} error={parsed && !parsed.ok ? parsed.error : undefined} hint={parsed?.ok ? `${formatCount(count, 'page')}: ${describePages(rangesToIndexes(parsed.ranges))}` : 'Single pages and ranges separated by commas.'} />
      <OutputRow dest={dest} setDest={setDest} name={name} setName={setName} nameLabel="New PDF name" error={out.ok ? undefined : out.error} busy={busy} runLabel="Extract into new PDF" disabled={parsed?.ok ? false : 'Enter the pages to extract.'} onRun={() => out.ok && onRun(ranges, out.name)} />
    </div>
  );
}
