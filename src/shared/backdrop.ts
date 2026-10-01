/**
 * The drifting starfield behind Orbis.
 *
 * One implementation, drawn by both halves of the application. It used to live inside a React component in the chat
 * window, which meant the browser -- the same product, a window away -- had no way to draw it and simply showed a
 * flat colour instead. A person who had chosen a look got it in one place and not the other.
 *
 * So the drawing is here: plain canvas, no framework, nothing imported. The chat mounts it, the browser's pages mount
 * it, and neither owns it.
 *
 * ## What it will not do
 *
 * **It never draws while nothing is looking.** A hidden window stops the loop entirely rather than animating into a
 * surface nobody is seeing, which on a laptop is a measurable amount of battery for no picture at all.
 *
 * **It never animates when asked not to.** Reduced motion means a still field, not a slow one: the particles are
 * placed once and left, so the look survives and the movement does not.
 *
 * **It never resizes on its own schedule.** The caller says when the surface changed; this does not poll.
 */

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  phase: number
  twinkleSpeed: number
}

/** How many particles a surface of this size wants. Density rather than a count, so a big window is not sparse. */
export const particleCount = (width: number, height: number): number => Math.round((width * height) / 24000)

export function spawn(width: number, height: number, random: () => number = Math.random): Particle {
  const angle = random() * Math.PI * 2
  const speed = 0.03 + random() * 0.16
  return {
    x: random() * width,
    y: random() * height,
    vx: Math.cos(angle) * speed,
    // Very slightly upward overall, which reads as drift rather than as rain.
    vy: Math.sin(angle) * speed - 0.02,
    // Mostly small points with a few larger glows.
    radius: 0.7 + random() ** 2 * 2.8,
    phase: random() * Math.PI * 2,
    twinkleSpeed: 0.5 + random() * 1.6
  }
}

/**
 * Moves one particle, wrapping it round the edges.
 *
 * Pure, and exported, because the wrap is the one piece of this with an off-by-one worth a test: a particle that
 * wraps at the edge rather than past it appears to bounce.
 */
export function step(p: Particle, width: number, height: number): void {
  p.x += p.vx
  p.y += p.vy
  if (p.x < -12) p.x = width + 12
  else if (p.x > width + 12) p.x = -12
  if (p.y < -12) p.y = height + 12
  else if (p.y > height + 12) p.y = -12
}

/** How bright a particle is at this moment. Between 0.45 and 1: a star that disappears entirely reads as a glitch. */
export const twinkle = (p: Particle, time: number): number =>
  0.45 + 0.55 * Math.abs(Math.sin(time * 0.0007 * p.twinkleSpeed + p.phase))

/**
 * What this needs to draw on, described rather than imported.
 *
 * Shared code has no platform, and asking for `lib: dom` here would put the browser's whole type surface into the
 * main process -- which it does not have and should not pretend to. A real canvas satisfies these by being one.
 */
export interface DrawingContext {
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: never, x: number, y: number, w: number, h: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike
  fillRect(x: number, y: number, w: number, h: number): void
  globalAlpha: number
  fillStyle: unknown
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void
}

export interface CanvasLike {
  width: number
  height: number
  clientWidth: number
  clientHeight: number
  getContext(kind: '2d'): DrawingContext | null
}

/** The page a canvas belongs to, for the few things that belong to the page rather than to the canvas. */
export interface PageLike {
  hidden: boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
  createCanvas(): CanvasLike
  devicePixelRatio: number
  requestFrame(run: (time: number) => void): number
  cancelFrame(handle: number): void
}

/** Pre-rendered radial glow, far cheaper per frame than canvas shadowBlur. */
export function makeGlowSprite(create: () => CanvasLike): CanvasLike {
  const size = 64
  const sprite = create()
  sprite.width = size
  sprite.height = size
  const g = sprite.getContext('2d')
  if (!g) return sprite
  const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(220, 252, 255, 1)')
  gradient.addColorStop(0.16, 'rgba(110, 225, 255, 0.95)')
  gradient.addColorStop(0.42, 'rgba(56, 190, 255, 0.22)')
  gradient.addColorStop(1, 'rgba(56, 190, 255, 0)')
  g.fillStyle = gradient
  g.fillRect(0, 0, size, size)
  return sprite
}

export interface Backdrop {
  /** Call when the surface changed size. Nothing here listens for that itself. */
  resize(): void
  /** Stops drawing and releases everything. Safe to call twice. */
  stop(): void
}

/**
 * Draws the field on a canvas until told to stop.
 *
 * `animated: false` still draws, once: the look is the point and the movement is the preference, so turning movement
 * off should leave a starfield rather than an empty rectangle.
 */
export function startBackdrop(
  canvas: CanvasLike,
  page: PageLike,
  options: { animated: boolean } = { animated: true }
): Backdrop {
  const context = canvas.getContext('2d')
  if (!context) return { resize: () => undefined, stop: () => undefined }
  // Proven once, kept: re-checking it on every frame would say nothing and read as though it might change.
  const ctx = context

  const sprite = makeGlowSprite(() => page.createCanvas())
  let particles: Particle[] = []
  let width = 0
  let height = 0
  let frame = 0
  let stopped = false

  const resize = (): void => {
    // Capped at 2: beyond that the cost is real and the difference is not.
    const dpr = Math.min(page.devicePixelRatio || 1, 2)
    width = canvas.clientWidth || 0
    height = canvas.clientHeight || 0
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    particles = Array.from({ length: particleCount(width, height) }, () => spawn(width, height))
    if (!options.animated) paint(0, false)
  }

  function paint(time: number, move: boolean): void {
    ctx.clearRect(0, 0, width, height)
    for (const p of particles) {
      if (move) step(p, width, height)
      const size = p.radius * 7
      ctx.globalAlpha = move ? twinkle(p, time) : 0.8
      ctx.drawImage(sprite as never, p.x - size / 2, p.y - size / 2, size, size)
    }
    ctx.globalAlpha = 1
  }

  const draw = (time: number): void => {
    if (stopped) return
    paint(time, true)
    frame = page.requestFrame(draw)
  }

  /*
   * Stopped while the window is hidden.
   *
   * A field animating behind a window nobody is looking at is a measurable amount of battery for no picture, and on
   * this canvas it is sixty frames a second of compositing.
   */
  const onVisibility = (): void => {
    if (stopped || !options.animated) return
    page.cancelFrame(frame)
    if (!page.hidden) frame = page.requestFrame(draw)
  }

  resize()
  if (options.animated) frame = page.requestFrame(draw)
  page.addEventListener('visibilitychange', onVisibility)

  return {
    resize,
    stop: () => {
      stopped = true
      page.cancelFrame(frame)
      page.removeEventListener('visibilitychange', onVisibility)
    }
  }
}
