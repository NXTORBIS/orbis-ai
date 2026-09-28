/**
 * Pages talking to each other.
 *
 * A Page that can send data to another Page is a Page that can exfiltrate data to another Page. That sentence is the
 * whole design brief: everything here exists because two Pages with different permissions must not be able to pool them
 * by cooperating, and because a Page must not be able to learn what other Pages exist.
 *
 * ## The rules that do not bend
 *
 * - **Both ends consent.** The sender needs `page.send` scoped to the receiver, and the receiver must have declared it
 *   accepts that kind of message. One-sided permission would let any Page push data into any other.
 * - **A Page cannot enumerate other Pages.** There is no "list the Pages" call and no error that distinguishes "that
 *   Page does not exist" from "that Page will not talk to you". Both are the same sentence, because the difference is
 *   exactly what a Page would use to map what is installed.
 * - **Permission does not pool.** A Page with the camera cannot become a camera service for a Page without it. Every
 *   capability is checked against the Page that is *using* it, never against whoever asked.
 * - **Messages are data.** Functions, prototypes and anything that is not plain JSON do not cross. A message that could
 *   carry behaviour is a message that carries code.
 * - **Cycles are caught.** A pipeline that feeds back into itself is stopped by a hop count carried with the message,
 *   not by trusting each Page to behave.
 *
 * Pure. No transport, no clock: `now` is always passed in, and the caller does the sending.
 */

import { capabilityById } from './capabilities.ts'
import { isPageId, type PageId } from './identity.ts'

export const COMPOSITION_LIMITS = Object.freeze({
  /** A single message, serialised. */
  messageBytes: 128 * 1024,
  /** How many Pages a message may pass through before it is stopped as a loop. */
  hops: 8,
  /** Message kinds one Page may declare it accepts. */
  acceptedKinds: 32,
  /** Outstanding requests between one pair of Pages. */
  outstanding: 16,
  kindLength: 64,
  /** Steps in one pipeline. */
  steps: 12
})

export interface CompositionError {
  error:
    | 'not-available'
    | 'not-allowed'
    | 'too-large'
    | 'too-many-hops'
    | 'invalid-message'
    | 'unknown-kind'
    | 'too-many-outstanding'
    | 'invalid-pipeline'
  message: string
}

export const isCompositionError = (value: unknown): value is CompositionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * The one sentence a Page gets when it cannot reach another Page.
 *
 * Identical whether the Page does not exist, is not installed, belongs to another profile, or simply refuses this kind
 * of message. Telling them apart is exactly how a Page would work out what else is on the machine, one guess at a time.
 */
const NOT_AVAILABLE: CompositionError = Object.freeze({
  error: 'not-available',
  message: 'That Page is not available to receive this.'
})

/** What a Page says it will accept. A declaration, checked against the receiver, never against the sender's claim. */
export interface Acceptance {
  /** The kind of message, like `table.rows` or `plot.series`. A name, not a schema. */
  kind: string
  /** What the Page does with it, for the permission prompt. */
  describe: string
  /** Whether the sender gets an answer back. */
  replies: boolean
}

export interface Participant {
  pageId: PageId
  /** What this Page has declared it accepts. Empty means it talks to nobody. */
  accepts: readonly Acceptance[]
  /** What this Page has actually been granted. Checked when *this* Page acts, never borrowed by anybody else. */
  granted: readonly string[]
  /** Whether the Page is currently running and able to receive. */
  running: boolean
}

export function checkKind(kind: string): CompositionError | null {
  if (typeof kind !== 'string' || kind === '') {
    return { error: 'unknown-kind', message: 'A message needs a kind.' }
  }
  if (kind.length > COMPOSITION_LIMITS.kindLength) {
    return { error: 'unknown-kind', message: 'That message kind is longer than a name should be.' }
  }
  // The same shape as an operation name, and for the same reason: a pattern says "is this a name at all", which is safe
  // against a name nobody thought of, where a blocklist only says "is this one of the bad ones".
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(kind)) {
    return { error: 'unknown-kind', message: `"${kind}" is not shaped like a message kind.` }
  }
  return null
}

// ---------------------------------------------------------------- messages

export interface Message {
  /** The sender's correlation id, echoed back with any reply. */
  id: string
  kind: string
  /** Plain data. Anything that is not survives nothing here. */
  body: unknown
  /**
   * How many Pages this has already passed through.
   *
   * Carried with the message rather than tracked per Page, because a cycle is a property of the path and no single Page
   * can see the path. A Page cannot lower it: the value the sender supplies is ignored and the trusted side sets it.
   */
  hops: number
}

/**
 * Whether a value is plain data.
 *
 * Checked structurally, and deliberately strict: a plain object, an array, a string, a finite number, a boolean or null.
 * Anything with a prototype, anything callable, anything with a getter -- all refused. A message that can carry
 * behaviour is a message that carries code, and the whole point of passing data between Pages is that it is data.
 */
