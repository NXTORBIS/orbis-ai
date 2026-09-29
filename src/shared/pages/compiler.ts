/**
 * Turning a checked PageSpec into a Page that can actually run.
 *
 * The output is two things that already existed before generation did: a `PageDocument` from `builder.ts`, which the
 * runtime knows how to render and step, and a `PageManifest` from `manifest.ts`, which the registry knows how to
 * validate and the permission layer knows how to read. Nothing here invents a new runtime. A generated Page is the
 * same kind of object as a Page somebody built by hand, and that is the most important property in this file: there
 * is no second code path with weaker checks that only generated Pages go down.
 *
 * ## Capabilities are derived, never declared
 *
 * The manifest's capability list is computed from the operations the spec uses, through the same table the compute
 * service enforces at call time. The spec has no field to put a capability in, the compiler has no parameter that
 * adds one from outside, and the two ends therefore cannot disagree: whatever the Page can call is exactly what it
 * asked for, and whatever it asked for is exactly what it can call.
 *
 * The one exception is stated rather than hidden. `storage.page` lets a Page remember what was typed into it, and no
 * operation implies it, so it cannot be derived. It is a compiler *option*, decided by the application, never by the
 * spec -- which means a model cannot obtain it by writing anything at all.
 *
 * ## Compiling is checked twice, on purpose
 *
 * `compile` refuses a spec that `checkSpec` would refuse, and then checks the document it produced with
 * `builder.check` before returning it. The second check is not redundant. It is the test that the compiler itself is
 * correct: a bug here that produced a document referring to a field it never created would otherwise become a Page
 * that opens and then fails when somebody types in it, and a Page that fails after opening is one that gets shared.
 */

import { check, type Component, type Computation, type Field, type PageDocument } from './builder.ts'
import { slugify, uniqueSlug, type PageOwner, type PageVersion } from './identity.ts'
import { LIMITS, MANIFEST_SCHEMA_VERSION, PAGE_RUNTIME_VERSION, validateManifest, type PageManifest } from './manifest.ts'
import { checkSpec, type OperationSignature, type PageSpec, type SpecProblem } from './spec.ts'

export interface CompileError {
  error: 'spec-rejected' | 'document-rejected' | 'manifest-rejected' | 'unknown-capability'
  message: string
  /** Everything wrong, so a screen can list it rather than reveal one problem at a time. */
  problems: readonly SpecProblem[]
}

export const isCompileError = (value: unknown): value is CompileError =>
  typeof value === 'object' && value !== null && 'error' in value

export interface CompileOptions {
  /** Operation name to the capability it needs. The same table the compute service enforces. */
  operations: Readonly<Record<string, string>>
  /**
   * What each operation takes, where it is known.
   *
   * Passed straight to `checkSpec`, so a step calling an operation with an argument it does not have never reaches a
   * document. Absent in a test that only cares about the shape of what is produced.
   */
  signatures?: Readonly<Record<string, OperationSignature>>
  /** A fresh, opaque page id. Generated outside so this file stays pure and a test can pin it. */
  pageId: string
  /** Slugs already taken, so the new one does not collide. */
  taken?: Iterable<string>
  /**
   * Whether the Page may remember what was typed into it between openings.
   *
   * Decided by the application and never by the spec. See the note at the top of this file about why this is the one
   * capability that is not derived, and why it is a parameter rather than a field.
   */
  allowStorage?: boolean
  /** `orion` for a Page a model wrote, which is the normal case here. */
  owner?: PageOwner
}

export interface Compiled {
  manifest: PageManifest
  document: PageDocument
  /** The spec as it was compiled, normalised. Kept so a later version can be a diff against it rather than a guess. */
  spec: PageSpec
  /** Problems that did not stop the compile. Shown to whoever is about to publish it. */
  warnings: readonly SpecProblem[]
}

/** The field a step's result is written into. Prefixed so it cannot collide with an input, which the spec also forbids. */
export const resultFieldFor = (stepName: string): string => `result_${stepName}`

/** A component id, derived from what it shows so the same spec always compiles to the same document. */
const componentId = (prefix: string, name: string): string => `${prefix}_${name}`

