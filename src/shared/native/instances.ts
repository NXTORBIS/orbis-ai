import { reset as resetParameters, setAll, isParameterProblem, type ParameterProblem, type ParameterSet, type ParameterValue } from './parameters.ts'
import type { AppSize, NativeAppManifest, WhenHidden } from './manifest.ts'
import { sizeFor } from './registry.ts'

/**
 * One opened copy of a Native App, and what may happen to it.
 *
 * ## Why instances exist at all
 *
 * ```
 * Projectile Lab          the app
 * Projectile Lab #a3f     an instance, with its own gravity
 * Experiment 17           a saved computational state
 * ```
 *
 * Two open simulations have to be able to disagree. If they share one mutable object — which is what happens when an
 * app keeps its state in a module-level variable or a single global store slice — changing gravity in one silently
 * changes the other, and the person comparing them is comparing nothing. Every function here returns a new instance
 * rather than editing one, so the isolation is structural instead of remembered.
 *
 * ## The generation counter is the important part
 *
 * Every reset, every reconfigure and every close increments `generation`. An asynchronous result — a worker finishing,
 * an engine returning — carries the generation it was started under, and `accepts` rejects anything stale. Without it
 * the sequence
 *
 * ```
 * open → start a 3-second computation → reset → the old result arrives
 * ```
 *
 * writes an answer from the old configuration into the new one, and the display is then wrong in a way nothing
 * reports. This is the single most common bug in interactive computational UIs and the whole reason this file is not
 * just a record type.
 *
 * ## Closed is not destroyed
 *
 * Closing an instance stops its work and releases its resources; it does not delete the state. A conversation keeps a
 * reference, so reopening restores rather than starting again — and closing a window never loses somebody's
 * experiment.
 *
 * Pure. `now` is always passed in.
 */

// ---------------------------------------------------------------- lifecycle

/**
 * Where an instance is.
 *
 * Not every app uses every state. `running` and `paused` only mean something to an app with a clock, and a plotter
 * goes `ready` and stays there. Forcing a plotter through `running` would make the word meaningless.
 */
export type Phase =
  | 'loading'
  | 'ready'
  | 'running'
  | 'paused'
  | 'suspended'
  | 'error'
  | 'closed'

export const PHASES: readonly Phase[] = Object.freeze(['loading', 'ready', 'running', 'paused', 'suspended', 'error', 'closed'])

/**
 * Which phase may follow which.
 *
 * Written down rather than implied by scattered `if`s, so an impossible move — resuming something that was never
 * running, reviving something closed — is refused in one place and the same way everywhere.
 */
const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = Object.freeze({
  loading: ['ready', 'error', 'closed'],
  ready: ['running', 'suspended', 'error', 'closed', 'loading'],
  running: ['paused', 'ready', 'suspended', 'error', 'closed'],
  paused: ['running', 'ready', 'suspended', 'error', 'closed'],
  suspended: ['ready', 'running', 'paused', 'error', 'closed'],
  error: ['loading', 'ready', 'closed'],
  // Deliberately terminal. An instance is reopened by creating a new one from its saved state, not by reviving this
  // one — a revived instance would still hold workers and subscriptions that were already torn down.
  closed: []
})

export const canMoveTo = (from: Phase, to: Phase): boolean => ALLOWED[from].includes(to)

/** True when an app with a clock should actually be computing. */
export const isLive = (phase: Phase): boolean => phase === 'running'

/** True when work should be stopped and resources given back. */
export const isFinished = (phase: Phase): boolean => phase === 'closed'

// ---------------------------------------------------------------- the instance

export interface InstanceFailure {
  /** What failed, in the words a person would use. Never a stack trace. */
  says: string
  /** What they can do. "Restore", "Restart", "Close" — the host turns these into buttons. */
  recovery: 'restore' | 'restart' | 'close' | 'wait'
  /** Developer detail, shown only in developer mode. */
  detail?: string
}

export interface Instance {
  id: string
  appId: string
  /** The app version this instance was opened against, kept so saved state can be migrated. */
  appVersion: number
  /** The conversation it belongs to, when it was opened from one. */
  conversationId: string | null
  /** The message it is attached to, so the chat can find its block again. */
  messageId: string | null

  phase: Phase
  /** Incremented by anything that invalidates work in flight. Never decremented. */
  generation: number

