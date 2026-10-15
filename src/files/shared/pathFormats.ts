/**
 * Ways of writing a path for "Copy path as…". Pure string functions; no
 * filesystem access. Paths given here are absolute paths of the platform
 * Orbis Files runs on (POSIX `/…`, or Windows `C:\…` / `\\server\share\…`).
 */

export type PathFormat = 'absolute' | 'relative' | 'posix' | 'windows' | 'quoted' | 'uri' | 'name';

/** Whether a path is written the Windows way (drive letter or UNC). */
export function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(p) || /^\\\\[^\\]/.test(p);
}

/** A file:// URI for a local path (Windows drive paths get a leading slash; UNC paths use the host; each segment is percent-encoded). */
export function fileUri(p: string): string {
  if (/^\\\\[^\\]/.test(p)) {
    const [host, ...rest] = p.slice(2).split('\\');
    return `file://${host}/${rest.map((s) => encodeURIComponent(s)).join('/')}`;
  }
  const posix = isWindowsPath(p) ? p.replace(/\\/g, '/') : p;
  const withRoot = /^[A-Za-z]:\//.test(posix) ? `/${posix}` : posix;
  return `file://${withRoot.split('/').map((seg, i) => (i === 1 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/')}`;
}

/**
 * The path with forward slashes. A POSIX path is returned unchanged: on Linux
 * and macOS a backslash is an ordinary character in a file name, not a separator.
 */
export function toPosixStyle(p: string): string {
  return isWindowsPath(p) ? p.replace(/\\/g, '/') : p;
}

/** The path with backslashes (forward slashes become backslashes). */
export function toWindowsStyle(p: string): string {
  return p.replace(/\//g, '\\');
}

/**
 * `target` relative to the folder `base`, with the separator of the paths
 * ("." for the folder itself, "../x" for items outside it). Returns undefined
 * when there is no relative path (different drives or roots).
 */
export function relativePath(base: string, target: string): string | undefined {
  const win = isWindowsPath(base) || isWindowsPath(target);
  const sep = win ? '\\' : '/';
  const split = (p: string) => (win ? p.split(/[\\/]/) : p.split('/')).filter((s, i) => s !== '' || i === 0);
  const a = split(base.length > 1 ? base.replace(win ? /[\\/]+$/ : /\/+$/, '') : base);
  const b = split(target.length > 1 ? target.replace(win ? /[\\/]+$/ : /\/+$/, '') : target);
  const same = (x: string, y: string) => (win ? x.toLowerCase() === y.toLowerCase() : x === y);
  if (!a.length || !b.length || !same(a[0]!, b[0]!)) return undefined;
  let i = 0;
  while (i < a.length && i < b.length && same(a[i]!, b[i]!)) i++;
  const up = a.slice(i).filter(Boolean).map(() => '..');
  const down = b.slice(i).filter(Boolean);
  const parts = [...up, ...down];
  return parts.length ? parts.join(sep) : '.';
}

/**
 * Quote a path for a shell command line so it is passed as one literal
 * argument: POSIX shells (sh, bash, zsh) use single quotes ('it'\''s');
 * PowerShell uses single quotes with '' for a quote. Nothing inside is expanded.
 */
export function shellQuote(p: string, flavor: 'posix' | 'powershell'): string {
  if (flavor === 'powershell') return `'${p.replace(/'/g, "''")}'`;
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

/** The shell flavour used for "quoted for shell" on a platform. */
export function shellFlavor(platform: string): 'posix' | 'powershell' {
  return platform === 'win32' ? 'powershell' : 'posix';
}

export function baseName(p: string): string {
  const trimmed = p.length > 1 ? p.replace(isWindowsPath(p) ? /[\\/]+$/ : /\/+$/, '') : p;
  const parts = isWindowsPath(trimmed) ? trimmed.split(/[\\/]/) : trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

/**
 * Text for "Copy path as…" for one or more paths. Several paths are joined
 * with new lines, except quoted paths, which are joined with spaces so they
 * can be pasted as arguments of one command.
 */
export function formatPaths(paths: string[], format: PathFormat, opts: { base?: string; platform?: string } = {}): string {
  const one = (p: string): string => {
    switch (format) {
      case 'absolute': return p;
      case 'relative': {
        if (!opts.base) throw new Error('A base folder is needed for relative paths.');
        return relativePath(opts.base, p) ?? p;
      }
      case 'posix': return toPosixStyle(p);
      case 'windows': return toWindowsStyle(p);
      case 'quoted': return shellQuote(p, shellFlavor(opts.platform ?? 'linux'));
      case 'uri': return fileUri(p);
      case 'name': return baseName(p);
    }
  };
  return paths.map(one).join(format === 'quoted' ? ' ' : '\n');
}

/** Name for "Compress to .zip": the item's name (without its extension for files), or "Archive.zip" for several items. */
export function quickZipName(items: Array<{ name: string; isDir: boolean }>): string {
  if (items.length !== 1) return 'Archive.zip';
  const { name, isDir } = items[0]!;
  const dot = name.lastIndexOf('.');
  const stem = !isDir && dot > 0 ? name.slice(0, dot) : name;
  return `${stem || 'Archive'}.zip`;
}
