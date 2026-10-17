import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ENDGAMES } from './endgamesData.ts'
import {
  DIFFICULTY_LABEL, THEME_LABEL, THEME_ORDER, objectiveText, proofKind, startDrill, verifyCatalogue, verifyEntry
} from './endgames.ts'
import { positionKey } from './rules.ts'

/**
 * The catalogue, checked.
 *
 * This is the test the Endgame Lab exists for. Every position is loaded, its side to move is compared with what the
 * entry says, and every "in n" claim is recomputed by exhaustive search -- every defence tried, and the shorter mate
 * ruled out, because "mate in three" that is really mate in two is wrong in the way that wastes somebody's evening.
 *
 * It is slower than the other tests here (the searches do the work of proving a negative) and that is the price of
 * the claims. If an entry fails, the entry is wrong: fix the data or take it out. Nothing is ever fixed by loosening
 * the check.
 */

// A budget big enough for the searches these positions need, and small enough that a runaway one stops.
const LIMITS = { budget: 400_000 }

test('every ending in the catalogue passes every check Orbis can make', () => {
  const report = verifyCatalogue(ENDGAMES, LIMITS)
  const failures = report.entries.filter((e) => !e.ok)
  const detail = failures.map((e) => `${e.id}: ${e.problems.join(' ')}`).join('\n')
  assert.equal(detail, '', detail)
  assert.deepEqual(report.problems, [])
  assert.equal(report.passed, report.authored)
  assert.ok(report.authored >= 20, `the catalogue should be worth having: ${report.authored} entries`)
})

test('the claims that say "in n" are proved by search, and the rest say so', () => {
  const searched = ENDGAMES.filter((e) => proofKind(e) === 'searched')
  assert.ok(searched.length >= 8, `${searched.length} entries carry a searched claim`)
  for (const entry of searched) {
    const check = verifyEntry(entry, LIMITS)
    assert.equal(check.ok, true, `${entry.id}: ${check.problems.join(' ')}`)
    // A searched entry has to come back with a proof, not with a reason it could not be proved.
    assert.ok(
      check.proved.some((line) => /forced/.test(line)),
      `${entry.id} claims a number of moves but nothing was proved: ${check.proved.join(' | ')}`
    )
    assert.deepEqual(check.unproved, [], `${entry.id} should not need excuses`)
  }
  // Everything else must be honest about what was not settled.
  for (const entry of ENDGAMES.filter((e) => proofKind(e) === 'checked')) {
    const check = verifyEntry(entry, LIMITS)
    assert.ok(check.unproved.length > 0, `${entry.id} is not a searched claim, so it must say what is unproved`)
  }
})

test('every theme and difficulty in use has a name, and the themes are all covered', () => {
  for (const entry of ENDGAMES) {
    assert.ok(THEME_LABEL[entry.theme], `${entry.id} has an unnamed theme`)
    assert.ok(DIFFICULTY_LABEL[entry.difficulty], `${entry.id} has an unnamed difficulty`)
    assert.ok(THEME_ORDER.includes(entry.theme), `${entry.id} is in a theme the screen does not list`)
  }
  for (const theme of THEME_ORDER) {
    assert.ok(ENDGAMES.some((e) => e.theme === theme), `the theme ${theme} is listed with nothing in it`)
  }
})

test('the catalogue covers the endings the Lab says it covers', () => {
  const ids = ENDGAMES.map((e) => e.id)
  // Named here because these are what the Lab is for: if one disappears, the Lab is quietly less than it claims.
  for (const needed of [
    'kp-take-the-opposition', 'kp-key-squares', 'kp-square-of-the-pawn',
    'convert-outside-passed-pawn', 'rook-cut-the-king-off', 'rook-philidor-third-rank',
    'mate-queen-from-centre', 'mate-rook-the-box'
  ]) {
    assert.ok(ids.includes(needed), `${needed} is missing from the catalogue`)
  }
})

test('no two entries are the same ending twice', () => {
  const ids = new Set(ENDGAMES.map((e) => e.id))
  assert.equal(ids.size, ENDGAMES.length)
  const positions = new Set(ENDGAMES.map((e) => positionKey(e.fen)))
  assert.equal(positions.size, ENDGAMES.length)
  const titles = new Set(ENDGAMES.map((e) => e.title))
  assert.equal(titles.size, ENDGAMES.length)
})

test('what every ending asks for can be read out loud, and nothing is already done', () => {
  for (const entry of ENDGAMES) {
    const text = objectiveText(entry)
    assert.match(text, /^You are (White|Black)\./, `${entry.id}: ${text}`)
    assert.ok(text.length > 30 && text.length < 220, `${entry.id}: ${text}`)
    const drill = startDrill(entry)
    assert.equal(drill.status, 'playing', `${entry.id} starts finished`)
    assert.equal(drill.fen, entry.fen)
    assert.equal(drill.learner, entry.sideToMove)
  }
})

test('the provenance says where each one comes from and never claims a game it is not from', () => {
  for (const entry of ENDGAMES) {
    assert.match(entry.provenance, /Orbis|rules/, `${entry.id} does not say where it comes from`)
    assert.ok(entry.provenance.length > 40, `${entry.id} has a provenance too short to mean anything`)
    // No entry pretends to be somebody's game, or a famous diagram, because none of them is one.
    assert.doesNotMatch(entry.provenance, /\b(19|20)\d\d\b/, `${entry.id} implies a date it cannot have`)
  }
})
