import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ADJUSTMENTS,
  adjust,
  brightnessOf,
  convolve,
  edges,
  gaussian,
  histogram,
  isImageError,
  kernel,
  KNOWN_KERNELS,
  makePicture,
  pixelAt,
  regions,
  TEST_PICTURES,
  testPicture,
  threshold,
  type Picture,
  type ImageError
} from './imaging.ts'

/**
 * What the image engine is held to.
 *
 * The pictures are built to have known answers: a step image has exactly one edge, vertical bars are found by the
 * across filter and not the down one, two squares touching at a corner are one shape or two depending on
 * connectivity. A filter that merely changed the pixels somehow would fail all of those.
 */

/**
 * Asserts a call did not refuse, and narrows the type.
 *
 * Written with `Exclude` rather than `T | Error -> T`, which infers `T` as the whole union and so narrows nothing.
 */
const ok = <T,>(value: T): Exclude<T, ImageError> => {
  assert.ok(!isImageError(value), isImageError(value) ? `${value.says} ${value.fix}` : '')
  return value as Exclude<T, ImageError>
}

const pic = (which: Parameters<typeof testPicture>[0], size = 64): Picture => ok(testPicture(which, size))

const meanOf = (picture: Picture): number => {
  let total = 0
  for (let at = 0; at < picture.data.length; at += 4) total += brightnessOf(picture.data[at], picture.data[at + 1], picture.data[at + 2])
  return total / (picture.width * picture.height)
}

describe('pictures', () => {
  it('every test picture builds at the size asked for', () => {
    for (const which of TEST_PICTURES) {
      const made = pic(which, 32)
      assert.equal(made.width, 32, which)
      assert.equal(made.data.length, 32 * 32 * 4, which)
      // Every pixel opaque, or later comparisons mean nothing.
      for (let at = 3; at < made.data.length; at += 4) assert.equal(made.data[at], 255, which)
    }
  })

  it('the noise picture is the same noise every time', () => {
    const a = pic('noise', 16)
    const b = pic('noise', 16)
    assert.deepEqual([...a.data], [...b.data])
  })

  it('refuses a size that is not one', () => {
    assert.ok(isImageError(makePicture(0, 10)))
    assert.ok(isImageError(makePicture(10, -1)))
    assert.ok(isImageError(makePicture(99_999, 99_999)))
    assert.ok(isImageError(makePicture(1.5, 10)))
  })

  it('refuses an image whose data does not match its size', () => {
    const made = convolve({ width: 4, height: 4, data: new Uint8ClampedArray(10) }, ok(kernel('identity')))
    assert.ok(isImageError(made))
    assert.match(made.says, /needs 64 bytes/)
  })
})

describe('pixels', () => {
  it('reads a pixel and works out its brightness the way the eye does', () => {
    const made = makePicture(2, 1)
    assert.ok(!isImageError(made))
    made.data.set([0, 255, 0, 255, 0, 0, 255, 255])
    const green = ok(pixelAt(made, 0, 0))
    const blue = ok(pixelAt(made, 1, 0))
    // Pure green looks far brighter than pure blue, which a plain average would not say.
    assert.ok(green.brightness > blue.brightness * 5, `green ${green.brightness}, blue ${blue.brightness}`)
    assert.equal(green.hex, '#00ff00')
    assert.equal(Math.round(green.hue), 120)
    assert.equal(Math.round(blue.hue), 240)
  })

  it('a grey pixel has no hue and no saturation', () => {
    const made = makePicture(1, 1)
    assert.ok(!isImageError(made))
    made.data.set([128, 128, 128, 255])
    const grey = ok(pixelAt(made, 0, 0))
    assert.equal(grey.saturation, 0)
    assert.equal(grey.hue, 0)
  })

  it('refuses a pixel outside the image, and says what the range is', () => {
    const made = pic('gradient', 8)
    const outside = pixelAt(made, 8, 0)
    assert.ok(isImageError(outside))
    assert.match(outside.fix, /0 to 7/)
    assert.ok(isImageError(pixelAt(made, -1, 0)))
  })
})

