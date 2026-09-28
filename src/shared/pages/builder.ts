/**
 * Building a Page without writing code.
 *
 * A built Page is a **description**, not a program: a tree of components, a set of named fields, and a list of
 * computations that read fields and write fields. The runtime renders the tree and runs the computations through the
 * same capability-checked door everything else uses.
 *
 * ## Why that matters more than the convenience
 *
 * A built Page contains no script. Not sandboxed script -- none. There is nowhere in this format to put a statement, a
 * function, or an expression that is not an arithmetic expression handed to the engine that already refuses everything
 * else. So the entire class of problem that `sandbox.ts` exists to contain does not arise for a Page built here, and
 * a Page somebody made by dragging things around is safe in a way an imported Page can never be.
 *
 * That is the real argument for a builder. Being easier is secondary.
 *
 * ## What it cannot do, said plainly
 *
 * A builder can only make what its components can express. There is no escape hatch, no "custom code" block, and adding
 * one would throw away the property above. `BUILDER_ASSUMPTIONS` says so: somebody who needs something these components
 * cannot express needs to write a Page, not fight this.
 *
 * ## The rules
 *
 * - **Every reference resolves, or the Page will not run.** A component bound to a field that does not exist is caught
 *   at build time, not when somebody clicks it.
 * - **Computations cannot form a cycle.** A field computed from itself, directly or through others, is refused.
 * - **A computation declares its operation, and the operation decides the capability.** A builder cannot ask for
 *   something the manifest did not declare.
 * - **Nothing is unbounded.** Components, fields, computations and depth all have ceilings.
 *
 * Pure. No DOM, no clock.
 */

import { checkKind } from './composition.ts'

export const BUILDER_LIMITS = Object.freeze({
  components: 300,
  fields: 200,
  computations: 100,
  /** How deeply components may nest. */
  depth: 12,
  labelLength: 200,
  /** Options in a choice field. */
  options: 200,
  /** Text a component may hold. */
  textLength: 4000
})

export interface BuilderProblem {
  /** Where the problem is, as a path through the document. */
  at: string
  /** `error` stops the Page running; `warning` does not. */
  severity: 'error' | 'warning'
  message: string
  code: string
}

// ---------------------------------------------------------------- fields

export type FieldType = 'number' | 'text' | 'boolean' | 'choice' | 'quantity' | 'table' | 'result'

