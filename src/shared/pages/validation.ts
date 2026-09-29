/**
 * The gates a generated Page passes before anybody is offered it.
 *
 * Generation produces something plausible. That is what generation is for and it is also the danger: a Page that
 * compiles, opens and shows a number is indistinguishable, to somebody looking at it, from one that is right. So a
 * built Page is put through a fixed sequence of checks, each of which can fail it, and the result says which passed
 * rather than producing a score.
 *
 * ## There is no confidence number here
 *
 * A single number between 0 and 1 covering "is this Page any good" would be read as a probability and is not one. Each
 * gate is a separate question with a separate answer, and the summary is the list of them. Somebody deciding whether
 * to publish a generated Page should be able to see that it passed structure and failed persistence, not that it
 * scored 0.82.
 *
 * ## What a machine can and cannot check
 *
 * The gates here are the arithmetic ones: does every reference resolve, does it ask for more than it needs, would it
 * call an engine fifty times per keystroke, would somebody's typing survive being saved. They are worth running and
 * they are not the whole question.
 *
 * What they cannot check is whether the Page computes **the right thing**. A Page that converts Celsius to Fahrenheit
 * with the wrong constant passes every gate in this file. That is stated on the Page itself rather than hidden here,
 * and it is the reason a generated Page carries a limitation saying nobody reviewed it.
 *
 * The one gate that can catch a wrong answer is `running`, and only the caller can run it: the engines live in the
 * main process, so this file takes the outcome of a real run as an input rather than pretending to do one.
 */

import { check, computationsAfter, initialState, type PageDocument } from './builder.ts'
import { CAPABILITIES, FORBIDDEN_CAPABILITIES, capabilityById } from './capabilities.ts'
import type { PageManifest } from './manifest.ts'
import type { PageSpec } from './spec.ts'

export const VALIDATION_LIMITS = Object.freeze({
  /**
   * How many calculations one keystroke may set off.
   *
   * Each is an engine call across a process boundary. Past this a Page types visibly slowly, and the fix is a button
   * rather than a faster engine.
   */
  perKeystroke: 6,
  /** Total calculations. A Page with more than this is a workflow wearing a Page's clothes. */
  computations: 16,
  /** Controls on screen before a Page stops being fillable in. */
  controls: 20,
  /** Capabilities. A generated Page needing many is a generated Page doing too much. */
  capabilities: 4
})

export type GateName =
  /** Every reference resolves and the document is one the runtime will accept. */
  | 'structure'
  /** It asks for exactly what its calculations need, and nothing that is never granted to a generated Page. */
  | 'permissions'
  /** Every control is labelled, distinctly, in words rather than in field names. */
  | 'legibility'
  /** It will not call an engine more times than somebody will wait for. */
  | 'responsiveness'
  /** What somebody types into it will still be there, or the Page does not pretend it will. */
  | 'persistence'
  /** It says what it does not do. */
  | 'honesty'
  /** It was actually run, and the calculations returned answers rather than refusals. */
  | 'running'

export type GateOutcome = 'passed' | 'failed' | 'not-run'

export interface GateResult {
  gate: GateName
  outcome: GateOutcome
  /** Why, in words. Present whether it passed or failed -- a gate that passed silently is one nobody can audit. */
  because: readonly string[]
}

export interface ValidationResult {
  gates: readonly GateResult[]
  /** True when no gate failed. A gate that did not run does not fail this, and `incomplete` says so. */
  passed: boolean
  /** True when something was not checked, so nobody reads a pass as a full pass. */
  incomplete: boolean
  /** Everything that failed, flattened, for a screen that shows problems rather than gates. */
  problems: readonly string[]
}

/** What a real run of the Page produced, supplied by whoever could run it. */
export interface RunEvidence {
  /** One entry per computation that was run. */
  results: readonly {
    name: string
    ok: boolean
    message?: string
    /**
     * The property names the calculation actually returned.
     *
     * This is the only way to find out. No engine declares its result shape anywhere, so a specification saying
     * `pick: 'range'` is a guess until something has run the thing and looked. A guess that is wrong does not fail:
     * it produces a Page with an empty box where the answer should be, which is the worst kind of wrong because it
     * looks like a calculation that has not been given enough rather than like a mistake.
     */
    keys?: readonly string[]
  }[]
  /** Computations that were not run because nothing triggered them -- a button, usually. */
  notRun: readonly string[]
}

export interface MissingPick {
  /** The component that would show nothing. */
  label: string
  step: string
  pick: string
  /** What the calculation did return, so a second attempt has something to work from. */
  available: readonly string[]
}

