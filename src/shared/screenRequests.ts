import type { ActionStep, Condition, ParamSpec, Plan, PlanStep, StepRecord } from './browserControl.ts'
import { validateParams } from './browserControl.ts'
import type { SurfaceControl, SurfaceDescriptor, SurfaceTree, ValueCheck } from './surfaces.ts'
import { checkControlValue, coerceForSpec, descendantsOf, normalizeName, planNextStep, resolveSurfacePath, sayValue } from './surfaces.ts'

/**
 * Turning a sentence into something that can be checked, and an outcome back into something true.
 *
 * `surfaces.ts` is the protocol: a screen says what can be read, set and done on it. This is the half between that
 * protocol and a person's words -- which of the screens are worth showing a model, what "a little more" means on a
 * real control, what has to happen in what order, and what to say afterwards.
 *
 * Everything here is pure, and the division is deliberate rather than tidy. **A model may generate; it may never
 * measure.** It can say "turn the search depth up a little"; it must not say what number that is, because the number
 * comes from the control's own range and the value it holds right now. So every relative request below is resolved
 * here, from a real reading, and a model that guesses a number instead is simply not asked to.
 *
 * The same rule runs the other way at the end: a step's outcome is read from what the control layer verified, never
 * from the fact that a command was sent. "Issued" is not "done" and never becomes it.
 */

// ---------------------------------------------------------------- a question or an instruction

export type RequestShape = 'question' | 'instruction'

/**
 * Words that are in every request and tell no two screens apart.
 *
 * Its own list rather than the capability search's (`FILLER` in `src/main/browserControl/registry.ts`), because the
 * two are matching different things. That one keeps verbs like "open", "set" and "turn", because a verb is half of
 * what a capability id *is* -- `tabs.create`, `navigation.go`. Here a verb is only how somebody asked: "turn the
 * engine off" must find the engine, and "turn" matching a screen called Turn Order would be the request's grammar
 * outranking its subject.
 */
const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'onto', 'about', 'please', 'can', 'could', 'would',
  'should', 'you', 'your', 'yours', 'me', 'my', 'mine', 'our', 'its', 'it', 'them', 'they',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'are', 'was', 'were', 'been', 'being', 'is', 'be',
  'then', 'than', 'now', 'just', 'also', 'any', 'all', 'some', 'every', 'here', 'there', 'where', 'when',
  'how', 'what', 'which', 'who', 'why', 'much', 'many', 'very', 'really', 'tell', 'let', 'make', 'get',
  'want', 'need', 'like', 'use', 'try', 'put', 'take', 'give', 'say', 'said', 'will', 'shall', 'may', 'might',
  // How somebody asks, rather than what they are asking about.
  'open', 'close', 'show', 'hide', 'set', 'change', 'turn', 'switch', 'press', 'click', 'start', 'stop', 'run',
  'increase', 'decrease', 'raise', 'lower', 'more', 'less', 'little', 'bit', 'lot', 'up', 'down', 'off', 'on',
  'again', 'back', 'please', 'orbis'
])

const wordsOf = (text: string): string[] =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

const subjectWords = (text: string): string[] => wordsOf(text).filter((word) => word.length > 1 && !COMMON_WORDS.has(word))

/**
 * Whether somebody is asking how something works or telling Orbis to do it.
 *
 * Worth getting right because the two have different costs. Answering "how do I change the speed?" by changing the
 * speed is doing something nobody asked for; answering "change the speed" with a description of where the slider is
 * is refusing to help.
 *
 * Politeness is read first, and that order is the whole of it. "Can you turn it up" is shaped exactly like a
 * question and is an instruction; "can I turn it up" is shaped the same way and is a question about what is possible.
 * A question mark decides nothing -- "turn it off?" is still an instruction.
 */
