import { clientSize, embedWindow, findBrowserWindow, type Embedded, type Rect } from './embed.ts'

/** The browser view's region in the Orbis window, as the renderer measures it (CSS pixels of the window's client area). */
export interface EmbedRegion {
  x: number
  y: number
  width: number
  height: number
  /** The renderer's devicePixelRatio (display scale times page zoom). */
  dpr: number
  /** Whether the browser view is showing (false: the chat is). */
  visible: boolean
  /** The renderer's viewport in CSS pixels: with the window's real client size it gives the true CSS-to-pixel scale (display scale, zoom, forced scale). */
  viewportWidth?: number
}

export function parseRegion(v: unknown): EmbedRegion | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const n = (k: string): number => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : NaN)
  const r: EmbedRegion = { x: n('x'), y: n('y'), width: n('width'), height: n('height'), dpr: n('dpr'), visible: o.visible === true }
  if (typeof o.viewportWidth === 'number' && o.viewportWidth > 0 && o.viewportWidth < 100000) r.viewportWidth = o.viewportWidth
  if ([r.x, r.y, r.width, r.height, r.dpr].some(Number.isNaN) || r.dpr <= 0 || r.dpr > 8 || r.width < 0 || r.height < 0 || r.width > 20000 || r.height > 20000) return null
  return r
}

export function physicalRect(r: EmbedRegion): Rect {
  const left = Math.round(r.x * r.dpr)
  const top = Math.round(r.y * r.dpr)
  return { x: left, y: top, width: Math.max(0, Math.round((r.x + r.width) * r.dpr) - left), height: Math.max(0, Math.round((r.y + r.height) * r.dpr) - top) }
}

/** Keeps Chromium's window inside the Orbis window: attaches it when it exists, follows the region, hides it for the chat. */
export class EmbedController {
  private region: EmbedRegion | null = null
  private child: Embedded | null = null
  private timer: NodeJS.Timeout | null = null
  private keepOnTop: NodeJS.Timeout | null = null
  private watch: NodeJS.Timeout | null = null
  /** Whether the browser is currently showing, so the keyboard is handed over once on the way in rather than on every region update. */
  private shown = false
  private readonly parent: () => bigint | null

  constructor(parent: () => bigint | null) {
    this.parent = parent
  }

  get attachedWindow(): Embedded | null {
    return this.child
  }

  setRegion(region: EmbedRegion): void {
    this.region = region
    this.apply()
  }

  /** The browser process started: wait for its window (it appears a moment after the process), then embed it. */
  attach(pid: number, timeoutMs = 60_000, find: (pid: number) => bigint | null = findBrowserWindow, supervise = false): void {
    this.detach()
    const deadline = Date.now() + timeoutMs
    const tick = (): void => {
      const parent = this.parent()
      const hwnd = parent ? find(pid) : null
      if (parent && hwnd) {
        this.child = embedWindow(parent, hwnd)
        this.timer = null
        this.keepOnTop = setInterval(() => {
          if (this.child && this.region?.visible) this.child.raise()
        }, 250)
        // A program that makes its own window (and may make another, or put its frame back, when it changes mode) is
        // watched: whenever its window is not a child of this one, it is made one again.
        if (supervise) {
          this.watch = setInterval(() => {
            const p = this.parent()
            const h = p ? find(pid) : null
            if (!p || !h) return
            if (!this.child || this.child.hwnd !== h || this.child.parent() !== p) {
              this.child = embedWindow(p, h)
              this.shown = false
              this.apply()
            }
          }, 60)
        }
        this.apply()
        return
      }
      if (Date.now() < deadline) this.timer = setTimeout(tick, 15)
    }
    tick()
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.keepOnTop) clearInterval(this.keepOnTop)
    this.keepOnTop = null
    if (this.watch) clearInterval(this.watch)
    this.watch = null
    if (this.shown) this.child?.holdInput(false)
    this.child = null
    this.shown = false
  }

  private apply(): void {
    if (!this.child || !this.region) return
    if (!this.region.visible || this.region.width <= 0 || this.region.height <= 0) {
      this.child.hide()
      if (this.shown) {
        this.shown = false
        // Back to the chat: the queues part again so the chat's own typing is its own.
        this.child.holdInput(false)
      }
    } else {
      // The true scale is the parent's real client width over the renderer's viewport width; devicePixelRatio is only the fallback.
      const parent = this.parent()
      const client = parent ? clientSize(parent) : null
      const dpr = client && this.region.viewportWidth ? client.width / this.region.viewportWidth : this.region.dpr
      this.child.place(physicalRect({ ...this.region, dpr }), true)
      // Only on the way in: the region is re-sent as the window moves, and focusing on every one would take the keyboard back mid-typing.
      if (!this.shown) {
        this.shown = true
        // The queues stay joined for as long as the browser is showing, or the keyboard goes back to the chat behind it.
        this.child.holdInput(true)
        this.child.focus()
      }
    }
  }
}
