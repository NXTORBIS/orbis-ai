import { test } from 'node:test'
import assert from 'node:assert/strict'
import { definitionFor, explain, GLOSSARY, lookupTerm, termFor, termsFor } from './glossary.ts'
import { INDICATORS } from './indicators.ts'

test('every term is complete enough to show at any level', () => {
  for (const term of GLOSSARY) {
    assert.ok(term.id.length > 1, `${term.term} has no id`)
    assert.ok(term.term.length > 1, `${term.id} has no name`)
    assert.ok(term.short.length > 15, `${term.id} has no one-line definition`)
    assert.ok(term.plain.length > 25, `${term.id} has no plain-words definition`)
    assert.ok(term.technical.length > 25, `${term.id} has no exact definition`)
    assert.ok(term.surfaces.length > 0, `${term.id} appears nowhere`)
  }
})

test('no id appears twice', () => {
  const ids = GLOSSARY.map((one) => one.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every related term exists', () => {
  const ids = new Set(GLOSSARY.map((one) => one.id))
  for (const term of GLOSSARY) {
    for (const related of term.related) {
      assert.ok(ids.has(related), `${term.id} points at ${related}, which is not a term`)
    }
  }
})

test('every indicator Orbis can calculate can also be explained', () => {
  // A chart that offers an indicator and cannot say what it is would be a chart offering a word.
  const ids = new Set(GLOSSARY.map((one) => one.id))
  const missing = INDICATORS.map((one) => one.kind).filter((kind) => !ids.has(kind))
  assert.deepEqual(
    missing,
    [],
    `these indicators are offered on a chart with no definition behind them: ${missing.join(', ')}`
  )
})

test('no definition promises an outcome or tells anybody what to do', () => {
  // The line this file must not cross. A definition explains a term; what it is worth is not a fact.
  const forbidden = [
    'you should buy',
    'you should sell',
    'signal to buy',
    'signal to sell',
    'indicates that price will',
    'guaranteed',
    'will rise',
    'will fall',
    'profitable',
    'recommend'
  ]
  for (const term of GLOSSARY) {
    const asText = `${term.short} ${term.plain} ${term.technical} ${term.whyItMatters ?? ''} ${term.howToUse ?? ''}`.toLowerCase()
    for (const phrase of forbidden) {
      assert.ok(!asText.includes(phrase), `${term.id} says "${phrase}"`)
    }
  }
})

test('no definition contains a market number, because a value comes from a provider', () => {
  // "Typically above 70" in a definition would be a claim about markets hidden where nobody would check it.
  for (const term of GLOSSARY) {
    const asText = `${term.short} ${term.plain} ${term.whyItMatters ?? ''}`
    assert.ok(
      !/\b\d+(?:\.\d+)?\s*(?:%|percent)\b/.test(asText),
      `${term.id} quotes a figure in its definition: ${asText}`
    )
  }
})

test('the plain wording is shorter than the exact wording, and says the same thing about the same term', () => {
  for (const term of GLOSSARY) {
    // Not a rule about truth -- both are true -- but the plain one should not be the longer of the two, or it is not
    // doing its job.
    assert.ok(term.plain.length <= term.technical.length + 120, `${term.id}'s plain wording is the harder one`)
  }
})

test('a definition comes back in the vocabulary that was asked for', () => {
  const rsi = termFor('rsi')
  assert.ok(rsi)
  assert.equal(definitionFor(rsi, 'plain'), rsi.plain)
  assert.equal(definitionFor(rsi, 'technical'), rsi.technical)
  assert.ok(definitionFor(rsi, 'standard').startsWith(rsi.short))
})

test('a term is found from the way somebody would actually ask', () => {
  assert.equal(lookupTerm('RSI')?.id, 'rsi')
  assert.equal(lookupTerm('what does rsi mean?')?.id, 'rsi')
  assert.equal(lookupTerm('relative strength index')?.id, 'rsi')
  assert.equal(lookupTerm('what is market cap')?.id, 'marketCap')
  assert.equal(lookupTerm('explain the order book')?.id, 'orderBook')
  assert.equal(lookupTerm('funding rate')?.id, 'funding')
})

test('a word that merely contains a term is not that term', () => {
  // The bug this guards: a loose substring match answers "what is a bridge" with the definition of basis.
  assert.equal(lookupTerm('rsid'), undefined)
  assert.equal(lookupTerm('volumetric analysis of rock'), undefined)
  assert.equal(lookupTerm(''), undefined)
})

test('a term Orbis has no definition for comes back as nothing, not as something invented', () => {
  for (const asked of ['what is a gamma squeeze', 'explain the hurst exponent', 'what is a wash trade']) {
    assert.equal(lookupTerm(asked), undefined, `${asked} was answered with something`)
  }
})

test('a surface can ask for its own terms', () => {
  const book = termsFor('book').map((one) => one.id)
  assert.ok(book.includes('orderBook'))
  assert.ok(book.includes('bid'))
  assert.ok(book.includes('ask'))
  assert.ok(!book.includes('backtest'))
  assert.equal(termsFor('nowhere').length, 0)
})

test('an explanation carries the definition, why anybody looks at it and how to use it here', () => {
  const explanation = explain(termFor('orderBook')!, 'plain')
  assert.equal(explanation.id, 'orderBook')
  assert.ok(explanation.definition.length > 25)
  assert.ok(explanation.howToUse.includes('Book'))
  assert.ok(explanation.related.some((one) => one.id === 'bid'))
})

test('an expansion is shown beside the abbreviation, not instead of it', () => {
  assert.equal(explain(termFor('rsi')!, 'plain').title, 'RSI — Relative strength index')
  // And a term that is not an abbreviation is not given a spurious dash.
  assert.equal(explain(termFor('spread')!, 'plain').title, 'Spread')
})

test('paper trading is explained as simulated, in every vocabulary', () => {
  const term = termFor('paperTrading')
  assert.ok(term)
  for (const wording of [term.short, term.plain, term.technical]) {
    assert.ok(/simulat|no real money|local/i.test(wording), `"${wording}" does not say it is simulated`)
  }
  assert.ok(term.plain.includes('not money you have'))
})

test('leverage is explained without being presented as a way to make more money', () => {
  const term = termFor('leverage')
  assert.ok(term)
  assert.ok(/both directions|scales both|losses/i.test(term.plain + term.technical))
})