  parameters: ParameterSet
  /** The app's own state, opaque to the runtime and serialised by the app. */
  domain: Readonly<Record<string, unknown>>
  size: AppSize
  /** True when the host is showing it. Drives `whenHidden`. */
  onScreen: boolean

  failure: InstanceFailure | null
  openedAt: number
  touchedAt: number
  /** Set when the instance was closed, so a conversation can say "this was closed" rather than showing nothing. */
  closedAt: number | null
  /** The experiment this instance's state was last saved as, when it was. */
  experimentId: string | null
}

export interface InstanceError {
  error: 'not-found' | 'bad-phase' | 'closed' | 'parameters' | 'limit'
  message: string
  problems?: readonly ParameterProblem[]
}

export const isInstanceError = (value: unknown): value is InstanceError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: InstanceError['error'], message: string, problems?: readonly ParameterProblem[]): InstanceError => ({
  error,
  message,
  ...(problems ? { problems } : {})
})

/**
 * How many instances may be open at once.
 *
 * A ceiling rather than a guess: a conversation with four hundred open simulations is not a use case, it is a leak,
 * and finding out by running out of memory is worse than being told.
 */
export const MOST_INSTANCES = 48

// ---------------------------------------------------------------- opening

export interface OpenRequest {
  id: string
  manifest: NativeAppManifest
  parameters: ParameterSet
  conversationId?: string | null
  messageId?: string | null
  /** Values to apply before it opens, from Orion or a Search Labs launch. */
  configure?: Readonly<Record<string, unknown>>
  size?: AppSize
  now: number
}

/**
 * A new instance, configured, or the reason it could not be.
 *
 * Configuration is applied before the instance exists, all or nothing. An app that opens and *then* fails to accept
 * three of five values is an app showing a configuration nobody asked for, so the failure happens before anything is
 * on screen.
 */
export function open(request: OpenRequest): Instance | InstanceError {
  const { manifest, now } = request

  let parameters = request.parameters
  if (request.configure && Object.keys(request.configure).length > 0) {
    const applied = setAll(parameters, request.configure)
    if (Array.isArray(applied)) {
      const first = applied[0]
      return fail('parameters', `${manifest.name} could not be opened like that: ${first.says} ${first.fix}`, applied)
    }
    parameters = applied.parameters
  }

  return {
    id: request.id,
    appId: manifest.id,
    appVersion: manifest.version,
    conversationId: request.conversationId ?? null,
    messageId: request.messageId ?? null,
    // Everything starts loading, including apps that have nothing to load: one entry point means the host has one
    // loading state to render rather than two code paths.
    phase: 'loading',
    generation: 1,
    parameters,
    domain: Object.freeze({}),
    size: sizeFor(manifest, request.size),
    onScreen: true,
    failure: null,
    openedAt: now,
    touchedAt: now,
    closedAt: null,
    experimentId: null
  }
}

// ---------------------------------------------------------------- moving between phases

/** A phase change, or the reason it is not allowed. */
export function moveTo(instance: Instance, phase: Phase, now: number): Instance | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')
  if (instance.phase === phase) return instance
  if (!canMoveTo(instance.phase, phase)) {
    return fail('bad-phase', `An app that is ${instance.phase} cannot become ${phase}.`)
  }

  // Anything that abandons work in flight takes the generation with it, so a late result cannot land afterwards.
  const invalidates = phase === 'closed' || phase === 'loading' || phase === 'error'
  return {
    ...instance,
    phase,
    generation: invalidates ? instance.generation + 1 : instance.generation,
    touchedAt: now,
    closedAt: phase === 'closed' ? now : instance.closedAt,
    failure: phase === 'error' ? instance.failure : null
  }
}

export const ready = (instance: Instance, now: number): Instance | InstanceError => moveTo(instance, 'ready', now)
export const run = (instance: Instance, now: number): Instance | InstanceError => moveTo(instance, 'running', now)
export const pause = (instance: Instance, now: number): Instance | InstanceError => moveTo(instance, 'paused', now)
export const close = (instance: Instance, now: number): Instance | InstanceError => moveTo(instance, 'closed', now)

/** An instance that failed, with something a person can act on. */
export function failed(instance: Instance, failure: InstanceFailure, now: number): Instance {
  // Never refused: a failure has already happened, and refusing to record it would leave the instance claiming to run.
  return { ...instance, phase: 'error', failure, generation: instance.generation + 1, touchedAt: now }
}

