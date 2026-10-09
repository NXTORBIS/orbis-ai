import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COUNTS, SECTIONS, mustFind, search, sections, simulationFor, SIMULATIONS } from './catalogue.ts'
import { advance, isSimulationError, run, startingValues, type Simulation } from './simulation.ts'

/**
 * One test over every simulation in the catalogue.
 *
 * Written so that adding a simulation adds its coverage: nothing here names a simulation except where a specific
 * published number is being checked. A new engine that forgets a readout, declares a control it ignores, or
 * conserves something it does not conserve fails here without anybody adding a test for it.
 */

const ok = <T>(value: T, what: string): Exclude<T, { error: string }> => {
  assert.ok(!isSimulationError(value), `${what}: ${isSimulationError(value) ? `${value.message} ${value.fix}` : ''}`)
  return value as Exclude<T, { error: string }>
}

test('every simulation is well formed', () => {
  const ids = new Set<string>()
  const known = new Set(SECTIONS.map((one) => one.id))
  for (const one of SIMULATIONS) {
    assert.ok(!ids.has(one.id), `two simulations share the id ${one.id}`)
    ids.add(one.id)
    assert.ok(known.has(one.section), `${one.id} is in section "${one.section}", which does not exist`)
    assert.ok(one.name.trim() !== '' && one.about.trim() !== '', `${one.id} does not describe itself`)
    assert.ok(one.controls.length > 0, `${one.id} has nothing to adjust`)
    assert.ok(one.readouts.length > 0, `${one.id} reports nothing`)
    assert.ok(one.limits.length > 0, `${one.id} claims no limits, and every model has some`)

    const keys = new Set<string>()
    for (const control of one.controls) {
      assert.ok(!keys.has(control.key), `${one.id} repeats the control "${control.key}"`)
      keys.add(control.key)
      assert.ok(control.least < control.most, `${one.id}: control "${control.key}" has an empty range`)
      assert.ok(
        control.initial >= control.least && control.initial <= control.most,
        `${one.id}: control "${control.key}" starts outside its own range`
      )
      assert.ok(control.step > 0, `${one.id}: control "${control.key}" has no step`)
      assert.ok(control.about.trim() !== '', `${one.id}: control "${control.key}" is unexplained`)
    }

    const seen = new Set<string>()
    for (const readout of one.readouts) {
      assert.ok(!seen.has(readout.key), `${one.id} repeats the readout "${readout.key}"`)
      seen.add(readout.key)
      assert.ok(readout.label.trim() !== '', `${one.id}: readout "${readout.key}" has no label`)
    }

    if (one.conserves) {
      assert.ok(seen.has(one.conserves.key), `${one.id} conserves "${one.conserves.key}", which it does not report`)
    }
  }
  assert.equal(COUNTS.simulations, SIMULATIONS.length)
  assert.equal(COUNTS.sections, sections().length)
})

test('every simulation runs from its own starting values and reports every readout it declared', () => {
  for (const one of SIMULATIONS) {
    const values = startingValues(one)
    const report = ok(run(one, values, { seconds: 4, dt: one.suggestedStep ?? 0.005 }), one.id)

    assert.ok(report.steps > 0, `${one.id} took no steps`)
    assert.ok(report.times.length > 0, `${one.id} kept no readings`)
    for (const readout of one.readouts) {
      assert.ok(readout.key in report.now, `${one.id} declared the readout "${readout.key}" and did not report it`)
      assert.ok(
        Number.isFinite(report.now[readout.key]),
        `${one.id}: readout "${readout.key}" came back as ${report.now[readout.key]}`
      )
      assert.equal(
        report.history[readout.key].length,
        report.times.length,
        `${one.id}: readout "${readout.key}" has a different number of readings than there are times`
      )
    }
    assert.ok(report.says.trim() !== '', `${one.id} says nothing about its run`)
  }
})

test('a simulation that paints produces shapes inside its own view', () => {
  for (const one of SIMULATIONS) {
    if (!one.paint) continue
    const values = startingValues(one)
    const report = ok(run(one, values, { seconds: 2, dt: one.suggestedStep ?? 0.005 }), one.id)
    assert.ok(report.scene !== null, `${one.id} paints but produced no scene`)
    assert.equal(report.scene.view.length, 4, `${one.id}: the view is not a rectangle`)
    const [, , wide, high] = report.scene.view
    assert.ok(Number.isFinite(wide) && Number.isFinite(high), `${one.id}: the view has no size`)
    assert.ok(report.scene.shapes.length > 0, `${one.id} drew nothing at all`)
    for (const shape of report.scene.shapes) {
      // A NaN coordinate draws nothing and reports no error, so it is the quietest possible way to fail.
      const numbers =
        shape.kind === 'circle' || shape.kind === 'text' || shape.kind === 'rect'
          ? [...shape.at]
          : shape.kind === 'line' || shape.kind === 'arrow'
            ? [...shape.from, ...shape.to]
            : shape.kind === 'path'
              ? [...shape.points]
              : []
      for (const value of numbers) {
        assert.ok(Number.isFinite(value), `${one.id}: a ${shape.kind} has a coordinate of ${value}`)
      }
    }
  }
})

