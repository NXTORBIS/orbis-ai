import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { emptyRegistry, registerPage, type PageRegistry } from '../../shared/pages/registry.ts'
import { GenerationService, PLANNER_INSTRUCTIONS, type GenerationServiceOptions } from './generationService.ts'
import { CATALOGUED_OPERATIONS, catalogueForPrompt } from './generationCatalogue.ts'
import { KNOWN_OPERATIONS } from './service.ts'
import { runEngineOperation } from './engines.ts'
import { runPhysicsOperation } from './physicsEngines.ts'

/**
 * These run the real engines.
 *
 * Only the model is replaced, and only because a test that needed one would be a test of the network. Everything the
 * model's answer then goes through -- the checker, the compiler, the gates, and the trial run -- is the real thing,
 * which is the only way to find out whether a specification that looks right produces a Page that works.
 */

const ALL: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(KNOWN_OPERATIONS.map((one) => [one, capabilityFor(one)]))
)

function capabilityFor(operation: string): string {
  const family = operation.slice(0, operation.indexOf('.'))
  if (['mechanics', 'motion', 'oscillator', 'collision', 'gravity', 'rotation', 'wave'].includes(family)) return 'computation.physics'
  if (['signal', 'interpolate', 'fit', 'precision', 'constants', 'frames', 'constraints'].includes(family)) return 'computation.science'
  if (['algebra', 'matrix', 'number', 'combinatorics', 'graph', 'calculus', 'geometry', 'relation'].includes(family)) {
    return 'computation.mathematics'
  }
  return 'computation.statistics'
}

/** The real dispatch, across the two bridges these tests reach. */
const runOperation = (operation: string, input: Record<string, unknown>): unknown => {
  const family = operation.slice(0, operation.indexOf('.'))
  if (['mechanics', 'motion', 'oscillator', 'collision', 'gravity', 'rotation', 'wave'].includes(family)) {
    return runPhysicsOperation(operation, input)
  }
  return runEngineOperation(operation, input)
}

const goodSpec = (): Record<string, unknown> => ({
  specVersion: 1,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Launch speed', initial: 20, minimum: 1, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Launch angle', initial: 45, minimum: 1, maximum: 89 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      when: 'change',
      describe: 'The trajectory with no air resistance',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } }
    }
  ],
  outputs: [{ name: 'range', label: 'How far it goes', display: 'statistic', step: 'flight', pick: 'range' }],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range']
})

interface Asked {
  system: string
  user: string
}

const serviceWith = (
  answers: readonly (Record<string, unknown> | null)[],
  extra: Partial<GenerationServiceOptions> = {}
): { service: GenerationService; asked: Asked[] } => {
  const asked: Asked[] = []
  let index = 0
  let counter = 0
  const service = new GenerationService({
    registry: async () => emptyRegistry(),
    runOperation,
    allOperations: ALL,
    apiKeys: async () => ['a-key'],
    fetchFn: (async () => {
      throw new Error('the model is replaced in these tests')
    }) as unknown as GenerationServiceOptions['fetchFn'],
    random: () => `abcdef0123456789${(counter += 1).toString().padStart(8, '0')}`,
    now: () => 1000 + counter,
    ask: async (system, user) => {
      asked.push({ system, user })
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      return answer
    },
    ...extra
  })
  return { service, asked }
}

describe('the prompt a model is given', () => {
  it('names every calculation it is allowed to use, and nothing else', () => {
    const catalogue = catalogueForPrompt()
    for (const operation of CATALOGUED_OPERATIONS) assert.ok(catalogue.includes(operation), operation)
    // And an operation that exists but is not catalogued is not offered.
    const uncatalogued = KNOWN_OPERATIONS.find((one) => !CATALOGUED_OPERATIONS.includes(one))
    assert.ok(uncatalogued !== undefined)
    assert.equal(catalogue.includes(`  ${uncatalogued}(`), false)
  })

  it('tells the model there is no way to ask for a permission or fetch anything', () => {
    assert.ok(PLANNER_INSTRUCTIONS.includes('no way to ask for a permission'))
  })

  it('gives it a way to say it cannot, so it is not cornered into inventing an operation', () => {
    assert.ok(PLANNER_INSTRUCTIONS.includes('"cannot"'))
  })
})

