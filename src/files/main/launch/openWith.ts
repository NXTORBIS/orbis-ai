import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeError } from '../../shared/errors';

/**
 * "Open with" support.
 *
 * Linux: real freedesktop.org data — application .desktop entries from the
 * XDG data directories, MIME types from shared-mime-info (globs2, subclasses),
 * and the user's default from mimeapps.list / xdg-mime. Applications are
 * launched by expanding their Exec line into an argument vector and starting
 * the program directly, never through a shell.
 *
 * macOS: applications declaring the file's extension in their Info.plist,
 * launched with `open -a`. Windows: the system "Open with" chooser.
 * The macOS and Windows paths are implemented but have not been run.
 */

export interface AppChoice {
  id: string;
  name: string;
  isDefault: boolean;
  /** Short note, e.g. why a choice is limited. */
  note?: string;
}

export interface OpenWithInfo {
  mime?: string;
  apps: AppChoice[];
  note?: string;
}

interface DesktopEntry {
  id: string;
  file: string;
  name: string;
  exec: string;
  mimeTypes: string[];
  terminal: boolean;
  icon?: string;
}

export function xdgDataDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const home = env.HOME ?? os.homedir();
  const user = env.XDG_DATA_HOME || path.join(home, '.local/share');
  const system = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  const extra = [path.join(home, '.local/share/flatpak/exports/share'), '/var/lib/flatpak/exports/share', '/var/lib/snapd/desktop'];
  return [...new Set([user, ...system, ...extra])];
}

/** Parse the [Desktop Entry] group of a .desktop file. */
export function parseDesktopEntry(text: string, id: string, file: string): DesktopEntry | undefined {
  const kv = new Map<string, string>();
  let inGroup = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      inGroup = line === '[Desktop Entry]';
      continue;
    }
    if (!inGroup) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!kv.has(key)) kv.set(key, line.slice(eq + 1).trim());
  }
  if (kv.get('Type') !== 'Application' || kv.get('Hidden') === 'true' || kv.get('NoDisplay') === 'true') return undefined;
  const exec = kv.get('Exec');
  const name = kv.get('Name');
  if (!exec || !name) return undefined;
  const tryExec = kv.get('TryExec');
  if (tryExec && !findExecutable(unescapeValue(tryExec))) return undefined;
  return {
    id,
    file,
    name: unescapeValue(name),
    exec,
    mimeTypes: (kv.get('MimeType') ?? '').split(';').map((m) => m.trim()).filter(Boolean),
    terminal: kv.get('Terminal') === 'true',
    icon: kv.get('Icon'),
  };
}

function unescapeValue(v: string): string {
  return v.replace(/\\(.)/g, (_, c: string) => ({ s: ' ', n: '\n', t: '\t', r: '\r', '\\': '\\' } as Record<string, string>)[c] ?? `\\${c}`);
}

export function findExecutable(cmd: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (path.isAbsolute(cmd)) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      return cmd;
    } catch {
      return undefined;
    }
  }
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

/**
 * Split an Exec value into arguments following the Desktop Entry
 * specification (double-quoted arguments with \" \` \$ \\ escapes), then
 * expand field codes for one file. Returns undefined for malformed lines.
 */
