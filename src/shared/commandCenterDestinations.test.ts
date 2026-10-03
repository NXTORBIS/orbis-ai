import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CAPABILITIES, PANEL_VIEWS, RAIL_VIEWS, destinationMissing, unavailableBecause } from './commandCenter.ts'
import type { Readiness } from './commandCenter.ts'

/**
 * Every row in the Command Center goes somewhere, or says it does not.
 *
 * This is the test that was missing, and the eighteen dead rows are what missing it cost. The registry listed
 * capabilities pointing at fifteen views the panel had never heard of and three more pointing at a view nobody had
 * written. All eighteen drew as ordinary live rows -- full colour, enabled button, a description promising something --
 * and clicking one put a name in the address bar that the panel did not recognise, so the panel fell back to its home.
 * Choosing "Tabs" in the Command Center opened the Command Center. Nothing failed, nothing was logged, and the only way
 * to find out was to click all forty-five.
 *
 * What makes this test worth having is that it does not trust either side on its own. It reads the real files -- the
 * panel's markup, and the two files that build the rail's views -- and compares them against what the registry claims.
 * A view that exists but is not declared is a working screen left unreachable; a view declared but not built is a dead
 * row. Both fail here, and both fail with the name of the thing to add.
 *
 * What it cannot check, and says so rather than implying otherwise: a `page` target is a chrome:// address inside a
 * browser this test has no access to, and a `do` target names a handler compiled into that browser (its source is not
 * in this repository). Those are checked by their own means. An `ask` target names a helper channel, and the helper is
 * here, so those are checked.
 */

const ROOT = join(import.meta.dirname, '..', '..')

const read = (...parts: string[]) => readFile(join(ROOT, ...parts), 'utf8')

const all: Readiness = { browser: true, helper: true, key: true, page: true }

/** The sections written into the panel's markup: `<section id="view-notes">` means the panel has a view called notes. */
async function sectionsInMarkup(): Promise<Set<string>> {
  const html = await read('orbis-ui', 'panel', 'index.html')
  const found = new Set<string>()
  for (const match of html.matchAll(/id="view-([A-Za-z0-9_-]+)"/g)) found.add(match[1])
  return found
}

/**
 * The views the rail really registers.
 *
 * Two shapes, because the rail builds its views two ways: `registerView('tabs', {...})` directly in browser.js, and
 * `listView('savedPages', 'Saved pages', ...)` in stores.js, which is a wrapper that calls registerView itself. Reading
 * only the first would have missed the seven store-backed views entirely and called them missing.
 */
async function viewsTheRailRegisters(): Promise<Set<string>> {
  const dir = join(ROOT, 'orbis-ui', 'panel', 'rail')
  const found = new Set<string>()
  for (const entry of await readdir(dir)) {
    if (!entry.endsWith('.js')) continue
    const source = await readFile(join(dir, entry), 'utf8')
    for (const match of source.matchAll(/\b(?:registerView|listView)\(\s*'([A-Za-z0-9_-]+)'/g)) found.add(match[1])
  }
  return found
}

/** Every channel name the helper answers on, as written in its own source. */
async function helperChannels(): Promise<Set<string>> {
  const dir = join(ROOT, 'src', 'helper')
  const found = new Set<string>()
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue
      const source = await readFile(path, 'utf8')
      // A handler is a property whose name is a channel: `'security:lockTab': guarded(...)`. The colon inside the
      // channel is why these are quoted at all, so the quoted-key shape is a reliable thing to look for.
      for (const match of source.matchAll(/'([a-z][A-Za-z0-9.-]*:[A-Za-z0-9.:-]+)'\s*:/g)) found.add(match[1])
    }
  }
  await walk(dir)
  return found
}

// ---------------------------------------------------------------- the two declared lists are true

test('every panel view this file declares is a section of the panel', async () => {
  const sections = await sectionsInMarkup()
  for (const view of PANEL_VIEWS) {
    assert.ok(
      sections.has(view),
      `PANEL_VIEWS names "${view}" but orbis-ui/panel/index.html has no <section id="view-${view}">. Either add the section or take the name out: a name in that list is what makes the Command Center offer the row.`
    )
  }
})

test('every rail view this file declares is one the rail really registers', async () => {
  const registered = await viewsTheRailRegisters()
  for (const view of RAIL_VIEWS) {
    assert.ok(
      registered.has(view),
      `RAIL_VIEWS names "${view}" but no file under orbis-ui/panel/rail registers it. Either build it or take the name out.`
    )
  }
})

