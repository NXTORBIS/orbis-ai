/**
 * One song, however it was found.
 *
 * The same recording can arrive from four directions -- a search, something recognised playing in a tab, a file
 * somebody imported, or a row already in the library -- and all four have to end up pointing at the same thing.
 * Otherwise the library fills with near-duplicates, "already in Orbis Music" never fires, and the taste model
 * learns about four separate songs that are one song.
 *
 * ## The hard half is *not* merging
 *
 * Collapsing everything that looks alike is easy and wrong. These are genuinely different recordings and have to
 * stay apart:
 *
 *   - a live version and the studio one;
 *   - an acoustic version;
 *   - a remix, and a remix by somebody else;
 *   - the clean edit and the explicit one;
 *   - a sped-up or slowed edit;
 *   - a remaster, which is the same performance but not the same master.
 *
 * So the version is read out of the title first, and two tracks only compare as the same recording when their
 * versions agree. A remaster is treated as the same *performance* and a different *release*, which is the one case
 * where somebody might reasonably want either answer -- so it is reported as its own kind rather than decided here.
 *
 * Pure. No storage, no network, no provider.
 */

export type VersionKind =
  | 'original'
  | 'remaster'
  | 'live'
  | 'acoustic'
  | 'radio-edit'
  | 'extended'
  | 'remix'
  | 'instrumental'
  | 'clean'
  | 'explicit'
  | 'sped-up'
  | 'slowed'
  | 'demo'
  | 'alternate'

export interface Version {
  kind: VersionKind
  /** What the title said, so it can be shown back rather than paraphrased. */
  said: string
  /** Who remixed it, when the title names them. */
  by: string | null
}

/**
 * What a title says about which version this is.
 *
 * Read in a fixed order, because titles stack: "Song (Live) [Remastered 2011]" is a live recording that was
 * remastered, and the thing a listener cares about is that it is live. The most distinguishing fact wins.
 */
