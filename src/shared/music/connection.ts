/**
 * The services a library can be brought in from, and the honest truth about each one.
 *
 * ## "Not set up" and "it broke" are different sentences
 *
 * The rule the rest of Orbis already follows. A service with no credentials configured has not failed — nothing
 * was ever asked of it. Collapsing the two into "unavailable" sends somebody looking for a network problem that
 * does not exist, so every state below is distinct and each carries its own next step.
 *
 * ## Connecting needs credentials Orbis cannot invent
 *
 * Spotify, Apple Music, YouTube Music, Deezer and TIDAL all require an application registered with them, and that
 * registration is something a person does, not something code can conjure. So the adapter and the whole pipeline
 * behind it are real and finished, and where the registration is absent the card says exactly that and offers the
 * routes that need no account: a playlist file, a folder of music, or a pasted list. **Nothing ever shows
 * "Connected" because a provider exists.**
 *
 * ## Capabilities are discovered, not assumed
 *
 * Two accounts on the same service can differ — a free account may list playlists and refuse audio features. So
 * what a connection can do is asked of it and remembered, and a screen greys out what this account cannot do
 * rather than offering it and failing halfway through an import.
 */

export type ConnectionState =
  | 'not-set-up'
  | 'ready-to-connect'
  | 'connecting'
  | 'connected'
  | 'expired'
  | 'refused'
  | 'broken'

export const CONNECTION_STATES: Readonly<Record<ConnectionState, { label: string; what: string; connected: boolean }>> = {
  'not-set-up': {
    label: 'Not set up',
    what: 'This service needs an application registered with it before Orbis can ask it anything.',
    connected: false
  },
  'ready-to-connect': { label: 'Not connected', what: 'Ready when you are. You will sign in on their own page.', connected: false },
  connecting: { label: 'Connecting', what: 'Waiting for you to finish signing in.', connected: false },
  connected: { label: 'Connected', what: '', connected: true },
  expired: { label: 'Needs signing in again', what: 'The permission ran out. Nothing was lost.', connected: false },
  refused: { label: 'Permission refused', what: 'The service would not allow that. Signing in again usually fixes it.', connected: false },
  broken: { label: 'Could not reach it', what: 'Orbis asked and got nothing back. This is usually temporary.', connected: false }
}

/** What a source can actually do, asked of the connection rather than assumed from its name. */
export interface Capabilities {
  listPlaylists: boolean
  readPlaylistTracks: boolean
  likedSongs: boolean
  albums: boolean
  followedArtists: boolean
  playHistory: boolean
  /** Industry recording codes, which are what make matching certain rather than probable. */
  isrc: boolean
  /** Writing back to the service. Almost never granted, and never assumed. */
  write: boolean
}

export const NO_CAPABILITIES: Capabilities = {
  listPlaylists: false,
  readPlaylistTracks: false,
  likedSongs: false,
  albums: false,
  followedArtists: false,
  playHistory: false,
  isrc: false,
  write: false
}

export const CAPABILITY_LABELS: Readonly<Record<keyof Capabilities, string>> = {
  listPlaylists: 'Your playlists',
  readPlaylistTracks: 'The tracks in them',
  likedSongs: 'Songs you liked',
  albums: 'Saved albums',
  followedArtists: 'Artists you follow',
  playHistory: 'What you played',
  isrc: 'Exact recording codes',
  write: 'Changing things there'
}

/** How a source is reached. Decides which card it appears on and what it needs. */
export type SourceKind = 'oauth' | 'file' | 'folder' | 'paste'

export interface SourceDescription {
  id: string
  name: string
  kind: SourceKind
  /** Which of the things above it could do, at best, with everything granted. */
  offers: readonly (keyof Capabilities)[]
  /** What a person has to do before this one can work at all. Empty when it needs nothing. */
  needs: string
}

/**
 * The sources Orbis knows how to read.
 *
 * The three at the bottom need no account and work today; the five above them need an application registered with
 * the service, and the card says so in those words rather than pretending to be one click from working.
 */
export const SOURCES: readonly SourceDescription[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks', 'likedSongs', 'albums', 'followedArtists', 'isrc'],
    needs: 'An application registered with Spotify for Developers, and its client id in Orbis.'
  },
  {
    id: 'apple',
    name: 'Apple Music',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks', 'likedSongs', 'albums', 'isrc'],
    needs: 'An Apple Developer membership and a MusicKit key.'
  },
  {
    id: 'youtube-music',
    name: 'YouTube Music',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks'],
    needs: 'A Google Cloud project with the YouTube Data API turned on.'
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks'],
    needs: 'A registered SoundCloud application. They are not currently accepting new ones.'
  },
  {
    id: 'deezer',
    name: 'Deezer',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks', 'likedSongs', 'isrc'],
    needs: 'A registered Deezer application and its id.'
  },
  {
    id: 'tidal',
    name: 'TIDAL',
    kind: 'oauth',
    offers: ['listPlaylists', 'readPlaylistTracks', 'likedSongs', 'isrc'],
    needs: 'A registered TIDAL application and its id.'
  },
  {
    id: 'playlist-file',
    name: 'A playlist file',
    kind: 'file',
    offers: ['readPlaylistTracks'],
    needs: ''
  },
  { id: 'folder', name: 'A folder of music', kind: 'folder', offers: ['readPlaylistTracks', 'isrc'], needs: '' },
  { id: 'paste', name: 'A list you paste in', kind: 'paste', offers: ['readPlaylistTracks'], needs: '' }
]

