import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, startingValues, isSimulationError, type Simulation, type Values } from './simulation.ts'
import { wavepacket, harmonicOscillator, sternGerlach } from './quantum.ts'
import { speedDistribution, isingModel, heatFlow } from './matter.ts'
import { nBody, decayChain, solverComparison } from './universe.ts'
import { stringWave, interference, lensRays, polarisation } from './waves.ts'
import { rlcCircuit, rcCharging, gaussLaw } from './circuits.ts'

/**
 * These check the physics against numbers from outside, not against itself.
 *
 * A simulation can be perfectly self-consistent and perfectly wrong. Each of these pins one result to something
 * published or exactly derivable — Onsager's magnetisation, the analytic tunnelling coefficient, the Bateman
 * equation, the convergence order of each solver — so an engine that quietly starts producing different physics
 * fails here rather than merely looking different.
 *
 * Two of them exist because a bug got through everything else:
 *   - tunnelling once rose with barrier height, because the transform's periodic box wrapped the reflected part
 *     round and counted it as transmitted;
 *   - the decay chain ran 19% fast at every seed, because a normal approximation was sampling a distribution
 *     whose mass sits against zero.
 */

const at = (simulation: Simulation, values: Values, seconds: number, dt: number): Record<string, number> => {
  const report = run(simulation, { ...startingValues(simulation), ...values }, { seconds, dt })
  assert.ok(!isSimulationError(report), `${simulation.id}: ${isSimulationError(report) ? report.message : ''}`)
  return report.now as Record<string, number>
}

const near = (got: number, want: number, tolerance: number, what: string): void => {
  assert.ok(
    Math.abs(got - want) <= tolerance,
    `${what}: got ${got}, expected ${want} (off by ${Math.abs(got - want)}, allowed ${tolerance})`
  )
}

test('tunnelling matches the analytic transmission, and rises as the barrier falls', () => {
  const got: number[] = []
  for (const barrier of [0.6, 0.8, 1.0]) {
    const now = at(wavepacket, { energy: 0.5, barrier, thickness: 0.6, packetWidth: 4, slowdown: 2e13 }, 14, 0.002)
    assert.equal(now.settled, 1, `barrier ${barrier}: the packet has not finished crossing, so the split means nothing yet`)
    // Within a factor of two of the single-energy formula. The packet carries a spread of energies, so exact
    // agreement would actually be the suspicious result.
    assert.ok(
      now.transmitted > now.predicted / 2 && now.transmitted < now.predicted * 2,
      `barrier ${barrier}: got through ${now.transmitted}, analytic ${now.predicted}`
    )
    got.push(now.transmitted)
  }
  // The direction is the thing a wrapped box got backwards: a taller barrier must let LESS through.
  assert.ok(got[0] > got[1] && got[1] > got[2], `transmission must fall as the barrier rises, got ${got.join(' > ')}`)
})

test('the wavefunction keeps all of its probability', () => {
  for (const barrier of [0, 1, 3]) {
    const now = at(wavepacket, { energy: 0.5, barrier, thickness: 1, slowdown: 2e13 }, 8, 0.002)
    near(now.norm, 1, 1e-6, `barrier ${barrier}: probability`)
  }
})

test('the oscillator ground state leaks past the classical turning point by the published amount', () => {
  const now = at(harmonicOscillator, { showLevel: 0, levels: 3 }, 1, 0.02)
  // The exact value is erfc(1) = 0.15730. A classical particle of that energy could never be out there at all.
  near(now.outside, 0.1573, 0.002, 'ground state beyond the turning point')
  // Every level exactly ħω above the last, and the ground state exactly half of that.
  near(now.zeroPoint / now.spacing, 0.5, 1e-9, 'zero-point energy over spacing')
})

test('spin measurement follows cos squared of half the angle', () => {
  for (const [angle, want] of [[0, 1], [60, 0.75], [90, 0.5], [120, 0.25], [180, 0]] as const) {
    const now = at(sternGerlach, { angle, rate: 400, seed: 7, thirdMagnet: 0 }, 40, 0.01)
    assert.ok(now.runs > 10000, 'not enough spins to say anything')
    near(now.fraction, want, 0.02, `${angle}°`)
  }
})

