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
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void): void {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useDropdownOpen(active)
  useEffect(() => {
    if (!active) return
    const dismiss = (): void => dismissRef.current()
    const onMouseDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) dismiss()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', dismiss)
    const stopPagePointer = window.api?.onPagePointer?.(dismiss)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', dismiss)
      stopPagePointer?.()
    }
  }, [ref, active])
}
