import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { emptyRegistry, registerPage, type PageRegistry } from './registry.ts'
import { looksComputable, resolve, RESOLUTION_LIMITS } from './resolution.ts'

const manifest = (parts: {
  slug: string
  title: string
  description: string
  keywords: string[]
  intents: string[]
  tags?: string[]
}): Record<string, unknown> => ({
  schemaVersion: 1,
  pageId: `page_${parts.slug.replace(/-/g, '')}${'0'.repeat(20)}`.slice(0, 29),
  slug: parts.slug,
  title: parts.title,
  description: parts.description,
  version: '1.0.0',
  kind: 'tool',
  categories: ['utilities.calculation'],
  tags: parts.tags ?? [],
  icon: 'calculator',
  owner: 'system',
  runtimeAtLeast: '1.0.0',
  capabilities: [],
  capabilityReasons: {},
  dependencies: [],
  search: { summary: parts.description, keywords: parts.keywords, intents: parts.intents, aliases: [] },
  offline: true,
  limitations: ['It does one thing.'],
  languages: ['en']
})

const withPages = (pages: readonly Record<string, unknown>[]): PageRegistry => {
  let state = emptyRegistry()
  for (const one of pages) {
    const result = registerPage(state, one, { trust: 'system', profileId: null, now: 1000 })
    assert.ok(!('error' in result), JSON.stringify('error' in result ? result : ''))
    state = result.state
  }
  return state
}

const converter = manifest({
  slug: 'unit-converter',
  title: 'Unit Converter',
  description: 'Convert between units of length, mass, temperature and more.',
  keywords: ['convert', 'unit', 'celsius', 'fahrenheit', 'kilogram', 'metre'],
  intents: ['convert'],
  tags: ['units', 'conversion']
})

const mortgage = manifest({
  slug: 'mortgage-calculator',
  title: 'Mortgage Calculator',
  description: 'Work out the monthly repayment on a mortgage.',
  keywords: ['mortgage', 'repayment', 'interest', 'loan'],
  intents: ['calculate'],
  tags: ['finance', 'mortgage']
})

const base = { profileId: 'p1', registry: withPages([converter, mortgage]) }

describe('looksComputable', () => {
  it('sees a calculation being asked for', () => {
    for (const query of ['calculate compound interest', 'convert 20 celsius to fahrenheit', 'how far does a ball go at 20 m/s']) {
      assert.ok(looksComputable(query).computable, query)
    }
  })

  it('does not see one in a question about the world', () => {
    for (const query of ['who is the prime minister', 'news about the budget', 'weather tomorrow', 'coffee near me', 'definition of entropy']) {
      const signal = looksComputable(query)
      assert.equal(signal.computable, false, query)
      assert.ok(signal.because.length > 0, query)
    }
  })

  it('does not treat a bare number as evidence', () => {
    // A year, a model number and a street number are all numbers. Without a word that asks for something, none of
    // these is a request to work anything out.
    for (const query of ['boeing 747', '1984', '221b baker street', 'ipv6']) {
      assert.equal(looksComputable(query).computable, false, query)
    }
  })

  it('lets a strong lookup intent override words that would otherwise qualify', () => {
    const signal = looksComputable('compare the news coverage', [{ intent: 'news', confidence: 0.9 }])
    assert.equal(signal.computable, false)
  })

  it('does not let a weak intent override, because a weak signal should not decide anything', () => {
    const signal = looksComputable('compare two loans', [{ intent: 'news', confidence: 0.2 }])
    assert.ok(signal.computable)
  })

  it('says why, every time, whichever way it went', () => {
    assert.ok(looksComputable('calculate the mean').because.length > 0)
    assert.ok(looksComputable('weather tomorrow').because.length > 0)
  })
})

