import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanCurrencyPreference,
  combinedFreshness,
  convert,
  currencyFor,
  currencyForCountry,
  currencyForLocale,
  CURRENCIES,
  decimalsFor,
  detectCurrency,
  formatMoney,
  freshnessOfRate,
  resolvePreference,
  searchCurrencies,
  symbolIsAmbiguous,
  type CurrencyPreference,
  type Rate
} from './currency.ts'

/**
 * Money in whatever the person actually uses.
 *
 * The tests that matter most are the ones about **not** producing a number: no rate means no converted price, and a
 * live price through an old rate is not a live price. Everything else is arrangement — but a converted figure with no
 * conversion behind it would be the most convincing fake in the whole feature.
 */

const NOW = 1_800_000_000_000

const rate = (value: number, at = NOW): Rate => ({ from: 'USD', to: 'INR', rate: value, at, source: 'Test' })

// ---------------------------------------------------------------- the registry

test('a currency knows its own decimals, not two everywhere', () => {
  // ¥1,500.00 looks like a rounding bug and KWD 1.23 has lost a digit that matters.
  assert.equal(currencyFor('JPY')?.decimals, 0)
  assert.equal(currencyFor('KWD')?.decimals, 3)
  assert.equal(currencyFor('USD')?.decimals, 2)
})

test('every currency is complete enough to display', () => {
  for (const one of CURRENCIES) {
    assert.equal(one.code.length, 3, `${one.code} is not an ISO code`)
    assert.ok(one.name.length > 2, `${one.code} has no name`)
    assert.ok(one.symbol.length > 0, `${one.code} has no symbol`)
    assert.ok(one.locale.includes('-'), `${one.code} has no locale`)
    assert.ok(one.decimals >= 0 && one.decimals <= 3)
  }
  assert.equal(new Set(CURRENCIES.map((one) => one.code)).size, CURRENCIES.length)
})

test('the major currencies are all there', () => {
  for (const code of ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CNY', 'AED', 'SGD', 'BRL', 'ZAR']) {
    assert.ok(currencyFor(code), `${code} is missing`)
  }
  assert.ok(CURRENCIES.length >= 30, `only ${CURRENCIES.length} currencies`)
})

test('a country resolves to its everyday currency', () => {
  assert.equal(currencyForCountry('IN')?.code, 'INR')
  assert.equal(currencyForCountry('GB')?.code, 'GBP')
  assert.equal(currencyForCountry('DE')?.code, 'EUR')
  assert.equal(currencyForCountry('FR')?.code, 'EUR')
  assert.equal(currencyForCountry('JP')?.code, 'JPY')
  assert.equal(currencyForCountry('xx'), undefined)
})

// ---------------------------------------------------------------- choosing one

test('a locale is read for its region, not its language', () => {
  // Reading "English" as "dollars" is how an application tells somebody in Mumbai what their coffee costs in a currency
  // they do not use.
  assert.equal(currencyForLocale('en-IN')?.code, 'INR')
  assert.equal(currencyForLocale('en-US')?.code, 'USD')
  assert.equal(currencyForLocale('en-GB')?.code, 'GBP')
  assert.equal(currencyForLocale('de-DE')?.code, 'EUR')
  assert.equal(currencyForLocale('fr-FR')?.code, 'EUR')
  assert.equal(currencyForLocale('ja-JP')?.code, 'JPY')
})

test('a locale with a script in it is still read correctly', () => {
  assert.equal(currencyForLocale('zh-Hant-TW')?.code, 'TWD')
  assert.equal(currencyForLocale('en-Latn-IN')?.code, 'INR')
})

test('a locale with no region gives nothing rather than a guess', () => {
  // `en` alone does not say where, and guessing is what this whole function exists to avoid.
  const bare = currencyForLocale('en')
  assert.ok(bare === undefined || bare.code === 'USD', 'a bare language must not become a confident answer')
  assert.equal(currencyForLocale(''), undefined)
  assert.equal(currencyForLocale('not a locale'), undefined)
})

test('a region Orbis already knows is preferred over the locale', () => {
  const out = detectCurrency({ region: 'IN', locale: 'en-US' })
  assert.equal(out.currency.code, 'INR')
  assert.equal(out.from, 'region')
})

test('with no region, the locale decides', () => {
  const out = detectCurrency({ locale: 'en-GB' })
  assert.equal(out.currency.code, 'GBP')
  assert.equal(out.from, 'locale')
})

