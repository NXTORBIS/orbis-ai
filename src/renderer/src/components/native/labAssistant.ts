import { apply, look, readAsk, type Ask } from '../../physics/control'

/** Same comparison the studio uses, so "Projectile Motion" and "projectile motion" are one name. */
const tidy = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * The assistant behind the orb: it answers about the laboratory in front of you, and it works its controls.
 *
 * ## It is deliberately small
 *
 * The orb is not a second chat window. It knows about the lab that is open and nothing else, so it will explain
 * what a control does, change one, run the simulation, or say what the numbers mean — and it will say plainly
 * that opening a browser tab, reading your files or looking something up is not its job. Those belong to the
 * conversation behind it, and it says so rather than pretending it cannot understand.
 *
 * The boundary is enforced here, not only asked for in the prompt. A model told to stay in its lane sometimes
 * does not, so a command that is not one of the studio's own is dropped on the way back and the reply says what
 * was ignored. That is the difference between a boundary and a request.
 *
 * ## Ordinary politeness still works
 *
 * "Hello", "what can you do", "thanks" are answered normally. Refusing those would make it feel broken rather
 * than focused.
 */

export interface LabReply {
  /** What to show in the orb. */
  says: string
  /** What it did to the laboratory, if anything. */
  did: string[]
  /** What it would not do, and why. */
  declined: string[]
}

/** The only things it is allowed to change. Anything else a model asks for is dropped here. */
const ALLOWED = new Set([
  'topic',
  'section',
  'set',
  'tab',
  'press',
  'speed',
  'playing',
  'step',
  'reset',
  'explain',
  'save'
])

/**
 * Things that are plainly not the laboratory's business. Matched before the model is asked, so an obvious
 * out-of-scope request costs nothing and gets a consistent answer rather than whatever the model felt like.
 */
const NOT_MINE: readonly { test: RegExp; what: string }[] = Object.freeze([
  { test: /\b(open|go to|visit|browse|navigate)\b.{0,20}\b(browser|tab|website|site|url|google|youtube)\b/i, what: 'opening pages in the browser' },
  { test: /\b(search|look up|google)\b.{0,30}\b(web|internet|online)\b/i, what: 'searching the web' },
  { test: /\b(my|the)\b.{0,12}\b(files?|folder|documents?|downloads?|desktop)\b/i, what: 'anything to do with your files' },
  { test: /\b(email|e-mail|message|whatsapp|slack|send.{0,10}\bto\b)\b/i, what: 'sending messages' },
  { test: /\b(password|secret|api key|token|vault|credential)\b/i, what: 'passwords or anything in the vault' },
  { test: /\b(install|download|update|restart|shut ?down|delete|uninstall)\b/i, what: 'changing or installing anything' },
  { test: /\b(weather|news|stock|price of|flight|recipe|translate)\b/i, what: 'looking things up in the world' },
  { test: /\b(write|draft|compose)\b.{0,20}\b(essay|email|letter|poem|story|code)\b/i, what: 'writing things for you' }
])

/**
 * Questions that cannot be answered from the numbers.
 *
 * A control's value and a readout are text, and text is enough for "what is the range" or "what does damping do".
 * Shape is not: whether a curve has flattened, where two lines cross, which way a field points, what the picture
 * looks like. For those the simulation is photographed and the picture goes to the one service with eyes.
 */
const NEEDS_EYES =
  /\b(look|see|screen|picture|image|shape|curve|graph|plot|colou?r|draw|drawn|shown|showing|display|pattern|where (is|are|does)|which way|looks? like|point(ing)?|cross(ing|es)?|flat(ten)?|steep|spike|peak|trough|symmetr|orient)/i

/**
 * The rectangle the simulation occupies, in window coordinates, for the main process to photograph.
 *
 * It is the simulation's own box, not the window: photographing the window would include the orb, the explainer
 * and the studio's chrome, and the question is about the physics.
 */
