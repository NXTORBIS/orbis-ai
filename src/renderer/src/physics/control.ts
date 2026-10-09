/**
 * Driving the Physics Studio from outside it — which is how Orion opens a topic and sets its controls.
 *
 * ## It does what a person does
 *
 * The 230 simulations came across from the original site unedited, and each owns its own parameters in its own
 * React state. There is no shared store to write into, and adding one would mean editing every one of them. So
 * this works the screen: it finds the topic card and presses it, finds the labelled slider and moves it, finds
 * the play button and presses that.
 *
 * That is not a workaround, it is the honest option. It cannot set something the laboratory does not offer, it
 * cannot set it to a value the laboratory would refuse, and it cannot drift away from what the simulation
 * actually does — because it is going through exactly the path a person goes through.
 *
 * ## Everything can fail, and says so
 *
 * A topic that does not exist, a parameter this simulation has not got, a number outside the slider's range, a
 * simulation with no play button: each returns a refusal naming what was wrong and what there was instead.
 * Reporting success for something that did not happen is the one outcome worth engineering against, because the
 * answer on screen would then disagree with what Orion said it did.
 */

import { PHYSICS_TOPICS, type PhysicsTopicRow } from '../../../shared/physics/topics.ts'

export interface ControlRefusal {
  ok: false
  says: string
  /** What there was instead, when that is the useful part. */
  instead?: string
}

export interface ControlResult {
  ok: true
  says: string
  /** What was actually set, read back off the screen rather than assumed. */
  settled?: Record<string, string>
}

export type Control = ControlResult | ControlRefusal

const no = (says: string, instead?: string): ControlRefusal => ({ ok: false, says, ...(instead ? { instead } : {}) })
const yes = (says: string, settled?: Record<string, string>): ControlResult => ({ ok: true, says, ...(settled ? { settled } : {}) })

/** The studio's root, wherever it is on screen. Null when no studio is open. */
const studio = (): HTMLElement | null => document.querySelector('.p8-studio')

const words = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim()

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

/** Waits for something to appear, rather than guessing how long a simulation takes to mount. */
async function appear<T extends Element>(find: () => T | null, within = 6000): Promise<T | null> {
  const until = Date.now() + within
  for (;;) {
    const found = find()
    if (found) return found
    if (Date.now() > until) return null
    await wait(80)
  }
}

/**
 * Sets a React-controlled input the way the page hears it.
 *
 * Assigning `.value` directly is invisible to React: it keeps its own copy of the value and the change never
 * reaches the component. The setter has to be called on the prototype and an input event dispatched, which is
 * what a real keystroke does underneath.
 */
function setNatively(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

// ---------------------------------------------------------------- finding a topic

const tidy = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The topic somebody meant.
 *
 * Exact id first, then exact name, then every word of what was asked appearing in the name. "projectile motion",
 * "projectile" and "Projectile Motion" all land on the same topic; something that matches several is refused with
 * the list, because picking one of five silently is worse than asking.
 */
export function findTopic(asked: string): PhysicsTopicRow | PhysicsTopicRow[] | null {
  const want = tidy(asked)
  if (want === '') return null

  const byId = PHYSICS_TOPICS.find((one) => one.id.toLowerCase() === asked.trim().toLowerCase())
  if (byId) return byId

  const byName = PHYSICS_TOPICS.filter((one) => tidy(one.name) === want)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    /*
     * Several topics share a name on purpose — the Virtual Experimental Physics Lab has its own Projectile Motion
     * beside the one in Classical Mechanics. Refusing "projectile motion" as ambiguous would be pedantic, so the
     * plain entry wins: its id has no section prefix, which is what makes it the canonical one. Which section it
     * came from is reported, so the choice is visible rather than silent.
     */
    const plain = [...byName].sort((a, b) => a.id.length - b.id.length)
    if (plain[0].id.length < plain[1].id.length) return plain[0]
    return byName
  }

  const parts = want.split(' ')
  const loose = PHYSICS_TOPICS.filter((one) => {
    const haystack = `${tidy(one.name)} ${tidy(one.id)} ${tidy(one.about)}`
    return parts.every((two) => haystack.includes(two))
  })
  if (loose.length === 0) return null
  if (loose.length === 1) return loose[0]

  // Several matched. A name that matches on its own beats one that only matched in its description.
  const inName = loose.filter((one) => parts.every((two) => tidy(one.name).includes(two)))
  if (inName.length === 1) return inName[0]
  return inName.length > 0 ? inName : loose
}