export function requestShape(text: string): RequestShape {
  const asked = String(text ?? '').trim().toLowerCase()
  if (!asked) return 'question'
  // Politeness wrapped round an instruction. "Can you", "could you", "would you mind", "please".
  if (/^(please\b|(can|could|would|will|wo?nt)\s+(you|u)\b)/.test(asked)) return 'instruction'
  if (/\bplease\b/.test(asked) && !/^(how|what|where|why|which|who|when)\b/.test(asked)) return 'instruction'
  // Asking about the thing rather than asking for it.
  if (/^(how|what|whats|what's|where|why|which|who|when|is|are|was|were|does|do i|did|am i|should i|can i|could i|may i|will it|whether)\b/.test(asked)) return 'question'
  if (/^(tell me|explain|describe|remind me|any idea|do you know)\b/.test(asked)) return 'question'
  return 'instruction'
}

// ---------------------------------------------------------------- which screens to show

/** One thing a request might have been about, with how sure the match is. */
export interface ScreenMatch {
  /** The full path: a surface, or a control or action on one. */
  path: string
  kind: 'surface' | 'control' | 'action'
  name: string
  score: number
}

export interface ShownScreens {
  /** The surfaces worth showing, outermost first, with their ancestors so every path reads whole. */
  surfaces: SurfaceDescriptor[]
  /**
   * Whether the request named anything in particular.
   *
   * False for "what can I change here?", which names nothing and is still a fair question. The difference decides
   * whether an empty `matched` means "Orbis has no such thing" or "they did not say which thing" -- answering the
   * second with the first is how a general question gets told the feature does not exist.
   */
  names: boolean
  /** What the request seems to be about, best first. Empty means nothing on screen answers to it. */
  matched: ScreenMatch[]
  /** The subtree written out for a model: every control with its type, its range and what it holds now. */
  text: string
  /** What is on screen at all, as `path — Name` lines, so "Orbis has no such thing" can be said with evidence. */
  openScreens: string[]
  /**
   * Screens that are not open and that a parent says it can open, as `path — Name`.
   *
   * These are the one honest gap in discovery, and naming it is the point. A screen that is not open has not said
   * what is on it, so nothing can be scored against its controls: with the Notifications page closed, "turn quiet
   * hours on" matches nothing anywhere. That is not the same as Orbis having no quiet hours, and answering it the
   * same way would be a confident falsehood. So the closed screens travel too, as somewhere to look.
   */
  canOpen: string[]
}

interface Named {
  id: string
  name: string
  keywords?: readonly string[]
  about?: string
  description?: string
}

/**
 * How well a request's words fit one named thing.
 *
 * In order of how sure each way is, the surest first, so a thing called exactly what somebody said outranks one that
 * merely mentions it. The same idea as `scoreCapability` in `commandCenter.ts`, over the different vocabulary a
 * screen has (a path segment, the words on screen, declared keywords, and what it is for).
 */
function scoreNamed(request: string, words: string[], thing: Named): number {
  const want = normalizeName(request)
  const id = normalizeName(thing.id)
  const name = normalizeName(thing.name)
  if (!want) return 0
  if (id === want || name === want) return 100
  if ((thing.keywords ?? []).some((one) => normalizeName(one) === want)) return 80
  if (id.startsWith(want) || name.startsWith(want)) return 70

  const haystack = [thing.id, thing.name, ...(thing.keywords ?? [])].join(' ')
  const own = wordsOf(haystack)
  // The id written as words too, so `engineDepth` answers to "depth".
  const split = wordsOf(thing.id.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))
  const named = [...own, ...split]
  const hits = words.filter((word) => named.some((part) => part === word || part.startsWith(word)))
  if (words.length && hits.length === words.length) return 60
  let score = hits.length * 12
  // What it says about itself: worth something, and the least of anything.
  const prose = `${thing.about ?? ''} ${thing.description ?? ''}`.toLowerCase()
  score += words.filter((word) => prose.includes(word)).length * 2
  return score
}

const ancestorsOf = (tree: SurfaceTree, surface: SurfaceDescriptor): SurfaceDescriptor[] => {
  const out: SurfaceDescriptor[] = []
  let at: SurfaceDescriptor | undefined = surface
  while (at?.parent) {
    const parent: SurfaceDescriptor | undefined = tree.find((one) => one.path === at!.parent)
    if (!parent || out.includes(parent)) break
    out.unshift(parent)
    at = parent
  }
  return out
}

/** How many allowed values are written out before the rest are counted instead. */
const VALUES_SHOWN = 14

/** One control, as a line a model can act on: what it is, what it may hold, and what it holds now. */
export function describeControlLine(control: SurfaceControl): string {
  const parts = [`  control ${control.id} “${control.name}” ${control.spec.type}`]
  if (control.spec.enum?.length) {
    const values = control.spec.enum
    parts.push(
      `one of: ${values.slice(0, VALUES_SHOWN).join(' | ')}${values.length > VALUES_SHOWN ? ` | …and ${values.length - VALUES_SHOWN} more` : ''}`
    )
  }
  if (typeof control.spec.min === 'number' || typeof control.spec.max === 'number') {
    parts.push(`range ${control.spec.min ?? '?'} to ${control.spec.max ?? '?'}`)
  }
  /*
   * What it holds, and only when that was really read.
   *
   * A control whose getter threw says so here instead of showing a value. Printing the `value` field anyway would
   * put a null in front of a model as though somebody had set it to nothing, which is the same fault as a store
   * writing its default over data it merely could not open.
   */
  parts.push(control.readable ? `= ${sayValue(control.value)}` : `= (could not be read: ${control.unreadableReason ?? 'no reason given'})`)
  if ('default' in control) parts.push(`(back to ${sayValue(control.default)})`)
  if (!control.writable) parts.push(`[read only: ${control.readonlyReason ?? 'it cannot be set'}]`)
  if (control.effects?.some((one) => one !== 'read' && one !== 'write')) parts.push(`[setting it will ${control.effects.filter((one) => one !== 'read' && one !== 'write').join(' and ')}]`)
  if (control.about) parts.push(`— ${control.about}`)
  return parts.join(' ')
}

const describeActionLine = (surface: SurfaceDescriptor, id: string): string => {
  const action = surface.actions.find((one) => one.id === id)!
  const parts = [`  do ${action.id} “${action.name}”`]
  if (action.params) parts.push(`needs ${Object.entries(action.params).map(([key, spec]) => `${key}${spec.required ? '' : '?'}:${spec.type}`).join(', ')}`)
  if (action.effects?.length) parts.push(`[${action.effects.join(', ')}]`)
  if (action.confirmation === 'always') parts.push('[asks you first]')
  if (action.unavailableReason) parts.push(`[cannot be done now: ${action.unavailableReason}]`)
  if (action.about) parts.push(`— ${action.about}`)
  return parts.join(' ')
}

function describeSurface(surface: SurfaceDescriptor, withThings: boolean): string {
  const head = [`${surface.path} — ${surface.name} (${surface.kind})`]
  if (surface.state.activity !== 'idle') head.push(`[${surface.state.activity}${surface.state.detail ? `: ${surface.state.detail}` : ''}]`)
  if (surface.problem) head.push(`[problem: ${surface.problem}]`)
  if (surface.about) head.push(`— ${surface.about}`)
  const lines = [head.join(' ')]
  if (!withThings) return lines[0]
  for (const control of surface.controls) lines.push(describeControlLine(control))
  for (const action of surface.actions) lines.push(describeActionLine(surface, action.id))
  if (surface.possibleChildren?.length) {
    lines.push(`  can open: ${surface.possibleChildren.map((one) => `${one.id} (${one.name})`).join(', ')}`)
  }
  return lines.join('\n')
}

/**
 * The part of the tree a request is about, written out for a model.
 *
 * Not the whole tree, and the reason is not only size. A model handed every control in Orbis has to pick one by
 * reading all of them, and the thing it picks is as likely to be the first plausible name as the right one. Handed
 * the eight screens whose own names answer to what was asked, plus what is open at all, it is choosing between
 * candidates rather than searching -- and it can see when the answer is that there is no such thing.
 *
 * Ancestors come along whether they matched or not, because a path is only usable whole: `settings/notifications`
 * means nothing to a caller that has not been told Settings exists.
 */
export function relevantScreens(tree: SurfaceTree, request: string, options: { limit?: number; chars?: number } = {}): ShownScreens {
  const limit = Math.max(1, options.limit ?? 8)
  const budget = Math.max(500, options.chars ?? 6000)
  const words = subjectWords(request)

  const matched: ScreenMatch[] = []
  const weight = new Map<string, number>()
  for (const surface of tree) {
    const own = scoreNamed(request, words, surface)
    if (own > 0) matched.push({ path: surface.path, kind: 'surface', name: surface.name, score: own })
    let best = own
    for (const control of surface.controls) {
      const score = scoreNamed(request, words, { id: control.id, name: control.name, about: control.about, description: control.spec.description })
      if (score > 0) matched.push({ path: `${surface.path}/${control.id}`, kind: 'control', name: control.name, score })
      best = Math.max(best, score)
    }
    for (const action of surface.actions) {
      const score = scoreNamed(request, words, { id: action.id, name: action.name, about: action.about })
      if (score > 0) matched.push({ path: `${surface.path}/${action.id}`, kind: 'action', name: action.name, score })
      best = Math.max(best, score)
    }
    /*
     * A screen that is not open yet is still a candidate, through its parent's own list.
     *
     * Without this, "turn the engine depth up" with Chess World closed scores nothing anywhere and reads as "Orbis
     * has no such thing" -- when in fact the route to it is declared and one step long. The parent carries the
     * score so the parent is what gets shown, which is also what has to be acted on first.
     */
    for (const child of surface.possibleChildren ?? []) {
      best = Math.max(best, scoreNamed(request, words, { id: child.id, name: child.name }) * 0.9)
    }
    if (best > 0) weight.set(surface.path, best)
  }

  /*
   * A request that names nothing is shown what is in front of the person instead.
   *
   * "What can I change here?" has no subject to score, so scoring it finds nothing -- and an empty answer would be
   * read as Orbis having no screens. The outermost ones, which is what somebody looking at the window would point
   * at, is the honest reply to a question with no subject.
   */
  const ranked = words.length
    ? [...weight.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    : tree.map((one): [string, number] => [one.path, 1]).sort((a, b) => a[0].split('/').length - b[0].split('/').length || a[0].localeCompare(b[0]))

  const keep: SurfaceDescriptor[] = []
  const add = (surface: SurfaceDescriptor): void => {
    if (!keep.includes(surface)) keep.push(surface)
  }
  for (const [path] of ranked.slice(0, limit)) {
    const surface = tree.find((one) => one.path === path)
    if (!surface) continue
    for (const up of ancestorsOf(tree, surface)) add(up)
    add(surface)
  }
  // Depth first by path, so a parent is always above its children and the shape of the tree reads off the page.
  keep.sort((a, b) => a.path.localeCompare(b.path))

  const detailed = new Set(keep.filter((one) => !words.length || weight.has(one.path)).map((one) => one.path))
  const blocks: string[] = []
  let used = 0
  for (const surface of keep) {
    const block = describeSurface(surface, detailed.has(surface.path))
    // Over the budget, the surface is still named -- a path that disappears looks like a screen that is not there.
    const line = used + block.length > budget ? describeSurface(surface, false) : block
    blocks.push(line)
    used += line.length
  }

  const open = new Set(tree.map((one) => one.path))
  return {
    surfaces: keep,
    names: words.length > 0,
    matched: matched.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)),
    text: blocks.join('\n'),
    openScreens: [...open].map((path) => `${path} — ${tree.find((one) => one.path === path)!.name}`),
    canOpen: tree.flatMap((one) => (one.possibleChildren ?? []).filter((child) => !open.has(`${one.path}/${child.id}`)).map((child) => `${one.path}/${child.id} — ${child.name}`))
  }
}

