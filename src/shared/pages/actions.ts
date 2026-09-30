/**
 * Driving a Page that is already open: what it can be asked to do, what the request has to say, and what is checked
 * before anything happens.
 *
 * This is not `changes.ts`. That module edits a Page's *spec* — add a chart, change an axis — and produces a new
 * version of the Page. This one operates the Page as it stands: set an input, run a step, sort a table, export a
 * result. The two are different in the way that editing a spreadsheet's formulas differs from typing in a cell, and
 * conflating them is how "sort this by price" ends up rewriting the Page.
 *
 * ## Why an action is data and never code
 *
 * Orion produces a request; the Page runtime performs it. Between them is this module, which turns a sentence into
 * a named action with named arguments and refuses anything that is not one:
 *
 * ```
 * "sort the table by price"
 *      ↓  Orion
 * { action: 'output.sort', target: 'results', arguments: { by: 'price', direction: 'ascending' } }
 *      ↓  checkAction
 * performed by the runtime, against the Page's own declared surface
 * ```
 *
 * Nothing here evaluates anything. There is no path by which a model's output becomes something executed against a
 * Page, which is the only arrangement where a Page's own text cannot talk its way into privileges — text on a Page
 * is data, and an action has to come through this door with a name the Page itself declared.
 *
 * ## Why every action is classified before it is allowed
 *
 * "Read the total" and "delete the dataset" are not the same kind of request and treating them alike gives you
 * either a confirmation prompt on every arithmetic question or a silent deletion. So each action carries what it
 * does to the Page, whether it reaches outside it, whether repeating it is safe, and whether a person should be
 * asked first — and those are properties of the action, decided once, rather than judgements made per request.
 *
 * ## Why targets resolve by name and not by position
 *
 * "The second table" is a phrase about what is on screen, and what is on screen changes. Every target here resolves
 * against something the Page declares — an input name, a step name, an output name — so a request keeps working
 * after the layout moves. Where a person genuinely said "the second one", the caller resolves that to a name first
 * and the ambiguity is visible at that point instead of buried.
 *
 * Pure: no clock, no storage, no runtime, no model. Every function returns a value or an error object; nothing
 * throws.
 */

import type { PageSpec } from './spec.ts'

export interface ActionError {
  error: 'unknown-action' | 'no-target' | 'bad-argument' | 'not-permitted' | 'not-ready' | 'ambiguous'
  message: string
  /** What would make the request work, when there is a single obvious thing. */
  remedy?: string
}

export const isActionError = (value: unknown): value is ActionError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ActionError['error'], message: string, remedy?: string): ActionError =>
  remedy === undefined ? { error, message } : { error, message, remedy }

export const ACTION_LIMITS = Object.freeze({
  arguments: 24,
  argumentTextLength: 4000,
  targetLength: 120,
  selectionRows: 10_000,
  eventsKept: 200
})

// ---------------------------------------------------------------- what an action is

/** What the action does to the Page. The distinction the confirmation rules are built on. */
export type ActionEffect =
  /** Reads Page state and changes nothing. */
  | 'read'
  /** Changes Page state, reversibly, inside the Page. */
  | 'write'
  /** Causes work to happen: a step runs, a simulation advances. */
  | 'compute'
  /** Produces something outside the Page: a file, a note, a task. */
  | 'emit'
  /** Destroys Page state. */
  | 'destroy'

/** Whether repeating an action is safe, which is what a workflow retry needs to know. */
export type RetrySafety =
  /** Doing it twice is the same as doing it once. `setInput` is like this; `increment` is not. */
  | 'idempotent'
  /** Doing it twice does it twice, and that may be wrong but is not dangerous. */
  | 'repeatable'
  /** Never retry without asking. */
  | 'once-only'

export interface ActionDefinition {
  /** `family.verb`, matching the convention operations already use. */
  name: string
  /** What it does, in a sentence, for a person and for a capability listing. */
  summary: string
  effect: ActionEffect
  retry: RetrySafety
  /** What kind of thing it acts on, or null when it acts on the Page as a whole. */
  targets: 'input' | 'step' | 'output' | 'page'
  /** Arguments it takes. A required one missing is a refusal, not a default. */
  arguments: Readonly<Record<string, { kind: 'number' | 'text' | 'boolean' | 'choice' | 'names'; required: boolean; options?: readonly string[] }>>
  /** Whether a person should be asked before it happens. */
  confirm: boolean
}