describe('histograms', () => {
  it('counts every pixel exactly once', () => {
    const made = ok(histogram(pic('checkerboard', 32)))
    assert.equal(made.pixels, 32 * 32)
    assert.equal(made.brightness.reduce((a, b) => a + b, 0), 32 * 32)
    assert.equal(made.red.reduce((a, b) => a + b, 0), 32 * 32)
  })

  it('a checkerboard is only black and white', () => {
    const made = ok(histogram(pic('checkerboard', 32)))
    assert.equal(made.darkest, 0)
    assert.equal(made.lightest, 255)
    assert.ok(made.brightness[0] > 0 && made.brightness[255] > 0)
    // Nothing in between.
    assert.equal(made.brightness.slice(1, 255).reduce((a, b) => a + b, 0), 0)
  })

  it('a gradient uses the whole range', () => {
    const made = ok(histogram(pic('gradient', 64)))
    assert.equal(made.darkest, 0)
    assert.ok(made.lightest > 250)
  })

  it('says when an image uses only a narrow range', () => {
    const made = makePicture(16, 16)
    assert.ok(!isImageError(made))
    for (let at = 0; at < made.data.length; at += 4) {
      made.data[at] = 100 + (at % 20)
      made.data[at + 1] = 100 + (at % 20)
      made.data[at + 2] = 100 + (at % 20)
      made.data[at + 3] = 255
    }
    const counted = ok(histogram(made))
    assert.ok(counted.notes.some((one) => /less than half the range/.test(one)))
  })

  it('reports clipping at both ends', () => {
    const made = ok(histogram(pic('step', 32)))
    assert.ok(made.clippedDark > 0)
    assert.ok(made.clippedLight > 0)
    assert.ok(made.notes.some((one) => /pure black/.test(one)))
    assert.ok(made.notes.some((one) => /pure white/.test(one)))
  })
})

