import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { makeError, toOrbisError } from '../../shared/errors';
import type { OperationRecord } from '../../shared/operations';
import { BUILTIN_IMAGE_PRESETS, ImagePresetSchema, ImageToolSpecSchema, outputName, planImage, type ImagePlan, type ImagePreset, type ImageToolSpec, type ImageToolSpecInput, type OutputFormat } from '../../shared/imageTools';
import { crop, flattenOnWhite, flip, orient, resize, rotate, type Bitmap } from '../../shared/pixels';
import type { ExternalRunner } from '../ops/OperationManager';
import { exists } from '../fs/FileSystemService';
import { uniqueName, validateName } from '../fs/paths';
import { readMetadata } from './metadata';
import { stripJpeg, stripPng } from './editMetadata';

/**
 * Batch image tools as one 'image-batch' operation: resize, crop to an aspect
 * ratio, rotate, flip, remove metadata and convert — for every selected image,
 * with progress, pause and cancel. Originals are never modified and nothing is
 * ever overwritten: each output is written to a temporary sibling, checked by
 * reading it back (format and exact pixel size), then committed with link(),
 * taking a free “name (2)” when the name is taken.
 *
 * Engines (real codecs only):
 *  - the platform codec (Electron nativeImage) decodes PNG/JPEG and encodes
 *    PNG/JPEG in the main process;
 *  - for WebP output and for inputs only Chromium can decode (WebP, GIF, BMP,
 *    AVIF, ICO) the app window decodes, transforms (same shared pixel code) and
 *    encodes with a canvas, and passes the bytes in `params.encoded`; this
 *    runner verifies and commits them like any other output;
 *  - “remove metadata” without other changes on JPEG/PNG reuses the metadata
 *    editor's byte-level stripping (image data copied unchanged).
 */

export interface DecodedImage extends Bitmap {
  /** Colour channels already multiplied by alpha (platform codec bitmaps are). */
  premultiplied: boolean;
}

export interface ImageCodec {
  /** Decode to 4-byte pixels; undefined when this codec cannot read the file. */
  decode(p: string): Promise<DecodedImage | undefined>;
  /** Encode; undefined when this codec cannot write the format. */
  encode(img: DecodedImage, format: OutputFormat, quality: number): Promise<Buffer | undefined>;
}

const EncodedSchema = z.object({
  source: z.string().min(1).max(32767),
  format: z.enum(['jpeg', 'png', 'webp']),
  data: z.instanceof(Uint8Array),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const ImageBatchParamsSchema = z.object({
  spec: ImageToolSpecSchema,
  /** Outputs already encoded by the app window (Chromium), per source. */
  encoded: z.array(EncodedSchema).max(10000).optional(),
});

/** Apply a plan's geometry to decoded, still un-oriented pixels. */
export function transformPixels(img: DecodedImage, orientation: number | undefined, spec: ImageToolSpec, plan: ImagePlan): DecodedImage {
  let b: Bitmap = orient(img, orientation);
  if (spec.rotate) b = rotate(b, spec.rotate);
  if (spec.flipH) b = flip(b, 'horizontal');
  if (spec.flipV) b = flip(b, 'vertical');
  if (plan.crop) b = crop(b, plan.crop.x, plan.crop.y, plan.crop.w, plan.crop.h);
  if (plan.scaleTo) b = resize(b, plan.scaleTo.w, plan.scaleTo.h);
  if (plan.format === 'jpeg') b = flattenOnWhite(b, img.premultiplied);
  return { ...b, premultiplied: img.premultiplied };
}

const FORMAT_LABEL: Record<OutputFormat, RegExp> = { jpeg: /^JPEG/, png: /^PNG/, webp: /WebP/, avif: /AVIF/, bmp: /BMP/ };

/** Commit a verified temporary file under `name` in `dir` without replacing anything. */
async function commitKeepBoth(tmp: string, dir: string, name: string): Promise<string> {
  let target = path.join(dir, name);
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fsp.link(tmp, target);
      return target;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      target = path.join(dir, await uniqueName(dir, name, exists));
    }
  }
  throw makeError('already_exists', 'images.commit', { message: 'Could not find a free name for the output.' });
}

