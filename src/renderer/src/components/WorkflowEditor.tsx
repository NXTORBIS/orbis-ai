import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bug,
  CircleCheck,
  Copy,
  Eye,
  EyeOff,
  History,
  ListChecks,
  LoaderCircle,
  Play,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2
} from 'lucide-react'
import type { CapabilityDescriptor, ControlDomain, ParamSpec, StepRecord } from '../../../shared/browserControl'
import type { PlanLine } from '../../../shared/workflowCompile'
import type { ActiveWorkflowRun, Workflow, WorkflowInput, WorkflowIssue, WorkflowRunSummary, WorkflowStep, WorkflowVersion } from '../../../shared/workflows'
import type { NoticeKind } from '../App'
import { newId } from '../lib/utils'
import { branches, copyStep, findStep, insertStep, moveStep, newStep, removeStep, STEP_TYPES, stepSummary, updateStep } from '../lib/workflowSteps'
import { LiveRun, RunSummaryView } from './WorkflowRunPanel'

interface Props {
  workflowId: string
  runs: ActiveWorkflowRun[]
  records: Record<string, StepRecord[]>
  onBack(): void
  onNotify(text: string, kind?: NoticeKind): void
  onRun(workflow: Workflow, debug: boolean): void
}

type Tab = 'steps' | 'settings' | 'plan' | 'history' | 'versions'

/** A JSON value edited as text; applied when the text is valid JSON. */
function JsonField({ label, value, onChange, rows = 3, hint }: { label: string; value: unknown; onChange(value: unknown): void; rows?: number; hint?: string }): React.JSX.Element {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (focused.current) return
    setText(value === undefined ? '' : JSON.stringify(value, null, 2))
    setError(null)
  }, [value])
  return (
    <label className="wf-field">
      <span>{label}</span>
      <textarea
        className="hud-input compact wf-json"
        rows={rows}
        spellCheck={false}
        value={text}
        aria-invalid={Boolean(error)}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value.trim()) {
            setError(null)
            return onChange(undefined)
          }
          try {
            onChange(JSON.parse(e.target.value))
            setError(null)
          } catch {
            setError('Not valid JSON yet.')
          }
        }}
        onBlur={() => (focused.current = false)}
      />
      {error ? <small className="wf-bad">{error}</small> : hint ? <small className="wf-muted">{hint}</small> : null}
    </label>
  )
}

