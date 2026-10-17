import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import './ui.css'

/**
 * The header a screen wears when its title is not the only thing in the row.
 *
 * `Surface` already draws a title and a way out, and most screens need nothing more. Three did not fit it and so
 * kept headers of their own: the laboratories, Courses and the toolkit each have a title with a count under it, a
 * box to narrow the list, and a way out — the same three parts, written three times, disagreeing about all of it.
 * The titles came out at 13px, 15px and 1.6rem, the counts were two different colours, and the search box was
 * pushed to the end of the row by three different tricks.
 *
 * So this is that one shape. The row is `.view-head` and the buttons sit in `.view-actions`, the two classes the
 * window has always used for a screen's header, which is why moving onto this takes almost no new CSS: what was
 * genuinely missing was somewhere to put the line under the title and somewhere to put the search box.
 *
 * **The way out is not optional.** It is either the close button this draws, or something you pass as `lead` — the
 * toolkit's way out is a "Back" pill at the start of the row, because inside a tool that button means one step up
 * rather than out. One of the two is required, and the type will not let you write a header with neither.
 */
type WayOut =
  | {
      /** Closing the screen. Draws the close button at the end of the row. */
      onClose: () => void
      /** What the close button says. "Close" alone is often ambiguous — say which screen. */
      closeLabel: string
      lead?: never
    }
  | {
      /** A way out of your own, at the start of the row — the toolkit's "Back", which goes up a level or out. */
      lead: ReactNode
      onClose?: never
      closeLabel?: never
    }

export type ViewHeaderProps = WayOut & {
  /** The screen's name. A real heading, drawn the size every other screen's title is drawn. */
  title: ReactNode
  /** A small picture beside the title. Decoration, so give it `aria-hidden`. */
  icon?: ReactNode
  /**
   * The line under the title: how many things are in the list, how many match, or what the screen is for.
   *
   * Worth saying in words rather than leaving blank. A list that is still being read says so, and one that matched
   * nothing says that too, which is the difference between a screen that is quiet and a screen that looks broken.
   */
  note?: ReactNode
  /** The box that narrows the list. It takes the slack in the row, so the title and the buttons keep their size. */
  search?: ReactNode
  /** Buttons for the screen as a whole. They sit before the way out. */
  actions?: ReactNode
  /** Extra classes for the screen's own rules — spacing, a maximum width. */
  className?: string
}

export function ViewHeader({ title, icon, note, search, actions, className, ...wayOut }: ViewHeaderProps): React.JSX.Element {
  return (
    <header className={['view-head', 'ui-head', className ?? ''].filter((one) => one !== '').join(' ')}>
      {wayOut.lead}
      <div className="ui-head-name">
        {icon}
        <div>
          <h2>{title}</h2>
          {note !== undefined && note !== null && <p>{note}</p>}
        </div>
      </div>
      {search !== undefined && <div className="ui-head-find">{search}</div>}
      {(actions !== undefined || wayOut.onClose !== undefined) && (
        <div className="view-actions">
          {actions}
          {wayOut.onClose !== undefined && (
            <IconButton label={wayOut.closeLabel} onClick={wayOut.onClose}>
              <X size={16} />
            </IconButton>
          )}
        </div>
      )}
    </header>
  )
}
