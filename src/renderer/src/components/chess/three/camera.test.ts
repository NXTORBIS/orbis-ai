import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DISTANCE_MAX, DISTANCE_MIN, POLAR_MAX, POLAR_MIN, TARGET, blendViews, cameraPosition, canPick, clampView,
  defaultView, easeInOut, overheadView, presetView, rotateByDrag, rotateBySteps, sameView, sideView, wheelSteps,
  wrapAngle, zoomBySteps, type View
} from './camera.ts'
import { HALF, squareFromRay, squareToWorld } from './boardGeometry.ts'

const within = (actual: number, expected: number, slack = 1e-9): void => {
  assert.ok(Math.abs(actual - expected) <= slack, `${actual} is not ${expected}`)
}

test('the starting view is above the board, behind the near edge, and holds the whole of it', () => {
  const view = defaultView()
  const eye = cameraPosition(view)
  assert.ok(eye.y > 4, 'the camera is not high enough to see the board as a board')
  assert.ok(eye.z > HALF, 'the camera is not behind the near edge')
  within(eye.x, 0, 1e-9)
  assert.ok(view.distance > HALF, 'the camera is inside the board')
})

test('an angle always comes back inside half a turn either way', () => {
  within(wrapAngle(0), 0)
  within(wrapAngle(Math.PI), Math.PI)
  within(wrapAngle(Math.PI * 2), 0)
  within(wrapAngle(-Math.PI * 2), 0)
  within(wrapAngle(Math.PI * 3), Math.PI)
  within(wrapAngle(Math.PI * 2.5), Math.PI * 0.5)
  assert.equal(wrapAngle(Number.NaN), 0)
  for (const angle of [-40, -7.3, -1, 0, 1, 7.3, 40, 1000]) {
    const out = wrapAngle(angle)
    assert.ok(out > -Math.PI && out <= Math.PI, `${angle} wrapped to ${out}`)
  }
})

test('the view can never leave the limits, whatever it is handed', () => {
  const absurd: View[] = [
    { azimuth: 400, polar: -9, distance: -5 },
    { azimuth: -400, polar: 90, distance: 9999 },
    { azimuth: Number.NaN, polar: Number.NaN, distance: Number.NaN },
    { azimuth: 0, polar: Number.POSITIVE_INFINITY, distance: 0 }
  ]
  for (const view of absurd) {
    const safe = clampView(view)
    assert.ok(safe.polar >= POLAR_MIN && safe.polar <= POLAR_MAX, `polar ${safe.polar}`)
    assert.ok(safe.distance >= DISTANCE_MIN && safe.distance <= DISTANCE_MAX, `distance ${safe.distance}`)
    assert.ok(safe.azimuth > -Math.PI && safe.azimuth <= Math.PI, `azimuth ${safe.azimuth}`)
  }
})

test('the camera stays above the board at every angle it is allowed to reach', () => {
  /*
   * The reason this matters is not how it looks. The pointer finds a square by following a line down onto a flat
   * surface, so a camera that got level with the board, or under it, would stop being able to click at all. The
   * tilt limit and clicking are the same fact, and this is where they are held together.
   */
  for (let polar = POLAR_MIN; polar <= POLAR_MAX + 1e-9; polar += 0.02) {
    for (const distance of [DISTANCE_MIN, 12, DISTANCE_MAX]) {
      for (const azimuth of [0, 1, -2, 3]) {
        const view = clampView({ azimuth, polar, distance })
        const eye = cameraPosition(view)
        assert.ok(eye.y > 0.05, `polar ${polar} put the camera at y ${eye.y}`)
        assert.ok(canPick(view), `polar ${polar} cannot pick a square`)
      }
    }
  }
})

test('from the limits of the tilt, the middle of the board is still clickable', () => {
  for (const polar of [POLAR_MIN, POLAR_MAX]) {
    for (const azimuth of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const view = clampView({ azimuth, polar, distance: 12 })
      const eye = cameraPosition(view)
      const middle = squareToWorld('d4', 'w')
      assert.ok(middle)
      const square = squareFromRay(eye, { x: middle.x - eye.x, y: -eye.y, z: middle.z - eye.z }, 'w')
      assert.equal(square, 'd4', `at polar ${polar}, azimuth ${azimuth}, d4 could not be reached`)
    }
  }
})

test('dragging across turns the board and dragging up raises the camera', () => {
  const from = defaultView()
  const right = rotateByDrag(from, 100, 0)
  assert.ok(right.azimuth < from.azimuth, 'dragging right did not swing the camera the other way')
  within(right.polar, from.polar)
  within(right.distance, from.distance)
  const up = rotateByDrag(from, 0, -100)
  assert.ok(up.polar > from.polar, 'dragging up did not lower the camera towards the board')
  const down = rotateByDrag(from, 0, 100)
  assert.ok(down.polar < from.polar)
  // Dragging a long way does not escape the limits.
  const miles = rotateByDrag(from, 0, -100000)
  within(miles.polar, POLAR_MAX)
})

