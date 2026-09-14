import mark from '../assets/orbis-mark.svg'
import wordmark from '../assets/orbis-wordmark.svg'

/** The standalone ORBIS ring with glowing cyan accents, used wherever the single logo appears. */
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

/** ORBIS wordmark with ring and text for dark backgrounds. */
export function OrbisWordmark(): React.JSX.Element {
  return <img className="wordmark" src={wordmark} alt="ORBIS" draggable={false} />
}
