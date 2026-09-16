/**
 * Noticing a CAPTCHA, and getting out of the way.
 *
 * A CAPTCHA is a site asking to be sure there is a person there. Orbis's answer to that question is to go and get one.
 * This module is how Orbis notices it has been asked, stops whatever it was doing, says so plainly, and waits — and it
 * is deliberately incapable of anything else.
 *
 * What it does not do, and cannot be made to do from here: solve a challenge, answer one, read a challenge image,
 * carry a verification token, replay one, hide that automation is running, or tell a workflow that verification
 * happened when it did not. There is no token anywhere in these types. A step that came through a challenge learns
 * one thing about it — `verified: true` — because that is the only thing a step has any business knowing.
 *
 * A challenge is finished when the challenge is no longer on the page. That is the only evidence accepted here, and it
 * comes from looking at the page again, which is the same way Orbis decides anything else worked.
 *
 * Signals arrive from a page, so they are treated as what they are: text written by somebody else. `safeSignals`
 * throws away anything token-shaped before it can be stored, logged, or shown, on the principle that the cheapest way
 * to keep a secret out of a log is never to put it in a structure in the first place.
 */

export type CaptchaProvider = 'recaptcha' | 'hcaptcha' | 'turnstile' | 'arkose' | 'aws-waf' | 'geetest' | 'friendly' | 'unknown'

/** What the person is being asked to do, as far as the page shows. */
export type CaptchaKind =
  /** A box to tick. */
  | 'checkbox'
  /** Running quietly; nothing to do unless it decides otherwise. */
  | 'invisible'
  /** Pictures, puzzles, something to work through. */
  | 'challenge'
  /** A whole page standing in front of the site. */
  | 'interstitial'
  | 'unknown'

export type CaptchaState =
  /** Something looks like a challenge, but not enough to interrupt anybody over. */
  | 'suspected'
  /** There is one, and Orbis has stopped. */
  | 'present'
  /** The person has been asked. */
  | 'awaiting-user'
  /** The page is being looked at again to see whether it is gone. */
  | 'verifying'
  /** It is gone, and the page let Orbis through. */
  | 'solved'
  /** It stood too long. */
  | 'expired'
  /** It was answered and the site was not satisfied. */
  | 'failed'
  /** Nobody dealt with it and the run ended. */
  | 'abandoned'

/**
 * What a page can be asked about without being asked for anything private.
 *
 * Addresses of frames and scripts, the names and roles of elements, and visible words. No cookies, no headers, no form
 * values, no response bodies — none of which are needed to tell a challenge from a page, and all of which are the sort
 * of thing that should not be in a detector's hands.
 */
export interface PageSignals {
  url: string
  title?: string
  /** Addresses of frames in the page. */
  frames?: string[]
  /** Addresses of scripts the page loaded. */
  scripts?: string[]
  /** Ids, classes, names and data attributes of elements, as plain strings. */
  attributes?: string[]
  /** Visible words, in whatever pieces the page reader found them. */
  text?: string[]
  /** The response status, when the page itself was the refusal. */
  status?: number
}

export interface CaptchaDetection {
  provider: CaptchaProvider
  kind: CaptchaKind
  /** 0 to 1. Nothing here is certain, and pretending otherwise would interrupt people over nothing. */
  confidence: number
  /** Whether it is worth stopping for. */
  present: boolean
  /** Why, in the words used to decide. Shown to the person, so it has to be readable. */
  reasons: string[]
}

/** Confident enough to stop and ask. */
export const STOP_AT = 0.6
/** Enough to keep an eye on, not enough to interrupt. */
export const SUSPECT_AT = 0.3

// ---------------------------------------------------------------- what each one looks like

interface ProviderShape {
  provider: CaptchaProvider
  name: string
  /** Strong: these addresses belong to the challenge and nothing else. */
  hosts: string[]
  /** Good: an element the provider puts in the page. */
  attributes: string[]
  kind: CaptchaKind
}

