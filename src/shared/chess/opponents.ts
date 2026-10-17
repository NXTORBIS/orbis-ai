import type { ArenaSetup, Assistance, DifficultyLevel } from './arena.ts'

/**
 * The opponents you can choose to play against.
 *
 * A list of named opponents from gentlest to hardest, each with a short name, what it is really set to, and a
 * sentence about what playing it is like. Pure: no engine, no window, so the whole ladder can be checked in a test
 * (Sections 051, 052).
 *
 * ## Three decisions worth reading before changing anything here
 *
 * **There is no rating next to any of them.** A rating is the result of playing hundreds of games against rated
 * opposition, and nothing in Orbis has played one, so there is no number to show. `coach.ts` refuses to estimate a
 * rating for the same reason. What is shown instead is what the opponent really is: the engine's own strength dial,
 * the position it is set to, and how long it is allowed to think. Those are facts about the settings, not a claim
 * about how well anybody plays. `RATING_NOTE` says this on screen and `rung` is a place in this list -- 1 is the
 * gentlest -- never a score.
 *
 * **A weaker opponent is the engine turned down, not a program told to play badly.** Every rung below the top is
 * made with the engine's own `Skill Level`, which is the setting the engine publishes for exactly this and which it
 * calibrated itself, plus a thinking time. Nothing here plays a random legal move, and nothing here is handed a
 * move that Orbis picked out as bad. That matters because the other way of making a weak bot -- throw a piece away
 * every so often -- produces games that no human of any strength would ever play, and a person learns the wrong
 * thing from them.
 *
 * **They are not personalities.** Every one of them is the same engine at a different setting. None of them prefers
 * attacking, none of them likes an open game, and Orbis does not pretend otherwise: the sentence beside each one
 * describes what its setting really does to its play. `STYLE_NOTE` says this where the list is shown. Inventing a
 * temperament would be the easiest thing on this screen to fake and the hardest for anybody to catch.
 *
 * ## Why the ladder stops where it does at the bottom
 *
 * `Skill Level 0` with a short think is the gentlest the engine goes while still playing chess. It is not a
 * beginner: it will still take a piece you leave and still mate you if you let it. Orbis could go below it only by
 * making the engine play nonsense, so it does not offer a rung there and says so instead of advertising a "beginner"
 * that is nothing of the kind. Fewer honest rungs, rather than more that lie.
 */

// ---------------------------------------------------------------- the engine's own strength dial

/**
 * What the engine's `Skill Level` option accepts.
 *
 * The engine publishes its own minimum and maximum in the handshake and `clampOption` in the engine service holds
 * every value to them, so this is the range the list is written against rather than the range that is enforced.
 * `handicapReach` below is how a screen finds out what the engine in front of it really offers.
 */
export const SKILL_RANGE: Readonly<{ low: number; high: number }> = Object.freeze({ low: 0, high: 20 })

/** The name of the option, spelt exactly as the engine advertises it. A near miss is silently not set. */
export const SKILL_OPTION = 'Skill Level'

export const RATING_NOTE =
  'None of these has a rating. Orbis has never played a rated game, so there is no number it could honestly put next to one. What each opponent is set to is written beside it instead.'

export const STYLE_NOTE =
  'They are all the same engine at different settings. None of them has a favourite kind of game, and the line beside each one describes what its setting does rather than giving it a personality it has not got. Nobody has played a run of games to check those descriptions, so treat them as a guide to the setting and not as a measurement.'

export const LADDER_NOTE =
  'The gentlest opponent here is the lowest setting the engine has while still playing proper chess. It is not a beginner and it will still punish a loose move. Orbis could only go below it by making the engine play nonsense, so it does not offer that.'

// ---------------------------------------------------------------- what an opponent is

export type OpponentId =
  | 'pip'
  | 'sprig'
  | 'pebble'
  | 'brook'
  | 'flint'
  | 'ridge'
  | 'crag'
  | 'summit'
  | 'zenith'

/** A rough band, for grouping the list. A band is a label on a setting, not a measurement of anybody. */
export type OpponentTier = 'gentlest' | 'turned-down' | 'most-of-the-way-up' | 'nothing-held-back'

export interface OpponentSettings {
  /**
   * The engine's own strength dial, 0 to 20. Left out on the top rung, which means nothing is held back.
   *
   * This is the whole of the handicap. There is no second dial, and no move is ever chosen for the engine.
   */
  skill?: number
  /** The search limits really sent with every one of its turns. */
  think: { movetime?: number; depth?: number; nodes?: number }
  /** How many of the engine's own lines to ask for. One, because nothing here chooses among them. */
  lines: number
  /** Kept at zero on purpose: see the note at the top of the file. */
  looseness: number
  spread: number
}

export interface Opponent {
  id: OpponentId
  name: string
  tier: OpponentTier
  /** Its place in this list, 1 for the gentlest. Not a score, and not comparable to anything outside this list. */
  rung: number
  /** What playing it is like, in terms of what its setting really does. Never a temperament. */
  style: string
  /** How strong it is, in words Orbis can stand behind. Never a number that looks like a rating. */
  strength: string
  settings: OpponentSettings
  /** The level of help the setup screen starts on against this one. Changeable; this is only where it starts. */
  help: Assistance
}

