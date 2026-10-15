import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { findOnPath } from '../launch/terminal';
import { makeError } from '../../shared/errors';
import { QuoteError, shellFlavorOf, shellName, splitShellArgs, type ShellInfo } from '../../shared/terminal';

/**
 * Shells the built-in terminal can start. Only programs that exist are listed:
 * on Linux and macOS $SHELL first, then bash, zsh, fish and sh from PATH; on
 * Windows PowerShell 7 (pwsh), Windows PowerShell and cmd.exe (ComSpec).
 */

const POSIX_CANDIDATES = ['bash', 'zsh', 'fish', 'sh'];
const LABEL: Record<string, string> = { bash: 'Bash', zsh: 'Zsh', fish: 'fish', sh: 'sh', dash: 'Dash', ksh: 'KornShell', tcsh: 'tcsh', pwsh: 'PowerShell 7', powershell: 'Windows PowerShell', cmd: 'Command Prompt' };

function labelOf(p: string): string {
  const n = shellName(p);
  return LABEL[n.toLowerCase()] ?? n;
}

/** Arguments a shell gets by default: login shells on macOS (like Terminal.app), none elsewhere. */
function defaultArgs(p: string, platform: NodeJS.Platform): string[] {
  const n = shellName(p).toLowerCase();
  if (platform === 'darwin' && ['bash', 'zsh', 'fish', 'sh', 'ksh'].includes(n)) return ['-l'];
  if (n === 'pwsh' || n === 'powershell') return ['-NoLogo'];
  return [];
}

async function isExecutableFile(p: string, platform: NodeJS.Platform): Promise<boolean> {
  const st = await fsp.stat(p).catch(() => undefined);
  if (!st?.isFile()) return false;
  if (platform === 'win32') return true;
  return fsp.access(p, fs.constants.X_OK).then(() => true, () => false);
}

export async function detectShells(opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): Promise<ShellInfo[]> {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const out: ShellInfo[] = [];
  const seen = new Set<string>();
  const add = async (p: string | undefined, source: string) => {
    if (!p) return;
    const real = await fsp.realpath(p).catch(() => p);
    const key = platform === 'win32' ? real.toLowerCase() : real;
    if (seen.has(key) || seen.has(platform === 'win32' ? p.toLowerCase() : p)) return;
    if (!(await isExecutableFile(p, platform))) return;
    seen.add(key);
    seen.add(platform === 'win32' ? p.toLowerCase() : p);
    out.push({ id: p, label: labelOf(p), path: p, args: defaultArgs(p, platform), flavor: shellFlavorOf(p), source });
  };
  if (platform === 'win32') {
    await add(await findOnPath('pwsh', env, platform), 'PATH');
    const sysRoot = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
    const winPs = path.win32.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    await add((await isExecutableFile(winPs, platform)) ? winPs : await findOnPath('powershell', env, platform), 'Windows');
    await add(env.ComSpec ?? (await findOnPath('cmd', env, platform)), 'ComSpec');
    return out;
  }
  const sh = env.SHELL?.trim();
  if (sh && path.isAbsolute(sh)) await add(sh, '$SHELL');
  for (const c of POSIX_CANDIDATES) await add(await findOnPath(c, env, platform), 'PATH');
  // Fall back to the standard locations when PATH is minimal (for example when started from a desktop file).
  for (const c of POSIX_CANDIDATES) await add(`/bin/${c}`, 'system');
  return out;
}

/** The terminal settings that choose the shell. */
export interface ShellSettings {
  terminalShell: string;
  terminalCustomPath: string;
  terminalCustomArgs: string;
}

/** The shell a new session starts, from Settings; the custom one is checked here (never trusted blindly). */
export async function resolveShell(settings: ShellSettings, opts: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}): Promise<ShellInfo> {
  const platform = opts.platform ?? process.platform;
  const choice = settings.terminalShell;
  if (choice === 'custom') {
    const p = settings.terminalCustomPath.trim();
    if (!p || !(platform === 'win32' ? path.win32.isAbsolute(p) : path.isAbsolute(p))) {
      throw makeError('validation', 'term.create', { message: 'The custom shell must be a full path to a program (Settings → Built-in terminal).' });
    }
    if (!(await isExecutableFile(p, platform))) throw makeError('not_found', 'term.create', { target: p, message: `The custom shell “${p}” does not exist or cannot be run.` });
    let args: string[];
    try {
      args = splitShellArgs(settings.terminalCustomArgs);
    } catch (err) {
      throw makeError('validation', 'term.create', { message: `The custom shell arguments are not valid: ${(err as QuoteError).message}` });
    }
    return { id: 'custom', label: labelOf(p), path: p, args, flavor: shellFlavorOf(p), source: 'Settings' };
  }
  const shells = await detectShells(opts);
  if (choice !== 'auto') {
    const hit = shells.find((s) => s.path === choice);
    if (hit) return hit;
    // A shell chosen earlier that is gone: say so rather than silently starting another one.
    throw makeError('not_found', 'term.create', { target: choice, message: `The shell chosen in Settings (${choice}) is no longer available. Choose another one in Settings → Built-in terminal.` });
  }
  const first = shells[0];
  if (!first) throw makeError('unavailable', 'term.create', { message: 'No shell was found on this system (looked for $SHELL, bash, zsh, fish and sh, or PowerShell and cmd on Windows).' });
  return first;
}