/**
 * Back to the starting configuration.
 *
 * Deliberately does not touch `experimentId`: resetting the parameters is not deleting the experiment they were saved
 * as. Conflating the two is how a reset button destroys an afternoon's work.
 */
export function reset(instance: Instance, now: number): Instance | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')
  return {
    ...instance,
    parameters: resetParameters(instance.parameters).parameters,
    domain: Object.freeze({}),
    phase: 'ready',
    generation: instance.generation + 1,
    failure: null,
    touchedAt: now
  }
}

// ---------------------------------------------------------------- parameters and state

export interface Changed {
  instance: Instance
  changed: readonly string[]
}

/** Parameters set on an instance, all or nothing. */
export function configure(instance: Instance, values: Readonly<Record<string, unknown>>, now: number): Changed | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')

  const applied = setAll(instance.parameters, values)
  if (Array.isArray(applied)) {
    const first = applied[0]
    return fail('parameters', `${first.says} ${first.fix}`, applied)
  }
  if (applied.changed.length === 0) return { instance, changed: [] }

  // A changed input invalidates whatever is being computed from the old one.
  return {
    instance: { ...instance, parameters: applied.parameters, generation: instance.generation + 1, touchedAt: now },
    changed: applied.changed
  }
}

/**
 * The app's own state replaced.
 *
 * Merged shallowly rather than deeply: a deep merge of state the runtime cannot read would mean guessing which nested
 * values were meant to be removed, and the app is the only thing that knows.
 */
export function store(instance: Instance, domain: Readonly<Record<string, unknown>>, now: number): Instance | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')
  return { ...instance, domain: Object.freeze({ ...instance.domain, ...domain }), touchedAt: now }
}

export function resize(instance: Instance, manifest: NativeAppManifest, size: AppSize, now: number): Instance | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')
  // Resizing must not reset anything: generation is untouched on purpose, so a running computation survives an expand.
  return { ...instance, size: sizeFor(manifest, size), touchedAt: now }
}

/**
 * On or off screen, with the app's own hidden behaviour applied.
 *
 * The runtime cannot decide this. A plotter costs nothing left running and a particle simulation costs a core, so the
 * manifest says which and this acts on it.
 */
export function onScreen(instance: Instance, manifest: NativeAppManifest, visible: boolean, now: number): Instance | InstanceError {
  if (instance.phase === 'closed') return fail('closed', 'That app was closed. Open it again to carry on.')
  if (instance.onScreen === visible) return instance

  const next: Instance = { ...instance, onScreen: visible, touchedAt: now }
  if (visible) {
    // Coming back on screen un-suspends it; it does not resume a clock the person had paused themselves.
    return instance.phase === 'suspended' ? { ...next, phase: 'ready' } : next
  }
  return applyHidden(next, manifest.whenHidden)
}

function applyHidden(instance: Instance, when: WhenHidden): Instance {
  // `continue` and `throttle` both keep running; they differ in how much work the host asks for, which `effort` says.
  if (when !== 'pause') return instance
  // `pause`: only a running clock is stopped. A ready plotter has nothing to pause and must not be marked suspended,
  // or it would appear to need reviving when it is simply idle.
  return instance.phase === 'running' ? { ...instance, phase: 'paused' } : instance
}

/** How much work a hidden instance should be doing. The host reads this; the runtime does not enforce a rate. */
export function effort(instance: Instance, manifest: NativeAppManifest): 'full' | 'reduced' | 'none' {
  if (instance.phase !== 'running') return 'none'
  if (instance.onScreen) return 'full'
  if (manifest.whenHidden === 'continue') return 'full'
  if (manifest.whenHidden === 'throttle') return 'reduced'
  return 'none'
}

// ---------------------------------------------------------------- stale results

/**
 * Whether a result that has just arrived still belongs to this instance.
 *
 * Every asynchronous call records the generation it started under and hands it back. A mismatch means the instance has
 * been reset, reconfigured or closed since, and the result is an answer to a question nobody is asking any more.
 *
 * This is cheap and it is the guard that stops the worst class of bug this platform can have: a correct number
 * displayed against the wrong inputs.
 */