describe('convolution', () => {
  it('the identity kernel leaves the image exactly as it was', () => {
    const before = pic('circles', 32)
    const after = ok(convolve(before, ok(kernel('identity'))))
    assert.deepEqual([...after.picture.data], [...before.data])
  })

  it('a blur does not change the overall brightness', () => {
    // The property that catches a missing or wrong divisor: a blur that brightens is a bug.
    const before = pic('checkerboard', 48)
    const after = ok(convolve(before, ok(kernel('box-blur'))))
    assert.ok(Math.abs(meanOf(after.picture) - meanOf(before)) < 3, `before ${meanOf(before)}, after ${meanOf(after.picture)}`)
  })

  it('a blur really does reduce the variation', () => {
    const before = pic('noise', 48)
    const after = ok(convolve(before, ok(kernel('gaussian-blur'))))
    const spread = (picture: Picture): number => {
      const mean = meanOf(picture)
      let total = 0
      for (let at = 0; at < picture.data.length; at += 4) {
        total += (brightnessOf(picture.data[at], picture.data[at + 1], picture.data[at + 2]) - mean) ** 2
      }
      return total / (picture.width * picture.height)
    }
    assert.ok(spread(after.picture) < spread(before) * 0.8, 'a blur must flatten noise')
  })

  it('a bigger blur radius blurs more', () => {
    const before = pic('checkerboard', 64)
    const small = ok(convolve(before, ok(gaussian(1))))
    const large = ok(convolve(before, ok(gaussian(4))))
    const spread = (picture: Picture): number => {
      const mean = meanOf(picture)
      let total = 0
      for (let at = 0; at < picture.data.length; at += 4) {
        total += (brightnessOf(picture.data[at], picture.data[at + 1], picture.data[at + 2]) - mean) ** 2
      }
      return total
    }
    assert.ok(spread(large.picture) < spread(small.picture), 'radius 4 must flatten more than radius 1')
  })

  it('the across filter finds vertical bars and the down filter does not', () => {
    /*
     * The clearest demonstration there is of what a direction means in a kernel. Vertical bars change left to right
     * and not top to bottom, so one filter should find everything and the other almost nothing.
     */
    const bars = pic('bars', 48)
    const across = ok(convolve(bars, ok(kernel('sobel-x'))))
    const down = ok(convolve(bars, ok(kernel('sobel-y'))))
    const awayFromMiddle = (picture: Picture): number => {
      let total = 0
      for (let at = 0; at < picture.data.length; at += 4) total += Math.abs(picture.data[at] - 128)
      return total
    }
    assert.ok(
      awayFromMiddle(across.picture) > awayFromMiddle(down.picture) * 5,
      `across ${awayFromMiddle(across.picture)}, down ${awayFromMiddle(down.picture)}`
    )
  })

  it('an edge kernel finds nothing in a flat area', () => {
    const flat = makePicture(16, 16)
    assert.ok(!isImageError(flat))
    for (let at = 0; at < flat.data.length; at += 4) {
      flat.data[at] = 120
      flat.data[at + 1] = 120
      flat.data[at + 2] = 120
      flat.data[at + 3] = 255
    }
    const made = ok(convolve(flat, ok(kernel('edge-detect'))))
    // A kernel summing to zero over a flat area gives zero, wherever you look.
    for (let at = 0; at < made.picture.data.length; at += 4) assert.equal(made.picture.data[at], 0)
    assert.ok(made.notes.some((one) => /sums to zero/.test(one)))
  })

  it('transparency is carried through rather than blurred', () => {
    const made = makePicture(8, 8)
    assert.ok(!isImageError(made))
    for (let i = 0; i < 64; i += 1) {
      made.data[i * 4] = 200
      made.data[i * 4 + 1] = 200
      made.data[i * 4 + 2] = 200
      // Half opaque, half not: a blur of alpha would soften the boundary.
      made.data[i * 4 + 3] = i % 8 < 4 ? 255 : 0
    }
    const after = ok(convolve(made, ok(kernel('gaussian-blur'))))
    for (let i = 0; i < 64; i += 1) {
      assert.equal(after.picture.data[i * 4 + 3], made.data[i * 4 + 3], `alpha changed at ${i}`)
    }
  })

  it('every edge handling gives a usable image, and they differ at the border', () => {
    const before = pic('step', 32)
    const results = new Map<string, number>()
    for (const how of ['extend', 'wrap', 'mirror', 'crop'] as const) {
      const made = ok(convolve(before, ok(gaussian(3)), how))
      assert.equal(made.picture.data.length, before.data.length, how)
      results.set(how, made.picture.data[0])
    }
    // Treating the outside as black darkens the border, which the others do not.
    assert.ok((results.get('crop') ?? 0) <= (results.get('extend') ?? 0))
  })

  it('refuses a kernel with no centre', () => {
    const made = convolve(pic('step', 8), { width: 2, height: 2, values: [1, 1, 1, 1] })
    assert.ok(isImageError(made))
    assert.match(made.says, /no centre/)
  })

  it('refuses a kernel with the wrong number of values', () => {
    const made = convolve(pic('step', 8), { width: 3, height: 3, values: [1, 1, 1] })
    assert.ok(isImageError(made))
    assert.match(made.says, /needs 9 values/)
  })

  it('refuses a divisor of zero and a value that is not a number', () => {
    assert.ok(isImageError(convolve(pic('step', 8), { width: 3, height: 3, values: new Array(9).fill(1), divisor: 0 })))
    assert.ok(isImageError(convolve(pic('step', 8), { width: 3, height: 3, values: [1, 1, 1, 1, Number.NaN, 1, 1, 1, 1] })))
  })

  it('every named kernel applies', () => {
    for (const which of KNOWN_KERNELS) {
      const made = convolve(pic('circles', 24), ok(kernel(which)))
      assert.ok(!isImageError(made), `${which}: ${isImageError(made) ? made.says : ''}`)
    }
  })

  it('refuses a gaussian radius it cannot make', () => {
    assert.ok(isImageError(gaussian(0)))
    assert.ok(isImageError(gaussian(100)))
  })

  it('counts the multiplications, and a wider kernel costs more', () => {
    const small = ok(convolve(pic('step', 32), ok(gaussian(1))))
    const large = ok(convolve(pic('step', 32), ok(gaussian(3))))
    assert.ok(large.multiplications > small.multiplications * 3)
    assert.ok(large.notes.some((one) => /four times as much/.test(one)))
  })
})

