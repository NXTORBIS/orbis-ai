import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ACCESSIBILITY_ASSUMPTIONS,
  CONTRAST_MINIMUM,
  TARGET_COMFORTABLE,
  TARGET_MINIMUM,
  audit,
  checkContrast,
  composite,
  contrastRatio,
  isColourError,
  isLargeText,
  readColour,
  relativeLuminance,
  type ElementDescription
} from './accessibility.ts'

const colour = (text: string): ReturnType<typeof readColour> => readColour(text)

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isColourError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

describe('reading colours', () => {
  it('reads the hex forms', () => {
    assert.deepEqual(ok(colour('#fff')), { red: 255, green: 255, blue: 255, alpha: 1 })
    assert.deepEqual(ok(colour('#000000')), { red: 0, green: 0, blue: 0, alpha: 1 })
    assert.deepEqual(ok(colour('#ff8800')), { red: 255, green: 136, blue: 0, alpha: 1 })
  })

  it('reads alpha from the four- and eight-digit forms', () => {
    assert.equal(ok(colour('#0000')).alpha, 0)
    assert.equal(ok(colour('#000000ff')).alpha, 1)
    assert.ok(Math.abs(ok(colour('#00000080')).alpha - 0.502) < 0.01)
  })

  it('reads rgb and rgba', () => {
    assert.deepEqual(ok(colour('rgb(255, 136, 0)')), { red: 255, green: 136, blue: 0, alpha: 1 })
    assert.equal(ok(colour('rgba(0, 0, 0, 0.5)')).alpha, 0.5)
    assert.equal(ok(colour('rgb(0 0 0 / 50%)')).alpha, 0.5)
  })

  it('reads percentage channels', () => {
    assert.equal(ok(colour('rgb(100%, 0%, 0%)')).red, 255)
  })

  it('is not case sensitive and tolerates space', () => {
    assert.deepEqual(ok(colour('  #FFF  ')), { red: 255, green: 255, blue: 255, alpha: 1 })
  })

  it('refuses a named colour rather than guessing at it', () => {
    // A half-supported name table produces numbers that look like measurements and are not.
    const refused = colour('rebeccapurple')
    assert.ok(isColourError(refused))
    assert.match(refused.message, /cannot be measured rather than guessed at/)
  })

  it('refuses hsl for the same reason', () => {
    assert.ok(isColourError(colour('hsl(120, 50%, 50%)')))
  })

  it('refuses nonsense', () => {
    assert.ok(isColourError(colour('')))
    assert.ok(isColourError(colour('#12345')))
    assert.ok(isColourError(colour('rgb(1, 2)')))
    assert.ok(isColourError(colour('rgb(a, b, c)')))
  })
})

describe('contrast arithmetic', () => {
  it('gives the known luminance of black and white', () => {
    assert.equal(relativeLuminance({ red: 0, green: 0, blue: 0, alpha: 1 }), 0)
    assert.ok(Math.abs(relativeLuminance({ red: 255, green: 255, blue: 255, alpha: 1 }) - 1) < 1e-12)
  })

  it('gives exactly 21:1 for black on white', () => {
    const ratio = contrastRatio({ red: 0, green: 0, blue: 0, alpha: 1 }, { red: 255, green: 255, blue: 255, alpha: 1 })
    assert.ok(Math.abs(ratio - 21) < 1e-9, `got ${ratio}`)
  })

  it('gives 1:1 for a colour against itself', () => {
    const grey = { red: 128, green: 128, blue: 128, alpha: 1 }
    assert.ok(Math.abs(contrastRatio(grey, grey) - 1) < 1e-12)
  })

  it('includes the linearisation step, which a naive implementation skips', () => {
    // Mid-grey on white. Without the gamma step this comes out near 2.0; with it, near 3.95.
    const ratio = contrastRatio({ red: 128, green: 128, blue: 128, alpha: 1 }, { red: 255, green: 255, blue: 255, alpha: 1 })
    assert.ok(ratio > 3.9 && ratio < 4.0, `got ${ratio}, which suggests the gamma step is missing`)
  })

  it('matches the published ratio for a known pair', () => {
    // #767676 on white is the canonical "just passes AA for normal text" colour.
    const result = ok(checkContrast('#767676', '#ffffff', 16))
    assert.ok(Math.abs(result.ratio - 4.54) < 0.02, `got ${result.ratio}`)
    assert.equal(result.passesAA, true)
  })

  it('is symmetric', () => {
    const a = { red: 20, green: 40, blue: 60, alpha: 1 }
    const b = { red: 200, green: 220, blue: 240, alpha: 1 }
    assert.equal(contrastRatio(a, b), contrastRatio(b, a))
  })

  it('composes a translucent foreground before measuring it', () => {
    // Half-opaque black on white is mid-grey, not black. Measuring it as black would claim 21:1.
    const half = { red: 0, green: 0, blue: 0, alpha: 0.5 }
    const white = { red: 255, green: 255, blue: 255, alpha: 1 }
    assert.ok(Math.abs(composite(half, white).red - 127.5) < 1e-9)
    const ratio = contrastRatio(half, white)
    assert.ok(ratio < 6, `a half-opaque black should not measure as ${ratio}:1`)
  })

  it('refuses to measure against a background that is itself see-through', () => {
    const refused = checkContrast('#000', 'rgba(255,255,255,0.5)')
    assert.ok(isColourError(refused))
    assert.match(refused.message, /what is behind it decides the contrast/)
  })
})

