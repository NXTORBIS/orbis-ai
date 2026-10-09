import { defaultVolumes, clampVolumes } from './atmosphere.ts'
import { DEFAULT_BREAKS } from './focus.ts'
import { defaultBehaviour } from './orbi.ts'
import type { BreakPlan, ContentCategory, Difficulty, FocusLevel, OrbiBehaviour, StudentPreferences } from './types.ts'

/**
 * What a student's settings are before they change anything, and how whatever is on disk is read back.
 *
 * Reading is deliberately forgiving about shape and strict about values: an unknown field is dropped, a number out of
 * range is pulled back into range, and a missing field takes its default. Nothing here throws, because a settings
 * file that cannot be read must not be the thing that stops somebody studying -- and nothing here quietly widens a
 * safety setting either, which is why `safetyOverride` falls back to `age` rather than to `off`.
 */

export const WIDGETS: readonly { id: string; label: string; blurb: string }[] = [
  { id: 'today', label: "Today's Orbit", blurb: 'Your goal, your target and where you are.' },
  { id: 'focus', label: 'Focus', blurb: 'Start a session, or carry one on.' },
  { id: 'quests', label: 'Daily Quests', blurb: "Today's small challenges." },
  { id: 'word', label: 'Word of the Day', blurb: 'One word, every day.' },
  { id: 'learning', label: 'Learning', blurb: 'Something to read or try.' },
  { id: 'goals', label: 'Active Goals', blurb: 'What you are working toward.' },
  { id: 'tasks', label: 'Upcoming Tasks', blurb: 'What is next and what is due.' },
  { id: 'continue', label: 'Continue Studying', blurb: 'Pick up where you stopped.' },
  { id: 'review', label: 'Review Today', blurb: 'What is due to come back.' },
  { id: 'wins', label: 'Recent Wins', blurb: 'What went well lately.' },
  { id: 'streak', label: 'Streak', blurb: 'Days in a row.' },
  { id: 'record', label: 'Personal Record', blurb: 'Your own bests.' },
  { id: 'subjects', label: 'Subject Progress', blurb: 'Where your time went.' },
  { id: 'later', label: 'Saved for Later', blurb: 'What you put off during Focus.' },
  { id: 'music', label: 'Music', blurb: 'What is playing.' },
  { id: 'atmosphere', label: 'Atmosphere', blurb: 'Sound and surroundings.' },
  { id: 'orbi', label: 'Orbi', blurb: 'Your companion.' },
  { id: 'insights', label: 'Insights', blurb: 'What you actually did.' },
  { id: 'orion', label: 'Orion', blurb: 'Ask for help.' }
]

/** The order the dashboard starts in. Not changed unless the student changes it. */
export const DEFAULT_WIDGETS: readonly string[] = ['today', 'focus', 'quests', 'tasks', 'goals', 'word', 'review', 'streak', 'subjects', 'orbi']

export function defaultPreferences(at: number): StudentPreferences {
  return {
    name: '',
    dob: null,
    learning: [],
    workingToward: [],
    focusStyle: 'unsure',
    atmosphere: 'minimal',
    onboarded: false,
    onboardedAt: null,
    tourAt: null,
    tourDone: false,
    why: '',

    defaultMinutes: 45,
    defaultLevel: 'focus',
    defaultAtmosphere: null,
    defaultPlaylistId: null,
    defaultBreaks: DEFAULT_BREAKS,
    exitConfirmation: true,
    blockedCategories: ['social', 'entertainment', 'streaming', 'gaming', 'shopping'],
    approvedSites: [],
    blockedSites: [],
    youtube: 'educational',

    orbi: defaultBehaviour(),
    orbiAt: null,
    motivationStyle: 'calm',

    difficulty: 'intermediate',
    learningReminders: true,

    musicOnFocus: 'suggest',
    volumes: defaultVolumes(),

    notifications: 'important',
    briefingMorning: false,
    briefingEvening: false,
    quietHours: { from: 22, to: 7 },
    weatherCity: null,
    quietUntil: null,

    reducedMotion: false,
    reducedTransparency: false,
    highContrast: false,
    largerText: false,
    density: 'standard',

    widgets: [...DEFAULT_WIDGETS],
    hiddenWidgets: [],

    safetyOverride: 'age',
    updatedAt: at
  }
}

