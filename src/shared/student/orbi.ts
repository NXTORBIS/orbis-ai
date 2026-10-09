import type { CoachMessage, FocusSession, MotivationEvent, OrbiBehaviour, OrbiPersonality, OrbiProfile, OrbiState, SessionState } from './types.ts'

/**
 * Orbi: the companion, and the rule that keeps it bearable.
 *
 * Two separate things live here. **Orbi's state** is what it looks like, and it is one state at a time rather than a
 * handful of booleans that can contradict each other -- celebrating and asleep cannot both be true. **The coach** is
 * what it says, and the important part of it is everything it refuses to say.
 *
 * ## Silence is the feature
 *
 * A companion that comments on everything is a companion people turn off, and a student who turns Orbi off loses the
 * part that actually helps. So the coach is rate-limited by design, not as an afterthought:
 *
 *   - nothing while somebody is typing, reading, mid-quiz or waiting on Orion;
 *   - never the same message twice within its own cooldown;
 *   - a cap per session, so a long session does not mean a long conversation;
 *   - priorities, so when something must be said the generic encouragement is the thing that gets dropped.
 *
 * Nothing in here guilts, shames or presses. "You can save that for later" is the strongest thing Orbi says when a
 * student reaches for a distraction, and there is deliberately no message anywhere about a streak being lost.
 *
 * Pure: the caller hands in the time and what is happening.
 */

export function defaultBehaviour(): OrbiBehaviour {
  return {
    enabled: true,
    visibility: 'full',
    personality: 'cute',
    messages: 'normal',
    animation: 'full',
    voice: 'off',
    celebration: 'subtle',
    size: 'medium',
    position: 'bottom-right'
  }
}

export function newOrbi(profileId: string, at: number): OrbiProfile {
  return { profileId, name: 'Orbi', level: 1, behaviour: defaultBehaviour(), unlocked: [], worn: [], room: [], updatedAt: at }
}

// ---------------------------------------------------------------- what Orbi looks like

export interface OrbiContext {
  session: FocusSession | null
  sessionState: SessionState | null
  /** Set for one moment after something happened, which is what makes Orbi react rather than just sit there. */
  moment: 'celebrating' | 'level-up' | 'achievement' | 'distraction' | 'thinking' | 'listening' | 'explaining' | null
  /** Whether Orion or the network is unavailable. */
  offline: boolean
  broken: boolean
  /** Local hour, for the small hours. */
  hour: number
  /** Whether the student has been idle a while with nothing running. */
  idleMinutes: number
}

/**
 * Orbi's one current state.
 *
 * Order matters: a fault outranks a mood, a moment outranks a session, and a session outranks being bored. Written as
 * a single ordered read rather than as nested conditions so that adding a state cannot accidentally hide another one.
 */
export function orbiState(context: OrbiContext): OrbiState {
  if (context.broken) return 'error'
  if (context.offline) return 'offline'
  if (context.moment === 'level-up') return 'level-up'
  if (context.moment === 'achievement') return 'achievement'
  if (context.moment === 'celebrating') return 'celebrating'
  if (context.moment === 'distraction') return 'distraction-warning'
  if (context.moment === 'thinking') return 'thinking'
  if (context.moment === 'listening') return 'listening'
  if (context.moment === 'explaining') return 'explaining'

  const state = context.sessionState
  if (state === 'break') return 'break'
  if (state === 'recovering' || state === 'interrupted') return 'recovery'
  if (state === 'active' || state === 'restored') return context.session?.policy.locked ? 'focus-locked' : 'focused'
  if (state === 'paused') return 'ready'

  if (context.idleMinutes > 20 && (context.hour >= 23 || context.hour < 5)) return 'sleeping'
  if (context.idleMinutes > 10) return 'idle'
  return 'ready'
}

/** How hard Orbi's animation should work, so a companion never costs a student their battery. */
export function animationFor(behaviour: OrbiBehaviour, state: OrbiState, reducedMotion: boolean): 'off' | 'simple' | 'full' {
  if (reducedMotion || behaviour.animation === 'off') return 'off'
  if (behaviour.animation === 'reduced') return 'simple'
  if (state === 'sleeping' || state === 'idle') return 'simple'
  return 'full'
}

