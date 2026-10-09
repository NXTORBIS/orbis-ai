import type { FocusSession, OrbiBehaviour, OrbiState, PersonalRecord } from './types.ts'

/**
 * Orbi's animation system: what plays, what interrupts what, and what never plays at all.
 *
 * ## Why this is a priority queue and not a pile of CSS classes
 *
 * Orbi has to be able to celebrate and then, half a second later, put up a shield because somebody reached for a
 * distraction. If celebration simply runs to completion, the shield arrives late -- and late is the one thing a
 * shield cannot be. So every animation declares a priority and a set of things it may cut across, and the
 * **highest priority wins immediately**:
 *
 *   P0  the shield, a completed session, a recovered crash   -- never waits for anything
 *   P1  a level, an achievement, a finished goal             -- waits only for P0
 *   P2  a milestone, XP                                      -- dropped if anything above is running
 *   P3  floating, blinking, the ring turning                 -- stops whenever anything else happens
 *
 * The practical effect, and the reason it is worth a module: a student never sees Orbi finish a dance before
 * noticing they have opened something they asked to be kept away from.
 *
 * ## Why the ambient layer stops
 *
 * Idle floating is the cheapest animation and also the one that makes a cinematic moment look wrong -- two
 * animations on the same transform fight, and the result reads as a glitch rather than a flourish. So P3 is not
 * merely lower priority; it is switched off while anything else plays.
 *
 * Pure: a decision about what should be playing, given what is playing and what just happened.
 */

export type AnimPriority = 0 | 1 | 2 | 3

/** Every animation Orbi has, by the thing that causes it. */
export type OrbiMoment =
  // P0 -- cannot be made to wait
  | 'shield'
  | 'session-complete'
  | 'restored'
  | 'error'
  // P1 -- the earned moments
  | 'level-up'
  | 'achievement'
  | 'goal-complete'
  | 'record'
  // P2 -- the small ones
  | 'milestone'
  | 'xp'
  | 'task-complete'
  | 'saved'
  | 'break-start'
  | 'break-over'
  | 'comeback'
  | 'greeting'
  | 'countdown'
  /**
   * The little dance.
   *
   * Deliberately rare and deliberately short. It is for the end of something that took a while -- a stage passed, a
   * long session finished -- and never for ordinary XP, because a companion that dances at everything is a
   * companion somebody turns off by Wednesday.
   */
  | 'dance'
  | 'losing-focus'
  // P3 -- always there, never important
  | 'idle'
  | 'blink'
  | 'hover'
  | 'look'
  | 'drag'
  | 'sleep'
  | 'wake'
  | 'thinking'
  | 'weather-rain'
  | 'weather-clear'
  | 'weather-snow'

export interface AnimSpec {
  priority: AnimPriority
  /** How long it runs, in milliseconds. Ambient animations loop and have no end. */
  duration: number | null
  /** The state Orbi is in while it plays. */
  state: OrbiState
  /** How much the ring does: a multiplier on its turning speed. */
  ring: number
  /** How far Orbi floats, in pixels. */
  float: number
  /** How bright the glow is, 0..1. */
  glow: number
  /** Whether particles are drawn. Off for anything that has to be cheap. */
  particles: boolean
  /** Whether this one may be cut short by something of equal priority. */
  interruptible: boolean
}

