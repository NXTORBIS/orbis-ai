import type { AgeBand, ContentCategory, SafetyVerdict } from './types.ts'

/**
 * Orbis Safety: whether a page is appropriate for how old somebody is.
 *
 * This is deliberately not `if (age < 13) block(randomSites)`. There are three separate steps, and keeping them
 * separate is what makes the result explainable:
 *
 *   1. an age band, worked out locally from a date of birth;
 *   2. a category for the page, from its address;
 *   3. a policy saying which categories that band may reach.
 *
 * `unknown` is the category that matters most. A page Orbis has never seen is not assumed to be fine -- for the
 * youngest band it is held back, for everyone else it is allowed, and in both cases the student is told which
 * happened rather than being left to guess why a link did nothing.
 *
 * Pure: no network, no storage, nothing about the person beyond the band handed in.
 */

// ---------------------------------------------------------------- how old somebody is

/** Years between a date of birth and a day, both as local dates. Null when the date cannot be read. */
export function ageOn(dob: string | null, on: Date): number | null {
  if (!dob) return null
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim())
  if (!parts) return null
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // A date that does not exist (31 February) is not a birthday, and must not quietly become one in March.
  const check = new Date(year, month - 1, day)
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null
  let age = on.getFullYear() - year
  const before = on.getMonth() + 1 < month || (on.getMonth() + 1 === month && on.getDate() < day)
  if (before) age -= 1
  if (age < 0 || age > 120) return null
  return age
}

export function bandFor(dob: string | null, on: Date): AgeBand {
  const age = ageOn(dob, on)
  if (age === null) return 'unknown'
  if (age < 10) return 'child'
  if (age < 13) return 'preteen'
  if (age < 16) return 'teen'
  if (age < 18) return 'older-teen'
  return 'adult'
}

export const BAND_LABELS: Record<AgeBand, string> = {
  child: 'Under 10',
  preteen: '10 to 12',
  teen: '13 to 15',
  'older-teen': '16 to 17',
  adult: '18 and over',
  unknown: 'Not set'
}

// ---------------------------------------------------------------- what a page is

/**
 * Hosts Orbis recognises, by what they are for.
 *
 * Short on purpose. This is not a filter list and must not pretend to be one -- it is the set of places common enough
 * that getting them wrong would be noticed, and everything else falls through to the signals below. A list that
 * claimed to cover the web would be a list that is wrong quietly.
 */
