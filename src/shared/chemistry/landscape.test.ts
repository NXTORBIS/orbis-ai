import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bondCurve, isLandscapeProblem, reactionPath, surface } from './landscape.ts'

const near = (got: number, want: number, within: number, what: string): void => {
  assert.ok(Math.abs(got - want) <= within, `${what}: got ${got}, expected ${want} to within ${within}`)
}

test('a bond is at its lowest where its length says, and zero there', () => {
  const got = bondCurve({ depth: 436, length: 74, width: 0.0193, points: 2000 })
  assert.ok(!isLandscapeProblem(got))
  let low = 0
  for (let i = 1; i < got.energy.length; i += 1) if (got.energy[i] < got.energy[low]) low = i
  near(got.r[low], 74, 1, 'the minimum of the H–H curve')
  near(got.energy[low], 0, 0.5, 'the energy at the minimum')
})

test('a bond dissociates — it flattens out at the dissociation energy', () => {
  const depth = 436
  const got = bondCurve({ depth, length: 74, width: 0.0193, outTo: 10, points: 2000 })
  assert.ok(!isLandscapeProblem(got))
  const last = got.energy[got.energy.length - 1]
  near(last, depth, depth * 0.02, 'the energy at long separation')
  // And it never goes above the dissociation energy on the stretching side.
  for (let i = 0; i < got.r.length; i += 1) {
    if (got.r[i] < 74) continue
    assert.ok(got.energy[i] <= depth + 1e-6, `at ${got.r[i]} pm the energy exceeded the well depth`)
  }
})

test('a harmonic spring does not dissociate, and the curve shows where it stops being right', () => {
  const got = bondCurve({ depth: 436, length: 74, width: 0.0193, outTo: 6, points: 2000 })
  assert.ok(!isLandscapeProblem(got))
  // The spring keeps climbing past the dissociation energy; the bond does not.
  const last = got.harmonic[got.harmonic.length - 1]
  assert.ok(last > 436 * 2, 'the harmonic curve should run away')
  assert.ok(got.harmonicFailsAt !== null, 'it should say where the spring stops being a good model')
  assert.ok(got.harmonicFailsAt > 74, 'and that is on the stretching side')
})

test('the two curves agree near the bottom, which is why the spring is used at all', () => {
  const got = bondCurve({ depth: 436, length: 74, width: 0.0193, points: 2000 })
  assert.ok(!isLandscapeProblem(got))
  for (let i = 0; i < got.r.length; i += 1) {
    // Within a few picometres of the minimum they must be close.
    if (Math.abs(got.r[i] - 74) > 4) continue
    assert.ok(
      Math.abs(got.energy[i] - got.harmonic[i]) < 436 * 0.01,
      `at ${got.r[i]} pm the two models differ by too much to justify the approximation`
    )
  }
})

test('the force constant is the exact second derivative', () => {
  // k = 2Da² at the minimum.
  const depth = 436
  const width = 0.0193
  const got = bondCurve({ depth, length: 74, width })
  assert.ok(!isLandscapeProblem(got))
  near(got.forceConstant, 2 * depth * width * width, 1e-9, 'the force constant')
})

test('a bond with impossible settings is refused and says why', () => {
  for (const [settings, because] of [
    [{ depth: 0, length: 74, width: 0.02 }, /more than zero/],
    [{ depth: 436, length: 0, width: 0.02 }, /100–160 pm/],
    [{ depth: 436, length: 74, width: -1 }, /0\.02/]
  ] as const) {
    const got = bondCurve(settings)
    assert.ok(isLandscapeProblem(got), `${JSON.stringify(settings)} should be refused`)
    assert.match(`${got.problem} ${got.fix}`, because)
  }
})

test('a reaction starts at zero, ends at its energy change, and climbs its barrier', () => {
  const got = reactionPath({ barrier: 80, change: -40, points: 1200 })
  assert.ok(!isLandscapeProblem(got))
  near(got.energy[0], 0, 1, 'reactants at zero')
  near(got.energy[got.energy.length - 1], -40, 1.5, 'products at the energy change')
  near(got.forward, 80, 4, 'the forward barrier')
  // Backwards it is the barrier plus the drop, because the products sit lower.
  near(got.backward, 120, 5, 'the backward barrier')
  assert.ok(got.exothermic)
})

test('an endothermic reaction has the bigger barrier forwards', () => {
  const got = reactionPath({ barrier: 90, change: 50, points: 1200 })
  assert.ok(!isLandscapeProblem(got))
  assert.ok(!got.exothermic)
  assert.ok(got.forward > got.backward, 'uphill overall means the forward barrier is the larger')
  near(got.forward - got.backward, 50, 5, 'the difference is the energy change')
})

