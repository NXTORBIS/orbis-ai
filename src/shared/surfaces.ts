import type { ConfirmationPolicy, ControlError, ParamSpec, SideEffect } from './browserControl.ts'
import { validateParams } from './browserControl.ts'

/**
 * How a screen inside the Orbis window describes what can be done to it.
 *
 * The control layer in `browserControl.ts` can already open a module, change a setting and work a web page. It stops
 * at the outside of Orbis's own screens: it can open Chess World and cannot reach the panel inside it, open a physics
 * simulation and cannot change a parameter in it. Opening something is the first step, not the job.
 *
 * This is the vocabulary for the rest of it. A **surface** is any controllable thing in the window -- a module, a page
 * inside it, a subpage, a tool, a panel, a dialog -- and surfaces nest as deeply as the real interface does. Each one
 * says who it is, what is inside it, what can be read, what can be set, what can be done, and what it is doing now. A
 * caller reads that and acts on it; nothing here is a list of Orbis's screens, because a list would have to be
 * rewritten every time somebody adds one.
 *
 * Three rules shape every type below, and they are the product's rules rather than this file's:
 *
 *  - **A value that could not be read is not a value.** Every read says whether it happened. Nothing here lets a
 *    screen answer 0 for a number it never looked at, which is the fault that made eleven stores write defaults over
 *    data they merely could not open.
 *  - **Issued is not done.** An outcome says `completed` only when the screen confirmed it afterwards; otherwise it
 *    says `attempted` and why confirming was not possible. There is no third state that quietly reads as success.
 *  - **Declared, never guessed.** A parameter's type, range and allowed values come from the same `ParamSpec` a
 *    capability's parameters use. There is no second parameter vocabulary, and nothing is inferred from a name.
 *
 * Pure on purpose: no Electron, no React, no DOM. Resolving a path is the heart of the system and it is testable
 * without a window.
 */

// ---------------------------------------------------------------- what a surface is

/**
 * What kind of thing a surface is.
 *
 * Only for how it reads to a person and how a route is described ("open Settings, then the Notifications page"). No
 * rule depends on it: a dialog is not more dangerous than a panel, and whether something can be reached is said by
 * `reach` rather than worked out from this.
 */
export type SurfaceKind =
  /** A whole feature: Chess World, Markets, Settings. */
  | 'module'
  /** A page inside a module, usually one of several you switch between. */
  | 'page'
  /** A page inside a page. */
  | 'subpage'
  /** Something you work with rather than look at: a board, a simulation, an editor. */
  | 'tool'
  /** A part of a screen that can be shown or hidden. */
  | 'panel'
  /** Something that opened over the top and wants an answer. */
  | 'dialog'
  /** A heading with controls under it, when those controls want somewhere of their own to live. */
  | 'group'

/**
 * One thing on a screen that holds a value: a switch, a slider, a box, a chooser.
 *
 * `spec` is a `ParamSpec`, deliberately. A control's type, its range, its allowed values and whether it is required
 * are the same questions a capability's parameter answers, and a second vocabulary for them would mean a second place
 * for the rules to disagree.
 */
export interface SurfaceControl {
  /** Its own name in the path, unique on this surface: `animationSpeed`, `depth`, `quietHours`. */
  id: string
  /** What it is called on screen, in the words a person reads there. */
  name: string
  /** What it does, when the name alone does not say. */
  about?: string
  /** Its type, its range, its allowed values -- the same vocabulary a capability's parameters use. */
  spec: ParamSpec
  /**
   * What it is set to right now.
   *
   * Only a measurement when `readable` is true. A control that could not be read reports `readable: false` and why,
   * and whatever is in here is not to be used -- it is never a default standing in for a reading, because a default
   * that looks like a reading is how a screen comes to be told it is set to something nobody set.
   */
  value: unknown
  readable: boolean
  /** Why the value above is not a reading. */
  unreadableReason?: string
  /** Whether it can be set right now. */
  writable: boolean
  /** Why it cannot be set right now: it is disabled, something else has to happen first, it is only ever read. */
  readonlyReason?: string
  /**
   * What it goes back to.
   *
   * Absent means this control has no default, which is not the same as a default of nothing: a default of nothing is
   * written as `null` and the key is present.
   */
  default?: unknown
  /** What setting it does to the world. Absent means it changes what is on screen and nothing else (`write`). */
  effects?: readonly SideEffect[]
  /** Whether setting it asks the person first. Absent means it does not. */
  confirmation?: ConfirmationPolicy
}

