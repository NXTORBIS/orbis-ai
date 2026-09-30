import { findUnsupported, type Unsupported } from './capability.ts'
import { DEFAULT_POLICIES, type JobCondition, type JobPolicies, type TemporalAction } from './job.ts'
import { checkSchedule, type Recurrence, type Schedule, type TimeOfDay, type Weekday } from './recurrence.ts'
import { addDays, canonicalZone, deviceZone, isKnownZone, wallTimeAt } from './zone.ts'

/**
 * Schedules said in ordinary words.
 *
 * Orbis already reads a few phrases -- `parseSchedule` in `../schedulePhrase.ts` handles "every Friday at 9am" and
 * four siblings, for workflows. This reads a much wider range and produces the richer schedule that knows about
 * places, clock changes and short months, plus the rest of what somebody actually said: what to do, where, how long
 * to keep doing it, and what to do if it fails.
 *
 * The older parser stays where it is and keeps working. This is not a replacement for it and does not change it.
 *
 * ## What it will not do
 *
 * **It never guesses.** Anything not clearly a time Orbis can keep comes back as a refusal with a reason. "Every
 * other Tuesday", "when the weather is nice", "soon" -- refused. A schedule that quietly means something else than
 * what somebody asked for is worse than no schedule, because they only find out after the moment has gone.
 *
 * **It never invents an action.** A sentence with no recognisable thing to do is refused, not turned into a
 * reminder. Turning "back up my files every Friday" into a note that says "back up my files" is a scheduler
 * pretending to have done something.
 *
 * **It never produces something Orbis cannot do.** Asking to send a WhatsApp on Monday comes back saying Orbis
 * cannot, with the nearest real thing offered instead.
 *
 * **It has no clock.** `now` is given, so a year of phrases is testable.
 */

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december'
] as const

/** Places people name, to the zone they mean. Only where the mapping is unambiguous; an IANA name is also accepted. */
const PLACES: Readonly<Record<string, string>> = Object.freeze({
  london: 'Europe/London',
  uk: 'Europe/London',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  california: 'America/Los_Angeles',
  chicago: 'America/Chicago',
  india: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  chennai: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  dubai: 'Asia/Dubai',
  singapore: 'Asia/Singapore',
  tokyo: 'Asia/Tokyo',
  japan: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  berlin: 'Europe/Berlin',
  germany: 'Europe/Berlin',
  paris: 'Europe/Paris',
  utc: 'UTC',
  gmt: 'UTC'
})

/** A calendar day, with no time attached. */
type Day = { year: number; month: number; day: number }

/** A time of day said in words. Returns null rather than a guess. */
export function readTime(text: string): TimeOfDay | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (t === 'noon' || t === 'midday') return { hour: 12, minute: 0 }
  if (t === 'midnight') return { hour: 0, minute: 0 }

  // "half past nine", "quarter to six" -- common enough in speech to be worth reading.
  const spoken = /^(half past|quarter past|quarter to) (\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm)?$/.exec(t)
  if (spoken) {
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
    const named = words.indexOf(spoken[2])
    let hour = named > 0 ? named : Number(spoken[2])
    if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null
    let minute = 0
    if (spoken[1] === 'half past') minute = 30
    else if (spoken[1] === 'quarter past') minute = 15
    else {
      minute = 45
      // "Quarter to six" is the hour before six.
      hour = hour === 1 ? 12 : hour - 1
    }
    if (spoken[3] === 'pm' && hour < 12) hour += 12
    if (spoken[3] === 'am' && hour === 12) hour = 0
    // With no am/pm, an evening-sounding hour is left as written; see the bare-hour note below.
    return { hour: hour % 24, minute }
  }

  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/.exec(t)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const half = m[3]?.replace(/\./g, '')
  if (minute > 59 || hour > 23 || (half && (hour < 1 || hour > 12))) return null
  if (half === 'pm' && hour < 12) hour += 12
  if (half === 'am' && hour === 12) hour = 0
  /**
   * A bare hour is taken literally.
   *
   * "at 7" could be either, and there is no reading that is right often enough to be worth being wrong about -- a
   * backup at 7am and a reminder at 7pm are both perfectly ordinary. So 7 means 07:00, and the confirmation shows
   * the time back so it can be corrected in one word.
   */
  return { hour, minute }
}

