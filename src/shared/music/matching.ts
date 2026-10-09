/**
 * Finding the track somebody already has, from a line of somebody else's playlist.
 *
 * ## Why this is staged rather than one score
 *
 * The signals are not equal. An ISRC is an answer; a title and an artist are a strong hint; a title alone is a
 * coin toss. Rolling them into one number loses that, and the lost part is exactly what decides whether a match
 * can be accepted without asking. So the stages run in order of how much they prove, the first one that answers
 * wins, and the answer carries **which stage found it** — which is what the screen shows and what the thresholds
 * are set against.
 *
 * ## The rule the whole file exists to keep
 *
 * **A low-confidence match is never taken.** It becomes a question for the student, with the candidates listed.
 * Taking an uncertain match silently is how somebody's playlist quietly fills with the wrong recordings: a live
 * version where they wanted the studio one, a cover where they wanted the original. That is worse than an
 * unmatched row, because an unmatched row is visible and a wrong match is not.
 *
 * ## Versions are not duplicates
 *
 * A remaster is not the original. A live take is not the studio take. `identity.ts` already knows the difference;
 * this keeps it, and when a wanted track has no version marking but the library has three versions of it, that is
 * an **ambiguous** answer with the versions offered, not a quiet pick of the first one.
 */

import { compare, identityKey, plainArtist, plainTitle, versionOf, type Identifiable, type Version } from './identity.ts'

/** Which signal found it. In order of how much each one proves. */
export type Stage = 'provider-id' | 'isrc' | 'exact' | 'artist-title' | 'album' | 'duration' | 'version' | 'fuzzy'

export type Band = 'certain' | 'strong' | 'ambiguous' | 'manual'

export interface Candidate<T> {
  track: T
  /** 0..1. What the stage and the agreeing signals came to. */
  score: number
  stage: Stage
  band: Band
  /** The plain reasons, for the row that shows the student why. */
  why: string[]
  version: Version
}

export interface MatchResult<T> {
  /** Taken only when the band allows it. Null is an honest answer, not a failure. */
  match: T | null
  band: Band
  stage: Stage | null
  score: number
  why: string[]
  /** Everything that was in the running, best first. Shown when the student is asked. */
  candidates: readonly Candidate<T>[]
  /** Why there is no match, when there is none. */
  reason: string | null
}

/**
 * What a line of somebody else's playlist looks like once it has been read.
 *
 * Everything is optional except the title, because every source gives a different amount: a Spotify export has an
 * ISRC and a provider id, an M3U has a path and perhaps a title, a CSV has whatever the exporter felt like.
 */
export interface Wanted {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  isrc?: string | null
  /** The provider's own id, and which provider it belongs to. */
  providerId?: string | null
  provider?: string | null
}

/** What the library offers for matching against. The track itself rides along as `track`. */
export interface Held<T> extends Identifiable {
  track: T
  isrc?: string | null
  providerIds?: Readonly<Record<string, string>> | null
}

/**
 * The bands.
 *
 * Set from what each stage actually proves rather than from round numbers: an ISRC or a provider id is the track,
 * a full metadata agreement is as near as metadata gets, and anything resting on a title needs a human.
 */
export const BANDS: Readonly<Record<Band, { from: number; label: string; take: boolean }>> = {
  certain: { from: 0.95, label: 'Certain', take: true },
  strong: { from: 0.85, label: 'Strong match', take: true },
  ambiguous: { from: 0.7, label: 'Needs a look', take: false },
  manual: { from: 0, label: 'No confident match', take: false }
}

export function bandFor(score: number): Band {
  if (score >= BANDS.certain.from) return 'certain'
  if (score >= BANDS.strong.from) return 'strong'
  if (score >= BANDS.ambiguous.from) return 'ambiguous'
  return 'manual'
}

const tidyIsrc = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const plain = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  // An ISRC is twelve characters. Anything else is not one, however much it looks like a code.
  return plain.length === 12 ? plain : null
}

const near = (a: number | null | undefined, b: number | null | undefined, slack: number): boolean =>
  typeof a === 'number' && typeof b === 'number' && a > 0 && b > 0 && Math.abs(a - b) <= slack

/** How much two strings of words have in common, 0..1. Used only as the last, weakest signal. */
export function wordOverlap(a: string, b: string): number {
  const left = new Set(a.split(' ').filter(Boolean))
  const right = new Set(b.split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const word of left) if (right.has(word)) shared += 1
  return shared / Math.max(left.size, right.size)
}