const CATEGORIES: readonly ContentCategory[] = [
  'education',
  'reference',
  'productivity',
  'communication',
  'social',
  'entertainment',
  'streaming',
  'gaming',
  'gambling',
  'adult',
  'dating',
  'shopping',
  'news',
  'unsafe',
  'violent',
  'unknown'
]

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

/**
 * Quiet hours, read back without letting a bad file silence Orbi for ever or wake it in the middle of the night.
 *
 * `null` is a real answer and means there are none. A range where both ends are the same hour would mean nothing at
 * all, so it reads as none rather than as a whole silent day.
 */
const readQuietHours = (value: unknown, fallback: { from: number; to: number } | null): { from: number; to: number } | null => {
  if (value === null) return null
  if (!value || typeof value !== 'object') return fallback
  const held = value as Record<string, unknown>
  const hour = (one: unknown): number | null => (typeof one === 'number' && Number.isFinite(one) ? Math.max(0, Math.min(23, Math.round(one))) : null)
  const from = hour(held.from)
  const to = hour(held.to)
  if (from === null || to === null || from === to) return fallback
  return { from, to }
}
const whole = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback
const words = (value: unknown, limit = 40, each = 80): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((one): one is string => typeof one === 'string').map((one) => one.trim().slice(0, each)).filter(Boolean))].slice(0, limit) : []
const text = (value: unknown, limit: number, fallback = ''): string => (typeof value === 'string' ? value.trim().slice(0, limit) : fallback)

function readBreaks(raw: unknown, fallback: BreakPlan): BreakPlan {
  if (!raw || typeof raw !== 'object') return fallback
  const one = raw as Record<string, unknown>
  return {
    focusMinutes: whole(one.focusMinutes, 0, 180, fallback.focusMinutes),
    breakMinutes: whole(one.breakMinutes, 0, 60, fallback.breakMinutes),
    blocks: whole(one.blocks, 1, 12, fallback.blocks),
    autoResume: flag(one.autoResume, fallback.autoResume)
  }
}

function readOrbi(raw: unknown, fallback: OrbiBehaviour): OrbiBehaviour {
  if (!raw || typeof raw !== 'object') return fallback
  const one = raw as Record<string, unknown>
  return {
    enabled: flag(one.enabled, fallback.enabled),
    visibility: pick(one.visibility, ['full', 'compact', 'minimal', 'hidden'] as const, fallback.visibility),
    personality: pick(one.personality, ['cute', 'minimal', 'futuristic', 'academic', 'competitive', 'mature', 'calm', 'energetic', 'playful'] as const, fallback.personality),
    messages: pick(one.messages, ['off', 'rare', 'normal'] as const, fallback.messages),
    animation: pick(one.animation, ['full', 'reduced', 'off'] as const, fallback.animation),
    voice: pick(one.voice, ['off', 'minimal', 'normal'] as const, fallback.voice),
    celebration: pick(one.celebration, ['off', 'subtle', 'full'] as const, fallback.celebration),
    size: pick(one.size, ['small', 'medium', 'large'] as const, fallback.size),
    position: pick(one.position, ['bottom-right', 'bottom-left', 'top-right', 'top-left'] as const, fallback.position)
  }
}

/** A place in the window, only if both parts are inside it. Anything else puts Orbi back in its corner. */
function readSpot(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const held = value as Record<string, unknown>
  if (typeof held.x !== 'number' || typeof held.y !== 'number' || !Number.isFinite(held.x) || !Number.isFinite(held.y)) return null
  return { x: Math.max(0.03, Math.min(0.97, held.x)), y: Math.max(0.08, Math.min(0.95, held.y)) }
}