/**
 * Whether a message is somebody asking for a schedule, as opposed to mentioning a time in passing.
 *
 * This gate exists because `readRequest` is strict about grammar but knows nothing about intent: "every day I open
 * news.example and it is slow" has a rule and an action in it, and is plainly not a request to open it every day.
 * Turning that into a schedule is the kind of mistake somebody finds out about the next morning.
 *
 * So a message has to *begin* like a request. Deliberately narrow: a missed request costs one more sentence, and a
 * wrongly-created schedule costs a surprise.
 */
export function looksLikeScheduleRequest(message: string): boolean {
  const text = message.trim().toLowerCase().replace(/\s+/g, ' ')
  // A whole paragraph that happens to open with "every day" is prose, not an instruction.
  if (text.length === 0 || text.length > 200) return false
  /**
   * A question is a question, and a sentence about oneself is a remark.
   *
   * "Every day I open news.example and it is slow" opens exactly like a request and is not one. Somebody asking for
   * something says "remind me" or "open news.example"; describing what they do says "I". That one word separates the
   * two more reliably than anything else short of understanding the sentence.
   */
  if (text.includes('?') || /\bi\b/.test(text)) return false
  return /^(?:please\s+|can you\s+|could you\s+)?(?:remind me\b|remind\b|schedule\b|set (?:up )?a (?:schedule|reminder)\b|every\b|each (?:day|week|month|year|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|daily\b|hourly\b|weekly\b|monthly\b|open\b|refresh\b|reload\b|run\b|close\b|ask orion\b|in \d|at \d|tomorrow\b|tonight\b|today\b|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/.test(
    text
  )
}

export interface Understood {
  ok: true
  action: TemporalAction
  schedule: Schedule
  policies: JobPolicies
  conditions: readonly JobCondition[]
  /** What Orbis understood, in words, to be shown back before anything is saved. */
  said: string
  /** Set when the time of day was not given and a default was used, so the confirmation can say so. */
  assumedTime: boolean
}

export type Refused =
  | { ok: false; why: string }
  /** Orbis genuinely cannot do this. Carried whole so the caller can offer the alternative. */
  | { ok: false; why: string; unsupported: Unsupported }

export type Reading = Understood | Refused

/** The default time of day when a rule gives a day but no time. Nine in the morning, and always said back. */
const DEFAULT_TIME: TimeOfDay = Object.freeze({ hour: 9, minute: 0 })

/**
 * A whole request, said in words.
 *
 * `now` and `zone` are given rather than read, which is what makes this testable and what lets a schedule be made
 * for somewhere other than where the computer is.
 */
export function readRequest(phrase: string, now: number, zone = deviceZone()): Reading {
  const raw = phrase.trim()
  if (raw.length === 0) return { ok: false, why: 'Nothing was said.' }

  let text = raw.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?]+$/, '')

  // Anything Orbis genuinely cannot do is answered before parsing, so the answer is about Orbis rather than grammar.
  const cannot = findUnsupported(text)
  if (cannot) return { ok: false, why: cannot.because, unsupported: cannot }

  // The place, taken out first: it is the same wherever it appears and would otherwise confuse the day-of-week rules.
  const place = takePlace(text)
  text = place.rest
  const timeZone = place.zone ?? zone
  if (!isKnownZone(timeZone)) return { ok: false, why: `This computer does not know the time zone “${timeZone}”.` }

  // Then the limits, for the same reason.
  const limits = takeLimits(text, now, timeZone)
  text = limits.rest

  const when = takeWhen(text, now, timeZone)
  if (when === null) {
    return {
      ok: false,
      why: 'I could not find a time in that. Try something like “every day at 8am”, “every Monday at 9”, or “in 20 minutes”.'
    }
  }
  text = when.rest

  const action = takeAction(text)
  if (action === null) {
    return {
      ok: false,
      why: 'I understood the time but not what to do. Try “open orbis.dev every morning at 8” or “remind me to stretch every hour”.'
    }
  }

  const schedule: Schedule = { recurrence: when.recurrence, timeZone, ...limits.limits }
  const problems = checkSchedule(schedule)
  if (problems.length > 0) return { ok: false, why: problems[0] }

  const policies: JobPolicies = {
    ...DEFAULT_POLICIES,
    // A one-off at a named moment is usually meant at that moment; a reminder especially so.
    missed: when.recurrence.kind === 'once' && action.kind === 'notify' ? 'withinWindow' : DEFAULT_POLICIES.missed,
    exact: /\bexactly\b|\bon the dot\b|\bsharp\b/.test(text)
  }

  return {
    ok: true,
    action,
    schedule,
    policies,
    conditions: takeConditions(raw.toLowerCase()),
    said: describe(action, schedule),
    assumedTime: when.assumedTime
  }
}

