import type { ConfirmationPolicy, ParamSpec, SideEffect } from '../../../../shared/browserControl.ts'
import type {
  PossibleChild,
  SurfaceAction,
  SurfaceActivity,
  SurfaceControl,
  SurfaceDescriptor,
  SurfaceKind,
  SurfaceLookup,
  SurfaceOutcome,
  SurfaceReach,
  SurfaceState,
  WiringProblem
} from '../../../../shared/surfaces.ts'
import { attempted, checkControlValue, checkSurfaceWiring, completed, failedOutcome, joinPath, refused, resolveSurfacePath, sayValue } from '../../../../shared/surfaces.ts'
import { validateParams } from '../../../../shared/browserControl.ts'

/**
 * Where the Orbis window's screens say what can be done to them.
 *
 * One register per screen, kept while that screen is on screen and gone the moment it is not. That is the whole
 * point of it being a register rather than a list somewhere: a control that is offered and no longer exists is the
 * fault this product has suffered most -- a capability registered at startup for a panel that closed, a screen whose
 * buttons were still being clicked by a plan after the screen had gone.
 *
 * Deliberately free of React and of the browser. A screen reaches it through `useSurface`, which is thirty lines on
 * top of this; nothing below this line knows what a component is, which is what lets the whole chain -- read a
 * control, set it, read it back -- be driven in a test with no window at all.
 */

/** One thing on a screen that holds a value, as the screen declares it. */
export interface ControlDeclaration {
  /** What it is called on screen. */
  name: string
  about?: string
  /** Its type, range and allowed values. The same vocabulary a capability's parameters use. */
  spec: ParamSpec
  /** Its value now. Called every time it is asked for, so it is never a copy that has gone stale. */
  get(): unknown
  /** Absent means it can only be read. */
  set?(value: unknown): void | Promise<void>
  /**
   * `false`, or a sentence saying why it cannot be set at this moment (greyed out, something else first).
   *
   * A function when the answer depends on anything that can change, which is nearly always. It is asked at the
   * moment somebody wants to know, like `get` -- and that is not a nicety: a value worked out while the declaration
   * is being built runs on every draw, before anything has been checked, and one that throws there takes the whole
   * screen out of the register rather than one control out of the answer. That happened the first time this was
   * written.
   */
  writable?: boolean | string | (() => boolean | string)
  /** What it goes back to. Leave it out when there is no default; `null` is a default of nothing. */
  default?: unknown
  /** What setting it does to the world. Absent means it changes what is on screen and nothing else. */
  effects?: readonly SideEffect[]
  confirmation?: ConfirmationPolicy
}

/** Something that can be done on a screen, as the screen declares it. */
export interface ActionDeclaration {
  name: string
  about?: string
  params?: Record<string, ParamSpec>
  confirmation?: ConfirmationPolicy
  effects?: readonly SideEffect[]
  /** A sentence when it cannot be done right now, null when it can. */
  unavailable?(): string | null
  run(params: Record<string, unknown>): unknown
  /**
   * Whether it really happened, asked after it ran.
   *
   * Without this the outcome says `attempted` and says why: the action was carried out and nothing here can confirm
   * it. That is not a formality -- a button that threw nothing and did nothing is indistinguishable from one that
   * worked, and the caller has to be told which it is looking at.
   */
  verify?(data: unknown): { done: boolean; detail: string } | Promise<{ done: boolean; detail: string }>
}

/** What a screen says about itself. Everything is optional: a screen that only has controls needs none of it. */
export interface StateDeclaration {
  activity?: SurfaceActivity
  detail?: string
  /** Only when it is really measured. Leave it out otherwise -- 0 reads as "just started". */
  progress?: number
  values?: Record<string, unknown>
}

