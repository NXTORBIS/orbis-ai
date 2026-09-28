import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { ORION_PAGES_ASSUMPTIONS, describePage, planAnswer, presentAnswer } from './orion.ts'
import { emptyRegistry, listPages, registerPage } from './registry.ts'
import { MANIFEST_SCHEMA_VERSION } from './manifest.ts'

describe('routing a question to an engine', () => {
  it('routes a conversion', () => {
    const plan = planAnswer('convert 20 celsius to fahrenheit')
    assert.equal(plan?.operation, 'units.convert')
    assert.deepEqual(plan?.input, { value: 20, from: 'celsius', to: 'fahrenheit' })
  })

  it('routes the ways people actually write a conversion', () => {
    for (const question of [
      '20 km/h in m/s',
      'what is 20 kg in lb',
      "what's 5 m as cm",
      'convert 1.5e3 g into kg',
      '-40 degC to degF'
    ]) {
      assert.ok(planAnswer(question)?.operation === 'units.convert', `"${question}" was not routed`)
    }
  })

  it('routes an equation', () => {
    const plan = planAnswer('solve x^2 + 3x + 2 = 0')
    assert.equal(plan?.operation, 'solver.solve')
    assert.equal((plan?.input as { equation: string }).equation, 'x^2 + 3x + 2 = 0')
  })

  it('routes an equation with the variable named', () => {
    const plan = planAnswer('solve 2a + 4 = 10 for a')
    assert.equal((plan?.input as { variable: string }).variable, 'a')
  })

  it('routes a derivative', () => {
    const plan = planAnswer('differentiate x^2 + sin(x)')
    assert.equal(plan?.operation, 'expression.differentiate')
    assert.equal((plan?.input as { text: string }).text, 'x^2 + sin(x)')
    assert.equal((plan?.input as { variable: string }).variable, 'x')
    assert.equal(planAnswer('derivative of x^3 with respect to t')?.input.variable, 't')
  })

  it('routes a summary of numbers', () => {
    const plan = planAnswer('what is the mean of 10, 20, 30')
    assert.equal(plan?.operation, 'statistics.summarise')
    assert.deepEqual((plan?.input as { values: number[] }).values, [10, 20, 30])
  })

  it('routes plain arithmetic, which is what a model gets wrong most confidently', () => {
    const plan = planAnswer('what is 1847 * 2293')
    assert.equal(plan?.operation, 'expression.evaluate')
    // `text` is the key the expression engine reads. The wrong key here does not fail loudly: the engine refuses and
    // the question quietly falls back to being answered by the model, which is the thing this file exists to prevent.
    assert.equal((plan?.input as { text: string }).text, '1847*2293')
  })

  it('routes arithmetic written without a question around it', () => {
    assert.equal(planAnswer('12.5 / 4')?.operation, 'expression.evaluate')
    assert.equal(planAnswer('2^10')?.operation, 'expression.evaluate')
  })
})

describe('refusing to guess', () => {
  it('answers null for anything it cannot map exactly', () => {
    for (const question of [
      'how much is a lot of flour',
      'what is the capital of France',
      'explain quantum entanglement',
      'is 20 celsius warm',
      'should I convert my garage',
      'who solved the poincare conjecture'
    ]) {
      assert.equal(planAnswer(question), null, `"${question}" was routed to an engine`)
    }
  })

  it('does not fire on a pattern buried in a sentence', () => {
    // The failure this prevents: a confident precise answer to a question nobody asked.
    assert.equal(planAnswer('I converted the garage into 20 m of storage'), null)
    assert.equal(planAnswer('solve this problem: my printer is broken'), null)
  })

  it('does not treat a single number as a summary', () => {
    assert.equal(planAnswer('what is the mean of 42'), null)
  })

  it('does not route an empty or absurd question', () => {
    assert.equal(planAnswer(''), null)
    assert.equal(planAnswer('   '), null)
    assert.equal(planAnswer('x'.repeat(500)), null)
  })

  it('does not treat a phrase with spaces in it as a unit', () => {
    assert.equal(planAnswer('turn 20 degrees to the left'), null)
  })

  it('only ever routes something it is certain about', () => {
    const plan = planAnswer('convert 20 celsius to fahrenheit')
    assert.equal(plan?.certainty, 'exact')
  })
})