// ---------------------------------------------------------------- what "a little more" is

/** How much of a control's range each word moves it. `all` goes to the end of the range. */
export const NUDGE_SHARE: Record<'little' | 'some' | 'lot', number> = { little: 0.1, some: 0.25, lot: 0.5 }

export type NudgeSize = keyof typeof NUDGE_SHARE | 'all'

export type Resolved = { ok: true; value: unknown; note: string } | { ok: false; why: string }

/**
 * What a control holds after being moved by a word rather than a number.
 *
 * The range is read from the control's own spec and the starting point from the control's own reading, so "a little
 * more" is a tenth of what this particular control can span -- two steps of a depth that goes to 40, a tenth of a
 * second on a delay that goes to one. A model asked for the number instead would answer from the shape of the
 * number it saw, which is how a depth of 18 becomes 25 on one screen and 19 on another.
 *
 * A control that does not say its range gets a refusal with the fix in it, not a guess. There is no honest tenth of
 * an unbounded number.
 */
export function nudgeValue(control: Pick<SurfaceControl, 'name' | 'spec' | 'value' | 'readable'>, direction: 'up' | 'down', size: NudgeSize): Resolved {
  const spec = control.spec
  if (spec.type !== 'number' && spec.type !== 'integer') {
    return { ok: false, why: `${control.name} holds ${spec.type === 'boolean' ? 'a yes or a no' : `a ${spec.type}`}, so there is nothing to turn up or down. Say what to set it to.` }
  }
  if (!control.readable) return { ok: false, why: `${control.name} could not be read, so there is nothing to move it from. Say a number instead.` }
  const now = Number(control.value)
  if (!Number.isFinite(now)) return { ok: false, why: `${control.name} does not hold a number right now (it is ${sayValue(control.value)}), so Orbis cannot move it. Say a number instead.` }
  const { min, max } = spec
  if (typeof min !== 'number' || typeof max !== 'number') {
    return { ok: false, why: `${control.name} does not say how far it goes, so Orbis cannot work out what “${size === 'all' ? 'all the way' : `a ${size}`}” means. Say a number.` }
  }

  const edge = direction === 'up' ? max : min
  if (now === edge) return { ok: false, why: `${control.name} is already ${direction === 'up' ? 'at its highest' : 'at its lowest'}, ${now}. Its range is ${min} to ${max}.` }

  if (size === 'all') return { ok: true, value: edge, note: `all the way ${direction} from ${now} to ${edge} (its range is ${min} to ${max})` }

  const raw = (max - min) * NUDGE_SHARE[size]
  // A whole-number control moves by whole numbers, and never by none: a tenth of a range of 5 is 0.5, and rounding
  // that to 0 would be a request that reported success and changed nothing.
  const step = spec.type === 'integer' ? Math.max(1, Math.round(raw)) : Number(raw.toPrecision(2))
  const wanted = direction === 'up' ? now + step : now - step
  const landed = direction === 'up' ? Math.min(max, wanted) : Math.max(min, wanted)
  const value = spec.type === 'integer' ? Math.round(landed) : Number(landed.toPrecision(6))
  return {
    ok: true,
    value,
    note:
      value === edge && wanted !== landed
        ? `${direction} a ${size} from ${now} would be ${wanted}, which is past the end, so ${value} — as far as it goes (its range is ${min} to ${max})`
        : `${direction} a ${size} from ${now} to ${value} (its range is ${min} to ${max})`
  }
}

