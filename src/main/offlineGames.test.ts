import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beats, classifyLoadFailure, gameOfTheDay, GAMES, launchChoice, normalizeData, randomGame, recordScore, searchGames } from '../shared/offlineGames.ts'

test('only real network failures count as offline', () => {
  assert.deepEqual(classifyLoadFailure(-106), { offline: true, kind: 'no-internet', reason: 'No internet connection' })
  assert.equal(classifyLoadFailure(-105).kind, 'dns')
  assert.equal(classifyLoadFailure(-102).kind, 'refused')
  assert.equal(classifyLoadFailure(-118).kind, 'timeout')
  assert.equal(classifyLoadFailure(-109).kind, 'unreachable')
  // Certificate errors, blocked or aborted loads are not offline.
  for (const code of [-200, -202, -20, -3, -312, -501]) assert.equal(classifyLoadFailure(code).offline, false, String(code))
})

test('the library ships twelve games, each searchable by name, category and description', () => {
  assert.equal(GAMES.length, 12)
  assert.equal(new Set(GAMES.map((g) => g.id)).size, 12)
  assert.ok(searchGames('snake').some((g) => g.id === 'snake'))
  assert.ok(searchGames('', 'puzzle').every((g) => g.categories.includes('puzzle')))
  assert.ok(searchGames('asteroid').some((g) => g.id === 'space-dodger'))
  assert.deepEqual(searchGames('', 'favorites', ['minesweeper']).map((g) => g.id), ['minesweeper'])
})

test('stored data is validated: bad values are dropped, defaults filled, unknown games ignored', () => {
  const data = normalizeData({ prefs: { behavior: 'explode', sound: 'yes', defaultGame: 'doom', difficulty: 'hard' }, scores: { snake: { best: 120, plays: 3 }, doom: { best: 9 } }, favorites: ['snake', 'snake', 'nope'], recent: [{ gameId: 'snake', playedAt: 5, score: 10 }, { gameId: 'x' }], saved: { runner: { state: {} }, minesweeper: { state: { cells: [] }, savedAt: 7 } } })
  assert.equal(data.prefs.behavior, 'error-page')
  assert.equal(data.prefs.sound, true)
  assert.equal(data.prefs.defaultGame, 'runner')
  assert.equal(data.prefs.difficulty, 'hard')
  assert.deepEqual(Object.keys(data.scores), ['snake'])
  assert.deepEqual(data.favorites, ['snake'])
  assert.equal(data.recent.length, 1)
  assert.deepEqual(Object.keys(data.saved), ['minesweeper'])
  assert.deepEqual(normalizeData('garbage').scores, {})
})

test('scores record plays, recents and new bests (lower is better for reaction times)', () => {
  let data = normalizeData({})
  let r = recordScore(data, 'snake', 50, undefined, 1000)
  assert.equal(r.newBest, true)
  data = r.data
  r = recordScore(data, 'snake', 30, undefined, 2000)
  assert.equal(r.newBest, false)
  assert.equal(r.data.scores.snake?.best, 50)
  assert.equal(r.data.scores.snake?.lastScore, 30)
  assert.equal(r.data.scores.snake?.plays, 2)
  assert.equal(r.data.recent[0].score, 30)
  assert.equal(beats('reaction-test', 180, 220), true)
  assert.equal(beats('reaction-test', 250, 220), false)
  assert.equal(beats('reaction-test', 0, 220), false)
})

test('game of the day is stable within a day; random avoids the last game; launch follows the preference', () => {
  const morning = new Date(2026, 8, 16, 8)
  const night = new Date(2026, 8, 16, 23)
  assert.equal(gameOfTheDay(morning), gameOfTheDay(night))
  const days = new Set(Array.from({ length: 30 }, (_, i) => gameOfTheDay(new Date(2026, 8, 1 + i))))
  assert.ok(days.size > 4)
  assert.notEqual(randomGame(['snake', 'runner'], 'snake', () => 0), 'snake')
  const data = normalizeData({ prefs: { launchGame: 'last', defaultGame: 'minesweeper' }, recent: [{ gameId: 'flappy', playedAt: 1, score: 3 }] })
  assert.equal(launchChoice(data, morning), 'flappy')
  assert.equal(launchChoice({ ...data, prefs: { ...data.prefs, launchGame: 'default' } }, morning), 'minesweeper')
  assert.equal(launchChoice({ ...data, prefs: { ...data.prefs, launchGame: 'daily' } }, morning), gameOfTheDay(morning))
})
