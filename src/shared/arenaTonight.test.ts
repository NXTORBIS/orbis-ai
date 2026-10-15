import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tonightMatches, tonightSession } from './arenaTonight.ts'

const NOW = Date.parse('2026-10-15T12:00:00Z')
const m = (key: string, status: string, kickoff: string | null): never =>
  ({ key, status, kickoff, home: { name: 'A' }, away: { name: 'B' }, competition: { name: 'Liga' } }) as never

test('only scheduled matches in the next day, soonest first', () => {
  const got = tonightMatches(
    [
      m('late', 'scheduled', '2026-10-15T20:00:00Z'),
      m('soon', 'scheduled', '2026-10-15T13:00:00Z'),
      m('over', 'finished', '2026-10-15T13:00:00Z'),
      m('far', 'scheduled', '2026-10-17T13:00:00Z'),
      m('none', 'scheduled', null),
      m('past', 'scheduled', '2026-10-15T09:00:00Z')
    ],
    NOW
  )
  assert.deepEqual(got.map((x) => x.key), ['soon', 'late'])
})

test('a session with only a date cannot be counted to, and one past the day is not tonight', () => {
  assert.equal(tonightSession([{ name: 'Race', startsAt: '2026-10-15', race: 'X' }], NOW), null)
  assert.equal(tonightSession([{ name: 'Race', startsAt: '2026-10-20T13:00:00Z', race: 'X' }], NOW), null)
  const two = [
    { name: 'FP1', startsAt: '2026-10-15T15:00:00Z', race: 'X' },
    { name: 'FP2', startsAt: '2026-10-15T14:00:00Z', race: 'X' }
  ]
  assert.equal(tonightSession(two, NOW)?.name, 'FP2')
})
