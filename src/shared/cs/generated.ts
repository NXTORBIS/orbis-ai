/**
 * Problems made by Orion, once the written ones run out.
 *
 * ## Why this needs checking at all
 *
 * A model asked for a coding problem will produce one. It will also produce a problem whose test cases are wrong
 * — the right description with an expected output that no correct solution prints, or a constraint the examples
 * break. None of that looks wrong on screen; it looks like a problem. Somebody then loses an evening to it and
 * concludes they cannot code.
 *
 * So the model is asked for **a reference solution as well**, and nothing is offered until that solution has
 * been checked against the test cases the same model wrote. If its own two answers disagree, the problem is
 * discarded. That is not proof — the solution is read rather than run unless a sandbox is set up — but it
 * catches the common failure, which is a problem whose author never worked it through.
 *
 * ## What is never taken from the model
 *
 * - **XP.** Derived from the difficulty by the studio's own table. A model that could set its own rewards would
 *   hand out two hundred for a problem it made easy on purpose.
 * - **Acceptance.** A real statistic about real people. A generated problem shows nothing there rather than an
 *   invented percentage.
 * - **Topics.** Taken from the twenty-one the studio already uses, so the filters keep working and a model
 *   cannot invent a twenty-second.
 * - **The number.** Allocated here, after the written ones.
 *
 * ## It says what it is
 *
 * Every generated problem carries `generated: true` and the screens show it. A problem written by hand and one
 * written by a model are different things, and Progress counts them apart so the numbers stay honest.
 */

/** The difficulties, and what each is worth. The studio's own table — never the model's. */
export const DIFFICULTY_XP: Readonly<Record<string, number>> = Object.freeze({
  Easy: 25,
  Medium: 50,
  Hard: 100,
  Expert: 200
})

/** The twenty-one topics the studio filters by. A generated problem may use these and nothing else. */
export const TOPICS: readonly string[] = Object.freeze([
  'Array',
  'BFS',
  'Backtracking',
  'Binary Search',
  'DFS',
  'Design',
  'Divide and Conquer',
  'Dynamic Programming',
  'Graph',
  'Hash Table',
  'Heap',
  'Linked List',
  'Math',
  'Matrix',
  'Pointers',
  'Recursion',
  'Shortest Path',
  'Sliding Window',
  'Stack',
  'String',
  'Two Pointers'
])

export interface GeneratedProblem {
  id: string
  number: number
  slug: string
  title: string
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert'
  topics: readonly string[]
  /** Null, always. A real statistic about real attempts, which a new problem does not have. */
  acceptance: null
  description: string
  examples: readonly { input: string; output: string; explanation?: string }[]
  constraints: readonly string[]
  starter: Readonly<Record<string, string>>
  tests: readonly { input: string; expected: string; hidden?: boolean }[]
  complexity: { time: string; space: string }
  hints: readonly string[]
  xp: number
  /** True, always. The screens show it, and Progress counts these apart from the written ones. */
  generated: true
  /** How the reference solution was checked: by running it, or by reading it. */
  checkedBy: 'ran' | 'read'
  /** The language the reference solution was written in. */
  referenceLanguage: string
}

export interface GeneratedProblem_Refusal {
  problem: string
  /** What to do about it. */
  fix: string
  /** Which check it failed, for the log rather than the screen. */
  failed: string
}

export const isRefusal = (held: unknown): held is GeneratedProblem_Refusal =>
  typeof held === 'object' && held !== null && 'failed' in held

const no = (problem: string, fix: string, failed: string): GeneratedProblem_Refusal => ({ problem, fix, failed })

// ---------------------------------------------------------------- what the model is asked

/**
 * The instruction.
 *
 * It asks for the reference solution in the same breath as the problem, and says why: so the model knows its
 * tests will be checked against its own code and has a reason to work them out rather than invent them.
 */