const KNOWN: Record<string, ContentCategory> = {
  // learning
  'khanacademy.org': 'education',
  'ncert.nic.in': 'education',
  'coursera.org': 'education',
  'edx.org': 'education',
  'brilliant.org': 'education',
  'byjus.com': 'education',
  'unacademy.com': 'education',
  'physicsclassroom.com': 'education',
  'mathsisfun.com': 'education',
  'desmos.com': 'education',
  'wolframalpha.com': 'education',
  'geeksforgeeks.org': 'education',
  'leetcode.com': 'education',
  'codeforces.com': 'education',
  'hackerrank.com': 'education',
  'exercism.org': 'education',
  'duolingo.com': 'education',
  'ted.com': 'education',
  'openstax.org': 'education',
  'scholar.google.com': 'reference',
  'arxiv.org': 'reference',
  'pubmed.ncbi.nlm.nih.gov': 'reference',
  'wikipedia.org': 'reference',
  'wiktionary.org': 'reference',
  'britannica.com': 'reference',
  'merriam-webster.com': 'reference',
  'dictionary.com': 'reference',
  'stackoverflow.com': 'reference',
  'stackexchange.com': 'reference',
  'developer.mozilla.org': 'reference',
  'docs.python.org': 'reference',
  'nodejs.org': 'reference',
  'typescriptlang.org': 'reference',
  'rust-lang.org': 'reference',
  'go.dev': 'reference',
  'docs.oracle.com': 'reference',
  'learn.microsoft.com': 'reference',
  // getting work done
  'github.com': 'productivity',
  'gitlab.com': 'productivity',
  'notion.so': 'productivity',
  'docs.google.com': 'productivity',
  'drive.google.com': 'productivity',
  'sheets.google.com': 'productivity',
  'overleaf.com': 'productivity',
  'figma.com': 'productivity',
  'canva.com': 'productivity',
  'obsidian.md': 'productivity',
  'anki.net': 'productivity',
  'ankiweb.net': 'productivity',
  'classroom.google.com': 'productivity',
  'calendar.google.com': 'productivity',
  'todoist.com': 'productivity',
  'trello.com': 'productivity',
  // talking
  'mail.google.com': 'communication',
  'outlook.com': 'communication',
  'outlook.office.com': 'communication',
  'slack.com': 'communication',
  'teams.microsoft.com': 'communication',
  'zoom.us': 'communication',
  'meet.google.com': 'communication',
  'discord.com': 'communication',
  'web.whatsapp.com': 'communication',
  'web.telegram.org': 'communication',
  // social
  'instagram.com': 'social',
  'facebook.com': 'social',
  'x.com': 'social',
  'twitter.com': 'social',
  'tiktok.com': 'social',
  'snapchat.com': 'social',
  'reddit.com': 'social',
  'tumblr.com': 'social',
  'pinterest.com': 'social',
  'linkedin.com': 'social',
  'threads.net': 'social',
  'quora.com': 'social',
  'vk.com': 'social',
  'weibo.com': 'social',
  // watching
  'youtube.com': 'streaming',
  'youtu.be': 'streaming',
  'netflix.com': 'streaming',
  'primevideo.com': 'streaming',
  'hotstar.com': 'streaming',
  'disneyplus.com': 'streaming',
  'hulu.com': 'streaming',
  'max.com': 'streaming',
  'twitch.tv': 'streaming',
  'vimeo.com': 'streaming',
  'dailymotion.com': 'streaming',
  'spotify.com': 'entertainment',
  'soundcloud.com': 'entertainment',
  'music.apple.com': 'entertainment',
  'imdb.com': 'entertainment',
  '9gag.com': 'entertainment',
  'buzzfeed.com': 'entertainment',
  // games
  'roblox.com': 'gaming',
  'steampowered.com': 'gaming',
  'store.steampowered.com': 'gaming',
  'epicgames.com': 'gaming',
  'miniclip.com': 'gaming',
  'poki.com': 'gaming',
  'crazygames.com': 'gaming',
  'coolmathgames.com': 'gaming',
  'chess.com': 'gaming',
  'lichess.org': 'gaming',
  'itch.io': 'gaming',
  'minecraft.net': 'gaming',
  // news
  'bbc.com': 'news',
  'bbc.co.uk': 'news',
  'cnn.com': 'news',
  'nytimes.com': 'news',
  'theguardian.com': 'news',
  'reuters.com': 'news',
  'thehindu.com': 'news',
  'indianexpress.com': 'news',
  'timesofindia.indiatimes.com': 'news',
  'news.google.com': 'news',
  'ndtv.com': 'news',
  // buying
  'amazon.com': 'shopping',
  'amazon.in': 'shopping',
  'flipkart.com': 'shopping',
  'ebay.com': 'shopping',
  'aliexpress.com': 'shopping',
  'myntra.com': 'shopping',
  'etsy.com': 'shopping',
  'walmart.com': 'shopping',
  'temu.com': 'shopping',
  'shein.com': 'shopping',
  // the ones with an age on them
  'bet365.com': 'gambling',
  'draftkings.com': 'gambling',
  'stake.com': 'gambling',
  'pokerstars.com': 'gambling',
  'tinder.com': 'dating',
  'bumble.com': 'dating',
  'hinge.co': 'dating',
  'grindr.com': 'dating',
  'okcupid.com': 'dating'
}

/** Words in a host that say what it is, when the host itself is not known. */
const HOST_WORDS: readonly (readonly [RegExp, ContentCategory])[] = [
  [/(^|[.-])(porn|xxx|xvideo|xnxx|hentai|nsfw|camgirl|onlyfans|rule34|sex)([.-]|$)/i, 'adult'],
  [/(^|[.-])(casino|betting|bet|poker|slots|lottery|jackpot|wager)([.-]|$)/i, 'gambling'],
  [/(^|[.-])(dating|hookup|singles|flirt)([.-]|$)/i, 'dating'],
  [/(^|[.-])(torrent|warez|crack|keygen|pirate|nulled)([.-]|$)/i, 'unsafe'],
  [/(^|[.-])(gore|beheading|deathvideo)([.-]|$)/i, 'violent'],
  [/(^|[.-])(game|games|gaming|arcade|io-games)([.-]|$)/i, 'gaming'],
  [/(^|[.-])(shop|store|deals|buy|cart|coupon)([.-]|$)/i, 'shopping'],
  [/(^|[.-])(news|times|herald|tribune|post|daily)([.-]|$)/i, 'news'],
  [/(^|[.-])(docs?|developer|api|reference|manual|wiki)([.-]|$)/i, 'reference'],
  [/(^|[.-])(learn|academy|school|college|university|edu|course|tutorial|study|exam|classroom)([.-]|$)/i, 'education'],
  [/(^|[.-])(stream|watch|tv|movies?|cinema|video)([.-]|$)/i, 'streaming'],
  [/(^|[.-])(mail|webmail|chat|messenger)([.-]|$)/i, 'communication']
]

