import { useState } from 'react'
import { Bell, BellOff, Plus, Trash2 } from 'lucide-react'
import type { ExperienceConfig } from '../../../shared/experience'
import type { RuleCondition, RuleOperator, StoredRule } from '../../../shared/rules'
import { MAX_RULES, RULES_SCHEMA_VERSION } from '../../../shared/rules'
import {
  describeCondition,
  isWatchable,
  NEEDS_NO_VALUE,
  OPERATORS_FOR,
  OPERATOR_LABELS,
  watchableField,
  WATCHABLE
} from '../../../shared/watchable'

/**
 * "Tell me when..."
 *
 * The condition engine was written, tested and stored, and there was no way to make a rule. This is that way.
 *
 * It is built from `WATCHABLE` rather than from free text, which is the whole point: every source, field and
 * comparison offered here is one something in Orbis actually reports, so a rule made in this screen is a rule that can
 * fire. There is no box to type a source into, because a source nobody reports would produce a rule that sat there
 * looking finished and never said anything.
 */

export interface RulesEditorProps {
  draft: ExperienceConfig
  /** Changes the draft the same way every other part of this screen does, so Keep and Cancel work unchanged. */
  change(next: ExperienceConfig): void
  say(message: string): void
}

/** A rule as this screen builds them, before it becomes a StoredRule. */
interface Draft {
  source: string
  field: string
  operator: RuleOperator
  value: string
  title: string
  body: string
  repeat: StoredRule['repeat']
  cooldownMinutes: number
}

const COOLDOWNS: { minutes: number; label: string }[] = [
  { minutes: 0, label: 'Every time' },
  { minutes: 5, label: 'At most every 5 minutes' },
  { minutes: 15, label: 'At most every 15 minutes' },
  { minutes: 60, label: 'At most once an hour' },
  { minutes: 60 * 24, label: 'At most once a day' }
]

const firstDraft = (): Draft => {
  const source = WATCHABLE[0]
  const field = source.fields[0]
  return {
    source: source.name,
    field: field.name,
    operator: OPERATORS_FOR[field.kind][0],
    value: field.states?.find(Boolean) ?? '',
    title: '',
    body: '',
    repeat: 'always',
    cooldownMinutes: 0
  }
}

/** The condition a draft describes, or null when it does not describe one. */
function conditionOf(draft: Draft): RuleCondition | null {
  if (!isWatchable(draft.source, draft.field, draft.operator)) return null
  if (NEEDS_NO_VALUE.includes(draft.operator)) {
    return { source: draft.source, field: draft.field, operator: draft.operator }
  }
  const known = watchableField(draft.source, draft.field)
  if (known?.kind === 'number') {
    const n = Number(draft.value)
    if (!Number.isFinite(n)) return null
    return { source: draft.source, field: draft.field, operator: draft.operator, value: n }
  }
  if (!draft.value.trim()) return null
  return { source: draft.source, field: draft.field, operator: draft.operator, value: draft.value.trim() }
}

