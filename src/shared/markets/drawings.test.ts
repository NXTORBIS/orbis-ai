import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  anchorsFor,
  boundsOf,
  channelOffset,
  cleanAnchor,
  cleanDrawing,
  cleanDrawings,
  drawingsFor,
  DRAWING_INFO,
  DRAWING_KINDS,
  fibLevels,
  inView,
  moveAnchor,
  priceAt,
  type Drawing,
  type DrawingKind
} from './drawings.ts'

const ID = 'binance:crypto:binance:btcusdt'
const HOUR = 3_600_000

const drawing = (kind: DrawingKind, anchors: { at: number; price: number }[], patch: Partial<Drawing> = {}): Drawing => ({
  id: 'd1',
  kind,
  instrumentId: ID,
  anchors,
  visible: true,
  createdAt: 1000,
  ...patch
})

// ---------------------------------------------------------------- market coordinates, always

test('every kind is described and says how many anchors it needs', () => {
  for (const kind of DRAWING_KINDS) {
    assert.ok(anchorsFor(kind) >= 1, kind)
    assert.ok(DRAWING_INFO[kind].label.length > 2, kind)
    assert.ok(DRAWING_INFO[kind].hint.length > 5, kind)
  }
})

test('an anchor is a moment and a price, and nothing else is one', () => {
  assert.deepEqual(cleanAnchor({ at: 1000, price: 50 }), { at: 1000, price: 50 })
  assert.equal(cleanAnchor({ at: 0, price: 50 }), null)
  assert.equal(cleanAnchor({ at: 1000, price: 0 }), null)
  assert.equal(cleanAnchor({ at: 1000, price: -5 }), null)
  assert.equal(cleanAnchor({ x: 120, y: 340 }), null)
  assert.equal(cleanAnchor(null), null)
})

test('a drawing with too few anchors is refused rather than drawn half-defined', () => {
  assert.equal(cleanDrawing({ id: 'a', kind: 'trendline', instrumentId: ID, anchors: [{ at: 1, price: 1 }] }), null)
  assert.equal(cleanDrawing({ id: 'a', kind: 'channel', instrumentId: ID, anchors: [{ at: 1, price: 1 }, { at: 2, price: 2 }] }), null)
  assert.ok(cleanDrawing({ id: 'a', kind: 'horizontal', instrumentId: ID, anchors: [{ at: 1, price: 1 }] }))
})

test('an unknown kind is refused', () => {
  assert.equal(cleanDrawing({ id: 'a', kind: 'spiral', instrumentId: ID, anchors: [{ at: 1, price: 1 }] }), null)
})

test('a label is a label, never anything a screen would run', () => {
  const cleaned = cleanDrawing({
    id: 'a',
    kind: 'text',
    instrumentId: ID,
    anchors: [{ at: 1, price: 1 }],
    text: '<script>alert(1)</script>support'
  })
  assert.equal(cleaned?.text, 'scriptalert(1)/scriptsupport')
})

test('a colour the design system does not have is dropped', () => {
  const cleaned = cleanDrawing({
    id: 'a',
    kind: 'horizontal',
    instrumentId: ID,
    anchors: [{ at: 1, price: 1 }],
    colour: 'url(javascript:x)'
  })
  assert.equal(cleaned?.colour, undefined)
})

test('reading a list back drops duplicates and bounds it', () => {
  const raw = [
    { id: 'a', kind: 'horizontal', instrumentId: ID, anchors: [{ at: 1, price: 1 }] },
    { id: 'a', kind: 'horizontal', instrumentId: ID, anchors: [{ at: 1, price: 2 }] },
    'nonsense'
  ]
  assert.equal(cleanDrawings(raw).length, 1)
  const many = Array.from({ length: 500 }, (_, i) => ({
    id: `d${i}`,
    kind: 'horizontal',
    instrumentId: ID,
    anchors: [{ at: 1, price: 1 }]
  }))
  assert.equal(cleanDrawings(many, 0, 200).length, 200)
})

// ---------------------------------------------------------------- geometry

test('a horizontal line holds its price at every moment', () => {
  const line = drawing('horizontal', [{ at: 1000, price: 84_500 }])
  assert.equal(priceAt(line, 1), 84_500)
  assert.equal(priceAt(line, 999_999_999), 84_500)
})

test('a trend line interpolates between its anchors and extends past them', () => {
  const line = drawing('trendline', [
    { at: 0, price: 100 },
    { at: 10 * HOUR, price: 200 }
  ])
  assert.equal(priceAt(line, 5 * HOUR), 150)
  // Extended, which is the whole use of a trend line after the second point.
  assert.equal(priceAt(line, 20 * HOUR), 300)
  assert.equal(priceAt(line, -10 * HOUR), 0)
})

