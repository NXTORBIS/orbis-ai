/**
 * Who has the omnibox, and how it is asked for.
 *
 * Focus went wrong here in the way it usually goes wrong: `input.focus()` scattered through whichever component
 * happened to want it, each call correct on its own and none of them aware of the others. The symptoms are always the
 * same -- it works, then it does not, then somebody adds a `setTimeout` and it works again on their machine.
 *
 * A timeout is not a fix. It is a guess about how long somebody else's work takes, and it is wrong the moment the
 * machine is busy. What is actually being waited for is almost always one of three real, observable things:
 *
 *   - the element does not exist yet
 *   - the document is not visible, so the platform will refuse focus
 *   - something else is mid-way through taking focus for a reason of its own
 *
 * Each of those has an event. This waits for the event.
 *
 * One rule decides the arguments: **the last explicit request wins, and an implicit one never beats an explicit one.**
 * Somebody pressing Ctrl+L has said what they want; a panel mounting and helpfully focusing itself has not. When the
 * two collide -- which is exactly the case that produced "the sidebar steals my cursor" -- the person wins.
 */

export type FocusState = 'idle' | 'requested' | 'committed' | 'blurred' | 'unavailable'

export type FocusReason =
  /** The person asked: a shortcut, a click, a deliberate action. Outranks everything. */
  | 'explicit'
  /** Something in the interface would like focus: a view opening, a page finishing. Yields to explicit. */
  | 'implicit'

export interface FocusRequest {
  reason?: FocusReason
  /** Select what is already there, as a shortcut into the address bar does. */
  selectAll?: boolean
  /** Where to put the caret. Ignored when `selectAll` is set. */
  caret?: 'start' | 'end' | 'keep'
  /** For diagnosis: who asked. Never shown to anybody. */
  from?: string
}

export interface OmniboxFocus {
  /** Asks for focus. Resolves to whether the input really ended up focused -- not whether focus was attempted. */
  requestFocus(request?: FocusRequest): Promise<boolean>
  focus(): Promise<boolean>
  blur(): void
  selectAll(): void
  getFocusState(): FocusState
  /** True when the input is the document's active element right now. Read, never remembered. */
  hasFocus(): boolean
  /** Watches state changes, for anything that needs to follow along. */
  onChange(listener: (state: FocusState) => void): () => void
  destroy(): void
}

const NEXT_FRAME = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Waits for the document to be visible.
 *
 * A hidden document refuses focus outright on every platform, and this is the single most common reason a focus call
 * "does nothing": the window was still coming up. This waits for the real event rather than guessing at a duration.
 */
function whenVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return Promise.resolve()
  return new Promise((resolve) => {
    const on = (): void => {
      if (document.visibilityState !== 'visible') return
      document.removeEventListener('visibilitychange', on)
      resolve()
    }
    document.addEventListener('visibilitychange', on)
  })
}

export function createOmniboxFocus(getInput: () => HTMLInputElement | null): OmniboxFocus {
  let state: FocusState = 'idle'
  const listeners = new Set<(s: FocusState) => void>()
  /** Rises on every request, so a slow implicit one cannot land after a later explicit one. */
  let generation = 0
  let lastExplicit = 0

  const set = (next: FocusState): void => {
    if (state === next) return
    state = next
    for (const listener of listeners) {
      try {
        listener(state)
      } catch {
        // One listener's problem is not the omnibox's.
      }
    }
  }

  const input = (): HTMLInputElement | null => getInput()

  const onFocus = (): void => set('committed')
  const onBlur = (): void => set('blurred')
  let watched: HTMLInputElement | null = null
  const watch = (): void => {
    const el = input()
    if (el === watched) return
    watched?.removeEventListener('focus', onFocus)
    watched?.removeEventListener('blur', onBlur)
    watched = el
    watched?.addEventListener('focus', onFocus)
    watched?.addEventListener('blur', onBlur)
  }

  function place(el: HTMLInputElement, request: FocusRequest): void {
    try {
      if (request.selectAll) {
        el.select()
        return
      }
      const caret = request.caret ?? 'end'
      if (caret === 'keep') return
      const at = caret === 'start' ? 0 : el.value.length
      el.setSelectionRange(at, at)
    } catch {
      // A control that will not take a selection is still focused, which is the part that matters.
    }
  }

  return {
    getFocusState: () => state,
    hasFocus: () => {
      const el = input()
      return Boolean(el) && document.activeElement === el
    },

    async requestFocus(request: FocusRequest = {}) {
      const reason = request.reason ?? 'implicit'
      const mine = ++generation
      if (reason === 'explicit') lastExplicit = mine
      set('requested')
      watch()

      // The document has to be visible before the platform will give focus to anything.
      await whenVisible()

      // The element may not be in the document yet. One frame is the real wait -- the frame the element is created in
      // -- and if it is still absent after that, it genuinely is not there and saying so is better than trying again
      // forever on a timer.
      let el = input()
      if (!el) {
        await NEXT_FRAME()
        el = input()
      }
      if (!el || !el.isConnected) {
        set('unavailable')
        return false
      }

      // An implicit request that a person has since overruled is dropped. This is the sidebar-steals-the-cursor case,
      // and it is decided here rather than by whichever handler happened to run last.
      if (reason === 'implicit' && lastExplicit > mine) return false
      if (mine !== generation && reason === 'implicit') return false

      watch()
      el.focus({ preventScroll: true })
      place(el, request)

      // What actually happened, not what was attempted. Focus can be refused, and a caller deserves to know.
      const got = document.activeElement === el
      set(got ? 'committed' : 'unavailable')
      return got
    },

    focus() {
      return this.requestFocus({ reason: 'explicit' })
    },

    blur() {
      const el = input()
      if (el && document.activeElement === el) el.blur()
      set('blurred')
    },

    selectAll() {
      const el = input()
      try {
        el?.select()
      } catch {
        /* nothing to select */
      }
    },

    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    destroy() {
      watched?.removeEventListener('focus', onFocus)
      watched?.removeEventListener('blur', onBlur)
      watched = null
      listeners.clear()
    }
  }
}

/**
 * The shortcuts that mean "put me in the address bar".
 *
 * Bound once, by the omnibox, rather than by every surface that wants them -- which is how duplicate handlers and
 * double navigation start. Returns a function that unbinds them again.
 */
export function bindFocusShortcuts(focus: OmniboxFocus): () => void {
  const onKey = (e: KeyboardEvent): void => {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl || e.altKey) return
    const key = e.key.toLowerCase()
    if (key !== 'l' && key !== 'e') return
    e.preventDefault()
    e.stopPropagation()
    // Explicit, and selecting what is there: a person reaching for the address bar means to replace it.
    void focus.requestFocus({ reason: 'explicit', selectAll: true, from: `ctrl+${key}` })
  }
  // Capture, so a page or a panel cannot swallow the shortcut before the omnibox sees it.
  document.addEventListener('keydown', onKey, true)
  return () => document.removeEventListener('keydown', onKey, true)
}