export interface SurfaceDeclaration {
  /** Its own name in the path: `notifications`, `engine-panel`. Letters, digits and dashes. */
  id: string
  /** The path of the screen this one is inside. Null or absent for a screen that is not inside anything. */
  parent?: string | null
  /** What it is called on screen. */
  name: string
  about?: string
  kind?: SurfaceKind
  /** Other words somebody might use for it. */
  keywords?: readonly string[]
  controls?: Record<string, ControlDeclaration>
  actions?: Record<string, ActionDeclaration>
  state?(): StateDeclaration
  /** False when it is mounted but not in front of anybody (behind a dialog, on a tab that is not showing). */
  visible?(): boolean
  /** What it can open that is not open yet, and how. This is what makes a route to a panel four levels down possible. */
  possibleChildren?: PossibleChild[]
  /** How this screen was reached from its parent. */
  reach?: SurfaceReach
}

interface Entry {
  /** Whatever the screen declared on its latest render. */
  read(): SurfaceDeclaration
  /** Registration order, so the newer of two screens claiming one path can be the one that answers. */
  at: number
}

const entries: Entry[] = []
let order = 0

/** Woken whenever a screen has drawn, so a write that is waiting for React to commit answers at once. */
const waiters = new Set<() => void>()

/**
 * Registers a screen for as long as it is on screen; the returned function takes it away again.
 *
 * `read` is a function rather than a declaration so that every getter and setter is the one from the screen's latest
 * render. A declaration captured once would read state from whenever it was captured, which is the quiet version of
 * the same fault as offering a control that no longer exists.
 */
export function registerSurface(read: () => SurfaceDeclaration): () => void {
  const entry: Entry = { read, at: ++order }
  entries.push(entry)
  return () => {
    const at = entries.indexOf(entry)
    if (at >= 0) entries.splice(at, 1)
  }
}

/** Called when a screen has drawn. A write waiting to read its value back stops waiting. */
export function surfacesDrawn(): void {
  for (const wake of [...waiters]) wake()
}

/** How many screens are registered right now. For telling "nothing is registered" from "nothing matched". */
export const registeredSurfaces = (): number => entries.length

/** Only for tests: forgets every registration. */
export function forgetSurfaces(): void {
  entries.length = 0
  waiters.clear()
}

// ---------------------------------------------------------------- reading the register

/** What a declaration says, with anything that throws turned into a reported problem rather than a crash. */
function safely<T>(what: () => T, fallback: T): { value: T; problem?: string } {
  try {
    return { value: what() }
  } catch (err) {
    return { value: fallback, problem: err instanceof Error ? err.message : String(err) }
  }
}

function describeControl(id: string, declared: ControlDeclaration): SurfaceControl {
  const read = safely(() => declared.get(), undefined as unknown)
  const asked = safely<boolean | string | undefined>(() => (typeof declared.writable === 'function' ? declared.writable() : declared.writable), false)
  // Anything that could not answer is treated as not settable, with the reason: the alternative is offering a
  // control whose own screen could not say whether it may be touched.
  const said = asked.problem ? `Whether it can be set could not be worked out: ${asked.problem}` : asked.value
  const writable = said !== false && typeof said !== 'string'
  const control: SurfaceControl = {
    id,
    name: declared.name,
    ...(declared.about ? { about: declared.about } : {}),
    spec: declared.spec,
    value: read.problem ? null : read.value,
    /*
     * A value that could not be read is not a value.
     *
     * Said here, once, for every control in Orbis: a getter that threw reports `readable: false` and why, and the
     * value beside it is null rather than a 0 or a false that would read as a measurement. This is the rule that
     * eleven stores broke by writing their defaults over data they merely could not open.
     */
    readable: !read.problem,
    ...(read.problem ? { unreadableReason: `Its value could not be read: ${read.problem}` } : {}),
    writable: writable && typeof declared.set === 'function',
    ...(typeof said === 'string'
      ? { readonlyReason: said }
      : typeof declared.set !== 'function'
        ? { readonlyReason: 'This one can only be read.' }
        : said === false
          ? { readonlyReason: 'It cannot be set at the moment.' }
          : {}),
    ...('default' in declared ? { default: declared.default } : {}),
    ...(declared.effects ? { effects: declared.effects } : {}),
    ...(declared.confirmation ? { confirmation: declared.confirmation } : {})
  }
  return control
}

