import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../../api';
import { Icon } from '../../ui/Icon';
import { useStore } from '../../state/store';
import { jobs } from '../../state/jobs';
import { app } from '../../state/app';
import { activePane, navigate, parentPath } from '../../state/workspace';
import { openFile } from '../../actions';
import { TERMINAL_STATES, type OperationRecord } from '../../../shared/operations';

/**
 * Pause/Resume for a running background job. Shown only once the main process
 * has said the job can be paused; the label follows the reported state.
 */
export function JobPauseButton({ jobId, size = 'md' }: { jobId: string | undefined; size?: 'sm' | 'md' }) {
  const c = useStore(jobs, (s) => (jobId ? s.controls[jobId] : undefined));
  if (!c?.pausable) return null;
  return (
    <button type="button" className={`btn btn-default btn-${size}`} aria-pressed={c.paused} onClick={c.paused ? c.resume : c.pause}>
      <Icon name={c.paused ? 'play' : 'pause'} size={14} /> <span>{c.paused ? 'Resume' : 'Pause'}</span>
    </button>
  );
}

/**
 * For a sticky bar above a table in a scrolling tool view: keeps the table's
 * sticky column headers just below the bar (instead of hidden behind it) by
 * writing the bar's height to --sticky-head on the view. Use as the bar's ref.
 */
export function useStickyHead(): (el: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    const view = el?.closest<HTMLElement>('.tool-view');
    if (!el || !view) return;
    const set = () => view.style.setProperty('--sticky-head', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    cleanup.current = () => {
      ro.disconnect();
      view.style.removeProperty('--sticky-head');
    };
  }, []);
}

/** "Paused" note for a job's progress line, or nothing while it runs. */
export function useJobPaused(jobId: string | undefined): boolean {
  return useStore(jobs, (s) => !!(jobId && s.controls[jobId]?.paused));
}

/** Call `cb` once when the operation reaches a terminal state (with its final record). Returns an unsubscribe function. */
export function onOperationFinished(id: string, cb: (rec: OperationRecord) => void): () => void {
  const done = (r: OperationRecord | undefined) => !!r && TERMINAL_STATES.has(r.state);
  const now = app.get().ops[id];
  if (done(now)) {
    cb(now!);
    return () => undefined;
  }
  const unsub = app.subscribe(() => {
    const r = app.get().ops[id];
    if (!done(r)) return;
    unsub();
    cb(r!);
  });
  return unsub;
}

/** Show an item selected in its folder in the active pane. */
export function showInPane(p: string): void {
  const parent = parentPath(p);
  if (parent) void navigate(activePane().id, { kind: 'fs', path: parent }, { select: p });
}

/** Open / Show buttons for a file row (keyboard reachable, labelled with the item). */
export function FileRowActions({ path, folder, children }: { path: string; folder?: boolean; children?: React.ReactNode }) {
  const name = path.split(/[\\/]/).pop() ?? path;
  return (
    <>
      {folder
        ? <button type="button" className="btn btn-ghost btn-sm" aria-label={`Open folder ${name}`} onClick={() => void navigate(activePane().id, { kind: 'fs', path })}>Open</button>
        : <button type="button" className="btn btn-ghost btn-sm" aria-label={`Open ${name}`} onClick={() => void openFile(path)}>Open</button>}
      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Show ${name} in its folder`} onClick={() => showInPane(path)}>Show</button>
      {children}
    </>
  );
}

/** Folder path input with Browse… and live validation against the real filesystem. */
export function FolderPicker({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label: string; id?: string }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  const fid = id ?? `fp-${label.replace(/\W+/g, '-').toLowerCase()}`;
  useEffect(() => setText(value), [value]);
  const commit = async (v: string) => {
    const r = await call<{ path: string; exists: boolean; kind?: string }>('fs:resolve', { input: v }).catch(() => undefined);
    if (!r?.exists || r.kind !== 'directory') {
      setError('This folder does not exist.');
      return;
    }
    setError(undefined);
    setText(r.path);
    onChange(r.path);
  };
  return (
    <div className={`field folder-picker ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={fid}>{label}</label>
      <div className="input-row">
        <input id={fid} className="input mono" value={text} spellCheck={false} aria-invalid={!!error} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && void commit(text)} onKeyDown={(e) => e.key === 'Enter' && void commit(text)} />
        <button type="button" className="btn btn-default btn-md" onClick={async () => {
          const p = await call<string | null>('fs:pickDirectory', { title: label }).catch(() => null);
          if (p) void commit(p);
        }}>
          <Icon name="folderOpen" size={14} /> <span>Browse…</span>
        </button>
      </div>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function FilePicker({ value, onChange, label, id }: { value: string; onChange: (v: string) => void; label: string; id: string }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setText(value), [value]);
  const commit = async (v: string) => {
    const r = await call<{ path: string; exists: boolean; kind?: string }>('fs:resolve', { input: v }).catch(() => undefined);
    if (!r?.exists) {
      setError('This item does not exist.');
      return;
    }
    setError(undefined);
    onChange(r.path);
  };
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <label className="field-label" htmlFor={id}>{label}</label>
      <input id={id} className="input mono" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && void commit(text)} onKeyDown={(e) => e.key === 'Enter' && void commit(text)} />
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