test('what a simulation says it conserves, it conserves', () => {
  let checked = 0
  for (const one of SIMULATIONS) {
    if (!one.conserves) continue
    const values = startingValues(one)
    const report = ok(run(one, values, { seconds: 10, dt: (one.suggestedStep ?? 0.005) / 2 }), one.id)
    assert.ok(report.drift !== null, `${one.id} conserves ${one.conserves.key} and reported no drift`)
    // A good solver at a small step holds this to well under a per cent. More than that is the solver, not
    // physics — and the laboratory says so on screen, which is the point of reporting it.
    assert.ok(
      Math.abs(report.drift.fraction) < 0.02,
      `${one.id}: ${one.conserves.label} drifted ${(report.drift.fraction * 100).toFixed(3)}% in ten seconds`
    )
    checked += 1
  }
  assert.ok(checked > 0, 'no simulation claims to conserve anything, which would be surprising')
})

test('halving the step makes a conserved quantity drift less, not more', () => {
  for (const one of SIMULATIONS) {
    if (!one.conserves) continue
    const values = startingValues(one)
    const step = one.suggestedStep ?? 0.005
    const coarse = ok(run(one, values, { seconds: 6, dt: step }), one.id)
    const fine = ok(run(one, values, { seconds: 6, dt: step / 4 }), one.id)
    assert.ok(coarse.drift !== null && fine.drift !== null)
    const was = Math.abs(coarse.drift.fraction)
    const now = Math.abs(fine.drift.fraction)
    // Allow for a run already at the floor of what double precision can hold.
    assert.ok(
      now <= was + 1e-9 || now < 1e-10,
      `${one.id}: a quarter of the step drifted ${now} against ${was} — the solver is not converging`
    )
  }
})

test('the same values give exactly the same run, every time', () => {
  for (const one of SIMULATIONS) {
    const values = startingValues(one)
    const first = ok(run(one, values, { seconds: 3, dt: one.suggestedStep ?? 0.005 }), one.id)
    const second = ok(run(one, values, { seconds: 3, dt: one.suggestedStep ?? 0.005 }), one.id)
    assert.deepEqual(first.now, second.now, `${one.id} is not repeatable`)
  }
})

test('a run is refused rather than fudged when it cannot be done', () => {
  const one = SIMULATIONS[0] as Simulation
  assert.ok(isSimulationError(run(one, startingValues(one), { seconds: 10, dt: 0 })), 'a zero step')
  assert.ok(isSimulationError(run(one, startingValues(one), { seconds: 10, dt: -1 })), 'a negative step')
  assert.ok(isSimulationError(run(one, startingValues(one), { seconds: 0, dt: 0.01 })), 'no time to run for')
  assert.ok(isSimulationError(run(one, startingValues(one), { seconds: 1e9, dt: 1e-9 })), 'more steps than it runs')
  assert.ok(isSimulationError(run(one, startingValues(one), { seconds: 10, dt: Number.NaN })), 'a step that is not a number')
})

test('the catalogue finds things, and refuses helpfully when it cannot', () => {
  for (const one of SIMULATIONS) assert.equal(simulationFor(one.id), one)
  assert.equal(simulationFor('nothing-like-this'), null)

  const refused = mustFind('nothing-like-this')
  assert.ok(isSimulationError(refused))
  assert.ok(refused.fix.includes(SIMULATIONS[0].id), 'the refusal should name something that does exist')
  assert.ok(!isSimulationError(mustFind(SIMULATIONS[0].id)))

  assert.equal(search('').length, SIMULATIONS.length)
  assert.equal(search('definitely not a simulation').length, 0)
  for (const one of SIMULATIONS) {
    assert.ok(search(one.id).some((two) => two.id === one.id), `search cannot find ${one.id} by its own id`)
  }
})

test('every listed section has something that runs, and nothing is hidden from the listing', () => {
  const shown = sections().flatMap((one) => one.simulations)
  assert.equal(shown.length, SIMULATIONS.length, 'a simulation sits in a section the listing leaves out')
  for (const group of sections()) assert.ok(group.simulations.length > 0, `${group.section.id} is listed and empty`)
})

test('the three solvers all integrate a known problem, and the better ones do better', () => {
  // Simple harmonic motion: x'' = −x, started at x = 1, v = 0. After 2π the exact answer is back at x = 1.
  const derivative = (state: readonly number[]): number[] => [state[1], -state[0]]
  // The step has to divide the period exactly. Rounding the step count instead leaves the run short of 2π, and
  // stopping 0.0032 early is itself an error of 5×10⁻⁶ — which would be blamed on the solver.
  const circuit = (solver: 'euler' | 'rk4' | 'verlet', steps: number): number => {
    const dt = (2 * Math.PI) / steps
    let state = [1, 0]
    for (let one = 0; one < steps; one += 1) state = advance(state, derivative, dt, solver)
    return Math.abs(state[0] - 1)
  }
  const euler = circuit('euler', 629)
  const rk4 = circuit('rk4', 629)
  const verlet = circuit('verlet', 629)
  assert.ok(rk4 < euler, `rk4 (${rk4}) should beat euler (${euler})`)
  assert.ok(verlet < euler, `verlet (${verlet}) should beat euler (${euler})`)
  assert.ok(rk4 < 1e-8, `rk4 should be very accurate here, and was off by ${rk4}`)

  // Fourth order means halving the step is about sixteen times better. Checked as a measured ratio, because
  // "it got smaller" would also pass for a first-order method quietly mislabelled.
  const coarse = circuit('rk4', 200)
  const fine = circuit('rk4', 400)
  const ratio = coarse / fine
  assert.ok(ratio > 8, `rk4 should gain about 16x from halving the step, and gained ${ratio.toFixed(1)}x`)
})