function TextField({ label, value, onChange, multiline, type = 'text', placeholder, hint }: { label: string; value: string | number | undefined; onChange(value: string): void; multiline?: boolean; type?: string; placeholder?: string; hint?: string }): React.JSX.Element {
  return (
    <label className="wf-field">
      <span>{label}</span>
      {multiline ? (
        <textarea className="hud-input compact" rows={3} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="hud-input compact" type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <small className="wf-muted">{hint}</small>}
    </label>
  )
}

/** A parameter's editor, from the capability's own description of it. Text fields also take {{variables}}. */
function ParamField({ name, spec, value, onChange }: { name: string; spec: ParamSpec; value: unknown; onChange(value: unknown): void }): React.JSX.Element {
  const label = `${name}${spec.required ? ' *' : ''}`
  if (spec.type === 'boolean') {
    return (
      <label className="wf-field">
        <span>{label}</span>
        <select className="hud-input compact" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
          <option value="">(not set)</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        <small className="wf-muted">{spec.description}</small>
      </label>
    )
  }
  if (spec.enum) {
    return (
      <label className="wf-field">
        <span>{label}</span>
        <select className="hud-input compact" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">(not set)</option>
          {spec.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <small className="wf-muted">{spec.description}</small>
      </label>
    )
  }
  if (spec.type === 'object' || spec.type === 'array' || spec.type === 'any') {
    return <JsonField label={label} value={value} onChange={onChange} hint={spec.description} rows={name === 'locator' ? 2 : 3} />
  }
  return (
    <TextField
      label={label}
      value={value === undefined ? '' : typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value)}
      hint={`${spec.description}${spec.sensitive ? ' (kept out of logs)' : ''}`}
      onChange={(text) => {
        if (text === '') return onChange(undefined)
        if ((spec.type === 'number' || spec.type === 'integer') && !text.includes('{{') && text.trim() !== '' && Number.isFinite(Number(text))) return onChange(spec.type === 'integer' ? Math.round(Number(text)) : Number(text))
        onChange(text)
      }}
    />
  )
}

const DOMAIN_ORDER: ControlDomain[] = ['navigation', 'page', 'tabs', 'groups', 'addressBar', 'browser', 'window', 'find', 'zoom', 'downloads', 'history', 'bookmarks', 'clipboard', 'extensions', 'permissions', 'settings', 'devtools', 'ui', 'shortcuts', 'workflows', 'state']

function StepProperties({ step, capabilities, workflows, onChange }: { step: WorkflowStep; capabilities: CapabilityDescriptor[]; workflows: Workflow[]; onChange(step: WorkflowStep): void }): React.JSX.Element {
  const set = (patch: Partial<WorkflowStep>): void => onChange({ ...step, ...patch } as WorkflowStep)
  const byDomain = useMemo(() => {
    const groups = new Map<string, CapabilityDescriptor[]>()
    for (const c of capabilities) groups.set(c.domain, [...(groups.get(c.domain) ?? []), c])
    return [...groups.entries()].sort((a, b) => DOMAIN_ORDER.indexOf(a[0] as ControlDomain) - DOMAIN_ORDER.indexOf(b[0] as ControlDomain))
  }, [capabilities])

  return (
    <div className="wf-props">
      <TextField label="Name" value={step.name} onChange={(name) => set({ name })} />
      <TextField label="Description" value={step.description ?? ''} onChange={(description) => set({ description: description || undefined })} />
      <label className="wf-check">
        <input type="checkbox" checked={step.enabled !== false} onChange={(e) => set({ enabled: e.target.checked ? undefined : false })} /> Enabled
      </label>

      {step.type === 'action' &&
        (() => {
          const capability = capabilities.find((c) => c.id === step.capability)
          return (
            <>
              <label className="wf-field">
                <span>Action</span>
                <select
                  className="hud-input compact"
                  value={step.capability}
                  onChange={(e) => {
                    const next = capabilities.find((c) => c.id === e.target.value)
                    set({ capability: e.target.value, params: Object.fromEntries(Object.entries(next?.params ?? {}).filter(([, p]) => p.required).map(([k, p]) => [k, p.type === 'object' ? {} : p.type === 'array' ? [] : p.type === 'boolean' ? false : ''])) } as Partial<WorkflowStep>)
                  }}
                >
                  {!capability && <option value={step.capability}>{step.capability} (not available)</option>}
                  {byDomain.map(([domain, list]) => (
                    <optgroup key={domain} label={domain}>
                      {list.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.id})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {capability && (
                  <small className="wf-muted">
                    {capability.description}
                    {capability.confirmation === 'always' ? ' Always asks you first.' : capability.confirmation === 'when-consequential' ? ' Asks you first when it is consequential.' : ''}
                  </small>
                )}
              </label>
              {capability &&
                Object.entries(capability.params).map(([name, spec]) => (
                  <ParamField key={name} name={name} spec={spec} value={step.params[name]} onChange={(value) => set({ params: Object.fromEntries(Object.entries({ ...step.params, [name]: value }).filter(([, v]) => v !== undefined)) } as Partial<WorkflowStep>)} />
                ))}
              <TextField label="Save result as variable" value={step.saveAs ?? ''} placeholder="e.g. apiKey" onChange={(saveAs) => set({ saveAs: saveAs.replace(/[^\w$-]/g, '') || undefined } as Partial<WorkflowStep>)} />
              <TextField label="Timeout (ms)" type="number" value={step.timeoutMs ?? ''} onChange={(v) => set({ timeoutMs: v ? Math.max(0, Number(v)) : undefined } as Partial<WorkflowStep>)} />
              <TextField label="Attempts" type="number" value={step.retry?.attempts ?? ''} hint="Tries in total when the action fails in a way that may pass on retry." onChange={(v) => set({ retry: v ? { ...step.retry, attempts: Math.min(5, Math.max(1, Number(v))) } : undefined } as Partial<WorkflowStep>)} />
              <JsonField label="Expected state afterwards" value={step.expect} onChange={(expect) => set({ expect: expect as never } as Partial<WorkflowStep>)} hint='A condition that must be true after the action, e.g. {"check":"textContains","text":"Saved"}.' />
              <label className="wf-check">
                <input type="checkbox" checked={step.optional === true} onChange={(e) => set({ optional: e.target.checked || undefined } as Partial<WorkflowStep>)} /> Continue even if this step fails
              </label>
            </>
          )
        })()}

      {step.type === 'if' && (
        <>
          <JsonField label="Condition" value={step.condition} onChange={(condition) => condition && set({ condition: condition as never } as Partial<WorkflowStep>)} rows={4} hint='Checked against the real browser, e.g. {"check":"elementExists","locator":{"text":"Sign out"}}.' />
          {(step.elseIf ?? []).map((branch, i) => (
            <JsonField key={i} label={`Else if ${i + 1} condition`} value={branch.condition} onChange={(condition) => condition && set({ elseIf: (step.elseIf ?? []).map((b, n) => (n === i ? { ...b, condition: condition as never } : b)) } as Partial<WorkflowStep>)} />
          ))}
          <div className="wf-inline">
            <button type="button" className="text-btn" onClick={() => set({ elseIf: [...(step.elseIf ?? []), { condition: { check: 'textContains', text: '' }, steps: [] }] } as Partial<WorkflowStep>)}>
              Add else if
            </button>
            {(step.elseIf ?? []).length > 0 && (
              <button type="button" className="text-btn" onClick={() => set({ elseIf: (step.elseIf ?? []).slice(0, -1) } as Partial<WorkflowStep>)}>
                Remove last else if
              </button>
            )}
          </div>
        </>
      )}

      {step.type === 'repeat' &&
        (() => {
          const mode = step.forEach !== undefined ? 'forEach' : step.times !== undefined ? 'times' : step.while ? 'while' : step.until ? 'until' : 'forever'
          const setMode = (next: string): void =>
            set({ times: next === 'times' ? 3 : undefined, forEach: next === 'forEach' ? '{{items}}' : undefined, while: next === 'while' ? { check: 'elementExists', locator: { text: 'Next' } } : undefined, until: next === 'until' ? { check: 'textContains', text: 'Done' } : undefined, forever: next === 'forever' ? true : undefined } as Partial<WorkflowStep>)
          return (
            <>
              <label className="wf-field">
                <span>Repeat</span>
                <select className="hud-input compact" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="times">A number of times</option>
                  <option value="forEach">For each item in a list</option>
                  <option value="while">While a condition is true</option>
                  <option value="until">Until a condition is true</option>
                  <option value="forever">Until stopped</option>
                </select>
              </label>
              {mode === 'times' && <TextField label="Times" value={step.times === undefined ? '' : String(step.times)} hint="A number, or a {{variable}}." onChange={(v) => set({ times: /^\d+$/.test(v) ? Number(v) : v } as Partial<WorkflowStep>)} />}
              {mode === 'forEach' && (
                <>
                  <TextField label="List" value={typeof step.forEach === 'string' ? step.forEach : JSON.stringify(step.forEach)} hint="A {{variable}} holding a list, e.g. {{results.values}}." onChange={(v) => set({ forEach: v } as Partial<WorkflowStep>)} />
                  <TextField label="Call each item" value={step.as ?? 'item'} onChange={(as) => set({ as: as.replace(/[^\w$-]/g, '') || undefined } as Partial<WorkflowStep>)} />
                </>
              )}
              {mode === 'while' && <JsonField label="While" value={step.while} onChange={(v) => v && set({ while: v as never } as Partial<WorkflowStep>)} />}
              {mode === 'until' && <JsonField label="Until" value={step.until} onChange={(v) => v && set({ until: v as never } as Partial<WorkflowStep>)} />}
              <TextField label="At most (iterations)" type="number" value={step.max ?? ''} hint="Protects against loops that never end." onChange={(v) => set({ max: v ? Math.max(1, Number(v)) : undefined } as Partial<WorkflowStep>)} />
            </>
          )
        })()}

      {step.type === 'set' && (
        <>
          <JsonField label="Values" value={step.values} rows={4} onChange={(values) => values && typeof values === 'object' && set({ values: values as Record<string, unknown> } as Partial<WorkflowStep>)} hint='e.g. {"greeting": "Hello {{name}}"}' />
          <label className="wf-check">
            <input type="checkbox" checked={step.sensitive === true} onChange={(e) => set({ sensitive: e.target.checked || undefined } as Partial<WorkflowStep>)} /> Private (masked everywhere, never exported)
          </label>
        </>
      )}

      {step.type === 'wait' && (
        <>
          <JsonField label="Until" value={step.until} onChange={(until) => set({ until: until as never } as Partial<WorkflowStep>)} hint="Leave empty to wait a fixed time instead." />
          {step.until ? (
            <TextField label="Give up after (ms)" type="number" value={step.timeoutMs ?? 30_000} onChange={(v) => set({ timeoutMs: Number(v) || undefined } as Partial<WorkflowStep>)} />
          ) : (
            <TextField label="Wait (ms)" type="number" value={step.ms ?? 1000} onChange={(v) => set({ ms: Number(v) || 0 } as Partial<WorkflowStep>)} />
          )}
        </>
      )}

      {step.type === 'transform' && (
        <>
          <TextField label="Input" value={typeof step.input === 'string' ? step.input : JSON.stringify(step.input)} hint="A value or {{variable}}." onChange={(input) => set({ input } as Partial<WorkflowStep>)} />
          <JsonField label="Operations" value={step.operations} rows={4} onChange={(operations) => Array.isArray(operations) && set({ operations } as Partial<WorkflowStep>)} hint='In order, e.g. [{"op":"trim"},{"op":"regex","pattern":"#(\\d+)"},{"op":"number"}]. Ops: trim, lowercase, uppercase, replace, split, join, substring, regex, number, formatNumber, parseJson, toJson, urlEncode, urlDecode, base64Encode, base64Decode, date, get, map, filter, sort, slice, first, last, length, unique.' />
          <TextField label="Save as" value={step.saveAs} onChange={(saveAs) => set({ saveAs: saveAs.replace(/[^\w$-]/g, '') } as Partial<WorkflowStep>)} />
        </>
      )}

      {step.type === 'orion' && (
        <>
          <TextField label="Question" multiline value={step.prompt} onChange={(prompt) => set({ prompt } as Partial<WorkflowStep>)} />
          <fieldset className="wf-fieldset">
            <legend>Orion may use</legend>
            {(['pageText', 'url', 'title', 'variables', 'selection'] as const).map((part) => (
              <label key={part} className="wf-check">
                <input type="checkbox" checked={step.include.includes(part)} onChange={(e) => set({ include: e.target.checked ? [...step.include, part] : step.include.filter((p) => p !== part) } as Partial<WorkflowStep>)} /> {part}
              </label>
            ))}
          </fieldset>
          <label className="wf-field">
            <span>Answer as</span>
            <select className="hud-input compact" value={step.expects} onChange={(e) => set({ expects: e.target.value as 'value' } as Partial<WorkflowStep>)}>
              <option value="value">A value</option>
              <option value="decision">A choice between options</option>
              <option value="boolean">Yes or no</option>
              <option value="json">Structured data (JSON)</option>
            </select>
          </label>
          {step.expects === 'decision' && <TextField label="Choices (one per line)" multiline value={(step.choices ?? []).join('\n')} onChange={(v) => set({ choices: v.split('\n').map((c) => c.trim()).filter(Boolean) } as Partial<WorkflowStep>)} />}
          <TextField label="Minimum confidence (0-1)" type="number" value={step.minConfidence ?? ''} hint="Below this, the run pauses so you can check Orion's answer." onChange={(v) => set({ minConfidence: v === '' ? undefined : Math.min(1, Math.max(0, Number(v))) } as Partial<WorkflowStep>)} />
          <TextField label="Save as" value={step.saveAs} onChange={(saveAs) => set({ saveAs: saveAs.replace(/[^\w$-]/g, '') } as Partial<WorkflowStep>)} />
        </>
      )}

      {step.type === 'call' && (
        <>
          <label className="wf-field">
            <span>Workflow</span>
            <select className="hud-input compact" value={step.workflowId} onChange={(e) => set({ workflowId: e.target.value } as Partial<WorkflowStep>)}>
              <option value="">Choose…</option>
              {workflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
          <JsonField label="Inputs" value={step.inputs} onChange={(inputs) => inputs && typeof inputs === 'object' && set({ inputs: inputs as Record<string, unknown> } as Partial<WorkflowStep>)} hint='e.g. {"email": "{{email}}"}' />
          <TextField label="Save outputs as" value={step.saveAs ?? ''} onChange={(saveAs) => set({ saveAs: saveAs.replace(/[^\w$-]/g, '') || undefined } as Partial<WorkflowStep>)} />
        </>
      )}

      {step.type === 'userAction' && (
        <>
          <TextField label="What you need to do" multiline value={step.message} onChange={(message) => set({ message } as Partial<WorkflowStep>)} />
          <JsonField label="Continue only when" value={step.until} onChange={(until) => set({ until: until as never } as Partial<WorkflowStep>)} hint="Orbis checks this after you continue, e.g. that you are signed in." />
        </>
      )}

      {step.type === 'confirm' && <TextField label="What will happen" multiline value={step.message} onChange={(message) => set({ message } as Partial<WorkflowStep>)} />}
    </div>
  )
}

function StepTree({
  steps,
  selectedId,
  issues,
  runningPath,
  onSelect,
  onAdd,
  onMove,
  onCopy,
  onRemove,
  onToggle,
  depth = 0,
  parent
}: {
  steps: WorkflowStep[]
  selectedId: string | null
  issues: WorkflowIssue[]
  runningPath?: string
  onSelect(id: string): void
  onAdd(where: { afterId?: string; parentId?: string; branch?: string }): void
  onMove(id: string, delta: -1 | 1): void
  onCopy(id: string): void
  onRemove(id: string): void
  onToggle(id: string): void
  depth?: number
  parent?: { id: string; branch: string }
}): React.JSX.Element {
  return (
    <ol className="wf-tree" style={{ '--depth': depth } as React.CSSProperties}>
      {steps.map((step, i) => {
        const stepIssues = issues.filter((issue) => issue.stepId === step.id)
        const running = Boolean(runningPath && step.name && runningPath.includes(step.name))
        return (
          <li key={step.id} className={`wf-step${step.id === selectedId ? ' selected' : ''}${step.enabled === false ? ' disabled' : ''}${stepIssues.some((x) => x.level === 'error') ? ' error' : ''}${running ? ' running' : ''}`}>
            <div className="wf-step-row">
              <button type="button" className="wf-step-main" onClick={() => onSelect(step.id)} aria-current={step.id === selectedId}>
                <span className="wf-step-type">{STEP_TYPES.find((t) => t.type === step.type)?.label}</span>
                <b className="truncate">{step.name}</b>
                <small className="truncate">{stepSummary(step)}</small>
                {stepIssues.map((issue, n) => (
                  <small key={n} className={issue.level === 'error' ? 'wf-bad' : 'wf-warn'}>
                    {issue.message}
                  </small>
                ))}
              </button>
              <span className="wf-step-actions">
                <button type="button" className="b-icon" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => onMove(step.id, -1)}>
                  <ArrowUp size={12} />
                </button>
                <button type="button" className="b-icon" aria-label="Move down" title="Move down" disabled={i === steps.length - 1} onClick={() => onMove(step.id, 1)}>
                  <ArrowDown size={12} />
                </button>
                <button type="button" className="b-icon" aria-label={step.enabled === false ? 'Enable step' : 'Disable step'} title={step.enabled === false ? 'Enable' : 'Disable'} onClick={() => onToggle(step.id)}>
                  {step.enabled === false ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button type="button" className="b-icon" aria-label="Duplicate step" title="Duplicate" onClick={() => onCopy(step.id)}>
                  <Copy size={12} />
                </button>
                <button type="button" className="b-icon danger" aria-label="Delete step" title="Delete" onClick={() => onRemove(step.id)}>
                  <Trash2 size={12} />
                </button>
                <button type="button" className="b-icon" aria-label="Add a step after this one" title="Add after" onClick={() => onAdd({ afterId: step.id })}>
                  <Plus size={12} />
                </button>
              </span>
            </div>
            {branches(step).map((branch) => (
              <div key={branch.key} className="wf-branch">
                <span className="wf-branch-label">{branch.label}</span>
                <StepTree
                  steps={branch.steps}
                  selectedId={selectedId}
                  issues={issues}
                  runningPath={runningPath}
                  onSelect={onSelect}
                  onAdd={onAdd}
                  onMove={onMove}
                  onCopy={onCopy}
                  onRemove={onRemove}
                  onToggle={onToggle}
                  depth={depth + 1}
                  parent={{ id: step.id, branch: branch.key }}
                />
              </div>
            ))}
          </li>
        )
      })}
      {parent && (
        <li className="wf-step-add">
          <button type="button" className="text-btn" onClick={() => onAdd({ parentId: parent.id, branch: parent.branch })}>
            <Plus size={12} /> Add step here
          </button>
        </li>
      )}
    </ol>
  )
}

/**
 * Builds and edits one workflow: its steps (as a tree of real, editable steps), their settings from each capability's
 * own parameters, the workflow's inputs, outputs, trigger, schedule and permissions, plan mode, its runs and versions,
 * and changes described to Orion. Edits stay local until saved, and validation runs as you edit.
 */
export default function WorkflowEditor({ workflowId, runs, records, onBack, onNotify, onRun }: Props): React.JSX.Element {
  const [workflow, setWorkflow] = useState<Workflow | null>(null)
  const [saved, setSaved] = useState<Workflow | null>(null)
  const [tab, setTab] = useState<Tab>('steps')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [issues, setIssues] = useState<WorkflowIssue[]>([])
  const [capabilities, setCapabilities] = useState<CapabilityDescriptor[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [adding, setAdding] = useState<{ afterId?: string; parentId?: string; branch?: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [change, setChange] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [plan, setPlan] = useState<{ lines: PlanLine[]; issues: WorkflowIssue[] } | null>(null)
  const [history, setHistory] = useState<WorkflowRunSummary[]>([])
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [versions, setVersions] = useState<WorkflowVersion[]>([])

  const dirty = Boolean(workflow && saved && JSON.stringify(workflow) !== JSON.stringify(saved))

  useEffect(() => {
    void window.api.getWorkflow(workflowId).then((w) => {
      setWorkflow(w)
      setSaved(w)
      setSelectedId(w?.steps[0]?.id ?? null)
    })
    void window.api.getControlCapabilities().then(setCapabilities)
    void window.api.getWorkflowLibrary().then((lib) => setWorkflows(lib.workflows.filter((w) => w.id !== workflowId)))
  }, [workflowId])

  // Validation follows every edit (debounced), against the capabilities Orbis really has.
  useEffect(() => {
    if (!workflow) return
    const timer = window.setTimeout(() => void window.api.validateWorkflow(workflow).then(setIssues).catch(() => undefined), 300)
    return () => window.clearTimeout(timer)
  }, [workflow])

  useEffect(() => {
    if (tab === 'plan' && saved) void window.api.planWorkflow(saved.id).then(setPlan)
    if (tab === 'history') void window.api.workflowHistory(workflowId).then(setHistory)
    if (tab === 'versions') void window.api.workflowVersions(workflowId).then((v) => setVersions([...v].reverse()))
  }, [tab, saved, workflowId])

  // A finished run of this workflow shows up in history straight away.
  useEffect(() => window.api.onWorkflowRunFinished((summary) => summary.workflowId === workflowId && void window.api.workflowHistory(workflowId).then(setHistory)), [workflowId])

  const activeRun = runs.find((r) => r.workflowId === workflowId)

  if (!workflow) {
    return (
      <div className="images-empty">
        <LoaderCircle size={22} className="spin" />
      </div>
    )
  }

  const edit = (patch: Partial<Workflow>): void => setWorkflow((w) => (w ? { ...w, ...patch } : w))
  const editSteps = (change: (steps: WorkflowStep[]) => WorkflowStep[]): void => setWorkflow((w) => (w ? { ...w, steps: change(w.steps) } : w))
  const selected = selectedId ? findStep(workflow.steps, selectedId) : null
  const errors = issues.filter((i) => i.level === 'error')

  const save = async (note?: string): Promise<Workflow | null> => {
    setSaving(true)
    try {
      const result = await window.api.saveWorkflow(workflow, note)
      setWorkflow(result)
      setSaved(result)
      onNotify(`Saved “${result.name}” (version ${result.version}).`)
      return result
    } catch (err) {
      onNotify(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`, 'error')
      return null
    } finally {
      setSaving(false)
    }
  }

  const run = async (debug: boolean): Promise<void> => {
    const current = dirty ? await save() : workflow
    if (current) onRun(current, debug)
  }

  const askOrion = async (): Promise<void> => {
    if (!change.trim()) return
    setDrafting(true)
    try {
      const updated = await window.api.draftWorkflow(change, dirty ? undefined : workflow.id)
      // The change comes back as unsaved edits to review; nothing is saved or run.
      setWorkflow(dirty ? { ...workflow, steps: updated.steps, inputs: updated.inputs, outputs: updated.outputs } : { ...updated, id: workflow.id })
      setChange('')
      onNotify('Orion updated the steps. Review them, then save.')
    } catch (err) {
      onNotify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setDrafting(false)
    }
  }

  const updateInput = (index: number, patch: Partial<WorkflowInput>): void => edit({ inputs: workflow.inputs.map((input, i) => (i === index ? { ...input, ...patch } : input)) })

  return (
    <section className="images-view wf-editor" aria-label={`Edit ${workflow.name}`}>
      <header className="images-head wf-editor-head">
        <button type="button" className="sb-icon" aria-label="Back to workflows" title="Back" onClick={() => (dirty && !window.confirm('Leave without saving your changes?') ? undefined : onBack())}>
          <ArrowLeft size={18} />
        </button>
        <input className="hud-input wf-title" value={workflow.name} aria-label="Workflow name" onChange={(e) => edit({ name: e.target.value })} />
        <span className="hud-label">
          v{workflow.version}
          {dirty ? ' · unsaved' : ''}
          {errors.length ? ` · ${errors.length} to fix` : issues.length ? ` · ${issues.length} note${issues.length === 1 ? '' : 's'}` : ' · ready'}
        </span>
        <div className="wf-head-actions">
          <button type="button" className="queue-btn" disabled={!dirty || saving} onClick={() => void save()}>
            <Save size={11} /> Save
          </button>
          <button type="button" className="queue-btn" disabled={!dirty} onClick={() => saved && setWorkflow(saved)} title="Discard unsaved changes">
            <Undo2 size={11} /> Revert
          </button>
          <button type="button" className="queue-btn" disabled={errors.length > 0 || Boolean(activeRun)} onClick={() => void run(true)} title="Run step by step">
            <Bug size={11} /> Debug
          </button>
          <button type="button" className="queue-btn primary" disabled={errors.length > 0 || Boolean(activeRun)} onClick={() => void run(false)}>
            <Play size={11} /> Run
          </button>
        </div>
      </header>

      <nav className="wf-tabs" aria-label="Workflow sections">
        {(
          [
            ['steps', 'Steps', ListChecks],
            ['settings', 'Settings', Settings2],
            ['plan', 'Plan', CircleCheck],
            ['history', 'History', History],
            ['versions', 'Versions', Undo2]
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} type="button" className={`wf-tab${tab === id ? ' active' : ''}`} aria-pressed={tab === id} onClick={() => setTab(id)}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </nav>

      <div className="wf-editor-body">
        {tab === 'steps' && (
          <>
            <div className="wf-col wf-col-steps">
              <form
                className="wf-orion"
                onSubmit={(e) => {
                  e.preventDefault()
                  void askOrion()
                }}
              >
                <Sparkles size={14} aria-hidden="true" />
                <input className="hud-input compact" value={change} placeholder="Describe a change for Orion, e.g. “after extracting the key, copy it to the clipboard”" aria-label="Describe a change for Orion" onChange={(e) => setChange(e.target.value)} />
                <button type="submit" className="queue-btn" disabled={drafting || !change.trim()}>
                  {drafting ? <LoaderCircle size={11} className="spin" /> : 'Apply'}
                </button>
              </form>
              {workflow.steps.length === 0 ? (
                <div className="images-empty">
                  <ListChecks size={24} />
                  <p>No steps yet.</p>
                  <button type="button" className="queue-btn primary" onClick={() => setAdding({})}>
                    <Plus size={11} /> Add the first step
                  </button>
                </div>
              ) : (
                <StepTree
                  steps={workflow.steps}
                  selectedId={selectedId}
                  issues={issues}
                  runningPath={activeRun?.state.currentStep}
                  onSelect={setSelectedId}
                  onAdd={setAdding}
                  onMove={(id, delta) => editSteps((steps) => moveStep(steps, id, delta))}
                  onCopy={(id) => {
                    const step = findStep(workflow.steps, id)
                    if (step) editSteps((steps) => insertStep(steps, copyStep(step, newId), { afterId: id }))
                  }}
                  onRemove={(id) => {
                    editSteps((steps) => removeStep(steps, id))
                    if (selectedId === id) setSelectedId(null)
                  }}
                  onToggle={(id) => editSteps((steps) => updateStep(steps, id, (s) => ({ ...s, enabled: s.enabled === false ? undefined : false }) as WorkflowStep))}
                />
              )}
              {workflow.steps.length > 0 && (
                <button type="button" className="text-btn wf-add-end" onClick={() => setAdding({})}>
                  <Plus size={12} /> Add a step at the end
                </button>
              )}
              {adding && (
                <div className="wf-add-menu popover glass" role="menu">
                  {STEP_TYPES.map((t) => (
                    <button
                      key={t.type}
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        const step = newStep(t.type, newId())
                        editSteps((steps) => insertStep(steps, step, adding))
                        setSelectedId(step.id)
                        setAdding(null)
                      }}
                    >
                      <span>
                        <b>{t.label}</b>
                        <small>{t.description}</small>
                      </span>
                    </button>
                  ))}
                  <button type="button" role="menuitem" className="menu-item" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <div className="wf-col wf-col-props">
              {activeRun ? (
                <LiveRun run={activeRun} records={records[activeRun.runId] ?? []} />
              ) : selected ? (
                <StepProperties key={selected.id} step={selected} capabilities={capabilities} workflows={workflows} onChange={(next) => editSteps((steps) => updateStep(steps, next.id, () => next))} />
              ) : (
                <p className="wf-muted">Select a step to edit it.</p>
              )}
              {!activeRun && issues.filter((i) => !i.stepId).length > 0 && (
                <ul className="wf-issues">
                  {issues
                    .filter((i) => !i.stepId)
                    .map((issue, n) => (
                      <li key={n} className={issue.level === 'error' ? 'wf-bad' : 'wf-warn'}>
                        {issue.message}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </>
        )}

        {tab === 'settings' && (
          <div className="wf-col wf-settings">
            <TextField label="Description" multiline value={workflow.description} onChange={(description) => edit({ description })} />
            <div className="wf-inline">
              <TextField label="Icon (emoji)" value={workflow.icon} onChange={(icon) => edit({ icon: icon.slice(0, 4) || '⚡' })} />
              <label className="wf-field">
                <span>Color</span>
                <input type="color" value={workflow.color} onChange={(e) => edit({ color: e.target.value })} />
              </label>
              <TextField label="Tags (comma separated)" value={workflow.tags.join(', ')} onChange={(v) => edit({ tags: v.split(',').map((t) => t.trim()).filter(Boolean) })} />
            </div>

            <h3>Inputs</h3>
            {workflow.inputs.map((input, i) => (
              <div key={i} className="wf-inline wf-input-row">
                <TextField label="Name" value={input.name} onChange={(name) => updateInput(i, { name: name.replace(/[^\w$-]/g, '') })} />
                <TextField label="Label" value={input.label} onChange={(label) => updateInput(i, { label })} />
                <label className="wf-field">
                  <span>Type</span>
                  <select className="hud-input compact" value={input.type} onChange={(e) => updateInput(i, { type: e.target.value as WorkflowInput['type'] })}>
                    {['string', 'number', 'boolean', 'url', 'secret', 'date', 'array', 'object'].map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                {input.type !== 'secret' && <TextField label="Default" value={input.default === undefined ? '' : String(input.default)} onChange={(v) => updateInput(i, { default: v === '' ? undefined : v })} />}
                <label className="wf-check">
                  <input type="checkbox" checked={input.required === true} onChange={(e) => updateInput(i, { required: e.target.checked })} /> Required
                </label>
                <button type="button" className="b-icon danger" aria-label="Remove input" onClick={() => edit({ inputs: workflow.inputs.filter((_, n) => n !== i) })}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="text-btn" onClick={() => edit({ inputs: [...workflow.inputs, { name: `input${workflow.inputs.length + 1}`, label: 'New input', type: 'string' }] })}>
              <Plus size={12} /> Add input
            </button>

            <h3>Outputs</h3>
            {workflow.outputs.map((output, i) => (
              <div key={i} className="wf-inline wf-input-row">
                <TextField label="Name" value={output.name} onChange={(name) => edit({ outputs: workflow.outputs.map((o, n) => (n === i ? { ...o, name: name.replace(/[^\w$-]/g, '') } : o)) })} />
                <TextField label="From variable" value={output.from} placeholder="e.g. apiKey" onChange={(from) => edit({ outputs: workflow.outputs.map((o, n) => (n === i ? { ...o, from } : o)) })} />
                <label className="wf-check">
                  <input type="checkbox" checked={output.sensitive === true} onChange={(e) => edit({ outputs: workflow.outputs.map((o, n) => (n === i ? { ...o, sensitive: e.target.checked } : o)) })} /> Private
                </label>
                <button type="button" className="b-icon danger" aria-label="Remove output" onClick={() => edit({ outputs: workflow.outputs.filter((_, n) => n !== i) })}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <button type="button" className="text-btn" onClick={() => edit({ outputs: [...workflow.outputs, { name: `output${workflow.outputs.length + 1}`, from: '' }] })}>
              <Plus size={12} /> Add output
            </button>

            <JsonField label="Starting variables" value={workflow.variables} onChange={(variables) => variables && typeof variables === 'object' && edit({ variables: variables as Record<string, unknown> })} />

            <h3>When it runs</h3>
            <label className="wf-field">
              <span>Start automatically</span>
              <select
                className="hud-input compact"
                value={workflow.trigger.type}
                onChange={(e) => edit({ trigger: (e.target.value === 'manual' ? { type: 'manual' } : e.target.value === 'appStart' ? { type: 'appStart' } : { type: e.target.value }) as Workflow['trigger'] })}
              >
                <option value="manual">Only when I run it</option>
                <option value="appStart">When Orbis starts</option>
                <option value="tabOpened">When a tab opens</option>
                <option value="navigationCompleted">When a page finishes loading</option>
                <option value="downloadCompleted">When a download completes</option>
              </select>
            </label>
            {(workflow.trigger.type === 'tabOpened' || workflow.trigger.type === 'navigationCompleted') && (
              <TextField label="Only for addresses matching" value={workflow.trigger.urlMatches ?? ''} hint="Text or a regular expression. Empty: any page." onChange={(urlMatches) => edit({ trigger: { ...workflow.trigger, urlMatches: urlMatches || undefined } as Workflow['trigger'] })} />
            )}
            {workflow.trigger.type === 'downloadCompleted' && (
              <TextField label="Only for file names matching" value={workflow.trigger.nameMatches ?? ''} onChange={(nameMatches) => edit({ trigger: { type: 'downloadCompleted', nameMatches: nameMatches || undefined } })} />
            )}
            <div className="wf-inline">
              <label className="wf-check">
                <input type="checkbox" checked={workflow.schedule?.enabled === true} onChange={(e) => edit({ schedule: { kind: 'daily', at: Date.now() + 3_600_000, ...workflow.schedule, enabled: e.target.checked } })} /> Run on a schedule (while Orbis is open)
              </label>
              {workflow.schedule?.enabled && (
                <>
                  <select className="hud-input compact" value={workflow.schedule.kind} aria-label="How often" onChange={(e) => edit({ schedule: { ...workflow.schedule!, kind: e.target.value as 'daily' } })}>
                    <option value="once">Once</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                  <input
                    className="hud-input compact"
                    type="datetime-local"
                    aria-label="Starting at"
                    value={new Date(workflow.schedule.at - new Date(workflow.schedule.at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
                    onChange={(e) => e.target.value && edit({ schedule: { ...workflow.schedule!, at: new Date(e.target.value).getTime() } })}
                  />
                </>
              )}
            </div>

            <h3>Safety</h3>
            <label className="wf-field">
              <span>When a step fails</span>
              <select className="hud-input compact" value={workflow.settings.onFailure} onChange={(e) => edit({ settings: { ...workflow.settings, onFailure: e.target.value as 'pause' } })}>
                <option value="pause">Pause, so I can fix it and continue</option>
                <option value="stop">Stop the run</option>
              </select>
            </label>
            <div className="wf-inline">
              <TextField label="Loop limit" type="number" value={workflow.settings.maxIterations} onChange={(v) => edit({ settings: { ...workflow.settings, maxIterations: Math.max(1, Number(v) || 1) } })} />
              <TextField label="Run time limit (minutes)" type="number" value={workflow.settings.timeoutMs ? workflow.settings.timeoutMs / 60_000 : ''} onChange={(v) => edit({ settings: { ...workflow.settings, timeoutMs: v ? Number(v) * 60_000 : undefined } })} />
            </div>
            <fieldset className="wf-fieldset">
              <legend>May use (none checked: anything)</legend>
              {DOMAIN_ORDER.map((domain) => (
                <label key={domain} className="wf-check">
                  <input
                    type="checkbox"
                    checked={workflow.settings.permissions.includes(domain)}
                    onChange={(e) => edit({ settings: { ...workflow.settings, permissions: e.target.checked ? [...workflow.settings.permissions, domain] : workflow.settings.permissions.filter((p) => p !== domain) } })}
                  />{' '}
                  {domain}
                </label>
              ))}
            </fieldset>
            <label className="wf-check">
              <input type="checkbox" checked={workflow.template} onChange={(e) => edit({ template: e.target.checked })} /> Use as a template for new workflows
            </label>
          </div>
        )}

        {tab === 'plan' && (
          <div className="wf-col">
            {dirty && <p className="wf-warn">This plan is of the saved version. Save to see your latest changes.</p>}
            {!plan ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <>
                <p className="wf-muted">What a run would do. Nothing is carried out here.</p>
                <ol className="wf-plan">
                  {plan.lines.map((line) => (
                    <li key={line.path} className={line.disabled ? 'disabled' : ''} style={{ paddingLeft: `${line.depth * 18 + 4}px` }}>
                      <span className="wf-plan-path">{line.path}</span>
                      <span>{line.text}</span>
                      {line.changes && <span className="wf-badge">changes things</span>}
                      {line.approval === 'always' && <span className="wf-badge warn">asks you first</span>}
                      {line.approval === 'when-consequential' && <span className="wf-badge">may ask first</span>}
                      {line.disabled && <span className="wf-badge">disabled</span>}
                    </li>
                  ))}
                </ol>
                {plan.issues.length > 0 && (
                  <ul className="wf-issues">
                    {plan.issues.map((issue, n) => (
                      <li key={n} className={issue.level === 'error' ? 'wf-bad' : 'wf-warn'}>
                        {issue.path ? `Step ${issue.path}: ` : ''}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <>
            <div className="wf-col wf-col-steps">
              {history.length === 0 ? (
                <p className="wf-muted">This workflow hasn't run yet.</p>
              ) : (
                <ol className="wf-history">
                  {history.map((h) => (
                    <li key={h.runId}>
                      <button type="button" className={`wf-history-row${openRun === h.runId ? ' selected' : ''}`} onClick={() => setOpenRun(h.runId)}>
                        <span className={`wf-status ${h.status}`}>{h.status}</span>
                        <span>{new Date(h.startedAt).toLocaleString()}</span>
                        <small className="wf-muted">
                          {Math.round(h.durationMs / 1000)} s · {h.stepsRun} steps · {h.trigger}
                        </small>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="wf-col wf-col-props">{openRun && history.find((h) => h.runId === openRun) ? <RunSummaryView summary={history.find((h) => h.runId === openRun)!} /> : <p className="wf-muted">Choose a run to see each step.</p>}</div>
          </>
        )}

        {tab === 'versions' && (
          <div className="wf-col">
            <p className="wf-muted">Each save that changes the steps or settings keeps the previous version.</p>
            {versions.length === 0 ? (
              <p className="wf-muted">No earlier versions yet.</p>
            ) : (
              <ol className="wf-history">
                {versions.map((v) => (
                  <li key={v.version} className="wf-version">
                    <span>
                      <b>Version {v.version}</b> · {new Date(v.savedAt).toLocaleString()} · {v.workflow.steps.length} top-level steps{v.note ? ` · ${v.note}` : ''}
                    </span>
                    <button
                      type="button"
                      className="queue-btn"
                      disabled={dirty}
                      onClick={() =>
                        void window.api.restoreWorkflowVersion(workflow.id, v.version).then((restored) => {
                          setWorkflow(restored)
                          setSaved(restored)
                          onNotify(`Restored version ${v.version} as version ${restored.version}.`)
                          void window.api.workflowVersions(workflowId).then((list) => setVersions([...list].reverse()))
                        })
                      }
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