export function expandExec(entry: Pick<DesktopEntry, 'exec' | 'name' | 'icon' | 'file'>, target: string): string[] | undefined {
  const value = unescapeValue(entry.exec);
  const args: string[] = [];
  let cur = '';
  let inQuote = false;
  let started = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (inQuote) {
      if (ch === '\\' && i + 1 < value.length && '"`$\\'.includes(value[i + 1]!)) {
        cur += value[++i];
      } else if (ch === '"') inQuote = false;
      else cur += ch;
    } else if (ch === '"') {
      inQuote = true;
      started = true;
    } else if (ch === ' ' || ch === '\t') {
      if (started || cur) args.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (inQuote) return undefined;
  if (started || cur) args.push(cur);
  if (!args.length) return undefined;
  const uri = `file://${target.split('/').map(encodeURIComponent).join('/')}`;
  const out: string[] = [];
  let used = false;
  for (const a of args) {
    if (a === '%f' || a === '%F') {
      out.push(target);
      used = true;
    } else if (a === '%u' || a === '%U') {
      out.push(uri);
      used = true;
    } else if (a === '%i') {
      if (entry.icon) out.push('--icon', entry.icon);
    } else if (['%d', '%D', '%n', '%N', '%v', '%m'].includes(a)) {
      /* deprecated field codes are removed */
    } else {
      const replaced = a.replace(/%([fFuUck%])/g, (_, c: string) => {
        if (c === '%') return '%';
        if (c === 'c') return entry.name;
        if (c === 'k') return entry.file;
        used = true;
        return c === 'u' || c === 'U' ? uri : target;
      });
      out.push(replaced);
    }
  }
  if (!used) out.push(target);
  return out;
}

async function loadEntries(dirs: string[]): Promise<Map<string, DesktopEntry>> {
  const entries = new Map<string, DesktopEntry>();
  for (const base of dirs) {
    const appsDir = path.join(base, 'applications');
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      const items = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const it of items) {
        const p = path.join(dir, it.name);
        if (it.isDirectory()) await walk(p, `${prefix}${it.name}-`, depth + 1);
        else if (it.name.endsWith('.desktop')) {
          const id = `${prefix}${it.name}`;
          if (entries.has(id)) continue; // earlier data dirs take precedence
          const text = await fsp.readFile(p, 'utf8').catch(() => '');
          const e = text.length < 512 * 1024 ? parseDesktopEntry(text, id, p) : undefined;
          if (e) entries.set(id, e);
          else entries.set(id, { id, file: p, name: '', exec: '', mimeTypes: [], terminal: false }); // shadowed/hidden
        }
      }
    };
    await walk(appsDir, '', 0);
  }
  for (const [id, e] of entries) if (!e.exec) entries.delete(id);
  return entries;
}

interface MimeDb { globs: Array<{ weight: number; mime: string; glob: string; cs: boolean }>; parents: Map<string, string[]> }

async function loadMimeDb(dirs: string[]): Promise<MimeDb> {
  const db: MimeDb = { globs: [], parents: new Map() };
  for (const base of [...dirs].reverse()) {
    const globs = await fsp.readFile(path.join(base, 'mime/globs2'), 'utf8').catch(() => '');
    for (const line of globs.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [w, mime, glob, flags] = line.split(':');
      if (mime && glob) db.globs.push({ weight: Number(w) || 50, mime, glob, cs: (flags ?? '').includes('cs') });
    }
    const subs = await fsp.readFile(path.join(base, 'mime/subclasses'), 'utf8').catch(() => '');
    for (const line of subs.split('\n')) {
      const [child, parent] = line.trim().split(/\s+/);
      if (child && parent) db.parents.set(child, [...(db.parents.get(child) ?? []), parent]);
    }
  }
  db.globs.sort((a, b) => b.weight - a.weight || b.glob.length - a.glob.length);
  return db;
}