export type Which = number | 'next' | 'previous' | 'first' | 'last'

/**
 * Which of a control's allowed values somebody meant: the second one, the next one, the last one.
 *
 * Counted here rather than left to a model, for the same reason as the arithmetic above: the list is on the screen
 * and the model is looking at a copy of it. "The second option" has one right answer and it is cheap to be certain.
 */
export function chooseValue(control: Pick<SurfaceControl, 'name' | 'spec' | 'value' | 'readable'>, which: Which): Resolved {
  const values = control.spec.enum
  if (!values?.length) return { ok: false, why: `${control.name} has no list of options to count through. Say what to set it to.` }
  if (typeof which === 'number') {
    if (!Number.isInteger(which) || which < 1 || which > values.length) {
      return { ok: false, why: `${control.name} has ${values.length} option${values.length === 1 ? '' : 's'}, so there is no number ${which}. They are: ${values.join(', ')}.` }
    }
    return { ok: true, value: values[which - 1], note: `option ${which} of ${values.length}: ${values[which - 1]}` }
  }
  if (which === 'first') return { ok: true, value: values[0], note: `the first of ${values.length}: ${values[0]}` }
  if (which === 'last') return { ok: true, value: values[values.length - 1], note: `the last of ${values.length}: ${values[values.length - 1]}` }

  if (!control.readable) return { ok: false, why: `${control.name} could not be read, so Orbis does not know which option it is on. Name the one you want: ${values.join(', ')}.` }
  const at = values.indexOf(String(control.value))
  if (at < 0) return { ok: false, why: `${control.name} is set to ${sayValue(control.value)}, which is not one of its options, so there is no next one. They are: ${values.join(', ')}.` }
  const to = which === 'next' ? at + 1 : at - 1
  if (to < 0 || to >= values.length) {
    return { ok: false, why: `${control.name} is already the ${which === 'next' ? 'last' : 'first'} option, ${values[at]}. They are: ${values.join(', ')}.` }
  }
  return { ok: true, value: values[to], note: `the ${which} option after ${values[at]}: ${values[to]}` }
}