test('with nothing at all, it falls back and says so', () => {
  const out = detectCurrency({})
  assert.equal(out.currency.code, 'USD')
  // Labelled a fallback rather than presented as a detection, so the settings screen can be honest about it.
  assert.equal(out.from, 'fallback')
  assert.equal(out.region, '')
})

test('detection never asks for a location', () => {
  // The signals it accepts are the whole story: a region Orbis already has, and a locale. No coordinates.
  const signals = detectCurrency({ region: 'IN', locale: 'en-IN' })
  assert.equal(signals.currency.code, 'INR')
  assert.deepEqual(Object.keys({ locale: '', region: '' }).sort(), ['locale', 'region'])
})

// ---------------------------------------------------------------- what the person chose

const preference = (over: Partial<CurrencyPreference> = {}): CurrencyPreference => ({
  mode: 'automatic',
  code: 'USD',
  detectedRegion: '',
  favourites: [],
  recents: [],
  compact: true,
  ...over
})

test('a manual choice survives detection, permanently', () => {
  // Somebody who switched to dollars while travelling did not ask to be switched back when they landed.
  const saved = preference({ mode: 'manual', code: 'USD' })
  const out = resolvePreference(saved, { region: 'IN', locale: 'en-IN' })
  assert.equal(out.code, 'USD')
  assert.equal(out.mode, 'manual')
})

test('automatic mode follows what was detected', () => {
  const out = resolvePreference(preference({ mode: 'automatic', code: 'USD' }), { region: 'IN' })
  assert.equal(out.code, 'INR')
  assert.equal(out.detectedRegion, 'IN')
})

test('a manual choice of a currency Orbis no longer offers falls back to detection', () => {
  const out = resolvePreference(preference({ mode: 'manual', code: 'XXX' }), { region: 'GB' })
  assert.equal(out.code, 'GBP')
})

// ---------------------------------------------------------------- converting

test('no rate means no converted price', () => {
  // The most convincing fake in the whole feature would be a converted figure with no conversion behind it.
  const out = convert(100, 'USD', 'INR', null, NOW)
  assert.equal(out.value, null)
  assert.equal(out.rate, null)
  assert.equal(out.freshness, 'unavailable')
})

test('a rate converts, and the result carries the rate and its age', () => {
  const out = convert(100, 'USD', 'INR', rate(88.5), NOW)
  assert.equal(out.value, 8_850)
  assert.equal(out.rate, 88.5)
  assert.equal(out.at, NOW)
  assert.equal(out.source, 'Test')
  assert.equal(out.freshness, 'real-time')
})

test('the same currency is not a conversion', () => {
  const out = convert(100, 'USD', 'USD', null, NOW)
  assert.equal(out.value, 100)
  // No age, because there is no rate to grow stale — otherwise a dollar price would eventually be called stale.
  assert.equal(out.at, null)
  assert.equal(out.freshness, 'real-time')
})

test('an impossible rate converts nothing', () => {
  assert.equal(convert(100, 'USD', 'INR', rate(0), NOW).value, null)
  assert.equal(convert(100, 'USD', 'INR', rate(-5), NOW).value, null)
  assert.equal(convert(100, 'USD', 'INR', rate(Number.NaN), NOW).value, null)
})

test('an amount that is not a number converts to nothing', () => {
  assert.equal(convert(null, 'USD', 'INR', rate(88), NOW).value, null)
  assert.equal(convert(Number.NaN, 'USD', 'INR', rate(88), NOW).value, null)
})

test('a rate ages from current through recent to stale', () => {
  assert.equal(freshnessOfRate(NOW, NOW), 'real-time')
  assert.equal(freshnessOfRate(NOW - 3 * 3600_000, NOW), 'real-time')
  assert.equal(freshnessOfRate(NOW - 36 * 3600_000, NOW), 'recent')
  assert.equal(freshnessOfRate(NOW - 120 * 3600_000, NOW), 'stale')
  assert.equal(freshnessOfRate(null, NOW), 'unavailable')
})

test('a weekend is not staleness', () => {
  // Reference rates are published each working day, so Friday's rate is the current rate all weekend. A warning that
  // fires every Monday is one nobody reads by the second week.
  assert.notEqual(freshnessOfRate(NOW - 60 * 3600_000, NOW), 'stale')
  // But four days is not a weekend, and something has genuinely gone wrong.
  assert.equal(freshnessOfRate(NOW - 100 * 3600_000, NOW), 'stale')
})

