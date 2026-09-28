/**
 * What changed on a page, and whether it mattered.
 *
 * A workflow that watches a page and reports every difference is a workflow nobody keeps switched on for a week. Real
 * pages churn constantly without meaning anything: a clock, a view counter, a rotating advert, a session id in a link,
 * a "3 minutes ago" that is now "4 minutes ago", a CSRF token. Treating those as news trains the person to ignore the
 * notifications, and then the one that mattered is ignored too.
 *
 * So this separates the two. Noise is recognised by shape -- the things that always change and never mean anything --
 * and what remains is reported with what it actually was and what it actually became. Nothing is summarised into "the
 * page changed"; a monitor that cannot say what changed has not watched anything.
 *
 * The comparison is over text, not markup. A site that rewrites its class names nightly has not changed for a reader,
 * and a monitor that fires on that is measuring the site's build process.
 */

/** A difference worth telling somebody about. */
export interface Change {
  kind: 'added' | 'removed' | 'changed'
  /** The text as it was. Empty for something added. */
  before: string
  /** The text as it is. Empty for something removed. */
  after: string
  /** Where in the page it sits, as a line number, so two changes can be told apart. */
  line: number
}

export interface Comparison {
  changed: boolean
  changes: Change[]
  /** How many differences were recognised as noise and left out. Counted so "nothing changed" can be trusted. */
  ignored: number
  /** In words, for a notification. Says what changed, never just that something did. */
  summary: string
}

/**
 * Things that change on their own and mean nothing.
 *
 * Each of these is a shape rather than a site: a clock is a clock on every page that has one. A line matching any of
 * them is compared with its own pattern removed, so "Updated 3 minutes ago · 412 views" and "Updated 4 minutes ago ·
 * 413 views" are the same line, while "Updated 3 minutes ago · In stock" and "Updated 4 minutes ago · Sold out" are
 * not -- the noise is stripped from both and what is left still differs.
 */
const NOISE = [
  /\b\d{1,2}:\d{2}(:\d{2})?\s?(am|pm)?\b/gi,
  /\b\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago\b/gi,
  /\b(just now|moments ago|today|yesterday)\b/gi,
  /\b\d{1,3}(,\d{3})*\s+(views?|reads?|comments?|shares?|likes?|online|watching)\b/gi,
  /\b(session|csrf|nonce|token|requestid|traceid)[=:\s-][a-z0-9-]{6,}\b/gi,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /[?&](utm_[a-z]+|fbclid|gclid|ref|sid|_t)=[^\s&]+/gi,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\bcopyright\s*(©|\(c\))?\s*\d{4}\b/gi,
  /\b(advertisement|sponsored|ad choices)\b/gi
]

