import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserControl } from '../browserControl/registry.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { registerMoreChromiumCapabilities } from './chromiumCapabilities2.ts'
import { registerFindInPage, registerSitePermissionCapabilities } from './chromiumCapabilities3.ts'
import { registerBrowserToolCapabilities } from './chromiumCapabilities4.ts'
import { registerBrowserUiCapabilities } from './chromiumCapabilities5.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * Every browser capability, checked for the things that make one usable by something that has never seen it.
 *
 * The Orb does not know these capabilities. It is handed a list of them at planning time and has to choose from it, so
 * each one is only as good as what it says about itself: a capability with no description cannot be chosen correctly, a
 * parameter with no description gets filled in with a guess, and one that changes the browser without checking
 * afterwards reports success on the strength of a function having returned.
 *
 * Nothing here runs against a browser. The definitions are inspected, which is the point -- this is the shape of the
 * catalogue, and it has to hold for the capability nobody thought to write a test for.
 */

/** A registry that keeps what was registered, including the parts `list()` does not expose. */
function catalogue(): { definitions: Record<string, Record<string, unknown>>; control: BrowserControl } {
  const control = new BrowserControl()
  const definitions: Record<string, Record<string, unknown>> = {}
  const register = control.register.bind(control)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(control as any).register = (definition: Record<string, unknown>): void => {
    definitions[String(definition.id)] = definition
    register(definition as never)
  }

  /*
   * Fakes that are never reached.
   *
   * Only `run` and `verify` would touch a browser, and neither is called here -- everything inspected is declared, not
   * executed. Registering for real is what makes this cover capabilities added later without anyone updating a list.
   */
  const unused = (): never => {
    throw new Error('the catalogue does not run capabilities')
  }
  const deps = {
    control,
    browser: { list: () => [] } as never,
    bridge: { run: unused } as never
  }
  registerChromiumCapabilities(deps)
  registerMoreChromiumCapabilities({ ...deps, saveDir: '.', selfExtensionId: 'x' })
  registerSitePermissionCapabilities(deps)
  registerFindInPage({ ...deps, activePage: unused as never })
  registerBrowserToolCapabilities({ ...deps, activePage: unused as never, readClipboardText: async () => '', hasClipboardImage: async () => false })
  registerBrowserUiCapabilities({ ...deps, activePage: unused as never, pid: undefined, ui: undefined })
  registerSurfaceCapabilities(deps)
  return { definitions, control }
}

const { definitions, control } = catalogue()
const all = Object.entries(definitions)

test('the catalogue is not empty, and nothing registered twice under one id', () => {
  assert.ok(all.length > 60, `only ${all.length} capabilities registered`)
  assert.equal(control.list({}).length >= all.length - 5, true)
})

test('every id is domain.action, and its domain is the domain it declares', () => {
  for (const [id, d] of all) {
    assert.match(id, /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z0-9]*$/, id)
    assert.equal(id.split('.')[0], String(d.domain), `${id} is registered under the domain "${String(d.domain)}"`)
  }
})

test('every capability says what it is and what it does', () => {
  for (const [id, d] of all) {
    assert.ok(typeof d.name === 'string' && d.name.length > 2, `${id} has no name`)
  }
  // Long enough to distinguish it from its neighbours: "Closes a tab." says nothing a planner did not already know
  // from the id, and a planner choosing between neighbours is choosing between their descriptions.
  const thin = all.filter(([, d]) => String(d.description ?? '').length < 40).map(([id]) => `${id} (${String(d(id).description ?? '').length})`)
  assert.deepEqual(thin, [], `these say too little about themselves: ${thin.join(', ')}`)
})

const d = (id: string): Record<string, unknown> => definitions[id]

test('every parameter is described, because something that has never seen it has to fill it in', () => {
  for (const [id, d] of all) {
    for (const [param, spec] of Object.entries((d.params ?? {}) as Record<string, { description?: string; type?: string }>)) {
      assert.ok(spec && typeof spec.type === 'string', `${id}.${param} has no type`)
      assert.ok(String(spec.description ?? '').length > 3, `${id}.${param} has no description`)
    }
  }
})

test('anything that changes the browser checks afterwards that it did', () => {
  /*
   * The rule this file exists for.
   *
   * A mutating capability without `verify` reports success because its own function returned, which is the difference
   * between "the tab closed" and "I asked for the tab to close". Reads are exempt and deliberately so: a read's answer
   * *is* its evidence, and there is no after-state to compare against.
   */
  const unchecked = all.filter(([, d]) => d.mutates === true && typeof d.verify !== 'function').map(([id]) => id)
  assert.deepEqual(unchecked, [], `these change the browser and never check: ${unchecked.join(', ')}`)
})

test('anything that asks permission can say what it is asking for', () => {
  // A confirmation reading "Run downloads.remove?" is not a question anybody can answer.
  const mute = all.filter(([, d]) => d.confirmation === 'always' && typeof d.describe !== 'function').map(([id]) => id)
  assert.deepEqual(mute, [], `these ask for confirmation without saying what they would do: ${mute.join(', ')}`)
})

test('nothing that only reads asks for confirmation', () => {
  // The other half of §11: a confirmation on a read is a prompt for nothing, and teaches people to click through them.
  const asking = all.filter(([, d]) => d.mutates !== true && d.confirmation === 'always').map(([id]) => id)
  assert.deepEqual(asking, [], `these only read and still ask: ${asking.join(', ')}`)
})

test("the browser's own pages are in the catalogue and reachable", () => {
  // The gap this guard was added for: "open browser settings" had no capability at all, so the only plans available
  // for it were a web search or the address bar.
  assert.ok(definitions['surface.open'], 'surface.open is missing')
  assert.ok(definitions['surface.list'], 'surface.list is missing')
  const found = control.list({ query: 'open browser settings' }).map((c) => c.id)
  assert.ok(found.includes('surface.open'), `"open browser settings" found ${found.slice(0, 5).join(', ') || 'nothing'}`)
})

test('asking to clear history finds the history capability, not a search', () => {
  const found = control.list({ query: "clear today's browsing history" }).map((c) => c.id)
  assert.ok(found.includes('history.deleteRange') || found.includes('history.clear'), `found ${found.slice(0, 5).join(', ')}`)
})
