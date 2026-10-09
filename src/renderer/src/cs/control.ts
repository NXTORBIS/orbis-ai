/**
 * Working the Computer Science Studio from outside it — for Orion, and for the orb.
 *
 * The same approach as the physics and chemistry studios, and for the same reason: their twenty-four sections
 * each hold their own state and share no store, so there is nothing to write to. The way in is the way a person
 * goes in — find the thing on screen and use it.
 *
 * Everything here reports what actually happened rather than what was asked for. A section that is not there
 * says so and lists what is; an algorithm that matches several says which.
 */

export interface ControlRefusal {
  ok: false
  says: string
  instead?: string
}

export interface ControlResult {
  ok: true
  says: string
  settled?: Record<string, string>
}

export type Control = ControlResult | ControlRefusal

const no = (says: string, instead?: string): ControlRefusal => ({ ok: false, says, ...(instead ? { instead } : {}) })
const yes = (says: string, settled?: Record<string, string>): ControlResult => ({ ok: true, says, ...(settled ? { settled } : {}) })

/** The studio's root, wherever it is on screen. Null when none is open. */
const studio = (): HTMLElement | null => document.querySelector('.cs-studio')

const words = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Waits for something to appear rather than guessing how long a lazily-loaded page takes. */
async function appear<T>(find: () => T | null, within = 8000): Promise<T | null> {
  const until = Date.now() + within
  for (;;) {
    const got = find()
    if (got) return got
    if (Date.now() > until) return null
    await wait(120)
  }
}

/** React tracks an input's value on the element, so the prototype's setter is what it notices. */
function setNatively(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype =
    el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Waits for the page to stop saying it is opening. */
const settled = async (): Promise<HTMLElement | null> =>
  appear(() => {
    const root = studio()
    if (!root) return null
    const opening = [...root.querySelectorAll('div')].some((one) => /^Opening…$/.test(words(one)))
    return opening ? null : root
  })

// ---------------------------------------------------------------- the rail

/** Every section in the rail, by the words on it. */
export function sections(): string[] {
  const root = studio()
  if (!root) return []
  const rail = root.querySelector('nav')
  if (!rail) return []
  return [...rail.querySelectorAll('button')].map((one) => words(one)).filter((one) => one !== '')
}

/** Opens one of the twenty-four sections by name. */
export async function openSection(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Computer Science Studio is not open.')
  const rail = root.querySelector('nav')
  if (!rail) return no('The studio has no navigation on screen.')

  const all = [...rail.querySelectorAll<HTMLButtonElement>('button')].map((el) => ({ label: words(el), el }))
  const want = tidy(asked)
  if (want === '') return no('No section was named.')

  const exact = all.filter((one) => tidy(one.label) === want)
  const near = exact.length > 0 ? exact : all.filter((one) => tidy(one.label).includes(want))
  if (near.length === 0) {
    return no(
      `The studio has no section called "${asked}".`,
      `What it has: ${all.map((one) => `"${one.label}"`).join(', ')}.`
    )
  }
  if (near.length > 1) {
    return no(`"${asked}" could be ${near.map((one) => `"${one.label}"`).join(' or ')}.`, 'Say which one.')
  }

  near[0].el.click()
  const after = await settled()
  if (!after) return no(`"${near[0].label}" did not finish opening.`)
  return yes(`${near[0].label} is open.`, { section: near[0].label })
}

// ---------------------------------------------------------------- the algorithm laboratory

/** Opens the Algorithm Laboratory and picks one of the ninety by name. */
export async function openAlgorithm(asked: string): Promise<Control> {
  const got = await openSection('Algorithms')
  if (!got.ok) return got

  const root = await settled()
  if (!root) return no('The Algorithm Laboratory did not open.')

  // Their lab has a search box over the ninety; using it is what a person would do.
  const box = root.querySelector<HTMLInputElement>('input[placeholder*="algorithm" i], input[placeholder*="Search" i]')
  if (box) {
    setNatively(box, asked)
    await wait(420)
  }

  const now = studio()
  if (!now) return no('The studio closed.')
  const want = tidy(asked)
  const rows = [...now.querySelectorAll<HTMLElement>('button')]
    .map((el) => ({ label: words(el), el }))
    .filter((one) => one.label !== '' && one.label.length < 70)

  const exact = rows.filter((one) => tidy(one.label) === want)
  const near = exact.length > 0 ? exact : rows.filter((one) => tidy(one.label).startsWith(want))
  const loose = near.length > 0 ? near : rows.filter((one) => tidy(one.label).includes(want))
  if (loose.length === 0) {
    return no(`No algorithm here matches "${asked}".`, 'The laboratory has ninety; try a word from the name.')
  }

  // The shortest name is the algorithm itself rather than a longer row that mentions it.
  const best = [...loose].sort((a, b) => a.label.length - b.label.length)[0]
  best.el.click()
  await wait(620)
  return yes(`${best.label} is open.`, { algorithm: best.label })
}

/** Runs whatever the Algorithm Laboratory has open. */
export async function play(): Promise<Control> {
  const root = studio()
  if (!root) return no('The Computer Science Studio is not open.')
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) =>
    /^(play|run|start)$/i.test(words(one)) || /^(play|run|start)$/i.test(one.getAttribute('aria-label') ?? '')
  )
  if (!button) return no('Nothing here has a play control.')
  button.click()
  await wait(200)
  return yes('Running.')
}