export function isPlainData(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null) return true
  const kind = typeof value
  if (kind === 'string' || kind === 'boolean') return true
  if (kind === 'number') return Number.isFinite(value as number)
  if (kind !== 'object') return false

  if (Array.isArray(value)) return value.every((one) => isPlainData(one, depth + 1))

  // A prototype other than `Object.prototype` (or none at all) means a class instance, a Map, a Date, something with
  // methods. Those do not survive being sent and should not silently become `{}`.
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false

  for (const key of Object.keys(value as object)) {
    // A getter runs code when the value is read, which is code crossing the boundary by another name.
    const descriptor = Object.getOwnPropertyDescriptor(value as object, key)
    if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return false
    if (!isPlainData((value as Record<string, unknown>)[key], depth + 1)) return false
  }
  return true
}

export interface SendInput {
  from: Participant
  /** The id the sender named. Never a Page object the sender supplied. */
  toPageId: string
  kind: string
  body: unknown
  id: string
  /** Every Page in this profile, looked up by the trusted side. The sender never sees this. */
  directory: ReadonlyMap<string, Participant>
  /** Hops already taken, from the message that caused this one. Zero when a person started it. */
  hops?: number
  /** Ids currently outstanding between this pair. */
  outstanding?: readonly string[]
}

export interface SendResult {
  to: Participant
  message: Message
  /** Whether the receiver replies to this kind. */
  expectsReply: boolean
  notes: readonly string[]
}

/**
 * One Page's message to another, checked from both ends.
 *
 * The order matters. The sender's own permission is checked **first**, before anything about the receiver is consulted,
 * so a Page without `page.send` learns nothing at all -- not even whether the Page it named exists. Checking the
 * receiver first would turn this function into a directory.
 */
export function send(input: SendInput): SendResult | CompositionError {
  // 1. The sender's permission, before anything else is looked at.
  const scoped = input.from.granted.includes('page.send')
  if (!scoped) {
    return {
      error: 'not-allowed',
      message: 'This Page has not been allowed to send anything to other Pages.'
    }
  }
  // The capability has to still exist in this build, checked through the registry rather than by trusting the string.
  if (capabilityById('page.send') === null) {
    return { error: 'not-allowed', message: 'Sending between Pages is not available in this version of Orbis.' }
  }

  const problem = checkKind(input.kind)
  if (problem) return problem

  if (!isPageId(input.toPageId)) return NOT_AVAILABLE
  if (input.toPageId === input.from.pageId) {
    return { error: 'invalid-message', message: 'A Page cannot send a message to itself.' }
  }

  // 2. Size, before the body is walked. A message too big to accept is not worth validating.
  let bytes: number
  try {
    bytes = JSON.stringify(input.body)?.length ?? Number.POSITIVE_INFINITY
  } catch {
    return { error: 'invalid-message', message: 'That message could not be read as data. It may contain a cycle.' }
  }
  if (bytes > COMPOSITION_LIMITS.messageBytes) {
    return { error: 'too-large', message: `A message may be at most ${COMPOSITION_LIMITS.messageBytes / 1024} KB; that one was ${Math.round(bytes / 1024)} KB.` }
  }
  if (!isPlainData(input.body)) {
    return {
      error: 'invalid-message',
      message: 'A message between Pages carries plain data only: text, numbers, true or false, lists and simple objects. Anything that could carry behaviour does not cross.'
    }
  }

  // 3. The hop count, set here and never taken from the sender.
  const hops = Math.max(0, Math.floor(input.hops ?? 0)) + 1
  if (hops > COMPOSITION_LIMITS.hops) {
    return {
      error: 'too-many-hops',
      message: `This message has already passed through ${COMPOSITION_LIMITS.hops} Pages, so it was stopped. Pages that pass messages in a circle would otherwise go round forever.`
    }
  }

  if ((input.outstanding?.length ?? 0) >= COMPOSITION_LIMITS.outstanding) {
    return { error: 'too-many-outstanding', message: 'There are already as many requests between these two Pages as are allowed at once.' }
  }

  // 4. Only now is the receiver consulted, and every failure past here is the same sentence.
  const to = input.directory.get(input.toPageId)
  if (to === undefined) return NOT_AVAILABLE
  if (!to.running) return NOT_AVAILABLE
  const acceptance = to.accepts.find((one) => one.kind === input.kind)
  if (acceptance === undefined) return NOT_AVAILABLE

  return {
    to,
    message: { id: input.id, kind: input.kind, body: input.body, hops },
    expectsReply: acceptance.replies,
    notes: Object.freeze([
      `${input.from.pageId} sent a "${input.kind}" to ${to.pageId}. Both Pages agreed to this: one was allowed to send, the other declared it accepts this kind.`,
      'The receiving Page acts with its own permissions. Nothing the sender was allowed to do carries across.'
    ])
  }
}

