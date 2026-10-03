import { button, h, svg } from '../../dom.ts'

/**
 * The pieces every time widget is built out of: a ring, a hidden sentence, a button that knows it is in a preview,
 * and three small readers for settings.
 *
 * They are here rather than in each widget because a ring drawn eight slightly different ways looks like eight
 * widgets by eight people. One ring, one way of saying a thing to somebody who cannot see it, one way of turning a
 * preview's controls off.
 */

// ---------------------------------------------------------------- settings, read without surprises

type Settings = Readonly<Record<string, string | number | boolean>>

/** A text setting, trimmed of nothing: a note's own spaces are the note's. */
export const text = (settings: Settings, name: string, fallback = ''): string => (typeof settings[name] === 'string' ? (settings[name] as string) : fallback)

/** A number setting. Anything that is not a real number is the fallback, never NaN passed on into a sum. */
export const number = (settings: Settings, name: string, fallback = 0): number => {
  const value = settings[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const flag = (settings: Settings, name: string, fallback = false): boolean => (typeof settings[name] === 'boolean' ? (settings[name] as boolean) : fallback)

// ---------------------------------------------------------------- drawing

export interface RingOptions {
  /** How much of the ring has run, from 0 to 1. Nothing draws the empty track on its own, which is honest about
   * having nothing to measure rather than drawing an arc that means nothing. */
  fraction: number | null
  /** How thick the ring is, in the hundred units its box is wide. */
  width?: number
  /** Extra classes on the arc, for a widget that colours its own. */
  arcClass?: string
  className?: string
}

/**
 * A ring: a quiet full circle with a bright arc over the part that has run.
 *
 * Drawn in a box a hundred units square and left to be stretched by whatever holds it, so the same ring is the whole
 * of a small card and a detail of a large one. The arc is measured in hundredths (`pathLength`), so moving it is one
 * number and no arithmetic about circumferences.
 */
export function ring(options: RingOptions): SVGElement {
  const width = options.width ?? 8
  const radius = 50 - width / 2
  const parts: SVGElement[] = [svg('circle', { class: 'wg-time-ring-track', cx: 50, cy: 50, r: radius, 'stroke-width': width, fill: 'none' })]
  if (options.fraction !== null) {
    const run = Math.min(100, Math.max(0, options.fraction * 100))
    parts.push(
      svg('circle', {
        class: `wg-time-ring-arc${options.arcClass ? ` ${options.arcClass}` : ''}`,
        cx: 50,
        cy: 50,
        r: radius,
        'stroke-width': width,
        fill: 'none',
        pathLength: 100,
        'stroke-dasharray': `${run.toFixed(2)} 100`,
        'stroke-linecap': 'round',
        transform: 'rotate(-90 50 50)'
      })
    )
  }
  return svg('svg', { class: `wg-time-ring${options.className ? ` ${options.className}` : ''}`, viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false' }, ...parts)
}

/** A point on a circle a hundred units wide, at an angle measured clockwise from twelve. */
export function onCircle(degrees: number, radius: number): { x: number; y: number } {
  const turn = ((degrees - 90) * Math.PI) / 180
  return { x: 50 + Math.cos(turn) * radius, y: 50 + Math.sin(turn) * radius }
}

/** Words that are read aloud but not drawn, for a picture that says something the text does not. */
export const said = (words: string): HTMLElement => h('span', { class: 'wg-time-said', text: words })

/**
 * A button that does what it says, except in a preview, where nothing on a card does anything.
 *
 * The handler is simply never attached in a preview rather than attached and ignored, so there is no path by which a
 * gallery tile could change somebody's start page.
 */
export function pressable(preview: boolean, label: string, run: () => void, content: Node | string | (Node | string)[] = label, cls = 'wg-btn'): HTMLButtonElement {
  const node = button(label, preview ? () => undefined : run, content, cls)
  if (preview) {
    node.tabIndex = -1
    node.setAttribute('aria-disabled', 'true')
  }
  return node
}

/** A box that can be typed in, unless this is a preview, where it shows what it would hold and takes nothing. */
export function quiet<T extends HTMLInputElement | HTMLTextAreaElement>(preview: boolean, node: T): T {
  if (preview) {
    node.readOnly = true
    node.tabIndex = -1
  }
  return node
}

// ---------------------------------------------------------------- typing that survives being redrawn

export interface Typed {
  /** What is on the card now, which may be a moment ahead of what has been saved. */
  text: string
  /** What the widget's settings held the last time this was taken from them. */
  base: string
  focused: boolean
  caret: number
}

const scratches = new WeakMap<HTMLElement, Typed>()

/**
 * What somebody was in the middle of typing, kept across the card being drawn again.
 *
 * A note and a calculator are the two widgets you type into, and both keep what you typed in their own settings --
 * so every save comes back as a changed widget, and a changed widget is drawn again from scratch. Without this, the
 * last few characters and the caret would vanish a moment after every pause in typing.
 *
 * Which of the two is newer is decided by `base`: if the settings still hold what they held when this card last
 * looked, then what is on the card is the newer of the two and it stays. If the settings have moved -- the save
 * landed, or somebody edited the note in its settings, or in another window -- then the settings are newer and they
 * win. There is no clock in that decision and so no race to lose.
 */
export function typing(body: HTMLElement, stored: string): Typed {
  const kept = scratches.get(body)
  if (kept && kept.base === stored) return kept
  const fresh: Typed = { text: stored, base: stored, focused: kept?.focused ?? false, caret: stored.length }
  scratches.set(body, fresh)
  return fresh
}

/**
 * Puts somebody back where they were typing when the card was rebuilt out from under them.
 *
 * A box that is taken out of the page while it has the keyboard is not a box anybody left: `isConnected` tells the
 * two apart, so tabbing away really does give the keyboard up and being redrawn does not.
 */
export function resume<T extends HTMLInputElement | HTMLTextAreaElement>(node: T, kept: Typed): void {
  node.addEventListener('focus', () => {
    kept.focused = true
  })
  node.addEventListener('blur', () => {
    if (node.isConnected) kept.focused = false
  })
  if (!kept.focused) return
  queueMicrotask(() => {
    if (!node.isConnected || node.readOnly) return
    node.focus({ preventScroll: true })
    const at = Math.min(Math.max(0, kept.caret), node.value.length)
    try {
      node.setSelectionRange(at, at)
    } catch {
      // A box that does not take a selection. Being focused in the right place is most of it anyway.
    }
  })
}
