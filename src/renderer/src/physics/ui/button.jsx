import React from 'react'

/**
 * The button the ported simulations expect.
 *
 * The original is built on Radix and class-variance-authority over Tailwind. Orbis has neither, so this keeps the
 * same props — `variant`, `size`, `asChild` — and renders them as plain classes that `physics.css` styles. Every
 * call site in the 230 simulations works unchanged, which is the whole point of shimming rather than editing them.
 *
 * `asChild` is honoured by cloning the single child and merging the class onto it, which is what Radix's Slot does
 * for the cases these simulations actually use.
 */
const Button = React.forwardRef(function Button(
  { className = '', variant = 'default', size = 'default', asChild = false, children, ...rest },
  ref
) {
  const classes = ['jx-btn', `jx-btn-${variant}`, `jx-btn-size-${size}`, className].filter(Boolean).join(' ')
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, {
      ...rest,
      ref,
      className: [children.props.className, classes].filter(Boolean).join(' ')
    })
  }
  return (
    <button ref={ref} type="button" className={classes} {...rest}>
      {children}
    </button>
  )
})

export { Button }
export default Button