/** Something that can be done on a surface: a button, a command, a step that starts. */
export interface SurfaceAction {
  /** Its own name in the path, unique on this surface: `sendTest`, `reset`, `exportPgn`. */
  id: string
  /** What it is called on screen. */
  name: string
  about?: string
  /** What it needs, in the same vocabulary a capability's parameters use. */
  params?: Record<string, ParamSpec>
  /** Whether it asks the person first. Absent means it does not. */
  confirmation?: ConfirmationPolicy
  /** What it does to the world. Absent means `write`. */
  effects?: readonly SideEffect[]
  /** Why it cannot be done right now. Absent means it can. */
  unavailableReason?: string
}

/** Whether something on a surface is going on, and how it ended if it has. */
export type SurfaceActivity = 'idle' | 'running' | 'paused' | 'finished' | 'failed'

/** What a surface says about itself right now. */
export interface SurfaceState {
  /** Whether it is on screen: registered, and not hidden behind something else. */
  present: boolean
  /** Whether something is going on here. A screen that never runs anything says `idle`. */
  activity: SurfaceActivity
  /** What is going on, in a person's words: "Thinking about move 14", "Searching 3 of 12". */
  detail?: string
  /**
   * How far along, from 0 to 1.
   *
   * Only when the screen really measures it. Absent means there is no measurement -- never 0, which would read as
   * "just started" about something that may be nearly done.
   */
  progress?: number
  /** Whatever else this screen reports about itself. The fields are its own; nothing here interprets them. */
  values?: Record<string, unknown>
  /** Why none of the above is a reading. */
  unavailableReason?: string
}

/**
 * How to get to a surface from the one it is inside.
 *
 * Declared by whoever knows -- the parent, for a child that does not exist until it is opened. Without this, reaching
 * a panel four levels down means guessing which button opens it, and a guess that is wrong is a click somewhere real.
 */
export type SurfaceReach =
  /** It is there as soon as its parent is. */
  | { kind: 'always' }
  /** Set a control on the parent: a section list, a tab strip, a mode chooser. */
  | { kind: 'control'; control: string; value: unknown }
  /** Do something on the parent: open a panel, expand a drawer, start a tool. */
  | { kind: 'action'; action: string; params?: Record<string, unknown> }
  /** Only a person can get there, and this says what they would have to do. Nothing tries it. */
  | { kind: 'manual'; how: string }

/**
 * A surface that is not there yet and could be, named by its parent so a route to it can be worked out before it
 * exists. The one thing a tree of only what exists cannot express, and the whole of how navigation works.
 */
export interface PossibleChild {
  id: string
  /** What it is called on screen, so a route can be described before it is walked. */
  name: string
  kind?: SurfaceKind
  /** How to make it exist. */
  reach: SurfaceReach
  /**
   * The path it really appears at, when that is not inside the screen that opens it.
   *
   * Almost always absent, and then it appears inside its parent, which is the ordinary case: a panel inside a page
   * inside a module. The exception is the one that matters most, because it is how every module is opened. The window
   * shell is what shows Markets -- setting its “what is on screen” control is the only way -- but Markets is not a
   * screen inside the window shell: it registers itself at the top level, as `markets`, because that is where a
   * person would look for it and where everything inside it hangs from.
   *
   * Without this the walk would wait for `window/markets` and nothing would ever appear there, so opening any module
   * would be reported as a step that did not work. With it, the shell can say honestly that it is the way in without
   * also claiming the screen lives inside it.
   */
  opens?: string
}

/** One surface, as it travels: flat, with its path and its parent's, so a tree can be rebuilt anywhere. */
export interface SurfaceDescriptor {
  id: string
  /** The whole path from the root, segments joined with `/`. */
  path: string
  name: string
  about?: string
  /** The path of the surface this is inside, or null when it is a root. */
  parent: string | null
  kind: SurfaceKind
  /** Other words somebody might use for it, for the forgiving match. */
  keywords?: readonly string[]
  controls: SurfaceControl[]
  actions: SurfaceAction[]
  state: SurfaceState
  /** The paths of the surfaces inside it that exist right now. */
  children: string[]
  /** The ones that do not exist yet, and how to reach each. */
  possibleChildren?: PossibleChild[]
  /** How this one was reached from its parent, when that is worth knowing. */
  reach?: SurfaceReach
  /** Something wrong with this surface itself -- two screens claiming one path, a getter that throws. */
  problem?: string
}

/** Every surface the window has right now, flat. Order is registration order; the tree is rebuilt from the paths. */
export type SurfaceTree = readonly SurfaceDescriptor[]

// ---------------------------------------------------------------- what came back

/**
 * What a write or an action really did.
 *
 * `completed` is only for something the screen confirmed afterwards -- a value read back, a state that changed.
 * Anything that was done and could not be confirmed is `attempted`, and says in `detail` why not. The distinction is
 * the point of the type: a caller that cannot tell them apart will report a guess as a fact.
 */
