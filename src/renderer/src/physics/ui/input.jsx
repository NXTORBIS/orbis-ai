import React from 'react'

/** The input the ported pages expect. Same props; Orbis styles it through physics.css. */
const Input = React.forwardRef(function Input({ className = '', type = 'text', ...rest }, ref) {
  return <input ref={ref} type={type} className={`jx-input ${className}`.trim()} {...rest} />
})

export { Input }
export default Input
