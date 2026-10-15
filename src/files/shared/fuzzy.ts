/**
 * Fuzzy matching and ranking for the quick switcher ("Go to file or
 * folder…"). Pure, shared by the renderer (local sources) and the main
 * process (indexed paths), so both rank the same way.
 *
 * A query matches when every whitespace-separated word appears in the text
 * as a subsequence (case-insensitive). The score prefers, in order: the
 * whole name, a name prefix, matches at word starts (after a space, -, _, .,
 * a path separator, or a lower→upper case change), runs of consecutive
 * characters, and short names. Ranking then adds a boost for the source
 * (open tabs, pins, known places) and for how recently and often the item
 * was opened.
 */

export interface FuzzyMatch {
  score: number;
  /** Indexes of the matched characters in the text (sorted, unique), for highlighting. */
  positions: number[];
}

const SEPARATORS = new Set([' ', '-', '_', '.', '/', '\\', '(', ')', '[', ']', '{', '}', ',', '+', '&', '@']);

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  if (SEPARATORS.has(prev)) return true;
  const cur = text[i]!;
  // camelCase / PascalCase transition, and letter → digit.
  if (prev.toLowerCase() === prev && prev.toUpperCase() !== prev && cur.toUpperCase() === cur && cur.toLowerCase() !== cur) return true;
  return /[A-Za-z]/.test(prev) && /[0-9]/.test(cur);
}

/** Longest query word considered (longer input is cut, which only makes matching stricter). */
const MAX_WORD = 64;
/** Start positions tried for each word (bounded so long texts stay fast). */
const MAX_STARTS = 24;

/** Positions of `w` in `lower` from start `s`, or null. Preferring boundaries can fail where plain greedy matching succeeds. */
function walk(w: string, text: string, lower: string, s: number, preferBoundary: boolean): number[] | null {
  const positions: number[] = [s];
  let ti = s + 1;
  for (let qi = 1; qi < w.length; qi++) {
    const c = w[qi]!;
    if (lower[ti] === c) {
      positions.push(ti++);
      continue;
    }
    let found = -1;
    let firstAny = -1;
    for (let k = ti; k < lower.length; k++) {
      if (lower[k] !== c) continue;
      if (firstAny < 0) firstAny = k;
      if (!preferBoundary || isBoundary(text, k)) {
        found = k;
        break;
      }
    }
    const at = found >= 0 ? found : firstAny;
    if (at < 0) return null;
    positions.push(at);
    ti = at + 1;
  }
  return positions;
}

function scorePositions(text: string, positions: number[]): number {
  let score = 0;
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k]!;
    score += 1;
    if (p === 0) score += 6;
    else if (isBoundary(text, p)) score += 4;
    if (k > 0) {
      const gap = p - positions[k - 1]! - 1;
      if (gap === 0) score += 5;
      else score -= Math.min(3, gap * 0.25);
    }
  }
  return score;
}

function matchWord(word: string, text: string, lower: string): FuzzyMatch | null {
  const w = word.toLowerCase().slice(0, MAX_WORD);
  if (!w) return { score: 0, positions: [] };
  let best: FuzzyMatch | null = null;
  let starts = 0;
  for (let s = lower.indexOf(w[0]!); s >= 0 && starts < MAX_STARTS; s = lower.indexOf(w[0]!, s + 1)) {
    starts++;
    const greedy = walk(w, text, lower, s, false);
    if (!greedy) break; // later starts cannot match either
    for (const positions of [walk(w, text, lower, s, true), greedy]) {
      if (!positions) continue;
      const score = scorePositions(text, positions);
      if (!best || score > best.score) best = { score, positions };
    }
  }
  return best;
}

