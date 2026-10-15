import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeError, OrbisError, toOrbisError } from '../../shared/errors';
import type { FileEntry } from '../../shared/model';
import { childPath, requireAbsolute } from './paths';
import { entryFor, extOf } from './FileSystemService';

/**
 * File templates for "New → …". A template is any regular file in the
 * templates folder: the configured folder (Settings → Your data), or on
 * Linux the XDG templates folder (XDG_TEMPLATES_DIR in user-dirs.dirs, else
 * ~/Templates) when it exists. A new file is a byte-for-byte copy, created
 * exclusively: an existing file is never overwritten.
 */

export interface TemplateInfo { name: string; path: string; size: number; ext: string }

export interface TemplatesListing {
  /** The folder in use, if any. */
  folder?: string;
  source: 'setting' | 'xdg' | 'none';
  /** Why no folder is used, or what was skipped. */
  note?: string;
  templates: TemplateInfo[];
}

/** Largest template copied. */
export const MAX_TEMPLATE_BYTES = 100 * 1024 * 1024;
/** Most templates listed. */
export const MAX_TEMPLATES = 200;

/** XDG_TEMPLATES_DIR from user-dirs.dirs ("$HOME/…" or an absolute path), if set. */
export function parseUserDirsTemplates(text: string, home: string): string | undefined {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    const m = /^XDG_TEMPLATES_DIR\s*=\s*"(.*)"\s*$/.exec(line);
    if (!m) continue;
    const v = m[1]!.replace(/\\"/g, '"');
    if (v.startsWith('$HOME')) return path.join(home, v.slice(5));
    if (path.isAbsolute(v)) return v;
  }
  return undefined;
}

async function isDir(p: string): Promise<boolean> {
  return (await fsp.stat(p).catch(() => undefined))?.isDirectory() ?? false;
}

/**
 * The templates folder in use. `configured` (an absolute path) wins; it is
 * reported, not replaced, when it does not exist. Otherwise, on Linux only,
 * the XDG templates folder is used when it exists and is not the home folder
 * itself (which is how XDG marks it as disabled).
 */
export async function resolveTemplatesFolder(configured: string, opts: { platform?: NodeJS.Platform; home?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ folder?: string; source: TemplatesListing['source']; note?: string }> {
  const platform = opts.platform ?? process.platform;
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  if (configured) {
    if (!path.isAbsolute(configured)) return { source: 'none', note: 'The templates folder in Settings is not an absolute path.' };
    if (!(await isDir(configured))) return { source: 'none', note: `The templates folder ${configured} does not exist.` };
    return { folder: path.resolve(configured), source: 'setting' };
  }
  if (platform !== 'linux') return { source: 'none', note: 'No templates folder is set. Choose one in Settings → Your data.' };
  const configHome = env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config');
  const userDirs = await fsp.readFile(path.join(configHome, 'user-dirs.dirs'), 'utf8').catch(() => '');
  const xdg = parseUserDirsTemplates(userDirs, home);
  const candidate = xdg ?? path.join(home, 'Templates');
  if (path.resolve(candidate) === path.resolve(home)) return { source: 'none', note: 'The desktop’s templates folder is turned off (it points to your home folder). Choose a folder in Settings → Your data.' };
  if (!(await isDir(candidate))) return { source: 'none', note: `There is no templates folder (${candidate} does not exist). Create it or choose one in Settings → Your data.` };
  return { folder: path.resolve(candidate), source: 'xdg' };
}

/** Regular files (or links to regular files) directly in the folder, not hidden, sorted by name. */
export async function listTemplates(folder: string): Promise<{ templates: TemplateInfo[]; skipped: number }> {
  const dir = requireAbsolute(folder, 'templates.list');
  const names = await fsp.readdir(dir).catch((err) => {
    throw new OrbisError(toOrbisError(err, 'templates.list', dir, 'no'));
  });
  const out: TemplateInfo[] = [];
  let skipped = 0;
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    if (name.startsWith('.')) continue;
    const p = path.join(dir, name);
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st?.isFile()) continue; // folders and broken links are not templates
    if (st.size > MAX_TEMPLATE_BYTES || out.length >= MAX_TEMPLATES) {
      skipped++;
      continue;
    }
    out.push({ name, path: p, size: st.size, ext: extOf(name) });
  }
  return { templates: out, skipped };
}

export async function templatesListing(configured: string, opts: Parameters<typeof resolveTemplatesFolder>[1] = {}): Promise<TemplatesListing> {
  const r = await resolveTemplatesFolder(configured, opts);
  if (!r.folder) return { source: r.source, note: r.note, templates: [] };
  const { templates, skipped } = await listTemplates(r.folder);
  return { folder: r.folder, source: r.source, templates, note: skipped ? `${skipped} file(s) were not listed (over 100 MB, or more than ${MAX_TEMPLATES} templates).` : r.note };
}

/**
 * Create `name` in `parent` as a copy of `template`, which must be a file
 * directly inside the templates folder in use. Fails if the name exists.
 */
export async function createFromTemplate(parent: string, name: string, template: string, folder: string | undefined): Promise<FileEntry> {
  const op = 'fs.createFromTemplate';
  if (!folder) throw makeError('not_found', op, { message: 'No templates folder is available.' });
  const tpl = requireAbsolute(template, op);
  if (path.dirname(tpl) !== path.resolve(folder)) throw makeError('permission_denied', op, { message: 'Templates are only copied from the templates folder.', target: tpl });
  const st = await fsp.stat(tpl).catch((err) => {
    throw new OrbisError(toOrbisError(err, op, tpl, 'no'));
  });
  if (!st.isFile()) throw makeError('validation', op, { message: 'This template is not a file.', target: tpl });
  if (st.size > MAX_TEMPLATE_BYTES) throw makeError('validation', op, { message: 'This template is larger than 100 MB.', target: tpl });
  const target = childPath(requireAbsolute(parent, op), name, op);
  try {
    // COPYFILE_EXCL: fails with EEXIST instead of replacing an existing file.
    await fsp.copyFile(tpl, target, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    throw new OrbisError(toOrbisError(err, op, target, 'no'));
  }
  return entryFor(target);
}
