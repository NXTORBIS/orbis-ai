import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetsIn, baseOf, newsAbout, normaliseNews, NEWS_SOURCES, sameStory } from './news.ts'
import type { Instrument } from './instrument.ts'

/**
 * Crypto headlines from publishers' own feeds.
 *
 * The tests that matter are about **not** attaching a story to a market it is not about. Matching a symbol anywhere in
 * a headline looks fine until "SOL" turns up inside "SOLD" and a news panel starts confidently mislabelling stories — a
 * panel that attaches fewer is better than one that attaches the wrong ones.
 */

const source = (id: string, name: string) => ({ id, name, url: `https://${id}.example/rss`, home: `https://${id}.example` })

const item = (title: string, url: string, publishedAt?: number) => ({ title, url, source: 'x', publishedAt })

const KNOWN = ['BTC', 'ETH', 'SOL', 'OP', 'XRP', 'DOGE']

// ---------------------------------------------------------------- which market a headline is about

test('a symbol on a word boundary is a match', () => {
  assert.deepEqual(assetsIn('BTC falls below $80,000', KNOWN), ['BTC'])
  assert.deepEqual(assetsIn('ETH and SOL both rally', KNOWN), ['ETH', 'SOL'])
})

test('a symbol buried inside another word is not a match', () => {
  // This is the whole point. "SOL" is inside "SOLD" and "CONSOLIDATES"; "OP" is inside "OPENS" and "CRYPTO".
  assert.deepEqual(assetsIn('Miner SOLD its holdings', KNOWN), [])
  assert.deepEqual(assetsIn('Market CONSOLIDATES after a week of losses', KNOWN), [])
  assert.deepEqual(assetsIn('Exchange OPENS in Singapore', KNOWN), [])
})

test('a short symbol in lower case is not a match', () => {
  // "sol" in prose is almost never Solana; "SOL" in a headline almost always is.
  assert.deepEqual(assetsIn('on solid ground after the sell-off', KNOWN), [])
  assert.deepEqual(assetsIn('SOL leads the majors', KNOWN), ['SOL'])
})

test('an asset’s name in prose is a match', () => {
  assert.deepEqual(assetsIn('Bitcoin falls below $80,000', KNOWN), ['BTC'])
  assert.deepEqual(assetsIn('Ethereum developers set a date', KNOWN), ['ETH'])
  assert.deepEqual(assetsIn('Ripple wins its appeal', KNOWN), ['XRP'])
})

test('a name inside a longer word is not a match', () => {
  assert.deepEqual(assetsIn('Bitcoiners gather in Prague', KNOWN), [])
})

test('a headline about nothing in the list names nothing', () => {
  // Not "a bit of everything" and not the majors by default: a story about regulation is not a story about bitcoin.
  assert.deepEqual(assetsIn('Regulators publish new guidance for exchanges', KNOWN), [])
  assert.deepEqual(assetsIn('', KNOWN), [])
})

test('only assets that were asked about are looked for', () => {
  assert.deepEqual(assetsIn('SOL and DOGE rally', ['BTC']), [])
})

test('a symbol with regular-expression characters cannot become a pattern', () => {
  // An asset called `C++` must not compile into a quantifier and throw, or match everything.
  assert.doesNotThrow(() => assetsIn('C++ developers ship a client', ['C++']))
})

// ---------------------------------------------------------------- the same story twice

test('two publishers’ wording of one story is recognised as one', () => {
  assert.equal(
    sameStory('Bitcoin falls below $80,000 as ETFs bleed', 'Bitcoin falls below $80,000 amid ETF outflows'),
    true
  )
})

test('two different stories about the same coin stay separate', () => {
  assert.equal(
    sameStory('Bitcoin falls below $80,000 as ETFs bleed', 'Bitcoin miners report record hashrate this quarter'),
    false
  )
})

test('opposite stories are not merged, however much wording they share', () => {
  // The case that broke counting shared words: three words of four in common, and the fourth reverses the meaning.
  assert.equal(sameStory('Bitcoin price falls today after the open', 'Bitcoin price rises today after the open'), false)
})

test('two short unrelated titles are not merged just because their only long word matches', () => {
  assert.equal(sameStory('Story 0', 'Story 1'), false)
})

test('an empty headline matches nothing', () => {
  assert.equal(sameStory('', 'Bitcoin falls'), false)
})

// ---------------------------------------------------------------- putting the feeds together

test('feeds become one list, newest first', () => {
  const items = normaliseNews(
    [
      { source: source('a', 'Alpha'), items: [item('Bitcoin rises', 'https://a/1', 3_000)] },
      { source: source('b', 'Beta'), items: [item('Ethereum upgrade lands', 'https://b/1', 5_000)] }
    ],
    { known: KNOWN }
  )
  assert.deepEqual(items.map((one) => one.title), ['Ethereum upgrade lands', 'Bitcoin rises'])
  assert.deepEqual(items[0].assets, ['ETH'])
  assert.equal(items[0].publisher, 'Beta')
})