/**
 * Every action a Page may expose, and what each one is.
 *
 * A closed set, deliberately. An open one — where a Page declares its own action names — means Orion has to be told
 * about them at generation time and a Page can claim an action it does not implement, which is exactly the class of
 * dead control this whole architecture exists to prevent. What varies between Pages is *which* of these apply,
 * which is what `surfaceOf` works out from the Page's own spec.
 */
export const ACTIONS: Readonly<Record<string, ActionDefinition>> = Object.freeze({
  'page.describe': {
    name: 'page.describe',
    summary: 'Say what the Page is for, what it takes and what it produces.',
    effect: 'read',
    retry: 'idempotent',
    targets: 'page',
    arguments: {},
    confirm: false
  },
  'page.state': {
    name: 'page.state',
    summary: 'Read the current value of every input and output.',
    effect: 'read',
    retry: 'idempotent',
    targets: 'page',
    arguments: {},
    confirm: false
  },
  'page.reset': {
    name: 'page.reset',
    summary: 'Put every input back to its starting value and clear the results.',
    effect: 'destroy',
    retry: 'idempotent',
    targets: 'page',
    arguments: {},
    // Resetting is idempotent and still destroys whatever was typed in, which is often work.
    confirm: true
  },
  'input.set': {
    name: 'input.set',
    summary: 'Give an input a value.',
    effect: 'write',
    retry: 'idempotent',
    targets: 'input',
    arguments: { value: { kind: 'text', required: true } },
    confirm: false
  },
  'input.read': {
    name: 'input.read',
    summary: 'Read what an input currently holds.',
    effect: 'read',
    retry: 'idempotent',
    targets: 'input',
    arguments: {},
    confirm: false
  },
  'step.run': {
    name: 'step.run',
    summary: 'Run one calculation and wait for it.',
    effect: 'compute',
    retry: 'idempotent',
    targets: 'step',
    arguments: {},
    confirm: false
  },
  'step.cancel': {
    name: 'step.cancel',
    summary: 'Stop a calculation that is running.',
    effect: 'write',
    retry: 'idempotent',
    targets: 'step',
    arguments: {},
    confirm: false
  },
  'output.read': {
    name: 'output.read',
    summary: 'Read a result the Page has computed.',
    effect: 'read',
    retry: 'idempotent',
    targets: 'output',
    arguments: {},
    confirm: false
  },
  'output.sort': {
    name: 'output.sort',
    summary: 'Sort a table by one of its columns.',
    effect: 'write',
    retry: 'idempotent',
    targets: 'output',
    arguments: {
      by: { kind: 'text', required: true },
      direction: { kind: 'choice', required: false, options: ['ascending', 'descending'] }
    },
    confirm: false
  },
  'output.filter': {
    name: 'output.filter',
    summary: 'Show only the rows of a table matching a condition.',
    effect: 'write',
    retry: 'idempotent',
    targets: 'output',
    arguments: {
      column: { kind: 'text', required: true },
      comparison: {
        kind: 'choice',
        required: true,
        options: ['equals', 'not-equals', 'above', 'below', 'at-least', 'at-most', 'contains']
      },
      value: { kind: 'text', required: true }
    },
    confirm: false
  },
  'output.clear-filters': {
    name: 'output.clear-filters',
    summary: 'Show every row again.',
    effect: 'write',
    retry: 'idempotent',
    targets: 'output',
    arguments: {},
    confirm: false
  },
  'output.export': {
    name: 'output.export',
    summary: 'Write a result out as a file.',
    effect: 'emit',
    // A second export writes a second file, which is not dangerous and is not the same as doing it once.
    retry: 'repeatable',
    targets: 'output',
    arguments: {
      format: { kind: 'choice', required: true, options: ['csv', 'json', 'markdown'] }
    },
    confirm: true
  },
  'output.to-note': {
    name: 'output.to-note',
    summary: 'Save a result into Notes.',
    effect: 'emit',
    retry: 'repeatable',
    targets: 'output',
    arguments: {},
    confirm: true
  }
})

export const ACTION_NAMES: readonly string[] = Object.freeze(Object.keys(ACTIONS).sort())

