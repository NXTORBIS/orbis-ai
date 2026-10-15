import fsp from 'node:fs/promises';
import path from 'node:path';
import { readHead } from './FileSystemService';

/**
 * Opening some files runs code. Detection uses content and permissions as well
 * as the extension, so a renamed program is still caught.
 */
const EXECUTABLE_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'cpl', 'lnk', 'reg',
  'sh', 'bash', 'zsh', 'command', 'run', 'bin', 'appimage', 'app', 'pkg', 'dmg', 'deb', 'rpm', 'jar', 'py', 'pl', 'rb', 'desktop',
]);

/** Determine whether opening a file may run code. Uses content and permissions, not only the extension. */
export async function executableReason(p: string): Promise<string | undefined> {
  const st = await fsp.stat(p);
  if (!st.isFile()) return undefined;
  const ext = path.extname(p).slice(1).toLowerCase();
  if (EXECUTABLE_EXT.has(ext)) return `".${ext}" files can run programs or scripts.`;
  try {
    const head = await readHead(p, 4);
    if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'This file is a Linux program (ELF).';
    if (head[0] === 0x4d && head[1] === 0x5a) return 'This file is a Windows program.';
    if (head[0] === 0x23 && head[1] === 0x21) return 'This file is a script (starts with "#!").';
    const mac = head.readUInt32BE(0);
    if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(mac)) return 'This file is a macOS program.';
  } catch {
    /* unreadable: fall through */
  }
  if (process.platform !== 'win32' && (st.mode & 0o111) !== 0) return 'This file is marked as executable.';
  return undefined;
}