/**
 * The match for one wanted track, or an honest absence of one.
 *
 * The stages run in order and the first that answers wins; the rest of the field is still collected, because when
 * the answer is uncertain the student is shown what else it might have been.
 */
export function matchTrack<T>(wanted: Wanted, library: readonly Held<T>[]): MatchResult<T> {
  if (!wanted.title || wanted.title.trim() === '') {
    return { match: null, band: 'manual', stage: null, score: 0, why: [], candidates: [], reason: 'That row has no title in it.' }
  }
  if (library.length === 0) {
    return { match: null, band: 'manual', stage: null, score: 0, why: [], candidates: [], reason: 'Nothing in your library to match it against yet.' }
  }

  const wantedVersion = versionOf(wanted.title)
  const wantedIsrc = tidyIsrc(wanted.isrc)
  const wantedTitle = plainTitle(wanted.title)
  const wantedArtist = plainArtist(wanted.artist ?? '')
  const wantedAlbum = plainTitle(wanted.album ?? '')
  /*
   * `Identifiable` needs an artist and a playlist row may not have one.
   *
   * Filled with an empty string rather than a guess: `identityKey` and `compare` then simply find no artist
   * agreement, which is the honest reading of a row that never named one.
   */
  const asIdentity: Identifiable = { ...wanted, artist: wanted.artist ?? '' }
  const candidates: Candidate<T>[] = []

  for (const held of library) {
    const heldVersion = versionOf(held.title)
    const why: string[] = []
    let score = 0
    let stage: Stage = 'fuzzy'

    // ---- 1. the provider's own id. The track, by definition, when both sides name the same provider.
    if (wanted.providerId && wanted.provider && held.providerIds?.[wanted.provider] === wanted.providerId) {
      candidates.push({ track: held.track, score: 1, stage: 'provider-id', band: 'certain', why: [`The same ${wanted.provider} track.`], version: heldVersion })
      continue
    }

    // ---- 2. the ISRC. One recording, internationally. Not one song: a remaster has its own.
    const heldIsrc = tidyIsrc(held.isrc)
    if (wantedIsrc && heldIsrc && wantedIsrc === heldIsrc) {
      candidates.push({ track: held.track, score: 0.99, stage: 'isrc', band: 'certain', why: ['The same recording code.'], version: heldVersion })
      continue
    }
    /*
     * Two different ISRCs are a real disagreement, not a missing signal.
     *
     * Both sides naming a recording and naming different ones means they are different recordings, whatever the
     * titles say. Letting the title stages override that is how a remaster gets filed as the original.
     */
    if (wantedIsrc && heldIsrc && wantedIsrc !== heldIsrc) continue

    // ---- 3. everything agreeing: the same canonical identity, which already folds in the version.
    const heldTitle = plainTitle(held.title)
    const heldArtist = plainArtist(held.artist ?? '')
    /*
     * The identity key does not look at the length, so lengths that flatly disagree must veto it.
     *
     * A three-minute edit and a ten-minute extended mix share a title, an artist and no version marking, so they
     * share a key — and taking that as certain is how somebody's playlist gets the wrong one of the two. Where
     * both lengths are known and far apart, this falls through to the scoring path, which can only reach a band
     * that asks.
     */
    const lengthsDisagree =
      typeof wanted.duration === 'number' &&
      typeof held.duration === 'number' &&
      wanted.duration > 0 &&
      held.duration > 0 &&
      Math.abs(wanted.duration - held.duration) > 20
    if (!lengthsDisagree && identityKey(asIdentity) === identityKey(held)) {
      candidates.push({ track: held.track, score: 0.96, stage: 'exact', band: 'certain', why: ['Title, artist and version all agree.'], version: heldVersion })
      continue
    }

    if (wantedTitle !== heldTitle) {
      // ---- 8. the last resort: words in common, and only with the artist agreeing.
      const overlap = wordOverlap(wantedTitle, heldTitle)
      if (overlap >= 0.6 && wantedArtist && wantedArtist === heldArtist) {
        candidates.push({
          track: held.track,
          score: 0.55 + overlap * 0.2,
          stage: 'fuzzy',
          band: bandFor(0.55 + overlap * 0.2),
          why: ['Same artist, and the titles are close but not the same.'],
          version: heldVersion
        })
      }
      continue
    }

    // The titles agree from here on; what separates the candidates is everything else.
    score = 0.6
    why.push('The titles agree.')
    stage = 'artist-title'

    if (wantedArtist && heldArtist) {
      if (wantedArtist === heldArtist) {
        score += 0.25
        why.push('Same artist.')
      } else {
        /*
         * A different artist with the same title is usually a different song.
         *
         * Hundreds of songs share a title. Without the artist agreeing this is barely a candidate, and it must not
         * reach a band that would be taken without asking.
         */
        score -= 0.3
        why.push('A different artist.')
      }
    }

    if (wantedAlbum && held.album) {
      if (wantedAlbum === plainTitle(held.album)) {
        score += 0.1
        why.push('Same album.')
        stage = 'album'
      }
    }

    if (near(wanted.duration, held.duration, 3)) {
      score += 0.1
      why.push('The same length.')
      if (stage === 'artist-title') stage = 'duration'
    } else if (typeof wanted.duration === 'number' && typeof held.duration === 'number' && wanted.duration > 0 && held.duration > 0) {
      const apart = Math.abs(wanted.duration - held.duration)
      if (apart > 20) {
        score -= 0.25
        why.push(`Lengths differ by ${Math.round(apart)} seconds.`)
      }
    }

    // ---- the version, which is its own stage because it is its own decision.
    const verdict = compare(asIdentity, held)
    if (wantedVersion.kind !== heldVersion.kind) {
      stage = 'version'
      /*
       * An unmarked request against a marked recording is a question, not a disagreement.
       *
       * "Blue" might well mean the remaster — the person asking simply did not say. So the penalty is small
       * enough to stay in the band that asks and large enough that it is never taken on its own, which is what
       * puts the three versions in front of them instead of picking one. Two *marked* versions that differ, a
       * live take against a remaster, really are different things, and keep the full penalty.
       */
      const unsaid = wantedVersion.kind === 'original' && heldVersion.kind !== 'original'
      score -= unsaid ? 0.1 : 0.2
      why.push(
        unsaid
          ? `You did not say which version; this is ${heldVersion.kind}.`
          : `One is ${wantedVersion.kind === 'original' ? 'the original' : wantedVersion.kind}, the other is ${heldVersion.kind === 'original' ? 'the original' : heldVersion.kind}.`
      )
    } else if (verdict.verdict === 'exact-duplicate' || verdict.verdict === 'same-track-different-metadata') {
      score += 0.05
    }

    candidates.push({ track: held.track, score: Math.max(0, Math.min(1, score)), stage, band: bandFor(Math.max(0, Math.min(1, score))), why, version: heldVersion })
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  if (!best) {
    return { match: null, band: 'manual', stage: null, score: 0, why: [], candidates: [], reason: 'Nothing in your library looks like it.' }
  }

  /*
   * Two candidates that are as good as each other is a question, not a coin toss.
   *
   * This is the usual shape of "three versions of the same song": the scores come out within a hair of each other,
   * and picking the first would be picking at random.
   */
  const second = candidates[1]
  const tied = second && best.score - second.score < 0.06 && best.score >= BANDS.ambiguous.from
  if (tied) {
    return {
      match: null,
      band: 'ambiguous',
      stage: best.stage,
      score: best.score,
      why: best.why,
      candidates: candidates.slice(0, 6),
      reason: 'More than one version of this could be it.'
    }
  }

  const band = best.band
  return {
    match: BANDS[band].take ? best.track : null,
    band,
    stage: best.stage,
    score: best.score,
    why: best.why,
    candidates: candidates.slice(0, 6),
    reason: BANDS[band].take ? null : band === 'ambiguous' ? 'Close, but not close enough to be sure.' : 'Nothing in your library matches it well enough.'
  }
}

/** Matching a whole list, with the counts the migration screens report. */
export interface MatchSummary {
  total: number
  matched: number
  ambiguous: number
  unmatched: number
}

export function matchAll<T>(
  wanted: readonly Wanted[],
  library: readonly Held<T>[]
): { results: { wanted: Wanted; result: MatchResult<T> }[]; summary: MatchSummary } {
  const results = wanted.map((one) => ({ wanted: one, result: matchTrack(one, library) }))
  return {
    results,
    summary: {
      total: results.length,
      matched: results.filter((one) => one.result.match !== null).length,
      ambiguous: results.filter((one) => one.result.match === null && one.result.band === 'ambiguous').length,
      unmatched: results.filter((one) => one.result.match === null && one.result.band === 'manual').length
    }
  }
}

/** The sentence a row shows about how it was matched. */
export function describeMatch<T>(result: MatchResult<T>): string {
  if (!result.match) return result.reason ?? 'No match.'
  const band = BANDS[result.band].label
  return `${band} — ${result.why.join(' ')}`.trim()
}
