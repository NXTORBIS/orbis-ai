/**
 * "Today", "the last hour", "this week" -- turned into two instants, in code rather than by a model.
 *
 * Every capability that acts on a stretch of the past takes epoch milliseconds, which is right: a time range should be
 * exact and not re-argued at each call site. But asking a language model to produce them means asking it what time it
 * is, which it does not know, and then asking it to do calendar arithmetic, which it does badly and silently -- a plan
 * that said "today" and carried midnight of the wrong day deletes the wrong day and reports success.
 *
 * So the plan carries the *word*, and the arithmetic happens here. "Clear today's history" and "clear the history from
 * today" reach the same two numbers because both reach the same name, not because either phrase was recognised.
 *
 * Local time throughout, deliberately. Somebody who says "today" means the day they are living in, and history is a
 * record of what they did in it; a UTC day boundary would cut it in the wrong place for most of the world.
 */

/** The stretches of the past a person actually names. A closed list, so an unknown word is an error rather than a guess. */
export const PERIODS = [
  { id: 'last-hour', what: 'the last hour', words: ['hour', 'past hour', 'last hour', '1 hour', 'an hour'] },
  { id: 'last-24-hours', what: 'the last 24 hours', words: ['24 hours', 'last 24 hours', 'past 24 hours', 'last day', 'past day'] },
  { id: 'today', what: 'today, since midnight', words: ['today', "today's", 'since midnight', 'this morning'] },
  { id: 'yesterday', what: 'yesterday, midnight to midnight', words: ['yesterday', "yesterday's"] },
  { id: 'last-7-days', what: 'the last seven days', words: ['7 days', 'last 7 days', 'past 7 days', 'last week', 'past week', 'seven days'] },
  { id: 'this-week', what: 'this week, since Monday', words: ['this week', "this week's", 'since monday'] },
  { id: 'last-4-weeks', what: 'the last four weeks', words: ['4 weeks', 'last 4 weeks', 'past 4 weeks', 'last month', 'past month', 'four weeks', '30 days'] },
  { id: 'this-month', what: 'this month, since the 1st', words: ['this month', "this month's"] },
  { id: 'everything', what: 'all of it, from the beginning', words: ['everything', 'all', 'all time', 'the beginning', 'always', 'ever', 'entire', 'whole'] }
] as const

export type PeriodId = (typeof PERIODS)[number]['id']

/** What `surface.open`-style parameters are allowed to say, for a capability's parameter description. */
export const PERIOD_NAMES: readonly PeriodId[] = PERIODS.map((p) => p.id)

export interface Span {
  /** Inclusive start, epoch ms. 0 means "from the beginning". */
  from: number
  /** Exclusive end, epoch ms. */
  to: number
  /** The period this came from, so a confirmation can say it back in the person's own terms. */
  period: PeriodId
  /** A phrase for a confirmation dialog: "today, since midnight". */
  what: string
}

/**
 * The name a period is known by, from whatever a model or a person actually wrote.
 *
 * Tolerant on the way in and exact on the way out. A model asked for a period will write "Today", "today's",
 * "the last 24 hours" or "all time" with equal confidence, and each of those is the same stretch of time -- so they
 * are normalised to one name here, once, rather than every capability growing its own opinion about which spellings
 * it accepts.
 *
 * Returns null for anything not recognised, which the caller turns into an error. Guessing would be worse: the cost of
 * reading "last month" as "today" is deleting four weeks somebody meant to keep.
 */
export function asPeriod(value: unknown): PeriodId | null {
  const said = String(value ?? '')
    .toLowerCase()
    .replace(/_+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!said) return null

  /*
   * Tried as written before any article is taken off it.
   *
   * "The beginning" is a listed name; strip its "the" first and it becomes "beginning", which is listed nowhere, and a
   * request to clear everything quietly becomes an error. Stripping is a second attempt, not a first.
   */
  for (const raw of [said, said.replace(/^(?:the|from|since|for|in|of) /, '')]) {
    if (!raw) continue
    for (const p of PERIODS) if (p.id === raw) return p.id
    // Longest word first, so "last 24 hours" is not claimed by "hour".
    const byLength = PERIODS.flatMap((p) => p.words.map((w) => ({ id: p.id, w }))).sort((a, b) => b.w.length - a.w.length)
    for (const { id, w } of byLength) if (raw === w || raw.includes(w)) return id
  }
  return null
}

/**
 * The two instants a period covers, as of `now`.
 *
 * `now` is a parameter rather than read from the clock so this is testable and so a single plan cannot drift: every
 * step in one run resolves against the same instant, and a run that straddles midnight does not half-belong to each day.
 */
export function spanOf(period: PeriodId, now: number): Span {
  const what = PERIODS.find((p) => p.id === period)?.what ?? period
  const end = now
  const midnight = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const today = midnight(new Date(now))
  const day = 86_400_000

  switch (period) {
    case 'last-hour':
      return { from: end - 3_600_000, to: end, period, what }
    case 'last-24-hours':
      return { from: end - day, to: end, period, what }
    case 'today':
      return { from: today, to: end, period, what }
    case 'yesterday':
      /*
       * Yesterday ends where today begins, and does not include today.
       *
       * The only period here that is not "up until now", which is exactly why somebody asks for it by name: they want
       * the day before left behind and the day they are in kept.
       */
      return { from: midnight(new Date(today - day)), to: today, period, what }
    case 'last-7-days':
      return { from: end - 7 * day, to: end, period, what }
    case 'this-week': {
      // Monday, because a week that starts on Sunday puts "this week" one day earlier than most people mean on a Sunday.
      const weekday = (new Date(today).getDay() + 6) % 7
      return { from: today - weekday * day, to: end, period, what }
    }
    case 'last-4-weeks':
      return { from: end - 28 * day, to: end, period, what }
    case 'this-month': {
      const d = new Date(now)
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: end, period, what }
    }
    case 'everything':
      return { from: 0, to: end, period, what }
  }
}

/**
 * A span from whatever a plan supplied: a period name, or explicit instants, or both.
 *
 * Explicit numbers win when they are given, because a caller that computed a range knows something this file does not.
 * A period and nothing else is the ordinary case. Neither is an error the caller reports -- not a silent "everything",
 * which is the one default here that could delete somebody's whole history on a typo.
 */
export function readSpan(params: { period?: unknown; from?: unknown; to?: unknown }, now: number): Span | { problem: string } {
  const from = typeof params.from === 'number' && Number.isFinite(params.from) ? params.from : null
  const to = typeof params.to === 'number' && Number.isFinite(params.to) ? params.to : null
  if (from !== null && to !== null) {
    if (to < from) return { problem: 'That time range ends before it starts.' }
    return { from, to, period: 'everything', what: `${new Date(from).toLocaleString()} to ${new Date(to).toLocaleString()}` }
  }

  if (params.period !== undefined && params.period !== null && String(params.period) !== '') {
    const period = asPeriod(params.period)
    if (!period) return { problem: `I do not know the period "${String(params.period)}". Use one of: ${PERIOD_NAMES.join(', ')}.` }
    const span = spanOf(period, now)
    // A half-given range still narrows a named period, so "today, up to 10am" is expressible.
    return { ...span, from: from ?? span.from, to: to ?? span.to }
  }

  if (from !== null) return { from, to: now, period: 'everything', what: `since ${new Date(from).toLocaleString()}` }
  return { problem: `Say which stretch of time: ${PERIOD_NAMES.join(', ')}, or give from and to in epoch milliseconds.` }
}
