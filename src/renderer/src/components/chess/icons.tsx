/**
 * The small marks on Chess World's own buttons.
 *
 * These were the media characters -- `⏮ ◀ ▶ ⏭` -- typed straight into the buttons on seven screens. They are
 * drawn by whatever font the computer has, so they arrived at different weights and different sizes to each
 * other, sat off the middle of their buttons, and on a machine with no glyph for one of them showed an empty box.
 * Four buttons in a row, each a slightly different shape and height, is what "the arrows look bad" was.
 *
 * Drawn here instead, on one 24x24 grid, with one stroke weight, so a row of them lines up. They take the
 * colour of the text around them, so a disabled button dims its mark along with its label and nothing has to know
 * that separately.
 *
 * They are shapes, not letters, so every button that uses one still needs its own `aria-label` -- as the ones that
 * used characters always did, because `▶` is not a word either.
 */

export interface ChessIconProps {
  /** A size in pixels. The default suits the small buttons under a board. */
  size?: number
  className?: string
}

function frame({ size = 15, className }: ChessIconProps, children: React.ReactNode): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className ? `cw-icon ${className}` : 'cw-icon'}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Back to the start of the game. */
export const FirstIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <><path d="M18 5 L9 12 L18 19 Z" fill="currentColor" stroke="none" /><path d="M6 5 L6 19" /></>)

/** Back one move. */
export const PrevIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <path d="M16 5 L7 12 L16 19 Z" fill="currentColor" stroke="none" />)

/** On one move. */
export const NextIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <path d="M8 5 L17 12 L8 19 Z" fill="currentColor" stroke="none" />)

/** To the end of the line. */
export const LastIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <><path d="M6 5 L15 12 L6 19 Z" fill="currentColor" stroke="none" /><path d="M18 5 L18 19" /></>)

/** Turn the board round. */
export const FlipIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <><path d="M4 9 L12 4 L20 9" /><path d="M20 15 L12 20 L4 15" /></>)

/** Play, for a game or a line that runs by itself. */
export const PlayIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <path d="M7 4 L19 12 L7 20 Z" fill="currentColor" stroke="none" />)

/** Stop what is running. */
export const PauseIcon = (props: ChessIconProps): React.JSX.Element =>
  frame(props, <><path d="M9 5 L9 19" /><path d="M15 5 L15 19" /></>)
