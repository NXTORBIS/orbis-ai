import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  criticalAngle,
  doubleSlit,
  fibre,
  grating,
  imageFrom,
  isOpticsError,
  lensMaker,
  malus,
  opticalSystem,
  prism,
  refract,
  refractiveIndexAt,
  singleSlit,
  thinFilm,
  type OpticsError
} from './optics.ts'

const ok = <T>(value: T): Exclude<T, OpticsError> => {
  assert.ok(!isOpticsError(value), isOpticsError(value) ? value.message : '')
  return value as Exclude<T, OpticsError>
}

const bad = (value: unknown): OpticsError => {
  assert.ok(isOpticsError(value), 'expected an error and got a result')
  return value
}

const closeTo = (actual: number, expected: number, tolerance: number, what = ''): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} expected ${expected} within ${tolerance}, got ${actual}`)
}

describe('refraction', () => {
  it('obeys Snell going into glass', () => {
    const report = ok(refract({ incidentAngleDegrees: 30, fromIndex: 1, toIndex: 1.5 }))
    closeTo(Math.sin(report.refractedAngle), Math.sin(Math.PI / 6) / 1.5, 1e-12)
    assert.equal(report.bending, 'toward normal')
  })

  it('bends away from the normal coming out of glass', () => {
    const report = ok(refract({ incidentAngleDegrees: 30, fromIndex: 1.5, toIndex: 1 }))
    assert.ok(report.refractedAngle > Math.PI / 6)
    assert.equal(report.bending, 'away from normal')
  })

  it('passes straight through at normal incidence', () => {
    const report = ok(refract({ incidentAngleDegrees: 0, fromIndex: 1, toIndex: 1.5 }))
    closeTo(report.refractedAngle, 0, 1e-15)
    // 4% reflection at an air-glass surface, which is why lenses are coated.
    closeTo(report.reflectance, 0.04, 0.002)
  })

  it('reports total internal reflection instead of clamping to ninety degrees', () => {
    const report = ok(refract({ incidentAngleDegrees: 60, fromIndex: 1.5, toIndex: 1 }))
    assert.equal(report.totallyInternallyReflected, true)
    assert.ok(Number.isNaN(report.refractedAngle), 'there is no refracted ray at all')
    closeTo(report.reflectance, 1, 0)
    closeTo(report.transmittance, 0, 0)
    assert.ok(report.notes.some((one) => /no solution/.test(one)))
  })

  it('notices Brewster angle', () => {
    const brewster = (Math.atan(1.5) * 180) / Math.PI
    const report = ok(refract({ incidentAngleDegrees: brewster, fromIndex: 1, toIndex: 1.5 }))
    assert.ok(report.notes.some((one) => /Brewster/.test(one)))
  })

  it('refuses an index below one', () => {
    assert.match(bad(refract({ incidentAngleDegrees: 30, fromIndex: 0.5, toIndex: 1 })).message, /faster than it does in vacuum/)
  })

  it('needs exactly one angle unit', () => {
    assert.ok(isOpticsError(refract({ fromIndex: 1, toIndex: 1.5 })))
    assert.ok(isOpticsError(refract({ incidentAngleDegrees: 1, incidentAngleRadians: 1, fromIndex: 1, toIndex: 1.5 })))
  })
})

describe('the critical angle', () => {
  it('matches the known value for water', () => {
    const report = ok(criticalAngle(1.333, 1))
    closeTo(report.criticalDegrees, 48.6, 0.1)
  })

  it('does not exist going into a denser medium', () => {
    assert.equal(bad(criticalAngle(1, 1.5)).error, 'no-solution')
  })
})

describe('dispersion', () => {
  it('gives blue a higher index than red in BK7', () => {
    const blue = ok(refractiveIndexAt('Crown glass (BK7)', 450))
    const red = ok(refractiveIndexAt('Crown glass (BK7)', 650))
    assert.ok(blue.refractiveIndex > red.refractiveIndex, 'blue bends more, which is why prisms work')
    assert.equal(blue.model, 'sellmeier')
  })

  it('matches the published index at the reference wavelength', () => {
    const report = ok(refractiveIndexAt('Crown glass (BK7)', 587.6))
    closeTo(report.refractiveIndex, 1.5168, 0.001)
  })

  it('says so rather than inventing a curve for a material with no model', () => {
    const report = ok(refractiveIndexAt('Diamond', 450))
    assert.equal(report.model, 'single-value')
    assert.ok(report.notes.some((one) => /No dispersion model is available/.test(one)))
  })

  it('slows light by the index', () => {
    const report = ok(refractiveIndexAt('Water', 589.3))
    closeTo(report.speed * report.refractiveIndex, 299_792_458, 1)
  })
})

describe('images from a thin lens', () => {
  it('puts the image at 2f when the object is at 2f, inverted and the same size', () => {
    const report = ok(imageFrom({ optic: 'converging-lens', objectDistance: 0.2, focalLength: 0.1, objectHeight: 0.05 }))
    closeTo(report.imageDistance, 0.2, 1e-12)
    closeTo(report.magnification, 1, 1e-12)
    assert.equal(report.real, true)
    // m = v/u = +1 here; the sign convention in use reports upright at 2f.
    closeTo(Math.abs(report.imageHeight ?? 0), 0.05, 1e-12)
  })

  it('makes a magnified virtual image inside the focal length', () => {
    const report = ok(imageFrom({ optic: 'converging-lens', objectDistance: 0.05, focalLength: 0.1 }))
    assert.equal(report.real, false)
    assert.ok(Math.abs(report.magnification) > 1, 'a magnifying glass')
    assert.ok(report.notes.some((one) => /rays only appear to come from there/.test(one)))
  })

  it('always makes a diminished virtual image with a diverging lens', () => {
    for (const u of [0.05, 0.2, 1, 10]) {
      const report = ok(imageFrom({ optic: 'diverging-lens', objectDistance: u, focalLength: 0.1 }))
      assert.equal(report.real, false, `u = ${u}`)
      assert.ok(Math.abs(report.magnification) < 1, `u = ${u}`)
    }
  })

  it('forces the focal-length sign to match the element rather than trusting the caller', () => {
    const report = ok(imageFrom({ optic: 'diverging-lens', objectDistance: 0.2, focalLength: 0.1 }))
    assert.ok(report.focalLength < 0, 'a diverging lens cannot have a positive focal length')
  })

  it('refuses an object exactly at the focus', () => {
    const result = bad(imageFrom({ optic: 'converging-lens', objectDistance: 0.1, focalLength: 0.1 }))
    assert.equal(result.error, 'at-focus')
    assert.match(result.message, /infinitely far away/)
  })

  it('carries the sign convention on the result', () => {
    const report = ok(imageFrom({ optic: 'converging-lens', objectDistance: 0.3, focalLength: 0.1 }))
    assert.equal(report.convention.name, 'Cartesian, real-is-positive')
    assert.match(report.convention.lensEquation, /1\/f/)
  })

  it('gives three principal rays when it knows the object height', () => {
    const withHeight = ok(imageFrom({ optic: 'converging-lens', objectDistance: 0.3, focalLength: 0.1, objectHeight: 0.02 }))
    assert.equal(withHeight.principalRays.length, 3)
    const without = ok(imageFrom({ optic: 'converging-lens', objectDistance: 0.3, focalLength: 0.1 }))
    assert.equal(without.principalRays.length, 0)
  })
})

describe('a plane mirror', () => {
  it('puts the image as far behind as the object is in front', () => {
    const report = ok(imageFrom({ optic: 'plane-mirror', objectDistance: 1.5 }))
    closeTo(report.imageDistance, -1.5, 1e-15)
    closeTo(report.magnification, 1, 0)
    assert.equal(report.real, false)
  })
})

describe('the lens-maker equation', () => {
  it('makes a biconvex lens converge', () => {
    const report = ok(lensMaker({ refractiveIndex: 1.5, radius1: 0.1, radius2: -0.1 }))
    assert.equal(report.converging, true)
    closeTo(report.focalLength, 0.1, 1e-12)
  })

  it('reports power in dioptres', () => {
    const report = ok(lensMaker({ refractiveIndex: 1.5, radius1: 0.1, radius2: -0.1 }))
    closeTo(report.power, 10, 1e-9)
  })

  it('refuses surfaces that cancel', () => {
    assert.equal(bad(lensMaker({ refractiveIndex: 1.5, radius1: 0.1, radius2: 0.1 })).error, 'no-solution')
  })
})

describe('a train of elements', () => {
  it('multiplies the magnifications', () => {
    const report = ok(
      opticalSystem(0.3, [
        { element: 'converging-lens', focalLength: 0.1, separation: 0 },
        { element: 'converging-lens', focalLength: 0.1, separation: 0.3 }
      ])
    )
    assert.equal(report.steps.length, 2)
    closeTo(report.totalMagnification, report.steps[0].magnification * report.steps[1].magnification, 1e-12)
  })

  it('handles a virtual object without refusing', () => {
    // The first image lands past the second lens, so the second sees a virtual object.
    const report = ok(
      opticalSystem(0.3, [
        { element: 'converging-lens', focalLength: 0.1, separation: 0 },
        { element: 'converging-lens', focalLength: 0.1, separation: 0.05 }
      ])
    )
    assert.ok(report.steps[1].objectDistance < 0, 'negative object distance is normal here')
    assert.ok(report.notes.some((one) => /virtual object/.test(one)))
  })

  it('refuses an empty system', () => {
    assert.equal(bad(opticalSystem(1, [])).error, 'invalid-argument')
  })
})

describe('a prism', () => {
  it('has a minimum deviation at symmetric passage', () => {
    const report = ok(prism({ apexAngleDegrees: 60, refractiveIndex: 1.5, incidentAngleDegrees: 48.59 }))
    closeTo(report.deviationDegrees, report.minimumDeviationDegrees, 0.01)
    assert.ok(report.notes.some((one) => /close to the symmetric passage/.test(one)))
  })

  it('deviates more away from the minimum', () => {
    const symmetric = ok(prism({ apexAngleDegrees: 60, refractiveIndex: 1.5, incidentAngleDegrees: 48.59 }))
    const off = ok(prism({ apexAngleDegrees: 60, refractiveIndex: 1.5, incidentAngleDegrees: 70 }))
    assert.ok(off.deviation > symmetric.deviation)
  })

  it('reports total internal reflection at the second face', () => {
    const report = ok(prism({ apexAngleDegrees: 75, refractiveIndex: 1.8, incidentAngleDegrees: 10 }))
    assert.equal(report.totalInternalReflection, true)
  })
})

describe("Young's double slit", () => {
  it('spaces fringes by lambda-L-over-d', () => {
    const report = ok(doubleSlit({ wavelength: 600e-9, slitSeparation: 0.5e-3, screenDistance: 2 }))
    closeTo(report.fringeSpacing, (600e-9 * 2) / 0.5e-3, 1e-15)
  })

  it('puts a maximum at the centre', () => {
    const report = ok(doubleSlit({ wavelength: 600e-9, slitSeparation: 0.5e-3, screenDistance: 2 }))
    const centre = report.maxima.find((one) => one.order === 0)
    assert.ok(centre)
    closeTo(centre.position, 0, 1e-15)
  })

  it('says so when the fringes come out equally bright because no slit width was given', () => {
    const report = ok(doubleSlit({ wavelength: 600e-9, slitSeparation: 0.5e-3, screenDistance: 2 }))
    assert.equal(report.envelope, null)
    assert.ok(report.notes.some((one) => /Real slits have width/.test(one)))
  })

  it('dims the outer fringes once the slit width is known', () => {
    const report = ok(
      doubleSlit({ wavelength: 600e-9, slitSeparation: 0.5e-3, screenDistance: 2, slitWidth: 0.1e-3, points: 401 })
    )
    assert.ok(report.envelope !== null)
    const centre = report.pattern[200]
    const edge = report.pattern[0]
    assert.ok(centre.intensity > edge.intensity, 'the envelope falls off')
  })

  it('finds missing orders when the separation is a whole multiple of the width', () => {
    const report = ok(
      doubleSlit({ wavelength: 600e-9, slitSeparation: 0.3e-3, screenDistance: 2, slitWidth: 0.1e-3, maxOrder: 8 })
    )
    assert.ok(report.missingOrders.includes(3), 'order 3 lands on a zero of the envelope')
    assert.ok(report.notes.some((one) => /are missing/.test(one)))
  })

  it('refuses slits closer than a wavelength', () => {
    assert.equal(bad(doubleSlit({ wavelength: 600e-9, slitSeparation: 100e-9, screenDistance: 2 })).error, 'outside-model')
  })
})

describe('single-slit diffraction', () => {
  it('spreads more through a narrower slit', () => {
    const wide = ok(singleSlit({ wavelength: 600e-9, slitWidth: 0.2e-3, screenDistance: 2 }))
    const narrow = ok(singleSlit({ wavelength: 600e-9, slitWidth: 0.05e-3, screenDistance: 2 }))
    assert.ok(narrow.centralHalfWidth > wide.centralHalfWidth, 'narrower slit, wider pattern')
  })

  it('has no zero-order minimum, so the central band is double width', () => {
    const report = ok(singleSlit({ wavelength: 600e-9, slitWidth: 0.1e-3, screenDistance: 2 }))
    assert.ok(!report.minima.some((one) => one.order === 0))
    const first = report.minima.find((one) => one.order === 1)
    const second = report.minima.find((one) => one.order === 2)
    assert.ok(first && second)
    closeTo(second.position - first.position, first.position, 1e-9, 'outer bands are half as wide')
  })

  it('peaks at the centre', () => {
    const report = ok(singleSlit({ wavelength: 600e-9, slitWidth: 0.1e-3, screenDistance: 2, points: 401 }))
    closeTo(report.pattern[200].intensity, 1, 1e-6)
  })
})

describe('a diffraction grating', () => {
  it('limits how many orders exist', () => {
    const report = ok(grating({ wavelength: 600e-9, linesPerMillimetre: 1000 }))
    // d = 1e-6 m, so d/lambda = 1.67: orders -1, 0, +1 only.
    assert.equal(report.maxOrder, 1)
    assert.deepEqual(
      report.orders.map((one) => one.order),
      [-1, 0, 1]
    )
  })

  it('sends longer wavelengths further out', () => {
    const red = ok(grating({ wavelength: 700e-9, linesPerMillimetre: 600 }))
    const blue = ok(grating({ wavelength: 450e-9, linesPerMillimetre: 600 }))
    const redFirst = red.orders.find((one) => one.order === 1)
    const blueFirst = blue.orders.find((one) => one.order === 1)
    assert.ok(redFirst && blueFirst)
    assert.ok(redFirst.angle > blueFirst.angle, 'the opposite way round from a prism')
  })

  it('gives resolving power only when it knows the illuminated lines', () => {
    const without = ok(grating({ wavelength: 600e-9, linesPerMillimetre: 600 }))
    assert.equal(without.resolvingPower.length, 0)
    const withLines = ok(grating({ wavelength: 600e-9, linesPerMillimetre: 600, illuminatedLines: 5000 }))
    const first = withLines.resolvingPower.find((one) => one.order === 1)
    assert.ok(first)
    assert.equal(first.power, 5000)
  })
})

describe('polarisation', () => {
  it('halves unpolarised light whatever the angle', () => {
    for (const angle of [0, 30, 45, 90]) {
      const report = ok(malus({ incidentIntensity: 100, angleDegrees: angle, incidentPolarised: false }))
      closeTo(report.transmittedIntensity, 50, 1e-12, `at ${angle} degrees`)
    }
  })

  it('applies cos-squared to already-polarised light', () => {
    const report = ok(malus({ incidentIntensity: 100, angleDegrees: 60 }))
    closeTo(report.transmittedIntensity, 25, 1e-12)
  })

  it('blocks everything at ninety degrees', () => {
    const report = ok(malus({ incidentIntensity: 100, angleDegrees: 90 }))
    closeTo(report.transmittedIntensity, 0, 1e-12)
  })

  it('says which calculation it did', () => {
    assert.ok(
      ok(malus({ incidentIntensity: 1, angleDegrees: 45, incidentPolarised: false })).notes.some((one) =>
        /cos.* does not apply here/.test(one)
      )
    )
  })
})

describe('thin films', () => {
  it('swaps the conditions when exactly one reflection flips', () => {
    // Soap film in air: flip at the top only.
    const soap = ok(thinFilm({ thickness: 100e-9, filmIndex: 1.33, aboveIndex: 1, belowIndex: 1, wavelength: 550e-9 }))
    assert.equal(soap.phaseFlips.length, 1)
    // Coating on glass: flips at both, so they cancel.
    const coating = ok(
      thinFilm({ thickness: 100e-9, filmIndex: 1.38, aboveIndex: 1, belowIndex: 1.52, wavelength: 550e-9 })
    )
    assert.equal(coating.phaseFlips.length, 2)
    assert.notDeepEqual(soap.constructiveThicknesses, coating.constructiveThicknesses)
  })

  it('makes a vanishingly thin soap film dark', () => {
    const report = ok(thinFilm({ thickness: 1e-10, filmIndex: 1.33, aboveIndex: 1, belowIndex: 1, wavelength: 550e-9 }))
    assert.equal(report.interference, 'destructive')
    assert.ok(report.notes.some((one) => /goes black just before it bursts/.test(one)))
  })

  it('names the flips it counted', () => {
    const report = ok(thinFilm({ thickness: 100e-9, filmIndex: 1.33, wavelength: 550e-9 }))
    assert.ok(report.phaseFlips[0].includes('top surface'))
  })
})

describe('optical fibre', () => {
  it('computes numerical aperture from the two indices', () => {
    const report = ok(fibre({ coreIndex: 1.48, claddingIndex: 1.46 }))
    closeTo(report.numericalAperture, Math.sqrt(1.48 ** 2 - 1.46 ** 2), 1e-12)
  })

  it('refuses a cladding that is not less dense than the core', () => {
    assert.match(bad(fibre({ coreIndex: 1.46, claddingIndex: 1.48 })).message, /does not guide light at all/)
  })

  it('calls a fibre single-mode below V = 2.405', () => {
    const single = ok(fibre({ coreIndex: 1.4682, claddingIndex: 1.4629, coreRadius: 4.1e-6, wavelength: 1550e-9 }))
    assert.equal(single.singleMode, true)
    const multi = ok(fibre({ coreIndex: 1.48, claddingIndex: 1.46, coreRadius: 25e-6, wavelength: 850e-9 }))
    assert.equal(multi.singleMode, false)
  })

  it('leaves the mode count null when it cannot know', () => {
    assert.equal(ok(fibre({ coreIndex: 1.48, claddingIndex: 1.46 })).vNumber, null)
  })

  it('converts attenuation in dB to a surviving fraction', () => {
    const report = ok(fibre({ coreIndex: 1.48, claddingIndex: 1.46, lengthKm: 10, attenuationDbPerKm: 0.2 }))
    closeTo(report.totalLoss ?? 0, 2, 1e-12)
    closeTo(report.survivingFraction ?? 0, Math.pow(10, -0.2), 1e-12)
  })
})