/** An action that only reads needs no confirmation and can always be retried. Checked by a test, not assumed. */
export const isReadOnly = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(ACTIONS, name) && ACTIONS[name].effect === 'read'

// ---------------------------------------------------------------- what a given Page exposes

export interface PageSurface {
  /** Actions this Page can actually perform, given what it contains. */
  actions: readonly string[]
  /** The names a target may take, by kind. */
  inputs: readonly string[]
  steps: readonly string[]
  outputs: readonly string[]
  /** Outputs that are tables, since sorting and filtering only mean anything for those. */
  tables: readonly string[]
  /** Steps that wait to be asked, which are the ones `step.run` is for. */
  manualSteps: readonly string[]
}

/**
 * What a Page can be asked to do, worked out from its own spec.
 *
 * This is the answer to "what can I do with this Page?" and it is derived rather than declared, so a Page cannot
 * offer an action it has no way to perform. A Page with no table does not offer sorting. A Page whose every step
 * recomputes as you type does not offer `step.run`, because there is nothing to press.
 */
export function surfaceOf(spec: PageSpec): PageSurface {
  const inputs = spec.inputs.map((one) => one.name)
  const steps = spec.steps.map((one) => one.name)
  const outputs = spec.outputs.map((one) => one.name)
  const tables = spec.outputs.filter((one) => one.display === 'table').map((one) => one.name)
  const manualSteps = spec.steps.filter((one) => one.when === 'button').map((one) => one.name)

  const actions: string[] = ['page.describe', 'page.state']
  if (inputs.length > 0) {
    actions.push('input.set', 'input.read', 'page.reset')
  }
  if (manualSteps.length > 0) {
    actions.push('step.run', 'step.cancel')
  }
  if (outputs.length > 0) {
    actions.push('output.read', 'output.export', 'output.to-note')
  }
  if (tables.length > 0) {
    actions.push('output.sort', 'output.filter', 'output.clear-filters')
  }

  return {
    actions: Object.freeze(actions.sort()),
    inputs: Object.freeze(inputs),
    steps: Object.freeze(steps),
    outputs: Object.freeze(outputs),
    tables: Object.freeze(tables),
    manualSteps: Object.freeze(manualSteps)
  }
}

/**
 * Whether a Page supports something, answered from its real surface.
 *
 * The function behind "can this Page do X?". It says no when the answer is no, which is the whole value: an
 * assistant that says yes to everything is worse than one that cannot be asked.
 */
export function supports(spec: PageSpec, action: string): { supported: boolean; why: string } {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    return { supported: false, why: `There is no action called "${action}".` }
  }
  const surface = surfaceOf(spec)
  if (surface.actions.includes(action)) {
    return { supported: true, why: ACTIONS[action].summary }
  }
  const definition = ACTIONS[action]
  const reason =
    definition.targets === 'input'
      ? 'this Page has no inputs'
      : definition.targets === 'step'
        ? 'this Page has nothing that waits to be run — everything recomputes as values change'
        : definition.targets === 'output'
          ? action === 'output.sort' || action === 'output.filter' || action === 'output.clear-filters'
            ? 'this Page shows no tables, and sorting or filtering only mean something for a table'
            : 'this Page produces no results'
          : 'this Page does not support it'
  return { supported: false, why: `No: ${reason}.` }
}

// ---------------------------------------------------------------- context

export type SelectionKind = 'cell' | 'row' | 'column' | 'output' | 'input' | 'step' | 'none'

/**
 * What the person has selected on the Page.
 *
 * Supplied by the runtime, because only the runtime knows. It is the reason "explain this" can mean something: the
 * word "this" resolves against a selection, and where there is none the request is genuinely ambiguous and saying so
 * beats picking something.
 */
export interface Selection {
  kind: SelectionKind
  /** The output, input or step the selection is in. */
  owner: string | null
  /** For a cell or column, the column name. */
  column?: string
  /** For a cell or row, the row index. */
  row?: number
}

export const nothingSelected: Selection = Object.freeze({ kind: 'none', owner: null })

export interface PageContext {
  pageId: string
  title: string
  surface: PageSurface
  selection: Selection
  /** Names of steps currently running, so an action can be refused as not-ready rather than queued behind them. */
  running: readonly string[]
  /** Whether the last run produced an error, which changes what advice is useful. */
  failing: boolean
}

