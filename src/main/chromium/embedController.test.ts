import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegion, physicalRect } from './embedController.ts'

test('regions are validated and scaled to whole physical pixels', () => {
  assert.equal(parseRegion(null), null)
  assert.equal(parseRegion({ x: 0, y: 0, width: 10, height: 10, dpr: 0, visible: true }), null)
  assert.equal(parseRegion({ x: 'a', y: 0, width: 10, height: 10, dpr: 1, visible: true }), null)
  const r = parseRegion({ x: 200.4, y: 36, width: 800.3, height: 500, dpr: 1.5, visible: true })
  assert.ok(r)
  const p = physicalRect(r)
  assert.equal(p.x, Math.round(200.4 * 1.5))
  assert.equal(p.x + p.width, Math.round(1000.7 * 1.5))
  assert.equal(p.y, 54)
})