describe('contrast thresholds', () => {
  it('knows when text counts as large', () => {
    assert.equal(isLargeText(24), true)
    assert.equal(isLargeText(23), false)
    assert.equal(isLargeText(19, true), true)
    assert.equal(isLargeText(18, true), false)
  })

  it('holds large text to a lower bar, as defined', () => {
    assert.equal(CONTRAST_MINIMUM.normal.aa, 4.5)
    assert.equal(CONTRAST_MINIMUM.large.aa, 3)
  })

  it('passes a pair for large text that fails for normal', () => {
    const normal = ok(checkContrast('#949494', '#ffffff', 16))
    const large = ok(checkContrast('#949494', '#ffffff', 30))
    assert.equal(normal.passesAA, false)
    assert.equal(large.passesAA, true)
  })

  it('says what would fix a failing pair', () => {
    const result = ok(checkContrast('#cccccc', '#ffffff'))
    assert.equal(result.passesAA, false)
    assert.match(result.describe, /Darken the text/)
  })

  it('says a bare pass is still not generous', () => {
    const result = ok(checkContrast('#767676', '#ffffff'))
    assert.equal(result.passesAA, true)
    assert.equal(result.passesAAA, false)
    assert.match(result.describe, /not generous/)
  })
})

describe('the audit', () => {
  const element = (over: Partial<ElementDescription> = {}): ElementDescription => ({
    id: 'save',
    role: 'button',
    name: 'Save project',
    keyboardReachable: true,
    width: 44,
    height: 44,
    ...over
  })

  const run = (...elements: ElementDescription[]): ReturnType<typeof audit> => audit(elements)

  it('finds a control with no name', () => {
    const result = run(element({ name: '' }))
    assert.ok(result.findings.some((one) => one.rule === 'name-required' && one.severity === 'blocker'))
  })

  it('finds a name that is present and says nothing', () => {
    for (const name of ['Click here', 'button', 'OK', 'Go', '...']) {
      const result = run(element({ name }))
      assert.ok(result.findings.some((one) => one.rule === 'name-meaningful'), `"${name}" was accepted`)
    }
  })

  it('finds a control a keyboard cannot reach', () => {
    const result = run(element({ keyboardReachable: false }))
    const finding = result.findings.find((one) => one.rule === 'keyboard-reachable')
    assert.equal(finding?.severity, 'blocker')
    assert.match(finding?.problem ?? '', /cannot be reached with a keyboard/)
  })

  it('does not demand a keyboard for something nobody operates', () => {
    const result = run({ id: 'heading', role: 'heading', name: 'Results' })
    assert.equal(result.findings.length, 0)
  })

  it('finds two elements claiming the same focus position', () => {
    const result = run(element({ id: 'a', focusOrder: 3 }), element({ id: 'b', focusOrder: 3 }))
    assert.ok(result.findings.some((one) => one.rule === 'focus-order-unique'))
  })

  it('finds text that is too faint', () => {
    const result = run(element({ foreground: '#cccccc', background: '#ffffff' }))
    const finding = result.findings.find((one) => one.rule === 'contrast-minimum')
    assert.equal(finding?.severity, 'serious')
  })

  it('reports a colour it cannot measure rather than passing it', () => {
    const result = run(element({ foreground: 'rebeccapurple', background: '#ffffff' }))
    assert.ok(result.findings.some((one) => one.rule === 'contrast-measurable'))
  })

  it('finds a target too small to hit', () => {
    const result = run(element({ width: 16, height: 16 }))
    const finding = result.findings.find((one) => one.rule === 'target-size')
    assert.equal(finding?.severity, 'serious')
    assert.match(finding?.fix ?? '', new RegExp(String(TARGET_MINIMUM)))
  })

  it('mentions a target that meets the minimum but is not comfortable', () => {
    const result = run(element({ width: TARGET_MINIMUM + 2, height: TARGET_MINIMUM + 2 }))
    const finding = result.findings.find((one) => one.rule === 'target-comfortable')
    assert.equal(finding?.severity, 'worth-fixing')
    assert.match(finding?.fix ?? '', new RegExp(String(TARGET_COMFORTABLE)))
  })

  it('finds colour used as the only signal', () => {
    const result = run(element({ colourOnly: true }))
    assert.ok(result.findings.some((one) => one.rule === 'colour-not-alone'))
  })

  it('finds animation that ignores reduced motion, and says why it matters', () => {
    const result = run(element({ animates: true }))
    const finding = result.findings.find((one) => one.rule === 'reduced-motion')
    assert.match(finding?.problem ?? '', /not a preference, it is nausea/)
  })

  it('accepts animation that respects reduced motion', () => {
    const result = run(element({ animates: true, respectsReducedMotion: true }))
    assert.ok(!result.findings.some((one) => one.rule === 'reduced-motion'))
  })

  it('finds an image with no alternative text', () => {
    const result = run({ id: 'chart', role: 'img' })
    assert.equal(result.findings.find((one) => one.rule === 'image-alt')?.severity, 'blocker')
  })

  it('accepts a decorative image with no alternative text', () => {
    const result = run({ id: 'flourish', role: 'img', decorative: true })
    assert.equal(result.findings.length, 0)
  })

  it('finds a decorative image that also has alternative text', () => {
    const result = run({ id: 'flourish', role: 'img', decorative: true, alternativeText: 'a flourish' })
    assert.ok(result.findings.some((one) => one.rule === 'image-decorative'))
  })

  it('finds alternative text describing the medium rather than the content', () => {
    for (const text of ['image of a chart', 'Photo', 'icon', 'graphic showing sales']) {
      const result = run({ id: 'chart', role: 'img', alternativeText: text })
      assert.ok(result.findings.some((one) => one.rule === 'image-alt-meaningful'), `"${text}" was accepted`)
    }
  })

  it('gives every finding something to do about it', () => {
    const result = run(
      element({ name: '', keyboardReachable: false, width: 8, height: 8, colourOnly: true, animates: true }),
      { id: 'img', role: 'img' }
    )
    assert.ok(result.findings.length >= 5)
    for (const finding of result.findings) {
      assert.ok(finding.fix.length > 10, `"${finding.rule}" has no usable fix`)
    }
  })

  it('puts blockers first', () => {
    const result = run(element({ name: '', width: TARGET_MINIMUM + 2, height: TARGET_MINIMUM + 2 }))
    assert.equal(result.findings[0].severity, 'blocker')
  })

  it('counts by severity', () => {
    const result = run(element({ name: '', colourOnly: true }))
    assert.equal(result.counts.blocker, 1)
    assert.ok(result.counts.serious >= 1)
  })
})