// ---------------------------------------------------------------- opening one

/** Opens a topic by finding its card and pressing it, exactly as somebody would. */
export async function openTopic(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')

  const found = findTopic(asked)
  if (found === null) {
    return no(`There is no physics topic called "${asked}".`, `The studio has ${PHYSICS_TOPICS.length} of them; try a word from the name.`)
  }
  if (Array.isArray(found)) {
    return no(
      `"${asked}" matches ${found.length} topics, so it is not clear which was meant.`,
      found.slice(0, 6).map((one) => one.name).join(', ')
    )
  }

  // Already showing it: nothing to do, and saying so beats pressing something at random.
  const heading = words(root.querySelector('h2'))
  if (heading === found.name) return yes(`${found.name} is already open.`)

  // Back to the list if a topic is open, then to the right section, then search for it by name.
  const back = [...root.querySelectorAll('button')].find((one) => /all topics/i.test(words(one)))
  if (back) {
    back.click()
    await wait(260)
  }

  const box = root.querySelector<HTMLInputElement>('input[placeholder*="Search" i]')
  if (!box) return no('The studio has no search box, so the topic cannot be reached from here.')
  setNatively(box, found.name)
  await wait(420)

  const card = [...root.querySelectorAll('button')].find((one) => words(one.querySelector('span')) === found.name)
  if (!card) {
    setNatively(box, '')
    return no(`${found.name} is in the list and its card did not appear.`, 'That is a fault in the studio rather than in what was asked for.')
  }
  card.click()

  const arrived = await appear(() => {
    const now = words(root.querySelector('h2'))
    return now === found.name ? root : null
  })
  if (!arrived) return no(`${found.name} was pressed and did not open.`)

  // Give the simulation a moment to mount its own canvas and controls before anybody sets one.
  await appear(() => root.querySelector('canvas, svg'), 4000)
  return yes(`${found.name} is open.`, { topic: found.id, section: found.sectionName })
}

// ---------------------------------------------------------------- its controls

interface Knob {
  label: string
  el: HTMLInputElement | HTMLSelectElement
  kind: 'number' | 'choice' | 'flag'
  least?: number
  most?: number
  step?: number
  options?: string[]
}

/** Every control the simulation on screen is offering, with the label it shows beside it. */
export function knobs(): Knob[] {
  const root = studio()
  if (!root) return []
  const out: Knob[] = []
  for (const label of root.querySelectorAll('label')) {
    // The name is the label's text without the live value that sits beside it.
    const name = words(label.querySelector('span')) || words(label).split(/\s{2,}/)[0]
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
    if (flag) out.push({ label: name, el: flag, kind: 'flag' })
  }
  return out
}

const matches = (label: string, asked: string): boolean => {
  const a = tidy(label)
  const b = tidy(asked)
  if (a === b) return true
  // "speed" should find "Initial speed (m/s)"; "angle" should find "Launch angle (°)".
  return a.split(' ').includes(b) || a.startsWith(b + ' ') || a.includes(' ' + b + ' ') || a.endsWith(' ' + b)
}

/**
 * Sets one of the simulation's own controls.
 *
 * The value is checked against what the control actually allows before it is set, and read back afterwards — so a
 * number the slider rounded or clamped is reported as what it became, not as what was asked for.
 */
