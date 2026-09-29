/**
 * Linguistics: counting what is in a text, measuring how hard it is, and comparing words.
 *
 * The shared linguistics engine for Orbis Pages. Every readability score names its formula and the grade scale it
 * is on, syllable counts say they are estimated, and nothing here claims to detect a language, an author or a
 * sentiment — those are judgements and this engine only counts.
 *
 * ## Why readability scores come in a set, never alone
 *
 * The scores disagree, sometimes by four grade levels on the same text, because they weigh sentence length and word
 * length differently and were each fitted on a particular corpus — Flesch-Kincaid on US Navy training manuals,
 * Dale-Chall on a list of words fourth-graders knew in 1948. A single score presented as "the reading level" hides
 * that. All of them are returned, with the spread reported, so the disagreement is the finding.
 *
 * ## Why syllable counts are estimates and say so
 *
 * English syllable counting by rule is about 85-90% accurate and cannot be better without a pronunciation
 * dictionary, because the spelling does not determine it: "business" is two syllables and "busyness" is three.
 * Every readability score that uses syllables inherits that error, which is one reason they disagree.
 *
 * ## What this engine will not do
 *
 * It will not identify a language, guess an author, score sentiment, or judge quality. Those need either a model or
 * a corpus, this has neither, and a number produced without them would be a fabrication wearing the clothes of a
 * measurement.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * token     vs  type          -- every word against every distinct word
 * character vs  grapheme      -- a code unit against what a reader sees as one letter
 * word      vs  lemma         -- "running" against "run"
 * readable  vs  simple        -- a score against whether anyone understands it
 * similar   vs  related       -- spelled alike against meaning alike; this measures only the first
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface LinguisticsError {
  error: 'invalid-argument' | 'too-short' | 'too-long' | 'out-of-range' | 'no-solution'
  message: string
}

export const isLinguisticsError = (value: unknown): value is LinguisticsError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: LinguisticsError['error'], message: string): LinguisticsError => ({ error, message })

export const LINGUISTICS_LIMITS = Object.freeze({
  characters: 200_000,
  words: 40_000,
  wordLength: 200,
  pairs: 400
})

// ---------------------------------------------------------------- counting

export interface TextStats {
  /** Code points, not code units. An emoji is one character here and two in a naive length. */
  characters: number
  charactersNoSpaces: number
  /** What a reader sees as one letter, counting combining marks with their base. */
  graphemes: number
  words: number
  /** Distinct words, lowercased. */
  uniqueWords: number
  sentences: number
  paragraphs: number
  syllables: number
  /** Words of three or more syllables, which several readability formulas key on. */
  polysyllabicWords: number
  averageWordsPerSentence: number
  averageSyllablesPerWord: number
  averageCharactersPerWord: number
  /** Distinct words over total words. Falls as a text gets longer, so it is only comparable at equal length. */
  typeTokenRatio: number
  /** A length-corrected version, which is comparable across different lengths. */
  rootTypeTokenRatio: number
  /** The most frequent words, longest first. */
  frequencies: readonly { word: string; count: number; share: number }[]
  /** Words appearing exactly once, which is a large fraction of any real text. */
  hapaxCount: number
  notes: readonly string[]
  warnings: readonly string[]
}

const SENTENCE_END = /[.!?]+(?=\s|$)/g

/** Split into words, keeping apostrophes and internal hyphens, which are part of words rather than punctuation. */
const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}'-]+/u)
    .map((one) => one.replace(/^[-']+|[-']+$/g, ''))
    .filter((one) => one.length > 0)

/**
 * Estimate the syllables in an English word.
 *
 * By rule, which is about 85-90% accurate and cannot be better without a pronunciation dictionary. The spelling
 * does not determine the answer: "business" is two syllables and "busyness" is three, and no rule distinguishes
 * them. Every readability score built on syllables inherits this error.
 */
export function syllablesIn(word: string): number {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '')
  if (clean.length === 0) return 0
  if (clean.length <= 3) return 1

  let working = clean
  // A trailing silent e, and the common suffixes that behave the same way.
  working = working.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
  working = working.replace(/^y/, '')
  // Up to three vowels in a run count as one syllable, which gets "beau" right. Two would split it in two, and
  // four would merge syllables that really are separate. Three is the best a single rule does.
  const groups = working.match(/[aeiouy]{1,3}/g)
  return Math.max(1, groups === null ? 0 : groups.length)
}

