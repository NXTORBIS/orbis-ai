import { useId, useState } from 'react'
import { Button, EmptyState } from '../../../ui'
import {
  ACTIVITIES, ACTIVITY_KINDS, activePlan, dismissedPlan, planTitle, type ActivityKind, type StudyPlan
} from '../../../../../shared/chess/coach'

/**
 * The plan, which belongs to the person and not to the coach.
 *
 * The coach suggests; everything here is the person overruling it. Lines can be moved, put aside, renamed and added,
 * and the two rules that make that worth doing are enforced in `coach.ts` rather than here: a line put aside stays
 * put aside even when the evidence behind it is still there, and the coach's own wording follows the evidence while
 * the person's order and their own lines do not move.
 *
 * `kept` says where the plan lives. It is not decoration: a screen that lets somebody carefully order nine lines
 * without saying whether that order survives closing the window is setting them up.
 */

export function StudyPlanList({
  plan,
  kept,
  onMove,
  onDismiss,
  onRestore,
  onRemove,
  onAdd,
  onRename,
  onResetTitle
}: {
  plan: StudyPlan
  kept: string
  onMove: (id: string, direction: 'up' | 'down') => void
  onDismiss: (id: string) => void
  onRestore: (id: string) => void
  onRemove: (id: string) => void
  onAdd: (title: string, activity: ActivityKind) => void
  onRename: (id: string, title: string) => void
  onResetTitle: (id: string) => void
}): React.JSX.Element {
  const id = useId()
  const [title, setTitle] = useState('')
  const [activity, setActivity] = useState<ActivityKind>('puzzle')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const showing = activePlan(plan)
  const aside = dismissedPlan(plan)

  const add = (): void => {
    const text = title.trim()
    if (!text) return
    onAdd(text, activity)
    setTitle('')
  }

  return (
    <div className="cw-co-pane">
      <h4 className="cw-co-title">Your study plan</h4>
      <p className="cw-co-dim">{kept}</p>

      {showing.length === 0
        ? <EmptyState>Nothing on the plan. The coach adds a line for each thing the record shows, and you can write your own below.</EmptyState>
        : (
          <ol className="cw-co-plan">
            {showing.map((item, index) => (
              <li key={item.id} className="cw-co-plan-line">
                <div className="cw-co-plan-move" role="group" aria-label={`Move "${planTitle(item)}"`}>
                  <Button size="tiny" kind="quiet" disabled={index === 0} onClick={() => onMove(item.id, 'up')}>Up</Button>
                  <Button size="tiny" kind="quiet" disabled={index === showing.length - 1} onClick={() => onMove(item.id, 'down')}>Down</Button>
                </div>
                <div className="cw-co-plan-body">
                  {editing === item.id
                    ? (
                      <div className="cw-co-plan-edit">
                        <label htmlFor={`${id}-edit`}>New wording</label>
                        <input
                          id={`${id}-edit`}
                          type="text"
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { onRename(item.id, draft); setEditing(null) }
                            if (e.key === 'Escape') setEditing(null)
                          }}
                        />
                        <Button size="tiny" onClick={() => { onRename(item.id, draft); setEditing(null) }}>Save</Button>
                        <Button size="tiny" kind="quiet" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    )
                    : <strong>{planTitle(item)}</strong>}
                  {item.what && <p className="cw-co-dim">{item.what}</p>}
                  <p className="cw-co-plan-where">
                    {ACTIVITIES[item.activity].label}
                    {item.from === 'coach' ? ' — suggested from what the record shows' : ' — your own line'}
                  </p>
                  {item.from === 'coach' && item.titleOverride !== undefined && (
                    <p className="cw-co-aside-note">
                      You called this &ldquo;{item.titleOverride}&rdquo;; the coach calls it &ldquo;{item.title}&rdquo;.
                      <Button size="tiny" kind="quiet" onClick={() => onResetTitle(item.id)}>Use the coach&rsquo;s wording</Button>
                    </p>
                  )}
                </div>
                <div className="cw-co-plan-acts">
                  {editing !== item.id && (
                    <Button size="tiny" kind="quiet" onClick={() => { setEditing(item.id); setDraft(planTitle(item)) }}>Reword</Button>
                  )}
                  <Button size="tiny" kind="quiet" onClick={() => onDismiss(item.id)}>Put aside</Button>
                  {item.from === 'person' && <Button size="tiny" kind="danger" onClick={() => onRemove(item.id)}>Remove</Button>}
                </div>
              </li>
            ))}
          </ol>
        )}

      <div className="cw-co-add">
        <h5 className="cw-co-subtitle">Add a line of your own</h5>
        <div className="cw-co-add-row">
          <span className="cw-co-add-field">
            <label htmlFor={`${id}-title`}>What you want to work on</label>
            <input id={`${id}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          </span>
          <span className="cw-co-add-field">
            <label htmlFor={`${id}-activity`}>Doing which</label>
            <select id={`${id}-activity`} value={activity} onChange={(e) => setActivity(e.target.value as ActivityKind)}>
              {ACTIVITY_KINDS.map((one) => <option key={one} value={one}>{ACTIVITIES[one].label}</option>)}
            </select>
          </span>
          <Button size="small" disabled={title.trim().length === 0} onClick={add}>Add</Button>
        </div>
        <p className="cw-co-dim">
          A line of your own is never touched by the coach: it keeps its wording and its place, and only you can take
          it off. A suggested line can be renamed too, but the sentence under it saying what the record shows stays as
          the record has it.
        </p>
      </div>

      {aside.length > 0 && (
        <details className="cw-co-numbers">
          <summary>{aside.length} put aside</summary>
          <p className="cw-co-dim">
            These stay put aside even when the record still shows the thing behind them, so a suggestion you have
            already decided about does not come back as new.
          </p>
          <ul className="cw-co-aside">
            {aside.map((item) => (
              <li key={item.id}>
                <span>{planTitle(item)}</span>
                <Button size="tiny" kind="quiet" onClick={() => onRestore(item.id)}>Bring back</Button>
                {item.from === 'person' && <Button size="tiny" kind="danger" onClick={() => onRemove(item.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
