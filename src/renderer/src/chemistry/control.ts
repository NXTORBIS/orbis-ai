/**
 * Working the Chemistry Studio from outside it — for Orion, and for the orb.
 *
 * The same approach as the physics studio's `control.ts`, and for the same reason: the user's twenty-six modules
 * each hold their own state and share no store, so there is nothing to write to. The way in is the way a person
 * goes in — find the thing on screen and use it.
 *
 * Everything here reports what actually happened rather than what was asked for. A slider that clamped a value
 * says what it became; a module that is not there says so and lists what is.
 */

import { MODULES } from './lib/chemistryStudio/registry.js'

export interface ControlRefusal {
  ok: false
  says: string
  /** What to do instead, when there is something. */
  instead?: string
}

export interface ControlResult {
  ok: true
  says: string
  /** What ended up set, by the label on screen. */
  settled?: Record<string, string>
}

export type Control = ControlResult | ControlRefusal

const no = (says: string, instead?: string): ControlRefusal => ({ ok: false, says, ...(instead ? { instead } : {}) })
const yes = (says: string, settled?: Record<string, string>): ControlResult => ({ ok: true, says, ...(settled ? { settled } : {}) })

/** The studio's root, wherever it is on screen. Null when no chemistry studio is open. */
const studio = (): HTMLElement | null => document.querySelector('.ch-studio')

const words = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Waits for something to appear, rather than guessing how long a module takes to load. */
async function appear<T extends Element>(find: () => T | null, within = 6000): Promise<T | null> {
  const until = Date.now() + within
  for (;;) {
    const got = find()
    if (got) return got
    if (Date.now() > until) return null
    await wait(120)
  }
}

/**
 * React tracks an input's value on the element, so setting `.value` directly is not seen.
 *
 * The prototype's own setter writes where React looks, and the input event is what tells it to read again. This
 * is the same helper the physics port needs, for the same reason.
 */
function setNatively(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

// ---------------------------------------------------------------- finding a module

export interface ModuleRow {
  id: string
  name: string
  route: string
  group: string
  desc: string
  keywords: readonly string[]
  soon?: boolean
}

const ALL = MODULES as unknown as ModuleRow[]

/**
 * Which module somebody meant.
 *
 * Returns the one match, the several it could be, or null. Several is not narrowed down by guessing: "chemistry"
 * matches most of them, and picking one would open the wrong studio with no sign that it had.
 */
export function findModule(asked: string): ModuleRow | ModuleRow[] | null {
  const want = tidy(asked)
  if (want === '') return null

  const byId = ALL.filter((one) => one.id === want.replace(/ /g, ''));
  if (byId.length === 1) return byId[0]

  const exact = ALL.filter((one) => tidy(one.name) === want)
  if (exact.length >= 1) return exact.length === 1 ? exact[0] : exact

  const inName = ALL.filter((one) => tidy(one.name).includes(want))
  if (inName.length === 1) return inName[0]

  const byWord = ALL.filter((one) => one.keywords.some((k) => tidy(k) === want))
  if (byWord.length === 1) return byWord[0]

  const loose = [...new Set([...inName, ...byWord, ...ALL.filter((one) => tidy(one.desc).includes(want))])]
  if (loose.length === 1) return loose[0]
  return loose.length > 1 ? loose : null
}

/** Opens one of their modules by finding its tile and pressing it, exactly as somebody would. */
export async function openModule(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')

  const found = findModule(asked)
  if (found === null) {
    return no(
      `There is no chemistry module called "${asked}".`,
      `The studio has ${ALL.length} of them; try a word from the name.`
    )
  }
  if (Array.isArray(found)) {
    return no(
      `"${asked}" could be ${found.slice(0, 5).map((one) => `"${one.name}"`).join(' or ')}.`,
      'Say which one.'
    )
  }
  if (found.soon) {
    return no(`"${found.name}" is not built yet.`, 'It is listed in the studio but there is nothing behind it.')
  }

  // Back to the hub first, because the tiles only exist there.
  const back = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => /^all modules$/i.test(words(one)))
  if (back) {
    back.click()
    await wait(360)
  }

  const after = await appear(() => studio())
  if (!after) return no('The Chemistry Studio closed.')

  // Their hub has a search box; using it narrows the tiles the same way a person would.
  const box = after.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="search" i]')
  if (box) {
    setNatively(box, found.name)
    await wait(420)
  }

  const root2 = studio()
  if (!root2) return no('The Chemistry Studio closed.')
  const tile = [...root2.querySelectorAll<HTMLButtonElement>('button')].find(
    (one) => tidy(words(one)).startsWith(tidy(found.name))
  )
  if (!tile) {
    return no(
      `"${found.name}" is in the studio's list but its tile is not on screen.`,
      'Go back to all modules and it will be there.'
    )
  }
  tile.click()

  // Their pages load on demand, so wait for one to arrive rather than reporting success at the loading screen.
  const arrived = await appear(() => {
    const now = studio()
    if (!now) return null
    const still = [...now.querySelectorAll('div')].some((one) => /^opening…$/i.test(words(one)))
    return still ? null : now
  }, 8000)
  if (!arrived) return no(`"${found.name}" did not finish opening.`)

  return yes(`${found.name} is open.`, { module: found.name })
}

