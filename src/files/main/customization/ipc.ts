import { BrowserWindow, dialog, nativeImage, nativeTheme, type IpcMainInvokeEvent } from 'electron';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { z } from 'zod';
import type { InvokeSchemas } from '../../shared/ipc';
import { makeError } from '../../shared/errors';
import { CustomizationError, CustomOpSchema } from '../../shared/customization/ops';
import { resolveCustomization } from '../../shared/customization/resolve';
import { CommandDescriptorSchema, type CommandDescriptor } from '../../shared/integration/host-adapters';
import type { ExportKind } from '../../shared/customization/portable';
import type { Services } from '../services';
import { checkBackgroundImage } from './backgrounds';

/**
 * IPC handlers for the customization engine. Every change goes through
 * CustomizationService, which validates the whole resulting configuration
 * before storing it; nothing here touches the user's files except writing an
 * export the user chose a destination for.
 */

export type CustomChannel =
  | 'custom:get' | 'custom:apply' | 'custom:undo' | 'custom:redo' | 'custom:revert' | 'custom:restoreBackup'
  | 'custom:export' | 'custom:pickImport' | 'custom:previewImport' | 'custom:applyImport' | 'custom:registry'
  | 'custom:pickBackground' | 'custom:checkBackground' | 'fs:checkPaths';

type Handlers = { [C in CustomChannel]: (p: z.infer<(typeof InvokeSchemas)[C]>, e: IpcMainInvokeEvent) => unknown };

/** Turn a refusal from the customization engine into a user-facing validation error. */
function guard<T>(operation: string, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CustomizationError) throw makeError('validation', operation, { message: err.message, cause: err.details.join('\n') || undefined });
    throw err;
  }
}

async function guardAsync<T>(operation: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CustomizationError) throw makeError('validation', operation, { message: err.message, cause: err.details.join('\n') || undefined });
    throw err;
  }
}

/** Mirror the effective mode and interface scale into Electron (window chrome, native dialogs, zoom). */
export function applyCustomizationToElectron(s: Services): void {
  const r = resolveCustomization(s.customization.current, { systemDark: nativeTheme.shouldUseDarkColors });
  if (nativeTheme.themeSource !== r.appearance.mode) nativeTheme.themeSource = r.appearance.mode;
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.webContents.isDestroyed() && Math.abs(w.webContents.getZoomFactor() - r.accessibility.interfaceScale) > 0.001) w.webContents.setZoomFactor(r.accessibility.interfaceScale);
  }
}

export function interfaceScale(s: Services): number {
  return resolveCustomization(s.customization.current, { systemDark: nativeTheme.shouldUseDarkColors }).accessibility.interfaceScale;
}

/**
 * Large background images are scaled down once into the profile's cache so
 * the interface never decodes a huge image while scrolling. Formats Electron
 * cannot decode in the main process are shown as they are.
 */