export async function setKnob(asked: string, value: string | number | boolean): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')

  const all = knobs()
  if (all.length === 0) return no('Nothing is open that has controls.', 'Open a topic first.')

  const hits = all.filter((one) => matches(one.label, asked))
  if (hits.length === 0) {
    return no(
      `This simulation has no control called "${asked}".`,
      `It has: ${all.map((one) => one.label).join(', ')}`
    )
  }
  if (hits.length > 1) {
    return no(`"${asked}" matches more than one of this simulation's controls.`, hits.map((one) => one.label).join(', '))
  }

  const knob = hits[0]

  if (knob.kind === 'flag') {
    const want = value === true || value === 'true' || value === 'on' || value === 1 || value === '1'
    const box = knob.el as HTMLInputElement
    if (box.checked !== want) box.click()
    return yes(`${knob.label} is ${box.checked ? 'on' : 'off'}.`, { [knob.label]: String(box.checked) })
  }

  if (knob.kind === 'choice') {
    const select = knob.el as HTMLSelectElement
    const want = String(value)
    const option =
      [...select.options].find((one) => tidy(one.textContent ?? '') === tidy(want)) ??
      [...select.options].find((one) => tidy(one.value) === tidy(want)) ??
      [...select.options].find((one) => tidy(one.textContent ?? '').includes(tidy(want)))
    if (!option) {
      return no(`${knob.label} has no setting called "${want}".`, `It offers: ${(knob.options ?? []).join(', ')}`)
    }
    setNatively(select, option.value)
    return yes(`${knob.label} is now ${words(option)}.`, { [knob.label]: words(option) })
  }

  const wanted = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9eE+.-]/g, ''))
  if (!Number.isFinite(wanted)) {
    return no(`"${value}" is not a number, and ${knob.label} takes one.`)
  }
  if (knob.least !== undefined && wanted < knob.least) {
    return no(`${knob.label} cannot go below ${knob.least}, and ${wanted} was asked for.`, `It takes ${knob.least} to ${knob.most}.`)
  }
  if (knob.most !== undefined && wanted > knob.most) {
    return no(`${knob.label} cannot go above ${knob.most}, and ${wanted} was asked for.`, `It takes ${knob.least} to ${knob.most}.`)
  }

  setNatively(knob.el, String(wanted))
  await wait(120)
  // Read back: a slider with a coarse step lands on the nearest one it has, and that is what it is set to.
  const became = Number((knob.el as HTMLInputElement).value)
  return yes(
    became === wanted
      ? `${knob.label} is ${became}.`
      : `${knob.label} is ${became} — the nearest it goes to ${wanted}.`,
    { [knob.label]: String(became) }
  )
}

// ---------------------------------------------------------------- the transport

const pressing = async (match: RegExp, what: string): Promise<Control> => {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  const button = [...root.querySelectorAll('button')].find((one) => match.test(one.getAttribute('aria-label') ?? ''))
  if (!button) {
    return no(`Nothing is open with a ${what} control.`, 'Not every topic runs over time; some are worked out once and drawn.')
  }
  button.click()
  await wait(140)
  return yes(`${what[0].toUpperCase()}${what.slice(1)}.`)
}

export const play = (): Promise<Control> => pressing(/^play$/i, 'play')
export const pause = (): Promise<Control> => pressing(/^pause$/i, 'pause')
export const step = (): Promise<Control> => pressing(/^step$/i, 'step')
export const reset = (): Promise<Control> => pressing(/^reset$/i, 'reset')

/** Starts it if it is not already going; says so rather than toggling it off by accident. */
export async function run(): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  const already = [...root.querySelectorAll('button')].some((one) => /^pause$/i.test(one.getAttribute('aria-label') ?? ''))
  if (already) return yes('It is already running.')
  return play()
}