describe('building a Page', () => {
  it('builds one, runs it for real, and the calculation answers', async () => {
    const { service, asked } = serviceWith([goodSpec()])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(outcome.session.stage, 'ready', JSON.stringify(outcome.session.failure))
    assert.equal(asked.length, 1, 'one attempt was enough')
    assert.ok(outcome.compiled !== null)
    assert.deepEqual(outcome.compiled.manifest.capabilities, ['computation.physics'])
    assert.equal(outcome.session.validation?.passed, true)
    assert.equal(outcome.session.validation?.incomplete, false, 'the running gate really ran')
  })

  it('gets a number out of the real engine, not a shape that looks like one', async () => {
    const { service } = serviceWith([goodSpec()])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.ok(outcome.compiled !== null)
    const evidence = service.tryRun(outcome.compiled.document)
    assert.deepEqual(evidence.results.map((one) => one.ok), [true])
    assert.ok(evidence.results[0].keys?.includes('range'))
    // 20 m/s at 45 degrees is v² sin 2θ / g, which is 400/9.81.
    const value = runOperation('motion.projectile', { speed: 20, angle: 45, gravity: 9.81 }) as { range: number }
    assert.ok(Math.abs(value.range - 400 / 9.81) < 1e-9, String(value.range))
  })

  it('never reaches the model when something already does it', async () => {
    const registry = withPage()
    const { service, asked } = serviceWith([goodSpec()], { registry: async () => registry })
    const outcome = await service.generate('p1', 'unit converter conversion units', {
      intents: [{ intent: 'conversion', confidence: 0.9 }]
    })
    assert.equal(asked.length, 0)
    assert.equal(outcome.session.stage, 'failed')
    assert.equal(outcome.session.failure?.code, 'nothing-to-build')
    assert.ok(outcome.resolution !== null && outcome.resolution.action !== 'generate')
  })

  it('never reaches the model for a question that was never a Page', async () => {
    const { service, asked } = serviceWith([goodSpec()])
    const outcome = await service.generate('p1', 'weather in paris tomorrow')
    assert.equal(asked.length, 0)
    assert.equal(outcome.session.stage, 'failed')
  })

  it('says so rather than building when there is nothing to ask', async () => {
    const { service, asked } = serviceWith([goodSpec()], { apiKeys: async () => [] })
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(asked.length, 0)
    assert.equal(outcome.session.stage, 'failed')
  })

  it('believes the model when it says nothing here can do it', async () => {
    const { service } = serviceWith([{ specVersion: 1, cannot: 'Orbis has no tide tables.' }])
    const outcome = await service.generate('p1', 'calculate the tide height at dover tomorrow')
    assert.equal(outcome.session.stage, 'failed')
    // Distinct from `nothing-to-build`, which means something already answers it. "Orbis cannot work this out" and
    // "there is already a Page for this" must not read alike.
    assert.equal(outcome.session.failure?.code, 'cannot-be-built')
    assert.ok(outcome.session.failure?.message.includes('tide tables'))
  })
})

describe('arguing with the model once', () => {
  it('sends back what was wrong with an argument name, and the second attempt works', async () => {
    const wrong = goodSpec()
    ;(wrong.steps as Record<string, unknown>[])[0].arguments = { velocity: { input: 'speed' }, angle: { input: 'angle' } }
    const { service, asked } = serviceWith([wrong, goodSpec()])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(asked.length, 2)
    assert.ok(asked[1].user.includes('does not take "velocity"'), asked[1].user)
    assert.ok(asked[1].user.includes('It takes speed, angle'))
    assert.equal(outcome.session.stage, 'ready')
  })

  it('sends back the properties a calculation really returns when a Page shows the wrong one', async () => {
    // The failure nothing else catches: the Page opens, the calculation answers, and the box is empty.
    const wrong = goodSpec()
    ;(wrong.outputs as Record<string, unknown>[])[0].pick = 'distance'
    const { service, asked } = serviceWith([wrong, goodSpec()])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(asked.length, 2)
    assert.ok(asked[1].user.includes('"distance" is not something flight returns'), asked[1].user)
    assert.ok(asked[1].user.includes('range'))
    assert.equal(outcome.session.stage, 'ready')
  })

  it('stops after the second attempt rather than flipping the same coin again', async () => {
    const wrong = goodSpec()
    ;(wrong.outputs as Record<string, unknown>[])[0].pick = 'distance'
    const { service, asked } = serviceWith([wrong, wrong, wrong])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(asked.length, 2)
    assert.notEqual(outcome.session.stage, 'ready')
  })

  it('refuses an operation Orbis does not have, and says so rather than trying it', async () => {
    const wrong = goodSpec()
    ;(wrong.steps as Record<string, unknown>[])[0].operation = 'secrets.read'
    const { service, asked } = serviceWith([wrong, wrong])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.notEqual(outcome.session.stage, 'ready')
    assert.ok(asked[1].user.includes('secrets.read'))
    assert.ok(outcome.compiled === null)
  })

  it('refuses an operation that exists but is not catalogued', async () => {
    // `markets.quote` is a real operation the compute service dispatches. A generated Page may not use it, and the
    // reason is the catalogue rather than anything about markets.
    const wrong = goodSpec()
    ;(wrong.steps as Record<string, unknown>[])[0].operation = 'data.parse'
    const { service } = serviceWith([wrong, wrong])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.notEqual(outcome.session.stage, 'ready')
  })
})

