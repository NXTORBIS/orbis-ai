import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Platform shortcut files that point at another item:
 *  - Windows `.lnk` shell links (read with the OS API, injected so this module stays testable);
 *  - freedesktop `.desktop` entries of `Type=Link` with a `file://` URL.
 * macOS aliases need Finder APIs Electron does not expose and are shown as ordinary files.
 * Resolution only reads; nothing is followed automatically during recursive work.
 */
export interface ShortcutInfo {
  kind: 'windows-shortcut' | 'desktop-link';
  target: string;
  targetKind: 'file' | 'directory' | 'missing';
  name?: string;
}

export type LnkReader = (p: string) => { target: string } | undefined;

export function parseDesktopLink(text: string): { url: string; name?: string } | undefined {
  let section = '';
  const kv: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1]!;
      continue;
    }
    if (section !== 'Desktop Entry') continue;
    const i = line.indexOf('=');
    if (i > 0) kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (kv.Type !== 'Link' || !kv.URL) return undefined;
  return { url: kv.URL, name: kv.Name };
}

export async function resolveShortcut(p: string, readLnk?: LnkReader): Promise<ShortcutInfo | undefined> {
  const ext = path.extname(p).toLowerCase();
  let target: string | undefined;
  let kind: ShortcutInfo['kind'];
  let name: string | undefined;
  if (ext === '.lnk' && readLnk) {
    kind = 'windows-shortcut';
    try {
      target = readLnk(p)?.target;
    } catch {
      return undefined;
    }
  } else if (ext === '.desktop') {
    kind = 'desktop-link';
    const st = await fsp.stat(p).catch(() => undefined);
    if (!st?.isFile() || st.size > 64 * 1024) return undefined;
    const link = parseDesktopLink(await fsp.readFile(p, 'utf8'));
    if (!link || !/^file:\/\//i.test(link.url)) return undefined;
    try {
      target = fileURLToPath(link.url);
    } catch {
      return undefined;
    }
    name = link.name;
  } else return undefined;
  if (!target || !path.isAbsolute(target)) return undefined;
  const st = await fsp.stat(target).catch(() => undefined);
  return { kind, target, name, targetKind: !st ? 'missing' : st.isDirectory() ? 'directory' : 'file' };
}