/*
 * The list.
 *
 * The dial moves in uneven steps on purpose: the difference between 0 and 3 is much larger than the difference
 * between 14 and 17, so the lower rungs are closer together. The thinking times rise with it because a stronger
 * setting given no time to use it is not actually stronger.
 */
export const OPPONENTS: readonly Opponent[] = Object.freeze([
  Object.freeze({
    id: 'pip' as const,
    name: 'Pip',
    tier: 'gentlest' as const,
    rung: 1,
    style: 'Plays sensibly for a while and then lets something go. It misses things rather than making a plan you can read.',
    strength: 'The gentlest the engine goes. It will still take a piece you leave and still mate you if you let it.',
    settings: Object.freeze({ skill: 0, think: Object.freeze({ movetime: 100 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'best' as const
  }),
  Object.freeze({
    id: 'sprig' as const,
    name: 'Sprig',
    tier: 'gentlest' as const,
    rung: 2,
    style: 'Much the same as Pip, and it lets fewer things go.',
    strength: 'Barely above the gentlest setting. Loose moves are still often punished.',
    settings: Object.freeze({ skill: 2, think: Object.freeze({ movetime: 150 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'best' as const
  }),
  Object.freeze({
    id: 'pebble' as const,
    name: 'Pebble',
    tier: 'turned-down' as const,
    rung: 3,
    style: 'Takes what you leave and sees a short tactic coming. Longer ideas go past it.',
    strength: 'Turned well down. A game against it is usually decided by one thing going wrong rather than by a mistake every move.',
    settings: Object.freeze({ skill: 4, think: Object.freeze({ movetime: 250 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'idea' as const
  }),
  Object.freeze({
    id: 'brook' as const,
    name: 'Brook',
    tier: 'turned-down' as const,
    rung: 4,
    style: 'Rarely gives anything away for nothing, and will punish a piece left loose for a move.',
    strength: 'Turned down, and solid with it. You have to earn something to beat it.',
    settings: Object.freeze({ skill: 7, think: Object.freeze({ movetime: 400 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'idea' as const
  }),
  Object.freeze({
    id: 'flint' as const,
    name: 'Flint',
    tier: 'most-of-the-way-up' as const,
    rung: 5,
    style: 'Plays solidly and rarely misses a tactic. Mistakes it makes are small ones.',
    strength: 'About halfway up the dial. A loose move usually costs something.',
    settings: Object.freeze({ skill: 10, think: Object.freeze({ movetime: 600 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'nudge' as const
  }),
  Object.freeze({
    id: 'ridge' as const,
    name: 'Ridge',
    tier: 'most-of-the-way-up' as const,
    rung: 6,
    style: 'Takes its chances and defends well. It will not hand you anything.',
    strength: 'Well up the dial. You will need a real idea rather than a lucky tactic.',
    settings: Object.freeze({ skill: 13, think: Object.freeze({ movetime: 900 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'nudge' as const
  }),
  Object.freeze({
    id: 'crag' as const,
    name: 'Crag',
    tier: 'most-of-the-way-up' as const,
    rung: 7,
    style: 'Hard to get anything past. It finds the awkward move more often than not.',
    strength: 'Near the top of the dial, with a second to think. Beating it is an achievement.',
    settings: Object.freeze({ skill: 16, think: Object.freeze({ movetime: 1200 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'none' as const
  }),
  Object.freeze({
    id: 'summit' as const,
    name: 'Summit',
    tier: 'most-of-the-way-up' as const,
    rung: 8,
    style: 'Plays well and keeps playing well. There is no moment where it stops paying attention.',
    strength: 'One notch off the top of the dial, with two seconds a move.',
    settings: Object.freeze({ skill: 19, think: Object.freeze({ movetime: 2000 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'none' as const
  }),
  Object.freeze({
    id: 'zenith' as const,
    name: 'Zenith',
    tier: 'nothing-held-back' as const,
    rung: 9,
    style: 'The engine with nothing turned down at all.',
    strength: 'Nothing held back, three seconds a move. Expect to lose.',
    settings: Object.freeze({ think: Object.freeze({ movetime: 3000 }), lines: 1, looseness: 0, spread: 1 }),
    help: 'none' as const
  })
])

/** The gentlest opponent is where the list starts, so an unknown id lands somewhere playable rather than nowhere. */
export const opponent = (id: OpponentId): Opponent => OPPONENTS.find((one) => one.id === id) ?? OPPONENTS[0]

export const isOpponentId = (id: unknown): id is OpponentId => typeof id === 'string' && OPPONENTS.some((one) => one.id === id)

/** The list in the order it is shown: gentlest first, by the rung each one carries. */
export const ladder = (): Opponent[] => [...OPPONENTS].sort((a, b) => a.rung - b.rung)

// ---------------------------------------------------------------- saying what one is, from its own data

/**
 * What an opponent is set to, in one sentence, built from its own settings rather than written out by hand.
 *
 * Two sentences that could drift apart are one sentence too many: a description typed next to a number is the thing
 * that is still describing the old number a year later.
 */
export function describeOpponent(one: Opponent): string {
  const bits: string[] = []
  const skill = one.settings.skill
  bits.push(
    skill === undefined
      ? 'the engine’s strength dial is not turned down at all'
      : `the engine’s own strength dial is set to ${skill} out of ${SKILL_RANGE.high}`
  )
  if (one.settings.think.movetime) bits.push(`and it thinks for ${one.settings.think.movetime} ms a move`)
  if (one.settings.think.depth) bits.push(`and looks no further than ${one.settings.think.depth} moves ahead`)
  if (one.settings.think.nodes) bits.push(`and looks at no more than ${one.settings.think.nodes} positions`)
  return `${bits.join(' ')}.`
}

/** The whole of what is said about an opponent on the list: what it is like, how strong, and what it is set to. */
export function opponentLines(one: Opponent): { name: string; style: string; strength: string; setting: string } {
  return { name: one.name, style: one.style, strength: one.strength, setting: describeOpponent(one) }
}

// ---------------------------------------------------------------- turning one into a level the session understands

/**
 * An opponent as the session's own idea of a level.
 *
 * The session already knows how to budget thinking time against a clock and how to ask the engine, so an opponent
 * becomes one of those rather than a second path through all of it.
 */
export function levelForOpponent(one: Opponent): DifficultyLevel {
  return {
    id: one.id,
    name: one.name,
    about: `${one.strength} ${one.style}`,
    think: { ...one.settings.think },
    lines: one.settings.lines,
    looseness: one.settings.looseness,
    spread: one.settings.spread,
    ...(one.settings.skill === undefined ? {} : { skillLevel: one.settings.skill })
  }
}

/** A setup for a game against this opponent: the rest of the setup as it stands, with this opponent's own help level. */
export function setupForOpponent(base: ArenaSetup, one: Opponent): ArenaSetup {
  return { ...base, opponent: one.id, assistance: one.help }
}

// ---------------------------------------------------------------- does the handicap actually reach the engine?

/** One advertised option, as the engine's handshake reported it. Only the parts this file needs. */
export interface AdvertisedOption {
  name: string
  type: string
  min?: number
  max?: number
}

export type HandicapReach =
  /** The dial will be set to this, which is what the opponent asked for. */
  | { kind: 'applies'; value: number; says: string }
  /** The engine's own range is narrower than the list assumes, so the dial lands somewhere else. Said, not hidden. */
  | { kind: 'clamped'; value: number; wanted: number; says: string }
  /** This opponent turns nothing down, so there is nothing to apply. */
  | { kind: 'nothing-to-apply'; says: string }
  /** This engine has no strength dial. The opponent is then only its thinking time, and the screen must say so. */
  | { kind: 'not-offered'; says: string }
  /** Orbis has not asked the engine what it can do yet. Not the same answer as "it has not got one". */
  | { kind: 'unknown'; says: string }

/**
 * Whether this opponent's strength will really be set on the engine in front of us.
 *
 * The reason this exists rather than being assumed: `Skill Level` is an option the engine publishes, and an engine
 * that does not publish it is simply never sent it -- the engine service refuses to guess at an option name. So a
 * list of nine opponents could quietly be nine thinking times, with the screen still saying "the dial is set to 4".
 * This is the question a screen has to ask before it says that.
 *
 * An empty option list means the engine has not shaken hands yet, which is `unknown` and not `not-offered`. A thing
 * Orbis cannot see yet is not a thing that is missing.
 */
export function handicapReach(one: Opponent, advertised: readonly AdvertisedOption[]): HandicapReach {
  const wanted = one.settings.skill
  if (wanted === undefined) {
    return { kind: 'nothing-to-apply', says: `${one.name} does not turn the engine down, so there is nothing to set.` }
  }
  if (!advertised.length) {
    return {
      kind: 'unknown',
      says: 'Orbis has not asked the engine what it can do yet, so it cannot yet say whether this opponent’s strength will really be set.'
    }
  }
  const option = advertised.find((entry) => entry.name === SKILL_OPTION)
  if (!option || option.type !== 'spin') {
    return {
      kind: 'not-offered',
      says: `This engine has no strength dial, so ${one.name} will only be the thinking time below and nothing else held back. It will play much harder than the list says.`
    }
  }
  const low = typeof option.min === 'number' ? option.min : SKILL_RANGE.low
  const high = typeof option.max === 'number' ? option.max : SKILL_RANGE.high
  if (low > high) {
    return {
      kind: 'not-offered',
      says: `This engine’s strength dial reports a range Orbis cannot use, so ${one.name} will only be the thinking time below.`
    }
  }
  const landed = Math.min(high, Math.max(low, wanted))
  if (landed !== wanted) {
    return {
      kind: 'clamped',
      value: landed,
      wanted,
      says: `This engine’s strength dial only goes from ${low} to ${high}, so ${one.name} is set to ${landed} rather than ${wanted}. It will not play quite as the list says.`
    }
  }
  return { kind: 'applies', value: landed, says: `${one.name}: the engine’s strength dial is set to ${landed}.` }
}
