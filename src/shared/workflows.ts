/**
 * Orbis workflows: the persistent, portable definition of multi-step browser automation, independent of any UI.
 * A workflow is data (steps, branches, loops, variables, inputs and outputs) that the Workflow Engine carries out
 * through the Orbis Browser Control Layer. This module holds the model and the deterministic parts that need no
 * browser: data transforms, validation before a run, and safe export and import.
 */
import type { CapabilityDescriptor, Condition, ControlError, ControlSource, RetryPolicy, RunState, StepRecord } from './browserControl.ts'
import { readPath } from './browserControl.ts'

export const WORKFLOW_FORMAT = 1

export type WorkflowVariableType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'url' | 'secret' | 'date'

export interface WorkflowInput {
  name: string
  label: string
  type: WorkflowVariableType
  required?: boolean
  default?: unknown
  description?: string
}

export interface WorkflowOutput {
  name: string
  label?: string
  /** A variable path, e.g. "apiKey" or "order.number". */
  from: string
  sensitive?: boolean
}

export type TransformOp =
  | { op: 'trim' | 'lowercase' | 'uppercase' | 'number' | 'parseJson' | 'toJson' | 'urlEncode' | 'urlDecode' | 'base64Encode' | 'base64Decode' | 'first' | 'last' | 'length' | 'unique' | 'string' | 'boolean' }
  | { op: 'replace'; from: string; to: string; regex?: boolean; all?: boolean }
  | { op: 'split'; separator: string }
  | { op: 'join'; separator: string }
  | { op: 'substring'; start: number; end?: number }
  | { op: 'regex'; pattern: string; group?: number; flags?: string }
  | { op: 'formatNumber'; decimals?: number }
  | { op: 'date'; format: 'iso' | 'date' | 'time' | 'datetime' | 'timestamp' }
  | { op: 'get'; path: string }
  | { op: 'map'; path: string }
  | { op: 'filter'; path?: string; operator: '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'matches'; value: unknown }
  | { op: 'sort'; path?: string; descending?: boolean }
  | { op: 'slice'; start: number; end?: number }

export type WorkflowStepType = 'action' | 'if' | 'repeat' | 'set' | 'wait' | 'transform' | 'orion' | 'call' | 'userAction' | 'confirm'

interface StepBase {
  id: string
  type: WorkflowStepType
  name: string
  description?: string
  /** Disabled steps are skipped. */
  enabled?: boolean
  metadata?: Record<string, unknown>
}

export interface ActionWorkflowStep extends StepBase {
  type: 'action'
  capability: string
  params: Record<string, unknown>
  target?: { tabId?: string; webContentsId?: number }
  saveAs?: string
  optional?: boolean
  retry?: RetryPolicy
  timeoutMs?: number
  /** Checked after the action; the step fails when it isn't true. */
  expect?: Condition
}

export interface IfWorkflowStep extends StepBase {
  type: 'if'
  condition: Condition
  then: WorkflowStep[]
  elseIf?: { condition: Condition; steps: WorkflowStep[] }[]
  else?: WorkflowStep[]
}

export interface RepeatWorkflowStep extends StepBase {
  type: 'repeat'
  times?: number | string
  until?: Condition
  while?: Condition
  forEach?: string | unknown[]
  as?: string
  max?: number
  forever?: boolean
  steps: WorkflowStep[]
}

export interface SetWorkflowStep extends StepBase {
  type: 'set'
  values: Record<string, unknown>
  sensitive?: boolean
}

export interface WaitWorkflowStep extends StepBase {
  type: 'wait'
  ms?: number
  until?: Condition
  timeoutMs?: number
}

export interface TransformWorkflowStep extends StepBase {
  type: 'transform'
  /** A value or {{variable}} to transform. */
  input: unknown
  operations: TransformOp[]
  saveAs: string
}

export interface OrionWorkflowStep extends StepBase {
  type: 'orion'
  prompt: string
  /** What Orion receives besides the prompt. */
  include: ('pageText' | 'url' | 'title' | 'variables' | 'selection')[]
  /** The structured result expected: a decision among choices, a value, a yes/no, or JSON. */
  expects: 'decision' | 'value' | 'boolean' | 'json'
  choices?: string[]
  /** Results below this confidence pause the run for the user instead of continuing. */
  minConfidence?: number
  saveAs: string
}

export interface CallWorkflowStep extends StepBase {
  type: 'call'
  workflowId: string
  inputs: Record<string, unknown>
  saveAs?: string
}

export interface UserActionWorkflowStep extends StepBase {
  type: 'userAction'
  /** What the user must do (sign in, solve a CAPTCHA, choose something). */
  message: string
  /** Checked when the user continues; the run waits again while it's false. */
  until?: Condition
}

export interface ConfirmWorkflowStep extends StepBase {
  type: 'confirm'
  message: string
}

export type WorkflowStep =
  | ActionWorkflowStep
  | IfWorkflowStep
  | RepeatWorkflowStep
  | SetWorkflowStep
  | WaitWorkflowStep
  | TransformWorkflowStep
  | OrionWorkflowStep
  | CallWorkflowStep
  | UserActionWorkflowStep
  | ConfirmWorkflowStep

export type WorkflowTrigger =
  | { type: 'manual' }
  | { type: 'appStart' }
  | { type: 'tabOpened'; urlMatches?: string }
  | { type: 'navigationCompleted'; urlMatches?: string }
  | { type: 'downloadCompleted'; nameMatches?: string }

export interface WorkflowSchedule {
  enabled: boolean
  kind: 'once' | 'daily' | 'weekly' | 'monthly'
  /** Epoch ms for "once"; for the others, the first occurrence (its time of day, weekday or day of month repeat). */
  at: number
}

export interface Workflow {
  format: typeof WORKFLOW_FORMAT
  id: string
  name: string
  description: string
  icon: string
  color: string
  version: number
  status: 'draft' | 'ready' | 'archived'
  createdAt: number
  updatedAt: number
  createdBy: 'user' | 'orion' | 'recording' | 'import'
  tags: string[]
  favorite: boolean
  pinned: boolean
  folder?: string
  template: boolean
  inputs: WorkflowInput[]
  outputs: WorkflowOutput[]
  variables: Record<string, unknown>
  steps: WorkflowStep[]
  trigger: WorkflowTrigger
  schedule?: WorkflowSchedule
  settings: {
    onFailure: 'stop' | 'pause'
    /** Limit for loops without a count (until/while/forever). */
    maxIterations: number
    /** Whole-run time limit. */
    timeoutMs?: number
    /** Capability domains this workflow may use (empty: any). */
    permissions: string[]
  }
}

export function newWorkflow(name: string, id: string, now = Date.now()): Workflow {
  return {
    format: WORKFLOW_FORMAT,
    id,
    name: name.trim() || 'Untitled workflow',
    description: '',
    icon: '⚡',
    color: '#3fd8ff',
    version: 1,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    createdBy: 'user',
    tags: [],
    favorite: false,
    pinned: false,
    template: false,
    inputs: [],
    outputs: [],
    variables: {},
    steps: [],
    trigger: { type: 'manual' },
    settings: { onFailure: 'pause', maxIterations: 1000, permissions: [] }
  }
}

/** Every step in a tree, depth first, with its path. */
export function walkSteps(steps: WorkflowStep[], visit: (step: WorkflowStep, path: string) => void, path = ''): void {
  steps.forEach((step, i) => {
    const here = path ? `${path}.${i + 1}` : String(i + 1)
    visit(step, here)
    if (step.type === 'if') {
      walkSteps(step.then, visit, `${here}.then`)
      step.elseIf?.forEach((branch, b) => walkSteps(branch.steps, visit, `${here}.elseIf${b + 1}`))
      if (step.else) walkSteps(step.else, visit, `${here}.else`)
    } else if (step.type === 'repeat') walkSteps(step.steps, visit, `${here}.loop`)
  })
}

// ---------------------------------------------------------------- transforms (deterministic, no AI)

const compareValues = (left: unknown, operator: string, right: unknown): boolean => {
  const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v))
  switch (operator) {
    case '==':
      return String(left) === String(right)
    case '!=':
      return String(left) !== String(right)
    case '>':
      return n(left) > n(right)
    case '>=':
      return n(left) >= n(right)
    case '<':
      return n(left) < n(right)
    case '<=':
      return n(left) <= n(right)
    case 'contains':
      return String(left ?? '').toLowerCase().includes(String(right ?? '').toLowerCase())
    case 'matches':
      try {
        return new RegExp(String(right), 'i').test(String(left ?? ''))
      } catch {
        return false
      }
    default:
      return false
  }
}