/** Suffixes that say what an address is for more reliably than any word in it. */
const SUFFIXES: readonly (readonly [string, ContentCategory])[] = [
  ['.edu', 'education'],
  ['.ac.uk', 'education'],
  ['.ac.in', 'education'],
  ['.edu.au', 'education'],
  ['.edu.in', 'education'],
  ['.sch.uk', 'education'],
  ['.gov', 'reference'],
  ['.gov.uk', 'reference'],
  ['.gov.in', 'reference'],
  ['.nic.in', 'reference'],
  ['.int', 'reference']
]

/** Orbis's own addresses: always reachable, whatever any policy says. Blocking the tools is not focus. */
const ORBIS_SCHEMES = ['orbis:', 'orbis-audio:', 'chrome:', 'chrome-extension:', 'chrome-untrusted:', 'about:', 'devtools:', 'blob:', 'data:', 'file:']

export function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    // Not an address at all: a search term typed into the bar, most likely.
    return ''
  }
}

/** Whether a host is the given domain or something under it. `m.youtube.com` is YouTube; `notyoutube.com` is not. */
export function under(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The address of a page, with everything that is not the page taken off.
 *
 * Tracking parameters, session ids and fragments all describe how somebody arrived rather than what they arrived at,
 * so two links to the same page compare equal. This is what stops the study library filling up with the same article
 * five times.
 */
export function canonical(url: string): string {
  try {
    const parsed = new URL(url)
    const drop = /^(utm_|fbclid|gclid|msclkid|mc_eid|mc_cid|igshid|ref|ref_src|ref_url|si|spm|yclid|_ga|__hs|vero_|trk|source)/i
    for (const key of [...parsed.searchParams.keys()]) {
      if (drop.test(key)) parsed.searchParams.delete(key)
    }
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) parsed.port = ''
    // A trailing slash on a bare host is the same page as none.
    let out = parsed.toString()
    if (parsed.pathname === '/' && !parsed.search) out = out.replace(/\/$/, '')
    return out
  } catch {
    return url.trim()
  }
}

/**
 * Which YouTube video or channel an address is, when it is one of those.
 *
 * Needed because YouTube is the one site a student genuinely needs both blocked and open, and the decision has to be
 * about the particular video rather than the host.
 */