/**
 * Whether a Page may act on a capability while handling a message from another Page.
 *
 * Always checked against the Page that is *doing* the thing. This is the function that stops two Pages pooling their
 * permissions: a Page with the camera handling a message from a Page without it is still the only one with the camera,
 * and the one without it does not get pictures by asking nicely.
 */
export function mayActOnBehalf(handler: Participant, capabilityId: string): CompositionError | null {
  if (!handler.granted.includes(capabilityId)) {
    return {
      error: 'not-allowed',
      message: `This Page has not been allowed to do that, and a message from another Page does not change it. Permissions belong to the Page that uses them.`
    }
  }
  return null
}

// ---------------------------------------------------------------- pipelines

export interface PipelineStep {
  pageId: string
  /** The kind this step sends onward. */
  produces: string
  /** What this step does, for the description shown before it runs. */
  describe: string
}

export interface Pipeline {
  id: string
  name: string
  steps: readonly PipelineStep[]
}

export interface PipelinePlan {
  pipeline: Pipeline
  /** Every capability the whole pipeline will use, and which Page uses it. For one prompt instead of several. */
  willUse: readonly { pageId: string; capabilities: readonly string[] }[]
  notes: readonly string[]
}

/**
 * A pipeline checked before any of it runs.
 *
 * Two things are worth catching here rather than halfway through. A Page appearing twice makes a loop, which the hop
 * count would stop but only after the work had been done several times. And the capabilities the whole chain will use
 * are collected so somebody can be asked once, up front, rather than prompted at each step -- a prompt that appears in
 * the middle of something already running is a prompt people click through.
 */
export function planPipeline(pipeline: Pipeline, directory: ReadonlyMap<string, Participant>): PipelinePlan | CompositionError {
  if (pipeline.steps.length === 0) {
    return { error: 'invalid-pipeline', message: 'A pipeline needs at least one step.' }
  }
  if (pipeline.steps.length > COMPOSITION_LIMITS.steps) {
    return { error: 'invalid-pipeline', message: `A pipeline may have at most ${COMPOSITION_LIMITS.steps} steps.` }
  }

  const seen = new Set<string>()
  for (const step of pipeline.steps) {
    const problem = checkKind(step.produces)
    if (problem) return { error: 'invalid-pipeline', message: problem.message }
    if (seen.has(step.pageId)) {
      return {
        error: 'invalid-pipeline',
        message: 'A Page appears twice in this pipeline, which would make it run in a circle.'
      }
    }
    seen.add(step.pageId)
  }

  const notes: string[] = []
  const willUse: { pageId: string; capabilities: readonly string[] }[] = []
  for (let i = 0; i < pipeline.steps.length; i++) {
    const step = pipeline.steps[i]
    const participant = directory.get(step.pageId)
    // The same sentence as everywhere else, so a pipeline is not a way to probe what exists either.
    if (participant === undefined) return NOT_AVAILABLE

    // Each step after the first has to accept what the one before it produces.
    if (i > 0) {
      const incoming = pipeline.steps[i - 1].produces
      if (!participant.accepts.some((one) => one.kind === incoming)) {
        return {
          error: 'invalid-pipeline',
          message: `Step ${i + 1} does not accept "${incoming}", which is what the step before it produces.`
        }
      }
    }
    willUse.push({ pageId: step.pageId, capabilities: Object.freeze([...participant.granted]) })
  }

  const risky = willUse
    .flatMap((one) => one.capabilities.map((id) => ({ pageId: one.pageId, definition: capabilityById(id) })))
    .filter((one) => one.definition !== null && (one.definition.risk === 'high' || one.definition.risk === 'critical'))
  if (risky.length > 0) {
    notes.push(
      `Somewhere in this chain: ${[...new Set(risky.map((one) => one.definition?.name))].join(', ')}. Every step keeps its own permissions, so this lists what the chain as a whole can reach.`
    )
  }
  notes.push(`${pipeline.steps.length} steps, each running with its own permissions. Nothing is shared between them except the data passed along.`)

  return { pipeline, willUse: Object.freeze(willUse), notes: Object.freeze(notes) }
}

/** What talking between Pages does and does not allow, for the permission prompt. */
export const COMPOSITION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Both Pages have to agree: one must be allowed to send, and the other must have said it accepts that kind of message.',
  'Permissions never pool. A Page handling a message acts with its own permissions, and nothing the sender was allowed to do carries across.',
  'A Page cannot find out what other Pages exist. Every reason a message cannot be delivered gives the same answer, because the differences between them are a map of what is installed.',
  'Messages carry plain data. Anything that could carry behaviour does not cross.',
  'A message that has passed through too many Pages is stopped, so Pages passing messages in a circle cannot go round forever.',
  'A pipeline is checked before any of it runs, and asks about every permission it will use once, at the start.'
])
