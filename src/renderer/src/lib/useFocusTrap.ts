import { useEffect, type RefObject } from 'react'

/**
 * Keeping the keyboard inside a dialog, and giving it back afterwards.
 *
 * Orbis has dialogs -- Settings, Shortcuts, confirmations -- and nothing held focus inside one. Pressing Tab enough
 * times walked out of the dialog and into the chat behind it, which for anybody who cannot see the screen means
 * operating controls they were told were covered up. Closing a dialog left focus wherever it happened to be, so the
 * button that opened it was no longer where the keyboard was.
 *
 * Three things, all of them what a dialog is expected to do:
 *
 * **Focus starts inside.** The first thing that can take focus gets it when the dialog opens, unless something in it
 * has asked for focus itself -- a search field that autofocuses is a better first stop than the close button, and
 * taking it away would be worse than doing nothing.
 *
 * **Tab stays inside.** Past the last control, Tab returns to the first; before the first, Shift+Tab goes to the
 * last. Measured each time rather than once, because a dialog's controls change as it is used.
 *
 * **Focus comes back.** Whatever had it before is given it again on close, so the keyboard is where it was.
 *
 * Escape is not here on purpose: closing is the dialog's own decision and several have more than one thing to close.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

/** The things in here that can actually take focus now. Hidden ones cannot, and must not be stops on the way round. */
function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((one) => {
    if (one.hasAttribute('inert') || one.getAttribute('aria-hidden') === 'true') return false
    // offsetParent is null for anything display:none, which is the case that matters; a fixed element has none either,
    // so its own size is checked as well rather than excluding it.
    return one.offsetParent !== null || one.getClientRects().length > 0
  })
}

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const root = ref.current
    if (!active || !root) return

    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null

    // Only if nothing inside has already taken focus: a field that autofocused chose better than this can.
    if (!root.contains(document.activeElement)) focusableIn(root)[0]?.focus()

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const stops = focusableIn(root)
      if (stops.length === 0) {
        // Nothing to move to, so moving would leave the dialog. Staying put is the honest answer.
        event.preventDefault()
        return
      }
      const first = stops[0]
      const last = stops[stops.length - 1]
      const here = document.activeElement
      if (event.shiftKey && (here === first || !root.contains(here))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && here === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      // Given back only if it is still there to give back to.
      if (returnTo && document.contains(returnTo)) returnTo.focus()
    }
  }, [ref, active])
}
