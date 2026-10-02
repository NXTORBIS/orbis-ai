/**
 * Looking at the page, for the things reading it cannot settle.
 *
 * Some requests are about what something looks like. "The thumbnail of the latest interview", "the red button", "the
 * chart on the right" -- a page's structure holds none of that. Every element may be a link with an image inside it
 * and an accessible name that is somebody's video title, and no amount of reading the tree says which picture is of
 * an interview.
 *
 * So this is the fallback, and three rules keep it a fallback rather than a habit:
 *
 *   1. **Only after reading has failed.** A screenshot costs a capture, a round trip and a large model; reading the
 *      page costs none of those and answers almost everything. Looking first would make every step slow to serve the
 *      few that need it -- and most of what used to look like "Orbis cannot see this button" was the locator stopping
 *      at a shadow boundary, not a limit of reading structure.
 *   2. **Only when the request was visual.** A locator that failed because the page moved on is a stale locator, and
 *      a picture tells you nothing about that. What justifies looking is a description nothing structural could match.
 *   3. **The answer is grounded, never obeyed.** The model is given the page's own numbered elements and has to pick
 *      one of those numbers. A number not in the snapshot is refused. Nothing here ever produces a coordinate to
 *      click, because a model's idea of where something is on an image is a guess and a click on a guess is a click
 *      on whatever happens to be there.
 */

/** One element as the page numbered it, which is all the model is allowed to choose between. */
export interface SeenElement {
  ref: number
  tag?: string
  role?: string
  label?: string
  href?: string
  value?: string
  inView?: boolean
}

/** The failures a picture could plausibly answer. Anything else is not a looking problem. */
const WORTH_LOOKING: ReadonlySet<string> = new Set(['not-found'])

/**
 * The words in a locator that describe something rather than name it exactly.
 *
 * A selector, an xpath or a ref is an exact address; if one of those failed, the page is not as the plan thought and
 * the answer is to look again at its structure, not at its pixels. Words are the case where a picture can help.
 */
export function describeWanted(params: Record<string, unknown> | undefined): string | null {
  const locator = (params?.locator ?? params) as Record<string, unknown> | undefined
  if (!locator || typeof locator !== 'object') return null
  if (locator.ref !== undefined || locator.selector !== undefined || locator.xpath !== undefined) return null

  const words = [locator.name, locator.text, locator.label, locator.placeholder]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
  if (!words.length) return null

  const role = typeof locator.role === 'string' && locator.role ? `${locator.role} ` : ''
  return `${role}${[...new Set(words)].join(' / ')}`.slice(0, 160)
}

/**
 * Whether this failure is one a picture could answer.
 *
 * Both halves have to hold: the browser could not find it, *and* what was being looked for was described in words.
 * Either alone is a different problem with a different answer.
 */
export function wantsEyes(kind: string, params: Record<string, unknown> | undefined): boolean {
  return WORTH_LOOKING.has(kind) && describeWanted(params) !== null
}

const NEWLINE = String.fromCharCode(10)

/**
 * The question put to the model, with the page's own elements as the only answers available.
 *
 * The elements are listed with their numbers because the number is what comes back. Asking "where is it" would get a
 * coordinate, which is a guess; asking "which of these" gets a choice between things that exist.
 */
export function visionQuestion(wanted: string, elements: readonly SeenElement[], page?: { title?: string; url?: string }): string {
  const rows = elements
    .slice(0, 60)
    .map((e) => {
      const what = [e.role || e.tag, e.label ? `"${String(e.label).slice(0, 70)}"` : '', e.href ? `-> ${String(e.href).slice(0, 50)}` : '', e.inView === false ? '(off screen)' : '']
        .filter(Boolean)
        .join(' ')
      return `${e.ref}. ${what}`
    })
    .join(NEWLINE)

  return [
    'This image is a web page as it looks right now.',
    page?.title || page?.url ? `It is ${page.title || page.url}.` : '',
    '',
    'These are the things on it that can be clicked or typed into, numbered:',
    rows,
    '',
    `Which one of those numbers is: ${wanted}`,
    '',
    'Answer with only the number. If none of them is it, answer: none.'
  ]
    .filter(Boolean)
    .join(NEWLINE)
}

/**
 * The choice, grounded against what the page actually offered.
 *
 * A number the snapshot does not contain is refused rather than passed on. The model is looking at a picture of a
 * page and is perfectly capable of answering with a number that means something to it and nothing to the browser, and
 * acting on that would be clicking at random while reporting that it had looked.
 */
export function readChoice(said: string, elements: readonly SeenElement[]): { ref: number } | { why: string } {
  const text = String(said ?? '').trim()
  if (!text) return { why: 'Nothing came back from looking at the page.' }
  if (/^\W*none\b/i.test(text)) return { why: 'Looking at the page, none of the things on it is that.' }

  // The first number in the reply. A model asked for only a number usually gives one, and sometimes a sentence first.
  const found = /-?\d+/.exec(text)
  if (!found) return { why: `Looking at the page gave no number: "${text.slice(0, 80)}"` }

  const ref = Number(found[0])
  const offered = elements.find((e) => e.ref === ref)
  if (!offered) return { why: `Looking at the page chose ${ref}, which is not one of the things on it.` }
  return { ref }
}