function picture(): { x: number; y: number; width: number; height: number } | null {
  if (typeof document === 'undefined') return null
  const studio = document.querySelector('.p8-studio')
  if (!studio) return null
  // Prefer the drawing itself. Several laboratories draw with SVG rather than a canvas, so both count.
  const drawn = [...studio.querySelectorAll('canvas, svg')]
    .map((one) => one.getBoundingClientRect())
    .filter((box) => box.width > 80 && box.height > 80)
  if (drawn.length === 0) return null
  // The whole drawing area, so a laboratory with a plot beside its scene is photographed as one picture.
  const left = Math.min(...drawn.map((b) => b.left))
  const top = Math.min(...drawn.map((b) => b.top))
  const right = Math.max(...drawn.map((b) => b.right))
  const bottom = Math.max(...drawn.map((b) => b.bottom))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

const GREETING = /^\s*(hi|hey|hello|yo|good (morning|afternoon|evening)|thanks?|thank you|ta|cheers|ok|okay)\b[\s!.?]*$/i
const WHAT_CAN_YOU_DO = /\b(what can you do|what do you do|help|who are you|what are you|how do(es)? (this|it) work)\b/i

/** Everything about the lab the model needs to answer sensibly, and nothing it does not. */
export function context(): string {
  const now = look()
  if (!now.open) return 'No laboratory is open at the moment.'
  const controls = now.controls
    .map((one) => {
      const range = one.least !== undefined && one.most !== undefined ? ` (${one.least} to ${one.most})` : ''
      const choices = one.options ? ` (one of: ${one.options.join(', ')})` : ''
      return `  - ${one.label} = ${one.value}${range}${choices}`
    })
    .join('\n')
  const readouts = Object.entries(now.readouts)
    .slice(0, 12)
    .map(([name, value]) => `  - ${name}: ${value}`)
    .join('\n')
  return [
    `The Physics Studio is open${now.topic ? ` on "${now.topic}"` : ''}.`,
    now.running ? 'It is running.' : 'It is not running.',
    controls === '' ? 'It has no adjustable controls.' : `Its controls are:\n${controls}`,
    now.choices.length === 0 ? '' : `It offers these views to choose between: ${now.choices.join(', ')}.`,
    now.buttons.length === 0 ? '' : `Its own buttons are: ${now.buttons.map((one) => `"${one}"`).join(', ')}.`,
    now.explaining ? 'The explanation below it is showing.' : 'The explanation below it is hidden.',
    readouts === '' ? '' : `It is currently reporting:\n${readouts}`
  ]
    .filter((one) => one !== '')
    .join('\n')
}

/** What the model is told. Written here so it is one thing, reviewable, rather than scattered. */
export function prompt(asked: string): string {
  return [
    'You are the assistant inside Orbis\'s Physics Studio. You help with the laboratory that is open and nothing else.',
    '',
    context(),
    '',
    'What you may do:',
    '  - Explain the physics, the controls, or what the numbers on screen mean.',
    '  - Work the studio: open a topic or a section, choose one of its views, set any of its controls, press any',
    '    of its own buttons, set the run speed, start it, stop it, step it, reset it, show or hide the',
    '    explanation, and save what it measured.',
    '  - Answer an ordinary greeting or a question about what you can do.',
    '',
    'What you must not do: anything outside this studio. No browser, no files, no web searches, no messages, no',
    'settings, no writing things. If you are asked for one of those, say in one sentence that it is not what you',
    'do here and that the conversation behind the lab can help with it. Do not apologise at length.',
    '',
    'Answer with JSON and nothing else:',
    '{"says": "<at most three sentences, plain words>", "command": null}',
    'or, when the studio should change, any of these together:',
    '{"says": "<what you are doing>", "command": {',
    '  "topic": "<a topic name>",',
    '  "section": "<a section name, to show the grid>",',
    '  "tab": "<one of the views listed above>",',
    '  "set": {"<control label exactly as listed>": <number, text or true/false>},',
    '  "press": ["<a button label exactly as listed>"],',
    '  "speed": <number, no unit>,',
    '  "playing": <true to run, false to stop>,',
    '  "step": <how many single frames>,',
    '  "reset": true,',
    '  "explain": <true to show the explanation, false to hide it>,',
    '  "save": "csv" | "json" | "png"',
    '}}',
    'Leave out every part you do not mean. Use the labels exactly as listed above, including their units.',
    'To open a topic, always use "topic" with the topic\'s own name. Never use "press" or "section" to open a',
    'topic: "press" is only for the buttons listed above, and "section" leaves the laboratory and shows the grid.',
    'Only include "topic" when the person asked for a different topic. A request to change a control is about the',
    'topic already open, and naming one again risks replacing what they are working on.',
    'Never invent a control or a button that is not listed. If what was asked for is not there, say so in "says"',
    'and use null. Do not press a button to "apply" a setting unless the laboratory listed one.',
    '',
    `The person said: ${asked}`
  ].join('\n')
}

/** Keeps only what the studio is allowed to be asked for, and says what it threw away. */
function onlyStudio(command: unknown): { ask: Ask; dropped: string[] } {
  const dropped: string[] = []
  const ask: Ask = {}
  if (typeof command !== 'object' || command === null) return { ask, dropped }

  for (const [key, value] of Object.entries(command as Record<string, unknown>)) {
    if (!ALLOWED.has(key)) {
      dropped.push(key)
      continue
    }
    if (key === 'topic' && typeof value === 'string') {
      /*
       * A topic that is already open is dropped rather than re-opened. A model asked only to change a control
       * volunteers the current topic often, and re-opening it resets the simulation -- so the control would be
       * set on a laboratory that had just been thrown away.
       */
      if (tidy(value) !== tidy(look().topic ?? '')) ask.topic = value
    }
    else if (key === 'section' && typeof value === 'string') ask.section = value
    else if (key === 'tab' && typeof value === 'string') ask.tab = value
    else if (key === 'save' && typeof value === 'string') ask.save = value
    else if (key === 'speed' && typeof value === 'number') ask.speed = value
    else if (key === 'step' && typeof value === 'number') ask.step = value
    else if (key === 'playing' && typeof value === 'boolean') ask.playing = value
    else if (key === 'reset' && typeof value === 'boolean') ask.reset = value
    else if (key === 'explain' && typeof value === 'boolean') ask.explain = value
    else if (key === 'press') {
      // One name or several. A model asked for "press this" sends a string about as often as a list.
      const many = (Array.isArray(value) ? value : [value]).filter((one): one is string => typeof one === 'string' && one.trim() !== '')
      if (many.length > 0) ask.press = many
    } else if (key === 'set' && typeof value === 'object' && value !== null) {
      const set: Record<string, string | number | boolean> = {}
      for (const [name, one] of Object.entries(value as Record<string, unknown>)) {
        if (typeof one === 'string' || typeof one === 'number' || typeof one === 'boolean') set[name] = one
      }
      if (Object.keys(set).length > 0) ask.set = set
    }
  }
  return { ask, dropped }
}

/** Reads the model's reply. A reply that is not the JSON asked for is used as plain words rather than discarded. */
function readReply(text: string): { says: string; command: unknown } {
  let cleaned = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '')
  /*
   * A model sometimes says a sentence before the JSON, or wraps it in prose. Taking the outermost braces finds the
   * object anyway, so a command is carried out instead of the whole reply being shown as words.
   */
  if (!cleaned.startsWith('{')) {
    const from = cleaned.indexOf('{')
    const to = cleaned.lastIndexOf('}')
    if (from !== -1 && to > from) cleaned = cleaned.slice(from, to + 1)
  }
  try {
    const held = JSON.parse(cleaned) as { says?: unknown; command?: unknown }
    return {
      says: typeof held.says === 'string' && held.says.trim() !== '' ? held.says.trim() : cleaned,
      command: held.command ?? null
    }
  } catch {
    return { says: cleaned, command: null }
  }
}