/** Opens one element's own page from the periodic table, by symbol, name or atomic number. */
export async function openElement(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')

  const opened = await openModule('periodic')
  if (!opened.ok) return opened

  const now = studio()
  if (!now) return no('The Chemistry Studio closed.')
  const want = tidy(asked)
  const tile = [...now.querySelectorAll<HTMLButtonElement>('button')].find((one) => {
    const label = one.getAttribute('aria-label') ?? ''
    if (label === '') return false
    const [name, numbered] = label.split(',').map((part) => part.trim())
    return (
      tidy(name) === want ||
      tidy(numbered ?? '').replace(/^element /, '') === want ||
      tidy(words(one)) === want
    )
  })
  if (!tile) {
    return no(`There is no element called "${asked}" in the table.`, 'Try its name, its symbol or its number.')
  }
  tile.click()
  await wait(620)
  return yes(`${asked} is open.`, { element: asked })
}

// ---------------------------------------------------------------- the module's own controls

export interface Knob {
  label: string
  el: HTMLInputElement | HTMLSelectElement
  kind: 'number' | 'choice' | 'flag' | 'text'
  least?: number
  most?: number
  step?: number
  options?: string[]
}

/** Every control the module on screen is offering, with the label it shows beside it. */
export function knobs(): Knob[] {
  const root = studio()
  if (!root) return []
  const out: Knob[] = []
  for (const label of root.querySelectorAll('label')) {
    const name = words(label.querySelector('span span')) || words(label.querySelector('span')) || words(label).split(/\s{2,}/)[0]
    if (name === '') continue
    const range = label.querySelector<HTMLInputElement>('input[type="range"], input[type="number"]')
    if (range) {
      out.push({
        label: name,
        el: range,
        kind: 'number',
        least: range.min === '' ? undefined : Number(range.min),
        most: range.max === '' ? undefined : Number(range.max),
        step: range.step === '' ? undefined : Number(range.step)
      })
      continue
    }
    const choice = label.querySelector<HTMLSelectElement>('select')
    if (choice) {
      out.push({ label: name, el: choice, kind: 'choice', options: [...choice.options].map((one) => one.textContent ?? one.value) })
      continue
    }
    const flag = label.querySelector<HTMLInputElement>('input[type="checkbox"]')
    if (flag) {
      out.push({ label: name, el: flag, kind: 'flag' })
      continue
    }
    const typed = label.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')
    if (typed) out.push({ label: name, el: typed, kind: 'text' })
  }
  return out
}

const matches = (label: string, asked: string): boolean => {
  const a = tidy(label)
  const b = tidy(asked)
  if (a === b) return true
  // "temperature" should find "T (K)"; "concentration" should find "C_acid".
  return a.split(' ').includes(b) || a.startsWith(b + ' ') || a.includes(' ' + b + ' ') || a.endsWith(' ' + b)
}

