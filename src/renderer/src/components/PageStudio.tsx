import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Download,
  FileWarning,
  Info,
  Layers,
  Play,
  Plus,
  Send,
  Sparkles,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Upload,
  Wrench,
  X
} from 'lucide-react'
import type { NoticeKind } from '../lib/notices'
import {
  BUILDER_LIMITS,
  argumentsFor,
  computationsAfter,
  initialState,
  setField as setFieldValue,
  type Component,
  type ComponentKind,
  type Computation,
  type Field,
  type FieldType,
  type PageDocument,
  type RunState
} from '../../../shared/pages/builder'
import { whatToRun } from '../../../shared/pages/validation'
import type { Rendered } from '../../../shared/pages/visual'
import type { PageAuditElement, PageCard, PageComputeResult } from '../../../shared/types'

/**
 * The parts of Orbis Pages that are not a Page: building one, packaging one, and finding out why one is misbehaving.
 *
 * Three screens that share one rule — **nothing here decides anything.** Every judgement comes from a pure module in
 * `shared/pages` through the main process: `check` says whether a built Page can run, `readPackage` says what is in a
 * file, `classify` says whose fault a fault is, and `audit` says what it could not check. This file renders those
 * answers and hands input back. A second opinion living in the renderer is how a screen ends up disagreeing with the
 * thing it is showing.
 */

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

// ================================================================ the builder

const FIELD_TYPES: { id: FieldType; label: string; describe: string }[] = [
  { id: 'number', label: 'Number', describe: 'A value somebody types or drags.' },
  { id: 'text', label: 'Text', describe: 'A line of writing.' },
  { id: 'boolean', label: 'Yes or no', describe: 'A switch.' },
  { id: 'choice', label: 'Choice', describe: 'One of a set of options.' },
  { id: 'quantity', label: 'Quantity', describe: 'A number with a unit attached.' },
  { id: 'table', label: 'Table', describe: 'Rows and columns.' },
  { id: 'result', label: 'Result', describe: 'Whatever a computation works out. Not editable.' }
]

const COMPONENT_KINDS: { id: ComponentKind; label: string; group: string }[] = [
  { id: 'heading', label: 'Heading', group: 'Content' },
  { id: 'paragraph', label: 'Paragraph', group: 'Content' },
  { id: 'note', label: 'Note', group: 'Content' },
  { id: 'divider', label: 'Divider', group: 'Content' },
  { id: 'group', label: 'Group', group: 'Layout' },
  { id: 'row', label: 'Row', group: 'Layout' },
  { id: 'column', label: 'Column', group: 'Layout' },
  { id: 'number-input', label: 'Number box', group: 'Input' },
  { id: 'text-input', label: 'Text box', group: 'Input' },
  { id: 'checkbox', label: 'Switch', group: 'Input' },
  { id: 'choice', label: 'Choice', group: 'Input' },
  { id: 'slider', label: 'Slider', group: 'Input' },
  { id: 'quantity-input', label: 'Quantity box', group: 'Input' },
  { id: 'value', label: 'Value', group: 'Output' },
  { id: 'statistic', label: 'Statistic', group: 'Output' },
  { id: 'table', label: 'Table', group: 'Output' },
  { id: 'plot', label: 'Plot', group: 'Output' },
  { id: 'button', label: 'Button', group: 'Action' }
]

/** The operations a built Page may run. The same names the engine door accepts, so nothing here can invent one. */
const OPERATIONS = [
  'units.convert',
  'units.parse',
  'expression.evaluate',
  'expression.simplify',
  'expression.differentiate',
  'solver.solve',
  'statistics.summarise',
  'statistics.correlate',
  'statistics.histogram',
  'plot.function',
  'plot.axis',
  'measurement.combine',
  'measurement.repeated',
  'optimise.interval',
  'simulate.integrate'
]

/** A starting document, so the builder opens on something that already works rather than a blank page. */
const STARTER: PageDocument = {
  fields: [
    { name: 'celsius', type: 'number', label: 'Celsius', initial: 20 },
    { name: 'fahrenheit', type: 'result', label: 'Fahrenheit', computed: true }
  ],
  components: [
    { id: 'h', kind: 'heading', text: 'Temperature' },
    { id: 'c', kind: 'number-input', field: 'celsius', label: 'Celsius' },
    { id: 'f', kind: 'value', field: 'fahrenheit', label: 'Fahrenheit' }
  ],
  computations: [
    {
      name: 'convert',
      operation: 'units.convert',
      inputs: { value: { field: 'celsius' }, from: { value: 'degC' }, to: { value: 'degF' } },
      writes: 'fahrenheit',
      when: 'change'
    }
  ]
}

interface CheckAnswer {
  problems: { at: string; severity: 'error' | 'warning'; message: string; code: string }[]
  canRun: boolean
  operations: string[]
  unusedFields: string[]
}

/**
 * Running a built Page: its values, and the calculations a change sets off.
 *
 * One hook for every Page that is a `PageDocument` -- the one being built in the builder, and the ones Orbis built
 * for somebody. A second copy would be a second answer to what happens when a field changes, and the copy is the one
 * that ends up wrong: it is the copy that forgets to follow a chain, or to stop on a refusal.
 *
 * Every calculation goes through `pages:compute`, under the identity of a real Page, so a Page running here is
 * checked against the capabilities that Page was granted exactly as it would be anywhere else.
 */