/** How fast it runs. The speed slider is the transport's own, not one of the simulation's parameters. */
export async function setSpeed(times: number): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  if (!Number.isFinite(times)) return no(`"${times}" is not a speed.`)

  // The transport's slider is the one next to the word Speed rather than inside a parameter label.
  const slider = [...root.querySelectorAll<HTMLInputElement>('input[type="range"]')].find((one) => {
    const near = one.closest('div')
    return near !== null && /speed/i.test(words(near)) && one.closest('label') === null
  })
  if (!slider) return no('This topic has no speed control.', 'Only the simulations that run over time have one.')

  const least = slider.min === '' ? 0.1 : Number(slider.min)
  const most = slider.max === '' ? 4 : Number(slider.max)
  if (times < least || times > most) {
    return no(`The speed goes from ${least}× to ${most}×, and ${times}× was asked for.`)
  }
  setNatively(slider, String(times))
  await wait(120)
  return yes(`Running at ${slider.value}×.`, { speed: `${slider.value}x` })
}

// ---------------------------------------------------------------- everything else a laboratory offers

/** The transport's own buttons and the studio's chrome. Named so they are not offered twice as "press this". */
const CHROME = /^(play|pause|step|reset|all topics|hide explanation|what does this mean\?|ask orion.*|clear this|back to chat|follow|centre|center|zoom in|zoom out)$/i

export interface Action {
  /** What it says on screen. */
  label: string
  el: HTMLButtonElement
  /** True when it is one of a row of choices rather than a thing that happens. */
  choice: boolean
}

/**
 * Every button in the simulation that is not the transport or the studio's own chrome.
 *
 * This is how "build the Hamiltonian", "run a trial" and "show the spectrum" become things the orb can do: they
 * are buttons the laboratory drew itself, and there is no list of them anywhere -- each of the 230 simulations
 * builds its own. So they are read off the screen, exactly as a person reads them.
 */
export function actions(): Action[] {
  const root = studio()
  if (!root) return []
  /*
   * Only what the simulation itself drew.
   *
   * The studio's section tabs are buttons in the same tree, and offering them meant the orb could press
   * "Classical Mechanics" when asked for the double pendulum -- which leaves the laboratory, takes the topic
   * away, and makes every request after it fail. The simulation begins at its own heading, so everything before
   * that heading is the studio's and not the orb's to press.
   */
  const heading = root.querySelector('h2')
  if (!heading) return []
  const out: Action[] = []
  for (const button of root.querySelectorAll<HTMLButtonElement>('button')) {
    const label = words(button) || (button.getAttribute('aria-label') ?? '')
    if (label === '' || label.length > 60) continue
    if (CHROME.test(label)) continue
    // A card in the topic grid is a button too, and pressing one is "open a topic", not "press a control".
    if (button.classList.contains('group') || button.closest('.na-orb') !== null) continue
    // After the heading in reading order. FOLLOWING is 4; a button inside the heading does not count.
    if ((heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) continue
    const box = button.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    const chosen = button.getAttribute('aria-selected') ?? button.getAttribute('aria-pressed')
    out.push({ label, el: button, choice: chosen !== null || button.getAttribute('role') === 'tab' })
  }
  return out
}

/** Picks the closest thing on screen to what was asked for, or says what there was instead. */
function closest<T extends { label: string }>(all: T[], asked: string, what: string): T | ControlRefusal {
  if (all.length === 0) return no(`This topic has no ${what}.`)
  const want = tidy(asked)
  const exact = all.filter((one) => tidy(one.label) === want)
  if (exact.length === 1) return exact[0]
  const near = all.filter((one) => matches(one.label, asked) || tidy(one.label).includes(want))
  if (near.length === 1) return near[0]
  if (near.length > 1) {
    return no(`"${asked}" could be ${near.map((one) => `"${one.label}"`).join(' or ')}.`, 'Say which one.')
  }
  const names = all.slice(0, 10).map((one) => `"${one.label}"`).join(', ')
  return no(`There is no ${what} called "${asked}".`, `What is here: ${names}.`)
}

/** Presses one of the simulation's own buttons by the words on it. */
export async function press(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  /*
   * "Open the double pendulum" sometimes arrives as a button press rather than as a topic. If the name is a
   * topic, open it: that is plainly what was wanted, and pressing something else with a similar name would
   * take the person somewhere they did not ask for.
   */
  const asTopic = findTopic(asked)
  if (asTopic !== null && !Array.isArray(asTopic)) {
    const already = words(root.querySelector('h2'))
    if (tidy(already) !== tidy(asTopic.name)) return openTopic(asked)
  }
  const found = closest(actions(), asked, 'button')
  if ('ok' in found) return found
  if (found.el.disabled) {
    return no(`"${found.label}" cannot be pressed just now.`, 'Something it needs has not been set yet.')
  }
  found.el.click()
  // A button that builds or runs something takes a moment; reading back too early would report the old state.
  await wait(420)
  return yes(`Pressed "${found.label}".`)
}

/**
 * Chooses one of a row of choices -- a tab, a mode, a method.
 *
 * Several laboratories choose with a row of buttons rather than a dropdown, which is why this is separate from
 * setting a control: there is nothing to set, there is something to pick.
 */
export async function pickTab(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  const choices = actions().filter((one) => one.choice)
  const found = closest(choices.length > 0 ? choices : actions(), asked, 'choice')
  if ('ok' in found) return found
  found.el.click()
  await wait(420)
  return yes(`Showing "${found.label}".`)
}

/** Shows or hides the explainer panel below the simulation. */
export async function explain(show: boolean): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  const toggle = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) =>
    /^(hide explanation|what does this mean\?)$/i.test(words(one))
  )
  if (!toggle) return no('This topic has no explanation to show.')
  const showing = /^hide explanation$/i.test(words(toggle))
  if (showing === show) return yes(show ? 'The explanation is already showing.' : 'The explanation is already hidden.')
  toggle.click()
  await wait(260)
  return yes(show ? 'Showing the explanation.' : 'Hid the explanation.')
}