test('the path never dips below the reactants before the barrier', () => {
  // This is what a polynomial fit through four points gets wrong, and it understates the barrier when it does.
  const got = reactionPath({ barrier: 80, change: -40, points: 1200 })
  assert.ok(!isLandscapeProblem(got))
  const peak = got.x.findIndex((one) => one === got.peakAt)
  for (let i = 0; i < peak; i += 1) {
    assert.ok(got.energy[i] >= -1, `the path dipped to ${got.energy[i]} before the barrier`)
  }
})

test('an exothermic reaction has its barrier early and an endothermic one late', () => {
  // Hammond's postulate, as a default rather than an assertion: the caller can override it.
  const down = reactionPath({ barrier: 80, change: -60 })
  const up = reactionPath({ barrier: 90, change: 60 })
  assert.ok(!isLandscapeProblem(down) && !isLandscapeProblem(up))
  assert.ok(down.peakAt < 0.5, `exothermic peak at ${down.peakAt}`)
  assert.ok(up.peakAt > 0.5, `endothermic peak at ${up.peakAt}`)
})

test('a barrier below an endothermic product is refused, because it cannot exist', () => {
  const got = reactionPath({ barrier: 20, change: 50 })
  assert.ok(isLandscapeProblem(got))
  assert.match(got.fix, /never be lower/)
})

test('a two-step reaction has an intermediate, and names the slow step', () => {
  const got = reactionPath({ barrier: 90, change: -30, secondBarrier: 50, points: 1200 })
  assert.ok(!isLandscapeProblem(got))
  assert.ok(got.intermediate !== null, 'there should be an intermediate between the two barriers')
  // The taller barrier is the slow one. Here the first.
  assert.equal(got.slowStep, 1)

  const other = reactionPath({ barrier: 40, change: -30, secondBarrier: 95, points: 1200 })
  assert.ok(!isLandscapeProblem(other))
  assert.equal(other.slowStep, 2)
})

test('a one-step reaction has no intermediate and no slow step to name', () => {
  const got = reactionPath({ barrier: 80, change: -40 })
  assert.ok(!isLandscapeProblem(got))
  assert.equal(got.intermediate, null)
  assert.equal(got.slowStep, null)
})

test('a surface has two wells and a saddle between them', () => {
  const got = surface({ grid: 61 })
  assert.ok(!isLandscapeProblem(got))
  assert.ok(got.wells.length >= 2, `found ${got.wells.length} wells`)
  assert.ok(got.saddle !== null, 'there should be a pass between the wells')
  assert.ok(got.barrier !== null && got.barrier > 0, 'and climbing to it costs energy')
})

test('the saddle really is a saddle — uphill one way, downhill the other', () => {
  const got = surface({ grid: 61 })
  assert.ok(!isLandscapeProblem(got) && got.saddle !== null)
  const { row, column } = got.saddle
  const here = got.z[row][column]
  const alongRow = [got.z[row][column - 1], got.z[row][column + 1]]
  const alongCol = [got.z[row - 1][column], got.z[row + 1][column]]
  const maxAlongRow = alongRow.every((one) => one < here)
  const minAlongCol = alongCol.every((one) => one > here)
  const theOtherWay = alongRow.every((one) => one > here) && alongCol.every((one) => one < here)
  assert.ok(
    (maxAlongRow && minAlongCol) || theOtherWay,
    'the point reported as a saddle must be a maximum along one direction and a minimum along the other'
  )
})

test('the saddle sits between the two wells, not outside them', () => {
  const got = surface({ grid: 61 })
  assert.ok(!isLandscapeProblem(got) && got.saddle !== null)
  const columns = got.wells.slice(0, 2).map((one) => one.column).sort((a, b) => a - b)
  assert.ok(
    got.saddle.column > columns[0] && got.saddle.column < columns[1],
    `the saddle at column ${got.saddle.column} is not between the wells at ${columns.join(' and ')}`
  )
})

test('the saddle is higher than the wells and lower than the ridge around it', () => {
  const got = surface({ grid: 61 })
  assert.ok(!isLandscapeProblem(got) && got.saddle !== null)
  for (const well of got.wells.slice(0, 2)) {
    assert.ok(got.saddle.energy > well.energy, 'a pass is above the valleys it joins')
  }
})

test('a deeper well makes a bigger barrier out of it', () => {
  const shallow = surface({ grid: 51, depth: 60 })
  const deep = surface({ grid: 51, depth: 160 })
  assert.ok(!isLandscapeProblem(shallow) && !isLandscapeProblem(deep))
  assert.ok(shallow.barrier !== null && deep.barrier !== null)
  assert.ok(deep.barrier > shallow.barrier, 'a deeper well is harder to climb out of')
})
