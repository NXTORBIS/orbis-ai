/**
 * Image processing: pixels, convolution, filters, thresholds and the things built on them.
 *
 * ## Every filter is a real convolution
 *
 * A blur is the image multiplied against a kernel and summed, pixel by pixel. So the blur radius actually changes
 * how far the influence spreads, a Sobel edge detector finds edges because the gradient there is large, and a kernel
 * somebody types in themselves does whatever that kernel does. Nothing here swaps one picture for another.
 *
 * ## The histogram is counted, and the threshold is chosen from it
 *
 * Otsu's method finds the threshold that best separates the two groups of pixels by maximising the variance between
 * them. That is a calculation over the actual histogram, so it lands in a different place for a different image —
 * which is the whole reason to prefer it over a number somebody guessed.
 *
 * ## What it works on
 *
 * Plain arrays of bytes, four per pixel, in the order red, green, blue, alpha. That is what a canvas gives and what a
 * canvas takes, so nothing has to be converted at either end, and this file needs no DOM to do any of it.
 *
 * Pure. No Electron, no DOM, no canvas.
 */

export interface ImageError {
  error: string
  says: string
  fix: string
}

export const isImageError = (value: unknown): value is ImageError =>
  typeof value === 'object' && value !== null && 'error' in value && 'says' in value && 'fix' in value

const refuse = (error: string, says: string, fix: string): ImageError => ({ error, says, fix })

export const IMAGE_LIMITS = Object.freeze({
  /** The most pixels one image may hold, which is about a 4K frame. */
  pixels: 8_300_000,
  side: 8_192,
  /** The widest a kernel may be. Beyond this the cost grows faster than the usefulness. */
  kernel: 31
})

export interface Picture {
  width: number
  height: number
  /** Four bytes per pixel: red, green, blue, alpha. */
  data: Uint8ClampedArray
}

export const makePicture = (width: number, height: number): Picture | ImageError => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return refuse('bad size', `${width} by ${height} is not a size.`, 'Both have to be whole numbers of at least one.')
  }
  if (width > IMAGE_LIMITS.side || height > IMAGE_LIMITS.side) {
    return refuse('too large', `${width} by ${height} is larger than this will work on.`, `Keep each side under ${IMAGE_LIMITS.side}.`)
  }
  if (width * height > IMAGE_LIMITS.pixels) {
    return refuse(
      'too many pixels',
      `${(width * height).toLocaleString()} pixels is more than this will work on.`,
      `Keep it under ${IMAGE_LIMITS.pixels.toLocaleString()} — about a 4K frame.`
    )
  }
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

const check = (picture: Picture): ImageError | null => {
  if (!Number.isInteger(picture.width) || !Number.isInteger(picture.height) || picture.width < 1 || picture.height < 1) {
    return refuse('bad size', 'The image has no usable size.', 'Both the width and the height have to be at least one.')
  }
  if (picture.data.length !== picture.width * picture.height * 4) {
    return refuse(
      'wrong amount of data',
      `A ${picture.width} by ${picture.height} image needs ${picture.width * picture.height * 4} bytes and this has ${picture.data.length}.`,
      'There are four bytes per pixel: red, green, blue and alpha.'
    )
  }
  if (picture.width * picture.height > IMAGE_LIMITS.pixels) {
    return refuse('too many pixels', `${(picture.width * picture.height).toLocaleString()} pixels is more than this will work on.`, 'Use a smaller image.')
  }
  return null
}

const clone = (picture: Picture): Picture => ({
  width: picture.width,
  height: picture.height,
  data: new Uint8ClampedArray(picture.data)
})

// ---------------------------------------------------------------- one pixel

export interface Pixel {
  x: number
  y: number
  red: number
  green: number
  blue: number
  alpha: number
  /** Perceived brightness, 0 to 255, weighted the way the eye actually responds. */
  brightness: number
  hex: string
  /** Hue in degrees, saturation and lightness as fractions. */
  hue: number
  saturation: number
  lightness: number
}

/**
 * Brightness, weighted the way the eye responds.
 *
 * Green contributes far more than blue to how bright something looks, so a plain average of the three is wrong — it
 * makes pure blue as bright as pure green, which nobody perceives. These are the standard luminance weights.
 */
export const brightnessOf = (red: number, green: number, blue: number): number => 0.2126 * red + 0.7152 * green + 0.0722 * blue

export function pixelAt(picture: Picture, x: number, y: number): Pixel | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= picture.width || y >= picture.height) {
    return refuse(
      'outside the image',
      `There is no pixel at ${x}, ${y}.`,
      `The image is ${picture.width} by ${picture.height}, so x runs 0 to ${picture.width - 1} and y runs 0 to ${picture.height - 1}.`
    )
  }
  const at = (y * picture.width + x) * 4
  const red = picture.data[at]
  const green = picture.data[at + 1]
  const blue = picture.data[at + 2]
  const alpha = picture.data[at + 3]

  const r = red / 255
  const g = green / 255
  const b = blue / 255
  const most = Math.max(r, g, b)
  const least = Math.min(r, g, b)
  const lightness = (most + least) / 2
  const span = most - least
  const saturation = span === 0 ? 0 : span / (1 - Math.abs(2 * lightness - 1))
  let hue = 0
  if (span !== 0) {
    if (most === r) hue = ((g - b) / span) % 6
    else if (most === g) hue = (b - r) / span + 2
    else hue = (r - g) / span + 4
    hue = ((hue * 60) % 360 + 360) % 360
  }

  return {
    x,
    y,
    red,
    green,
    blue,
    alpha,
    brightness: brightnessOf(red, green, blue),
    hex: `#${[red, green, blue].map((one) => one.toString(16).padStart(2, '0')).join('')}`,
    hue,
    saturation,
    lightness
  }
}

