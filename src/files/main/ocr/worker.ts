/**
 * Text recognition worker thread (bundled to dist/main/ocr-worker.cjs and started
 * as an eval worker, so it also runs from inside app.asar).
 *
 * It drives tesseract.js v7's WebAssembly core (tesseract.js-core: Tesseract 5 +
 * Leptonica) directly: the WebAssembly binary and the language data arrive as
 * bytes from the main process, so nothing is looked up on disk and nothing is
 * ever downloaded. Network access is switched off inside this thread before the
 * engine loads (fetch, http, https, net, tls…), so even a code path that tried
 * to fetch language data would fail instead of reaching out.
 *
 * Messages (one at a time; the main process queues them):
 *   init       { langs: [{ code, data }] }           load language data and initialise the engine
 *   recognize  { image, orientation, detectOrientation, dpi?, addToPdf? }
 *   pdf-begin  { title }  /  pdf-end → PDF bytes         searchable PDF (text layer under the images)
 *   nice       → this thread's nice value (Linux)        checks the background priority
 */
import os from 'node:os';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parentPort, workerData } from 'node:worker_threads';
import PSM from 'tesseract.js/src/constants/PSM';
import OEM from 'tesseract.js/src/constants/OEM';
import * as bmp from 'bmp-js';
import coreSimd from 'tesseract.js-core/tesseract-core-simd-lstm.js';
import corePlain from 'tesseract.js-core/tesseract-core-lstm.js';
import { composeOrientation, type QuarterTurn } from '../../shared/ocr';

// ------------------------------------------------------------------ no network, ever
const NO_NET = 'Network access is disabled for text recognition (language data is bundled or added from files).';
function blockNetwork(): void {
  const refuse = () => {
    throw new Error(NO_NET);
  };
  (globalThis as { fetch?: unknown }).fetch = () => Promise.reject(new Error(NO_NET));
  for (const k of ['XMLHttpRequest', 'WebSocket', 'EventSource']) (globalThis as Record<string, unknown>)[k] = undefined;
  for (const name of ['http', 'https', 'http2', 'net', 'tls', 'dgram']) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(`node:${name}`) as Record<string, unknown>;
    for (const fn of ['request', 'get', 'connect', 'createConnection', 'createSocket', 'Agent']) {
      if (typeof mod[fn] === 'function') {
        try {
          mod[fn] = refuse;
        } catch {
          /* read-only export: the other guards still apply */
        }
      }
    }
  }
}
blockNetwork();

const data = workerData as { wasm: Uint8Array; variant: 'simd' | 'plain'; lowPriority?: boolean };