const SHAPES: ProviderShape[] = [
  {
    provider: 'recaptcha',
    name: 'reCAPTCHA',
    hosts: ['google.com/recaptcha', 'recaptcha.net/recaptcha', 'gstatic.com/recaptcha'],
    attributes: ['g-recaptcha', 'recaptcha-checkbox', 'rc-imageselect', 'recaptcha-anchor'],
    kind: 'checkbox'
  },
  {
    provider: 'hcaptcha',
    name: 'hCaptcha',
    hosts: ['hcaptcha.com/captcha', 'js.hcaptcha.com', 'newassets.hcaptcha.com'],
    attributes: ['h-captcha', 'hcaptcha-box', 'challenge-container'],
    kind: 'checkbox'
  },
  {
    provider: 'turnstile',
    name: 'Cloudflare Turnstile',
    hosts: ['challenges.cloudflare.com/turnstile', 'challenges.cloudflare.com/cdn-cgi/challenge-platform'],
    attributes: ['cf-turnstile', 'cf-challenge-running', 'cf-chl-widget'],
    kind: 'interstitial'
  },
  {
    provider: 'arkose',
    name: 'Arkose FunCaptcha',
    hosts: ['arkoselabs.com', 'funcaptcha.com', 'arkoselabs.cn'],
    attributes: ['funcaptcha', 'fc-iframe-wrap', 'arkose'],
    kind: 'challenge'
  },
  {
    provider: 'aws-waf',
    name: 'AWS WAF',
    hosts: ['awswaf.com', 'captcha.awswaf.com'],
    attributes: ['awswaf-captcha', 'captcha-container-aws'],
    kind: 'interstitial'
  },
  {
    provider: 'geetest',
    name: 'GeeTest',
    hosts: ['geetest.com', 'geevisit.com'],
    attributes: ['geetest_holder', 'geetest_panel', 'gt_slider'],
    kind: 'challenge'
  },
  {
    provider: 'friendly',
    name: 'Friendly Captcha',
    hosts: ['friendlycaptcha.com', 'api.friendlycaptcha.com'],
    attributes: ['frc-captcha', 'frc-button'],
    kind: 'invisible'
  }
]

/**
 * Words that mean a challenge whoever put them there.
 *
 * Weak on their own — a page about CAPTCHAs is not a CAPTCHA — so they are worth something only alongside a frame, a
 * script or an element that agrees with them.
 */
const PHRASES: { text: string; kind?: CaptchaKind }[] = [
  { text: "i'm not a robot", kind: 'checkbox' },
  { text: 'i am not a robot', kind: 'checkbox' },
  { text: 'verify you are human', kind: 'checkbox' },
  { text: 'verify you are a human', kind: 'checkbox' },
  { text: 'are you a human', kind: 'checkbox' },
  { text: 'checking your browser', kind: 'interstitial' },
  { text: 'verifying you are human', kind: 'interstitial' },
  { text: 'security check', kind: 'interstitial' },
  { text: 'unusual traffic', kind: 'interstitial' },
  { text: 'complete the security check', kind: 'challenge' },
  { text: 'select all images', kind: 'challenge' },
  { text: 'select all squares', kind: 'challenge' },
  { text: 'solve the puzzle', kind: 'challenge' },
  { text: 'slide to complete', kind: 'challenge' },
  { text: 'enter the characters you see', kind: 'challenge' },
  { text: 'type the characters', kind: 'challenge' },
  { text: 'press and hold', kind: 'challenge' }
]

/** Addresses that are a challenge in themselves. */
const INTERSTITIAL_PATHS = ['/cdn-cgi/challenge-platform', '/sorry/index', '/captcha', '/challenge']

/**
 * What the page looks like it is asking, and how sure that is.
 *
 * Several small agreements rather than one rule: a frame from a provider, an element it left behind, words a person
 * would read, a status that says refused. One of those is a guess; three are not. The score is capped so no single
 * signal can be enough on its own except the ones that only ever mean a challenge.
 */
export function detect(raw: PageSignals): CaptchaDetection {
  const signals = safeSignals(raw)
  const everything = [signals.url, ...(signals.frames ?? []), ...(signals.scripts ?? [])].map((s) => s.toLowerCase())
  const attributes = (signals.attributes ?? []).map((s) => s.toLowerCase())
  const words = (signals.text ?? []).join(' ').toLowerCase()

  let best: { shape: ProviderShape; score: number; reasons: string[] } | null = null
  for (const shape of SHAPES) {
    let score = 0
    const reasons: string[] = []
    if (shape.hosts.some((host) => everything.some((u) => u.includes(host)))) {
      // A frame or script from the provider is as close to certain as this gets: nothing else loads it.
      score += 0.65
      reasons.push(`the page loaded ${shape.name}`)
    }
    if (shape.attributes.some((attr) => attributes.some((a) => a.includes(attr)))) {
      score += 0.4
      reasons.push(`${shape.name} left its widget in the page`)
    }
    if (score > 0 && (!best || score > best.score)) best = { shape, score, reasons }
  }

  const phrase = PHRASES.find((p) => words.includes(p.text))
  const interstitialPath = INTERSTITIAL_PATHS.some((path) => signals.url.toLowerCase().includes(path))
  const refused = signals.status === 403 || signals.status === 429

  let score = best?.score ?? 0
  const reasons = [...(best?.reasons ?? [])]
  let kind: CaptchaKind = best?.shape.kind ?? 'unknown'

  if (phrase) {
    score += best ? 0.25 : 0.35
    reasons.push(`the page says “${phrase.text}”`)
    // What the page asks for beats what the provider usually asks for: the same widget shows a box or a puzzle.
    if (phrase.kind && (phrase.kind === 'challenge' || kind === 'unknown' || kind === 'checkbox')) kind = phrase.kind
  }
  if (interstitialPath) {
    score += 0.3
    reasons.push('the address is a challenge page')
    if (kind === 'unknown') kind = 'interstitial'
  }
  if (refused && (phrase || best || interstitialPath)) {
    score += 0.15
    reasons.push(`the site answered ${signals.status}`)
  }

  const confidence = Math.min(1, Math.round(score * 100) / 100)
  return {
    provider: best?.shape.provider ?? 'unknown',
    kind,
    confidence,
    present: confidence >= STOP_AT,
    reasons
  }
}

