import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasesFor, assetFor, assetOf, baseSymbol, describeAsset, LOGO_SIZES, namedSymbols } from './assets.ts'
import type { Instrument } from './instrument.ts'

/**
 * What an asset is, as opposed to what it is trading at.
 *
 * The tests that matter are about not lying with a picture: a pair is not an asset, a name is not invented from a
 * ticker, and an unknown asset never borrows a known one's logo. Getting any of these wrong produces a screen that
 * looks completely normal and is wrong about which coin you are looking at.
 */

const instrument = (over: Partial<Instrument> = {}): Instrument => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  symbol: 'BTCUSDT',
  name: 'BTC / USDT',
  assetType: 'crypto',
  exchange: 'binance',
  currency: 'USDT',
  provider: 'binance',
  ...over
})

// ---------------------------------------------------------------- a pair is not an asset

test('the quote currency is trimmed off a pair to find the asset', () => {
  // Asking for a logo for "BTCUSDT" asks for something that does not exist and never will.
  assert.equal(baseSymbol('BTCUSDT', 'USDT'), 'BTC')
  assert.equal(baseSymbol('ETHBTC', 'BTC'), 'ETH')
  assert.equal(baseSymbol('SOLUSDC', 'USDC'), 'SOL')
})

test('the longest matching quote currency wins', () => {
  // BTCUSDT ends with both USDT and T; trimming the shorter would leave BTCUSD and look for a logo that is not there.
  assert.equal(baseSymbol('BTCUSDT'), 'BTC')
  assert.equal(baseSymbol('ETHFDUSD'), 'ETH')
})

test('a symbol that is all quote currency keeps itself', () => {
  // Trimming USDTUSD to nothing would leave an asset with no identity at all.
  assert.equal(baseSymbol('USDTUSD', 'USD'), 'USDT')
  assert.equal(baseSymbol('USD', 'USD'), 'USD')
})

test('the provider’s own metadata is preferred over guessing', () => {
  const asset = assetOf(instrument({ symbol: 'WEIRDPAIR', metadata: { base: 'WEIRD' } }))
  assert.equal(asset.symbol, 'WEIRD')
})

test('without metadata the symbol is read as a pair', () => {
  assert.equal(assetOf(instrument()).symbol, 'BTC')
  assert.equal(assetOf(instrument({ symbol: 'ETHUSDT', currency: 'USDT' })).symbol, 'ETH')
})

// ---------------------------------------------------------------- names are facts, not guesses

test('a known asset gets its real name', () => {
  assert.equal(assetFor('BTC').name, 'Bitcoin')
  assert.equal(assetFor('ETH').name, 'Ethereum')
  assert.equal(assetFor('SOL').name, 'Solana')
  assert.equal(assetFor('BTC').named, true)
})

test('an unknown ticker keeps its ticker rather than being given a name', () => {
  // "ZZZ" is not "Zzz Coin". Inventing a name is the same failure as inventing a price.
  const unknown = assetFor('ZZZ')
  assert.equal(unknown.name, 'ZZZ')
  assert.equal(unknown.named, false)
})

test('case and punctuation do not make a different asset', () => {
  assert.equal(assetFor('btc').assetId, assetFor('BTC').assetId)
  assert.equal(assetFor('b-t-c').symbol, 'BTC')
})

test('different ways of writing one market reach the same asset', () => {
  const fromPair = assetOf(instrument({ symbol: 'BTCUSDT', currency: 'USDT' }))
  const fromBase = assetFor('BTC', 'binance')
  const fromMeta = assetOf(instrument({ symbol: 'ANYTHING', metadata: { base: 'btc' } }))
  assert.equal(fromPair.assetId, fromBase.assetId)
  assert.equal(fromMeta.assetId, fromBase.assetId)
  assert.equal(fromPair.logoUrl, fromBase.logoUrl)
})

// ---------------------------------------------------------------- logos

test('a logo url is for the asset, never for the pair', () => {
  const asset = assetOf(instrument())
  assert.ok(asset.logoUrl?.endsWith('/btc.svg'), asset.logoUrl ?? 'none')
  assert.ok(!asset.logoUrl?.includes('usdt'))
})

test('an asset whose symbol could not be a logo asks for none', () => {
  // Rather than requesting something guaranteed to fail, over and over, for every row.
  assert.equal(assetFor('').logoUrl, null)
  assert.equal(assetFor('A').logoUrl, null)
  assert.equal(assetFor('AVERYLONGTICKERNAME').logoUrl, null)
})