test('three filters pass light where two pass none', () => {
  const crossed = at(polarisation, { filters: 2, lastAngle: 90, startPolarised: 0 }, 1, 0.02)
  near(crossed.out, 0, 1e-12, 'two crossed filters')
  const three = at(polarisation, { filters: 3, lastAngle: 90, startPolarised: 0 }, 1, 0.02)
  // Half at the first, then cos²45° twice: 0.5 × 0.5 × 0.5 = 0.125.
  near(three.out, 0.125, 1e-9, 'three filters at 45° steps')
  assert.ok(three.out > crossed.out, 'adding a filter should let MORE through here, which is the whole point')
})

test('the gas settles to the two-dimensional Maxwell distribution', () => {
  const now = at(speedDistribution, { particles: 500, speed: 400, seed: 1, sameStart: 1, slowdown: 1000 }, 12, 0.002)
  assert.ok(now.collisions > 5000, `only ${now.collisions} collisions — not thermalised`)
  // In two dimensions, rms/mean = √(4/π) = 1.1284. Starting every particle at one speed, this is 1 exactly.
  near(now.ratio, Math.sqrt(4 / Math.PI), 0.03, 'rms over mean')
  // Elastic collisions, so the energy must not move at all.
  near(now.rms, 400, 1e-6, 'rms speed, which elastic collisions cannot change')
})

test('the Ising model finds its own transition, at the temperature Onsager derived', () => {
  const critical = 2 / Math.log(1 + Math.SQRT2)
  near(critical, 2.269185, 1e-5, "Onsager's temperature")

  const cold = at(isingModel, { temperature: 1.5, sweeps: 80, seed: 3, size: 48 }, 20, 0.01)
  const hot = at(isingModel, { temperature: 3.5, sweeps: 80, seed: 3, size: 48 }, 20, 0.01)
  assert.ok(cold.absMagnetisation > 0.95, `below the transition it should be ordered, got ${cold.absMagnetisation}`)
  assert.ok(hot.absMagnetisation < 0.15, `above it should be disordered, got ${hot.absMagnetisation}`)

  // Onsager's exact magnetisation at T = 2: (1 − sinh(2/T)^-4)^(1/8).
  const exact = (1 - Math.sinh(2 / 2) ** -4) ** 0.125
  const warm = at(isingModel, { temperature: 2, sweeps: 80, seed: 3, size: 48 }, 20, 0.01)
  near(warm.absMagnetisation, exact, 0.03, 'magnetisation at T = 2 against Onsager')
})

test('heat settles towards a straight line, and never past the ends', () => {
  // Settling takes L²/απ². At 200 mm²/s over 10 cm that is about five seconds, so sixty is comfortably settled —
  // running for less than the settling time and calling the result wrong is a test fault, not a physics one.
  const now = at(heatFlow, { leftEnd: 100, rightEnd: 0, startAt: 20, insulated: 0, diffusivity: 200, length: 10 }, 60, 0.0005)
  near(now.middle, 50, 0.5, 'the middle of a settled bar')
  assert.ok(now.stability <= 0.5, `the scheme is unstable at ${now.stability}`)
  // Nothing is generated inside, so nothing can get hotter than the hot end or colder than the cold one.
  assert.ok(now.hottest <= 100.001 && now.coldest >= -0.001, 'temperature went outside the two ends')
})

test('an insulated end lets the whole bar reach the held temperature', () => {
  // An insulated end relaxes through the quarter-wave mode, so it takes four times as long as a bar held at both
  // ends. Five centimetres puts that back inside a short run.
  // Fewer points as well: a short bar on a fine grid pushes the stability number past the half this scheme
  // allows, and then it does not drift, it explodes. The next test checks that it says so rather than pretending.
  const now = at(heatFlow, { leftEnd: 100, startAt: 20, insulated: 1, diffusivity: 200, length: 5, points: 60 }, 60, 0.0005)
  near(now.coldest, 100, 1, 'the far end of an insulated bar')
})

test('the figure-of-eight holds its energy, and says when it stops being trustworthy', () => {
  const now = at(nBody, { bodies: 3, arrangement: 0, seed: 1 }, 20, 0.002)
  assert.ok(Math.abs(now.drift) < 1e-4, `energy drifted ${now.drift}`)
  assert.equal(now.trustworthy, 1)

  // A step ten times longer must drift more. Verlet is good, not magic.
  const coarse = at(nBody, { bodies: 3, arrangement: 0, seed: 1 }, 20, 0.02)
  assert.ok(Math.abs(coarse.drift) > Math.abs(now.drift), 'a longer step should drift more')
})