export const ANIMATIONS: Record<OrbiMoment, AnimSpec> = {
  // ---------------------------------------------------------------- P0
  shield: { priority: 0, duration: 2600, state: 'distraction-warning', ring: 2.6, float: 2, glow: 1, particles: true, interruptible: false },
  'session-complete': { priority: 0, duration: 3200, state: 'celebrating', ring: 3, float: 9, glow: 1, particles: true, interruptible: false },
  restored: { priority: 0, duration: 1600, state: 'recovery', ring: 0.8, float: 4, glow: 0.5, particles: false, interruptible: true },
  error: { priority: 0, duration: 1400, state: 'error', ring: 0, float: 0, glow: 0.25, particles: false, interruptible: true },

  // ---------------------------------------------------------------- P1
  'level-up': { priority: 1, duration: 3600, state: 'level-up', ring: 4, float: 10, glow: 1, particles: true, interruptible: false },
  achievement: { priority: 1, duration: 2800, state: 'achievement', ring: 2.4, float: 8, glow: 1, particles: true, interruptible: false },
  'goal-complete': { priority: 1, duration: 4200, state: 'celebrating', ring: 3.2, float: 9, glow: 1, particles: true, interruptible: false },
  // A record is its own thing: it only happens once per record and it should feel different from a milestone.
  record: { priority: 1, duration: 2400, state: 'celebrating', ring: 3.4, float: 7, glow: 1, particles: true, interruptible: true },

  // ---------------------------------------------------------------- P2
  milestone: { priority: 2, duration: 1100, state: 'encouraging', ring: 1.8, float: 6, glow: 0.8, particles: true, interruptible: true },
  xp: { priority: 2, duration: 900, state: 'encouraging', ring: 1.4, float: 5, glow: 0.7, particles: true, interruptible: true },
  'task-complete': { priority: 2, duration: 900, state: 'encouraging', ring: 1.5, float: 5, glow: 0.7, particles: true, interruptible: true },
  saved: { priority: 2, duration: 700, state: 'curious', ring: 1.2, float: 4, glow: 0.6, particles: true, interruptible: true },
  'break-start': { priority: 2, duration: 1400, state: 'break', ring: 0.3, float: 7, glow: 0.35, particles: false, interruptible: true },
  'break-over': { priority: 2, duration: 1200, state: 'ready', ring: 1, float: 5, glow: 0.5, particles: false, interruptible: true },
  comeback: { priority: 2, duration: 2000, state: 'recovery', ring: 1, float: 5, glow: 0.6, particles: true, interruptible: true },
  greeting: { priority: 2, duration: 1500, state: 'ready', ring: 1.2, float: 5, glow: 0.6, particles: false, interruptible: true },
  countdown: { priority: 2, duration: 3000, state: 'focused', ring: 2, float: 3, glow: 0.8, particles: true, interruptible: true },
  'losing-focus': { priority: 2, duration: 2400, state: 'curious', ring: 0.5, float: 5, glow: 0.5, particles: false, interruptible: true },
  dance: { priority: 2, duration: 2600, state: 'celebrating', ring: 2.2, float: 9, glow: 0.9, particles: true, interruptible: true },

  // ---------------------------------------------------------------- P3, the layer that gets out of the way
  idle: { priority: 3, duration: null, state: 'idle', ring: 0.5, float: 4, glow: 0.3, particles: false, interruptible: true },
  blink: { priority: 3, duration: 160, state: 'idle', ring: 0.5, float: 4, glow: 0.3, particles: false, interruptible: true },
  hover: { priority: 3, duration: null, state: 'curious', ring: 1.1, float: 6, glow: 0.7, particles: false, interruptible: true },
  look: { priority: 3, duration: 900, state: 'curious', ring: 0.7, float: 4, glow: 0.4, particles: false, interruptible: true },
  drag: { priority: 3, duration: null, state: 'curious', ring: 1.4, float: 0, glow: 0.6, particles: true, interruptible: true },
  sleep: { priority: 3, duration: null, state: 'sleeping', ring: 0.1, float: 8, glow: 0.15, particles: false, interruptible: true },
  wake: { priority: 3, duration: 1200, state: 'ready', ring: 0.8, float: 5, glow: 0.5, particles: false, interruptible: true },
  // Weather: ambient, and only ever a small change in how it moves. Rain slows it; a clear sky lifts it a little.
  'weather-rain': { priority: 3, duration: null, state: 'idle', ring: 0.3, float: 3, glow: 0.22, particles: false, interruptible: true },
  'weather-clear': { priority: 3, duration: null, state: 'idle', ring: 0.7, float: 6, glow: 0.42, particles: false, interruptible: true },
  'weather-snow': { priority: 3, duration: null, state: 'idle', ring: 0.25, float: 7, glow: 0.3, particles: true, interruptible: true },
  thinking: { priority: 3, duration: null, state: 'thinking', ring: 0.4, float: 3, glow: 0.6, particles: true, interruptible: true }
}