test('turning with the keys is the same movement in whole steps', () => {
  const from = defaultView()
  const once = rotateBySteps(from, 1, 0)
  const twice = rotateBySteps(once, 1, 0)
  within(wrapAngle(from.azimuth - once.azimuth), wrapAngle(once.azimuth - twice.azimuth), 1e-9)
  // Nothing at all is nothing at all.
  assert.ok(sameView(rotateBySteps(from, 0, 0), from))
})

test('zooming is the same proportion each step and stops at the ends', () => {
  const from = defaultView()
  const closer = zoomBySteps(from, -1)
  const further = zoomBySteps(from, 1)
  assert.ok(closer.distance < from.distance)
  assert.ok(further.distance > from.distance)
  within(closer.distance * (further.distance / from.distance), from.distance, 1e-9)
  // A hundred steps in either direction lands exactly on the limit rather than somewhere silly.
  within(zoomBySteps(from, -100).distance, DISTANCE_MIN)
  within(zoomBySteps(from, 100).distance, DISTANCE_MAX)
  assert.ok(sameView(zoomBySteps(from, 0), from))
  assert.ok(sameView(zoomBySteps(from, Number.NaN), from))
})

test('a wheel turn becomes steps whatever the device reports', () => {
  // A mouse, reporting pixels.
  assert.ok(wheelSteps(100, 0) > 0)
  assert.ok(wheelSteps(-100, 0) < 0)
  within(wheelSteps(100, 0), 1)
  // A device reporting lines, and one reporting pages.
  within(wheelSteps(3, 1), 1)
  within(wheelSteps(1, 2), 1)
  // A trackpad flick of a couple of pixels still does something rather than nothing.
  assert.ok(Math.abs(wheelSteps(2, 0)) > 0)
  assert.equal(Math.sign(wheelSteps(2, 0)), 1)
  assert.equal(Math.sign(wheelSteps(-2, 0)), -1)
  // Nothing is nothing, and a runaway wheel is capped.
  assert.equal(wheelSteps(0, 0), 0)
  assert.equal(wheelSteps(Number.NaN, 0), 0)
  assert.ok(wheelSteps(100000, 0) <= 3)
  assert.ok(wheelSteps(-100000, 0) >= -3)
})

test('the named views are all different and all usable', () => {
  const views = [presetView('default'), presetView('overhead'), presetView('side')]
  assert.deepEqual(views[0], defaultView())
  assert.deepEqual(views[1], overheadView())
  assert.deepEqual(views[2], sideView())
  for (const view of views) {
    assert.ok(canPick(view))
    const safe = clampView(view)
    assert.deepEqual(safe, view, 'a named view is outside its own limits')
  }
  // From above really is from above, and from the side really is low.
  assert.ok(views[1].polar < views[0].polar)
  assert.ok(views[2].polar > views[0].polar)
})

test('swinging back to a view takes the short way round', () => {
  // Just past half a turn: the way home is forward a little, not backward almost the whole way.
  const from: View = clampView({ azimuth: 3.0, polar: 0.9, distance: 12 })
  const to: View = clampView({ azimuth: -3.0, polar: 0.9, distance: 12 })
  const half = blendViews(from, to, 0.5)
  // The short way crosses the half-turn mark, so halfway is near it rather than near zero.
  assert.ok(Math.abs(half.azimuth) > 3.0, `halfway came out at ${half.azimuth}, which is the long way round`)
  assert.ok(sameView(blendViews(from, to, 0), from))
  assert.ok(sameView(blendViews(from, to, 1), to))
  assert.ok(sameView(blendViews(from, to, Number.NaN), to))
})

test('the easing starts and ends still and passes through the middle', () => {
  within(easeInOut(0), 0)
  within(easeInOut(1), 1)
  within(easeInOut(0.5), 0.5)
  within(easeInOut(-5), 0)
  within(easeInOut(5), 1)
  let last = -1
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const value = easeInOut(t)
    assert.ok(value >= last, `the easing went backwards at ${t}`)
    last = value
  }
})

test('the camera looks at the middle of the board, not at its surface', () => {
  // Lifted a little, so the pieces sit in the frame rather than the board filling the bottom half of it.
  assert.ok(TARGET.y > 0)
  assert.equal(TARGET.x, 0)
  assert.equal(TARGET.z, 0)
  const eye = cameraPosition(defaultView())
  const reach = Math.hypot(eye.x - TARGET.x, eye.y - TARGET.y, eye.z - TARGET.z)
  within(reach, defaultView().distance, 1e-9)
})

test('two views the eye cannot tell apart are treated as the same view', () => {
  const view = defaultView()
  assert.ok(sameView(view, { ...view }))
  assert.ok(sameView(view, { ...view, distance: view.distance + 1e-6 }))
  assert.equal(sameView(view, { ...view, distance: view.distance + 0.5 }), false)
  assert.equal(sameView(view, { ...view, polar: view.polar + 0.1 }), false)
  // A whole turn round is the same view, which is what stops the reset swinging for nothing.
  assert.ok(sameView(view, { ...view, azimuth: view.azimuth + Math.PI * 2 }))
})
