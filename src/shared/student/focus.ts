import type { BreakPlan, ContentCategory, FocusLevel, FocusPolicy, SafetyVerdict } from './types.ts'
import { CATEGORY_LABELS, canonical, categorise, checkSafety, hostOf, listed, type SafetyConfig, youtubeRef } from './safety.ts'

/**
 * Orbis Focus: whether something is a distraction from the task in front of somebody right now.
 *
 * Separate from safety on purpose. YouTube is safe for a sixteen-year-old and still the thing that ends their study
 * session, and one video on it may be the whole reason they opened the browser. So a page gets two decisions, in a
 * fixed order:
 *
 *   1. is it appropriate?  -- safety. Always. If no, it is not reachable and focus never gets a say.
 *   2. is it a distraction? -- focus. Only while a session runs, and only against that session's own snapshot.
 *
 * The snapshot is the second thing that matters here. A policy is copied into the session when it starts, and nothing
 * that happens in Settings afterwards can weaken the session in progress. Without that, "block social media" is a
 * setting somebody turns off the moment it works.
 */

export const FOCUS_LEVELS: Record<FocusLevel, { label: string; blurb: string; blocked: readonly ContentCategory[]; enforce: 'warn' | 'block'; locked: boolean }> = {
  light: {
    label: 'Light',
    blurb: 'A timer and a gentle nudge. Nothing is blocked unless you ask for it.',
    blocked: [],
    enforce: 'warn',
    locked: false
  },
  focus: {
    label: 'Focus',
    blurb: 'Distracting categories are held back, and the Focus Shield offers to save them for later.',
    blocked: ['social', 'entertainment', 'streaming', 'gaming', 'shopping'],
    enforce: 'block',
    locked: false
  },
  deep: {
    label: 'Deep Focus',
    blurb: 'Only what you approved is reachable, the policy is locked for the session, and leaving takes a deliberate press.',
    blocked: ['social', 'entertainment', 'streaming', 'gaming', 'shopping', 'news', 'communication', 'unknown'],
    enforce: 'block',
    locked: true
  }
}

export const DEFAULT_BREAKS: BreakPlan = { focusMinutes: 0, breakMinutes: 0, blocks: 1, autoResume: false }

export const POMODORO: Record<string, { label: string; plan: BreakPlan; minutes: number }> = {
  classic: { label: 'Classic', plan: { focusMinutes: 25, breakMinutes: 5, blocks: 4, autoResume: true }, minutes: 25 },
  deep: { label: 'Deep study', plan: { focusMinutes: 50, breakMinutes: 10, blocks: 2, autoResume: true }, minutes: 50 },
  long: { label: 'Long study', plan: { focusMinutes: 90, breakMinutes: 15, blocks: 2, autoResume: false }, minutes: 90 },
  none: { label: 'No breaks', plan: DEFAULT_BREAKS, minutes: 45 }
}

/** One-press starts. Each is a real configuration, not a label. */
export const FOCUS_PRESETS: readonly { id: string; label: string; minutes: number; level: FocusLevel; breaks: BreakPlan; blurb: string }[] = [
  { id: 'quick', label: 'Quick Focus', minutes: 15, level: 'light', breaks: DEFAULT_BREAKS, blurb: 'Fifteen minutes to get going.' },
  { id: 'homework', label: 'Homework', minutes: 45, level: 'focus', breaks: DEFAULT_BREAKS, blurb: "Today's assigned work, with the usual distractions held back." },
  { id: 'revision', label: 'Revision', minutes: 25, level: 'focus', breaks: POMODORO.classic.plan, blurb: 'Short blocks with breaks, for going back over things.' },
  { id: 'deep', label: 'Deep Study', minutes: 50, level: 'deep', breaks: POMODORO.deep.plan, blurb: 'Fifty minutes, locked, approved resources only.' },
  { id: 'reading', label: 'Reading', minutes: 30, level: 'focus', breaks: DEFAULT_BREAKS, blurb: 'A quiet window for reading.' },
  { id: 'coding', label: 'Coding', minutes: 60, level: 'focus', breaks: DEFAULT_BREAKS, blurb: 'Documentation and your editor stay open.' },
  { id: 'exam', label: 'Exam Prep', minutes: 90, level: 'deep', breaks: POMODORO.long.plan, blurb: 'Long, strict, minimal.' },
  { id: 'research', label: 'Research', minutes: 60, level: 'focus', breaks: DEFAULT_BREAKS, blurb: 'The web stays open; the feeds do not.' },
  { id: 'sprint', label: 'Study Sprint', minutes: 10, level: 'light', breaks: DEFAULT_BREAKS, blurb: 'Ten minutes. Just start.' }
]