const toBase64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const fromBase64 = (text: string): string => new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)))

/** Applies one transform; throws a readable error when the value can't be transformed that way. */
export function applyTransform(value: unknown, t: TransformOp): unknown {
  const text = (): string => (value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value))
  const list = (): unknown[] => {
    if (Array.isArray(value)) return value
    throw new Error(`"${t.op}" needs a list.`)
  }
  switch (t.op) {
    case 'trim':
      return text().trim()
    case 'lowercase':
      return text().toLowerCase()
    case 'uppercase':
      return text().toUpperCase()
    case 'string':
      return text()
    case 'boolean':
      return typeof value === 'boolean' ? value : !['', 'false', '0', 'no', 'off', 'null', 'undefined'].includes(text().trim().toLowerCase())
    case 'number': {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const cleaned = text().replace(/[^\d.eE+-]/g, '')
      const n = Number(cleaned)
      if (!/\d/.test(cleaned) || !Number.isFinite(n)) throw new Error(`"${text().slice(0, 40)}" is not a number.`)
      return n
    }
    case 'formatNumber': {
      const n = Number(value)
      if (!Number.isFinite(n)) throw new Error('formatNumber needs a number.')
      return n.toFixed(Math.max(0, Math.min(10, t.decimals ?? 2)))
    }
    case 'replace': {
      if (!t.regex) return t.all === false ? text().replace(t.from, t.to) : text().split(t.from).join(t.to)
      return text().replace(new RegExp(t.from, t.all === false ? '' : 'g'), t.to)
    }
    case 'split':
      return text().split(t.separator)
    case 'join':
      return list().map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(t.separator)
    case 'substring':
      return text().substring(t.start, t.end)
    case 'regex': {
      const match = new RegExp(t.pattern, t.flags ?? '').exec(text())
      return match ? (match[t.group ?? (match.length > 1 ? 1 : 0)] ?? null) : null
    }
    case 'parseJson':
      try {
        return JSON.parse(text())
      } catch {
        throw new Error('The value is not valid JSON.')
      }
    case 'toJson':
      return JSON.stringify(value)
    case 'urlEncode':
      return encodeURIComponent(text())
    case 'urlDecode':
      return decodeURIComponent(text())
    case 'base64Encode':
      return toBase64(text())
    case 'base64Decode':
      return fromBase64(text())
    case 'date': {
      const date = typeof value === 'number' ? new Date(value) : new Date(text())
      if (Number.isNaN(date.getTime())) throw new Error(`"${text().slice(0, 40)}" is not a date.`)
      if (t.format === 'timestamp') return date.getTime()
      if (t.format === 'iso') return date.toISOString()
      if (t.format === 'date') return date.toISOString().slice(0, 10)
      if (t.format === 'time') return date.toISOString().slice(11, 19)
      return date.toISOString().replace('T', ' ').slice(0, 19)
    }
    case 'get':
      return readPath(value, t.path)
    case 'map':
      return list().map((x) => readPath(x, t.path))
    case 'filter':
      return list().filter((x) => compareValues(t.path ? readPath(x, t.path) : x, t.operator, t.value))
    case 'sort': {
      const key = (x: unknown): unknown => (t.path ? readPath(x, t.path) : x)
      const sorted = [...list()].sort((a, b) => {
        const ka = key(a)
        const kb = key(b)
        const d = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), undefined, { numeric: true })
        return d
      })
      return t.descending ? sorted.reverse() : sorted
    }
    case 'slice':
      return Array.isArray(value) ? value.slice(t.start, t.end) : text().slice(t.start, t.end)
    case 'first':
      return Array.isArray(value) ? value[0] : text().charAt(0)
    case 'last':
      return Array.isArray(value) ? value[value.length - 1] : text().slice(-1)
    case 'length':
      return Array.isArray(value) ? value.length : text().length
    case 'unique':
      return [...new Map(list().map((x) => [JSON.stringify(x), x])).values()]
  }
}