/**
 * Sets one of the module's own controls.
 *
 * The value is checked against what the control allows before it is set, and read back afterwards — so a number
 * the slider rounded or clamped is reported as what it became, not as what was asked for.
 */
export async function setKnob(asked: string, value: string | number | boolean): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')

  const all = knobs()
  if (all.length === 0) {
    return no('Nothing is open that has controls.', 'Open a module first.')
  }

  const exact = all.filter((one) => tidy(one.label) === tidy(asked))
  const near = exact.length > 0 ? exact : all.filter((one) => matches(one.label, asked))
  if (near.length === 0) {
    const names = all.slice(0, 10).map((one) => `"${one.label}"`).join(', ')
    return no(`This module has no control called "${asked}".`, `What it has: ${names}.`)
  }
  if (near.length > 1) {
    return no(
      `"${asked}" could be ${near.map((one) => `"${one.label}"`).join(' or ')}.`,
      'Say which one.'
    )
  }

  const knob = near[0]

  if (knob.kind === 'flag') {
    const want = value === true || value === 'true' || value === 'on' || value === 1
    const box = knob.el as HTMLInputElement
    if (box.checked !== want) {
      box.click()
      await wait(140)
    }
    return yes(`${knob.label} is ${box.checked ? 'on' : 'off'}.`, { [knob.label]: box.checked ? 'on' : 'off' })
  }

  if (knob.kind === 'choice') {
    const pick = knob.el as HTMLSelectElement
    const want = tidy(String(value))
    const option = [...pick.options].find(
      (one) => tidy(one.textContent ?? '') === want || tidy(one.value) === want
    ) ?? [...pick.options].find((one) => tidy(one.textContent ?? '').includes(want))
    if (!option) {
      const names = [...pick.options].map((one) => `"${one.textContent ?? one.value}"`).join(', ')
      return no(`"${value}" is not one of the choices for ${knob.label}.`, `The choices are ${names}.`)
    }
    setNatively(pick, option.value)
    await wait(200)
    return yes(`${knob.label} is ${option.textContent ?? option.value}.`, { [knob.label]: option.textContent ?? option.value })
  }

  if (knob.kind === 'text') {
    setNatively(knob.el as HTMLInputElement, String(value))
    await wait(200)
    return yes(`${knob.label} is ${(knob.el as HTMLInputElement).value}.`, { [knob.label]: (knob.el as HTMLInputElement).value })
  }

  const wanted = Number(value)
  if (!Number.isFinite(wanted)) return no(`"${value}" is not a number, and ${knob.label} takes one.`)
  if (knob.least !== undefined && knob.most !== undefined && (wanted < knob.least || wanted > knob.most)) {
    return no(`${knob.label} goes from ${knob.least} to ${knob.most}, and ${wanted} was asked for.`)
  }
  setNatively(knob.el as HTMLInputElement, String(wanted));
  await wait(200)
  const became = Number((knob.el as HTMLInputElement).value)
  return yes(
    became === wanted ? `${knob.label} is ${became}.` : `${knob.label} is ${became} — the nearest it goes to ${wanted}.`,
    { [knob.label]: String(became) }
  )
}

/** Chooses one of a module's own tabs — titration, chromatography, and so on. */
export async function pickTab(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((el) => ({ label: words(el), el }))
  if (tabs.length === 0) return no('This module has no tabs.')
  const want = tidy(asked)
  const found =
    tabs.find((one) => tidy(one.label) === want) ?? tabs.find((one) => tidy(one.label).includes(want))
  if (!found) {
    return no(
      `This module has no view called "${asked}".`,
      `What it has: ${tabs.map((one) => `"${one.label}"`).join(', ')}.`
    )
  }
  found.el.click()
  await wait(360)
  return yes(`Showing "${found.label}".`)
}

