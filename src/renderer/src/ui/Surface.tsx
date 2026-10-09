import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './IconButton'

/**
 * The frame every screen in the window wears.
 *
 * `.view` and `.view-head` have been the shape of a screen for a long time; what has been missing is anything that
 * made them compulsory. Screens were written four different ways — one borrowed the image gallery's frame, one had
 * no positioning at all and laid out in flow behind the chat, one had no close button and no keyboard way out. The
 * frame is a component now, so a screen gets the right one by not having a choice.
 *
 * What it guarantees, and what the four hand-written frames each got wrong at least once:
 *
 *   - it covers the chat, because `.view` positions it;
 *   - it has a name, because `label` is required and becomes the region's accessible name;
 *   - it has a way out, because `onClose` is required and draws the button;
 *   - the title is a real heading rather than a styled `div`.
 *
 * Escape is not handled here. It is handled once in `App.tsx`, where it can see whether a popover or a text field
 * wants the key first — a screen that needs it for something of its own keeps it by calling `preventDefault`, which
 * is the contract Markets, Create, Whiteboard and Student already follow.
 *
 * No new CSS: these are the classes that were already there.
 */
export interface SurfaceProps {
  /** The screen's name. The heading, and the region's accessible name. */
  title: ReactNode
  /** What the region is called, when the title is not plain words. Defaults to the title when it is a string. */
  label?: string
  /** Buttons for the screen as a whole. They sit to the right of the title, before the close button. */
  actions?: ReactNode
  /** Closing it. Required: a screen with no way out is the fault this component exists to stop. */
  onClose: () => void
  /** What the close button says. Worth setting when "Close" alone would be ambiguous. */
  closeLabel?: string
  /** Extra classes for the screen's own rules — `board-view`, `clips-view`. */
  className?: string
  children: ReactNode
}

export function Surface({ title, label, actions, onClose, closeLabel = 'Close', className, children }: SurfaceProps): React.JSX.Element {
  const named = label ?? (typeof title === 'string' ? title : undefined)
  return (
    <div className={['view', className ?? ''].filter((one) => one !== '').join(' ')} role="region" aria-label={named}>
      <header className="view-head">
        <h2>{title}</h2>
        <div className="view-actions">
          {actions}
          <IconButton label={closeLabel} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
      </header>
      {children}
    </div>
  )
}
