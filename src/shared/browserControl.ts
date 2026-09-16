import type { TransformOp } from './workflows.ts'

/**
 * The Orbis Browser Control Layer's shared vocabulary: capabilities (what Orbis can do right now), commands (a request to
 * do one of them), results (what really happened, verified), plans (multi-step work with variables, conditions and
 * repetition) and the runs that carry plans out. The same types are used by the Orbis window, Orion's browser agent
 * and any future automation, so there is one control surface for all of them.
 */

export type ControlDomain =
  | 'tabs'
  | 'groups'
  | 'navigation'
  | 'addressBar'
  | 'page'
  | 'ui'
  | 'browser'
  | 'window'
  | 'zoom'
  | 'find'
  | 'settings'
  | 'downloads'
  | 'history'
  | 'bookmarks'
  | 'clipboard'
  | 'extensions'
  | 'permissions'
  | 'devtools'
  | 'shortcuts'
  | 'workflows'
  | 'notes'
  | 'tasks'
  | 'clips'
  | 'whiteboard'
  | 'state'

/** Who asked: the person using Orbis, Orion's browser agent, or an automation run. */
export type ControlSource = 'user' | 'orion' | 'automation'

export interface ParamSpec {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'any'
  description: string
  required?: boolean
  enum?: string[]
  /** Never logged or shown in run status (typed text that may be private, clipboard contents). */
  sensitive?: boolean
}

/** What must be true, or who must act, for a capability to run. */
export type ControlRequirement = 'browser-open' | 'web-page' | 'user-interaction' | 'website-permission' | 'extension-permission' | 'authentication' | 'elevated'

/**
 * When the user must approve: never; always (consequential: deleting data, installing, changing security settings);
 * or when the action itself turns out to be consequential (a click that submits, buys or sends, decided per call).
 * Confirmation applies to Orion and automations; the person using Orbis already chose to act.
 */
export type ConfirmationPolicy = 'none' | 'always' | 'when-consequential'

export interface CapabilityDescriptor {
  /** Stable id, "domain.action", e.g. "tabs.create". */
  id: string
  domain: ControlDomain
  name: string
  description: string
  params: Record<string, ParamSpec>
  /** Changes browser state (as opposed to only reading it). */
  mutates: boolean
  confirmation: ConfirmationPolicy
  requires: ControlRequirement[]
  /** Where it runs: the main process, or the Orbis window (tabs, groups, address bar and other state the window owns). */
  provider: 'main' | 'window'
  /** Whether it can run right now, and why not. */
  available: boolean
  unavailableReason?: string
}

export interface ControlTarget {
  /** An Orbis tab id, as the browser state lists it. */
  tabId?: string
  /** A tab's page by its WebContents id. */
  webContentsId?: number
}

export interface RetryPolicy {
  /** Total attempts, including the first (1-5). */
  attempts?: number
  /** Wait between attempts. */
  delayMs?: number
  /** Alternative parameter sets to try in turn after a failure (for example other element locators). */
  alternatives?: Record<string, unknown>[]
}

export interface BrowserCommand {
  capability: string
  params?: Record<string, unknown>
  target?: ControlTarget
  source?: ControlSource
  /** Why, in a few words, for the log and approval prompts. */
  reason?: string
  retry?: RetryPolicy
  /** Skip verification (for a caller that verifies itself). */
  skipVerify?: boolean
}

export type ControlErrorCode =
  | 'unknown-capability'
  | 'unavailable'
  | 'invalid-params'
  | 'not-found'
  | 'stale-element'
  | 'declined'
  | 'blocked'
  | 'timeout'
  | 'failed'
  | 'verification-failed'
  | 'aborted'

export interface ControlError {
  code: ControlErrorCode
  message: string
  /** Trying again (after waiting, with fresh state or another locator) may work. */
  recoverable: boolean
}

export interface CommandResult<T = unknown> {
  ok: boolean
  capability: string
  data?: T
  error?: ControlError
  /** How the outcome was checked against real browser state after acting. */
  verification?: { verified: boolean; detail: string }
  attempts: number
  durationMs: number
}

// ---------------------------------------------------------------- plans

/** A state check, answered from the real browser at the moment it is evaluated. */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | ({ check: ConditionCheck } & Record<string, unknown>)

export type ConditionCheck =
  | 'elementExists'
  | 'elementMissing'
  | 'textContains'
  | 'textMissing'
  | 'urlMatches'
  | 'pageLoaded'
  | 'downloadCompleted'
  | 'tabExists'
  | 'windowExists'
  | 'extensionExists'
  | 'settingEquals'
  | 'variableExists'
  | 'compare'
  | 'capabilityAvailable'

/** Every step can have an id, a label, and be switched off. */
export interface StepMeta {
  id?: string
  label?: string
  /** A disabled step is skipped. */
  enabled?: boolean
}