describe('adjustments', () => {
  it('grayscale makes every channel the same', () => {
    const made = ok(adjust(pic('circles', 16), 'grayscale'))
    for (let at = 0; at < made.picture.data.length; at += 4) {
      assert.equal(made.picture.data[at], made.picture.data[at + 1])
      assert.equal(made.picture.data[at + 1], made.picture.data[at + 2])
    }
    assert.ok(made.notes.some((one) => /pure blue/.test(one)))
  })

  it('inverting twice returns the original', () => {
    const before = pic('circles', 16)
    const once = ok(adjust(before, 'invert'))
    const twice = ok(adjust(once.picture, 'invert'))
    assert.deepEqual([...twice.picture.data], [...before.data])
  })

  it('brightness moves the mean, and reports what it flattened', () => {
    const before = pic('gradient', 32)
    const after = ok(adjust(before, 'brightness', 60))
    assert.ok(meanOf(after.picture) > meanOf(before))
    assert.ok(after.clipped > 0, 'pushing a gradient up must flatten the bright end')
    assert.ok(after.notes.some((one) => /cannot be recovered/.test(one)))
  })

  it('contrast of one changes nothing', () => {
    const before = pic('gradient', 16)
    const after = ok(adjust(before, 'contrast', 1))
    assert.deepEqual([...after.picture.data], [...before.data])
  })

  it('gamma brightens the middle without clipping the ends', () => {
    const before = pic('gradient', 64)
    const after = ok(adjust(before, 'gamma', 2))
    assert.ok(meanOf(after.picture) > meanOf(before), 'a gamma above 1 must brighten')
    assert.equal(after.clipped, 0, 'gamma must not clip')
    assert.ok(after.notes.some((one) => /rarely clips/.test(one)))
  })

  it('saturation of zero leaves a grey image', () => {
    const made = makePicture(4, 4)
    assert.ok(!isImageError(made))
    for (let i = 0; i < 16; i += 1) {
      made.data[i * 4] = 200
      made.data[i * 4 + 1] = 40
      made.data[i * 4 + 2] = 90
      made.data[i * 4 + 3] = 255
    }
    const after = ok(adjust(made, 'saturation', 0))
    for (let at = 0; at < after.picture.data.length; at += 4) {
      assert.equal(after.picture.data[at], after.picture.data[at + 1])
      assert.equal(after.picture.data[at + 1], after.picture.data[at + 2])
    }
  })

  it('posterise reduces the image to the number of levels asked for', () => {
    const after = ok(adjust(pic('gradient', 64), 'posterise', 4))
    const levels = new Set<number>()
    for (let at = 0; at < after.picture.data.length; at += 4) levels.add(after.picture.data[at])
    assert.ok(levels.size <= 4, `got ${levels.size} levels`)
  })

  it('every adjustment runs', () => {
    for (const which of ADJUSTMENTS) {
      const made = adjust(pic('circles', 16), which, which === 'posterise' ? 4 : which === 'threshold' ? 128 : 1.2)
      assert.ok(!isImageError(made), `${which}: ${isImageError(made) ? made.says : ''}`)
    }
  })

  it('refuses an adjustment it does not have, and one with no number', () => {
    assert.ok(isImageError(adjust(pic('step', 8), 'nonsense' as never)))
    assert.ok(isImageError(adjust(pic('step', 8), 'brightness', Number.NaN)))
  })
})

