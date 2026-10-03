import { test } from 'node:test'
import assert from 'node:assert/strict'
import { areaPath, curvePoints, highLow, linePath, smoothPath } from './curve.ts'

const BOX = { width: 100, height: 40, pad: 4 }

test('nothing is drawn from a run too short to be a line', () => {
  assert.deepEqual(curvePoints([], BOX), [])
  assert.deepEqual(curvePoints([64_000], BOX), [])
})

test('a run holding something that is not a number draws nothing at all', () => {
  // A price that could not be read is not a price of zero, so the whole run is refused rather than bent towards one.
  assert.deepEqual(curvePoints([1, Number.NaN, 3], BOX), [])
  assert.deepEqual(curvePoints([1, Number.POSITIVE_INFINITY], BOX), [])
})

test('the points fill the box, high numbers at the top', () => {
  const points = curvePoints([10, 20, 30], BOX)
  assert.equal(points.length, 3)
  assert.deepEqual(points.map((one) => one.x), [4, 50, 96])
  // The lowest number sits on the floor of the box and the highest on its ceiling, both inside the padding.
  assert.deepEqual(points.map((one) => one.y), [36, 20, 4])
  assert.deepEqual(points.map((one) => one.value), [10, 20, 30])
})

test('the ends can be given their own room, so a dot sits over its own label', () => {
  // Five hours across 100, each in a column of 20: the dots land on 10, 30, 50, 70, 90, which is where the hours go.
  const points = curvePoints([1, 2, 3, 4, 5], { width: 100, height: 40, pad: 3, padX: 10 })
  assert.deepEqual(points.map((one) => one.x), [10, 30, 50, 70, 90])
  assert.deepEqual(points.map((one) => one.y), [37, 28.5, 20, 11.5, 3])
})

test('a run that never moves is drawn flat through the middle', () => {
  const points = curvePoints([7, 7, 7, 7], BOX)
  assert.deepEqual(points.map((one) => one.y), [20, 20, 20, 20])
})

test('a path is written only when there are points', () => {
  assert.equal(linePath([]), '')
  assert.equal(smoothPath([], BOX), '')
  assert.equal(areaPath('', [], 40), '')
  assert.equal(areaPath('M0 0 L1 1', [], 40), '')
})

test('two points are joined straight, three or more are softened', () => {
  const two = curvePoints([1, 2], BOX)
  assert.equal(smoothPath(two, BOX), linePath(two))
  const many = curvePoints([1, 5, 2, 6], BOX)
  assert.match(smoothPath(many, BOX), /^M[\d.]+ [\d.]+ C/)
  assert.equal(smoothPath(many, BOX).split('C').length - 1, 3)
})

test('a softened curve never leaves its box', () => {
  // A spike between two low readings is where a curve would overshoot and be drawn clipped.
  const points = curvePoints([1, 1, 40, 1, 1, 40, 1], BOX)
  const numbers = smoothPath(points, BOX).split(/[^\d.]+/).filter((one) => one !== '').map(Number)
  const ys = numbers.filter((_one, at) => at % 2 === 1)
  assert.ok(Math.min(...ys) >= 0, 'nothing above the top')
  assert.ok(Math.max(...ys) <= BOX.height, 'nothing below the bottom')
})

test('an area closes the line down to its floor', () => {
  const points = curvePoints([1, 2], BOX)
  assert.equal(areaPath(linePath(points), points, 40), 'M4 36 L96 4 L96 40 L4 40 Z')
})

test('the highest and the lowest point, and the first of equals', () => {
  assert.equal(highLow([]), null)
  const points = curvePoints([5, 9, 2, 9], BOX)
  const found = highLow(points)
  assert.equal(found?.high.value, 9)
  assert.equal(found?.high.x, points[1].x)
  assert.equal(found?.low.value, 2)
})
