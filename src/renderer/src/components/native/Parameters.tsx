import { useEffect, useMemo, useRef, useState } from 'react'
import './phase2.css'

/**
 * The controls for an app's declared parameters.
 *
 * ## One panel, from the declarations
 *
 * Every Phase 2 application's controls are rendered from its parameter definitions rather than hand-written per app.
 * That is what §111 of the brief asks for, and the reason is not tidiness: a hand-rolled slider sets a component's
 * own state, and a declared parameter goes through the runtime, which checks its range and its unit and refuses what
 * does not fit. A panel built from declarations cannot accidentally bypass that.
 *
 * ## Refusals are shown against the control
 *
 * Setting gravity to five kilograms comes back as a refusal with a sentence. It appears under the field that caused
 * it, and the field keeps what was typed so it can be corrected — clearing it would throw away the thing somebody
 * was halfway through.
 *
 * ## Typing is debounced; everything else is immediate
 *
 * A text or number field waits until typing settles, because every keystroke would otherwise be a round trip and a
 * recomputation. A dropdown or a checkbox is one deliberate act and applies at once.
 */

export interface Definition {
  id: string
  name: string
  kind: string
  about: string
  unit?: string
  least?: number
  most?: number
  step?: number
  places?: number
  options?: readonly { id: string; label: string }[]
  group?: string
  derived: boolean
}

export interface ParametersProps {
  definitions: readonly Definition[]
  /** Which to show. The runtime worked this out from each parameter's conditions. */
  shown: readonly string[]
  values: Readonly<Record<string, string | number | boolean | readonly number[]>>
  /** Applies values. Returns the refusals, keyed by parameter, or nothing when all of them took. */
  onSet(values: Record<string, unknown>): Promise<Readonly<Record<string, string>> | null>
  busy?: boolean
}

const TEXTUAL = new Set(['text', 'expression', 'color', 'reference'])

export default function Parameters({ definitions, shown, values, onSet, busy }: ParametersProps): React.JSX.Element {
  const visible = useMemo(() => definitions.filter((one) => shown.includes(one.id)), [definitions, shown])
  const groups = useMemo(() => {
    const out = new Map<string, Definition[]>()
    for (const one of visible) {
      const key = one.group ?? 'Settings'
      const held = out.get(key) ?? []
      held.push(one)
      out.set(key, held)
    }
    return [...out.entries()]
  }, [visible])

  /** What is in each field, which is not the same as what the runtime holds while somebody is typing. */
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const timers = useRef<Record<string, number>>({})

  // The runtime's values win whenever they change from outside — Orion setting one, or a reset.
  useEffect(() => {
    setDraft({})
    setProblems({})
  }, [values])

  const asText = (one: Definition): string => {
    if (draft[one.id] !== undefined) return draft[one.id]
    const value = values[one.id]
    if (value === undefined || value === null) return ''
    if (Array.isArray(value)) return value.join(', ')
    if (typeof value === 'number' && one.places !== undefined) return String(value)
    return String(value)
  }

  const apply = async (id: string, raw: unknown): Promise<void> => {
    const found = await onSet({ [id]: raw })
    if (found && found[id]) setProblems((held) => ({ ...held, [id]: found[id] }))
    else {
      setProblems((held) => {
        const next = { ...held }
        delete next[id]
        return next
      })
      setDraft((held) => {
        const next = { ...held }
        delete next[id]
        return next
      })
    }
  }

  const later = (id: string, raw: string): void => {
    setDraft((held) => ({ ...held, [id]: raw }))
    if (timers.current[id]) window.clearTimeout(timers.current[id])
    // Long enough that typing a list of twenty numbers is one request rather than twenty.
    timers.current[id] = window.setTimeout(() => void apply(id, raw), 420)
  }

  useEffect(
    () => () => {
      for (const timer of Object.values(timers.current)) window.clearTimeout(timer)
    },
    []
  )

  if (visible.length === 0) return <p className="p2-faint">This app has no settings of its own.</p>

  return (
    <div className="p2-params">
      {groups.map(([group, list]) => (
        <fieldset key={group} className="p2-group">
          <legend>{group}</legend>
          {list.map((one) => {
            const problem = problems[one.id]
            const described = `${one.id}-about`
            return (
              <div key={one.id} className={`p2-field${problem ? ' bad' : ''}`}>
                <label htmlFor={`p-${one.id}`}>
                  {one.name}
                  {one.unit && <span className="p2-unit"> ({one.unit})</span>}
                </label>

                {one.derived ? (
                  <output id={`p-${one.id}`} className="p2-derived">
                    {asText(one)} <span className="p2-faint">worked out</span>
                  </output>
                ) : one.kind === 'boolean' ? (
                  <input
                    id={`p-${one.id}`}
                    type="checkbox"
                    checked={values[one.id] === true}
                    disabled={busy}
                    aria-describedby={described}
                    onChange={(event) => void apply(one.id, event.target.checked)}
                  />
                ) : one.kind === 'choice' ? (
                  <select
                    id={`p-${one.id}`}
                    value={String(values[one.id] ?? '')}
                    disabled={busy}
                    aria-describedby={described}
                    onChange={(event) => void apply(one.id, event.target.value)}
                  >
                    {(one.options ?? []).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : one.kind === 'numbers' || one.kind === 'vector' || TEXTUAL.has(one.kind) ? (
                  <textarea
                    id={`p-${one.id}`}
                    rows={one.kind === 'numbers' || one.kind === 'text' ? 2 : 1}
                    value={asText(one)}
                    disabled={busy}
                    spellCheck={false}
                    aria-describedby={described}
                    onChange={(event) => later(one.id, event.target.value)}
                    onBlur={(event) => void apply(one.id, event.target.value)}
                  />
                ) : (
                  <div className="p2-number">
                    {/*
                      * A slider and a box together: the slider is for exploring and the box for a value somebody
                      * knows. A slider alone cannot express 3.71, and a box alone cannot be swept.
                      */}
                    {one.least !== undefined && one.most !== undefined && one.most - one.least <= 100_000 && (
                      <input
                        type="range"
                        min={one.least}
                        max={one.most}
                        step={one.step ?? (one.kind === 'integer' ? 1 : (one.most - one.least) / 200)}
                        value={Number(values[one.id] ?? one.least)}
                        disabled={busy}
                        aria-label={`${one.name} slider`}
                        onChange={(event) => later(one.id, event.target.value)}
                      />
                    )}
                    <input
                      id={`p-${one.id}`}
                      type="text"
                      inputMode="decimal"
                      value={asText(one)}
                      disabled={busy}
                      aria-describedby={described}
                      onChange={(event) => later(one.id, event.target.value)}
                      onBlur={(event) => void apply(one.id, event.target.value)}
                    />
                  </div>
                )}

                <p className="p2-about" id={described}>
                  {one.about}
                </p>
                {problem && (
                  <p className="p2-problem" role="alert">
                    {problem}
                  </p>
                )}
              </div>
            )
          })}
        </fieldset>
      ))}
    </div>
  )
}