export interface SurfaceOutcome {
  status: 'completed' | 'attempted' | 'refused' | 'failed'
  /** What happened, in a person's words. This is what somebody reads. */
  detail: string
  /** For a write: what the value actually became, read back after setting it. */
  value?: unknown
  /** Whether `detail` rests on a reading taken after the fact, rather than on having sent the instruction. */
  verified: boolean
  /** Whatever the action itself gave back. */
  data?: unknown
  error?: ControlError
}

/**
 * A value as somebody would read it in a sentence.
 *
 * Here rather than in whichever file is writing the sentence, so that "on" is "on" wherever it is said: the window
 * says what a control became and the capability says what it already was, and two spellings of the same thing in
 * those two places read as two different answers.
 */
export const sayValue = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (typeof value === 'string') return `“${value}”`
  if (value === null || value === undefined) return 'nothing'
  if (typeof value === 'object') return Array.isArray(value) ? `a list of ${value.length}` : 'a set of values'
  return String(value)
}

export const completed = (detail: string, extra: Partial<SurfaceOutcome> = {}): SurfaceOutcome => ({ status: 'completed', detail, verified: true, ...extra })
/** Done, and nothing could confirm it. `why` is what a person needs in order to check for themselves. */
export const attempted = (detail: string, extra: Partial<SurfaceOutcome> = {}): SurfaceOutcome => ({ status: 'attempted', detail, verified: false, ...extra })
export const refused = (detail: string, extra: Partial<SurfaceOutcome> = {}): SurfaceOutcome => ({ status: 'refused', detail, verified: false, ...extra })
export const failedOutcome = (detail: string, extra: Partial<SurfaceOutcome> = {}): SurfaceOutcome => ({ status: 'failed', detail, verified: false, ...extra })

// ---------------------------------------------------------------- paths

/** A path through the tree: `chess/study/engine-panel/depth`. The last segment may be a surface, a control or an action. */
export type SurfacePath = string

export const SURFACE_SEPARATOR = '/'

