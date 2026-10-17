import { useMemo } from 'react'
import { skyProgress, type Star } from '../../../../shared/student/orbiAnim'

/**
 * The student's progress as a sky.
 *
 * Every goal is a star, every milestone a smaller one beside it, and a subject with real hours against it gets its
 * own. A star is **lit only when the thing it stands for is finished** -- the sky is a picture of completed work,
 * and a sky full of unlit stars for things merely started would be a picture of nothing.
 *
 * It is a picture, not a control. There is nothing to click, because the point is to see at a glance how much has
 * been done -- and because a long-term view somebody has to navigate is one they stop opening.
 *
 * Accessible without the picture: the figure carries a caption with the same facts, so nothing here is only visual.
 */

export default function Constellation({ stars, reducedMotion }: { stars: readonly Star[]; reducedMotion: boolean }): React.JSX.Element {
  const progress = useMemo(() => skyProgress(stars), [stars])
  const lines = useMemo(
    () =>
      stars
        .filter((one) => one.parent)
        .map((one) => ({ from: one, to: stars.find((x) => x.id === one.parent) }))
        .filter((one): one is { from: Star; to: Star } => !!one.to),
    [stars]
  )

  if (stars.length === 0) {
    return (
      <p className="view-empty">
        Your sky is empty for now. Every goal you set becomes a star, and it lights up when you finish it.
      </p>
    )
  }

  return (
    <figure className={`st-sky${reducedMotion ? ' still' : ''}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={`${progress.lit} of ${progress.total} finished.`}>
        {/* The lines first, so a star always sits on top of its own thread. */}
        {lines.map((one) => (
          <line
            key={one.from.id}
            x1={one.from.x * 100}
            y1={one.from.y * 100}
            x2={one.to.x * 100}
            y2={one.to.y * 100}
            className={one.from.lit && one.to.lit ? 'st-sky-line on' : 'st-sky-line'}
          />
        ))}
        {stars.map((one, index) => (
          <g key={one.id} className={`st-sky-star ${one.kind}${one.lit ? ' on' : ''}`} style={{ ['--st-star' as string]: String(index % 7) }}>
            <circle cx={one.x * 100} cy={one.y * 100} r={one.kind === 'goal' ? 1.5 : one.kind === 'subject' ? 1.1 : 0.8} />
            {one.lit && one.kind === 'goal' ? <circle cx={one.x * 100} cy={one.y * 100} r={3.4} className="st-sky-halo" /> : null}
          </g>
        ))}
      </svg>
      <figcaption>
        {progress.lit} of {progress.total} lit.
        {/* The same facts in words, because the picture is not the only way to read it. */}
        <span className="sr-only">
          {stars
            .filter((one) => one.lit)
            .map((one) => one.label)
            .join(', ') || 'Nothing finished yet.'}
        </span>
      </figcaption>
    </figure>
  )
}
