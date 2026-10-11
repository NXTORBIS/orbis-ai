import type { ReactNode } from 'react'
import { IconButton } from './IconButton'

/**
 * One thing in a list, with what you can do to it.
 *
 * Twenty-three of these — chats in the sidebar, clips, schedules, boards, alerts, triggers, saved currencies — and
 * they disagree about the thing that decides whether the list can be used from the keyboard at all.
 *
 * **What reveals the actions.** The sidebar and Schedules reveal them on `:hover` *and* `:focus-within`, so
 * tabbing to a row brings its buttons out. Most of the others reveal on hover alone — which means that for
 * somebody moving by keyboard, the buttons are reachable but invisible, and for somebody on a touch screen they
 * may as well not exist. `:focus-within` is the behaviour that wins here, and it costs nothing on a mouse.
 *
 * **Which row is the chosen one.** Five class names and four different answers for anything not looking at the
 * screen: `.on`, `.selected`, `.active` and `.is-chosen`, none of which says anything out loud. `selected` is a
 * real prop here and becomes `aria-current`, so the row says it.
 *
 * The actions are data rather than markup on purpose. Given as elements, every list decides for itself whether
 * they are icon buttons with names — and the ones that decided wrong are exactly how a list of chats ends up with
 * six buttons all called "button".
 *
 * No new CSS. Every class is passed in, so a converted row is the same pixels; what changes is what it says.
 */
export interface RowAction {
  /** What it does, in words. Becomes the name and the tooltip. */
  label: string
  icon: ReactNode
  onClick: () => void
  /** Lit, for something currently on. */
  on?: boolean
  /** For the one that deletes. */
  danger?: boolean
  disabled?: boolean
}

export interface ListRowProps {
  /** What this row is. Used as the row's accessible name when the title is not plain words. */
  name: string
  title: ReactNode
  subtitle?: ReactNode
  /** Something before the title — an icon, a colour, a picture. */
  icon?: ReactNode
  /** Picking the row. Without it the row is not a button and takes no focus. */
  onSelect?: () => void
  /** Whether this is the one being shown. Says so with `aria-current`, not only with a colour. */
  selected?: boolean
  actions?: readonly RowAction[]
  /** `li` inside a real list, `div` otherwise. */
  as?: 'li' | 'div'
  /** The row's own class — `sb-row`, `clip-row`, `sched-row`. */
  className?: string
  /** The class on the part that is pressed to pick the row — `sb-row-main`, `clip-main`. */
  mainClassName?: string
  /** The class around the buttons — `sb-row-actions`, `sched-tools`. */
  actionsClassName?: string
  /** The class on each button, when the family styles them itself rather than using `.icon-btn`. */
  actionClassName?: string
  /** The family's own classes for the two pieces of text. Nothing is invented here: a class of our own would
      change the layout of every row it touched, and the whole rule is that day one looks identical. */
  titleClassName?: string
  subtitleClassName?: string
  children?: ReactNode
}

export function ListRow({
  name,
  title,
  subtitle,
  icon,
  onSelect,
  selected,
  actions,
  as = 'li',
  className,
  mainClassName,
  actionsClassName,
  actionClassName,
  titleClassName,
  subtitleClassName,
  children
}: ListRowProps): React.JSX.Element {
  const Tag = as
  const main =
    onSelect === undefined ? (
      <div className={mainClassName}>
        {icon}
        <span className={titleClassName}>{title}</span>
        {subtitle === undefined ? null : <span className={subtitleClassName}>{subtitle}</span>}
      </div>
    ) : (
      <button
        type="button"
        className={mainClassName}
        onClick={onSelect}
        // `aria-current` rather than `aria-selected`: this is the one being shown, not one picked from a set that
        // is presented as a set. The two are not interchangeable and four of these got it wrong by using neither.
        aria-current={selected === true ? 'true' : undefined}
        aria-label={typeof title === 'string' ? undefined : name}
      >
        {icon}
        <span className={titleClassName}>{title}</span>
        {subtitle === undefined ? null : <span className={subtitleClassName}>{subtitle}</span>}
      </button>
    )

  return (
    <Tag className={[className ?? '', selected === true ? 'on' : ''].filter((one) => one !== '').join(' ')}>
      {main}
      {children}
      {actions === undefined || actions.length === 0 ? null : (
        <div className={actionsClassName}>
          {actions.map((one) => (
            <IconButton
              key={one.label}
              label={one.label}
              onClick={one.onClick}
              on={one.on}
              danger={one.danger}
              disabled={one.disabled}
              className={actionClassName}
              small
            >
              {one.icon}
            </IconButton>
          ))}
        </div>
      )}
    </Tag>
  )
}