/** Splits a path, forgiving the ways people write one: extra separators, dots, a leading or trailing slash. */
export function pathSegments(path: SurfacePath): string[] {
  return String(path ?? '')
    .split(/[/.>]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export const joinPath = (...parts: (string | null | undefined)[]): string => parts.filter(Boolean).join(SURFACE_SEPARATOR)

/** A surface, control or action id: starts with a letter, then letters, digits and dashes. */
export const SURFACE_ID = /^[a-zA-Z][a-zA-Z0-9-]*$/

export const isSurfaceId = (id: unknown): id is string => typeof id === 'string' && SURFACE_ID.test(id)

/**
 * A name reduced to what it is, for comparing one against another.
 *
 * Case and punctuation go, so `animationSpeed`, `animation speed`, `Animation Speed` and `animation-speed` are one
 * word. This is what lets somebody say what they see on screen instead of what the code calls it.
 */
export const normalizeName = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The words in a name, for matching a request that puts them in another order. */
const wordsOf = (text: string): string[] => String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** One thing a path segment could mean, with every name it answers to. */
export interface Candidate<T> {
  value: T
  id: string
  name: string
  keywords?: readonly string[]
}

export type MatchResult<T> =
  | { kind: 'one'; value: T; how: MatchHow }
  /** Several things answer to it. Nothing is chosen: a guess between two real controls is a wrong setting. */
  | { kind: 'several'; ids: string[] }
  | { kind: 'none' }

/** How a match was made, from the surest to the loosest, for saying why something was chosen. */
export type MatchHow = 'id' | 'name' | 'keyword' | 'start' | 'words' | 'part'

/**
 * Which of these a person meant.
 *
 * Tried in order of how sure each way is, and the first way that finds exactly one thing wins. Ambiguity is reported
 * rather than broken: when two controls answer equally well to "speed", choosing one of them is how an automation
 * sets the wrong thing and reports success.
 */
export function matchOne<T>(asked: string, candidates: readonly Candidate<T>[]): MatchResult<T> {
  const want = normalizeName(asked)
  if (!want || !candidates.length) return { kind: 'none' }

  const tries: ((c: Candidate<T>) => boolean)[] = [
    (c) => c.id === asked,
    (c) => normalizeName(c.id) === want,
    (c) => normalizeName(c.name) === want,
    (c) => (c.keywords ?? []).some((k) => normalizeName(k) === want),
    // "animation speed" for `animationSpeedMultiplier`: what somebody says is the start of what it is called.
    (c) => normalizeName(c.id).startsWith(want) || normalizeName(c.name).startsWith(want),
    // Every word they said is in it, in any order: "speed animation".
    (c) => {
      const asking = wordsOf(asked)
      const has = [...wordsOf(c.id), ...wordsOf(c.name), ...(c.keywords ?? []).flatMap(wordsOf), ...wordsOf(c.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))]
      return asking.length > 0 && asking.every((word) => has.some((part) => part === word || part.startsWith(word)))
    },
    (c) => normalizeName(c.id).includes(want) || normalizeName(c.name).includes(want)
  ]
  const hows: MatchHow[] = ['id', 'id', 'name', 'keyword', 'start', 'words', 'part']

  for (let i = 0; i < tries.length; i++) {
    const hit = candidates.filter(tries[i])
    if (hit.length === 1) return { kind: 'one', value: hit[0].value, how: hows[i] }
    if (hit.length > 1) return { kind: 'several', ids: hit.map((c) => c.id) }
  }
  return { kind: 'none' }
}

export type SurfaceHit =
  | { kind: 'surface'; surface: SurfaceDescriptor; path: string; how: MatchHow[]; skipped: string[] }
  | { kind: 'control'; surface: SurfaceDescriptor; control: SurfaceControl; path: string; how: MatchHow[]; skipped: string[] }
  | { kind: 'action'; surface: SurfaceDescriptor; action: SurfaceAction; path: string; how: MatchHow[]; skipped: string[] }

/** Nothing there. Says how far it got and what was there instead, so the next attempt is a correction, not a guess. */
export interface SurfaceMiss {
  kind: 'miss'
  why: 'empty' | 'unknown' | 'ambiguous'
  /** The path of the last thing that did resolve, or '' when even the first segment did not. */
  reached: string
  /** The segment that stopped it. */
  stuck: string
  /** What was there to choose from at that point. */
  choices: string[]
  message: string
}

const miss = (why: SurfaceMiss['why'], reached: string, stuck: string, choices: string[], message: string): SurfaceMiss => ({ kind: 'miss', why, reached, stuck, choices, message })

const childrenOf = (tree: SurfaceTree, path: string | null): SurfaceDescriptor[] => tree.filter((s) => s.parent === path)

/** Everything inside a surface, however deep, nearest first. */
export function descendantsOf(tree: SurfaceTree, path: string): SurfaceDescriptor[] {
  const out: SurfaceDescriptor[] = []
  let layer = childrenOf(tree, path)
  while (layer.length) {
    out.push(...layer)
    layer = layer.flatMap((s) => childrenOf(tree, s.path))
  }
  return out
}

export const surfaceAt = (tree: SurfaceTree, path: string): SurfaceDescriptor | undefined => tree.find((s) => s.path === path)

export interface ResolveOptions {
  /**
   * Whether a segment may match something further down than the next level.
   *
   * On by default, because people leave levels out: the real path is `chess/study/engine-panel/depth` and what gets
   * said is `chess/study/depth`. Only taken when exactly one descendant answers to it, and every level jumped over is
   * reported in `skipped` -- a shortcut nobody is told about is how a caller comes to believe it is somewhere it is
   * not.
   */
  skipLevels?: boolean
  /** Only surfaces, so a trailing `depth` is not mistaken for a control when a panel of that name exists. */
  surfacesOnly?: boolean
}

/**
 * What a path points at: a surface, a control on one, or an action on one.
 *
 * Pure, and the heart of the system. Every segment is matched forgivingly (see `matchOne`) and every forgiveness is
 * reported, so a caller can tell `chess/study/depth` resolving to `chess/study/engine-panel/depth` from a path that
 * was exactly right.
 */
export function resolveSurfacePath(tree: SurfaceTree, path: SurfacePath, options: ResolveOptions = {}): SurfaceHit | SurfaceMiss {
  const segments = pathSegments(path)
  if (!segments.length) return miss('empty', '', '', childrenOf(tree, null).map((one) => one.id), 'No path was given.')

  const skipLevels = options.skipLevels !== false
  const how: MatchHow[] = []
  const skipped: string[] = []
  let here: SurfaceDescriptor | null = null

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const last = i === segments.length - 1
    const reached = here?.path ?? ''

    // Surfaces first at every level: a panel called "depth" is a place, and a control called "depth" is a setting on
    // one. Preferring the place keeps a path that continues from resolving to a control that cannot have children.
    const surfaces: SurfaceDescriptor[] = here ? childrenOf(tree, here.path) : childrenOf(tree, null)
    /*
     * Written out rather than inferred, and it has to be.
     *
     * `here` moves down the tree as the loop goes, so TypeScript works out what it holds from the assignments to it
     * -- including `here = found.value` below. Leaving this to inference makes that a circle: what `found` is depends
     * on what `here` is, which depends on what `found` is. The whole function silently became `any`.
     */
    const found: MatchResult<SurfaceDescriptor> = matchOne(
      segment,
      surfaces.map((one: SurfaceDescriptor) => ({ value: one, id: one.id, name: one.name, keywords: one.keywords }))
    )
    if (found.kind === 'one') {
      how.push(found.how)
      here = found.value
      continue
    }
    if (found.kind === 'several') {
      return miss('ambiguous', reached, segment, found.ids, `“${segment}” could be ${found.ids.join(' or ')}. Say which one.`)
    }

    // Then, on the last segment, a control or an action of the surface we are on.
    if (last && here && !options.surfacesOnly) {
      const control = matchOne(
        segment,
        here.controls.map((c) => ({ value: c, id: c.id, name: c.name }))
      )
      if (control.kind === 'one') return { kind: 'control', surface: here, control: control.value, path: joinPath(here.path, control.value.id), how: [...how, control.how], skipped }
      if (control.kind === 'several') return miss('ambiguous', reached, segment, control.ids, `“${segment}” could be ${control.ids.join(' or ')}. Say which one.`)

      const action = matchOne(
        segment,
        here.actions.map((a) => ({ value: a, id: a.id, name: a.name }))
      )
      if (action.kind === 'one') return { kind: 'action', surface: here, action: action.value, path: joinPath(here.path, action.value.id), how: [...how, action.how], skipped }
      if (action.kind === 'several') return miss('ambiguous', reached, segment, action.ids, `“${segment}” could be ${action.ids.join(' or ')}. Say which one.`)
    }

    // Then a level further down, when that is allowed and exactly one thing answers.
    if (skipLevels && here) {
      const deeper: SurfaceDescriptor[] = descendantsOf(tree, here.path)
      const place: MatchResult<SurfaceDescriptor> = matchOne(
        segment,
        deeper.map((one: SurfaceDescriptor) => ({ value: one, id: one.id, name: one.name, keywords: one.keywords }))
      )
      if (place.kind === 'one') {
        skipped.push(...pathSegments(place.value.path).slice(pathSegments(here.path).length, -1))
        how.push(place.how)
        here = place.value
        continue
      }
      if (last && !options.surfacesOnly) {
        type Thing = { on: SurfaceDescriptor; control: SurfaceControl } | { on: SurfaceDescriptor; action: SurfaceAction }
        const things: Candidate<Thing>[] = deeper.flatMap((s) => [
          ...s.controls.map((c): Candidate<Thing> => ({ value: { on: s, control: c }, id: c.id, name: c.name })),
          ...s.actions.map((a): Candidate<Thing> => ({ value: { on: s, action: a }, id: a.id, name: a.name }))
        ])
        const thing = matchOne(segment, things)
        if (thing.kind === 'one') {
          const found = thing.value
          skipped.push(...pathSegments(found.on.path).slice(pathSegments(here.path).length))
          return 'control' in found
            ? { kind: 'control', surface: found.on, control: found.control, path: joinPath(found.on.path, found.control.id), how: [...how, thing.how], skipped }
            : { kind: 'action', surface: found.on, action: found.action, path: joinPath(found.on.path, found.action.id), how: [...how, thing.how], skipped }
        }
        if (thing.kind === 'several') return miss('ambiguous', reached, segment, thing.ids, `“${segment}” could be ${thing.ids.join(' or ')}. Say which one.`)
      }
    }

    const choices = [...surfaces.map((one) => one.id), ...(here && !options.surfacesOnly ? [...here.controls.map((one) => one.id), ...here.actions.map((one) => one.id)] : [])]
    return miss(
      'unknown',
      reached,
      segment,
      choices,
      here
        ? `${here.name} has nothing called “${segment}”.${choices.length ? ` It has: ${choices.join(', ')}.` : ' It has nothing that can be reached from here.'}`
        : `Nothing on screen is called “${segment}”.${choices.length ? ` There is: ${choices.join(', ')}.` : ' No screen has registered anything that can be used.'}`
    )
  }

  return { kind: 'surface', surface: here!, path: here!.path, how, skipped }
}

