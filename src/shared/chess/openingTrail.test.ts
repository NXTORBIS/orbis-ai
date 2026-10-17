import test from 'node:test'
import assert from 'node:assert/strict'
import { openingTrail, stopLabel, trailWords } from './openingTrail.ts'

test('nothing played is no trail, and is said as nothing played', () => {
  const trail = openingTrail([])
  assert.deepEqual(trail.stops, [])
  assert.equal(trail.deepest, null)
  assert.equal(trail.walked, 0)
  assert.equal(trail.stoppedAt, null)
  assert.ok(trailWords(trail).includes('Nothing has been played'))
})

test('a real opening line collects the names it was given, deepest last', () => {
  const trail = openingTrail(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])
  assert.equal(trail.walked, 5)
  assert.equal(trail.stoppedAt, null)
  assert.ok(trail.stops.length > 0)
  assert.ok(trail.deepest !== null)
  if (trail.deepest === null) return
  // The last name belongs to the last position named, not to the last move played.
  assert.equal(trail.deepest.ply, trail.stops[trail.stops.length - 1].ply)
  assert.ok(trail.deepest.record.eco.length > 0)
  assert.ok(trail.deepest.record.name.length > 0)
})

test('the same name twice running is one stop, not two', () => {
  const trail = openingTrail(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'])
  const seen = trail.stops.map((one) => `${one.record.eco} ${one.record.name}`)
  assert.equal(new Set(seen).size, seen.length)
})

test('the stops are in the order they were reached', () => {
  const trail = openingTrail(['d4', 'd5', 'c4', 'e6', 'Nc3'])
  const plies = trail.stops.map((one) => one.ply)
  assert.deepEqual(plies, [...plies].sort((a, b) => a - b))
})

test('a move that cannot be played stops the walk there and says which move', () => {
  const trail = openingTrail(['e4', 'e4'])
  assert.equal(trail.walked, 1)
  assert.ok(trail.stoppedAt !== null)
  if (trail.stoppedAt === null) return
  assert.equal(trail.stoppedAt.ply, 2)
  assert.equal(trail.stoppedAt.move, 'e4')
  assert.ok(trailWords(trail).includes('cannot be played'))
})

test('a starting position that cannot be used refuses before any move is walked', () => {
  const trail = openingTrail(['e4'], 'not a position')
  assert.equal(trail.walked, 0)
  assert.ok(trail.stoppedAt !== null)
  if (trail.stoppedAt === null) return
  assert.equal(trail.stoppedAt.ply, 0)
  assert.equal(trailWords(trail), trail.stoppedAt.reason)
})

test('a line nobody has a name for says so rather than naming it anyway', () => {
  const trail = openingTrail(['a4', 'h5', 'a5', 'h4'])
  if (trail.stops.length === 0) {
    assert.ok(trailWords(trail).includes('no name'))
  } else {
    // If the dataset does name one of those positions the words must say how many, never invent a count.
    assert.ok(trailWords(trail).includes(String(trail.stops.length)))
  }
})

test('a stop is written the way a move is written on its own', () => {
  const trail = openingTrail(['e4', 'e5', 'Nf3'])
  for (const stop of trail.stops) {
    const label = stopLabel(stop)
    assert.ok(label.includes(stop.san))
    assert.ok(stop.ply % 2 === 1 ? label.includes('.') : label.includes('…'))
  }
  assert.equal(stopLabel({ ply: 5, san: 'Bc4', fen: '', record: { key: '', eco: 'C50', name: 'x', line: [] } }), '3.Bc4')
  assert.equal(stopLabel({ ply: 6, san: 'Bc5', fen: '', record: { key: '', eco: 'C50', name: 'x', line: [] } }), '3…Bc5')
})
