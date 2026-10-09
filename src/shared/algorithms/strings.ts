import { Recorder, fail, type AlgorithmError, type Run } from './trace.ts'

/**
 * String algorithms that record what they do.
 *
 * ## Why these three matchers together
 *
 * Naive matching, Knuth-Morris-Pratt and Rabin-Karp solve the same problem and fail in different places, and the
 * counts are what show it. On `aaaaaaaaab` looking for `aaab`, the naive matcher compares nearly every character of
 * every window and KMP never looks at a character twice — the comparison counts differ by a factor, on screen, from
 * one run each. Rabin-Karp does almost no character comparisons at all until a hash matches, and on a bad hash it
 * does them all; the spurious-hit counter is what makes that visible rather than asserted.
 *
 * ## The failure table is built, not described
 *
 * KMP's whole idea is the table of how far back to jump, and it is built here step by step with its own recorded
 * steps. A version that computed the table silently and then matched would hide the half of the algorithm that is
 * actually interesting.
 *
 * Pure. No clock, no randomness.
 */

const MOST = 20_000

function check(text: string, pattern: string): AlgorithmError | null {
  if (typeof text !== 'string' || typeof pattern !== 'string') {
    return fail('input', 'Both the text and the pattern have to be text.', 'Give two pieces of text.')
  }
  if (pattern.length === 0) return fail('empty-pattern', 'There is nothing to look for.', 'Type something to search for.')
  if (text.length > MOST) return fail('too-big', `That text is ${text.length} characters, which is more than this traces.`, `Use at most ${MOST}.`)
  if (pattern.length > text.length) {
    return fail('pattern-longer', 'The pattern is longer than the text, so it cannot be in it.', 'Shorten the pattern or lengthen the text.')
  }
  return null
}

export interface MatchResult {
  /** Every position the pattern starts at, in order. */
  at: readonly number[]
  found: boolean
  comparisons: number
  /** For Rabin-Karp: hashes that matched where the characters did not. */
  spurious: number
}

const finish = (rec: Recorder, name: string, text: string, pattern: string, at: readonly number[], spurious = 0): Run => {
  if (!rec.cut) {
    rec.step(
      'done',
      at.length === 0
        ? `"${pattern}" is not in the text`
        : `"${pattern}" starts at ${at.length === 1 ? `position ${at[0]}` : `positions ${at.join(', ')}`}`,
      [...at]
    )
  }
  const run = rec.finish(name, { text, pattern }, { at: [...at], found: at.length > 0, comparisons: 0, spurious } satisfies MatchResult)
  // The comparison count comes from the recorder, so the result cannot claim a different number from the trace.
  return { ...run, result: { at: [...at], found: at.length > 0, comparisons: run.counts.comparisons, spurious } satisfies MatchResult }
}

// ---------------------------------------------------------------- naive

/**
 * Naive matching: try the pattern at every position.
 *
 * Here because it is the baseline the other two are measured against, and because its worst case — a pattern that
 * nearly matches everywhere — is a thing somebody should see happen rather than be told about.
 */
export function naiveMatch(text: string, pattern: string, ceiling?: number): Run | AlgorithmError {
  const bad = check(text, pattern)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const at: number[] = []

  rec.where(1, { n: text.length, m: pattern.length })
  for (let start = 0; start + pattern.length <= text.length && !rec.cut; start += 1) {
    rec.where(1, { start })
    rec.step('range', `try the pattern starting at ${start}`, [start], {
      region: { from: start, to: start + pattern.length - 1, label: `window at ${start}` }
    })
    let matched = 0
    while (matched < pattern.length && !rec.cut) {
      rec.where(2, { at: matched })
      rec.step('compare', `is "${text[start + matched]}" the same as "${pattern[matched]}"?`, [start + matched], {
        values: [text[start + matched], pattern[matched]]
      })
      if (text[start + matched] !== pattern[matched]) {
        rec.where(3)
        rec.step('note', `no — start again one position along, from ${start + 1}`, [start + 1])
        break
      }
      matched += 1
    }
    if (matched === pattern.length) {
      rec.where(4, { found: at.length + 1 })
      rec.step('visit', `the whole pattern matched at ${start}`, [start])
      at.push(start)
    }
  }
  return finish(rec, 'naive string matching', text, pattern, at)
}

// ---------------------------------------------------------------- Knuth-Morris-Pratt

/**
 * The failure table: for each position, how much of the pattern's start is also its end up to there.
 *
 * Built with its own recorded steps, because this is the half of KMP worth watching. The table is what lets the
 * matcher never move the text pointer backwards, which is why KMP is O(n + m) and the naive matcher is O(n·m).
 */
function buildTable(rec: Recorder, pattern: string): number[] {
  const table = new Array<number>(pattern.length).fill(0)
  rec.where(1, { m: pattern.length })
  rec.step('note', 'first build the table: how far to jump back after a mismatch', [])
  let length = 0
  for (let at = 1; at < pattern.length && !rec.cut; ) {
    rec.where(2, { at, length })
    rec.step('compare', `does "${pattern[at]}" continue the prefix "${pattern.slice(0, length)}"?`, [at], {
      values: [pattern[at], pattern[length]]
    })
    if (pattern[at] === pattern[length]) {
      length += 1
      table[at] = length
      rec.where(3, { length })
      rec.step('write', `yes — table[${at}] is ${length}`, [at], { values: [length] })
      at += 1
    } else if (length > 0) {
      rec.where(4)
      rec.step('note', `no — fall back to table[${length - 1}] = ${table[length - 1]} rather than starting over`, [])
      length = table[length - 1]
    } else {
      table[at] = 0
      rec.where(5)
      rec.step('write', `no, and nothing to fall back to — table[${at}] is 0`, [at], { values: [0] })
      at += 1
    }
  }
  return table
}

