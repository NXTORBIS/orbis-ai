import test from 'node:test'
import assert from 'node:assert/strict'
import { calculate, convert, formatNumber } from './calculate.ts'

const value = (expression: string): number | null => calculate(expression)?.value ?? null

test('the arithmetic is arithmetic', () => {
  assert.equal(value('25 × 48'), 1200)
  assert.equal(value('2+2'), 4)
  assert.equal(value('100 / 4'), 25)
  assert.equal(value('7 - 9'), -2)
  assert.equal(value('10 % 3'), 1)
})

test('precedence and grouping are respected rather than read left to right', () => {
  assert.equal(value('2 + 3 * 4'), 14)
  assert.equal(value('(2 + 3) * 4'), 20)
  assert.equal(value('100 / 4 / 5'), 5)
})

test('exponentiation groups from the right, as it does in mathematics', () => {
  assert.equal(value('2^10'), 1024)
  assert.equal(value('2^3^2'), 512, '2^(3^2), not (2^3)^2')
})

test('a leading minus is a negative number, not a missing operand', () => {
  assert.equal(value('-5 + 3'), -2)
  assert.equal(value('-(4 * 2)'), -8)
})

test('the functions people actually type', () => {
  assert.equal(value('sqrt(144)'), 12)
  assert.equal(value('abs(-7)'), 7)
  assert.equal(value('round(4.6)'), 5)
  assert.equal(value('log(1000)'), 3)
})

test('a percentage is understood the way it is written', () => {
  assert.equal(value('15% of 850'), 127.5)
  assert.equal(calculate('15% of 850')?.display, '127.5')
})

test('what is not a sum is refused, so the page can show search results instead', () => {
  assert.equal(calculate('who is albert einstein'), null)
  assert.equal(calculate('python 3 tutorial'), null)
  assert.equal(calculate(''), null)
  assert.equal(calculate('hello'), null)
  // A bare number is not a calculation; it is a search for a number.
  assert.equal(calculate('42'), null)
})

test('a malformed expression is refused rather than guessed at', () => {
  assert.equal(calculate('(2 + 3'), null)
  assert.equal(calculate('2 + 3)'), null)
  assert.equal(calculate('2 +'), null)
  assert.equal(calculate('* 5'), null)
})

test('dividing by zero gives the true answer rather than a refusal', () => {
  assert.equal(value('1/0'), Infinity)
})

test('numbers are shown the way people write them', () => {
  assert.equal(formatNumber(1200), '1,200')
  assert.equal(formatNumber(1234567), '1,234,567')
  assert.equal(formatNumber(127.5), '127.5')
  assert.equal(formatNumber(0.1 + 0.2), '0.3', 'floating point noise is not shown to people')
})

// ---------------------------------------------------------------- conversions

test('lengths, masses and data convert exactly', () => {
  assert.equal(Math.round(convert('100 km to miles')!.value * 1000) / 1000, 62.137)
  assert.equal(convert('1 kg to g')!.value, 1000)
  assert.equal(convert('2 gb to mb')!.value, 2048)
})

test('temperature is a formula, not a factor', () => {
  assert.equal(convert('100 c to f')!.value, 212)
  assert.equal(convert('32 f to c')!.value, 0)
  assert.equal(convert('0 c to k')!.value, 273.15)
})

test('converting between different kinds of thing is refused, not answered', () => {
  assert.equal(convert('5 kg to miles'), null)
  assert.equal(convert('10 gb to celsius'), null)
})

test('currency is not invented, because a rate is a fact about today', () => {
  assert.equal(convert('100 usd to eur'), null)
  assert.equal(convert('50 gbp to inr'), null)
})

test('a conversion to the same unit is not a conversion', () => {
  assert.equal(convert('5 km to km'), null)
})

test('the words people put in front are understood', () => {
  assert.ok(convert('convert 10 miles to km'))
  assert.ok(convert('how many cm in 2 m'))
})
