import { PHYSICS_TOPICS, searchTopics, type PhysicsTopicRow } from '../physics/topics.ts'
import { CHEMISTRY_MODULES, findChemistryModule, type ChemistryModuleRow } from '../chemistry/modules.ts'

/**
 * Reading "open collision of two objects, initial velocity 30" as a laboratory to open and the values to set.
 *
 * ## Why this is not left to a model
 *
 * It used to be. The chat asked Orion whether a message wanted an app, and a message like "open collision of 2
 * objects animation" came back as something to search the web for — so Orbis opened the browser instead of the
 * laboratory that has exactly that simulation in it. The topic names are a list Orbis holds; matching against a
 * list is not a judgement, and asking a model to do it adds a way to get it wrong.
 *
 * So this decides first, from the names themselves. Orion is still asked about everything this cannot place,
 * which is where a model is actually better than a list.
 *
 * ## It is shared on purpose
 *
 * The orb inside a laboratory and the chat outside it must understand the same sentence the same way. Two readers
 * would drift, and the difference would show up as "it works in the lab but not in the chat" — which is exactly
 * what was reported.
 */

export interface LabRequest {
  /** Which laboratory. */
  app: 'physics-studio' | 'chemistry-studio'
  /** The topic or module to open, by its own name. */
  opens: string
  /** Its id, for anything that would rather match on that. */
  id: string
  /** `name = value` pairs for the simulation's own controls, in the form the studio's settings parameter takes. */
  settings: string
  /** How fast to run it, as a multiple of real time. Absent when the message did not say. */
  speed?: number
  /** Whether to start it. Absent when the message did not say. */
  playing?: boolean
  /** How certain this is: `named` when the message named the topic, `matched` when it was found by its words. */
  how: 'named' | 'matched'
}

const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Words that mean "put this on screen", so a plain question is not turned into a laboratory.
 *
 * "What is projectile motion" is a question and gets an answer. "Open projectile motion" is a request.
 */
const OPENS = /\b(open|show|run|start|launch|simulate|simulation|animate|animation|visuali[sz]e|demonstrate|play|model|lab|studio|experiment|interactive|plot|graph|draw)\b/i

/** A question, which must be answered rather than opened, unless it also plainly asks for the thing on screen. */
const ASKS = /^\s*(what|why|how|when|who|which|is|are|does|do|can|could|should|explain|tell me about|define)\b/i

/**
 * Numbers people say in words, because "initial velocity thirty" is as likely as "30".
 *
 * Only up to twenty and the round tens: past that people write the digits, and a longer table would start
 * matching words that are not numbers at all.
 */
const WORDS: Readonly<Record<string, number>> = Object.freeze({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  half: 0.5, double: 2, twice: 2
})

/** The words that are about the laboratory rather than about the physics, dropped before matching a topic. */
const FLUFF =
  /\b(please|can you|could you|i want|i would like|for me|the|a|an|of|on|in|with|and|to|some|me|now|just|simulation|simulations|animation|animated|animate|visuali[sz]e|visuali[sz]ation|interactive|demo|demonstration|lab|laboratory|studio|experiment|open|show|run|start|launch|play|model|plot|graph|draw|objects?|bodies|body)\b/gi

/** "2 objects" and "two objects" both describe the scene, not a control, so the count is not a setting. */
const COUNTING = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(objects?|bodies|body|balls?|masses|particles?|blocks?|carts?|pendulums?|springs?)\b/gi

/** Words that are plainly a run speed rather than one of the simulation's own controls. */
const SPEED = /\b(?:at\s+)?(\d+(?:\.\d+)?)\s*(?:x|times)(?:\s+(?:speed|faster|slower))?\b/i

/**
 * The settings a message asked for, as `name = value` lines.
 *
 * Only pairs where a name is followed by a number are taken, and the counting phrases are removed first so
 * "collision of 2 objects" does not set a control called "collision of" to 2. Anything ambiguous is left out
 * rather than guessed at: a wrong value set silently is worse than a value not set.
 */