export function applyTransforms(value: unknown, operations: TransformOp[]): unknown {
  return operations.reduce((current, t, i) => {
    try {
      return applyTransform(current, t)
    } catch (err) {
      throw new Error(`Transform ${i + 1} (${t.op}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }, value)
}

// ---------------------------------------------------------------- validation before a run

export interface WorkflowIssue {
  level: 'error' | 'warning'
  stepId?: string
  path?: string
  message: string
}

const CHECKS = new Set(['elementExists', 'elementMissing', 'textContains', 'textMissing', 'urlMatches', 'pageLoaded', 'downloadCompleted', 'tabExists', 'windowExists', 'extensionExists', 'settingEquals', 'variableExists', 'compare', 'capabilityAvailable'])

/** The {{variables}} a value refers to (top-level names). */
export function referencedVariables(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') for (const m of value.matchAll(/\{\{\s*([\w$-]+)(?:[.\w$-]*)\s*\}\}/g)) out.add(m[1])
  else if (Array.isArray(value)) value.forEach((v) => referencedVariables(v, out))
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => referencedVariables(v, out))
  return out
}

function conditionIssues(condition: Condition | undefined, where: { stepId: string; path: string }, known: Set<string>, issues: WorkflowIssue[]): void {
  if (!condition || typeof condition !== 'object') return issues.push({ level: 'error', ...where, message: 'The condition is missing.' }) as unknown as void
  if ('all' in condition) return (condition as { all: Condition[] }).all.forEach((c) => conditionIssues(c, where, known, issues))
  if ('any' in condition) return (condition as { any: Condition[] }).any.forEach((c) => conditionIssues(c, where, known, issues))
  if ('not' in condition) return conditionIssues((condition as { not: Condition }).not, where, known, issues)
  const check = (condition as { check?: string }).check
  if (!check || !CHECKS.has(check)) issues.push({ level: 'error', ...where, message: `Unknown condition "${String(check)}".` })
  if (check === 'variableExists') return
  for (const name of referencedVariables(condition)) if (!known.has(name)) issues.push({ level: 'error', ...where, message: `{{${name}}} is used before it is created.` })
}

/**
 * Checks a workflow before it runs: its structure, capabilities that don't exist or can't be used, missing required
 * parameters, variables used before they exist, invalid conditions and loops, missing inputs, and calls to other
 * workflows (missing or circular).
 */
export function validateWorkflow(
  workflow: Workflow,
  options: { capabilities: CapabilityDescriptor[]; workflows?: Workflow[]; inputs?: Record<string, unknown> }
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  const byId = new Map(options.capabilities.map((c) => [c.id, c]))
  if (!workflow.name.trim()) issues.push({ level: 'error', message: 'The workflow needs a name.' })
  if (!workflow.steps.length) issues.push({ level: 'error', message: 'The workflow has no steps.' })
  const ids = new Set<string>()
  const known = new Set<string>([...Object.keys(workflow.variables), ...workflow.inputs.map((i) => i.name), 'index', 'run', 'now'])
  for (const input of workflow.inputs) {
    if (input.required && options.inputs && (options.inputs[input.name] === undefined || options.inputs[input.name] === '') && input.default === undefined) {
      issues.push({ level: 'error', message: `The input "${input.label || input.name}" is required.` })
    }
  }

  const visit = (steps: WorkflowStep[], path: string, scope: Set<string>): void => {
    steps.forEach((step, i) => {
      const here = path ? `${path}.${i + 1}` : String(i + 1)
      const where = { stepId: step.id, path: here }
      if (!step.id) issues.push({ level: 'error', path: here, message: 'A step has no id.' })
      else if (ids.has(step.id)) issues.push({ level: 'error', ...where, message: `Two steps share the id "${step.id}".` })
      ids.add(step.id)
      if (step.enabled === false) return
      const missing = (value: unknown): void => {
        for (const name of referencedVariables(value)) if (!scope.has(name)) issues.push({ level: 'error', ...where, message: `Step “${step.name}” uses {{${name}}} before it is created.` })
      }
      switch (step.type) {
        case 'action': {
          const capability = byId.get(step.capability)
          if (!capability) {
            issues.push({ level: 'error', ...where, message: `Step “${step.name}” uses "${step.capability}", which this Orbis doesn't have.` })
            break
          }
          if (workflow.settings.permissions.length && !workflow.settings.permissions.includes(capability.domain)) {
            issues.push({ level: 'error', ...where, message: `Step “${step.name}” needs the "${capability.domain}" permission, which this workflow doesn't have.` })
          }
          for (const [name, spec] of Object.entries(capability.params)) {
            if (spec.required && (step.params[name] === undefined || step.params[name] === '')) issues.push({ level: 'error', ...where, message: `Step “${step.name}” is missing “${name}” (${spec.description}).` })
          }
          for (const name of Object.keys(step.params)) if (!(name in capability.params)) issues.push({ level: 'warning', ...where, message: `Step “${step.name}” has an unknown parameter "${name}".` })
          if (capability.confirmation === 'always') issues.push({ level: 'warning', ...where, message: `Step “${step.name}” (${capability.name}) always asks you to approve it.` })
          missing(step.params)
          if (step.expect) conditionIssues(step.expect, where, scope, issues)
          if (step.saveAs) scope.add(step.saveAs)
          break
        }
        case 'if':
          conditionIssues(step.condition, where, scope, issues)
          visit(step.then, `${here}.then`, new Set(scope))
          step.elseIf?.forEach((b, n) => {
            conditionIssues(b.condition, where, scope, issues)
            visit(b.steps, `${here}.elseIf${n + 1}`, new Set(scope))
          })
          if (step.else) visit(step.else, `${here}.else`, new Set(scope))
          // Variables set in every branch exist afterwards; set in only some, they may not.
          break
        case 'repeat': {
          const bounded = step.times !== undefined || step.forEach !== undefined || step.until || step.while
          if (!bounded && !step.forever) issues.push({ level: 'error', ...where, message: `Loop “${step.name}” needs a count, a list, a condition, or "until stopped".` })
          if (step.forever && !step.until) issues.push({ level: 'warning', ...where, message: `Loop “${step.name}” repeats until you stop it.` })
          missing(step.forEach)
          missing(step.times)
          if (step.until) conditionIssues(step.until, where, new Set([...scope, step.as ?? 'item', 'index']), issues)
          if (step.while) conditionIssues(step.while, where, scope, issues)
          const inner = new Set([...scope, 'index', ...(step.forEach !== undefined ? [step.as ?? 'item'] : [])])
          visit(step.steps, `${here}.loop`, inner)
          for (const name of inner) scope.add(name)
          break
        }
        case 'set':
          missing(step.values)
          for (const name of Object.keys(step.values)) scope.add(name)
          break
        case 'wait':
          if (step.until) conditionIssues(step.until, where, scope, issues)
          else if (!step.ms || step.ms < 0) issues.push({ level: 'error', ...where, message: `Wait “${step.name}” needs a duration or a condition.` })
          break
        case 'transform':
          missing(step.input)
          if (!step.operations.length) issues.push({ level: 'warning', ...where, message: `Transform “${step.name}” has no operations.` })
          scope.add(step.saveAs)
          break
        case 'orion':
          if (!step.prompt.trim()) issues.push({ level: 'error', ...where, message: `Orion step “${step.name}” has no question.` })
          if (step.expects === 'decision' && !step.choices?.length) issues.push({ level: 'error', ...where, message: `Orion step “${step.name}” needs choices to decide between.` })
          missing(step.prompt)
          scope.add(step.saveAs)
          break
        case 'call': {
          const called = options.workflows?.find((w) => w.id === step.workflowId)
          if (!called) issues.push({ level: 'error', ...where, message: `Step “${step.name}” calls a workflow that doesn't exist.` })
          else {
            for (const input of called.inputs) if (input.required && step.inputs[input.name] === undefined && input.default === undefined) issues.push({ level: 'error', ...where, message: `Calling “${called.name}” needs its input “${input.label || input.name}”.` })
            if (callsItself(called, workflow.id, options.workflows ?? [])) issues.push({ level: 'error', ...where, message: `Calling “${called.name}” leads back to this workflow (a loop of calls).` })
          }
          missing(step.inputs)
          if (step.saveAs) scope.add(step.saveAs)
          break
        }
        case 'userAction':
          if (step.until) conditionIssues(step.until, where, scope, issues)
          break
        case 'confirm':
          missing(step.message)
          break
      }
    })
  }
  visit(workflow.steps, '', known)
  for (const output of workflow.outputs) {
    const root = output.from.split('.')[0]
    if (!known.has(root)) issues.push({ level: 'warning', message: `Output “${output.label || output.name}” reads {{${root}}}, which no step creates.` })
  }
  return issues
}

