/**
 * Checking a Page is usable by everybody, and being honest about how much of that a machine can check.
 *
 * ## The thing this file must not let anybody believe
 *
 * An automated accessibility check finds somewhere around a third of real accessibility problems. It finds the ones that
 * are arithmetic -- contrast ratios, missing labels, target sizes -- and it is blind to the ones that are judgement: a
 * label that is present and meaningless, a reading order that is technically correct and makes no sense, an image whose
 * alternative text says "image", a colour that carries meaning nothing else carries.
 *
 * So `audit` never returns a pass. It returns what it checked, what it found, and **what it could not check**, and that
 * last list is not an afterthought -- it is the part that stops a clean result being read as a certificate. A Page that
 * scores perfectly here may still be unusable, and the result says so in those words.
 *
 * ## What is arithmetic, and therefore reliable
 *
 * Contrast is a defined calculation over sRGB values, and this implements it exactly: the WCAG relative luminance
 * formula, with the linearisation step that a surprising number of implementations skip. A contrast number from here is
 * correct, and can be relied on.
 *
 * Pure. No DOM: a Page describes its own elements and this checks the description.
 */

// ---------------------------------------------------------------- colour and contrast

export interface Colour {
  /** 0 to 255. */
  red: number
  green: number
  blue: number
  /** 0 to 1. Used to compose against a background before contrast is measured. */
  alpha: number
}

export interface ColourError {
  error: 'unreadable-colour'
  message: string
}

export const isColourError = (value: unknown): value is ColourError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * A colour from CSS-like text.
 *
 * Handles `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`. Named colours and `hsl()` are refused rather than
 * approximated, because a contrast number computed from a guessed colour is worse than no number: it looks like a
 * measurement.
 */
export function readColour(input: string): Colour | ColourError {
  const text = String(input ?? '').trim().toLowerCase()
  if (text === '') return { error: 'unreadable-colour', message: 'There is no colour here.' }

  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    const digits = hex[1]
    const expand = (one: string): number => Number.parseInt(one.length === 1 ? one + one : one, 16)
    if (digits.length === 3 || digits.length === 4) {
      return {
        red: expand(digits[0]),
        green: expand(digits[1]),
        blue: expand(digits[2]),
        alpha: digits.length === 4 ? expand(digits[3]) / 255 : 1
      }
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        red: expand(digits.slice(0, 2)),
        green: expand(digits.slice(2, 4)),
        blue: expand(digits.slice(4, 6)),
        alpha: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1
      }
    }
    return { error: 'unreadable-colour', message: `"${input}" is not a hex colour Orbis can read.` }
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter((one) => one !== '')
    if (parts.length < 3) return { error: 'unreadable-colour', message: `"${input}" does not have three colour values in it.` }
    const channel = (one: string): number => {
      const value = one.endsWith('%') ? (Number.parseFloat(one) / 100) * 255 : Number.parseFloat(one)
      return Number.isFinite(value) ? Math.min(255, Math.max(0, value)) : Number.NaN
    }
    const red = channel(parts[0])
    const green = channel(parts[1])
    const blue = channel(parts[2])
    if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
      return { error: 'unreadable-colour', message: `"${input}" has a colour value that is not a number.` }
    }
    let alpha = 1
    if (parts.length >= 4) {
      const raw = parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3])
      alpha = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1
    }
    return { red, green, blue, alpha }
  }

  // A named colour or `hsl()` could be converted, but a half-supported table is a source of wrong numbers that look
  // right. Refusing names the limitation instead of hiding it.
  return {
    error: 'unreadable-colour',
    message: `Orbis reads colours written as #rrggbb or rgb(). "${input}" is something else, so its contrast cannot be measured rather than guessed at.`
  }
}

/**
 * Relative luminance, as WCAG defines it.
 *
 * The linearisation step -- the `((c + 0.055) / 1.055) ^ 2.4` part -- is the one implementations skip, and skipping it
 * produces numbers that are close enough to look plausible and wrong enough to pass a failing pair. It is here in full.
 */
