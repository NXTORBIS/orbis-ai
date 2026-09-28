import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOmniboxSuggestionHandlers } from './omniboxSuggestions.ts'

const NOW = Date.UTC(2026, 8, 27, 4, 0, 0)

const workspace = (id: string, name: string) => ({
  id,
  name,
  color: 'teal',
  tabs: [{ url: 'https://example.com', title: 'Example', pinned: false }],
  groups: []
})

const deps = (over: Partial<Parameters<typeof createOmniboxSuggestionHandlers>[0]> = {}) => ({
  stores: () => ({
    workspaces: {
      list: async () => [workspace('w1', 'Development')],
      get: async () => null,
      current: () => null,
      setCurrent: () => {},
      saveCurrent: async () => ({ id: 'w1', name: 'Development' }),
      rename: async () => true,
      remove: async () => true,
      markOpened: async () => true
    },
    research: { withSources: () => [{ id: 'r1', title: 'git rebase vs merge', updatedAt: NOW - 1000, sourceList: [] }] }
  }),
  orion: async () => ['development environment setup'],
  personalized: async () => true,
  now: () => NOW,
  ...over
}) as Parameters<typeof createOmniboxSuggestionHandlers>[0]

const run = async (d: Parameters<typeof createOmniboxSuggestionHandlers>[0], args: unknown[]) => {
  const handler = createOmniboxSuggestionHandlers(d)['omnibox:orbis']
  return (await handler(args, {} as never)) as { rows: { kind: string; relevance: number }[] }
}

test('nothing typed is answered with nothing', async () => {
  assert.deepEqual((await run(deps(), [''])).rows, [])
  assert.deepEqual((await run(deps(), ['   '])).rows, [])
  assert.deepEqual((await run(deps(), [null])).rows, [])
})

test('finds a workspace by what was typed', async () => {
  const { rows } = await run(deps(), ['deve'])
  assert.ok(rows.some((r) => r.kind === 'workspace'), 'the Development workspace should be offered')
})

test('finds research by what was typed', async () => {
  const { rows } = await run(deps(), ['rebase'])
  assert.ok(rows.some((r) => r.kind === 'research'))
})

test('a source that fails costs only its own rows', async () => {
  const broken = deps({
    stores: () => ({
      workspaces: { list: async () => { throw new Error('disk is busy') } },
      research: { withSources: () => { throw new Error('unreadable') } }
    }) as never
  })
  const { rows } = await run(broken, ['development'])
  // Orion still answered, so the address bar is not left empty because a store was unhappy.
  assert.ok(rows.some((r) => r.kind === 'orion'), 'Orion rows should survive the other sources failing')
})

test('Orion failing does not take the rest down', async () => {
  const { rows } = await run(deps({ orion: async () => { throw new Error('offline') } }), ['deve'])
  assert.ok(rows.some((r) => r.kind === 'workspace'))
})

test('the helper is not asked to return more than it should', async () => {
  const { rows } = await run(deps(), ['deve', 99])
  assert.ok(rows.length <= 8, 'a caller asking for 99 rows gets at most the ceiling')
})

test('research is withheld when personalisation is off', async () => {
  const { rows } = await run(deps({ personalized: async () => false }), ['rebase'])
  assert.equal(rows.filter((r) => r.kind === 'research').length, 0)
})

test('no store at all is not an error', async () => {
  const { rows } = await run(deps({ stores: () => null }), ['development'])
  assert.ok(Array.isArray(rows))
})
