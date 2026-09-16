import type { WorkflowStep, WorkflowStepType } from '../../../shared/workflows'

/** The kinds of step a workflow can have, in the order the "Add step" menu offers them. */
export const STEP_TYPES: { type: WorkflowStepType; label: string; description: string }[] = [
  { type: 'action', label: 'Action', description: 'Do something in Orbis: open a page, click, type, extract, manage tabs…' },
  { type: 'if', label: 'If / else', description: 'Choose steps depending on what the browser shows right now.' },
  { type: 'repeat', label: 'Repeat', description: 'Run steps several times, for each item, while or until something is true.' },
  { type: 'set', label: 'Set variable', description: 'Store values to use in later steps.' },
  { type: 'wait', label: 'Wait', description: 'Wait for a condition (or a fixed time).' },
  { type: 'transform', label: 'Transform data', description: 'Trim, extract with a pattern, split, convert — no AI needed.' },
  { type: 'orion', label: 'Ask Orion', description: 'Let Orion decide or extract something, as structured data.' },
  { type: 'call', label: 'Run a workflow', description: 'Run another saved workflow and use its outputs.' },
  { type: 'userAction', label: 'Wait for me', description: 'Pause so you can sign in or do something yourself.' },
  { type: 'confirm', label: 'Confirm', description: 'Ask you before continuing.' }
]

export function newStep(type: WorkflowStepType, id: string): WorkflowStep {
  switch (type) {
    case 'action':
      return { id, type, name: 'Open a page', capability: 'navigation.go', params: { url: '' } }
    case 'if':
      return { id, type, name: 'If', condition: { check: 'textContains', text: '' }, then: [], else: [] }
    case 'repeat':
      return { id, type, name: 'Repeat', times: 3, steps: [] }
    case 'set':
      return { id, type, name: 'Set variable', values: { value: '' } }
    case 'wait':
      return { id, type, name: 'Wait', until: { check: 'pageLoaded' }, timeoutMs: 15_000 }
    case 'transform':
      return { id, type, name: 'Transform', input: '', operations: [{ op: 'trim' }], saveAs: 'result' }
    case 'orion':
      return { id, type, name: 'Ask Orion', prompt: '', include: ['pageText', 'url', 'title'], expects: 'value', saveAs: 'answer' }
    case 'call':
      return { id, type, name: 'Run another workflow', workflowId: '', inputs: {} }
    case 'userAction':
      return { id, type, name: 'Wait for me', message: 'Do this in the browser, then continue.' }
    case 'confirm':
      return { id, type, name: 'Confirm', message: 'Continue?' }
  }
}

type Branch = { key: string; label: string; steps: WorkflowStep[] }

/** A step's child step lists: then / else if / else for an if, the loop body for a repeat. */
export function branches(step: WorkflowStep): Branch[] {
  if (step.type === 'if') {
    return [
      { key: 'then', label: 'Then', steps: step.then },
      ...(step.elseIf ?? []).map((b, i) => ({ key: `elseIf${i}`, label: `Else if ${i + 1}`, steps: b.steps })),
      { key: 'else', label: 'Else', steps: step.else ?? [] }
    ]
  }
  if (step.type === 'repeat') return [{ key: 'loop', label: 'Repeat these', steps: step.steps }]
  return []
}

export function withBranch(step: WorkflowStep, key: string, steps: WorkflowStep[]): WorkflowStep {
  if (step.type === 'repeat' && key === 'loop') return { ...step, steps }
  if (step.type === 'if') {
    if (key === 'then') return { ...step, then: steps }
    if (key === 'else') return { ...step, else: steps }
    const index = Number(key.slice('elseIf'.length))
    return { ...step, elseIf: (step.elseIf ?? []).map((b, i) => (i === index ? { ...b, steps } : b)) }
  }
  return step
}

/** Applies a change to every step list in the tree (the top level and every branch). */
function mapLists(steps: WorkflowStep[], change: (list: WorkflowStep[]) => WorkflowStep[]): WorkflowStep[] {
  return change(steps).map((step) => branches(step).reduce((s, b) => withBranch(s, b.key, mapLists(b.steps, change)), step))
}