export interface Playing {
  moment: OrbiMoment
  startedAt: number
  /** When it ends. Null for the ambient ones, which run until replaced. */
  endsAt: number | null
}

/** The ambient state, which is what Orbi falls back to when nothing else is happening. */
export function ambient(context: {
  session: FocusSession | null
  idleMinutes: number
  hour: number
  hovering: boolean
  dragging: boolean
  thinking: boolean
  /**
   * What it is doing outside, when anything actually knows.
   *
   * Only ever supplied by something that has real weather -- the start page's widget has it, Student does not go
   * looking. With nothing supplied, Orbi moves the way it always does rather than guessing at a season.
   */
  weather?: 'rain' | 'clear' | 'snow' | null
}): OrbiMoment {
  if (context.dragging) return 'drag'
  if (context.thinking) return 'thinking'
  if (context.hovering) return 'hover'
  if (!context.session && context.idleMinutes > 20 && (context.hour >= 23 || context.hour < 5)) return 'sleep'
  if (!context.session && context.idleMinutes > 12) return 'sleep'
  /*
   * Weather, last of all and only when nothing else is going on.
   *
   * It changes how Orbi drifts and nothing else: no raindrops on the screen, no sun behind it. A companion that
   * re-themes itself with the forecast is a distraction, and the student is trying to work.
   */
  if (!context.session && context.weather === 'rain') return 'weather-rain'
  if (!context.session && context.weather === 'snow') return 'weather-snow'
  if (!context.session && context.weather === 'clear') return 'weather-clear'
  return 'idle'
}

/**
 * What should be playing.
 *
 * `asked` is what just happened, if anything. The rules, in order:
 *
 *   1. nothing asked for, and what is playing has finished -> the ambient animation;
 *   2. something of a *higher* priority asked for -> it cuts in at once;
 *   3. something of the *same* priority asked for -> it waits, unless what is playing says it may be cut short;
 *   4. something of a *lower* priority asked for -> it is dropped entirely, not queued.
 *
 * Rule 4 is deliberate. A queue of small animations played one after another is how a companion ends up still
 * reacting to something that happened a minute ago.
 */
export function nextAnimation(playing: Playing | null, asked: OrbiMoment | null, ambientNow: OrbiMoment, at: number): Playing {
  const finished = !playing || (playing.endsAt !== null && at >= playing.endsAt)
  const start = (moment: OrbiMoment): Playing => {
    const spec = ANIMATIONS[moment]
    return { moment, startedAt: at, endsAt: spec.duration === null ? null : at + spec.duration }
  }

  if (!asked) {
    if (finished) return playing?.moment === ambientNow && playing.endsAt === null ? playing : start(ambientNow)
    return playing
  }

  const want = ANIMATIONS[asked]
  if (finished) return start(asked)

  const held = ANIMATIONS[playing.moment]
  if (want.priority < held.priority) return start(asked)
  if (want.priority === held.priority && held.interruptible) return start(asked)
  // Lower priority while something is playing: dropped, not remembered.
  return playing
}

/** What the renderer needs, worked out from what is playing and what the student asked for. */
export interface AnimFrame {
  moment: OrbiMoment
  state: OrbiState
  ring: number
  float: number
  glow: number
  particles: boolean
  /** 0..1 through this animation. 0 for the ambient ones. */
  through: number
}

