import { button, h } from './dom.ts'

/**
 * The line along the bottom that says what just happened.
 *
 * One at a time, and always the words Orbis itself used: every change to the board comes back with a sentence
 * saying what it did, and this shows that sentence rather than a second description written here. A refusal is
 * shown the same way, for the same reason -- the person asked for something and is owed the answer.
 *
 * Spoken politely, so somebody using a screen reader hears "Weather added" without being interrupted.
 */

const STAY = 5_000

export interface Toast {
  say(text: string, action?: { label: string; press: () => void }): void
  destroy(): void
}

export function createToast(host: HTMLElement): Toast {
  const strip = h('div', { class: 'wg-toast-strip', role: 'status', 'aria-live': 'polite' })
  host.append(strip)
  let timer = 0

  const clear = (): void => {
    clearTimeout(timer)
    timer = 0
    strip.replaceChildren()
  }

  return {
    say: (text, action) => {
      clear()
      if (!text) return
      const toast = h('div', { class: 'wg-toast' }, h('span', { class: 'wg-toast-words', text }))
      if (action) {
        toast.append(
          button(action.label, () => {
            clear()
            action.press()
          }, action.label, 'wg-btn')
        )
      }
      const close = button('Dismiss', clear, '×', 'wg-icon-btn wg-toast-close')
      toast.append(close)
      strip.append(toast)
      // Goes away by itself: a message about something that has already happened should not need dismissing.
      timer = setTimeout(clear, action ? STAY * 2 : STAY) as unknown as number
    },
    destroy: () => {
      clear()
      strip.remove()
    }
  }
}
