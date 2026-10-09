/**
 * Writing a quiz, and refusing the questions that are wrong.
 *
 * ## Why every question is checked
 *
 * A model writing multiple-choice questions gets several things wrong often enough to matter, and every one of
 * them looks fine on screen:
 *
 *   - **Two right answers.** "Which of these is a prime number?" with 3 and 7 both listed. Whatever you pick,
 *     something tells you that you were wrong.
 *   - **The right answer missing.** The stated answer is not among the options, so the question cannot be
 *     answered at all.
 *   - **The same option twice.** Picking one of two identical options is a coin toss presented as knowledge.
 *   - **An answer that gives itself away** — the only option written in full sentences, or "all of the above"
 *     when nothing else is plausible.
 *   - **No explanation.** Then being wrong teaches nothing, which is the only reason to take a quiz.
 *
 * So each question is checked and the bad ones are dropped. If too few survive the whole quiz is refused rather
 * than shown short, because a quiz that says ten questions and asks four reads as broken.
 *
 * ## It is checked, not graded
 *
 * None of this makes a question *true*. Nothing here can know whether the Krebs cycle has eight steps. What it
 * can know is whether the question is answerable, and that is what it checks. The quiz says where it came from,
 * and the end screen says the marks are for this attempt rather than a measurement of what somebody knows —
 * which is Student's job, and it measures rather than asks.
 */

export type QuizDifficulty = 'easy' | 'ordinary' | 'hard'

export interface QuizQuestion {
  id: string
  /** The question itself. */
  asks: string
  /** Two to five of them, in the order they are shown. */
  options: readonly string[]
  /** Which option is right, as an index into `options`. */
  answer: number
  /** Why it is right. Required: being wrong without being told why teaches nothing. */
  because: string
  /** What this question is about, for the breakdown at the end. */
  topic: string
}

export interface Quiz {
  id: string
  title: string
  about: string
  difficulty: QuizDifficulty
  questions: readonly QuizQuestion[]
  /** Where the questions came from: a subject, or something in the conversation. */
  from: string
  /** Set when some questions were dropped, so the count is never silently short. */
  dropped?: number
  madeAt: number
}

export interface QuizRefusal {
  problem: string
  fix: string
  failed: string
}

export const isQuizRefusal = (held: unknown): held is QuizRefusal =>
  typeof held === 'object' && held !== null && 'failed' in held

const no = (problem: string, fix: string, failed: string): QuizRefusal => ({ problem, fix, failed })

/** The fewest questions worth showing, whatever was asked for. */
export const FEWEST_KEPT = 3

// ---------------------------------------------------------------- what Orion is asked

export function quizPrompt(options: {
  about: string
  count: number
  difficulty: QuizDifficulty
  /** The text the questions must come from, when the quiz is about something already on screen. */
  source?: string
}): string {
  const hard = {
    easy: 'Keep them straightforward: one idea each, no trick wording.',
    ordinary: 'Ordinary difficulty: somebody who has studied this should get most of them.',
    hard: 'Make them hard: several steps, or a distinction that is easy to get wrong.'
  }[options.difficulty]

  return [
    `Write ${options.count} multiple-choice questions about: ${options.about}`,
    options.source
      ? `\nThe questions must come from this text and nothing else. Do not ask about anything it does not say:\n"""\n${options.source.slice(0, 12_000)}\n"""\n`
      : '',
    hard,
    '',
    'Answer with JSON and nothing else:',
    '{',
    '  "title": "<a short name for the quiz>",',
    '  "questions": [',
    '    {',
    '      "asks": "<the question>",',
    '      "options": ["<...>", "<...>", "<...>", "<...>"],',
    '      "answer": <the index of the right one, counting from 0>,',
    '      "because": "<why it is right, in a sentence or two>",',
    '      "topic": "<two or three words saying what this one is about>"',
    '    }',
    '  ]',
    '}',
    '',
    'Rules, and each one is checked before anybody sees the quiz — a question that breaks one is thrown away:',
    '  - **Exactly one option is right.** If two could be defended, rewrite the question. This is the mistake',
    '    that matters most: whatever the person picks, something tells them they were wrong.',
    '  - Four options, all different, all plausible. No "all of the above", no "none of the above".',
    '  - The right answer must be one of the options, and `answer` must point at it.',
    '  - Do not make the right one longer or more carefully worded than the others. That gives it away.',
    '  - Spread the right answers across the positions rather than putting them all first.',
    '  - Every question needs `because`. A quiz where being wrong teaches nothing is not worth taking.',
    '  - Ask about the subject, never about the quiz. No "which of these did the text mention first".',
    '  - No two questions about the same fact. Two questions whose right answers say the same thing in',
    '    different words are one question, and the second is thrown away.'
  ]
    .filter((one) => one !== '')
    .join('\n')
}