export interface Field {
  /** A name, used in bindings and in expressions. */
  name: string
  type: FieldType
  label: string
  /** The starting value. Its shape has to match the type. */
  initial?: unknown
  /** For `choice`. */
  options?: readonly { value: string; label: string }[]
  /** For `quantity`. */
  unit?: string
  /** For `number`. */
  minimum?: number
  maximum?: number
  /** True when a computation writes this, in which case a person cannot edit it. */
  computed?: boolean
  /** A sentence explaining what it is, shown beside the control. */
  help?: string
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/i

// ---------------------------------------------------------------- components

export type ComponentKind =
  /** Structure. */
  | 'group'
  | 'row'
  | 'column'
  /** Static content. */
  | 'heading'
  | 'paragraph'
  | 'note'
  | 'divider'
  /** Bound to a field, and editable. */
  | 'number-input'
  | 'text-input'
  | 'checkbox'
  | 'choice'
  | 'slider'
  | 'quantity-input'
  /** Bound to a field, and read-only. */
  | 'value'
  | 'table'
  | 'plot'
  | 'statistic'
  /** Does something. */
  | 'button'

export interface Component {
  id: string
  kind: ComponentKind
  label?: string
  /** The field this reads from and, where it is editable, writes to. */
  field?: string
  /** For a button: which computation it runs. */
  runs?: string
  /** For static content. */
  text?: string
  children?: readonly Component[]
  /** Only shown when this field is true. A name, never an expression. */
  showWhen?: string
  /** A note shown beneath, for things the person should know. */
  help?: string
}

/** Which kinds are bound to a field, and whether they write to it. */
const BINDING: Readonly<Record<string, { needs: boolean; writes: boolean; accepts: readonly FieldType[] }>> = Object.freeze({
  'number-input': { needs: true, writes: true, accepts: ['number'] },
  'text-input': { needs: true, writes: true, accepts: ['text'] },
  checkbox: { needs: true, writes: true, accepts: ['boolean'] },
  choice: { needs: true, writes: true, accepts: ['choice'] },
  slider: { needs: true, writes: true, accepts: ['number'] },
  'quantity-input': { needs: true, writes: true, accepts: ['quantity'] },
  value: { needs: true, writes: false, accepts: ['number', 'text', 'boolean', 'choice', 'quantity', 'result'] },
  table: { needs: true, writes: false, accepts: ['table'] },
  plot: { needs: true, writes: false, accepts: ['result'] },
  statistic: { needs: true, writes: false, accepts: ['number', 'quantity', 'result'] }
})

const CONTAINERS = new Set<ComponentKind>(['group', 'row', 'column'])

// ---------------------------------------------------------------- computations

export interface Computation {
  name: string
  /** The engine operation, like `units.convert`. Decides which capability is needed. */
  operation: string
  /** Each argument's value: a field's name, or a literal. */
  inputs: Readonly<Record<string, { field: string } | { value: unknown }>>
  /** The field the result is written into. */
  writes: string
  /** When it runs. `change` on every edit; `button` only when a button runs it. */
  when: 'change' | 'button'
  describe?: string
}

// ---------------------------------------------------------------- the document

export interface PageDocument {
  fields: readonly Field[]
  components: readonly Component[]
  computations: readonly Computation[]
}

export interface CheckResult {
  problems: readonly BuilderProblem[]
  /** True when nothing is an error. Warnings do not stop a Page running. */
  canRun: boolean
  /** Every operation the document uses, so the manifest can be checked against it. */
  operations: readonly string[]
  /** Fields nothing reads and nothing writes. Not an error, but almost always a mistake. */
  unusedFields: readonly string[]
}

/**
 * A document checked before it can run.
 *
 * Everything here is caught at build time rather than when somebody clicks. A Page that opens and then fails on the
 * first interaction is worse than one that refuses to be saved, because the first kind gets shared.
 */
export function check(document: PageDocument): CheckResult {
  const problems: BuilderProblem[] = []
  const add = (at: string, code: string, message: string, severity: 'error' | 'warning' = 'error'): void => {
    problems.push({ at, code, message, severity })
  }

  // ---- fields
  if (document.fields.length > BUILDER_LIMITS.fields) {
    add('fields', 'too-many-fields', `A Page may have at most ${BUILDER_LIMITS.fields} fields.`)
  }
  const fields = new Map<string, Field>()
  for (const field of document.fields) {
    if (!NAME_PATTERN.test(field.name)) {
      add(`fields.${field.name}`, 'bad-field-name', `"${field.name}" is not a usable name. Use a letter first, then letters, numbers or underscores.`)
      continue
    }
    if (fields.has(field.name)) {
      add(`fields.${field.name}`, 'duplicate-field', `There are two fields called "${field.name}". Names have to be unique, because that is how everything refers to them.`)
      continue
    }
    if ((field.label ?? '').trim() === '') {
      add(`fields.${field.name}`, 'no-label', `The field "${field.name}" has no label, so nobody using it will know what it is for.`, 'warning')
    }
    if (field.type === 'choice') {
      if (!field.options || field.options.length === 0) {
        add(`fields.${field.name}`, 'no-options', `The choice "${field.name}" has nothing to choose from.`)
      } else if (field.options.length > BUILDER_LIMITS.options) {
        add(`fields.${field.name}`, 'too-many-options', `The choice "${field.name}" has more than the ${BUILDER_LIMITS.options} options allowed.`)
      } else {
        const values = new Set<string>()
        for (const option of field.options) {
          if (values.has(option.value)) {
            add(`fields.${field.name}`, 'duplicate-option', `"${field.name}" has two options with the value "${option.value}", and only one of them can ever be chosen.`)
          }
          values.add(option.value)
        }
      }
    }
    if (field.type === 'quantity' && (field.unit ?? '').trim() === '') {
      add(`fields.${field.name}`, 'no-unit', `The quantity "${field.name}" has no unit, which is the only thing that makes it a quantity rather than a number.`)
    }
    if (field.type === 'number' && field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum) {
      add(`fields.${field.name}`, 'bad-range', `The lowest value allowed for "${field.name}" is above the highest.`)
    }
    fields.set(field.name, field)
  }

  // ---- components
  const componentIds = new Set<string>()
  const read = new Set<string>()
  const written = new Set<string>()
  let componentCount = 0

  const walk = (component: Component, path: string, depth: number): void => {
    componentCount += 1
    if (componentCount > BUILDER_LIMITS.components) return
    if (depth > BUILDER_LIMITS.depth) {
      add(path, 'too-deep', `Components are nested more than ${BUILDER_LIMITS.depth} deep here, which is deeper than anybody can follow on a screen.`)
      return
    }
    if (componentIds.has(component.id)) {
      add(path, 'duplicate-component', `There are two components with the id "${component.id}".`)
    }
    componentIds.add(component.id)

    if ((component.text ?? '').length > BUILDER_LIMITS.textLength) {
      add(path, 'text-too-long', 'That is more text than one component should hold.')
    }
    if ((component.label ?? '').length > BUILDER_LIMITS.labelLength) {
      add(path, 'label-too-long', 'That label is too long to read.')
    }

    // `hasOwnProperty`, so a component of kind `constructor` finds nothing on the prototype.
    const binding = Object.prototype.hasOwnProperty.call(BINDING, component.kind) ? BINDING[component.kind] : undefined
    if (binding) {
      if (component.field === undefined) {
        add(path, 'no-field', `This ${component.kind} is not connected to anything, so it has nothing to show.`)
      } else {
        const field = fields.get(component.field)
        if (field === undefined) {
          // Caught here rather than at the moment somebody clicks it.
          add(path, 'unknown-field', `This ${component.kind} is connected to "${component.field}", and there is no field with that name.`)
        } else {
          read.add(field.name)
          if (binding.writes) written.add(field.name)
          if (!binding.accepts.includes(field.type)) {
            add(
              path,
              'wrong-field-type',
              `A ${component.kind} cannot show a ${field.type}. "${field.name}" would need to be ${binding.accepts.join(' or ')}.`
            )
          }
          if (binding.writes && field.computed === true) {
            add(
              path,
              'editing-computed',
              `"${field.name}" is worked out by a computation, so somebody editing it here would have their change overwritten. Show it with a value component instead.`
            )
          }
        }
      }
    } else if (component.field !== undefined) {
      add(path, 'field-ignored', `A ${component.kind} does not show a field, so connecting it to "${component.field}" does nothing.`, 'warning')
    }

    if (component.kind === 'button') {
      if (component.runs === undefined) {
        add(path, 'button-does-nothing', 'This button does not run anything, so pressing it has no effect.')
      }
      if ((component.label ?? '').trim() === '') {
        add(path, 'button-unlabelled', 'This button has no label, so nobody can tell what it does.')
      }
    }

    if (component.showWhen !== undefined) {
      const condition = fields.get(component.showWhen)
      if (condition === undefined) {
        add(path, 'unknown-condition', `This is shown only when "${component.showWhen}" is true, and there is no field with that name.`)
      } else if (condition.type !== 'boolean') {
        add(path, 'condition-not-boolean', `"${component.showWhen}" is a ${condition.type}, and only a true/false field can decide whether something is shown.`)
      } else {
        read.add(condition.name)
      }
    }

    if (CONTAINERS.has(component.kind)) {
      if (!component.children || component.children.length === 0) {
        add(path, 'empty-container', `This ${component.kind} is empty.`, 'warning')
      }
    } else if (component.children && component.children.length > 0) {
      add(path, 'unexpected-children', `A ${component.kind} cannot contain other components.`)
    }

    for (let i = 0; i < (component.children?.length ?? 0); i++) {
      walk((component.children as Component[])[i], `${path}.children[${i}]`, depth + 1)
    }
  }

  for (let i = 0; i < document.components.length; i++) {
    walk(document.components[i], `components[${i}]`, 1)
  }
  if (componentCount > BUILDER_LIMITS.components) {
    add('components', 'too-many-components', `A Page may have at most ${BUILDER_LIMITS.components} components.`)
  }

  // ---- computations
  if (document.computations.length > BUILDER_LIMITS.computations) {
    add('computations', 'too-many-computations', `A Page may have at most ${BUILDER_LIMITS.computations} computations.`)
  }
  const computations = new Map<string, Computation>()
  const operations = new Set<string>()
  for (const computation of document.computations) {
    const path = `computations.${computation.name}`
    if (!NAME_PATTERN.test(computation.name)) {
      add(path, 'bad-computation-name', `"${computation.name}" is not a usable name.`)
      continue
    }
    if (computations.has(computation.name)) {
      add(path, 'duplicate-computation', `There are two computations called "${computation.name}".`)
      continue
    }
    computations.set(computation.name, computation)

    // The same shape as an engine operation name, checked rather than trusted.
    if (checkKind(computation.operation) !== null) {
      add(path, 'bad-operation', `"${computation.operation}" is not shaped like something Orbis can do.`)
    } else {
      operations.add(computation.operation)
    }

    const target = fields.get(computation.writes)
    if (target === undefined) {
      add(path, 'unknown-target', `"${computation.name}" writes to "${computation.writes}", and there is no field with that name.`)
    } else {
      written.add(target.name)
      if (target.computed !== true) {
        add(
          path,
          'target-not-computed',
          `"${computation.writes}" is written by a computation but is not marked as computed, so somebody could edit it and have their change overwritten.`,
          'warning'
        )
      }
    }

    for (const [argument, source] of Object.entries(computation.inputs)) {
      if ('field' in source) {
        if (!fields.has(source.field)) {
          add(`${path}.${argument}`, 'unknown-input', `"${computation.name}" takes "${argument}" from "${source.field}", and there is no field with that name.`)
        } else {
          read.add(source.field)
        }
      }
    }
  }

  // ---- cycles
  //
  // A field computed from itself, directly or through a chain, would recompute forever. Walked depth-first from every
  // computation rather than trusting a topological sort to notice, because the error message wants to name the loop.
  const dependsOn = (name: string): string[] => {
    const computation = computations.get(name)
    if (!computation) return []
    const sources: string[] = []
    for (const source of Object.values(computation.inputs)) {
      if (!('field' in source)) continue
      for (const [otherName, other] of computations) {
        if (other.writes === source.field) sources.push(otherName)
      }
    }
    return sources
  }

  const state = new Map<string, 'visiting' | 'done'>()
  const reported = new Set<string>()
  const visit = (name: string, stack: string[]): void => {
    const current = state.get(name)
    if (current === 'done') return
    if (current === 'visiting') {
      const from = stack.indexOf(name)
      const loop = [...stack.slice(from), name].join(' → ')
      if (!reported.has(loop)) {
        reported.add(loop)
        add(`computations.${name}`, 'cycle', `These computations depend on each other in a circle, so none of them could ever finish: ${loop}.`)
      }
      return
    }
    state.set(name, 'visiting')
    for (const next of dependsOn(name)) visit(next, [...stack, name])
    state.set(name, 'done')
  }
  for (const name of computations.keys()) visit(name, [])

  // ---- buttons pointing at nothing
  const checkButtons = (component: Component, path: string): void => {
    if (component.kind === 'button' && component.runs !== undefined && !computations.has(component.runs)) {
      add(path, 'unknown-computation', `This button runs "${component.runs}", and there is no computation with that name.`)
    }
    for (let i = 0; i < (component.children?.length ?? 0); i++) {
      checkButtons((component.children as Component[])[i], `${path}.children[${i}]`)
    }
  }
  for (let i = 0; i < document.components.length; i++) checkButtons(document.components[i], `components[${i}]`)

  // ---- a computation nothing ever triggers
  const runnable = new Set<string>()
  const collectRuns = (component: Component): void => {
    if (component.runs !== undefined) runnable.add(component.runs)
    for (const child of component.children ?? []) collectRuns(child)
  }
  for (const component of document.components) collectRuns(component)
  for (const [name, computation] of computations) {
    if (computation.when === 'button' && !runnable.has(name)) {
      add(
        `computations.${name}`,
        'never-runs',
        `"${name}" only runs when a button says so, and no button runs it. It will never happen.`,
        'warning'
      )
    }
  }

  const unused = [...fields.keys()].filter((name) => !read.has(name) && !written.has(name))
  for (const name of unused) {
    add(`fields.${name}`, 'unused-field', `Nothing shows or uses "${name}".`, 'warning')
  }

  return {
    problems: Object.freeze(problems),
    canRun: !problems.some((one) => one.severity === 'error'),
    operations: Object.freeze([...operations].sort()),
    unusedFields: Object.freeze(unused)
  }
}

// ---------------------------------------------------------------- running it

export interface RunState {
  values: Readonly<Record<string, unknown>>
}

/** A field's starting value, from its `initial` or from what its type sensibly starts at. */
export function initialState(document: PageDocument): RunState {
  const values: Record<string, unknown> = {}
  for (const field of document.fields) {
    if (!NAME_PATTERN.test(field.name)) continue
    if (field.initial !== undefined) {
      values[field.name] = field.initial
      continue
    }
    switch (field.type) {
      case 'number':
        // The lowest allowed value rather than zero, because a field whose range starts at 10 should not begin outside it.
        values[field.name] = field.minimum ?? 0
        break
      case 'text':
        values[field.name] = ''
        break
      case 'boolean':
        values[field.name] = false
        break
      case 'choice':
        values[field.name] = field.options?.[0]?.value ?? ''
        break
      case 'quantity':
        values[field.name] = { value: 0, unit: field.unit ?? '' }
        break
      case 'table':
        values[field.name] = { headers: [], rows: [] }
        break
      case 'result':
        // Null, not an empty object: nothing has been worked out yet, and an empty result looks like one that came back.
        values[field.name] = null
        break
    }
  }
  return { values: Object.freeze(values) }
}

/** Which computations should run after a field changed. Ordered so a dependency runs before what depends on it. */
export function computationsAfter(document: PageDocument, changed: string): Computation[] {
  const triggered: Computation[] = []
  const byTarget = new Map<string, Computation>()
  for (const computation of document.computations) byTarget.set(computation.writes, computation)

  const seen = new Set<string>()
  const queue = [changed]
  while (queue.length > 0) {
    const field = queue.shift() as string
    for (const computation of document.computations) {
      if (computation.when !== 'change') continue
      if (seen.has(computation.name)) continue
      const reads = Object.values(computation.inputs).some((one) => 'field' in one && one.field === field)
      if (!reads) continue
      seen.add(computation.name)
      triggered.push(computation)
      // Its output may trigger others, so follow the chain. `check` has already refused any cycle.
      queue.push(computation.writes)
    }
  }
  void byTarget
  return triggered
}

/** The arguments for one computation, from the current state. */
export function argumentsFor(computation: Computation, state: RunState): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [argument, source] of Object.entries(computation.inputs)) {
    if (!NAME_PATTERN.test(argument)) continue
    if ('field' in source) {
      out[argument] = Object.prototype.hasOwnProperty.call(state.values, source.field) ? state.values[source.field] : undefined
    } else {
      out[argument] = source.value
    }
  }
  return out
}

