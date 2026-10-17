import type { ReactNode } from 'react'
import './ui.css'

/**
 * What a screen says when there is nothing in it yet.
 *
 * One line of dim text, centred in the space. No border, no card, no icon: a drawn box full of nothing is louder
 * than the nothing it describes, and six screens each drawing their own was the clutter. `.view-empty` in the
 * global stylesheet is the one rule behind this, and every screen that used to roll its own now points at it.
 *
 * Say what would be here, and — where it genuinely helps — put the one thing that would put something here in
 * `action`. One plain button, not three. A blank screen that only says "Nothing yet" leaves somebody looking for
 * the button.
 */
export interface EmptyStateProps {
  /** What would be here. A sentence, not a word. */
  children: ReactNode
  /** The one thing that would put something here — a button, a link. Optional, but usually the point. */
  action?: ReactNode
}

export function EmptyState({ children, action }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="view-empty">
      <p className="view-empty-words">{children}</p>
      {action ? <div className="view-empty-do">{action}</div> : null}
    </div>
  )
}
