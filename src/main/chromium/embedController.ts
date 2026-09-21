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
  attach(pid: number, timeoutMs = 60_000): void {
    this.detach()
    const deadline = Date.now() + timeoutMs
    const tick = (): void => {
      const parent = this.parent()
      const hwnd = parent ? findBrowserWindow(pid) : null
      if (parent && hwnd) {
        this.child = embedWindow(parent, hwnd)
        this.timer = null
        this.apply()
        return
      }
      if (Date.now() < deadline) this.timer = setTimeout(tick, 50)
    }
    tick()
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.child = null
  }

  private apply(): void {
    if (!this.child || !this.region) return
    if (!this.region.visible || this.region.width <= 0 || this.region.height <= 0) this.child.hide()
    else {
      // The true scale is the parent's real client width over the renderer's viewport width; devicePixelRatio is only the fallback.
      const parent = this.parent()
      const client = parent ? clientSize(parent) : null
      const dpr = client && this.region.viewportWidth ? client.width / this.region.viewportWidth : this.region.dpr
      this.child.place(physicalRect({ ...this.region, dpr }), true)
    }
  }
}
