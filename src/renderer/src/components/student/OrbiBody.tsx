import { DRAW_ORDER, type Face, type PartName, type Rig, type StyleTraits } from '../../../../shared/student/orbiCharacter'

/**
 * Drawing Orbi.
 *
 * ## This file makes no decisions
 *
 * Every number comes in: the skeleton from `orbiCharacter.ts`, the face from the expression, the proportions from
 * the style. Nothing here chooses a pose, so a pose can be tested without a browser and this cannot disagree with
 * the engine about what Orbi is doing.
 *
 * ## What makes it cute
 *
 * Four proportions, and they are the whole design:
 *
 *   - **a big head on a small body**, a bit over two to one. This single ratio does more than anything else, and
 *     it is why Orbi is a creature rather than a sphere with a face drawn on it.
 *   - **big eyes, set low and wide.** Low on the face reads as young, wide apart reads as open. Each carries a
 *     bright highlight and a smaller one opposite, which is what stops an eye looking like a hole punched in it.
 *   - **a small mouth.** Smaller than feels right. A big mouth reads as a cartoon; a small one reads as alive.
 *   - **no square corners anywhere.**
 *
 * ## It is alive when nothing is happening
 *
 * It blinks, it breathes, the ring turns and the antenna bead pulses — all in CSS, on properties the compositor
 * handles alone, so a still Orbi costs almost nothing and every bit of it stops under reduced motion. A character
 * that freezes between events reads as a picture of a character.
 */

export interface OrbiBodyProps {
  rig: Rig
  face: Face
  /** The drawing's own size in pixels. The rig is always in a 100×100 space. */
  size: number
  flip?: boolean
  traits: StyleTraits
  /** Where the eyes are looking, −1..1 each way. Set from the pointer by the parent. */
  toward?: { x: number; y: number }
  /** How much light is behind Orbi, 0..1. Comes from the moment that is playing. */
  glow?: number
  /** Thin lines and no fills, for the smallest sizes where a filled shape is only a blob. */
  plain?: boolean
  /** A stable id, so two Orbis on one screen cannot share a gradient. */
  uid?: string
}

/** A part's transform. One string per part, which is all the browser needs to place it. */
function place(part: PartName, rig: Rig, s: number): string {
  const one = rig[part]
  /*
   * A hidden limb is drawn small as well as faded.
   *
   * Fading alone leaves a full-length ghost arm at low opacity, which reads as a smudge. Shrinking it into the
   * body as it goes makes it look like it is being drawn back in, which is what it is meant to look like.
   */
  const grown = 0.35 + one.show * 0.65
  /*
   * Every number is checked before it reaches the attribute.
   *
   * One NaN anywhere in a transform makes the browser discard the whole attribute silently, and the part then
   * draws at the top-left corner of the drawing — which is exactly how a stray square ended up floating beside
   * Orbi's head, with no error anywhere to explain it.
   */
  const n = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback)
  const x = n(one.x, 50) * s
  const y = n(one.y, 50) * s
  const sx = n(one.scaleX, 1) * grown
  const sy = n(one.scaleY, 1) * grown
  return `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${n(one.rotate, 0).toFixed(2)}) scale(${sx.toFixed(3)} ${sy.toFixed(3)})`
}

/**
 * The eyes.
 *
 * Big, low and wide apart. Shape carries the feeling; the pupils carry where Orbi is looking.
 */