// ---------------------------------------------------------------- what Orbi says

/**
 * The message library, kept as content rather than inside components.
 *
 * Five voices for each event. Not variations on a theme for their own sake -- a student who picked "minimal" and a
 * student who picked "playful" want genuinely different things, and the difference between them is mostly how little
 * is said.
 */
/**
 * How Orbi sounds, by voice.
 *
 * Five voices, not nine styles. A style is how Orbi *looks and moves*; a voice is how it *speaks*, and the two
 * are deliberately different lists because "futuristic" and "cute" have no business being different sentences —
 * they would only ever be the same words with different punctuation. `voiceFor` maps every style to one of these.
 */
export type OrbiVoice = 'calm' | 'energetic' | 'academic' | 'playful' | 'minimal'

/** Which voice a style speaks in. Every personality ever stored resolves here, including the older ones. */
export function voiceFor(personality: OrbiPersonality): OrbiVoice {
  switch (personality) {
    case 'cute':
    case 'playful':
      return 'playful'
    case 'competitive':
    case 'energetic':
      return 'energetic'
    case 'academic':
      return 'academic'
    case 'minimal':
    case 'mature':
      return 'minimal'
    case 'futuristic':
    case 'calm':
    default:
      return 'calm'
  }
}

const LINES: Record<MotivationEvent, Record<OrbiVoice, string>> = {
  'session-started': {
    calm: "Ready when you are. Let's get this one done.",
    energetic: "Here we go. Let's make this one count.",
    academic: 'Session started. Your task is on screen.',
    playful: 'Right then. Clock is running.',
    minimal: 'Started.'
  },
  'first-milestone': {
    calm: "You're in the zone.",
    energetic: "Nice. You're moving.",
    academic: 'A quarter of the way through.',
    playful: 'Off to a flying start.',
    minimal: '25%.'
  },
  'half-way': {
    calm: 'Halfway there.',
    energetic: 'Halfway. Keep going.',
    academic: 'Half the planned time is done.',
    playful: 'Downhill from here.',
    minimal: 'Halfway.'
  },
  'final-stretch': {
    calm: 'Final stretch.',
    energetic: 'Last push.',
    academic: 'Ten per cent remaining.',
    playful: 'Nearly done. Do not look away now.',
    minimal: 'Nearly there.'
  },
  'distraction-attempt': {
    calm: 'You can save that for later.',
    energetic: 'Later. Back to it.',
    academic: 'That is outside this session. It can be saved.',
    playful: 'It will still be there afterwards.',
    minimal: 'Saved for later?'
  },
  'session-complete': {
    calm: 'You did it.',
    energetic: 'Done. That was a good one.',
    academic: 'Session complete.',
    playful: 'And that is that.',
    minimal: 'Done.'
  },
  'break-started': {
    calm: 'Take the break properly. Stand up.',
    energetic: 'Break time. Move about.',
    academic: 'Break started.',
    playful: 'Go and look at something further than a screen.',
    minimal: 'Break.'
  },
  'break-over': {
    calm: 'Ready?',
    energetic: "Back to it when you're ready.",
    academic: 'The break is over.',
    playful: 'Round two?',
    minimal: 'Ready?'
  },
  comeback: {
    // Never "you lost your streak". This is the message that decides whether somebody comes back twice.
    calm: "Welcome back. Let's start small.",
    energetic: 'Good to see you. Ten minutes?',
    academic: 'Welcome back. Your last task is still here.',
    playful: 'There you are. Shall we start gently?',
    minimal: 'Welcome back.'
  },
  'goal-complete': {
    calm: 'Another goal checked off.',
    energetic: 'Goal done. That is a big one.',
    academic: 'Goal complete.',
    playful: 'One fewer thing hanging over you.',
    minimal: 'Goal done.'
  },
  'task-complete': {
    calm: 'Task done.',
    energetic: 'Tick.',
    academic: 'Task marked complete.',
    playful: 'Gone.',
    minimal: 'Done.'
  },
  'level-up': {
    calm: 'Level up.',
    energetic: 'Level up. Something new is unlocked.',
    academic: 'You have reached a new level.',
    playful: 'Level up. Orbi approves.',
    minimal: 'Level up.'
  },
  achievement: {
    calm: 'That is a milestone.',
    energetic: 'Achievement unlocked.',
    academic: 'Achievement recorded.',
    playful: 'Shiny new badge.',
    minimal: 'Achievement.'
  },
  'losing-focus': {
    calm: "That happens. Pick one small thing and start there.",
    energetic: 'Shake it off. One small step.',
    academic: 'Reduce the task. What is the smallest next step?',
    playful: 'Brains wander. Mine does too.',
    minimal: 'One small step.'
  },
  'rest-day': {
    calm: 'Resting counts. Ready when you are.',
    energetic: 'Rest up. Tomorrow then.',
    academic: 'Marked as a rest day.',
    playful: 'Even Orbi sleeps.',
    minimal: 'Rest day.'
  }
}

