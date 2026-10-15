/**
 * Duplicate groups, automatic selection rules and the CSV report. Shared by the
 * main process (which enforces the rules again before acting) and the renderer
 * (which previews them). Every rule keeps at least one copy of each group.
 */

export interface DupFile {
  path: string;
  modifiedMs: number;
  createdMs?: number;
}

export type DupVerification = 'sha256' | 'name-size';

export interface DuplicateGroup {
  /** Stable id: the SHA-256 for content matches, `ns:<size>:<name>` for name-and-size matches. */
  id: string;
  /** Full SHA-256 of the content (content mode only). */
  hash?: string;
  size: number;
  files: DupFile[];
  /** 'sha256': contents verified identical. 'name-size': same name and size only, contents NOT verified. */
  verification: DupVerification;
  reclaimableBytes: number;
}

export type SelectionRule =
  | { kind: 'newest' }
  | { kind: 'oldest' }
  | { kind: 'shortest-path' }
  | { kind: 'longest-name' }
  | { kind: 'prefer-folder'; folder: string }
  | { kind: 'one-per-folder' };

export const SELECTION_RULE_LABELS: Record<SelectionRule['kind'], string> = {
  newest: 'Keep the newest copy',
  oldest: 'Keep the oldest copy',
  'shortest-path': 'Keep the copy with the shortest path',
  'longest-name': 'Keep the copy with the longest name',
  'prefer-folder': 'Keep the copy inside a chosen folder',
  'one-per-folder': 'Keep one copy in each folder',
};

function sepOf(p: string): string {
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

export function baseName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1);
}

export function dirName(p: string): string {
  const s = p.replace(/[\\/]+$/, '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i <= 0 ? s.slice(0, 1) || s : s.slice(0, i);
}

/** True when `p` is `folder` or inside it (string comparison of normalised absolute paths). */
export function insideFolder(folder: string, p: string): boolean {
  const f = folder.replace(/[\\/]+$/, '');
  if (!f) return true;
  return p === f || p.startsWith(f + sepOf(f));
}

const byPath = (a: DupFile, b: DupFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The one copy a rule keeps among `files` (deterministic: ties are broken by path). */
function pick(files: DupFile[], kind: 'newest' | 'oldest' | 'shortest-path' | 'longest-name'): DupFile {
  const sorted = [...files].sort((a, b) => {
    let d = 0;
    if (kind === 'newest') d = b.modifiedMs - a.modifiedMs;
    else if (kind === 'oldest') d = a.modifiedMs - b.modifiedMs;
    else if (kind === 'shortest-path') d = a.path.length - b.path.length;
    else d = baseName(b.path).length - baseName(a.path).length;
    return d || byPath(a, b);
  });
  return sorted[0]!;
}

/**
 * Which copies of a group a rule marks for removal. Never returns every copy:
 * when the rule cannot decide (e.g. no copy is in the preferred folder) nothing
 * is marked and `note` says why.
 */
export function selectForRemoval(group: Pick<DuplicateGroup, 'files'>, rule: SelectionRule): { remove: string[]; note?: string } {
  const files = group.files;
  if (files.length < 2) return { remove: [], note: 'Only one copy.' };
  let keep: Set<string>;
  switch (rule.kind) {
    case 'newest':
    case 'oldest':
    case 'shortest-path':
    case 'longest-name':
      keep = new Set([pick(files, rule.kind).path]);
      break;
    case 'prefer-folder': {
      const inside = files.filter((f) => insideFolder(rule.folder, f.path));
      if (!inside.length) return { remove: [], note: 'No copy is inside the preferred folder, so nothing is marked in this group.' };
      keep = new Set([pick(inside, 'oldest').path]);
      break;
    }
    case 'one-per-folder': {
      const byDir = new Map<string, DupFile[]>();
      for (const f of files) byDir.set(dirName(f.path), [...(byDir.get(dirName(f.path)) ?? []), f]);
      keep = new Set([...byDir.values()].map((list) => pick(list, 'oldest').path));
      if (keep.size === files.length) return { remove: [], note: 'Every copy is in a different folder.' };
      break;
    }
  }
  const remove = files.filter((f) => !keep.has(f.path)).map((f) => f.path);
  // Defence in depth: a rule never marks every copy.
  if (remove.length >= files.length) return { remove: [], note: 'At least one copy is always kept.' };
  return { remove };
}

/** Apply a rule to every group. Returns the paths marked for removal per group id. */
export function applySelectionRule(groups: DuplicateGroup[], rule: SelectionRule): { marks: Record<string, string[]>; notes: Record<string, string> } {
  const marks: Record<string, string[]> = {};
  const notes: Record<string, string> = {};
  for (const g of groups) {
    const r = selectForRemoval(g, rule);
    marks[g.id] = r.remove;
    if (r.note) notes[g.id] = r.note;
  }
  return { marks, notes };
}

export interface DedupePlanGroup {
  /** Copies that stay. At least one, and each must still exist and match when the action runs. */
  keep: string[];
  /** Copies the action applies to. */
  remove: string[];
  size: number;
  verification: DupVerification;
}

/** Structural checks of a plan before anything touches the disk (also run in the main process). */
export function checkDedupePlan(groups: DedupePlanGroup[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  groups.forEach((g, i) => {
    if (!g.keep.length) errors.push(`Group ${i + 1}: at least one copy must be kept.`);
    for (const p of [...g.keep, ...g.remove]) {
      if (seen.has(p)) errors.push(`Group ${i + 1}: ${p} appears more than once.`);
      seen.add(p);
    }
  });
  return errors;
}

/** Turn per-group marks into a plan (groups with nothing marked are left out). */
export function planFromMarks(groups: DuplicateGroup[], marks: Record<string, string[] | Set<string>>): DedupePlanGroup[] {
  const out: DedupePlanGroup[] = [];
  for (const g of groups) {
    const m = new Set(marks[g.id] ?? []);
    const remove = g.files.filter((f) => m.has(f.path)).map((f) => f.path);
    if (!remove.length) continue;
    out.push({ keep: g.files.filter((f) => !m.has(f.path)).map((f) => f.path), remove, size: g.size, verification: g.verification });
  }
  return out;
}

// ---------------------------------------------------------------- CSV report

export function csvField(v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number | undefined>>): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export const DUPLICATES_CSV_HEADER = ['group', 'match', 'sha256', 'size_bytes', 'copies', 'action', 'path', 'modified'];

/** One row per file: which group it belongs to, how it was matched and whether it is kept or marked. */
export function duplicatesCsv(groups: DuplicateGroup[], marks: Record<string, string[] | Set<string>>): string {
  const rows: Array<Array<string | number | undefined>> = [DUPLICATES_CSV_HEADER];
  groups.forEach((g, i) => {
    const m = new Set(marks[g.id] ?? []);
    for (const f of g.files) {
      rows.push([
        i + 1,
        g.verification === 'sha256' ? 'same content (SHA-256)' : 'same name and size (not verified)',
        g.hash ?? '',
        g.size,
        g.files.length,
        m.has(f.path) ? 'marked' : 'keep',
        f.path,
        new Date(f.modifiedMs).toISOString(),
      ]);
    }
  });
  return toCsv(rows);
}
