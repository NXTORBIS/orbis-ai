import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppDatabase } from '../store/Database';
import type { OperationManager } from '../ops/OperationManager';
import type { Logger } from '../log';
import { OcrEngine } from './engine';
import { OcrLanguageStore } from './languages';
import { OcrTextStore } from './store';
import { OcrIndexJob } from './indexJob';
import { makeOcrExtractRunner, makeOcrSaveRunner } from './runners';
import type { PdfRasterizer } from './recognize';

/**
 * Text recognition services of one profile: the engine (worker threads), the
 * languages (bundled English + files the user added), the recognized-text store
 * used by content search, the background job, and the 'ocr-extract' / 'ocr-save'
 * operation runners. The PDF page renderer is set by main.ts (it needs Electron).
 */

export interface OcrServiceOptions {
  /** Folder with the engine's WebAssembly files (default: <dist>/ocr). */
  wasmDir?: string;
  /** The worker bundle (default: <dist>/main/ocr-worker.cjs). */
  workerScript?: string;
  /** Bundled language data (default: <dist>/ocr/lang). */
  langDir?: string;
  /** Pictures and Documents, for the background job's default folders. */
  defaultFolders?: () => Promise<string[]>;
  /** Background job timings (tests). */
  index?: { startDelayMs?: number; intervalMs?: number; watch?: boolean };
  idleMs?: number;
}

export interface OcrServices {
  engine: OcrEngine;
  languages: OcrLanguageStore;
  store: OcrTextStore;
  index: OcrIndexJob;
  /** Renders PDF pages (and decodes images the engine cannot read); undefined outside the app. */
  rasterizer: PdfRasterizer | undefined;
  stop(): void;
}

async function homeFolders(): Promise<string[]> {
  const out: string[] = [];
  for (const name of ['Pictures', 'Documents']) {
    const p = path.join(os.homedir(), name);
    if ((await fsp.stat(p).catch(() => undefined))?.isDirectory()) out.push(p);
  }
  return out;
}

export function createOcrServices(o: OcrServiceOptions & {
  db: AppDatabase;
  ops: OperationManager;
  catalog: { getKv<T>(key: string, fallback: T): T; setKv(key: string, value: unknown): void };
  profileDir: string;
  /** The built app's dist folder. */
  distDir: string;
  log: Logger;
  onCreated: (p: string) => void;
}): OcrServices {
  const languages = new OcrLanguageStore(o.langDir ?? path.join(o.distDir, 'ocr', 'lang'), path.join(o.profileDir, 'ocr-languages'));
  const engine = new OcrEngine({
    wasmDir: o.wasmDir ?? path.join(o.distDir, 'ocr'),
    workerScript: o.workerScript ?? path.join(o.distDir, 'main', 'ocr-worker.cjs'),
    languages,
    idleMs: o.idleMs,
    log: (event, fields) => o.log.info(event, fields),
  });
  const store = new OcrTextStore(o.db);
  const index = new OcrIndexJob({
    store,
    engine,
    kv: o.catalog,
    defaultFolders: o.defaultFolders ?? homeFolders,
    log: (event, fields) => o.log.info(event, fields),
    ...o.index,
  });
  const services: OcrServices = {
    engine,
    languages,
    store,
    index,
    rasterizer: undefined,
    stop: () => {
      index.stop();
      engine.stop();
    },
  };
  const extract = makeOcrExtractRunner({ engine, rasterizer: () => services.rasterizer, markRunning: (r) => o.ops.markRunning(r), onCreated: o.onCreated });
  o.ops.registerRunner('ocr-extract', extract.run, extract.validate);
  const save = makeOcrSaveRunner({ markRunning: (r) => o.ops.markRunning(r), onCreated: o.onCreated });
  o.ops.registerRunner('ocr-save', save.run, save.validate);
  return services;
}