// ---------------------------------------------------------------- getting there

/** One thing to do on the way to a surface. */
export interface RouteStep {
  /** The surface this step gets to. */
  path: string
  name: string
  /** What has to be done on its parent to get there. */
  reach: SurfaceReach
  /** The parent it is done on. */
  on: string
}

export interface RoutePlan {
  /** The target, as its path would read once it exists. */
  target: string
  /** The part of the way that is already open, outermost first. */
  open: string[]
  /** What to do next, or null when there is nothing left to do. */
  next: RouteStep | null
  /** True when the target is already there. */
  arrived: boolean
  /** Why there is nothing to do next although the target is not there. */
  stuck?: string
}

/**
 * The next step towards a surface, worked out from what is open now and what each parent says it could open.
 *
 * One step at a time on purpose. A surface that does not exist yet cannot say what is inside it, so a whole route
 * cannot be known in advance: Chess World has to be open before it can say that Study is one of its pages. The caller
 * takes this step, reads the tree again, and asks again -- which is also the only way the walk notices that a step did
 * not do what it said it would.
 */
export function planNextStep(tree: SurfaceTree, path: SurfacePath): RoutePlan {
  const segments = pathSegments(path)
  const plan: RoutePlan = { target: segments.join(SURFACE_SEPARATOR), open: [], next: null, arrived: false }
  if (!segments.length) return { ...plan, stuck: 'No path was given.' }

  let here: SurfaceDescriptor | null = null
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const siblings: SurfaceDescriptor[] = here ? childrenOf(tree, here.path) : childrenOf(tree, null)
    // Written out for the same reason as in `resolveSurfacePath`: `here` is assigned from this.
    const open: MatchResult<SurfaceDescriptor> = matchOne(
      segment,
      siblings.map((one: SurfaceDescriptor) => ({ value: one, id: one.id, name: one.name, keywords: one.keywords }))
    )
    if (open.kind === 'one') {
      here = open.value
      plan.open.push(here.path)
      if (i === segments.length - 1) return { ...plan, target: here.path, arrived: true }
      continue
    }
    if (open.kind === 'several') return { ...plan, stuck: `“${segment}” could be ${open.ids.join(' or ')}. Say which one.` }

    /*
     * Not open. The last segment may also be a control or an action, which is not somewhere to go: a path ending at a
     * setting is reached by opening the surface that holds it, and that is already done by here.
     */
    const on: SurfaceDescriptor | null = here
    if (i === segments.length - 1 && on) {
      const thing: MatchResult<string> = matchOne(segment, [
        ...on.controls.map((one) => ({ value: one.id, id: one.id, name: one.name })),
        ...on.actions.map((one) => ({ value: one.id, id: one.id, name: one.name }))
      ])
      if (thing.kind === 'one') return { ...plan, target: joinPath(on.path, thing.value), arrived: true }
    }

    /*
     * Who could open it, and from where.
     *
     * Inside a screen, that is the screen we are standing on and nothing else. At the top level it is every screen
     * that is open and says it can show a screen of its own -- which is how a module is opened at all. Markets is not
     * a screen inside the window shell; it registers itself as `markets`. But the shell is the only thing that can
     * show it, so asking for `markets/screener` with Markets closed has to be able to find the shell's own control.
     * Without this the first segment of every path into a closed module was "nothing on screen is called markets",
     * which is a true sentence about a screen Orbis can open perfectly well.
     */
    type Opener = { child: PossibleChild; on: SurfaceDescriptor }
    const possible: Opener[] = here
      ? (here.possibleChildren ?? []).map((child) => ({ child, on: here as SurfaceDescriptor }))
      : childrenOf(tree, null).flatMap((root) => (root.possibleChildren ?? []).filter((child) => child.opens).map((child) => ({ child, on: root })))
    const could: MatchResult<Opener> = matchOne(
      segment,
      possible.map((one: Opener) => ({ value: one, id: one.child.id, name: one.child.name }))
    )
    if (could.kind === 'several') return { ...plan, stuck: `“${segment}” could be ${could.ids.join(' or ')}. Say which one.` }
    if (could.kind === 'none') {
      // One list, not two: a child that is open is usually also one the parent says it can open, and naming it twice
      // reads as two different things with the same name.
      const choices = [...new Set([...siblings.map((one) => one.id), ...possible.map((one) => one.child.id)])]
      return {
        ...plan,
        stuck: on
          ? `${on.name} cannot open anything called “${segment}”.${choices.length ? ` It can open: ${choices.join(', ')}.` : ''}`
          : `Nothing on screen is called “${segment}”.${choices.length ? ` There is: ${choices.join(', ')}.` : ''}`
      }
    }
    const { child: wanted, on: opener } = could.value
    if (wanted.reach.kind === 'manual') {
      return { ...plan, stuck: `${wanted.name} cannot be opened by Orbis: ${wanted.reach.how}` }
    }
    // Where it will really be, which is inside whatever opens it unless that screen has said otherwise.
    const appearsAt = wanted.opens ? pathSegments(wanted.opens).join(SURFACE_SEPARATOR) : joinPath(opener.path, wanted.id)
    return { ...plan, next: { path: appearsAt, name: wanted.name, reach: wanted.reach, on: opener.path } }
  }
  return plan
}