/** A line with its noise taken out, for comparing. Empty when the line was nothing but noise. */
export function withoutNoise(line: string): string {
  let text = String(line ?? '')
  for (const pattern of NOISE) text = text.replace(pattern, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

/** Page text as comparable lines: trimmed, empties dropped, so reflowing whitespace is not a change. */
const lines = (text: string): string[] =>
  String(text ?? '')
    .split(/\r?\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

/**
 * How much two lines have in common, for telling "this line was edited" from "this line was replaced".
 *
 * Two measures, because the interesting case defeats either alone. Shared words catch "£24.99" becoming "£19.99".
 * A shared prefix or suffix catches "Availability: In stock" becoming "Availability: Sold out" -- which has almost no
 * words in common and is obviously the same line, and which is exactly what a monitor is usually watching. The
 * stronger of the two decides.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (!left || !right) return 0

  const words = (s: string): Set<string> => new Set(s.split(/[^a-z0-9]+/).filter(Boolean))
  const lw = words(left)
  const rw = words(right)
  let shared = 0
  for (const w of lw) if (rw.has(w)) shared += 1
  const byWord = lw.size && rw.size ? (2 * shared) / (lw.size + rw.size) : 0

  // The label a value hangs off: how much of the shorter line is identical at the start or the end.
  let prefix = 0
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix += 1
  }
  const byShape = (prefix + suffix) / Math.min(left.length, right.length)

  return Math.max(byWord, byShape)
}

/** Lines that look like the same line edited, rather than one removed and another added. */
const EDITED = 0.5

/**
 * What changed between two readings of a page.
 *
 * Lines that only differ in their noise are not changes. What is left is matched up so an edited line is reported as
 * an edit -- "£24.99" becoming "£19.99" is one change with both values, not a removal and an addition that somebody
 * has to put back together themselves.
 */
export function compare(before: string, after: string, limit = 20): Comparison {
  const was = lines(before)
  const now = lines(after)

  const wasClean = was.map(withoutNoise)
  const nowClean = now.map(withoutNoise)

  // Lines present in both, ignoring noise, are unchanged whatever their raw text says.
  const nowCounts = new Map<string, number>()
  for (const line of nowClean) if (line) nowCounts.set(line, (nowCounts.get(line) ?? 0) + 1)

  let ignored = 0
  const removed: { text: string; line: number }[] = []
  for (const [i, clean] of wasClean.entries()) {
    if (!clean) { ignored += 1; continue }
    const count = nowCounts.get(clean) ?? 0
    if (count > 0) {
      nowCounts.set(clean, count - 1)
      continue
    }
    removed.push({ text: was[i], line: i + 1 })
  }

  const added: { text: string; line: number }[] = []
  const leftover = new Map(nowCounts)
  for (const [i, clean] of nowClean.entries()) {
    if (!clean) { ignored += 1; continue }
    const count = leftover.get(clean) ?? 0
    if (count > 0) {
      leftover.set(clean, count - 1)
      added.push({ text: now[i], line: i + 1 })
    }
  }

  // Pair up what looks like the same line edited, so a price change reads as a price change.
  const changes: Change[] = []
  const usedAdds = new Set<number>()
  for (const gone of removed) {
    let best = -1
    let score = 0
    for (const [i, arrival] of added.entries()) {
      if (usedAdds.has(i)) continue
      const s = similarity(withoutNoise(gone.text), withoutNoise(arrival.text))
      if (s > score) { score = s; best = i }
    }
    if (best >= 0 && score >= EDITED) {
      usedAdds.add(best)
      changes.push({ kind: 'changed', before: gone.text, after: added[best].text, line: gone.line })
    } else {
      changes.push({ kind: 'removed', before: gone.text, after: '', line: gone.line })
    }
  }
  for (const [i, arrival] of added.entries()) {
    if (usedAdds.has(i)) continue
    changes.push({ kind: 'added', before: '', after: arrival.text, line: arrival.line })
  }

  changes.sort((a, b) => a.line - b.line)
  const kept = changes.slice(0, limit)
  return {
    changed: changes.length > 0,
    changes: kept,
    ignored,
    summary: describe(changes, kept.length)
  }
}

/** What changed, in a sentence somebody could act on without opening the page. */
function describe(changes: Change[], shown: number): string {
  if (!changes.length) return 'Nothing meaningful changed.'
  const edited = changes.filter((c) => c.kind === 'changed')
  const parts: string[] = []
  if (edited.length) {
    const first = edited[0]
    const from = first.before.length > 60 ? `${first.before.slice(0, 57)}…` : first.before
    const to = first.after.length > 60 ? `${first.after.slice(0, 57)}…` : first.after
    parts.push(`“${from}” became “${to}”`)
  }
  const gained = changes.filter((c) => c.kind === 'added').length
  const lost = changes.filter((c) => c.kind === 'removed').length
  if (gained) parts.push(`${gained} line${gained === 1 ? '' : 's'} added`)
  if (lost) parts.push(`${lost} line${lost === 1 ? '' : 's'} gone`)
  const more = changes.length > shown ? ` (${changes.length - shown} more)` : ''
  return `${parts.join('; ')}${more}.`
}

// ---------------------------------------------------------------- when a page stops being the page

export type Anomaly = 'gone' | 'blocked' | 'emptied' | 'replaced' | 'rate-limited'

export interface AnomalyReport {
  anomaly: Anomaly
  /** What was seen, in words. A monitor that shouts "changed!" at a sign-in wall is not watching the page. */
  detail: string
}

const BLOCKED = /\b(access denied|forbidden|403|unusual traffic|are you a robot|verify you are human|captcha|sign in to continue|log in to view|subscribe to (read|continue))\b/i
const GONE = /\b(404|page not found|no longer available|this page (has been )?(removed|deleted)|content unavailable)\b/i
const LIMITED = /\b(too many requests|429|rate limit|slow down|try again later)\b/i

/**
 * Whether the page stopped being the page, rather than changing.
 *
 * The difference matters because the response is different. A price that changed is news. A page that now says "verify
 * you are human" is not news about the price -- it is the monitor being locked out, and reporting it as a change would
 * be reporting a fact about the watcher as a fact about the world.
 */
export function anomaly(before: string, after: string): AnomalyReport | null {
  const now = String(after ?? '')
  const was = String(before ?? '')
  if (LIMITED.test(now) && !LIMITED.test(was)) return { anomaly: 'rate-limited', detail: 'The site is asking Orbis to slow down. Nothing about the page itself has been read.' }
  if (BLOCKED.test(now) && !BLOCKED.test(was)) return { anomaly: 'blocked', detail: 'The page now asks for a sign-in or a human check, so what it says cannot be read.' }
  if (GONE.test(now) && !GONE.test(was)) return { anomaly: 'gone', detail: 'The page is no longer there.' }

  const wasLines = lines(was).length
  const nowLines = lines(now).length
  if (wasLines >= 10 && nowLines === 0) return { anomaly: 'emptied', detail: 'The page came back empty. It may not have finished loading.' }
  // Almost nothing in common, with real content on both sides, is a different page rather than an edited one.
  if (wasLines >= 10 && nowLines >= 10) {
    const before20 = new Set(lines(was).slice(0, 40).map(withoutNoise).filter(Boolean))
    const after20 = lines(now).slice(0, 40).map(withoutNoise).filter(Boolean)
    const shared = after20.filter((l) => before20.has(l)).length
    if (before20.size && shared / Math.max(1, after20.length) < 0.1) {
      return { anomaly: 'replaced', detail: 'Almost nothing on the page is what it was. This looks like a different page rather than a change.' }
    }
  }
  return null
}