export function promptFor(options: {
  /** What the problem should be about. One of `TOPICS`, or free words. */
  about: string
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert'
  /** Titles already in the library, so it does not write one of them again. */
  avoid: readonly string[]
  /** The language the reference solution should be in. */
  language: string
}): string {
  return [
    'Write one coding problem, in the style of a competitive-programming or interview question.',
    '',
    `Subject: ${options.about}`,
    `Difficulty: ${options.difficulty}`,
    options.avoid.length > 0
      ? `Do NOT write any of these, which already exist: ${options.avoid.slice(0, 40).join(', ')}.`
      : '',
    '',
    'Answer with JSON and nothing else:',
    '{',
    '  "title": "<a short name>",',
    '  "description": "<the problem, in full. Markdown is fine. Say exactly what to read and what to print>",',
    '  "topics": ["<one or more of the list below>"],',
    '  "examples": [{"input": "<as a person would write it>", "output": "<...>", "explanation": "<why>"}],',
    '  "constraints": ["<each bound on the input>"],',
    '  "tests": [{"input": "<exact stdin>", "expected": "<exact stdout>"}, …],',
    '  "complexity": {"time": "O(n)", "space": "O(1)"},',
    '  "hints": ["<a nudge, not the answer>", "<a bigger nudge>"]',
    '}',
    '',
    `Then, AFTER the closing brace, a complete and correct solution in ${options.language}, in a fenced code`,
    'block on its own:',
    '',
    '```',
    '<the solution — reads stdin, prints to stdout>',
    '```',
    '',
    'The code goes in the fence, NOT inside the JSON. Putting a whole program inside a JSON string means',
    'escaping every quote and newline in it, which goes wrong more often than it goes right.',
    '',
    `Topics must come from this list only: ${TOPICS.join(', ')}.`,
    '',
    'About the tests, which is the part that matters:',
    '  - At least four. "input" is exactly what the program reads on stdin, "expected" exactly what it prints.',
    '  - Include the examples among them, so what you showed and what you test agree.',
    '  - Include an edge case: the smallest input the constraints allow, and something degenerate.',
    `  - **Your reference solution will be run against your own tests before this problem is shown to anybody.**`,
    '    If they disagree, the problem is thrown away. So work each test out with the solution rather than',
    '    writing plausible-looking numbers.',
    '  - The problem must have exactly ONE correct output for each input. If more than one answer would be',
    '    right — "return any valid pair" — say in the description which one to print, for instance the',
    '    lexicographically smallest, or do not write that problem.',
    '',
    'Two parts, then: the JSON object, and one fenced block holding the solution. Nothing else.'
  ]
    .filter((one) => one !== '')
    .join('\n')
}

/**
 * Reads the reply: the JSON that describes the problem, and the fenced block that holds the solution.
 *
 * The two are read separately on purpose. A program inside a JSON string has to have every quote, backslash and
 * newline escaped, and a model gets that wrong often enough to lose a perfectly good problem to a broken
 * envelope. Outside the JSON, in a fence, nothing needs escaping.
 *
 * A reference inside the JSON is still taken, because a model that put it there has done nothing wrong.
 */
export function readReply(text: string): { held: Record<string, unknown> } | GeneratedProblem_Refusal {
  const whole = String(text ?? '').trim()

  const object = firstObject(whole)
  if (object === null) {
    return no('Orion did not write a problem.', 'Try again, or pick a different subject.', 'no json')
  }

  let held: Record<string, unknown>
  try {
    const parsed = JSON.parse(object.text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return no('Orion did not write a problem.', 'Try again.', 'not an object')
    }
    held = parsed as Record<string, unknown>
  } catch {
    return no('What Orion wrote could not be read.', 'The part describing the problem would not parse.', 'bad json')
  }

  // The fence after the JSON, which is where the solution was asked for.
  if (typeof held.reference !== 'string' || held.reference.trim() === '') {
    const fenced = firstFence(whole.slice(object.end))
    if (fenced !== null) held.reference = fenced
  }

  return { held }
}

/**
 * The first complete JSON object in the text, found by counting braces rather than by looking for the last one.
 *
 * `lastIndexOf('}')` was wrong here: the solution that follows the JSON very often contains a brace, so the
 * "object" ran on into the code and nothing parsed.
 */
function firstObject(text: string): { text: string; end: number } | null {
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
      if (depth === 0) return { text: text.slice(from, at + 1), end: at + 1 }
    }
  }
  return null
}