function Eyes({ face, s, toward, ink }: { face: Face; s: number; toward: { x: number; y: number }; ink: string }): React.JSX.Element {
  const spread = 10.5 * face.eyeSpread * 2
  const left = -spread / 2
  const right = spread / 2
  // Deliberately large. An eye this size on a head this size is most of why Orbi reads as a creature.
  const r = 6.2
  const px = Math.max(-1.8, Math.min(1.8, toward.x * 2))
  const py = Math.max(-1.4, Math.min(1.4, toward.y * 1.6))

  const pair = (render: (cx: number) => React.JSX.Element): React.JSX.Element => (
    <>
      {render(left * s)}
      {render(right * s)}
    </>
  )

  /** An open eye: the dark of it, a big highlight, and a small one opposite. */
  const round = (cx: number, grow = 1, squash = 1): React.JSX.Element => (
    <g key={cx}>
      <ellipse cx={cx} cy={0} rx={r * grow * s} ry={r * grow * squash * s} fill={ink} />
      <circle cx={cx + (px + 1.9) * s} cy={(py - 2) * s} r={r * 0.38 * s} fill="var(--orbi-glint)" />
      <circle cx={cx + (px - 1.6) * s} cy={(py + 1.9) * s} r={r * 0.17 * s} fill="var(--orbi-glint)" opacity={0.75} />
    </g>
  )

  switch (face.eyes) {
    case 'closed':
      return pair((cx) => (
        <path key={cx} d={`M ${cx - r * s} 0 q ${r * s} ${r * 0.8 * s} ${r * 2 * s} 0`} fill="none" stroke={ink} strokeWidth={2.1 * s} strokeLinecap="round" />
      ))
    case 'happy':
      // Curving upward: the one shape everybody reads as a smile in the eyes.
      return pair((cx) => (
        <path
          key={cx}
          d={`M ${cx - r * s} ${r * 0.45 * s} q ${r * s} ${-r * 1.6 * s} ${r * 2 * s} 0`}
          fill="none"
          stroke={ink}
          strokeWidth={2.3 * s}
          strokeLinecap="round"
        />
      ))
    case 'sleepy':
      return pair((cx) => (
        <g key={cx}>
          <path d={`M ${cx - r * s} 0 q ${r * s} ${r * 0.55 * s} ${r * 2 * s} 0`} fill="none" stroke={ink} strokeWidth={2 * s} strokeLinecap="round" />
          <ellipse cx={cx} cy={r * 0.95 * s} rx={r * 0.5 * s} ry={r * 0.2 * s} fill={ink} opacity={0.3} />
        </g>
      ))
    case 'narrow':
      return pair((cx) => round(cx, 0.92, 0.62))
    case 'wide':
      return pair((cx) => round(cx, 1.16, 1.06))
    case 'determined':
      // A lid cutting across the top of the eye. Angry eyebrows, without eyebrows.
      return pair((cx) => (
        <g key={cx}>
          {round(cx, 0.95, 0.9)}
          <path
            d={`M ${cx - r * 1.2 * s} ${-r * 0.8 * s} L ${cx + r * 1.2 * s} ${-r * 0.2 * s} L ${cx + r * 1.2 * s} ${-r * 1.4 * s} L ${cx - r * 1.2 * s} ${-r * 1.4 * s} Z`}
            fill="var(--orbi-mid)"
          />
        </g>
      ))
    case 'thinking':
      // Looking up and to one side: the universal picture of working something out.
      return pair((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={0} rx={r * s} ry={r * s} fill={ink} />
          <circle cx={cx + r * 0.3 * s} cy={-r * 0.38 * s} r={r * 0.4 * s} fill="var(--orbi-glint)" />
        </g>
      ))
    case 'worried':
      return pair((cx) => (
        <g key={cx}>
          {round(cx, 1.05, 0.95)}
          <path
            d={`M ${cx - r * 1.2 * s} ${-r * 1.5 * s} q ${r * 1.2 * s} ${-r * 0.5 * s} ${r * 2.4 * s} ${r * 0.1 * s}`}
            fill="none"
            stroke={ink}
            strokeWidth={1.6 * s}
            strokeLinecap="round"
            opacity={0.8}
          />
        </g>
      ))
    case 'sparkle':
      return pair((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={0} rx={r * 1.05 * s} ry={r * 1.05 * s} fill={ink} />
          {/* A four-point star rather than a dot: the difference between pleased and delighted. */}
          <path
            d={`M ${cx} ${-r * 0.95 * s} L ${cx + r * 0.3 * s} ${-r * 0.2 * s} L ${cx + r * 0.95 * s} 0 L ${cx + r * 0.3 * s} ${r * 0.2 * s} L ${cx} ${r * 0.95 * s} L ${cx - r * 0.3 * s} ${r * 0.2 * s} L ${cx - r * 0.95 * s} 0 L ${cx - r * 0.3 * s} ${-r * 0.2 * s} Z`}
            fill="var(--orbi-glint)"
          />
        </g>
      ))
    case 'open':
    default:
      return pair((cx) => round(cx))
  }
}

