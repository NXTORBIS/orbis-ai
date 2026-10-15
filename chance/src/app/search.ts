/**
 * Matching and ranking for the command palette and the home screen's tool
 * filter. One module, two surfaces: the palette ranks everything the
 * application can navigate to, and the home grid uses the same tool matcher so
 * that typing "expected shortfall" in either place finds the same screen.
 *
 * This searches metadata only — `TOOLS` from `./tools`, the examples library
 * and the saved investigations the store already holds. It must never import a
 * tool screen module: a single static import pulls all 36 code-split screens
 * back into the first chunk. Navigation is by route, which costs nothing.
 *
 * There is no fuzzy-search dependency, and there is not going to be one. The
 * rules below are deliberately legible: a match is classified (equal, prefix,
 * word start, substring, subsequence), that class gives a base score, and the
 * field it matched in gives a weight. The best (class × weight) over all
 * fields wins, and the field that produced it is reported as the reason the
 * result is in the list — the matching method or question, not just the name.
 */
import { TOOLS, type ToolInfo } from './tools';
import type { Route } from './tools';
import { BUILT_IN_TEMPLATES, EXAMPLES } from '../examples/library';
import type { IconName } from '../ui/icons';
import type { Investigation } from '../persistence/schema';

/* ------------------------------------------------------------ matching */

/** How a query matched a single field, best first. */
export type MatchKind = 'equal' | 'prefix' | 'word' | 'substring' | 'subsequence';

const KIND_SCORE: Record<MatchKind, number> = {
  equal: 1000,
  prefix: 700,
  word: 520,
  substring: 400,
  subsequence: 140,
};

export interface FieldMatch {
  kind: MatchKind;
  score: number;
}

function normalise(text: string): string {
  // Fold the dashes and accents the method names use, so "Dempster-Shafer"
  // is found by "dempster shafer" and "Fréchet" by "frechet".
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Classify how `query` matches `text`. Both are normalised here, so callers
 * pass raw field values. Returns null when there is no match at all.
 */
export function matchField(query: string, text: string): FieldMatch | null {
  const q = normalise(query);
  const t = normalise(text);
  if (!q || !t) return null;
  if (q === t) return { kind: 'equal', score: KIND_SCORE.equal };
  if (t.startsWith(q)) return { kind: 'prefix', score: KIND_SCORE.prefix };
  const index = t.indexOf(q);
  if (index > 0) {
    // A match at the start of a word reads as intentional; one in the middle
    // of a word is weaker but still a real substring match.
    const atWordStart = t[index - 1] === ' ';
    const kind: MatchKind = atWordStart ? 'word' : 'substring';
    // Shorter fields are more specific: "VaR" matching a three-word method
    // name should beat it matching a paragraph of description.
    const density = q.length / t.length;
    return { kind, score: KIND_SCORE[kind] + Math.round(density * 60) };
  }
  // Subsequence matching is the only fuzzy rule, and it is deliberately
  // narrow: the query's characters must be consumed in a few runs that each
  // begin at the start of a word. "expsh" finds "Expected shortfall with its
  // standard error" in two runs, while "cvar" does not drag in "CTMC
  // transient..." on the strength of four letters scattered mid-word, which
  // an unrestricted subsequence match did.
  if (q.length >= 3) {
    const compact = q.replace(/ /g, '');
    const runs = wordRunSubsequence(compact, t);
    // A very short query gets at most two runs: "cvar" may stand for a
    // two-word abbreviation, but spread over three words it is a coincidence.
    if (runs !== null && (compact.length >= 5 || runs <= 2)) {
      const density = compact.length / t.replace(/ /g, '').length;
      return { kind: 'subsequence', score: KIND_SCORE.subsequence + Math.round(density * 40) - runs * 10 };
    }
  }
  return null;
}

/** Longest run limit for the fuzzy rule: more runs than this is a coincidence. */
const MAX_RUNS = 3;

/**
 * Match `compact` (the query with spaces removed) against `text` in runs that
 * each start at a word boundary. Returns the number of runs used, or null.
 */
function wordRunSubsequence(compact: string, text: string): number | null {
  let i = 0;
  let from = 0;
  let runs = 0;
  let longest = 0;
  while (i < compact.length) {
    let k = -1;
    for (let j = from; j < text.length; j++) {
      if (text[j] === compact[i] && (j === 0 || text[j - 1] === ' ')) {
        k = j;
        break;
      }
    }
    if (k < 0) return null;
    runs++;
    if (runs > MAX_RUNS) return null;
    let length = 0;
    while (i < compact.length && k < text.length && text[k] === compact[i]) {
      i++;
      k++;
      length++;
    }
    longest = Math.max(longest, length);
    from = k;
  }
  // A string of single initials is a coincidence rather than an abbreviation:
  // "cvar" should not match "Charts, variance, and rank correlation".
  return longest >= 2 ? runs : null;
}

/**
 * Words carried by a question rather than its subject. A query typed as a
 * sentence — "how do I combine disagreeing experts" — must not be required to
 * match "how" and "do" somewhere before it can find the tool whose own
 * question is "How should I combine disagreeing experts?".
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'if', 'in', 'is', 'it',
  'many', 'me', 'much', 'my', 'of', 'on', 'or', 'should', 'that', 'the', 'this', 'to', 'what', 'when', 'which', 'why', 'with', 'you',
]);

/** The terms worth matching, which is the whole query when it is all stopwords. */
export function queryTerms(query: string): string[] {
  const all = normalise(query).split(' ').filter(Boolean);
  const significant = all.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return significant.length ? significant : all;
}

/* ------------------------------------------------------------- results */

export type SearchResultKind = 'tool' | 'investigation' | 'example' | 'template' | 'destination';

/** What selecting a result does. The palette performs it; search computes it. */
export type SearchAction =
  | { kind: 'navigate'; route: Route }
  | { kind: 'open-investigation'; investigationId: string }
  | { kind: 'open-entry'; toolId: Investigation['toolId']; configOverride: Record<string, unknown>; name: string; description?: string; assumptions?: string[]; origin: { kind: 'example' | 'template'; ref: string } };

export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  /** Label for the kind of thing this is, shown on every row. */
  kindLabel: string;
  title: string;
  /** What it is: the category, or the tool an investigation belongs to. */
  context: string;
  /** Why it matched: the method, question or field text that scored. */
  reason: string;
  icon: IconName;
  score: number;
  action: SearchAction;
}

