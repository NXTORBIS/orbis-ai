/**
 * Lighting up the thing Orbi is talking about.
 *
 * ## Why a light rather than an arm
 *
 * Orbi pointing at a button means growing an arm, aiming it, and hoping the person follows it to the right place —
 * and at the size Orbi actually appears, a stubby arm aimed across a card is ambiguous at best. Darkening
 * everything except the thing itself has no ambiguity in it at all: there is exactly one lit object on the screen
 * and it is the answer. It also scales, which an arm does not — the same effect works on a button, a whole panel
 * or a row in a list.
 *
 * So Orbi keeps its hands to itself and simply looks at what is lit.
 *
 * ## All of this is geometry, and none of it is drawing
 *
 * Where the hole goes, how big, how round, and where Orbi stands so it is beside the light rather than inside it.
 * The component that draws it makes no decisions, so every rule here — "a tall panel gets square corners", "never
 * stand on the thing you are lighting" — is testable without a browser.
 */

/** A thing on the screen, as the geometry needs it. */
export interface Target {
  left: number
  top: number
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** The hole in the darkness. */
export interface Spot {
  left: number
  top: number
  width: number
  height: number
  /** Corner radius in pixels. A small square thing becomes a circle; a panel keeps square-ish corners. */
  radius: number
  /** Where the light is centred, for the rings and the glow. */
  centreX: number
  centreY: number
  /** Half the diagonal: how far a ring has to travel to clear the lit area. */
  reach: number
}

/**
 * How much room to leave around the thing.
 *
 * Generous on something small, tighter on something large. A twenty-pixel halo round a button reads as deliberate;
 * the same halo round a full-width panel reads as a misaligned box.
 */
export function paddingFor(target: Target): number {
  const smaller = Math.min(target.width, target.height)
  if (smaller <= 40) return 14
  if (smaller <= 120) return 12
  return 9
}

/**
 * The lit area for a thing on the screen.
 *
 * Clamped to the window on all four sides, because a hole that runs off the edge stops reading as a hole and
 * starts reading as the darkness having a corner missing.
 */
export function spotlightFor(target: Target, viewport: Viewport): Spot {
  const pad = paddingFor(target)
  const left = Math.max(4, target.left - pad)
  const top = Math.max(4, target.top - pad)
  const right = Math.min(viewport.width - 4, target.left + target.width + pad)
  const bottom = Math.min(viewport.height - 4, target.top + target.height + pad)
  const width = Math.max(24, right - left)
  const height = Math.max(24, bottom - top)

  /*
   * Round for something small and square, gently rounded for anything else.
   *
   * A circle round an icon looks like a spotlight. A circle round a wide card looks like a mistake, because the
   * lit area then includes a great deal of what is beside the card.
   */
  const squarish = Math.abs(width - height) < Math.max(width, height) * 0.35
  const radius = squarish && Math.max(width, height) <= 120 ? Math.max(width, height) / 2 : Math.min(22, Math.min(width, height) / 2)

  return {
    left,
    top,
    width,
    height,
    radius,
    centreX: left + width / 2,
    centreY: top + height / 2,
    reach: Math.hypot(width, height) / 2
  }
}

/** Which side of the lit area has room for Orbi and its bubble. */
export type Side = 'left' | 'right' | 'above' | 'below'

export function sideFor(spot: Spot, viewport: Viewport, need = 150): Side {
  const room = {
    right: viewport.width - (spot.left + spot.width),
    left: spot.left,
    below: viewport.height - (spot.top + spot.height),
    above: spot.top
  }
  /*
   * A wide thing is approached from above or below.
   *
   * The room beside a full-width card is whatever margin the window has, and standing in it means standing over
   * the application's own sidebar -- which looks like a mistake even though it is outside the light. Something
   * wide has room under it, and that is where the eye goes next anyway.
   */
  const wide = spot.width > viewport.width * 0.5
  if (wide) {
    if (room.below >= need) return 'below'
    if (room.above >= need) return 'above'
  }
  // Otherwise beside first, because a bubble beside something reads better than one on top of it.
  if (room.right >= need) return 'right'
  if (room.left >= need) return 'left'
  if (room.below >= need) return 'below'
  if (room.above >= need) return 'above'
  // Nowhere has room: take whichever has most, rather than refusing to place it.
  return (Object.entries(room).sort((a, b) => b[1] - a[1])[0][0] as Side) ?? 'below'
}

/**
 * Where Orbi stands.
 *
 * Always outside the lit area and never over it: Orbi standing in its own spotlight hides the very thing the
 * spotlight exists to show, which was the whole problem with pointing.
 */
export function orbiBeside(spot: Spot, side: Side, size: number, viewport: Viewport): { x: number; y: number; flip: boolean } {
  const gap = size * 0.6 + 10
  const clampX = (value: number): number => Math.max(size * 0.6, Math.min(viewport.width - size * 0.6, value))
  const clampY = (value: number): number => Math.max(size * 0.7, Math.min(viewport.height - size * 0.3, value))

  switch (side) {
    case 'right':
      return { x: clampX(spot.left + spot.width + gap), y: clampY(spot.centreY), flip: true }
    case 'left':
      return { x: clampX(spot.left - gap), y: clampY(spot.centreY), flip: false }
    case 'above':
      return { x: clampX(spot.centreX), y: clampY(spot.top - gap * 0.5), flip: false }
    case 'below':
    default:
      return { x: clampX(spot.centreX), y: clampY(spot.top + spot.height + gap), flip: false }
  }
}

/**
 * Where the bubble of words goes.
 *
 * Every side is tried, each is clamped to the window, and the one that does not land on the lit thing wins. The
 * first version simply placed it on the preferred side and clamped — and on anything near the bottom of the
 * screen the clamp pulled it straight back over the spotlight, so the words covered the very thing they were
 * describing. Clamping has to be part of the choice, not applied after it.
 */
export function bubbleBeside(
  spot: Spot,
  side: Side,
  viewport: Viewport,
  size = { width: 320, height: 180 }
): { left: number; top: number } {
  const gap = 22
  const clampLeft = (value: number): number => Math.max(14, Math.min(viewport.width - size.width - 14, value))
  const clampTop = (value: number): number => Math.max(14, Math.min(viewport.height - size.height - 14, value))

  const place = (which: Side): { left: number; top: number } => {
    switch (which) {
      case 'right':
        return { left: clampLeft(spot.left + spot.width + gap + 70), top: clampTop(spot.centreY - size.height / 2) }
      case 'left':
        return { left: clampLeft(spot.left - gap - 70 - size.width), top: clampTop(spot.centreY - size.height / 2) }
      case 'above':
        return { left: clampLeft(spot.centreX - size.width / 2), top: clampTop(spot.top - gap - size.height) }
      case 'below':
      default:
        return { left: clampLeft(spot.centreX - size.width / 2), top: clampTop(spot.top + spot.height + gap + 60) }
    }
  }

  /** How much of the lit area this placement would cover. Zero is the whole requirement. */
  const covers = (at: { left: number; top: number }): number => {
    const across = Math.max(0, Math.min(at.left + size.width, spot.left + spot.width) - Math.max(at.left, spot.left))
    const down = Math.max(0, Math.min(at.top + size.height, spot.top + spot.height) - Math.max(at.top, spot.top))
    return across * down
  }

  // The asked-for side first, so a placement that works keeps the layout predictable.
  const tried = [side, 'below', 'above', 'right', 'left'].filter((one, index, all) => all.indexOf(one) === index) as Side[]
  const scored = tried.map((one) => ({ one, at: place(one), overlap: covers(place(one)) }))
  const clear = scored.find((one) => one.overlap === 0)
  if (clear) return clear.at

  /*
   * Nowhere is clear: take whichever covers least.
   *
   * On a very small window a box of words and a lit panel genuinely cannot both fit, and covering a corner of it
   * is better than putting the words off the screen where they cannot be read at all.
   */
  scored.sort((a, b) => a.overlap - b.overlap)
  return scored[0].at
}

/**
 * The rings that travel outward from the lit edge.
 *
 * Returned as plain numbers so the look of the thing is testable and so the component only has to draw them.
 * Each ring is the same shape as the hole, scaled up and fading as it goes — which is what reads as a pulse
 * coming off the object rather than a circle drawn on top of it.
 */
export function rings(spot: Spot, count = 3): { delay: number; scale: number }[] {
  const out: { delay: number; scale: number }[] = []
  for (let i = 0; i < count; i += 1) {
    out.push({
      // Staggered so they chase each other rather than arriving together.
      delay: (i / count) * 2.4,
      // How far past the edge each one travels. Bigger things need proportionally less, or it swamps the screen.
      scale: 1 + Math.min(0.5, 70 / Math.max(60, spot.reach))
    })
  }
  return out
}

/** Whether a thing is worth lighting at all, or so large that darkening everything else says nothing. */
export function worthLighting(target: Target, viewport: Viewport): boolean {
  if (target.width < 8 || target.height < 8) return false
  const area = (target.width * target.height) / (viewport.width * viewport.height)
  // More than seven tenths of the screen is not a spotlight, it is a slightly darker border.
  return area < 0.7
}

/** How long the light takes to move from one thing to the next. Quick: it is a transition, not a journey. */
export function travelTime(from: Spot | null, to: Spot): number {
  if (!from) return 420
  const distance = Math.hypot(to.centreX - from.centreX, to.centreY - from.centreY)
  return Math.min(620, Math.max(260, 260 + distance * 0.35))
}