function describeAction(id: string, declared: ActionDeclaration): SurfaceAction {
  const why = declared.unavailable ? safely(() => declared.unavailable!(), null as string | null) : { value: null as string | null }
  return {
    id,
    name: declared.name,
    ...(declared.about ? { about: declared.about } : {}),
    ...(declared.params ? { params: declared.params } : {}),
    ...(declared.confirmation ? { confirmation: declared.confirmation } : {}),
    ...(declared.effects ? { effects: declared.effects } : {}),
    ...(why.problem ? { unavailableReason: `Whether this can be done could not be worked out: ${why.problem}` } : why.value ? { unavailableReason: why.value } : {})
  }
}

function describeState(declared: SurfaceDeclaration): SurfaceState {
  const visible = declared.visible ? safely(() => declared.visible!(), true) : { value: true }
  const own = declared.state ? safely(() => declared.state!(), {} as StateDeclaration) : { value: {} as StateDeclaration }
  const state: SurfaceState = {
    present: visible.value !== false,
    activity: own.value.activity ?? 'idle',
    ...(own.value.detail ? { detail: own.value.detail } : {}),
    ...(typeof own.value.progress === 'number' && Number.isFinite(own.value.progress) ? { progress: own.value.progress } : {}),
    ...(own.value.values ? { values: own.value.values } : {})
  }
  const problem = own.problem ?? visible.problem
  return problem ? { ...state, unavailableReason: `This screen could not say what it is doing: ${problem}` } : state
}

let broken: string[] = []

/**
 * Screens that could not even say what they offer, from the last time the register was read.
 *
 * A screen whose description throws while it is being built cannot be placed in the tree -- there is no id to place
 * it under. Dropping it silently would mean a screen that is on the person's screen and in no answer, so the fact is
 * kept here and said in the answer instead. Unreadable is not missing.
 */
export const brokenSurfaces = (): readonly string[] => broken

/**
 * What every registered screen says about itself right now, oldest registration first.
 *
 * The one place the register is read, so that a declaration which cannot be built is counted the same way whoever is
 * asking -- the tree, a read, a write.
 */
function declarations(): { declared: SurfaceDeclaration; at: number }[] {
  const out: { declared: SurfaceDeclaration; at: number }[] = []
  const problems: string[] = []
  for (const entry of [...entries].sort((a, b) => a.at - b.at)) {
    const got = safely(() => entry.read(), null as SurfaceDeclaration | null)
    if (got.problem) {
      problems.push(`A screen could not say what it offers: ${got.problem}`)
      continue
    }
    const declared = got.value
    if (!declared || typeof declared.id !== 'string' || !declared.id) {
      problems.push('A screen is registered without a name, so nothing on it can be reached.')
      continue
    }
    out.push({ declared, at: entry.at })
  }
  broken = problems
  return out
}

