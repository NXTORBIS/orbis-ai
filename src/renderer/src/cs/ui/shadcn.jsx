/**
 * The three small packages their shadcn components import: `@radix-ui/react-slot`,
 * `class-variance-authority`, `@radix-ui/react-slider`, and `tailwind-merge`.
 *
 * NOT the user's files. Their `ui/button.jsx`, `ui/slider.jsx` and `lib/utils.js` came across unedited, and
 * these are what those import instead — four small pieces rather than four dependencies, because what they
 * actually use of each is a handful of lines.
 */
import React, { createContext, useContext, useId, useRef, useState } from 'react'

// ---------------------------------------------------------------- class-variance-authority

/**
 * Builds a class-name function from a base string and a set of variants.
 *
 * Exactly what their Button asks of it: pick a class per variant, fall back to `defaultVariants`, and append
 * whatever `className` was passed. `compoundVariants` is supported because it is part of the shape, even though
 * their components do not use it yet.
 */
export function cva(base, config = {}) {
  const { variants = {}, defaultVariants = {}, compoundVariants = [] } = config
  return (props = {}) => {
    const out = [base]
    const chosen = {}
    for (const name of Object.keys(variants)) {
      const value = props[name] ?? defaultVariants[name]
      chosen[name] = value
      const found = value === undefined ? undefined : variants[name]?.[value]
      if (found) out.push(found)
    }
    for (const one of compoundVariants) {
      const { class: cls, className: clsName, ...needs } = one
      if (Object.entries(needs).every(([key, want]) => chosen[key] === want)) out.push(cls ?? clsName)
    }
    if (props.class) out.push(props.class)
    if (props.className) out.push(props.className)
    return out.filter(Boolean).join(' ')
  }
}

// ---------------------------------------------------------------- tailwind-merge

/**
 * Later class wins, where two classes set the same thing.
 *
 * The real `tailwind-merge` knows every Tailwind group. This knows the ones that actually collide in their
 * components — padding, size, colour, radius, display — by taking the prefix before the last dash-number or
 * dash-word. It is enough that `cn('px-4', 'px-2')` gives `px-2`, which is the only reason the function exists.
 */
export function twMerge(...parts) {
  const all = parts.flat(Infinity).filter(Boolean).join(' ').split(/\s+/).filter(Boolean)
  const byGroup = new Map()
  const loose = []
  for (const one of all) {
    const group = groupOf(one)
    if (group === null) {
      loose.push(one)
      continue
    }
    // Later wins: setting it again replaces the earlier one in place.
    byGroup.set(group, one)
  }
  return [...loose, ...byGroup.values()].join(' ')
}

/** Which mutually-exclusive group a class belongs to, or null when it does not conflict with anything. */
function groupOf(one) {
  const bare = one.replace(/^[a-z-]+:/i, '') // a variant prefix like hover: does not change the group
  const GROUPS = [
    [/^-?(p|px|py|pt|pr|pb|pl)-/, (m) => 'pad-' + m[1]],
    [/^-?(m|mx|my|mt|mr|mb|ml)-/, (m) => 'margin-' + m[1]],
    [/^(w|h|min-w|min-h|max-w|max-h|size)-/, (m) => 'size-' + m[1]],
    [/^(text)-(xs|sm|base|lg|xl|\d*xl|\[)/, () => 'font-size'],
    [/^(text)-/, () => 'text-colour'],
    [/^(bg)-/, () => 'background'],
    [/^(border)-(\d|\[)/, () => 'border-width'],
    [/^(border)-/, () => 'border-colour'],
    [/^(rounded)(-|$)/, () => 'radius'],
    [/^(flex|grid|block|inline|inline-flex|inline-block|hidden|contents|table)$/, () => 'display'],
    [/^(gap|gap-x|gap-y)-/, (m) => 'gap-' + m[1]],
    [/^(opacity)-/, () => 'opacity'],
    [/^(shadow)(-|$)/, () => 'shadow'],
    [/^(font)-/, () => 'font-weight'],
    [/^(leading)-/, () => 'leading'],
    [/^(tracking)-/, () => 'tracking'],
    [/^(justify)-/, () => 'justify'],
    [/^(items)-/, () => 'items'],
    [/^(overflow|overflow-x|overflow-y)-/, (m) => 'overflow-' + m[1]]
  ]
  for (const [pattern, name] of GROUPS) {
    const m = pattern.exec(bare)
    // The variant prefix is part of the group, or hover:px-2 would override px-4 unconditionally.
    if (m) return (one.includes(':') ? one.slice(0, one.indexOf(':') + 1) : '') + name(m)
  }
  return null
}

// ---------------------------------------------------------------- @radix-ui/react-slot

/**
 * Renders its own child, merging the props it was given into it.
 *
 * Their Button uses it for `asChild`, so a Button can be a link while keeping the button's classes.
 */
export const Slot = React.forwardRef(function Slot({ children, ...mine }, ref) {
  if (!React.isValidElement(children)) return null
  const theirs = children.props
  return React.cloneElement(children, {
    ...mine,
    ...theirs,
    // Both sets of classes, mine first so theirs can override.
    className: [mine.className, theirs.className].filter(Boolean).join(' '),
    style: { ...mine.style, ...theirs.style },
    ref
  })
})

// ---------------------------------------------------------------- @radix-ui/react-slider

const SliderWhere = createContext(null)

/**
 * A slider, by the parts their component composes: Root, Track, Range, Thumb.
 *
 * A real range input underneath, so the keyboard, the pointer and the accessibility come from the browser rather
 * than from a handful of pointer handlers that would get one of the three wrong. The coloured track and the
 * visible thumb are drawn over it.
 */
export const Root = React.forwardRef(function Root(
  { className = '', value, defaultValue, min = 0, max = 100, step = 1, onValueChange, disabled, children, ...rest },
  ref
) {
  const [mine, setMine] = useState(defaultValue ?? [min])
  const held = value ?? mine
  const now = Array.isArray(held) ? held[0] : held
  const id = useId()
  const share = max === min ? 0 : ((now - min) / (max - min)) * 100

  return (
    <SliderWhere.Provider value={{ share }}>
      <span ref={ref} className={`csl ${className}`.trim()} {...rest}>
        <input
          id={id}
          type="range"
          className="csl-input"
          min={min}
          max={max}
          step={step}
          value={now}
          disabled={disabled}
          onChange={(event) => {
            const next = [Number(event.target.value)]
            if (value === undefined) setMine(next)
            onValueChange?.(next)
          }}
        />
        {children}
      </span>
    </SliderWhere.Provider>
  )
})
Root.displayName = 'Slider'

export const Track = ({ className = '', children, ...rest }) => (
  <span className={`csl-track ${className}`.trim()} {...rest}>
    {children}
  </span>
)

export const Range = ({ className = '', ...rest }) => {
  const where = useContext(SliderWhere)
  return <span className={`csl-range ${className}`.trim()} style={{ width: `${where?.share ?? 0}%` }} {...rest} />
}

export const Thumb = ({ className = '', ...rest }) => {
  const where = useContext(SliderWhere)
  return <span className={`csl-thumb ${className}`.trim()} style={{ left: `${where?.share ?? 0}%` }} {...rest} />
}

export default { cva, twMerge, Slot, Root, Track, Range, Thumb }