/** A field set, with its type respected. Anything of the wrong shape is refused rather than coerced. */
export function setField(document: PageDocument, state: RunState, name: string, value: unknown): RunState | BuilderProblem {
  const field = document.fields.find((one) => one.name === name)
  if (field === undefined) {
    return { at: `fields.${name}`, severity: 'error', code: 'unknown-field', message: `There is no field called "${name}".` }
  }
  const wrong = (expected: string): BuilderProblem => ({
    at: `fields.${name}`,
    severity: 'error',
    code: 'wrong-type',
    message: `"${field.label || name}" holds ${expected}.`
  })

  switch (field.type) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return wrong('a number')
      if (field.minimum !== undefined && value < field.minimum) {
        return { at: `fields.${name}`, severity: 'error', code: 'below-minimum', message: `"${field.label || name}" cannot be below ${field.minimum}.` }
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return { at: `fields.${name}`, severity: 'error', code: 'above-maximum', message: `"${field.label || name}" cannot be above ${field.maximum}.` }
      }
      break
    }
    case 'text':
      if (typeof value !== 'string') return wrong('text')
      if (value.length > BUILDER_LIMITS.textLength) {
        return { at: `fields.${name}`, severity: 'error', code: 'too-long', message: `"${field.label || name}" is longer than allowed.` }
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') return wrong('true or false')
      break
    case 'choice':
      if (typeof value !== 'string') return wrong('one of its options')
      if (!field.options?.some((one) => one.value === value)) {
        return { at: `fields.${name}`, severity: 'error', code: 'not-an-option', message: `"${value}" is not one of the options for "${field.label || name}".` }
      }
      break
    default:
      break
  }

  return { values: Object.freeze({ ...state.values, [name]: value }) }
}

/** What a built Page is, and is not, for the builder's own help panel. */
export const BUILDER_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A Page built here contains no code at all. It is a description of what to show and what to work out, so there is nothing in it that could do something you did not ask for.',
  'That is also its limit: it can only do what these components can express. There is no place to put custom code, and adding one would throw away the guarantee above.',
  'Everything is checked before the Page can run. A component connected to a field that does not exist is a problem you see while building, not one somebody else finds later.',
  'Computations cannot depend on each other in a circle, because nothing in such a circle could ever finish.',
  'A computation can only do things Orbis already knows how to do, and each one still asks for permission the same way.',
  'Warnings do not stop a Page running. Errors do.'
])