/** Whether a workflow's calls (directly or through others) reach a given workflow. */
export function callsItself(workflow: Workflow, targetId: string, all: Workflow[], seen = new Set<string>()): boolean {
  if (workflow.id === targetId) return true
  if (seen.has(workflow.id)) return false
  seen.add(workflow.id)
  let found = false
  walkSteps(workflow.steps, (step) => {
    if (found || step.type !== 'call') return
    const next = all.find((w) => w.id === step.workflowId)
    if (next && callsItself(next, targetId, all, seen)) found = true
  })
  return found
}

// ---------------------------------------------------------------- export and import

export interface WorkflowExport {
  format: typeof WORKFLOW_FORMAT
  exportedAt: number
  workflow: Workflow
}

/** A workflow ready to share: secret inputs, secret variables and sensitive step values are removed. */
export function exportWorkflow(workflow: Workflow, now = Date.now()): WorkflowExport {
  const copy: Workflow = JSON.parse(JSON.stringify(workflow))
  copy.inputs = copy.inputs.map((input) => (input.type === 'secret' ? { ...input, default: undefined } : input))
  const secretNames = new Set(copy.inputs.filter((i) => i.type === 'secret').map((i) => i.name))
  copy.variables = Object.fromEntries(Object.entries(copy.variables).filter(([name]) => !secretNames.has(name) && !/pass(word)?|secret|token|api.?key|cookie|otp/i.test(name)))
  walkSteps(copy.steps, (step) => {
    if (step.type === 'set' && step.sensitive) step.values = Object.fromEntries(Object.keys(step.values).map((k) => [k, '']))
  })
  copy.favorite = false
  copy.pinned = false
  delete copy.schedule
  return { format: WORKFLOW_FORMAT, exportedAt: now, workflow: copy }
}

