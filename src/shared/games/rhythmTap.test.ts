import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GRADE_POINTS, LANES, MIN_LANE_GAP_MS, WINDOWS, accuracyOf, chartValid, emptyCounts, judge, makeSong, nearestOpen, notePoints, rank } from './rhythmTap.ts'
import type { Difficulty, Song } from './rhythmTap.ts'

test('every generated song is a fair chart, on every difficulty, over three hundred seeds', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as Difficulty[]) {
    for (let seed = 1; seed <= 300; seed++) {
      const song = makeSong(seed, difficulty)
      assert.equal(chartValid(song), null, `${difficulty} seed ${seed}: ${chartValid(song)}`)
    }
  }
})

test('the chart check catches the four ways a chart is unfair', () => {
  const song = makeSong(7, 'normal')
  const bend = (notes: Song['notes']): string | null => chartValid({ ...song, notes })
  assert.equal(chartValid(song), null)
  assert.match(bend([song.notes[3], song.notes[1]])!, /out of order/)
  assert.match(bend([{ ...song.notes[0], lane: 9 }])!, /does not exist/)
  assert.match(bend([{ ...song.notes[0], ms: 10 }])!, /off the beat grid/)
  const lane = song.notes[0].lane
  // One sixteenth apart, in the same lane: on the grid, and still two notes one tap could be meant for.
  assert.match(bend([song.notes[0], { ...song.notes[0], ms: song.notes[0].ms + Math.round(song.beatMs / 4), lane }])!, /in lane \d only \d+ms apart/)
  const stacked = Array.from({ length: 3 }, (_, i) => ({ ...song.notes[0], lane: i }))
  assert.match(bend(stacked)!, /at once/)
  assert.match(bend([{ ...song.notes[0], freq: 2 }])!, /nobody can hear/)
})

test('the notes and the tune are the same list, so one of them cannot drift from the other', () => {
  const song = makeSong(11, 'normal')
  // Every tap target carries the sound it makes. There is no second list to fall out of step with.
  for (const note of song.notes) assert.ok(note.freq > 40 && note.lengthMs > 0, 'a note with nothing to play')
  assert.ok(song.backing.some((hit) => hit.kind === 'kick'))
  assert.ok(song.backing.some((hit) => hit.kind === 'hat'))
  assert.ok(song.backing.every((hit) => hit.ms >= 0 && hit.ms <= song.lengthMs))
  // The beat underneath lands on the beat, not near it.
  for (const hit of song.backing.filter((h) => h.kind === 'kick')) assert.ok(Math.abs(hit.ms / song.beatMs - Math.round(hit.ms / song.beatMs)) < 0.02)
  assert.equal(song.lengthMs, Math.round(song.bars * song.barMs))
})

test('the same seed is the same song, and the harder ones ask for more notes', () => {
  assert.deepEqual(makeSong(5, 'normal'), makeSong(5, 'normal'))
  assert.notDeepEqual(makeSong(5, 'normal').notes, makeSong(6, 'normal').notes)
  const rate = (difficulty: Difficulty): number => {
    const song = makeSong(5, difficulty)
    return song.notes.length / (song.lengthMs / 1000)
  }
  assert.ok(rate('hard') > rate('normal'))
  assert.ok(rate('normal') > rate('easy'))
  assert.ok(rate('easy') > 0.5, 'even the easy one is a song, not a trickle')
})

test('early and late are told apart, and so is being nearly right from being wrong', () => {
  assert.deepEqual(judge(0), { grade: 'perfect', early: false })
  assert.deepEqual(judge(-WINDOWS.perfect), { grade: 'perfect', early: true })
  assert.deepEqual(judge(WINDOWS.perfect + 1), { grade: 'good', early: false })
  assert.deepEqual(judge(-(WINDOWS.good + 1)), { grade: 'ok', early: true })
  assert.deepEqual(judge(WINDOWS.ok + 1), { grade: 'miss', early: false })
  assert.deepEqual(judge(-900), { grade: 'miss', early: true })
  assert.ok(WINDOWS.perfect < WINDOWS.good && WINDOWS.good < WINDOWS.ok)
  assert.equal(MIN_LANE_GAP_MS, WINDOWS.ok * 2, 'the gap between two notes in a lane is the window, both ways')
})

test('a run of notes is worth more than the same notes scattered, and a miss is worth nothing', () => {
  assert.equal(notePoints('miss', 40), 0)
  assert.ok(notePoints('perfect', 0) > notePoints('good', 0))
  assert.ok(notePoints('good', 0) > notePoints('ok', 0))
  assert.ok(notePoints('perfect', 30) > notePoints('perfect', 0))
  assert.equal(notePoints('perfect', 999), notePoints('perfect', 50), 'the run stops paying more at fifty')
  assert.equal(notePoints('perfect', -5), GRADE_POINTS.perfect, 'a negative run is simply no run')
})

test('accuracy weighs each note by how well it was hit, and says nothing when nothing was played', () => {
  assert.equal(accuracyOf(emptyCounts()), 0)
  assert.equal(accuracyOf({ ...emptyCounts(), perfect: 10 }), 100)
  assert.equal(accuracyOf({ ...emptyCounts(), miss: 10 }), 0)
  assert.equal(accuracyOf({ ...emptyCounts(), perfect: 5, miss: 5 }), 50)
  const mixed = accuracyOf({ perfect: 4, good: 3, ok: 2, miss: 1 })
  assert.ok(mixed > 60 && mixed < 80, `a mixed run came out at ${mixed}`)
  assert.equal(rank(100), 'Every note')
  assert.equal(rank(50), 'Keep at it')
  assert.ok(rank(96) !== rank(70), 'the words mean something')
})

test('a tap takes the nearest note still waiting in that lane, and nothing when there is none', () => {
  const song = makeSong(3, 'normal')
  const open = song.notes.map(() => true)
  const first = song.notes.findIndex((n) => n.lane === 2)
  assert.ok(first >= 0)
  const note = song.notes[first]
  assert.equal(nearestOpen(song.notes, open, 2, note.ms + 20), first)
  assert.equal(nearestOpen(song.notes, open, 2, note.ms + WINDOWS.ok + 5), -1, 'too late to be that note')
  assert.equal(nearestOpen(song.notes, open, (note.lane + 1) % LANES, note.ms), nearestOpen(song.notes, open, (note.lane + 1) % LANES, note.ms), 'another lane is another question')
  open[first] = false
  assert.notEqual(nearestOpen(song.notes, open, 2, note.ms + 20), first, 'a note already hit is not hit twice')
})
