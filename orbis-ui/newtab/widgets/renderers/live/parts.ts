import { h } from '../../dom.ts'

/**
 * The few small pieces the four live widgets share.
 *
 * Shared rather than copied because each of them is a promise the whole page makes: that a number drawn as a picture
 * is also there in words, and that nothing in a preview can be pressed. A promise kept in four places is a promise
 * three of them will eventually break.
 */

/** Words for somebody who hears the page instead of seeing it. In the markup, never on the screen. */
export const said = (text: string): HTMLElement => h('span', { class: 'wg-live-said', text })

/**
 * A control put out of reach.
 *
 * A preview is the real widget drawn from sample data, so its buttons and boxes are real too. They are turned off
 * rather than left out: a gallery tile that shows an Ask box with no box in it is not showing the widget.
 */
export function inert<T extends HTMLElement>(node: T, preview: boolean): T {
  if (preview) {
    node.setAttribute('disabled', '')
    node.setAttribute('tabindex', '-1')
  }
  return node
}

/** An arrow for a change: up, down, or a bar for a day that went nowhere. Drawn, so it is not a character that may be missing. */
export const ARROWS: Readonly<Record<'up' | 'down' | 'flat', string>> = Object.freeze({
  up: 'M6 10.5 L6 2.4 M2.6 5.6 L6 2.2 L9.4 5.6',
  down: 'M6 2 L6 10.1 M2.6 6.9 L6 10.3 L9.4 6.9',
  flat: 'M2.4 6.2 L9.6 6.2'
})
