import { z } from 'zod';

/**
 * Built-in terminal: limits, IPC payload schemas and the pure helpers shared by
 * the main process and the window (shell quoting, cd commands, /proc and lsof
 * parsing, link checks). Nothing here touches the file system or a process.
 */

/** Terminal size limits (columns × rows) accepted from the window. */
export const TERM_COLS_MIN = 2;
export const TERM_COLS_MAX = 1000;
export const TERM_ROWS_MIN = 1;
export const TERM_ROWS_MAX = 500;
/** Largest single write from the window (characters). Larger pastes are sent in parts. */
export const TERM_WRITE_MAX = 256 * 1024;
/** Most sessions one window may have open at once. */
export const TERM_SESSIONS_MAX = 16;
/** Scrollback lines the setting accepts. */
export const TERM_SCROLLBACK_MIN = 100;
export const TERM_SCROLLBACK_MAX = 100_000;
/** Longest web link opened from terminal output. */
export const TERM_LINK_MAX = 2048;

/**
 * Flow control. Output is batched in the main process (at most every BATCH_MS or
 * BATCH_MAX characters) and the window acknowledges what xterm.js has parsed.
 * When more than HIGH_WATER characters are unacknowledged the PTY is paused (the
 * program blocks on its next write); it resumes below LOW_WATER.
 */
export const TERM_BATCH_MS = 8;
export const TERM_BATCH_MAX = 64 * 1024;
export const TERM_HIGH_WATER = 512 * 1024;
export const TERM_LOW_WATER = 128 * 1024;

export const TermIdSchema = z.string().regex(/^t[0-9a-f]{16}$/, 'Not a terminal session id.');
const cols = z.number().int().min(TERM_COLS_MIN).max(TERM_COLS_MAX);
const rows = z.number().int().min(TERM_ROWS_MIN).max(TERM_ROWS_MAX);

export const TermCreateSchema = z.object({
  /** Folder the shell starts in (absolute, checked in the main process; home when missing). */
  cwd: z.string().min(1).max(32767).optional(),
  cols,
  rows,
});
export const TermWriteSchema = z.object({ id: TermIdSchema, data: z.string().min(1).max(TERM_WRITE_MAX) });
export const TermResizeSchema = z.object({ id: TermIdSchema, cols, rows });
export const TermAckSchema = z.object({ id: TermIdSchema, chars: z.number().int().min(1).max(64 * 1024 * 1024) });
export const TermLinkSchema = z.object({ url: z.string().min(1).max(TERM_LINK_MAX) });

/** How a shell reads quotes. */
export type ShellFlavor = 'posix' | 'fish' | 'powershell' | 'cmd';

/** A shell Orbis Files can start (detected on this system, or the custom one from Settings). */
export interface ShellInfo {
  /** Stable id for Settings: "auto", "custom" or the absolute path. */
  id: string;
  label: string;
  path: string;
  args: string[];
  flavor: ShellFlavor;
  /** Where it was found ("$SHELL", "PATH", "ComSpec", "Settings"). */
  source: string;
}

/** What the window knows about one of its sessions. */
export interface TermSessionInfo {
  id: string;
  pid: number;
  shell: string;
  shellPath: string;
  flavor: ShellFlavor;
  /** Folder the session started in. */
  startCwd: string;
  /** Set when the requested folder could not be used. */
  startNote?: string;
  createdMs: number;
  exited?: { exitCode: number; signal?: number };
}

/**
 * What runs in a session. `busy` is true when a program other than the shell has
 * the terminal (the foreground process group differs from the shell's), false
 * when the shell itself is in the foreground, null when this platform cannot tell.
 */
export interface TermStatus {
  id: string;
  exited: boolean;
  busy: boolean | null;
  /** Name of the foreground program when busy. */
  program?: string;
  /** Linux: the shell process's own state letter from /proc (R running, S sleeping…). */
  shellState?: string;
  /** Child processes of the shell (Linux, macOS); undefined when unknown. */
  children?: number;
  how: 'proc' | 'pty-process' | 'unavailable';
}

/** The shell's current folder, or why it cannot be read. */
export type TermCwd = { ok: true; path: string; how: 'proc' | 'lsof' } | { ok: false; reason: string };

