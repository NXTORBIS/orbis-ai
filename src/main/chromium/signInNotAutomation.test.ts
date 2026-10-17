import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Google sign-in only works because of one line that is *not* in the browser.
 *
 * Orbis starts its browser with `--remote-debugging-pipe`, which is how it shows the tabs, the address bar and the Orb.
 * Chromium maps that switch to `EnableAutomationControlled` in `content/child/runtime_features.cc`, which sets
 * `navigator.webdriver`, and Google's sign-in refuses any page where that is true -- "This browser or app may not be
 * secure", on Google's own sites and on every site offering "Sign in with Google". Signing in is the reason this fork
 * exists, so the fork drops that one map entry. `--enable-automation` and headless mode are left flagged.
 *
 * Nothing in this repository can stop someone re-syncing the Chromium tree, so this checks the two things that would
 * make the change quietly disappear: the patch that carries it, and -- when the tree is on this machine -- the tree.
 */

const repo = resolve(import.meta.dirname, '..', '..', '..')
const PATCH = join(repo, 'patches', 'chromium-orbis-signin-not-automation.patch')
const TREE_FILE = 'C:/chromium/src/content/child/runtime_features.cc'
const MAPPING = /\{\s*wrf::EnableAutomationControlled,\s*switches::kRemoteDebuggingPipe/

test('the patch that lets people sign in is still in the stack', async () => {
  assert.ok(
    existsSync(PATCH),
    'patches/chromium-orbis-signin-not-automation.patch is gone. Without it a fresh Chromium tree marks the browser as robot-driven and Google sign-in fails everywhere.',
  )
  const patch = await readFile(PATCH, 'utf8')
  assert.match(patch, /content\/child\/runtime_features\.cc/, 'the patch should still be the one that edits runtime_features.cc')
  const removed = patch
    .split('\n')
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .join('\n')
  assert.match(removed, MAPPING, 'the patch no longer removes the line that maps the debugging pipe to automation-controlled')
})

test('the Chromium tree on this machine still has the change applied', { skip: existsSync(TREE_FILE) ? false : 'no Chromium tree here' }, async () => {
  const source = await readFile(TREE_FILE, 'utf8')
  const live = source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
  assert.doesNotMatch(
    live,
    MAPPING,
    'the Chromium tree maps --remote-debugging-pipe to automation-controlled again, so navigator.webdriver is true and Google sign-in will fail. Re-apply the patch stack: scripts/apply-chromium-patches.ps1',
  )
})