// ---------------------------------------------------------------- keeping secrets out

/** Field names that are the answer to a challenge, or the way back into an account. */
const NEVER = [
  'g-recaptcha-response',
  'h-captcha-response',
  'cf-turnstile-response',
  'cf_clearance',
  'captcha-token',
  'captcha_token',
  'verification-token',
  'authorization',
  'cookie',
  'set-cookie',
  'session',
  'csrf',
  'x-api-key',
  'bearer',
  'password',
  'otp',
  'mfa'
]

/** A long unbroken run of token characters. Nothing a person reads looks like this; plenty of secrets do. */
const TOKEN_SHAPED = /[A-Za-z0-9_-]{40,}/

/**
 * Everything the page said, minus anything that looks like a secret.
 *
 * Detection needs none of it: whether a challenge is on the page is decided by frames, widgets and words, never by the
 * answer to one. So the answer is dropped here, before it can be stored on an encounter, written to a log, or sent to
 * a model. Anything token-shaped goes too, named or not — a secret that arrives under an unfamiliar name is still a
 * secret, and this errs towards throwing away something harmless.
 */
export function safeSignals(signals: PageSignals): PageSignals {
  const clean = (values: string[] | undefined): string[] | undefined =>
    values?.filter((value) => {
      const lower = value.toLowerCase()
      if (NEVER.some((name) => lower.includes(name))) return false
      return !TOKEN_SHAPED.test(value)
    })
  return {
    // Addresses keep their host and path; a query string is where tokens travel, so it does not come along.
    url: stripQuery(signals.url),
    title: signals.title,
    frames: clean(signals.frames?.map(stripQuery)),
    scripts: clean(signals.scripts?.map(stripQuery)),
    attributes: clean(signals.attributes),
    text: clean(signals.text),
    status: signals.status
  }
}

function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

// ---------------------------------------------------------------- one encounter, from noticing to gone

export interface CaptchaEncounter {
  id: string
  /** The tab it is in. A challenge in one tab does not stop another. */
  tabId: string
  profileId: string
  /** Where it was, without the query string. */
  url: string
  provider: CaptchaProvider
  kind: CaptchaKind
  confidence: number
  reasons: string[]
  state: CaptchaState
  noticedAt: number
  /** When the person was asked. */
  askedAt?: number
  endedAt?: number
  /** How many times the page has been looked at to see whether it is gone. */
  checks: number
  /** How many times it has come back after apparently being finished. */
  reappearances: number
  /** Said plainly, for the person and for the log. */
  note?: string
}

/** How long a challenge may stand before Orbis stops waiting and says so. */
export const WAIT_LIMIT_MS = 5 * 60 * 1000
/** How many times the same challenge may come back before Orbis stops trying to get past it. */
export const REAPPEAR_LIMIT = 3

export function notice(detection: CaptchaDetection, where: { id: string; tabId: string; profileId: string; url: string }, now = Date.now()): CaptchaEncounter | null {
  if (detection.confidence < SUSPECT_AT) return null
  return {
    id: where.id,
    tabId: where.tabId,
    profileId: where.profileId,
    url: stripQuery(where.url),
    provider: detection.provider,
    kind: detection.kind,
    confidence: detection.confidence,
    reasons: detection.reasons,
    state: detection.present ? 'present' : 'suspected',
    noticedAt: now,
    checks: 0,
    reappearances: 0
  }
}

/** The person has been told. Orbis is not doing anything else in this tab until they say otherwise. */
export function askUser(encounter: CaptchaEncounter, now = Date.now()): CaptchaEncounter {
  if (encounter.state !== 'present' && encounter.state !== 'suspected') return encounter
  return { ...encounter, state: 'awaiting-user', askedAt: now, note: assistance(encounter) }
}

/**
 * Looks at the page again.
 *
 * This is the only way an encounter ends well, and what decides it is whether the challenge is still there — not
 * whether anybody said they finished it, and not any value the page handed back. A challenge that is gone is finished;
 * a challenge that is still showing is not, however it was answered.
 */
