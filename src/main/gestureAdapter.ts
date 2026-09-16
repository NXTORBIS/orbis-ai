import type { NormalizedTrackpadGesture } from '../shared/historySwipe'

/**
 * Turning what each platform sends into one shape.
 *
 * Chromium tells the app about trackpad movement as wheel events, and marks the ones that came from a precision
 * trackpad rather than a mouse wheel: a real trackpad reports fine-grained pixel movement, a wheel reports notches.
 * That flag is the platform's own answer to "was this two fingers on a trackpad", and it is the one Orbis trusts —
 * nothing here tries to guess a gesture from ordinary mouse movement.
 *
 * What the platforms do not all send is where a gesture begins and ends. macOS reports the phases; Windows and Linux
 * report a stream of movement and simply stop when the fingers lift. So on those platforms the end is taken from the
 * pause that follows, the same way Chromium does it internally.
 */

/** How long a gap in movement means the fingers have lifted, on platforms that do not say so themselves. */
export const GESTURE_END_AFTER_SILENCE_MS = 120

/** A wheel event as Electron reports it, with the parts that matter for a trackpad. */
export interface WheelLikeEvent {
  type: string
  deltaX?: number
  deltaY?: number
  /** True when the movement came from a precision trackpad rather than a mouse wheel. */
  hasPreciseScrollingDeltas?: boolean
  /** macOS reports coasting through this; a value means the fingers have already lifted. */
  accelerationRatioX?: number
  modifiers?: string[]
}

export interface GestureAdapterOptions {
  /** Normalized events, in order, for the recogniser to make sense of. */
  emit(event: NormalizedTrackpadGesture): void
  /** The platform, so the same adapter can behave correctly on each. Defaults to the one Orbis is running on. */
  platform?: NodeJS.Platform
  now?(): number
  /** Set a timer; replaced in tests so the end of a gesture can be made to happen at will. */
  setTimer?(run: () => void, ms: number): NodeJS.Timeout | number
  clearTimer?(handle: NodeJS.Timeout | number): void
}

export class GestureInputAdapter {
  private readonly o: Required<Pick<GestureAdapterOptions, 'emit'>> & GestureAdapterOptions
  private inGesture = false
  private endTimer: NodeJS.Timeout | number | null = null
  private lastAt = 0

  constructor(options: GestureAdapterOptions) {
    this.o = options
  }

  private get platform(): NodeJS.Platform {
    return this.o.platform ?? process.platform
  }
  private now(): number {
    return this.o.now?.() ?? Date.now()
  }
  private setTimer(run: () => void, ms: number): NodeJS.Timeout | number {
    return this.o.setTimer ? this.o.setTimer(run, ms) : setTimeout(run, ms)
  }
  private clearTimer(handle: NodeJS.Timeout | number): void {
    if (this.o.clearTimer) this.o.clearTimer(handle)
    else clearTimeout(handle as NodeJS.Timeout)
  }

  /** Whether this event is trackpad movement at all. A mouse wheel is not, and neither is anything else. */
  static isTrackpad(event: WheelLikeEvent): boolean {
    return event.type === 'mouseWheel' && event.hasPreciseScrollingDeltas === true
  }

  /** Everything ends: the window lost focus, the tab went away, the page navigated. */
  cancel(): void {
    if (this.endTimer !== null) {
      this.clearTimer(this.endTimer)
      this.endTimer = null
    }
    if (!this.inGesture) return
    this.inGesture = false
    this.o.emit({ type: 'cancel', fingers: 2, deltaX: 0, deltaY: 0, timestamp: this.now() })
  }

  /**
   * One wheel event from a page. Anything that is not precision trackpad movement is ignored entirely, so a mouse
   * wheel costs nothing here and changes nothing.
   */
  handleWheel(event: WheelLikeEvent): void {
    if (!GestureInputAdapter.isTrackpad(event)) return
    const timestamp = this.now()
    const deltaX = event.deltaX ?? 0
    const deltaY = event.deltaY ?? 0
    // macOS says when the fingers have lifted and the trackpad is coasting; elsewhere there is no such signal.
    const momentum = this.platform === 'darwin' ? Boolean(event.accelerationRatioX) : false

    if (!this.inGesture) {
      this.inGesture = true
      this.o.emit({ type: 'begin', fingers: 2, deltaX: 0, deltaY: 0, timestamp })
    }
    this.lastAt = timestamp
    this.o.emit({ type: 'update', fingers: 2, deltaX, deltaY, timestamp, momentum })

    // The fingers lifting is a pause in the movement, on every platform that does not say so outright.
    if (this.endTimer !== null) this.clearTimer(this.endTimer)
    this.endTimer = this.setTimer(() => this.finish(), GESTURE_END_AFTER_SILENCE_MS)
  }

  /** The pause has gone on long enough: the fingers are up. */
  private finish(): void {
    this.endTimer = null
    if (!this.inGesture) return
    this.inGesture = false
    this.o.emit({ type: 'end', fingers: 2, deltaX: 0, deltaY: 0, timestamp: this.lastAt })
  }

  /** macOS reports the phases itself, so the ends are taken from the platform rather than from a pause. */
  handleScrollTouch(phase: 'begin' | 'end'): void {
    if (this.platform !== 'darwin') return
    if (phase === 'begin') {
      if (this.endTimer !== null) {
        this.clearTimer(this.endTimer)
        this.endTimer = null
      }
      if (!this.inGesture) {
        this.inGesture = true
        this.o.emit({ type: 'begin', fingers: 2, deltaX: 0, deltaY: 0, timestamp: this.now() })
      }
      return
    }
    if (this.endTimer !== null) {
      this.clearTimer(this.endTimer)
      this.endTimer = null
    }
    this.finish()
  }
}
