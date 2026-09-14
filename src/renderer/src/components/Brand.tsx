import mark from '../assets/orbis-mark.png'
import wordmark from '../assets/orbis-wordmark.png'

/** The standalone ORBIS ring, used wherever the single logo appears. */
export function OrbisMark({ size, className }: { size: number; className?: string }): React.JSX.Element {
  return (
    <img
      className={`orbis-mark${className ? ` ${className}` : ''}`}
      src={mark}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ width: size, height: size }}
    />
  )
}

/** ORBIS wordmark for dark theme. */
export function OrbisWordmark(): React.JSX.Element {
  return <img className="wordmark" src={wordmark} alt="ORBIS" draggable={false} />
}