/** Field weights. Name first, then the method list — that is the point of this. */
const W = {
  name: 1,
  method: 0.86,
  question: 0.66,
  category: 0.6,
  summary: 0.52,
  description: 0.3,
} as const;

interface Candidate {
  weight: number;
  text: string;
  /** How to phrase the reason when this field is the best match. */
  reason: (text: string) => string;
}

interface Scored {
  score: number;
  kind: MatchKind;
  reason: string;
}

/** The best weighted match of one string across all of an entry's fields. */
function bestOfFields(query: string, candidates: Candidate[]): Scored | null {
  let bestResult: Scored | null = null;
  for (const candidate of candidates) {
    const match = matchField(query, candidate.text);
    if (!match) continue;
    const score = match.score * candidate.weight;
    if (!bestResult || score > bestResult.score) {
      bestResult = { score, kind: match.kind, reason: candidate.reason(candidate.text) };
    }
  }
  return bestResult;
}

/**
 * Score one entry. Two readings of the query are tried and the better wins:
 *
 *  - the whole query as one string, which is what makes an exact name match
 *    or a method name typed in full score highest;
 *  - the query's significant terms separately, each scored against every
 *    field, averaged and then multiplied by the fraction of terms that matched
 *    at all — so a question typed as a sentence finds the right tool, while a
 *    query where only one word in four lands stays far down the list.
 *
 * A term-based match needs at least half its terms to land, which is what
 * keeps a long query from matching everything weakly.
 */
function best(query: string, candidates: Candidate[]): Scored | null {
  const whole = bestOfFields(query, candidates);
  const terms = queryTerms(query);
  if (terms.length < 2) return whole;
  // The query matched a field as typed, so that is the match to report: an
  // exact, prefix or substring hit on the whole query is always a stronger
  // statement than the same words found in different fields.
  if (whole && whole.kind !== 'subsequence') return whole;

  let sum = 0;
  let matched = 0;
  let reason: Scored | null = null;
  for (const term of terms) {
    const hit = bestOfFields(term, candidates);
    if (!hit) continue;
    matched++;
    sum += hit.score;
    if (!reason || hit.score > reason.score) reason = hit;
  }
  const fraction = matched / terms.length;
  // Two thirds of the terms, so "Kendall tau" is not answered by every entry
  // containing "tau" while a question typed as a sentence still works.
  if (!reason || matched < Math.ceil(terms.length * (2 / 3))) return whole;
  const termScore = (sum / terms.length) * fraction;
  if (whole && whole.score >= termScore) return whole;
  return { score: termScore, kind: reason.kind, reason: reason.reason };
}

export interface ToolMatch {
  tool: ToolInfo;
  score: number;
  kind: MatchKind;
  reason: string;
}

/**
 * Rank the tool catalogue against a query. Used by the palette and, on its
 * own, by the home screen's tool filter.
 */
export function matchTools(query: string): ToolMatch[] {
  if (!query.trim()) return [];
  const out: ToolMatch[] = [];
  for (const tool of TOOLS) {
    const match = best(query, [
      { weight: W.name, text: tool.name, reason: () => tool.summary },
      { weight: W.category, text: tool.category, reason: (t) => `In ${t}` },
      { weight: W.summary, text: tool.summary, reason: (t) => t },
      { weight: W.description, text: tool.description, reason: () => tool.summary },
      ...tool.methods.map((m) => ({ weight: W.method, text: m, reason: (t: string) => `Method: ${t}` })),
      ...tool.questions.map((q) => ({ weight: W.question, text: q, reason: (t: string) => `Answers: ${t}` })),
    ]);
    if (!match) continue;
    out.push({ tool, score: match.score, kind: match.kind, reason: match.reason });
  }
  return out.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
}

