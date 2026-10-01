import { startBackdrop } from '../../src/shared/backdrop.ts'

/**
 * The starfield, on a page of the browser.
 *
 * The same drawing the chat uses, from the same file, so the two halves of Orbis look like one application. It is
 * mounted only when the look asks for it: a preset that paints a flat background should not have stars drifting over
 * it, and a person who has turned movement down should not be given movement here.
 */

/**
 * The browser page, as the shared drawing describes it.
 *
 * The drawing has no platform of its own -- it is used by the chat and by the browser -- so each side hands it the
 * handful of things it needs. This is that handful, for a real document.
 */
function pageFor(doc: Document) {
  return {
    get hidden() {
      return doc.hidden
    },
    addEventListener: (type: string, listener: () => void) => doc.addEventListener(type, listener),
    removeEventListener: (type: string, listener: () => void) => doc.removeEventListener(type, listener),
    createCanvas: () => doc.createElement('canvas'),
    get devicePixelRatio() {
      return doc.defaultView ? doc.defaultView.devicePixelRatio : 1
    },
    requestFrame: (run: (time: number) => void) => (doc.defaultView ?? globalThis).requestAnimationFrame(run),
    cancelFrame: (handle: number) => (doc.defaultView ?? globalThis).cancelAnimationFrame(handle)
  }
}

let running: { resize(): void; stop(): void } | null = null
let canvas: HTMLCanvasElement | null = null

/**
 * Shows or hides the field.
 *
 * `wanted` comes from the look Orbis is wearing: the backdrop its preset asked for. `still` is reduced motion, which
 * keeps the field and stops it moving rather than removing it -- the stars are the look, the drift is the preference.
 */
export function setBackdrop(wanted: boolean, still: boolean): void {
  if (!wanted) {
    running?.stop()
    running = null
    canvas?.remove()
    canvas = null
    return
  }

  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.className = 'hud-particles'
    canvas.setAttribute('aria-hidden', 'true')
    // Behind everything and untouchable: a backdrop that swallowed a click would be a background eating the page.
    document.body.prepend(canvas)
  }

  running?.stop()
  running = startBackdrop(canvas, pageFor(document), { animated: !still })
}

/** The window changed size, so the field needs laying out again. Nothing in the drawing listens for this itself. */
window.addEventListener('resize', () => running?.resize())
