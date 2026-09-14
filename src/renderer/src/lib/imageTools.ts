export function imageCanvas(source: CanvasImageSource, width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.drawImage(source, 0, 0, width, height)
  return { canvas, ctx }
}

export function toDataUrl(canvas: HTMLCanvasElement, alpha?: boolean): string {
  return alpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92)
}

/** Fills masked pixels (mask=1) smoothly from their surroundings. */
export function inpaint(image: ImageData, mask: Uint8Array): void {
  const px = new Float32Array(image.data)
  fill(px, mask, image.width, image.height)
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    for (let c = 0; c < 4; c++) image.data[i * 4 + c] = px[i * 4 + c]
  }
}

function fill(px: Float32Array, mask: Uint8Array, w: number, h: number): void {
  const holes: number[] = []
  for (let i = 0; i < w * h; i++) if (mask[i]) holes.push(i)
  if (!holes.length) return

  let iterations = 160
  if (w > 24 && h > 24 && holes.length > 300) {
    // Solve a half-size copy first so large holes start from a smooth guess instead of converging slowly.
    const hw = w >> 1
    const hh = h >> 1
    const small = new Float32Array(hw * hh * 4)
    const smallMask = new Uint8Array(hw * hh)
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < hw; x++) {
        const j = y * hw + x
        let count = 0
        for (const i of [y * 2 * w + x * 2, y * 2 * w + x * 2 + 1, (y * 2 + 1) * w + x * 2, (y * 2 + 1) * w + x * 2 + 1]) {
          if (mask[i]) continue
          for (let c = 0; c < 4; c++) small[j * 4 + c] += px[i * 4 + c]
          count++
        }
        if (count) for (let c = 0; c < 4; c++) small[j * 4 + c] /= count
        else smallMask[j] = 1
      }
    }
    fill(small, smallMask, hw, hh)
    for (const i of holes) {
      const j = Math.min(hh - 1, Math.floor(i / w) >> 1) * hw + Math.min(hw - 1, (i % w) >> 1)
      for (let c = 0; c < 4; c++) px[i * 4 + c] = small[j * 4 + c]
    }
    iterations = 40
  } else {
    let count = 0
    const sum = [0, 0, 0, 0]
    for (const i of holes) {
      for (const n of [i - 1, i + 1, i - w, i + w]) {
        if (n < 0 || n >= w * h || mask[n]) continue
        for (let c = 0; c < 4; c++) sum[c] += px[n * 4 + c]
        count++
      }
    }
    for (const i of holes) for (let c = 0; c < 4; c++) px[i * 4 + c] = count ? sum[c] / count : 0
  }

  const order = Int32Array.from(holes)
  for (let it = 0; it < iterations; it++) {
    const forward = it % 2 === 0
    for (let n = 0; n < order.length; n++) {
      const i = order[forward ? n : order.length - 1 - n]
      const x = i % w
      let count = 0
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      const add = (j: number): void => {
        r += px[j * 4]
        g += px[j * 4 + 1]
        b += px[j * 4 + 2]
        a += px[j * 4 + 3]
        count++
      }
      if (x > 0) add(i - 1)
      if (x < w - 1) add(i + 1)
      if (i >= w) add(i - w)
      if (i < w * (h - 1)) add(i + w)
      if (!count) continue
      px[i * 4] = r / count
      px[i * 4 + 1] = g / count
      px[i * 4 + 2] = b / count
      px[i * 4 + 3] = a / count
    }
  }
}

export function resizedSize(width: number, height: number, ratio: number, scale: number): { sx: number; sy: number; sw: number; sh: number; width: number; height: number } {
  let sw = width
  let sh = height
  if (ratio > 0) {
    if (width / height > ratio) sw = Math.round(height * ratio)
    else sh = Math.round(width / ratio)
  }
  const factor = Math.min(scale, 2048 / Math.max(sw, sh))
  return { sx: Math.round((width - sw) / 2), sy: Math.round((height - sh) / 2), sw, sh, width: Math.max(1, Math.round(sw * factor)), height: Math.max(1, Math.round(sh * factor)) }
}

/** Centre-crops to `ratio` (0 keeps the shape) and scales, capped at 2048px on the long edge. */
export function resizeImage(source: CanvasImageSource, width: number, height: number, ratio: number, scale: number): HTMLCanvasElement {
  const size = resizedSize(width, height, ratio, scale)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, size.sx, size.sy, size.sw, size.sh, 0, 0, size.width, size.height)
  return canvas
}