/**
 * Match `query` against `text`. Returns null when any query word does not
 * occur in order. An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { score: 0, positions: [] };
  const lower = text.toLowerCase();
  let score = 0;
  const positions = new Set<number>();
  for (const w of words) {
    const m = matchWord(w, text, lower);
    if (!m) return null;
    score += m.score;
    m.positions.forEach((p) => positions.add(p));
  }
  const q = words.join(' ').toLowerCase();
  if (lower === q) score += 50;
  else if (lower.startsWith(q)) score += 25;
  else if (words.length === 1 && lower.includes(q)) score += isBoundary(text, lower.indexOf(q)) ? 10 : 3;
  score -= Math.min(10, text.length * 0.05);
  return { score, positions: [...positions].sort((a, b) => a - b) };
}

export type SwitcherSource = 'tab' | 'pin' | 'known' | 'recent' | 'folder' | 'index';

export interface SwitcherCandidate {
  path: string;
  name: string;
  kind: 'file' | 'directory';
  source: SwitcherSource;
  /** Last opened (ms since epoch) and how often, for recent items. */
  recentMs?: number;
  recentCount?: number;
  /** Open tab to switch to (source 'tab'). */
  tabId?: string;
}

export interface RankedCandidate extends SwitcherCandidate {
  score: number;
  /** Matched character positions in `name` (empty when the match was on the path). */
  positions: number[];
  /** Every source the item was found in (after merging duplicates). */
  sources: SwitcherSource[];
}

/** Ranking boost per source: places the user deliberately keeps rank above folder contents and indexed files. */
export const SOURCE_BOOST: Record<SwitcherSource, number> = { tab: 4, pin: 4, known: 3, recent: 2, folder: 1, index: 0 };

/** Boost for recently and frequently opened items: up to ~11 points, halving every three days. */
export function recencyBoost(recentMs: number | undefined, count: number | undefined, now: number): number {
  if (!recentMs) return 0;
  const ageHours = Math.max(0, (now - recentMs) / 3_600_000);
  return 8 * Math.pow(0.5, ageHours / 72) + Math.min(10, count ?? 1) * 0.3;
}

/**
 * Merge candidates by path (keeping every source and the best recency), match
 * them against the query and return the best `limit`, highest score first.
 * The name is matched; when the query contains a path separator the full path
 * is matched too (at a small discount). With an empty query, recent items come
 * first (most recent first), then tabs, pins and known places.
 */
export function rankCandidates(query: string, candidates: SwitcherCandidate[], opts: { now?: number; limit?: number } = {}): RankedCandidate[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 50;
  const merged = new Map<string, RankedCandidate>();
  for (const c of candidates) {
    const key = c.source === 'tab' ? `tab:${c.tabId ?? c.path}` : c.path;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, { ...c, score: 0, positions: [], sources: [c.source] });
      continue;
    }
    if (!cur.sources.includes(c.source)) cur.sources.push(c.source);
    if (SOURCE_BOOST[c.source] > SOURCE_BOOST[cur.source]) cur.source = c.source;
    if ((c.recentMs ?? 0) > (cur.recentMs ?? 0)) {
      cur.recentMs = c.recentMs;
      cur.recentCount = c.recentCount;
    }
  }
  const q = query.trim();
  const out: RankedCandidate[] = [];
  const pathQuery = /[\\/]/.test(q);
  for (const c of merged.values()) {
    const boost = Math.max(...c.sources.map((s) => SOURCE_BOOST[s])) + recencyBoost(c.recentMs, c.recentCount, now);
    if (!q) {
      if (c.source === 'folder' || c.source === 'index') continue;
      out.push({ ...c, score: boost + (c.recentMs ? 100 + c.recentMs / 1e13 : 0), positions: [] });
      continue;
    }
    const byName = fuzzyMatch(q, c.name);
    const byPath = pathQuery || !byName ? fuzzyMatch(q, c.path) : null;
    const pathScore = byPath ? byPath.score * 0.8 : -Infinity;
    if (!byName && !byPath) continue;
    if (byName && byName.score >= pathScore) out.push({ ...c, score: byName.score + boost, positions: byName.positions });
    else out.push({ ...c, score: pathScore + boost, positions: [] });
  }
  out.sort((a, b) => b.score - a.score || a.name.length - b.name.length || a.path.localeCompare(b.path));
  return out.slice(0, limit);
}

/** A SQL LIKE pattern matching names that contain the word's characters in order ("rpt" → "%r%p%t%"). */
export function subsequenceLike(word: string): string {
  const esc = (ch: string) => (ch === '%' || ch === '_' || ch === '\\' ? `\\${ch}` : ch);
  return `%${[...word.slice(0, MAX_WORD)].map(esc).join('%')}%`;
}
