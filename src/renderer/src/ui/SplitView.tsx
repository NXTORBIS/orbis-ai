import type { ReactNode } from 'react'

/**
 * A list down one side and the thing you picked beside it.
 *
 * Nine screens are this shape — notes, boards, Pages, Markets, Settings, Customize, the formula vault, goals,
 * Student's settings — and each invented its own two class names for it. That part is harmless. What is not is
 * that **neither pane has a name**: somebody moving around by region hears "region, region" and has to go in and
 * read to find out which is the list.
 *
 * Both names are required here. They are two words each and they are the difference between a screen you can
 * navigate and one you have to explore.
 *
 * `nothingPicked` is the second reason. Every one of these has a state where the list has things in it and
 * nothing is chosen, and the ones that drew nothing left somebody looking at an empty half-screen with no idea
 * whether it was broken or waiting.
 *
 * No new CSS: both panes keep their own classes, so a converted screen is the same pixels.
 */
export interface SplitViewProps {
  /** The wrapper's class — `meeting-body`, `pages-body`, `mk-body`. */
  className?: string
  list: ReactNode
  /** What the list is — "Your notes", "Boards", "Settings". */
  listLabel: string
  listClassName?: string
  /**
   * `nav` when the list is how you move around the screen, `aside` when it is a filter beside the main thing, and
   * `ul` when the pane IS the list. The last one matters more than it looks: wrapping an existing `ul` in a `div`
   * puts a second element between the rules and the rows, and the browser's own list margins come back with it --
   * which is pixels moving, and pixels must not move.
   */
  listAs?: 'nav' | 'aside' | 'div' | 'ul'
  /** The thing that is open. Left out when nothing is picked, and then `nothingPicked` is shown instead. */
  detail?: ReactNode
  /** What the right-hand side is. Worth naming after whatever is open, when the screen knows. */
  detailLabel: string
  detailClassName?: string
  detailAs?: 'section' | 'div'
  /** What the right-hand side says when nothing is picked. */
  nothingPicked?: ReactNode
}

export function SplitView({
  className,
  list,
  listLabel,
  listClassName,
  listAs = 'nav',
  detail,
  detailLabel,
  detailClassName,
  detailAs = 'section',
  nothingPicked
}: SplitViewProps): React.JSX.Element {
  const ListTag = listAs
  const DetailTag = detailAs
  return (
    <div className={className}>
      <ListTag className={listClassName} aria-label={listLabel}>
        {list}
      </ListTag>
      <DetailTag className={detailClassName} aria-label={detailLabel}>
        {detail ?? nothingPicked}
      </DetailTag>
    </div>
  )
}
