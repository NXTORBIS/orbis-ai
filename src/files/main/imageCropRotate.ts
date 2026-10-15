import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeImage, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { InvokeChannel, InvokeSchemas } from '../shared/ipc';
import { makeError, OrbisError, toOrbisError } from '../shared/errors';
import { requireAbsolute } from './fs/paths';
import type { ImageCropRotateResult, ImageDimensions } from '../shared/imageCropRotate';

const MAX_FILE = 200 * 1024 * 1024;

type Channels = 'imageCrop:info' | 'imageCrop:apply';
type Handlers = { [C in Extract<InvokeChannel, Channels>]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

function formatForExt(ext: string): 'png' | 'jpeg' | 'webp' {
  const lower = ext.toLowerCase();
  if (lower === 'jpg' || lower === 'jpeg') return 'jpeg';
  if (lower === 'webp') return 'webp';
  return 'png';
}

export function imageCropRotateHandlers(): Handlers {
  return {
    'imageCrop:info': async (p) => {
      const abs = requireAbsolute(p.path, 'imageCrop.info');
      const stat = await fsp.stat(abs).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'imageCrop.info', abs, 'no'));
      });
      if (!stat.isFile()) throw makeError('validation', 'imageCrop.info', { target: abs, message: 'Not a file.' });
      if (stat.size > MAX_FILE) throw makeError('validation', 'imageCrop.info', { target: abs, message: 'Image file too large (over 200 MB).' });

      const buf = await fsp.readFile(abs);
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) throw makeError('validation', 'imageCrop.info', { target: abs, message: 'Could not decode the image.' });
      const size = img.getSize();
      const ext = path.extname(abs).slice(1);
      const result: ImageDimensions = { width: size.width, height: size.height, format: ext || 'png' };
      return result;
    },

    'imageCrop:apply': async (p) => {
      const abs = requireAbsolute(p.path, 'imageCrop.apply');
      const stat = await fsp.stat(abs).catch((err) => {
        throw new OrbisError(toOrbisError(err, 'imageCrop.apply', abs, 'no'));
      });
      if (stat.size > MAX_FILE) throw makeError('validation', 'imageCrop.apply', { target: abs, message: 'Image too large.' });

      const buf = await fsp.readFile(abs);
      let img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) throw makeError('validation', 'imageCrop.apply', { target: abs, message: 'Could not decode the image.' });

      // Crop
      if (p.crop) {
        const size = img.getSize();
        const cx = Math.max(0, Math.min(p.crop.x, size.width));
        const cy = Math.max(0, Math.min(p.crop.y, size.height));
        const cw = Math.min(p.crop.width, size.width - cx);
        const ch = Math.min(p.crop.height, size.height - cy);
        if (cw > 0 && ch > 0) {
          img = img.crop({ x: cx, y: cy, width: cw, height: ch });
        }
      }

      // Rotation (90 degree steps via nativeImage)
      const deg = ((p.rotateDeg % 360) + 360) % 360;
      if (deg === 90) {
        // Rotate 90 CW: create a new bitmap manually
        const size = img.getSize();
        const bitmap = img.toBitmap();
        const w = size.width, h = size.height;
        const newBuf = Buffer.alloc(h * w * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const dstX = h - 1 - y;
            const dstY = x;
            const dstIdx = (dstY * h + dstX) * 4;
            newBuf[dstIdx] = bitmap[srcIdx]!;
            newBuf[dstIdx + 1] = bitmap[srcIdx + 1]!;
            newBuf[dstIdx + 2] = bitmap[srcIdx + 2]!;
            newBuf[dstIdx + 3] = bitmap[srcIdx + 3]!;
          }
        }
        img = nativeImage.createFromBitmap(newBuf, { width: h, height: w });
      } else if (deg === 180) {
        const size = img.getSize();
        const bitmap = img.toBitmap();
        const w = size.width, h = size.height;
        const newBuf = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const dstIdx = ((h - 1 - y) * w + (w - 1 - x)) * 4;
            newBuf[dstIdx] = bitmap[srcIdx]!;
            newBuf[dstIdx + 1] = bitmap[srcIdx + 1]!;
            newBuf[dstIdx + 2] = bitmap[srcIdx + 2]!;
            newBuf[dstIdx + 3] = bitmap[srcIdx + 3]!;
          }
        }
        img = nativeImage.createFromBitmap(newBuf, { width: w, height: h });
      } else if (deg === 270) {
        const size = img.getSize();
        const bitmap = img.toBitmap();
        const w = size.width, h = size.height;
        const newBuf = Buffer.alloc(h * w * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const dstX = y;
            const dstY = w - 1 - x;
            const dstIdx = (dstY * h + dstX) * 4;
            newBuf[dstIdx] = bitmap[srcIdx]!;
            newBuf[dstIdx + 1] = bitmap[srcIdx + 1]!;
            newBuf[dstIdx + 2] = bitmap[srcIdx + 2]!;
            newBuf[dstIdx + 3] = bitmap[srcIdx + 3]!;
          }
        }
        img = nativeImage.createFromBitmap(newBuf, { width: h, height: w });
      }

      // Flip
      if (p.flipH || p.flipV) {
        const size = img.getSize();
        const bitmap = img.toBitmap();
        const w = size.width, h = size.height;
        const newBuf = Buffer.alloc(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const dx = p.flipH ? w - 1 - x : x;
            const dy = p.flipV ? h - 1 - y : y;
            const dstIdx = (dy * w + dx) * 4;
            newBuf[dstIdx] = bitmap[srcIdx]!;
            newBuf[dstIdx + 1] = bitmap[srcIdx + 1]!;
            newBuf[dstIdx + 2] = bitmap[srcIdx + 2]!;
            newBuf[dstIdx + 3] = bitmap[srcIdx + 3]!;
          }
        }
        img = nativeImage.createFromBitmap(newBuf, { width: w, height: h });
      }

      // Encode output
      const fmt = p.format ?? formatForExt(path.extname(abs).slice(1));
      let output: Buffer;
      if (fmt === 'jpeg') {
        output = img.toJPEG(p.quality ?? 90);
      } else if (fmt === 'webp') {
        // Electron nativeImage doesn't have native WebP export; fall back to PNG
        output = img.toPNG();
      } else {
        output = img.toPNG();
      }

      // Save as new file beside the original
      const dir = path.dirname(abs);
      const baseName = path.basename(abs, path.extname(abs));
      const outExt = fmt === 'jpeg' ? '.jpg' : `.${fmt}`;
      let outName = `${baseName}_edited${outExt}`;
      let outPath = path.join(dir, outName);
      // Avoid overwriting
      if (await fsp.stat(outPath).catch(() => null)) {
        outName = `${baseName}_edited_${randomUUID().slice(0, 8)}${outExt}`;
        outPath = path.join(dir, outName);
      }

      await fsp.writeFile(outPath, output);
      const finalSize = img.getSize();
      const result: ImageCropRotateResult = {
        outputPath: outPath,
        width: finalSize.width,
        height: finalSize.height,
        bytes: output.length,
      };
      return result;
    },
  };
}
