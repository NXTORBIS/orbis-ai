import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NoteElement, ShapeElement, StrokeElement } from '../shared/whiteboard.ts'
import { boardBounds, boardToSvg, bounds, hits, move, newBoard, normalizeBoard, normalizeElement, pick, pickIn, scale, simplify, topZ } from '../shared/whiteboard.ts'

const stroke = (patch: Partial<StrokeElement> = {}): StrokeElement => ({ id: 's', kind: 'stroke', z: 1, color: '#fff', createdAt: 0, width: 4, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], ...patch })
const rect = (patch: Partial<ShapeElement> = {}): ShapeElement => ({ id: 'r', kind: 'rectangle', z: 2, color: '#fff', createdAt: 0, width: 2, from: { x: 10, y: 10 }, to: { x: 110, y: 60 }, ...patch })
const note = (patch: Partial<NoteElement> = {}): NoteElement => ({ id: 'n', kind: 'note', z: 3, color: '#ffd866', createdAt: 0, at: { x: 200, y: 200 }, text: 'remember', width: 180, height: 140, ...patch })

test('a thing knows the space it takes, and a board knows the space it all takes', () => {
  assert.deepEqual(bounds(stroke()), { x: -2, y: -2, width: 104, height: 4 })
  assert.deepEqual(bounds(note()), { x: 200, y: 200, width: 180, height: 140 })
  const all = boardBounds([stroke(), note()])!
  assert.equal(all.x, -2)
  assert.equal(Math.round(all.width), 382)
  assert.equal(boardBounds([]), null)
  assert.equal(topZ([stroke(), note()]), 4)
})

test('picking finds what is under the pointer, frontmost first, and only near lines', () => {
  const elements = [stroke(), rect(), note()]
  assert.equal(pick(elements, { x: 50, y: 0 })?.id, 's', 'right on the line')
  assert.equal(pick(elements, { x: 50, y: 40 }), null, 'inside an unfilled rectangle is empty space')
  assert.equal(pick(elements, { x: 10, y: 35 })?.id, 'r', 'on the rectangle edge')
  assert.equal(pick(elements, { x: 250, y: 250 })?.id, 'n')
  assert.equal(pick([rect({ fill: '#123456' })], { x: 50, y: 40 })?.id, 'r', 'a filled shape is caught anywhere inside')
  // Frontmost wins where things overlap.
  const overlapping = [note({ id: 'back', z: 1 }), note({ id: 'front', z: 9 })]
  assert.equal(pick(overlapping, { x: 210, y: 210 })?.id, 'front')
  assert.deepEqual(pickIn(elements, { x: -10, y: -10, width: 200, height: 200 }).map((e) => e.id), ['s', 'r'])
})

test('moving and scaling keep a thing together', () => {
  const moved = move(stroke(), 10, 5)
  assert.deepEqual(bounds(moved), { x: 8, y: 3, width: 104, height: 4 })
  const scaled = scale(rect(), { x: 10, y: 10 }, 2)
  assert.deepEqual(bounds(scaled), { x: 8, y: 8, width: 204, height: 104 })
  assert.equal((move(note(), -100, -100) as NoteElement).at.x, 100)
})

test('a drawn line keeps its shape with far fewer points', () => {
  const points = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.round(Math.sin(i / 25) * 40) }))
  const fewer = simplify(points, 1)
  assert.ok(fewer.length < points.length / 3, `kept ${fewer.length} of ${points.length}`)
  assert.deepEqual(fewer[0], points[0])
  assert.deepEqual(fewer.at(-1), points.at(-1))
  // Every dropped point is still close to the line that remains.
  for (const p of points) {
    const near = fewer.some((q, i) => i > 0 && Math.abs(p.x - q.x) <= 30)
    assert.ok(near)
  }
  assert.deepEqual(simplify([{ x: 0, y: 0 }, { x: 1, y: 1 }]), [{ x: 0, y: 0 }, { x: 1, y: 1 }])
})

test('stored boards are checked: bad things are dropped, names and limits enforced', () => {
  const board = normalizeBoard({
    id: 'b1',
    name: '  My   board  ',
    background: 'starfield',
    elements: [stroke(), { id: 'x', kind: 'image', at: { x: 0, y: 0 }, src: 'https://example.com/a.png' }, { kind: 'note', text: 'no id' }, note()]
  })
  assert.equal(board?.name, 'My board')
  assert.equal(board?.background, 'grid')
  assert.deepEqual(board?.elements.map((e) => e.id), ['s', 'n'], 'a remote image and an element without an id are dropped')
  assert.equal(normalizeBoard({ name: 'no id' }), null)
  assert.equal(normalizeElement({ id: 'e', kind: 'stroke', points: [] }), null, 'a line with no points is not a line')
  assert.equal(normalizeElement({ id: 'e', kind: 'text', at: { x: 1, y: 2 }, text: 'hi' })?.kind, 'text')
  assert.equal(newBoard({ name: 'Fresh' }).elements.length, 0)
})

test('a board writes out as SVG with everything on it', () => {
  const svg = boardToSvg(newBoard({ id: 'b', elements: [stroke(), rect({ fill: '#222' }), note({ text: 'hello' }), { id: 'a', kind: 'arrow', z: 4, color: '#3fd8ff', createdAt: 0, width: 3, from: { x: 0, y: 0 }, to: { x: 60, y: 60 } }] }))
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/)
  assert.match(svg, /<path d="M/)
  assert.match(svg, /<rect [^>]*fill="#222"/)
  assert.match(svg, /<polygon points=/, 'the arrow has a head')
  assert.match(svg, />hello</)
  assert.ok(svg.trim().endsWith('</svg>'))
  const escaped = boardToSvg(newBoard({ elements: [{ id: 't', kind: 'text', z: 1, color: '#fff', createdAt: 0, at: { x: 0, y: 0 }, text: '<script>&"', size: 14 }] }))
  assert.match(escaped, /&lt;script&gt;&amp;&quot;/)
  assert.doesNotMatch(escaped, /<script>/)
})

test('hit testing ignores points far outside a thing', () => {
  assert.equal(hits(stroke(), { x: 50, y: 300 }), false)
  assert.equal(hits(note(), { x: 0, y: 0 }), false)
})
