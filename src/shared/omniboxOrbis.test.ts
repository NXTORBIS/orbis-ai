import { test } from 'node:test'
import assert from 'node:assert/strict'
import { orbisOnlySuggestions, ORBIS_ONLY_KINDS, type OrbisOmniboxSources } from './omniboxOrbis.ts'

const NOW = Date.UTC(2026, 8, 27, 4, 0, 0)

const sources = (over: Partial<OrbisOmniboxSources> = {}): OrbisOmniboxSources => ({
  research: [],
  workspaces: [],
  orion: [],
  now: NOW,
  personalized: true,
  ...over
})

test('says nothing when there is nothing typed', () => {
  assert.deepEqual(orbisOnlySuggestions('', sources({ workspaces: [{ id: 'w1', name: 'Development' }] })), [])
  assert.deepEqual(orbisOnlySuggestions('   ', sources({ workspaces: [{ id: 'w1', name: 'Development' }] })), [])
})

test('offers a workspace by name', () => {
  const rows = orbisOnlySuggestions('deve', sources({ workspaces: [{ id: 'w1', name: 'Development', tabCount: 7 }] }))
  const workspace = rows.find((r) => r.kind === 'workspace')
  assert.ok(workspace, 'a workspace called Development should be offered for "deve"')
  assert.match(workspace.text, /Development/)
  assert.equal(workspace.workspaceId, 'w1', 'the row must say which workspace it opens')
  assert.equal(workspace.url, undefined, 'opening a workspace is not a navigation')
})

test('a workspace that was not asked for is not offered', () => {
  const rows = orbisOnlySuggestions('quantum', sources({ workspaces: [{ id: 'w1', name: 'Development' }] }))
  assert.equal(rows.filter((r) => r.kind === 'workspace').length, 0)
})

test('never returns a kind the browser already has of its own', () => {
  const rows = orbisOnlySuggestions('git', {
    ...sources({
      workspaces: [{ id: 'w1', name: 'git things' }],
      research: [{ question: 'git rebase vs merge', at: NOW - 1000 }],
      orion: ['git bisect how to']
    })
  })
  assert.ok(rows.length > 0, 'this input should produce something')
  for (const row of rows) {
    assert.ok(
      (ORBIS_ONLY_KINDS as readonly string[]).includes(row.kind),
      `${row.kind} is Chromium's own job and must not be duplicated here`
    )
  }
})

test('every row can be acted on and can explain itself', () => {
  const rows = orbisOnlySuggestions('git', {
    ...sources({
      workspaces: [{ id: 'w1', name: 'git things' }],
      research: [{ question: 'git rebase vs merge', at: NOW - 1000 }],
      orion: ['git bisect how to']
    })
  })
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.ok(row.url || row.query || row.workspaceId, `${row.kind} has nowhere to go when chosen`)
    assert.ok(row.detail.trim().length > 0, `${row.kind} has no second line`)
  }
})

test('stays inside the band it is given, below a typed address', () => {
  const rows = orbisOnlySuggestions('git', {
    ...sources({
      workspaces: [{ id: 'w1', name: 'git things' }],
      research: [{ question: 'git rebase vs merge', at: NOW - 1000 }],
      orion: ['git bisect how to']
    })
  })
  for (const row of rows) {
    assert.ok(row.relevance > 0 && row.relevance <= 940, `${row.kind} scored ${row.relevance}`)
    // Chromium gives a what-you-typed match around 1300; nothing here may outrank that.
    assert.ok(row.relevance < 1300, `${row.kind} would outrank the address being typed`)
  }
})

test('best first', () => {
  const rows = orbisOnlySuggestions('git', {
    ...sources({
      workspaces: [{ id: 'w1', name: 'git things' }],
      research: [{ question: 'git rebase vs merge', at: NOW - 1000 }],
      orion: ['git bisect how to']
    })
  })
  const scores = rows.map((r) => r.relevance)
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a))
})

test('one kind cannot crowd out the others', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, name: `git project ${i}` }))
  const rows = orbisOnlySuggestions('git', {
    ...sources({ workspaces: many, research: [{ question: 'git rebase vs merge', at: NOW - 1000 }], orion: ['git bisect'] })
  })
  assert.ok(rows.filter((r) => r.kind === 'workspace').length <= 2, 'workspaces should be capped')
  assert.ok(new Set(rows.map((r) => r.kind)).size > 1, 'other kinds should still get a place')
})

test('honours the limit', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, name: `git project ${i}` }))
  const rows = orbisOnlySuggestions('git', { ...sources({ workspaces: many, orion: ['git a', 'git b', 'git c'] }) }, 2)
  assert.ok(rows.length <= 2)
})

test('research is left out when the person has turned personalisation off', () => {
  const off = orbisOnlySuggestions('rebase', {
    ...sources({ research: [{ question: 'git rebase vs merge', at: NOW - 1000 }], personalized: false })
  })
  assert.equal(off.filter((r) => r.kind === 'research').length, 0)
})