export interface ActionStep extends StepMeta {
  /** A capability id. */
  do: string
  /** The step fails when the action takes longer than this. */
  timeoutMs?: number
  params?: Record<string, unknown>
  target?: ControlTarget
  /** Stores the result's data in this variable. */
  saveAs?: string
  /** The run continues when this step fails (otherwise a failure stops or pauses the run). */
  optional?: boolean
  retry?: RetryPolicy
  /** Checked after the step; the step fails if it isn't true. */
  expect?: Condition
}

export type PlanStep =
  | ActionStep
  | (StepMeta & { if: Condition; then: PlanStep[]; else?: PlanStep[] })
  | (StepMeta & {
      repeat: {
        /** A count, or a {{variable}} holding one. */
        times?: number | string
        /** Stop when this becomes true (checked after each iteration). */
        until?: Condition
        /** Continue while this is true (checked before each iteration). */
        while?: Condition
        /** Iterate over an array: a {{variable}}, or a literal list. */
        forEach?: string | unknown[]
        /** The loop variable's name for forEach (default "item"); "index" always holds the iteration number. */
        as?: string
        /** Upper bound on iterations for until/while/forever loops (default 1000). */
        max?: number
        /** Repeat until the run is stopped. */
        forever?: boolean
      }
      steps: PlanStep[]
    })
  | (StepMeta & { set: Record<string, unknown>; sensitive?: boolean })
  | (StepMeta & { wait: { ms?: number; until?: Condition; timeoutMs?: number; pollMs?: number } })
  /** Deterministic data transformation (no AI): trim, regex, split, parse JSON, filter, sort… */
  | (StepMeta & { transform: { input: unknown; operations: TransformOp[]; saveAs: string } })
  /** Orion answers a question about real state, as structured data with a confidence. */
  | (StepMeta & { ask: { prompt: string; include: ('pageText' | 'url' | 'title' | 'variables' | 'selection')[]; expects: 'decision' | 'value' | 'boolean' | 'json'; choices?: string[]; minConfidence?: number; saveAs: string } })
  /** Runs another workflow with its own variables, returning its outputs. */
  | (StepMeta & { call: { workflowId: string; inputs: Record<string, unknown>; saveAs?: string } })
  /** Pauses for the user (signing in, a CAPTCHA, a choice), then checks the expected state before continuing. */
  | (StepMeta & { userAction: { message: string; until?: Condition } })
  /** Asks the user to confirm before continuing. */
  | (StepMeta & { confirm: { message: string } })

export interface Plan {
  name: string
  steps: PlanStep[]
  /** Values the run returns when it ends, read from its variables. */
  outputs?: { name: string; from: string; sensitive?: boolean }[]
  /** Starting variables (user-provided values, Orion-generated values). */
  variables?: Record<string, unknown>
  /** Variable names never shown in status or logs. */
  sensitiveVariables?: string[]
  /** On a failed critical step: stop the run (default), or pause it so the user can fix things and resume. */
  onFailure?: 'stop' | 'pause'
}

export type RunStatus = 'running' | 'paused' | 'waiting-confirmation' | 'waiting-user' | 'stopping' | 'stopped' | 'completed' | 'failed'

/** "step" runs the next action and pauses again (debugging). */
export type RunControl = 'pause' | 'resume' | 'stop' | 'skip' | 'restart-step' | 'stop-after-iteration' | 'step'

/** What happened in one step of a run, for execution history and debugging. */
export interface StepRecord {
  runId: string
  path: string
  stepId?: string
  label?: string
  kind: 'action' | 'if' | 'repeat' | 'set' | 'wait' | 'transform' | 'ask' | 'call' | 'userAction' | 'confirm'
  action?: string
  status: 'success' | 'failed' | 'skipped' | 'cancelled'
  startedAt: number
  durationMs: number
  attempts?: number
  iteration?: number
  error?: ControlError
  verification?: { verified: boolean; detail: string }
  /** A short, redacted summary of the result. */
  summary?: unknown
}

export interface RunState {
  id: string
  name: string
  source: ControlSource
  status: RunStatus
  /** Path of the step being run, e.g. "2 › repeat › 1". */
  currentStep?: string
  currentAction?: string
  iteration?: number
  totalIterations?: number
  /** Variables with sensitive ones redacted. */
  variables: Record<string, unknown>
  lastResult?: CommandResult
  error?: ControlError
  startedAt: number
  finishedAt?: number
  stepsRun: number
  /** Top-level steps done and in total. */
  stepIndex?: number
  stepCount?: number
  /** Why the run is waiting: for the user to do something, to confirm, or at a debugger pause. */
  waitingFor?: { kind: 'user' | 'confirmation' | 'debugger'; message: string }
  /** The run's outputs (sensitive ones redacted), once it ends. */
  outputs?: Record<string, unknown>
}

