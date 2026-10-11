import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

let openDropdowns = 0

/**
 * Marks the document while any menu or dropdown is open. The top rows of the window are window-drag areas (there is no
 * native title bar), and Windows swallows clicks there, so while something is open those areas stop dragging and a
 * click on them reaches the page like any other click and closes it.
 */
export function useDropdownOpen(active: boolean): void {
  useEffect(() => {
    if (!active) return
    openDropdowns++
    document.documentElement.dataset.dropdownOpen = ''
    return () => {
      openDropdowns = Math.max(0, openDropdowns - 1)
      if (!openDropdowns) delete document.documentElement.dataset.dropdownOpen
    }
  }, [active])
}

/**
 * Calls `onDismiss`, while `active`, when the user clicks anywhere outside `ref`: elsewhere in the Orbis window
 * (including the window's drag areas), inside a browser page (which the window's document never sees, so the main
 * process reports it), or outside Orbis. Escape dismisses too.
 */
export interface DismissOptions {
  /**
   * Whether Escape dismisses too. True unless said otherwise.
   *
   * The address bar sets it false, because Escape there is a chain rather than a single answer: the first press
   * clears the keyboard's place in the list and the inline completion, the second puts the list away, and the
   * third gives up on what was typed. Binding Escape here as well made the first press do all three at once --
   * which is not a small difference, because somebody pressing Escape to get rid of a highlighted suggestion does
   * not want the list they were reading to vanish with it.
   */
  escape?: boolean
}

export function useDismiss(
  ref: RefObject<HTMLElement | null> | RefObject<HTMLElement | null>[],
  active: boolean,
  onDismiss: () => void,
  options: DismissOptions = {}
): void {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  // A panel rendered at the top of the HUD is not inside its own button, so a dropdown can name every part of itself.
  const parts = Array.isArray(ref) ? ref : [ref]
  const partsRef = useRef(parts)
  partsRef.current = parts
  useDropdownOpen(active)
  useEffect(() => {
    if (!active) return
    const dismiss = (): void => dismissRef.current()
    const onMouseDown = (e: MouseEvent): void => {
      const known = partsRef.current.filter((part) => part.current)
      if (known.length && !known.some((part) => part.current!.contains(e.target as Node))) dismiss()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    const wantsEscape = options.escape !== false
    document.addEventListener('mousedown', onMouseDown)
    if (wantsEscape) document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', dismiss)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      if (wantsEscape) document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', dismiss)
    }
    // `options.escape` is read rather than watched: a caller that changed its mind mid-open would be a caller
    // describing two different controls, and every one of them passes a literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])
}