/** The mouth. Small, low, and the thing that changes most between feelings. */
function Mouth({ face, s, ink }: { face: Face; s: number; ink: string }): React.JSX.Element | null {
  const y = 9.5 * s
  const w = 4.2 * s
  switch (face.mouth) {
    case 'smile':
      return <path d={`M ${-w} ${y} q ${w} ${w * 0.95} ${w * 2} 0`} fill="none" stroke={ink} strokeWidth={1.7 * s} strokeLinecap="round" />
    case 'grin':
      return (
        <g>
          <path d={`M ${-w * 1.15} ${y} q ${w * 1.15} ${w * 1.5} ${w * 2.3} 0 z`} fill={ink} />
          {/* A tongue: one curve, and the whole difference between a grin and a hole. */}
          <path d={`M ${-w * 0.45} ${y + w * 0.82} q ${w * 0.45} ${w * 0.5} ${w * 0.9} 0 z`} fill="var(--orbi-blush)" opacity={0.9} />
        </g>
      )
    case 'small':
      return <path d={`M ${-w * 0.42} ${y} q ${w * 0.42} ${w * 0.55} ${w * 0.84} 0`} fill="none" stroke={ink} strokeWidth={1.6 * s} strokeLinecap="round" />
    case 'open':
      return <ellipse cx={0} cy={y + w * 0.3} rx={w * 0.62} ry={w * 0.8} fill={ink} />
    case 'oh':
      return <ellipse cx={0} cy={y + w * 0.2} rx={w * 0.4} ry={w * 0.52} fill={ink} />
    case 'flat':
      return <path d={`M ${-w * 0.62} ${y} L ${w * 0.62} ${y}`} stroke={ink} strokeWidth={1.7 * s} strokeLinecap="round" />
    case 'wobble':
      return (
        <path d={`M ${-w} ${y} q ${w * 0.5} ${w * 0.45} ${w} 0 q ${w * 0.5} ${-w * 0.45} ${w} 0`} fill="none" stroke={ink} strokeWidth={1.6 * s} strokeLinecap="round" />
      )
    case 'tiny-frown':
      return <path d={`M ${-w * 0.6} ${y + w * 0.35} q ${w * 0.6} ${-w * 0.55} ${w * 1.2} 0`} fill="none" stroke={ink} strokeWidth={1.6 * s} strokeLinecap="round" />
    case 'talking':
      return <ellipse cx={0} cy={y} rx={w * 0.5} ry={w * 0.36} fill={ink} />
    case 'neutral':
    default:
      return <path d={`M ${-w * 0.4} ${y} L ${w * 0.4} ${y}`} stroke={ink} strokeWidth={1.5 * s} strokeLinecap="round" opacity={0.7} />
  }
}