// ---------------------------------------------------------------- a wish, checked

/**
 * One thing a model may ask for.
 *
 * Deliberately small, and three of the six are relative on purpose. `set` takes a value, so it is what a model uses
 * when somebody said a value; `nudge`, `choose` and `revert` are what it uses when somebody did not, and each is
 * worked out below from what the control really holds. There is no seventh form in which a model supplies a number
 * it inferred.
 */
export type ScreenWish =
  | { op: 'open'; path: string; why?: string }
  | { op: 'read'; path: string; why?: string }
  | { op: 'set'; path: string; value: unknown; why?: string; onlyIf?: { path: string; is: unknown } }
  | { op: 'nudge'; path: string; direction: 'up' | 'down'; size: NudgeSize; why?: string }
  | { op: 'choose'; path: string; which: Which; why?: string }
  /** Back to whatever it held before Orbis last changed it. */
  | { op: 'revert'; path: string; why?: string }
  | { op: 'do'; path: string; params?: Record<string, unknown>; why?: string; onlyIf?: { path: string; is: unknown } }

/** A control that has to hold a particular value before a step runs, read again at the moment of the branch. */
export interface StepCondition {
  path: string
  is: unknown
}

/** A wish that has been checked against the real tree: a capability, its parameters, and what it is for. */
export interface ReadyStep {
  capability: 'screen.goTo' | 'screen.read' | 'screen.write' | 'screen.do'
  params: Record<string, unknown>
  /** What this step does, in the words somebody will read. */
  what: string
  /** How a relative request became this value, when it was one. Shown so nothing changes silently. */
  note?: string
  /** Only do it when this still holds. Becomes a reading and a branch in the plan. */
  onlyIf?: StepCondition
}

export type Checked =
  | { ok: true; steps: ReadyStep[] }
  /** The request was wrong and would be wrong again: no such control, a value it cannot take, nothing to move. */
  | { ok: false; why: string }
  /** Two things answer equally well, or the path stopped somewhere. One short question, with what was really there. */
  | { ok: false; why: string; question: string; choices: string[] }

export interface CheckOptions {
  /** What a control held before Orbis last changed it, for `revert`. Undefined when there is nothing to go back to. */
  previousValue?(path: string): unknown
}

/**
 * Every wish checked against the tree as it is now, before anything runs.
 *
 * The order matters: a path that does not resolve, a control that cannot be set, a value outside the range -- all of
 * these are found here, with the range or the list of options in the message, rather than halfway through a plan
 * with two of five steps already done to somebody's screen.
 *
 * A screen that is not open yet is not a failure. `screen.goTo` is added in front of a write or an action whose
 * surface is not in the tree, which is the one case where the right answer to "there is no such path" is to open it.
 */
