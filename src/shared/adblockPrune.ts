/**
 * Response-pruning rules: the advertising layer that a network rule cannot reach.
 *
 * Almost all advertising is separable by where it comes from, and Orbis blocks it there -- before the request, in
 * Chromium's own network stack. This file is for the case where that is impossible, and it is worth being precise
 * about what that case is, because it is the only justification for reaching into a response at all:
 *
 *   **The advertisement and the content are the same kind of file, from the same host, over the same path.**
 *
 * YouTube is the example everybody meets. A pre-roll is an MP4 fetched from `rr1---sn-xyz.googlevideo.com/videoplayback`
 * and so is the video; there is no hostname, path or resource type that tells them apart. Measured on this build: of
 * two `videoplayback` requests on a monetised video, one was blocked and one allowed, and the advertisement played
 * regardless. No amount of better network rules fixes that, because the information needed to decide is not in the
 * request.
 *
 * What *is* separable is the instruction. The player asks its server what to play and is told, in JSON, both where the
 * video is and where the advertisements go. Removing the advertising fields leaves the player with nothing to play.
 * That is a smaller, safer intervention than any of the alternatives: no request is guessed at, no element is hidden,
 * no stream is touched, and the video that plays is fetched and decoded exactly as before.
 *
 * WHAT THIS IS NOT ALLOWED TO BE
 *
 *   - It is not a general licence to rewrite responses. A site appears here only when the same-origin argument above
 *     actually holds for it, and only the named fields are touched.
 *   - It is not DRM circumvention. Nothing here decrypts, forges a licence or alters protected media.
 *   - It is not a selector hack. It matches no class names, so a redesign of the page does not affect it.
 *
 * The rules are data, in one table, so that a change in what a site calls its advertising fields is a change to this
 * table rather than to any code.
 */

export interface PruneRule {
  /** Which site this applies to. Matched against the page's hostname, with subdomains. */
  hosts: string[]
  /** Endpoints whose JSON responses carry the instruction, matched against the request URL. */
  endpoints: RegExp
  /**
   * Globals the page assigns the same document to, which have no request to intercept.
   *
   * These are written by an inline script in the HTML, so the only place to stand is a property that prunes on
   * assignment.
   */
  globals: string[]
  /**
   * The fields to remove.
   *
   * Explicit names, never a pattern. A pattern over "anything containing ad" reaches `adaptiveFormats` -- which is how
   * the video itself is described -- and removing that does not block an advertisement, it breaks playback.
   */
  fields: string[]
  /** Fields whose presence means this really is the document we think it is, so nothing else is touched. */
  signature: string[]
}

export const PRUNE_RULES: PruneRule[] = [
  {
    hosts: ['youtube.com', 'youtube-nocookie.com', 'youtubekids.com'],
    endpoints: /\/youtubei\/v[0-9]+\/(player|reel\/reel_item_watch|next)\b/,
    globals: ['ytInitialPlayerResponse', 'playerResponse'],
    fields: [
      // Where advertisements go in the timeline: pre-roll, mid-roll, post-roll.
      'adPlacements',
      // The advertisements the player should load.
      'playerAds',
      // The newer slot form of the same instruction.
      'adSlots',
      // What the player reports back while an advertisement is running.
      'adBreakHeartbeatParams',
      // The serving record attached to a placement.
      'adServingDataEntity'
    ],
    signature: ['streamingData', 'videoDetails', 'playerConfig', 'playabilityStatus']
  }
]

/** The rule for a hostname, or null when Orbis has no business touching this site's responses. */
export function ruleForHost(hostname: string): PruneRule | null {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '')
  if (!host) return null
  for (const rule of PRUNE_RULES) {
    for (const h of rule.hosts) {
      if (host === h || host.endsWith(`.${h}`)) return rule
    }
  }
  return null
}

/**
 * Whether a value looks like the document a rule is about.
 *
 * Checked before anything is removed, so that a response which merely happens to have a field of the same name is left
 * alone. Pruning the wrong document is how a blocker breaks a site.
 */
export function matchesSignature(value: unknown, rule: PruneRule): boolean {
  if (!value || typeof value !== 'object') return false
  const o = value as Record<string, unknown>
  return rule.signature.some((f) => f in o) || rule.fields.some((f) => f in o)
}

/** Wrappers a response is commonly delivered inside. */
const WRAPPERS = ['playerResponse', 'player_response', 'response']

export interface PruneResult {
  /** Whether anything was actually removed. Only a real removal is ever counted anywhere. */
  changed: boolean
  /** Which fields were removed, for the decision trace. */
  fields: string[]
}

/**
 * Removes a rule's advertising fields from a value, in place.
 *
 * In place and shallow -- the top level plus the known wrappers -- because this runs on every navigation and the
 * documents are large. A deep walk would cost far more and find nothing extra: these fields live where the rule says.
 *
 * An array field becomes an empty array rather than disappearing. The player checks length; a missing key has been
 * observed to send it looking elsewhere for the value.
 */
export function pruneValue(value: unknown, rule: PruneRule, depth = 0): PruneResult {
  if (!value || typeof value !== 'object' || depth > 2) return { changed: false, fields: [] }
  const o = value as Record<string, unknown>
  const removed: string[] = []

  if (matchesSignature(o, rule)) {
    for (const field of rule.fields) {
      if (o[field] === undefined) continue
      o[field] = Array.isArray(o[field]) ? [] : undefined
      removed.push(field)
    }
  }
  for (const wrapper of WRAPPERS) {
    const inner = o[wrapper]
    if (inner && typeof inner === 'object') removed.push(...pruneValue(inner, rule, depth + 1).fields)
  }
  return { changed: removed.length > 0, fields: removed }
}