/**
 * The icon for a generated Page.
 *
 * One word, from what the Page computes rather than from its title, because a title is something a model wrote and an
 * operation family is something Orbis defined. A Page whose steps span families gets the neutral one.
 */
export function iconFor(operations: readonly string[]): string {
  const families = new Set(operations.map((one) => one.slice(0, one.indexOf('.'))))
  if (families.size !== 1) return 'square-function'
  const family = [...families][0]
  const known: Readonly<Record<string, string>> = {
    units: 'ruler',
    statistics: 'chart-bar',
    matrix: 'grid-3x3',
    algebra: 'sigma',
    calculus: 'infinity',
    geometry: 'shapes',
    finance: 'banknote',
    motion: 'target',
    mechanics: 'move',
    oscillator: 'activity',
    collision: 'zap',
    gravity: 'orbit',
    rotation: 'rotate-cw',
    wave: 'audio-waveform',
    signal: 'audio-waveform',
    table: 'table',
    plot: 'line-chart',
    date: 'calendar',
    text: 'type'
  }
  return Object.prototype.hasOwnProperty.call(known, family) ? known[family] : 'square-function'
}

/**
 * The categories a generated Page is filed under.
 *
 * Derived from the operation families, and always including `generated` — which is not decoration. It is how the
 * library, the search index and the export scanner can all tell, without reading anything else, that nobody reviewed
 * this Page. Removing it would make a generated Page indistinguishable from one somebody wrote.
 */
export function categoriesFor(operations: readonly string[]): string[] {
  const families = [...new Set(operations.map((one) => one.slice(0, one.indexOf('.'))))].sort()
  const out = ['generated', ...families.map((one) => `generated.${one}`)]
  return out.slice(0, LIMITS.categories)
}

/** What every generated Page says about itself, whatever it computes. */
export const GENERATED_LIMITATIONS: readonly string[] = Object.freeze([
  'This Page was generated from a description rather than written by hand, and nobody has reviewed it.',
  'Every number it shows came from an Orbis calculation, not from a model. What a model chose was which calculation to use and what to call it.',
  'It works offline and reaches nothing outside Orbis. It cannot read your files, your accounts or any other Page.'
])

function buildFields(spec: PageSpec): Field[] {
  const fields: Field[] = []
  for (const input of spec.inputs) {
    const field: Field = {
      name: input.name,
      type: input.kind,
      label: input.label
    }
    if (input.initial !== undefined) (field as { initial?: unknown }).initial = input.initial
    if (input.options !== undefined) (field as { options?: readonly { value: string; label: string }[] }).options = input.options
    if (input.unit !== undefined) (field as { unit?: string }).unit = input.unit
    if (input.minimum !== undefined) (field as { minimum?: number }).minimum = input.minimum
    if (input.maximum !== undefined) (field as { maximum?: number }).maximum = input.maximum
    if (input.help !== undefined) (field as { help?: string }).help = input.help
    fields.push(field)
  }
  for (const step of spec.steps) {
    fields.push({
      name: resultFieldFor(step.name),
      type: 'result',
      label: step.describe ?? step.name,
      computed: true
    })
  }
  return fields
}

function buildComputations(spec: PageSpec): Computation[] {
  return spec.steps.map((step) => {
    const inputs: Record<string, { field: string; pick?: string } | { value: unknown }> = {}
    for (const [argument, source] of Object.entries(step.arguments)) {
      if ('input' in source) inputs[argument] = { field: source.input }
      else if ('step' in source) {
        inputs[argument] =
          source.pick === undefined ? { field: resultFieldFor(source.step) } : { field: resultFieldFor(source.step), pick: source.pick }
      } else inputs[argument] = { value: source.value }
    }
    const computation: Computation = {
      name: step.name,
      operation: step.operation,
      inputs,
      writes: resultFieldFor(step.name),
      when: step.when
    }
    if (step.describe !== undefined) (computation as { describe?: string }).describe = step.describe
    return computation
  })
}

