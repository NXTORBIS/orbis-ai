/**
 * The things in Orbi's room, drawn.
 *
 * ## Why pictures and not labels
 *
 * The room used to be the *words* "Bookshelf" and "Plant" floating over a desk, which is a list pretending to be a
 * place. A room somebody wants to put things in has to look like a room. These are deliberately simple shapes —
 * flat, two or three colours, built from the same accent the rest of Orbis uses — because a room full of detailed
 * illustrations would pull the eye away from the work, which is the opposite of the point.
 *
 * ## Everything here is drawn by hand, in code
 *
 * No image files, no icon font, nothing downloaded. That keeps the room working offline, keeps it sharp at any size
 * and keeps the whole feature a few kilobytes.
 *
 * Each piece draws inside a 100×100 box and sits on the floor line at y=100, so anything can be placed anywhere
 * without looking like it is hovering.
 */

const INK = 'var(--st-ink, #eef2f8)'
const LINE = 'var(--st-line, rgba(255,255,255,0.18))'
const ACCENT = 'var(--cyan, #3fd8ff)'
const WARM = '#ffbe4d'
const GREEN = '#3ee58a'

export const ROOM_ART: Record<string, React.JSX.Element> = {
  'room-books': (
    <g>
      <rect x="22" y="72" width="56" height="10" rx="2" fill={LINE} stroke={INK} strokeWidth="1.5" />
      <rect x="26" y="62" width="48" height="10" rx="2" fill="none" stroke={ACCENT} strokeWidth="1.5" />
      <rect x="31" y="52" width="38" height="10" rx="2" fill={LINE} stroke={INK} strokeWidth="1.5" />
    </g>
  ),
  'room-bookshelf': (
    <g>
      <rect x="18" y="26" width="64" height="74" rx="3" fill="none" stroke={INK} strokeWidth="2" />
      <line x1="18" y1="50" x2="82" y2="50" stroke={INK} strokeWidth="2" />
      <line x1="18" y1="74" x2="82" y2="74" stroke={INK} strokeWidth="2" />
      {[30, 38, 46, 54, 62].map((x) => (
        <rect key={x} x={x} y="32" width="5" height="18" fill={x % 16 === 0 ? ACCENT : LINE} />
      ))}
      {[28, 36, 44, 58].map((x) => (
        <rect key={x} x={x} y="56" width="5" height="18" fill={x === 36 ? WARM : LINE} />
      ))}
    </g>
  ),
  'room-plant': (
    <g>
      <path d="M38 100 L42 78 H58 L62 100 Z" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M50 78 C50 60 40 56 36 46 C48 48 50 58 50 66" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M50 74 C50 58 60 52 66 44 C58 50 54 60 52 70" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  ),
  'room-telescope': (
    <g>
      <line x1="50" y1="100" x2="50" y2="74" stroke={INK} strokeWidth="2" />
      <line x1="38" y1="100" x2="62" y2="100" stroke={INK} strokeWidth="2" />
      <line x1="34" y1="70" x2="72" y2="42" stroke={INK} strokeWidth="5" strokeLinecap="round" />
      <circle cx="74" cy="40" r="5" fill="none" stroke={ACCENT} strokeWidth="2" />
      <circle cx="30" cy="30" r="1.6" fill={ACCENT} />
      <circle cx="44" cy="20" r="1.2" fill={ACCENT} />
    </g>
  ),
  'room-monitor': (
    <g>
      <rect x="20" y="36" width="60" height="40" rx="3" fill="none" stroke={INK} strokeWidth="2" />
      <rect x="26" y="42" width="30" height="4" rx="2" fill={ACCENT} />
      <rect x="26" y="50" width="42" height="3" rx="1.5" fill={LINE} />
      <rect x="26" y="57" width="36" height="3" rx="1.5" fill={LINE} />
      <path d="M44 76 H56 L58 90 H42 Z" fill="none" stroke={INK} strokeWidth="2" />
      <line x1="34" y1="90" x2="66" y2="90" stroke={INK} strokeWidth="2" />
    </g>
  ),
  'room-science': (
    <g>
      <path d="M42 34 V54 L28 88 A4 4 0 0 0 32 94 H68 A4 4 0 0 0 72 88 L58 54 V34" fill="none" stroke={INK} strokeWidth="2" />
      <line x1="38" y1="34" x2="62" y2="34" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M34 78 L66 78 L72 88 A4 4 0 0 1 68 94 H32 A4 4 0 0 1 28 88 Z" fill={ACCENT} opacity="0.35" />
      <circle cx="46" cy="84" r="2" fill={ACCENT} />
      <circle cx="56" cy="88" r="1.5" fill={ACCENT} />
    </g>
  ),
  'room-art': (
    <g>
      <rect x="22" y="24" width="56" height="44" rx="2" fill="none" stroke={INK} strokeWidth="2" />
      <path d="M26 60 L40 42 L50 54 L60 36 L74 60 Z" fill={ACCENT} opacity="0.4" />
      <circle cx="64" cy="34" r="4" fill={WARM} />
    </g>
  ),
  'room-certificate': (
    <g>
      <rect x="26" y="30" width="48" height="56" rx="2" fill="none" stroke={INK} strokeWidth="2" />
      <line x1="34" y1="44" x2="66" y2="44" stroke={LINE} strokeWidth="2" />
      <line x1="34" y1="52" x2="60" y2="52" stroke={LINE} strokeWidth="2" />
      <line x1="34" y1="60" x2="64" y2="60" stroke={LINE} strokeWidth="2" />
      <circle cx="50" cy="74" r="6" fill="none" stroke={WARM} strokeWidth="2" />
      <path d="M46 80 L44 92 L50 88 L56 92 L54 80" fill={WARM} opacity="0.7" />
    </g>
  ),
  'room-constellation': (
    <g>
      <rect x="20" y="22" width="60" height="56" rx="3" fill="none" stroke={LINE} strokeWidth="1.5" />
      <line x1="32" y1="62" x2="44" y2="40" stroke={ACCENT} strokeWidth="1.2" />
      <line x1="44" y1="40" x2="58" y2="50" stroke={ACCENT} strokeWidth="1.2" />
      <line x1="58" y1="50" x2="68" y2="32" stroke={ACCENT} strokeWidth="1.2" />
      {[
        [32, 62],
        [44, 40],
        [58, 50],
        [68, 32]
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" fill={ACCENT} />
      ))}
    </g>
  ),
  'room-desk-tidy': (
    <g>
      <rect x="22" y="70" width="56" height="8" rx="2" fill="none" stroke={INK} strokeWidth="2" />
      <rect x="28" y="56" width="14" height="14" rx="2" fill="none" stroke={ACCENT} strokeWidth="1.8" />
      <rect x="46" y="60" width="10" height="10" rx="2" fill={LINE} stroke={INK} strokeWidth="1.5" />
      <line x1="62" y1="70" x2="62" y2="54" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <line x1="66" y1="70" x2="68" y2="56" stroke={WARM} strokeWidth="2" strokeLinecap="round" />
    </g>
  ),
  'room-lamp': (
    <g>
      <path d="M36 44 L64 44 L58 64 H42 Z" fill={WARM} opacity="0.35" stroke={WARM} strokeWidth="2" />
      <line x1="50" y1="64" x2="50" y2="94" stroke={INK} strokeWidth="2" />
      <ellipse cx="50" cy="96" rx="14" ry="4" fill="none" stroke={INK} strokeWidth="2" />
    </g>
  )
}

/** Anything without a picture of its own gets a plain crate, so a new item is never invisible. */
export const DEFAULT_ART = (
  <g>
    <rect x="30" y="58" width="40" height="36" rx="3" fill="none" stroke={INK} strokeWidth="2" />
    <line x1="30" y1="70" x2="70" y2="70" stroke={LINE} strokeWidth="2" />
  </g>
)

export function RoomPiece({ id, label, size = 72 }: { id: string; label: string; size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={label} className="st-room-art">
      {ROOM_ART[id] ?? DEFAULT_ART}
    </svg>
  )
}