/** Resources every session can reach, because they are the tools rather than the web. */
const ALWAYS: readonly string[] = ['orbis:', 'chrome:', 'chrome-extension:', 'chrome-untrusted:', 'about:', 'file:', 'blob:', 'data:', 'devtools:']

export interface PolicyDraft {
  level: FocusLevel
  blocked?: readonly ContentCategory[]
  approved?: readonly string[]
  approvedCategories?: readonly ContentCategory[]
  blockedSites?: readonly string[]
  locked?: boolean
  youtube?: FocusPolicy['youtube']
  approvedVideos?: readonly string[]
  approvedChannels?: readonly string[]
  allowSaveForLater?: boolean
}

/**
 * The policy a session will run under, fixed at the moment it starts.
 *
 * Everything is defaulted from the level rather than left undefined, so a session can never run with "whatever the
 * settings happen to say later" -- which is the whole point of snapshotting it.
 */
export function snapshotPolicy(draft: PolicyDraft): FocusPolicy {
  const level = FOCUS_LEVELS[draft.level] ? draft.level : 'focus'
  const base = FOCUS_LEVELS[level]
  const approvedCategories: ContentCategory[] = [...new Set(draft.approvedCategories ?? (['education', 'reference', 'productivity'] as const))]
  // A category cannot be blocked and approved at once; being approved is the more specific decision, so it wins.
  const blocked = [...new Set(draft.blocked ?? base.blocked)].filter((one) => !approvedCategories.includes(one))
  return {
    level,
    blocked,
    approved: [...new Set([...(draft.approved ?? []).map((one) => one.trim().toLowerCase()).filter(Boolean)])].slice(0, 400),
    approvedCategories,
    blockedSites: [...new Set((draft.blockedSites ?? []).map((one) => one.trim().toLowerCase()).filter(Boolean))].slice(0, 400),
    locked: draft.locked ?? base.locked,
    enforce: base.enforce,
    allowSaveForLater: draft.allowSaveForLater ?? true,
    approvedVideos: [...new Set(draft.approvedVideos ?? [])].slice(0, 400),
    approvedChannels: [...new Set(draft.approvedChannels ?? [])].slice(0, 400),
    youtube: draft.youtube ?? (level === 'deep' ? 'approved-only' : 'educational')
  }
}

export interface FocusDecision {
  /** Whether the page may open. */
  allowed: boolean
  /** 'safety' means it would be blocked whether or not a session were running. */
  because: 'allowed' | 'safety' | 'focus' | 'site'
  category: ContentCategory
  /** One sentence for the shield. */
  reason: string
  /** Whether the shield may offer to save it for later. Never for something safety stopped. */
  saveable: boolean
  /** Whether this counts as a distraction attempt in the session's numbers. */
  counts: boolean
  /** Set when a warning rather than a block: the page opens and the student is told. */
  warn: boolean
}

/**
 * Whether a page may open, right now, for this person in this session.
 *
 * Order is load-bearing. Safety first, always, so a focus policy can never be the thing that lets an inappropriate
 * page through -- and so that Student mode cannot be used as a way around the profile's own protection.
 */
