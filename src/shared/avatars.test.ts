import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AVATARS, DEFAULT_AVATAR, avatarFor, avatarStyle, isAvatar, markFor, suggestFor } from './avatars.ts'

describe('the set itself', () => {
  it('has no two the same id, because an id is what settings stores', () => {
    const ids = AVATARS.map((one) => one.id)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('the default is one of them', () => {
    assert.ok(AVATARS.some((one) => one.id === DEFAULT_AVATAR))
  })

  it('every colour is a hex colour, because the stylesheet drops anything else silently', () => {
    for (const one of AVATARS) {
      for (const [what, value] of [
        ['from', one.from],
        ['to', one.to],
        ['with', one.with],
        ['rim', one.rim]
      ] as const) {
        assert.match(value, /^#[0-9a-f]{6}$/, `${one.id}.${what} is not a hex colour`)
      }
    }
  })

  /*
   * Orbis is cyan light on near-black, and these are the only pictures in it. The first set was half warm --
   * orange, amber, gold, coral -- and photographed beside the product they read as sweets spilled onto it. Warm
   * is also what the rest of Orbis means by a warning, so a picture that is warm by default says something it
   * does not mean.
   *
   * Measured on every colour of every world, not just the body: a pattern, a limb or a rim drifting warm is how
   * this would come back, one value at a time, with nobody able to say when.
   */
  it('nothing in the set is warm: blue is never weaker than red', () => {
    for (const one of AVATARS) {
      for (const [what, value] of [
        ['from', one.from],
        ['to', one.to],
        ['with', one.with],
        ['rim', one.rim],
        ['sky', one.sky]
      ] as const) {
        const red = parseInt(value.slice(1, 3), 16)
        const blue = parseInt(value.slice(5, 7), 16)
        assert.ok(blue >= red, `${one.id}.${what} is a warm colour (${value})`)
      }
    }
  })

  it('the lit side is lighter than the dark side, or it is not a sphere', () => {
    // Crude on purpose: the sum of the channels. A proper luminance is not needed to catch a pair written the wrong
    // way round, which is the mistake this exists for.
    const weight = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    for (const one of AVATARS) {
      assert.ok(weight(one.from) > weight(one.to), `${one.id} is darker on its lit side`)
      assert.ok(weight(one.rim) >= weight(one.from), `${one.id}'s rim is darker than its interior`)
    }
  })
})

describe('an id that is not one of ours', () => {
  /*
   * Never null, and never thrown.
   *
   * A settings file written by a newer build, restored from another machine, or edited by hand must leave somebody
   * with a picture rather than with nothing. Every other store in Orbis has been caught writing its defaults over
   * data it merely could not read; this does the opposite and simply shows the default without touching anything.
   */
  it('falls back rather than failing', () => {
    for (const bad of ['', 'nope', 'CYAN', null, undefined, 42 as unknown as string]) {
      assert.equal(avatarFor(bad as string).id, DEFAULT_AVATAR)
    }
  })

  it('is not accepted by the guard settings validation uses', () => {
    assert.equal(isAvatar('nope'), false)
    assert.equal(isAvatar(''), false)
    assert.equal(isAvatar(7), false)
    assert.equal(isAvatar(AVATARS[3].id), true)
  })
})

describe('the name picks one', () => {
  it('the same name always gives the same picture', () => {
    // The whole point: the suggestion is shown while somebody types, and one that changed on every keystroke for
    // the same name would read as a fault rather than as an answer.
    for (const name of ['Amit', 'ksran', 'A', 'a very long name indeed']) {
      assert.equal(suggestFor(name).id, suggestFor(name).id)
    }
  })

  it('ignores case and the space around it, because that is the same person', () => {
    assert.equal(suggestFor('Amit').id, suggestFor('  amit ').id)
  })

  it('spreads across the set rather than landing on one or two', () => {
    const names = ['Amit', 'Ben', 'Cara', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ira', 'Jo', 'Kit', 'Lena', 'Mo', 'Nia', 'Omar', 'Pia']
    const got = new Set(names.map((one) => suggestFor(one).id))
    assert.ok(got.size >= 6, `sixteen names landed on only ${got.size} pictures`)
  })

  it('an empty name still gives one', () => {
    assert.equal(suggestFor('').id, DEFAULT_AVATAR)
    assert.equal(suggestFor('   ').id, DEFAULT_AVATAR)
  })
})

describe('the letter on it', () => {
  it('is one letter, never two', () => {
    assert.equal(markFor('Amit Thinks'), 'A')
    assert.equal(markFor('ksran'), 'K')
  })

  it('skips what cannot be drawn and gives nothing rather than a box', () => {
    assert.equal(markFor('  '), '')
    assert.equal(markFor('!!!'), '')
    assert.equal(markFor('🙂'), '')
    assert.equal(markFor('!!amit'), 'A')
  })

  it('takes a digit, since a name may start with one', () => {
    assert.equal(markFor('2fast'), '2')
  })
})

describe('what the stylesheet is handed', () => {
  it('is the properties the rules read, and nothing else', () => {
    const style = avatarStyle('ember')
    assert.deepEqual(Object.keys(style).sort(), ['--av-from', '--av-rim', '--av-sky', '--av-tilt', '--av-to', '--av-turn', '--av-with'])
    assert.match(style['--av-turn'], /^\d+deg$/)
    assert.match(style['--av-tilt'], /^\d+deg$/)
  })

  it('an unknown id still produces a full set, so a swatch is never drawn with nothing', () => {
    const style = avatarStyle('nope')
    assert.equal(style['--av-from'], avatarFor(DEFAULT_AVATAR).from)
  })
})

describe('what is going on inside each one', () => {
  /*
   * The first version was twelve balls of one colour with a letter stamped on them, which is a swatch rather than
   * a picture somebody would want. These two keep it from drifting back: every orb has a pattern, and no pattern
   * is used so often that the row reads as four things repeated.
   */
  it('no two worlds share an interior', () => {
    // Six weathers shared between twelve worlds photographed as "most of them look the same": the same drawing in
    // two colours is one world at two settings, and with the warm half of the wheel ruled out there is not enough
    // hue left to carry the difference on its own.
    const used = AVATARS.map((one) => one.pattern)
    assert.equal(new Set(used).size, AVATARS.length, 'two worlds are drawn the same way')
  })

  it('the worlds lean in every direction, while the light barely moves', () => {
    /*
     * The light is what the twelve share; the axis is where their variety is allowed to live.
     *
     * While the bands were drawn from `turn` they were all within fifty degrees of each other and every banded
     * world looked like the same world. Both halves are checked, because widening the light instead would undo
     * the thing that makes a grid of twelve read as one place.
     */
    const spread = (values: number[]): number => Math.max(...values) - Math.min(...values)
    assert.ok(spread(AVATARS.map((one) => one.turn)) <= 60, 'the light is lit from too many directions to be one set')
    assert.ok(spread(AVATARS.map((one) => one.tilt)) >= 300, 'the worlds all lean the same way')
    for (const one of AVATARS) {
      assert.ok(Number.isInteger(one.tilt) && one.tilt >= 0 && one.tilt < 360, `${one.id} has no usable axis`)
    }
  })

  it('the pattern colour is not the same as the one it is drawn on', () => {
    // Same colour means an invisible pattern, which is the silent way this feature stops working.
    for (const one of AVATARS) {
      assert.notEqual(one.with.toLowerCase(), one.from.toLowerCase(), `${one.id}'s pattern is its own interior`)
      assert.notEqual(one.with.toLowerCase(), one.to.toLowerCase(), `${one.id}'s pattern is its own dark side`)
    }
  })
})

describe('the pattern has to be visible', () => {
  /*
   * A pattern drawn in a colour near its own interior is a pattern nobody can see.
   *
   * The first set was chosen by hue alone and half of them vanished: photographed side by side, the ones that read
   * were exactly the ones with a wide gap in lightness, and the ones that looked like plain balls were the ones
   * without. So the rule is about lightness, not hue, and it is measured rather than eyeballed.
   */
  const weight = (hex: string): number => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)

  it('the pattern is far enough from the interior to be seen', () => {
    for (const one of AVATARS) {
      const gap = Math.abs(weight(one.from) - weight(one.with))
      assert.ok(gap >= 180, `${one.id}: only ${gap} between the interior and its pattern, which will not read`)
    }
  })

  it('and far enough from the dark side not to disappear into it', () => {
    for (const one of AVATARS) {
      const gap = Math.abs(weight(one.with) - weight(one.to))
      assert.ok(gap >= 60, `${one.id}: the pattern is almost the colour of its own dark limb`)
    }
  })
})

describe('the air is the same light on all twelve', () => {
  /*
   * The bodies differ so the twelve can be told apart; the air does not, because it is Orbis's own light falling
   * on all of them. That is what makes a grid of twelve read as one place rather than as a bag of marbles, and it
   * is the only thing tying the worlds to the rest of the product, whose accent is --cyan (#3fd8ff).
   *
   * Measured, not eyeballed: every sky must be a cool colour -- blue at least as strong as red -- and must not be
   * a brighter copy of the body, which is what `rim` already is and what made the old edge read as a stroke drawn
   * around the shape rather than as something in front of it.
   */
  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]

  it('every sky is cool: blue leads, and red never does', () => {
    for (const one of AVATARS) {
      const [r, , b] = rgb(one.sky)
      assert.ok(b >= r, `${one.id}'s air is warmer than it is cool (${one.sky})`)
      assert.ok(b >= 0xc0, `${one.id}'s air is not light enough at the limb to read (${one.sky})`)
    }
  })

  it('the air is never just a brighter copy of the body', () => {
    for (const one of AVATARS) {
      const [sr, sg, sb] = rgb(one.sky)
      const [fr, fg, fb] = rgb(one.from)
      // Compare the colours' shape, not their brightness: scale both to the same total and look at the difference.
      const sum = (a: number, b: number, c: number): number => a + b + c || 1
      const ss = sum(sr, sg, sb)
      const fs = sum(fr, fg, fb)
      const apart = Math.abs(sr / ss - fr / fs) + Math.abs(sg / ss - fg / fs) + Math.abs(sb / ss - fb / fs)
      assert.ok(apart >= 0.045, `${one.id}'s air is the same colour as its body (${one.sky} vs ${one.from})`)
    }
  })

  it('all twelve skies sit in one family, or they are not one light', () => {
    // The spread between the coolest and the warmest sky, as blue-minus-red. A family, not a rainbow.
    const lean = AVATARS.map((one) => { const [r, , b] = rgb(one.sky); return b - r })
    assert.ok(Math.max(...lean) - Math.min(...lean) <= 90, 'the skies are too far apart to read as one light')
  })
})