/**
 * Answer one thing said to the orb.
 *
 * Out-of-scope requests are turned away here, before anything is asked of a model: it costs nothing, the answer
 * is the same every time, and it cannot be talked round.
 */
export async function answer(asked: string): Promise<LabReply> {
  const said = String(asked ?? '').trim()
  if (said === '') return { says: 'Ask me something about the laboratory.', did: [], declined: [] }

  const outside = NOT_MINE.find((one) => one.test.test(said))
  if (outside) {
    return {
      says: `That is not what I do here — I only work this laboratory. Ask in the conversation behind it for ${outside.what}.`,
      did: [],
      declined: [outside.what]
    }
  }

  if (GREETING.test(said)) {
    const now = look()
    return {
      says: now.open && now.topic
        ? `Hello. ${now.topic} is open — ask me about it, or tell me what to change.`
        : 'Hello. Open a topic and I can explain it or work its controls.',
      did: [],
      declined: []
    }
  }

  if (WHAT_CAN_YOU_DO.test(said)) {
    const now = look()
    const some = now.controls.slice(0, 2).map((one) => `"set ${one.label} to ${one.most ?? 10}"`).join(', ')
    return {
      says: now.open
        ? `I explain what is on screen and I work it. I can open any topic, set any control, choose a view, press its buttons, run it, step it, reset it, change the speed, show the explanation and save the measurements. Try ${some || '"run it at 2x"'}, "step it 10 times", or "open the double pendulum". Anything outside this studio belongs in the conversation behind it.`
        : 'I explain the laboratory that is open and work all of its controls. Open a topic and ask me about it.',
      did: [],
      declined: []
    }
  }

  // Something that is plainly a command can be carried out without asking a model at all.
  const direct = readAsk(said)
  const looksLikeCommand =
    /\b(open|run|play|start|pause|stop|set|change|make|press|click|step|reset|show|hide|save|export)\b/i.test(said) &&
    (direct.topic !== undefined ||
      direct.section !== undefined ||
      direct.set !== undefined ||
      direct.tab !== undefined ||
      direct.press !== undefined ||
      direct.speed !== undefined ||
      direct.playing !== undefined ||
      direct.step !== undefined ||
      direct.reset !== undefined ||
      direct.explain !== undefined ||
      direct.save !== undefined)

  /*
   * A sentence the patterns understood completely is done here, with no model involved.
   *
   * It is faster, it cannot be misread, and it works with no key set. It also fixes the opposite failure: Orion
   * does not hold the list of 245 topics, so asked to open one by name it would say it could not -- about a
   * topic sitting in the studio's own list.
   */
  if (looksLikeCommand) {
    const got = await apply(direct)
    if (got.done.length > 0) {
      return { says: got.done.join(' '), did: got.done, declined: got.refused }
    }
    // Nothing happened. Fall through to Orion, which may read the sentence better than the patterns did.
  }

  const api = typeof window !== 'undefined' ? window.api : null
  if (!api || typeof api.physicsAsk !== 'function') {
    if (!looksLikeCommand) {
      return { says: 'Orion is not available here, so I can only work the controls — try "run it at 2x".', did: [], declined: [] }
    }
    const got = await apply(direct)
    return { says: got.done.join(' ') || 'Nothing changed.', did: got.done, declined: got.refused }
  }

  /*
   * A question about shape goes to the model that can see, with the simulation photographed. It answers in words
   * rather than JSON, because looking at a picture is explaining, not commanding -- so the reply is shown as it
   * came and the studio is not touched.
   */
  const area = NEEDS_EYES.test(said) && !looksLikeCommand ? picture() : null
  if (area !== null && typeof api.physicsLook === 'function') {
    let seen: string | null = null
    try {
      seen = await api.physicsLook(
        [
          context(),
          '',
          'The picture is the simulation as it is drawn right now. Answer in at most three sentences, in plain',
          'words, about what the picture shows. Say plainly if the picture does not show what was asked about.',
          '',
          `The person asked: ${said}`
        ].join('\n'),
        area
      )
    } catch {
      seen = null
    }
    if (seen !== null && seen.trim() !== '') return { says: seen.trim(), did: [], declined: [] }
    // Nothing could look at it. Fall through and answer from the numbers rather than saying nothing.
  }

  let text: string | null = null
  try {
    text = await api.physicsAsk(prompt(said), null)
  } catch {
    text = null
  }

  if (text === null || text.trim() === '') {
    // No answer from the model. If it read as a command, do it anyway rather than saying nothing useful.
    if (looksLikeCommand) {
      const got = await apply(direct)
      return {
        says: got.done.length > 0 ? got.done.join(' ') : 'I could not reach Orion, and there was nothing to change.',
        did: got.done,
        declined: got.refused
      }
    }
    return { says: 'I could not reach Orion just now. The controls still work.', did: [], declined: [] }
  }

  const { says, command } = readReply(text)
  const { ask, dropped } = onlyStudio(command)

  const declined = dropped.map((one) => `"${one}" is not something this laboratory has`)
  if (Object.keys(ask).length === 0) return { says, did: [], declined }

  const got = await apply(ask)
  return { says, did: got.done, declined: [...declined, ...got.refused] }
}