function globToRegex(glob: string, cs: boolean): RegExp {
  const src = glob.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${src}$`, cs ? '' : 'i');
}

export function mimeForName(db: MimeDb, name: string): string | undefined {
  for (const g of db.globs) if (globToRegex(g.glob, g.cs).test(name)) return g.mime;
  return undefined;
}

function mimeChain(db: MimeDb, mime: string): string[] {
  const out: string[] = [];
  const queue = [mime];
  while (queue.length && out.length < 20) {
    const m = queue.shift()!;
    if (out.includes(m)) continue;
    out.push(m);
    queue.push(...(db.parents.get(m) ?? []));
    if (m.startsWith('text/') && m !== 'text/plain') queue.push('text/plain');
  }
  return out;
}

async function defaultAppFor(mime: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const home = env.HOME ?? os.homedir();
  const configs = [env.XDG_CONFIG_HOME || path.join(home, '.config'), ...(env.XDG_CONFIG_DIRS || '/etc/xdg').split(':'), path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'applications')];
  for (const dir of configs) {
    const text = await fsp.readFile(path.join(dir, 'mimeapps.list'), 'utf8').catch(() => '');
    let inDefaults = false;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) inDefaults = line === '[Default Applications]';
      else if (inDefaults && line.startsWith(`${mime}=`)) {
        const first = line.slice(mime.length + 1).split(';').find(Boolean);
        if (first) return first.trim();
      }
    }
  }
  return undefined;
}

export async function listOpenWith(target: string, sniffedMime: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<OpenWithInfo> {
  if (process.platform === 'win32') {
    return { apps: [{ id: 'windows:openas', name: 'Choose an app…', isDefault: false, note: 'Opens the Windows "Open with" chooser.' }], note: 'Windows chooses the application in its own dialog.' };
  }
  if (process.platform === 'darwin') return listMacApps(target);
  const dirs = xdgDataDirs(env);
  const [entries, db] = await Promise.all([loadEntries(dirs), loadMimeDb(dirs)]);
  const isDir = (await fsp.stat(target).catch(() => undefined))?.isDirectory();
  const mime = isDir ? 'inode/directory' : mimeForName(db, path.basename(target)) ?? sniffedMime ?? 'application/octet-stream';
  const chain = mimeChain(db, mime);
  const def = await defaultAppFor(mime, env);
  const apps: AppChoice[] = [];
  for (const e of entries.values()) {
    if (e.terminal) continue;
    if (!e.mimeTypes.some((m) => chain.includes(m))) continue;
    const argv = expandExec(e, target);
    if (!argv || !findExecutable(argv[0]!, env)) continue;
    apps.push({ id: e.id, name: e.name, isDefault: e.id === def });
  }
  apps.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
  return { mime, apps, note: apps.length ? undefined : 'No installed application declares support for this type of file.' };
}

export async function launchWith(target: string, appId: string, sniffedMime: string | undefined, env: NodeJS.ProcessEnv = process.env): Promise<{ app: string; pid?: number }> {
  if (process.platform === 'win32') {
    if (appId !== 'windows:openas') throw makeError('validation', 'fs.openWith', { message: 'Unknown application.' });
    const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', target], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return { app: 'Windows chooser', pid: child.pid };
  }
  const info = await listOpenWith(target, sniffedMime, env);
  const choice = info.apps.find((a) => a.id === appId);
  if (!choice) throw makeError('validation', 'fs.openWith', { message: 'That application is not available for this file.' });
  if (process.platform === 'darwin') {
    await new Promise<void>((resolve, reject) => execFile('open', ['-a', appId, target], (err) => (err ? reject(makeError('io', 'fs.openWith', { message: `The application could not be started: ${err.message}` })) : resolve())));
    return { app: choice.name };
  }
  const entries = await loadEntries(xdgDataDirs(env));
  const entry = entries.get(appId)!;
  const argv = expandExec(entry, target)!;
  const exe = findExecutable(argv[0]!, env)!;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, argv.slice(1), { detached: true, stdio: 'ignore', env });
    child.once('error', (err) => reject(makeError('io', 'fs.openWith', { message: `${choice.name} could not be started: ${err.message}` })));
    child.once('spawn', () => {
      child.unref();
      resolve({ app: choice.name, pid: child.pid });
    });
  });
}

/* ------------------------------------------------------------------ macOS (not run in this environment) */

async function listMacApps(target: string): Promise<OpenWithInfo> {
  const ext = path.extname(target).slice(1).toLowerCase();
  const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
  const apps: AppChoice[] = [];
  for (const r of roots) {
    for (const name of await fsp.readdir(r).catch(() => [] as string[])) {
      if (!name.endsWith('.app')) continue;
      const plist = path.join(r, name, 'Contents/Info.plist');
      try {
        const json = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8', timeout: 2000 })) as { CFBundleDocumentTypes?: Array<{ CFBundleTypeExtensions?: string[]; LSItemContentTypes?: string[] }> };
        const ok = (json.CFBundleDocumentTypes ?? []).some((t) => (t.CFBundleTypeExtensions ?? []).map((x) => x.toLowerCase()).includes(ext) || (t.CFBundleTypeExtensions ?? []).includes('*') || (t.LSItemContentTypes ?? []).includes('public.data'));
        if (ok) apps.push({ id: path.join(r, name), name: name.replace(/\.app$/, ''), isDefault: false });
      } catch {
        /* unreadable bundle */
      }
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return { apps, note: apps.length ? undefined : 'No application declares support for this extension.' };
}