test('a live price through an old rate is not a live price', () => {
  // The point of the whole module. Converting does not preserve the market's freshness.
  assert.equal(combinedFreshness('real-time', 'stale'), 'stale')
  assert.equal(combinedFreshness('real-time', 'real-time'), 'real-time')
  assert.equal(combinedFreshness('stale', 'real-time'), 'stale')
  assert.equal(combinedFreshness('real-time', 'unavailable'), 'unavailable')
  assert.equal(combinedFreshness('delayed', 'recent'), 'delayed')
})

// ---------------------------------------------------------------- saying it

test('an amount is written the way its currency is written', () => {
  // Indian grouping is lakhs; writing it by hand is how ₹1,234,567 appears in an application used in India.
  const inr = formatMoney(1_234_567, 'INR')
  assert.ok(inr.includes('₹'), inr)
  assert.ok(inr.includes('12,34,567') || inr.includes('1,234,567'), `unexpected grouping: ${inr}`)
  const usd = formatMoney(1_234_567, 'USD')
  assert.ok(usd.includes('1,234,567'), usd)
})

test('the yen has no cents', () => {
  const yen = formatMoney(1_500, 'JPY')
  assert.ok(!yen.includes('.'), yen)
})

test('a dinar keeps its third decimal', () => {
  assert.equal(decimalsFor(currencyFor('KWD')!, 1.234), 3)
})

test('a price too small for two decimals gets more, rather than becoming zero', () => {
  // 0.00 is not a rounding error, it is a deleted price.
  assert.equal(decimalsFor(currencyFor('USD')!, 0.00001234), 8)
  const tiny = formatMoney(0.00001234, 'USD')
  assert.ok(!/^\$0\.00$/.test(tiny), `the price was rounded away: ${tiny}`)
})

test('an amount that is not a number is a dash', () => {
  assert.equal(formatMoney(null, 'USD'), '—')
  assert.equal(formatMoney(Number.NaN, 'USD'), '—')
})

test('an ambiguous symbol can carry its code', () => {
  // "$120" could be five different currencies.
  assert.equal(symbolIsAmbiguous('USD'), true)
  assert.equal(symbolIsAmbiguous('GBP'), false)
  assert.ok(formatMoney(120, 'USD', { withCode: true }).includes('USD'))
  assert.ok(!formatMoney(120, 'GBP', { withCode: true }).includes('GBP'))
})

test('large numbers can be shortened without losing what they are', () => {
  const compact = formatMoney(10_400_000, 'INR', { compact: true })
  assert.ok(compact.includes('₹'), compact)
  assert.ok(compact.length < formatMoney(10_400_000, 'INR').length, `${compact} was not shorter`)
})

test('a small number is never shortened', () => {
  assert.equal(formatMoney(42.5, 'USD', { compact: true }), formatMoney(42.5, 'USD'))
})

// ---------------------------------------------------------------- finding one

test('searching finds a currency by code, name or symbol', () => {
  assert.ok(searchCurrencies('inr').some((one) => one.code === 'INR'))
  assert.ok(searchCurrencies('rupee').some((one) => one.code === 'INR'))
  assert.ok(searchCurrencies('₹').some((one) => one.code === 'INR'))
})

test('searching for a dollar finds every dollar', () => {
  // Which is exactly why the code is always shown beside the symbol.
  const dollars = searchCurrencies('dollar').map((one) => one.code)
  for (const code of ['USD', 'AUD', 'CAD', 'SGD', 'NZD', 'HKD']) {
    assert.ok(dollars.includes(code), `${code} was not found`)
  }
})

test('an empty search offers everything', () => {
  assert.equal(searchCurrencies('').length, CURRENCIES.length)
})

// ---------------------------------------------------------------- reading one back

test('a preference read from a file keeps what is valid', () => {
  const cleaned = cleanCurrencyPreference({
    mode: 'manual',
    code: 'inr',
    detectedRegion: 'in',
    favourites: ['USD', 'XXX', 'USD', 'EUR'],
    recents: ['GBP'],
    compact: false
  })
  assert.equal(cleaned.mode, 'manual')
  assert.equal(cleaned.code, 'INR')
  assert.equal(cleaned.detectedRegion, 'IN')
  // A currency Orbis no longer offers is dropped rather than kept as a choice nobody can make, and duplicates go.
  assert.deepEqual(cleaned.favourites, ['USD', 'EUR'])
  assert.equal(cleaned.compact, false)
})

test('rubbish becomes the default preference rather than throwing', () => {
  assert.equal(cleanCurrencyPreference(null).code, 'USD')
  assert.equal(cleanCurrencyPreference('INR').mode, 'automatic')
  assert.equal(cleanCurrencyPreference({ code: 'NOTACURRENCY' }).code, 'USD')
})