/**
 * What "this" refers to, in priority order.
 *
 * Narrowest first: a selected cell beats the row it is in, the row beats the table, the table beats the Page. That
 * ordering is what makes "explain this" and "sort this" both do the obvious thing from the same selection, and it
 * is spelled out here rather than left to each caller, because callers that each guess produce an assistant whose
 * behaviour depends on which code path asked.
 */
export function resolveThis(context: PageContext): { target: string; kind: SelectionKind; note: string } | ActionError {
  const { selection } = context
  if (selection.kind === 'none' || selection.owner === null) {
    if (context.surface.outputs.length === 1) {
      return {
        target: context.surface.outputs[0],
        kind: 'output',
        note: `Nothing is selected, and this Page has one result, so "this" is taken to mean ${context.surface.outputs[0]}.`
      }
    }
    return fail(
      'ambiguous',
      'Nothing is selected, so there is no way to tell what "this" means.',
      context.surface.outputs.length > 1
        ? `Name one of: ${context.surface.outputs.join(', ')}.`
        : 'Select something on the Page first.'
    )
  }
  const note =
    selection.kind === 'cell'
      ? `the cell in ${selection.owner}${selection.column === undefined ? '' : `, column ${selection.column}`}${selection.row === undefined ? '' : `, row ${selection.row + 1}`}`
      : selection.kind === 'row'
        ? `row ${(selection.row ?? 0) + 1} of ${selection.owner}`
        : selection.kind === 'column'
          ? `the ${selection.column ?? 'selected'} column of ${selection.owner}`
          : `${selection.owner}`
  return { target: selection.owner, kind: selection.kind, note: `"this" means ${note}.` }
}

// ---------------------------------------------------------------- requests

export interface ActionRequest {
  action: string
  /** An input, step or output name, or null for a Page-wide action. */
  target: string | null
  arguments: Readonly<Record<string, unknown>>
}

export interface CheckedAction {
  request: ActionRequest
  definition: ActionDefinition
  /** Arguments with defaults filled in and every value of the declared kind. */
  arguments: Readonly<Record<string, string | number | boolean | readonly string[]>>
  /** Whether a person has to be asked before this runs. */
  needsConfirmation: boolean
  /** A sentence describing what will happen, for that confirmation. */
  describes: string
}

const asText = (value: unknown): string | null =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : null

/**
 * Check a request against the Page, and fill in what it left out.
 *
 * Everything that could be wrong is wrong here, before anything runs: an action the Page does not have, a target
 * that is not a thing, an argument of the wrong kind, a required argument missing, a table operation on something
 * that is not a table. What comes back is either a refusal that says what to do instead, or a request that the
 * runtime can perform without checking anything again.
 */
