import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasesFor, assetFor, assetOf, baseSymbol, describeAsset, LOGO_SIZES, namedSymbols, underlyingSymbol } from './assets.ts'
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

test('a known asset offers every source, the versioned one first', () => {
  const asset = assetFor('BTC')
  assert.equal(asset.logoUrls[0], asset.logoUrl, 'logoUrl is the head of the list')
  // The CC0 set is versioned, so what it returns today it returns next year, and it is flat artwork at a known size.
  // The rest are asked only when it has no answer, ending with the exchanges, which carry the newest listings.
  assert.match(asset.logoUrls[0], /cryptocurrency-icons@/)
  assert.match(asset.logoUrls[1], /coincap/)
  assert.ok(
    asset.logoUrls.some((one) => one.includes('bnbstatic')),
    'an exchange is asked, because an icon set cannot carry a coin listed last week'
  )
  assert.equal(new Set(asset.logoUrls).size, asset.logoUrls.length, 'no place is asked twice')
})

test('a tokenised stock is asked for under the name its logo is filed under', () => {
  /**
   * The exchange's convention: the market is CBRS, the asset in its own registry is CBRSB, and the image exists only
   * under the second. Every tokenised-equity market showed bare letters until this was asked for, and those are
   * exactly the newest listings, which no icon set carries either.
   */
  const asset = assetFor('CBRS')
  assert.ok(
    asset.logoUrls.some((one) => /CBRSB|cbrsb/.test(one)),
    `the suffixed form must be among the candidates: ${asset.logoUrls.join(' ')}`
  )
})

test('an asset nobody has named still gets candidates, because a logo is not a name', () => {
  // ZZZ has no entry in the registry, so its name stays ZZZ -- and it is still worth asking whether a logo exists.
  const asset = assetFor('ZZZ')
  assert.equal(asset.named, false)
  assert.equal(asset.name, 'ZZZ')
  assert.ok(asset.logoUrls.length >= 2)
  assert.ok(asset.logoUrls.every((one) => one.toLowerCase().includes('zzz')), 'and never somebody else’s')
})

// ---------------------------------------------------------------- contracts are not coins

test('a lot-sized contract wears its coin’s logo and name, and keeps its own symbol', () => {
  /**
   * A perpetual on a cheap coin is quoted in lots, so the contract is called 1000SHIB -- one contract is a thousand
   * SHIB. That prefix belongs to the contract, not to the coin, and no icon set anywhere carries an entry called
   * 1000SHIB, so dozens of these markets showed bare letters on a grey circle for ever.
   *
   * The symbol on screen stays the contract's, because 1000SHIB and SHIB are different markets at different prices
   * and showing both as SHIB would be wrong in a worse way.
   */
  const contract = assetFor('1000SHIB')
  assert.equal(contract.symbol, '1000SHIB', 'the contract keeps its own symbol')
  assert.equal(contract.name, assetFor('SHIB').name, 'and takes the coin’s name')
  assert.deepEqual([...contract.logoUrls], [...assetFor('SHIB').logoUrls], 'and the coin’s logo')
})

test('every lot size is understood, and a bare number is not a coin', () => {
  for (const [contract, coin] of [
    ['1000PEPE', 'PEPE'],
    ['1000000MOG', 'MOG'],
    ['10000SATS', 'SATS'],
    ['1000BONK', 'BONK']
  ] as const) {
    assert.equal(underlyingSymbol(contract), coin, contract)
  }
  // Nothing is left after the digits, so there is no coin here and the symbol stands as it is.
  assert.equal(underlyingSymbol('1000'), '1000')
  assert.equal(underlyingSymbol('1000000'), '1000000')
  // A coin whose name genuinely starts with a digit is not a lot size being stripped.
  assert.equal(underlyingSymbol('0G'), '0G')
})

test('a coin is never mistaken for a contract on another coin', () => {
  // SHIB must not be read as a lot of HIB, and the ordinary case must be left completely alone.
  for (const plain of ['BTC', 'SHIB', 'ETH', 'SOL', 'LUNA']) {
    assert.equal(underlyingSymbol(plain), plain, plain)
  }
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
  assert.ok(asset.logoUrls.length >= 2, 'it is asked about like any other ticker')
})

test('every candidate is keyed by the same ticker, so one cannot answer for another asset', () => {
  /**
   * The rule that matters most about this list: showing the wrong logo is worse than showing none, because the screen
   * looks entirely normal while being wrong about which coin you are reading. So every address in it has to be built
   * from this asset's own ticker and nothing else.
   *
   * Checked case-insensitively and at the start of the last path segment, because the places asked disagree about
   * both: one wants `sol.svg`, another `SOL.png`, and the exchanges file a tokenised stock under `SOLB`. All three are
   * this asset; none of them could be another.
   */
  const asset = assetFor('SOL')
  assert.ok(asset.logoUrls.length >= 2)
  for (const url of asset.logoUrls) {
    const last = url.slice(url.lastIndexOf('/') + 1)
    assert.match(last, /^sol/i, url)
  }
})
