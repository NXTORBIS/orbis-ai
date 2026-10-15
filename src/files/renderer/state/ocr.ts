import { call, on, runJob, errorShape } from '../api';
import { createStore } from './store';
import { addJob, jobs, removeJob, setJobControl, updateJob } from './jobs';
import { showPanel, toast, toastError } from './app';
import type { OrbisErrorShape } from '../../shared/errors';
import type { FileEntry } from '../../shared/model';
import { DEFAULT_RUN_OPTIONS, langName, type OcrCapabilities, type OcrIndexStatus, type OcrLanguageInfo, type OcrResult, type OcrRunOptions } from '../../shared/ocr';

/**
 * Text recognition in the window: results per file (shown in the details
 * panel's Text tab), the languages chosen for the next run, the engine's
 * capabilities, and the background job's status (listed with the other
 * background tasks, with Pause, Resume and Stop).
 */

export interface OcrEntryState {
  path: string;
  name: string;
  status: 'running' | 'done' | 'error';
  result?: OcrResult;
  error?: OrbisErrorShape;
  progress?: { stage: string; fraction?: number };
  cancel?: () => void;
  options: OcrRunOptions;
}

interface OcrState {
  byPath: Record<string, OcrEntryState>;
  /** Options for the next run (languages, orientation, PDF text pages). */
  options: OcrRunOptions;
  languages: OcrLanguageInfo[];
  caps?: OcrCapabilities;
  index?: OcrIndexStatus;
}

export const ocr = createStore<OcrState>({ byPath: {}, options: DEFAULT_RUN_OPTIONS, languages: [] });

/** Results kept in the window (the oldest are forgotten first). */
const KEEP = 20;

function setEntry(path: string, patch: Partial<OcrEntryState> | null): void {
  ocr.set((s) => {
    const byPath = { ...s.byPath };
    if (patch === null) delete byPath[path];
    else byPath[path] = { ...(byPath[path] as OcrEntryState), ...patch };
    const keys = Object.keys(byPath);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) if (byPath[k]!.status !== 'running') delete byPath[k];
    return { byPath };
  });
}

export function setRunOptions(patch: Partial<OcrRunOptions>): void {
  ocr.set((s) => ({ options: { ...s.options, ...patch } }));
}

/** The details panel keeps showing the Text tab while the user moves between images (until another tab is chosen). */
export const textTabSticky = { on: false };

/** Ask the details panel to show the Text tab (after showing the panel if it is hidden). */
export async function showTextTab(): Promise<void> {
  textTabSticky.on = true;
  await showPanel('inspector');
  requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('orbis:show-ocr')));
}

/** Recognize the text of one image or PDF; the result appears in the details panel. */
export async function recognizeEntry(entry: Pick<FileEntry, 'path' | 'name'>, options: OcrRunOptions = ocr.get().options): Promise<void> {
  const cur = ocr.get().byPath[entry.path];
  if (cur?.status === 'running') return;
  void showTextTab();
  setEntry(entry.path, { path: entry.path, name: entry.name, status: 'running', result: undefined, error: undefined, progress: { stage: 'Starting the recognition engine' }, options });
  const handle = runJob<OcrResult>(
    (jobId) => call('ocr:recognize', { path: entry.path, jobId, options }),
    (p) => {
      const pr = p as { stage?: string; fraction?: number } | undefined;
      if (pr?.stage) setEntry(entry.path, { progress: { stage: pr.stage, fraction: pr.fraction } });
    },
    `Text recognition of ${entry.name}`,
  );
  setEntry(entry.path, { cancel: handle.cancel });
  try {
    const r = await handle.promise;
    if (r.cancelled || !r.value) {
      setEntry(entry.path, null);
      return;
    }
    setEntry(entry.path, { status: 'done', result: r.value, progress: undefined, cancel: undefined });
  } catch (err) {
    setEntry(entry.path, { status: 'error', error: errorShape(err, 'ocr.recognize'), progress: undefined, cancel: undefined });
  }
}

export function forgetResult(path: string): void {
  setEntry(path, null);
}

export async function refreshLanguages(): Promise<OcrLanguageInfo[]> {
  const languages = await call<OcrLanguageInfo[]>('ocr:languages').catch(() => ocr.get().languages);
  ocr.set((s) => ({ languages, options: { ...s.options, langs: s.options.langs.filter((l) => languages.some((x) => x.code === l)).length ? s.options.langs.filter((l) => languages.some((x) => x.code === l)) : ['eng'] } }));
  return languages;
}

export async function loadCapabilities(): Promise<OcrCapabilities | undefined> {
  const caps = await call<OcrCapabilities>('ocr:capabilities').catch(() => undefined);
  if (caps) ocr.set({ caps, languages: caps.languages });
  return caps;
}

/** "English + German" for a list of codes. */
export const langsLabel = (langs: string[]): string => langs.map(langName).join(' + ');

// ------------------------------------------------------------------ background job

const INDEX_JOB = 'ocr-index';

function applyIndexStatus(st: OcrIndexStatus): void {
  const prev = ocr.get().index;
  ocr.set({ index: st });
  const active = st.state === 'scanning' || st.state === 'paused';
  const listed = jobs.get().list.some((j) => j.id === INDEX_JOB);
  const progress = `${st.recognized.toLocaleString()} recognized · ${st.pending.toLocaleString()} waiting${st.state === 'paused' ? ' · paused' : ''}`;
  if (active) {
    if (!listed) {
      addJob({
        id: INDEX_JOB,
        label: 'Making text in images searchable',
        startedMs: Date.now(),
        progress,
        cancel: () => void call('ocr:indexCancel').catch(toastError),
        pause: () => void call('ocr:indexPause').catch(toastError),
        resume: () => void call('ocr:indexResume').catch(toastError),
      });
    } else updateJob(INDEX_JOB, { progress });
    setJobControl(INDEX_JOB, { pausable: true, paused: st.state === 'paused', pause: () => void call('ocr:indexPause'), resume: () => void call('ocr:indexResume'), cancel: () => void call('ocr:indexCancel') });
  } else if (listed) {
    removeJob(INDEX_JOB, 'cancelled');
    setJobControl(INDEX_JOB, null);
    if (prev && prev.state !== 'off' && st.state === 'idle' && st.recognized > 0) toast({ level: 'success', title: 'Text in images is searchable', detail: `${st.recognized.toLocaleString()} image${st.recognized === 1 ? '' : 's'} recognized; ${st.stored.toLocaleString()} with text in all. Search with content:"…".` });
  }
}

let started = false;
export function initOcr(): void {
  if (started) return;
  started = true;
  on<OcrIndexStatus>('ocr:indexStatus', applyIndexStatus);
  on<OcrLanguageInfo[]>('ocr:languagesChanged', (languages) => ocr.set({ languages }));
  void call<OcrIndexStatus>('ocr:indexStatus').then(applyIndexStatus, () => undefined);
  void loadCapabilities();
}