// ---------------------------------------------------------------- state

/** A browser tab as the control layer sees it: the Orbis window's own tab state. */
export interface ControlTab {
  id: string
  index: number
  /** Its page's WebContents id, once the page exists. */
  webContentsId: number | null
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  pinned: boolean
  private: boolean
  muted: boolean
  audible: boolean
  groupId: string | null
  zoom: number
  error: string | null
  crashed: boolean
  active: boolean
}

export interface ControlGroup {
  id: string
  name: string
  color: string
  collapsed: boolean
  tabIds: string[]
}

/** What the Orbis window reports about its browser, whenever it changes. */
export interface WindowBrowserState {
  open: boolean
  hidden: boolean
  mode: 'full' | 'window' | 'dock' | null
  tabs: ControlTab[]
  groups: ControlGroup[]
  activeTabId: string | null
  /** The tab that was active before the current one ("the tab I was just using"). */
  previousTabId: string | null
  closedTabs: { url: string; title: string; index: number }[]
  split: { left: string; right: string } | null
  find: { open: boolean; text: string; activeMatch: number; matches: number }
  addressBar: { value: string; editing: boolean; focused: boolean; suggestions: { index: number; kind: string; text: string; url?: string }[] }
  panel: 'history' | 'downloads' | 'bookmarks' | 'closed' | null
  /** Sites waiting for an answer to a permission request. */
  permissionRequests: { id: string; origin: string; permission: string; label: string }[]
  updatedAt: number
}

/** What the Orbis window answers after carrying out one of its capabilities. */
export interface WindowRunResult {
  ok: boolean
  data?: unknown
  error?: ControlError
  verification?: { verified: boolean; detail: string }
}

/** A request from the main process for the window to carry out one of its capabilities. */
export interface WindowRunRequest {
  callId: string
  capability: string
  params: Record<string, unknown>
  target: ControlTarget | null
  source: ControlSource
}

/** An approval Orbis asks the user for before Orion or an automation does something consequential. */
export interface ControlConfirmRequest {
  id: string
  capability: string
  action: string
  reason: string
  source: ControlSource
}

// ---------------------------------------------------------------- helpers (pure)

/** Checks params against a capability's spec; returns a message for the first problem, or null. */
export function validateParams(spec: Record<string, ParamSpec>, params: Record<string, unknown>): string | null {
  for (const [name, p] of Object.entries(spec)) {
    const value = params[name]
    if (value === undefined || value === null) {
      if (p.required) return `"${name}" is required: ${p.description}`
      continue
    }
    const ok =
      p.type === 'any' ||
      (p.type === 'string' && typeof value === 'string') ||
      (p.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
      (p.type === 'integer' && Number.isInteger(value)) ||
      (p.type === 'boolean' && typeof value === 'boolean') ||
      (p.type === 'array' && Array.isArray(value)) ||
      (p.type === 'object' && typeof value === 'object' && !Array.isArray(value))
    if (!ok) return `"${name}" must be ${p.type === 'integer' ? 'a whole number' : `a ${p.type}`}.`
    if (p.enum && !p.enum.includes(String(value))) return `"${name}" must be one of: ${p.enum.join(', ')}.`
  }
  for (const name of Object.keys(params)) if (!(name in spec)) return `Unknown parameter "${name}". Expected: ${Object.keys(spec).join(', ') || 'none'}.`
  return null
}

/** Reads a dotted path ("result.items.0.title") from a value. */
export function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const part of path.split('.').filter(Boolean)) {
    if (current === null || current === undefined) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

const WHOLE = /^\{\{\s*([\w.$-]+)\s*\}\}$/
const PART = /\{\{\s*([\w.$-]+)\s*\}\}/g

/** Replaces {{variable}} references. A value that is only a reference keeps its type (an array stays an array). */
export function interpolate(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = WHOLE.exec(value)
    if (whole) return readPath(variables, whole[1])
    return value.replace(PART, (_m, path: string) => {
      const found = readPath(variables, path)
      return found === undefined || found === null ? '' : typeof found === 'object' ? JSON.stringify(found) : String(found)
    })
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, variables))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolate(v, variables)]))
  return value
}

/** Parameter and variable names whose values never appear in logs. */
const SECRET_NAME = /pass(word)?|secret|token|otp|one.?time|credit|card|cvv|cvc|ssn|api.?key|cookie|auth/i

/** A copy safe to log: sensitive fields, secret-looking names and long text are masked or shortened. */
export function redact(value: unknown, sensitive: Set<string> = new Set(), depth = 0): unknown {
  if (depth > 5) return '…'
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}… (${value.length} chars)` : value
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, sensitive, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sensitive.has(k) || SECRET_NAME.test(k) ? (v === undefined || v === '' ? v : '[redacted]') : redact(v, sensitive, depth + 1)])
    )
  }
  return value
}
