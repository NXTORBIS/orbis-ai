import { useState, type ReactElement } from 'react'
import { GitBranch, RotateCcw, Trash2 } from 'lucide-react'
import { branchList } from '../../../shared/conversationBranch'
import type { Conversation } from '../../../shared/types'

/**
 * The answers this conversation has had and moved away from.
 *
 * Editing a message or asking for a different answer no longer destroys what was there -- it parks it. This is the
 * way back to it, and the only place in the window that shows one exists at all.
 *
 * It is deliberately quiet: a conversation that has never been changed shows nothing here, because a control that is
 * always on the screen and almost never used is a control people learn to stop seeing.
 */
export default function OtherAnswers({
  conversation,
  onUse,
  onForget
}: {
  conversation?: Conversation
  onUse(branchId: string): void
  onForget(branchId: string): void
}): ReactElement | null {
  const [open, setOpen] = useState(false)
  const others = conversation ? branchList(conversation) : []
  if (!conversation || others.length === 0) return null

  return (
    <div className="others">
      <button type="button" className="others-toggle" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <GitBranch size={13} aria-hidden="true" />
        {others.length === 1 ? 'One other answer' : `${others.length} other answers`}
      </button>
      {open && (
        <ul className="others-list">
          {others.map((one) => (
            <li key={one.id} className="others-row">
              <span className="others-label" title={one.label}>
                {one.label}
              </span>
              <span className="others-when">{new Date(one.at).toLocaleString()}</span>
              <button type="button" className="icon-btn" aria-label={`Go back to "${one.label}"`} onClick={() => onUse(one.id)}>
                <RotateCcw size={14} aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn" aria-label={`Forget "${one.label}"`} onClick={() => onForget(one.id)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