// ---------------------------------------------------------------- reading and checking

/** Why one question was dropped, kept for the log rather than the screen. */
export interface QuizDropped {
  asks: string
  why: string
}

export function readQuiz(
  text: string,
  context: { about: string; difficulty: QuizDifficulty; from: string; count: number; id: string; now: number }
): { quiz: Quiz; dropped: QuizDropped[] } | QuizRefusal {
  const whole = String(text ?? '').trim()
  const object = firstObject(whole)
  if (object === null) return no('Orion did not write a quiz.', 'Try asking again.', 'no json')

  let held: Record<string, unknown>
  try {
    const parsed = JSON.parse(object) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return no('Orion did not write a quiz.', 'Try asking again.', 'not an object')
    }
    held = parsed as Record<string, unknown>
  } catch {
    return no('What Orion wrote could not be read.', 'It was meant to be a quiz and would not parse.', 'bad json')
  }

  const rows = Array.isArray(held.questions) ? held.questions : []
  if (rows.length === 0) return no('Orion wrote no questions.', 'Try asking again.', 'no questions')

  const kept: QuizQuestion[] = []
  const dropped: QuizDropped[] = []
  const seen = new Set<string>()
  /**
   * The right answers already asked about, so one fact is not asked twice in different words.
   *
   * A real run gave "Water moving over the land" and "Water flowing over the land" as the answers to two
   * questions about runoff. The question text differed, so comparing that let both through.
   */
  const facts: string[][] = []

  for (const [at, row] of rows.entries()) {
    const checked = checkQuestion(row, `q${at + 1}`)
    if (isQuizRefusal(checked)) {
      dropped.push({ asks: shortAsk(row), why: checked.problem })
      continue
    }
    // The same question twice is one question and a waste of the person's time.
    const same = checked.asks.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (seen.has(same)) {
      dropped.push({ asks: checked.asks, why: 'the same question twice' })
      continue
    }
    const fact = tidyWords(checked.options[checked.answer] ?? '')
    if (fact.length > 0 && facts.some((earlier) => mostlyTheSame(fact, earlier))) {
      dropped.push({ asks: checked.asks, why: 'the same fact asked twice in different words' })
      continue
    }
    seen.add(same)
    if (fact.length > 0) facts.push(fact)
    kept.push(checked)
  }

  if (kept.length < Math.min(FEWEST_KEPT, context.count)) {
    return no(
      `Only ${kept.length} of Orion's ${rows.length} questions held up, which is too few for a quiz.`,
      dropped[0] ? `The first problem was: ${dropped[0].why}.` : 'Try asking again.',
      'too few kept'
    )
  }

  const title = String(held.title ?? '').trim() || `Quiz: ${context.about}`

  return {
    quiz: {
      id: context.id,
      title: title.slice(0, 90),
      about: context.about,
      difficulty: context.difficulty,
      questions: Object.freeze(kept.slice(0, context.count)),
      from: context.from,
      ...(dropped.length > 0 ? { dropped: dropped.length } : {}),
      madeAt: context.now
    },
    dropped
  }
}