/** Reads an exported workflow; throws a readable error for anything that isn't one. New ids keep it apart from existing workflows. */
export function importWorkflow(json: unknown, newId: () => string, now = Date.now()): Workflow {
  const data = (typeof json === 'string' ? JSON.parse(json) : json) as Partial<WorkflowExport>
  if (!data || typeof data !== 'object' || data.format !== WORKFLOW_FORMAT || !data.workflow) throw new Error('That is not an Orbis workflow export.')
  const w = data.workflow as Partial<Workflow>
  if (typeof w.name !== 'string' || !Array.isArray(w.steps)) throw new Error('The workflow is incomplete (it needs a name and steps).')
  const base = newWorkflow(w.name, newId(), now)
  const reid = (steps: unknown[]): WorkflowStep[] =>
    steps.map((raw) => {
      const step = { ...(raw as WorkflowStep) }
      if (!step || typeof step !== 'object' || typeof step.type !== 'string' || typeof step.name !== 'string') throw new Error('A step in the workflow is malformed.')
      if (!['action', 'if', 'repeat', 'set', 'wait', 'transform', 'orion', 'call', 'userAction', 'confirm'].includes(step.type)) throw new Error(`Unknown step type "${step.type}".`)
      step.id = newId()
      if (step.type === 'if') {
        step.then = reid(step.then ?? [])
        if (step.else) step.else = reid(step.else)
        if (step.elseIf) step.elseIf = step.elseIf.map((b) => ({ condition: b.condition, steps: reid(b.steps ?? []) }))
      }
      if (step.type === 'repeat') step.steps = reid(step.steps ?? [])
      return step
    })
  return {
    ...base,
    description: typeof w.description === 'string' ? w.description : '',
    icon: typeof w.icon === 'string' ? w.icon : base.icon,
    color: typeof w.color === 'string' ? w.color : base.color,
    createdBy: 'import',
    tags: Array.isArray(w.tags) ? w.tags.filter((t): t is string => typeof t === 'string') : [],
    template: w.template === true,
    inputs: Array.isArray(w.inputs) ? w.inputs : [],
    outputs: Array.isArray(w.outputs) ? w.outputs : [],
    variables: w.variables && typeof w.variables === 'object' ? w.variables : {},
    steps: reid(w.steps),
    trigger: w.trigger && typeof w.trigger === 'object' ? w.trigger : { type: 'manual' },
    settings: { ...base.settings, ...(w.settings && typeof w.settings === 'object' ? w.settings : {}) }
  }
}