test('a ray does not exist before its first anchor', () => {
  const ray = drawing('ray', [
    { at: 10 * HOUR, price: 100 },
    { at: 20 * HOUR, price: 200 }
  ])
  assert.equal(priceAt(ray, 5 * HOUR), null)
  assert.equal(priceAt(ray, 30 * HOUR), 300)
})

test('two anchors at the same moment describe no slope, so there is no price to follow', () => {
  const line = drawing('trendline', [
    { at: 1000, price: 100 },
    { at: 1000, price: 200 }
  ])
  assert.equal(priceAt(line, 2000), null)
})

test('a channel offsets its second line by the third anchor', () => {
  const channel = drawing('channel', [
    { at: 0, price: 100 },
    { at: 10 * HOUR, price: 200 },
    { at: 5 * HOUR, price: 170 }
  ])
  // The line is at 150 at that moment; the third anchor is 20 above it.
  assert.equal(channelOffset(channel), 20)
  assert.equal(channelOffset(drawing('trendline', [{ at: 0, price: 1 }, { at: 1, price: 2 }])), null)
})

test('fibonacci levels run from the second anchor back toward the first', () => {
  const fib = drawing('fibonacci', [
    { at: 0, price: 100 },
    { at: 10 * HOUR, price: 200 }
  ])
  const levels = fibLevels(fib)
  assert.equal(levels.length, 7)
  assert.equal(levels[0].price, 200)
  assert.equal(levels[levels.length - 1].price, 100)
  const half = levels.find((one) => one.fraction === 0.5)
  assert.equal(half?.price, 150)
  assert.equal(half?.label, '50%')
})

test('a rectangle normalises its corners, so they can be given in any order', () => {
  const box = drawing('rectangle', [
    { at: 10 * HOUR, price: 200 },
    { at: 2 * HOUR, price: 100 }
  ])
  assert.deepEqual(boundsOf(box), { from: 2 * HOUR, to: 10 * HOUR, low: 100, high: 200 })
})

// ---------------------------------------------------------------- the point of all this

test('a drawing keeps its place when the chart is zoomed, because it was never stored in pixels', () => {
  // The same drawing, asked about across wildly different visible ranges. Its price at a moment does not depend on what
  // the chart happens to be showing -- which is the whole reason anchors are time and price.
  const line = drawing('trendline', [
    { at: 0, price: 100 },
    { at: 10 * HOUR, price: 200 }
  ])
  const answer = priceAt(line, 7 * HOUR)
  assert.equal(answer, 170)
  // Nothing about the view can change it: there is no view in the call.
  assert.equal(priceAt(line, 7 * HOUR), answer)
})

test('what is in view is judged generously for things with a slope', () => {
  const line = drawing('trendline', [
    { at: 0, price: 100 },
    { at: HOUR, price: 200 }
  ])
  // Both anchors far to the left, but the line still crosses the view.
  assert.equal(inView(line, 100 * HOUR, 200 * HOUR), true)
  assert.equal(inView(drawing('horizontal', [{ at: 1, price: 1 }]), 999, 1000), true)
  const box = drawing('rectangle', [
    { at: HOUR, price: 100 },
    { at: 2 * HOUR, price: 200 }
  ])
  assert.equal(inView(box, 10 * HOUR, 20 * HOUR), false)
  assert.equal(inView(box, 0, 3 * HOUR), true)
})

// ---------------------------------------------------------------- editing

test('dragging an anchor moves it in market coordinates', () => {
  const line = drawing('trendline', [
    { at: 0, price: 100 },
    { at: HOUR, price: 200 }
  ])
  const moved = moveAnchor(line, 1, { at: 2 * HOUR, price: 300 })
  assert.deepEqual(moved.anchors[1], { at: 2 * HOUR, price: 300 })
  assert.deepEqual(moved.anchors[0], line.anchors[0])
})

test('a locked drawing is not moved by a stray drag', () => {
  const line = drawing('horizontal', [{ at: HOUR, price: 100 }], { locked: true })
  assert.deepEqual(moveAnchor(line, 0, { at: HOUR, price: 999 }).anchors[0], { at: HOUR, price: 100 })
})

test('an anchor that is not a point on a chart does not move anything', () => {
  const line = drawing('horizontal', [{ at: HOUR, price: 100 }])
  assert.deepEqual(moveAnchor(line, 0, { at: 0, price: 0 }).anchors[0], { at: HOUR, price: 100 })
  assert.deepEqual(moveAnchor(line, 5, { at: HOUR, price: 1 }).anchors[0], { at: HOUR, price: 100 })
})

test('a drawing only ever appears on the market it was drawn on', () => {
  const mine = drawing('horizontal', [{ at: HOUR, price: 1 }])
  const theirs = drawing('horizontal', [{ at: HOUR, price: 1 }], { id: 'd2', instrumentId: 'other:1:2:3' })
  assert.deepEqual(drawingsFor([mine, theirs], ID), [mine])
})