export function frame(playing: Playing, at: number, behaviour: OrbiBehaviour, lowPower: boolean, reducedMotion: boolean): AnimFrame {
  const spec = ANIMATIONS[playing.moment]
  /*
   * Movement is scaled rather than switched off.
   *
   * With less movement asked for, or with the machine under load, Orbi keeps its *state* -- the eyes, the glow, the
   * shape -- and loses only the motion. That is what keeps every state legible without animation, which is the
   * accessibility requirement and also what makes the low-power path safe to take at any moment.
   */
  const scale = reducedMotion || behaviour.animation === 'off' ? 0 : lowPower || behaviour.animation === 'reduced' ? 0.4 : 1
  const celebrating = spec.priority <= 1
  const allowed = behaviour.celebration === 'off' && celebrating ? 0 : behaviour.celebration === 'subtle' && celebrating ? 0.6 : 1
  return {
    moment: playing.moment,
    state: spec.state,
    ring: spec.ring * scale * allowed,
    float: spec.float * scale,
    glow: spec.glow,
    // Particles are the first thing to go: they are the most expensive and the least informative.
    particles: spec.particles && scale > 0.5 && allowed > 0.5 && !lowPower,
    through: spec.duration === null || playing.endsAt === null ? 0 : Math.min(1, (at - playing.startedAt) / spec.duration)
  }
}

// ---------------------------------------------------------------- the milestones, with names

/**
 * The stages of a session, named.
 *
 * "Next milestone: 60 minutes" is easier to hold on to than "57 minutes remaining", which is the whole point --
 * a long session becomes a handful of short ones. The names are the same whatever the length, so a student learns
 * them once.
 */
export const STAGES: readonly { at: number; name: string }[] = [
  { at: 0, name: 'Start' },
  { at: 0.22, name: 'Momentum' },
  { at: 0.45, name: 'Build' },
  { at: 0.66, name: 'Deep focus' },
  { at: 0.85, name: 'Final push' },
  { at: 1, name: 'Complete' }
]

export function stageNow(through: number): { name: string; next: { name: string; at: number } | null } {
  const value = Math.max(0, Math.min(1, through))
  let current = STAGES[0]
  for (const stage of STAGES) if (value >= stage.at) current = stage
  const next = STAGES.find((one) => one.at > value) ?? null
  return { name: current.name, next: next ? { name: next.name, at: next.at } : null }
}

// ---------------------------------------------------------------- about to beat something

export interface RecordWatch {
  /** What is about to be beaten, in the student's words. */
  what: string
  /** Seconds until it is. */
  inSeconds: number
  /** Set the moment it is beaten. */
  beaten: boolean
}

/**
 * Whether this session is about to beat a record, or just has.
 *
 * Only ever the student's own records, only when there is a record worth beating, and only within a few minutes of
 * it -- "six minutes from your longest session" is a reason to keep going, and the same sentence an hour early is
 * noise. Returns null the rest of the time, which is almost always.
 */
export function watchRecord(session: FocusSession | null, records: PersonalRecord, todaySeconds: number): RecordWatch | null {
  if (!session) return null
  const longest = records.longestSessionSeconds
  if (longest >= 600) {
    const gap = longest - session.focusedSeconds
    if (gap <= 0 && session.focusedSeconds - longest < 60) return { what: 'your longest session', inSeconds: 0, beaten: true }
    if (gap > 0 && gap <= 360) return { what: 'your longest session', inSeconds: Math.round(gap), beaten: false }
  }
  const bestDay = records.bestDaySeconds
  if (bestDay >= 1800) {
    const gap = bestDay - todaySeconds
    if (gap > 0 && gap <= 360) return { what: "your best day's total", inSeconds: Math.round(gap), beaten: false }
  }
  return null
}

// ---------------------------------------------------------------- Orbi growing up

/**
 * Orbi's appearance tiers.
 *
 * Cosmetic, and named for places rather than ranks -- "Scholar" describes Orbi, not the student. Nothing here
 * implies anybody is cleverer than anybody else, and nothing here is needed in order to study.
 */
export const TIERS: readonly { from: number; id: string; name: string; blurb: string }[] = [
  { from: 1, id: 'basic', name: 'Orbi', blurb: 'Where everybody starts.' },
  { from: 5, id: 'explorer', name: 'Explorer Orbi', blurb: 'A brighter ring, and a trail.' },
  { from: 10, id: 'scholar', name: 'Scholar Orbi', blurb: 'Quieter, steadier, a little studious.' },
  { from: 20, id: 'astral', name: 'Astral Orbi', blurb: 'Stars in the ring.' },
  { from: 30, id: 'quantum', name: 'Quantum Orbi', blurb: 'The ring splits as it turns.' },
  { from: 50, id: 'orbit-master', name: 'Orbit Master', blurb: 'Three rings, slowly.' }
]