async function displayCopy(profileDir: string, file: string, bytes: number, modifiedMs: number): Promise<string> {
  const dir = path.join(profileDir, 'backgrounds');
  const key = crypto.createHash('sha1').update(`${file}|${bytes}|${modifiedMs}`).digest('hex');
  const out = path.join(dir, `${key}.jpg`);
  if (await fsp.stat(out).then(() => true, () => false)) return out;
  if (bytes < 3 * 1024 * 1024) return file;
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty()) return file;
  const { width } = img.getSize();
  if (width <= 3200 && bytes < 8 * 1024 * 1024) return file;
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${out}.${crypto.randomUUID()}.part`;
  await fsp.writeFile(tmp, img.resize({ width: Math.min(width, 3200), quality: 'good' }).toJPEG(86));
  await fsp.rename(tmp, out).catch(async () => fsp.unlink(tmp).catch(() => undefined));
  // Keep only the most recent few cached backgrounds.
  const files = await fsp.readdir(dir).catch(() => [] as string[]);
  if (files.length > 6) {
    const stats = await Promise.all(files.map(async (f) => ({ f, t: (await fsp.stat(path.join(dir, f)).catch(() => undefined))?.mtimeMs ?? 0 })));
    for (const x of stats.sort((a, b) => b.t - a.t).slice(6)) await fsp.unlink(path.join(dir, x.f)).catch(() => undefined);
  }
  return out;
}

export function customizationHandlers(s: Services): Handlers {
  const c = s.customization;
  const exportDir = async () => {
    const docs = path.join(os.homedir(), 'Documents');
    return (await fsp.stat(docs).then((st) => st.isDirectory(), () => false)) ? docs : os.homedir();
  };
  return {
    'custom:get': () => c.state(),
    'custom:apply': (p) => {
      const op = CustomOpSchema.safeParse(p.op);
      if (!op.success) throw makeError('validation', 'custom.apply', { message: 'That change is not valid.', cause: op.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n') });
      return guard('custom.apply', () => c.apply(op.data, { systemDark: p.systemDark }));
    },
    'custom:undo': () => guard('custom.undo', () => c.undo()),
    'custom:redo': () => guard('custom.redo', () => c.redo()),
    'custom:revert': () => guard('custom.revert', () => c.revertToLastGood()),
    'custom:restoreBackup': (p) => guard('custom.restoreBackup', () => c.restoreBackup(p.slot)),
    'custom:export': async (p, e) => guardAsync('custom.export', async () => {
      const { json, fileName } = c.exportJson(p.kind as ExportKind, p.id, { systemDark: p.systemDark });
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Export customization', defaultPath: path.join(await exportDir(), fileName), filters: [{ name: 'Orbis Files customization', extensions: ['json'] }] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return null;
      const target = r.filePath.toLowerCase().endsWith('.json') ? r.filePath : `${r.filePath}.json`;
      // The save dialog already asked about replacing an existing file.
      const tmp = `${target}.${crypto.randomUUID()}.part`;
      await fsp.writeFile(tmp, json, { flag: 'wx' });
      await fsp.rename(tmp, target).catch(async (err) => {
        await fsp.unlink(tmp).catch(() => undefined);
        throw err;
      });
      return { path: target, bytes: Buffer.byteLength(json) };
    }),
    'custom:pickImport': async (_p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Import customization', properties: ['openFile' as const], filters: [{ name: 'Orbis Files customization', extensions: ['json'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
    },
    'custom:previewImport': async (p) => guardAsync('custom.previewImport', async () => {
      const { text, fileName } = await c.readImport(p.path);
      return { ...c.previewImport(text, fileName), fileName };
    }),
    // The file is read and validated again: nothing from the preview is trusted.
    'custom:applyImport': async (p) => guardAsync('custom.applyImport', async () => {
      const { text, fileName } = await c.readImport(p.path);
      return c.applyImport(text, fileName);
    }),
    'custom:registry': (p) => {
      const commands: CommandDescriptor[] = [];
      for (const raw of p.commands) {
        const r = CommandDescriptorSchema.safeParse(raw);
        if (r.success) commands.push(r.data);
      }
      c.setRegistry(commands);
      return { accepted: commands.length };
    },
    'custom:pickBackground': async (_p, e) => {
      const win = BrowserWindow.fromWebContents(e.sender);
      const opts = { title: 'Choose a background image', properties: ['openFile' as const], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (r.canceled || !r.filePaths[0]) return null;
      return { path: r.filePaths[0], check: await checkBackgroundImage(r.filePaths[0]) };
    },
    'custom:checkBackground': async (p) => {
      const check = await checkBackgroundImage(p.path);
      if (!check.ok) return check;
      const display = await displayCopy(s.profileDir, check.path, check.bytes, check.modifiedMs).catch(() => check.path);
      return { ...check, display };
    },
    'fs:checkPaths': async (p) => {
      return Promise.all(p.paths.map(async (file) => {
        try {
          const st = await fsp.stat(file);
          return { path: file, exists: true, kind: st.isDirectory() ? 'directory' : 'file' };
        } catch (err) {
          const code = (err as NodeJS.ErrnoException).code;
          const reason = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : code === 'EACCES' || code === 'EPERM' ? 'permission' : 'unavailable';
          return { path: file, exists: false, reason, code };
        }
      }));
    },
  };
}