describe('what the audit refuses to claim', () => {
  it('never says a Page passed', () => {
    const clean = audit([{ id: 'ok', role: 'button', name: 'Save project', keyboardReachable: true, width: 44, height: 44 }])
    assert.equal(clean.findings.length, 0)
    assert.ok(!/pass/i.test(clean.headline), `the headline said: ${clean.headline}`)
    assert.match(clean.headline, /a floor, not a verdict/)
  })

  it('lists what it could not check, even when it found nothing', () => {
    const clean = audit([{ id: 'ok', role: 'button', name: 'Save project', keyboardReachable: true, width: 44, height: 44 }])
    assert.ok(clean.cannotCheck.length >= 5)
    assert.ok(clean.cannotCheck.some((one) => /can be present, correct in form, and meaningless/.test(one)))
    assert.ok(clean.cannotCheck.some((one) => /actual screen reader/.test(one)))
  })

  it('lists what it did check, so the scope is visible', () => {
    assert.ok(audit([]).checked.length >= 6)
  })

  it('says how many things would stop somebody entirely', () => {
    const blocked = audit([{ id: 'x', role: 'button', name: '', keyboardReachable: false }])
    assert.match(blocked.headline, /stop somebody using this Page/)
  })
})

describe('assumptions', () => {
  it('states how much an automated check is worth', () => {
    assert.ok(ACCESSIBILITY_ASSUMPTIONS.some((one) => /roughly a third/.test(one)))
  })

  it('states that a clean result is not a certificate', () => {
    assert.ok(ACCESSIBILITY_ASSUMPTIONS.some((one) => /floor, not a certificate/.test(one)))
  })

  it('states that only a real screen reader settles the question', () => {
    assert.ok(ACCESSIBILITY_ASSUMPTIONS.some((one) => /using it with a screen reader/.test(one)))
  })
})
