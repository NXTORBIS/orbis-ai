/**
 * Turns a stored workflow into the plan the run engine carries out, and describes what a run would do without doing it
 * (plan mode). Both are pure: no browser, no state.
 */
import type { CapabilityDescriptor, Plan, PlanStep } from './browserControl.ts'
import type { Workflow, WorkflowStep } from './workflows.ts'

/** A workflow step as a plan step. */
export function compileStep(step: WorkflowStep, maxIterations: number): PlanStep {
  const meta = { id: step.id, label: step.name, ...(step.enabled === false ? { enabled: false } : {}) }
  switch (step.type) {
    case 'action':
      return {
        ...meta,
        do: step.capability,
        params: step.params,
        ...(step.target ? { target: step.target } : {}),
        ...(step.saveAs ? { saveAs: step.saveAs } : {}),
        ...(step.optional ? { optional: true } : {}),
        ...(step.retry ? { retry: step.retry } : {}),
        ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}),
        ...(step.expect ? { expect: step.expect } : {})
      }
    case 'if': {
      // else-if chains become nested ifs in the else branch.
      const elseBranch = (step.elseIf ?? []).reduceRight<PlanStep[] | undefined>(
        (rest, branch, i) => [{ id: `${step.id}-elseif-${i + 1}`, label: `${step.name} (else if ${i + 1})`, if: branch.condition, then: branch.steps.map((s) => compileStep(s, maxIterations)), ...(rest ? { else: rest } : {}) }],
        step.else?.map((s) => compileStep(s, maxIterations))
      )
      return { ...meta, if: step.condition, then: step.then.map((s) => compileStep(s, maxIterations)), ...(elseBranch ? { else: elseBranch } : {}) }
    }
    case 'repeat':
      return {
        ...meta,
        repeat: {
          ...(step.times !== undefined ? { times: step.times } : {}),
          ...(step.until ? { until: step.until } : {}),
          ...(step.while ? { while: step.while } : {}),
          ...(step.forEach !== undefined ? { forEach: step.forEach } : {}),
          ...(step.as ? { as: step.as } : {}),
          ...(step.forever ? { forever: true } : {}),
          max: step.max ?? maxIterations
        },
        steps: step.steps.map((s) => compileStep(s, maxIterations))
      }
    case 'set':
      return { ...meta, set: step.values, ...(step.sensitive ? { sensitive: true } : {}) }
    case 'wait':
      return { ...meta, wait: { ...(step.ms !== undefined ? { ms: step.ms } : {}), ...(step.until ? { until: step.until } : {}), ...(step.timeoutMs ? { timeoutMs: step.timeoutMs } : {}) } }
    case 'transform':
      return { ...meta, transform: { input: step.input, operations: step.operations, saveAs: step.saveAs } }
    case 'orion':
      return { ...meta, ask: { prompt: step.prompt, include: step.include, expects: step.expects, ...(step.choices ? { choices: step.choices } : {}), ...(step.minConfidence !== undefined ? { minConfidence: step.minConfidence } : {}), saveAs: step.saveAs } }
    case 'call':
      return { ...meta, call: { workflowId: step.workflowId, inputs: step.inputs, ...(step.saveAs ? { saveAs: step.saveAs } : {}) } }
    case 'userAction':
      return { ...meta, userAction: { message: step.message, ...(step.until ? { until: step.until } : {}) } }
    case 'confirm':
      return { ...meta, confirm: { message: step.message } }
  }
}

/** The plan for one run: steps, starting variables (the workflow's, then the run's inputs), secrets kept out of logs. */
export function compileWorkflow(workflow: Workflow, inputs: Record<string, unknown> = {}): Plan {
  const defaults = Object.fromEntries(workflow.inputs.filter((i) => i.default !== undefined).map((i) => [i.name, i.default]))
  const secret = workflow.inputs.filter((i) => i.type === 'secret').map((i) => i.name)
  const sensitiveSteps: string[] = []
  const collect = (steps: WorkflowStep[]): void => {
    for (const s of steps) {
      if (s.type === 'set' && s.sensitive) sensitiveSteps.push(...Object.keys(s.values))
      if (s.type === 'if') {
        collect(s.then)
        s.elseIf?.forEach((b) => collect(b.steps))
        if (s.else) collect(s.else)
      }
      if (s.type === 'repeat') collect(s.steps)
    }
  }
  collect(workflow.steps)
  return {
    name: workflow.name,
    steps: workflow.steps.map((s) => compileStep(s, workflow.settings.maxIterations)),
    variables: { ...workflow.variables, ...defaults, ...inputs },
    sensitiveVariables: [...new Set([...secret, ...sensitiveSteps])],
    onFailure: workflow.settings.onFailure,
    outputs: workflow.outputs.map((o) => ({ name: o.name, from: o.from, ...(o.sensitive ? { sensitive: true } : {}) }))
  }
}

export interface PlanLine {
  path: string
  depth: number
  text: string
  /** It changes something outside the run (a tab, a page, a setting…). */
  changes: boolean
  /** The user will be asked to approve it (always, or when it turns out to be consequential). */
  approval: 'never' | 'always' | 'when-consequential'
  disabled: boolean
}

const quoted = (value: unknown): string => (typeof value === 'string' ? `“${value.length > 50 ? `${value.slice(0, 47)}…` : value}”` : JSON.stringify(value))

