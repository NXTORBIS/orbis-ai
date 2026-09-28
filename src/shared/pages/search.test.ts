import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  PAGE_SEARCH_ASSUMPTIONS,
  PAGE_SEARCH_LIMITS,
  directPage,
  pagesModule,
  suggestPages,
  wordsForIntent
} from './search.ts'
import { emptyRegistry, registerPage, type PageRegistry } from './registry.ts'
import { MANIFEST_SCHEMA_VERSION } from './manifest.ts'

const manifest = (over: Record<string, unknown>): Record<string, unknown> => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  version: '1.0.0',
  kind: 'tool',
  categories: ['utilities.general'],
  icon: 'square',
  owner: 'system',
  runtimeAtLeast: '1.0.0',
  capabilities: ['computation.arithmetic'],
  capabilityReasons: {},
  dependencies: [],
  offline: true,
  limitations: [],
  languages: ['en'],
  ...over
})

const UNITS = manifest({
  pageId: 'page_1111111111111111111111111111',
  slug: 'unit-converter',
  title: 'Unit Converter',
  description: 'Convert a quantity into another unit of the same kind, with dimensional checking throughout.',
  tags: ['units', 'conversion', 'measurement'],
  capabilities: ['computation.units'],
  search: {
    summary: 'Convert between metres, miles, kilograms and hundreds of other units.',
    keywords: ['convert', 'conversion', 'units', 'celsius', 'fahrenheit', 'metres'],
    intents: ['convert', 'calculate'],
    aliases: ['Units', 'Conversion']
  }
})

const SOLVER = manifest({
  pageId: 'page_2222222222222222222222222222',
  slug: 'equation-solver',
  title: 'Equation Solver',
  description: 'Solve an equation for one unknown and see every answer checked by substituting it back in.',
  tags: ['algebra', 'equations', 'maths'],
  search: {
    summary: 'Solve equations and systems of equations.',
    keywords: ['solve', 'equation', 'algebra', 'roots'],
    intents: ['solve', 'calculate'],
    aliases: ['Solver']
  }
})

const SHOP = manifest({
  pageId: 'page_3333333333333333333333333333',
  slug: 'cable-catalogue',
  title: 'Cable Catalogue',
  description: 'A catalogue of cables, adapters and converters for reference while you are shopping.',
  tags: ['cables', 'hardware', 'reference'],
  search: {
    summary: 'Look up cables and adapters.',
    keywords: ['cable', 'adapter', 'converter', 'hdmi'],
    intents: ['shopping'],
    aliases: []
  }
})

const registry = (...manifests: Record<string, unknown>[]): PageRegistry => {
  let state = emptyRegistry()
  for (const one of manifests) {
    const result = registerPage(state, one, { trust: 'system', profileId: null, now: 1000 })
    assert.ok(!('error' in result), `could not register: ${JSON.stringify(result)}`)
    state = result.state
  }
  return state
}

const suggest = (
  query: string,
  over: Partial<Parameters<typeof suggestPages>[0]> = {},
  ...manifests: Record<string, unknown>[]
): ReturnType<typeof suggestPages> =>
  suggestPages({
    registry: registry(...(manifests.length > 0 ? manifests : [UNITS, SOLVER, SHOP])),
    query,
    profileId: 'default',
    ...over
  })

describe('matching what a Page does', () => {
  it('offers the converter for a conversion query', () => {
    const results = suggest('convert celsius to fahrenheit', {
      intents: [{ intent: 'conversion', confidence: 0.9 }]
    })
    assert.equal(results[0]?.page.manifest.slug, 'unit-converter')
  })

  it('offers a Page named outright', () => {
    const results = suggest('unit converter')
    assert.equal(results[0]?.page.manifest.slug, 'unit-converter')
    assert.ok(results[0].confidence > 0.7)
  })

  it('recognises an alias', () => {
    const results = suggest('solver')
    assert.equal(results[0]?.page.manifest.slug, 'equation-solver')
    assert.ok(results[0].because.some((one) => /another name for/.test(one)))
  })

  it('does not put the converter in front of somebody shopping for a converter cable', () => {
    // The word matches; the intent does not. This is the case keyword matching alone gets wrong.
    const results = suggest('hdmi converter cable', { intents: [{ intent: 'shopping', confidence: 0.9 }] })
    assert.notEqual(results[0]?.page.manifest.slug, 'unit-converter')
  })

  it('weighs intent by how confident the query is in it', () => {
    const sure = suggest('convert this', { intents: [{ intent: 'conversion', confidence: 0.95 }] })
    const unsure = suggest('convert this', { intents: [{ intent: 'conversion', confidence: 0.4 }] })
    assert.ok((sure[0]?.confidence ?? 0) > (unsure[0]?.confidence ?? 0))
  })
})

