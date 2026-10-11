import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * A button with words on it.
 *
 * Sixty-five hand-written kinds across the window, in two families that each already work: `queue-btn`, the pill,
 * used 215 times across 42 files; and `st-btn`, the panel, used 171 times across 29. Neither is wrong and this
 * does not replace either — it puts the contract on top of them, because what the copies disagree about is not
 * how they look.
 *
 * **They disagree about the quiet one's name.** The pill family calls it `ghost`, the panel family and Courses
 * and the laboratories call it `quiet`. Two words for one idea is how somebody writes a third.
 *
 * **They disagree about waiting.** Several screens hand-write the same dance — swap the words for "Saving…",
 * disable the button, remember to put it back — and each does it slightly differently. `busy` does all three,
 * and keeps the button's width, so a row of buttons does not jump when one of them starts working.
 *
 * **They forget `type`.** These sit inside forms often enough that the HTML default of `submit` has been a real
 * bug more than once. It is always `button` here unless something asks otherwise.
 *
 * No new CSS: `look` picks which of the two existing families to wear.
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type'> {
  children: ReactNode
  /** Which family. `pill` is `queue-btn`, the window's common one; `panel` is `st-btn`. */
  look?: 'pill' | 'panel'
  /** `primary` is the loud one, `quiet` has no border, `danger` is the one that deletes. */
  kind?: 'normal' | 'primary' | 'quiet' | 'danger'
  size?: 'small' | 'tiny' | 'big'
  /** Lit, for a button that is currently on. Carries `aria-pressed` with it. */
  on?: boolean
  /** Working. Says so, stops a second press, and keeps the button's width so nothing jumps. */
  busy?: boolean
  /** What it says while working. "Saving…", "Checking…". */
  busyLabel?: ReactNode
  /** An icon before the words. */
  icon?: ReactNode
  type?: 'button' | 'submit'
}

/** The quiet one is `ghost` in the pill family and `quiet` in the panel family. One prop, two spellings. */
const QUIET: Record<'pill' | 'panel', string> = { pill: 'ghost', panel: 'quiet' }

export function Button({
  children,
  look = 'pill',
  kind = 'normal',
  size,
  on,
  busy,
  busyLabel,
  icon,
  type,
  className,
  disabled,
  ...rest
}: ButtonProps): React.JSX.Element {
  const classes = [
    look === 'pill' ? 'queue-btn' : 'st-btn',
    kind === 'quiet' ? QUIET[look] : kind === 'normal' ? '' : kind,
    size ?? '',
    on ? 'on' : '',
    busy ? 'is-busy' : '',
    className ?? ''
  ]
    .filter((one) => one !== '')
    .join(' ')
  return (
    <button
      // Never a submit by accident.
      type={type ?? 'button'}
      className={classes}
      disabled={disabled === true || busy === true}
      // Said out loud as well as shown, or somebody not watching the button has no idea it is working.
      aria-busy={busy === true ? true : undefined}
      {...(on === undefined ? {} : { 'aria-pressed': on })}
      {...rest}
    >
      {icon}
      {busy === true && busyLabel !== undefined ? busyLabel : children}
    </button>
  )
}