describe('thresholds', () => {
  it("Otsu's method lands between the two groups", () => {
    /*
     * An image with two clear groups of brightness — 60 and 200 — has one obviously right answer, and a method that
     * genuinely maximises the separation must land between them rather than anywhere.
     */
    const made = makePicture(32, 32)
    assert.ok(!isImageError(made))
    for (let i = 0; i < 32 * 32; i += 1) {
      const value = i % 2 === 0 ? 60 : 200
      made.data[i * 4] = value
      made.data[i * 4 + 1] = value
      made.data[i * 4 + 2] = value
      made.data[i * 4 + 3] = 255
    }
    const found = ok(threshold(made, 'otsu'))
    assert.ok(found.level > 60 && found.level < 200, `the threshold came out at ${found.level}`)
    assert.ok(Math.abs(found.foreground - 0.5) < 0.02, `foreground was ${found.foreground}`)
  })

  it('it lands in a different place for a different image, which is the point', () => {
    const dark = ok(threshold(pic('noise', 32), 'otsu'))
    const bright = ok(threshold(ok(adjust(pic('noise', 32), 'brightness', 80)).picture, 'otsu'))
    assert.notEqual(dark.level, bright.level)
  })

  it('the mean method is honest about where it goes wrong', () => {
    const made = ok(threshold(pic('step', 32), 'mean'))
    assert.ok(made.notes.some((one) => /average/.test(one) && /goes wrong/.test(one)))
  })

  it('a given level is used exactly', () => {
    const made = ok(threshold(pic('gradient', 32), 'given', 77))
    assert.equal(made.level, 77)
  })

  it('says when the threshold put almost everything on one side', () => {
    const made = ok(threshold(pic('gradient', 32), 'given', 255))
    assert.ok(made.foreground < 0.03, `foreground was ${made.foreground}`)
    assert.ok(made.notes.some((one) => /one side/.test(one)))
  })

  it('refuses a level that is not a brightness', () => {
    assert.ok(isImageError(threshold(pic('step', 8), 'given', 300)))
    assert.ok(isImageError(threshold(pic('step', 8), 'given', -5)))
  })
})

describe('finding shapes', () => {
  it('finds three circles as three shapes', () => {
    const made = ok(regions(pic('circles', 64), { smallest: 4 }))
    assert.equal(made.regions.length, 3)
    // Sorted largest first, and the largest circle really is the largest.
    assert.ok(made.regions[0].pixels > made.regions[1].pixels)
    // Each is roughly round: a circle fills about pi/4 of its bounding box.
    for (const one of made.regions) {
      assert.ok(one.fill > 0.6 && one.fill <= 1, `a circle filled ${one.fill.toFixed(2)} of its box`)
    }
  })

  it('connectivity decides whether two shapes touching at a corner are one or two', () => {
    const corner = pic('two-blobs', 32)
    const eight = ok(regions(corner, { connectivity: 8 }))
    const four = ok(regions(corner, { connectivity: 4 }))
    assert.equal(eight.regions.length, 1, 'eight-way joins them at the corner')
    assert.equal(four.regions.length, 2, 'four-way keeps them apart')
    assert.ok(eight.notes.some((one) => /one/.test(one)))
    assert.ok(four.notes.some((one) => /two/.test(one)))
  })

  it('every foreground pixel belongs to exactly one shape', () => {
    const made = pic('circles', 48)
    const found = ok(regions(made))
    let foreground = 0
    for (let at = 0; at < made.data.length; at += 4) if (made.data[at] > 127) foreground += 1
    const labelled = found.labels.filter((one) => one !== 0).length
    assert.equal(labelled, foreground, 'every white pixel must get a label')
    assert.equal(found.background + labelled, made.width * made.height)
  })

  it('a shape smaller than asked for is left out, and said to be', () => {
    const made = ok(regions(pic('noise', 32), { smallest: 50 }))
    assert.ok(made.notes.some((one) => /were left out/.test(one)) || made.regions.length > 0)
  })

  it('says plainly when nothing was found', () => {
    const black = makePicture(16, 16)
    assert.ok(!isImageError(black))
    for (let at = 3; at < black.data.length; at += 4) black.data[at] = 255
    const made = ok(regions(black))
    assert.equal(made.regions.length, 0)
    assert.ok(made.notes.some((one) => /Nothing was found/.test(one)))
  })

  it('a large single region does not overflow anything', () => {
    // An explicit stack rather than recursion is what makes this work; a recursive fill would overflow here.
    const white = makePicture(200, 200)
    assert.ok(!isImageError(white))
    for (let i = 0; i < 200 * 200; i += 1) {
      white.data[i * 4] = 255
      white.data[i * 4 + 1] = 255
      white.data[i * 4 + 2] = 255
      white.data[i * 4 + 3] = 255
    }
    const made = ok(regions(white))
    assert.equal(made.regions.length, 1)
    assert.equal(made.regions[0].pixels, 200 * 200)
  })
})