describe('the floor', () => {
  it('shows nothing for a query that matches nothing', () => {
    assert.deepEqual(suggest('best pizza in rome'), [])
  })

  it('does not let a shared tag alone be enough', () => {
    // "maths" is a tag on the solver and nothing else matches. One weak signal must not clear the floor.
    const results = suggest('maths')
    assert.deepEqual(results, [])
  })

  it('does not let weak signals stack up to a strong one', () => {
    // Several tag and keyword hits, no name match and no intent. Combining as fractions keeps this below a real match.
    const weak = suggest('units measurement conversion metres')
    const strong = suggest('unit converter')
    if (weak.length > 0) {
      assert.ok(weak[0].confidence < strong[0].confidence, 'stacked weak signals outscored a name match')
    }
  })

  it('ignores words too common to be evidence', () => {
    assert.deepEqual(suggest('what is the'), [])
    assert.deepEqual(suggest('how can you use this'), [])
  })

  it('shows nothing for an empty or absurd query', () => {
    assert.deepEqual(suggest(''), [])
    assert.deepEqual(suggest('   '), [])
    assert.deepEqual(suggest('x'.repeat(PAGE_SEARCH_LIMITS.queryLength + 1)), [])
  })

  it('never interrupts somebody typing a web address', () => {
    assert.deepEqual(suggest('unit converter', { looksLikeUrl: true }), [])
  })
})

describe('how much is shown', () => {
  it('never offers more than a few', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      manifest({
        pageId: `page_${String(i).repeat(28).slice(0, 28)}`,
        slug: `converter-${i}`,
        title: `Converter ${i}`,
        description: `Converter number ${i}, which converts things between units of the same kind.`,
        tags: ['conversion'],
        search: { summary: 'Converts things.', keywords: ['convert'], intents: ['convert'], aliases: [] }
      })
    )
    const results = suggest('convert', { intents: [{ intent: 'conversion', confidence: 0.9 }] }, ...many)
    assert.ok(results.length <= PAGE_SEARCH_LIMITS.shown, `showed ${results.length}`)
  })

  it('shows the best first', () => {
    const results = suggest('convert units', { intents: [{ intent: 'conversion', confidence: 0.9 }] })
    for (let i = 0; i + 1 < results.length; i++) {
      assert.ok(results[i].confidence >= results[i + 1].confidence)
    }
  })

  it('leaves out a Page that cannot open', () => {
    let state = registry(UNITS)
    state = {
      pages: state.pages.map((one) => ({ ...one, status: 'incompatible' as const, note: 'needs a newer Orbis' })),
      aliases: state.aliases
    }
    assert.deepEqual(suggestPages({ registry: state, query: 'unit converter', profileId: 'default' }), [])
  })
})

describe('saying why', () => {
  it('gives a reason for every suggestion', () => {
    const results = suggest('convert celsius', { intents: [{ intent: 'conversion', confidence: 0.9 }] })
    assert.ok(results.length > 0)
    for (const one of results) {
      assert.ok(one.because.length > 0, 'a suggestion with no reason cannot be debugged')
      for (const reason of one.because) assert.ok(reason.length > 5)
    }
  })

  it('names the intent it matched', () => {
    const results = suggest('convert celsius', { intents: [{ intent: 'conversion', confidence: 0.9 }] })
    assert.ok(results[0].because.some((one) => /which is what Unit Converter does/.test(one)))
  })

  it('translates between the two vocabularies rather than comparing strings and hoping', () => {
    // Search says "conversion"; a manifest says "convert". Comparing them directly matches nothing, which is exactly
    // what happened before this table existed -- the whole intent signal was dead while appearing to work.
    assert.ok(wordsForIntent('conversion').includes('convert'))
    assert.ok(wordsForIntent('calculation').includes('calculate'))
    // An intent no Page could act on maps to nothing at all.
    assert.deepEqual([...wordsForIntent('navigational')], [])
    assert.deepEqual([...wordsForIntent('entity')], [])
  })

  it('cannot be walked up a prototype chain by an intent name', () => {
    assert.deepEqual([...wordsForIntent('constructor' as never)], [])
  })

  it('names the keywords it matched', () => {
    const results = suggest('celsius fahrenheit', { intents: [{ intent: 'conversion', confidence: 0.8 }] })
    assert.ok(results[0].because.some((one) => /it handles/.test(one)))
  })
})