export function checkAction(
  spec: PageSpec,
  context: PageContext,
  request: ActionRequest
): CheckedAction | ActionError {
  if (typeof request.action !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, request.action)) {
    return fail(
      'unknown-action',
      `There is no action called "${String(request.action)}".`,
      `This Page can do: ${context.surface.actions.join(', ')}.`
    )
  }
  const definition = ACTIONS[request.action]
  const surface = context.surface
  if (!surface.actions.includes(definition.name)) {
    return fail('not-permitted', supports(spec, definition.name).why, `This Page can do: ${surface.actions.join(', ')}.`)
  }

  // ---- the target
  let target: string | null = null
  if (definition.targets === 'page') {
    if (request.target !== null && request.target !== undefined && request.target !== '') {
      return fail(
        'bad-argument',
        `${definition.name} acts on the whole Page, so it takes no target, and "${String(request.target)}" was given as one.`
      )
    }
  } else {
    const named = asText(request.target)
    if (named === null || named === '') {
      const choices =
        definition.targets === 'input' ? surface.inputs : definition.targets === 'step' ? surface.steps : surface.outputs
      return fail(
        'no-target',
        `${definition.name} needs to be told which ${definition.targets} to act on.`,
        `Name one of: ${choices.join(', ')}.`
      )
    }
    if (named.length > ACTION_LIMITS.targetLength) {
      return fail('bad-argument', 'That target name is too long to be one.')
    }
    const pool =
      definition.targets === 'input' ? surface.inputs : definition.targets === 'step' ? surface.steps : surface.outputs
    if (!pool.includes(named)) {
      return fail(
        'no-target',
        `This Page has no ${definition.targets} called "${named}".`,
        pool.length === 0 ? undefined : `It has: ${pool.join(', ')}.`
      )
    }
    // Sorting or filtering something that is not a table is a category error, not a missing feature.
    if (
      (definition.name === 'output.sort' ||
        definition.name === 'output.filter' ||
        definition.name === 'output.clear-filters') &&
      !surface.tables.includes(named)
    ) {
      return fail(
        'not-permitted',
        `"${named}" is not a table, and ${definition.name.split('.')[1]} only means something for a table.`,
        surface.tables.length === 0 ? undefined : `The tables here are: ${surface.tables.join(', ')}.`
      )
    }
    if (definition.name === 'step.run' && !surface.manualSteps.includes(named)) {
      return fail(
        'not-permitted',
        `"${named}" recomputes on its own whenever its inputs change, so there is nothing to run.`,
        surface.manualSteps.length === 0 ? undefined : `The steps that wait to be run are: ${surface.manualSteps.join(', ')}.`
      )
    }
    if (definition.name === 'step.cancel' && !context.running.includes(named)) {
      return fail('not-ready', `"${named}" is not running, so there is nothing to cancel.`)
    }
    if (definition.effect === 'compute' && context.running.includes(named)) {
      return fail(
        'not-ready',
        `"${named}" is already running.`,
        'Wait for it to finish, or cancel it first.'
      )
    }
    target = named
  }

  // ---- the arguments
  const given = request.arguments ?? {}
  const keys = Object.keys(given)
  if (keys.length > ACTION_LIMITS.arguments) {
    return fail('bad-argument', `An action takes at most ${ACTION_LIMITS.arguments} arguments.`)
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(definition.arguments, key)) {
      const allowed = Object.keys(definition.arguments)
      return fail(
        'bad-argument',
        `${definition.name} does not take "${key}".`,
        allowed.length === 0 ? 'It takes no arguments.' : `It takes: ${allowed.join(', ')}.`
      )
    }
  }

  const checked: Record<string, string | number | boolean | readonly string[]> = Object.create(null)
  for (const [name, shape] of Object.entries(definition.arguments)) {
    const has = Object.prototype.hasOwnProperty.call(given, name)
    if (!has) {
      if (shape.required) {
        return fail('bad-argument', `${definition.name} needs "${name}", and it was not given one.`)
      }
      // An optional choice defaults to its first option, which is stated in the definition rather than guessed.
      if (shape.kind === 'choice' && shape.options !== undefined && shape.options.length > 0) {
        checked[name] = shape.options[0]
      }
      continue
    }
    const raw = given[name]
    switch (shape.kind) {
      case 'number': {
        const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN
        if (!Number.isFinite(value)) return fail('bad-argument', `"${name}" has to be a number.`)
        checked[name] = value
        break
      }
      case 'boolean': {
        if (typeof raw !== 'boolean') return fail('bad-argument', `"${name}" has to be true or false.`)
        checked[name] = raw
        break
      }
      case 'choice': {
        const value = asText(raw)
        if (value === null) return fail('bad-argument', `"${name}" has to be text.`)
        if (shape.options !== undefined && !shape.options.includes(value)) {
          return fail('bad-argument', `"${value}" is not one of: ${shape.options.join(', ')}.`)
        }
        checked[name] = value
        break
      }
      case 'names': {
        if (!Array.isArray(raw)) return fail('bad-argument', `"${name}" has to be a list of names.`)
        const names = raw.map((one) => asText(one))
        if (names.some((one) => one === null)) return fail('bad-argument', `"${name}" holds something that is not a name.`)
        checked[name] = Object.freeze(names as string[])
        break
      }
      default: {
        const value = asText(raw)
        if (value === null) return fail('bad-argument', `"${name}" has to be text.`)
        if (value.length > ACTION_LIMITS.argumentTextLength) {
          return fail('bad-argument', `"${name}" is longer than the ${ACTION_LIMITS.argumentTextLength} characters allowed.`)
        }
        checked[name] = value
        break
      }
    }
  }

  // A column named in a sort or filter has to be a column, and this module cannot know the columns — the runtime
  // does, from the data. So it is passed through and the runtime refuses it, which is recorded here so nobody
  // assumes it was checked.
  const describes = describeAction(definition, target, checked)

  return {
    request: { action: definition.name, target, arguments: Object.freeze({ ...given }) },
    definition,
    arguments: Object.freeze(checked),
    needsConfirmation: definition.confirm,
    describes
  }
}