export function findStep(steps: WorkflowStep[], id: string): WorkflowStep | null {
  for (const step of steps) {
    if (step.id === id) return step
    for (const b of branches(step)) {
      const found = findStep(b.steps, id)
      if (found) return found
    }
  }
  return null
}

export const updateStep = (steps: WorkflowStep[], id: string, change: (step: WorkflowStep) => WorkflowStep): WorkflowStep[] =>
  mapLists(steps, (list) => list.map((s) => (s.id === id ? change(s) : s)))

export const removeStep = (steps: WorkflowStep[], id: string): WorkflowStep[] => mapLists(steps, (list) => list.filter((s) => s.id !== id))

/** Moves a step up (-1) or down (+1) within its own list. */
export const moveStep = (steps: WorkflowStep[], id: string, delta: -1 | 1): WorkflowStep[] =>
  mapLists(steps, (list) => {
    const i = list.findIndex((s) => s.id === id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= list.length) return list
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

/** Inserts a step after another (in the same list), or at the end of a branch, or at the end of the workflow. */
export function insertStep(steps: WorkflowStep[], step: WorkflowStep, where: { afterId?: string; parentId?: string; branch?: string }): WorkflowStep[] {
  if (where.parentId && where.branch) {
    const parent = findStep(steps, where.parentId)
    if (!parent) return steps
    const current = branches(parent).find((b) => b.key === where.branch)?.steps ?? []
    return updateStep(steps, where.parentId, (p) => withBranch(p, where.branch!, [...current, step]))
  }
  if (where.afterId) {
    return mapLists(steps, (list) => {
      const i = list.findIndex((s) => s.id === where.afterId)
      return i < 0 ? list : [...list.slice(0, i + 1), step, ...list.slice(i + 1)]
    })
  }
  return [...steps, step]
}

/** A copy of a step (and everything inside it) with new ids. */
export function copyStep(step: WorkflowStep, newId: () => string): WorkflowStep {
  const copy = { ...step, id: newId(), name: `${step.name} (copy)` } as WorkflowStep
  return branches(copy).reduce((s, b) => withBranch(s, b.key, b.steps.map((child) => ({ ...copyStep(child, newId), name: child.name }))), copy)
}

export function countSteps(steps: WorkflowStep[]): number {
  return steps.reduce((sum, step) => sum + 1 + branches(step).reduce((n, b) => n + countSteps(b.steps), 0), 0)
}

/** One line saying what a step does, for the step list. */
export function stepSummary(step: WorkflowStep): string {
  const short = (value: unknown): string => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > 48 ? `${text.slice(0, 45)}…` : text
  }
  switch (step.type) {
    case 'action': {
      const main = step.params.url ?? step.params.locator ?? step.params.text ?? step.params.query ?? ''
      return `${step.capability}${main ? ` · ${short(main)}` : ''}${step.saveAs ? ` → {{${step.saveAs}}}` : ''}`
    }
    case 'if':
      return `if ${short(step.condition)}`
    case 'repeat':
      return step.forEach !== undefined ? `for each in ${short(step.forEach)}` : step.times !== undefined ? `${String(step.times)} times` : step.while ? `while ${short(step.while)}` : step.until ? `until ${short(step.until)}` : 'until stopped'
    case 'set':
      return Object.keys(step.values).map((k) => `{{${k}}}`).join(', ')
    case 'wait':
      return step.until ? `until ${short(step.until)}` : `${Math.round((step.ms ?? 0) / 100) / 10}s`
    case 'transform':
      return `${step.operations.map((o) => o.op).join(' → ')} → {{${step.saveAs}}}`
    case 'orion':
      return `${short(step.prompt)} → {{${step.saveAs}}}`
    case 'call':
      return step.workflowId ? `workflow ${step.workflowId.slice(0, 8)}` : 'choose a workflow'
    case 'userAction':
      return short(step.message)
    case 'confirm':
      return short(step.message)
  }
}
