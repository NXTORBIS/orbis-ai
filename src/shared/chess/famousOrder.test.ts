import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FAMOUS_ORDERS, famousMoveNotes, isFamousOrder, orderFamous, orderWords } from './famousOrder.ts'
import type { FamousGame } from './famous.ts'

/** A game with only the parts the ordering looks at. Nothing here is shown to anybody. */
function game(parts: { id: string; white: string; year?: number; moves: number; guided?: number[] }): FamousGame {
  return {
    id: parts.id,
    white: { name: parts.white },
    black: { name: 'Black' },
    result: '1-0',
    ending: 'checkmate',
    san: Array.from({ length: parts.moves }, () => 'e4'),
    themes: [],
    note: '',
    unstated: [],
    guided: (parts.guided ?? []).map((ply) => ({ ply, ask: 'ask', afterward: 'after' })),
    ...(parts.year === undefined ? {} : { year: parts.year })
  } as FamousGame
}

const anderssen = game({ id: 'a', white: 'Anderssen', year: 1851, moves: 45 })
const kasparov = game({ id: 'k', white: 'Kasparov', year: 1999, moves: 87 })
const undated = game({ id: 'u', white: 'Unknown', moves: 20 })
const three = [kasparov, undated, anderssen]

test('both directions of each order really change the list', () => {
  assert.deepEqual(orderFamous(three, 'oldest').map((one) => one.id), ['a', 'k', 'u'])
  assert.deepEqual(orderFamous(three, 'newest').map((one) => one.id), ['k', 'a', 'u'])
  assert.deepEqual(orderFamous(three, 'shortest').map((one) => one.id), ['u', 'a', 'k'])
  assert.deepEqual(orderFamous(three, 'longest').map((one) => one.id), ['k', 'a', 'u'])
  assert.deepEqual(orderFamous(three, 'name').map((one) => one.id), ['a', 'k', 'u'])
  assert.deepEqual(orderFamous(three, 'name-back').map((one) => one.id), ['u', 'k', 'a'])
})

test('a game with no year is last whichever way round the years are asked for', () => {
  assert.equal(orderFamous(three, 'oldest').at(-1)?.id, 'u')
  assert.equal(orderFamous(three, 'newest').at(-1)?.id, 'u')
})

test('the collection it was given is not sorted in place', () => {
  const before = three.map((one) => one.id)
  orderFamous(three, 'longest')
  assert.deepEqual(three.map((one) => one.id), before)
})

test('every order has words of its own, and nothing else is accepted as an order', () => {
  for (const one of FAMOUS_ORDERS) assert.ok(orderWords(one.id).length > 0, `${one.id} says nothing`)
  assert.equal(FAMOUS_ORDERS.length, 6)
  assert.ok(isFamousOrder('oldest'))
  assert.equal(isFamousOrder('year'), false)
  assert.equal(isFamousOrder(null), false)
})

test('only moves the collection has words about are marked', () => {
  const marked = famousMoveNotes(game({ id: 'g', white: 'W', moves: 10, guided: [3, 7] }))
  assert.deepEqual(Object.keys(marked).sort(), ['3', '7'])
  assert.equal(marked[3]?.kind, 'commentary')
  assert.equal(Object.keys(famousMoveNotes(game({ id: 'g', white: 'W', moves: 10 }))).length, 0)
})

test('a commentary point outside the game is not marked', () => {
  const marked = famousMoveNotes(game({ id: 'g', white: 'W', moves: 4, guided: [0, 5, 2] }))
  assert.deepEqual(Object.keys(marked), ['2'])
})