/** Presses one of the module's own buttons by the words on it. */
export async function press(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')
  // Not the studio's own way back, and not a tab -- those have their own ways in.
  const CHROME = /^(all modules|what does this mean\?|hide explanation|all|back)$/i
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    .filter((one) => one.getAttribute('role') !== 'tab')
    .map((el) => ({ label: words(el), el }))
    .filter((one) => one.label !== '' && one.label.length <= 60 && !CHROME.test(one.label))
  const want = tidy(asked)
  const found = buttons.find((one) => tidy(one.label) === want) ?? buttons.find((one) => tidy(one.label).includes(want))
  if (!found) {
    return no(
      `There is no button called "${asked}" here.`,
      `What is here: ${buttons.slice(0, 10).map((one) => `"${one.label}"`).join(', ')}.`
    )
  }
  if (found.el.disabled) return no(`"${found.label}" cannot be pressed just now.`)
  found.el.click()
  await wait(420)
  return yes(`Pressed "${found.label}".`)
}

/** Shows or hides the explanation below a module. */
export async function explain(show: boolean): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')
  const toggle = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) =>
    /^(hide explanation|what does this mean\?)$/i.test(words(one))
  )
  if (!toggle) return no('This module has no explanation to show.')
  const showing = /^hide explanation$/i.test(words(toggle))
  if (showing === show) return yes(show ? 'The explanation is already showing.' : 'The explanation is already hidden.')
  toggle.click()
  await wait(260)
  return yes(show ? 'Showing the explanation.' : 'Hid the explanation.')
}

/** Back to the hub. */
export async function allModules(): Promise<Control> {
  const root = studio()
  if (!root) return no('The Chemistry Studio is not open.')
  const back = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => /^all modules$/i.test(words(one)))
  if (!back) return yes('Already showing all the modules.')
  back.click()
  await wait(360)
  return yes('Showing all the modules.')
}

// ---------------------------------------------------------------- reading it back

export interface StudioState {
  open: boolean
  module: string | null
  /** Every control the module offers, and what it is set to. */
  controls: { label: string; value: string; least?: number; most?: number; options?: string[] }[]
  /** The rows of choices it offers. */
  tabs: string[]
  /** Its own buttons, by the words on them. */
  buttons: string[]
  /** The numbers it is reporting right now. */
  readouts: Record<string, string>
  explaining: boolean
}

/** What is on screen, so Orion can answer about it rather than guess. */
export function look(): StudioState {
  const root = studio()
  if (!root) {
    return { open: false, module: null, controls: [], tabs: [], buttons: [], readouts: {}, explaining: false }
  }

  const readouts: Record<string, string> = {}
  // A stat is a label above a value, which is how their Stat component renders one.
  for (const cell of root.querySelectorAll('.rounded-xl, .rounded-lg')) {
    if (cell.children.length !== 2) continue
    const name = words(cell.firstElementChild)
    const value = words(cell.lastElementChild)
    if (name !== '' && value !== '' && name !== value && name.length < 40) readouts[name] = value
  }

  const CHROME = /^(all modules|what does this mean\?|hide explanation|all|back)$/i
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    .filter((one) => one.getAttribute('role') !== 'tab')
    .map((one) => words(one))
    .filter((one) => one !== '' && one.length <= 60 && !CHROME.test(one))

  return {
    open: true,
    module: words(root.querySelector('h2')) || null,
    controls: knobs().map((one) => ({
      label: one.label,
      value: one.kind === 'flag' ? String((one.el as HTMLInputElement).checked) : one.el.value,
      least: one.least,
      most: one.most,
      options: one.options
    })),
    tabs: [...root.querySelectorAll('[role="tab"]')].map((one) => words(one)),
    buttons: [...new Set(buttons)],
    readouts,
    explaining: [...root.querySelectorAll('button')].some((one) => /^hide explanation$/i.test(words(one)))
  }
}

// ---------------------------------------------------------------- all together

export interface Ask {
  /** One of their twenty-six modules, by name. */
  module?: string
  /** One element's own page, by name, symbol or number. */
  element?: string
  /** One of the module's own tabs. */
  tab?: string
  /** Controls by the label the module shows. */
  set?: Record<string, string | number | boolean>
  /** The module's own buttons, pressed in the order given. */
  press?: string[]
  /** Show or hide the explanation. */
  explain?: boolean
  /** Back to the hub. */
  home?: boolean
}