/** What will happen, in a sentence, for a confirmation prompt and for an action log. */
export function describeAction(
  definition: ActionDefinition,
  target: string | null,
  args: Readonly<Record<string, unknown>>
): string {
  const on = target === null ? '' : ` on ${target}`
  switch (definition.name) {
    case 'input.set':
      return `Set ${String(target)} to ${String(args.value)}.`
    case 'output.sort':
      return `Sort ${String(target)} by ${String(args.by)}, ${String(args.direction ?? 'ascending')}.`
    case 'output.filter':
      return `Show only rows of ${String(target)} where ${String(args.column)} ${String(args.comparison)} ${String(args.value)}.`
    case 'output.export':
      return `Write ${String(target)} out as a ${String(args.format)} file.`
    case 'output.to-note':
      return `Save ${String(target)} into Notes.`
    case 'page.reset':
      return 'Put every input back to its starting value and clear the results. Anything typed in will be lost.'
    case 'step.run':
      return `Run ${String(target)} and wait for it.`
    case 'step.cancel':
      return `Stop ${String(target)}.`
    default:
      return `${definition.summary.replace(/\.$/, '')}${on}.`
  }
}

/**
 * Whether a workflow may retry an action on its own after a failure.
 *
 * Idempotent actions may. Repeatable ones may not without asking, because a retried export writes a second file and
 * a retried note makes a second note — neither is dangerous and both are wrong. Once-only actions never may.
 */
export const mayRetry = (definition: ActionDefinition): boolean => definition.retry === 'idempotent'

// ---------------------------------------------------------------- events

export type PageEventKind =
  | 'page.opened'
  | 'page.closed'
  | 'input.changed'
  | 'step.started'
  | 'step.finished'
  | 'step.failed'
  | 'output.changed'
  | 'export.finished'
  | 'selection.changed'

export interface PageEvent {
  kind: PageEventKind
  pageId: string
  /** The input, step or output it is about, where it is about one. */
  subject: string | null
  /** Plain data only. Never a value that could carry behaviour across the boundary. */
  detail: Readonly<Record<string, string | number | boolean | null>>
}

/**
 * Which events are worth waking a consumer for, and which are noise.
 *
 * A Page emits an event on every keystroke. Handing all of them to a model is expensive and, worse, drowns the ones
 * that matter, so the filter is explicit: a workflow waiting on a calculation wants `step.finished`, and Orion
 * answering a question wants what changed since it last looked. The default is the quiet set — the events that mean
 * something finished or something broke — because a default that includes keystrokes is a default nobody notices
 * until the bill arrives.
 */
export const NOISY_EVENTS: readonly PageEventKind[] = Object.freeze(['input.changed', 'selection.changed'])

export const QUIET_EVENTS: readonly PageEventKind[] = Object.freeze(
  (
    [
      'page.opened',
      'page.closed',
      'step.started',
      'step.finished',
      'step.failed',
      'output.changed',
      'export.finished'
    ] as PageEventKind[]
  ).slice()
)

export interface EventFilter {
  /** Which kinds to pass. */
  kinds: readonly PageEventKind[]
  /** Only events about these subjects, or empty for any. */
  subjects: readonly string[]
  /** Only events from this Page. An empty string means any, which a Page-scoped consumer should never use. */
  pageId: string
}

/**
 * Filter a stream of events.
 *
 * Scoped by Page as well as by kind, because a consumer subscribed to "step.finished" across every open Page gets
 * another Page's results and cannot tell. Every filter therefore names a Page, and the one case where it does not
 * has to say so explicitly.
 */
export function filterEvents(events: readonly PageEvent[], filter: EventFilter): PageEvent[] {
  const kinds = new Set(filter.kinds)
  const subjects = new Set(filter.subjects)
  return events
    .filter((one) => (filter.pageId === '' ? true : one.pageId === filter.pageId))
    .filter((one) => kinds.has(one.kind))
    .filter((one) => subjects.size === 0 || (one.subject !== null && subjects.has(one.subject)))
    .slice(-ACTION_LIMITS.eventsKept)
}