test('nothing the rail builds is left unreachable', async () => {
  // The other direction, and the direction the original bug was in: twelve finished views that nothing could open.
  // A view that exists and is not declared here cannot be addressed, so the work in it is invisible.
  const registered = await viewsTheRailRegisters()
  for (const view of registered) {
    assert.ok(
      (RAIL_VIEWS as readonly string[]).includes(view),
      `orbis-ui/panel/rail registers "${view}" but RAIL_VIEWS does not name it, so nothing can open it. Add it to RAIL_VIEWS.`
    )
  }
})

test('no two views answer to the same address', () => {
  // The panel matches an address against these without case, because the rail's names have capitals in them
  // (tabGroups, savedPages) and an address somebody typed or a restored tab brought back has whatever case it has.
  // That makes "Recall" and "recall" the same address, so two views differing only in case would mean one of them
  // could never be opened and nothing would say which.
  const names = [...PANEL_VIEWS, ...RAIL_VIEWS].map((one) => one.toLowerCase())
  assert.equal(new Set(names).size, names.length, `two views share an address: ${names.sort().join(' ')}`)
})

// ---------------------------------------------------------------- every capability resolves, or admits it does not

test('every capability goes somewhere that exists, or is shown as unavailable with a reason', async () => {
  const sections = await sectionsInMarkup()
  const railViews = await viewsTheRailRegisters()

  for (const capability of CAPABILITIES) {
    const target = capability.target
    const why = destinationMissing(capability)

    if (target.kind === 'panel') {
      // 'home' is the Command Center, which is where these rows are drawn. A row that leads back to the screen you
      // clicked it on is the dead click in its purest form, so it is refused whether or not the view exists.
      if (target.view === 'home') {
        assert.ok(why, `${capability.id} points at the Command Center itself, and is still offered as a live row`)
        continue
      }
      const real = sections.has(target.view)
      assert.equal(
        why === null,
        real,
        real
          ? `${capability.id} leads to the panel view "${target.view}", which exists, but the row is marked unavailable: "${why}". Add "${target.view}" to PANEL_VIEWS.`
          : `${capability.id} leads to the panel view "${target.view}", and orbis-ui/panel/index.html has no such section. The row must say so rather than being offered.`
      )
      continue
    }

    if (target.kind === 'view') {
      const real = railViews.has(target.view)
      assert.equal(
        why === null,
        real,
        real
          ? `${capability.id} leads to the rail view "${target.view}", which exists, but the row is marked unavailable: "${why}". Add "${target.view}" to RAIL_VIEWS.`
          : `${capability.id} leads to the rail view "${target.view}", and nothing under orbis-ui/panel/rail registers it. The row must say so rather than being offered.`
      )
      continue
    }

    if (target.kind === 'app') {
      // A screen the Orbis window has and the browser does not. It is never offered from the browser panel, and the
      // reason names where to find it rather than leaving somebody clicking.
      assert.ok(why, `${capability.id} lives in the Orbis window but the browser panel offers it as a live row`)
      assert.match(why!, /Orbis window/, `${capability.id} says "${why}", which does not tell anybody where it is`)
      continue
    }

    // page, do, ask: nothing in this file can say where they lead, so nothing here claims to.
    assert.equal(why, null, `${capability.id} is a ${target.kind} target and this test cannot judge its destination`)
  }
})

test('a capability asking Orbis to do something names a channel Orbis answers on', async () => {
  const channels = await helperChannels()
  const askers = CAPABILITIES.filter((c) => c.target.kind === 'ask')
  assert.ok(askers.length > 0, 'nothing asks Orbis for anything, which means this test is checking nothing')
  for (const capability of askers) {
    const channel = (capability.target as { channel: string }).channel
    assert.ok(
      channels.has(channel),
      `${capability.id} asks Orbis for "${channel}" and no file under src/helper answers on it, so the row would do nothing and say it had worked.`
    )
  }
})

// ---------------------------------------------------------------- the reason reaches the interface

test('a missing destination is the reason given, not a thing the person could go and fix', () => {
  // The order inside unavailableBecause matters. Told "The browser is not connected", somebody connects the browser
  // and clicks again; told the screen does not exist, they stop. The first answer wastes their time twice over.
  const nowhere = CAPABILITIES.filter((c) => destinationMissing(c) !== null)
  for (const capability of nowhere) {
    assert.equal(
      unavailableBecause(capability, all),
      destinationMissing(capability),
      `${capability.id} has nowhere to go and yet reports something else with everything running`
    )
    const nothingRunning: Readiness = { browser: false, helper: false, key: false, page: false }
    assert.equal(
      unavailableBecause(capability, nothingRunning),
      destinationMissing(capability),
      `${capability.id} blames the browser or the helper for a destination that does not exist`
    )
  }
})

test('a capability that goes somewhere real is not held back by this check', () => {
  const tabs = CAPABILITIES.find((c) => c.id === 'tabs')!
  assert.equal(destinationMissing(tabs), null)
  assert.equal(unavailableBecause(tabs, all), null)
})
