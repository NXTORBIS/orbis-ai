/**
 * Git status: parsing `git status --porcelain=v2 -z --branch` output and
 * turning it into per-entry badges for one folder. Pure functions shared by
 * the main process (which runs git) and the tests.
 *
 * Porcelain v2 records (each terminated by NUL with -z):
 *   # branch.oid <commit> | (initial)
 *   # branch.head <name> | (detached)
 *   # branch.upstream <upstream>
 *   # branch.ab +<ahead> -<behind>
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>  NUL <origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *   ? <path>          (untracked; a wholly untracked folder ends with "/")
 *   ! <path>          (ignored; same)
 */

export type GitCode = 'conflicted' | 'modified' | 'added' | 'deleted' | 'renamed' | 'typechange' | 'untracked' | 'ignored';

export interface GitBranch {
  oid?: string;
  /** Branch name; undefined when HEAD is detached. */
  head?: string;
  detached: boolean;
  /** No commit yet. */
  initial: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export interface GitEntry {
  /** Path relative to the repository root, "/"-separated; folders end with "/". */
  path: string;
  code: GitCode;
  /** Change recorded in the index (staged). */
  staged: boolean;
  /** Change in the working tree not yet staged. */
  unstaged: boolean;
  origPath?: string;
}

export interface GitStatus {
  branch: GitBranch;
  entries: GitEntry[];
}

/** Badge for one listed item. `inside`: the folder itself is clean but contains changes. */
export interface GitBadge {
  code: GitCode;
  inside?: boolean;
  staged?: boolean;
  /** For renamed items: the previous path (relative to the repository). */
  from?: string;
}

/** Most important first: what a folder containing several kinds of changes shows. */
export const GIT_CODE_ORDER: GitCode[] = ['conflicted', 'modified', 'typechange', 'deleted', 'renamed', 'added', 'untracked', 'ignored'];

export const GIT_CODE_LABEL: Record<GitCode, string> = {
  conflicted: 'Conflicted',
  modified: 'Modified',
  typechange: 'Type changed',
  deleted: 'Deleted',
  renamed: 'Renamed',
  added: 'Added',
  untracked: 'Untracked',
  ignored: 'Ignored',
};

/** One letter for compact badges. */
export const GIT_CODE_LETTER: Record<GitCode, string> = { conflicted: '!', modified: 'M', typechange: 'T', deleted: 'D', renamed: 'R', added: 'A', untracked: 'U', ignored: 'I' };

function codeFromXY(xy: string): GitCode {
  const x = xy[0] ?? '.';
  const y = xy[1] ?? '.';
  const has = (c: string) => x === c || y === c;
  if (has('U') || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflicted';
  if (has('M')) return 'modified';
  if (has('T')) return 'typechange';
  if (has('D')) return 'deleted';
  if (has('R') || has('C')) return 'renamed';
  if (has('A')) return 'added';
  return 'modified';
}

/**
 * Parse porcelain v2 output (with -z). `limit`: stop after this many entries
 * and report `truncated`. Malformed records are skipped and counted.
 */
export function parsePorcelainV2(out: string, limit = Infinity): GitStatus & { truncated: boolean; skipped: number } {
  const branch: GitBranch = { detached: false, initial: false };
  const entries: GitEntry[] = [];
  const recs = out.split('\0');
  let skipped = 0;
  let truncated = false;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i]!;
    if (!r) continue;
    if (r.startsWith('# ')) {
      const [, key, ...rest] = r.split(' ');
      const val = rest.join(' ');
      if (key === 'branch.oid') {
        if (val === '(initial)') branch.initial = true;
        else branch.oid = val;
      } else if (key === 'branch.head') {
        if (val === '(detached)') branch.detached = true;
        else branch.head = val;
      } else if (key === 'branch.upstream') branch.upstream = val;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(val);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }
    if (entries.length >= limit) {
      truncated = true;
      break;
    }
    const kind = r[0];
    if ((kind === '?' || kind === '!') && r[1] === ' ') {
      entries.push({ path: r.slice(2), code: kind === '?' ? 'untracked' : 'ignored', staged: false, unstaged: kind === '?' });
      continue;
    }
    if (kind === '1' || kind === '2' || kind === 'u') {
      const fields = kind === '1' ? 8 : kind === '2' ? 9 : 10;
      // The path is everything after the fixed fields (paths may contain spaces).
      let pos = 0;
      for (let f = 0; f < fields && pos >= 0; f++) pos = r.indexOf(' ', pos) + 1 || -1;
      if (pos <= 0) {
        skipped++;
        continue;
      }
      const xy = r.slice(2, 4);
      const path = r.slice(pos);
      const e: GitEntry = { path, code: kind === 'u' ? 'conflicted' : kind === '2' ? 'renamed' : codeFromXY(xy), staged: xy[0] !== '.' && kind !== 'u', unstaged: xy[1] !== '.' || kind === 'u' };
      if (kind === '2') {
        // Copies are reported like renames; the original path follows as its own NUL-terminated field.
        e.origPath = recs[i + 1];
        i++;
      }
      entries.push(e);
      continue;
    }
    skipped++;
  }
  return { branch, entries, truncated, skipped };
}