/**
 * Every property a Page tries to show, checked against what its calculations really returned.
 *
 * Only for steps that ran. A step waiting for a button returned nothing to check against, and treating that as a
 * missing property would fail every Page with a button on it.
 */
export function missingPicks(document: PageDocument, evidence: RunEvidence): MissingPick[] {
  const returned = new Map<string, readonly string[]>()
  for (const one of evidence.results) {
    if (one.ok && one.keys !== undefined) returned.set(one.name, one.keys)
  }
  const writtenBy = new Map<string, string>()
  for (const computation of document.computations) writtenBy.set(computation.writes, computation.name)

  const out: MissingPick[] = []
  const walk = (component: { kind: string; label?: string; field?: string; pick?: string; children?: readonly unknown[] }): void => {
    if (component.pick !== undefined && component.field !== undefined) {
      const step = writtenBy.get(component.field)
      const keys = step === undefined ? undefined : returned.get(step)
      if (step !== undefined && keys !== undefined && !keys.includes(component.pick)) {
        out.push({ label: component.label ?? component.field, step, pick: component.pick, available: keys })
      }
    }
    for (const child of component.children ?? []) walk(child as Parameters<typeof walk>[0])
  }
  for (const component of document.components) walk(component)
  return out
}

export interface ValidateInput {
  spec: PageSpec
  manifest: PageManifest
  document: PageDocument
  /** Operation name to capability. The same table the compiler derived from. */
  operations: Readonly<Record<string, string>>
  /** Whether Orbis decided this Page may remember what was typed into it. */
  allowStorage: boolean
  /** The outcome of really running it. Omitted when nobody could, which makes the result incomplete rather than passed. */
  evidence?: RunEvidence
}

/**
 * Capabilities a generated Page may hold.
 *
 * Not a list of what is dangerous -- that is `FORBIDDEN_CAPABILITIES`, and it applies to every Page. This is narrower:
 * a generated Page may compute and it may remember its own fields, and that is all. A capability that is perfectly
 * reasonable for a Page somebody wrote -- reading the clipboard, say -- is not reasonable for one a model wrote in
 * response to a sentence, because there is no author to have thought about it.
 */
export const GENERATED_MAY_HOLD = (id: string): boolean => id.startsWith('computation.') || id === 'storage.page'

function structure(input: ValidateInput): GateResult {
  const checked = check(input.document)
  const errors = checked.problems.filter((one) => one.severity === 'error')
  if (errors.length > 0) {
    return { gate: 'structure', outcome: 'failed', because: errors.map((one) => `${one.at}: ${one.message}`) }
  }
  const declared = new Set(checked.operations)
  const missing = [...declared].filter((one) => !Object.prototype.hasOwnProperty.call(input.operations, one))
  if (missing.length > 0) {
    return {
      gate: 'structure',
      outcome: 'failed',
      because: missing.map((one) => `It uses "${one}", which Orbis does not have.`)
    }
  }
  return {
    gate: 'structure',
    outcome: 'passed',
    because: [`Every reference resolves, and all ${checked.operations.length} calculation${checked.operations.length === 1 ? '' : 's'} it uses exist.`]
  }
}

function permissions(input: ValidateInput): GateResult {
  const because: string[] = []
  const asked = input.manifest.capabilities
  const failures: string[] = []

  for (const one of asked) {
    if (Object.prototype.hasOwnProperty.call(FORBIDDEN_CAPABILITIES, one)) {
      failures.push(`It asks for "${one}", which no Page is ever granted.`)
      continue
    }
    if (capabilityById(one) === null) {
      failures.push(`It asks for "${one}", which is not a capability Orbis has.`)
      continue
    }
    if (!GENERATED_MAY_HOLD(one)) {
      failures.push(`It asks for "${one}". A generated Page may calculate and may remember its own boxes, and nothing else.`)
    }
  }
  if (asked.includes('storage.page') && !input.allowStorage) {
    failures.push('It asks to remember what is typed into it, and that was not granted.')
  }
  if (asked.length > VALIDATION_LIMITS.capabilities) {
    failures.push(`It asks for ${asked.length} permissions, and a generated Page may ask for at most ${VALIDATION_LIMITS.capabilities}.`)
  }

  // The important direction: exactly what the calculations need, no more. A capability in the manifest that no
  // operation requires is one that arrived from somewhere it should not have.
  const needed = new Set(check(input.document).operations.map((one) => input.operations[one]).filter((one) => one !== undefined))
  for (const one of asked) {
    if (one === 'storage.page') continue
    if (!needed.has(one)) failures.push(`It asks for "${one}", and none of its calculations need it.`)
  }
  for (const one of needed) {
    if (!asked.includes(one)) failures.push(`It uses something needing "${one}" without asking for it, so it would be refused when somebody clicked.`)
  }

  if (failures.length > 0) return { gate: 'permissions', outcome: 'failed', because: failures }
  because.push(
    asked.length === 0
      ? 'It asks for nothing.'
      : `It asks for exactly what its calculations need: ${asked.join(', ')}.`
  )
  void CAPABILITIES
  return { gate: 'permissions', outcome: 'passed', because }
}

