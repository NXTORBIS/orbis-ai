/**
 * The picture on an Orbis account.
 *
 * Every one of these is a sphere, because Orbis already has one and it is the thing people recognise the product by.
 * They are not photographs of marbles and they are not image files: each is a short recipe -- four colours and an
 * angle -- that the stylesheet turns into a lit sphere. That matters for three reasons.
 *
 * **Nothing ships.** No PNGs to load, nothing to go missing, nothing to look soft on a high-resolution screen. The
 * same recipe draws an 18px mark beside a message and a 96px orb on the setup screen, both exactly sharp.
 *
 * **It is one idea, not twelve pictures.** A sphere lit from the upper left, with an interior that differs. Set them
 * side by side and they read as a family rather than as a folder of clip art.
 *
 * **A name can choose one.** `suggestFor` turns whatever has been typed into a stable choice, so the setup screen can
 * show somebody a picture that is already theirs before they have picked anything -- and show it changing as they
 * type, which is the moment this is for.
 *
 * The ids are stored in settings and must never be renamed: an account whose picture is `aurora` and a build that has
 * renamed that to `dawn` is an account whose picture silently becomes the fallback.
 */

/**
 * What is going on inside the sphere.
 *
 * The first version had none of this: twelve balls of one colour each, distinguishable only by hue, with a letter
 * stamped on them to tell them apart. That is a swatch, not a thing somebody wants as their picture -- and the
 * letter was doing work the design should have been doing. Each of these is a different weather inside the glass,
 * so the twelve differ in shape as well as in colour and a person can say "the striped one" rather than "the blue".
 *
 * Drawn under the shading, never instead of it: a pattern on a flat disc is a sticker, and what makes these read
 * as glass is that the same glint, limb and rim sit over all of them.
 */
export type Pattern = 'bands' | 'swirl' | 'nebula' | 'eye' | 'shard' | 'wave'

export interface Avatar {
  /** Stored in settings. Never rename one of these. */
  readonly id: string
  /** Said out loud by a screen reader, and shown as the title on the swatch. */
  readonly name: string
  /** The interior, from the lit side to the dark limb. */
  readonly from: string
  readonly to: string
  /** The second colour the pattern is drawn in. The two should not be neighbours, or the pattern disappears. */
  readonly with: string
  /** The glow that sits under the rim on the lit side. Usually a brighter relative of `from`. */
  readonly rim: string
  /** Where the light falls, in degrees, so the family does not all face the same way. */
  readonly turn: number
  /** The weather inside. */
  readonly pattern: Pattern
}

/**
 * Twelve, which is two rows of six on a narrow screen and one long row on a wide one.
 *
 * Ordered so that neighbours differ: a run of four blues in the middle of the row looks like an accident, and the
 * eye picks a favourite much faster when consecutive swatches are not nearly the same.
 */
export const AVATARS: readonly Avatar[] = Object.freeze([
  { id: 'cyan', name: 'Tide', from: '#5fe4ff', to: '#04202e', with: '#06566f', rim: '#a6f2ff', turn: 318, pattern: 'wave' },
  { id: 'ember', name: 'Ember', from: '#ff9d5c', to: '#2a0b06', with: '#8c1b0c', rim: '#ffd0a8', turn: 330, pattern: 'swirl' },
  { id: 'jade', name: 'Jade', from: '#48e5a0', to: '#042219', with: '#065040', rim: '#9df5cd', turn: 312, pattern: 'bands' },
  { id: 'orchid', name: 'Orchid', from: '#c58cff', to: '#190830', with: '#3d1278', rim: '#e6ccff', turn: 324, pattern: 'nebula' },
  { id: 'amber', name: 'Amber', from: '#ffc94d', to: '#2a1900', with: '#7a4100', rim: '#ffe6a8', turn: 306, pattern: 'shard' },
  { id: 'cobalt', name: 'Cobalt', from: '#6aa8ff', to: '#061331', with: '#102a8c', rim: '#b8d4ff', turn: 336, pattern: 'eye' },
  { id: 'rose', name: 'Rose', from: '#ff7d9c', to: '#2f0610', with: '#73062c', rim: '#ffc2d1', turn: 300, pattern: 'swirl' },
  { id: 'mint', name: 'Mint', from: '#7ef0d8', to: '#042421', with: '#065c4e', rim: '#c2fbee', turn: 342, pattern: 'nebula' },
  { id: 'slate', name: 'Slate', from: '#b8c6d8', to: '#0b111a', with: '#2b3a4d', rim: '#e4ecf6', turn: 315, pattern: 'bands' },
  { id: 'coral', name: 'Coral', from: '#ff8a6b', to: '#2b0d09', with: '#8a2414', rim: '#ffc4b3', turn: 348, pattern: 'eye' },
  { id: 'violet', name: 'Violet', from: '#8b7cff', to: '#0e092b', with: '#241680', rim: '#cbc3ff', turn: 309, pattern: 'wave' },
  { id: 'gold', name: 'Gold', from: '#ffd98a', to: '#281f06', with: '#6d4c05', rim: '#fff0c9', turn: 333, pattern: 'shard' }
])

export const DEFAULT_AVATAR = 'cyan'

const BY_ID = new Map(AVATARS.map((one) => [one.id, one]))

/**
 * The avatar for a stored id.
 *
 * Never null. A settings file written by a newer build, or edited by hand, must not leave somebody without a picture
 * -- the fallback is the default one, which is the same thing a brand new account gets.
 */
export function avatarFor(id: string | null | undefined): Avatar {
  return BY_ID.get(String(id ?? '')) ?? BY_ID.get(DEFAULT_AVATAR)!
}

/** Whether an id is one of the known ones, which is what settings validation needs. */
export function isAvatar(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id)
}

/**
 * The avatar a name suggests.
 *
 * Stable -- the same name always gives the same one -- and spread, so two people in the same house do not both get
 * cyan. It is deliberately not random: on the setup screen the suggestion is shown as the name is typed, and a
 * suggestion that flickers to a different colour on every keystroke for the *same* name would read as a fault.
 *
 * Case and surrounding space are ignored, because "Amit" and " amit " are the same person.
 */
export function suggestFor(name: string): Avatar {
  const key = name.trim().toLowerCase()
  if (key === '') return avatarFor(DEFAULT_AVATAR)
  // FNV-1a. Small, no dependencies, and it scatters short strings well -- which matters, because most names are short
  // and a weaker hash puts every three-letter name on the same two colours.
  let hash = 0x811c9dc5
  for (let at = 0; at < key.length; at++) {
    hash ^= key.charCodeAt(at)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return AVATARS[hash % AVATARS.length]
}

/**
 * The letter drawn on an avatar when there is nothing else to show.
 *
 * One letter, never two: an orb is small and a pair of initials inside it is a smudge. Letters and digits only, so a
 * name that is entirely punctuation or emoji gives nothing rather than a box glyph.
 */
export function markFor(name: string): string {
  for (const ch of name.trim()) {
    if (/[\p{L}\p{N}]/u.test(ch)) return ch.toUpperCase()
  }
  return ''
}

/**
 * The custom properties a swatch needs, as a style object.
 *
 * Here rather than in the component so that every place that draws one -- the setup screen, the sidebar, a message --
 * is drawing the same thing from the same four values.
 */
export function avatarStyle(id: string | null | undefined): Record<string, string> {
  const one = avatarFor(id)
  return {
    '--av-from': one.from,
    '--av-to': one.to,
    '--av-with': one.with,
    '--av-rim': one.rim,
    '--av-turn': `${one.turn}deg`
  }
}