/** Every screen registered right now, flat, each with its path and its parent's. */
export function surfaceTree(options: { path?: string; depth?: number } = {}): SurfaceDescriptor[] {
  const byPath = new Map<string, { declared: SurfaceDeclaration; duplicate: boolean }>()
  for (const { declared } of declarations()) {
    const path = joinPath(declared.parent ?? null, declared.id)
    // The later registration answers, and the clash is reported rather than hidden: two screens on one path is a real
    // fault, and silently preferring one of them is how it goes unnoticed for months.
    byPath.set(path, { declared, duplicate: byPath.has(path) })
  }

  const paths = new Set(byPath.keys())
  const all: SurfaceDescriptor[] = []
  for (const [path, { declared, duplicate }] of byPath) {
    const parent = declared.parent ?? null
    const controls = Object.entries(declared.controls ?? {}).map(([id, one]) => describeControl(id, one))
    const actions = Object.entries(declared.actions ?? {}).map(([id, one]) => describeAction(id, one))
    all.push({
      id: declared.id,
      path,
      name: declared.name,
      ...(declared.about ? { about: declared.about } : {}),
      /*
       * A parent that is not registered is reported as a root rather than hidden.
       *
       * A screen whose parent has gone -- unmounted first, or never registered -- would otherwise be in the register
       * and in no tree, which is the worst of both: it answers when asked and cannot be found.
       */
      parent: parent && paths.has(parent) ? parent : null,
      kind: declared.kind ?? 'panel',
      ...(declared.keywords ? { keywords: declared.keywords } : {}),
      controls,
      actions,
      state: describeState(declared),
      children: [...paths].filter((other) => byPath.get(other)!.declared.parent === path),
      ...(declared.possibleChildren?.length ? { possibleChildren: declared.possibleChildren } : {}),
      ...(declared.reach ? { reach: declared.reach } : {}),
      ...(duplicate ? { problem: `Two screens are registered as “${path}”. The newer one answers; the older one is unreachable.` } : {}),
      ...(parent && !paths.has(parent) ? { problem: `Its parent “${parent}” is not on screen, so this is listed on its own.` } : {})
    })
  }

  if (!options.path) return limit(all, null, options.depth)
  const root = all.find((s) => s.path === options.path)
  if (!root) return []
  return limit(all, root.path, options.depth)
}

/**
 * What is wrong with how the screens on screen are wired to each other, right now.
 *
 * Asked of the whole tree rather than of one subtree, because that is the only way the answer is worth anything: a
 * route into Markets is declared by Markets and carried out on the window, and a check that only looked at one of
 * them would be reading half of the disagreement. What it looks for is in `checkSurfaceWiring`.
 *
 * Read on every `screen.tree`, so a mis-wired route is a sentence in the answer rather than a screen that quietly
 * cannot be opened. It costs a pass over a list of what is on screen, and the list is short -- a dozen screens, not a
 * thousand.
 */
export const surfaceWiring = (): WiringProblem[] => checkSurfaceWiring(surfaceTree())

/**
 * The subtree under a path, no deeper than asked.
 *
 * `depth` counts levels below where it starts: 0 is the starting point alone (the roots, when there is no path), 1 is
 * that and what is directly inside it. Absent means all of it.
 */
function limit(all: SurfaceDescriptor[], from: string | null, depth?: number): SurfaceDescriptor[] {
  const deep = (path: string): number => path.split('/').length
  const base = from ? deep(from) : 1
  const keep = (s: SurfaceDescriptor): boolean => {
    if (from && s.path !== from && !s.path.startsWith(`${from}/`)) return false
    return depth === undefined || deep(s.path) - base <= depth
  }
  return all.filter(keep)
}

const found = (path: string): ReturnType<typeof resolveSurfacePath> => resolveSurfacePath(surfaceTree(), path)

/** The live declaration behind a resolved surface, which is what holds the getters and setters. */
function declarationFor(path: string): SurfaceDeclaration | null {
  // Newest first, to match the tree: where two screens claim one path, the one that answers must be the same one.
  for (const { declared } of declarations().reverse()) {
    if (joinPath(declared.parent ?? null, declared.id) === path) return declared
  }
  return null
}

// ---------------------------------------------------------------- answering

export function surfaceStateAt(path: string): { ok: true; path: string; name: string; state: SurfaceState } | { ok: false; message: string } {
  const hit = found(path)
  if (hit.kind === 'miss') return { ok: false, message: hit.message }
  if (hit.kind !== 'surface') return { ok: false, message: `${hit.path} is ${hit.kind === 'control' ? 'a control' : 'an action'}, not a screen.` }
  return { ok: true, path: hit.surface.path, name: hit.surface.name, state: hit.surface.state }
}