/** A date of birth only if it reads as one. Anything else becomes "not set", which has its own safety policy. */
function readDob(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

export function readPreferences(raw: unknown, at: number): StudentPreferences {
  const base = defaultPreferences(at)
  if (!raw || typeof raw !== 'object') return base
  const one = raw as Record<string, unknown>
  const widgets = words(one.widgets, 40, 40).filter((id) => WIDGETS.some((w) => w.id === id))
  return {
    name: text(one.name, 60),
    dob: readDob(one.dob),
    learning: words(one.learning, 12),
    workingToward: words(one.workingToward, 12),
    focusStyle: pick(one.focusStyle, ['short', 'pomodoro', 'long', 'deep', 'flexible', 'unsure'] as const, base.focusStyle),
    atmosphere: text(one.atmosphere, 40, base.atmosphere) || base.atmosphere,
    onboarded: flag(one.onboarded, false),
    onboardedAt: typeof one.onboardedAt === 'number' && Number.isFinite(one.onboardedAt) ? one.onboardedAt : null,
    // A step id that no longer exists reads as null, which starts the tour from the beginning rather than nowhere.
    tourAt: typeof one.tourAt === 'string' && one.tourAt.length > 0 && one.tourAt.length <= 40 ? one.tourAt : null,
    tourDone: flag(one.tourDone, false),
    why: text(one.why, 300),

    defaultMinutes: whole(one.defaultMinutes, 5, 300, base.defaultMinutes),
    defaultLevel: pick(one.defaultLevel, ['light', 'focus', 'deep'] as const satisfies readonly FocusLevel[], base.defaultLevel),
    defaultAtmosphere: typeof one.defaultAtmosphere === 'string' ? one.defaultAtmosphere.slice(0, 40) : null,
    defaultPlaylistId: typeof one.defaultPlaylistId === 'string' ? one.defaultPlaylistId.slice(0, 80) : null,
    defaultBreaks: readBreaks(one.defaultBreaks, base.defaultBreaks),
    exitConfirmation: flag(one.exitConfirmation, base.exitConfirmation),
    blockedCategories: words(one.blockedCategories, 20, 20).filter((c): c is ContentCategory => (CATEGORIES as readonly string[]).includes(c)),
    approvedSites: words(one.approvedSites, 400, 300),
    blockedSites: words(one.blockedSites, 400, 300),
    youtube: pick(one.youtube, ['blocked', 'educational', 'approved-only', 'open'] as const, base.youtube),

    orbi: readOrbi(one.orbi, base.orbi),
    orbiAt: readSpot(one.orbiAt),
    motivationStyle: pick(one.motivationStyle, ['calm', 'goal', 'energetic', 'academic', 'self-competition', 'minimal'] as const, base.motivationStyle),

    difficulty: pick(one.difficulty, ['beginner', 'intermediate', 'advanced'] as const satisfies readonly Difficulty[], base.difficulty),
    learningReminders: flag(one.learningReminders, base.learningReminders),

    musicOnFocus: pick(one.musicOnFocus, ['off', 'suggest', 'auto'] as const, base.musicOnFocus),
    volumes: clampVolumes(one.volumes as never, base.volumes),

    notifications: pick(one.notifications, ['all', 'important', 'focus', 'off'] as const, base.notifications),
    briefingMorning: flag(one.briefingMorning, base.briefingMorning),
    briefingEvening: flag(one.briefingEvening, base.briefingEvening),
    quietHours: readQuietHours(one.quietHours, base.quietHours),
    weatherCity: typeof one.weatherCity === 'string' && one.weatherCity.trim() ? one.weatherCity.trim().slice(0, 80) : base.weatherCity,
    // A time in the past is simply over, so it reads as nothing rather than as a muted companion.
    quietUntil: typeof one.quietUntil === 'number' && Number.isFinite(one.quietUntil) && one.quietUntil > 0 ? Math.round(one.quietUntil) : base.quietUntil,

    reducedMotion: flag(one.reducedMotion, base.reducedMotion),
    reducedTransparency: flag(one.reducedTransparency, base.reducedTransparency),
    highContrast: flag(one.highContrast, base.highContrast),
    largerText: flag(one.largerText, base.largerText),
    density: pick(one.density, ['calm', 'standard', 'dense'] as const, base.density),

    widgets: widgets.length > 0 ? widgets : base.widgets,
    hiddenWidgets: words(one.hiddenWidgets, 40, 40).filter((id) => WIDGETS.some((w) => w.id === id)),

    // Never widened by a bad read: a file that cannot be understood falls back to following the age, not to off.
    safetyOverride: pick(one.safetyOverride, ['age', 'strict', 'off'] as const, 'age'),
    updatedAt: typeof one.updatedAt === 'number' && Number.isFinite(one.updatedAt) ? one.updatedAt : at
  }
}

/** A patch applied over what is held, read through the same rules so a bad value cannot get in by the side door. */
export function patchPreferences(held: StudentPreferences, patch: unknown, at: number): StudentPreferences {
  if (!patch || typeof patch !== 'object') return held
  return { ...readPreferences({ ...held, ...(patch as Record<string, unknown>) }, at), updatedAt: at }
}

/** What the onboarding collected, which is a much smaller thing than the whole of Settings. */
export interface Onboarding {
  name: string
  dob: string | null
  learning: readonly string[]
  workingToward: readonly string[]
  focusStyle: StudentPreferences['focusStyle']
  atmosphere: string
}

export function applyOnboarding(held: StudentPreferences, answers: Onboarding, at: number): StudentPreferences {
  const style = answers.focusStyle
  // What they said about how they like to work becomes a real default, not a stored answer nothing reads.
  const minutes = style === 'short' ? 25 : style === 'pomodoro' ? 25 : style === 'long' ? 75 : style === 'deep' ? 50 : held.defaultMinutes
  const breaks = style === 'pomodoro' ? { focusMinutes: 25, breakMinutes: 5, blocks: 4, autoResume: true } : style === 'deep' ? { focusMinutes: 50, breakMinutes: 10, blocks: 2, autoResume: true } : held.defaultBreaks
  return patchPreferences(
    held,
    {
      name: answers.name,
      dob: answers.dob,
      learning: answers.learning,
      workingToward: answers.workingToward,
      focusStyle: style,
      atmosphere: answers.atmosphere,
      defaultMinutes: minutes,
      defaultBreaks: breaks,
      defaultLevel: style === 'deep' ? 'deep' : held.defaultLevel,
      defaultAtmosphere: answers.atmosphere === 'minimal' ? null : answers.atmosphere,
      onboarded: true,
      onboardedAt: at
    },
    at
  )
}

/** The reset scopes a student can ask for, each one exactly what it says. */
export type ResetScope = 'xp' | 'achievements' | 'goals' | 'learning' | 'focus-history' | 'orbi' | 'distractions' | 'everything'

export const RESET_SCOPES: readonly { id: ResetScope; label: string; blurb: string }[] = [
  { id: 'xp', label: 'XP and levels', blurb: 'Your XP history and level go back to the start. Sessions and goals stay.' },
  { id: 'achievements', label: 'Achievements', blurb: 'Unlocked achievements are cleared. They can be earned again.' },
  { id: 'goals', label: 'Goals and tasks', blurb: 'Every goal, milestone and task is removed.' },
  { id: 'learning', label: 'Learning history', blurb: 'What you have seen, reviewed and answered.' },
  { id: 'focus-history', label: 'Focus history', blurb: 'Past sessions, records and insights. Capsules and spaces stay.' },
  { id: 'orbi', label: 'Orbi', blurb: 'Orbi goes back to how it started, keeping nothing unlocked.' },
  { id: 'distractions', label: 'Saved for later', blurb: 'Everything in the later queue and every captured thought.' },
  { id: 'everything', label: 'Everything in Orbis Student', blurb: 'All Student data for this profile. Your browser, history and Orbis settings are untouched.' }
]