/** Goes back to the topic grid and shows one section of it. */
export async function openSection(asked: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  const back = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => /^all topics$/i.test(words(one)))
  if (back) {
    back.click()
    await wait(420)
  }
  const after = studio()
  if (!after) return no('The Physics Studio closed.')
  const tabs = [...after.querySelectorAll<HTMLButtonElement>('button')]
    .map((el) => ({ label: words(el), el }))
    .filter((one) => one.label !== '' && one.label.length < 40 && !CHROME.test(one.label) && !one.el.classList.contains('group'))
  const found = closest(tabs, asked, 'section')
  if ('ok' in found) return found
  found.el.click()
  await wait(320)
  return yes(`Showing ${found.label}.`)
}

/** Saves what the simulation has measured. The export bar offers CSV, JSON and a picture. */
export async function save(kind: string): Promise<Control> {
  const root = studio()
  if (!root) return no('The Physics Studio is not open.')
  /*
   * "Picture" and "image" are how people say PNG, and the export bar says PNG. Without this, asking to save the
   * picture looked for a button with the word "picture" on it and found nothing, so a button that was right
   * there was reported as missing.
   */
  const want = tidy(kind).replace(/^(picture|image|photo|screenshot)$/, 'png')
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find((one) => {
    const label = tidy(words(one))
    return label.includes(want) && /csv|json|png|image|picture|export|download|save/.test(label)
  })
  if (!button) {
    return no(`There is nothing here that saves as ${kind}.`, 'Only the topics that record measurements can be saved.')
  }
  button.click()
  await wait(320)
  return yes(`Saved as ${kind}.`)
}

// ---------------------------------------------------------------- reading it back

export interface StudioState {
  open: boolean
  topic: string | null
  section: string | null
  running: boolean
  /** Every control the simulation offers, and what it is set to. */
  controls: { label: string; value: string; least?: number; most?: number; options?: string[] }[]
  /** The numbers the simulation is reporting right now. */
  readouts: Record<string, string>
  /** The simulation's own buttons, by the words on them. */
  buttons: string[]
  /** The rows of choices it offers -- tabs, modes, methods. */
  choices: string[]
  /** Whether the explanation below the simulation is showing. */
  explaining: boolean
}