export interface Connection {
  sourceId: string
  state: ConnectionState
  /** The account name the service gave back, when it gave one. Never guessed. */
  account: string | null
  capabilities: Capabilities
  connectedAt: number | null
  /** When the permission runs out, when the service said. */
  expiresAt: number | null
  /** The last thing that went wrong, in words, for the card. */
  lastProblem: string | null
  lastUsedAt: number | null
}

export function newConnection(sourceId: string, configured: boolean): Connection {
  const source = SOURCES.find((one) => one.id === sourceId)
  // Sources needing no registration are ready the moment they exist; the rest are honestly not set up.
  const ready = source?.needs === '' || configured
  return {
    sourceId,
    state: ready ? 'ready-to-connect' : 'not-set-up',
    account: null,
    capabilities: { ...NO_CAPABILITIES },
    connectedAt: null,
    expiresAt: null,
    lastProblem: null,
    lastUsedAt: null
  }
}

/**
 * Whether this connection is usable right now.
 *
 * Expiry is checked here rather than trusted from the stored state, because a connection stored as `connected`
 * three weeks ago is not connected now, and a card that says otherwise is the exact lie the spec forbids.
 */
export function usable(connection: Connection, now: number): { ok: boolean; why: string } {
  if (connection.state !== 'connected') {
    const state = CONNECTION_STATES[connection.state]
    return { ok: false, why: state.what || state.label }
  }
  if (connection.expiresAt !== null && connection.expiresAt <= now) {
    return { ok: false, why: CONNECTION_STATES.expired.what }
  }
  if (!connection.capabilities.readPlaylistTracks) {
    return { ok: false, why: 'This account is connected but is not allowed to read the tracks in a playlist.' }
  }
  return { ok: true, why: '' }
}

/** The card's own sentence. Short, and never claims more than the state. */
export function describeConnection(connection: Connection, now: number): string {
  if (connection.state === 'connected' && connection.expiresAt !== null && connection.expiresAt <= now) {
    return CONNECTION_STATES.expired.label
  }
  if (connection.state === 'connected') return connection.account ? `Connected as ${connection.account}` : 'Connected'
  if (connection.lastProblem && (connection.state === 'broken' || connection.state === 'refused')) {
    return `${CONNECTION_STATES[connection.state].label} — ${connection.lastProblem}`
  }
  return CONNECTION_STATES[connection.state].label
}

/**
 * What this connection cannot do, for the screen that greys those things out.
 *
 * Only ever derived from what the connection reported. A capability absent from the list is absent because the
 * account did not offer it, not because Orbis guessed.
 */
export function missing(connection: Connection): { key: keyof Capabilities; label: string }[] {
  const source = SOURCES.find((one) => one.id === connection.sourceId)
  if (!source) return []
  return source.offers
    .filter((key) => !connection.capabilities[key])
    .map((key) => ({ key, label: CAPABILITY_LABELS[key] }))
}

/**
 * Capabilities worked out from what the service actually answered.
 *
 * Each probe is a real request that either returned rows or did not. A request that fails for any reason leaves
 * its capability false, which is the safe direction: a screen that under-offers is an annoyance, and one that
 * over-offers fails mid-import.
 */
export function capabilitiesFrom(probes: Partial<Record<keyof Capabilities, boolean>>): Capabilities {
  return {
    listPlaylists: probes.listPlaylists === true,
    readPlaylistTracks: probes.readPlaylistTracks === true,
    likedSongs: probes.likedSongs === true,
    albums: probes.albums === true,
    followedArtists: probes.followedArtists === true,
    playHistory: probes.playHistory === true,
    isrc: probes.isrc === true,
    write: probes.write === true
  }
}

/** What an HTTP status from a service means for the connection. */
export function stateFromStatus(status: number): ConnectionState {
  if (status === 401) return 'expired'
  if (status === 403) return 'refused'
  if (status >= 500 || status === 0) return 'broken'
  return 'connected'
}

/**
 * The sources that work without anybody registering anything.
 *
 * This is what the Migration Center opens on when nothing is configured, so the screen is useful on a fresh
 * install instead of being a wall of "not set up".
 */
export function sourcesThatNeedNothing(): readonly SourceDescription[] {
  return SOURCES.filter((one) => one.needs === '')
}