export default function OrbiBody({
  rig,
  face,
  size,
  flip = false,
  traits,
  toward = { x: 0, y: 0 },
  glow = 0,
  plain = false,
  uid = 'orbi'
}: OrbiBodyProps): React.JSX.Element {
  const s = size / 100
  // Big. Over twice the body's height, which is the proportion the whole character rests on.
  const head = 22 * traits.headScale
  const ink = 'var(--orbi-ink)'
  const limb = 6.6 * s
  const skin = plain ? 'none' : `url(#${uid}-skin)`
  // Limbs in the body's own colour: in the shadow colour they were invisible against a dark window.
  const line = plain ? ink : 'var(--orbi-mid)'
  const shade = plain ? ink : 'var(--orbi-deep)'
  const outline = plain ? ink : 'none'

  const part = (name: PartName, children: React.ReactNode): React.JSX.Element | null => {
    const show = rig[name].show
    // Gone entirely rather than drawn at nothing: an invisible node is still a node the browser composites.
    if (!(show > 0.02)) return null
    return (
      <g key={name} transform={place(name, rig, s)} className={`orbi-part orbi-${name}`} opacity={show < 1 ? show : undefined}>
        {children}
      </g>
    )
  }

  const pieces: Partial<Record<PartName, React.JSX.Element | null>> = {
    // The orbit signature: behind the shoulders, turning slowly, the one piece of Orbis's own language on it.
    ring: part(
      'ring',
      <ellipse rx={30 * s * traits.ring} ry={8.5 * s * traits.ring} fill="none" stroke="var(--orbi-ring)" strokeWidth={2.4 * s} className="orbi-ring" strokeLinecap="round" />
    ),
    leftLeg: part('leftLeg', <line x1={0} y1={-4 * s} x2={0} y2={10 * s} stroke={line} strokeWidth={limb * 0.86} strokeLinecap="round" />),
    rightLeg: part('rightLeg', <line x1={0} y1={-4 * s} x2={0} y2={10 * s} stroke={line} strokeWidth={limb * 0.86} strokeLinecap="round" />),
    leftFoot: part('leftFoot', <ellipse rx={4.8 * s} ry={3.1 * s} fill={shade} />),
    rightFoot: part('rightFoot', <ellipse rx={4.8 * s} ry={3.1 * s} fill={shade} />),
    leftArm: part('leftArm', <line x1={0} y1={-3 * s} x2={0} y2={14 * s} stroke={line} strokeWidth={limb * 0.76} strokeLinecap="round" />),
    rightArm: part('rightArm', <line x1={0} y1={-3 * s} x2={0} y2={14 * s} stroke={line} strokeWidth={limb * 0.76} strokeLinecap="round" />),
    leftHand: part('leftHand', <circle r={4.2 * s} fill={line} />),
    rightHand: part('rightHand', <circle r={4.2 * s} fill={line} />),
    // Small, round and tucked under the head. A rounded rectangle read as a fridge; an ellipse reads as a body.
    body: part('body', <ellipse rx={10 * s} ry={10.5 * s} fill={skin} stroke={outline} strokeWidth={1.7 * s} className="orbi-breathe" />),
    head: part(
      'head',
      <>
        {/* Wider than tall, and big. The proportion that does most of the work. */}
        <ellipse rx={head * s} ry={head * 0.9 * s} fill={skin} stroke={outline} strokeWidth={1.7 * s} />
        <line x1={0} y1={-head * 0.88 * s} x2={0} y2={-head * 1.26 * s} stroke={line} strokeWidth={1.6 * s} strokeLinecap="round" />
        <circle cx={0} cy={-head * 1.38 * s} r={2.6 * s} fill="var(--orbi-ring)" className="orbi-bead" />
      </>
    ),
    face: part(
      'face',
      <>
        {traits.sweetness > 0 && face.blush > 0 && !plain ? (
          <g opacity={face.blush * traits.sweetness * 0.6} aria-hidden>
            <ellipse cx={-14 * s} cy={7 * s} rx={4.4 * s} ry={2.6 * s} fill="var(--orbi-blush)" />
            <ellipse cx={14 * s} cy={7 * s} rx={4.4 * s} ry={2.6 * s} fill="var(--orbi-blush)" />
          </g>
        ) : null}
        {/* Eyes sit low on the face. High eyes read as an adult; low eyes read as a baby. */}
        <g transform={`translate(0 ${1.5 * s})`}>
          <Eyes face={face} s={s} toward={toward} ink={ink} />
          {/*
            * The blink.
            *
            * Two lids that drop and lift on their own, for ever, on a transform the compositor handles. It costs
            * nothing and it is the single thing that stops a face looking like a sticker.
            */}
          {plain ? null : (
            /*
             * Clipped to the eyes, which is what makes a lid a lid.
             *
             * Parked above the face they were plainly visible as two bright blobs sitting on top of Orbi's head,
             * like a hat it had not asked for. Clipped, a lid simply does not exist until it comes down over the
             * eye it belongs to.
             */
            <g className="orbi-lids" clipPath={`url(#${uid}-eyes)`} aria-hidden>
              <ellipse cx={-10.5 * face.eyeSpread * s} cy={0} rx={8.6 * s} ry={8.6 * s} fill="var(--orbi-mid)" />
              <ellipse cx={10.5 * face.eyeSpread * s} cy={0} rx={8.6 * s} ry={8.6 * s} fill="var(--orbi-mid)" />
            </g>
          )}
        </g>
        {Math.abs(face.brows) > 1.5 ? (
          <g stroke={ink} strokeWidth={1.6 * s} strokeLinecap="round" opacity={0.85}>
            <line x1={-14 * s} y1={-11 * s} x2={-6 * s} y2={(-11 + face.brows * 0.24) * s} />
            <line x1={14 * s} y1={-11 * s} x2={6 * s} y2={(-11 + face.brows * 0.24) * s} />
          </g>
        ) : null}
        <Mouth face={face} s={s} ink={ink} />
      </>
    )
  }

  return (
    <>
      {/*
        * The gradient lives outside the character, and that placement is load-bearing.
        *
        * `<defs>` has no size and sits at the origin, so a `<defs>` *inside* the group stretched the group's
        * bounding box up to the top-left corner of the drawing. The glow is a `drop-shadow` filter, a filter's
        * region comes from that box, and the result was a small bright square floating beside Orbi's head that
        * no element occupied and no hit test could find.
        */}
      <defs>
        {/* Lit from above, so the head has a top to it rather than being a flat disc. */}
        <radialGradient id={`${uid}-skin`} cx="38%" cy="26%" r="78%">
          <stop offset="0%" stopColor="var(--orbi-light)" />
          <stop offset="58%" stopColor="var(--orbi-mid)" />
          <stop offset="100%" stopColor="var(--orbi-deep)" />
        </radialGradient>
        {/* The only places a lid may ever be painted: the two eyes, and a hair above them. */}
        <clipPath id={`${uid}-eyes`}>
          <ellipse cx={-10.5 * face.eyeSpread * s} cy={1.5 * s} rx={8 * s} ry={7.4 * s} />
          <ellipse cx={10.5 * face.eyeSpread * s} cy={1.5 * s} rx={8 * s} ry={7.4 * s} />
        </clipPath>
      </defs>
      <g className="orbi-character" transform={flip ? `translate(${size} 0) scale(-1 1)` : undefined} style={{ ['--orbi-glow' as string]: String(glow) }}>
        {DRAW_ORDER.map((name) => pieces[name] ?? null).filter(Boolean)}
      </g>
    </>
  )
}