function legibility(input: ValidateInput): GateResult {
  const failures: string[] = []
  const labels = new Map<string, string[]>()
  for (const one of [...input.spec.inputs, ...input.spec.outputs]) {
    const key = one.label.toLowerCase().replace(/\s+/g, ' ').trim()
    labels.set(key, [...(labels.get(key) ?? []), one.name])
    // A label that is the field name is a label nobody wrote. `speed` is not a label; "Launch speed" is.
    if (key === one.name.toLowerCase() || key === one.name.toLowerCase().replace(/_/g, ' ')) {
      failures.push(`"${one.name}" is labelled with its own name, which tells somebody nothing they did not already see.`)
    }
  }
  for (const [label, names] of labels) {
    if (names.length > 1) failures.push(`${names.length} things are labelled "${label}", so nobody can tell which is which.`)
  }
  const controls = input.spec.inputs.length + input.spec.outputs.length
  if (controls > VALIDATION_LIMITS.controls) {
    failures.push(`There are ${controls} things on screen, and past ${VALIDATION_LIMITS.controls} a Page stops being something somebody fills in.`)
  }

  if (failures.length > 0) return { gate: 'legibility', outcome: 'failed', because: failures }
  return {
    gate: 'legibility',
    outcome: 'passed',
    because: [`All ${controls} labels are distinct, and none of them is a field name.`]
  }
}

/**
 * How much work one keystroke sets off.
 *
 * Counted from the real trigger graph rather than from the number of computations, because a Page with twelve
 * calculations where each input feeds one is fine, and a Page with four where every input feeds all of them is not.
 */
function responsiveness(input: ValidateInput): GateResult {
  const failures: string[] = []
  let worst = 0
  let worstField = ''
  for (const field of input.spec.inputs) {
    const triggered = computationsAfter(input.document, field.name).length
    if (triggered > worst) {
      worst = triggered
      worstField = field.label
    }
  }
  if (worst > VALIDATION_LIMITS.perKeystroke) {
    failures.push(
      `Typing in "${worstField}" sets off ${worst} calculations, and the most that can happen while somebody types is ${VALIDATION_LIMITS.perKeystroke}. Some of them should wait for a button.`
    )
  }
  if (input.spec.steps.length > VALIDATION_LIMITS.computations) {
    failures.push(`It does ${input.spec.steps.length} calculations, and past ${VALIDATION_LIMITS.computations} this is a workflow rather than a Page.`)
  }
  if (failures.length > 0) return { gate: 'responsiveness', outcome: 'failed', because: failures }
  return {
    gate: 'responsiveness',
    outcome: 'passed',
    because: [
      worst === 0
        ? 'Nothing recalculates as somebody types.'
        : `At most ${worst} calculation${worst === 1 ? '' : 's'} run${worst === 1 ? 's' : ''} while somebody types, in "${worstField}".`
    ]
  }
}

/**
 * Whether what somebody types survives.
 *
 * The failure this catches is a Page that looks like it remembers and does not. Either it was granted storage, in
 * which case its fields have to be things that can be stored, or it was not, in which case it must not have a field
 * whose whole purpose is to be kept -- a long text box somebody would be annoyed to retype.
 */
function persistence(input: ValidateInput): GateResult {
  const stores = input.manifest.capabilities.includes('storage.page')
  if (stores) {
    // `initialState` cannot fail -- the document reached here having passed `check`, and a field it could not start
    // is simply left unset. So there is nothing to guard against, and a guard here would be a branch that never runs
    // while looking like a safety net.
    const started = initialState(input.document)
    const kept = Object.keys(started.values).length
    return {
      gate: 'persistence',
      outcome: 'passed',
      because: [
        `What is typed into its ${input.spec.inputs.length} box${input.spec.inputs.length === 1 ? '' : 'es'} will still be there next time, and ${kept} of them start with something in.`
      ]
    }
  }
  const longText = input.spec.inputs.filter((one) => one.kind === 'text')
  if (longText.length > 0) {
    return {
      gate: 'persistence',
      outcome: 'failed',
      because: [
        `"${longText[0].label}" is something somebody types at length, and this Page does not remember anything. It would be lost every time the Page closed.`
      ]
    }
  }
  return {
    gate: 'persistence',
    outcome: 'passed',
    because: ['It remembers nothing, and it has nothing whose loss would matter.']
  }
}