/** The component that shows one input, chosen from its kind. */
function inputComponent(spec: PageSpec, name: string): Component | null {
  const input = spec.inputs.find((one) => one.name === name)
  if (input === undefined) return null
  const kind =
    input.kind === 'number'
      ? // A slider needs both ends to mean anything; without them it is a box with a number in it.
        input.minimum !== undefined && input.maximum !== undefined
        ? 'slider'
        : 'number-input'
      : input.kind === 'text'
        ? 'text-input'
        : input.kind === 'boolean'
          ? 'checkbox'
          : input.kind === 'choice'
            ? 'choice'
            : 'quantity-input'
  const component: Component = { id: componentId('in', name), kind, label: input.label, field: name }
  if (input.help !== undefined) (component as { help?: string }).help = input.help
  return component
}

/** The component that shows one output. */
function outputComponent(spec: PageSpec, name: string): Component | null {
  const output = spec.outputs.find((one) => one.name === name)
  if (output === undefined) return null
  const component: Component = {
    id: componentId('out', name),
    kind: output.display,
    label: output.label,
    field: resultFieldFor(output.step)
  }
  if (output.pick !== undefined) (component as { pick?: string }).pick = output.pick
  if (output.help !== undefined) (component as { help?: string }).help = output.help
  return component
}

function buildComponents(spec: PageSpec): Component[] {
  const buttonSteps = spec.steps.filter((one) => one.when === 'button')
  const inputNames = new Set(spec.inputs.map((one) => one.name))

  // Buttons go at the end of the last section that holds an input, which is where somebody's hand already is after
  // filling the form in. If no section holds an input -- a Page of constants -- they go at the end of the first.
  let buttonSection = -1
  for (let i = 0; i < spec.sections.length; i++) {
    if (spec.sections[i].members.some((member) => inputNames.has(member))) buttonSection = i
  }
  if (buttonSection === -1 && spec.sections.length > 0) buttonSection = 0

  const sections: Component[] = []
  for (let i = 0; i < spec.sections.length; i++) {
    const section = spec.sections[i]
    const children: Component[] = []
    if (section.text !== undefined) {
      children.push({ id: componentId('text', String(i)), kind: 'paragraph', text: section.text })
    }
    for (const member of section.members) {
      const component = inputComponent(spec, member) ?? outputComponent(spec, member)
      // `checkSpec` established that every member is one or the other, so a null here is a compiler bug rather than a
      // bad spec, and it is better for the document check below to name it than for this to skip it quietly.
      if (component !== null) children.push(component)
    }
    if (i === buttonSection) {
      for (const step of buttonSteps) {
        children.push({
          id: componentId('run', step.name),
          kind: 'button',
          label: step.describe ?? `Work out ${step.name}`,
          runs: step.name
        })
      }
    }
    sections.push({
      id: componentId('section', String(i)),
      kind: 'group',
      label: section.title,
      children
    })
  }
  return sections
}

/**
 * The capabilities a spec's operations require.
 *
 * An operation missing from the table is a compile failure rather than a skipped capability, which is the direction
 * that fails safe: the alternative would be a Page that calls something it never asked permission for and is refused
 * at run time, on the first click, in front of somebody.
 */
export function capabilitiesFor(
  operations: readonly string[],
  table: Readonly<Record<string, string>>
): { capabilities: string[] } | { missing: string } {
  const needed = new Set<string>()
  for (const operation of operations) {
    if (!Object.prototype.hasOwnProperty.call(table, operation)) return { missing: operation }
    needed.add(table[operation])
  }
  return { capabilities: [...needed].sort() }
}