test('the decay chain follows the exponential, and the daughter peaks where Bateman says', () => {
  // Averaged over seeds: a single run is genuinely noisy, and demanding one run hit the mean would be wrong.
  let total = 0
  let expected = 0
  for (let seed = 1; seed <= 8; seed += 1) {
    const now = at(decayChain, { seed, parents: 20000, parentHalfLife: 5, daughterHalfLife: 15 }, 20, 0.002)
    total += now.parents
    expected = now.expectedParents
  }
  const mean = total / 8
  // Four half-lives in: 1/16 of 20,000. The spread of the mean of eight runs is about √1250/√8 ≈ 12.
  near(mean, expected, 60, 'parents left, averaged over eight seeds')

  const one = at(decayChain, { seed: 1, parentHalfLife: 5, daughterHalfLife: 15 }, 1, 0.002)
  const lp = Math.LN2 / 5
  const ld = Math.LN2 / 15
  near(one.peakDaughterAt, Math.log(ld / lp) / (ld - lp), 1e-9, 'Bateman peak')
})

test('each solver converges at the order it is supposed to', () => {
  const errorsAt = (step: number): Record<string, number> =>
    at(solverComparison, { step, periods: 10, showExact: 1 }, 0.5, 0.02)

  const coarse = errorsAt(0.1)
  const fine = errorsAt(0.05)

  // Euler is first order, so halving the step should roughly halve the error — and it is enormous either way.
  assert.ok(coarse.eulerError > 1, `Euler should be badly wrong after ten periods, got ${coarse.eulerError}`)
  // Verlet is second order: about four times better.
  assert.ok(fine.verletError < coarse.verletError / 2.5, `Verlet ${coarse.verletError} -> ${fine.verletError}`)
  // Runge-Kutta is fourth order: about sixteen times better, and far smaller to begin with.
  assert.ok(fine.rk4Error < coarse.rk4Error / 8, `rk4 ${coarse.rk4Error} -> ${fine.rk4Error}`)
  assert.ok(coarse.rk4Error < coarse.verletError, 'rk4 should beat Verlet on accuracy')
  assert.ok(coarse.verletError < coarse.eulerError, 'Verlet should beat Euler by a long way')
})

test('a string mode rings at n·v/2L and holds its nodes still', () => {
  for (const mode of [1, 2, 3, 5]) {
    const now = at(stringWave, { shape: 2, mode, speed: 5, length: 4, damping: 0, points: 240 }, 2, 0.0005)
    near(now.modeFrequency, (mode * 5) / (2 * 4), 1e-9, `mode ${mode} frequency`)
    assert.ok(now.courant < 1, `the scheme is unstable at Courant ${now.courant}`)
    // The height right now swings through zero twice a cycle, so it is the tallest ever reached that must hold.
    assert.ok(now.biggest > 0.95 && now.biggest < 1.05, `mode ${mode} should hold its amplitude, got ${now.biggest}`)
    assert.ok(now.peak <= now.biggest + 1e-9, 'the height now cannot exceed the tallest ever')
  }
})

test('fringe spacing is λD/d, and a wider slit narrows the envelope', () => {
  const now = at(interference, { slits: 2, separation: 20, width: 4, wavelength: 550, distance: 1, screenWidth: 0.06 }, 0.1, 0.01)
  near(now.fringeSpacing, ((550e-9 * 1) / 20e-6) * 1000, 1e-9, 'fringe spacing')
  const wider = at(interference, { slits: 2, separation: 20, width: 12, wavelength: 550, distance: 1, screenWidth: 0.06 }, 0.1, 0.01)
  assert.ok(wider.firstMinimum < now.firstMinimum, 'a wider slit should diffract less')
  // When the separation is a whole multiple of the width, that order lands on a diffraction zero and is simply
  // not there. At d/a = 2 it is the second; at 20/12 it is no order at all, and the readout must say so.
  const missing = at(interference, { slits: 2, separation: 20, width: 10, wavelength: 550, distance: 1, screenWidth: 0.06 }, 0.1, 0.01)
  assert.equal(missing.missingOrder, 2, 'd/a = 2, so the second order goes missing')
  assert.equal(wider.missingOrder, 0, 'd/a = 1.67 is not a whole number, so no order goes missing')
})

