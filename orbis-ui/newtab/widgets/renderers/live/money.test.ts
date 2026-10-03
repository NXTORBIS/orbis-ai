import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changeWords, formatPrice, pricePlaces, tickerText } from './money.ts'

test('a price that is not a number has no words', () => {
  assert.equal(formatPrice(Number.NaN, 'USD'), '')
  assert.equal(formatPrice(Number.POSITIVE_INFINITY, 'USD'), '')
})

test('a price is shown in its own currency', () => {
  assert.equal(formatPrice(64_250, 'USD', 'en-US'), '$64,250.00')
  assert.equal(formatPrice(233.2, 'usd', 'en-US'), '$233.20')
})

test('something worth a fraction of a penny keeps enough places to tell it apart', () => {
  assert.equal(pricePlaces(64_250), 2)
  assert.equal(pricePlaces(0.5), 4)
  assert.equal(pricePlaces(0.000_018), 6)
  assert.equal(formatPrice(0.000_018, 'USD', 'en-US'), '$0.000018')
})

test('a currency the browser does not know is said plainly rather than guessed at', () => {
  assert.equal(formatPrice(12.5, 'XYZZY', 'en-US'), '12.50 XYZZY')
  assert.equal(formatPrice(12.5, '', 'en-US'), '12.50')
})

test('a change carries its sign, not only its colour', () => {
  assert.deepEqual(changeWords(1.84), { direction: 'up', text: '+1.84%', said: 'Up 1.84 per cent today' })
  assert.deepEqual(changeWords(-0.42), { direction: 'down', text: '−0.42%', said: 'Down 0.42 per cent today' })
})

test('a move too small to show is called no change, not minus nothing', () => {
  assert.deepEqual(changeWords(0), { direction: 'flat', text: '0.00%', said: 'No change today' })
  assert.equal(changeWords(-0.001)?.direction, 'flat')
  assert.equal(changeWords(-0.001)?.text, '0.00%')
  assert.equal(changeWords(Number.NaN), null)
})

test('a symbol is cut rather than left to push the price off the card', () => {
  assert.equal(tickerText(' btc '), 'BTC')
  assert.equal(tickerText('abcdefghijklmnop'), 'ABCDEFGHIJKL')
})