export function checkWishes(tree: SurfaceTree, wishes: readonly ScreenWish[], options: CheckOptions = {}): Checked {
  const steps: ReadyStep[] = []
  const opened = new Set<string>()

  for (const wish of wishes) {
    const asked = String(wish.path ?? '').trim()
    if (!asked) return { ok: false, why: 'A step was given with no path, so there is nothing to act on.' }

    if (wish.op === 'open') {
      /*
       * Not resolved against what exists -- the whole point of opening something is that it does not exist yet --
       * but the route to it is checked, which is a different question and the one worth asking here.
       *
       * `planNextStep` walks what is open and what each parent says it can open. A path it cannot take a first step
       * towards is a path nowhere in Orbis, and refusing it here is what stops "open the thermostat calibration
       * panel" becoming "open Settings, which is the nearest thing with a name".
       */
      const route = planNextStep(tree, asked)
      if (!route.arrived && !route.next) return { ok: false, why: route.stuck ?? `Orbis cannot get to “${asked}” from what is on screen.` }
      steps.push({ capability: 'screen.goTo', params: { path: asked }, what: wish.why?.trim() || `Open ${asked}` })
      opened.add(asked)
      continue
    }

    /*
     * A precondition is checked for existing now, and read again when the plan reaches it.
     *
     * Both, because they answer different questions. A path that points at nothing is a mistake in the request and
     * belongs in a refusal before anything runs; a value that has changed since is the ordinary case, and that is
     * what the branch in the plan is for.
     */
    let onlyIf: StepCondition | undefined
    if ((wish.op === 'set' || wish.op === 'do') && wish.onlyIf) {
      const guard = resolveSurfacePath(tree, String(wish.onlyIf.path ?? ''))
      if (guard.kind !== 'control') {
        return { ok: false, why: guard.kind === 'miss' ? `The condition on this step points at nothing: ${guard.message}` : `${guard.path} does not hold a value, so it cannot be a condition.` }
      }
      onlyIf = { path: guard.path, is: wish.onlyIf.is }
    }

    const hit = resolveSurfacePath(tree, asked)
    if (hit.kind === 'miss') {
      /*
       * Something a step earlier in this plan is opening is taken on trust, and only that.
       *
       * The tree being checked against is the tree before the plan runs, so a panel this plan opens genuinely is not
       * in it. Trusting anything further would mean a wrong path being discovered by a write landing somewhere
       * unexpected.
       */
      const willOpen = [...opened].some((one) => asked === one || asked.startsWith(`${one}/`) || one.startsWith(`${asked}/`))
      if (willOpen) {
        if (wish.op === 'set') {
          steps.push({ capability: 'screen.write', params: { path: asked, value: wish.value }, what: wish.why?.trim() || `Set ${asked} to ${sayValue(wish.value)}`, ...(onlyIf ? { onlyIf } : {}) })
          continue
        }
        if (wish.op === 'do') {
          steps.push({ capability: 'screen.do', params: { path: asked, ...(wish.params ? { params: wish.params } : {}) }, what: wish.why?.trim() || `Do ${asked}`, ...(onlyIf ? { onlyIf } : {}) })
          continue
        }
        if (wish.op === 'read') {
          steps.push({ capability: 'screen.read', params: { path: asked }, what: wish.why?.trim() || `Read ${asked}` })
          continue
        }
        // A relative move needs a reading, and there is nothing to read on a screen that is not open yet.
        return { ok: false, why: `${asked} is not on screen yet, so Orbis cannot see what it is set to in order to move it. Open it first, then say how far to move it.` }
      }
      return {
        ok: false,
        why: hit.message,
        question: hit.why === 'ambiguous' ? `${hit.message} Which did you mean?` : `Orbis cannot find “${hit.stuck}”. ${hit.choices.length ? `Did you mean one of these: ${hit.choices.join(', ')}?` : 'What is it called on screen?'}`,
        choices: hit.choices
      }
    }

    if (wish.op === 'read') {
      steps.push({ capability: 'screen.read', params: { path: hit.path }, what: wish.why?.trim() || `Read ${hit.kind === 'control' ? hit.control.name : hit.path}` })
      continue
    }

    if (wish.op === 'do') {
      if (hit.kind !== 'action') return { ok: false, why: `${hit.path} is ${hit.kind === 'surface' ? 'a screen' : 'a control that holds a value'}, not something that can be done.` }
      if (hit.action.unavailableReason) return { ok: false, why: `${hit.action.name} cannot be done right now. ${hit.action.unavailableReason}` }
      if (hit.action.params) {
        const problem = checkActionParams(hit.action.params, wish.params ?? {})
        if (problem) return { ok: false, why: `${hit.action.name}: ${problem}` }
      }
      steps.push({ capability: 'screen.do', params: { path: hit.path, ...(wish.params ? { params: wish.params } : {}) }, what: wish.why?.trim() || hit.action.name, ...(onlyIf ? { onlyIf } : {}) })
      continue
    }

    if (hit.kind !== 'control') {
      return { ok: false, why: `${hit.path} is ${hit.kind === 'surface' ? 'a screen' : 'something that is done rather than set'}, so it does not hold a value to change.` }
    }
    const control = hit.control

    let value: unknown
    let note: string | undefined
    if (wish.op === 'set') value = wish.value
    else if (wish.op === 'nudge') {
      const moved = nudgeValue(control, wish.direction, wish.size)
      if (!moved.ok) return { ok: false, why: moved.why }
      value = moved.value
      note = moved.note
    } else if (wish.op === 'choose') {
      const picked = chooseValue(control, wish.which)
      if (!picked.ok) return { ok: false, why: picked.why }
      value = picked.value
      note = picked.note
    } else {
      const before = options.previousValue?.(hit.path)
      if (before === undefined) {
        return { ok: false, why: `Orbis has no record of what ${control.name} was before, so there is nothing to put it back to. Say what to set it to.` }
      }
      value = before
      note = `back to ${sayValue(before)}, which is what it held before Orbis changed it`
    }

    // The control's own spec, through the same check a capability's parameters go through. Out of range is refused
    // with the range rather than quietly becoming the nearest allowed number.
    const allowed = onlyIf ? valueForSpec(control, value) : checkControlValue(control, value)
    if (!allowed.ok) return { ok: false, why: allowed.message }

    steps.push({
      capability: 'screen.write',
      params: { path: hit.path, value: allowed.value },
      what: wish.why?.trim() || `Set ${control.name} to ${sayValue(allowed.value)}`,
      ...(note ? { note } : {}),
      ...(onlyIf ? { onlyIf } : {})
    })
  }

  if (!steps.length) return { ok: false, why: 'There was nothing to do.' }
  return { ok: true, steps }
}