export function useDocumentRunner(
  document: PageDocument,
  pageId: string,
  onNotify: (message: string, kind?: NoticeKind) => void,
  /**
   * Whether this Page is one that has been built and not yet kept.
   *
   * It changes which door the calculations go through, and that is not a detail. `pages:compute` resolves the Page in
   * the register first, and a Page waiting to be kept is not in the register -- so without this the preview somebody
   * is deciding about can run nothing at all, and every answer on it reads "nothing yet".
   */
  pending = false
): {
  state: RunState
  running: boolean
  change(name: string, value: unknown): Promise<void>
  run(name: string): Promise<void>
  reset(): void
} {
  const [state, setState] = useState<RunState>(() => initialState(document))
  const [running, setRunning] = useState(false)

  // The starting values change whenever the fields do, so nothing holds a value for a field that is gone.
  useEffect(() => {
    setState(initialState(document))
  }, [document.fields])

  /**
   * Worked out once, on opening.
   *
   * Without this a Page opens showing "nothing yet" beside every answer until somebody touches a control, which
   * reads as a Page that is broken rather than one that is waiting. Its starting values are real values -- the
   * specification gave them, and generation already ran the Page with exactly these and checked what came back -- so
   * there is an answer to show and no reason to make somebody produce it.
   *
   * Only the calculations that happen on their own. A button still waits to be pressed.
   */
  useEffect(() => {
    let cancelled = false
    const start = initialState(document)
    // The same list, in the same order, that generation ran the Page with before anybody was offered it. One
    // implementation, so what a Page shows on opening is what was checked.
    const named = new Set(whatToRun(document).run)
    const first = document.computations.filter((one) => named.has(one.name))
    if (first.length === 0) return
    void (async () => {
      // Read through a ref so this does not depend on `carry`, which changes with `state` and would restart the
      // opening run on its own first result.
      if (!cancelled) await openingRun.current(start, first)
    })()
    return () => {
      cancelled = true
    }
  }, [document])

  /**
   * The opening run, held in a ref.
   *
   * `carry` is rebuilt whenever `state` changes, so an effect depending on it would fire again the moment its own
   * first result landed, and again after that -- a Page that recalculates itself for ever. The ref is the same
   * object across renders, so the effect above depends only on the document.
   */
  const openingRun = useRef<(from: RunState, computations: readonly Computation[]) => Promise<void>>(async () => {})

  /** A list of computations run in order, each seeing what the one before it wrote. */
  const carry = useCallback(
    async (from: RunState, computations: readonly Computation[]): Promise<void> => {
      if (computations.length === 0) return
      let current = from
      setRunning(true)
      try {
        for (const computation of computations) {
          const input = argumentsFor(computation, current)
          const result = (pending
            ? await window.api.pagesGenerateTry(pageId, computation.operation, input as Record<string, unknown>)
            : await window.api.pagesCompute({
                pageId,
                operation: computation.operation,
                input: input as Record<string, unknown>
              })) as PageComputeResult
          if (!result || !('ok' in result) || !result.ok) {
            // The engine's own sentence, against the field that was being worked out.
            onNotify(`${computation.name}: ${(result as { message?: string })?.message ?? 'that did not work'}`, 'error')
            continue
          }
          // An engine that refuses the numbers says so inside its answer rather than by failing the request. A check
          // that noticed only the envelope would write the refusal into the field as though it were a result.
          const value = result.value
          if (value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false) {
            onNotify(`${computation.name}: ${String((value as { message?: unknown }).message ?? 'that did not work')}`, 'error')
            continue
          }
          const written = setFieldValue(document, current, computation.writes, value ?? null)
          if (!('code' in written)) {
            current = written
            setState(current)
          }
        }
      } finally {
        setRunning(false)
      }
    },
    [document, pageId, onNotify, pending]
  )

  /**
   * A field changed, and whatever that sets off.
   *
   * The order comes from `computationsAfter`, which follows the chain -- so a field computed from a field computed
   * from this one updates too, and in the right order. `check` has already refused any cycle, so this cannot loop.
   */
  const change = useCallback(
    async (name: string, value: unknown) => {
      const next = setFieldValue(document, state, name, value)
      if ('code' in next) {
        onNotify(next.message, 'error')
        return
      }
      setState(next)
      await carry(next, computationsAfter(document, name))
    },
    [document, state, onNotify, carry]
  )

  /** A button pressed. Only the one calculation it names, and then whatever that sets off. */
  const run = useCallback(
    async (name: string) => {
      const computation = document.computations.find((one) => one.name === name)
      if (computation === undefined) return
      await carry(state, [computation, ...computationsAfter(document, computation.writes)])
    },
    [document, state, carry]
  )

  openingRun.current = carry

  const reset = useCallback(() => setState(initialState(document)), [document])

  return { state, running, change, run, reset }
}