describe('prefilling', () => {
  it('passes the query to a Page that can start from one', () => {
    const results = suggest('convert 20 celsius to fahrenheit', { intents: [{ intent: 'conversion', confidence: 0.9 }] })
    assert.equal(results[0].prefill, 'convert 20 celsius to fahrenheit')
  })

  it('passes nothing to a Page that cannot', () => {
    const results = suggest('cable catalogue', { intents: [{ intent: 'shopping', confidence: 0.9 }] })
    assert.equal(results[0]?.prefill, null)
  })
})

describe('having used it before', () => {
  it('nudges a Page that already matched', () => {
    const without = suggest('convert units', { intents: [{ intent: 'conversion', confidence: 0.8 }] })
    const with_ = suggest('convert units', {
      intents: [{ intent: 'conversion', confidence: 0.8 }],
      opened: { page_1111111111111111111111111111: 5 }
    })
    assert.ok((with_[0]?.confidence ?? 0) > (without[0]?.confidence ?? 0))
  })

  it('does not promote a Page that did not match on its own', () => {
    const results = suggest('best pizza in rome', { opened: { page_1111111111111111111111111111: 100 } })
    assert.deepEqual(results, [])
  })

  it('nudges only a little', () => {
    const results = suggest('convert units', {
      intents: [{ intent: 'conversion', confidence: 0.8 }],
      opened: { page_1111111111111111111111111111: 1000 }
    })
    assert.ok(results[0].confidence <= 1)
  })
})

describe('where it goes on the page', () => {
  const module = (query: string, over: Partial<Parameters<typeof pagesModule>[0]> = {}): ReturnType<typeof pagesModule> =>
    pagesModule({ registry: registry(UNITS, SOLVER, SHOP), query, profileId: 'default', ...over })

  it('is absent when nothing matches', () => {
    const result = module('best pizza in rome')
    assert.equal(result.show, false)
    assert.equal(result.suggestions.length, 0)
  })

  it('goes above the web results when a Page does exactly this', () => {
    const result = module('unit converter')
    assert.equal(result.show, true)
    assert.equal(result.rank, 1)
    assert.match(result.heading, /Do this in Orbis/)
  })

  it('goes below the web results when a Page is merely related', () => {
    const result = module('celsius', { intents: [{ intent: 'conversion', confidence: 0.55 }] })
    if (result.show) {
      assert.equal(result.rank, 7)
      assert.match(result.heading, /Related/)
    }
  })

  it('always says why it is there', () => {
    assert.ok(module('unit converter').because.length > 5)
  })
})

describe('opening one straight away', () => {
  it('opens a Page somebody named exactly', () => {
    const result = directPage({ registry: registry(UNITS, SOLVER, SHOP), query: 'unit converter', profileId: 'default' })
    assert.equal(result?.page.manifest.slug, 'unit-converter')
  })

  it('does not open anything for a merely good match', () => {
    const result = directPage({
      registry: registry(UNITS, SOLVER, SHOP),
      query: 'convert celsius',
      profileId: 'default',
      intents: [{ intent: 'conversion', confidence: 0.7 }]
    })
    assert.equal(result, null)
  })

  it('does not open anything when two Pages are nearly as good as each other', () => {
    const twin = manifest({
      pageId: 'page_4444444444444444444444444444',
      slug: 'unit-converter-pro',
      title: 'Unit Converter',
      description: 'Another Page that also converts units between one another, with the same name as the first.',
      tags: ['units'],
      capabilities: ['computation.units'],
      search: { summary: 'Converts units.', keywords: ['convert'], intents: ['convert'], aliases: [] }
    })
    const result = directPage({
      registry: registry(UNITS, twin),
      query: 'unit converter',
      profileId: 'default'
    })
    // Ambiguous, so it is offered rather than acted on.
    assert.equal(result, null)
  })

  it('does not open anything for a web address', () => {
    const result = directPage({
      registry: registry(UNITS),
      query: 'unit converter',
      profileId: 'default',
      looksLikeUrl: true
    })
    assert.equal(result, null)
  })
})

describe('assumptions', () => {
  it('says a weak match shows nothing', () => {
    assert.ok(PAGE_SEARCH_ASSUMPTIONS.some((one) => /A weak match shows nothing/.test(one)))
  })

  it('says Orbis does not fill space with its own features', () => {
    assert.ok(PAGE_SEARCH_ASSUMPTIONS.some((one) => /own features above what you searched for/.test(one)))
  })

  it('says every suggestion explains itself', () => {
    assert.ok(PAGE_SEARCH_ASSUMPTIONS.some((one) => /says why it was chosen/.test(one)))
  })
})
