import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './ui.css'

/**
 * A small round control that is either on or off.
 *
 * There are seven of these in the window and they disagree about how they say so: some carry `aria-pressed`, some
 * `aria-selected`, some neither — which means some of them do not say so at all to anything that is not looking at
 * the screen. `aria-pressed` is always here and always correct, because `on` is a required prop.
 *
 * `aria-selected` belongs to something chosen from a set that is listed as a set — a tab, an option. A chip that
 * turns a filter on is pressed, not selected, and the two are not interchangeable.
 */
export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed' | 'children' | 'type'> {
  /** Whether it is on. Required: a toggle that does not say which way it is set is the fault this exists to stop. */
  on: boolean
  children: ReactNode
}

export function Chip({ on, children, className, ...rest }: ChipProps): React.JSX.Element {
  return (
    <button type="button" className={['ui-chip', className ?? ''].filter((one) => one !== '').join(' ')} aria-pressed={on} {...rest}>
      {children}
    </button>
  )
}
