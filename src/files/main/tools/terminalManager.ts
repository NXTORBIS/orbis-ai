import os from 'node:os';
import { terminalEnv, shellFlavorOf, type ShellFlavor } from '../../shared/terminal';

/**
 * Terminal session manager: spawns shell processes via child_process and
 * manages multiple terminal sessions. This wraps the lower-level pty work
 * that the existing terminal/ folder handles, providing a higher-level API
 * for the TerminalPanel feature.
 *
 * The actual PTY spawning and data flow is handled by the existing terminal
 * subsystem (main/terminal/). This module provides utilities for managing
 * terminal sessions from the feature perspective: auto-cd, working directory
 * tracking and session metadata.
 */

export interface TerminalSession {
  id: string;
  pid: number;
  shell: string;
  shellPath: string;
  flavor: ShellFlavor;
  cwd: string;
  createdMs: number;
  label: string;
}

let nextId = 0;

/** Generate a unique terminal session id. */
export function generateTermId(): string {
  const hex = (++nextId * 0x100000000 + Math.random() * 0x100000000 >>> 0).toString(16).padStart(16, '0');
  return `t${hex}`;
}

/**
 * Detect the default shell on this system. Returns the shell path and its
 * flavor (posix, fish, powershell, cmd).
 */
export function detectDefaultShell(): { path: string; flavor: ShellFlavor } {
  const platform = process.platform;
  if (platform === 'win32') {
    const comspec = process.env.COMSPEC ?? 'cmd.exe';
    return { path: comspec, flavor: shellFlavorOf(comspec) };
  }
  const shell = process.env.SHELL ?? '/bin/sh';
  return { path: shell, flavor: shellFlavorOf(shell) };
}

/**
 * Build the environment for a terminal session. Strips Electron-specific
 * variables and sets terminal identification.
 */
export function buildTerminalEnv(extra?: Record<string, string>): Record<string, string> {
  const env = terminalEnv(process.env as Record<string, string | undefined>, {
    termProgramVersion: process.env.npm_package_version,
    platform: process.platform,
  });
  if (extra) Object.assign(env, extra);
  return env;
}

/**
 * Get the home directory for the current user.
 */
export function homeDir(): string {
  return os.homedir();
}

/**
 * Validate and resolve a working directory for a terminal session.
 * Returns the home directory if the requested path is invalid.
 */
export async function resolveTerminalCwd(requestedCwd?: string): Promise<string> {
  if (!requestedCwd) return homeDir();
  const fsp = await import('node:fs/promises');
  try {
    const stat = await fsp.stat(requestedCwd);
    if (stat.isDirectory()) return requestedCwd;
  } catch {
    // fall through
  }
  return homeDir();
}