/**
 * A value checked against a control's own spec, and against nothing else.
 *
 * `checkControlValue` also refuses a control that cannot be set at this moment, which is right for a step about to
 * run and wrong for one behind an `onlyIf`. Whether it can be set is the kind of thing the guard exists to decide,
 * and it is read again when the plan reaches the branch -- so refusing the whole request now, on a fact that may
 * well be the reason the step was guarded, would make the guard useless. What is still worth refusing now is a
 * value the control could never hold: out of its range, or not one of its options.
 */
function valueForSpec(control: SurfaceControl, value: unknown): ValueCheck {
  const coerced = coerceForSpec(control.spec, value)
  const problem = validateParams({ [control.id]: { ...control.spec, required: true } }, { [control.id]: coerced.value })
  if (problem) return { ok: false, message: problem }
  return { ok: true, value: coerced.value, ...(coerced.note ? { note: coerced.note } : {}) }
}

/** An action's own parameters, checked the way the window will check them, so a refusal happens before the plan runs. */
function checkActionParams(spec: Record<string, ParamSpec>, params: Record<string, unknown>): string | null {
  for (const [name, one] of Object.entries(spec)) {
    if (one.required && (params[name] === undefined || params[name] === null)) return `it needs ${name} (${one.description}).`
  }
  const extra = Object.keys(params).filter((name) => !(name in spec))
  return extra.length ? `it does not take ${extra.join(', ')}. It takes: ${Object.keys(spec).join(', ') || 'nothing'}.` : null
}

// ---------------------------------------------------------------- the plan

/**
 * The checked steps as a plan for the runner Orbis already has.
 *
 * There is no second executor here and there must not be: a plan run through `PlanRun` gets the pausing, the
 * stopping, the step records, the checkpoints, the confirmations and the one line in the log that every other
 * automation in Orbis gets. A loop over `control.execute` would get none of it, and would be the second place a
 * failure has to be understood.
 *
 * `onlyIf` is why `Condition` is in this file at all. "Set the start time, but only if quiet hours are on" is two
 * steps and a branch: read the control, then act inside an `if` that compares the saved reading. Asking the screen
 * again at the moment of the branch is the point -- the alternative is a plan that decided ten seconds ago.
 */
export function planForScreens(name: string, steps: readonly ReadyStep[]): Plan {
  const planSteps: PlanStep[] = []
  steps.forEach((step, index) => {
    const action: ActionStep = {
      id: `act${index + 1}`,
      do: step.capability,
      params: step.params,
      label: step.what,
      saveAs: `step${index + 1}`
    }
    if (!step.onlyIf) {
      planSteps.push(action)
      return
    }
    /*
     * The guard's own reading is marked as a check, not as a step.
     *
     * By its id rather than by its label, because the report below has to tell the two apart and a label is words
     * somebody may change. A reading taken to decide something is how the plan thought; it is not one of the things
     * the person asked for, and listing it as one would pad every answer with Orbis's own bookkeeping.
     */
    const read: ActionStep = { id: `check${index + 1}`, do: 'screen.read', params: { path: step.onlyIf.path }, label: `Check ${step.onlyIf.path}`, saveAs: `check${index + 1}` }
    const test: Condition = { check: 'compare', left: `{{check${index + 1}.value}}`, op: '==', right: step.onlyIf.is }
    planSteps.push(read, { if: test, then: [action], label: `Only if ${step.onlyIf.path} is ${sayValue(step.onlyIf.is)}` })
  })
  // Stop rather than pause: there is nobody standing by a plan that came out of a sentence, and a half-applied
  // change left paused for ever is worse than one that stopped and said where.
  return { name, steps: planSteps, onFailure: 'stop' }
}

// ---------------------------------------------------------------- what really happened

export type StepStatus = 'confirmed' | 'unconfirmed' | 'nothing-to-do' | 'refused' | 'failed' | 'skipped'

export interface StepOutcome {
  /** What the step was for, in the words it was planned with. */
  what: string
  capability: string
  status: StepStatus
  /** What the screen said about it afterwards. This is the sentence worth reading. */
  detail: string
}

export interface ScreenReport {
  outcomes: StepOutcome[]
  /** Whether every step that was meant to change something was confirmed by a reading taken afterwards. */
  allConfirmed: boolean
  /** What to say: the result first, then anything that did not work and why. */
  text: string
}

/**
 * What a run really did, read from its own records.
 *
 * Every "confirmed" below rests on `verification.verified`, which the control layer only sets from a reading taken
 * after the fact. Nothing here can turn a command that was sent into a result that happened, and that is the only
 * property of this function that matters.
 */