export function readSettings(sentence: string): string {
  let text = String(sentence ?? '')
  // The scene description and the run speed both look like a name followed by a number. Remove them first.
  text = text.replace(COUNTING, ' ').replace(SPEED, ' ')

  const found = new Map<string, string>()

  // "initial velocity 30", "angle = 45", "mass: 2.5", "gravity of 3.7", "set the launch angle to 60"
  const digits = /([a-zA-Z][a-zA-Z _°µ()/-]{1,34}?)\s*(?:=|:|\bof\b|\bto\b|\bis\b|\bat\b)?\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z°/²³]{0,8})/g
  for (const one of text.matchAll(digits)) {
    const name = cleanName(one[1])
    const value = one[2]
    if (name === '' || !Number.isFinite(Number(value))) continue
    found.set(name, value)
  }

  // "initial velocity thirty"
  const spelled = new RegExp(`([a-zA-Z][a-zA-Z _°µ()/-]{1,34}?)\\s*(?:=|:|\\bof\\b|\\bto\\b|\\bis\\b)?\\s*\\b(${Object.keys(WORDS).join('|')})\\b`, 'gi')
  for (const one of text.matchAll(spelled)) {
    const name = cleanName(one[1])
    if (name === '') continue
    const value = WORDS[one[2].toLowerCase()]
    if (value === undefined || found.has(name)) continue
    found.set(name, String(value))
  }

  return [...found].map(([name, value]) => `${name} = ${value}`).join(', ')
}