// ---------------------------------------------------------------- setting a control

/**
 * The value as this control's own spec would have it, when what arrived is plainly the same thing written differently.
 *
 * Only where there is one answer and saying it out loud costs nothing: `"true"` for a switch, `"3"` for a number,
 * `"Notifications"` for a chooser whose values are ids. Every one of these is reported in `note`, because a value
 * that quietly became something else is the kind of thing that reads as the screen being wrong.
 *
 * Nothing is clamped. A number outside the range is refused with the range in the message, because a 400 silently
 * becoming 100 is an automation being told it got what it asked for.
 */
export function coerceForSpec(spec: ParamSpec, value: unknown): { value: unknown; note?: string } {
  if (value === null || value === undefined) return { value }
  if (spec.type === 'boolean' && typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['true', 'on', 'yes', '1'].includes(text)) return { value: true, note: `read “${value}” as on` }
    if (['false', 'off', 'no', '0'].includes(text)) return { value: false, note: `read “${value}” as off` }
    return { value }
  }
  if ((spec.type === 'number' || spec.type === 'integer') && typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return { value: spec.type === 'integer' ? Math.round(n) : n, note: `read “${value}” as the number ${spec.type === 'integer' ? Math.round(n) : n}` }
    return { value }
  }
  if (spec.enum?.length && typeof value === 'string' && !spec.enum.includes(value)) {
    const found = matchOne(
      value,
      spec.enum.map((one) => ({ value: one, id: one, name: one }))
    )
    if (found.kind === 'one') return { value: found.value, note: `read “${value}” as ${found.value}` }
    if (found.kind === 'several') return { value, note: `“${value}” could be ${found.ids.join(' or ')}` }
  }
  return { value }
}

