import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * A button that is an icon, and therefore must say what it is.
 *
 * `.icon-btn` is already the window's one genuinely shared control — 33 files use it. What it has never had is
 * anything making the name compulsory, so a screen could render a bare icon and nothing would notice until somebody
 * using a screen reader met a button called "button". The label is a required prop here: it becomes the accessible
 * name and the tooltip, and there is no way to render one of these without it.
 *
 * No new CSS. This is the class that already exists, with the contract attached.
 */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title' | 'children'> {
  /** What pressing it does, in words. Becomes the accessible name and the tooltip. */
  label: string
  /** The icon. One element; the class sizes it. */
  children: ReactNode
  /** Smaller, for a row of actions inside a list item. */
  small?: boolean
  /** Lit, for something that is currently on. Carries `aria-pressed` with it. */
  on?: boolean
  /** For the one that deletes. */
  danger?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, small, on, danger, className, type, ...rest },
  ref
) {
  const classes = ['icon-btn', small ? 'small' : '', on ? 'on' : '', danger ? 'danger' : '', className ?? '']
    .filter((one) => one !== '')
    .join(' ')
  return (
    <button
      ref={ref}
      // Never a submit by accident: these sit inside forms often enough that the default would have been a bug.
      type={type ?? 'button'}
      className={classes}
      aria-label={label}
      title={label}
      // Only when it is a toggle. `aria-pressed` on a button that is not one says something untrue about it.
      {...(on === undefined ? {} : { 'aria-pressed': on })}
      {...rest}
    >
      {children}
    </button>
  )
})