// Background work runs at the lowest scheduling priority. On Linux, setpriority() with
// pid 0 changes the calling thread only, so the main process and the window keep theirs.
let priorityNote = 'normal';
if (data.lowPriority && process.platform === 'linux') {
  try {
    os.setPriority(19);
    priorityNote = 'lowered';
  } catch (err) {
    priorityNote = `not lowered: ${(err as Error).message}`;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type TessModule = any;
type TessApi = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

let M: TessModule | undefined;
let api: TessApi | undefined;
let langsKey = '';
let currentId = 0;
let pdf: { renderer: TessApi; base: string } | undefined;

async function core(): Promise<TessModule> {
  if (M) return M;
  const factory = data.variant === 'simd' ? coreSimd : corePlain;
  M = await factory({
    wasmBinary: data.wasm,
    // Engine progress for the page being recognized (percent 0–100).
    TesseractProgress: (percent: number) => parentPort!.postMessage({ id: currentId, progress: Math.max(0, Math.min(1, (percent - 30) / 70)) }),
    print: () => undefined,
    printErr: () => undefined,
  });
  return M;
}

function gunzipIfNeeded(b: Uint8Array): Uint8Array {
  return b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(zlib.gunzipSync(b)) : b;
}

async function init(langs: Array<{ code: string; data: Uint8Array }>): Promise<{ langs: string; priority: string }> {
  const m = await core();
  const key = langs.map((l) => l.code).join('+');
  if (api && key === langsKey) return { langs: key, priority: priorityNote };
  try {
    m.FS.mkdir('/tessdata');
  } catch {
    /* exists */
  }
  for (const l of langs) m.FS.writeFile(`/tessdata/${l.code}.traineddata`, gunzipIfNeeded(l.data));
  if (api) api.End();
  api = new m.TessBaseAPI();
  if (api.Init('/tessdata', key, OEM.LSTM_ONLY, null) !== 0) {
    api = undefined;
    langsKey = '';
    throw new Error(`The language data for ${key.replace(/\+/g, ' + ')} could not be loaded (damaged, or made for another Tesseract version).`);
  }
  api.SetVariable('tessedit_pageseg_mode', PSM.AUTO);
  // Remove the language files from the engine's memory file system: Init has read them.
  for (const l of langs) {
    try {
      m.FS.unlink(`/tessdata/${l.code}.traineddata`);
    } catch {
      /* already gone */
    }
  }
  langsKey = key;
  return { langs: key, priority: priorityNote };
}

function setImage(image: Uint8Array, orientation: number, angle: number): void {
  let bytes = image;
  // Leptonica reads only some BMP variants; like tesseract.js, convert every BMP through bmp-js first.
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) bytes = new Uint8Array(bmp.encode(bmp.decode(Buffer.from(bytes))).data);
  M.FS.writeFile('/input', bytes);
  if (api.SetImageFile(orientation, angle) === 1) throw new Error('The image could not be decoded by the recognition engine (unsupported variant or damaged file).');
}

interface Word { text: string; conf: number; x0: number; y0: number; x1: number; y1: number }
interface Pass { text: string; confidence: number; words: Word[]; width: number; height: number; skew: number; turn: number; orientation: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
function wordsOf(json: any): Word[] {
  const out: Word[] = [];
  for (const b of json?.blocks ?? []) for (const p of b.paragraphs ?? []) for (const l of p.lines ?? []) for (const w of l.words ?? []) {
    if (!w?.bbox || typeof w.text !== 'string' || !w.text.trim()) continue;
    out.push({ text: w.text, conf: Math.round(Number(w.confidence) * 10) / 10, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
  }
  return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Size of the image as the engine sees it (after orientation), from the page line of the TSV output. */
function frameSize(): { width: number; height: number } {
  const first = String(api.GetTSVText(0) ?? '').split('\n')[0]?.split('\t') ?? [];
  return { width: Number(first[8]) || 0, height: Number(first[9]) || 0 };
}

function pass(image: Uint8Array, orientation: number, turn: number, dpi?: number): Pass {
  // Straighten small skew (as tesseract.js's rotateAuto does): find the text lines, read their gradient.
  setImage(image, orientation, 0);
  if (dpi) api.SetSourceResolution(dpi);
  api.FindLines();
  const g = Number(api.GetGradient?.() ?? 0);
  let skew = 0;
  if (Number.isFinite(g) && Math.abs(g) >= 0.005 && Math.abs(g) < 0.5) {
    skew = g;
    setImage(image, orientation, skew);
    if (dpi) api.SetSourceResolution(dpi);
  }
  api.Recognize(null);
  const words = wordsOf(JSON.parse(api.GetJSONText() || '{}'));
  return { text: String(api.GetUTF8Text() ?? ''), confidence: Number(api.MeanTextConf()), words, ...frameSize(), skew, turn, orientation };
}

/** Recognition quality used to choose an orientation: confident characters, weighted by confidence. */
const score = (p: Pass) => p.words.reduce((s, w) => s + (w.conf >= 50 ? w.text.length * w.conf : 0), 0);

function recognize(msg: { image: Uint8Array; orientation?: number; detectOrientation?: boolean; dpi?: number; addToPdf?: boolean }): Omit<Pass, 'orientation'> {
  if (!api) throw new Error('The recognition engine is not initialised.');
  const fileO = msg.orientation ?? 1;
  let best = pass(msg.image, composeOrientation(fileO, 0), 0, msg.dpi);
  let last = best;
  const good = best.words.filter((w) => w.conf >= 70).reduce((n, w) => n + w.text.length, 0);
  // A poor first reading may be a turned page. Tesseract already reads sideways lines as vertical text, so
  // upside down is tried first, then the quarter turns. A page where nothing at all was found (a photo,
  // a blank page) is not tried again: turned text still yields some (wrong) words.
  if (msg.detectOrientation && best.words.length > 0 && (best.confidence < 70 || good < 3)) {
    for (const turn of [180, 90, 270]) {
      const p = pass(msg.image, composeOrientation(fileO, turn as QuarterTurn), turn, msg.dpi);
      last = p;
      if (score(p) > score(best) * 1.15 + 50) best = p;
      if (best.confidence >= 85 && best.words.length >= 2) break;
    }
  }
  if (msg.addToPdf) {
    if (!pdf) throw new Error('No searchable PDF is being written.');
    // The renderer adds the page the engine holds now: recognize the chosen orientation again if needed.
    if (last !== best) pass(msg.image, best.orientation, best.turn, msg.dpi);
    if (!pdf.renderer.AddImage(api)) throw new Error('The page could not be added to the searchable PDF.');
  }
  const { orientation: _o, ...rest } = best;
  void _o;
  return rest;
}

function pdfBegin(title: string): void {
  if (!api) throw new Error('The recognition engine is not initialised.');
  if (pdf) M.FS.unlink(`${pdf.base}.pdf`);
  const base = `/out-${Date.now()}`;
  const renderer = new M.TessPDFRenderer(base, '/tessdata', false);
  if (!renderer.BeginDocument(title.slice(0, 200))) throw new Error('The searchable PDF could not be started.');
  pdf = { renderer, base };
}

function pdfEnd(): Uint8Array {
  if (!pdf) throw new Error('No searchable PDF is being written.');
  const { renderer, base } = pdf;
  pdf = undefined;
  renderer.EndDocument();
  M._free(renderer);
  const bytes = M.FS.readFile(`${base}.pdf`) as Uint8Array;
  M.FS.unlink(`${base}.pdf`);
  return bytes;
}

/** This thread's nice value (field 19 of /proc/thread-self/stat), to check the background priority. */
function niceness(): number | null {
  try {
    const stat = fs.readFileSync('/proc/thread-self/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(fields[16]);
  } catch {
    return null;
  }
}

parentPort!.on('message', (msg: { id: number; type: string; [k: string]: unknown }) => {
  currentId = msg.id;
  const reply = (value: unknown, transfer?: ArrayBuffer[]) => parentPort!.postMessage({ id: msg.id, ok: true, value }, transfer ?? []);
  const fail = (err: unknown) => parentPort!.postMessage({ id: msg.id, ok: false, message: String((err as Error)?.message ?? err).slice(0, 600) });
  void (async () => {
    try {
      switch (msg.type) {
        case 'init': return reply(await init(msg.langs as Array<{ code: string; data: Uint8Array }>));
        case 'recognize': return reply(recognize(msg as never));
        case 'pdf-begin': return reply(pdfBegin(String(msg.title ?? 'Recognized text')));
        case 'pdf-end': {
          const bytes = pdfEnd();
          const copy = new Uint8Array(bytes);
          return reply(copy, [copy.buffer]);
        }
        case 'nice': return reply({ nice: niceness(), priority: priorityNote });
        case 'fetch-test':
          // Used by the tests: proves the guard is in place inside this thread.
          return reply(await (globalThis as unknown as { fetch: (u: string) => Promise<unknown> }).fetch(String(msg.url)).then(() => 'fetched', (e: Error) => e.message));
        default: throw new Error(`Unknown request ${msg.type}`);
      }
    } catch (err) {
      fail(err);
    }
  })();
});