describe('what the model writes is never trusted', () => {
  it('drops a capability list it tried to declare', async () => {
    const sneaky = { ...goodSpec(), capabilities: ['secrets.read', 'network.fetch'], owner: 'system' }
    const { service } = serviceWith([sneaky])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(outcome.session.stage, 'ready')
    assert.ok(outcome.compiled !== null)
    assert.deepEqual(outcome.compiled.manifest.capabilities, ['computation.physics'])
    assert.equal(outcome.compiled.manifest.owner, 'orion')
  })

  it('never puts anything it did not read into the Page', async () => {
    const sneaky = { ...goodSpec(), script: 'fetch("https://example.invalid")', url: 'https://example.invalid' }
    const { service } = serviceWith([sneaky])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.ok(outcome.compiled !== null)
    assert.equal(JSON.stringify(outcome.compiled).includes('example.invalid'), false)
  })

  it('keeps what the model wrote as evidence even when it was refused', async () => {
    const wrong = { ...goodSpec(), steps: [] }
    const { service } = serviceWith([wrong, wrong])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.notEqual(outcome.session.stage, 'ready')
    assert.ok(outcome.session.raw !== null)
    assert.ok(outcome.session.raw.includes('Projectile Range'))
    // And the spec is null, because nothing usable was ever read out of it.
    assert.equal(outcome.session.spec, null)
  })

  it('does not build from an answer that is not an object at all', async () => {
    const { service } = serviceWith([null])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(outcome.session.stage, 'failed')
    assert.equal(outcome.session.failure?.code, 'model-failed')
  })
})

describe('the trial run', () => {
  it('reports an engine refusing the numbers rather than calling it a pass', async () => {
    // A launch angle of 0 makes the range zero and the flight time zero, which several of these engines refuse.
    const impossible = goodSpec()
    ;(impossible.inputs as Record<string, unknown>[])[1].initial = 0
    ;(impossible.inputs as Record<string, unknown>[])[1].minimum = 0
    const { service } = serviceWith([impossible])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    const evidence = outcome.compiled === null ? null : service.tryRun(outcome.compiled.document)
    // Whether the engine refuses it or answers zero is the engine's business. What matters is that whatever it did is
    // what the evidence says, rather than an assumption.
    if (evidence !== null && !evidence.results[0].ok) {
      assert.ok(String(evidence.results[0].message).length > 0)
    } else {
      assert.equal(outcome.session.stage, 'ready')
    }
  })

  it('checks a Page whose work waits for a button, rather than leaving it the one Page nobody checked', async () => {
    const waiting = goodSpec()
    ;(waiting.steps as Record<string, unknown>[])[0].when = 'button'
    const { service } = serviceWith([waiting])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(outcome.session.stage, 'ready', JSON.stringify(outcome.session.failure))
    assert.ok(outcome.compiled !== null)
    const evidence = service.tryRun(outcome.compiled.document)
    assert.deepEqual(evidence.results.map((one) => one.ok), [true])
    assert.ok(evidence.results[0].keys?.includes('range'))
  })

  it('catches a wrong property on a Page whose work waits for a button', async () => {
    // The whole reason the trial run presses them. Before it did, this Page was built, kept, and showed an empty box.
    const waiting = goodSpec()
    ;(waiting.steps as Record<string, unknown>[])[0].when = 'button'
    ;(waiting.outputs as Record<string, unknown>[])[0].pick = 'distance'
    const { service, asked } = serviceWith([waiting, goodSpec()])
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.equal(asked.length, 2)
    assert.ok(asked[1].user.includes('"distance" is not something flight returns'))
    assert.equal(outcome.session.stage, 'ready')
  })

  it('notices an engine that refuses inside its answer rather than by throwing', async () => {
    // Two refusals reach the runner and they look different. This is the quieter one.
    const { service } = serviceWith([goodSpec()])
    let refusals = 0
    const outcome = await service.generate('p1', 'calculate the range of a projectile')
    assert.ok(outcome.compiled !== null)
    const spy = new GenerationService({
      registry: async () => emptyRegistry(),
      runOperation: () => ({ ok: false, message: 'That is not a projectile.' }),
      allOperations: ALL,
      apiKeys: async () => ['a-key'],
      fetchFn: (async () => {
        throw new Error('unused')
      }) as never,
      random: () => 'abcdef0123456789abcdef01',
      ask: async () => {
        refusals += 1
        return goodSpec()
      }
    })
    const evidence = spy.tryRun(outcome.compiled.document)
    assert.equal(evidence.results[0].ok, false)
    assert.equal(evidence.results[0].message, 'That is not a projectile.')
    assert.equal(refusals, 0)
  })
})

function withPage(): PageRegistry {
  const result = registerPage(
    emptyRegistry(),
    {
      schemaVersion: 1,
      pageId: 'page_unitconverter00000000',
      slug: 'unit-converter',
      title: 'Unit Converter',
      description: 'Convert between units of length, mass, temperature and more.',
      version: '1.0.0',
      kind: 'tool',
      categories: ['utilities.calculation'],
      tags: ['units', 'conversion'],
      icon: 'ruler',
      owner: 'system',
      runtimeAtLeast: '1.0.0',
      capabilities: [],
      capabilityReasons: {},
      dependencies: [],
      search: {
        summary: 'Convert between units.',
        keywords: ['convert', 'unit', 'units', 'conversion', 'celsius', 'metre'],
        intents: ['convert'],
        aliases: []
      },
      offline: true,
      limitations: ['It converts units.'],
      languages: ['en']
    },
    { trust: 'system', profileId: null, now: 1000 }
  )
  assert.ok(!('error' in result), JSON.stringify(result))
  return result.state
}