/** The library destinations, so "settings" or "saved" is reachable by name. */
const DESTINATIONS: { route: Route; title: string; summary: string; icon: IconName; keywords: string[] }[] = [
  { route: { kind: 'home' }, title: 'Home', summary: 'The tool catalogue and recent investigations.', icon: 'home', keywords: ['start', 'catalogue', 'tools'] },
  { route: { kind: 'saved' }, title: 'Saved investigations', summary: 'Everything you have saved in this browser.', icon: 'saved', keywords: ['library', 'import', 'export'] },
  { route: { kind: 'templates' }, title: 'Templates', summary: 'Start from a prepared configuration.', icon: 'template', keywords: ['library', 'starting point'] },
  { route: { kind: 'examples' }, title: 'Worked examples', summary: 'Real calculations you can open and change.', icon: 'book', keywords: ['library', 'learn', 'tutorial'] },
  { route: { kind: 'settings' }, title: 'Settings', summary: 'Theme, precision and stored data.', icon: 'settings', keywords: ['preferences', 'theme', 'storage', 'data'] },
];

export interface SearchSources {
  investigations: Investigation[];
  toolName(id: Investigation['toolId']): string;
  toolIcon(id: Investigation['toolId']): IconName;
}

/**
 * The one ranked list behind the command palette: tools, saved
 * investigations, examples, built-in templates and the library destinations.
 */
export function searchEverything(query: string, sources: SearchSources, limit = 30): SearchResult[] {
  if (!query.trim()) return [];
  const results: SearchResult[] = [];

  for (const match of matchTools(query)) {
    results.push({
      id: `tool:${match.tool.id}`,
      kind: 'tool',
      kindLabel: 'Tool',
      title: match.tool.name,
      context: match.tool.category,
      reason: match.reason,
      icon: match.tool.icon,
      score: match.score,
      action: { kind: 'navigate', route: { kind: 'tool', toolId: match.tool.id } },
    });
  }

  for (const inv of sources.investigations) {
    const toolName = sources.toolName(inv.toolId);
    const match = best(query, [
      { weight: W.name, text: inv.name, reason: (t) => `Saved as “${t}”` },
      { weight: W.summary, text: inv.description ?? '', reason: (t) => t },
      { weight: W.category, text: toolName, reason: (t) => `An investigation in ${t}` },
    ]);
    if (!match) continue;
    results.push({
      id: `investigation:${inv.id}`,
      kind: 'investigation',
      kindLabel: 'Saved investigation',
      title: inv.name,
      context: toolName,
      reason: match.reason,
      icon: sources.toolIcon(inv.toolId),
      // Just below an equally-matching tool: a tool is the more common intent,
      // and a saved investigation is also reachable from its own screen.
      score: match.score * 0.96,
      action: { kind: 'open-investigation', investigationId: inv.id },
    });
  }

  for (const example of EXAMPLES) {
    const match = best(query, [
      { weight: W.name, text: example.title, reason: (t) => t },
      { weight: W.question, text: example.question, reason: (t) => `Answers: ${t}` },
      { weight: W.category, text: example.category, reason: (t) => `In ${t}` },
      { weight: W.description, text: example.description, reason: () => example.question },
    ]);
    if (!match) continue;
    results.push({
      id: `example:${example.id}`,
      kind: 'example',
      kindLabel: 'Worked example',
      title: example.title,
      context: `${sources.toolName(example.toolId)} · ${example.level}`,
      reason: match.reason,
      icon: 'book',
      score: match.score * 0.9,
      action: {
        kind: 'open-entry',
        toolId: example.toolId,
        configOverride: example.configOverride,
        name: example.title,
        description: example.question,
        assumptions: example.assumptions,
        origin: { kind: 'example', ref: example.id },
      },
    });
  }

  for (const template of BUILT_IN_TEMPLATES) {
    const match = best(query, [
      { weight: W.name, text: template.name, reason: (t) => t },
      { weight: W.summary, text: template.description, reason: (t) => t },
      { weight: W.category, text: template.category, reason: (t) => `In ${t}` },
    ]);
    if (!match) continue;
    results.push({
      id: `template:${template.id}`,
      kind: 'template',
      kindLabel: 'Template',
      title: template.name,
      context: sources.toolName(template.toolId),
      reason: match.reason,
      icon: 'template',
      score: match.score * 0.86,
      action: {
        kind: 'open-entry',
        toolId: template.toolId,
        configOverride: template.configOverride,
        name: template.name,
        origin: { kind: 'template', ref: template.id },
      },
    });
  }

  for (const destination of DESTINATIONS) {
    const match = best(query, [
      { weight: W.name, text: destination.title, reason: () => destination.summary },
      { weight: W.summary, text: destination.summary, reason: (t) => t },
      ...destination.keywords.map((k) => ({ weight: W.question, text: k, reason: () => destination.summary })),
    ]);
    if (!match) continue;
    results.push({
      id: `destination:${destination.route.kind}`,
      kind: 'destination',
      kindLabel: 'Go to',
      title: destination.title,
      context: 'Library',
      reason: match.reason,
      icon: destination.icon,
      score: match.score * 0.8,
      action: { kind: 'navigate', route: destination.route },
    });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
