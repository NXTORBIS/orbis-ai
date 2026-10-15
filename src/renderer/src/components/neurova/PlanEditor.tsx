import { useState } from 'react'
import type { Edit, Energy, Finding, Plan, Vocal } from '../../../../shared/neurova/plan'

export interface PlanEditorProps {
  plan: Plan
  findings: Finding[]
  /** Why the last edit was refused, if it was. */
  lastRefusal?: string | null
  onEdit: (edit: Edit) => void
  onUndo: () => void
}

const ENERGY: Energy[] = ['unspecified', 'low', 'medium', 'high']
const VOCAL: Vocal[] = ['unspecified', 'none', 'lead']

export function PlanEditor({ plan, findings, lastRefusal, onEdit, onUndo }: PlanEditorProps): React.JSX.Element {
  const [newName, setNewName] = useState('')
  const errors = findings.filter((f) => f.level === 'error')
  const advice = findings.filter((f) => f.level === 'advice')
  return (
    <section className="nv-plan" aria-label="Song plan">
      <div className="nv-x-head">
        <h3>Plan</h3>
        <button type="button" className="queue-btn ghost" onClick={onUndo} disabled={plan.past.length === 0}>Undo last change</button>
      </div>
      <p className="nv-x-note">A plan is what you intend. It does not claim the audio follows it.</p>
      {lastRefusal ? <p className="nv-x-warn" role="alert">{lastRefusal}</p> : null}
      <ol className="nv-x-list">
        {plan.sections.map((s, i) => (
          <li key={s.id} className="nv-x-row">
            <div className="nv-x-row-top">
              <span className="nv-x-badge">{s.origin === 'user' ? 'you wrote' : 'suggested'}</span>
              <label className="nv-x-field nv-x-grow">
                <span>Name</span>
                <input value={s.name} disabled={s.locked} aria-describedby={s.locked ? `nv-lk-${s.id}` : undefined}
                  onChange={(e) => onEdit({ op: 'set', id: s.id, field: 'name', value: e.target.value })} />
              </label>
            </div>
            <div className="nv-x-row-mid">
              <label className="nv-x-field"><span>Energy</span>
                <select value={s.energy} disabled={s.locked} onChange={(e) => onEdit({ op: 'set', id: s.id, field: 'energy', value: e.target.value })}>
                  {ENERGY.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
              <label className="nv-x-field"><span>Vocal</span>
                <select value={s.vocal} disabled={s.locked} onChange={(e) => onEdit({ op: 'set', id: s.id, field: 'vocal', value: e.target.value })}>
                  {VOCAL.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
            <div className="nv-x-actions">
              <button type="button" className="queue-btn ghost" disabled={i === 0 || s.locked} aria-label={`Move ${s.name} up`} onClick={() => onEdit({ op: 'move', id: s.id, by: -1 })}>Up</button>
              <button type="button" className="queue-btn ghost" disabled={i === plan.sections.length - 1 || s.locked} aria-label={`Move ${s.name} down`} onClick={() => onEdit({ op: 'move', id: s.id, by: 1 })}>Down</button>
              <button type="button" className="queue-btn ghost" aria-pressed={s.locked} onClick={() => onEdit({ op: 'lock', id: s.id, locked: !s.locked })}>{s.locked ? 'Unlock' : 'Lock'}</button>
              <button type="button" className="queue-btn ghost" disabled={s.locked || plan.sections.length === 1} aria-label={`Remove ${s.name}`} onClick={() => onEdit({ op: 'remove', id: s.id })}>Remove</button>
            </div>
            {s.locked ? <p id={`nv-lk-${s.id}`} className="nv-x-note">{`"${s.name}" is locked. Unlock it to rename, change, move or remove it.`}</p> : null}
          </li>
        ))}
      </ol>
      <form className="nv-x-add" onSubmit={(e) => {
        e.preventDefault()
        const name = newName.trim()
        if (!name) return
        onEdit({ op: 'add', section: { id: `p-u-${plan.revision}-${plan.sections.length}`, type: 'free', name, purpose: '', energy: 'unspecified', vocal: 'unspecified', lyricSectionId: null }, after: plan.sections[plan.sections.length - 1]?.id })
        setNewName('')
      }}>
        <label className="nv-x-field nv-x-grow"><span>New section name</span>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} />
        </label>
        <button type="submit" className="queue-btn" disabled={!newName.trim()}>Add section</button>
      </form>
      <div className="nv-x-row-mid">
        <label className="nv-x-field nv-x-grow"><span>How it ends</span>
          <input value={plan.ending} maxLength={300} onChange={(e) => onEdit({ op: 'ending', value: e.target.value })} />
        </label>
        <label className="nv-x-field"><span>Target length (seconds)</span>
          <input type="number" min={1} max={3600} value={plan.targetSec ?? ''} placeholder="not set"
            onChange={(e) => onEdit({ op: 'target', seconds: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
      </div>
      <div className="nv-x-findings" aria-live="polite">
        {findings.length === 0 ? <p className="nv-x-note">No problems found in the plan.</p> : null}
        {errors.length > 0 ? (
          <div><h4>Problems ({errors.length})</h4><ul>{errors.map((f, i) => <li key={i}><strong>Error:</strong> {f.section ? `${f.section}: ` : ''}{f.message}</li>)}</ul></div>
        ) : null}
        {advice.length > 0 ? (
          <div><h4>Advice ({advice.length})</h4><ul>{advice.map((f, i) => <li key={i}><strong>Advice:</strong> {f.section ? `${f.section}: ` : ''}{f.message}</li>)}</ul></div>
        ) : null}
      </div>
    </section>
  )
}
