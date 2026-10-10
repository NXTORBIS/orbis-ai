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
 * renamed that to `dawn` is an account whose picture silently becomes the fallback. The *names* are only ever shown,
 * so those can change freely -- and they are worlds rather than colours, because "Vesper" is something somebody
 * picks and "Rose" is something somebody is assigned.
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
  /**
   * The interior, from the lit side to the dark limb.
   *
   * Both are cool -- blue is never weaker than red in any colour in this file, and that is measured rather than
   * trusted. The first set was half warm: oranges, ambers, golds and a coral, which next to Orbis's own cyan on
   * near-black read as a bag of sweets somebody had spilled onto the product. Warmth is what the rest of Orbis
   * reserves for a warning, so a picture that is warm by default is saying something it does not mean.
   *
   * The dark side goes almost all the way to the application's own background (`#060708`), so every world sits
   * in the same black. That and the shared air are the two things that make twelve different bodies read as one
   * set rather than as twelve separate decisions.
   */
  readonly from: string
  readonly to: string
  /** The second colour the pattern is drawn in. The two should not be neighbours, or the pattern disappears. */
  readonly with: string
  /**
   * The air: the colour of this world's atmosphere where you look through most of it, at the limb.
   *
   * Every one of the twelve is in Orbis's own cyan family, and that is the point. The bodies differ so a person
   * can tell them apart; the air is the same light falling on all of them, which is what makes twelve separate
   * spheres read as twelve worlds in one place rather than as a bag of coloured marbles. It is also the single
   * thing that ties them to the rest of the product, whose accent is `--cyan`.
   *
   * It must not be a brighter copy of `from`. `rim` already is one, and an edge drawn in the body's own colour
   * reads as a stroke around the shape rather than as something in front of it -- which is exactly what the old
   * version looked like.
   */
  readonly sky: string
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
 * **All of them are cool**, because the product is: cyan light on near-black. Twelve worlds spread around the cold
 * half of the wheel -- sea green, aqua, cyan, ice, sky, cobalt, indigo, orchid, magenta -- rather than a rainbow
 * with four fires in it.
 *
 * That costs something, and the cost is paid elsewhere. Hue alone can no longer tell twelve apart inside a 150°
 * arc, so each also differs in **how bright its body is** and in **which way its weather runs**:
 *
 * - *Bright* bodies alternate with *dark* ones down the row, so no two neighbours are the same weight. Quartz is
 *   almost white and Umbra is almost black, and they sit next to each other on purpose.
 * - Umbra alone has its weather drawn **lighter** than its body: rings of light on a world that is otherwise the
 *   application's own black. Four of them were drawn that way at first and it was wrong -- a pale pattern over a
 *   dark body stops reading as weather inside glass and starts reading as paint on top of it, and Basalt in
 *   particular came out as a humbug. One is a world with its own light in it; four is a style.
 * - No two near neighbours in colour share a pattern. Tide and Boreal are both teal and were both waves, which
 *   made them the same world at two brightnesses; Boreal turning instead is what tells them apart at 56px.
 *
 * The `id` of each is what settings stores and must never change; the names moved when the colours did, which is
 * why `ember` is called Umbra and `gold` is called Cygnus. Nothing shows an id, so that is only ever read here.
 */
export const AVATARS: readonly Avatar[] = Object.freeze([
  { id: 'cyan', name: 'Tide', from: '#3fd8ff', to: '#031a26', with: '#0e6b89', rim: '#a9f1ff', sky: '#b4c9ff', turn: 318, pattern: 'wave' },
  { id: 'violet', name: 'Twilight', from: '#8878ff', to: '#0a0722', with: '#2a1d8c', rim: '#cbc2ff', sky: '#9fd4ff', turn: 309, pattern: 'swirl' },
  { id: 'jade', name: 'Verdant', from: '#36d9a2', to: '#031f1a', with: '#02574a', rim: '#9af5d2', sky: '#a6d8ff', turn: 312, pattern: 'bands' },
  { id: 'orchid', name: 'Nebula', from: '#b57af2', to: '#160830', with: '#3d1077', rim: '#e4c8ff', sky: '#a8c6ff', turn: 324, pattern: 'nebula' },
  { id: 'amber', name: 'Quartz', from: '#d8ecfa', to: '#0c161e', with: '#78b0d2', rim: '#f2fbff', sky: '#8fe0ff', turn: 306, pattern: 'shard' },
  { id: 'ember', name: 'Umbra', from: '#24404d', to: '#05080b', with: '#6cc8e4', rim: '#8fe6ff', sky: '#a4d2ff', turn: 330, pattern: 'eye' },
  { id: 'rose', name: 'Vesper', from: '#d46ad4', to: '#230525', with: '#5e0866', rim: '#f5bdf5', sky: '#b7c6ff', turn: 300, pattern: 'swirl' },
  { id: 'coral', name: 'Boreal', from: '#3a8f9e', to: '#04161c', with: '#063744', rim: '#9fdce8', sky: '#aacdff', turn: 348, pattern: 'swirl' },
  { id: 'gold', name: 'Cygnus', from: '#93b4fa', to: '#070c22', with: '#3f55b8', rim: '#d2e0ff', sky: '#95e0ff', turn: 333, pattern: 'shard' },
  { id: 'slate', name: 'Basalt', from: '#6c7e93', to: '#090e15', with: '#1b2733', rim: '#c3d2e4', sky: '#8fdcff', turn: 315, pattern: 'bands' },
  { id: 'mint', name: 'Aurora', from: '#66ecd4', to: '#032321', with: '#05604f', rim: '#c6fbf0', sky: '#a2c8ff', turn: 342, pattern: 'nebula' },
  { id: 'cobalt', name: 'Abyss', from: '#4f84f0', to: '#040c22', with: '#122a8e', rim: '#b2cfff', sky: '#9bd6ff', turn: 336, pattern: 'eye' }
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
    '--av-sky': one.sky,
    '--av-rim': one.rim,
    '--av-turn': `${one.turn}deg`
  }
}