// ---------------------------------------------------------------- the pieces

function takePlace(text: string): { rest: string; zone: string | null } {
  const m = /\b(?:in|for|time in)\s+([a-z ]+?)\s+time\b|\b(?:in|for)\s+([a-z_/]+\/[a-z_]+)\b/.exec(text)
  if (m) {
    const named = (m[1] ?? m[2] ?? '').trim()
    // A name typed out in full is spelled the way the database spells it, not the way the phrase happened to arrive.
    const zone = PLACES[named] ?? canonicalZone(named)
    if (zone) return { rest: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(), zone }
  }
  // "... at 9am uk time", "... 6pm IST"
  const suffix = /\b([a-z ]{2,20}?)\s*time\b/.exec(text)
  if (suffix) {
    const zone = PLACES[suffix[1].trim()]
    if (zone) return { rest: text.replace(suffix[0], ' ').replace(/\s+/g, ' ').trim(), zone }
  }
  const bare = /\b(ist|utc|gmt)\b/.exec(text)
  if (bare) return { rest: text.replace(bare[0], ' ').replace(/\s+/g, ' ').trim(), zone: PLACES[bare[1]] }
  return { rest: text, zone: null }
}

function takeLimits(
  text: string,
  now: number,
  zone: string
): { rest: string; limits: { startsAt?: number; endsAt?: number; maxRuns?: number } } {
  const limits: { startsAt?: number; endsAt?: number; maxRuns?: number } = {}
  let rest = text

  const times = /\b(?:for|just) (\d{1,3}) (?:times|runs|days|weeks)\b/.exec(rest)
  if (times) {
    limits.maxRuns = Number(times[1])
    rest = rest.replace(times[0], ' ')
  }
  const once = /\bonly once\b/.exec(rest)
  if (once) {
    limits.maxRuns = 1
    rest = rest.replace(once[0], ' ')
  }

  const until = /\buntil (.+?)(?:$|,)/.exec(rest)
  if (until) {
    const end = readDay(until[1].trim(), now, zone)
    if (end) {
      // End of that day, since "until Friday" includes Friday.
      limits.endsAt = end.endOfDay
      rest = rest.replace(until[0], ' ')
    }
  }
  const from = /\bstarting (?:on |from )?(.+?)(?:$|,)/.exec(rest)
  if (from) {
    const start = readDay(from[1].trim(), now, zone)
    if (start) {
      limits.startsAt = start.startOfDay
      rest = rest.replace(from[0], ' ')
    }
  }
  return { rest: rest.replace(/\s+/g, ' ').trim(), limits }
}