export function makeImageBatchRunner(deps: { codec?: ImageCodec; markRunning: (rec: OperationRecord) => void; onCreated?: (p: string) => void }): ExternalRunner {
  return async (rec, req, ctx, helpers) => {
    const parsed = ImageBatchParamsSchema.safeParse(req.params);
    if (!parsed.success) throw makeError('validation', 'images.batch', { message: 'The image settings are not valid.', cause: parsed.error.issues[0]?.message });
    const { spec } = parsed.data;
    const encoded = new Map((parsed.data.encoded ?? []).map((e) => [path.resolve(e.source), e]));
    if (spec.outputFolder) {
      const st = await fsp.stat(spec.outputFolder).catch(() => undefined);
      if (!st?.isDirectory()) throw makeError('not_a_directory', 'images.batch', { target: spec.outputFolder, message: 'The output folder does not exist.' });
    }
    rec.progress = { totalItems: rec.sources.length, completedItems: 0, completedBytes: 0 };
    deps.markRunning(rec);
    const created: Array<{ source: string; destination: string }> = [];
    for (const src of rec.sources) {
      await ctx.gate();
      const dir = spec.outputFolder ?? path.dirname(src);
      let tmp: string | undefined;
      try {
        const st = await fsp.lstat(src);
        if (!st.isFile()) throw makeError('unsupported', 'images.batch', { target: src, message: 'Only image files are processed (not folders or links).' });
        const meta = await readMetadata(src);
        if (meta.kind !== 'image') throw makeError('unsupported', 'images.batch', { target: src, message: 'This file is not an image these tools can read.' });
        const plan = planImage({ name: path.basename(src), width: meta.width, height: meta.height, orientation: meta.orientation }, spec);
        if (plan.error) throw makeError('unsupported', 'images.batch', { target: src, message: plan.error });
        if (plan.unchanged) {
          rec.results.push({ source: src, status: 'skipped', error: { category: 'validation', operation: 'images.batch', message: 'Nothing to change for this image.', dataChanged: 'no', retryable: false, target: src } });
          helpers.tick(0, 1, path.basename(src));
          continue;
        }
        const name = outputName(path.basename(src), spec, plan.format);
        const v = validateName(name);
        if (!v.valid) throw makeError('invalid_name', 'images.batch', { target: src, message: v.reason });
        let bytes: Buffer;
        const pre = encoded.get(path.resolve(src));
        if (pre) {
          if (pre.format !== plan.format || pre.width !== plan.width || pre.height !== plan.height) throw makeError('validation', 'images.batch', { target: src, message: 'The image prepared in the window does not match the preview; nothing was saved.' });
          bytes = Buffer.from(pre.data.buffer, pre.data.byteOffset, pre.data.byteLength);
        } else if (!plan.reencode) {
          const original = await fsp.readFile(src);
          bytes = plan.format === 'jpeg' ? stripJpeg(original, 'all').data : stripPng(stripPng(original, 'exif').data, 'text').data;
        } else {
          if (plan.engine === 'renderer') throw makeError('unsupported', 'images.batch', { target: src, message: plan.format === 'webp' ? 'WebP is encoded by the app window; start this from Batch image tools.' : 'This format is decoded by the app window; start this from Batch image tools.' });
          if (!deps.codec) throw makeError('unavailable', 'images.batch', { message: 'Image processing is not available here.' });
          const img = await deps.codec.decode(src).catch(() => undefined);
          if (!img) throw makeError('unsupported', 'images.batch', { target: src, message: 'The platform image codec could not decode this file (it may be damaged or use an unsupported variant, such as CMYK JPEG).' });
          if (img.width !== meta.width || img.height !== meta.height) throw makeError('io', 'images.batch', { target: src, message: 'The decoded size differs from the size stored in the file; nothing was saved.' });
          await ctx.gate();
          const out = transformPixels(img, meta.orientation, spec, plan);
          const enc = await deps.codec.encode(out, plan.format, spec.quality);
          if (!enc) throw makeError('unsupported', 'images.batch', { target: src, message: `${plan.format.toUpperCase()} cannot be written by the platform codec.` });
          bytes = enc;
        }
        tmp = path.join(dir, `.orbis-part-${crypto.randomUUID()}.${plan.format}`);
        helpers.temp(tmp);
        await fsp.writeFile(tmp, bytes, { flag: 'wx' });
        const check = await readMetadata(tmp);
        if (check.kind !== 'image' || !FORMAT_LABEL[plan.format].test(check.format ?? '') || check.width !== plan.width || check.height !== plan.height) {
          throw makeError('io', 'images.batch', { target: src, message: `The output did not verify (expected ${plan.format.toUpperCase()} ${plan.width} × ${plan.height}); nothing was saved.` });
        }
        if (spec.stripMetadata && (check.exif || check.gps || check.hasLocation)) throw makeError('io', 'images.batch', { target: src, message: 'Metadata was still present in the output; nothing was saved.' });
        const final = await commitKeepBoth(tmp, dir, name);
        await fsp.unlink(tmp).catch(() => undefined);
        helpers.committed(tmp);
        tmp = undefined;
        created.push({ source: src, destination: final });
        deps.onCreated?.(final);
        rec.results.push({ source: src, destination: final, status: 'done' });
        helpers.tick(bytes.length, 1, path.basename(src));
      } catch (err) {
        if (tmp) {
          await fsp.rm(tmp, { force: true }).catch(() => undefined);
          helpers.committed(tmp);
        }
        const shape = toOrbisError(err, 'images.batch', src, 'no');
        if (shape.category === 'cancelled') throw err;
        rec.results.push({ source: src, status: 'failed', error: shape });
        helpers.tick(0, 1, path.basename(src));
      }
    }
    // Window-encoded bytes are not kept for the life of the record (a retry of those items asks to start again from the dialog).
    if (req.params && 'encoded' in req.params) delete (req.params as { encoded?: unknown }).encoded;
    // Undo moves the new copies to the Trash; originals were never touched.
    rec.undo = created.length ? { kind: 'transfer', mode: 'copy', items: created } : { kind: 'none', reason: 'No new images were created.' };
  };
}