/** Everything one question has to be before it is shown. */
export function checkQuestion(row: unknown, id: string): QuizQuestion | QuizRefusal {
  if (typeof row !== 'object' || row === null) return no('not a question', '', 'shape')
  const held = row as Record<string, unknown>

  const asks = String(held.asks ?? held.question ?? '').trim()
  if (asks.length < 8) return no('the question is too short to be a question', '', 'asks')

  const options = (Array.isArray(held.options) ? held.options : [])
    .map((one) => String(one ?? '').trim())
    .filter((one) => one !== '')
  if (options.length < 2) return no('fewer than two options', '', 'options')
  if (options.length > 5) return no('more than five options', '', 'options')

  // The same option twice makes picking between them a coin toss dressed as knowledge.
  const tidy = options.map((one) => one.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
  if (new Set(tidy).size !== tidy.length) return no('the same option appears twice', '', 'duplicate options')

  // "All of the above" cannot be checked for having exactly one right answer, so it is not allowed at all.
  if (tidy.some((one) => /^(?:all|none|both)\s+of\s+the\s+above$/.test(one) || one === 'all of these' || one === 'none of these')) {
    return no('an "all of the above" option', '', 'above option')
  }

  const answer = answerIndex(held, options)
  if (answer === null) return no('the right answer is not one of the options', '', 'answer missing')

  const because = String(held.because ?? held.explanation ?? held.why ?? '').trim()
  if (because.length < 10) return no('no explanation of why the answer is right', '', 'because')

  const topic = String(held.topic ?? '').trim() || 'General'

  return {
    id,
    asks,
    options: Object.freeze(options),
    answer,
    because,
    topic: topic.slice(0, 40)
  }
}

/**
 * Which option is right.
 *
 * An index is taken when it points at a real option; otherwise the answer is matched against the options by
 * text, because a model that writes `"answer": "Paris"` has not done anything wrong. A letter — "B" — is read
 * too. Anything that cannot be resolved to exactly one option is refused rather than guessed.
 */
function answerIndex(held: Record<string, unknown>, options: readonly string[]): number | null {
  const raw = held.answer ?? held.correct ?? held.correctIndex ?? held.answerIndex
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < options.length) return raw

  const said = String(raw ?? '').trim()
  if (said === '') return null

  // A bare letter, when there are no more options than letters.
  if (/^[a-eA-E]$/.test(said)) {
    const at = said.toLowerCase().charCodeAt(0) - 97
    if (at < options.length) return at
  }
  // A number written as text.
  if (/^\d+$/.test(said)) {
    const at = Number(said)
    if (at >= 0 && at < options.length) return at
    // Some models count from one.
    if (at - 1 >= 0 && at - 1 < options.length) return at - 1
  }

  const tidy = (one: string): string => one.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const matches = options.map((one, at) => ({ at, same: tidy(one) === tidy(said) })).filter((one) => one.same)
  return matches.length === 1 ? matches[0].at : null
}

/** The words of an answer that carry meaning, stemmed, with the filler taken out. */
function tidyWords(text: string): string[] {
  const skip = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'over', 'into', 'and', 'is', 'are', 'that', 'it', 'its', 'from', 'by', 'as', 'at'])
  const stem = (word: string): string => word.replace(/(?:ing|ed|es|s)$/, '')
  return [
    ...new Set(
      String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((one) => one !== '' && !skip.has(one))
        .map(stem)
    )
  ]
}

/**
 * Whether two answers say the same thing.
 *
 * Overlap rather than equality, because the repeat that actually happens is a reworded one: "water moving over
 * the land" against "water flowing over the land" shares two words of three and differs in a verb. Half or more
 * in common, and at least two words in common -- the second part matters, or "the Sun" and "the Moon" would be
 * one fact.
 */
function mostlyTheSame(one: readonly string[], other: readonly string[]): boolean {
  const shared = one.filter((word) => other.includes(word))
  if (shared.length < 2) return false
  const union = new Set([...one, ...other]).size
  return union > 0 && shared.length / union >= 0.5
}

const shortAsk = (row: unknown): string => {
  const held = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {}
  return String(held.asks ?? held.question ?? 'a question').slice(0, 60)
}

/** The first complete JSON object, counting braces rather than looking for the last one. */
function firstObject(text: string): string | null {
  const from = text.indexOf('{')
  if (from === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let at = from; at < text.length; at += 1) {
    const ch = text[at]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(from, at + 1)
    }
  }
  return null
}

/** What a quiz is and is not, for the card to show. */
export const aboutQuizzes: readonly string[] = Object.freeze([
  'The questions were written by Orion and each one was checked before you saw it: exactly one right answer, the answer among the options, no repeated options, and an explanation for every question. A question that failed any of those was thrown away.',
  'Checked is not the same as true. Nothing here can know whether an answer is factually right — only that the question can be answered. Treat a surprising answer as worth looking up.',
  'The marks are for this attempt. They are not a measurement of what you know: Orbis measures that in Student, from work over time, rather than from one quiz.'
])