export function recheck(encounter: CaptchaEncounter, signals: PageSignals, now = Date.now()): CaptchaEncounter {
  if (encounter.state === 'solved' || encounter.state === 'abandoned' || encounter.state === 'expired') return encounter
  const again = detect(signals)
  const checked = { ...encounter, state: 'verifying' as CaptchaState, checks: encounter.checks + 1 }

  if (!again.present) {
    return { ...checked, state: 'solved', endedAt: now, note: 'The challenge is no longer on the page.' }
  }
  if (encounter.state === 'awaiting-user' && now - (encounter.askedAt ?? encounter.noticedAt) > WAIT_LIMIT_MS) {
    return { ...checked, state: 'expired', endedAt: now, note: 'The challenge was still there after five minutes, so Orbis stopped waiting.' }
  }
  // Still showing, and still within the time: the person is presumably working on it.
  return { ...checked, state: 'awaiting-user', confidence: again.confidence, reasons: again.reasons }
}

/** It came back after apparently being done, which usually means the site is not satisfied. */
export function reappeared(encounter: CaptchaEncounter, now = Date.now()): CaptchaEncounter {
  const count = encounter.reappearances + 1
  if (count >= REAPPEAR_LIMIT) {
    return {
      ...encounter,
      state: 'failed',
      reappearances: count,
      endedAt: now,
      note: `The site asked to check again ${count} times, so Orbis stopped. It may not want this done automatically.`
    }
  }
  return { ...encounter, state: 'present', reappearances: count, askedAt: undefined, endedAt: undefined, note: 'The site is asking again.' }
}

/** Nobody dealt with it, and whatever was running has ended. */
export function abandon(encounter: CaptchaEncounter, why: string, now = Date.now()): CaptchaEncounter {
  if (encounter.state === 'solved') return encounter
  return { ...encounter, state: 'abandoned', endedAt: now, note: why }
}

export function isOpen(encounter: CaptchaEncounter): boolean {
  return encounter.state === 'suspected' || encounter.state === 'present' || encounter.state === 'awaiting-user' || encounter.state === 'verifying'
}

/** What a step is allowed to learn about a challenge: that it was got through, and nothing about how. */
export function verified(encounter: CaptchaEncounter): boolean {
  return encounter.state === 'solved'
}

// ---------------------------------------------------------------- what to say, and what to offer

/** What the person is being asked to do, in a sentence, without telling them how to answer it. */
export function assistance(encounter: CaptchaEncounter): string {
  const site = siteOf(encounter.url)
  switch (encounter.kind) {
    case 'checkbox':
      return `${site} wants to check you are a person. Tick the box on the page and Orbis will carry on.`
    case 'challenge':
      return `${site} has asked for a puzzle to be worked through. Finish it on the page and Orbis will carry on.`
    case 'interstitial':
      return `${site} is checking the browser before letting anyone in. Once it lets you through, Orbis will carry on.`
    case 'invisible':
      return `${site} is verifying quietly. If it asks for anything, do it on the page and Orbis will carry on.`
    default:
      return `${site} has asked to verify you are a person. Deal with it on the page and Orbis will carry on.`
  }
}

/** What Orbis offers to do, all of which is help finding the thing — none of which is answering it. */
export type CaptchaAction = 'show' | 'focus-tab' | 'scroll-to' | 'skip' | 'stop'

export function actions(encounter: CaptchaEncounter): CaptchaAction[] {
  if (!isOpen(encounter)) return []
  return encounter.kind === 'interstitial' ? ['focus-tab', 'skip', 'stop'] : ['focus-tab', 'scroll-to', 'skip', 'stop']
}

function siteOf(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/]+)/i)
  return match ? match[1].replace(/^www\./, '') : 'This site'
}

// ---------------------------------------------------------------- the rest of Orbis

/**
 * The challenge as a step, so a run that hits one pauses through the machinery it already has.
 *
 * Deliberately a step like any other: it waits for a person, and afterwards the page is looked at again like anything
 * else. Nothing about a challenge deserves a second way of running things.
 */
export function captchaStep(encounter: CaptchaEncounter): { intent: string; needsUser: string; target: { tabId: string } } {
  return { intent: `Wait while you verify on ${siteOf(encounter.url)}`, needsUser: assistance(encounter), target: { tabId: encounter.tabId } }
}

/** An encounter as it may be shown or written down. Already free of secrets, and checked again here. */
export function publicEncounter(encounter: CaptchaEncounter): CaptchaEncounter {
  return { ...encounter, reasons: encounter.reasons.filter((reason) => !TOKEN_SHAPED.test(reason)) }
}
