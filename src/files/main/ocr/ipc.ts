import { BrowserWindow, dialog, type IpcMainInvokeEvent, type WebContents } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../../shared/ipc';
import { OCR_IMAGE_EXTS, type OcrCapabilities, type OcrResult } from '../../shared/ocr';
import { makeError } from '../../shared/errors';
import { requireAbsolute } from '../fs/paths';
import type { PauseGate } from '../jobs/PauseGate';
import type { Services } from '../services';
import { recognizeFile } from './recognize';

/**
 * IPC handlers for text recognition. Payloads were validated by the shared zod
 * schemas (ipcHandlers.ts); paths are checked to be absolute here and the files
 * are checked again (type, size, contents) before anything reads them.
 */

type Channels = 'ocr:recognize' | 'ocr:capabilities' | 'ocr:languages' | 'ocr:addLanguage' | 'ocr:removeLanguage' | 'ocr:pickLanguageFile' | 'ocr:indexStatus' | 'ocr:indexSettings' | 'ocr:indexRun' | 'ocr:indexPause' | 'ocr:indexResume' | 'ocr:indexCancel';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };
type RunJob = <T>(jobId: string, wc: WebContents, fn: (signal: AbortSignal, progress: (p: unknown) => void, gate?: PauseGate) => Promise<T>, opts?: { pausable?: boolean }) => { jobId: string; pausable: boolean };

export function ocrHandlers(s: Services, runJob: RunJob, broadcast: (channel: 'ocr:indexStatus' | 'ocr:languagesChanged', payload: unknown) => void): Handlers {
  const o = s.ocr;
  o.index.on('status', (st) => broadcast('ocr:indexStatus', st));
  o.languages.on('changed', () => void o.languages.list().then((l) => broadcast('ocr:languagesChanged', l)));
  return {
    'ocr:recognize': (p, e) => {
      const file = requireAbsolute(p.path, 'ocr.recognize');
      return runJob<OcrResult>(p.jobId, e.sender, async (signal, progress) => {
        const r = await recognizeFile(file, p.options, { engine: o.engine, rasterizer: o.rasterizer, lane: 'interactive', signal, onProgress: progress });
        s.log.info('ocr.recognized', { kind: r.result.kind, pages: r.result.pages.length, ms: r.result.durationMs, low: r.result.lowConfidence, langs: p.options.langs.join('+') });
        return r.result;
      }, { pausable: false });
    },
    'ocr:capabilities': async (): Promise<OcrCapabilities> => {
      const st = o.index.status();
      return { formats: [...OCR_IMAGE_EXTS, 'pdf'], pdf: !!o.rasterizer, searchablePdf: true, languages: await o.languages.list(), priority: st.priority, priorityNote: st.priorityNote };
    },
    'ocr:languages': () => o.languages.list(),
    'ocr:addLanguage': async (p) => {
      const info = await o.languages.add(requireAbsolute(p.path, 'ocr.addLanguage'), (code, data) => o.engine.verifyLanguage(code, data));
      s.log.info('ocr.language_added', { code: info.code, bytes: info.bytes });
      return info;
    },
    'ocr:removeLanguage': async (p) => {
      await o.languages.remove(p.code);
      const st = o.index.settings();
      if (st.langs.includes(p.code)) {
        const langs = st.langs.filter((l) => l !== p.code);
        await o.index.update({ langs: langs.length ? langs : ['eng'] });
      }
      return o.languages.list();
    },
    'ocr:pickLanguageFile': async (_p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Add language data', buttonLabel: 'Add', properties: ['openFile' as const], filters: [{ name: 'Tesseract language data', extensions: ['traineddata'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
    'ocr:indexStatus': () => o.index.status(),
    'ocr:indexSettings': async (p) => {
      if (p.folders) p.folders = p.folders.map((f) => requireAbsolute(f, 'ocr.indexSettings'));
      if (p.langs) {
        const installed = new Set((await o.languages.list()).map((l) => l.code));
        const missing = p.langs.filter((l) => !installed.has(l));
        if (missing.length) throw makeError('validation', 'ocr.indexSettings', { message: `Not installed: ${missing.join(', ')}. Add the language first.` });
      }
      const st = await o.index.update(p);
      s.log.info('ocr.index_settings', { enabled: st.settings.enabled, folders: st.settings.folders.length, workers: st.settings.workers });
      return st;
    },
    'ocr:indexRun': () => {
      o.index.requestRun();
      return o.index.status();
    },
    'ocr:indexPause': () => {
      o.index.pause();
      return o.index.status();
    },
    'ocr:indexResume': () => {
      o.index.resume();
      return o.index.status();
    },
    'ocr:indexCancel': () => {
      o.index.cancel();
      return o.index.status();
    },
  };
}
