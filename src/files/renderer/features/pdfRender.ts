import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import { call } from '../api';

/**
 * Page thumbnails for the PDF tools, drawn by PDF.js in the renderer. The PDF's
 * bytes come over IPC (the renderer cannot read files); parsing runs in PDF.js's
 * module worker, loaded from next to the renderer bundle (dist/renderer, inside
 * app.asar when packaged). Script evaluation stays off (the page's CSP forbids
 * it); fonts not embedded in the PDF are drawn with system fonts.
 */

let configured = false;
function configure(): void {
  if (configured) return;
  GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', document.baseURI).href;
  configured = true;
}

export interface LoadedPdf { doc: PDFDocumentProxy; close: () => void }

/** Open a PDF for drawing thumbnails. Rejects with a readable reason when it cannot be drawn. */
export async function openPdfForThumbnails(path: string): Promise<LoadedPdf> {
  configure();
  const data = await call<Uint8Array>('pdf:bytes', { path });
  const task = getDocument({ data, isEvalSupported: false, useSystemFonts: true, disableAutoFetch: true, stopAtErrors: false });
  const doc = await task.promise;
  return { doc, close: () => void task.destroy() };
}

/**
 * Draw one page (0-based) into the canvas, fitting `box` CSS pixels on its
 * longer side. The page's own rotation is applied; extra turns are left to CSS.
 */
export async function drawPage(doc: PDFDocumentProxy, index: number, canvas: HTMLCanvasElement, box: number): Promise<void> {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = (box / Math.max(base.width, base.height)) * dpr;
  const vp = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  canvas.style.width = `${Math.round(vp.width / dpr)}px`;
  canvas.style.height = `${Math.round(vp.height / dpr)}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas drawing is not available.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
}