describe('edges', () => {
  it('a step image has one edge, down the middle', () => {
    const made = ok(edges(pic('step', 48), { blurFirst: false }))
    // The strongest response should be at the boundary, which is the middle column.
    let strongestColumn = 0
    let most = -1
    for (let x = 0; x < 48; x += 1) {
      let total = 0
      for (let y = 0; y < 48; y += 1) total += made.strength[y * 48 + x]
      if (total > most) {
        most = total
        strongestColumn = x
      }
    }
    assert.ok(Math.abs(strongestColumn - 24) <= 1, `the strongest column was ${strongestColumn}, not the middle`)
  })

  it('a step responds far more strongly than a smooth ramp', () => {
    /*
     * A constant slope has a constant gradient, so at a low enough threshold a ramp is marked everywhere — that is a
     * true property of a magnitude threshold, not a fault. What distinguishes a step is the *strength*, so that is
     * what is compared, at the same threshold for both.
     */
    const smooth = ok(edges(pic('gradient', 48), { blurFirst: false, threshold: 100 }))
    const sharp = ok(edges(pic('step', 48), { blurFirst: false, threshold: 100 }))
    assert.equal(smooth.edgePixels, 0, 'a gentle ramp should not reach a threshold of 100')
    assert.ok(sharp.edgePixels > 0, 'a step should')
    assert.ok(Math.max(...sharp.strength) > Math.max(...smooth.strength) * 10)
  })

  it('and says that an adaptive threshold can mark a whole ramp', () => {
    const made = ok(edges(pic('gradient', 48)))
    assert.ok(made.notes.some((one) => /smooth ramp/.test(one)))
  })

  it('blurring first removes the edges that noise produces', () => {
    const noisy = pic('noise', 48)
    const raw = ok(edges(noisy, { blurFirst: false, threshold: 60 }))
    const blurred = ok(edges(noisy, { blurFirst: true, threshold: 60 }))
    assert.ok(blurred.edgePixels < raw.edgePixels, `raw ${raw.edgePixels}, blurred ${blurred.edgePixels}`)
    assert.ok(raw.notes.some((one) => /noise in the image appears as edges/.test(one)))
  })

  it('the direction is kept, and a vertical edge points across', () => {
    const made = ok(edges(pic('step', 32), { blurFirst: false }))
    // At the boundary of a left-dark right-bright step the gradient points along x, so near 0 degrees.
    const at = 16 * 32 + 16
    assert.ok(Math.abs(made.direction[at]) < 20 || Math.abs(Math.abs(made.direction[at]) - 180) < 20, `direction was ${made.direction[at]}`)
    assert.ok(made.notes.some((one) => /direction at each pixel is kept/.test(one)))
  })

  it('says when the threshold let too much through to be useful', () => {
    const made = ok(edges(pic('checkerboard', 48), { threshold: 1 }))
    assert.ok(made.notes.some((one) => /too much to be useful/.test(one)))
  })

  it('a corner shows a gradient in two directions, which an edge detector alone cannot distinguish', () => {
    const made = ok(edges(pic('corners', 48), { blurFirst: false }))
    assert.ok(made.edgePixels > 0)
    // The four sides of the square are all found.
    assert.ok(made.edgePixels > 48, `only ${made.edgePixels} edge pixels on a square`)
  })
})
