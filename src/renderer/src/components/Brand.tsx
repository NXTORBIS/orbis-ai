import ring from '../assets/orbis-ring.png'
import logo from '../assets/orbis-logo.png'

/** The ORBIS ring from the original transparent logo, used wherever the single mark appears. */
export function OrbisMark({ size, className }: { size: number; className?: string }): React.JSX.Element {
  return (
    <img
      className={`orbis-mark${className ? ` ${className}` : ''}`}
      src={ring}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: size, height: size }}
    />
  )
}

/** The original transparent ORBIS logo (ring and lettering). */
export function OrbisWordmark({ className }: { className?: string }): React.JSX.Element {
  return <img className={`wordmark${className ? ` ${className}` : ''}`} src={logo} alt="ORBIS" draggable={false} />
}
