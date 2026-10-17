import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewFen, previewPuzzle } from './puzzlePreview.ts'
import type { Puzzle } from './puzzles.ts'

function puzzle(id: string, startFen: string): Puzzle {
  return {
    id,
    exercise: { startFen } as Puzzle['exercise'],
    themes: [],
    rating: null,
    ratingFrom: null,
    addedAt: 0
  }
}

const A = puzzle('a', 'fen-a')
const B = puzzle('b', 'fen-b')

test('an empty list previews nothing, so no made-up board is drawn', () => {
  assert.equal(previewPuzzle([], null), null)
  assert.equal(previewPuzzle([], 'a'), null)
})

test('with nothing picked, the first puzzle in the list is shown', () => {
  assert.equal(previewPuzzle([A, B], null), A)
})

test('the picked puzzle is shown when it is still in the list', () => {
  assert.equal(previewPuzzle([A, B], 'b'), B)
})

test('a picked puzzle that has dropped out of the list falls back to the first one', () => {
  assert.equal(previewPuzzle([A, B], 'gone'), A)
})

test('the preview draws the exercise start position and nothing else', () => {
  assert.equal(previewFen(B), 'fen-b')
})
