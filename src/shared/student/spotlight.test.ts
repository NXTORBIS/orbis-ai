import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  bubbleBeside,
  orbiBeside,
  paddingFor,
  rings,
  sideFor,
  spotlightFor,
  travelTime,
  worthLighting,
  type Target,
  type Viewport
} from './spotlight.ts'

const screen: Viewport = { width: 1280, height: 800 }
const button: Target = { left: 600, top: 400, width: 120, height: 40 }
const panel: Target = { left: 100, top: 120, width: 700, height: 420 }
const icon: Target = { left: 300, top: 300, width: 32, height: 32 }

describe('the spotlight', () => {
  it('leaves more room round something small than something large', () => {
    assert.ok(paddingFor(icon) > paddingFor(panel))
  })

  it('surrounds the thing it is lighting', () => {
    const spot = spotlightFor(button, screen)
    assert.ok(spot.left < button.left)
    assert.ok(spot.top < button.top)
    assert.ok(spot.left + spot.width > button.left + button.width)
    assert.ok(spot.top + spot.height > button.top + button.height)
  })

  it('never runs off the edge of the window', () => {
    for (const target of [
      { left: 0, top: 0, width: 60, height: 30 },
      { left: 1240, top: 770, width: 60, height: 40 },
      { left: -20, top: 400, width: 100, height: 50 }
    ]) {
      const spot = spotlightFor(target, screen)
      assert.ok(spot.left >= 0, `left ${spot.left}`)
      assert.ok(spot.top >= 0, `top ${spot.top}`)
      assert.ok(spot.left + spot.width <= screen.width, 'runs off the right')
      assert.ok(spot.top + spot.height <= screen.height, 'runs off the bottom')
    }
  })

  it('a small square thing is lit as a circle', () => {
    const spot = spotlightFor(icon, screen)
    assert.equal(spot.radius, Math.max(spot.width, spot.height) / 2)
  })

  it('but a wide panel is not, because a circle round a card lights half of what is beside it', () => {
    const spot = spotlightFor(panel, screen)
    assert.ok(spot.radius <= 22, `a panel should keep gentle corners, got ${spot.radius}`)
  })

  it('the centre and the reach describe the lit area, for the rings to work from', () => {
    const spot = spotlightFor(button, screen)
    assert.equal(spot.centreX, spot.left + spot.width / 2)
    assert.equal(spot.centreY, spot.top + spot.height / 2)
    assert.ok(spot.reach > spot.width / 2)
  })

  it('it picks the side with room, preferring beside', () => {
    assert.equal(sideFor(spotlightFor({ left: 200, top: 400, width: 100, height: 40 }, screen), screen), 'right')
    // Hard against the right edge: there is no room on the right, so it goes to the left.
    assert.equal(sideFor(spotlightFor({ left: 1150, top: 400, width: 100, height: 40 }, screen), screen), 'left')
  })

  it('a wide thing is approached from below rather than from the margin beside it', () => {
    /*
     * Standing in the margin beside a full-width card means standing over the application's own sidebar, which
     * reads as a mistake even though it is outside the light.
     */
    const wide = spotlightFor({ left: 340, top: 300, width: 1120, height: 140 }, screen)
    assert.equal(sideFor(wide, screen), 'below')
  })

  it('and when nothing has room it still answers', () => {
    const tiny: Viewport = { width: 300, height: 300 }
    const side = sideFor(spotlightFor({ left: 20, top: 20, width: 260, height: 260 }, tiny), tiny)
    assert.ok(['left', 'right', 'above', 'below'].includes(side))
  })

  it('Orbi never stands in its own spotlight', () => {
    /*
     * The whole reason this replaced pointing.
     *
     * Orbi standing over the lit thing hides exactly what the light exists to show.
     */
    for (const target of [button, panel, icon, { left: 20, top: 20, width: 80, height: 80 }]) {
      const spot = spotlightFor(target, screen)
      const side = sideFor(spot, screen)
      const where = orbiBeside(spot, side, 70, screen)
      const insideX = where.x > spot.left && where.x < spot.left + spot.width
      const insideY = where.y > spot.top && where.y < spot.top + spot.height
      assert.ok(!(insideX && insideY), `Orbi stood inside the light for ${JSON.stringify(target)}`)
    }
  })

  it('and never off the screen either', () => {
    const spot = spotlightFor({ left: 1200, top: 760, width: 70, height: 36 }, screen)
    const where = orbiBeside(spot, sideFor(spot, screen), 70, screen)
    assert.ok(where.x >= 0 && where.x <= screen.width, `x ${where.x}`)
    assert.ok(where.y >= 0 && where.y <= screen.height, `y ${where.y}`)
  })

  it('Orbi faces the thing it is looking at', () => {
    const spot = spotlightFor(button, screen)
    assert.equal(orbiBeside(spot, 'right', 70, screen).flip, true, 'standing to the right, it faces back left')
    assert.equal(orbiBeside(spot, 'left', 70, screen).flip, false)
  })

  it('the words sit near the light and stay on screen', () => {
    for (const side of ['left', 'right', 'above', 'below'] as const) {
      const spot = spotlightFor(button, screen)
      const where = bubbleBeside(spot, side, screen)
      assert.ok(where.left >= 0 && where.left + 320 <= screen.width, `${side}: left ${where.left}`)
      assert.ok(where.top >= 0 && where.top + 180 <= screen.height, `${side}: top ${where.top}`)
    }
  })

  it('and never land on the thing being explained', () => {
    /*
     * The fault this guards against covered the very thing it was describing.
     *
     * Placing on the preferred side and clamping afterwards pulled the words straight back over a spotlight near
     * the bottom of the screen. Clamping has to be part of choosing the side, not applied after it.
     */
    const awkward: Target[] = [
      { left: 40, top: 640, width: 900, height: 120 },
      { left: 900, top: 620, width: 340, height: 150 },
      { left: 40, top: 30, width: 1180, height: 120 },
      { left: 500, top: 300, width: 300, height: 200 }
    ]
    for (const target of awkward) {
      const spot = spotlightFor(target, screen)
      const side = sideFor(spot, screen)
      const at = bubbleBeside(spot, side, screen)
      const across = Math.max(0, Math.min(at.left + 320, spot.left + spot.width) - Math.max(at.left, spot.left))
      const down = Math.max(0, Math.min(at.top + 180, spot.top + spot.height) - Math.max(at.top, spot.top))
      assert.equal(across * down, 0, `the words covered the light for ${JSON.stringify(target)}`)
      assert.ok(at.left >= 0 && at.left + 320 <= screen.width)
      assert.ok(at.top >= 0 && at.top + 180 <= screen.height)
    }
  })

  it('the rings chase each other rather than arriving together', () => {
    const out = rings(spotlightFor(button, screen))
    assert.equal(out.length, 3)
    const delays = out.map((one) => one.delay)
    assert.equal(new Set(delays).size, delays.length, 'every ring starts at a different moment')
    for (const one of out) assert.ok(one.scale > 1, 'a ring has to travel outward')
  })

  it('a big thing gets proportionally smaller rings, so they do not swamp the screen', () => {
    const small = rings(spotlightFor(icon, screen))[0].scale
    const large = rings(spotlightFor(panel, screen))[0].scale
    assert.ok(large < small, `a panel's rings (${large}) should travel less far than an icon's (${small})`)
  })

  it('something invisible is not lit', () => {
    assert.equal(worthLighting({ left: 0, top: 0, width: 0, height: 0 }, screen), false)
    assert.equal(worthLighting({ left: 0, top: 0, width: 4, height: 4 }, screen), false)
  })

  it('nor is something that fills the screen, where darkening the rest says nothing', () => {
    assert.equal(worthLighting({ left: 0, top: 0, width: 1280, height: 780 }, screen), false)
    assert.equal(worthLighting(panel, screen), true)
  })

  it('the light moves quickly, and further takes a little longer', () => {
    const a = spotlightFor({ left: 100, top: 100, width: 80, height: 40 }, screen)
    const b = spotlightFor({ left: 1000, top: 600, width: 80, height: 40 }, screen)
    assert.ok(travelTime(a, b) > travelTime(a, a))
    assert.ok(travelTime(a, b) <= 620, 'never long enough to wait for')
    assert.ok(travelTime(null, b) > 0, 'arriving from nowhere still takes a moment')
  })
})