const PRIORITY: Record<MotivationEvent, CoachMessage['priority']> = {
  'distraction-attempt': 'high',
  'session-complete': 'high',
  'goal-complete': 'high',
  'level-up': 'high',
  achievement: 'high',
  comeback: 'high',
  'losing-focus': 'high',
  'break-started': 'medium',
  'break-over': 'medium',
  'half-way': 'medium',
  'first-milestone': 'medium',
  'final-stretch': 'medium',
  'task-complete': 'medium',
  'session-started': 'low',
  'rest-day': 'low'
}

const STATE_FOR: Record<MotivationEvent, OrbiState> = {
  'session-started': 'focused',
  'first-milestone': 'encouraging',
  'half-way': 'encouraging',
  'final-stretch': 'encouraging',
  'distraction-attempt': 'distraction-warning',
  'session-complete': 'celebrating',
  'break-started': 'break',
  'break-over': 'ready',
  comeback: 'recovery',
  'goal-complete': 'celebrating',
  'task-complete': 'encouraging',
  'level-up': 'level-up',
  achievement: 'achievement',
  'losing-focus': 'curious',
  'rest-day': 'idle'
}

/** How long before the same event may be said again, in milliseconds. */
const COOLDOWN: Record<CoachMessage['priority'], number> = { high: 60_000, medium: 10 * 60_000, low: 30 * 60_000 }

/** The most Orbi will say in one session, whatever happens. */
const CAP: Record<OrbiBehaviour['messages'], number> = { off: 0, rare: 3, normal: 8 }

export interface CoachState {
  /** When each event was last said. */
  said: Readonly<Record<string, number>>
  /** How many messages this session has had. */
  count: number
  sessionId: string | null
}

export function newCoachState(): CoachState {
  return { said: {}, count: 0, sessionId: null }
}

export interface CoachNow {
  /** What the student is doing right now. Each of these is a reason to stay quiet. */
  typing: boolean
  reading: boolean
  quizzing: boolean
  waitingOnOrion: boolean
  /** A deep session with messages turned down: Orbi is present and silent. */
  behaviour: OrbiBehaviour
  sessionId: string | null
}

export interface CoachOutcome {
  message: CoachMessage | null
  state: CoachState
  /** Why nothing was said, for the developer panel. Never shown to a student. */
  why: string | null
}

/**
 * Whether Orbi says something, and what.
 *
 * Returns the new coach state alongside the message, so the cooldowns live with whoever is driving rather than in a
 * module-level variable that two surfaces could disagree about.
 */
export function coach(event: MotivationEvent, now: CoachNow, state: CoachState, at: number): CoachOutcome {
  const fresh = state.sessionId === now.sessionId ? state : { said: state.said, count: 0, sessionId: now.sessionId }
  const nothing = (why: string): CoachOutcome => ({ message: null, state: fresh, why })

  if (!now.behaviour.enabled) return nothing('Orbi is off')
  if (now.behaviour.messages === 'off') return nothing('messages are off')
  const priority = PRIORITY[event]

  // The interruption rules. A high-priority message still waits for somebody who is typing -- there is no message
  // worth making a student lose a sentence over.
  if (now.typing) return nothing('typing')
  if (now.waitingOnOrion) return nothing('waiting on Orion')
  if (now.quizzing && priority !== 'high') return nothing('mid-quiz')
  if (now.reading && priority === 'low') return nothing('reading')
  if (now.behaviour.messages === 'rare' && priority === 'low') return nothing('set to rare')

  const last = fresh.said[event] ?? 0
  if (at - last < COOLDOWN[priority]) return nothing('said recently')
  if (fresh.count >= CAP[now.behaviour.messages] && priority !== 'high') return nothing('enough for one session')

  return {
    message: { event, text: LINES[event][voiceFor(now.behaviour.personality)], orbi: STATE_FOR[event], priority },
    state: { said: { ...fresh.said, [event]: at }, count: fresh.count + 1, sessionId: now.sessionId },
    why: null
  }
}