const MARKS: readonly (readonly [RegExp, VersionKind])[] = [
  [/\b(live(?:\s+(?:at|from|in|version|recording))?|unplugged|in\s+concert|mtv\s+unplugged)\b/i, 'live'],
  [/\b(acoustic(?:\s+version)?)\b/i, 'acoustic'],
  [/\b(instrumental|karaoke|backing\s+track)\b/i, 'instrumental'],
  [/\b([\w .'&-]{1,40})\s+remix\b/i, 'remix'],
  [/\b(remix|rmx|bootleg|flip|vip\s+mix|club\s+mix|dub\s+mix)\b/i, 'remix'],
  [/\b(sped\s*-?\s*up|speed\s*up|nightcore|fast\s+version)\b/i, 'sped-up'],
  [/\b(slowed(?:\s*\+?\s*reverb)?|slow(?:ed)?\s+version|daycore)\b/i, 'slowed'],
  [/\b(extended(?:\s+(?:mix|version|edit))?|long\s+version|12["”]?\s*(?:inch|mix))\b/i, 'extended'],
  [/\b(radio\s+edit|single\s+(?:version|edit)|short\s+version)\b/i, 'radio-edit'],
  [/\b(demo(?:\s+version)?|rough\s+mix)\b/i, 'demo'],
  [/\b(alternate(?:\s+(?:mix|version|take))?|alt\.?\s+(?:mix|version)|take\s+\d+)\b/i, 'alternate'],
  [/\b(remaster(?:ed)?(?:\s*\d{4})?|\d{4}\s+remaster|anniversary\s+(?:edition|remaster))\b/i, 'remaster'],
  [/\b(clean(?:\s+version)?|edited(?:\s+version)?)\b/i, 'clean'],
  [/\b(explicit(?:\s+version)?|uncensored)\b/i, 'explicit']
]

/** Everything in brackets, which is where a version is nearly always written. */
const BRACKETED = /[([{][^)\]}]*[)\]}]/g

/** What version of a recording a title describes. 'original' when the title says nothing about it. */
export function versionOf(title: string): Version {
  const text = title ?? ''
  // The whole title is searched, not only the brackets: "Song - Live at Wembley" is common and has none.
  for (const [pattern, kind] of MARKS) {
    const found = pattern.exec(text)
    if (!found) continue
    const by = kind === 'remix' && found[1] && !/^remix$/i.test(found[1].trim()) ? found[1].trim() : null
    return { kind, said: found[0].trim(), by }
  }
  return { kind: 'original', said: '', by: null }
}

/**
 * A title with the noise taken off, for comparing.
 *
 * Everything in brackets goes, along with featured artists, trailing dashes and punctuation. What is left is the
 * name of the song, which is what two rows have to agree on before anything else is considered.
 */
export function plainTitle(title: string): string {
  return (title ?? '')
    .replace(BRACKETED, ' ')
    .replace(/\s[-–—]\s.*$/, '')
    .replace(/\b(feat|ft|featuring|with)\.?\s+.*$/i, '')
    .replace(/\b(prod|produced)\.?\s+by\s+.*$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** An artist name with the noise taken off. Collaborators are kept apart, so a duet is not one artist. */
export function plainArtist(artist: string): string {
  return (artist ?? '')
    .replace(/\b(feat|ft|featuring)\.?\s+/gi, ' & ')
    .replace(/[^\p{L}\p{N}\s&,]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** Who is on a track, as a set, so order and punctuation stop mattering. */
export function artistsOf(artist: string): string[] {
  return plainArtist(artist)
    .split(/\s*(?:&|,|\band\b|\bx\b|\bvs\.?\b)\s*/)
    .map((one) => one.trim())
    .filter(Boolean)
}

export interface Identifiable {
  /** An industry identifier, when one legitimately came with the track. The strongest evidence there is. */
  isrc?: string | null
  /** A provider's own id, and which provider it belongs to. */
  providerId?: string | null
  provider?: string | null
  title: string
  artist: string
  album?: string | null
  /** Seconds. Used only to tell two recordings apart, never to merge them. */
  duration?: number | null
  year?: number | null
}

/**
 * A key two rows share when they are the same recording.
 *
 * Deliberately includes the version, so the studio cut and the live cut get different keys and are never collapsed
 * into each other. An ISRC, when there is one, is the whole key -- it already means "this exact recording".
 */
export function identityKey(one: Identifiable): string {
  const isrc = (one.isrc ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (isrc.length === 12) return `isrc:${isrc}`
  const version = versionOf(one.title)
  const artists = artistsOf(one.artist).sort().join('&')
  // With no artist, the length joins the key: an untagged file is told apart from another by how long it is.
  const length = artists.length === 0 && one.duration ? `|d:${Math.round(one.duration / 5) * 5}` : ''
  return `t:${plainTitle(one.title)}|a:${artists}${length}|v:${version.kind}${version.by ? `:${version.by.toLowerCase()}` : ''}`
}

export type Verdict =
  | 'exact-duplicate'
  | 'same-track-different-metadata'
  | 'different-version'
  | 'remix'
  | 'live-version'
  | 'acoustic-version'
  | 'remaster'
  | 'new-track'

export interface Comparison {
  verdict: Verdict
  /** 0..1. How sure, which is what decides whether the student is asked rather than told. */
  confidence: number
  /** Which fields agreed, so a decision can be shown rather than asserted. */
  matched: readonly string[]
  /** One sentence for the interface. */
  why: string
}

const DURATION_SLACK = 4

/**
 * How two rows relate.
 *
 * Returns a kind rather than a yes-or-no, because the interface has four different things to say: it is already
 * here, it is here under a different name, a different version is here, or it is new. "Already in your library"
 * shown for a remix is the mistake this exists to prevent.
 */
export function compare(a: Identifiable, b: Identifiable): Comparison {
  const matched: string[] = []
  const isrcA = (a.isrc ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const isrcB = (b.isrc ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (isrcA.length === 12 && isrcA === isrcB) {
    return { verdict: 'exact-duplicate', confidence: 1, matched: ['isrc'], why: 'The same recording.' }
  }
  if (a.provider && a.provider === b.provider && a.providerId && a.providerId === b.providerId) {
    return { verdict: 'exact-duplicate', confidence: 0.98, matched: ['provider'], why: 'The same recording.' }
  }

  const titleA = plainTitle(a.title)
  const titleB = plainTitle(b.title)
  const sameTitle = titleA.length > 0 && titleA === titleB
  if (sameTitle) matched.push('title')

  const artistsA = artistsOf(a.artist)
  const artistsB = artistsOf(b.artist)
  const shared = artistsA.filter((one) => artistsB.includes(one))
  const sameArtist = shared.length > 0 && (artistsA.length === artistsB.length || shared.length === Math.min(artistsA.length, artistsB.length))
  if (sameArtist) matched.push('artist')

  /*
   * Neither row names an artist.
   *
   * That happens -- a file with no tags, a track saved from a page that gave only a title. With no artist on
   * either side there is nothing to disagree about, so the comparison carries on and rests on the title, the
   * length and the album instead. Treating it as a different track is how a library ends up with six copies of
   * the same untagged file.
   */
  const neitherNamed = artistsA.length === 0 && artistsB.length === 0
  if (!sameTitle || (shared.length === 0 && !neitherNamed)) {
    return { verdict: 'new-track', confidence: sameTitle ? 0.5 : 0.9, matched, why: 'Not in your library.' }
  }

  const versionA = versionOf(a.title)
  const versionB = versionOf(b.title)
  if (versionA.kind !== versionB.kind || (versionA.by ?? '') !== (versionB.by ?? '')) {
    // The same song, a different recording of it. Named exactly, so the student decides.
    const kind = versionA.kind === 'original' ? versionB.kind : versionA.kind
    const verdict: Verdict =
      kind === 'remix' ? 'remix' : kind === 'live' ? 'live-version' : kind === 'acoustic' ? 'acoustic-version' : kind === 'remaster' ? 'remaster' : 'different-version'
    return {
      verdict,
      confidence: 0.85,
      matched,
      why: `A different version of this is already in your library${versionB.said ? ` (${versionB.said})` : ''}.`
    }
  }

  const durationA = a.duration ?? null
  const durationB = b.duration ?? null
  if (durationA !== null && durationB !== null && durationA > 0 && durationB > 0) {
    const gap = Math.abs(durationA - durationB)
    if (gap <= DURATION_SLACK) matched.push('duration')
    else if (gap > Math.max(20, Math.min(durationA, durationB) * 0.12)) {
      /*
       * Same title, same artist, same version, and minutes apart.
       *
       * That is two different recordings whatever the titles say -- an edit, an album cut with an intro, a
       * mislabelled file. Said as "a different version" rather than merged, because merging them would lose one.
       */
      return { verdict: 'different-version', confidence: 0.7, matched, why: 'A recording of this with a different length is already in your library.' }
    }
  }

  const albumA = plainTitle(a.album ?? '')
  const albumB = plainTitle(b.album ?? '')
  if (albumA && albumB && albumA === albumB) matched.push('album')

  const strong = matched.includes('duration') || matched.includes('album')
  return {
    verdict: strong ? 'exact-duplicate' : 'same-track-different-metadata',
    confidence: strong ? 0.94 : 0.78,
    matched,
    why: strong ? 'Already in Orbis Music.' : 'This looks like a track already in your library, saved with different details.'
  }
}

/** What to show when something is about to be added. Null when there is nothing to say. */
export function duplicateOf<T extends Identifiable>(wanted: Identifiable, held: readonly T[]): { track: T; comparison: Comparison } | null {
  let best: { track: T; comparison: Comparison } | null = null
  for (const one of held) {
    const comparison = compare(wanted, one)
    if (comparison.verdict === 'new-track') continue
    if (!best || comparison.confidence > best.comparison.confidence) best = { track: one, comparison }
  }
  return best
}

// ---------------------------------------------------------------- canonical shapes

export interface CanonicalTrack {
  /** The identity key, which is what everything else points at. */
  key: string
  title: string
  /** The title with the version taken off, for showing in a list. */
  name: string
  artist: string
  artists: readonly string[]
  album: string | null
  version: Version
  duration: number | null
  year: number | null
  isrc: string | null
  /** Which provider, and its id there. Several providers can point at one canonical track. */
  sources: readonly { provider: string; id: string }[]
}

export function canonicalTrack(one: Identifiable): CanonicalTrack {
  const version = versionOf(one.title)
  const isrc = (one.isrc ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return {
    key: identityKey(one),
    title: one.title,
    // The bracketed version is dropped from the display name but never from the identity.
    name: one.title.replace(BRACKETED, '').replace(/\s[-–—]\s*$/, '').replace(/\s+/g, ' ').trim() || one.title,
    artist: one.artist,
    artists: artistsOf(one.artist),
    album: one.album ?? null,
    version,
    duration: one.duration ?? null,
    year: one.year ?? null,
    isrc: isrc.length === 12 ? isrc : null,
    sources: one.provider && one.providerId ? [{ provider: one.provider, id: one.providerId }] : []
  }
}

/** The same canonical track seen through two providers, with both kept. */
export function mergeSources(a: CanonicalTrack, b: CanonicalTrack): CanonicalTrack {
  const sources = [...a.sources]
  for (const one of b.sources) if (!sources.some((x) => x.provider === one.provider && x.id === one.id)) sources.push(one)
  return {
    ...a,
    // Whichever row knows more wins per field; nothing is thrown away because one source left it blank.
    album: a.album ?? b.album,
    duration: a.duration ?? b.duration,
    year: a.year ?? b.year,
    isrc: a.isrc ?? b.isrc,
    sources
  }
}

/** How a version should be written next to a title. Empty for the original. */
export const VERSION_LABELS: Record<VersionKind, string> = {
  original: '',
  remaster: 'Remastered',
  live: 'Live',
  acoustic: 'Acoustic',
  'radio-edit': 'Radio edit',
  extended: 'Extended',
  remix: 'Remix',
  instrumental: 'Instrumental',
  clean: 'Clean',
  explicit: 'Explicit',
  'sped-up': 'Sped up',
  slowed: 'Slowed',
  demo: 'Demo',
  alternate: 'Alternate'
}

export function versionLabel(version: Version): string {
  if (version.kind === 'remix' && version.by) return `${version.by} remix`
  return VERSION_LABELS[version.kind]
}
