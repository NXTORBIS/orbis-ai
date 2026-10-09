import type { ReactNode } from 'react'
import './ui.css'

/**
 * What a screen says when there is nothing in it yet.
 *
 * There are twenty-one of these in the window — `.view-empty`, `.images-empty`, `.mk-empty`, `.st-empty`,
 * `.notify-none`, `.labs-none` and the rest — which is twenty-one chances for one of them to say nothing useful.
 * The shape that works is the same every time: say what would be here, and say the one thing that would put
 * something here.
 *
 * `.view-empty` already exists and is the one this uses. The component's value is the second prop: a blank screen
 * that only says "Nothing yet" leaves somebody looking for the button, and `action` is the place to put it.
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