describe('resolve', () => {
  it('opens a Page that already does exactly this rather than building one', () => {
    const result = resolve({ ...base, query: 'convert 20 celsius to fahrenheit' })
    assert.ok(result.action === 'open' || result.action === 'configure', result.action)
    if (result.action === 'open' || result.action === 'configure') {
      assert.equal(result.suggestion.page.identity.slug, 'unit-converter')
    }
  })

  it('prefers an existing Page even when the query is clearly computable', () => {
    // The point of the ladder. A generated mortgage calculator might fit the words better; the one somebody wrote is
    // still the better answer.
    const result = resolve({ ...base, query: 'calculate my mortgage repayment' })
    assert.notEqual(result.action, 'generate')
  })

  it('generates only when nothing in the library does it', () => {
    const result = resolve({ ...base, query: 'calculate the terminal velocity of a falling raindrop' })
    assert.equal(result.action, 'generate')
    if (result.action === 'generate') {
      assert.equal(result.request, 'calculate the terminal velocity of a falling raindrop')
      assert.ok(result.because.some((one) => one.includes('Nothing in the library')))
    }
  })

  it('declines a query that was never a Page', () => {
    for (const query of ['latest news', 'weather in paris', 'who won the cup final']) {
      const result = resolve({ ...base, query })
      assert.equal(result.action, 'decline', query)
    }
  })

  it('never interrupts a web address', () => {
    const result = resolve({ ...base, query: 'https://example.com/calculate', looksLikeUrl: true })
    assert.equal(result.action, 'decline')
    if (result.action === 'decline') assert.ok(result.because[0].includes('web address'))
  })

  it('declines an empty query and a document', () => {
    assert.equal(resolve({ ...base, query: '   ' }).action, 'decline')
    assert.equal(resolve({ ...base, query: 'calculate '.repeat(200) }).action, 'decline')
    assert.ok(RESOLUTION_LIMITS.queryLength < 'calculate '.repeat(200).length)
  })

  it('says generation is unavailable rather than offering an option that does nothing', () => {
    const result = resolve({ ...base, query: 'calculate the terminal velocity of a falling raindrop', canGenerate: false })
    assert.equal(result.action, 'decline')
    if (result.action === 'decline') assert.ok(result.because.some((one) => one.includes('not available')))
  })

  it('offers two Pages together when each covers a different half', () => {
    const registry = withPages([
      converter,
      manifest({
        slug: 'shipping-cost',
        title: 'Shipping Cost',
        description: 'Work out the shipping cost from a parcel weight.',
        keywords: ['shipping', 'parcel', 'postage', 'cost'],
        intents: ['calculate'],
        tags: ['shipping', 'postage']
      })
    ])
    const result = resolve({
      profileId: 'p1',
      registry,
      query: 'unit conversion units convert shipping cost parcel postage',
      intents: [{ intent: 'conversion', confidence: 0.9 }]
    })
    assert.equal(result.action, 'compose')
    if (result.action === 'compose') {
      assert.equal(result.parts.length, 2)
      assert.deepEqual(new Set(result.parts.map((one) => one.page.identity.slug)), new Set(['unit-converter', 'shipping-cost']))
    }
  })

  it('does not call two Pages a composition when they match the same words', () => {
    // Two answers to one question. The better one is the answer, and offering both dresses a tie up as coverage.
    const registry = withPages([
      converter,
      manifest({
        slug: 'metric-converter',
        title: 'Metric Converter',
        description: 'Convert between units of length, mass and temperature.',
        keywords: ['convert', 'unit', 'celsius', 'fahrenheit', 'kilogram', 'metre'],
        intents: ['convert'],
        tags: ['units', 'conversion']
      })
    ])
    const result = resolve({
      profileId: 'p1',
      registry,
      query: 'unit converter conversion units',
      intents: [{ intent: 'conversion', confidence: 0.9 }]
    })
    assert.notEqual(result.action, 'compose')
  })

  it('carries the reasons through, so a wrong answer can be argued with', () => {
    const result = resolve({ ...base, query: 'calculate the terminal velocity of a falling raindrop' })
    assert.ok(result.because.length >= 2)
  })
})
