import { clipFormat, clipFormats, clipImage, clipText, writeClipImage, writeClipText } from './clip';
import { nativeImage, type IpcMainInvokeEvent, type WebContents } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError } from '../shared/errors';
import { isRemoteRef } from '../shared/remote';
import {
  CLIP_HISTORY_MAX, CLIP_TEXT_MAX, CLIP_TEXT_PREVIEW, fileUriToPath, parseGnomeCopiedFiles, parseUriList, pathsFromText,
  type ClipHistoryEntry, type ClipPeek,
} from '../shared/powerTools';
import { requireAbsolute, validateName } from './fs/paths';
import type { Services } from './services';
import type { PauseGate } from './jobs/PauseGate';
import { joinRequest, planJoin } from './tools/splitJoin';
import { shredInfo } from './tools/shred';
import { planFlatten } from './tools/flatten';
import { planDates } from './tools/setDates';

/**
 * IPC for the power tools (pt:*) and the clipboard (clip:*). Payloads were
 * validated by the shared zod schemas (ipcHandlers.ts) before these run; paths
 * are made absolute here and every operation re-checks what it touches.
 *
 * Clipboard history: the last 10 file sets copied or cut in Orbis Files, kept
 * in memory in the main process (shared by the windows of this profile) and
 * never written to disk — file lists are private and a cut set means nothing
 * after a restart.
 */

type Channels = Extract<InvokeChannel, `pt:${string}` | `clip:${string}`>;
type Handlers = { [C in Channels]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };
type RunJob = <T>(jobId: string, wc: WebContents, fn: (signal: AbortSignal, progress: (p: unknown) => void, gate?: PauseGate) => Promise<T>) => { jobId: string; pausable: boolean };

interface StoredEntry { id: string; mode: 'copy' | 'cut'; paths: string[]; timeMs: number }

const MAX_EXISTS_CHECKS = 10_000;
/** As many items as a copy or cut can hold (clip:setFiles). */
const MAX_PASTE_ITEMS = 100_000;
const MAX_IMAGE_FILE = 64 * 1024 * 1024;
const norm = (t: string) => t.replace(/\r\n/g, '\n').trim();

async function existing(paths: string[], limit = MAX_EXISTS_CHECKS): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths.slice(0, limit)) {
    if (isRemoteRef(p)) out.push(p);
    else if (path.isAbsolute(p) && (await fsp.lstat(p).then(() => true, () => false))) out.push(p);
  }
  return out;
}