test('an unknown asset gets no logo rather than somebody else’s', () => {
  // The worst possible failure: a screen that looks completely normal and is wrong about which coin it shows.
  const unknown = assetFor('ZZZQQ')
  const bitcoin = assetFor('BTC')
  assert.notEqual(unknown.logoUrl, bitcoin.logoUrl)
  assert.ok(unknown.logoUrl?.endsWith('/zzzqq.svg'), 'it must ask for its own, and fall back when that 404s')
})

test('the logo source is named, so it can be checked', () => {
  assert.ok(assetFor('BTC').logoSource?.includes('CC0'))
})

test('two providers calling something the same thing are different assets', () => {
  // A future second provider's "SOL" must not silently inherit Solana's identity.
  assert.notEqual(assetFor('SOL', 'binance').assetId, assetFor('SOL', 'elsewhere').assetId)
  assert.equal(assetFor('SOL', 'binance').symbol, assetFor('SOL', 'elsewhere').symbol)
})

// ---------------------------------------------------------------- what is said about it

test('an asset describes itself with both name and symbol where it has both', () => {
  // The logo is never the only thing saying which asset this is.
  assert.equal(describeAsset(assetFor('BTC')), 'Bitcoin (BTC)')
  assert.equal(describeAsset(assetFor('ZZZ')), 'ZZZ')
})

test('the aliases are the ones prose actually uses', () => {
  assert.ok(aliasesFor('BTC').includes('bitcoin'))
  assert.ok(aliasesFor('XRP').includes('ripple'))
  assert.deepEqual(aliasesFor('ZZZ'), [])
})

test('every named asset is complete and unique', () => {
  const symbols = namedSymbols()
  assert.ok(symbols.length >= 40, `only ${symbols.length} named assets`)
  for (const symbol of symbols) {
    const asset = assetFor(symbol)
    assert.ok(asset.name.length > 0, `${symbol} has no name`)
    assert.equal(asset.named, true)
    assert.equal(asset.symbol, symbol)
  }
})

test('the sizes are a fixed set, so surfaces cannot drift apart', () => {
  assert.deepEqual(Object.keys(LOGO_SIZES), ['tiny', 'small', 'medium', 'large', 'hero'])
  const values = Object.values(LOGO_SIZES)
  for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1], 'the sizes are not in order')
})

// ---------------------------------------------------------------- a second place to look

test('a known asset offers both sources, the versioned one first', () => {
  const asset = assetFor('BTC')
  assert.equal(asset.logoUrls.length, 2)
  assert.equal(asset.logoUrls[0], asset.logoUrl, 'logoUrl is the head of the list')
  // The CC0 set is versioned, so what it returns today it returns next year. The live service is the fallback.
  assert.match(asset.logoUrls[0], /cryptocurrency-icons@/)
  assert.match(asset.logoUrls[1], /coincap/)
})

test('an asset nobody has named still gets both candidates, because a logo is not a name', () => {
  // ZZZ has no entry in the registry, so its name stays ZZZ -- and it is still worth asking whether a logo exists.
  const asset = assetFor('ZZZ')
  assert.equal(asset.named, false)
  assert.equal(asset.name, 'ZZZ')
  assert.equal(asset.logoUrls.length, 2)
})

test('a symbol that could not be one is asked about nowhere', () => {
  // Too short, too long, and nothing left after the punctuation is stripped. "B-C" is not in this list on purpose:
  // it strips to "BC", which is a perfectly ordinary ticker, and refusing it would be wrong.
  for (const bad of ['', 'A', 'TOOLONGASYMBOL', '---']) {
    const asset = assetFor(bad)
    assert.equal(asset.logoUrl, null, bad)
    assert.deepEqual([...asset.logoUrls], [], bad)
  }
})

test('punctuation is stripped rather than treated as a reason to refuse', () => {
  const asset = assetFor('B-C')
  assert.equal(asset.symbol, 'BC')
  assert.equal(asset.logoUrls.length, 2)
})

test('both candidates are keyed by the same ticker, so one cannot answer for another asset', () => {
  const asset = assetFor('SOL')
  for (const url of asset.logoUrls) {
    assert.match(url, /\bsol\b/, url)
  }
})
