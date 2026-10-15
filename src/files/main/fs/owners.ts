import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * Resolves POSIX user and group ids to names. Reads /etc/passwd and /etc/group
 * first and falls back to `id`/`getent` (run without a shell) for directory
 * services. Results are cached; unknown ids stay numeric.
 */
const users = new Map<number, string>();
const groups = new Map<number, string>();
let loaded = false;

function loadFiles(): void {
  if (loaded) return;
  loaded = true;
  const parse = (file: string, into: Map<number, string>) => {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const parts = line.split(':');
        if (parts.length >= 3 && /^\d+$/.test(parts[2]!)) into.set(Number(parts[2]), parts[0]!);
      }
    } catch {
      /* not available on this platform */
    }
  };
  parse('/etc/passwd', users);
  parse('/etc/group', groups);
}

function lookup(kind: 'passwd' | 'group', id: number): string | undefined {
  try {
    const out = execFileSync('getent', [kind, String(id)], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] });
    const name = out.split(':')[0]?.trim();
    return name || undefined;
  } catch {
    if (kind === 'passwd' && process.platform === 'darwin') {
      try {
        return execFileSync('id', ['-nu', String(id)], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function ownerNames(uids: number[], gids: number[]): { users: Record<number, string>; groups: Record<number, string> } {
  if (process.platform === 'win32') return { users: {}, groups: {} };
  loadFiles();
  const u: Record<number, string> = {};
  const g: Record<number, string> = {};
  for (const id of new Set(uids)) {
    if (!users.has(id)) users.set(id, lookup('passwd', id) ?? String(id));
    u[id] = users.get(id)!;
  }
  for (const id of new Set(gids)) {
    if (!groups.has(id)) groups.set(id, lookup('group', id) ?? String(id));
    g[id] = groups.get(id)!;
  }
  return { users: u, groups: g };
}