export function powerToolsHandlers(s: Services, runJob: RunJob): Handlers {
  const history: StoredEntry[] = [];
  /** What Orbis Files last put on the system clipboard for a copy or cut. */
  let lastWritten: { text: string; mode: 'copy' | 'cut'; paths: string[] } | null = null;

  const readFormat = async (fmt: string): Promise<string> => (await clipFormat(fmt))?.toString('utf8') ?? '';

  /** File items on the clipboard and where they came from. */
  const clipFiles = async (formats: string[], text: string, limit: number): Promise<{ files: ClipPeek['files'] & { paths: string[] } | null; ours: boolean; staleOurs: boolean }> => {
    const result = (paths: string[], mode: 'copy' | 'cut', source: NonNullable<ClipPeek['files']>['source']) => ({ count: paths.length, mode, names: paths.slice(0, 3).map((p) => path.basename(p)), source, paths });
    if (lastWritten && text && norm(text) === norm(lastWritten.text)) {
      const paths = await existing(lastWritten.paths, limit);
      return paths.length ? { files: result(paths, lastWritten.mode, 'orbis'), ours: true, staleOurs: false } : { files: null, ours: true, staleOurs: true };
    }
    if (formats.includes('x-special/gnome-copied-files')) {
      const g = parseGnomeCopiedFiles(await readFormat('x-special/gnome-copied-files'));
      const paths = g ? await existing(g.paths, limit) : [];
      if (g && paths.length) return { files: result(paths, g.mode, 'gnome'), ours: false, staleOurs: false };
    }
    if (formats.includes('text/uri-list')) {
      const paths = await existing(parseUriList(await readFormat('text/uri-list')), limit);
      if (paths.length) return { files: result(paths, 'copy', 'uri-list'), ours: false, staleOurs: false };
    }
    if (process.platform === 'win32' && formats.includes('FileNameW')) {
      // Windows offers the first file of an Explorer copy as FileNameW (untested: no Windows machine was available).
      const p = ((await clipFormat('FileNameW'))?.toString('utf16le') ?? '').replace(/\0[\s\S]*$/, '');
      const paths = await existing(p ? [p] : []);
      if (paths.length) return { files: result(paths, 'copy', 'platform'), ours: false, staleOurs: false };
    }
    if (process.platform === 'darwin' && formats.includes('public.file-url')) {
      // Finder puts a file URL there (untested: no Mac was available).
      const p = fileUriToPath((await readFormat('public.file-url')).trim(), 'darwin');
      const paths = await existing(p ? [p] : []);
      if (paths.length) return { files: result(paths, 'copy', 'platform'), ours: false, staleOurs: false };
    }
    const asPaths = text ? pathsFromText(text, process.platform) : undefined;
    if (asPaths) {
      const paths = await existing(asPaths, limit);
      if (paths.length === Math.min(asPaths.length, limit)) return { files: result(paths, 'copy', 'paths'), ours: false, staleOurs: false };
    }
    return { files: null, ours: false, staleOurs: false };
  };

  /** `full`: every item checked (for pasting); otherwise the first 200 (the window asks every few seconds). */
  const peek = async (full = false): Promise<ClipPeek & { allFiles?: string[] }> => {
    const formats = await clipFormats();
    const text = await clipText();
    const f = await clipFiles(formats, text, full ? MAX_PASTE_ITEMS : 200);
    const image = !f.files && formats.some((x) => x.startsWith('image/'));
    let textInfo: ClipPeek['text'] = null;
    if (!f.files && !f.staleOurs && text) {
      let json = false;
      if (text.length < 1024 * 1024 && /^\s*[[{]/.test(text)) {
        try {
          JSON.parse(text);
          json = true;
        } catch { /* not JSON */ }
      }
      textInfo = { length: text.length, lines: text.split('\n').length, preview: text.slice(0, CLIP_TEXT_PREVIEW), json };
    }
    const files = f.files ? { count: f.files.count, mode: f.files.mode, names: f.files.names, source: f.files.source } : null;
    return { files, image, text: textInfo, ours: f.ours, staleOurs: f.staleOurs, formats, allFiles: f.files?.paths };
  };

  const listEntry = async (e: StoredEntry): Promise<ClipHistoryEntry> => {
    const local = e.paths.filter((p) => !isRemoteRef(p));
    const there = await existing(local);
    return { id: e.id, mode: e.mode, timeMs: e.timeMs, count: e.paths.length, firstNames: e.paths.slice(0, 3).map((p) => path.basename(p)), missing: Math.min(local.length, MAX_EXISTS_CHECKS) - there.length, remote: e.paths.length - local.length };
  };

  const startClipSave = (dir: string, name: string, data: Buffer, origin: string) => {
    const v = validateName(name);
    if (!v.valid) throw makeError('invalid_name', 'clip.save', { message: v.reason, target: name });
    return s.ops.start({ type: 'clip-save', sources: [path.join(dir, name)], destination: dir, conflictPolicy: 'ask', origin, params: { name, data } });
  };

  return {
    // ------------------------------------------------------------ split and join
    'pt:splitStart': (p) => {
      const src = requireAbsolute(p.path, 'split.start');
      const dest = p.destination ? requireAbsolute(p.destination, 'split.start') : path.dirname(src);
      return s.ops.start({ type: 'split-file', sources: [src], destination: dest, conflictPolicy: 'ask', origin: 'split-file', params: p.params });
    },
    'pt:joinPlan': (p) => planJoin(requireAbsolute(p.path, 'join.plan')),
    'pt:joinStart': async (p) => {
      const picked = requireAbsolute(p.path, 'join.start');
      const dest = p.destination ? requireAbsolute(p.destination, 'join.start') : path.dirname(picked);
      const plan = await planJoin(picked, dest);
      return s.ops.start(joinRequest(plan, dest, p.options.keepOnMismatch));
    },
    // ------------------------------------------------------------ secure delete
    'pt:shredInfo': (p, e) => {
      const paths = p.paths.map((x) => requireAbsolute(x, 'shred.info'));
      return runJob(p.jobId, e.sender, (signal, progress, gate) => shredInfo(paths, { signal, wait: () => gate?.wait() ?? Promise.resolve(), onProgress: (n) => progress({ stage: 'Counting', items: n }) }));
    },
    'pt:shredStart': (p) => {
      const paths = p.paths.map((x) => requireAbsolute(x, 'shred.start'));
      s.log.info('shred.start', { items: paths.length, passes: p.params.passes });
      return s.ops.start({ type: 'shred', sources: paths, origin: 'shred', params: p.params });
    },
    // ------------------------------------------------------------ flatten
    'pt:flattenPlan': (p, e) => {
      const root = requireAbsolute(p.path, 'flatten.plan');
      return runJob(p.jobId, e.sender, async (signal, progress, gate) => {
        const plan = await planFlatten(root, p.spec, { signal, wait: () => gate?.wait() ?? Promise.resolve(), onProgress: (n) => progress({ stage: 'Looking inside', items: n }) });
        const { dirs: _dirs, ...rest } = plan;
        void _dirs;
        return { ...rest, moves: plan.moves.slice(0, 2000), movesTotal: plan.moves.length, conflicts: plan.moves.filter((m) => m.conflict).length };
      });
    },
    'pt:flattenStart': (p) => s.ops.start({ type: 'flatten', sources: [requireAbsolute(p.path, 'flatten.start')], conflictPolicy: 'ask', origin: 'flatten', params: p.spec }),
    // ------------------------------------------------------------ set dates
    'pt:datesPlan': (p, e) => {
      const paths = p.paths.map((x) => requireAbsolute(x, 'dates.plan'));
      return runJob(p.jobId, e.sender, async (signal, progress, gate) => {
        const plan = await planDates(paths, p.spec, (f) => s.metadata.read(f), { signal, wait: () => gate?.wait() ?? Promise.resolve(), onProgress: (n) => n % 200 === 0 && progress({ stage: 'Reading dates', items: n }) });
        return { ...plan, items: plan.items.slice(0, 5000), total: plan.items.length, changing: plan.items.filter((i) => i.next).length };
      });
    },
    'pt:datesStart': (p) => s.ops.start({ type: 'set-dates', sources: p.paths.map((x) => requireAbsolute(x, 'dates.start')), origin: 'set-dates', params: { spec: p.spec } }),
    'pt:capabilities': () => ({
      platform: process.platform,
      birthTime: false,
      birthTimeReason: process.platform === 'linux'
        ? 'Linux has no system call to set the creation (birth) time; only the kernel sets it when a file is created.'
        : process.platform === 'darwin'
          ? 'macOS can change the creation time (setattrlist), but Node.js and Electron offer no call for it, so Orbis Files does not change it.'
          : 'Windows can change the creation time (SetFileTime), but Node.js and Electron offer no call for it, so Orbis Files does not change it.',
      junctions: process.platform === 'win32',
      hardLinks: true,
    }),
    'pt:linkStart': (p) => {
      const dest = requireAbsolute(p.destination, 'link.start');
      const items = p.params.items.map((i) => ({ target: requireAbsolute(i.target, 'link.start'), name: i.name }));
      return s.ops.start({ type: 'link-create', sources: items.map((i) => i.target), destination: dest, conflictPolicy: 'ask', origin: p.params.kind === 'hard' ? 'hard-link' : 'junction', params: { kind: p.params.kind, items } });
    },

    // ------------------------------------------------------------ clipboard
    'clip:peek': async () => {
      const { allFiles: _a, ...rest } = await peek();
      void _a;
      return rest;
    },
    'clip:readFiles': async () => {
      const p = await peek(true);
      return p.files && p.allFiles ? { mode: p.files.mode, paths: p.allFiles, source: p.files.source } : null;
    },
    'clip:setFiles': async (p) => {
      await writeClipText(p.text);
      lastWritten = { text: p.text, mode: p.mode, paths: p.paths };
      const head = history[0];
      if (head && head.mode === p.mode && head.paths.length === p.paths.length && head.paths.every((x, i) => x === p.paths[i])) head.timeMs = Date.now();
      else {
        history.unshift({ id: crypto.randomUUID(), mode: p.mode, paths: p.paths.slice(), timeMs: Date.now() });
        history.length = Math.min(history.length, CLIP_HISTORY_MAX);
      }
      return { entries: history.length };
    },
    'clip:history': async () => Promise.all(history.map(listEntry)),
    'clip:historyItems': async (p) => {
      const e = history.find((x) => x.id === p.id);
      if (!e) throw makeError('not_found', 'clip.history', { message: 'This entry is no longer in the clipboard history.' });
      const paths = await existing(e.paths, MAX_PASTE_ITEMS);
      return { mode: e.mode, paths, missing: e.paths.length - paths.length };
    },
    'clip:clearHistory': () => {
      history.length = 0;
      return { entries: 0 };
    },
    'clip:imageInfo': async () => {
      const img = await clipImage();
      if (img.isEmpty()) return null;
      const size = img.getSize();
      // A small preview for the naming dialog (the window cannot read the clipboard image itself).
      const scale = Math.min(1, 320 / Math.max(size.width, size.height, 1));
      const thumb = img.resize({ width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)), quality: 'good' }).toDataURL();
      return { ...size, thumb };
    },
    'clip:pasteImage': async (p) => {
      const dir = requireAbsolute(p.dir, 'clip.pasteImage');
      if (!/\.png$/i.test(p.name)) throw makeError('validation', 'clip.pasteImage', { message: 'Images are saved as PNG, so the name must end in .png.' });
      const img = await clipImage();
      if (img.isEmpty()) throw makeError('not_found', 'clip.pasteImage', { message: 'The clipboard no longer holds an image.' });
      return startClipSave(dir, p.name, img.toPNG(), 'paste-image');
    },
    'clip:pasteText': async (p) => {
      const dir = requireAbsolute(p.dir, 'clip.pasteText');
      const text = await clipText();
      if (!text) throw makeError('not_found', 'clip.pasteText', { message: 'The clipboard no longer holds text.' });
      if (text.length > CLIP_TEXT_MAX) throw makeError('validation', 'clip.pasteText', { message: 'The clipboard text is larger than 64 MB.' });
      return startClipSave(dir, p.name, Buffer.from(text, 'utf8'), 'paste-text');
    },
    'clip:copyImage': async (p) => {
      const file = requireAbsolute(p.path, 'clip.copyImage');
      const st = await fsp.stat(file).catch(() => undefined);
      if (!st?.isFile()) throw makeError('not_found', 'clip.copyImage', { target: file, message: 'This image no longer exists.' });
      if (st.size > MAX_IMAGE_FILE) throw makeError('validation', 'clip.copyImage', { target: file, message: 'Images over 64 MB are not copied to the clipboard.' });
      const img = nativeImage.createFromPath(file);
      // Formats the platform codec cannot read (WebP, GIF, AVIF…) are decoded by the window instead.
      if (img.isEmpty()) return { needsWindowDecode: true };
      await writeClipImage(img);
      lastWritten = null;
      return img.getSize();
    },
    'clip:writeImagePng': async (p) => {
      requireAbsolute(p.path, 'clip.writeImagePng');
      const buf = Buffer.from(p.pngBase64, 'base64');
      if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw makeError('validation', 'clip.writeImagePng', { message: 'The decoded image is not a PNG.' });
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) throw makeError('validation', 'clip.writeImagePng', { message: 'The image could not be read.' });
      await writeClipImage(img);
      lastWritten = null;
      return img.getSize();
    },
    // Clipboard pins (persisted in DB)
    'clip:pins': () => s.catalog.clipPins(),
    'clip:pin': (p) => s.catalog.pinClipEntry(p.id, p.mode, p.paths, p.label),
    'clip:unpin': (p) => s.catalog.unpinClipEntry(p.id),
  };
}