// ---------------------------------------------------------------- problems

/** Opens the problem list and then one problem by its title. */
export async function openProblem(asked: string): Promise<Control> {
  const got = await openSection('Problems')
  if (!got.ok) return got

  const root = await settled()
  if (!root) return no('The problem list did not open.')

  const box = root.querySelector<HTMLInputElement>('input[placeholder*="problem" i], input[placeholder*="Search" i]')
  if (box) {
    setNatively(box, asked)
    await wait(420)
  }

  const now = studio()
  if (!now) return no('The studio closed.')
  const want = tidy(asked)
  const rows = [...now.querySelectorAll<HTMLButtonElement>('button')]
    .map((el) => ({ label: words(el), el }))
    .filter((one) => one.label !== '' && one.label.length < 90)

  const exact = rows.filter((one) => tidy(one.label).includes(want))
  if (exact.length === 0) {
    return no(`No problem here matches "${asked}".`, 'Try a word from its title, or open Problems and look.')
  }
  // The shortest match is the problem row rather than a longer one that merely mentions it.
  const best = [...exact].sort((a, b) => a.label.length - b.label.length)[0]
  best.el.click()
  const after = await settled()
  if (!after) return no(`"${best.label}" did not finish opening.`)
  return yes(`${best.label} is open.`, { problem: best.label })
}

// ---------------------------------------------------------------- the playground

/** Puts a program into the playground's editor, and picks its language first when one was named. */
export async function writeCode(code: string, language?: string): Promise<Control> {
  const opened = await openSection('Playground')
  if (!opened.ok) return opened

  const root = await settled()
  if (!root) return no('The playground did not open.')

  if (language !== undefined && language !== '') {
    const picked = await pickLanguage(language)
    if (!picked.ok) return picked
  }

  const editor = await appear(() => studio()?.querySelector<HTMLTextAreaElement>('textarea.cse-box') ?? null)
  if (!editor) return no('The playground has no editor on screen.')
  setNatively(editor, code)
  await wait(200)
  return yes(`${code.split('\n').length} lines written into the editor.`)
}