export type ValueCheck = { ok: true; value: unknown; note?: string } | { ok: false; message: string }

/**
 * Whether this control can be given this value, checked against the control's own spec.
 *
 * The same `validateParams` every capability's parameters go through, so the rules about types, ranges and allowed
 * values are the rules, in one place, with the same words in the same failures. Whether it can be written at all is
 * checked first: a refusal that says "it is a whole number" about a control that is greyed out is a true sentence
 * about the wrong problem.
 */
export function checkControlValue(control: SurfaceControl, value: unknown): ValueCheck {
  if (!control.writable) return { ok: false, message: `${control.name} cannot be set right now.${control.readonlyReason ? ` ${control.readonlyReason}` : ''}` }
  const coerced = coerceForSpec(control.spec, value)
  const problem = validateParams({ [control.id]: { ...control.spec, required: true } }, { [control.id]: coerced.value })
  if (problem) return { ok: false, message: problem }
  return { ok: true, value: coerced.value, ...(coerced.note ? { note: coerced.note } : {}) }
}

// ---------------------------------------------------------------- is it joined up

/** One thing wrong with how the screens are wired together, as a sentence somebody can act on. */
export interface WiringProblem {
  /** The path of the screen the problem is on, or '' when it has no usable path. */
  at: string
  message: string
}

/** Exactly this control on exactly this surface. Declared code, so the name is matched exactly and never forgivingly. */
const controlNamed = (on: SurfaceDescriptor, id: string): SurfaceControl | undefined => on.controls.find((one) => one.id === id)
const actionNamed = (on: SurfaceDescriptor, id: string): SurfaceAction | undefined => on.actions.find((one) => one.id === id)

/**
 * Whether the way to a screen really leads there, checked against the screen it would be done on.
 *
 * This is the check that pays for the whole file. A route is declared by the parent -- "to open the screener, set my
 * `panel` control to `screener`" -- and nothing anywhere makes that true. Spell the control's name differently from
 * the way the screen spells it, or name a value the control does not offer, and the walk still produces a step, the
 * step still gets carried out, and the write is refused by a screen that is perfectly right to refuse it. The screen
 * at the end of that route is then unreachable for ever, and every attempt reads as a passing fault rather than as a
 * wire that was never joined. This product has lost whole features exactly that way.
 */
function checkReach(on: SurfaceDescriptor, reach: SurfaceReach, about: string, found: (problem: string) => void): void {
  if (reach.kind === 'always' || reach.kind === 'manual') return
  if (reach.kind === 'control') {
    const control = controlNamed(on, reach.control)
    if (!control) {
      found(`${about} is reached by setting “${reach.control}” on ${on.name}, and ${on.name} has no control of that name.${on.controls.length ? ` It has: ${on.controls.map((one) => one.id).join(', ')}.` : ''}`)
      return
    }
    if (control.spec.enum?.length && !control.spec.enum.includes(String(reach.value))) {
      found(`${about} is reached by setting ${control.name} to “${sayValue(reach.value)}”, which is not one of the values it takes: ${control.spec.enum.join(', ')}.`)
    }
    return
  }
  const action = actionNamed(on, reach.action)
  if (!action) {
    found(`${about} is reached by doing “${reach.action}” on ${on.name}, and ${on.name} has nothing of that name to do.${on.actions.length ? ` It can do: ${on.actions.map((one) => one.id).join(', ')}.` : ''}`)
    return
  }
  const problem = validateParams(action.params ?? {}, reach.params ?? {})
  if (problem) found(`${about} is reached by doing ${action.name}, and what the route passes it is wrong: ${problem}`)
}

