import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { makeError } from '../../shared/errors';

/**
 * "Open terminal here": find the terminal application the system offers and
 * start it in a folder. Nothing is guessed: on Linux a terminal is used only
 * when its program is found on PATH ($TERMINAL, then the Debian/Ubuntu
 * x-terminal-emulator alternative, then the desktop's own terminal, then
 * common terminals); macOS uses Terminal.app through `open -a Terminal`;
 * Windows uses Windows Terminal (wt.exe) when it is on PATH, else a new
 * Command Prompt window. Programs are started directly (no shell), with the
 * folder as a separate argument or as the working directory.
 */

export interface TerminalChoice {
  /** Program to start (absolute path on Linux/Windows when found on PATH). */
  command: string;
  label: string;
  /** Arguments for opening in `dir` (the program is also started with `dir` as its working directory). */
  args: (dir: string) => string[];
  /** Where the choice came from, for the user. */
  via: 'TERMINAL variable' | 'x-terminal-emulator' | 'desktop' | 'installed' | 'system';
}

interface Known { cmd: string; label: string; args: (dir: string) => string[] }

/** Terminals that take a working-directory option; others start in the working directory they are given. */
const KNOWN: Known[] = [
  { cmd: 'gnome-terminal', label: 'GNOME Terminal', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'kgx', label: 'GNOME Console', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'ptyxis', label: 'Ptyxis', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'konsole', label: 'Konsole', args: (d) => ['--workdir', d] },
  { cmd: 'xfce4-terminal', label: 'Xfce Terminal', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'mate-terminal', label: 'MATE Terminal', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'qterminal', label: 'QTerminal', args: (d) => ['-w', d] },
  { cmd: 'lxterminal', label: 'LXTerminal', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'tilix', label: 'Tilix', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'terminator', label: 'Terminator', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'kitty', label: 'kitty', args: (d) => ['--directory', d] },
  { cmd: 'alacritty', label: 'Alacritty', args: (d) => ['--working-directory', d] },
  { cmd: 'wezterm', label: 'WezTerm', args: (d) => ['start', '--cwd', d] },
  { cmd: 'foot', label: 'foot', args: (d) => [`--working-directory=${d}`] },
  { cmd: 'xterm', label: 'XTerm', args: () => [] },
];

/** The desktop's own terminal first (XDG_CURRENT_DESKTOP). */
const DESKTOP: Array<[RegExp, string[]]> = [
  [/gnome|unity|budgie|pantheon/i, ['kgx', 'ptyxis', 'gnome-terminal']],
  [/kde|plasma/i, ['konsole']],
  [/xfce/i, ['xfce4-terminal']],
  [/mate/i, ['mate-terminal']],
  [/lxqt/i, ['qterminal']],
  [/lxde/i, ['lxterminal']],
];

/** Find an executable on PATH (or check an absolute path). */
export async function findOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string | undefined> {
  const exts = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean) : [''];
  const check = async (p: string) => {
    for (const ext of exts) {
      const full = p + (ext && !p.toLowerCase().endsWith(ext.toLowerCase()) ? ext : '');
      const st = await fsp.stat(full).catch(() => undefined);
      if (!st?.isFile()) continue;
      if (platform === 'win32') return full;
      if (await fsp.access(full, fs.constants.X_OK).then(() => true, () => false)) return full;
    }
    return undefined;
  };
  if (path.isAbsolute(cmd)) return check(cmd);
  if (cmd.includes('/') || cmd.includes('\\')) return undefined;
  for (const dir of (env.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    const hit = await check(path.join(dir, cmd));
    if (hit) return hit;
  }
  return undefined;
}

/** Detect the terminal to use, or undefined when none is available. */
export async function detectTerminal(opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}): Promise<TerminalChoice | undefined> {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform === 'darwin') return { command: 'open', label: 'Terminal', args: (d) => ['-a', 'Terminal', d], via: 'system' };
  if (platform === 'win32') {
    const wt = await findOnPath('wt', env, platform);
    if (wt) return { command: wt, label: 'Windows Terminal', args: (d) => ['-d', d], via: 'installed' };
    const cmd = env.ComSpec ?? 'cmd.exe';
    return { command: cmd, label: 'Command Prompt', args: () => ['/c', 'start', '', 'cmd.exe'], via: 'system' };
  }
  const known = (cmd: string) => KNOWN.find((k) => k.cmd === cmd);
  const t = env.TERMINAL?.trim();
  if (t && !/\s/.test(t)) {
    const found = await findOnPath(t, env, platform);
    if (found) {
      const k = known(path.basename(found));
      return { command: found, label: k?.label ?? path.basename(found), args: k?.args ?? (() => []), via: 'TERMINAL variable' };
    }
  }
  const alt = await findOnPath('x-terminal-emulator', env, platform);
  if (alt) {
    // The alternative points at a real terminal; use that terminal's own directory option when it is a known one.
    const real = await fsp.realpath(alt).catch(() => alt);
    const k = known(path.basename(real));
    return { command: alt, label: k?.label ?? 'the default terminal (x-terminal-emulator)', args: k?.args ?? (() => []), via: 'x-terminal-emulator' };
  }
  const desktop = env.XDG_CURRENT_DESKTOP ?? '';
  const preferred = DESKTOP.filter(([re]) => re.test(desktop)).flatMap(([, cmds]) => cmds);
  for (const cmd of preferred) {
    const found = await findOnPath(cmd, env, platform);
    if (found) return { command: found, label: known(cmd)!.label, args: known(cmd)!.args, via: 'desktop' };
  }
  for (const k of KNOWN) {
    const found = await findOnPath(k.cmd, env, platform);
    if (found) return { command: found, label: k.label, args: k.args, via: 'installed' };
  }
  return undefined;
}

/** Start the terminal in `dir`; resolves once the program has started. */
export async function openTerminal(dir: string, choice: TerminalChoice): Promise<void> {
  const st = await fsp.stat(dir).catch(() => undefined);
  if (!st?.isDirectory()) throw makeError('not_a_directory', 'fs.openTerminal', { target: dir, message: 'A terminal can only be opened in a folder that exists.' });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(choice.command, choice.args(dir), { cwd: dir, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.once('error', (e) => reject(makeError('unavailable', 'fs.openTerminal', { message: `${choice.label} could not be started: ${e.message}` })));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