describe('presenting a computed answer', () => {
  it('says the answer was worked out rather than recalled', () => {
    const plan = planAnswer('what is 1847 * 2293')
    assert.ok(plan !== null)
    const answer = presentAnswer(plan, { value: 4235171 })
    assert.match(answer.text, /Calculated exactly, not estimated/)
    assert.match(answer.text, /4235171/)
  })

  it('names what worked it out', () => {
    const plan = planAnswer('convert 20 celsius to fahrenheit')
    assert.ok(plan !== null)
    assert.equal(presentAnswer(plan, { display: '68 degF' }).operation, 'units.convert')
    assert.match(presentAnswer(plan, { display: '68 degF' }).text, /unit engine, not from memory/)
  })

  it('echoes back what it understood, so a misreading can be seen', () => {
    const plan = planAnswer('20 km/h in m/s')
    assert.ok(plan !== null)
    assert.match(presentAnswer(plan, { display: '5.56 m/s' }).understood, /20 km\/h converted to m\/s/)
  })

  it('carries every caveat the engine returned', () => {
    const plan = planAnswer('what is the mean of 1, 2, 3')
    assert.ok(plan !== null)
    const answer = presentAnswer(plan, {
      mean: 2,
      median: 2,
      notes: ['The mean is sensitive to a single extreme value.'],
      assumptions: ['These are all the values, not a sample of them.']
    })
    assert.equal(answer.notes.length, 2)
    assert.ok(answer.notes.some((one) => /sensitive to a single extreme/.test(one)))
  })

  it('carries a description as a caveat too', () => {
    const plan = planAnswer('what is 2 * 3')
    assert.ok(plan !== null)
    const answer = presentAnswer(plan, { value: 6, describe: 'Exact in whole numbers.' })
    assert.ok(answer.notes.includes('Exact in whole numbers.'))
  })

  it('reads the shapes the engines actually return', () => {
    const plan = planAnswer('solve x + 1 = 3')
    assert.ok(plan !== null)
    const answer = presentAnswer(plan, { solutions: [{ text: 'x = 2' }] })
    assert.match(answer.text, /x = 2/)
  })

  it('does not lose an answer it did not recognise the shape of', () => {
    const plan = planAnswer('what is 2 * 3')
    assert.ok(plan !== null)
    const answer = presentAnswer(plan, { somethingNew: 42 })
    assert.match(answer.text, /42/)
  })

  it('does not flood an answer with caveats', () => {
    const plan = planAnswer('what is 2 * 3')
    assert.ok(plan !== null)
    const many = Array.from({ length: 30 }, (_, i) => `note ${i}`)
    assert.ok(presentAnswer(plan, { value: 6, notes: many }).notes.length <= 6)
  })
})

describe('describing a Page', () => {
  const page = (over: Record<string, unknown> = {}): ReturnType<typeof listPages>[number] => {
    const result = registerPage(
      emptyRegistry(),
      {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        pageId: 'page_1111111111111111111111111111',
        slug: 'unit-converter',
        title: 'Unit Converter',
        description: 'Convert a quantity into another unit of the same kind, with dimensional checking throughout.',
        version: '1.0.0',
        kind: 'converter',
        categories: ['science.measurement'],
        tags: ['units'],
        icon: 'ruler',
        owner: 'system',
        runtimeAtLeast: '1.0.0',
        capabilities: ['computation.units'],
        capabilityReasons: {},
        dependencies: [],
        search: { summary: 'Convert between hundreds of units.', keywords: ['convert'], intents: ['convert'], aliases: [] },
        offline: true,
        limitations: ['Currency is not a unit: an exchange rate has to be fetched.'],
        languages: ['en'],
        ...over
      },
      { trust: 'system', profileId: null, now: 1000 }
    )
    assert.ok(!('error' in result), JSON.stringify(result))
    return result.page
  }

  it('says what the Page says about itself', () => {
    const lines = describePage(page())
    assert.ok(lines[0].includes('Unit Converter'))
    assert.ok(lines.some((one) => /dimensional checking/.test(one)))
  })

  it('always includes what the Page says it cannot do', () => {
    // The part somebody needs before relying on it, which is exactly the part usually left out.
    assert.ok(describePage(page()).some((one) => /It cannot: Currency is not a unit/.test(one)))
  })

  it('says when a Page is not available, rather than describing it as though it were', () => {
    const one = page()
    const unavailable = { ...one, status: 'incompatible' as const, note: 'it needs a newer Orbis' }
    assert.ok(describePage(unavailable).some((line) => /not available/.test(line)))
  })

  it('does not repeat the description as the summary', () => {
    const lines = describePage(page({ search: { summary: 'Convert a quantity into another unit of the same kind, with dimensional checking throughout.', keywords: [], intents: [], aliases: [] } }))
    const body = lines.filter((one) => /dimensional checking/.test(one))
    assert.equal(body.length, 1)
  })
})

describe('assumptions', () => {
  it('states the rule this whole file exists for', () => {
    assert.ok(
      ORION_PAGES_ASSUMPTIONS.some((one) => /A model asked for a sum answers confidently whether or not it is right/.test(one))
    )
  })

  it('states that a computed answer says so', () => {
    assert.ok(ORION_PAGES_ASSUMPTIONS.some((one) => /says it was computed/.test(one)))
  })

  it('states that half-understanding is worse than answering vaguely', () => {
    assert.ok(ORION_PAGES_ASSUMPTIONS.some((one) => /Half-understanding a question/.test(one)))
  })
})
