import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketsStore } from './store.ts'
import type { Instrument } from '../../shared/markets/instrument.ts'

/**
 * Watchlists, ticker groups and alerts on disk.
 *
 * Choices, not data. So the tests are about them surviving: a restart, a provider being unreachable, a file somebody has
 * edited by hand, and a switch to another profile that must not bring one person's lists into another's.
 */

const bench = async (): Promise<{ store: MarketsStore; dir: string; done: () => Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-markets-'))
  const store = new MarketsStore(dir)
  return {
    store,
    dir,
    done: async () => {
      store.stop()
      await rm(dir, { recursive: true, force: true })
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

/** Where the store put a profile's file. */
const find = async (dir: string): Promise<string> => {
  const { readdir } = await import('node:fs/promises')
  const walk = async (at: string): Promise<string | null> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        const found = await walk(path)
        if (found) return found
      } else if (entry.name === 'markets.json') {
        return path
      }
    }
    return null
  }
  const found = await walk(dir)
  assert.ok(found, 'nothing was written')
  return found
}

// ---------------------------------------------------------------- nothing, to begin with

test('a profile that has never opened Markets has an empty workspace, not an error', async () => {
  const w = await bench()
  try {
    const workspace = await w.store.read('default')
    assert.deepEqual(workspace.watchlists, [])
    assert.deepEqual(workspace.alerts, [])
    assert.equal(workspace.ticker.enabled, false)
    assert.deepEqual(await w.store.watching('default'), [])
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- watchlists

test('a watchlist is made, added to, and survives a restart', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'My crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    await w.store.addToWatchlist('default', list.id, eth)
    await w.store.flush()

    const after = new MarketsStore(w.dir)
    const lists = await after.watchlists('default')
    assert.equal(lists.length, 1)
    assert.equal(lists[0].name, 'My crypto')
    assert.deepEqual(
      lists[0].items.map((i) => i.instrument.symbol),
      ['BTCUSDT', 'ETHUSDT']
    )
    after.stop()
  } finally {
    await w.done()
  }
})

test('the instrument’s details are kept, so the list draws with the provider unreachable', async () => {
  // This is the point of keeping choices apart from data: the row has a symbol and a name before any price arrives.
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    const item = (await w.store.watchlists('default'))[0].items[0]
    assert.equal(item.instrument.name, 'BTC / USDT')
    assert.equal(item.instrument.currency, 'USDT')
    // And it is remembered globally too, so anything else asking about it need not search again.
    assert.ok((await w.store.known('default')).some((k) => k.instrumentId === btc.instrumentId))
  } finally {
    await w.done()
  }
})

test('the same instrument is not added twice', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    await w.store.addToWatchlist('default', list.id, btc)
    assert.equal((await w.store.watchlists('default'))[0].items.length, 1)
  } finally {
    await w.done()
  }
})

test('removing takes the item out and leaves the rest', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    await w.store.addToWatchlist('default', list.id, eth)
    await w.store.removeFromWatchlist('default', list.id, btc.instrumentId)
    assert.deepEqual(
      (await w.store.watchlists('default'))[0].items.map((i) => i.instrument.symbol),
      ['ETHUSDT']
    )
  } finally {
    await w.done()
  }
})

test('a list is renamed and removed', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Old')
    await w.store.renameWatchlist('default', list.id, 'New')
    assert.equal((await w.store.watchlists('default'))[0].name, 'New')
    await w.store.removeWatchlist('default', list.id)
    assert.deepEqual(await w.store.watchlists('default'), [])
  } finally {
    await w.done()
  }
})