export function reportScreenRun(records: readonly StepRecord[]): ScreenReport {
  const outcomes: StepOutcome[] = []
  for (const record of records) {
    // Only the steps that act, and only once. An `if` is how the plan decided and the reading under it is Orbis's
    // own bookkeeping; neither is a thing somebody asked for.
    if (record.kind !== 'action' || record.stepId?.startsWith('check')) continue
    const what = record.label ?? record.action ?? 'A step'
    const capability = record.action ?? ''
    const summary = record.summary && typeof record.summary === 'object' ? (record.summary as Record<string, unknown>) : null
    if (record.status === 'skipped' || record.status === 'cancelled') {
      outcomes.push({ what, capability, status: 'skipped', detail: record.status === 'skipped' ? 'It was skipped.' : 'It was stopped before this ran.' })
      continue
    }
    if (record.status === 'success') {
      /*
       * A reading is confirmed by being a reading. It has nothing to verify against and no verification of its own,
       * so the general rule below -- no verification means nothing could confirm it -- would report every read as
       * doubtful. What a read has to be honest about is something else: whether the screen could answer at all.
       */
      if (record.action === 'screen.read') {
        const readable = summary?.readable !== false
        outcomes.push({
          what,
          capability,
          status: readable ? 'confirmed' : 'unconfirmed',
          detail: readable ? `${String(summary?.name ?? what)} is ${sayValue(summary?.value)}.` : `${String(summary?.name ?? what)} could not be read. ${String(summary?.note ?? '')}`.trim()
        })
        continue
      }
      const detail = record.verification?.detail ?? 'The screen said nothing about it.'
      if (summary?.unchanged === true) outcomes.push({ what, capability, status: 'nothing-to-do', detail })
      else if (record.verification?.verified) outcomes.push({ what, capability, status: 'confirmed', detail })
      else outcomes.push({ what, capability, status: 'unconfirmed', detail: `It was carried out and nothing could confirm it. ${detail}` })
      continue
    }
    const error = record.error
    const refused = error?.code === 'invalid-params' || error?.code === 'declined' || error?.code === 'blocked' || error?.code === 'not-found'
    outcomes.push({ what, capability, status: refused ? 'refused' : 'failed', detail: error?.message ?? 'It did not work, and nothing said why.' })
  }

  const changing = outcomes.filter((one) => one.status !== 'skipped')
  const allConfirmed = changing.length > 0 && changing.every((one) => one.status === 'confirmed' || one.status === 'nothing-to-do')
  const good = outcomes.filter((one) => one.status === 'confirmed' || one.status === 'nothing-to-do')
  const bad = outcomes.filter((one) => one.status === 'refused' || one.status === 'failed')
  const unsure = outcomes.filter((one) => one.status === 'unconfirmed')
  const stopped = outcomes.filter((one) => one.status === 'skipped')

  const lines: string[] = []
  // The result first, in the screen's own words.
  for (const one of good) lines.push(one.detail)
  for (const one of unsure) lines.push(`${one.what}: ${one.detail}`)
  for (const one of bad) lines.push(`${one.what} did not happen: ${one.detail}`)
  if (stopped.length) lines.push(`${stopped.length} later step${stopped.length === 1 ? '' : 's'} were not tried.`)
  if (!lines.length) lines.push('Nothing was done.')
  return { outcomes, allConfirmed, text: lines.join(' ') }
}

// ---------------------------------------------------------------- answering a question from the screen itself

/**
 * A question answered from one real reading, with no model involved.
 *
 * Two jobs. It is the answer to "what is the depth set to?", which is a reading and nothing else -- and it is what
 * Orbis says when Orion cannot be reached, because a question has a true answer sitting in the register while an
 * instruction does not.
 */
export function answerAboutControl(tree: SurfaceTree, path: string): string | null {
  const hit = resolveSurfacePath(tree, path)
  if (hit.kind === 'miss') return null
  if (hit.kind === 'surface') {
    const inside = descendantsOf(tree, hit.surface.path)
    const settable = hit.surface.controls.filter((one) => one.writable)
    return [
      `${hit.surface.name} is open${hit.surface.state.activity === 'idle' ? '' : ` and ${hit.surface.state.activity}`}.`,
      settable.length ? `You can change ${settable.map((one) => one.name).join(', ')}.` : 'Nothing on it can be changed.',
      hit.surface.actions.length ? `You can ${hit.surface.actions.map((one) => one.name.toLowerCase()).join(', ')}.` : '',
      inside.length ? `Inside it: ${inside.map((one) => one.name).join(', ')}.` : ''
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (hit.kind === 'action') {
    return `${hit.action.name} is on ${hit.surface.name}${hit.action.unavailableReason ? `, and cannot be done right now: ${hit.action.unavailableReason}` : ''}.${hit.action.about ? ` ${hit.action.about}` : ''}`
  }
  const c = hit.control
  const range =
    c.spec.enum?.length
      ? ` It can be ${c.spec.enum.join(', ')}.`
      : typeof c.spec.min === 'number' && typeof c.spec.max === 'number'
        ? ` It goes from ${c.spec.min} to ${c.spec.max}.`
        : ''
  const where = `It is on ${hit.surface.name} (${hit.path}).`
  if (!c.readable) return `${c.name} could not be read: ${c.unreadableReason ?? 'the screen did not say why'}. ${where}${range}`
  return `${c.name} is ${sayValue(c.value)}.${range} ${where}${c.writable ? '' : ` It cannot be changed at the moment: ${c.readonlyReason ?? 'the screen did not say why'}.`}`
}