function describeCondition(condition: unknown): string {
  const c = condition as Record<string, unknown>
  if (!c || typeof c !== 'object') return '(no condition)'
  if (Array.isArray(c.all)) return c.all.map(describeCondition).join(' and ')
  if (Array.isArray(c.any)) return c.any.map(describeCondition).join(' or ')
  if (c.not) return `not (${describeCondition(c.not)})`
  switch (c.check) {
    case 'elementExists':
      return `the page has ${quoted(JSON.stringify(c.locator))}`
    case 'elementMissing':
      return `the page doesn't have ${quoted(JSON.stringify(c.locator))}`
    case 'textContains':
      return `the page says ${quoted(c.text)}`
    case 'textMissing':
      return `the page doesn't say ${quoted(c.text)}`
    case 'urlMatches':
      return `the address matches ${quoted(c.pattern)}`
    case 'pageLoaded':
      return 'the page has loaded'
    case 'variableExists':
      return `{{${String(c.name)}}} has a value`
    case 'compare':
      return `${quoted(c.left)} ${String(c.op)} ${quoted(c.right)}`
    default:
      return String(c.check)
  }
}

/**
 * Plan mode: what a run would do, step by step, with what changes things and what will ask for approval. Nothing is
 * executed and nothing is reported as having happened.
 */
export function describeWorkflow(workflow: Workflow, capabilities: CapabilityDescriptor[]): PlanLine[] {
  const byId = new Map(capabilities.map((c) => [c.id, c]))
  const lines: PlanLine[] = []
  const visit = (steps: WorkflowStep[], path: string, depth: number, parentDisabled: boolean): void => {
    steps.forEach((step, i) => {
      const here = path ? `${path}.${i + 1}` : String(i + 1)
      const disabled = parentDisabled || step.enabled === false
      const push = (text: string, changes = false, approval: PlanLine['approval'] = 'never'): void => void lines.push({ path: here, depth, text, changes, approval, disabled })
      switch (step.type) {
        case 'action': {
          const cap = byId.get(step.capability)
          const params = Object.entries(step.params)
            .filter(([k]) => k !== 'locator')
            .map(([k, v]) => `${k} ${quoted(v)}`)
            .join(', ')
          const locator = step.params.locator ? ` on ${quoted(JSON.stringify(step.params.locator))}` : ''
          push(`${step.name}: ${cap ? cap.name : `${step.capability} (not available in this Orbis)`}${locator}${params ? ` (${params})` : ''}${step.saveAs ? ` → {{${step.saveAs}}}` : ''}`, cap?.mutates ?? true, cap ? (cap.confirmation === 'always' ? 'always' : cap.confirmation === 'when-consequential' ? 'when-consequential' : 'never') : 'never')
          break
        }
        case 'if':
          push(`${step.name}: if ${describeCondition(step.condition)}`)
          visit(step.then, `${here}.then`, depth + 1, disabled)
          step.elseIf?.forEach((branch, b) => {
            lines.push({ path: `${here}.elseIf${b + 1}`, depth, text: `else if ${describeCondition(branch.condition)}`, changes: false, approval: 'never', disabled })
            visit(branch.steps, `${here}.elseIf${b + 1}`, depth + 1, disabled)
          })
          if (step.else) {
            lines.push({ path: `${here}.else`, depth, text: 'otherwise', changes: false, approval: 'never', disabled })
            visit(step.else, `${here}.else`, depth + 1, disabled)
          }
          break
        case 'repeat': {
          const how =
            step.forEach !== undefined
              ? `for each ${step.as ?? 'item'} in ${quoted(step.forEach)}`
              : step.times !== undefined
                ? `${String(step.times)} times`
                : step.while
                  ? `while ${describeCondition(step.while)}`
                  : step.until
                    ? `until ${describeCondition(step.until)}`
                    : 'until stopped'
          push(`${step.name}: repeat ${how}${step.until && step.forEach === undefined && step.times === undefined ? '' : step.until ? `, stopping once ${describeCondition(step.until)}` : ''} (at most ${step.max ?? workflow.settings.maxIterations})`)
          visit(step.steps, `${here}.loop`, depth + 1, disabled)
          break
        }
        case 'set':
          push(`${step.name}: set ${Object.keys(step.values).map((k) => `{{${k}}}`).join(', ')}${step.sensitive ? ' (kept private)' : ''}`)
          break
        case 'wait':
          push(`${step.name}: wait ${step.until ? `until ${describeCondition(step.until)} (up to ${Math.round((step.timeoutMs ?? 30_000) / 1000)}s)` : `${Math.round((step.ms ?? 0) / 100) / 10}s`}`)
          break
        case 'transform':
          push(`${step.name}: transform ${quoted(step.input)} with ${step.operations.map((o) => o.op).join(' → ')} → {{${step.saveAs}}}`)
          break
        case 'orion':
          push(`${step.name}: ask Orion ${quoted(step.prompt)}${step.choices ? ` (choose from ${step.choices.map((c) => quoted(c)).join(', ')})` : ''} → {{${step.saveAs}}}`)
          break
        case 'call':
          push(`${step.name}: run the workflow ${step.workflowId}${step.saveAs ? ` → {{${step.saveAs}}}` : ''}`, true)
          break
        case 'userAction':
          push(`${step.name}: pause for you: ${step.message}`)
          break
        case 'confirm':
          push(`${step.name}: ask you to confirm: ${step.message}`, false, 'always')
          break
      }
    })
  }
  visit(workflow.steps, '', 0, false)
  return lines
}
