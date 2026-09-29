/**
 * Materials, statics and beams, checked against answers that can be worked out by hand.
 *
 * Every case here has a closed-form answer from an independent route, so a wrong sign convention or a dropped
 * factor shows up as a number rather than as a plausible-looking curve.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MATERIALS,
  materialById,
  propertyOf,
  compareProperty,
  elasticConstants,
  ruleOfMixtures,
  isMaterialError
} from './materials.ts'
import {
  resultant,
  beamReactions,
  solveTruss,
  blockOnSlope,
  beltFriction,
  compositeArea,
  isStaticsError
} from './statics.ts'
import {
  sectionProperties,
  analyseBeam,
  mohrsCircle,
  checkFailure,
  eulerBuckling,
  shaftTorsion,
  isBeamError
} from './beams.ts'

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: got ${actual}, expected about ${expected}`)
}

// ---------------------------------------------------------------- materials

test('every material property carries a unit and a source', () => {
  for (const material of MATERIALS) {
    for (const [name, property] of Object.entries(material.properties)) {
      if (!property) continue
      assert.ok(property.source.length > 0, `${material.id}.${name} has no source`)
      assert.ok(property.condition.length > 0, `${material.id}.${name} does not say the condition it holds at`)
    }
  }
})

test('a known material comes back and an unknown one is refused', () => {
  const steel = materialById('steel-mild')
  assert.ok(!isMaterialError(steel))
  const nothing = materialById('unobtainium')
  assert.ok(isMaterialError(nothing))
})

test('a property that is not held is refused rather than invented', () => {
  const found = propertyOf('steel-mild', 'youngsModulus')
  assert.ok(!isMaterialError(found), isMaterialError(found) ? found.message : '')
  assert.ok(found.source.length > 0, 'a value always arrives with where it came from')
  assert.ok(found.value > 1e11 && found.value < 3e11, 'steel is around 200 GPa')

  const missing = propertyOf('steel-mild', 'notAProperty')
  assert.ok(isMaterialError(missing))
})

test('comparing a property lists the materials that lack it instead of dropping them', () => {
  const report = compareProperty(['steel-mild', 'abs', 'alumina'], 'youngsModulus')
  assert.ok(!isMaterialError(report), isMaterialError(report) ? report.message : '')
  const named = new Set([...report.ranked.map((r) => r.material), ...report.missing])
  assert.equal(named.size, 3, 'every material asked about is accounted for somewhere')
  assert.ok(
    report.ranked.every((row, i) => i === 0 || (report.ranked[i - 1].value ?? 0) >= (row.value ?? 0)),
    'ranked really is ranked'
  )
})

test('elastic constants need exactly two, and reproduce steel', () => {
  const two = elasticConstants({ youngsModulus: 200e9, poissonRatio: 0.3 })
  assert.ok(!isMaterialError(two), isMaterialError(two) ? two.message : '')
  near(two.shearModulus, 200e9 / (2 * 1.3), 1e6, 'G = E/(2(1+v))')
  near(two.bulkModulus, 200e9 / (3 * (1 - 2 * 0.3)), 1e6, 'K = E/(3(1-2v))')

  const one = elasticConstants({ youngsModulus: 200e9 })
  assert.ok(isMaterialError(one), 'one constant leaves the material undetermined')
})

test('rule of mixtures gives both bounds and they bracket', () => {
  const report = ruleOfMixtures({ fibreModulus: 230e9, matrixModulus: 3.5e9, fibreVolumeFraction: 0.6 })
  assert.ok(!isMaterialError(report), isMaterialError(report) ? report.message : '')
  near(report.alongFibres, 0.6 * 230e9 + 0.4 * 3.5e9, 1e6, 'the stiff direction is the volume-weighted average')
  assert.ok(report.acrossFibres < report.alongFibres, 'across the fibres is always the weaker direction')
  assert.ok(report.acrossFibres > 3.5e9, 'and still stiffer than the matrix alone')
})

// ---------------------------------------------------------------- statics

test('two perpendicular forces through the reference point add without a moment', () => {
  const report = resultant(
    [
      { magnitude: 10, angleDegrees: 0, x: 0, y: 0 },
      { magnitude: 10, angleDegrees: 90, x: 0, y: 0 }
    ],
    [],
    { x: 0, y: 0 }
  )
  assert.ok(!isStaticsError(report), isStaticsError(report) ? report.message : '')
  near(report.x, 10, 1e-9, 'x component')
  near(report.y, 10, 1e-9, 'y component')
  near(report.magnitude, Math.hypot(10, 10), 1e-9, 'magnitude')
  near(report.moment, 0, 1e-9, 'forces through the reference point make no moment about it')
  near(report.angleDegrees ?? 0, 45, 1e-9, 'direction')
})

test('a pure couple has the same moment about every point', () => {
  const report = resultant([], [{ moment: 25 }], { x: 3, y: -7 })
  assert.ok(!isStaticsError(report))
  near(report.moment, 25, 1e-12, 'the couple moment')
  near(report.magnitude, 0, 1e-12, 'a couple has no resultant force')
})

test('a simply supported beam with a central point load splits the load in half', () => {
  const report = beamReactions({
    length: 4,
    supports: [
      { kind: 'pin', position: 0 },
      { kind: 'roller', position: 4 }
    ],
    pointLoads: [{ magnitude: 1000, position: 2 }]
  })
  assert.ok(!isStaticsError(report), isStaticsError(report) ? report.message : '')
  assert.equal(report.determinacy, 'determinate')
  const total = report.reactions.reduce((sum, r) => sum + (r.vertical ?? 0), 0)
  near(total, 1000, 1e-6, 'the reactions carry the whole load')
  near(report.reactions[0].vertical ?? 0, 500, 1e-6, 'a central load splits evenly')
  assert.ok(report.equilibriumVerified, 'equilibrium actually balances')
})

test('an off-centre load loads the nearer support more', () => {
  const report = beamReactions({
    length: 10,
    supports: [
      { kind: 'pin', position: 0 },
      { kind: 'roller', position: 10 }
    ],
    pointLoads: [{ magnitude: 1000, position: 2 }]
  })
  assert.ok(!isStaticsError(report), isStaticsError(report) ? report.message : '')
  near(report.reactions[0].vertical ?? 0, 800, 1e-6, 'the near support takes 8/10')
  near(report.reactions[1].vertical ?? 0, 200, 1e-6, 'the far one takes 2/10')
})

test('an over-supported beam is refused by name rather than guessed at', () => {
  const report = beamReactions({
    length: 4,
    supports: [
      { kind: 'fixed', position: 0 },
      { kind: 'fixed', position: 4 }
    ],
    pointLoads: [{ magnitude: 1000, position: 2 }]
  })
  assert.ok(isStaticsError(report))
  assert.equal(report.error, 'indeterminate')
})

test('a loaded truss balances at every joint', () => {
  const report = solveTruss({
    nodes: [
      { id: 'a', x: 0, y: 0, support: 'pin' },
      { id: 'b', x: 4, y: 0, support: 'roller' },
      { id: 'c', x: 2, y: 2 }
    ],
    members: [
      { id: 'ab', from: 'a', to: 'b' },
      { id: 'ac', from: 'a', to: 'c' },
      { id: 'bc', from: 'b', to: 'c' }
    ],
    loads: [{ node: 'c', x: 0, y: -1000 }]
  })
  assert.ok(!isStaticsError(report), isStaticsError(report) ? report.message : '')
  assert.equal(report.determinacy, 'determinate')
  assert.ok(report.equilibriumVerified, 'every joint balances')
  assert.ok(report.worstJointResidual < 1e-6, 'and the residual proves it')
  const ac = report.members.find((m) => m.id === 'ac')
  assert.ok(ac && ac.force < 0, 'the diagonal under a downward load is in compression')
  const ab = report.members.find((m) => m.id === 'ab')
  assert.ok(ab && ab.force > 0, 'the bottom chord is in tension')
})

test('a truss missing a member is refused as a mechanism', () => {
  const report = solveTruss({
    nodes: [
      { id: 'a', x: 0, y: 0, support: 'pin' },
      { id: 'b', x: 4, y: 0, support: 'roller' },
      { id: 'c', x: 2, y: 2 }
    ],
    members: [
      { id: 'ac', from: 'a', to: 'c' },
      { id: 'bc', from: 'b', to: 'c' }
    ],
    loads: [{ node: 'c', x: 0, y: -1000 }]
  })
  assert.ok(isStaticsError(report))
  assert.ok(report.error === 'mechanism' || report.error === 'indeterminate')
})

test('friction supplies what is needed, not the maximum it could', () => {
  const gentle = blockOnSlope({ mass: 10, slopeDegrees: 5, staticCoefficient: 0.6, kineticCoefficient: 0.5 })
  assert.ok(!isStaticsError(gentle), isStaticsError(gentle) ? gentle.message : '')
  assert.equal(gentle.regime, 'static')
  // Signed against the driving force: friction points back up the slope, so it comes out negative.
  near(Math.abs(gentle.frictionForce), 10 * 9.80665 * Math.sin((5 * Math.PI) / 180), 1e-6, 'friction supplies only what holds it')
  assert.ok(gentle.frictionForce < 0, 'and it points up the slope')
  assert.ok(gentle.maximumStatic > Math.abs(gentle.frictionForce), 'it has plenty in reserve')
  near(gentle.acceleration, 0, 1e-12, 'nothing moves')
})

test('a steep slope with weak friction slides', () => {
  const steep = blockOnSlope({ mass: 10, slopeDegrees: 45, staticCoefficient: 0.3, kineticCoefficient: 0.25 })
  assert.ok(!isStaticsError(steep), isStaticsError(steep) ? steep.message : '')
  assert.equal(steep.regime, 'sliding')
  assert.ok(steep.acceleration > 0, 'it accelerates down the slope')
  near(steep.angleOfRepose ?? 0, (Math.atan(0.3) * 180) / Math.PI, 1e-9, 'the repose angle is atan(mu)')
})

test('belt friction is the capstan equation and ignores the drum radius', () => {
  const half = beltFriction({ slackTension: 100, coefficient: 0.3, wrapAngleDegrees: 180 })
  assert.ok(!isStaticsError(half), isStaticsError(half) ? half.message : '')
  near(half.tightSide, 100 * Math.exp(0.3 * Math.PI), 1e-6, 'T2 = T1 e^(mu*beta)')

  const turns = beltFriction({ slackTension: 100, coefficient: 0.3, wrapTurns: 0.5 })
  assert.ok(!isStaticsError(turns))
  near(turns.tightSide, half.tightSide, 1e-6, 'half a turn is the same as 180 degrees')
})

test('belt friction refuses both ways of giving the wrap at once', () => {
  const both = beltFriction({ slackTension: 100, coefficient: 0.3, wrapAngleDegrees: 180, wrapTurns: 0.5 })
  assert.ok(isStaticsError(both))
})

test('composite area moves the centroid and uses the parallel axis theorem', () => {
  const report = compositeArea([
    { area: 100, x: 0, y: 0, ixx: 1000, iyy: 1000 },
    { area: 100, x: 0, y: 10, ixx: 1000, iyy: 1000 }
  ])
  assert.ok(!isStaticsError(report), isStaticsError(report) ? report.message : '')
  near(report.y, 5, 1e-9, 'two equal areas centre between them')
  near(report.ixx ?? 0, 2 * 1000 + 2 * 100 * 25, 1e-6, 'parallel axis shifts add')
})

test('a composite with a piece missing its second moment refuses to report one', () => {
  const report = compositeArea([
    { area: 100, x: 0, y: 0, ixx: 1000 },
    { area: 100, x: 0, y: 10 }
  ])
  assert.ok(!isStaticsError(report))
  assert.equal(report.ixx, null, 'a partial answer would be a wrong answer')
})

// ---------------------------------------------------------------- beams

test('a rectangle has the second moment everyone knows', () => {
  const report = sectionProperties({ shape: 'rectangle', width: 0.1, height: 0.2 })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  near(report.ixx, (0.1 * 0.2 ** 3) / 12, 1e-12, 'bh^3/12')
  near(report.iyy, (0.2 * 0.1 ** 3) / 12, 1e-12, 'hb^3/12')
  near(report.area, 0.02, 1e-12, 'area')
  assert.ok(report.symmetric, 'a rectangle is symmetric')
  near(report.sectionModulusTop, report.sectionModulusBottom, 1e-12, 'so both moduli match')
})

test('a solid circle reports a polar moment and an open section does not', () => {
  const circle = sectionProperties({ shape: 'circle', diameter: 0.05 })
  assert.ok(!isBeamError(circle), isBeamError(circle) ? circle.message : '')
  near(circle.polarMoment ?? 0, (Math.PI * 0.05 ** 4) / 32, 1e-14, 'pi d^4 / 32')

  const iSection = sectionProperties({
    shape: 'i-section',
    height: 0.2,
    flangeWidth: 0.1,
    flangeThickness: 0.01,
    webThickness: 0.006
  })
  assert.ok(!isBeamError(iSection), isBeamError(iSection) ? iSection.message : '')
  assert.equal(iSection.polarMoment, null, 'an open section warps and has no closed form here')
})

test('a section missing a dimension is refused rather than defaulted', () => {
  const report = sectionProperties({ shape: 'rectangle', width: 0.1 })
  assert.ok(isBeamError(report))
})

test('a simply supported beam under a central load has PL/4 at midspan', () => {
  const section = sectionProperties({ shape: 'rectangle', width: 0.1, height: 0.2 })
  assert.ok(!isBeamError(section))
  const report = analyseBeam({
    kind: 'simply-supported',
    length: 4,
    supportA: 0,
    supportB: 4,
    pointLoads: [{ magnitude: 1000, position: 2 }],
    youngsModulus: 200e9,
    secondMoment: section.ixx,
    stations: 401
  })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  near(Math.abs(report.maxMoment.value), (1000 * 4) / 4, 10, 'PL/4 at midspan')
  near(report.maxMoment.at, 2, 0.02, 'and it happens at midspan')
  const expected = (1000 * 4 ** 3) / (48 * 200e9 * section.ixx)
  near(Math.abs(report.maxDeflection?.value ?? 0), expected, expected * 0.03, 'PL^3/48EI')
  assert.ok(report.integrationResidual < 1e-3, 'the integrated shear closes on the applied load')
})

test('a cantilever with an end load has WL at the root and no deflection without stiffness', () => {
  const report = analyseBeam({
    kind: 'cantilever',
    length: 3,
    pointLoads: [{ magnitude: 500, position: 3 }],
    stations: 301
  })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  const worst = Math.max(Math.abs(report.maxMoment.value), Math.abs(report.minMoment.value))
  near(worst, 500 * 3, 15, 'WL at the fixed end')
  assert.equal(report.maxDeflection, null, 'without E and I there is no deflection to report')
})

test("Mohr's circle on pure shear gives equal and opposite principals", () => {
  const report = mohrsCircle({ sigmaX: 0, sigmaY: 0, tauXY: 50e6 })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  near(report.principal1, 50e6, 1, 'one principal')
  near(report.principal2, -50e6, 1, 'the other')
  near(report.maximumShear, 50e6, 1, 'the radius is the shear')
  near(report.centre, 0, 1e-9, 'pure shear has no mean normal stress')
})

test('the absolute maximum shear uses the out-of-plane zero when both principals share a sign', () => {
  const report = mohrsCircle({ sigmaX: 100e6, sigmaY: 40e6, tauXY: 0 })
  assert.ok(!isBeamError(report))
  near(report.maximumShear, 30e6, 1, 'in plane, half the difference of the two')
  near(report.absoluteMaximumShear, 50e6, 1, 'in three dimensions, half of 100 minus zero')
})

test('failure criteria disagree, and all three are shown', () => {
  const report = checkFailure({ state: { sigmaX: 200e6, sigmaY: -100e6, tauXY: 0 }, strength: 250e6 })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  assert.equal(report.comparison.length, 3, 'all three criteria reported')
  const tresca = report.comparison.find((one) => one.criterion === 'max-shear-stress')
  const vonMises = report.comparison.find((one) => one.criterion === 'distortion-energy')
  assert.ok(tresca && vonMises)
  assert.ok(tresca.effectiveStress >= vonMises.effectiveStress - 1, 'Tresca is the conservative one')
  near(tresca.effectiveStress, 300e6, 1e3, 'the full principal range')
})

test('a long strut buckles and a short one crushes', () => {
  const long = eulerBuckling({
    length: 5,
    youngsModulus: 200e9,
    secondMoment: 1e-8,
    area: 1e-3,
    endCondition: 'pinned-pinned',
    yieldStrength: 250e6
  })
  assert.ok(!isBeamError(long), isBeamError(long) ? long.message : '')
  assert.equal(long.governs, 'buckling')
  near(long.criticalLoad, (Math.PI ** 2 * 200e9 * 1e-8) / 25, 1, 'the Euler load')

  const short = eulerBuckling({
    length: 0.05,
    youngsModulus: 200e9,
    secondMoment: 1e-8,
    area: 1e-3,
    endCondition: 'pinned-pinned',
    yieldStrength: 250e6
  })
  assert.ok(!isBeamError(short), isBeamError(short) ? short.message : '')
  assert.equal(short.governs, 'crushing')
})

test('end conditions change the critical load by their effective length factor', () => {
  const base = { length: 5, youngsModulus: 200e9, secondMoment: 1e-8 }
  const pinned = eulerBuckling({ ...base, endCondition: 'pinned-pinned' })
  const cantilever = eulerBuckling({ ...base, endCondition: 'fixed-free' })
  assert.ok(!isBeamError(pinned) && !isBeamError(cantilever))
  near(cantilever.criticalLoad, pinned.criticalLoad / 4, pinned.criticalLoad * 1e-6, 'a cantilever is a quarter as strong')
})

test('a solid shaft in torsion matches Tr/J and TL/JG', () => {
  const report = shaftTorsion({ torque: 1000, outerDiameter: 0.05, length: 1, shearModulus: 80e9 })
  assert.ok(!isBeamError(report), isBeamError(report) ? report.message : '')
  const j = (Math.PI * 0.05 ** 4) / 32
  near(report.polarMoment, j, 1e-16, 'polar moment')
  near(report.maximumShearStress, (1000 * 0.025) / j, 1e3, 'Tr/J')
  near(report.angleOfTwist, (1000 * 1) / (j * 80e9), 1e-9, 'TL/JG')
})

test('a hollow shaft loses far less strength than it loses weight', () => {
  const solid = shaftTorsion({ torque: 1000, outerDiameter: 0.05 })
  const hollow = shaftTorsion({ torque: 1000, outerDiameter: 0.05, innerDiameter: 0.03 })
  assert.ok(!isBeamError(solid) && !isBeamError(hollow))
  const areaRatio = (0.05 ** 2 - 0.03 ** 2) / 0.05 ** 2
  const stiffnessRatio = hollow.polarMoment / solid.polarMoment
  assert.ok(stiffnessRatio > areaRatio, 'the material near the axis carries almost nothing')
})