/** "bash", "pwsh", "cmd" from a shell's path (Windows or POSIX separators, .exe dropped). */
export function shellName(shellPath: string): string {
  const base = shellPath.split(/[\\/]/).pop() ?? shellPath;
  return base.replace(/\.(exe|com|bat|cmd)$/i, '') || shellPath;
}

/** The quoting rules of a shell, decided by its program name. */
export function shellFlavorOf(shellPath: string): ShellFlavor {
  const n = shellName(shellPath).toLowerCase();
  if (n === 'fish') return 'fish';
  if (n === 'pwsh' || n === 'powershell' || n === 'pwsh-preview') return 'powershell';
  if (n === 'cmd') return 'cmd';
  return 'posix';
}

export class QuoteError extends Error {}

/** Characters PowerShell treats as a single quote (ASCII and the typographic ones). */
const PS_SINGLE_QUOTES = /['‘’‚‛]/g;

/**
 * Quote a string so the shell reads it as one literal word: nothing inside is
 * expanded (no variables, globs, history or command substitution).
 *
 * - POSIX (sh, bash, zsh, dash, ksh): '…' with ' written as '\''. Everything,
 *   including newlines and backslashes, is literal inside single quotes.
 * - fish: '…' where only \\ and \' are escapes inside single quotes, so both are escaped.
 * - PowerShell: '…' with every single quote (also ‘ ’ ‚ ‛, which PowerShell accepts
 *   as quotes) doubled; $ and ` are literal inside single quotes.
 * - cmd.exe: "…"; a " cannot be written inside and a line break cannot be passed
 *   at all (QuoteError). % is taken out of the quotes as ^% so %NAME% is not
 *   expanded at the interactive prompt ("a"^%"b"^%"" reads as a%b%).
 */
export function quoteForShell(s: string, flavor: ShellFlavor): string {
  if (s.includes('\0')) throw new QuoteError('A null character cannot be passed to a shell.');
  switch (flavor) {
    case 'posix':
      return `'${s.replace(/'/g, `'\\''`)}'`;
    case 'fish':
      return `'${s.replace(/[\\']/g, (c) => `\\${c}`)}'`;
    case 'powershell':
      return `'${s.replace(PS_SINGLE_QUOTES, (c) => c + c)}'`;
    case 'cmd': {
      if (/[\r\n]/.test(s)) throw new QuoteError('cmd.exe cannot take a line break inside an argument.');
      if (s.includes('"')) throw new QuoteError('cmd.exe cannot take a double quote inside a quoted argument.');
      return `"${s.replace(/%/g, '"^%"')}"`;
    }
  }
}

/** Paths for dropping onto a terminal: each quoted, separated by spaces, with a trailing space. */
export function quotePaths(paths: string[], flavor: ShellFlavor): string {
  return `${paths.map((p) => quoteForShell(p, flavor)).join(' ')} `;
}

/** The command that changes the shell's folder (without the final Enter). */
export function cdCommand(dir: string, flavor: ShellFlavor): string {
  switch (flavor) {
    case 'powershell':
      return `Set-Location -LiteralPath ${quoteForShell(dir, flavor)}`;
    case 'cmd':
      return `cd /d ${quoteForShell(dir, flavor)}`;
    case 'fish':
      return `cd ${quoteForShell(dir, flavor)}`;
    default:
      // An absolute path never starts with "-", but "--" also stops option parsing in every POSIX cd.
      return `cd -- ${quoteForShell(dir, flavor)}`;
  }
}

/**
 * Keys that empty the shell's command line before a command is typed into it:
 * Ctrl+E Ctrl+U for readline-style editors (bash, zsh, fish and PowerShell's
 * Emacs mode; bash and zsh keep the text, Ctrl+Y brings it back), Escape for cmd.exe
 * and PowerShell's Windows mode.
 */
export function clearLineKeys(flavor: ShellFlavor, platform: string): string {
  if (flavor === 'cmd') return '\x1b';
  if (flavor === 'powershell' && platform === 'win32') return '\x1b';
  return '\x05\x15';
}

/** A web link that may be opened from terminal output: http(s) only, no credentials, bounded length. */
export function safeWebLink(raw: string): string | undefined {
  if (raw.length > TERM_LINK_MAX) return undefined;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  if (u.username || u.password) return undefined;
  if (!u.hostname) return undefined;
  return u.href;
}

/** Fields of /proc/<pid>/stat that the terminal uses. */
export interface ProcStat {
  pid: number;
  comm: string;
  state: string;
  ppid: number;
  pgrp: number;
  session: number;
  ttyNr: number;
  /** Foreground process group of the process's controlling terminal (-1 when none). */
  tpgid: number;
}