/**
 * Everything about the tree that would make a screen unreachable without ever failing out loud.
 *
 * Pure, and read at runtime rather than only in a test: the window puts whatever this finds into the answer to
 * `screen.tree`, so a mis-wired route is a sentence in front of somebody instead of a feature nobody can get to. A
 * test can only check the screens it stands up, and the screens Orbis really has are the ones a person has open.
 *
 * Nothing here is about whether a screen is working. Every problem below is a disagreement inside Orbis's own
 * declarations -- two screens claiming one path, a route naming a control that is not there, a control and a button
 * sharing a name so that one of them can never be reached -- and every one of them is a mistake in the code rather
 * than something a person did.
 */
export function checkSurfaceWiring(tree: SurfaceTree): WiringProblem[] {
  const problems: WiringProblem[] = []
  const add = (at: string, message: string): void => {
    problems.push({ at, message })
  }
  const paths = new Set(tree.map((one) => one.path))

  const seen = new Set<string>()
  for (const one of tree) {
    if (seen.has(one.path)) add(one.path, `Two screens are registered as “${one.path}”. Only one of them can ever answer, and which one depends on the order they happened to appear in.`)
    seen.add(one.path)

    if (!isSurfaceId(one.id)) add(one.path, `“${one.id}” cannot be part of a path. A name starts with a letter and then has letters, digits and dashes.`)
    if (!String(one.name ?? '').trim()) add(one.path, 'This screen has no name, so nothing can ask for it by what it is called.')
    if (one.parent && !paths.has(one.parent)) add(one.path, `Its parent “${one.parent}” is not on screen, so it cannot be reached through it.`)

    /*
     * A control and a button of one name: the control always wins, for ever.
     *
     * `resolveSurfacePath` looks at controls before actions, deliberately -- a path that ends at a name is far more
     * often a setting than a button. So an action sharing a control's name is not ambiguous, which would be
     * reported; it is simply never found, and the only sign of it is that asking for the button sets the setting.
     */
    for (const action of one.actions) {
      if (controlNamed(one, action.id)) add(one.path, `${one.name} has a setting and a button both called “${action.id}”. The setting is what a path of that name finds, so the button can never be reached by name.`)
    }
    for (const thing of [...one.controls, ...one.actions]) {
      if (!isSurfaceId(thing.id)) add(one.path, `“${thing.id}” on ${one.name} cannot be part of a path. A name starts with a letter and then has letters, digits and dashes.`)
    }

    if (one.reach && one.parent && paths.has(one.parent)) {
      const parent = tree.find((other) => other.path === one.parent)!
      checkReach(parent, one.reach, one.name, (message) => add(one.path, message))
    }

    const could = new Set<string>()
    for (const child of one.possibleChildren ?? []) {
      if (!isSurfaceId(child.id)) add(one.path, `“${child.id}”, which ${one.name} says it can open, cannot be part of a path. A name starts with a letter and then has letters, digits and dashes.`)
      if (could.has(child.id)) add(one.path, `${one.name} says twice that it can open “${child.id}”, each time in a different way. Only the first is ever used.`)
      could.add(child.id)
      /*
       * A screen that says it appears somewhere else has to say where.
       *
       * `opens` is what lets the shell be the way into Markets without claiming Markets lives inside it. An empty or
       * unusable one would make the walk wait at a path with no segments in it, for ever, and report the step that
       * really did work as a step that did nothing.
       */
      if (child.opens !== undefined && !pathSegments(child.opens).length) {
        add(one.path, `${one.name} says “${child.id}” appears somewhere other than inside it, and does not say where.`)
      }
      checkReach(one, child.reach, child.name || child.id, (message) => add(one.path, message))
    }
  }
  return problems
}

// ---------------------------------------------------------------- the wire

/**
 * What the main process asks the window for.
 *
 * Their own names, not capability ids: these are the questions the bridge asks, and the capabilities that ask them
 * are `screen.*` in `src/main/browserControl/surfaceCapabilities.ts`. Keeping the two apart is what lets a capability
 * be renamed, split or governed differently without the window having to hear about it.
 */
export const SURFACE_CALLS = {
  /** Every surface, or one subtree. */
  tree: 'surface.tree',
  /** What one surface says about itself. */
  state: 'surface.state',
  /** One control's value, range and whether it can be written. */
  read: 'surface.read',
  /** Set one control, and read it back. */
  write: 'surface.write',
  /** Do one action, and say what it really did. */
  run: 'surface.run',
  /** What a control or action declares about itself, for deciding whether to ask the person first. */
  lookup: 'surface.lookup'
} as const

export type SurfaceCall = (typeof SURFACE_CALLS)[keyof typeof SURFACE_CALLS]

/** What `surface.lookup` answers: enough to decide whether this needs approval, without doing it. */
export interface SurfaceLookup {
  path: string
  kind: 'surface' | 'control' | 'action'
  name: string
  /** The surface it is on. */
  on: string
  confirmation: ConfirmationPolicy
  effects: readonly SideEffect[]
  /** Why it cannot be done or set right now. */
  unavailableReason?: string
}