export function knuthMorrisPratt(text: string, pattern: string, ceiling?: number): Run | AlgorithmError {
  const bad = check(text, pattern)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const table = buildTable(rec, pattern)
  const at: number[] = []

  rec.where(6, { n: text.length })
  rec.step('note', `the table is [${table.join(', ')}] — now walk the text once`, [])

  let inText = 0
  let inPattern = 0
  while (inText < text.length && !rec.cut) {
    rec.where(7, { i: inText, j: inPattern })
    rec.step('compare', `is "${text[inText]}" the same as "${pattern[inPattern]}"?`, [inText], {
      values: [text[inText], pattern[inPattern]],
      region: { from: inText - inPattern, to: Math.min(text.length - 1, inText - inPattern + pattern.length - 1), label: 'window' }
    })
    if (text[inText] === pattern[inPattern]) {
      inText += 1
      inPattern += 1
      rec.where(8, { i: inText, j: inPattern })
      if (inPattern === pattern.length) {
        const start = inText - inPattern
        rec.where(9, { found: at.length + 1 })
        rec.step('visit', `the whole pattern matched, starting at ${start}`, [start])
        at.push(start)
        inPattern = table[inPattern - 1]
      }
    } else if (inPattern > 0) {
      /*
       * The text pointer does not move. That is the whole algorithm.
       *
       * The naive matcher would go back to `start + 1` and re-read characters it has already read; here the table
       * says how much of the pattern is still known to match, so the text is read once from end to end.
       */
      rec.where(10, { j: table[inPattern - 1] })
      rec.step('note', `no — but the first ${table[inPattern - 1]} of the pattern still match, so only the pattern moves`, [inText])
      inPattern = table[inPattern - 1]
    } else {
      rec.where(11, { i: inText + 1 })
      rec.step('note', 'no, and nothing matches, so move along one', [inText])
      inText += 1
    }
  }
  return finish(rec, 'Knuth-Morris-Pratt', text, pattern, at)
}

// ---------------------------------------------------------------- Rabin-Karp

const BASE = 256
const MODULUS = 1_000_003

/**
 * Rabin-Karp: compare a rolling hash, and only compare characters when the hashes agree.
 *
 * The rolling part is the idea: the hash of the next window is worked out from the last one in constant time, by
 * removing the character that left and adding the one that arrived. A hash match is checked character by character,
 * because two different windows can hash the same — and the count of those spurious hits is reported, because a
 * hash function that produced many of them would make this slower than the naive matcher.
 */
export function rabinKarp(text: string, pattern: string, ceiling?: number): Run | AlgorithmError {
  const bad = check(text, pattern)
  if (bad) return bad
  const rec = new Recorder(ceiling)
  const at: number[] = []
  const m = pattern.length

  // BASE^(m-1) mod MODULUS, for removing the leading character.
  let high = 1
  for (let one = 0; one < m - 1; one += 1) high = (high * BASE) % MODULUS

  let wanted = 0
  let window = 0
  for (let one = 0; one < m; one += 1) {
    wanted = (BASE * wanted + pattern.charCodeAt(one)) % MODULUS
    window = (BASE * window + text.charCodeAt(one)) % MODULUS
  }
  rec.where(1, { wanted, window })
  rec.step('note', `the pattern hashes to ${wanted}; the first window hashes to ${window}`, [])

  let spurious = 0
  for (let start = 0; start + m <= text.length && !rec.cut; start += 1) {
    rec.where(2, { start, window })
    rec.step('compare', `does the window at ${start} hash to ${wanted}?`, [start], {
      values: [window, wanted],
      region: { from: start, to: start + m - 1, label: `window at ${start}` }
    })
    if (window === wanted) {
      rec.where(3)
      let same = true
      for (let one = 0; one < m && !rec.cut; one += 1) {
        rec.step('compare', `the hashes agree — is "${text[start + one]}" the same as "${pattern[one]}"?`, [start + one], {
          values: [text[start + one], pattern[one]]
        })
        if (text[start + one] !== pattern[one]) {
          same = false
          break
        }
      }
      if (same) {
        rec.where(4, { found: at.length + 1 })
        rec.step('visit', `a real match at ${start}`, [start])
        at.push(start)
      } else {
        spurious += 1
        rec.where(5, { spurious })
        rec.step('note', 'the hashes agreed and the characters did not — a spurious hit', [start])
        rec.count('spuriousHits')
      }
    }
    if (start + m < text.length) {
      // Roll: take the leaving character out, bring the arriving one in. Constant time, whatever m is.
      window = (BASE * (window - text.charCodeAt(start) * high) + text.charCodeAt(start + m)) % MODULUS
      if (window < 0) window += MODULUS
      rec.where(6, { window })
      rec.step('update', `roll the hash forward: drop "${text[start]}", add "${text[start + m]}" → ${window}`, [start + 1])
      rec.count('rolls')
    }
  }
  return finish(rec, 'Rabin-Karp', text, pattern, at, spurious)
}

// ---------------------------------------------------------------- the registry

export type StringName = 'naive-match' | 'kmp' | 'rabin-karp'

export const STRING_NAMES: readonly StringName[] = Object.freeze(['naive-match', 'kmp', 'rabin-karp'])

export function runString(name: StringName, text: string, pattern: string, ceiling?: number): Run | AlgorithmError {
  switch (name) {
    case 'naive-match':
      return naiveMatch(text, pattern, ceiling)
    case 'kmp':
      return knuthMorrisPratt(text, pattern, ceiling)
    case 'rabin-karp':
      return rabinKarp(text, pattern, ceiling)
    default:
      return fail('unknown', `There is no string algorithm called "${String(name)}".`, `Choose one of: ${STRING_NAMES.join(', ')}.`)
  }
}