test('an unnamed list still has a name', async () => {
  const w = await bench()
  try {
    assert.equal((await w.store.createWatchlist('default', '   ')).name, 'Watchlist')
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- the ticker

test('the ticker is off until it is switched on, and then it stays on', async () => {
  const w = await bench()
  try {
    assert.equal((await w.store.ticker('default')).enabled, false)
    await w.store.setTicker('default', { enabled: true, speed: 60, size: 'normal' })
    await w.store.flush()

    const after = new MarketsStore(w.dir)
    const ticker = await after.ticker('default')
    assert.equal(ticker.enabled, true)
    assert.equal(ticker.speed, 60)
    assert.equal(ticker.size, 'normal')
    after.stop()
  } finally {
    await w.done()
  }
})

test('a group is added, changed and removed, and the active one follows', async () => {
  const w = await bench()
  try {
    await w.store.setTickerGroup('default', { id: 'g1', name: 'Crypto', instrumentIds: [btc.instrumentId] })
    await w.store.setTicker('default', { ...(await w.store.ticker('default')), enabled: true })
    assert.equal((await w.store.ticker('default')).activeGroupId, 'g1')

    await w.store.setTickerGroup('default', { id: 'g1', name: 'Renamed', instrumentIds: [btc.instrumentId, eth.instrumentId] })
    const ticker = await w.store.ticker('default')
    assert.equal(ticker.groups.length, 1)
    assert.equal(ticker.groups[0].name, 'Renamed')
    assert.equal(ticker.groups[0].instrumentIds.length, 2)

    await w.store.removeTickerGroup('default', 'g1')
    assert.equal((await w.store.ticker('default')).activeGroupId, '', 'no group left to be active')
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- alerts

test('an alert is saved, changed and removed', async () => {
  const w = await bench()
  try {
    const saved = await w.store.saveAlert('default', {
      id: 'a1',
      instrumentId: btc.instrumentId,
      comparison: 'above',
      value: 100000
    })
    assert.equal(saved?.value, 100000)
    await w.store.saveAlert('default', { id: 'a1', instrumentId: btc.instrumentId, comparison: 'above', value: 120000 })
    assert.equal((await w.store.alerts('default')).length, 1)
    assert.equal((await w.store.alerts('default'))[0].value, 120000)
    await w.store.removeAlert('default', 'a1')
    assert.deepEqual(await w.store.alerts('default'), [])
  } finally {
    await w.done()
  }
})

test('something that is not an alert is not saved', async () => {
  const w = await bench()
  try {
    assert.equal(await w.store.saveAlert('default', { nonsense: true }), null)
    assert.deepEqual(await w.store.alerts('default'), [])
  } finally {
    await w.done()
  }
})

test('an alert’s memory is written back without touching its condition', async () => {
  // The memory advances constantly in the background; the condition is somebody's setting. Confusing the two would let a
  // background update quietly rewrite what an alert is for.
  const w = await bench()
  try {
    await w.store.saveAlert('default', { id: 'a1', instrumentId: btc.instrumentId, comparison: 'above', value: 100000 })
    await w.store.rememberAlertState('default', [
      {
        id: 'a1',
        instrumentId: btc.instrumentId,
        label: 'tampered',
        subject: { kind: 'price' },
        comparison: 'below',
        value: 1,
        repeat: 'every-time',
        cooldownMs: 0,
        dailyLimit: 0,
        enabled: true,
        createdAt: 0,
        lastValue: 99000,
        lastFiredAt: 555
      }
    ])
    const [alert] = await w.store.alerts('default')
    assert.equal(alert.lastValue, 99000, 'the memory advanced')
    assert.equal(alert.lastFiredAt, 555)
    assert.equal(alert.comparison, 'above', 'and the condition did not change')
    assert.equal(alert.value, 100000)
    assert.equal(alert.label, '')
  } finally {
    await w.done()
  }
})

test('remembering the state of an alert that is gone changes nothing', async () => {
  const w = await bench()
  try {
    await w.store.rememberAlertState('default', [
      {
        id: 'ghost',
        instrumentId: btc.instrumentId,
        label: '',
        subject: { kind: 'price' },
        comparison: 'above',
        value: 1,
        repeat: 'every-time',
        cooldownMs: 0,
        dailyLimit: 0,
        enabled: true,
        createdAt: 0
      }
    ])
    assert.deepEqual(await w.store.alerts('default'), [])
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- what is watched

test('what is watched is the ticker, the lists and the live alerts together', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    await w.store.setTickerGroup('default', { id: 'g1', name: 'T', instrumentIds: [eth.instrumentId] })
    await w.store.setTicker('default', { ...(await w.store.ticker('default')), enabled: true, activeGroupId: 'g1' })
    await w.store.saveAlert('default', {
      id: 'a1',
      instrumentId: 'binance:crypto:binance:solusdt',
      comparison: 'above',
      value: 1
    })
    const watching = (await w.store.watching('default')).sort()
    assert.deepEqual(watching, [btc.instrumentId, 'binance:crypto:binance:solusdt', eth.instrumentId].sort())
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- profiles

test('one profile’s markets are not another’s', async () => {
  const w = await bench()
  try {
    const mine = await w.store.createWatchlist('one', 'Mine')
    await w.store.addToWatchlist('one', mine.id, btc)
    await w.store.createWatchlist('two', 'Theirs')
    await w.store.flush()

    assert.deepEqual((await w.store.watchlists('one')).map((l) => l.name), ['Mine'])
    assert.deepEqual((await w.store.watchlists('two')).map((l) => l.name), ['Theirs'])
    assert.deepEqual(await w.store.watching('two'), [])
  } finally {
    await w.done()
  }
})

test('changing profile writes what was pending and forgets the rest', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('one', 'Mine')
    await w.store.addToWatchlist('one', list.id, btc)
    await w.store.profileChanged()
    // Written before the cache was dropped, so it is still there when the profile comes back.
    assert.equal((await w.store.watchlists('one'))[0].items.length, 1)
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- the file itself

test('the file holds no credential, because there is none to hold', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('default', 'Crypto')
    await w.store.addToWatchlist('default', list.id, btc)
    await w.store.saveAlert('default', { id: 'a1', instrumentId: btc.instrumentId, comparison: 'above', value: 1 })
    await w.store.flush()
    const written = (await readFile(await find(w.dir), 'utf8')).toLowerCase()
    for (const word of ['apikey', 'api_key', 'secret', 'token', 'password', 'bearer']) {
      assert.ok(!written.includes(word), `"${word}" is in the markets file`)
    }
  } finally {
    await w.done()
  }
})

test('a file somebody has edited by hand is read for what it can give', async () => {
  const w = await bench()
  try {
    await w.store.createWatchlist('default', 'Real')
    await w.store.flush()
    const path = await find(w.dir)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        watchlists: [{ id: 'kept', name: 'Kept', items: [{ instrument: btc }] }, 'nonsense', null],
        ticker: { enabled: 'yes', speed: -400, groups: [{ id: 'g', instrumentIds: ['a', 'a'] }] },
        alerts: [{ broken: true }]
      })
    )
    const after = new MarketsStore(w.dir)
    const workspace = await after.read('default')
    assert.equal(workspace.watchlists.length, 1)
    assert.equal(workspace.watchlists[0].name, 'Kept')
    assert.equal(workspace.ticker.enabled, false, 'a string is not a boolean')
    assert.equal(workspace.ticker.speed, 5, 'a negative speed is clamped')
    assert.deepEqual(workspace.ticker.groups[0].instrumentIds, ['a'])
    assert.deepEqual(workspace.alerts, [])
    after.stop()
  } finally {
    await w.done()
  }
})

test('a file that cannot be read at all is an empty workspace, not a failure', async () => {
  const w = await bench()
  try {
    await w.store.createWatchlist('default', 'Real')
    await w.store.flush()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(await find(w.dir), 'this is not json')
    const after = new MarketsStore(w.dir)
    assert.deepEqual((await after.read('default')).watchlists, [])
    after.stop()
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- following along

test('anything watching the store is told when something changes', async () => {
  const w = await bench()
  try {
    const seen: string[] = []
    w.store.onChange((profileId) => seen.push(profileId))
    await w.store.createWatchlist('default', 'Crypto')
    assert.deepEqual(seen, ['default'])
  } finally {
    await w.done()
  }
})

test('a listener that throws does not stop the change being written', async () => {
  const w = await bench()
  try {
    w.store.onChange(() => {
      throw new Error('this screen is broken')
    })
    await w.store.createWatchlist('default', 'Crypto')
    await w.store.flush()
    assert.equal((await w.store.watchlists('default')).length, 1)
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- import and export

test('an export round-trips through an import', async () => {
  const w = await bench()
  try {
    const list = await w.store.createWatchlist('one', 'Mine')
    await w.store.addToWatchlist('one', list.id, btc)
    const exported = await w.store.export('one')
    await w.store.import('two', exported)
    assert.deepEqual((await w.store.watchlists('two')).map((l) => l.name), ['Mine'])
  } finally {
    await w.done()
  }
})

test('an import of rubbish leaves an empty workspace rather than a broken one', async () => {
  const w = await bench()
  try {
    await w.store.createWatchlist('one', 'Mine')
    await w.store.import('one', 'not a workspace')
    assert.deepEqual(await w.store.watchlists('one'), [])
  } finally {
    await w.done()
  }
})

// ---------------------------------------------------------------- the master switch

test('the master switch survives a restart', async () => {
  const { store, dir, done } = await bench()
  try {
    assert.equal(await store.enabled('one'), true)
    await store.setEnabled('one', false)
    await store.flush()
    const again = new MarketsStore(dir)
    assert.equal(await again.enabled('one'), false)
    again.stop()
  } finally {
    await done()
  }
})

test('switching Markets off leaves the watchlists and ticker groups alone', async () => {
  const { store, done } = await bench()
  try {
    const list = await store.createWatchlist('one', 'Core')
    await store.addToWatchlist('one', list.id, btc)
    await store.setTickerGroup('one', { id: 'g1', name: 'Main', instrumentIds: [eth.instrumentId] })
    // The ticker on as well, so the test can tell the master switch apart from the ticker's own switch.
    await store.setTicker('one', { ...(await store.ticker('one')), enabled: true })
    await store.setEnabled('one', false)

    // Off, and nothing lost: switching back on should find the same lists rather than an empty Markets.
    assert.equal(await store.enabled('one'), false)
    assert.deepEqual((await store.watchlists('one'))[0].items.map((i) => i.instrumentId), [btc.instrumentId])
    assert.deepEqual((await store.ticker('one')).groups[0].instrumentIds, [eth.instrumentId])
    assert.equal((await store.ticker('one')).enabled, true)
    // But nothing is watched while it is off.
    assert.deepEqual(await store.watching('one'), [])

    await store.setEnabled('one', true)
    assert.deepEqual((await store.watching('one')).sort(), [btc.instrumentId, eth.instrumentId].sort())
  } finally {
    await done()
  }
})

test('one profile’s master switch is not another’s', async () => {
  const { store, done } = await bench()
  try {
    await store.setEnabled('one', false)
    assert.equal(await store.enabled('one'), false)
    assert.equal(await store.enabled('two'), true)
  } finally {
    await done()
  }
})

// ---------------------------------------------------------------- closing down

test('closing writes down a change that was still waiting', async () => {
  const { store, dir, done } = await bench()
  try {
    // Changed and not flushed: this is the state Orbis is in for a second after every edit.
    const list = await store.createWatchlist('one', 'Nearly lost')
    await store.addToWatchlist('one', list.id, btc)
    // No flush. Closing is what has to save it, or a watchlist made a moment before quitting disappears.
    store.stop()

    const again = new MarketsStore(dir)
    const found = await again.watchlists('one')
    assert.equal(found.length, 1)
    assert.equal(found[0].name, 'Nearly lost')
    assert.deepEqual(found[0].items.map((i) => i.instrumentId), [btc.instrumentId])
    again.stop()
  } finally {
    await done()
  }
})

test('closing with nothing waiting writes nothing and does not throw', async () => {
  const { store, done } = await bench()
  try {
    store.stop()
    store.stop()
  } finally {
    await done()
  }
})

// ---------------------------------------------------------------- alerts that have fired

test('a firing is recorded, and the history survives a restart', async () => {
  const { store, dir, done } = await bench()
  try {
    await store.recordFiring('one', {
      alertId: 'a1',
      instrumentId: btc.instrumentId,
      symbol: 'BTCUSDT',
      label: 'BTC above 100,000',
      value: 100_001,
      at: 1_700_000_000_000
    })
    store.stop()

    const again = new MarketsStore(dir)
    const history = await again.alertHistory('one')
    assert.equal(history.length, 1)
    assert.equal(history[0].value, 100_001)
    assert.equal(history[0].label, 'BTC above 100,000')
    again.stop()
  } finally {
    await done()
  }
})

test('the history stops growing rather than filling the file', async () => {
  const { store, done } = await bench()
  try {
    // An alert on a busy market can fire every cooldown for a week.
    for (let i = 0; i < 260; i++) {
      await store.recordFiring('one', {
        alertId: 'a1',
        instrumentId: btc.instrumentId,
        symbol: 'BTCUSDT',
        label: `firing ${i}`,
        value: i,
        at: 1_700_000_000_000 + i
      })
    }
    const history = await store.alertHistory('one')
    assert.equal(history.length, 200)
    // The newest are kept: the oldest are what a history can afford to forget.
    assert.equal(history[history.length - 1].label, 'firing 259')
    assert.equal(history[0].label, 'firing 60')
  } finally {
    await done()
  }
})

test('clearing the history leaves the alerts themselves alone', async () => {
  const { store, done } = await bench()
  try {
    await store.saveAlert('one', {
      id: 'a1',
      instrumentId: btc.instrumentId,
      subject: { kind: 'price' },
      comparison: 'above',
      value: 1
    })
    await store.recordFiring('one', {
      alertId: 'a1',
      instrumentId: btc.instrumentId,
      symbol: 'BTCUSDT',
      label: 'fired',
      value: 2,
      at: 1_700_000_000_000
    })
    await store.clearAlertHistory('one')
    assert.deepEqual(await store.alertHistory('one'), [])
    assert.equal((await store.alerts('one')).length, 1)
  } finally {
    await done()
  }
})

// ---------------------------------------------------------------- saved screens

test('a screen saves its definition and survives a restart', async () => {
  const { store, dir, done } = await bench()
  try {
    const saved = await store.saveScreen('one', 'Oversold', {
      conditions: [{ field: 'rsi', operator: 'lt', value: 30, period: 14, interval: '1h' }],
      match: 'all',
      sort: { field: 'rsi', direction: 'asc' },
      limit: 25
    })
    assert.equal(saved.name, 'Oversold')
    store.stop()

    const again = new MarketsStore(dir)
    const screens = await again.screens('one')
    assert.equal(screens.length, 1)
    assert.equal(screens[0].query.conditions[0].field, 'rsi')
    assert.equal(screens[0].query.limit, 25)
    again.stop()
  } finally {
    await done()
  }
})

test('saving over a screen keeps its id rather than making a second one', async () => {
  const { store, done } = await bench()
  try {
    const first = await store.saveScreen('one', 'Mine', { conditions: [{ field: 'price', operator: 'gt', value: 1 }] })
    const second = await store.saveScreen('one', 'Mine, edited', { conditions: [{ field: 'price', operator: 'gt', value: 2 }] }, first.id)
    assert.equal(second.id, first.id)
    const screens = await store.screens('one')
    assert.equal(screens.length, 1)
    assert.equal(screens[0].name, 'Mine, edited')
    assert.equal(screens[0].query.conditions[0].value, 2)
    // The moment it was first made is not rewritten by an edit.
    assert.equal(screens[0].createdAt, first.createdAt)
  } finally {
    await done()
  }
})

test('a screen read back from a hand-edited file is re-validated, not trusted', async () => {
  const { store, done } = await bench()
  try {
    const saved = await store.saveScreen('one', 'Dirty', {
      conditions: [
        { field: 'not a field', operator: 'gt', value: 1 },
        { field: 'rsi', operator: 'whatever', value: 30, period: 0 }
      ],
      limit: 999_999
    })
    assert.equal(saved.query.conditions.length, 1)
    assert.equal(saved.query.conditions[0].operator, 'gt')
    assert.equal(saved.query.conditions[0].period, undefined)
    assert.equal(saved.query.limit, 200)
  } finally {
    await done()
  }
})

test('one profile’s screens and history are not another’s', async () => {
  const { store, done } = await bench()
  try {
    await store.saveScreen('one', 'Mine', { conditions: [{ field: 'price', operator: 'gt', value: 1 }] })
    await store.recordFiring('one', {
      alertId: 'a1',
      instrumentId: btc.instrumentId,
      symbol: 'BTCUSDT',
      label: 'fired',
      value: 1,
      at: 1_700_000_000_000
    })
    assert.equal((await store.screens('two')).length, 0)
    assert.equal((await store.alertHistory('two')).length, 0)
  } finally {
    await done()
  }
})
