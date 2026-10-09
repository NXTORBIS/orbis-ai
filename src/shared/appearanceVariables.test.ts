import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appearanceVariables, normalizeConfig, wantsReducedMotion } from './experience.ts'

/**
 * The slider marked "Panel see-through" ran backwards: the setting multiplied the amount of panel colour, so dragging
 * it up made panels solid and at the top of its range they were completely opaque. It also wrote a dark grey in, so a
 * light theme went nearly black the moment the slider was touched.
 */

const withTransparency = (value: number): Record<string, string> =>
  appearanceVariables(normalizeConfig({ appearance: { transparency: value } }), false)

/** The percentage of panel colour left in the glass. Higher means more solid. */
const solidness = (vars: Record<string, string>): number => {
  const glass = vars['--glass']
  assert.ok(glass, 'the glass colour is set')
  const found = /([0-9]+)%/.exec(glass)
  assert.ok(found, glass)
  return Number(found[1])
}

test('asking for more see-through gives less panel colour, not more', () => {
  const clear = solidness(withTransparency(1.5))
  const solid = solidness(withTransparency(0.5))
  assert.ok(clear < solid, `more see-through (${clear}%) must leave less colour than less see-through (${solid}%)`)
})

test('panels never become completely opaque, which is what the top of the slider used to do', () => {
  for (const value of [0.5, 0.75, 1.25, 1.5]) {
    const solid = solidness(withTransparency(value))
    assert.ok(solid > 0 && solid <= 100, `${value} -> ${solid}%`)
  }
  assert.ok(solidness(withTransparency(1.5)) < 100)
})

test('the panel keeps the theme its own colour instead of a grey written in here', () => {
  const vars = withTransparency(1.3)
  assert.ok(vars['--glass'].includes('var(--bg-mid)'), vars['--glass'])
  assert.ok(!/rgba\(\s*14/.test(vars['--glass']), 'no hard-coded dark grey')
})

test('leaving the slider alone sets nothing at all', () => {
  assert.equal(withTransparency(1)['--glass'], undefined)
})

test('stillness is asked of the system, and asking for it is what makes it true', () => {
  assert.equal(wantsReducedMotion(normalizeConfig({ appearance: { reducedMotion: 'on' } }), false), true, 'what you asked for counts')
  // The main process used to hand this `nativeTheme.shouldUseDarkColors ? false : false`, which is false either way,
  // so the computer's own "less movement" setting could never reach here.
  assert.equal(wantsReducedMotion(normalizeConfig({}), true), true, "and what the computer asks for counts too")
  assert.equal(wantsReducedMotion(normalizeConfig({}), false), false)
})
