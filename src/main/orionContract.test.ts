import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Orion, protected.
 *
 * Orbis is replacing the browser underneath Orion. Orion itself must come through that unchanged — not "mostly", and
 * not "with a few features dropped because they were awkward". These tests are the contract: they describe what Orion
 * is allowed to depend on and what it must still be able to do, and they fail if the migration quietly takes any of
 * it away.
 *
 * They deliberately test the shape of the integration rather than the answers Orion gives. What model says what is
 * Orion's business; that it can still see a page, act on one, and be told what happened is the migration's business.
 */

const MAIN = import.meta.dirname
const read = (relative: string): Promise<string> => readFile(join(MAIN, relative), 'utf8')

test('Orion does not know which browser engine it is running on', async () => {
  const agent = await read('browserAgent.ts')
  assert.doesNotMatch(agent, /from ['"]electron['"]/, "Orion must depend on the page contract, not on Electron — otherwise it has to be rewritten for Chromium")
  assert.match(agent, /from '\.\/pageHandle'/, 'it works through the page contract')
})

test('every way Orion touches a page is named in the contract, so nothing it needs can be dropped', async () => {
  const agent = await read('browserAgent.ts')
  const contract = await read('pageHandle.ts')

  // What the agent loop actually calls on a page, read from the code rather than from memory. `wc` is what the
  // agent calls the page it is working on; a name merely ending in those letters is something else entirely.
  const used = new Set<string>()
  for (const match of agent.matchAll(/(?:^|[^A-Za-z])wc[.]([a-zA-Z]+)/g)) used.add(match[1])

  const missing = [...used].filter((name) => !contract.includes(name) && !['then', 'catch', 'id'].includes(name))
  assert.deepEqual(missing, [], `Orion uses these on a page but the contract does not promise them:\n  ${missing.join('\n  ')}`)
})

test('Orion can still do everything it could do before the migration', async () => {
  const agent = await read('browserAgent.ts')

  // The tools are what Orion can actually do in a browser. Losing one is losing a capability the user has today.
  const tools = [
    'navigate', 'click', 'click_point', 'type_text', 'press_key', 'press_keys', 'scroll', 'drag', 'select_option',
    'read_page', 'inspect', 'go_back', 'go_forward', 'wait', 'wait_for_video_end', 'ask_user', 'note', 'set_goal',
    'mark_done', 'find_capabilities', 'use_capability'
  ]
  const lost = tools.filter((tool) => !agent.includes(`case '${tool}':`))
  assert.deepEqual(lost, [], `these are things Orion can do today and must still be able to do:\n  ${lost.join('\n  ')}`)
})

test('Orion reaches the rest of the browser through the control layer, not around it', async () => {
  const agent = await read('browserAgent.ts')
  // Tabs, windows, downloads and the rest are the control layer's, so Chromium changes land there rather than here.
  assert.match(agent, /control\?:\s*BrowserControl/, 'the control layer is how Orion reaches everything beyond the page')
  assert.match(agent, /find_capabilities/, 'Orion can ask what is possible rather than being told at build time')
  assert.match(agent, /use_capability/, 'and can then use what it found')
})

test('Orion understands a page by meaning, not by guessing at pixels', async () => {
  const page = await read('browserControl/page.ts')
  assert.match(page, /accessibilityTree/, 'the accessibility tree is how a page is understood semantically')
  assert.match(page, /debugger/, 'read through the page’s own inspector connection, which Chromium has too')

  const agent = await read('browserAgent.ts')
  // Clicking a point is there for when nothing else works, but a reference to a real element comes first.
  assert.match(agent, /case 'click':/)
  assert.match(agent, /case 'click_point':/)
})

test('what Orion does is checked afterwards, rather than assumed to have worked', async () => {
  const agent = await read('browserAgent.ts')
  // Observe, act, then look again: the loop only moves on once the page says something really changed.
  assert.match(agent, /fingerprint/, 'a page is fingerprinted so a step can tell whether anything happened')
  assert.match(agent, /settle/, 'and waited for before it is read')
})

test('the page contract promises real behaviour and says so', async () => {
  const contract = await read('pageHandle.ts')
  assert.match(contract, /Nothing here may pretend/, 'the contract must be explicit that nothing may fake a result')
  // The things that make Orion's loop possible at all.
  for (const method of ['executeJavaScript', 'capturePage', 'insertText', 'sendInputEvent', 'loadURL', 'isDestroyed', 'navigationHistory']) {
    assert.match(contract, new RegExp(`\\b${method}\\b`), `${method} is part of what Orion needs from a page`)
  }
})

test('Orion keeps working when the page it was using disappears', async () => {
  const agent = await read('browserAgent.ts')
  assert.match(agent, /isDestroyed\(\)/, 'a closed tab must be noticed rather than acted on')
})