const PRESETS_KEY = 'imageTools.presets';
export const MAX_IMAGE_PRESETS = 50;

/** Saved image-tool settings (per profile, catalogue key-value table), plus the built-in presets. */
export class ImagePresetStore {
  constructor(private readonly kv: { getKv<T>(key: string, fallback: T): T; setKv(key: string, value: unknown): void }) {}

  private saved(): ImagePreset[] {
    const raw = z.array(z.unknown()).safeParse(this.kv.getKv<unknown>(PRESETS_KEY, []));
    if (!raw.success) return [];
    return raw.data.flatMap((x) => {
      const p = ImagePresetSchema.safeParse(x);
      return p.success && !p.data.builtIn ? [p.data] : [];
    });
  }

  list(): ImagePreset[] {
    return [...BUILTIN_IMAGE_PRESETS, ...this.saved().sort((a, b) => a.name.localeCompare(b.name))];
  }

  save(name: string, specInput: ImageToolSpecInput): ImagePreset {
    const n = name.trim();
    if (!n) throw makeError('validation', 'images.savePreset', { message: 'Enter a name for the preset.' });
    if (BUILTIN_IMAGE_PRESETS.some((p) => p.name.toLowerCase() === n.toLowerCase())) throw makeError('validation', 'images.savePreset', { message: 'A built-in preset has this name. Choose another name.' });
    const spec = ImageToolSpecSchema.safeParse(specInput);
    if (!spec.success) throw makeError('validation', 'images.savePreset', { message: 'These image settings are not valid.', cause: spec.error.issues[0]?.message });
    const list = this.saved();
    const existing = list.find((p) => p.name.toLowerCase() === n.toLowerCase());
    if (!existing && list.length >= MAX_IMAGE_PRESETS) throw makeError('validation', 'images.savePreset', { message: `Up to ${MAX_IMAGE_PRESETS} presets can be saved. Delete one first.` });
    const preset: ImagePreset = { id: existing?.id ?? crypto.randomUUID(), name: n.slice(0, 80), spec: { ...spec.data, outputFolder: spec.data.outputFolder }, savedMs: Date.now() };
    this.kv.setKv(PRESETS_KEY, [...list.filter((p) => p.id !== preset.id), preset]);
    return preset;
  }

  delete(id: string): boolean {
    if (id.startsWith('builtin:')) throw makeError('validation', 'images.deletePreset', { message: 'Built-in presets cannot be deleted.' });
    const list = this.saved();
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) return false;
    this.kv.setKv(PRESETS_KEY, next);
    return true;
  }
}
