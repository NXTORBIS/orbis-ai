/**
 * Handing on something you highlighted, with where it came from.
 *
 * Orbis has no account anywhere -- no service to post to, no server of its own, no permission to send as anybody. So
 * "share" here means what it honestly can mean: the words, the page they came from and its address, put somewhere the
 * person can hand on themselves. What it must never mean is a button that says "Shared!" and did nothing, which is
 * the easiest thing in the world to build and the reason nobody trusts a share button.
 *
 * Three rules:
 *
 * **Copied is not shared.** If the thing that happened was a copy, the words on screen say copied. Every wording in
 * this file is written so that it cannot be read as "it has been sent to somebody".
 *
 * **The address is the real one, with the private parts taken out.** A page's address often carries a session token,
 * a reset key or a one-time link in its query. Handing that on hands somebody your login. Those are stripped, and
 * only those: the rest of the address is left exactly as it is, because an address Orbis has quietly rewritten is one
 * that may no longer go where it went.
 *
 * **Nothing is invented.** No title where the page had none, no address for something that has none, no source line
 * for a selection that came from nowhere in particular.
 */

/** What a share is made of. Only what was really there: a missing field is missing, never filled in. */
export interface SharePayload {
  /** The words, exactly as selected. */
  readonly text: string
  /** The page's title, or null when it had none. */
  readonly title: string | null
  /** The page's address, with private parameters removed, or null when there is not a sharable one. */
  readonly url: string | null
  /** The site, for a short attribution line. Null when there is no address. */
  readonly site: string | null
}

/** How the share ended. Each is a different thing and is said differently. */
export type ShareOutcome = 'copied' | 'drafted' | 'cancelled' | 'failed' | 'unavailable'

/**
 * Query parameters that carry a way in rather than a way to the page.
 *
 * Named, not guessed at by shape: a parameter is removed because it is known to be a credential, and anything else is
 * left alone. Guessing would quietly break ordinary links, which is a worse failure than it looks -- a shared link
 * that goes to the wrong place is indistinguishable from the right one until somebody opens it.
 */
const PRIVATE_PARAMS = new Set([
  'access_token',
  'id_token',
  'refresh_token',
  'token',
  'auth',
  'authorization',
  'apikey',
  'api_key',
  'key',
  'secret',
  'client_secret',
  'password',
  'passwd',
  'pwd',
  'session',
  'sessionid',
  'sid',
  'sig',
  'signature',
  'code',
  'otp',
  'invite',
  'invitation',
  'reset',
  'reset_token',
  'confirmation_token',
  'unsubscribe_token',
  'share_token',
  'magic',
  'magiclink'
])

/** The longest address worth carrying. Past this it is almost certainly a one-time link rather than a page. */
const MAX_URL = 2000

/**
 * The address to hand on, or null when there is not one.
 *
 * `null` for anything that is not an ordinary web page -- a file on this computer, one of the browser's own screens,
 * a `data:` URL -- because those mean nothing to whoever receives them and one of them is a copy of the page itself.
 */
export function sharableUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // A user and password in the address is a credential, and no part of it is worth handing on.
  parsed.username = ''
  parsed.password = ''
  for (const name of [...parsed.searchParams.keys()]) {
    if (PRIVATE_PARAMS.has(name.toLowerCase())) parsed.searchParams.delete(name)
  }
  // A fragment can carry a token too, and is the one part of an address the server never sees anyway.
  if (/\b(access_token|id_token|token|key|secret)=/i.test(parsed.hash)) parsed.hash = ''
  const out = parsed.toString()
  return out.length > MAX_URL ? null : out
}

/** The site, for a short attribution line. */
export function siteOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** How much text a share carries. Past this it is cut, and the cut is said rather than done quietly. */
export const MAX_SHARE_TEXT = 8000

export interface BuiltShare {
  readonly payload: SharePayload
  /** True when the text had to be cut. Said to the person; never done silently. */
  readonly shortened: boolean
}

/** What to hand on, from what was selected and the page it was on. */
export function buildShare(input: { text: string; title?: string | null; url?: string | null }): BuiltShare {
  const whole = String(input.text ?? '')
  const shortened = whole.length > MAX_SHARE_TEXT
  const text = shortened ? `${whole.slice(0, MAX_SHARE_TEXT).trimEnd()}…` : whole
  const url = input.url ? sharableUrl(input.url) : null
  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim().slice(0, 300) : null
  return { payload: { text, title, url, site: siteOf(url) }, shortened }
}

const LF = String.fromCharCode(10)

/**
 * The share as plain text: the quote, then where it came from.
 *
 * A quote and its source, in the shape somebody would write by hand. Nothing is added that was not there -- a
 * selection from a page with no title and no address is just the words, which is the honest thing to hand on.
 */
export function shareText(payload: SharePayload): string {
  const parts = [payload.text.trim()]
  const source = [payload.title, payload.url].filter((one): one is string => Boolean(one))
  if (source.length) parts.push(`— ${source.join(LF)}`)
  return parts.join(LF + LF)
}

/** The subject line for a mail draft. The page's title, or the first few words when it had none. */
export function shareSubject(payload: SharePayload): string {
  if (payload.title) return payload.title.slice(0, 120)
  const words = payload.text.trim().split(/\s+/).slice(0, 9).join(' ')
  return words.length > 120 ? `${words.slice(0, 117)}…` : words || 'Something I highlighted'
}

/**
 * What to tell somebody, given what really happened.
 *
 * Each outcome has its own sentence and none of them can be mistaken for another. "Copied" never says shared;
 * "cancelled" is not reported as a failure, because somebody who changed their mind has not hit a problem.
 */
export function shareSaid(outcome: ShareOutcome, shortened = false): string {
  const cut = shortened ? ' It was longer than a share carries, so the end is not in it.' : ''
  switch (outcome) {
    case 'copied':
      // Deliberately not "Shared". Nothing left this computer.
      return `Copied the highlighted text, with where it came from. Paste it wherever you want it.${cut}`
    case 'drafted':
      return `Opened a draft message with the highlighted text in it. Sending it is yours to do.${cut}`
    case 'cancelled':
      return 'Nothing was shared.'
    case 'unavailable':
      return 'There is nothing on this computer Orbis can hand this to.'
    default:
      return 'Orbis could not share that.'
  }
}

/** A `mailto:` for the computer's own mail program, or null when there is nothing worth opening one for. */
export function mailtoFor(payload: SharePayload): string | null {
  const body = shareText(payload)
  if (!body.trim()) return null
  // Address left empty on purpose: who it goes to is the person's choice, made in their own mail program.
  return `mailto:?subject=${encodeURIComponent(shareSubject(payload))}&body=${encodeURIComponent(body.slice(0, 1800))}`
}