/** A filter for a workflow waiting on one step of one Page. The common case, so it is not hand-assembled. */
export const waitingFor = (pageId: string, step: string): EventFilter =>
  Object.freeze({
    kinds: Object.freeze(['step.finished', 'step.failed'] as PageEventKind[]),
    subjects: Object.freeze([step]),
    pageId
  })

// ---------------------------------------------------------------- what Orion is told

export interface ContextForModel {
  pageId: string
  title: string
  purpose: string
  /** What can be asked for, with a sentence each. Not the definitions; the subset this Page has. */
  actions: readonly { name: string; summary: string; confirm: boolean }[]
  inputs: readonly { name: string; label: string; kind: string }[]
  outputs: readonly { name: string; label: string; display: string }[]
  steps: readonly { name: string; waits: boolean }[]
  selection: string
  running: readonly string[]
  /** What the Page says it does not do, which is the part a model is most likely to get wrong. */
  limits: readonly string[]
}

/**
 * The Page, as much of it as a model needs and no more.
 *
 * Deliberately not the whole state. Sending everything is expensive, leaks whatever the person typed into a Page
 * that was never meant to leave the machine, and makes answers worse rather than better — a model given four
 * hundred rows of data and a question about the Page's structure spends its attention on the rows. So this carries
 * the Page's shape, its declared limits and what is selected, and the *values* stay on the Page until something
 * asks for one by name through `output.read`.
 */
export function contextForModel(spec: PageSpec, context: PageContext): ContextForModel {
  const selection = resolveThis(context)
  return {
    pageId: context.pageId,
    title: spec.title,
    purpose: spec.purpose,
    actions: Object.freeze(
      context.surface.actions.map((name) => ({
        name,
        summary: ACTIONS[name].summary,
        confirm: ACTIONS[name].confirm
      }))
    ),
    inputs: Object.freeze(spec.inputs.map((one) => ({ name: one.name, label: one.label, kind: one.kind }))),
    outputs: Object.freeze(spec.outputs.map((one) => ({ name: one.name, label: one.label, display: one.display }))),
    steps: Object.freeze(spec.steps.map((one) => ({ name: one.name, waits: one.when === 'button' }))),
    selection: isActionError(selection) ? 'nothing is selected' : selection.note,
    running: Object.freeze([...context.running]),
    limits: Object.freeze([...spec.notes])
  }
}

/** Whether any value from the Page's own data would be sent. Checked by a test, so the claim above stays true. */
export const carriesPageData = (sent: ContextForModel): boolean =>
  JSON.stringify(sent).includes('"rows"') || JSON.stringify(sent).includes('"values"')

export const ACTION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Actions operate a Page as it stands. Editing what a Page *is* belongs to changes.ts, and conflating the two is how "sort by price" ends up rewriting the Page.',
  'Nothing here evaluates anything. A model produces a named action with named arguments, and there is no path by which its output becomes code run against a Page.',
  'The set of actions is closed. A Page choosing its own action names would let it claim an action it does not implement, which is the dead-control problem this prevents.',
  'What a Page offers is derived from its own spec, so a Page with no table does not offer sorting and a Page whose steps all recompute does not offer a run button.',
  'Every action states what it does to the Page, whether it reaches outside, whether repeating it is safe and whether to ask first — decided once per action rather than judged per request.',
  'Sorting something that is not a table is refused as a category error rather than treated as a missing feature.',
  'A retry is automatic only for idempotent actions. A retried export writes a second file, which is not dangerous and is not the same as doing it once.',
  'Targets resolve against names the Page declares, never positions, so a request survives the layout moving.',
  '"This" resolves narrowest-first — cell, row, table, Page — in one place, so the behaviour cannot depend on which caller asked.',
  'With nothing selected and more than one result, "this" is refused as ambiguous rather than guessed.',
  'Event filters name a Page. A consumer subscribed across every open Page receives another Page\'s results and cannot tell.',
  'The default event set excludes keystrokes, because a default that includes them is one nobody notices until the cost shows up.',
  'A model is sent the Page\'s shape, limits and selection — not its values. Values stay on the Page until something asks for one by name.'
])