/** What is on screen, so Orion can answer about it rather than guess. */
export function look(): StudioState {
  const root = studio()
  if (!root) return { open: false, topic: null, section: null, running: false, controls: [], readouts: {}, buttons: [], choices: [], explaining: false }

  const readouts: Record<string, string> = {}
  for (const cell of root.querySelectorAll('.grid > div')) {
    const name = words(cell.firstElementChild)
    const value = words(cell.lastElementChild)
    if (name !== '' && value !== '' && name !== value && name.length < 40) readouts[name] = value
  }

  return {
    open: true,
    topic: words(root.querySelector('h2')) || null,
    section: words(root.querySelector('.jx-pagetitle h3')) || null,
    running: [...root.querySelectorAll('button')].some((one) => /^pause$/i.test(one.getAttribute('aria-label') ?? '')),
    controls: knobs().map((one) => ({
      label: one.label,
      value: one.kind === 'flag' ? String((one.el as HTMLInputElement).checked) : one.el.value,
      least: one.least,
      most: one.most,
      options: one.options
    })),
    readouts,
    buttons: actions().filter((one) => !one.choice).map((one) => one.label),
    choices: actions().filter((one) => one.choice).map((one) => one.label),
    explaining: [...root.querySelectorAll('button')].some((one) => /^hide explanation$/i.test(words(one)))
  }
}

// ---------------------------------------------------------------- all together

export interface Ask {
  topic?: string
  /** One of the studio's sections, when the grid should be shown rather than a topic. */
  section?: string
  /** Controls by the label the simulation shows, e.g. `{ 'launch angle': 60, speed: 30 }`. */
  set?: Record<string, string | number | boolean>
  /** One of a row of choices -- a tab, a mode, a method. */
  tab?: string
  /** The simulation's own buttons, pressed in the order given. */
  press?: string[]
  speed?: number
  playing?: boolean
  /** Advance it by single frames. */
  step?: number
  /** Put it back to where it started. */
  reset?: boolean
  /** Show or hide the explanation below it. */
  explain?: boolean
  /** Save what it measured: csv, json or png. */
  save?: string
}

/**
 * Carries out a whole request — open this, set that, run it — and reports every part separately.
 *
 * It keeps going after a part fails rather than stopping: asking for a topic and three settings, one of which the
 * simulation has not got, should still open the topic and set the other two. What did not happen is listed.
 */
export async function apply(ask: Ask): Promise<{ ok: boolean; done: string[]; refused: string[]; state: StudioState }> {
  const done: string[] = []
  const refused: string[] = []

  const note = (got: Control): void => {
    if (got.ok) done.push(got.says)
    else refused.push(got.instead ? `${got.says} ${got.instead}` : got.says)
  }

  /*
   * The order is the order a person would do it in, and it matters.
   *
   * A topic first, because its controls do not exist until it is open. Then the choice of tab, because several
   * laboratories show different controls per tab. Then the controls, then the buttons that act on them, and only
   * then running it -- setting a value after pressing "run" would be measured against the old one.
   */
  if (typeof ask.section === 'string' && ask.section.trim() !== '') note(await openSection(ask.section))

  if (typeof ask.topic === 'string' && ask.topic.trim() !== '') note(await openTopic(ask.topic))

  if (typeof ask.tab === 'string' && ask.tab.trim() !== '') note(await pickTab(ask.tab))

  if (ask.set) {
    for (const [name, value] of Object.entries(ask.set)) {
      note(await setKnob(name, value))
    }
  }

  if (typeof ask.speed === 'number') note(await setSpeed(ask.speed))

  if (ask.reset === true) note(await reset())

  if (Array.isArray(ask.press)) {
    for (const one of ask.press.slice(0, 6)) {
      if (typeof one === 'string' && one.trim() !== '') note(await press(one))
    }
  }

  if (ask.playing === true) note(await run())
  else if (ask.playing === false) note(await pause())

  if (typeof ask.step === 'number' && ask.step > 0) {
    const many = Math.min(60, Math.round(ask.step))
    for (let i = 0; i < many; i += 1) await step()
    note(yes(many === 1 ? 'Stepped once.' : `Stepped ${many} times.`))
  }

  if (typeof ask.explain === 'boolean') note(await explain(ask.explain))

  if (typeof ask.save === 'string' && ask.save.trim() !== '') note(await save(ask.save))

  return { ok: refused.length === 0, done, refused, state: look() }
}

