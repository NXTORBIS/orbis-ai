/**
 * The letters and numbers round the edge of the board.
 *
 * They are drawn on small canvases and hung in the scene as sprites, which always turn to face the camera. That is
 * the whole reason for doing it this way: a coordinate painted flat on the board is unreadable from the side and
 * upside down from the far end, and a coordinate that is readable from everywhere is the difference between a 3D
 * board you can call a move on and an ornament.
 *
 * This is the only file in the 3D board that needs a browser, which is why it is on its own: everything that
 * decides anything is in a file a test can run.
 */

import { FILES, RANKS, fileLabelSpot, rankLabelSpot, type Orientation } from './boardGeometry.ts'
import { DEFAULT_PALETTE, readPalette, type Palette } from './palette.ts'

type Three = typeof import('three')

/** How many pixels across each little canvas is. Enough that the letters stay crisp when the camera comes close. */
const TEXTURE_SIZE = 96

export interface LabelSet {
  /** Moves every label to where it belongs for this way up. */
  place(orientation: Orientation): void
  dispose(): void
}

/**
 * Draws one character and hands back the picture.
 *
 * Returns null rather than throwing when there is nothing to draw on -- no canvas, or no 2D context left to give
 * out. The board then has no coordinates, which is a shame and not a failure, so it is not allowed to take the
 * whole 3D view down with it.
 */
function characterTexture(T: Three, character: string, colour: string): import('three').CanvasTexture | null {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = TEXTURE_SIZE
    canvas.height = TEXTURE_SIZE
    const pen = canvas.getContext('2d')
    if (!pen) return null
    pen.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE)
    pen.font = `600 ${Math.round(TEXTURE_SIZE * 0.66)}px ui-monospace, "JetBrains Mono", monospace`
    pen.textAlign = 'center'
    pen.textBaseline = 'middle'
    // A dark halo under the character so it stays readable over both the frame and a pale square behind it.
    pen.lineWidth = Math.round(TEXTURE_SIZE * 0.1)
    pen.strokeStyle = 'rgba(0, 0, 0, 0.75)'
    pen.strokeText(character, TEXTURE_SIZE / 2, TEXTURE_SIZE * 0.54)
    pen.fillStyle = colour
    pen.fillText(character, TEXTURE_SIZE / 2, TEXTURE_SIZE * 0.54)
    const texture = new T.CanvasTexture(canvas)
    texture.colorSpace = T.SRGBColorSpace
    texture.needsUpdate = true
    return texture
  } catch {
    return null
  }
}

/**
 * Builds the coordinates and adds them to the group the scene set aside for them.
 *
 * Sixteen sprites: a letter under each file and a number beside each rank. They are built once; turning the board
 * round moves them rather than rebuilding them, because rebuilding would mean sixteen new canvases every time
 * somebody pressed the turn-the-board button.
 */
export function createLabels(
  T: Three,
  group: import('three').Group,
  palette: Palette = DEFAULT_PALETTE
): LabelSet {
  const sprites: { sprite: import('three').Sprite; kind: 'file' | 'rank'; index: number }[] = []
  const make = (character: string, kind: 'file' | 'rank', index: number): void => {
    const texture = characterTexture(T, character, palette.frameText)
    if (!texture) return
    const material = new T.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    const sprite = new T.Sprite(material)
    sprite.scale.set(0.34, 0.34, 1)
    // Over the top of the board rather than hidden by it, whatever angle the camera is at.
    sprite.renderOrder = 40
    group.add(sprite)
    sprites.push({ sprite, kind, index })
  }
  FILES.forEach((file, index) => make(file, 'file', index))
  RANKS.forEach((rank) => make(String(rank), 'rank', rank))

  const place = (orientation: Orientation): void => {
    for (const one of sprites) {
      const spot = one.kind === 'file' ? fileLabelSpot(one.index, orientation) : rankLabelSpot(one.index, orientation)
      // Lifted a little off the frame so the sprite is not half-buried in it when seen from low down.
      one.sprite.position.set(spot.x, spot.y + 0.1, spot.z)
    }
  }

  const dispose = (): void => {
    for (const one of sprites) {
      const material = one.sprite.material as import('three').SpriteMaterial
      material.map?.dispose()
      material.dispose()
      group.remove(one.sprite)
    }
    sprites.length = 0
  }

  place('w')
  return { place, dispose }
}

/**
 * Can a graphics context be had at all?
 *
 * Asked before the graphics library is even fetched, so a machine that cannot draw a 3D board does not download
 * one. The probe canvas is thrown away immediately: holding on to contexts is how a browser runs out of them.
 */
export function probeWebgl(): { api: 'webgl2' | 'webgl' | 'none'; reason: string } {
  try {
    const canvas = document.createElement('canvas')
    const two = canvas.getContext('webgl2')
    if (two) {
      two.getExtension('WEBGL_lose_context')?.loseContext()
      return { api: 'webgl2', reason: '' }
    }
    const one = canvas.getContext('webgl')
    if (one) {
      one.getExtension('WEBGL_lose_context')?.loseContext()
      return { api: 'webgl', reason: '' }
    }
    return { api: 'none', reason: 'the browser would not open a graphics context' }
  } catch (err) {
    return { api: 'none', reason: err instanceof Error ? err.message : 'a graphics context could not be opened' }
  }
}

/** Reads Orbis's own colour tokens off an element on the page. */
export function paletteFrom(element: Element | null): Palette {
  if (!element || typeof getComputedStyle !== 'function') return DEFAULT_PALETTE
  const style = getComputedStyle(element)
  // The reading goes through `readPalette`, which refuses anything three.js cannot parse.
  return readPalette((token) => style.getPropertyValue(token))
}