// ---------------------------------------------------------------- execution history and statistics

/** One finished run of a workflow, as stored in its history. */
export interface WorkflowRunSummary {
  runId: string
  workflowId: string
  workflowName: string
  version: number
  source: ControlSource
  trigger: 'manual' | 'schedule' | 'event' | 'orion' | 'call'
  status: 'completed' | 'failed' | 'stopped'
  startedAt: number
  finishedAt: number
  durationMs: number
  stepsRun: number
  iterations?: number
  error?: ControlError & { stepPath?: string; stepLabel?: string }
  /** Outputs with sensitive values masked. */
  outputs?: Record<string, unknown>
  steps: StepRecord[]
}

export interface WorkflowStats {
  runs: number
  succeeded: number
  failed: number
  cancelled: number
  averageDurationMs: number
  retries: number
  lastRun?: { status: WorkflowRunSummary['status']; finishedAt: number }
  /** How often each step failed, by label. */
  stepFailures: Record<string, number>
  mostFrequentFailure?: string
}

export function workflowStats(runs: WorkflowRunSummary[]): WorkflowStats {
  const stepFailures: Record<string, number> = {}
  let retries = 0
  for (const run of runs) {
    for (const step of run.steps) {
      if ((step.attempts ?? 1) > 1) retries += (step.attempts ?? 1) - 1
      if (step.status === 'failed') {
        const key = step.label ?? step.action ?? step.path
        stepFailures[key] = (stepFailures[key] ?? 0) + 1
      }
    }
  }
  const latest = [...runs].sort((a, b) => b.finishedAt - a.finishedAt)[0]
  const mostFrequentFailure = Object.entries(stepFailures).sort((a, b) => b[1] - a[1])[0]?.[0]
  return {
    runs: runs.length,
    succeeded: runs.filter((r) => r.status === 'completed').length,
    failed: runs.filter((r) => r.status === 'failed').length,
    cancelled: runs.filter((r) => r.status === 'stopped').length,
    averageDurationMs: runs.length ? Math.round(runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length) : 0,
    retries,
    ...(latest ? { lastRun: { status: latest.status, finishedAt: latest.finishedAt } } : {}),
    stepFailures,
    ...(mostFrequentFailure ? { mostFrequentFailure } : {})
  }
}