export function compile(raw: unknown, options: CompileOptions): Compiled | CompileError {
  const checked = checkSpec(raw, options.operations, options.signatures ?? {})
  if (!checked.usable || checked.normalised === null) {
    return {
      error: 'spec-rejected',
      message: 'This description could not be turned into a Page.',
      problems: checked.problems.filter((one) => one.severity === 'error')
    }
  }
  // The normalised spec, never the one that arrived. See the note in `spec.ts` about why the difference matters.
  const spec = checked.normalised
  const operations = checked.operations
  const warnings = checked.problems.filter((one) => one.severity === 'warning')

  const derived = capabilitiesFor(operations, options.operations)
  if ('missing' in derived) {
    // Unreachable through `checkSpec`, which refuses an unknown operation. Kept because the table is a parameter, and
    // a caller passing a different table to `compile` than to `checkSpec` would otherwise produce a Page whose
    // manifest is missing a capability it needs.
    return {
      error: 'unknown-capability',
      message: `There is no capability recorded for "${derived.missing}", so the Page could not say what it needs.`,
      problems: [{ at: 'steps', severity: 'error', code: 'unknown-capability', message: derived.missing }]
    }
  }
  const capabilities = [...derived.capabilities]
  if (options.allowStorage === true) capabilities.push('storage.page')
  capabilities.sort()

  const document: PageDocument = {
    fields: buildFields(spec),
    components: buildComponents(spec),
    computations: buildComputations(spec)
  }

  // The compiler checking its own output. See the note at the top of the file about why this is not redundant.
  const built = check(document)
  if (!built.canRun) {
    return {
      error: 'document-rejected',
      message: 'The Page built from this description would not run.',
      problems: built.problems
        .filter((one) => one.severity === 'error')
        .map((one) => ({ at: one.at, severity: 'error' as const, code: one.code, message: one.message }))
    }
  }

  const version: PageVersion = { major: 1, minor: 0, patch: 0 }
  const slug = uniqueSlug(slugify(spec.title) || 'page', options.taken ?? [])
  const limitations = [...GENERATED_LIMITATIONS, ...spec.notes]
    .map((one) => (one.length > LIMITS.limitation ? `${one.slice(0, LIMITS.limitation - 1)}…` : one))
    .slice(0, LIMITS.limitations)

  const manifest: PageManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    pageId: options.pageId,
    slug,
    title: spec.title,
    description: spec.purpose,
    version,
    kind: 'tool',
    categories: categoriesFor(operations),
    tags: spec.keywords.filter((one) => /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(one) && one.length <= LIMITS.tag).slice(0, LIMITS.tags),
    icon: iconFor(operations),
    owner: options.owner ?? 'orion',
    runtimeAtLeast: PAGE_RUNTIME_VERSION,
    capabilities,
    capabilityReasons: Object.fromEntries(
      capabilities.map((one) => [
        one,
        one === 'storage.page'
          ? 'So the Page remembers what you typed into it the next time you open it.'
          : `Needed by ${operations.filter((op) => options.operations[op] === one).join(', ')}.`
      ])
    ),
    dependencies: [],
    search: {
      summary: spec.purpose.length > LIMITS.summary ? `${spec.purpose.slice(0, LIMITS.summary - 1)}…` : spec.purpose,
      keywords: spec.keywords.slice(0, LIMITS.keywords),
      intents: ['calculate'],
      aliases: []
    },
    offline: true,
    limitations,
    // A generated Page accepts nothing from another Page. Accepting a message is a decision about trust, and the
    // whole point of this format is that a model cannot make one.
    accepts: [],
    languages: ['en']
  }

  const manifestProblems = validateManifest({
    ...manifest,
    version: `${version.major}.${version.minor}.${version.patch}`,
    runtimeAtLeast: `${PAGE_RUNTIME_VERSION.major}.${PAGE_RUNTIME_VERSION.minor}.${PAGE_RUNTIME_VERSION.patch}`
  }).filter((one) => one.severity === 'error')
  if (manifestProblems.length > 0) {
    return {
      error: 'manifest-rejected',
      message: 'The Page built from this description could not describe itself.',
      problems: manifestProblems.map((one) => ({ at: one.path, severity: 'error' as const, code: one.code, message: one.message }))
    }
  }

  return {
    manifest,
    document,
    spec,
    warnings: [
      ...warnings,
      ...built.problems
        .filter((one) => one.severity === 'warning')
        .map((one) => ({ at: one.at, severity: 'warning' as const, code: one.code, message: one.message }))
    ]
  }
}

export const COMPILER_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A generated Page is the same kind of object as one somebody wrote by hand. There is no second runtime with weaker checks.',
  'Capabilities are computed from the calculations a Page uses, through the same table the compute service enforces. The two ends cannot disagree.',
  'Storage is the one capability that is not derived, because no calculation implies it. It is decided by Orbis, never by the description.',
  'The compiler checks its own output before returning it, so a bug here fails at build time rather than on somebody first click.',
  'Every generated Page is filed under `generated`, so nothing has to read its contents to know nobody reviewed it.'
])