export function relativeLuminance(colour: Colour): number {
  const channel = (value: number): number => {
    const c = Math.min(1, Math.max(0, value / 255))
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(colour.red) + 0.7152 * channel(colour.green) + 0.0722 * channel(colour.blue)
}

/** A translucent colour laid over an opaque one. Contrast is meaningless until this has happened. */
export function composite(foreground: Colour, background: Colour): Colour {
  const alpha = Math.min(1, Math.max(0, foreground.alpha))
  return {
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
    alpha: 1
  }
}

/**
 * The contrast ratio between two colours, from 1 to 21.
 *
 * A translucent foreground is composed against the background first: measuring a 50%-opaque colour as though it were
 * opaque overstates its contrast by a wide margin, and that is exactly the case people get wrong.
 */
export function contrastRatio(foreground: Colour, background: Colour): number {
  const front = foreground.alpha < 1 ? composite(foreground, background) : foreground
  const a = relativeLuminance(front)
  const b = relativeLuminance(background)
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

export type TextSize = 'normal' | 'large'

/** The thresholds, as defined. `large` is 18pt, or 14pt bold -- about 24px and 18.66px. */
export const CONTRAST_MINIMUM: Readonly<Record<TextSize, { aa: number; aaa: number }>> = Object.freeze({
  normal: Object.freeze({ aa: 4.5, aaa: 7 }),
  large: Object.freeze({ aa: 3, aaa: 4.5 })
})

/** Whether text counts as large, from its size and weight. */
export const isLargeText = (pixels: number, bold = false): boolean => pixels >= 24 || (bold && pixels >= 18.66)

export interface ContrastResult {
  ratio: number
  size: TextSize
  passesAA: boolean
  passesAAA: boolean
  /** What to say about it, including what would fix it. */
  describe: string
}

export function checkContrast(foreground: string, background: string, pixels = 16, bold = false): ContrastResult | ColourError {
  const front = readColour(foreground)
  if (isColourError(front)) return front
  const back = readColour(background)
  if (isColourError(back)) return back
  if (back.alpha < 1) {
    // Without knowing what is behind it, there is no ratio to compute. Assuming white is a guess presented as a result.
    return {
      error: 'unreadable-colour',
      message: 'The background is partly transparent, so what is behind it decides the contrast. Measure against the colour that is actually behind it.'
    }
  }

  const size: TextSize = isLargeText(pixels, bold) ? 'large' : 'normal'
  const ratio = contrastRatio(front, back)
  const minimum = CONTRAST_MINIMUM[size]
  const rounded = Math.round(ratio * 100) / 100

  const describe = ratio >= minimum.aaa
    ? `${rounded}:1, which is comfortable for ${size} text.`
    : ratio >= minimum.aa
      ? `${rounded}:1, which meets the minimum for ${size} text but is not generous. Somebody with low vision or a dim screen will find it harder than you do.`
      : `${rounded}:1, which is below the ${minimum.aa}:1 minimum for ${size} text. ${
          size === 'normal' ? 'Darken the text, lighten the background, or make the text larger.' : 'Darken the text or lighten the background.'
        }`

  return { ratio, size, passesAA: ratio >= minimum.aa, passesAAA: ratio >= minimum.aaa, describe }
}

// ---------------------------------------------------------------- the audit

export type Severity = 'blocker' | 'serious' | 'worth-fixing'

export interface Finding {
  severity: Severity
  /** Which element, as the Page named it. */
  element: string
  /** What is wrong. */
  problem: string
  /** What to do about it. Never omitted: a finding without a fix is a complaint. */
  fix: string
  rule: string
}

/** An element as a Page describes it. Nothing is read from a DOM; the Page says what it has. */
export interface ElementDescription {
  /** A name for the element, used in findings. */
  id: string
  role: string
  /** The accessible name: a label, aria-label, or the text inside. Empty when there is none. */
  name?: string
  /** Whether it can be reached and operated with a keyboard. */
  keyboardReachable?: boolean
  /** Its position in the focus order. Missing means it follows the document. */
  focusOrder?: number
  foreground?: string
  background?: string
  fontPixels?: number
  bold?: boolean
  /** Its clickable size in CSS pixels. */
  width?: number
  height?: number
  /** True when the only thing distinguishing this element's state is its colour. */
  colourOnly?: boolean
  /** True when it animates. */
  animates?: boolean
  /** True when the animation respects the system's reduced-motion setting. */
  respectsReducedMotion?: boolean
  /** For an image: its alternative text. */
  alternativeText?: string
  /** True when the image is decorative and correctly marked as such. */
  decorative?: boolean
}

/** Roles that a person has to be able to operate. A decoration does not need a keyboard; a button does. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'textbox',
  'combobox',
  'slider',
  'switch',
  'tab',
  'menuitem',
  'option',
  'spinbutton',
  'searchbox'
])

/** The smallest a touch target should be, in CSS pixels. 24 is the WCAG 2.2 minimum; 44 is comfortable. */
export const TARGET_MINIMUM = 24
export const TARGET_COMFORTABLE = 44

export interface AuditResult {
  findings: readonly Finding[]
  /** What was actually checked, so a clean result cannot be read as more than it is. */
  checked: readonly string[]
  /**
   * What no automated check can decide.
   *
   * The most important field here. A result with no findings and this list attached says "nothing arithmetic is wrong";
   * a result with no findings and nothing attached would say "this Page is accessible", which would be a lie.
   */
  cannotCheck: readonly string[]
  /** Findings by severity, for a summary line. */
  counts: Readonly<Record<Severity, number>>
  /** The sentence to show at the top. Never says "passed". */
  headline: string
}

/**
 * A Page's elements checked against what a machine can check.
 *
 * Every rule here is arithmetic or a missing-field test. Nothing here forms an opinion about whether a label is a *good*
 * label, and the result says that is not being done rather than leaving somebody to assume it was.
 */
export function audit(elements: readonly ElementDescription[]): AuditResult {
  const findings: Finding[] = []

  const add = (severity: Severity, element: string, problem: string, fix: string, rule: string): void => {
    findings.push({ severity, element, problem, fix, rule })
  }

  const seenOrder = new Map<number, string>()

  for (const element of elements) {
    const interactive = INTERACTIVE_ROLES.has(element.role)

    // --- a name, for anything a person has to operate or understand
    if (interactive && (element.name ?? '').trim() === '') {
      add(
        'blocker',
        element.id,
        `This ${element.role} has no name, so a screen reader announces it as just "${element.role}".`,
        'Give it a label, an aria-label, or visible text inside it.',
        'name-required'
      )
    }
    // A name that is only a placeholder word is worse than none: it reads as a name and says nothing.
    if (interactive && /^(button|link|click here|here|submit|ok|go|image|icon|\.\.\.|…)$/i.test((element.name ?? '').trim())) {
      add(
        'serious',
        element.id,
        `"${element.name}" does not say what this ${element.role} does. Out of context it is meaningless, and a screen reader user often hears it out of context.`,
        'Say what happens: "Save project", "Open settings", "Delete this row".',
        'name-meaningful'
      )
    }

    // --- keyboard
    if (interactive && element.keyboardReachable === false) {
      add(
        'blocker',
        element.id,
        `This ${element.role} cannot be reached with a keyboard, so anybody not using a mouse cannot use it at all.`,
        'Make it a real button or link, or give it a tab stop and a key handler.',
        'keyboard-reachable'
      )
    }

    // --- focus order
    if (typeof element.focusOrder === 'number' && element.focusOrder > 0) {
      const existing = seenOrder.get(element.focusOrder)
      if (existing !== undefined) {
        add(
          'serious',
          element.id,
          `This and "${existing}" both claim position ${element.focusOrder} in the focus order, so which comes first is whatever the browser decides.`,
          'Let the document order decide, and move the element in the markup instead.',
          'focus-order-unique'
        )
      }
      seenOrder.set(element.focusOrder, element.id)
    }

    // --- contrast
    if (element.foreground !== undefined && element.background !== undefined) {
      const result = checkContrast(element.foreground, element.background, element.fontPixels ?? 16, element.bold ?? false)
      if (isColourError(result)) {
        add('worth-fixing', element.id, result.message, 'Write the colour as #rrggbb or rgb() so it can be measured.', 'contrast-measurable')
      } else if (!result.passesAA) {
        add('serious', element.id, `Its text contrast is ${result.describe}`, 'Darken the text or lighten the background until it reaches the minimum.', 'contrast-minimum')
      }
    }

    // --- target size
    if (interactive && element.width !== undefined && element.height !== undefined) {
      const smallest = Math.min(element.width, element.height)
      if (smallest < TARGET_MINIMUM) {
        add(
          'serious',
          element.id,
          `This ${element.role} is ${element.width}×${element.height} pixels, which is smaller than the ${TARGET_MINIMUM}-pixel minimum. It is hard to hit with a finger and hard for anybody whose hands are not steady.`,
          `Make it at least ${TARGET_MINIMUM} pixels in both directions, or add padding around it.`,
          'target-size'
        )
      } else if (smallest < TARGET_COMFORTABLE) {
        add(
          'worth-fixing',
          element.id,
          `This ${element.role} is ${element.width}×${element.height} pixels. It meets the minimum but ${TARGET_COMFORTABLE} is what is comfortable on a touchscreen.`,
          `Consider making it ${TARGET_COMFORTABLE} pixels.`,
          'target-comfortable'
        )
      }
    }

    // --- colour as the only signal
    if (element.colourOnly === true) {
      add(
        'serious',
        element.id,
        'Colour is the only thing showing this element’s state, so it says nothing to somebody who cannot distinguish those colours.',
        'Add a word, an icon, an underline or a pattern alongside the colour.',
        'colour-not-alone'
      )
    }

    // --- motion
    if (element.animates === true && element.respectsReducedMotion !== true) {
      add(
        'serious',
        element.id,
        'This animates and does not check whether the person has asked for reduced motion. For somebody with a vestibular disorder that is not a preference, it is nausea.',
        'Wrap the animation in a prefers-reduced-motion check and make the reduced version instant.',
        'reduced-motion'
      )
    }

    // --- images
    if (element.role === 'img') {
      const alternative = (element.alternativeText ?? '').trim()
      if (element.decorative === true && alternative !== '') {
        add(
          'worth-fixing',
          element.id,
          'This image is marked decorative but also has alternative text, so it will be announced when it was meant to be skipped.',
          'Either remove the alternative text or stop marking it decorative.',
          'image-decorative'
        )
      } else if (element.decorative !== true && alternative === '') {
        add(
          'blocker',
          element.id,
          'This image has no alternative text, so it is invisible to anybody using a screen reader.',
          'Describe what the image shows, or mark it decorative if it carries no information.',
          'image-alt'
        )
      } else if (/^(image|picture|photo|icon|graphic|img)\b/i.test(alternative)) {
        add(
          'worth-fixing',
          element.id,
          `"${alternative}" describes the medium rather than the content. A screen reader already says it is an image.`,
          'Say what it shows, not that it is a picture.',
          'image-alt-meaningful'
        )
      }
    }
  }

  const counts = {
    blocker: findings.filter((one) => one.severity === 'blocker').length,
    serious: findings.filter((one) => one.severity === 'serious').length,
    'worth-fixing': findings.filter((one) => one.severity === 'worth-fixing').length
  }

  const checked = [
    'Every control has a name',
    'Every control can be reached with a keyboard',
    'No two elements claim the same focus position',
    'Text contrast against its background',
    'How big things are to click or tap',
    'Whether colour is the only signal',
    'Whether animation respects reduced motion',
    'Whether images have alternative text'
  ]

  const cannotCheck = [
    'Whether a label actually describes what the control does. A name can be present, correct in form, and meaningless.',
    'Whether the reading order makes sense. It can be technically valid and still be nonsense to listen to.',
    'Whether alternative text describes the right thing about an image.',
    'Whether an error message tells somebody how to fix the problem.',
    'Whether the Page still works at 200% zoom or in a narrow window.',
    'Whether anything is understandable, which is most of what accessibility means.',
    'Whether it works with an actual screen reader, which is the only test that settles the question.'
  ]

  const headline =
    counts.blocker > 0
      ? `${counts.blocker} thing${counts.blocker === 1 ? '' : 's'} here will stop somebody using this Page at all.`
      : counts.serious > 0
        ? `${counts.serious} thing${counts.serious === 1 ? '' : 's'} will make this Page hard to use for some people.`
        : findings.length > 0
          ? `Nothing here blocks anybody. ${findings.length} thing${findings.length === 1 ? '' : 's'} could be better.`
          : // Never "passed". This is the sentence the whole file exists to get right.
            'Nothing was found by the checks a machine can do. That is a floor, not a verdict: the things that matter most are on the list below of what could not be checked.'

  return {
    findings: Object.freeze(
      [...findings].sort((a, b) => {
        const order: Record<Severity, number> = { blocker: 0, serious: 1, 'worth-fixing': 2 }
        return order[a.severity] - order[b.severity]
      })
    ),
    checked: Object.freeze(checked),
    cannotCheck: Object.freeze(cannotCheck),
    counts: Object.freeze(counts),
    headline
  }
}

/** What an automated check is worth, for the panel that shows the result. */
export const ACCESSIBILITY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'An automated check finds roughly a third of real accessibility problems: the ones that are arithmetic. The rest need a person.',
  'A clean result is a floor, not a certificate. It means nothing measurable is wrong, not that the Page is usable.',
  'Contrast here is the WCAG calculation exactly, including the linearisation step that is commonly skipped, so the numbers can be relied on.',
  'A translucent colour is composed against its background before being measured, because measuring it as though it were opaque overstates the contrast.',
  'A colour Orbis cannot read exactly is reported as unmeasurable rather than guessed at.',
  'Nothing here judges whether a label is a good label. It can only see whether one is there.',
  'The only test that settles whether a Page is usable with a screen reader is using it with a screen reader.'
])