export function accepts(instance: Instance, generation: number): boolean {
  return instance.phase !== 'closed' && generation === instance.generation
}

/** Said in words, for a log or a developer panel. */
export function whyRejected(instance: Instance, generation: number): string | null {
  if (accepts(instance, generation)) return null
  if (instance.phase === 'closed') return `Dropped: ${instance.appId} #${instance.id} was closed.`
  return `Dropped: ${instance.appId} #${instance.id} has moved on (result from generation ${generation}, now ${instance.generation}).`
}

// ---------------------------------------------------------------- a set of them

export type Instances = Readonly<Record<string, Instance>>

/**
 * Add an instance, retiring the stalest one when the ceiling is reached.
 *
 * ## Why it retires rather than refuses
 *
 * Refusing was the original behaviour and it dead-ends the feature. The count is every instance ever opened in the
 * session, across every conversation — so opening labs normally reaches forty-eight, and from then on nothing
 * opens at all, with a message telling you to close something you cannot see. A card sitting in a conversation
 * from an hour ago is not worth that.
 *
 * So the least recently touched one that is not on screen is closed to make room. Anything on screen is left
 * alone: closing something somebody is looking at to open something else would be worse than the limit.
 */
export function add(instances: Instances, instance: Instance): Instances | InstanceError {
  const live = Object.values(instances).filter((one) => one.phase !== 'closed')
  if (live.length < MOST_INSTANCES) {
    return Object.freeze({ ...instances, [instance.id]: instance })
  }

  const stalest = live
    .filter((one) => !one.onScreen)
    .sort((a, b) => a.touchedAt - b.touchedAt)[0]

  if (!stalest) {
    return fail(
      'limit',
      `There are already ${MOST_INSTANCES} apps open and every one of them is on screen. Close one before opening another.`
    )
  }

  return Object.freeze({
    ...instances,
    [stalest.id]: { ...stalest, phase: 'closed', touchedAt: instance.openedAt },
    [instance.id]: instance
  })
}

export function replace(instances: Instances, instance: Instance): Instances {
  return Object.freeze({ ...instances, [instance.id]: instance })
}

export const find = (instances: Instances, id: string): Instance | null => instances[id] ?? null

export const inConversation = (instances: Instances, conversationId: string): readonly Instance[] =>
  Object.values(instances)
    .filter((one) => one.conversationId === conversationId)
    .sort((a, b) => a.openedAt - b.openedAt)

export const openOf = (instances: Instances, appId: string): readonly Instance[] =>
  Object.values(instances).filter((one) => one.appId === appId && one.phase !== 'closed')

/**
 * Closed instances dropped, once there are enough of them to matter.
 *
 * Kept rather than deleted immediately, because a conversation referring to one should say "this was closed" rather
 * than showing nothing at all. Anything whose state was saved as an experiment is never swept — the saved copy is the
 * user's, and the reference to it is how they find it again.
 */
export function sweep(instances: Instances, keep = 24): Instances {
  const closed = Object.values(instances)
    .filter((one) => one.phase === 'closed' && one.experimentId === null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
  if (closed.length <= keep) return instances

  const drop = new Set(closed.slice(keep).map((one) => one.id))
  const out: Record<string, Instance> = {}
  for (const [id, one] of Object.entries(instances)) if (!drop.has(id)) out[id] = one
  return Object.freeze(out)
}

/** What a developer panel shows about one instance. Never shown to anybody else. */
export function diagnose(instance: Instance, manifest: NativeAppManifest | null): Readonly<Record<string, string>> {
  return Object.freeze({
    app: instance.appId,
    instance: instance.id,
    version: String(instance.appVersion),
    phase: instance.phase,
    generation: String(instance.generation),
    size: instance.size,
    onScreen: instance.onScreen ? 'yes' : 'no',
    effort: manifest ? effort(instance, manifest) : 'unknown',
    engine: manifest?.engine ?? 'none',
    parameters: String(Object.keys(instance.parameters).length),
    experiment: instance.experimentId ?? 'not saved',
    failure: instance.failure?.says ?? 'none'
  })
}

/** Parameter problems named, so a refusal can be reported honestly rather than as "invalid". */
export const problemsOf = (error: InstanceError): readonly ParameterProblem[] => error.problems ?? []

export { isParameterProblem }
export type { ParameterValue }