export function decide(url: string, options: { safety: SafetyConfig; policy: FocusPolicy | null; onBreak?: boolean }): FocusDecision {
  const address = url.trim()
  if (ALWAYS.some((one) => address.toLowerCase().startsWith(one))) {
    return { allowed: true, because: 'allowed', category: 'productivity', reason: 'This is part of Orbis.', saveable: false, counts: false, warn: false }
  }

  const safety: SafetyVerdict = checkSafety(address, options.safety)
  if (!safety.allowed) {
    return { allowed: false, because: 'safety', category: safety.category, reason: safety.reason, saveable: false, counts: false, warn: false }
  }

  const policy = options.policy
  // No session, or a break: the browser is a browser.
  if (!policy || options.onBreak) {
    return { allowed: true, because: 'allowed', category: safety.category, reason: safety.reason, saveable: false, counts: false, warn: false }
  }

  const category = safety.category

  // Named by hand for this session: the most specific thing anybody said, so it decides first.
  if (listed(address, policy.blockedSites)) {
    return { allowed: false, because: 'site', category, reason: 'You asked Orbis to hold this one back during Focus.', saveable: policy.allowSaveForLater, counts: true, warn: policy.enforce === 'warn' }
  }
  if (listed(address, policy.approved)) {
    return { allowed: true, because: 'allowed', category, reason: 'This is one of your approved resources.', saveable: false, counts: false, warn: false }
  }

  // YouTube, which needs its own answer because it is both the library and the distraction.
  const youtube = youtubeRef(address)
  if (youtube) {
    const decided = decideYoutube(youtube, policy)
    if (decided) return decided
  }

  if (policy.approvedCategories.includes(category)) {
    return { allowed: true, because: 'allowed', category, reason: `${CATEGORY_LABELS[category]} is allowed in this session.`, saveable: false, counts: false, warn: false }
  }
  if (policy.blocked.includes(category)) {
    const warn = policy.enforce === 'warn'
    return {
      allowed: warn,
      because: 'focus',
      category,
      reason: warn
        ? `${CATEGORY_LABELS[category]} is a distraction from this session.`
        : `${CATEGORY_LABELS[category]} is held back until this session finishes.`,
      saveable: policy.allowSaveForLater,
      counts: true,
      warn
    }
  }
  return { allowed: true, because: 'allowed', category, reason: safety.reason, saveable: false, counts: false, warn: false }
}

function decideYoutube(ref: { video: string | null; channel: string | null }, policy: FocusPolicy): FocusDecision | null {
  const approved = (ref.video && policy.approvedVideos.includes(ref.video)) || (ref.channel && policy.approvedChannels.includes(ref.channel))
  if (approved) {
    return { allowed: true, because: 'allowed', category: 'education', reason: 'You approved this one for study.', saveable: false, counts: false, warn: false }
  }
  switch (policy.youtube) {
    case 'open':
      return null
    case 'blocked':
      return { allowed: false, because: 'focus', category: 'streaming', reason: 'Video is held back until this session finishes.', saveable: policy.allowSaveForLater, counts: true, warn: false }
    case 'approved-only':
      return {
        allowed: false,
        because: 'focus',
        category: 'streaming',
        // Said exactly: not "YouTube is blocked", but "this one is not on the list", which is a different and truer thing.
        reason: 'Only videos you approved are open during this session.',
        saveable: policy.allowSaveForLater,
        counts: true,
        warn: false
      }
    case 'educational':
    default:
      // Nothing can tell from an address whether a video teaches anything, and Orbis must not pretend it can. The
      // home page and the feeds are held back; a particular video opens, because asking for one is a decision.
      if (ref.video) return { allowed: true, because: 'allowed', category: 'streaming', reason: 'A video you went to directly.', saveable: false, counts: false, warn: false }
      return { allowed: false, because: 'focus', category: 'streaming', reason: 'The video feeds are held back. A video you go to directly still opens.', saveable: policy.allowSaveForLater, counts: true, warn: false }
  }
}

/** What a student is shown before a strict session starts, so nothing about it is a surprise. */
export function previewPolicy(policy: FocusPolicy): { blocked: readonly string[]; allowed: readonly string[]; locked: boolean; note: string } {
  const blocked = policy.blocked.map((one) => CATEGORY_LABELS[one])
  if (policy.youtube === 'blocked' || policy.youtube === 'approved-only') blocked.push('Video, except what you approved')
  const allowed = [...policy.approvedCategories.map((one) => CATEGORY_LABELS[one]), ...policy.approved.slice(0, 20)]
  allowed.push('Orbis, Orion and the study tools')
  return {
    blocked: [...new Set(blocked)],
    allowed: [...new Set(allowed)],
    locked: policy.locked,
    note: policy.locked
      ? 'The policy is fixed for this session. Changing your settings while it runs will not weaken it.'
      : 'You can change this during the session.'
  }
}

/** Which of the hosts in a list the student has blocked, as hosts, so the browser can be told. */
export function hostsToBlock(policy: FocusPolicy): readonly string[] {
  return [...new Set(policy.blockedSites.map((one) => (one.includes('/') ? hostOf(one.startsWith('http') ? one : `https://${one}`) : one)).filter(Boolean))]
}

/** What a page should be saved as, when it is saved for later. */
export function describeForLater(url: string, title: string): { url: string; title: string; category: ContentCategory } {
  return { url: canonical(url), title: title.trim().slice(0, 300) || hostOf(url) || 'Saved page', category: categorise(url) }
}