/** Count what a reader sees as one letter: a base character plus any combining marks. */
const graphemesIn = (text: string): number => {
  let count = 0
  for (const character of text) {
    // Skip combining marks, which attach to the character before them.
    if (/\p{M}/u.test(character)) continue
    count += 1
  }
  return count
}

export function textStats(input: { text: string; topWords?: number }): TextStats | LinguisticsError {
  const { text } = input
  if (typeof text !== 'string') return fail('invalid-argument', 'The text has to be a string.')
  if (text.length > LINGUISTICS_LIMITS.characters) {
    return fail('too-long', `That is ${text.length} characters; this handles up to ${LINGUISTICS_LIMITS.characters}.`)
  }

  const words = wordsOf(text)
  if (words.length > LINGUISTICS_LIMITS.words) {
    return fail('too-long', `That is ${words.length} words; this handles up to ${LINGUISTICS_LIMITS.words}.`)
  }

  const characters = [...text].length
  const charactersNoSpaces = [...text.replace(/\s/g, '')].length
  const sentenceMatches = text.match(SENTENCE_END)
  // A text with no terminal punctuation is still one sentence, not zero — dividing by zero would make every
  // readability score infinite.
  const sentences = Math.max(1, sentenceMatches === null ? (words.length > 0 ? 1 : 0) : sentenceMatches.length)
  const paragraphs = Math.max(1, text.split(/\n\s*\n/).filter((one) => one.trim().length > 0).length)

  const counts = new Map<string, number>()
  let syllables = 0
  let polysyllabic = 0
  let wordCharacters = 0
  for (const word of words) {
    if (word.length > LINGUISTICS_LIMITS.wordLength) {
      return fail('invalid-argument', `A "word" of ${word.length} characters is not a word; this handles up to ${LINGUISTICS_LIMITS.wordLength}.`)
    }
    counts.set(word, (counts.get(word) ?? 0) + 1)
    const s = syllablesIn(word)
    syllables += s
    if (s >= 3) polysyllabic += 1
    wordCharacters += [...word].length
  }

  const frequencies = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, Math.min(Math.round(input.topWords ?? 20), 500)))
    .map(([word, count]) => ({ word, count, share: words.length === 0 ? 0 : count / words.length }))

  const hapax = [...counts.values()].filter((one) => one === 1).length
  const warnings: string[] = []
  if (words.length < 100) {
    warnings.push(
      `Only ${words.length} words. Every readability formula was fitted on passages of at least a hundred words, and below that they are unstable — one long sentence moves the score by grade levels.`
    )
  }
  if (sentenceMatches === null && words.length > 0) {
    warnings.push('No sentence-ending punctuation was found, so the whole text was counted as one sentence. Every sentence-length measure below is therefore about the text as a whole.')
  }

  return {
    characters,
    charactersNoSpaces,
    graphemes: graphemesIn(text),
    words: words.length,
    uniqueWords: counts.size,
    sentences,
    paragraphs,
    syllables,
    polysyllabicWords: polysyllabic,
    averageWordsPerSentence: words.length / sentences,
    averageSyllablesPerWord: words.length === 0 ? 0 : syllables / words.length,
    averageCharactersPerWord: words.length === 0 ? 0 : wordCharacters / words.length,
    typeTokenRatio: words.length === 0 ? 0 : counts.size / words.length,
    rootTypeTokenRatio: words.length === 0 ? 0 : counts.size / Math.sqrt(words.length),
    frequencies: Object.freeze(frequencies),
    hapaxCount: hapax,
    notes: Object.freeze([
      `${words.length} words, ${counts.size} of them distinct, in ${sentences} sentences.`,
      'The type-token ratio falls as a text gets longer whatever its vocabulary, so two texts of different lengths cannot be compared on it. The root version corrects for that and is the one to use.',
      `${hapax} words appear exactly once — ${((hapax / Math.max(counts.size, 1)) * 100).toFixed(0)}% of the distinct vocabulary. A large fraction of once-only words is normal in any real text, not a sign of anything.`,
      'Syllable counts are estimated by rule and are about 85-90% accurate. The spelling does not determine the answer, so no rule can do better without a pronunciation dictionary.',
      'Characters are counted as code points and graphemes separately, because an emoji or an accented letter is one thing to a reader and several to a naive length.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- readability

export type ReadabilityFormula =
  | 'flesch-reading-ease'
  | 'flesch-kincaid-grade'
  | 'gunning-fog'
  | 'smog'
  | 'coleman-liau'
  | 'automated-readability'

export const READABILITY_FORMULAS: readonly ReadabilityFormula[] = Object.freeze([
  'flesch-reading-ease',
  'flesch-kincaid-grade',
  'gunning-fog',
  'smog',
  'coleman-liau',
  'automated-readability'
])

export const READABILITY_FACTS: Readonly<
  Record<ReadabilityFormula, { label: string; scale: string; fittedOn: string; usesSyllables: boolean; minimumWords: number }>
> = Object.freeze({
  'flesch-reading-ease': {
    label: 'Flesch Reading Ease',
    scale: '0 to 100, higher is easier. 60-70 is plain English; below 30 is very hard.',
    fittedOn: 'Rudolf Flesch, 1948, on adult reading material. Not a grade level — the only score here that is not.',
    usesSyllables: true,
    minimumWords: 100
  },
  'flesch-kincaid-grade': {
    label: 'Flesch-Kincaid Grade Level',
    scale: 'US school grade. 8 means an average eighth-grader could read it.',
    fittedOn: 'Kincaid et al., 1975, for US Navy technical training manuals. That is the register it describes.',
    usesSyllables: true,
    minimumWords: 100
  },
  'gunning-fog': {
    label: 'Gunning Fog Index',
    scale: 'Years of formal education needed on a first reading.',
    fittedOn: 'Robert Gunning, 1952, on business writing. Counts words of three or more syllables as "complex", which penalises perfectly familiar long words.',
    usesSyllables: true,
    minimumWords: 100
  },
  smog: {
    label: 'SMOG',
    scale: 'US school grade needed for full comprehension, not just reading.',
    fittedOn: 'McLaughlin, 1969, on health materials. Designed around 100% comprehension rather than 50-75%, so it reads two grades higher than the others by design.',
    usesSyllables: true,
    minimumWords: 30
  },
  'coleman-liau': {
    label: 'Coleman-Liau Index',
    scale: 'US school grade.',
    fittedOn: 'Coleman and Liau, 1975. Uses letters per word instead of syllables, so it avoids the syllable-counting error entirely — a real advantage over the others.',
    usesSyllables: false,
    minimumWords: 100
  },
  'automated-readability': {
    label: 'Automated Readability Index',
    scale: 'US school grade, roughly age minus 5.',
    fittedOn: 'Smith and Senter, 1967, for the US Air Force. Also uses characters rather than syllables.',
    usesSyllables: false,
    minimumWords: 100
  }
})

export interface ReadabilityReport {
  /** Every formula, because they disagree and the disagreement is the finding. */
  scores: readonly {
    formula: ReadabilityFormula
    label: string
    value: number
    scale: string
    fittedOn: string
    usesSyllables: boolean
    reliable: boolean
  }[]
  /** The grade-level scores only, so a spread can be quoted. */
  gradeRange: { lowest: number; highest: number; spread: number; median: number } | null
  stats: TextStats
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Every readability score at once, with the spread between them reported.
 *
 * Returning one score would be the wrong shape for the question. They routinely differ by three or four grade
 * levels on the same passage, because they weigh sentence length and word length differently and were fitted on
 * different material. The spread is the useful output: a tight spread means the text is consistently pitched, and a
 * wide one means the formulas are disagreeing about whether long sentences or long words are the problem.
 */
export function readability(input: { text: string }): ReadabilityReport | LinguisticsError {
  const stats = textStats({ text: input.text })
  if (isLinguisticsError(stats)) return stats
  if (stats.words === 0) return fail('too-short', 'There are no words to score.')

  const wps = stats.averageWordsPerSentence
  const spw = stats.averageSyllablesPerWord
  const letters = stats.charactersNoSpaces
  const lettersPer100 = (letters / stats.words) * 100
  const sentencesPer100 = (stats.sentences / stats.words) * 100
  const complexShare = (stats.polysyllabicWords / stats.words) * 100

  const value = (formula: ReadabilityFormula): number => {
    switch (formula) {
      case 'flesch-reading-ease':
        return 206.835 - 1.015 * wps - 84.6 * spw
      case 'flesch-kincaid-grade':
        return 0.39 * wps + 11.8 * spw - 15.59
      case 'gunning-fog':
        return 0.4 * (wps + complexShare)
      case 'smog':
        // The full form, valid for any number of sentences rather than the 30-sentence shortcut.
        return 1.0430 * Math.sqrt(stats.polysyllabicWords * (30 / stats.sentences)) + 3.1291
      case 'coleman-liau':
        return 0.0588 * lettersPer100 - 0.296 * sentencesPer100 - 15.8
      default:
        return 4.71 * (letters / stats.words) + 0.5 * wps - 21.43
    }
  }

  const scores = READABILITY_FORMULAS.map((formula) => {
    const facts = READABILITY_FACTS[formula]
    return {
      formula,
      label: facts.label,
      value: value(formula),
      scale: facts.scale,
      fittedOn: facts.fittedOn,
      usesSyllables: facts.usesSyllables,
      reliable: stats.words >= facts.minimumWords
    }
  })

  const grades = scores.filter((one) => one.formula !== 'flesch-reading-ease').map((one) => one.value)
  const sortedGrades = [...grades].sort((a, b) => a - b)
  const gradeRange =
    grades.length === 0
      ? null
      : {
          lowest: sortedGrades[0],
          highest: sortedGrades[sortedGrades.length - 1],
          spread: sortedGrades[sortedGrades.length - 1] - sortedGrades[0],
          median:
            sortedGrades.length % 2 === 1
              ? sortedGrades[(sortedGrades.length - 1) / 2]
              : (sortedGrades[sortedGrades.length / 2 - 1] + sortedGrades[sortedGrades.length / 2]) / 2
        }

  const warnings: string[] = [...stats.warnings]
  if (gradeRange !== null && gradeRange.spread > 3) {
    warnings.push(
      `The grade-level formulas disagree by ${gradeRange.spread.toFixed(1)} grades. That usually means long sentences and long words are pulling in different directions — worth looking at which, rather than picking whichever score suits.`
    )
  }
  if (scores.some((one) => !one.reliable)) {
    warnings.push('Some formulas need more words than this text has and their scores are marked as not reliable rather than being withheld.')
  }

  return {
    scores: Object.freeze(scores),
    gradeRange,
    stats,
    notes: Object.freeze([
      'Every formula is returned rather than one, because they disagree — often by three or four grade levels on the same text — and the disagreement is more informative than any single number.',
      gradeRange !== null
        ? `The grade-level scores run from ${gradeRange.lowest.toFixed(1)} to ${gradeRange.highest.toFixed(1)}, with a median of ${gradeRange.median.toFixed(1)}.`
        : 'No grade-level scores were computed.',
      'Coleman-Liau and the Automated Readability Index use letter counts rather than syllables, so they avoid the syllable-estimation error the others carry. Where they agree with the syllable-based scores, that agreement means something.',
      'None of these measures whether anyone understands the text. They measure sentence length and word length, which correlate with difficulty and are not the same as it — a passage of short familiar words in short sentences can still be incomprehensible.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- comparing words

export interface DistanceReport {
  /** The number of single-character edits to turn one into the other. */
  levenshtein: number
  /** Levenshtein allowing a transposition as one edit rather than two. */
  damerauLevenshtein: number
  /** 0 to 1, where 1 is identical. Length-normalised, so it is comparable across different word lengths. */
  similarity: number
  /** Jaro-Winkler, which weights a shared prefix. Better for names than plain edit distance. */
  jaroWinkler: number
  /** How each was reached, so the answer can be checked. */
  operations: readonly { kind: 'match' | 'substitute' | 'insert' | 'delete'; from: string; to: string; at: number }[]
  notes: readonly string[]
}

/**
 * How far apart two strings are, by several measures.
 *
 * Several, because they rank differently and the right one depends on the job: plain edit distance treats a
 * transposition as two changes, Damerau-Levenshtein as one (which suits typing errors), and Jaro-Winkler weights a
 * shared prefix (which suits names, where the start is more reliable than the end).
 *
 * None of these measures meaning. "cat" and "car" are one edit apart and unrelated; "cat" and "feline" are six
 * edits apart and mean nearly the same thing.
 */
export function stringDistance(input: { first: string; second: string }): DistanceReport | LinguisticsError {
  const { first, second } = input
  if (typeof first !== 'string' || typeof second !== 'string') return fail('invalid-argument', 'Both have to be strings.')
  const a = [...first]
  const b = [...second]
  if (a.length > 2000 || b.length > 2000) return fail('too-long', 'Both strings have to be under 2000 characters.')

  // Full matrix, so the edit path can be reported rather than just the number.
  const rows = a.length + 1
  const cols = b.length + 1
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i += 1) d[i][0] = i
  for (let j = 0; j < cols; j += 1) d[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  const levenshtein = d[a.length][b.length]

  // Damerau, with the adjacent-transposition step added.
  const t: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let i = 0; i < rows; i += 1) t[i][0] = i
  for (let j = 0; j < cols; j += 1) t[0][j] = j
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      t[i][j] = Math.min(t[i - 1][j] + 1, t[i][j - 1] + 1, t[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        t[i][j] = Math.min(t[i][j], t[i - 2][j - 2] + 1)
      }
    }
  }

  // Walk the matrix back to recover the edit path.
  const operations: DistanceReport['operations'][number][] = []
  let i = a.length
  let j = b.length
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      operations.push({
        kind: a[i - 1] === b[j - 1] ? 'match' : 'substitute',
        from: a[i - 1],
        to: b[j - 1],
        at: i - 1
      })
      i -= 1
      j -= 1
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      operations.push({ kind: 'delete', from: a[i - 1], to: '', at: i - 1 })
      i -= 1
    } else {
      operations.push({ kind: 'insert', from: '', to: b[j - 1], at: i })
      j -= 1
    }
  }
  operations.reverse()

  // Jaro-Winkler.
  const jaro = (): number => {
    if (a.length === 0 && b.length === 0) return 1
    if (a.length === 0 || b.length === 0) return 0
    const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
    const aMatched = new Array<boolean>(a.length).fill(false)
    const bMatched = new Array<boolean>(b.length).fill(false)
    let matches = 0
    for (let x = 0; x < a.length; x += 1) {
      const from = Math.max(0, x - window)
      const to = Math.min(b.length - 1, x + window)
      for (let y = from; y <= to; y += 1) {
        if (bMatched[y] || a[x] !== b[y]) continue
        aMatched[x] = true
        bMatched[y] = true
        matches += 1
        break
      }
    }
    if (matches === 0) return 0
    let transpositions = 0
    let y = 0
    for (let x = 0; x < a.length; x += 1) {
      if (!aMatched[x]) continue
      while (!bMatched[y]) y += 1
      if (a[x] !== b[y]) transpositions += 1
      y += 1
    }
    return (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3
  }
  const jaroScore = jaro()
  let prefix = 0
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1
  const jaroWinkler = jaroScore + prefix * 0.1 * (1 - jaroScore)

  const longest = Math.max(a.length, b.length)
  return {
    levenshtein,
    damerauLevenshtein: t[a.length][b.length],
    similarity: longest === 0 ? 1 : 1 - levenshtein / longest,
    jaroWinkler,
    operations: Object.freeze(operations),
    notes: Object.freeze([
      `${levenshtein} single-character edits, or ${t[a.length][b.length]} allowing transpositions as one.`,
      'Plain edit distance counts a transposition as two changes; Damerau-Levenshtein counts it as one, which fits typing errors better.',
      `Jaro-Winkler gives ${jaroWinkler.toFixed(4)}, weighting the ${prefix}-character shared prefix. That suits names, where the start is more reliably spelled than the end.`,
      'None of these measures meaning. "cat" and "car" are one edit apart and unrelated; "cat" and "feline" are six apart and nearly synonymous.'
    ])
  }
}

/**
 * Soundex and a refined phonetic key, for matching names that sound alike.
 *
 * Soundex dates from 1918 and is crude by design — it was built for clerks filing cards by hand. It matches
 * Smith and Smyth, and it also matches plenty of names that sound nothing alike, because it collapses all vowels
 * and keeps only four characters. It is included because a great many systems still index on it, so matching
 * against those systems requires it; it is not a good way to compare names now.
 */
export interface PhoneticReport {
  soundex: string
  /** A longer key that keeps more of the word, for comparison. */
  refinedKey: string
  /** How the code was built, step by step. */
  steps: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

const SOUNDEX_GROUPS: Readonly<Record<string, string>> = Object.freeze({
  b: '1', f: '1', p: '1', v: '1',
  c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
  d: '3', t: '3',
  l: '4',
  m: '5', n: '5',
  r: '6'
})

export function phoneticKey(input: { word: string }): PhoneticReport | LinguisticsError {
  const clean = input.word.toLowerCase().replace(/[^a-z]/g, '')
  if (clean.length === 0) return fail('invalid-argument', 'There are no letters to code. Soundex is defined for the Latin alphabet only.')

  const steps: string[] = [`Start from "${clean}".`]
  const first = clean[0].toUpperCase()
  let code = first
  let previous = SOUNDEX_GROUPS[clean[0]] ?? ''
  for (let i = 1; i < clean.length && code.length < 4; i += 1) {
    const letter = clean[i]
    const group = SOUNDEX_GROUPS[letter]
    if (group === undefined) {
      // h and w are transparent: they do not break a repeat. Vowels do.
      if (letter !== 'h' && letter !== 'w') previous = ''
      continue
    }
    if (group !== previous) {
      code += group
      steps.push(`"${letter}" is group ${group}, and differs from the previous group, so it is kept.`)
    } else {
      steps.push(`"${letter}" is group ${group}, the same as the letter before it, so it is dropped.`)
    }
    previous = group
  }
  const soundex = code.padEnd(4, '0')
  steps.push(`Padded to four characters: ${soundex}.`)

  // A longer key: the same grouping with no length cap and vowels marked rather than dropped, so it discriminates
  // between words Soundex collapses together.
  let refined = first
  let lastGroup = ''
  for (let i = 1; i < clean.length; i += 1) {
    const group = SOUNDEX_GROUPS[clean[i]] ?? '0'
    if (group !== lastGroup) refined += group
    lastGroup = group
  }

  return {
    soundex,
    refinedKey: refined,
    steps: Object.freeze(steps),
    notes: Object.freeze([
      `Soundex: ${soundex}. It keeps the first letter and three consonant groups, collapsing all vowels.`,
      'From 1918, built for clerks filing cards. It matches Smith and Smyth, and it also matches a great many names that sound nothing alike.',
      `The longer key ${refined} keeps the whole word, so it separates words Soundex collapses together.`,
      'Soundex is defined for English spelled in the Latin alphabet. It is meaningless for other writing systems and poor for names from other languages.'
    ]),
    warnings: Object.freeze([
      'Soundex is included because many existing systems index on it, so matching against them requires it. It is not a good way to compare names today — edit distance or Jaro-Winkler is better for almost every purpose.'
    ])
  }
}

// ---------------------------------------------------------------- vocabulary overlap

export interface OverlapReport {
  /** Words in both, as a fraction of words in either. */
  jaccard: number
  /** Words in both, as a fraction of the shorter vocabulary. */
  overlapCoefficient: number
  /** Angle between the two frequency vectors, which accounts for how often words appear rather than just whether. */
  cosineSimilarity: number
  sharedWords: readonly string[]
  onlyInFirst: readonly string[]
  onlyInSecond: readonly string[]
  firstVocabulary: number
  secondVocabulary: number
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * How much vocabulary two texts share, by three measures that answer different questions.
 *
 * Jaccard treats a word as present or absent; cosine similarity weights it by how often it appears. A long text and
 * a short one will always have a low Jaccard score simply because the long one has more words the short one lacks,
 * which is why the overlap coefficient — measured against the shorter vocabulary — is here too.
 *
 * This is vocabulary overlap, not similarity of meaning. Two texts on the same subject in different registers share
 * little vocabulary; two texts on opposite sides of an argument share almost all of it.
 */
export function vocabularyOverlap(input: {
  first: string
  second: string
  /** Words to ignore. Passed in rather than built in, because what counts as a stop word depends on the question. */
  ignore?: readonly string[]
}): OverlapReport | LinguisticsError {
  if (typeof input.first !== 'string' || typeof input.second !== 'string') {
    return fail('invalid-argument', 'Both texts have to be strings.')
  }
  const ignore = new Set((input.ignore ?? []).map((one) => one.toLowerCase()))
  const firstWords = wordsOf(input.first).filter((one) => !ignore.has(one))
  const secondWords = wordsOf(input.second).filter((one) => !ignore.has(one))
  if (firstWords.length === 0 || secondWords.length === 0) {
    return fail('too-short', 'One of the texts has no words left to compare after the ignore list was applied.')
  }

  const countsOf = (words: readonly string[]): Map<string, number> => {
    const out = new Map<string, number>()
    for (const one of words) out.set(one, (out.get(one) ?? 0) + 1)
    return out
  }
  const a = countsOf(firstWords)
  const b = countsOf(secondWords)

  const shared: string[] = []
  const onlyFirst: string[] = []
  for (const word of a.keys()) {
    if (b.has(word)) shared.push(word)
    else onlyFirst.push(word)
  }
  const onlySecond = [...b.keys()].filter((one) => !a.has(one))

  const union = a.size + b.size - shared.length
  const jaccard = union === 0 ? 0 : shared.length / union
  const overlapCoefficient = shared.length / Math.min(a.size, b.size)

  let dot = 0
  for (const word of shared) dot += (a.get(word) as number) * (b.get(word) as number)
  const magnitudeA = Math.sqrt([...a.values()].reduce((sum, one) => sum + one * one, 0))
  const magnitudeB = Math.sqrt([...b.values()].reduce((sum, one) => sum + one * one, 0))
  const cosine = magnitudeA === 0 || magnitudeB === 0 ? 0 : dot / (magnitudeA * magnitudeB)

  const warnings: string[] = []
  const ratio = Math.max(firstWords.length, secondWords.length) / Math.min(firstWords.length, secondWords.length)
  if (ratio > 3) {
    warnings.push(
      `One text is ${ratio.toFixed(1)} times the length of the other. The Jaccard score will be low for that reason alone — use the overlap coefficient, which measures against the shorter vocabulary.`
    )
  }
  if (ignore.size === 0) {
    warnings.push(
      'No words were ignored, so "the", "of" and "and" are counted like any other. Those dominate any English text and inflate every measure here. What counts as a stop word depends on the question, which is why the list is an argument.'
    )
  }

  return {
    jaccard,
    overlapCoefficient,
    cosineSimilarity: cosine,
    sharedWords: Object.freeze(shared.sort()),
    onlyInFirst: Object.freeze(onlyFirst.sort()),
    onlyInSecond: Object.freeze(onlySecond.sort()),
    firstVocabulary: a.size,
    secondVocabulary: b.size,
    notes: Object.freeze([
      `${shared.length} words in both, out of ${a.size} and ${b.size}. Jaccard ${jaccard.toFixed(4)}, overlap coefficient ${overlapCoefficient.toFixed(4)}, cosine ${cosine.toFixed(4)}.`,
      'Jaccard asks whether a word appears; cosine asks how often. They answer different questions and a text can score high on one and low on the other.',
      'This is vocabulary overlap, not similarity of meaning. Two texts arguing opposite sides of a question share nearly all their vocabulary.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const LINGUISTICS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Syllable counts are estimated by rule, about 85-90% accurate. Spelling does not determine syllables, so no rule can do better without a pronunciation dictionary.',
  'Every readability score is returned with its formula, its scale and the material it was fitted on. They disagree by several grade levels and the disagreement is reported.',
  'Readability measures sentence length and word length. It does not measure whether anyone understands the text.',
  'The type-token ratio falls with length whatever the vocabulary, so a length-corrected version is given alongside it.',
  'Characters are counted as code points and as graphemes separately, because an emoji is one thing to a reader and several to a naive length.',
  'String distances measure spelling, never meaning.',
  'Soundex is included for matching against systems that index on it. It is crude by design and better measures exist.',
  'Stop words are an argument, not a built-in list, because what counts as one depends on the question.',
  'This engine does not identify languages, guess authors, score sentiment or judge quality. Those need a model or a corpus and it has neither.'
])