/** Picks a language in whichever screen offers one. */
export async function pickLanguage(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Computer Science Studio is not open.')

  // Their selector is a button that opens a searchable list.
  const opener = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) =>
    /language/i.test(one.getAttribute('aria-label') ?? '') || /^(javascript|python|c\+\+|java|typescript|go|rust|c#|c)$/i.test(words(one))
  )
  if (opener) {
    opener.click()
    await wait(260)
  }

  const now = studio()
  if (!now) return no('The studio closed.')
  const search = now.querySelector<HTMLInputElement>('input[placeholder*="language" i]')
  if (search) {
    setNatively(search, asked)
    await wait(300)
  }

  const after = studio()
  if (!after) return no('The studio closed.')
  const want = tidy(asked)
  const rows = [...after.querySelectorAll<HTMLButtonElement>('button')]
    .map((el) => ({ label: words(el), el }))
    .filter((one) => one.label !== '' && one.label.length < 40)
  const found = rows.find((one) => tidy(one.label) === want) ?? rows.find((one) => tidy(one.label).startsWith(want))
  if (!found) {
    return no(`No language here is called "${asked}".`, 'Try its usual name, like Python or C++.')
  }
  found.el.click()
  await wait(260)
  return yes(`${found.label} is selected.`, { language: found.label })
}

/** Presses Run, wherever the open screen has one. */
export async function run(): Promise<Control> {
  const root = studio()
  if (!root) return no('The Computer Science Studio is not open.')
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => /^run\b/i.test(words(one)))
  if (!button) return no('Nothing here has a Run control.')
  if (button.disabled) return no('Run cannot be pressed just now.')
  button.click()
  // Reading the code takes a moment; this reports that it was asked for, not what it said.
  await wait(600)
  return yes('Run pressed.')
}

// ---------------------------------------------------------------- reading it back

export interface StudioState {
  open: boolean
  /** The section showing, by the rail's own words. */
  section: string | null
  /** Every section in the rail. */
  sections: string[]
  /** The heading of whatever is on screen. */
  heading: string | null
  /** Whether an editor is on screen, and how much is in it. */
  editor: { lines: number } | null
}

export function look(): StudioState {
  const root = studio()
  if (!root) return { open: false, section: null, sections: [], heading: null, editor: null }

  const rail = root.querySelector('nav')
  const current = rail
    ? ([...rail.querySelectorAll<HTMLButtonElement>('button')].find((one) => one.getAttribute('aria-current') === 'page') ?? null)
    : null
  const editor = root.querySelector<HTMLTextAreaElement>('textarea.cse-box')

  return {
    open: true,
    section: current ? words(current) : null,
    sections: sections(),
    heading: words(root.querySelector('h1, h2')) || null,
    editor: editor ? { lines: editor.value.split('\n').length } : null
  }
}

// ---------------------------------------------------------------- all together

export interface Ask {
  /** One of the twenty-four sections, by name. */
  section?: string
  /** One of the ninety algorithms. Opens the laboratory first. */
  algorithm?: string
  /** A problem, by its title. Opens the list first. */
  problem?: string
  /** A language, in whichever screen offers one. */
  language?: string
  /** A program to put in the playground's editor. */
  code?: string
  /** Press Run once everything else is set. */
  run?: boolean
  /** Start whatever is running, in the Algorithm Laboratory. */
  playing?: boolean
}

export async function apply(ask: Ask): Promise<{ ok: boolean; done: string[]; refused: string[]; state: StudioState }> {
  const done: string[] = []
  const refused: string[] = []

  const note = (got: Control): void => {
    if (got.ok) done.push(got.says)
    else refused.push(got.instead ? `${got.says} ${got.instead}` : got.says)
  }

  /*
   * The order a person would do it in, and it matters: an algorithm opens its own laboratory, and code has to be
   * written before Run means anything.
   */
  if (typeof ask.algorithm === 'string' && ask.algorithm.trim() !== '') note(await openAlgorithm(ask.algorithm))
  else if (typeof ask.problem === 'string' && ask.problem.trim() !== '') note(await openProblem(ask.problem))
  else if (typeof ask.section === 'string' && ask.section.trim() !== '') note(await openSection(ask.section))

  if (typeof ask.code === 'string' && ask.code.trim() !== '') note(await writeCode(ask.code, ask.language))
  else if (typeof ask.language === 'string' && ask.language.trim() !== '') note(await pickLanguage(ask.language))

  if (ask.playing === true) note(await play())
  if (ask.run === true) note(await run())

  return { ok: refused.length === 0, done, refused, state: look() }
}