test('the lens equation puts the image where it belongs, and goes virtual inside the focus', () => {
  const real = at(lensRays, { kind: 0, focal: 10, objectAt: 15, objectHeight: 3 }, 0.1, 0.01)
  near(real.imageAt, 30, 1e-9, 'image distance for u = 15, f = 10')
  near(real.magnification, -2, 1e-9, 'magnification')
  assert.equal(real.real, 1)
  assert.equal(real.upright, 0)

  const virtual = at(lensRays, { kind: 0, focal: 10, objectAt: 5, objectHeight: 3 }, 0.1, 0.01)
  near(virtual.imageAt, -10, 1e-9, 'inside the focus the image is virtual')
  near(virtual.magnification, 2, 1e-9, 'and upright and magnified — a magnifying glass')
  assert.equal(virtual.real, 0)
  assert.equal(virtual.upright, 1)
})

test('an RLC circuit rings below its critical resistance and creeps above it', () => {
  const ringing = at(rlcCircuit, { resistance: 5, inductance: 100, capacitance: 10, voltage: 10, startCharge: 0, window: 0.05 }, 0.4, 0.00001)
  assert.ok(ringing.swings > 3, `it should ring, and crossed zero only ${ringing.swings} times`)
  near(ringing.naturalFrequency, 1 / (2 * Math.PI * Math.sqrt(0.1 * 1e-5)), 1e-6, 'natural frequency')
  near(ringing.criticalResistance, 2 * Math.sqrt(0.1 / 1e-5), 1e-6, 'critical resistance')

  const creeping = at(rlcCircuit, { resistance: 400, inductance: 100, capacitance: 10, voltage: 10, startCharge: 0, window: 0.05 }, 0.4, 0.00001)
  assert.equal(creeping.swings, 0, 'overdamped means it never crosses zero at all')
  near(creeping.voltageNow, 10, 0.2, 'and it still settles at the supply')
})

test('a capacitor is 63.2% charged after one time constant', () => {
  const tau = 10e3 * 100e-6 // 1 second
  const now = at(rcCharging, { resistance: 10, capacitance: 100, voltage: 5, discharging: 0 }, tau, 0.0005)
  near(now.fraction, 0.6321, 0.002, 'fraction after one time constant')
  near(now.timeConstant, tau, 1e-12, 'time constant')

  const five = at(rcCharging, { resistance: 10, capacitance: 100, voltage: 5, discharging: 0 }, tau * 5, 0.0005)
  near(five.fraction, 0.9933, 0.002, 'after five time constants')
})

test("Gauss's law: the flux depends on what is inside and nothing else", () => {
  const alone = at(gaussLaw, { charge: 5, outside: 0, radius: 3, samples: 1500 }, 0.1, 0.05)
  near(alone.off, 0, 0.5, 'flux against the law')

  // The radius must make no difference whatsoever.
  const bigger = at(gaussLaw, { charge: 5, outside: 0, radius: 12, samples: 1500 }, 0.1, 0.05)
  near(bigger.flux, alone.flux, Math.abs(alone.flux) * 0.01, 'flux is unchanged by the radius')

  // A charge outside changes the field at every point and contributes exactly nothing to the total.
  const withOutside = at(gaussLaw, { charge: 5, outside: 15, outsideAt: 8, radius: 3, samples: 1500 }, 0.1, 0.05)
  near(withOutside.flux, alone.flux, Math.abs(alone.flux) * 0.02, 'a charge outside adds no flux')
})

test('an unstable choice of step is refused, not quietly drawn', () => {
  // α·dt/dx² above a half and the explicit scheme explodes within a few steps. A laboratory that drew the result
  // anyway would be showing arithmetic and calling it heat.
  const report = run(
    heatFlow,
    { ...startingValues(heatFlow), diffusivity: 200, length: 5, points: 160 },
    { seconds: 10, dt: 0.0005 }
  )
  assert.ok(isSimulationError(report), 'an unstable grid should be refused')
  assert.match(report.message, /finite/i)

  // And the same bar on a grid coarse enough is fine, so the guard is not simply refusing everything.
  const fine = at(heatFlow, { diffusivity: 200, length: 5, points: 60 }, 10, 0.0005)
  assert.ok(fine.stability <= 0.5, `stability ${fine.stability}`)
})