/**
 * Carries out a whole request and reports every part separately.
 *
 * It keeps going after a part fails rather than stopping: asking for a module and three settings, one of which it
 * has not got, should still open the module and set the other two.
 */
export async function apply(ask: Ask): Promise<{ ok: boolean; done: string[]; refused: string[]; state: StudioState }> {
  const done: string[] = []
  const refused: string[] = []

  const note = (got: Control): void => {
    if (got.ok) done.push(got.says)
    else refused.push(got.instead ? `${got.says} ${got.instead}` : got.says)
  }

  if (ask.home === true) note(await allModules())

  // An element is a page of the periodic table, so it already implies which module.
  if (typeof ask.element === 'string' && ask.element.trim() !== '') note(await openElement(ask.element))
  else if (typeof ask.module === 'string' && ask.module.trim() !== '') note(await openModule(ask.module))

  // The tab before the controls: several of their studios show different controls per tab.
  if (typeof ask.tab === 'string' && ask.tab.trim() !== '') note(await pickTab(ask.tab))

  if (ask.set) {
    for (const [name, value] of Object.entries(ask.set)) {
      note(await setKnob(name, value))
    }
  }

  if (Array.isArray(ask.press)) {
    for (const one of ask.press.slice(0, 6)) {
      if (typeof one === 'string' && one.trim() !== '') note(await press(one))
    }
  }

  if (typeof ask.explain === 'boolean') note(await explain(ask.explain))

  return { ok: refused.length === 0, done, refused, state: look() }
}

/**
 * Reads a sentence into a request.
 *
 * Deliberately simple: anything it is not sure about it leaves out rather than guessing, and the caller sees what
 * it understood.
 */
export function readAsk(sentence: string): Ask {
  const text = String(sentence ?? '').trim()
  const ask: Ask = {}
  if (text === '') return ask

  const element = text.match(/\b(?:element|atom)\s+([A-Za-z]{1,12}|\d{1,3})\b/i)
  if (element) ask.element = element[1]

  if (ask.element === undefined) {
    const head = text.split(/\b(?:with|where|at|,|;|and set)\b/i)[0]
    const module = head
      .replace(/^\s*(?:open|show|run|start|load|go to|take me to)\s+/i, '')
      .replace(/\b(?:the|a|an|module|studio|lab)\b/gi, ' ')
      .trim()
    if (module !== '') ask.module = module
  }

  const set: Record<string, string | number> = {}
  for (const one of text.matchAll(/([a-zA-Z][a-zA-Z _°()/]{1,28}?)\s*(?:=|:|\bof\b|\bto\b|\bis\b)\s*(-?\d+(?:\.\d+)?)/g)) {
    const name = one[1].trim().replace(/^\s*(?:with|and|at|set)\s+/i, '').trim()
    const value = Number(one[2])
    if (name === '' || !Number.isFinite(value)) continue
    set[name] = value
  }
  if (Object.keys(set).length > 0) ask.set = set

  const tab = text.match(/\b(?:tab|view|show(?:ing)?)\s+(?:the\s+)?["']?([a-zA-Z][a-zA-Z –—/-]{1,34}?)["']?\s*(?:tab|view)?\s*$/i)
  if (tab) ask.tab = tab[1].trim()

  const pressed = text.match(/\b(?:press|click|hit|tap)\s+(?:the\s+)?["']?([a-zA-Z][a-zA-Z0-9 –—()/.&+-]{1,40}?)["']?\s*(?:button)?\s*$/i)
  if (pressed) ask.press = [pressed[1].trim()]

  if (/\b(?:explain|explanation|what does this mean)\b/i.test(text) && !/\bhide\b/i.test(text)) ask.explain = true
  if (/\bhide\b.{0,16}\bexplan/i.test(text)) ask.explain = false

  if (/\b(?:all modules|back to (?:the )?(?:hub|modules|list))\b/i.test(text)) ask.home = true

  return ask
}

/** Every module, for anything that needs the list without reaching into the registry. */
export const MODULE_ROWS: readonly ModuleRow[] = Object.freeze(ALL.map((one) => Object.freeze({ ...one })))
