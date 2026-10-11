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
 * **What it cannot do, which is worth knowing before reaching for it.** Everything passed as `actions` lands
 * inside `.view-actions`. Markets puts some of its header -- the currency picker, the live-connection state, the
 * section strip -- directly in `.view-head` and only the rest in `.view-actions`, and moving those into the
 * actions group changes the layout. So Markets keeps a hand-written frame, on purpose. A screen whose header is
 * genuinely two groups is not the shape this component is, and forcing it would be the one thing forbidden here:
 * a visible change smuggled in beside a construction change.
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
  /**
   * Attributes the screen's own stylesheet reads off its root.
   *
   * Markets writes `data-density` there and twenty-odd rules key off it, so without a way through this component
   * the biggest screen in the window could not wear the frame at all -- it would have had to keep its own copy
   * for the sake of one attribute. Narrow on purpose: the frame still decides the class, the role and the name.
   */
  rootData?: Record<string, string | number | undefined>
  children: ReactNode
}

export function Surface({ title, label, actions, onClose, closeLabel = 'Close', className, rootData, children }: SurfaceProps): React.JSX.Element {
  const named = label ?? (typeof title === 'string' ? title : undefined)
  return (
    <div className={['view', className ?? ''].filter((one) => one !== '').join(' ')} role="region" aria-label={named} {...(rootData ?? {})}>
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