/** The contents of the first fenced block, whatever language is written on the fence. */
function firstFence(text: string): string | null {
  const match = /```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/.exec(text)
  if (match && match[1].trim() !== '') return match[1].trim()
  // No fence at all: whatever is left, if it looks like code rather than a sentence.
  const rest = text.trim()
  if (rest !== '' && /[;{}=()]/.test(rest)) return rest
  return null
}

// ---------------------------------------------------------------- the checks before the solution is run

export interface Proposed {
  title: string
  description: string
  topics: readonly string[]
  examples: readonly { input: string; output: string; explanation?: string }[]
  constraints: readonly string[]
  tests: readonly { input: string; expected: string }[]
  complexity: { time: string; space: string }
  hints: readonly string[]
  reference: string
}

/**
 * Everything checkable without running anything.
 *
 * Done first because it is free: a problem with two tests or a made-up topic is refused before a single
 * execution is spent on it.
 */
export function checkShape(
  held: Record<string, unknown>,
  options: { avoid: readonly string[] }
): Proposed | GeneratedProblem_Refusal {
  const title = String(held.title ?? '').trim()
  if (title.length < 3) return no('The problem has no title.', 'Try again.', 'title')
  if (title.length > 80) return no('The title is longer than a title.', 'Try again.', 'title length')

  const already = options.avoid.map((one) => one.toLowerCase().trim())
  if (already.includes(title.toLowerCase())) {
    return no(`"${title}" is already in the library.`, 'Ask for a different subject.', 'duplicate')
  }

  const description = String(held.description ?? '').trim()
  if (description.length < 40) {
    return no('The description is too short to be a problem.', 'Try again.', 'description')
  }

  const topics = (Array.isArray(held.topics) ? held.topics : [])
    .map((one) => String(one).trim())
    .filter((one) => TOPICS.includes(one))
  if (topics.length === 0) {
    return no(
      'None of the topics it gave are ones the studio knows.',
      `Topics have to come from the twenty-one the filters use.`,
      'topics'
    )
  }

  const examples = (Array.isArray(held.examples) ? held.examples : [])
    .filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
    .map((one) => ({
      input: String(one.input ?? '').trim(),
      output: String(one.output ?? '').trim(),
      ...(one.explanation ? { explanation: String(one.explanation).trim() } : {})
    }))
    .filter((one) => one.input !== '' && one.output !== '')
  if (examples.length === 0) {
    return no('It gave no worked examples.', 'A problem without one cannot be understood.', 'examples')
  }

  const tests = (Array.isArray(held.tests) ? held.tests : [])
    .filter((one): one is Record<string, unknown> => typeof one === 'object' && one !== null)
    .map((one) => ({ input: String(one.input ?? ''), expected: String(one.expected ?? '').trim() }))
    // An empty expected output is not a test: every program prints nothing when it fails.
    .filter((one) => one.expected !== '')
  if (tests.length < 3) {
    return no(
      `It gave ${tests.length} usable test${tests.length === 1 ? '' : 's'}, and three is the fewest worth judging on.`,
      'Try again.',
      'too few tests'
    )
  }

  // Two tests with the same input and different answers cannot both be right.
  const byInput = new Map<string, string>()
  for (const one of tests) {
    const held2 = byInput.get(one.input)
    if (held2 !== undefined && held2 !== one.expected) {
      return no(
        'Two of its tests give the same input different answers.',
        'The problem is not consistent with itself, so it was thrown away.',
        'contradictory tests'
      )
    }
    byInput.set(one.input, one.expected)
  }

  const reference = String(held.reference ?? '').trim()
  if (reference.length < 10) {
    return no(
      'It wrote no reference solution.',
      'Without one the tests cannot be checked, so the problem cannot be offered.',
      'no reference'
    )
  }

  const constraints = (Array.isArray(held.constraints) ? held.constraints : []).map((one) => String(one).trim()).filter(Boolean)
  const hints = (Array.isArray(held.hints) ? held.hints : []).map((one) => String(one).trim()).filter(Boolean)
  const complexityHeld = (typeof held.complexity === 'object' && held.complexity !== null ? held.complexity : {}) as Record<string, unknown>

  return {
    title,
    description,
    topics,
    examples,
    constraints,
    tests,
    complexity: {
      time: String(complexityHeld.time ?? '').trim() || 'not stated',
      space: String(complexityHeld.space ?? '').trim() || 'not stated'
    },
    hints,
    reference
  }
}

// ---------------------------------------------------------------- the check that matters

/** What running the reference against one test produced. */
export interface OneCheck {
  input: string
  expected: string
  got: string
  right: boolean
  /** Set when it could not be run or read at all. */
  broke?: string
}

/**
 * Whether the reference solution agrees with the tests.
 *
 * `runOne` is handed in: in the renderer it is the execution service, and in a test it is a function that knows
 * the answers. Nothing here reaches for a global, which is what makes this checkable without a window.
 *
 * Every test is checked rather than stopping at the first failure, because the useful thing to know is whether
 * the problem is a little wrong or entirely wrong.
 */
export async function checkAgainstReference(
  proposed: Proposed,
  runOne: (source: string, stdin: string) => Promise<{ stdout: string; origin: 'ran' | 'predicted'; broke?: string }>
): Promise<{ checks: OneCheck[]; checkedBy: 'ran' | 'read' } | GeneratedProblem_Refusal> {
  const checks: OneCheck[] = []
  let origin: 'ran' | 'predicted' = 'predicted'

  for (const test of proposed.tests) {
    let got
    try {
      got = await runOne(proposed.reference, test.input)
    } catch (error) {
      return no(
        'The reference solution could not be checked.',
        error instanceof Error ? error.message : String(error),
        'runner threw'
      )
    }
    if (got.broke) {
      return no(
        `Its own solution would not run: ${got.broke}`,
        'A problem whose reference solution does not work cannot be offered.',
        'reference broke'
      )
    }
    origin = got.origin
    const want = test.expected.replace(/\s+$/gm, '').trim()
    const mine = String(got.stdout ?? '').replace(/\s+$/gm, '').trim()
    checks.push({ input: test.input, expected: want, got: mine, right: want === mine })
  }

  const wrong = checks.filter((one) => !one.right)
  if (wrong.length > 0) {
    const first = wrong[0]
    return no(
      `Orion's own solution disagrees with ${wrong.length} of its ${checks.length} tests.`,
      `On "${shorten(first.input)}" it printed "${shorten(first.got)}" and the test expects "${shorten(first.expected)}". The problem was thrown away rather than shown.`,
      'reference disagrees'
    )
  }

  return { checks, checkedBy: origin === 'ran' ? 'ran' : 'read' }
}