/**
 * Reads a sentence into a request.
 *
 * "projectile motion with speed 30" and "open the double pendulum and run it at 2x" both become something this
 * module can carry out. It is deliberately simple: anything it is not sure about it leaves out rather than
 * guessing, and the caller sees what it understood.
 */
export function readAsk(sentence: string): Ask {
  const text = String(sentence ?? '').trim()
  const ask: Ask = {}
  if (text === '') return ask

  // The settings come after "with", "at" or a comma, so the topic is what is left in front of them.
  const head = text.split(/\b(?:with|where|at|,|;|and set)\b/i)[0]
  const topic = head.replace(/^\s*(?:open|show|run|start|load|go to|play)\s+/i, '').replace(/\b(?:the|a|an)\b/gi, ' ').trim()
  if (topic !== '') ask.topic = topic

  // "speed 30", "angle = 45", "mass: 2.5"
  const set: Record<string, string | number> = {}
  for (const one of text.matchAll(/([a-zA-Z][a-zA-Z °()/]{1,28}?)\s*(?:=|:|\bof\b|\bto\b|\bis\b)?\s*(-?\d+(?:\.\d+)?)/g)) {
    const name = one[1].trim().replace(/^\s*(?:with|and|at|set)\s+/i, '').trim()
    const value = Number(one[2])
    if (name === '' || !Number.isFinite(value)) continue
    // The run speed is the transport's, not a parameter, and is worth telling apart.
    if (/^(?:speed|at)$/i.test(name) && /\d+\s*(?:x|times)\b/i.test(text)) continue
    set[name] = value
  }
  if (Object.keys(set).length > 0) ask.set = set

  const times = text.match(/(\d+(?:\.\d+)?)\s*(?:x|times)\b/i)
  if (times) ask.speed = Number(times[1])

  if (/\b(?:run|play|start|go)\b/i.test(text)) ask.playing = true
  if (/\b(?:pause|stop|hold)\b/i.test(text)) ask.playing = false

  if (/\breset\b|\bstart over\b|\bback to the start\b/i.test(text)) ask.reset = true

  const stepped = text.match(/\bstep\b(?:\s+(?:it|forward|through))?(?:\s+(\d+))?/i)
  if (stepped) ask.step = stepped[1] ? Number(stepped[1]) : 1

  if (/\b(?:explain|explanation|what does this mean)\b/i.test(text) && !/\bhide\b/i.test(text)) ask.explain = true
  if (/\bhide\b.{0,16}\bexplan/i.test(text)) ask.explain = false

  const saved = text.match(/\b(?:save|export|download)\b.{0,20}?\b(csv|json|png|picture|image)\b/i)
  if (saved) ask.save = saved[1].toLowerCase()

  // "press build hamiltonian", "click run trial", "show the spectrum"
  const pressed = text.match(/\b(?:press|click|hit|tap)\s+(?:the\s+)?["\u2018\u2019\u201c\u201d']?([a-zA-Z][a-zA-Z0-9 \u2013\u2014()/.&+-]{1,40}?)["\u2018\u2019\u201c\u201d']?\s*(?:button)?\s*$/i)
  if (pressed) ask.press = [pressed[1].trim()]

  return ask
}