export interface ControlReading {
  ok: true
  path: string
  name: string
  on: string
  type: ParamSpec['type']
  value: unknown
  readable: boolean
  writable: boolean
  /** The allowed values, when there is a fixed set of them. */
  values?: string[]
  min?: number
  max?: number
  /** Why it could not be read, or why it cannot be written. */
  note?: string
}

export function readSurfaceControl(path: string): ControlReading | { ok: false; message: string } {
  const hit = found(path)
  if (hit.kind === 'miss') return { ok: false, message: hit.message }
  if (hit.kind !== 'control') return { ok: false, message: `${hit.path} is ${hit.kind === 'surface' ? 'a screen' : 'an action'}, not a control.` }
  const c = hit.control
  return {
    ok: true,
    path: hit.path,
    name: c.name,
    on: hit.surface.path,
    type: c.spec.type,
    value: c.value,
    readable: c.readable,
    writable: c.writable,
    ...(c.spec.enum ? { values: c.spec.enum } : {}),
    ...(typeof c.spec.min === 'number' ? { min: c.spec.min } : {}),
    ...(typeof c.spec.max === 'number' ? { max: c.spec.max } : {}),
    ...(c.unreadableReason || c.readonlyReason ? { note: c.unreadableReason ?? c.readonlyReason } : {})
  }
}

/** Two values are the same thing. Shapes compared whole, so a control holding an object reads back honestly. */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * Waits for a screen to have drawn, so a value can be read back.
 *
 * Setting a control calls the screen's own setter, which in React means asking for a new render rather than changing
 * anything now. Reading straight back therefore reads the old value, and reporting that would be reporting a failure
 * for something that worked. So: wake on the next draw, and fall back to looking again a few times, because some
 * screens change something that does not draw.
 */
function settle(check: () => boolean, ms = 1500): Promise<boolean> {
  if (check()) return Promise.resolve(true)
  return new Promise((resolve) => {
    let done = false
    const finish = (value: boolean): void => {
      if (done) return
      done = true
      waiters.delete(wake)
      clearInterval(poll)
      clearTimeout(timer)
      resolve(value)
    }
    const wake = (): void => {
      if (check()) finish(true)
    }
    waiters.add(wake)
    const poll = setInterval(wake, 25)
    const timer = setTimeout(() => finish(check()), ms)
  })
}

/**
 * Sets a control and says what the value actually became.
 *
 * Every refusal happens before the setter is called: unknown path, not a control, cannot be written, wrong type, out
 * of range. After it, the value is read back -- and a read-back that does not match is reported as `attempted` with
 * what it really holds, not as a failure and never as a success. A screen that rounds, clamps or normalises what it
 * is given is behaving correctly, and the caller needs to be told the number it will see.
 */
