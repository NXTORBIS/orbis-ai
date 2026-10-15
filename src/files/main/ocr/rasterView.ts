import { ipcMain, session, WebContentsView, type IpcMainEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { makeError } from '../../shared/errors';
import type { PdfRasterizer, RasterDoc, RasterPage } from './recognize';

/**
 * Renders PDF pages for text recognition with PDF.js in a hidden, sandboxed page
 * (dist/raster/raster.html) held by a WebContentsView that is never attached to a
 * window: no window appears, and the page is not one of the app's windows (it has
 * no app IPC, only the narrow bridge in rasterPreload.ts, and a session partition
 * of its own that denies every permission). The page is created on first use and
 * closed after a minute without work, or when the last app window closes.
 */

const IDLE_MS = 60_000;
const START_TIMEOUT_MS = 20_000;

export class ElectronRasterizer implements PdfRasterizer {
  private view: WebContentsView | undefined;
  private wc: WebContents | undefined;
  private ready: Promise<void> | undefined;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  private idle: NodeJS.Timeout | undefined;
  private openDocs = 0;

  constructor(private readonly opts: { html: string; preload: string; log?: (event: string, fields: Record<string, unknown>) => void }) {
    ipcMain.on('raster:reply', (e: IpcMainEvent, m: { id: number; ok: boolean; value?: unknown; message?: string }) => {
      if (!this.wc || e.sender !== this.wc) return;
      const p = this.pending.get(m?.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.ok) p.resolve(m.value);
      else p.reject(makeError('validation', 'ocr.raster', { message: m.message ?? 'The page could not be rendered.' }));
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const ses = session.fromPartition('orbis-raster', { cache: false });
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    // Only the page's own files load; anything else (http, other protocols) is refused.
    ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith('file://') && !details.url.startsWith('blob:') && !details.url.startsWith('data:') }));
    const view = new WebContentsView({
      webPreferences: { preload: this.opts.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, spellcheck: false, backgroundThrottling: false, session: ses, webgl: false },
    });
    const wc = view.webContents;
    this.view = view;
    this.wc = wc;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('render-process-gone', (_e, d) => {
      this.opts.log?.('ocr.raster_gone', { reason: d.reason });
      this.reset(`The page renderer stopped (${d.reason}).`);
    });
    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(makeError('unavailable', 'ocr.raster', { message: 'The PDF page renderer did not start.' })), START_TIMEOUT_MS);
      const onReady = (e: IpcMainEvent) => {
        if (e.sender !== wc) return;
        clearTimeout(timer);
        ipcMain.removeListener('raster:ready', onReady);
        resolve();
      };
      ipcMain.on('raster:ready', onReady);
      wc.loadFile(this.opts.html).catch((err: Error) => {
        clearTimeout(timer);
        ipcMain.removeListener('raster:ready', onReady);
        reject(makeError('unavailable', 'ocr.raster', { message: `The PDF page renderer could not load: ${err.message}` }));
      });
    });
    this.ready.catch(() => this.reset('The PDF page renderer did not start.'));
    return this.ready;
  }

  private reset(why: string): void {
    for (const p of this.pending.values()) p.reject(makeError('unavailable', 'ocr.raster', { message: why }));
    this.pending.clear();
    const wc = this.wc;
    this.view = undefined;
    this.wc = undefined;
    this.ready = undefined;
    this.openDocs = 0;
    if (wc && !wc.isDestroyed()) wc.close();
  }

  private async call<T>(job: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 120_000): Promise<T> {
    clearTimeout(this.idle);
    await this.start();
    if (signal?.aborted) throw makeError('cancelled', 'ocr.raster');
    const id = ++this.seq;
    try {
      return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          reject(makeError('busy', 'ocr.raster', { message: 'Rendering the page took too long and was stopped.' }));
          // A page stuck in PDF.js is only stopped by ending its renderer.
          this.reset('The PDF page renderer was restarted.');
        }, timeoutMs);
        const onAbort = () => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(makeError('cancelled', 'ocr.raster'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.pending.set(id, {
          resolve: (v) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            resolve(v as T);
          },
          reject: (e) => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(e);
          },
        });
        this.wc!.send('raster:job', { id, ...job });
      });
    } finally {
      this.scheduleIdle();
    }
  }

  private scheduleIdle(): void {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (!this.pending.size && !this.openDocs) this.reset('idle');
    }, IDLE_MS);
    this.idle.unref?.();
  }

  async openPdf(bytes: Uint8Array, signal?: AbortSignal): Promise<RasterDoc> {
    const docId = randomUUID();
    const { pageCount } = await this.call<{ pageCount: number }>({ op: 'open', docId, bytes }, signal);
    this.openDocs++;
    let closed = false;
    return {
      pageCount,
      page: (index, o, sig) => this.call<RasterPage>({ op: 'page', docId, index, render: o.render, dpi: o.dpi, maxPixels: o.maxPixels }, sig),
      close: () => {
        if (closed) return;
        closed = true;
        this.openDocs = Math.max(0, this.openDocs - 1);
        if (this.wc) void this.call({ op: 'close', docId }).catch(() => undefined);
      },
    };
  }

  decodeImage(bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<{ png: Uint8Array; width: number; height: number }> {
    return this.call({ op: 'decode', bytes, mime }, signal);
  }

  /** Close the hidden page (last window closed, quit). */
  dispose(): void {
    clearTimeout(this.idle);
    this.reset('Text recognition stopped.');
  }
}