const rank = (c: GitCode) => GIT_CODE_ORDER.indexOf(c);

/**
 * Badges for the items of one folder. `rel` is the folder's path relative to
 * the repository root ("" for the root, otherwise "a/b" without slashes at
 * either end). Returns badges by item name, and the badge every item inherits
 * when the folder itself is inside an untracked or ignored folder.
 */
export function folderBadges(entries: GitEntry[], rel: string): { byName: Record<string, GitBadge>; inherited?: GitBadge } {
  const prefix = rel ? `${rel}/` : '';
  const byName: Record<string, GitBadge> = {};
  let inherited: GitBadge | undefined;
  for (const e of entries) {
    // A wholly untracked/ignored folder that contains this folder: every item inherits it.
    if (e.path.endsWith('/') && rel && (`${rel}/` === e.path || `${rel}/`.startsWith(e.path))) {
      if (!inherited || rank(e.code) < rank(inherited.code)) inherited = { code: e.code };
      continue;
    }
    if (!e.path.startsWith(prefix)) continue;
    const rest = e.path.slice(prefix.length);
    if (!rest) continue;
    const slash = rest.indexOf('/');
    if (slash < 0 || slash === rest.length - 1) {
      // The item itself (a file, or a folder reported as a whole with a trailing "/").
      const name = slash < 0 ? rest : rest.slice(0, -1);
      const cur = byName[name];
      if (!cur || cur.inside || rank(e.code) < rank(cur.code)) byName[name] = { code: e.code, staged: e.staged || undefined, from: e.origPath };
    } else {
      // Something inside a child folder: the folder "contains changes" (ignored files are not changes).
      if (e.code === 'ignored') continue;
      const name = rest.slice(0, slash);
      const cur = byName[name];
      if (!cur) byName[name] = { code: e.code, inside: true };
      else if (cur.inside && rank(e.code) < rank(cur.code)) cur.code = e.code;
    }
  }
  return { byName, inherited };
}

/** Number of changed (not ignored) entries. */
export function changeCount(entries: GitEntry[]): number {
  let n = 0;
  for (const e of entries) if (e.code !== 'ignored') n++;
  return n;
}

/** Remove user names and passwords from a remote URL (https://user:token@host/… → https://host/…). */
export function redactRemoteUrl(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/@]*@)(.*)$/i.exec(url.trim());
  if (!m) return url.trim();
  // ssh://git@host is a user name, not a secret, and is needed to connect; keep it for ssh.
  if (/^ssh:/i.test(m[1]!) && !m[2]!.includes(':')) return url.trim();
  return `${m[1]}${m[3]}`;
}

/** What the status bar says about the branch: "main ↑2 ↓1", "detached at 1a2b3c4", "main (no commits yet)". */
export function branchLabel(b: GitBranch): string {
  const name = b.detached ? `detached at ${(b.oid ?? '').slice(0, 7)}` : b.head ?? 'unknown branch';
  const ab = b.upstream ? `${b.ahead ? ` ↑${b.ahead}` : ''}${b.behind ? ` ↓${b.behind}` : ''}` : '';
  return `${name}${ab}${b.initial ? ' (no commits yet)' : ''}`;
}
