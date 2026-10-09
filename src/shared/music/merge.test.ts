import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DUPLICATE_RULES, STRATEGIES, canUndo, planMerge, snapshotOf, summariseBulk, type MergeTrack } from './merge.ts'

const track = (id: string, title: string, artist = 'A', extra: Partial<MergeTrack> = {}): MergeTrack => ({
  id,
  title,
  artist,
  source: 'mine',
  ...extra
})

describe('music merge', () => {
  it('only one strategy removes anything', () => {
    const removing = STRATEGIES.filter((one) => one.removes).map((one) => one.id)
    assert.deepEqual(removing, ['replace'])
  })

  it('adding to the end keeps the existing order untouched', () => {
    const plan = planMerge({
      destination: [track('a', 'One'), track('b', 'Two')],
      incoming: [track('c', 'Three', 'A', { source: 'spotify' })],
      strategy: 'append',
      duplicates: 'drop-exact'
    })
    assert.deepEqual(plan.result.map((one) => one.title), ['One', 'Two', 'Three'])
    assert.equal(plan.removed.length, 0)
    assert.equal(plan.destructive, false)
    assert.match(plan.says, /nothing of yours is removed/i)
  })

  it('a track already there is reported rather than added twice', () => {
    const plan = planMerge({
      destination: [track('a', 'One')],
      incoming: [track('x', 'One', 'A', { source: 'spotify' })],
      strategy: 'append',
      duplicates: 'drop-exact'
    })
    assert.equal(plan.added.length, 0)
    assert.equal(plan.alreadyThere.length, 1)
    assert.equal(plan.result.length, 1)
  })

  it('the counts always add up to what the source held', () => {
    const incoming = [
      track('x', 'One', 'A', { source: 's' }),
      track('y', 'One', 'A', { source: 's' }),
      track('z', 'New', 'A', { source: 's' })
    ]
    const plan = planMerge({ destination: [track('a', 'One')], incoming, strategy: 'append', duplicates: 'drop-exact' })
    assert.equal(plan.added.length + plan.alreadyThere.length + plan.dropped.length, incoming.length)
  })

  it('a different version is a conflict, and is still added', () => {
    const plan = planMerge({
      destination: [track('a', 'Blue')],
      incoming: [track('x', 'Blue (2019 Remaster)', 'A', { source: 's' })],
      strategy: 'append',
      duplicates: 'keep-all'
    })
    assert.equal(plan.conflicts.length, 1)
    assert.equal(plan.conflicts[0].kind, 'version')
    assert.equal(plan.added.length, 1)
  })

  it('dropping every version but one keeps what is already there', () => {
    const plan = planMerge({
      destination: [track('a', 'Blue')],
      incoming: [track('x', 'Blue (Live)', 'A', { source: 's' })],
      strategy: 'append',
      duplicates: 'drop-canonical'
    })
    assert.equal(plan.added.length, 0)
    assert.equal(plan.dropped.length, 1)
  })

  it('preferring my own file makes it a conflict rather than a silent swap', () => {
    const plan = planMerge({
      destination: [track('a', 'Blue (Remaster)')],
      incoming: [track('x', 'Blue', 'A', { source: 's', local: true })],
      strategy: 'append',
      duplicates: 'prefer-local'
    })
    assert.equal(plan.conflicts.length, 1)
    assert.equal(plan.added.length, 1)
  })

  it('back-to-back repeats go, repeats further apart stay', () => {
    const plan = planMerge({
      destination: [],
      incoming: [track('x', 'One', 'A', { source: 's' }), track('y', 'One', 'A', { source: 's' }), track('z', 'Two', 'A', { source: 's' }), track('w', 'One', 'A', { source: 's' })],
      strategy: 'append',
      duplicates: 'drop-consecutive'
    })
    assert.deepEqual(plan.result.map((one) => one.title), ['One', 'Two', 'One'])
  })

  it('keeping everything keeps the repeat', () => {
    const plan = planMerge({
      destination: [],
      incoming: [track('x', 'One', 'A', { source: 's' }), track('y', 'One', 'A', { source: 's' })],
      strategy: 'append',
      duplicates: 'keep-all'
    })
    assert.equal(plan.result.length, 2)
  })

  it('replace is the only plan that says something is going', () => {
    const plan = planMerge({
      destination: [track('a', 'Mine')],
      incoming: [track('x', 'Theirs', 'A', { source: 's' })],
      strategy: 'replace',
      duplicates: 'drop-exact'
    })
    assert.equal(plan.removed.length, 1)
    assert.equal(plan.destructive, true)
    assert.match(plan.says, /removed/i)
    assert.match(plan.says, /snapshot/i)
  })

  it('their order wins, and mine follows', () => {
    const plan = planMerge({
      destination: [track('a', 'One'), track('b', 'Mine Only')],
      incoming: [track('x', 'Three', 'A', { source: 's' }), track('y', 'One', 'A', { source: 's' })],
      strategy: 'imported-order',
      duplicates: 'drop-exact'
    })
    assert.deepEqual(plan.result.map((one) => one.title), ['Three', 'One', 'Mine Only'])
  })

  it('working it out puts a new track beside the one it follows', () => {
    const plan = planMerge({
      destination: [track('a', 'One'), track('b', 'Two')],
      incoming: [track('x', 'One', 'A', { source: 's' }), track('y', 'Between', 'A', { source: 's' })],
      strategy: 'smart',
      duplicates: 'drop-exact'
    })
    assert.deepEqual(plan.result.map((one) => one.title), ['One', 'Between', 'Two'])
  })

  it('an unplayable track is kept as a reference, never dropped quietly', () => {
    const gone = track('x', 'Gone', 'A', { source: 's' })
    const plan = planMerge({ destination: [], incoming: [gone], strategy: 'append', duplicates: 'drop-exact', unavailable: [gone] })
    assert.equal(plan.conflicts[0].kind, 'unavailable')
    assert.equal(plan.result.length, 1)
    assert.equal(plan.dropped.length, 0)
  })

  it('every duplicate rule is described', () => {
    for (const rule of DUPLICATE_RULES) {
      assert.ok(rule.name.length > 3, rule.id)
      assert.ok(rule.what.length > 10, rule.id)
    }
  })

  it('a bulk summary counts only the rows that will run', () => {
    const plan = planMerge({ destination: [], incoming: [track('x', 'One', 'A', { source: 's' })], strategy: 'append', duplicates: 'drop-exact' })
    const out = summariseBulk(
      [
        { sourceId: 's1', sourceName: 'Gym', destinationId: 'd1', destinationName: 'Gym', action: 'merge' },
        { sourceId: 's2', sourceName: 'Old', destinationId: null, destinationName: 'Old', action: 'skip' }
      ],
      new Map([
        ['s1', plan],
        ['s2', plan]
      ])
    )
    assert.equal(out.merges, 1)
    assert.equal(out.skips, 1)
    assert.equal(out.newTracks, 1)
  })

  it('undo is refused once the playlist has been edited since', () => {
    const snapshot = snapshotOf('p1', 'Gym', ['a', 'b'], 'Merged from Spotify', 1_000)
    assert.equal(canUndo(snapshot, 1_000, 1_000).can, true)
    const later = canUndo(snapshot, 50_000, 1_000)
    assert.equal(later.can, false)
    assert.match(later.why, /edited since/i)
    assert.equal(canUndo(snapshot, 1_000, null).can, false)
  })
})