function honesty(input: ValidateInput): GateResult {
  const stated = input.manifest.limitations
  if (stated.length === 0) {
    return { gate: 'honesty', outcome: 'failed', because: ['It says nothing about what it does not do.'] }
  }
  if (!stated.some((one) => one.toLowerCase().includes('nobody has reviewed'))) {
    return {
      gate: 'honesty',
      outcome: 'failed',
      because: ['It does not say it was generated. Somebody reading it would take it for a Page that was written.']
    }
  }
  const own = stated.length - 3
  return {
    gate: 'honesty',
    outcome: 'passed',
    because: [
      own > 0
        ? `It says it was generated, and states ${own} limit${own === 1 ? '' : 's'} of its own.`
        : 'It says it was generated. It states no limits of its own, which is worth a look before publishing.'
    ]
  }
}

function running(evidence: RunEvidence | undefined, document: PageDocument): GateResult {
  if (evidence === undefined) {
    return {
      gate: 'running',
      outcome: 'not-run',
      because: ['Nobody has actually run it. Everything above is about its shape rather than its answers.']
    }
  }
  const refused = evidence.results.filter((one) => !one.ok)
  if (refused.length > 0) {
    return {
      gate: 'running',
      outcome: 'failed',
      because: refused.map((one) => `"${one.name}" was refused: ${one.message ?? 'no reason given'}`)
    }
  }
  if (evidence.results.length === 0) {
    return { gate: 'running', outcome: 'failed', because: ['It was run and nothing calculated anything.'] }
  }
  const missing = missingPicks(document, evidence)
  if (missing.length > 0) {
    return {
      gate: 'running',
      outcome: 'failed',
      because: missing.map(
        (one) =>
          `"${one.label}" shows "${one.pick}" from ${one.step}, and ${one.step} does not return that. It returns ${one.available.join(', ')}.`
      )
    }
  }
  const waiting = evidence.notRun.length > 0 ? ` ${evidence.notRun.length} wait${evidence.notRun.length === 1 ? 's' : ''} for a button.` : ''
  return {
    gate: 'running',
    outcome: 'passed',
    because: [
      `All ${evidence.results.length} calculation${evidence.results.length === 1 ? '' : 's'} that run on their own returned an answer.${waiting}`,
      'That they returned an answer does not mean it is the right one. Nothing here can check that.'
    ]
  }
}

/** Every gate, in order. The order is the order somebody would want them: cheapest and most fundamental first. */
export function validate(input: ValidateInput): ValidationResult {
  const gates: GateResult[] = [
    structure(input),
    permissions(input),
    legibility(input),
    responsiveness(input),
    persistence(input),
    honesty(input),
    running(input.evidence, input.document)
  ]
  return {
    gates: Object.freeze(gates),
    passed: !gates.some((one) => one.outcome === 'failed'),
    incomplete: gates.some((one) => one.outcome === 'not-run'),
    problems: Object.freeze(gates.filter((one) => one.outcome === 'failed').flatMap((one) => one.because))
  }
}

/**
 * The computations a caller should run to produce `RunEvidence`.
 *
 * Every `change` computation, in the order the builder would run them, from the Page's starting values. A `button`
 * computation is deliberately not included: running one means pressing something on somebody's behalf, and the
 * result would not be evidence about the Page opening.
 */
export function whatToRun(document: PageDocument): { run: readonly string[]; waiting: readonly string[] } {
  const run: string[] = []
  const seen = new Set<string>()
  for (const field of document.fields) {
    if (field.computed === true) continue
    for (const computation of computationsAfter(document, field.name)) {
      if (seen.has(computation.name)) continue
      seen.add(computation.name)
      run.push(computation.name)
    }
  }
  return {
    run: Object.freeze(run),
    waiting: Object.freeze(document.computations.filter((one) => !seen.has(one.name)).map((one) => one.name))
  }
}

export const VALIDATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'There is no score. Each gate is a separate question with a separate answer, because a single number covering all of them would be read as a probability and is not one.',
  'None of these gates can tell whether the Page computes the right thing. A converter with the wrong constant passes every one of them.',
  'A gate that did not run does not count as passed. The result says it is incomplete, so a pass is never read as a full pass.',
  'A generated Page may calculate and may remember its own boxes. Anything else is refused, however reasonable it would be for a Page somebody wrote.',
  'How much work a keystroke sets off is counted from the real trigger graph, not from how many calculations there are.'
])