export function BuilderPanel({
  pageId,
  onNotify
}: {
  /** A Page whose capabilities the preview runs under. The builder has no identity of its own. */
  pageId: string
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [document, setDocument] = useState<PageDocument>(STARTER)
  const [answer, setAnswer] = useState<CheckAnswer | null>(null)
  const [tab, setTab] = useState<'fields' | 'components' | 'computations'>('fields')
  // The one runner, shared with every other Page that is a document. See `useDocumentRunner`.
  const { state, running, change } = useDocumentRunner(document, pageId, onNotify)

  /**
   * Checked on every edit.
   *
   * At build time rather than when somebody clicks: a Page that opens and then fails on the first interaction is worse
   * than one that refuses to be saved, because the first kind gets shared before anybody notices.
   */
  useEffect(() => {
    let cancelled = false
    void window.api.pagesCheckDocument(document).then((result) => {
      if (cancelled || refused(result)) return
      setAnswer(result)
    })
    return () => {
      cancelled = true
    }
  }, [document])

  const errors = answer?.problems.filter((one) => one.severity === 'error') ?? []
  const warnings = answer?.problems.filter((one) => one.severity === 'warning') ?? []

  const patchField = (at: number, over: Partial<Field>): void =>
    setDocument((current) => ({
      ...current,
      fields: current.fields.map((one, i) => (i === at ? { ...one, ...over } : one))
    }))

  const patchComponent = (at: number, over: Partial<Component>): void =>
    setDocument((current) => ({
      ...current,
      components: current.components.map((one, i) => (i === at ? { ...one, ...over } : one))
    }))

  const patchComputation = (at: number, over: Partial<Computation>): void =>
    setDocument((current) => ({
      ...current,
      computations: current.computations.map((one, i) => (i === at ? { ...one, ...over } : one))
    }))

  return (
    <div className="studio">
      <div className="studio-note" role="note">
        <Info size={14} />
        <div>
          <b>A Page built here contains no code at all.</b> It is a description of what to show and what to work out, so
          there is nothing in it that could do something you did not ask for. That is also its limit: it can only do
          what these pieces can express, and there is nowhere to put custom code.
        </div>
      </div>

      <div className="studio-split">
        {/* ---------------------------------------------------------------- the editor */}
        <div className="studio-edit">
          <div className="page-chips" role="tablist" aria-label="What to edit">
            {(['fields', 'components', 'computations'] as const).map((one) => (
              <button
                key={one}
                type="button"
                role="tab"
                aria-selected={tab === one}
                className={`page-chip${tab === one ? ' on' : ''}`}
                onClick={() => setTab(one)}
              >
                {one}{' '}
                <b>
                  {one === 'fields'
                    ? document.fields.length
                    : one === 'components'
                      ? document.components.length
                      : document.computations.length}
                </b>
              </button>
            ))}
          </div>

          {tab === 'fields' && (
            <ul className="studio-list">
              {document.fields.map((field, at) => (
                <li key={at}>
                  <div className="page-row">
                    <label className="page-field">
                      <span>Name</span>
                      <input
                        value={field.name}
                        spellCheck={false}
                        onChange={(e) => patchField(at, { name: e.target.value })}
                      />
                    </label>
                    <label className="page-field">
                      <span>Label</span>
                      <input value={field.label} onChange={(e) => patchField(at, { label: e.target.value })} />
                    </label>
                    <label className="page-field">
                      <span>Type</span>
                      <select
                        value={field.type}
                        onChange={(e) => patchField(at, { type: e.target.value as FieldType })}
                      >
                        {FIELD_TYPES.map((one) => (
                          <option key={one.id} value={one.id} title={one.describe}>
                            {one.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="studio-inline">
                      <input
                        type="checkbox"
                        checked={field.computed === true}
                        onChange={(e) => patchField(at, { computed: e.target.checked })}
                      />
                      <span title="A computation writes this, so nobody can edit it">worked out</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${field.name}`}
                      onClick={() =>
                        setDocument((c) => ({ ...c, fields: c.fields.filter((_v, i) => i !== at) }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {field.type === 'choice' && (
                    <input
                      className="studio-wide"
                      aria-label="Options, comma separated" placeholder="Options, comma separated"
                      value={(field.options ?? []).map((one) => one.value).join(', ')}
                      onChange={(e) =>
                        patchField(at, {
                          options: e.target.value
                            .split(',')
                            .map((one) => one.trim())
                            .filter((one) => one !== '')
                            .map((one) => ({ value: one, label: one }))
                        })
                      }
                    />
                  )}
                  {field.type === 'quantity' && (
                    <input
                      className="studio-wide"
                      aria-label="Unit for this field" placeholder="Unit, like m/s or degC"
                      value={field.unit ?? ''}
                      spellCheck={false}
                      onChange={(e) => patchField(at, { unit: e.target.value })}
                    />
                  )}
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="queue-btn small"
                  disabled={document.fields.length >= BUILDER_LIMITS.fields}
                  onClick={() =>
                    setDocument((c) => ({
                      ...c,
                      fields: [
                        ...c.fields,
                        { name: `field${c.fields.length + 1}`, type: 'number', label: 'New field' }
                      ]
                    }))
                  }
                >
                  <Plus size={13} /> Field
                </button>
              </li>
            </ul>
          )}

          {tab === 'components' && (
            <ul className="studio-list">
              {document.components.map((component, at) => (
                <li key={at}>
                  <div className="page-row">
                    <label className="page-field">
                      <span>Shows</span>
                      <select
                        value={component.kind}
                        onChange={(e) => patchComponent(at, { kind: e.target.value as ComponentKind })}
                      >
                        {[...new Set(COMPONENT_KINDS.map((one) => one.group))].map((group) => (
                          <optgroup key={group} label={group}>
                            {COMPONENT_KINDS.filter((one) => one.group === group).map((one) => (
                              <option key={one.id} value={one.id}>
                                {one.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <label className="page-field">
                      <span>Field</span>
                      <select
                        value={component.field ?? ''}
                        onChange={(e) => patchComponent(at, { field: e.target.value || undefined })}
                      >
                        <option value="">— none —</option>
                        {document.fields.map((one) => (
                          <option key={one.name} value={one.name}>
                            {one.label || one.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="page-field wide">
                      <span>{component.kind === 'button' ? 'Label' : 'Label or text'}</span>
                      <input
                        value={component.label ?? component.text ?? ''}
                        onChange={(e) =>
                          patchComponent(
                            at,
                            component.kind === 'heading' || component.kind === 'paragraph' || component.kind === 'note'
                              ? { text: e.target.value }
                              : { label: e.target.value }
                          )
                        }
                      />
                    </label>
                    {component.kind === 'button' && (
                      <label className="page-field">
                        <span>Runs</span>
                        <select
                          value={component.runs ?? ''}
                          onChange={(e) => patchComponent(at, { runs: e.target.value || undefined })}
                        >
                          <option value="">— nothing —</option>
                          {document.computations.map((one) => (
                            <option key={one.name} value={one.name}>
                              {one.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="Remove this component"
                      onClick={() =>
                        setDocument((c) => ({ ...c, components: c.components.filter((_v, i) => i !== at) }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="queue-btn small"
                  onClick={() =>
                    setDocument((c) => ({
                      ...c,
                      components: [...c.components, { id: `c${c.components.length + 1}`, kind: 'value' }]
                    }))
                  }
                >
                  <Plus size={13} /> Component
                </button>
              </li>
            </ul>
          )}

          {tab === 'computations' && (
            <ul className="studio-list">
              {document.computations.map((computation, at) => (
                <li key={at}>
                  <div className="page-row">
                    <label className="page-field">
                      <span>Name</span>
                      <input
                        value={computation.name}
                        spellCheck={false}
                        onChange={(e) => patchComputation(at, { name: e.target.value })}
                      />
                    </label>
                    <label className="page-field wide">
                      <span>Does</span>
                      <select
                        value={computation.operation}
                        onChange={(e) => patchComputation(at, { operation: e.target.value })}
                      >
                        {OPERATIONS.map((one) => (
                          <option key={one} value={one}>
                            {one}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="page-field">
                      <span>Writes to</span>
                      <select
                        value={computation.writes}
                        onChange={(e) => patchComputation(at, { writes: e.target.value })}
                      >
                        {document.fields.map((one) => (
                          <option key={one.name} value={one.name}>
                            {one.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="page-field">
                      <span>When</span>
                      <select
                        value={computation.when}
                        onChange={(e) =>
                          patchComputation(at, { when: e.target.value === 'button' ? 'button' : 'change' })
                        }
                      >
                        <option value="change">on every edit</option>
                        <option value="button">when a button says so</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Remove ${computation.name}`}
                      onClick={() =>
                        setDocument((c) => ({ ...c, computations: c.computations.filter((_v, i) => i !== at) }))
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <input
                    className="studio-wide"
                    spellCheck={false}
                    placeholder='Arguments, like: value=@celsius, from="degC", to="degF"'
                    value={Object.entries(computation.inputs)
                      .map(([key, source]) =>
                        'field' in source ? `${key}=@${source.field}` : `${key}=${JSON.stringify(source.value)}`
                      )
                      .join(', ')}
                    onChange={(e) => {
                      // `@name` reads a field, anything else is a literal. Deliberately small: a general expression
                      // here would be a second language nobody asked for, and the engine already has one.
                      const inputs: Record<string, { field: string } | { value: unknown }> = {}
                      for (const part of e.target.value.split(',')) {
                        const [rawKey, ...rest] = part.split('=')
                        const key = rawKey.trim()
                        const raw = rest.join('=').trim()
                        if (key === '' || raw === '') continue
                        if (raw.startsWith('@')) inputs[key] = { field: raw.slice(1) }
                        else {
                          try {
                            inputs[key] = { value: JSON.parse(raw) }
                          } catch {
                            // Not JSON, so it is meant as plain text. Quotes around it are stripped either way.
                            inputs[key] = { value: raw.replace(/^["']|["']$/g, '') }
                          }
                        }
                      }
                      patchComputation(at, { inputs })
                    }}
                  />
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="queue-btn small"
                  onClick={() =>
                    setDocument((c) => ({
                      ...c,
                      computations: [
                        ...c.computations,
                        {
                          name: `step${c.computations.length + 1}`,
                          operation: OPERATIONS[0],
                          inputs: {},
                          writes: c.fields[0]?.name ?? '',
                          when: 'change'
                        }
                      ]
                    }))
                  }
                >
                  <Plus size={13} /> Computation
                </button>
              </li>
            </ul>
          )}

          {/* Errors stop it running; warnings do not. Shown apart, because that difference is what somebody acts on. */}
          {errors.length > 0 && (
            <div className="studio-problems is-error">
              <h4>
                <AlertTriangle size={13} /> {errors.length} thing{errors.length === 1 ? '' : 's'} stopping this Page
              </h4>
              {errors.map((one, i) => (
                <p key={i}>
                  <code>{one.at}</code> {one.message}
                </p>
              ))}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="studio-problems">
              <h4>
                <Info size={13} /> {warnings.length} worth looking at
              </h4>
              {warnings.map((one, i) => (
                <p key={i}>
                  <code>{one.at}</code> {one.message}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* ---------------------------------------------------------------- the preview */}
        <div className="studio-preview">
          <header>
            <Play size={13} />
            <span>Preview</span>
            {running && <em>working…</em>}
            {answer && (
              <span className={`studio-pill${answer.canRun ? ' ok' : ''}`}>
                {answer.canRun ? 'runs' : 'will not run'}
              </span>
            )}
          </header>

          {answer?.canRun === false ? (
            <p className="page-note">
              Fix the errors on the left and this will run. Nothing is previewed from a Page that could not open, because
              a preview of a broken Page is a picture of something that will not happen.
            </p>
          ) : (
            <div className="studio-render">
              {document.components.map((component, at) => (
                <PreviewComponent
                  key={at}
                  component={component}
                  document={document}
                  state={state}
                  onChange={(name, value) => void change(name, value)}
                  onRun={(name) => {
                    const computation = document.computations.find((one) => one.name === name)
                    if (!computation) return
                    // A button runs its computation by nudging whatever it reads, which is the same path an edit takes.
                    const firstField = Object.values(computation.inputs).find((one) => 'field' in one)
                    if (firstField && 'field' in firstField) {
                      void change(firstField.field, state.values[firstField.field])
                    }
                  }}
                />
              ))}
            </div>
          )}

          {answer && answer.operations.length > 0 && (
            <p className="page-note">
              This Page would need: {answer.operations.join(', ')}. Each one still asks for permission the same way any
              other Page does.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** One component, rendered as the Page would show it. */
/**
 * A rendered Page measured, for `visual.ts` to judge.
 *
 * Everything here is asked of the document directly: where each box is, how big it is, how big its content is, what
 * colour its text is against what is behind it. Nothing is estimated and there is no screenshot -- the browser knows
 * all of this precisely, and precise beats approximate for every defect worth catching.
 *
 * The one thing the DOM cannot say on its own is whether a box that shows an answer *has* one, because an empty
 * answer and an answer that is empty look identical. `PreviewComponent` writes that down as it renders.
 */
export function measure(root: HTMLElement, emphasis: Readonly<Record<string, 'primary' | 'secondary' | 'supporting'>> = {}): Rendered[] {
  const top = root.getBoundingClientRect()
  const out: Rendered[] = []
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-page-component]'))) {
    const box = element.getBoundingClientRect()
    const style = window.getComputedStyle(element)
    const id = element.dataset.pageComponent ?? ''
    const said = element.dataset.pageValue
    const field = element.dataset.pageField
    out.push({
      id,
      kind: element.dataset.pageKind ?? '',
      x: box.left - top.left,
      y: box.top - top.top,
      width: box.width,
      height: box.height,
      text: (element.textContent ?? '').trim(),
      contentWidth: element.scrollWidth,
      contentHeight: element.scrollHeight,
      // Something with no box at all is not rendered, whatever the style says.
      visible: box.width > 0 || box.height > 0 || style.display !== 'none',
      foreground: style.color,
      background: behind(element),
      fontPixels: Number.parseFloat(style.fontSize),
      ...(said === undefined || field === undefined ? {} : { bound: { field, hasValue: said === 'yes' } }),
      ...(Object.prototype.hasOwnProperty.call(emphasis, id) ? { emphasis: emphasis[id] } : {})
    })
  }
  return out
}

/**
 * The colour actually behind an element.
 *
 * Walking up until something is not transparent, because almost every element in a Page inherits its background from
 * an ancestor -- reading the element's own would say `rgba(0, 0, 0, 0)` and make every contrast check meaningless.
 */
function behind(element: HTMLElement): string {
  let current: HTMLElement | null = element
  for (let i = 0; i < 20 && current !== null; i++) {
    const colour = window.getComputedStyle(current).backgroundColor
    if (colour !== '' && colour !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(colour)) return colour
    current = current.parentElement
  }
  // Nothing opaque anywhere up the tree. The application's own surface is what is really behind it.
  return window.getComputedStyle(document.body).backgroundColor || '#000000'
}

/**
 * The attributes that make a rendered component findable.
 *
 * Every branch of `PreviewComponent` carries these, which is what lets the Page be measured after it renders.
 * Without them the visual check would have to guess which box on screen is which component, and a visual check that
 * guesses is one whose findings nobody can act on.
 *
 * `data-page-value` is the one that is not about geometry: it says whether a box that exists to show an answer has
 * one. Nothing else can tell -- an empty answer and an answer that happens to be empty look identical in the DOM.
 */
function tag(component: Component, hasValue?: boolean): Record<string, string> {
  const out: Record<string, string> = { 'data-page-component': component.id, 'data-page-kind': component.kind }
  if (component.field !== undefined) out['data-page-field'] = component.field
  if (hasValue !== undefined) out['data-page-value'] = hasValue ? 'yes' : 'no'
  return out
}

export function PreviewComponent({
  component,
  document,
  state,
  onChange,
  onRun
}: {
  component: Component
  document: PageDocument
  state: RunState
  onChange(name: string, value: unknown): void
  onRun(name: string): void
}): React.JSX.Element | null {
  const field = component.field ? document.fields.find((one) => one.name === component.field) : undefined
  const held = component.field ? state.values[component.field] : undefined
  // `pick` reads one property out of a result. The property being absent and the result not having arrived yet are
  // both `undefined` here, and both mean "nothing to show", so they are not told apart.
  const value =
    component.pick !== undefined && held !== null && typeof held === 'object'
      ? (held as Record<string, unknown>)[component.pick]
      : component.pick !== undefined
        ? undefined
        : held

  // The condition is a field's name, never an expression. A Page cannot hide something on a rule nothing can check.
  if (component.showWhen && state.values[component.showWhen] !== true) return null

  switch (component.kind) {
    case 'group':
    case 'row':
    case 'column':
      return (
        <section className={component.kind === 'row' ? 'studio-row' : 'studio-group'} {...tag(component)}>
          {component.label && <h4 className="studio-h">{component.label}</h4>}
          {(component.children ?? []).map((child) => (
            <PreviewComponent key={child.id} component={child} document={document} state={state} onChange={onChange} onRun={onRun} />
          ))}
        </section>
      )
    case 'table':
      return <PreviewTable label={component.label ?? field?.label ?? ''} value={value} attributes={tag(component, value !== undefined && value !== null)} />
    case 'plot':
      return <PreviewPlot label={component.label ?? field?.label ?? ''} value={value} attributes={tag(component, value !== undefined && value !== null)} />
    case 'heading':
      return (
        <h4 className="studio-h" {...tag(component)}>
          {component.text || 'Heading'}
        </h4>
      )
    case 'paragraph':
      return <p {...tag(component)}>{component.text}</p>
    case 'note':
      return (
        <p className="page-note" {...tag(component)}>
          {component.text}
        </p>
      )
    case 'divider':
      return <hr className="studio-hr" {...tag(component)} />
    case 'number-input':
    case 'slider':
      return (
        <label className="page-field" {...tag(component)}>
          <span>{component.label || field?.label}</span>
          <input
            type={component.kind === 'slider' ? 'range' : 'number'}
            value={typeof value === 'number' ? value : 0}
            min={field?.minimum}
            max={field?.maximum}
            onChange={(e) => onChange(component.field as string, Number(e.target.value))}
          />
        </label>
      )
    case 'text-input':
      return (
        <label className="page-field wide" {...tag(component)}>
          <span>{component.label || field?.label}</span>
          <input value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(component.field as string, e.target.value)} />
        </label>
      )
    case 'checkbox':
      return (
        <label className="studio-inline" {...tag(component)}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(component.field as string, e.target.checked)}
          />
          <span>{component.label || field?.label}</span>
        </label>
      )
    case 'choice':
      return (
        <label className="page-field" {...tag(component)}>
          <span>{component.label || field?.label}</span>
          <select value={String(value ?? '')} onChange={(e) => onChange(component.field as string, e.target.value)}>
            {(field?.options ?? []).map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
      )
    case 'quantity-input': {
      const held = (value ?? {}) as { value?: number; unit?: string }
      return (
        <label className="page-field" {...tag(component)}>
          <span>
            {component.label || field?.label} {field?.unit ? `(${field.unit})` : ''}
          </span>
          <input
            type="number"
            value={typeof held.value === 'number' ? held.value : 0}
            onChange={(e) =>
              onChange(component.field as string, { value: Number(e.target.value), unit: field?.unit ?? '' })
            }
          />
        </label>
      )
    }
    case 'value':
    case 'statistic':
      return (
        <output
          className={component.kind === 'statistic' ? 'page-answer' : 'page-answer-line'}
          {...tag(component, value !== undefined && value !== null)}
        >
          <span className="page-label">{component.label || field?.label}</span>
          <strong>{readable(value)}</strong>
        </output>
      )
    case 'button':
      return (
        <button
          type="button"
          className="queue-btn small"
          {...tag(component)}
          disabled={!component.runs}
          onClick={() => component.runs && onRun(component.runs)}
        >
          {component.label || 'Run'}
        </button>
      )
    default:
      return (
        <p className="page-note">
          {/* Said rather than drawn as an empty box, so the builder is honest about what it can show. */}
          A {component.kind} is not previewed here yet.
        </p>
      )
  }
}

/**
 * Rows an engine returned, as a table.
 *
 * Takes the columns from the first row rather than from anywhere that declares them, because an engine's result is a
 * plain object and nothing describes its shape. A result that is not a list of objects says so instead of drawing an
 * empty grid, which would read as a calculation that returned nothing.
 */
function PreviewTable({
  label,
  value,
  attributes
}: {
  label: string
  value: unknown
  attributes?: Record<string, string>
}): React.JSX.Element {
  const rows = Array.isArray(value) ? value.filter((one) => one !== null && typeof one === 'object') : []
  if (rows.length === 0) {
    return (
      <output className="page-answer-line" {...attributes}>
        <span className="page-label">{label}</span>
        <span className="page-note">{value === undefined ? 'nothing yet' : 'This is not a table.'}</span>
      </output>
    )
  }
  const columns = [...new Set(rows.flatMap((one) => Object.keys(one as Record<string, unknown>)))].slice(0, 8)
  return (
    <figure className="page-block" {...attributes}>
      <figcaption className="page-label">{label}</figcaption>
      <table className="page-table">
        <thead>
          <tr>
            {columns.map((one) => (
              <th key={one}>{one}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, i) => (
            <tr key={i}>
              {columns.map((one) => (
                <td key={one}>{readable((row as Record<string, unknown>)[one])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 && <figcaption className="page-note">Showing the first 200 of {rows.length} rows.</figcaption>}
    </figure>
  )
}

/**
 * A series an engine returned, drawn.
 *
 * Plain SVG, and deliberately plotted from whatever pair of numbers each point actually has rather than from assumed
 * names: engines return `{x, y}`, `{t, value}` and bare pairs, and a chart that silently drew nothing because it was
 * looking for the wrong key is worse than one that says it could not find any points.
 */
function PreviewPlot({
  label,
  value,
  attributes
}: {
  label: string
  value: unknown
  attributes?: Record<string, string>
}): React.JSX.Element {
  const points: { x: number; y: number }[] = []
  const list = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { points?: unknown }).points)
      ? ((value as { points: unknown[] }).points)
      : []
  for (const one of list) {
    if (Array.isArray(one) && typeof one[0] === 'number' && typeof one[1] === 'number') {
      points.push({ x: one[0], y: one[1] })
      continue
    }
    if (one === null || typeof one !== 'object') continue
    const numbers = Object.entries(one as Record<string, unknown>).filter(([, held]) => typeof held === 'number') as [string, number][]
    const xKey = numbers.find(([key]) => key === 'x' || key === 't' || key === 'time')?.[0] ?? numbers[0]?.[0]
    const yKey = numbers.find(([key]) => key !== xKey)?.[0]
    if (xKey === undefined || yKey === undefined) continue
    points.push({ x: (one as Record<string, number>)[xKey], y: (one as Record<string, number>)[yKey] })
  }
  if (points.length < 2) {
    return (
      <output className="page-answer-line" {...attributes}>
        <span className="page-label">{label}</span>
        <span className="page-note">{value === undefined ? 'nothing yet' : 'There are not enough points here to draw.'}</span>
      </output>
    )
  }
  const xs = points.map((one) => one.x)
  const ys = points.map((one) => one.y)
  const lowX = Math.min(...xs)
  const highX = Math.max(...xs)
  const lowY = Math.min(...ys)
  const highY = Math.max(...ys)
  // A flat series has no range to scale by, so it is drawn down the middle rather than divided by zero.
  const spanX = highX - lowX || 1
  const spanY = highY - lowY || 1
  const at = (one: { x: number; y: number }): string =>
    `${(((one.x - lowX) / spanX) * 300 + 10).toFixed(2)},${(190 - ((one.y - lowY) / spanY) * 170).toFixed(2)}`
  return (
    <figure className="page-block" {...attributes}>
      <figcaption className="page-label">{label}</figcaption>
      <svg className="page-plot" viewBox="0 0 320 200" role="img" aria-label={`${label}: ${points.length} points`}>
        <polyline points={points.map(at).join(' ')} fill="none" stroke="var(--cyan)" strokeWidth="1.5" />
      </svg>
      <figcaption className="page-note">
        {lowX === highX ? `x = ${readable(lowX)}` : `${readable(lowX)} to ${readable(highX)}`} across,{' '}
        {lowY === highY ? `y = ${readable(lowY)}` : `${readable(lowY)} to ${readable(highY)}`} up.
      </figcaption>
    </figure>
  )
}

/**
 * Whatever a computation wrote, as something readable.
 *
 * An engine answer is an object with its own shape, so this looks for the fields the engines actually return rather
 * than stringifying the whole thing. Null is shown as "nothing yet" — an empty object would read as an answer that
 * came back empty, which is a different thing.
 */
function readable(value: unknown): string {
  if (value === null || value === undefined) return 'nothing yet'
  if (typeof value === 'number') return String(Number(value.toPrecision(10)))
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const one = value as Record<string, unknown>
    for (const key of ['display', 'report', 'text', 'value', 'mean']) {
      if (typeof one[key] === 'number') return String(Number((one[key] as number).toPrecision(10)))
      if (typeof one[key] === 'string') return one[key] as string
    }
    if (Array.isArray(one.solutions)) {
      return (one.solutions as { text?: string; value?: number }[]).map((s) => s.text ?? String(s.value)).join(', ')
    }
  }
  return JSON.stringify(value).slice(0, 200)
}

// ================================================================ packaging

interface Inspected {
  manifest: { title?: string; slug?: string; description?: string }
  files: number
  requested: { id: string; name: string; description: string; risk: string }[]
  unknownCapabilities: string[]
  intact: boolean
  warnings: string[]
  beforeYouDecide: string[]
}

export function PackagePanel({
  pages,
  onNotify
}: {
  pages: PageCard[]
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  const [chosen, setChosen] = useState(pages[0]?.pageId ?? '')
  const [contents, setContents] = useState('{\n  "note": "whatever this Page had saved"\n}')
  const [secrets, setSecrets] = useState<{ entry: string; looksLike: string; line: number }[]>([])
  const [packed, setPacked] = useState<unknown>(null)
  const [text, setText] = useState('')
  const [inspected, setInspected] = useState<Inspected | null>(null)
  const [problem, setProblem] = useState('')

  const exportIt = useCallback(
    async (acceptSecrets: boolean) => {
      setProblem('')
      const result = await window.api.pagesExport(
        chosen,
        [{ path: 'state.json', content: contents }],
        acceptSecrets
      )
      if (refused(result)) {
        setProblem(result.message ?? 'That could not be exported.')
        return
      }
      if (!('package' in result)) {
        // The refusal arm: its message names each finding, which is what the list below reads.
        setProblem((result as { message?: string }).message ?? 'That could not be exported.')
        return
      }
      setSecrets([...result.secrets])
      setPacked(result.package)
      onNotify(acceptSecrets && result.secrets.length > 0 ? 'Exported, credentials included' : 'Exported')
    },
    [chosen, contents, onNotify]
  )

  const inspect = useCallback(async () => {
    setProblem('')
    setInspected(null)
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      setProblem('That is not a file Orbis can read. A package is JSON.')
      return
    }
    const result = await window.api.pagesInspectPackage(raw, text.length)
    if (refused(result)) {
      setProblem(result.message ?? 'That package could not be read.')
      return
    }
    if (!('manifest' in result)) {
      setProblem((result as { message?: string }).message ?? 'That package could not be read.')
      return
    }
    setInspected(result as unknown as Inspected)
  }, [text])

  return (
    <div className="studio">
      <section className="studio-block">
        <h4>
          <Download size={14} /> Export a Page
        </h4>
        <div className="page-row">
          <label className="page-field wide">
            <span>Which Page</span>
            <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              {pages.map((one) => (
                <option key={one.pageId} value={one.pageId}>
                  {one.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="page-field wide">
          <span>What it has saved</span>
          <textarea value={contents} rows={4} spellCheck={false} onChange={(e) => setContents(e.target.value)} />
        </label>

        <div className="page-chips">
          <button type="button" className="queue-btn small" onClick={() => void exportIt(false)}>
            <Download size={13} /> Export
          </button>
        </div>

        {problem !== '' && (
          <p className="page-problem" role="alert">
            <ShieldAlert size={13} /> {problem}
          </p>
        )}

        {/*
          * A refused export is the common case worth designing for: somebody's Page cached a key and nobody noticed.
          * The findings name where, never the value -- putting a suspected key on screen copies it somewhere new.
          */}
        {problem.includes('credential') && (
          <div className="studio-secrets">
            <p>
              Remove them and export again, or export anyway knowing that anybody you send this to can read them.
            </p>
            <button type="button" className="queue-btn small ghost" onClick={() => void exportIt(true)}>
              Export anyway
            </button>
          </div>
        )}

        {secrets.length > 0 && (
          <p className="page-problem">
            Exported with {secrets.length} finding{secrets.length === 1 ? '' : 's'} that looked like credentials:{' '}
            {secrets.map((one) => `${one.entry} line ${one.line}`).join(', ')}.
          </p>
        )}

        {packed !== null && (
          <>
            <label className="page-field wide">
              <span>The package</span>
              <textarea readOnly rows={5} value={JSON.stringify(packed, null, 2)} spellCheck={false} />
            </label>
            <p className="page-note">
              The checksum in there detects a damaged file. It is not a signature: anybody who edits a package can
              recompute it, so it cannot show who made this or whether it was changed on purpose.
            </p>
          </>
        )}
      </section>

      <section className="studio-block">
        <h4>
          <Upload size={14} /> Open a package
        </h4>
        <label className="page-field wide">
          <span>Paste a package</span>
          <textarea
            value={text}
            rows={5}
            spellCheck={false}
            placeholder="Paste the contents of an Orbis Page package"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="button" className="queue-btn small" disabled={text.trim() === ''} onClick={() => void inspect()}>
          <FileWarning size={13} /> Look at it
        </button>

        {inspected && (
          <div className="studio-inspect">
            <h5>{inspected.manifest.title ?? 'A Page'}</h5>
            <p className="page-note">{inspected.manifest.description}</p>

            {/* The part somebody has to read before deciding. Rendered as content, not behind a disclosure. */}
            <ul className="studio-decide">
              {inspected.beforeYouDecide.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>

            <div className="page-stats">
              <div className="page-stat">
                <span>Files</span>
                <strong>{inspected.files}</strong>
              </div>
              <div className="page-stat">
                <span>Asks for</span>
                <strong>{inspected.requested.length}</strong>
              </div>
              <div className="page-stat">
                <span>Checksum</span>
                <strong>{inspected.intact ? 'matches' : 'does not match'}</strong>
              </div>
            </div>

            {inspected.requested.length > 0 && (
              <>
                <h5>What it is asking for</h5>
                {inspected.requested.map((one) => (
                  <p key={one.id} className="pages-perm">
                    <Info size={13} />
                    <strong>{one.name}</strong>
                    <span className="pages-tag">{one.risk}</span>
                    <span className="pages-perm-why">{one.description}</span>
                  </p>
                ))}
                <p className="page-note">
                  Asking is not being given it. Nothing is granted by opening a package, and each one is still yours to
                  decide.
                </p>
              </>
            )}

            {inspected.warnings.length > 0 && (
              <div className="studio-problems">
                {inspected.warnings.map((one) => (
                  <p key={one}>{one}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ================================================================ diagnostics

interface Diagnosis {
  source: string
  summary: string
  consequence: string
  actionable: boolean
  recurring: boolean
  suggestions: { action: string; label: string; cost: string; automatic: boolean }[]
}

interface AuditAnswer {
  findings: { severity: string; element: string; problem: string; fix: string; rule: string }[]
  checked: string[]
  cannotCheck: string[]
  counts: Record<string, number>
  headline: string
}

const FAULT_KINDS = [
  'script-error',
  'startup-failure',
  'crashed',
  'unresponsive',
  'timed-out',
  'out-of-memory',
  'storage-full',
  'storage-unreadable',
  'permission-denied',
  'policy-violation',
  'bad-input',
  'engine-failure'
]

export function DiagnosticsPanel({ onNotify }: { onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [health, setHealth] = useState<{
    health: { pages: number; available: number; archived: number; needsReview: number; incompatible: number; danglingAliases: string[]; duplicateSlugs: string[]; duplicateIds: string[]; healthy: boolean }
    problems: { slug: string; message: string }[]
  } | null>(null)
  const [kind, setKind] = useState('crashed')
  const [unsaved, setUnsaved] = useState(true)
  const [checkpoint, setCheckpoint] = useState(false)
  const [repeats, setRepeats] = useState(1)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [audit, setAudit] = useState<AuditAnswer | null>(null)

  useEffect(() => {
    void window.api.pagesHealth().then((result) => {
      if (refused(result)) return
      setHealth(result)
    })
  }, [])

  useEffect(() => {
    void window.api
      .pagesDiagnose(
        { kind, detail: 'A fault of this kind', at: Date.now(), repeats },
        { hasUnsavedWork: unsaved, hasCheckpoint: checkpoint, everStarted: true }
      )
      .then((result) => {
        if (refused(result)) return
        setDiagnosis(result as Diagnosis)
      })
  }, [kind, unsaved, checkpoint, repeats])

  const runAudit = useCallback(async () => {
    // The screen describing itself. In Chromium this could come from the accessibility tree instead, which would make
    // it better rather than different.
    const elements: PageAuditElement[] = [
      { id: 'run', role: 'button', name: 'Run the audit', keyboardReachable: true, width: 44, height: 44, foreground: '#ededef', background: '#0e1013' },
      { id: 'kind', role: 'combobox', name: 'What went wrong', keyboardReachable: true, width: 160, height: 28 },
      { id: 'quiet', role: 'button', name: '', keyboardReachable: true, width: 16, height: 16 }
    ]
    const result = await window.api.pagesAudit(elements)
    if (refused(result)) {
      onNotify(result.message ?? 'The audit could not run', 'error')
      return
    }
    setAudit(result as AuditAnswer)
  }, [onNotify])

  return (
    <div className="studio">
      <section className="studio-block">
        <h4>
          <Layers size={14} /> The register
        </h4>
        {health === null ? (
          <p className="page-note">Reading…</p>
        ) : (
          <>
            <div className="page-stats">
              {[
                ['Pages', health.health.pages],
                ['Available', health.health.available],
                ['Need review', health.health.needsReview],
                ['Incompatible', health.health.incompatible],
                ['Archived', health.health.archived]
              ].map(([label, value]) => (
                <div key={String(label)} className="page-stat">
                  <span>{String(label)}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
            </div>
            <p className={health.health.healthy ? 'page-note' : 'page-problem'}>
              {health.health.healthy ? (
                <>
                  <Check size={13} /> Nothing in the register contradicts itself.
                </>
              ) : (
                <>
                  <AlertTriangle size={13} /> The register has a problem:{' '}
                  {[
                    health.health.duplicateSlugs.length > 0 && `duplicate addresses (${health.health.duplicateSlugs.join(', ')})`,
                    health.health.duplicateIds.length > 0 && `duplicate ids`,
                    health.health.danglingAliases.length > 0 && `${health.health.danglingAliases.length} aliases pointing at nothing`
                  ]
                    .filter(Boolean)
                    .join('; ')}
                </>
              )}
            </p>
            {health.problems.length > 0 && (
              <div className="studio-problems is-error">
                <h4>Pages that would not register</h4>
                {health.problems.map((one) => (
                  <p key={one.slug}>
                    <code>{one.slug}</code> {one.message}
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="studio-block">
        <h4>
          <Stethoscope size={14} /> What Orbis says when something goes wrong
        </h4>
        <div className="page-row">
          <label className="page-field wide">
            <span>What happened</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {FAULT_KINDS.map((one) => (
                <option key={one} value={one}>
                  {one.replace(/-/g, ' ')}
                </option>
              ))}
            </select>
          </label>
          <label className="page-field">
            <span>Times</span>
            <input
              type="number"
              min={1}
              max={10}
              value={repeats}
              onChange={(e) => setRepeats(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
          </label>
          <label className="studio-inline">
            <input type="checkbox" checked={unsaved} onChange={(e) => setUnsaved(e.target.checked)} />
            <span>unsaved work</span>
          </label>
          <label className="studio-inline">
            <input type="checkbox" checked={checkpoint} onChange={(e) => setCheckpoint(e.target.checked)} />
            <span>has a checkpoint</span>
          </label>
        </div>

        {diagnosis && (
          <div className="studio-diagnosis">
            <strong>{diagnosis.summary}</strong>
            <p>{diagnosis.consequence}</p>
            <p className="page-note">
              Whose it is: <b>{diagnosis.source}</b>
              {diagnosis.recurring && ' · this keeps happening'}
              {!diagnosis.actionable && ' · there is nothing you can do about this one'}
            </p>
            <ul className="studio-recover">
              {diagnosis.suggestions.map((one) => (
                <li key={one.action}>
                  <b>{one.label}</b>
                  {/* Never the action without its cost. That pairing is the whole point of this panel. */}
                  {one.cost === '' ? (
                    <em>costs nothing{one.automatic ? ', so Orbis may do it on its own' : ''}</em>
                  ) : (
                    <em className="is-cost">{one.cost}</em>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="studio-block">
        <h4>
          <Wrench size={14} /> Accessibility
        </h4>
        <button type="button" className="queue-btn small" onClick={() => void runAudit()}>
          <Play size={13} /> Check this screen
        </button>

        {audit && (
          <>
            <p className={audit.counts.blocker > 0 ? 'page-problem' : 'page-note'}>{audit.headline}</p>

            {audit.findings.length > 0 && (
              <ul className="studio-findings">
                {audit.findings.map((one, i) => (
                  <li key={i} className={`is-${one.severity}`}>
                    <b>{one.element}</b>
                    <span>{one.problem}</span>
                    <em>{one.fix}</em>
                  </li>
                ))}
              </ul>
            )}

            {/*
              * The most important list on this screen. A clean result with nothing attached would read as
              * "this is accessible", which would be a lie -- an automated check finds about a third of real problems.
              */}
            <h5>What a machine could not check</h5>
            <ul className="studio-cannot">
              {audit.cannotCheck.map((one) => (
                <li key={one}>{one}</li>
              ))}
            </ul>

            <details className="studio-checked">
              <summary>What it did check ({audit.checked.length})</summary>
              <ul>
                {audit.checked.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>
    </div>
  )
}

// ================================================================ composition

interface Participant {
  pageId: string
  title: string
  slug: string
  running: boolean
  accepts: { kind: string; describe: string; replies: boolean }[]
  canSend: boolean
}

/**
 * Which Pages can hand something to which.
 *
 * Both halves are shown because both are required: a Page has to be allowed to send, and the Page it names has to have
 * said it accepts that kind. Neither is enough alone, and seeing them side by side is the only way somebody works out
 * why a route they expected is not there.
 *
 * What is deliberately absent: any way to see what a Page *could* accept if it declared something. The list shows what
 * is declared, and nothing infers the rest.
 */
export function ComposePanel({ onNotify }: { onNotify(message: string, kind?: NoticeKind): void }): React.JSX.Element {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('')
  const [body, setBody] = useState('{\n  "rows": [[1, 2], [3, 4]]\n}')
  const [result, setResult] = useState<{ ok: boolean; message: string; notes: string[] } | null>(null)

  useEffect(() => {
    void window.api.pagesParticipants().then((answer) => {
      if (refused(answer)) return
      setParticipants(answer.participants)
      setFrom(answer.participants.find((one) => one.canSend)?.pageId ?? '')
    })
  }, [])

  const senders = participants.filter((one) => one.canSend)
  const receivers = participants.filter((one) => one.accepts.length > 0)
  const target = participants.find((one) => one.pageId === to)

  // Only the kinds this receiver actually declared. Offering one it did not is offering a refusal.
  const kinds = target?.accepts ?? []
  useEffect(() => {
    if (kinds.length > 0 && !kinds.some((one) => one.kind === kind)) setKind(kinds[0].kind)
  }, [kinds, kind])

  const deliver = useCallback(async () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      setResult({ ok: false, message: 'That body is not data Orbis can read. A message between Pages is JSON.', notes: [] })
      return
    }
    const answer = await window.api.pagesSend(from, to, kind, parsed)
    if (refused(answer)) {
      setResult({ ok: false, message: answer.message ?? 'That could not be sent.', notes: [] })
      return
    }
    if (!('to' in answer)) {
      // The refusal arm. Every reason gives the same sentence, so nothing here tries to tell them apart.
      setResult({ ok: false, message: (answer as { message?: string }).message ?? 'That could not be sent.', notes: [] })
      return
    }
    setResult({ ok: true, message: `Delivered to ${target?.title ?? to}.`, notes: [...answer.notes] })
    onNotify('Message delivered')
  }, [from, to, kind, body, target, onNotify])

  return (
    <div className="studio">
      <div className="studio-note" role="note">
        <Info size={14} />
        <div>
          <b>Both Pages have to agree.</b> One must be allowed to send, and the other must have said it accepts that
          kind of message. Permissions never pool: the Page that receives acts with its own, and nothing the sender was
          allowed to do carries across.
        </div>
      </div>

      <section className="studio-block">
        <h4>
          <Send size={14} /> Who can send, and who can receive
        </h4>
        <div className="studio-routes">
          <div>
            <h5>Allowed to send</h5>
            {senders.length === 0 ? (
              <p className="page-note">No Page has been allowed to send to another.</p>
            ) : (
              <ul>
                {senders.map((one) => (
                  <li key={one.pageId}>{one.title}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h5>Accepts something</h5>
            {receivers.length === 0 ? (
              <p className="page-note">No Page has declared that it accepts anything.</p>
            ) : (
              <ul>
                {receivers.map((one) => (
                  <li key={one.pageId}>
                    <b>{one.title}</b>
                    {one.accepts.map((a) => (
                      <em key={a.kind}>
                        <code>{a.kind}</code> {a.describe}
                      </em>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="studio-block">
        <h4>
          <Play size={14} /> Send one
        </h4>
        <div className="page-row">
          <label className="page-field wide">
            <span>From</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">— choose —</option>
              {participants.map((one) => (
                <option key={one.pageId} value={one.pageId}>
                  {one.title}
                  {one.canSend ? '' : ' (not allowed to send)'}
                </option>
              ))}
            </select>
          </label>
          <label className="page-field wide">
            <span>To</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">— choose —</option>
              {participants.map((one) => (
                <option key={one.pageId} value={one.pageId}>
                  {one.title}
                  {one.accepts.length === 0 ? ' (accepts nothing)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="page-field">
            <span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={kinds.length === 0}>
              {kinds.length === 0 ? (
                <option value="">— nothing declared —</option>
              ) : (
                kinds.map((one) => (
                  <option key={one.kind} value={one.kind}>
                    {one.kind}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        {kinds.find((one) => one.kind === kind) && (
          <p className="page-note">{kinds.find((one) => one.kind === kind)?.describe}</p>
        )}

        <label className="page-field wide">
          <span>What to send</span>
          <textarea value={body} rows={4} spellCheck={false} onChange={(e) => setBody(e.target.value)} />
        </label>

        <button type="button" className="queue-btn small" disabled={from === '' || to === '' || kind === ''} onClick={() => void deliver()}>
          Send
        </button>

        {result && (
          <>
            <p className={result.ok ? 'page-note' : 'page-problem'}>{result.message}</p>
            {result.notes.map((one) => (
              <p key={one} className="page-note">
                {one}
              </p>
            ))}
          </>
        )}

        <p className="page-note">
          Every reason a message cannot be delivered gives the same answer, because the differences between them would
          be a map of what is installed.
        </p>
      </section>
    </div>
  )
}

/** The tabs the studio has, so `PagesView` does not need to know what is inside each one. */
export const STUDIO_TABS = [
  // Describing comes first because it is what somebody will reach for: building a Page by hand is the thing you do
  // when describing one did not give you what you wanted.
  { id: 'describe' as const, label: 'Describe', icon: Sparkles },
  { id: 'builder' as const, label: 'Build', icon: Wrench },
  { id: 'compose' as const, label: 'Between Pages', icon: Send },
  // Applications sit beside composition rather than inside it: sending one Page's result to another is a message,
  // and grouping Pages under one address with routes is a different thing that happens to need the same Pages.
  { id: 'applications' as const, label: 'Applications', icon: Layers },
  { id: 'package' as const, label: 'Packages', icon: Upload },
  { id: 'diagnostics' as const, label: 'Diagnostics', icon: Stethoscope }
]

export type StudioTab = (typeof STUDIO_TABS)[number]['id']

export function CloseButton({ onClose }: { onClose(): void }): React.JSX.Element {
  return (
    <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
      <X size={16} />
    </button>
  )
}