/**
 * Parse /proc/<pid>/stat. The command name is in parentheses and may itself
 * contain spaces and parentheses, so fields are counted after the last ')'.
 */
export function parseProcStat(text: string): ProcStat | undefined {
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open < 0 || close < open) return undefined;
  const pid = Number(text.slice(0, open).trim());
  const rest = text.slice(close + 1).trim().split(/\s+/);
  // rest: state ppid pgrp session tty_nr tpgid …
  if (rest.length < 6 || !Number.isInteger(pid)) return undefined;
  const n = (i: number) => Number(rest[i]);
  const st: ProcStat = { pid, comm: text.slice(open + 1, close), state: rest[0]!, ppid: n(1), pgrp: n(2), session: n(3), ttyNr: n(4), tpgid: n(5) };
  return [st.ppid, st.pgrp, st.session, st.ttyNr, st.tpgid].every(Number.isInteger) ? st : undefined;
}

/** The folder from `lsof -a -d cwd -p <pid> -Fn` output (the line starting with "n"). */
export function parseLsofCwd(out: string): string | undefined {
  for (const line of out.split('\n')) if (line.startsWith('n/')) return line.slice(1);
  return undefined;
}

/** Text that would run more than one line when pasted (any line break that is not the very end). */
export function isMultiline(text: string): boolean {
  return /[\r\n]/.test(text.replace(/(\r\n|\r|\n)$/, ''));
}

/** Last folder name of a path for tab titles ("~" for the home folder, "/" for the root). */
export function folderLabel(dir: string, home?: string): string {
  if (home && dir.replace(/[\\/]+$/, '') === home.replace(/[\\/]+$/, '')) return '~';
  const trimmed = dir.length > 1 ? dir.replace(/[\\/]+$/, '') : dir;
  if (/^[A-Za-z]:$/.test(trimmed)) return `${trimmed}\\`;
  return trimmed.split(/[\\/]/).pop() || trimmed || '/';
}

/**
 * The environment a terminal session gets: the user's own environment without
 * variables that belong to Electron or Orbis Files (ELECTRON_*, which would make
 * an Electron-based program started from the shell behave like Node; ORBIS_*,
 * which can carry test or integration secrets; NODE_CHANNEL_FD / NODE_UNIQUE_ID,
 * Node's IPC channel), with the desktop name Electron replaced restored and the
 * usual terminal identification set.
 */
export function terminalEnv(base: Record<string, string | undefined>, extra: { termProgramVersion?: string; platform?: string } = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    const up = k.toUpperCase();
    if (up.startsWith('ELECTRON_') || up.startsWith('ORBIS_')) continue;
    if (up === 'NODE_CHANNEL_FD' || up === 'NODE_UNIQUE_ID' || up === 'NODE_CHANNEL_SERIALIZATION_MODE' || up === 'CHROME_DESKTOP' || up === 'GOOGLE_API_KEY') continue;
    out[k] = v;
  }
  // Electron sets XDG_CURRENT_DESKTOP for itself on some desktops and keeps the real value here.
  if (out.ORIGINAL_XDG_CURRENT_DESKTOP !== undefined) {
    out.XDG_CURRENT_DESKTOP = out.ORIGINAL_XDG_CURRENT_DESKTOP;
    delete out.ORIGINAL_XDG_CURRENT_DESKTOP;
  }
  if (extra.platform !== 'win32') {
    out.TERM = 'xterm-256color';
    out.COLORTERM = 'truecolor';
    // xterm.js speaks UTF-8; without any locale variable shells fall back to "C" and show non-ASCII names as M-… bytes.
    if (!out.LC_ALL && !out.LC_CTYPE && !out.LANG) out.LANG = extra.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  }
  out.TERM_PROGRAM = 'OrbisFiles';
  if (extra.termProgramVersion) out.TERM_PROGRAM_VERSION = extra.termProgramVersion;
  return out;
}

/** Custom shell arguments from Settings, split like a command line (quotes kept together, nothing expanded). */
export function splitShellArgs(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(cur);
      cur = '';
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (quote) throw new QuoteError(`A ${quote === '"' ? 'double' : 'single'} quote is not closed.`);
  if (inWord) out.push(cur);
  return out;
}