export function tierFor(level: number): (typeof TIERS)[number] {
  let found = TIERS[0]
  for (const tier of TIERS) if (level >= tier.from) found = tier
  return found
}

export function nextTier(level: number): (typeof TIERS)[number] | null {
  return TIERS.find((one) => one.from > level) ?? null
}

// ---------------------------------------------------------------- the constellation

export interface Star {
  id: string
  label: string
  /** 'lit' when the thing it stands for is finished. */
  lit: boolean
  /** Where it sits, as a fraction of the box. Worked out from the id so it never moves between renders. */
  x: number
  y: number
  /** The star it hangs from, when it has one. */
  parent: string | null
  kind: 'goal' | 'milestone' | 'subject'
}

/** A number from a string, so a star's place is stable without being stored. */
function spread(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 10_000
  return hash / 10_000
}

/**
 * The student's progress as a sky.
 *
 * Every goal is a star and every milestone a smaller one beside it; subjects with real time against them get their
 * own. A star is lit only when the thing it stands for is actually finished -- the sky is a picture of completed
 * work, and a sky full of unlit stars for things merely begun would be a picture of nothing.
 */
export function constellation(
  goals: readonly { id: string; title: string; state: string; milestones: readonly { id: string; title: string; completedAt: number | null }[] }[],
  subjects: readonly { subject: string; focusedSeconds: number }[]
): Star[] {
  const out: Star[] = []
  const count = Math.max(1, goals.length)
  goals.forEach((goal, index) => {
    // Goals sit around a circle, so the picture reads as a sky rather than a list.
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2
    const x = 0.5 + Math.cos(angle) * 0.3
    const y = 0.5 + Math.sin(angle) * 0.28
    out.push({ id: `goal:${goal.id}`, label: goal.title, lit: goal.state === 'completed', x, y, parent: null, kind: 'goal' })
    goal.milestones.forEach((one, i) => {
      const spin = angle + (i - (goal.milestones.length - 1) / 2) * 0.42
      out.push({
        id: `milestone:${one.id}`,
        label: one.title,
        lit: one.completedAt !== null,
        x: Math.max(0.04, Math.min(0.96, x + Math.cos(spin) * 0.13)),
        y: Math.max(0.06, Math.min(0.94, y + Math.sin(spin) * 0.12)),
        parent: `goal:${goal.id}`,
        kind: 'milestone'
      })
    })
  })
  for (const one of subjects) {
    if (one.focusedSeconds < 1800) continue
    out.push({
      id: `subject:${one.subject}`,
      label: one.subject,
      lit: one.focusedSeconds >= 10 * 3600,
      x: 0.08 + spread(one.subject) * 0.84,
      y: 0.08 + spread(`${one.subject}y`) * 0.84,
      parent: null,
      kind: 'subject'
    })
  }
  return out
}

/** How much of the sky is lit, for a one-line summary. */
export function skyProgress(stars: readonly Star[]): { lit: number; total: number } {
  return { lit: stars.filter((one) => one.lit).length, total: stars.length }
}

// ---------------------------------------------------------------- one more minute

/**
 * Whether "one more minute" should be offered, and whether it may pay anything.
 *
 * Offered only right at the end, and paid at most a few times a day -- it is a nudge over the finish line, and a
 * nudge that can be taken forty times is a way of farming XP rather than a nudge.
 */
export const EXTRA_MINUTE_XP = 5
export const EXTRA_MINUTES_A_DAY = 3

export function offerExtraMinute(session: FocusSession | null, usedToday: number): boolean {
  if (!session || session.state !== 'active') return false
  const left = session.plannedMinutes * 60 - session.focusedSeconds
  return left > 0 && left <= 90 && usedToday < EXTRA_MINUTES_A_DAY
}