/** The line for an event, with no rate limiting, for somewhere that asked for it directly. */
export function line(event: MotivationEvent, personality: OrbiPersonality): string {
  return LINES[event][voiceFor(personality)]
}

// ---------------------------------------------------------------- growing up

/**
 * What Orbi unlocks, and when.
 *
 * All of it cosmetic. Nothing a student needs in order to study is behind a level, which is the line between a
 * companion and a game that wants their time: the timer, the blocking, Orion and the learning all work at level one.
 */
export interface Cosmetic {
  id: string
  label: string
  kind: 'orbi' | 'accessory' | 'room' | 'atmosphere' | 'theme' | 'animation'
  /** The level it arrives at, when it arrives by level rather than by achievement. */
  level: number | null
}

export const COSMETICS: readonly Cosmetic[] = [
  { id: 'orbi-glow', label: 'Soft glow', kind: 'orbi', level: null },
  { id: 'orbi-headphones', label: 'Headphones', kind: 'accessory', level: 3 },
  { id: 'orbi-glasses', label: 'Glasses', kind: 'accessory', level: null },
  { id: 'orbi-backpack', label: 'Backpack', kind: 'accessory', level: null },
  { id: 'orbi-hoodie', label: 'Hoodie', kind: 'accessory', level: null },
  { id: 'orbi-labcoat', label: 'Lab coat', kind: 'accessory', level: 12 },
  { id: 'orbi-cap', label: 'Graduation cap', kind: 'accessory', level: null },
  { id: 'orbi-tablet', label: 'Study tablet', kind: 'accessory', level: null },
  { id: 'room-books', label: 'A few books', kind: 'room', level: null },
  { id: 'room-bookshelf', label: 'Bookshelf', kind: 'room', level: null },
  { id: 'room-plant', label: 'Plant', kind: 'room', level: null },
  { id: 'room-telescope', label: 'Telescope', kind: 'room', level: null },
  { id: 'room-monitor', label: 'Monitor', kind: 'room', level: null },
  { id: 'room-science', label: 'Science equipment', kind: 'room', level: null },
  { id: 'room-art', label: 'Something on the wall', kind: 'room', level: null },
  { id: 'room-certificate', label: 'Certificate', kind: 'room', level: null },
  { id: 'room-constellation', label: 'Constellation wall', kind: 'room', level: null },
  { id: 'room-lamp', label: 'Warm lamp', kind: 'room', level: 5 },
  { id: 'room-desk-tidy', label: 'Tidy desk', kind: 'room', level: 2 },
  { id: 'atmosphere-deep-space', label: 'Deep Space', kind: 'atmosphere', level: 7 },
  { id: 'animation-orbit', label: 'Orbital spin', kind: 'animation', level: 9 },
  { id: 'theme-night', label: 'Night Study', kind: 'theme', level: 4 }
]

export function cosmeticById(id: string): Cosmetic | null {
  return COSMETICS.find((one) => one.id === id) ?? null
}

/** What a level brings with it. */
export function unlocksAtLevel(level: number): Cosmetic[] {
  return COSMETICS.filter((one) => one.level === level)
}

/** Orbi's level follows the student's, because it is their progress and not a second currency. */
export function orbiLevelFor(studentLevel: number): number {
  return Math.max(1, Math.min(studentLevel, 100))
}

/** Everything unlocked by a level and a set of achievements, with no duplicates. */
export function unlockedFor(level: number, fromAchievements: readonly string[]): string[] {
  const byLevel = COSMETICS.filter((one) => one.level !== null && one.level <= level).map((one) => one.id)
  return [...new Set([...byLevel, ...fromAchievements])]
}
