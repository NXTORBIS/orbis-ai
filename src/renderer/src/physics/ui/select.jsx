import React, { createContext, useContext } from 'react'

/**
 * The Select the ported pages expect.
 *
 * The original is Radix's compound select — `Select` wrapping a `SelectTrigger`, a `SelectValue` and a list of
 * `SelectItem`s. Orbis has no Radix, so this keeps exactly that shape over a native `<select>`: the trigger and
 * value render nothing on their own, and the items become `<option>`s. Every call site works unchanged, which is
 * the point of shimming it rather than rewriting the pages that use it.
 */

const Ctx = createContext({ value: undefined, onValueChange: undefined, placeholder: undefined })

/** Pulls the options out of the children, wherever they are nested — Radix allows groups and labels around them. */
function collect(children, out = []) {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      out.push({ value: child.props.value, label: child.props.children, disabled: child.props.disabled })
      return
    }
    if (child.props?.children) collect(child.props.children, out)
  })
  return out
}

function placeholderIn(children) {
  let found
  React.Children.forEach(children, (child) => {
    if (found || !React.isValidElement(child)) return
    if (child.type === SelectValue) {
      found = child.props.placeholder
      return
    }
    if (child.props?.children) {
      const deeper = placeholderIn(child.props.children)
      if (deeper) found = deeper
    }
  })
  return found
}

export function Select({ value, onValueChange, disabled, children }) {
  const options = collect(children)
  const placeholder = placeholderIn(children)
  return (
    <Ctx.Provider value={{ value, onValueChange, placeholder }}>
      <select
        className="jx-select"
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {/* Radix shows the placeholder until something is chosen, so the native one needs an empty option. */}
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((one) => (
          <option key={String(one.value)} value={one.value} disabled={one.disabled}>
            {typeof one.label === 'string' ? one.label : String(one.value)}
          </option>
        ))}
      </select>
    </Ctx.Provider>
  )
}

/** The trigger and the value are structural in Radix. The native select is both, so these render nothing. */
export function SelectTrigger() {
  return null
}
export function SelectValue() {
  return null
}
export function SelectContent({ children }) {
  return <>{children}</>
}
export function SelectGroup({ children }) {
  return <>{children}</>
}
export function SelectLabel() {
  return null
}
export function SelectItem() {
  return null
}

export const useSelect = () => useContext(Ctx)
export default Select
