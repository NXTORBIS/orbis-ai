/**
 * The biology door: what a Page may ask for, what it gets back, and what it is refused.
 *
 * These tests go through `runBiologyOperation` rather than calling the engines directly, because the door is where
 * untrusted input is read and where a mistyped argument has to become a refusal rather than a wrong answer.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { BIOLOGY_CAPABILITY, runBiologyOperation } from './biologyEngines.ts'
import { BadInput } from './engines.ts'
import { CAPABILITIES } from '../../shared/pages/capabilities.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runBiologyOperation(operation, input) as Record<string, unknown>

const good = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, true, `${operation} came back not-ok: ${JSON.stringify(out).slice(0, 300)}`)
  return out
}

const refused = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, false, `${operation} was expected to refuse and did not`)
  return out
}

const rejects = (operation: string, input: Record<string, unknown>, pattern: RegExp): void => {
  assert.throws(() => run(operation, input), (error: unknown) => {
    assert.ok(error instanceof BadInput, `expected BadInput, got ${String(error)}`)
    assert.match((error as Error).message, pattern)
    return true
  })
}

describe('the capability map', () => {
  it('needs exactly one capability, and it exists', () => {
    const needed = new Set(Object.values(BIOLOGY_CAPABILITY))
    assert.deepEqual([...needed], ['computation.biology'])
    assert.ok(Object.prototype.hasOwnProperty.call(CAPABILITIES, 'computation.biology'))
  })

  it('answers every operation it advertises', () => {
    for (const operation of Object.keys(BIOLOGY_CAPABILITY)) {
      // An operation that needs arguments throws BadInput; one that needs none returns. Either proves it is
      // reachable. What must not happen is "not a biology operation".
      try {
        run(operation, {})
      } catch (error) {
        assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput`)
        assert.doesNotMatch((error as Error).message, /is not a biology operation/, `${operation} is advertised but not handled`)
      }
    }
  })

  it('refuses an operation it does not advertise', () => {
    rejects('dna.sequence-the-genome', {}, /not a biology operation/)
  })

  it('reaches no clock and no randomness', () => {
    const source = readFileSync(new URL('./biologyEngines.ts', import.meta.url), 'utf8')
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(body, /Date\.now|new Date|Math\.random/)
  })
})

describe('sequences through the door', () => {
  it('reads a sequence', () => {
    const out = good('dna.read', { sequence: 'GGCC' })
    assert.equal(out.gcContent, 1)
    assert.equal(out.reverseComplement, 'GGCC')
  })

  it('passes the engine refusal through rather than throwing', () => {
    const out = refused('dna.read', { sequence: 'ATGU' })
    assert.match(out.message as string, /neither DNA nor RNA/)
  })

  it('refuses a sequence that is not text', () => {
    rejects('dna.read', { sequence: 42 }, /sequence/)
  })

  it('refuses a sequence longer than the cap', () => {
    rejects('dna.read', { sequence: 'A'.repeat(200_001) }, /sequence/)
  })

  it('translates in a named frame', () => {
    const out = good('dna.translate', { sequence: 'ATGGCC', frame: 1 })
    assert.equal(out.protein, 'MA')
  })

  it('reports the other five frames', () => {
    const out = good('dna.translate', { sequence: 'ATGGCCATTGTA' })
    assert.equal((out.otherFrames as unknown[]).length, 5)
  })

  it('refuses a frame outside the six', () => {
    const out = refused('dna.translate', { sequence: 'ATGGCC', frame: 9 })
    assert.match(out.message as string, /six reading frames/)
  })

  it('serves the codon table with its source', () => {
    const out = good('dna.codon-table')
    assert.equal(Object.keys(out.table as object).length, 64)
    assert.match(out.source as string, /NCBI translation table 1/)
  })

  it('serves the amino acid table', () => {
    const out = good('dna.amino-acids')
    assert.ok(Object.keys(out.aminoAcids as object).length >= 21)
  })

  it('refuses a kind that is not dna or rna', () => {
    rejects('dna.read', { sequence: 'ATGC', kind: 'protein' }, /not one of/)
  })
})

describe('inheritance through the door', () => {
  it('runs a monohybrid cross', () => {
    const out = good('inherit.cross', { first: 'Aa', second: 'Aa' })
    assert.equal(out.phenotypeRatio, '3:1')
  })

  it('honours the incomplete-dominance flag', () => {
    const out = good('inherit.cross', { first: 'Aa', second: 'Aa', incompleteDominance: true })
    assert.equal((out.phenotypes as unknown[]).length, 3)
  })

  it('refuses a flag that is not a boolean', () => {
    rejects('inherit.cross', { first: 'Aa', second: 'Aa', codominance: 'yes' }, /codominance/)
  })

  it('takes a recessive frequency', () => {
    const out = good('inherit.population', { recessiveFrequency: 0.2 })
    assert.ok(Math.abs((out.dominantFrequency as number) - 0.8) < 1e-12)
  })

  it('takes three observed counts instead', () => {
    const out = good('inherit.population', {
      observedHomozygousDominant: 640,
      observedHeterozygous: 320,
      observedHomozygousRecessive: 40
    })
    assert.equal(out.atEquilibrium, true)
  })

  it('refuses with none of the three routes', () => {
    const out = refused('inherit.population', {})
    assert.match(out.message as string, /recessive allele frequency/)
  })

  it('computes a map distance', () => {
    const out = good('inherit.linkage', {
      parentalOne: 450,
      parentalTwo: 450,
      recombinantOne: 50,
      recombinantTwo: 50
    })
    assert.ok(Math.abs((out.mapDistance as number) - 10) < 1e-9)
  })

  it('refuses a linkage count that is missing', () => {
    rejects('inherit.linkage', { parentalOne: 450, parentalTwo: 450, recombinantOne: 50 }, /recombinantTwo/)
  })
})

describe('enzymes and proteins through the door', () => {
  const points = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].map((substrate) => ({
    substrate,
    rate: (100 * substrate) / (10 + substrate)
  }))

  it('fits a kinetic series', () => {
    const out = good('enzyme.kinetics', { points })
    assert.ok(Math.abs((out.vmax as number) - 100) < 0.01)
    assert.ok(Math.abs((out.km as number) - 10) < 0.01)
  })

  it('refuses a point list that is not a list', () => {
    rejects('enzyme.kinetics', { points: 'lots' }, /points/)
  })

  it('refuses a point missing its rate', () => {
    rejects('enzyme.kinetics', { points: [{ substrate: 1 }] }, /rate/)
  })

  it('identifies an inhibition type', () => {
    const inhibited = [0.5, 1, 2, 5, 10, 20, 50, 100, 200].map((substrate) => ({
      substrate,
      rate: (100 * substrate) / (30 + substrate)
    }))
    const out = good('enzyme.inhibition', { control: points, inhibited })
    assert.equal(out.type, 'competitive')
  })

  it('fits a binding curve', () => {
    const curve = [0.1, 0.3, 1, 3, 10, 30, 100].map((ligand) => ({
      ligand,
      occupancy: ligand / (ligand + 10)
    }))
    const out = good('enzyme.binding', { points: curve })
    assert.ok(Math.abs((out.kd as number) - 10) < 0.2)
  })

  it('describes a protein', () => {
    const out = good('protein.properties', { sequence: 'WY' })
    assert.equal(out.extinctionCoefficient, 6990)
  })

  it('refuses more disulfide bonds than cysteines', () => {
    const out = refused('protein.properties', { sequence: 'ACG', disulfideBonds: 3 })
    assert.match(out.message as string, /cysteines/)
  })

  it('takes a free energy change', () => {
    const out = good('energy.reaction', { deltaG: -10 })
    assert.equal(out.favourable, true)
  })

  it('takes an equilibrium constant instead', () => {
    const out = good('energy.reaction', { equilibriumConstant: 100 })
    assert.ok((out.deltaG as number) < 0)
  })

  it('refuses with neither', () => {
    const out = refused('energy.reaction', {})
    assert.match(out.message as string, /standard free energy change/)
  })

  it('computes the change under real concentrations', () => {
    const out = good('energy.reaction', { deltaG: 10, products: [1e-6], reactants: [1] })
    assert.notEqual(out.underConditions, null)
  })

  it('refuses a concentration list that is not numbers', () => {
    rejects('energy.reaction', { deltaG: 0, products: ['a'], reactants: [1] }, /products/)
  })
})

describe('bodies through the door', () => {
  it('computes body measures with the not-clinical statement attached', () => {
    const out = good('body.measures', { height: 180, weight: 81 })
    assert.ok(Math.abs((out.bodyMassIndex as number) - 25) < 1e-9)
    assert.match(out.notClinical as string, /not a clinical judgement/)
  })

  it('refuses a height in metres and says how to fix it', () => {
    const out = refused('body.measures', { height: 1.8, weight: 81 })
    assert.match(out.message as string, /multiply by 100/)
  })

  it('computes a metabolic rate from every equation', () => {
    const out = good('body.metabolism', { weight: 80, height: 180, age: 30, sex: 'male' })
    assert.ok((out.basalRate as unknown[]).length >= 3)
    assert.match(out.notClinical as string, /not a clinical judgement/)
  })

  it('refuses a sex outside the two the equations were fitted with', () => {
    rejects('body.metabolism', { weight: 80, height: 180, age: 30, sex: 'unspecified' }, /not one of/)
  })

  it('refuses an activity level it does not know', () => {
    rejects(
      'body.metabolism',
      { weight: 80, height: 180, age: 30, sex: 'male', activity: 'extreme' },
      /not one of/
    )
  })

  it('serves the activity levels with the not-clinical statement', () => {
    const out = good('body.activity-levels')
    assert.equal((out.levels as unknown[]).length, 5)
    assert.match(out.notClinical as string, /not a clinical judgement/)
  })

  it('computes cardiac output from a stroke volume', () => {
    const out = good('heart.output', { strokeVolume: 70, heartRate: 70 })
    assert.ok(Math.abs((out.cardiacOutput as number) - 4.9) < 1e-9)
  })

  it('computes it from an output instead', () => {
    const out = good('heart.output', { cardiacOutput: 4.9, heartRate: 70 })
    assert.ok(Math.abs((out.strokeVolume as number) - 70) < 1e-9)
  })

  it('refuses with neither', () => {
    const out = refused('heart.output', { heartRate: 70 })
    assert.match(out.message as string, /stroke volume/)
  })

  it('refuses a reversed blood pressure', () => {
    const out = refused('heart.output', { strokeVolume: 70, heartRate: 70, systolic: 80, diastolic: 120 })
    assert.match(out.message as string, /swap them/)
  })

  it('splits alveolar from minute ventilation', () => {
    const out = good('breathe.ventilation', { tidalVolume: 500, respiratoryRate: 12, deadSpace: 150 })
    assert.equal(out.minuteVentilation, 6000)
    assert.equal(out.alveolarVentilation, 4200)
  })

  it('estimates dead space from a weight', () => {
    const out = good('breathe.ventilation', { tidalVolume: 500, respiratoryRate: 12, weight: 70 })
    assert.equal(out.deadSpaceEstimated, true)
  })

  it('refuses a dead space that swallows the whole breath', () => {
    const out = refused('breathe.ventilation', { tidalVolume: 150, respiratoryRate: 12, deadSpace: 150 })
    assert.equal(out.error, 'not-applicable')
  })

  it('estimates kidney function by both named equations', () => {
    const out = good('kidney.function', { creatinine: 1, age: 40, sex: 'male', weight: 70 })
    assert.ok((out.cockcroftGault as number) > 0)
    assert.ok((out.ckdEpi as number) > 0)
    assert.match(out.comparison as string, /different quantities/)
  })

  it('refuses a creatinine in micromoles', () => {
    const out = refused('kidney.function', { creatinine: 88, age: 40, sex: 'male' })
    assert.match(out.message as string, /divide by 88.4/)
  })

  it('takes a half-life', () => {
    const out = good('drug.kinetics', { halfLife: 4 })
    assert.equal(out.timeToSteadyState, 20)
  })

  it('takes an elimination constant instead', () => {
    const out = good('drug.kinetics', { eliminationConstant: Math.LN2 / 4 })
    assert.ok(Math.abs((out.halfLife as number) - 4) < 1e-12)
  })

  it('refuses with neither', () => {
    const out = refused('drug.kinetics', {})
    assert.match(out.message as string, /half-life in hours/)
  })

  it('reports the accumulation factor for a dosing interval', () => {
    const out = good('drug.kinetics', { halfLife: 4, dosingInterval: 4 })
    const steady = out.steadyState as { accumulationFactor: number }
    assert.ok(Math.abs(steady.accumulationFactor - 2) < 1e-12)
  })
})

describe('populations through the door', () => {
  it('projects logistic growth', () => {
    const out = good('population.growth', {
      model: 'logistic',
      initialSize: 10,
      growthRate: 0.5,
      carryingCapacity: 1000,
      duration: 60
    })
    assert.ok(Math.abs((out.finalSize as number) - 1000) / 1000 < 1e-4)
  })

  it('caps the trace that crosses the boundary without capping the integration', () => {
    const out = good('population.growth', {
      model: 'logistic',
      initialSize: 10,
      growthRate: 0.5,
      carryingCapacity: 1000,
      duration: 60,
      steps: 50_000
    })
    assert.ok((out.trace as unknown[]).length <= 400)
    // The answer still came from the fine integration, not from 400 coarse steps.
    assert.ok(Math.abs((out.finalSize as number) - 1000) / 1000 < 1e-6)
  })

  it('refuses a model it does not know', () => {
    rejects('population.growth', { model: 'malthusian', initialSize: 10, growthRate: 0.1, duration: 5 }, /not one of/)
  })

  it('refuses a capped model without a capacity', () => {
    const out = refused('population.growth', { model: 'logistic', initialSize: 10, growthRate: 0.5, duration: 10 })
    assert.match(out.message as string, /needs a carrying capacity/)
  })

  it('lists the models', () => {
    const out = good('population.models')
    assert.equal((out.models as unknown[]).length, 5)
  })

  it('runs a predator-prey system', () => {
    const out = good('population.predator-prey', {
      prey: 40,
      predator: 9,
      preyGrowth: 0.4,
      predationRate: 0.02,
      predatorDeath: 0.3,
      conversionRate: 0.5,
      duration: 100
    })
    const equilibrium = out.equilibrium as { prey: number; predator: number }
    assert.ok(Math.abs(equilibrium.prey - 30) < 1e-9)
    assert.ok(Math.abs(equilibrium.predator - 20) < 1e-9)
  })

  it('refuses a predation rate of zero', () => {
    const out = refused('population.predator-prey', {
      prey: 40,
      predator: 9,
      preyGrowth: 0.4,
      predationRate: 0,
      predatorDeath: 0.3,
      conversionRate: 0.5,
      duration: 10
    })
    assert.match(out.message as string, /do not interact/)
  })

  it('estimates a population from marks', () => {
    const out = good('population.mark-recapture', { marked: 100, recaptureSample: 100, recapturedMarked: 20 })
    assert.equal(out.lincolnPetersen, 500)
    assert.ok((out.chapman as number) < 500)
  })

  it('refuses more marks back than went out', () => {
    const out = refused('population.mark-recapture', { marked: 10, recaptureSample: 50, recapturedMarked: 20 })
    assert.match(out.message as string, /More marks came back/)
  })

  it('builds a life table', () => {
    const out = good('population.life-table', {
      rows: [
        { age: 0, survivors: 1000, fecundity: 0 },
        { age: 1, survivors: 500, fecundity: 2 },
        { age: 2, survivors: 200, fecundity: 3 },
        { age: 3, survivors: 0, fecundity: 0 }
      ]
    })
    assert.ok(Math.abs((out.netReproductiveRate as number) - 1.6) < 1e-12)
  })

  it('refuses a life table row missing its fecundity', () => {
    rejects(
      'population.life-table',
      { rows: [{ age: 0, survivors: 100 }, { age: 1, survivors: 50, fecundity: 1 }] },
      /fecundity/
    )
  })

  it('computes every diversity index at once', () => {
    const out = good('ecology.diversity', {
      counts: [
        { name: 'a', count: 25 },
        { name: 'b', count: 25 },
        { name: 'c', count: 25 },
        { name: 'd', count: 25 }
      ]
    })
    assert.ok(Math.abs((out.shannon as number) - Math.log(4)) < 1e-12)
    assert.ok(Math.abs((out.inverseSimpson as number) - 4) < 1e-12)
    const effective = out.effectiveSpecies as { order0: number; order1: number; order2: number }
    assert.equal(effective.order0, 4)
  })

  it('refuses a species named twice', () => {
    const out = refused('ecology.diversity', {
      counts: [
        { name: 'a', count: 5 },
        { name: 'A', count: 5 }
      ]
    })
    assert.match(out.message as string, /appears twice/)
  })

  it('walks energy up a food chain', () => {
    const out = good('ecology.food-chain', { primaryProduction: 10_000, levels: 4 })
    const levels = out.levels as { energy: number }[]
    assert.ok(Math.abs(levels[3].energy - 10) < 1e-9)
    assert.ok(Math.abs((out.baseRequired as number) - 1000) < 1e-9)
  })

  it('takes one efficiency per step', () => {
    const out = good('ecology.food-chain', { primaryProduction: 1000, levels: 3, efficiencies: [0.2, 0.1] })
    assert.ok(Math.abs((out.baseRequired as number) - 50) < 1e-9)
  })

  it('says out loud when it fell back to the ten percent rule', () => {
    const out = good('ecology.food-chain', { primaryProduction: 1000, levels: 3 })
    assert.ok((out.warnings as string[]).some((one) => /rule of thumb/.test(one)))
  })

  it('refuses an efficiency above one', () => {
    const out = refused('ecology.food-chain', { primaryProduction: 1000, levels: 3, efficiency: 1.4 })
    assert.match(out.message as string, /more energy than it ate/)
  })

  it('names the levels when asked', () => {
    const out = good('ecology.food-chain', {
      primaryProduction: 1000,
      levels: 2,
      names: ['grass', 'cattle']
    })
    const levels = out.levels as { name: string }[]
    assert.equal(levels[0].name, 'grass')
    assert.equal(levels[1].name, 'cattle')
  })
})

describe('provenance', () => {
  it('serves every engine assumption list', () => {
    const out = good('biology.assumptions')
    for (const key of ['genetics', 'biochemistry', 'physiology', 'ecology']) {
      assert.ok(Array.isArray(out[key]), `${key} assumptions missing`)
      assert.ok((out[key] as unknown[]).length >= 8, `${key} assumptions too thin`)
    }
  })

  it('serves the not-clinical statement on its own', () => {
    const out = good('biology.not-clinical')
    assert.match(out.statement as string, /not a clinical judgement/)
  })

  it('attaches the not-clinical statement to every operation that describes a person', () => {
    const personal: [string, Record<string, unknown>][] = [
      ['body.measures', { height: 180, weight: 81 }],
      ['body.metabolism', { weight: 80, height: 180, age: 30, sex: 'male' }],
      ['heart.output', { strokeVolume: 70, heartRate: 70 }],
      ['breathe.ventilation', { tidalVolume: 500, respiratoryRate: 12, deadSpace: 150 }],
      ['kidney.function', { creatinine: 1, age: 40, sex: 'male' }],
      ['drug.kinetics', { halfLife: 4 }]
    ]
    for (const [operation, input] of personal) {
      const out = good(operation, input)
      assert.match(out.notClinical as string, /not a clinical judgement/, `${operation} is missing the statement`)
    }
  })
})
