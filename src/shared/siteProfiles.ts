/**
 * What Orbis has learned about working on a particular site.
 *
 * Not instructions. This is a record of what actually happened the last few times Orbis tried to do something on a
 * site: which kinds of action worked there, which did not, and whether it asked somebody to prove they were a person.
 * The agent reads it the way you would read a note to yourself -- "finding things by their label has not worked here;
 * last time the page had to be read instead" -- and then decides for itself.
 *
 * Three rules, and the first is the one that matters:
 *
 * **A profile is never a script.** It holds counts and dates, and there is no field anywhere in it for a sequence of
 * steps, a selector, or a thing to click. A site that changes its layout makes the counts stale, which is a small
 * loss; a site that changes its layout would make a stored script wrong, which is a large one.
 *
 * **It only ever records outcomes Orbis saw.** Every number here came from an action that really ran and really
 * succeeded or failed. Nothing is inferred, and a site Orbis has not worked on has no profile rather than an empty
 * one full of zeroes that look like failures.
 *
 * **It holds nothing about the person.** A host, counts, and times. Never what was searched, read, typed, bought or
 * looked at -- that is browsing history, it belongs to the person, and a file about site compatibility is not where
 * it goes.
 */

/** The kinds of thing worth remembering separately. Coarse on purpose: a hundred counters would learn nothing. */
export type SiteSkill = 'find' | 'click' | 'type' | 'read' | 'extract' | 'navigate'

export interface SiteSkillRecord {
  worked: number
  failed: number
  /** When this skill was last tried here. */
  at: number
}

export interface SiteProfile {
  /** The site, without `www.`. Never a full address: a profile is about a site, not a page. */
  readonly host: string
  readonly skills: Readonly<Record<string, SiteSkillRecord>>
  /** How many times a verification challenge has appeared here. */
  readonly challenges: number
  /** When a challenge last appeared, or null. */
  readonly lastChallenge: number | null
  readonly firstSeen: number
  readonly lastSeen: number
}

export const SITE_PROFILE_VERSION = 1

/** How many sites are kept. Past this the least recently used go: this is a memory, not an archive. */
export const MAX_SITE_PROFILES = 300

/** Counts older than this stop being worth anything -- sites change. */
const STALE_AFTER = 60 * 24 * 60 * 60 * 1000

/** Which skill a capability exercises, or null for the ones that say nothing about a site. */
export function skillOf(capability: string): SiteSkill | null {
  if (capability === 'page.find' || capability === 'page.waitFor') return 'find'
  if (capability === 'page.click' || capability === 'page.check' || capability === 'page.select' || capability === 'page.submit') return 'click'
  if (capability === 'page.type' || capability === 'page.clear' || capability === 'page.paste') return 'type'
  if (capability === 'page.read' || capability === 'page.snapshot' || capability === 'page.accessibility') return 'read'
  if (capability === 'page.extract' || capability === 'page.evaluateQuery') return 'extract'
  if (capability.startsWith('navigation.')) return 'navigate'
  return null
}

/** The site a web address belongs to, or null for anything that is not an ordinary web page. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const host = parsed.hostname.replace(/^www\./, '')
    return host === '' ? null : host
  } catch {
    return null
  }
}

const fresh = (host: string, at: number): SiteProfile => ({ host, skills: {}, challenges: 0, lastChallenge: null, firstSeen: at, lastSeen: at })

/** Records one thing that really happened. Returns the new profile; the old one is never changed in place. */
export function noteOutcome(profile: SiteProfile | undefined, host: string, skill: SiteSkill, worked: boolean, at: number): SiteProfile {
  const base = profile ?? fresh(host, at)
  const had = base.skills[skill] ?? { worked: 0, failed: 0, at }
  return {
    ...base,
    skills: { ...base.skills, [skill]: { worked: had.worked + (worked ? 1 : 0), failed: had.failed + (worked ? 0 : 1), at } },
    lastSeen: at
  }
}

/** Records that a site asked somebody to prove they were a person. */
export function noteChallenge(profile: SiteProfile | undefined, host: string, at: number): SiteProfile {
  const base = profile ?? fresh(host, at)
  return { ...base, challenges: base.challenges + 1, lastChallenge: at, lastSeen: at }
}

/**
 * What this profile is worth saying to the agent, or null when it has nothing useful to add.
 *
 * Deliberately quiet. A site where everything has worked produces nothing, because "it worked" is what the agent
 * already assumes and a note saying so is noise it has to read on every page. Only the awkward sites speak up.
 */
export function summarise(profile: SiteProfile, now: number): string | null {
  if (now - profile.lastSeen > STALE_AFTER) return null
  const notes: string[] = []

  for (const [skill, record] of Object.entries(profile.skills)) {
    const tried = record.worked + record.failed
    // Two tries is not a pattern. Three, mostly failing, is worth mentioning.
    if (tried < 3 || record.failed <= record.worked) continue
    notes.push(`${skill} has failed ${record.failed} of ${tried} times here`)
  }
  if (profile.challenges > 0) {
    notes.push(profile.challenges === 1 ? 'this site has asked to verify a person once' : `this site has asked to verify a person ${profile.challenges} times`)
  }
  return notes.length ? `On ${profile.host}: ${notes.join('; ')}.` : null
}

/** The sites worth keeping, most recently used first. */
export function prune(profiles: readonly SiteProfile[], limit = MAX_SITE_PROFILES, now = Date.now()): SiteProfile[] {
  return [...profiles]
    .filter((one) => now - one.lastSeen <= STALE_AFTER)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit)
}

/** One profile read back from disk, or null if it is not one. A damaged record is dropped, never repaired. */
export function readProfile(raw: unknown): SiteProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const host = typeof o.host === 'string' ? o.host.slice(0, 120) : ''
  if (host === '' || typeof o.firstSeen !== 'number' || typeof o.lastSeen !== 'number') return null
  const skills: Record<string, SiteSkillRecord> = {}
  if (o.skills && typeof o.skills === 'object') {
    for (const [name, value] of Object.entries(o.skills as Record<string, unknown>).slice(0, 12)) {
      const v = value as Record<string, unknown>
      if (!v || typeof v.worked !== 'number' || typeof v.failed !== 'number') continue
      skills[name.slice(0, 20)] = { worked: Math.max(0, v.worked), failed: Math.max(0, v.failed), at: typeof v.at === 'number' ? v.at : o.lastSeen }
    }
  }
  return {
    host,
    skills,
    challenges: typeof o.challenges === 'number' && o.challenges >= 0 ? o.challenges : 0,
    lastChallenge: typeof o.lastChallenge === 'number' ? o.lastChallenge : null,
    firstSeen: o.firstSeen,
    lastSeen: o.lastSeen
  }
}