// ---------------------------------------------------------------- what the window sees

export interface WorkflowVersion {
  version: number
  savedAt: number
  note?: string
  workflow: Workflow
}

/** Where an interrupted run can continue from. */
export interface WorkflowCheckpoint {
  runId: string
  workflowId: string
  version: number
  /** The top-level step to continue from. */
  nextTopIndex: number
  /** Variables safe to keep (nothing sensitive). */
  variables: Record<string, unknown>
  /** Inputs the run started with (secrets excluded). */
  inputs: Record<string, unknown>
  savedAt: number
}

/** A workflow run in progress. */
export interface ActiveWorkflowRun {
  runId: string
  workflowId: string
  workflowName: string
  version: number
  trigger: WorkflowRunSummary['trigger']
  debug: boolean
  state: RunState
}

/** A recording in progress. */
export interface RecordingState {
  active: boolean
  paused: boolean
  steps: ActionWorkflowStep[]
  /** Secret inputs created for private fields (their values are never recorded). */
  inputs: WorkflowInput[]
  startedAt: number
}

export interface WorkflowLibrary {
  workflows: Workflow[]
  stats: Record<string, WorkflowStats>
  nextRuns: Record<string, number>
  active: ActiveWorkflowRun[]
  checkpoints: WorkflowCheckpoint[]
  recording: RecordingState
  canRememberSecrets: boolean
}

export type WorkflowRunResult = { ok: true; run: ActiveWorkflowRun } | { ok: false; message: string; issues: WorkflowIssue[] }

/** The next time a schedule fires after `from`, or null when it won't fire again. */
export function nextScheduledRun(schedule: WorkflowSchedule, from: number): number | null {
  if (!schedule.enabled) return null
  if (schedule.kind === 'once') return schedule.at > from ? schedule.at : null
  const next = new Date(schedule.at)
  const guard = 5000
  for (let i = 0; next.getTime() <= from && i < guard; i++) {
    if (schedule.kind === 'daily') next.setDate(next.getDate() + 1)
    else if (schedule.kind === 'weekly') next.setDate(next.getDate() + 7)
    else next.setMonth(next.getMonth() + 1)
  }
  return next.getTime() > from ? next.getTime() : null
}