/** A day said in words, as the moments it begins and ends. Used for limits, not for the rule itself. */
function readDay(text: string, now: number, zone: string): { startOfDay: number; endOfDay: number } | null {
  const here = wallTimeAt(now, zone)
  let date: Day | null = null

  if (text === 'today') date = here
  else if (text === 'tomorrow') date = addDays(here, 1)
  else if (/^next week$/.test(text)) date = addDays(here, 7)
  else if (/^next month$/.test(text)) date = addDays(here, 30)
  else {
    const weekday = DAYS.indexOf(text.replace(/^(next |this )/, '') as (typeof DAYS)[number])
    if (weekday >= 0) {
      let walk: Day = here
      for (let i = 1; i <= 7; i++) {
        walk = addDays(walk, 1)
        const w = wallTimeAt(Date.UTC(walk.year, walk.month - 1, walk.day, 12), 'UTC')
        if (new Date(Date.UTC(w.year, w.month - 1, w.day)).getUTCDay() === weekday) break
      }
      date = walk
    } else {
      const d = /^(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?$/.exec(text)
      if (d) {
        const month = MONTHS.findIndex((m) => m.startsWith(d[2]))
        if (month >= 0) date = { year: d[3] ? Number(d[3]) : here.year, month: month + 1, day: Number(d[1]) }
      }
    }
  }
  if (date === null) return null
  const start = Date.UTC(date.year, date.month - 1, date.day)
  return { startOfDay: start, endOfDay: start + 86_400_000 - 1 }
}

interface WhenRead {
  recurrence: Recurrence
  rest: string
  assumedTime: boolean
}

function takeWhen(text: string, now: number, zone: string): WhenRead | null {
  const here = wallTimeAt(now, zone)
  const cut = (m: RegExpExecArray, recurrence: Recurrence, assumedTime: boolean): WhenRead => ({
    recurrence,
    rest: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim(),
    assumedTime
  })

  // "in 20 minutes", "in 2 hours", "in 3 days"
  let m = /\bin (\d{1,4}) (minute|minutes|min|mins|hour|hours|hr|hrs|day|days)\b/.exec(text)
  if (m) {
    const n = Number(m[1])
    const unit = m[2].startsWith('min') ? 60_000 : m[2].startsWith('h') ? 3_600_000 : 86_400_000
    const at = now + n * unit
    const w = wallTimeAt(at, zone)
    return cut(m, { kind: 'once', date: { year: w.year, month: w.month, day: w.day }, time: { hour: w.hour, minute: w.minute } }, false)
  }

  // "every 30 minutes", "every 2 hours", "hourly"
  m = /\bevery (\d{1,4}) (minute|minutes|min|mins|hour|hours|hr|hrs)\b/.exec(text)
  if (m) {
    const n = Number(m[1])
    const minutes = m[2].startsWith('min') ? n : n * 60
    return cut(m, { kind: 'interval', everyMinutes: minutes, from: now }, false)
  }
  m = /\b(?:hourly|every hour|each hour)\b/.exec(text)
  if (m) return cut(m, { kind: 'interval', everyMinutes: 60, from: now }, false)
  m = /\b(?:every minute|each minute)\b/.exec(text)
  if (m) return cut(m, { kind: 'interval', everyMinutes: 1, from: now }, false)

  // Refuse the ones that sound schedulable and are not, rather than matching them loosely below.
  if (/\bevery other\b|\bevery second (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bfortnight/.test(text)) {
    return null
  }

  const timeIn = (): { time: TimeOfDay; assumed: boolean; matched: string } => {
    const at = /\bat ([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|noon|midnight|midday|half past [a-z0-9]+|quarter (?:past|to) [a-z0-9]+)\b/.exec(text)
    if (at) {
      const read = readTime(at[1])
      if (read) return { time: read, assumed: false, matched: at[0] }
    }
    // "every morning", "every evening" -- a real way people say it, and the default is said back either way.
    if (/\bmorning\b/.test(text)) return { time: { hour: 8, minute: 0 }, assumed: true, matched: '' }
    if (/\bafternoon\b/.test(text)) return { time: { hour: 14, minute: 0 }, assumed: true, matched: '' }
    if (/\bevening\b/.test(text)) return { time: { hour: 19, minute: 0 }, assumed: true, matched: '' }
    if (/\bnight\b/.test(text)) return { time: { hour: 22, minute: 0 }, assumed: true, matched: '' }
    return { time: DEFAULT_TIME, assumed: true, matched: '' }
  }

  const withTime = (m2: RegExpExecArray, make: (t: TimeOfDay) => Recurrence): WhenRead => {
    const t = timeIn()
    const cleaned = text.replace(m2[0], ' ').replace(t.matched, ' ').replace(/\s+/g, ' ').trim()
    return { recurrence: make(t.time), rest: cleaned, assumedTime: t.assumed }
  }

  // Weekdays and weekends, which people say far more often than the days themselves.
  m = /\b(?:every )?(?:weekday|weekdays|on weekdays|every working day)\b/.exec(text)
  if (m) return withTime(m, (t) => ({ kind: 'weekly', weekdays: [1, 2, 3, 4, 5], time: t }))
  m = /\b(?:every )?(?:weekend|weekends|on weekends)\b/.exec(text)
  if (m) return withTime(m, (t) => ({ kind: 'weekly', weekdays: [0, 6], time: t }))

  // One or more named days: "every monday", "every monday and friday", "on tue, thu".
  const named = [...text.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/g)]
  if (named.length > 0 && /\b(every|each|on|weekly)\b/.test(text)) {
    const weekdays = [...new Set(named.map((n) => DAYS.indexOf(n[1] as (typeof DAYS)[number]) as Weekday))].sort()
    const t = timeIn()
    let cleaned = text
    for (const n of named) cleaned = cleaned.replace(n[0], ' ')
    cleaned = cleaned.replace(/\b(every|each|on|weekly|and|,)\b/g, ' ').replace(t.matched, ' ').replace(/\s+/g, ' ').trim()
    return { recurrence: { kind: 'weekly', weekdays, time: t.time }, rest: cleaned, assumedTime: t.assumed }
  }

  // "the last day of the month"
  m = /\b(?:on the )?last day of (?:the |every |each )?month\b/.exec(text)
  if (m) return withTime(m, (t) => ({ kind: 'monthlyLastDay', time: t }))

  // "every month on the 1st", "monthly on the 15th"
  m = /\b(?:every month|monthly|each month)(?: on the (\d{1,2})(?:st|nd|rd|th)?)?\b/.exec(text)
  if (m) {
    const day = m[1] ? Number(m[1]) : 1
    // A month-end day is kept as asked and handled by the short-month rule, rather than refused as the old parser did.
    return withTime(m, (t) => ({ kind: 'monthly', day, time: t, short: 'lastDay' }))
  }

  // "every year on 3 March", "yearly on march 3"
  m = /\b(?:every year|yearly|annually|each year)(?: on)?(?: the)? (?:(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)|([a-z]+) (\d{1,2})(?:st|nd|rd|th)?)\b/.exec(text)
  if (m) {
    const dayText = m[1] ?? m[4]
    const monthText = m[2] ?? m[3]
    const month = MONTHS.findIndex((x) => x.startsWith(monthText))
    if (month >= 0) {
      return withTime(m, (t) => ({ kind: 'yearly', month: month + 1, day: Number(dayText), time: t, short: 'lastDay' }))
    }
  }

  m = /\b(?:every day|everyday|daily|each day|every morning|every evening|every afternoon|every night)\b/.exec(text)
  if (m) return withTime(m, (t) => ({ kind: 'daily', time: t }))

  // One-offs: "tomorrow at 7", "today at 6pm", "on 3 March at 9", "next monday at 10".
  m = /\b(today|tomorrow|tonight)\b/.exec(text)
  if (m) {
    const t = timeIn()
    const base = m[1] === 'tomorrow' ? addDays(here, 1) : here
    const time = m[1] === 'tonight' && t.assumed ? { hour: 20, minute: 0 } : t.time
    const cleaned = text.replace(m[0], ' ').replace(t.matched, ' ').replace(/\s+/g, ' ').trim()
    return { recurrence: { kind: 'once', date: base, time }, rest: cleaned, assumedTime: t.assumed }
  }
  m = /\b(?:next|this) (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(text)
  if (m) {
    const wanted = DAYS.indexOf(m[1] as (typeof DAYS)[number])
    let walk: Day = here
    for (let i = 1; i <= 7; i++) {
      walk = addDays(walk, 1)
      if (new Date(Date.UTC(walk.year, walk.month - 1, walk.day)).getUTCDay() === wanted) break
    }
    const t = timeIn()
    const cleaned = text.replace(m[0], ' ').replace(t.matched, ' ').replace(/\s+/g, ' ').trim()
    return { recurrence: { kind: 'once', date: walk, time: t.time }, rest: cleaned, assumedTime: t.assumed }
  }
  m = /\bon (?:the )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)(?: (\d{4}))?\b/.exec(text)
  if (m) {
    const month = MONTHS.findIndex((x) => x.startsWith(m![2]))
    if (month >= 0) {
      const t = timeIn()
      const year = m[3] ? Number(m[3]) : here.year
      const date = { year, month: month + 1, day: Number(m[1]) }
      const cleaned = text.replace(m[0], ' ').replace(t.matched, ' ').replace(/\s+/g, ' ').trim()
      return { recurrence: { kind: 'once', date, time: t.time }, rest: cleaned, assumedTime: t.assumed }
    }
  }

  // A bare time with nothing else: "at 6pm" means the next 6pm.
  m = /\bat ([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|noon|midnight)\b/.exec(text)
  if (m) {
    const read = readTime(m[1])
    if (read) {
      const todayLater = read.hour > here.hour || (read.hour === here.hour && read.minute > here.minute)
      const date = todayLater ? here : addDays(here, 1)
      return cut(m, { kind: 'once', date, time: read }, false)
    }
  }

  return null
}

function takeAction(text: string): TemporalAction | null {
  const t = text.replace(/^(?:please |can you |could you )/, '').trim()

  // A reminder, which is the most common thing anybody schedules.
  let m = /\b(?:remind me(?: to| that| about)?|reminder(?: to| about)?|tell me(?: to)?)\s+(.+)$/.exec(t)
  if (m && m[1].trim()) return { kind: 'notify', message: sentence(m[1]) }

  // A web address, with or without a verb in front of it.
  m = /\b(?:open|go to|visit|launch|load)\s+(?:the )?(?:page |site |website )?((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/.exec(t)
  if (m) return { kind: 'openUrl', url: asUrl(m[1]), newTab: true }
  m = /\b(?:refresh|reload|check)\s+(?:the )?((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)/.exec(t)
  if (m) return { kind: 'refreshUrl', url: asUrl(m[1]) }
  m = /^((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/.exec(t)
  if (m) return { kind: 'openUrl', url: asUrl(m[1]), newTab: true }

  m = /\b(?:open|switch to|load)\s+(?:my )?(.+?)\s*workspace\b/.exec(t)
  if (m && m[1].trim()) return { kind: 'openWorkspace', workspaceId: m[1].trim() }
  m = /\b(?:run|start)\s+(?:the |my )?(.+?)\s*workflow\b/.exec(t)
  if (m && m[1].trim()) return { kind: 'workflow', workflowId: m[1].trim() }
  m = /\bopen\s+(?:the |my )?(.+?)\s*page\b/.exec(t)
  if (m && m[1].trim()) return { kind: 'openPage', pageId: m[1].trim() }
  m = /\bclose\s+(?:all )?(?:tabs?|the tabs?)(?: (?:for|matching|from) (.+))?$/.exec(t)
  if (m && m[1]?.trim()) return { kind: 'closeTabs', urlMatches: m[1].trim() }

  // A Telegram message, which is how a reminder reaches somebody who is not at this computer.
  m = /\b(?:telegram|message me on telegram|send me a telegram)(?: me)?(?: saying| that| to)?\s+(.+)$/.exec(t)
  if (m && m[1].trim()) return { kind: 'telegram', chatId: '', message: sentence(m[1]) }

  // A webhook, which is an address somebody owns. https only; see the check in job.ts.
  m = /\b(?:post|send)\s+(?:a message |the message )?(?:to\s+)?(https:\/\/\S+)(?:\s+saying\s+(.+))?$/.exec(t)
  if (m) return { kind: 'webhook', url: m[1], message: m[2]?.trim() ? sentence(m[2]) : 'Orbis schedule' }

  m = /\b(?:ask orion|ask|summarise|summarize|find out|look up)\s+(.+)$/.exec(t)
  if (m && m[1].trim()) return { kind: 'orion', prompt: sentence(m[1]) }

  return null
}

function takeConditions(text: string): JobCondition[] {
  const out: JobCondition[] = []
  if (/\bon wifi\b|\bonly on wifi\b|\bwhen on wifi\b/.test(text)) out.push({ kind: 'onWifi' })
  if (/\bplugged in\b|\bon (?:power|charge|charger)\b/.test(text)) out.push({ kind: 'onPower' })
  const battery = /\bbattery (?:is )?(?:above|over) (\d{1,3})\b/.exec(text)
  if (battery) out.push({ kind: 'batteryAbove', percent: Number(battery[1]) })
  return out
}

function asUrl(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`
}

function sentence(text: string): string {
  const trimmed = text.trim().replace(/^to\s+/, '').replace(/[,;]$/, '')
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

// ---------------------------------------------------------------- saying it back

/** Twelve-hour clock, because that is how the phrase was probably said. */
export function clockText(time: TimeOfDay): string {
  const half = time.hour < 12 ? 'am' : 'pm'
  const hour = time.hour % 12 === 0 ? 12 : time.hour % 12
  return time.minute === 0 ? `${hour}${half}` : `${hour}:${String(time.minute).padStart(2, '0')}${half}`
}

const ORDINAL = (n: number): string => {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'
  return `${n}${suffix}`
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The rule in words, for showing back before anything is saved. */
export function describeRecurrence(r: Recurrence): string {
  switch (r.kind) {
    case 'once':
      return `once, on ${ORDINAL(r.date.day)} ${cap(MONTHS[r.date.month - 1])} at ${clockText(r.time)}`
    case 'interval':
      return r.everyMinutes % 60 === 0 && r.everyMinutes >= 60
        ? `every ${r.everyMinutes / 60} hour${r.everyMinutes === 60 ? '' : 's'}`
        : `every ${r.everyMinutes} minute${r.everyMinutes === 1 ? '' : 's'}`
    case 'daily':
      return `every day at ${clockText(r.time)}`
    case 'weekly': {
      const days = r.weekdays.map((d) => cap(DAYS[d]))
      const list = days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`
      return `every ${list} at ${clockText(r.time)}`
    }
    case 'monthly':
      return `every month on the ${ORDINAL(r.day)} at ${clockText(r.time)}`
    case 'monthlyLastDay':
      return `on the last day of every month at ${clockText(r.time)}`
    case 'yearly':
      return `every year on ${ORDINAL(r.day)} ${cap(MONTHS[r.month - 1])} at ${clockText(r.time)}`
  }
}

/** The action in words. */
export function describeAction(a: TemporalAction): string {
  switch (a.kind) {
    case 'workflow':
      return `run the ${a.workflowId} workflow`
    case 'openUrl':
      return `open ${a.url.replace(/^https?:\/\//, '')}`
    case 'openWorkspace':
      return `open the ${a.workspaceId} workspace`
    case 'openPage':
      return `open the ${a.pageId} Page`
    case 'refreshUrl':
      return `refresh ${a.url.replace(/^https?:\/\//, '')}`
    case 'closeTabs':
      return `close tabs matching ${a.urlMatches}`
    case 'orion':
      return `ask Orion: ${a.prompt}`
    case 'notify':
      return `remind you: ${a.message}`
    case 'webhook':
      // The address, without the scheme, because that is how somebody recognises their own webhook.
      return `post to ${a.url.replace(/^https:\/\//, '').slice(0, 60)}`
    case 'telegram':
      return `send you a Telegram: ${a.message}`
  }
}

/** The whole thing in one sentence, place included when it is not where the computer is. */
export function describe(action: TemporalAction, schedule: Schedule): string {
  const parts = [cap(describeAction(action)), describeRecurrence(schedule.recurrence)]
  let out = parts.join(', ')
  /**
   * Compared as the database spells them, because the same place has more than one name.
   *
   * A machine in India resolves its own zone as `Asia/Calcutta` while somebody saying "IST" gets `Asia/Kolkata`.
   * Comparing the strings makes Orbis tag a schedule "(Kolkata time)" on a computer already in that very zone,
   * which reads as though the time had been converted from somewhere else.
   */
  const here = canonicalZone(deviceZone())
  const there = canonicalZone(schedule.timeZone)
  if (there !== null && there !== here) out += ` (${schedule.timeZone.split('/').pop()?.replace(/_/g, ' ')} time)`
  if (schedule.maxRuns !== undefined) out += `, ${schedule.maxRuns} time${schedule.maxRuns === 1 ? '' : 's'}`
  if (schedule.endsAt !== undefined) out += ', until it ends'
  return out
}