test('a story two publishers carry appears once, naming both', () => {
  const items = normaliseNews(
    [
      { source: source('a', 'Alpha'), items: [item('Bitcoin falls below $80,000 as ETFs bleed', 'https://a/1', 3_000)] },
      { source: source('b', 'Beta'), items: [item('Bitcoin falls below $80,000 amid ETF outflows', 'https://b/1', 2_900)] }
    ],
    { known: KNOWN }
  )
  assert.equal(items.length, 1)
  assert.equal(items[0].publisher, 'Alpha')
  // "Two publishers carried this" is worth more than two rows saying the same thing.
  assert.deepEqual(items[0].alsoIn, ['Beta'])
})

test('the same link from two feeds is one item', () => {
  const items = normaliseNews(
    [
      { source: source('a', 'Alpha'), items: [item('A headline', 'https://shared/story?utm=a', 3_000)] },
      { source: source('b', 'Beta'), items: [item('A headline', 'https://shared/story?utm=b', 3_000)] }
    ],
    { known: KNOWN }
  )
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].alsoIn, ['Beta'])
})

test('a headline with no link or no title is dropped', () => {
  // Neither can be read nor checked, and a row that cannot be opened is not a headline.
  const items = normaliseNews(
    [{ source: source('a', 'Alpha'), items: [item('', 'https://a/1'), item('No link', ''), item('Real one', 'https://a/2')] }],
    { known: KNOWN }
  )
  assert.deepEqual(items.map((one) => one.title), ['Real one'])
})

test('an undated story goes last rather than being dated now', () => {
  const items = normaliseNews(
    [
      { source: source('a', 'Alpha'), items: [item('Undated story', 'https://a/1')] },
      { source: source('b', 'Beta'), items: [item('Dated story', 'https://b/1', 1_000)] }
    ],
    { known: KNOWN }
  )
  assert.deepEqual(items.map((one) => one.title), ['Dated story', 'Undated story'])
  assert.equal(items[0].publishedAt, 1_000)
  // Not "now": the feed did not say, and inventing a date would sort it above real news.
  assert.equal(items[1].publishedAt, null)
})

test('no feeds give no headlines rather than an error', () => {
  assert.deepEqual(normaliseNews([], { known: KNOWN }), [])
})

test('the limit is respected', () => {
  const many = Array.from({ length: 40 }, (_v, i) => item(`Story ${i}`, `https://a/${i}`, i))
  assert.equal(normaliseNews([{ source: source('a', 'Alpha'), items: many }], { known: KNOWN, limit: 5 }).length, 5)
})

// ---------------------------------------------------------------- filtering to a market

test('headlines about one asset are the ones that name it', () => {
  const items = normaliseNews(
    [
      {
        source: source('a', 'Alpha'),
        items: [item('Bitcoin rises', 'https://a/1', 3), item('Ethereum upgrade', 'https://a/2', 2), item('Regulators speak', 'https://a/3', 1)]
      }
    ],
    { known: KNOWN }
  )
  assert.deepEqual(newsAbout(items, 'BTC').map((one) => one.title), ['Bitcoin rises'])
  assert.deepEqual(newsAbout(items, 'DOGE'), [])
})

// ---------------------------------------------------------------- instruments

test('a pair’s base asset is what a headline would name', () => {
  const pair = (symbol: string, currency: string, base?: string): Instrument => ({
    instrumentId: `binance:crypto:binance:${symbol.toLowerCase()}`,
    symbol,
    name: symbol,
    assetType: 'crypto',
    exchange: 'binance',
    currency,
    provider: 'binance',
    metadata: base ? { base } : undefined
  })
  assert.equal(baseOf(pair('BTCUSDT', 'USDT', 'BTC')), 'BTC')
  // Without metadata, the quote currency is trimmed off the pair, which is what a pair's symbol is.
  assert.equal(baseOf(pair('ETHUSDT', 'USDT')), 'ETH')
  assert.equal(baseOf(pair('WEIRD', '')), 'WEIRD')
})

// ---------------------------------------------------------------- the sources themselves

test('every default source is a publisher’s own feed over https', () => {
  // Feeds are published for syndication; nothing here scrapes a page.
  assert.ok(NEWS_SOURCES.length >= 3)
  for (const one of NEWS_SOURCES) {
    assert.ok(one.url.startsWith('https://'), `${one.id} is not https`)
    assert.ok(one.home.startsWith('https://'), `${one.id} has no home`)
    assert.ok(one.name.length > 0)
  }
  assert.equal(new Set(NEWS_SOURCES.map((one) => one.id)).size, NEWS_SOURCES.length)
})