/** Strips the leading verbs and filler from a control's name, and refuses anything that is left over as noise. */
function cleanName(raw: string): string {
  const name = String(raw)
    .replace(/^\s*(?:with|and|at|set|make|change|using|where|but)\s+/i, '')
    .replace(/\b(?:the|a|an|its|it|please)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (name.length < 2) return ''
  // A name that is only a preposition or a verb is not a control.
  if (/^(?:of|to|is|at|in|on|for|by|as|so|if|or)$/i.test(name)) return ''
  return name
}

/** The run speed a message asked for, or undefined when it did not say. */
export function readSpeed(sentence: string): number | undefined {
  const got = SPEED.exec(String(sentence ?? ''))
  if (!got) return undefined
  const times = Number(got[1])
  return Number.isFinite(times) && times > 0 ? times : undefined
}

/** Whether a message asked for it to be running, stopped, or did not say. */
export function readPlaying(sentence: string): boolean | undefined {
  const text = String(sentence ?? '')
  if (/\b(?:pause|stop|hold|freeze)\b/i.test(text)) return false
  if (/\b(?:run|play|start|go|animate|simulate)\b/i.test(text)) return true
  return undefined
}

/**
 * Which laboratory and which topic a message is asking for, or null when it is not asking for one.
 *
 * `null` is the common answer and must stay cheap: most messages are conversation. It is also the honest answer —
 * returning a laboratory for a message that did not want one takes over half the screen uninvited.
 */
export function readLabRequest(sentence: string): LabRequest | null {
  const text = String(sentence ?? '').trim()
  if (text === '' || text.length > 400) return null

  // A question is answered, not opened -- unless it also says to put the thing on screen.
  if (ASKS.test(text) && !OPENS.test(text)) return null
  if (!OPENS.test(text)) return null

  const settings = readSettings(text)
  const speed = readSpeed(text)
  const playing = readPlaying(text)

  // What is left once the words about opening things are gone is what names the topic.
  const subject = text
    .replace(SPEED, ' ')
    .replace(/[,;].*$/, ' ')
    .replace(/\b(?:with|where|at|and set|set)\b.*$/i, ' ')
    /*
     * "2 objects" describes the scene, not the topic.
     *
     * Left in, the stray 2 made "collision of 2 objects" match nothing at all — every word has to appear
     * somewhere in the topic, and no topic has a 2 in its name. That one leftover digit is why asking for a
     * collision animation ended up as a web search.
     */
    .replace(COUNTING, ' ')
    .replace(FLUFF, ' ')
    // Letters only by this point: a number left here is a value or a count, never part of a topic's name.
    .replace(/[^a-zA-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  /*
   * A second reading, with only the opening verb taken off.
   *
   * Some words are both a request and a name: "visualization" is how people ask for a picture and is also one of
   * their module names, so stripping it left "chemical" and matched nothing.
   */
  const kept = text
    .replace(SPEED, ' ')
    .replace(/[,;].*$/, ' ')
    .replace(/\b(?:with|where|at|and set|set)\b.*$/i, ' ')
    .replace(COUNTING, ' ')
    .replace(/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:open|show me|show|run|start|launch|load|go to|take me to|play)\s+/i, ' ')
    .replace(/\b(?:the|a|an|of|for|me|please|module|studio|lab|laboratory)\b/gi, ' ')
    .replace(/[^a-zA-Z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (subject.length < 3 && kept.length < 3) return null

  // The filler-stripped reading first, then the one that kept it. Either may be the one that names something.
  const physics = (subject.length >= 3 ? matchPhysics(subject) : null) ?? (kept.length >= 3 ? matchPhysics(kept) : null)
  const chemistry = (subject.length >= 3 ? matchChemistry(subject) : null) ?? (kept.length >= 3 ? matchChemistry(kept) : null)

  /*
   * Both matched. The longer name is the more specific one, because a one-word match against a 245-item list is
   * much more often a coincidence than a two-word match is.
   */
  if (physics && chemistry) {
    return physics.opens.length >= chemistry.opens.length
      ? { ...physics, settings, ...(speed !== undefined ? { speed } : {}), ...(playing !== undefined ? { playing } : {}) }
      : { ...chemistry, settings }
  }
  if (physics) {
    return { ...physics, settings, ...(speed !== undefined ? { speed } : {}), ...(playing !== undefined ? { playing } : {}) }
  }
  if (chemistry) return { ...chemistry, settings }
  return null
}

function matchPhysics(subject: string): Omit<LabRequest, 'settings' | 'speed' | 'playing'> | null {
  const want = tidy(subject)
  if (want === '') return null

  const named = PHYSICS_TOPICS.find((one) => tidy(one.name) === want)
  if (named) return { app: 'physics-studio', opens: named.name, id: named.id, how: 'named' }

  const inside = PHYSICS_TOPICS.filter((one) => tidy(one.name).includes(want) || want.includes(tidy(one.name)))
  if (inside.length === 1) return row(inside[0], 'named')
  if (inside.length > 1) {
    // Several. The shortest name is the canonical topic rather than a longer variant of it.
    const shortest = [...inside].sort((a, b) => a.name.length - b.name.length)[0]
    return row(shortest, 'matched')
  }

  // Every word has to appear somewhere in the topic, which is what stops "open it" matching everything.
  const found = searchTopics(subject)
  if (found.length === 0 || found.length > 6) return null
  const shortest = [...found].sort((a, b) => a.name.length - b.name.length)[0]
  return row(shortest, 'matched')
}

const row = (one: PhysicsTopicRow, how: LabRequest['how']): Omit<LabRequest, 'settings' | 'speed' | 'playing'> => ({
  app: 'physics-studio',
  opens: one.name,
  id: one.id,
  how
})

function matchChemistry(subject: string): Omit<LabRequest, 'settings' | 'speed' | 'playing'> | null {
  const got = findChemistryModule(subject)
  if (got === null || Array.isArray(got)) return null
  const one = got as ChemistryModuleRow
  // A module their own registry marks unfinished is not opened: there is nothing behind it.
  if (one.soon) return null
  const want = tidy(subject)
  return {
    app: 'chemistry-studio',
    opens: one.name,
    id: one.id,
    how: tidy(one.name) === want ? 'named' : 'matched'
  }
}

/** The values to open a laboratory with, in the shape its parameters take. */
export function valuesFor(request: LabRequest): Record<string, string | number | boolean> {
  if (request.app === 'chemistry-studio') {
    const out: Record<string, string | number | boolean> = { module: request.opens }
    if (request.settings !== '') out.settings = request.settings
    return out
  }
  const out: Record<string, string | number | boolean> = { topic: request.opens }
  if (request.settings !== '') out.settings = request.settings
  if (request.speed !== undefined) out.speed = request.speed
  if (request.playing !== undefined) out.playing = request.playing
  return out
}

/** The counts, for anything that wants to say how much is reachable this way. */
export const LAB_REACH = Object.freeze({
  physics: PHYSICS_TOPICS.length,
  chemistry: CHEMISTRY_MODULES.filter((one) => !one.soon).length
})