export async function writeSurfaceControl(path: string, value: unknown): Promise<SurfaceOutcome> {
  const hit = found(path)
  if (hit.kind === 'miss') return refused(hit.message)
  if (hit.kind !== 'control') return refused(`${hit.path} is ${hit.kind === 'surface' ? 'a screen' : 'an action'}, not something that holds a value.`)

  const checked = checkControlValue(hit.control, value)
  if (!checked.ok) return refused(checked.message)

  const declared = declarationFor(hit.surface.path)?.controls?.[hit.control.id]
  if (!declared?.set) return refused(`${hit.control.name} cannot be set right now.`)

  const before = hit.control.readable ? hit.control.value : undefined
  try {
    await declared.set(checked.value)
  } catch (err) {
    return failedOutcome(`${hit.control.name} would not take that: ${err instanceof Error ? err.message : String(err)}`, {
      error: { code: 'failed', message: err instanceof Error ? err.message : String(err), recoverable: true }
    })
  }

  const now = (): SurfaceControl | null => {
    const again = resolveSurfacePath(surfaceTree(), hit.path)
    return again.kind === 'control' ? again.control : null
  }
  await settle(() => {
    const c = now()
    return Boolean(c && c.readable && same(c.value, checked.value))
  })

  const after = now()
  const note = checked.note ? ` (${checked.note})` : ''
  if (!after) return attempted(`${hit.control.name} was set${note}, and the screen it is on has gone, so nothing could be read back.`, { value: checked.value })
  if (!after.readable) return attempted(`${hit.control.name} was set${note}. Its value cannot be read, so Orbis cannot confirm it.${after.unreadableReason ? ` ${after.unreadableReason}` : ''}`, { value: checked.value })
  if (same(after.value, checked.value)) return completed(`${hit.control.name} is now ${sayValue(after.value)}${note}.`, { value: after.value })
  return attempted(`${hit.control.name} was set to ${sayValue(checked.value)}${note} and it reads ${sayValue(after.value)}${same(after.value, before) ? ' — the same as before' : ''}.`, { value: after.value })
}

/**
 * Does something on a screen and says what it really did.
 *
 * `completed` only when the action itself confirmed it. An action with nothing to check against says `attempted`, in
 * those words, with what it gave back -- which is the honest answer and the one a caller can act on.
 */
export async function runSurfaceAction(path: string, params: Record<string, unknown> = {}): Promise<SurfaceOutcome> {
  const hit = found(path)
  if (hit.kind === 'miss') return refused(hit.message)
  if (hit.kind !== 'action') return refused(`${hit.path} is ${hit.kind === 'surface' ? 'a screen' : 'a control'}, not something that can be done.`)
  if (hit.action.unavailableReason) return refused(`${hit.action.name} cannot be done right now. ${hit.action.unavailableReason}`)

  const declared = declarationFor(hit.surface.path)?.actions?.[hit.action.id]
  if (!declared) return refused(`${hit.action.name} is no longer on screen.`)

  if (declared.params) {
    const problem = validateParams(declared.params, params)
    if (problem) return refused(problem)
  }

  let data: unknown
  try {
    data = await declared.run(params)
  } catch (err) {
    return failedOutcome(`${hit.action.name} failed: ${err instanceof Error ? err.message : String(err)}`, {
      error: { code: 'failed', message: err instanceof Error ? err.message : String(err), recoverable: true }
    })
  }

  if (!declared.verify) return attempted(`${hit.action.name} was done. The screen does not report whether it worked, so Orbis cannot confirm it.`, { data })
  try {
    const checked = await declared.verify(data)
    return checked.done ? completed(checked.detail, { data }) : attempted(`${hit.action.name} was done and ${checked.detail}`, { data })
  } catch (err) {
    return attempted(`${hit.action.name} was done, and checking it failed: ${err instanceof Error ? err.message : String(err)}`, { data })
  }
}

/** What a control or action declares about itself, for deciding whether to ask the person first. */
export function lookupSurface(path: string): SurfaceLookup | { ok: false; message: string } {
  const hit = found(path)
  if (hit.kind === 'miss') return { ok: false, message: hit.message }
  if (hit.kind === 'surface') {
    return { path: hit.path, kind: 'surface', name: hit.surface.name, on: hit.surface.parent ?? '', confirmation: 'none', effects: ['read'] }
  }
  const one = hit.kind === 'control' ? hit.control : hit.action
  const unavailable = hit.kind === 'control' ? (hit.control.writable ? undefined : hit.control.readonlyReason ?? 'It cannot be set right now.') : hit.action.unavailableReason
  return {
    path: hit.path,
    kind: hit.kind,
    name: one.name,
    on: hit.surface.path,
    confirmation: one.confirmation ?? 'none',
    effects: one.effects ?? ['write'],
    ...(unavailable ? { unavailableReason: unavailable } : {})
  }
}