export function RulesEditor({ draft, change, say }: RulesEditorProps): React.JSX.Element {
  const [making, setMaking] = useState<Draft | null>(null)

  const rules = draft.rules
  const editing = making ?? firstDraft()
  const source = WATCHABLE.find((s) => s.name === editing.source) ?? WATCHABLE[0]
  const field = source.fields.find((f) => f.name === editing.field) ?? source.fields[0]
  const operators = OPERATORS_FOR[field.kind]
  const condition = making ? conditionOf(making) : null
  const sentence = condition
    ? describeCondition(condition.source, condition.field, condition.operator, condition.value)
    : ''

  const edit = (patch: Partial<Draft>): void => setMaking({ ...editing, ...patch })

  /** Moving to another reading resets the comparison, because the old one may not apply to the new kind. */
  const pickField = (sourceName: string, fieldName: string): void => {
    const next = WATCHABLE.find((s) => s.name === sourceName) ?? WATCHABLE[0]
    const chosen = next.fields.find((f) => f.name === fieldName) ?? next.fields[0]
    edit({
      source: next.name,
      field: chosen.name,
      operator: OPERATORS_FOR[chosen.kind][0],
      value: chosen.states?.find(Boolean) ?? ''
    })
  }

  const add = (): void => {
    if (!making || !condition) return
    if (rules.length >= MAX_RULES) {
      say(`Orbis keeps ${MAX_RULES} rules. Remove one first.`)
      return
    }
    const at = Date.now()
    // Unique against the rules that exist, not against the clock and the list's length: two rules added and one removed
    // inside the same millisecond would otherwise collide, and `cleanRules` deduplicates by id -- so the collision
    // would show as a rule quietly vanishing on the next load.
    const taken = new Set(rules.map((r) => r.id))
    let id = `rule-${at.toString(36)}`
    for (let n = 1; taken.has(id); n++) id = `rule-${at.toString(36)}-${n}`
    const rule: StoredRule = {
      id,
      name: making.title.trim() || sentence,
      schemaVersion: RULES_SCHEMA_VERSION,
      enabled: true,
      test: condition,
      notify: { title: making.title.trim() || sentence, body: making.body.trim() },
      cooldownMs: making.cooldownMinutes * 60_000,
      repeat: making.repeat,
      createdAt: at,
      updatedAt: at
    }
    change({ ...draft, rules: [...rules, rule] })
    setMaking(null)
  }

  const setRule = (id: string, patch: Partial<StoredRule>): void =>
    change({ ...draft, rules: rules.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)) })

  const remove = (id: string): void => change({ ...draft, rules: rules.filter((r) => r.id !== id) })

  return (
    <>
      <div className="cz-section-head">
        <h3>Tell me when</h3>
        {!making && (
          <button type="button" className="queue-btn small" onClick={() => setMaking(firstDraft())}>
            <Plus size={12} /> New rule
          </button>
        )}
      </div>
      <p className="view-muted">
        A rule watches something Orbis already knows and tells you once, when it becomes true. It speaks on the change,
        not while it stays true, and it goes quiet during the hours you have set aside.
      </p>

      {making && (
        <div className="cz-rule-make">
          <div className="cz-rule-row">
            <span className="cz-rule-word">When</span>
            <select
              value={`${editing.source}.${editing.field}`}
              onChange={(e) => {
                const [s, f] = e.target.value.split('.')
                pickField(s, f)
              }}
              aria-label="What to watch"
            >
              {WATCHABLE.map((s) => (
                <optgroup key={s.name} label={`${s.label} — ${s.from}`}>
                  {s.fields.map((f) => (
                    <option key={f.name} value={`${s.name}.${f.name}`}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <select
              value={editing.operator}
              onChange={(e) => edit({ operator: e.target.value as RuleOperator })}
              aria-label="How to compare it"
            >
              {operators.map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABELS[op]}
                </option>
              ))}
            </select>

            {/* A comparison against the reading before needs no value; showing a box for one would invite nonsense. */}
            {!NEEDS_NO_VALUE.includes(editing.operator) &&
              (field.states ? (
                <select value={editing.value} onChange={(e) => edit({ value: e.target.value })} aria-label="Value">
                  {field.states.map((state) => (
                    <option key={state || 'none'} value={state}>
                      {state || 'nothing'}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.kind === 'number' ? 'number' : 'text'}
                  value={editing.value}
                  onChange={(e) => edit({ value: e.target.value })}
                  placeholder={field.unit ? `0${field.unit}` : 'value'}
                  aria-label="Value"
                />
              ))}
          </div>

          <div className="cz-rule-row">
            <span className="cz-rule-word">Say</span>
            <input
              value={editing.title}
              onChange={(e) => edit({ title: e.target.value })}
              placeholder={sentence || 'What the notification should say'}
              maxLength={80}
              aria-label="What the notification says"
            />
          </div>

          <div className="cz-rule-row">
            <select
              value={editing.repeat}
              onChange={(e) => edit({ repeat: e.target.value as StoredRule['repeat'] })}
              aria-label="How often"
            >
              <option value="always">Every time it becomes true</option>
              <option value="once">Once, then stop</option>
            </select>
            {editing.repeat === 'always' && (
              <select
                value={editing.cooldownMinutes}
                onChange={(e) => edit({ cooldownMinutes: Number(e.target.value) })}
                aria-label="How often at most"
              >
                {COOLDOWNS.map((c) => (
                  <option key={c.minutes} value={c.minutes}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="cz-rule-acts">
            {/* Shown before it is made, so what the rule will watch is readable as a sentence rather than a shape. */}
            <span className="view-muted">{sentence || 'Choose something to watch.'}</span>
            <button type="button" className="queue-btn small" onClick={() => setMaking(null)}>
              Cancel
            </button>
            <button type="button" className="queue-btn small primary" disabled={!condition} onClick={add}>
              Add rule
            </button>
          </div>
        </div>
      )}

      {rules.length === 0 && !making && <p className="view-muted">No rules yet.</p>}

      <div className="cz-rules">
        {rules.map((rule) => {
          const test = rule.test as Partial<RuleCondition>
          // A rule may outlive what it watched. Saying so is better than leaving it looking like it still works.
          const watching =
            typeof test.source === 'string' &&
            typeof test.field === 'string' &&
            test.operator !== undefined &&
            isWatchable(test.source, test.field, test.operator)
          return (
            <div key={rule.id} className={`cz-rule${rule.enabled ? '' : ' off'}`}>
              <div className="cz-rule-face">
                <span className="cz-rule-name">{rule.notify.title || rule.name}</span>
                <span className="cz-rule-why">
                  {watching
                    ? describeCondition(test.source!, test.field!, test.operator!, test.value)
                    : 'Orbis no longer reports what this watched.'}
                </span>
                {rule.lastFiredAt !== undefined && (
                  <span className="cz-rule-when">Last said {new Date(rule.lastFiredAt).toLocaleString()}</span>
                )}
              </div>
              <button
                type="button"
                className="queue-btn small"
                aria-pressed={rule.enabled}
                title={rule.enabled ? 'Stop this rule speaking' : 'Let this rule speak again'}
                onClick={() => setRule(rule.id, { enabled: !rule.enabled })}
              >
                {rule.enabled ? <Bell size={12} /> : <BellOff size={12} />}
              </button>
              <button
                type="button"
                className="queue-btn small"
                title={`Remove "${rule.notify.title || rule.name}"`}
                onClick={() => remove(rule.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </>
  )
}
