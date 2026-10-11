import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketsStore } from './store.ts'
import { resolveExperience } from '../../shared/markets/experience.ts'
import { applyDraft, EMPTY_DRAFT, type OnboardingDraft } from '../../shared/markets/onboarding.ts'
import type { Instrument } from '../../shared/markets/instrument.ts'

/**
 * The experience profile and the first launch, on disk.
 *
 * The questions and the adaptation engine are tested where they live. What is tested here is the part that can go wrong
 * in a way somebody would notice a week later: whether a profile survives a restart, whether applying a setup is all or
 * nothing, and whether one profile's answers can reach another's.
 */

const bench = async (): Promise<{ store: MarketsStore; dir: string; done: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-experience-'))
  const store = new MarketsStore(dir)
  return {
    store,
    dir,
    done: async () => {
      store.stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

const btc: Instrument = {
  instrumentId: 'binance:crypto:binance:btcusdt',
  symbol: 'BTCUSDT',
  name: 'BTC / USDT',
  assetType: 'crypto',
  exchange: 'binance',
  currency: 'USDT',
  provider: 'binance'
}

const eth: Instrument = { ...btc, instrumentId: 'binance:crypto:binance:ethusdt', symbol: 'ETHUSDT', name: 'ETH / USDT' }

const choice = (one: Instrument) => ({ instrumentId: one.instrumentId, symbol: one.symbol, name: one.name })

const draft = (patch: Partial<OnboardingDraft> = {}): OnboardingDraft => ({ ...EMPTY_DRAFT, ...patch })

test('a new profile has not been asked yet, and has a complete configuration anyway', async () => {
  const { store, done } = await bench()
  try {
    const record = await store.onboarding('p1')
    assert.equal(record.completed, false)
    assert.equal(record.draft, null)
    const resolved = resolveExperience(await store.experience('p1'))
    assert.ok(resolved.get('panels').length > 0)
    assert.equal(resolved.get('density'), 'balanced')
  } finally {
    await done()
  }
})

test('a profile survives a restart', async () => {
  const { store, dir, done } = await bench()
  try {
    await store.setExperience('p1', { level: 'professional', goals: ['charts'], indicators: ['rsi'] })
    await store.flush()
    const again = new MarketsStore(dir)
    const read = await again.experience('p1')
    assert.equal(read.level, 'professional')
    assert.deepEqual(read.indicators, ['rsi'])
  } finally {
    await done()
  }
})

test('changing the level keeps what somebody set by hand', async () => {
  const { store, done } = await bench()
  try {
    await store.setExperienceOverride('p1', { chartType: 'ohlc' })
    await store.setExperience('p1', { level: 'beginner' })
    const resolved = resolveExperience(await store.experience('p1'))
    assert.equal(resolved.get('chartType'), 'ohlc')
    assert.equal(resolved.level, 'beginner')
  } finally {
    await done()
  }
})

test('resetting the presentation settings leaves everything else alone', async () => {
  const { store, done } = await bench()
  try {
    await store.createWatchlist('p1', 'Mine')
    await store.setExperience('p1', { level: 'professional' })
    await store.setExperienceOverride('p1', { density: 'minimal' })
    await store.resetExperience('p1')

    const profile = await store.experience('p1')
    assert.deepEqual(profile.overrides, {})
    // The level and the answers behind it stay: this resets what was overridden, not who somebody said they were.
    assert.equal(profile.level, 'professional')
    assert.equal((await store.watchlists('p1')).length, 1)
  } finally {
    await done()
  }
})

test('a term is remembered as read, once', async () => {
  const { store, done } = await bench()
  try {
    await store.markLearned('p1', 'marketCap')
    await store.markLearned('p1', 'marketCap')
    await store.markLearned('p1', 'rsi')
    assert.deepEqual((await store.experience('p1')).learned, ['marketCap', 'rsi'])
  } finally {
    await done()
  }
})

test('a draft is written as somebody goes, and is not the profile', async () => {
  const { store, dir, done } = await bench()
  try {
    await store.saveDraft('p1', draft({ step: 'goals', path: 'full', profile: { level: 'expert' } }))
    await store.flush()

    const again = new MarketsStore(dir)
    const record = await again.onboarding('p1')
    assert.equal(record.draft?.step, 'goals')
    assert.equal(record.draft?.profile.level, 'expert')
    // Eight screens in is not a configuration. Nothing has been applied.
    assert.equal((await again.experience('p1')).level, 'intermediate')
    assert.equal(record.completed, false)
  } finally {
    await done()
  }
})

test('a draft arriving after setup finished is ignored, because it is a stale window', async () => {
  const { store, done } = await bench()
  try {
    await store.completeOnboarding('p1', applyDraft(draft({ profile: { level: 'professional' } })))
    await store.saveDraft('p1', draft({ step: 'goals', profile: { level: 'beginner' } }))
    const record = await store.onboarding('p1')
    assert.equal(record.draft, null)
    assert.equal((await store.experience('p1')).level, 'professional')
  } finally {
    await done()
  }
})

test('applying a setup writes the profile, the ticker, the currency and the watchlist together', async () => {
  const { store, done } = await bench()
  try {
    const applied = applyDraft(
      draft({
        profile: { level: 'professional', goals: ['charts'] },
        ticker: 'yes',
        tickerAssets: [choice(btc), choice(eth)],
        currencyMode: 'manual',
        currency: 'INR',
        watchlistAssets: [choice(btc)],
        watchlistName: 'Mine'
      })
    )
    await store.completeOnboarding('p1', applied, [btc, eth])

    const workspace = await store.read('p1')
    assert.equal(workspace.experience.level, 'professional')
    assert.equal(workspace.ticker.enabled, true)
    assert.deepEqual(workspace.ticker.groups[0].instrumentIds, [btc.instrumentId, eth.instrumentId])
    assert.equal(workspace.ticker.activeGroupId, workspace.ticker.groups[0].id)
    assert.equal(workspace.currency.code, 'INR')
    assert.equal(workspace.currency.mode, 'manual')
    assert.equal(workspace.watchlists[0].name, 'Mine')
    assert.equal(workspace.watchlists[0].items[0].instrumentId, btc.instrumentId)
    assert.equal(workspace.onboarding.completed, true)
    assert.equal(workspace.onboarding.draft, null)
    // The instruments are remembered, so the list draws before any provider answers.
    assert.ok(workspace.known.some((one) => one.instrumentId === btc.instrumentId))
  } finally {
    await done()
  }
})

test('a market no provider could describe is not written as a row with nothing behind it', async () => {
  const { store, done } = await bench()
  try {
    const applied = applyDraft(
      draft({
        watchlistAssets: [choice(btc), { instrumentId: 'binance:crypto:binance:ghost', symbol: 'GHOSTUSDT', name: '' }],
        ticker: 'yes'
      })
    )
    // Only bitcoin resolved. The other is dropped rather than written with a symbol and no instrument.
    await store.completeOnboarding('p1', applied, [btc])
    const workspace = await store.read('p1')
    assert.equal(workspace.watchlists[0].items.length, 1)
    assert.deepEqual(workspace.ticker.groups[0].instrumentIds, [btc.instrumentId])
  } finally {
    await done()
  }
})

test('applying a setup with no markets creates no empty watchlist', async () => {
  const { store, done } = await bench()
  try {
    await store.completeOnboarding('p1', applyDraft(draft({ profile: { level: 'beginner' } })))
    assert.deepEqual((await store.read('p1')).watchlists, [])
  } finally {
    await done()
  }
})

test('a ticker somebody had already set up is not replaced by one from setup', async () => {
  const { store, done } = await bench()
  try {
    await store.setTickerGroup('p1', { id: 'mine', name: 'Mine', instrumentIds: [eth.instrumentId] })
    await store.completeOnboarding(
      'p1',
      applyDraft(draft({ ticker: 'yes', tickerAssets: [choice(btc)] })),
      [btc, eth]
    )
    const workspace = await store.read('p1')
    assert.equal(workspace.ticker.groups.length, 1)
    assert.equal(workspace.ticker.groups[0].id, 'mine')
    // Their group survives; what setup decided is whether the strip is showing.
    assert.equal(workspace.ticker.enabled, true)
  } finally {
    await done()
  }
})

test('skipping is recorded as skipping, and leaves a complete configuration', async () => {
  const { store, done } = await bench()
  try {
    const record = await store.skipOnboarding('p1')
    assert.equal(record.completed, true)
    assert.equal(record.skipped, true)
    const resolved = resolveExperience(await store.experience('p1'))
    assert.equal(resolved.get('density'), 'balanced')
    assert.ok(resolved.get('panels').length > 0)
    // Nothing was switched on that nobody asked for.
    assert.equal((await store.ticker('p1')).enabled, false)
  } finally {
    await done()
  }
})

test('running setup again does not delete anything', async () => {
  const { store, done } = await bench()
  try {
    await store.createWatchlist('p1', 'Mine')
    await store.completeOnboarding('p1', applyDraft(draft({ profile: { level: 'expert' } })))
    await store.restartOnboarding('p1')

    const workspace = await store.read('p1')
    assert.equal(workspace.onboarding.completed, false)
    assert.equal(workspace.watchlists.length, 1)
    // Their answers stand until they answer differently.
    assert.equal(workspace.experience.level, 'expert')
  } finally {
    await done()
  }
})

test('one profile cannot see another profile’s answers', async () => {
  const { store, done } = await bench()
  try {
    await store.completeOnboarding('p1', applyDraft(draft({ profile: { level: 'beginner' }, ticker: 'yes' })), [btc])
    await store.completeOnboarding('p2', applyDraft(draft({ profile: { level: 'expert' }, ticker: 'no' })), [btc])

    assert.equal((await store.experience('p1')).level, 'beginner')
    assert.equal((await store.experience('p2')).level, 'expert')
    assert.equal((await store.ticker('p2')).enabled, false)

    await store.profileChanged()
    assert.equal((await store.experience('p1')).level, 'beginner')
    assert.equal((await store.experience('p2')).level, 'expert')
  } finally {
    await done()
  }
})

test('somebody who already had Markets set up is not turned into a beginner by the upgrade', async () => {
  const { store, dir, done } = await bench()
  try {
    // A profile from before any of this existed: lists, alerts and a chart they had configured.
    await store.createWatchlist('p1', 'Mine')
    const lists = await store.watchlists('p1')
    await store.addToWatchlist('p1', lists[0].id, btc)
    await store.saveAlert('p1', {
      instrumentId: btc.instrumentId,
      subject: { kind: 'price' },
      condition: { kind: 'above', value: 1 }
    })
    await store.setLayout('p1', { section: 'markets', interval: '4h', chartType: 'ohlc' })
    await store.flush()

    // Strip the experience out of the file, as an older Orbis would have left it.
    const { readdir, readFile, writeFile } = await import('node:fs/promises')
    const walk = async (at: string): Promise<string | null> => {
      for (const entry of await readdir(at, { withFileTypes: true })) {
        const path = join(at, entry.name)
        if (entry.isDirectory()) {
          const found = await walk(path)
          if (found) return found
        } else if (entry.name === 'markets.json') return path
      }
      return null
    }
    const path = await walk(dir)
    assert.ok(path)
    const raw = JSON.parse(await readFile(path, 'utf8'))
    delete raw.experience
    delete raw.onboarding
    await writeFile(path, JSON.stringify(raw))

    const again = new MarketsStore(dir)
    const profile = await again.experience('p1')
    assert.notEqual(profile.level, 'beginner')
    // Their chart settings became explicit overrides, so no preset can undo them.
    assert.equal(profile.overrides.chartType, 'ohlc')
    assert.equal(profile.overrides.defaultInterval, '4h')
    // And they are asked once, which is an offer rather than a reset: their list is still there.
    assert.equal((await again.onboarding('p1')).completed, false)
    assert.equal((await again.watchlists('p1'))[0].items.length, 1)
  } finally {
    await done()
  }
})