// ---------------------------------------------------------------- putting it together

/**
 * A checked problem, in the shape the studio's pages already read.
 *
 * The number, the id and the XP are allocated here. Two of the tests are marked hidden — the ones that are not
 * among the examples, so what was shown stays visible and the rest is held back.
 */
export function assemble(options: {
  proposed: Proposed
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert'
  checkedBy: 'ran' | 'read'
  language: string
  /** The highest number already in the library. */
  after: number
  /** Starter code per language, built by the caller from the studio's own templates. */
  starter: Readonly<Record<string, string>>
}): GeneratedProblem {
  const { proposed, difficulty, after } = options
  const number = after + 1
  const shownInputs = new Set(proposed.examples.map((one) => one.input.trim()))

  return {
    id: `g${String(number).padStart(4, '0')}`,
    number,
    slug: slugFor(proposed.title),
    title: proposed.title,
    difficulty,
    topics: Object.freeze([...proposed.topics]),
    // Never invented: acceptance is a statistic about real attempts and this problem has had none.
    acceptance: null,
    description: proposed.description,
    examples: Object.freeze(proposed.examples.map((one) => Object.freeze({ ...one }))),
    constraints: Object.freeze([...proposed.constraints]),
    starter: Object.freeze({ ...options.starter }),
    tests: Object.freeze(
      proposed.tests.map((one) =>
        Object.freeze({
          input: one.input,
          expected: one.expected,
          // Hidden unless it is one of the examples, which were shown anyway.
          ...(shownInputs.has(one.input.trim()) ? {} : { hidden: true })
        })
      )
    ),
    complexity: { ...proposed.complexity },
    hints: Object.freeze([...proposed.hints]),
    // From the studio's own table, never from the model.
    xp: DIFFICULTY_XP[difficulty] ?? 25,
    generated: true,
    checkedBy: options.checkedBy,
    referenceLanguage: options.language
  }
}

export function slugFor(title: string): string {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'generated-problem'
}

const shorten = (text: string): string => {
  const one = String(text ?? '').replace(/\n/g, '↵')
  return one.length > 48 ? one.slice(0, 45) + '…' : one
}

/** What a generated problem is and is not, for the screen to show beside it. */
export const aboutThis: readonly string[] = Object.freeze([
  'This problem was written by Orion, and it was not shown until its own reference solution agreed with every one of its own test cases. A problem whose author never worked it through is the usual failure, and that is the check that catches it.',
  'Where the reference solution was read rather than run — which is the case unless a sandbox is set up — the agreement is a strong sign and not a proof.',
  'The XP comes from the studio’s own table by difficulty, never from the model, so a problem cannot set its own reward.',
  'There is no acceptance rate, because that is a statistic about real attempts and this problem has had none. An invented percentage would be the easiest thing here to fake.',
  'Progress counts generated problems separately from the written ones, so the numbers stay comparable.'
])
