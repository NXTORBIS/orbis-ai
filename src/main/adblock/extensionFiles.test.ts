import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every ruleset the extension's manifest names has to be on disk.
 *
 * Chromium does not shrug a missing one off. If a single path in `declarative_net_request.rule_resources` is not
 * there, the whole extension is refused with "Failed to load extension", and with it goes the ad blocker, the
 * selection orb and everything else the extension does -- for a file nobody noticed was missing.
 *
 * That is exactly what happened: `adblock/rules/first-line.json` is written by
 * `scripts/build-first-line-rules.mjs`, the build never ran it, and the file was never committed, so the extension
 * had been failing to load. The build runs it now, and this test is what stops it going quiet again.
 */

const root = join(import.meta.dirname, '..', '..', '..')

test('every ruleset the manifest names really exists', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'extension', 'manifest.json'), 'utf8')) as {
    declarative_net_request?: { rule_resources?: { id: string; path: string; enabled?: boolean }[] }
  }
  const rulesets = manifest.declarative_net_request?.rule_resources ?? []
  assert.ok(rulesets.length > 0, 'the manifest should declare rulesets; if it no longer does, this test is checking nothing')
  const missing = rulesets.filter((one) => !existsSync(join(root, 'extension', one.path))).map((one) => `${one.id} -> ${one.path}`)
  assert.deepEqual(missing, [], 'a ruleset named in the manifest is not on disk, so Chromium will refuse the whole extension')
})

test('the rules that have to be live before anything is fetched are real rules', async () => {
  const text = await readFile(join(root, 'extension', 'adblock', 'rules', 'first-line.json'), 'utf8')
  const rules = JSON.parse(text) as { id: number; action: { type: string }; condition: Record<string, unknown> }[]
  assert.ok(Array.isArray(rules), 'the ruleset is a list of rules')
  assert.ok(rules.length >= 50, `the first-line ruleset has only ${rules.length} rules, which is too few to be the real one`)
  const ids = new Set(rules.map((r) => r.id))
  assert.equal(ids.size, rules.length, 'two rules share an id, which Chromium refuses')
  for (const rule of rules.slice(0, 20)) {
    assert.equal(rule.action.type, 'block', 'a first-line rule blocks')
    assert.ok(rule.condition.urlFilter ?? rule.condition.requestDomains, 'a rule needs something to match on')
  }
})
