import type { WidgetRenderer } from '../../api.ts'
import { h } from '../../dom.ts'
import { calculate, sumText, sumValue } from './sums.ts'
import { pressable, quiet, resume, text, typing, type Typed } from './parts.ts'

/**
 * A calculator that works the sum out itself.
 *
 * The arithmetic is in `calculate` (sums.ts), which reads the text a character at a time: no `eval`, no
 * `new Function`, nothing that would turn a start page into something that runs whatever was pasted into it.
 *
 * The display is a real text box, so a keyboard works in it without the widget having to reinvent one -- every key,
 * selecting, pasting and undo included. The pad types into that same box at the caret, so the two ways of working
 * are the same way of working.
 */

/** One key: what it draws, what it is called out loud, and what it types. */
interface Key {
  area: string
  mark: string
  label: string
  /** What goes into the box. Absent for the two keys that do something instead. */
  types?: string
}

const KEYS: readonly Key[] = Object.freeze([
  { area: 'clr', mark: 'C', label: 'Clear' },
  { area: 'opn', mark: '(', label: 'Open bracket', types: '(' },
  { area: 'cls', mark: ')', label: 'Close bracket', types: ')' },
  { area: 'pct', mark: '%', label: 'Per cent', types: '%' },
  { area: 'div', mark: '÷', label: 'Divide', types: '÷' },
  { area: 'mul', mark: '×', label: 'Multiply', types: '×' },
  { area: 'sub', mark: '−', label: 'Take away', types: '−' },
  { area: 'add', mark: '+', label: 'Add', types: '+' },
  { area: 'dot', mark: '.', label: 'Point', types: '.' },
  { area: 'eq', mark: '=', label: 'Work it out' },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => ({ area: `k${digit}`, mark: String(digit), label: String(digit), types: String(digit) }))
])

export const calculator: WidgetRenderer = (ctx) => {
  const kept = typing(ctx.body, text(ctx.settings, 'sum'))
  const root = h('div', { class: 'wg-calc', 'data-size': ctx.size })

  const box = quiet(
    ctx.preview,
    h('input', {
      class: 'wg-calc-typed',
      type: 'text',
      inputmode: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      maxlength: '120',
      'aria-label': 'The sum',
      placeholder: '0'
    })
  )
  box.value = kept.text
  const answer = h('p', { class: ctx.size === 'small' ? 'wg-time-said' : 'wg-calc-answer', role: 'status', 'aria-live': 'polite' })
  root.appendChild(h('div', { class: 'wg-calc-screen' }, box, answer))

  const pad = h('div', { class: 'wg-calc-pad', role: 'group', 'aria-label': 'Calculator keys' })
  for (const key of KEYS) {
    const press = key.area === 'clr' ? clearAll : key.area === 'eq' ? workItOut : () => type(key.types ?? '')
    const button = pressable(ctx.preview, key.label, press, key.mark, 'wg-calc-key')
    button.style.setProperty('grid-area', key.area)
    button.dataset.key = key.area
    pad.appendChild(button)
  }
  root.appendChild(pad)
  ctx.body.appendChild(root)

  /** What is on screen, told to the card so it is still there after a reload. */
  function hold(value: string, caret?: number): void {
    box.value = value
    kept.text = value
    kept.caret = caret ?? value.length
    if (caret !== undefined) {
      try {
        box.setSelectionRange(caret, caret)
      } catch {
        // Not a box with a caret. The value is what matters.
      }
    }
    ctx.save({ sum: value })
    say()
  }

  /** The running answer, under the sum. Nothing at all while the box is empty: a calculator showing 0 is lying. */
  function say(): void {
    const sum = calculate(box.value)
    answer.textContent = sum.ok ? sumText(sum.value) : sum.error
    root.dataset.wrong = !sum.ok && sum.error !== '' ? 'yes' : 'no'
  }

  /**
   * A key types into the box at the caret.
   *
   * Where the caret is has to be read before the box is focused, because focusing a box that did not have the
   * keyboard moves the caret -- and a key pressed halfway along a sum has to land halfway along the sum.
   */
  function type(what: string): void {
    const from = box.selectionStart ?? box.value.length
    const to = box.selectionEnd ?? from
    const next = `${box.value.slice(0, from)}${what}${box.value.slice(to)}`.slice(0, 120)
    box.focus({ preventScroll: true })
    hold(next, Math.min(from + what.length, next.length))
  }

  function clearAll(): void {
    box.focus({ preventScroll: true })
    hold('')
  }

  function workItOut(): void {
    const sum = calculate(box.value)
    if (!sum.ok) return say()
    box.focus({ preventScroll: true })
    hold(sumValue(sum.value))
  }

  if (!ctx.preview) {
    box.addEventListener('input', () => {
      kept.text = box.value
      kept.caret = box.selectionStart ?? box.value.length
      ctx.save({ sum: box.value })
      say()
    })
    box.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        workItOut()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        clearAll()
      }
    })
  }
  resume(box, kept)
  sendBack(ctx.preview, kept, (value) => ctx.save({ sum: value }))
  say()
}

/**
 * Sends on what was typed when the card was rebuilt before the save had gone.
 *
 * The card holds a change back for a moment before saving it, and starts that wait again each time it is drawn. A
 * card drawn in that gap would otherwise drop the last thing typed, so what is on screen is simply offered again.
 */
function sendBack(preview: boolean, kept: Typed, save: (value: string) => void): void {
  if (preview || kept.text === kept.base) return
  save(kept.text)
}