export function youtubeRef(url: string): { video: string | null; channel: string | null } | null {
  const host = hostOf(url)
  if (!under(host, 'youtube.com') && !under(host, 'youtu.be')) return null
  try {
    const parsed = new URL(url)
    if (under(host, 'youtu.be')) return { video: parsed.pathname.slice(1) || null, channel: null }
    if (parsed.pathname === '/watch') return { video: parsed.searchParams.get('v'), channel: null }
    const embed = /^\/(embed|shorts|live)\/([^/?#]+)/.exec(parsed.pathname)
    if (embed) return { video: embed[2], channel: null }
    const channel = /^\/(channel|c|user)\/([^/?#]+)/.exec(parsed.pathname)
    if (channel) return { video: null, channel: channel[2] }
    const handle = /^\/@([^/?#]+)/.exec(parsed.pathname)
    if (handle) return { video: null, channel: `@${handle[1]}` }
    return { video: null, channel: null }
  } catch {
    return null
  }
}

/** What Orbis thinks a page is. Custom rules win over everything Orbis worked out itself. */
export function categorise(url: string, custom: Readonly<Record<string, ContentCategory>> = {}): ContentCategory {
  const host = hostOf(url)
  if (!host) return 'unknown'
  for (const [domain, category] of Object.entries(custom)) {
    if (under(host, domain.toLowerCase())) return category
  }
  if (KNOWN[host]) return KNOWN[host]
  for (const [domain, category] of Object.entries(KNOWN)) {
    if (under(host, domain)) return category
  }
  for (const [suffix, category] of SUFFIXES) {
    if (host.endsWith(suffix)) return category
  }
  for (const [pattern, category] of HOST_WORDS) {
    if (pattern.test(host)) return category
  }
  return 'unknown'
}

// ---------------------------------------------------------------- what a band may reach

/**
 * What each band may not reach, and what it is asked about.
 *
 * `held` is stopped outright. `asked` is stopped with the option of asking for an exception, which is the difference
 * between a browser that protects somebody and one that argues with them. `adult` has neither: safety for an adult is
 * whatever they chose themselves.
 */
const BAND_POLICY: Record<AgeBand, { held: readonly ContentCategory[]; asked: readonly ContentCategory[]; unknownHeld: boolean }> = {
  child: { held: ['adult', 'gambling', 'dating', 'unsafe', 'violent'], asked: ['social', 'streaming', 'gaming', 'shopping', 'news'], unknownHeld: true },
  preteen: { held: ['adult', 'gambling', 'dating', 'unsafe', 'violent'], asked: ['social', 'shopping'], unknownHeld: true },
  teen: { held: ['adult', 'gambling', 'dating', 'unsafe'], asked: ['violent'], unknownHeld: false },
  'older-teen': { held: ['adult', 'gambling', 'unsafe'], asked: [], unknownHeld: false },
  adult: { held: [], asked: [], unknownHeld: false },
  // Nobody said. Hold the things that have an age on them by law, allow the rest, and let them set it in Settings.
  unknown: { held: ['adult', 'gambling', 'unsafe'], asked: [], unknownHeld: false }
}

const CATEGORY_WORDS: Record<ContentCategory, string> = {
  education: 'learning',
  reference: 'reference',
  productivity: 'work',
  communication: 'messages',
  social: 'social',
  entertainment: 'entertainment',
  streaming: 'video',
  gaming: 'games',
  gambling: 'gambling',
  adult: 'adult',
  dating: 'dating',
  shopping: 'shopping',
  news: 'news',
  unsafe: 'unsafe',
  violent: 'violent',
  unknown: 'something Orbis has not seen before'
}

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  education: 'Learning',
  reference: 'Reference',
  productivity: 'Work',
  communication: 'Messages',
  social: 'Social',
  entertainment: 'Entertainment',
  streaming: 'Video',
  gaming: 'Games',
  gambling: 'Gambling',
  adult: 'Adult',
  dating: 'Dating',
  shopping: 'Shopping',
  news: 'News',
  unsafe: 'Unsafe',
  violent: 'Violent',
  unknown: 'Unknown'
}

export interface SafetyConfig {
  band: AgeBand
  /** 'strict' treats every band as the band below; 'off' leaves safety to the browser's own settings. */
  override: 'age' | 'strict' | 'off'
  /** Hosts somebody allowed by hand, which beat the category. */
  approved: readonly string[]
  /** Hosts somebody blocked by hand, which beat everything. */
  blocked: readonly string[]
  /** Categories corrected by hand. */
  custom?: Readonly<Record<string, ContentCategory>>
}

const STRICTER: Record<AgeBand, AgeBand> = {
  child: 'child',
  preteen: 'child',
  teen: 'preteen',
  'older-teen': 'teen',
  adult: 'older-teen',
  unknown: 'preteen'
}

/** Whether a host matches one of a list of hosts or URL prefixes. */
export function listed(url: string, list: readonly string[]): boolean {
  const host = hostOf(url)
  const full = url.toLowerCase()
  for (const raw of list) {
    const entry = raw.trim().toLowerCase()
    if (!entry) continue
    if (entry.includes('/')) {
      // A URL prefix: everything under that path.
      const prefix = entry.startsWith('http') ? entry : `https://${entry}`
      if (full.startsWith(prefix) || full.startsWith(prefix.replace('https://', 'http://'))) return true
      continue
    }
    if (host && under(host, entry.replace(/^www\./, ''))) return true
  }
  return false
}

/** Whether a page is appropriate, and why. Says nothing about focus; that is a separate decision. */
export function checkSafety(url: string, config: SafetyConfig): SafetyVerdict {
  const scheme = ORBIS_SCHEMES.find((one) => url.toLowerCase().startsWith(one))
  if (scheme) return { allowed: true, category: 'productivity', source: 'allowed', reason: 'This is part of Orbis.', askable: false }

  const category = categorise(url, config.custom)
  if (listed(url, config.blocked)) {
    return { allowed: false, category, source: 'blocked-list', reason: 'This site is on your blocked list.', askable: false }
  }
  if (listed(url, config.approved)) {
    return { allowed: true, category, source: 'approved-list', reason: 'This site is on your approved list.', askable: false }
  }
  if (config.override === 'off') {
    return { allowed: true, category, source: 'allowed', reason: 'Age protection is off for this profile.', askable: false }
  }
  const band = config.override === 'strict' ? STRICTER[config.band] : config.band
  const policy = BAND_POLICY[band]
  if (policy.held.includes(category)) {
    return { allowed: false, category, source: 'age-policy', reason: `${CATEGORY_LABELS[category]} sites are not available on this profile.`, askable: false }
  }
  if (policy.asked.includes(category)) {
    return { allowed: false, category, source: 'category', reason: `${CATEGORY_LABELS[category]} sites need to be approved on this profile.`, askable: true }
  }
  if (category === 'unknown' && policy.unknownHeld) {
    return {
      allowed: false,
      category,
      source: 'unknown-content',
      // Said plainly: Orbis does not know, and on this profile not knowing means not yet.
      reason: 'Orbis has not seen this site before, so it needs approving first.',
      askable: true
    }
  }
  return { allowed: true, category, source: 'allowed', reason: `This is ${CATEGORY_WORDS[category]}.`, askable: false }
}