// ---------------------------------------------------------------- histograms

export interface Histogram {
  /** 256 counts, one per level. */
  red: readonly number[]
  green: readonly number[]
  blue: readonly number[]
  brightness: readonly number[]
  pixels: number
  /** The darkest and lightest levels actually present. */
  darkest: number
  lightest: number
  meanBrightness: number
  /** Pixels at 0 and at 255, which is what clipping looks like. */
  clippedDark: number
  clippedLight: number
  says: string
  notes: readonly string[]
}

export function histogram(picture: Picture): Histogram | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad

  const red = new Array<number>(256).fill(0)
  const green = new Array<number>(256).fill(0)
  const blue = new Array<number>(256).fill(0)
  const brightness = new Array<number>(256).fill(0)
  let total = 0

  for (let at = 0; at < picture.data.length; at += 4) {
    red[picture.data[at]] += 1
    green[picture.data[at + 1]] += 1
    blue[picture.data[at + 2]] += 1
    const level = Math.round(brightnessOf(picture.data[at], picture.data[at + 1], picture.data[at + 2]))
    brightness[Math.max(0, Math.min(255, level))] += 1
    total += brightnessOf(picture.data[at], picture.data[at + 1], picture.data[at + 2])
  }

  const pixels = picture.width * picture.height
  const darkest = brightness.findIndex((one) => one > 0)
  const lightest = 255 - [...brightness].reverse().findIndex((one) => one > 0)
  const meanBrightness = pixels === 0 ? 0 : total / pixels

  const notes: string[] = []
  const usedRange = lightest - darkest
  if (usedRange < 128 && pixels > 0) {
    notes.push(
      `Everything in this image sits between ${darkest} and ${lightest} out of 255, so it uses less than half the range available. Stretching it would make it look considerably more contrasted without losing anything.`
    )
  }
  if (brightness[0] > pixels * 0.05) {
    notes.push(`${((brightness[0] / pixels) * 100).toFixed(1)}% of the pixels are pure black. Detail at that end has already been lost and no adjustment brings it back.`)
  }
  if (brightness[255] > pixels * 0.05) {
    notes.push(`${((brightness[255] / pixels) * 100).toFixed(1)}% of the pixels are pure white. That detail is gone too.`)
  }
  if (meanBrightness < 60) notes.push('The image is dark overall.')
  else if (meanBrightness > 195) notes.push('The image is bright overall.')

  return {
    red: Object.freeze(red),
    green: Object.freeze(green),
    blue: Object.freeze(blue),
    brightness: Object.freeze(brightness),
    pixels,
    darkest: darkest < 0 ? 0 : darkest,
    lightest: Number.isFinite(lightest) ? lightest : 255,
    meanBrightness,
    clippedDark: brightness[0],
    clippedLight: brightness[255],
    says: `${pixels.toLocaleString()} pixels, brightness from ${darkest < 0 ? 0 : darkest} to ${lightest}, averaging ${meanBrightness.toFixed(1)}.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- kernels

export interface Kernel {
  width: number
  height: number
  values: readonly number[]
  /** What everything is divided by afterwards. Null works it out from the sum. */
  divisor?: number | null
  offset?: number
  name?: string
  about?: string
}

export type KnownKernel =
  | 'identity'
  | 'box-blur'
  | 'gaussian-blur'
  | 'sharpen'
  | 'edge-detect'
  | 'sobel-x'
  | 'sobel-y'
  | 'laplacian'
  | 'emboss'
  | 'outline'

export const KNOWN_KERNELS: readonly KnownKernel[] = Object.freeze([
  'identity',
  'box-blur',
  'gaussian-blur',
  'sharpen',
  'edge-detect',
  'sobel-x',
  'sobel-y',
  'laplacian',
  'emboss',
  'outline'
])

export function kernel(which: KnownKernel): Kernel | ImageError {
  switch (which) {
    case 'identity':
      return { width: 3, height: 3, values: [0, 0, 0, 0, 1, 0, 0, 0, 0], name: 'Identity', about: 'Leaves the image exactly as it was. Useful for checking that convolution itself is not changing anything.' }
    case 'box-blur':
      return { width: 3, height: 3, values: [1, 1, 1, 1, 1, 1, 1, 1, 1], name: 'Box blur', about: 'Replaces every pixel with the average of itself and its neighbours. The simplest blur, and it shows its square shape on a bright point.' }
    case 'gaussian-blur':
      return { width: 3, height: 3, values: [1, 2, 1, 2, 4, 2, 1, 2, 1], name: 'Gaussian blur', about: 'A blur weighted towards the centre, so it looks smooth rather than square. What almost every blur in practice is.' }
    case 'sharpen':
      return { width: 3, height: 3, values: [0, -1, 0, -1, 5, -1, 0, -1, 0], name: 'Sharpen', about: 'Adds the difference between a pixel and its neighbours back onto it, which makes edges stand out. Overdone, it produces a halo.' }
    case 'edge-detect':
      return { width: 3, height: 3, values: [-1, -1, -1, -1, 8, -1, -1, -1, -1], divisor: 1, name: 'Edge detect', about: 'Keeps only what differs from its surroundings, so flat areas go black and edges stay.' }
    case 'sobel-x':
      return { width: 3, height: 3, values: [-1, 0, 1, -2, 0, 2, -1, 0, 1], divisor: 1, offset: 128, name: 'Sobel, across', about: 'The rate of change left to right, so it finds vertical edges and ignores horizontal ones.' }
    case 'sobel-y':
      return { width: 3, height: 3, values: [-1, -2, -1, 0, 0, 0, 1, 2, 1], divisor: 1, offset: 128, name: 'Sobel, down', about: 'The rate of change top to bottom, so it finds horizontal edges.' }
    case 'laplacian':
      return { width: 3, height: 3, values: [0, 1, 0, 1, -4, 1, 0, 1, 0], divisor: 1, offset: 128, name: 'Laplacian', about: 'The second rate of change, which is large wherever the brightness turns a corner. Very sensitive to noise.' }
    case 'emboss':
      return { width: 3, height: 3, values: [-2, -1, 0, -1, 1, 1, 0, 1, 2], divisor: 1, offset: 128, name: 'Emboss', about: 'Lights edges from one direction and darkens the other, so the image looks pressed into metal.' }
    case 'outline':
      return { width: 3, height: 3, values: [-1, -1, -1, -1, 8, -1, -1, -1, -1], divisor: 1, name: 'Outline', about: 'The same as edge detect. Kept separately because both names are in common use.' }
    default:
      return refuse('unknown kernel', `There is no kernel called "${String(which)}".`, `Try one of: ${KNOWN_KERNELS.join(', ')}.`)
  }
}

/** A Gaussian blur of a chosen radius, worked out rather than taken from a table. */
export function gaussian(radius: number): Kernel | ImageError {
  if (!Number.isInteger(radius) || radius < 1) return refuse('bad radius', `A radius of ${radius} is not usable.`, 'Use a whole number of at least 1.')
  const width = radius * 2 + 1
  if (width > IMAGE_LIMITS.kernel) {
    return refuse('too wide', `A radius of ${radius} makes a ${width} by ${width} kernel.`, `Keep the width under ${IMAGE_LIMITS.kernel} — a radius of ${Math.floor((IMAGE_LIMITS.kernel - 1) / 2)} or less.`)
  }
  // The standard relationship: a sigma of about a third of the radius puts almost all the weight inside it.
  const sigma = Math.max(0.5, radius / 3)
  const values: number[] = []
  for (let y = -radius; y <= radius; y += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      values.push(Math.exp(-(x * x + y * y) / (2 * sigma * sigma)))
    }
  }
  return { width, height: width, values, name: `Gaussian blur, radius ${radius}`, about: `Weighted towards the centre with a spread of ${sigma.toFixed(2)} pixels.` }
}

export type Edges = 'extend' | 'wrap' | 'mirror' | 'crop'

export const EDGE_HANDLING: readonly Edges[] = Object.freeze(['extend', 'wrap', 'mirror', 'crop'])

export const EDGE_ABOUT: Readonly<Record<Edges, string>> = Object.freeze({
  extend: 'Pretends the edge pixel repeats outwards. The usual choice, and it slightly smears the border.',
  wrap: 'Takes the pixel from the opposite side, as though the image were a tube. Right for a texture that tiles.',
  mirror: 'Reflects the image back on itself at the edge. Looks the most natural on a photograph.',
  crop: 'Treats everything outside as black, which darkens the border. Honest, and usually not what you want.'
})

export interface Convolved {
  picture: Picture
  kernel: Kernel
  /** What the kernel was divided by, after being worked out if it was not given. */
  divisor: number
  /** Multiplications done, which is what the cost of a convolution actually is. */
  multiplications: number
  says: string
  notes: readonly string[]
}

/**
 * Applies a kernel to an image.
 *
 * ## The alpha channel is left alone
 *
 * Blurring the transparency along with the colour makes a hard-edged shape go soft at its boundary, which is almost
 * never wanted and looks like a bug. So alpha is copied through untouched unless the kernel is the identity.
 *
 * ## The divisor matters and is worked out when not given
 *
 * A blur kernel of nine ones has to be divided by nine or the image comes out nine times too bright. An edge kernel
 * sums to zero and must not be divided at all. Working the divisor out from the sum, and treating a sum of zero as a
 * divisor of one, handles both without the caller having to think about it.
 */
export function convolve(picture: Picture, which: Kernel, edges: Edges = 'extend'): Convolved | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad
  if (which.width < 1 || which.height < 1 || which.width % 2 === 0 || which.height % 2 === 0) {
    return refuse(
      'bad kernel shape',
      `A ${which.width} by ${which.height} kernel has no centre pixel.`,
      'Both sides have to be odd, so there is a middle for the kernel to sit on.'
    )
  }
  if (which.width > IMAGE_LIMITS.kernel || which.height > IMAGE_LIMITS.kernel) {
    return refuse('kernel too wide', `A ${which.width} by ${which.height} kernel is larger than this will apply.`, `Keep both sides under ${IMAGE_LIMITS.kernel}.`)
  }
  if (which.values.length !== which.width * which.height) {
    return refuse(
      'wrong number of values',
      `A ${which.width} by ${which.height} kernel needs ${which.width * which.height} values and this has ${which.values.length}.`,
      'Give one value per position.'
    )
  }
  if (which.values.some((one) => !Number.isFinite(one))) {
    return refuse('bad value', 'One of the kernel values is not a number.', 'Every position needs a number.')
  }

  const sum = which.values.reduce((a, b) => a + b, 0)
  // A kernel summing to zero is a difference operator and must not be scaled; anything else is normalised.
  const divisor = which.divisor ?? (sum === 0 ? 1 : sum)
  if (divisor === 0) return refuse('bad divisor', 'The divisor is zero.', 'Leave it out and it will be worked out from the kernel, or give a number that is not zero.')
  const offset = which.offset ?? 0

  const halfX = (which.width - 1) / 2
  const halfY = (which.height - 1) / 2
  const made = makePicture(picture.width, picture.height)
  if (isImageError(made)) return made

  const sample = (x: number, y: number): number => {
    let sx = x
    let sy = y
    switch (edges) {
      case 'extend':
        sx = Math.max(0, Math.min(picture.width - 1, x))
        sy = Math.max(0, Math.min(picture.height - 1, y))
        break
      case 'wrap':
        sx = ((x % picture.width) + picture.width) % picture.width
        sy = ((y % picture.height) + picture.height) % picture.height
        break
      case 'mirror': {
        const reflect = (value: number, size: number): number => {
          if (size === 1) return 0
          let at = value
          while (at < 0 || at >= size) {
            if (at < 0) at = -at - 1
            if (at >= size) at = 2 * size - at - 1
          }
          return at
        }
        sx = reflect(x, picture.width)
        sy = reflect(y, picture.height)
        break
      }
      case 'crop':
        if (x < 0 || y < 0 || x >= picture.width || y >= picture.height) return -1
        break
    }
    return (sy * picture.width + sx) * 4
  }

  let multiplications = 0
  for (let y = 0; y < picture.height; y += 1) {
    for (let x = 0; x < picture.width; x += 1) {
      let red = 0
      let green = 0
      let blue = 0
      for (let ky = 0; ky < which.height; ky += 1) {
        for (let kx = 0; kx < which.width; kx += 1) {
          const weight = which.values[ky * which.width + kx]
          if (weight === 0) continue
          const at = sample(x + kx - halfX, y + ky - halfY)
          if (at < 0) continue
          red += picture.data[at] * weight
          green += picture.data[at + 1] * weight
          blue += picture.data[at + 2] * weight
          multiplications += 3
        }
      }
      const to = (y * picture.width + x) * 4
      made.data[to] = red / divisor + offset
      made.data[to + 1] = green / divisor + offset
      made.data[to + 2] = blue / divisor + offset
      // Transparency is copied through: blurring it would soften the edge of a hard-edged shape.
      made.data[to + 3] = picture.data[to + 3]
    }
  }

  const notes: string[] = []
  if (which.about !== undefined) notes.push(which.about)
  notes.push(EDGE_ABOUT[edges])
  notes.push(
    `A ${which.width} by ${which.height} kernel over ${(picture.width * picture.height).toLocaleString()} pixels is ${multiplications.toLocaleString()} multiplications. Doubling the kernel's width costs four times as much, which is why a large blur is usually done as two passes of a line rather than one square.`
  )
  if (sum === 0) notes.push('This kernel sums to zero, so a flat area of any colour comes out as nothing. That is what makes it find edges.')

  return {
    picture: made,
    kernel: which,
    divisor,
    multiplications,
    says: `${which.name ?? 'Kernel'} applied, ${multiplications.toLocaleString()} multiplications.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- the point operations

export type Adjustment = 'grayscale' | 'invert' | 'brightness' | 'contrast' | 'gamma' | 'threshold' | 'posterise' | 'sepia' | 'saturation'

export const ADJUSTMENTS: readonly Adjustment[] = Object.freeze([
  'grayscale',
  'invert',
  'brightness',
  'contrast',
  'gamma',
  'saturation',
  'threshold',
  'posterise',
  'sepia'
])

export const ADJUSTMENT_ABOUT: Readonly<Record<Adjustment, string>> = Object.freeze({
  grayscale: 'Replaces every pixel with its brightness, weighted the way the eye responds rather than as a plain average.',
  invert: 'Turns every value into 255 minus itself.',
  brightness: 'Adds to every value. Pushed far enough, everything bunches at one end and detail is lost.',
  contrast: 'Pushes values away from the middle, or towards it. Away from the middle, the ends clip.',
  gamma: 'Adjusts the middle without moving the ends, which is usually what somebody means by "brighter".',
  saturation: 'Moves every pixel towards or away from its own brightness.',
  threshold: 'Everything brighter than the level becomes white, everything else black.',
  posterise: 'Rounds every value to a smaller number of levels, which produces flat bands.',
  sepia: 'A warm tint over the brightness, the colour old prints go.'
})

export interface Adjusted {
  picture: Picture
  adjustment: Adjustment
  amount: number
  /** Pixels pushed to 0 or 255 and therefore flattened. */
  clipped: number
  says: string
  notes: readonly string[]
}

/**
 * One adjustment, applied to every pixel.
 *
 * Clipping is counted, which is the honest part: pushing the brightness up by 80 looks like an improvement and
 * silently destroys everything that was already near white. Saying how many pixels that happened to is the
 * difference between an adjustment and a mistake.
 */
export function adjust(picture: Picture, adjustment: Adjustment, amount = 1): Adjusted | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad
  if (!ADJUSTMENT_ABOUT[adjustment]) {
    return refuse('unknown adjustment', `There is no adjustment called "${String(adjustment)}".`, `Try one of: ${ADJUSTMENTS.join(', ')}.`)
  }
  if (!Number.isFinite(amount)) return refuse('bad amount', `"${amount}" is not a number.`, 'Give a number.')

  const made = clone(picture)
  let clipped = 0

  for (let at = 0; at < made.data.length; at += 4) {
    const red = made.data[at]
    const green = made.data[at + 1]
    const blue = made.data[at + 2]
    let r = red
    let g = green
    let b = blue

    switch (adjustment) {
      case 'grayscale': {
        const level = brightnessOf(red, green, blue)
        r = level
        g = level
        b = level
        break
      }
      case 'invert':
        r = 255 - red
        g = 255 - green
        b = 255 - blue
        break
      case 'brightness':
        r = red + amount
        g = green + amount
        b = blue + amount
        break
      case 'contrast':
        // Pivoting on the middle, so a factor of 1 changes nothing.
        r = (red - 128) * amount + 128
        g = (green - 128) * amount + 128
        b = (blue - 128) * amount + 128
        break
      case 'gamma': {
        const power = amount <= 0 ? 1 : 1 / amount
        r = 255 * (red / 255) ** power
        g = 255 * (green / 255) ** power
        b = 255 * (blue / 255) ** power
        break
      }
      case 'saturation': {
        const level = brightnessOf(red, green, blue)
        r = level + (red - level) * amount
        g = level + (green - level) * amount
        b = level + (blue - level) * amount
        break
      }
      case 'threshold': {
        const on = brightnessOf(red, green, blue) >= amount
        r = on ? 255 : 0
        g = r
        b = r
        break
      }
      case 'posterise': {
        const levels = Math.max(2, Math.min(255, Math.round(amount)))
        const step = 255 / (levels - 1)
        r = Math.round(red / step) * step
        g = Math.round(green / step) * step
        b = Math.round(blue / step) * step
        break
      }
      case 'sepia': {
        const level = brightnessOf(red, green, blue)
        r = level * 1.07
        g = level * 0.95
        b = level * 0.74
        break
      }
    }

    // Counted before clamping, so what was lost is known rather than merely happening.
    if (adjustment !== 'threshold' && adjustment !== 'posterise') {
      for (const value of [r, g, b]) if (value < 0 || value > 255) clipped += 1
    }

    made.data[at] = r
    made.data[at + 1] = g
    made.data[at + 2] = b
  }

  const notes: string[] = [ADJUSTMENT_ABOUT[adjustment]]
  const channels = picture.width * picture.height * 3
  if (clipped > channels * 0.02) {
    notes.push(
      `${((clipped / channels) * 100).toFixed(1)}% of the colour values were pushed past the end of the range and flattened against it. That detail cannot be recovered by adjusting back.`
    )
  }
  if (adjustment === 'grayscale') {
    notes.push('A plain average of the three would make pure blue as bright as pure green, which nobody sees that way. These weights are what the eye actually does.')
  }
  if (adjustment === 'gamma') {
    notes.push('Gamma moves the middle and leaves black at black and white at white, which is why it rarely clips where adding brightness does.')
  }

  return {
    picture: made,
    adjustment,
    amount,
    clipped,
    says: `${adjustment}${adjustment === 'grayscale' || adjustment === 'invert' || adjustment === 'sepia' ? '' : ` at ${amount}`} applied${clipped > 0 ? `, flattening ${clipped.toLocaleString()} values against the ends` : ''}.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- thresholds and shapes

export interface ThresholdReport {
  level: number
  /** How it was arrived at. */
  method: 'otsu' | 'mean' | 'given'
  /** Fraction of pixels that came out white. */
  foreground: number
  picture: Picture
  says: string
  notes: readonly string[]
}

/**
 * Picks a threshold from the histogram, by Otsu's method.
 *
 * The level that maximises the variance between the two groups is the one that separates them best, and it is found
 * by trying every level over the counted histogram. That makes it a calculation rather than a guess — and on an image
 * with two clear groups of brightness it lands between them, which is the thing worth demonstrating.
 */
export function threshold(picture: Picture, method: 'otsu' | 'mean' | 'given' = 'otsu', given = 128): ThresholdReport | ImageError {
  const counted = histogram(picture)
  if (isImageError(counted)) return counted
  const total = counted.pixels
  if (total === 0) return refuse('empty', 'The image has no pixels.', 'Use an image with something in it.')

  let level: number
  if (method === 'given') {
    if (!Number.isFinite(given) || given < 0 || given > 255) return refuse('bad level', `${given} is not a brightness.`, 'A level is from 0 to 255.')
    level = given
  } else if (method === 'mean') {
    level = counted.meanBrightness
  } else {
    // Otsu: try every split and keep the one with the largest variance between the two groups.
    let best = 0
    let bestVariance = -1
    let belowCount = 0
    let belowSum = 0
    const allSum = counted.brightness.reduce((a, b, at) => a + b * at, 0)
    for (let at = 0; at < 256; at += 1) {
      belowCount += counted.brightness[at]
      if (belowCount === 0) continue
      const aboveCount = total - belowCount
      if (aboveCount === 0) break
      belowSum += counted.brightness[at] * at
      const belowMean = belowSum / belowCount
      const aboveMean = (allSum - belowSum) / aboveCount
      const variance = (belowCount / total) * (aboveCount / total) * (belowMean - aboveMean) ** 2
      if (variance > bestVariance) {
        bestVariance = variance
        best = at
      }
    }
    /*
     * One more than the level found.
     *
     * The method finds the level `t` that splits the histogram into 0..t and t+1..255. Thresholding here keeps
     * everything at or above the level, so the boundary has to be t+1 — passing t back put the whole lower group in
     * the foreground, which on an image of two clear groups gave exactly the wrong answer.
     */
    level = Math.min(255, best + 1)
  }

  const made = adjust(picture, 'threshold', level)
  if (isImageError(made)) return made

  let white = 0
  for (let at = 0; at < made.picture.data.length; at += 4) if (made.picture.data[at] > 127) white += 1

  const notes: string[] = []
  if (method === 'otsu') {
    notes.push(
      `The level was chosen by looking for the split that separates the two groups of brightness best, over the image's own histogram. On an image without two clear groups it still picks something, and the result is less meaningful — which the histogram will show.`
    )
  } else if (method === 'mean') {
    notes.push('The average brightness as the level. Quick, and it goes wrong on an image that is mostly one thing: a page of text is mostly white, so the average sits far too high.')
  }
  if (white / total > 0.97 || white / total < 0.03) {
    notes.push(
      `Only ${((white / total) * 100).toFixed(1)}% came out white, so the threshold put almost everything on one side. Either the image has no two groups to separate, or the level is wrong for it.`
    )
  }

  return {
    level,
    method,
    foreground: white / total,
    picture: made.picture,
    says: `Threshold at ${level.toFixed(0)}: ${((white / total) * 100).toFixed(1)}% of the image came out white.`,
    notes: Object.freeze(notes)
  }
}

export interface Region {
  id: number
  pixels: number
  /** The box it fits in. */
  left: number
  top: number
  right: number
  bottom: number
  /** Where its middle is. */
  centreX: number
  centreY: number
  /** Pixels divided by the area of its box: 1 means it fills the box exactly. */
  fill: number
}

export interface RegionReport {
  regions: readonly Region[]
  /** Which region each pixel belongs to, 0 for background. */
  labels: readonly number[]
  background: number
  says: string
  notes: readonly string[]
}

/**
 * Finds the separate shapes in a thresholded image, by flood fill.
 *
 * ## Four-connected or eight-connected changes the answer
 *
 * Two shapes touching only at a corner are one shape under eight-connectivity and two under four. Neither is
 * correct in general, so the choice is offered and its consequence stated — rather than one being picked silently.
 */
export function regions(picture: Picture, options: { connectivity?: 4 | 8; smallest?: number } = {}): RegionReport | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad
  const connectivity = options.connectivity ?? 8
  const smallest = Math.max(1, Math.floor(options.smallest ?? 1))

  const { width, height } = picture
  const labels = new Array<number>(width * height).fill(0)
  const found: Region[] = []
  let next = 1

  const neighbours =
    connectivity === 4
      ? [
          [0, -1],
          [-1, 0],
          [1, 0],
          [0, 1]
        ]
      : [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1]
        ]

  const isForeground = (at: number): boolean => picture.data[at * 4] > 127

  for (let start = 0; start < labels.length; start += 1) {
    if (labels[start] !== 0 || !isForeground(start)) continue
    const id = next++
    // An explicit stack rather than recursion: a large region would otherwise overflow it.
    const stack = [start]
    labels[start] = id
    let pixels = 0
    let left = width
    let right = 0
    let top = height
    let bottom = 0
    let sumX = 0
    let sumY = 0

    while (stack.length > 0) {
      const at = stack.pop() as number
      const x = at % width
      const y = Math.floor(at / width)
      pixels += 1
      sumX += x
      sumY += y
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y

      for (const [dx, dy] of neighbours) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const to = ny * width + nx
        if (labels[to] !== 0 || !isForeground(to)) continue
        labels[to] = id
        stack.push(to)
      }
    }

    const boxArea = (right - left + 1) * (bottom - top + 1)
    found.push({
      id,
      pixels,
      left,
      top,
      right,
      bottom,
      centreX: sumX / pixels,
      centreY: sumY / pixels,
      fill: boxArea === 0 ? 0 : pixels / boxArea
    })
  }

  const kept = found.filter((one) => one.pixels >= smallest).sort((a, b) => b.pixels - a.pixels)
  const dropped = found.length - kept.length
  const background = labels.filter((one) => one === 0).length

  const notes: string[] = [
    connectivity === 8
      ? 'Shapes touching only at a corner are counted as one, because this uses eight-way connectivity. Switch to four-way and they separate.'
      : 'Shapes touching only at a corner are counted as two, because this uses four-way connectivity. Switch to eight-way and they join.'
  ]
  if (dropped > 0) notes.push(`${dropped} shape${dropped === 1 ? '' : 's'} smaller than ${smallest} pixel${smallest === 1 ? '' : 's'} were left out.`)
  if (kept.length === 0) notes.push('Nothing was found. The threshold may have put the whole image on one side.')

  return {
    regions: Object.freeze(kept),
    labels: Object.freeze(labels),
    background,
    says: `${kept.length} separate shape${kept.length === 1 ? '' : 's'}${kept.length > 0 ? `, the largest ${kept[0].pixels.toLocaleString()} pixels` : ''}.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- edges

export interface EdgeReport {
  picture: Picture
  /** Strength at each pixel, before being drawn. */
  strength: readonly number[]
  /** Direction at each pixel, in degrees. */
  direction: readonly number[]
  /** Pixels above the strength that counts as an edge. */
  edgePixels: number
  threshold: number
  says: string
  notes: readonly string[]
}

/**
 * Finds edges by combining the two Sobel gradients.
 *
 * The strength is the length of the gradient and the direction is its angle, which is what makes this more than two
 * separate filters: a diagonal edge is found by both and neither alone would say how strong it is. The direction is
 * kept because it is what every further step — thinning, following a contour — needs.
 */
export function edges(picture: Picture, options: { threshold?: number; blurFirst?: boolean } = {}): EdgeReport | ImageError {
  const bad = check(picture)
  if (bad !== null) return bad

  // Blurring first is the usual advice, because the gradient of a noisy image is mostly noise.
  let working = picture
  if (options.blurFirst !== false) {
    const blurred = convolve(picture, kernel('gaussian-blur') as Kernel)
    if (isImageError(blurred)) return blurred
    working = blurred.picture
  }

  const gray = adjust(working, 'grayscale')
  if (isImageError(gray)) return gray

  const { width, height } = picture
  const strength = new Array<number>(width * height).fill(0)
  const direction = new Array<number>(width * height).fill(0)
  const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  let most = 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let gx = 0
      let gy = 0
      for (let j = 0; j < 3; j += 1) {
        for (let i = 0; i < 3; i += 1) {
          const sx = Math.max(0, Math.min(width - 1, x + i - 1))
          const sy = Math.max(0, Math.min(height - 1, y + j - 1))
          const value = gray.picture.data[(sy * width + sx) * 4]
          gx += value * kx[j * 3 + i]
          gy += value * ky[j * 3 + i]
        }
      }
      const at = y * width + x
      strength[at] = Math.hypot(gx, gy)
      direction[at] = (Math.atan2(gy, gx) * 180) / Math.PI
      if (strength[at] > most) most = strength[at]
    }
  }

  const level = options.threshold ?? Math.max(20, most * 0.2)
  const made = makePicture(width, height)
  if (isImageError(made)) return made
  let edgePixels = 0
  for (let at = 0; at < strength.length; at += 1) {
    const on = strength[at] >= level
    if (on) edgePixels += 1
    const value = on ? 255 : 0
    made.data[at * 4] = value
    made.data[at * 4 + 1] = value
    made.data[at * 4 + 2] = value
    made.data[at * 4 + 3] = 255
  }

  const notes: string[] = [
    'The strength is the length of the gradient from the two Sobel directions combined, so a diagonal edge is found as strongly as a straight one. Either filter alone would miss half of them.',
    'The direction at each pixel is kept as well as the strength. That is what a further step needs — thinning an edge to one pixel, or following a contour, both work from the direction.'
  ]
  if (options.blurFirst !== false) {
    notes.push('The image was blurred first. The gradient of a noisy image is mostly noise, so almost every edge detector blurs before it differentiates.')
  } else {
    notes.push('No blur was applied first, so any noise in the image appears as edges. Turn the blur on and compare.')
  }
  if (options.threshold === undefined) {
    notes.push(
      `The threshold was set at a fifth of the strongest response found, which is ${level.toFixed(0)} here. That adapts to the image, and it has a consequence: a smooth ramp has a small but perfectly even gradient everywhere, so a relative threshold can mark all of it. Give a threshold yourself to see the difference.`
    )
  }
  if (edgePixels / strength.length > 0.4) {
    notes.push(`${((edgePixels / strength.length) * 100).toFixed(0)}% of the image came out as edge, which is too much to be useful. Raise the threshold.`)
  }

  return {
    picture: made,
    strength: Object.freeze(strength),
    direction: Object.freeze(direction),
    edgePixels,
    threshold: level,
    says: `${edgePixels.toLocaleString()} of ${strength.length.toLocaleString()} pixels are edge at a threshold of ${level.toFixed(0)} — ${((edgePixels / strength.length) * 100).toFixed(1)}%.`,
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- pictures to work on

export type TestPicture = 'gradient' | 'checkerboard' | 'circles' | 'noise' | 'step' | 'two-blobs' | 'corners' | 'bars'

export const TEST_PICTURES: readonly TestPicture[] = Object.freeze([
  'gradient',
  'step',
  'checkerboard',
  'bars',
  'circles',
  'two-blobs',
  'corners',
  'noise'
])

export const TEST_PICTURE_ABOUT: Readonly<Record<TestPicture, string>> = Object.freeze({
  gradient: 'A smooth ramp from black to white. A blur barely changes it; an edge detector finds almost nothing, because nothing changes suddenly.',
  step: 'Black on one side, white on the other. One edge, so an edge detector should find exactly one line.',
  checkerboard: 'Squares. Every boundary is an edge, so this is where a blur radius shows most clearly.',
  bars: 'Vertical stripes. The Sobel-across filter finds them all and the Sobel-down filter finds none, which is the clearest demonstration of what direction means.',
  circles: 'Three filled circles of different sizes, for finding separate shapes.',
  'two-blobs': 'Two shapes touching at one corner. Four-way connectivity counts two and eight-way counts one.',
  corners: 'A square. Corners are where a gradient has two directions at once, which is why finding them needs more than an edge detector.',
  noise: 'Random dots, from a fixed sequence so it is the same every time. Shows why an edge detector blurs first.'
})

/** Builds a picture to work on. Deterministic, so the same name always gives the same image. */
export function testPicture(which: TestPicture, size = 64): Picture | ImageError {
  const made = makePicture(size, size)
  if (isImageError(made)) return made
  const set = (x: number, y: number, value: number): void => {
    const at = (y * size + x) * 4
    made.data[at] = value
    made.data[at + 1] = value
    made.data[at + 2] = value
    made.data[at + 3] = 255
  }
  // A fixed generator, so "noise" is the same noise every time and a comparison is a comparison.
  let seed = 12345
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }

  switch (which) {
    case 'gradient':
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) set(x, y, (x / (size - 1)) * 255)
      break
    case 'step':
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) set(x, y, x < size / 2 ? 0 : 255)
      break
    case 'checkerboard': {
      const square = Math.max(1, Math.floor(size / 8))
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          set(x, y, (Math.floor(x / square) + Math.floor(y / square)) % 2 === 0 ? 0 : 255)
        }
      }
      break
    }
    case 'bars': {
      const bar = Math.max(1, Math.floor(size / 10))
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) set(x, y, Math.floor(x / bar) % 2 === 0 ? 0 : 255)
      break
    }
    case 'circles': {
      const circles: readonly [number, number, number][] = [
        [size * 0.28, size * 0.3, size * 0.16],
        [size * 0.72, size * 0.32, size * 0.1],
        [size * 0.5, size * 0.74, size * 0.13]
      ]
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const inside = circles.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)
          set(x, y, inside ? 255 : 0)
        }
      }
      break
    }
    case 'two-blobs': {
      // Two squares meeting at exactly one corner, which is the case connectivity decides.
      const half = Math.floor(size / 2)
      const box = Math.max(2, Math.floor(size / 5))
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const first = x >= half - box && x < half && y >= half - box && y < half
          const second = x >= half && x < half + box && y >= half && y < half + box
          set(x, y, first || second ? 255 : 0)
        }
      }
      break
    }
    case 'corners': {
      const from = Math.floor(size * 0.25)
      const to = Math.floor(size * 0.75)
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) set(x, y, x >= from && x < to && y >= from && y < to ? 255 : 0)
      }
      break
    }
    case 'noise':
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) set(x, y, random() * 255)
      break
    default:
      return refuse('unknown picture', `There is no picture called "${String(which)}".`, `Try one of: ${TEST_PICTURES.join(', ')}.`)
  }

  return made
}

export const IMAGE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Eight bits per channel, which is what a screen shows and what a canvas holds. A photograph straight from a camera has more, and some of it is lost before this sees it.',
  'Everything is done in the values as stored, not in linear light. Strictly, a blur should be done on linearised values; almost no software does, and this does not either.',
  'Transparency is carried through convolution untouched rather than blurred with the colour, because blurring it softens the edge of a hard-edged shape.',
  'Convolution is the straightforward sum, not a transform. That is exact and gets slow for a large kernel, where a real library would use a different method.',
  'Edge detection here is a gradient and a threshold. A full detector also thins the edges to one pixel and follows weak edges connected to strong ones, neither of which is done.',
  'No object recognition of any kind. Finding separate shapes is flood fill over a threshold, which says where things are and nothing whatever about what they are.'
])
