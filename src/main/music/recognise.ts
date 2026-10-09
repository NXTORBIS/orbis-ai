import {
  activeSighting,
  fromSighting,
  namesUsable,
  recognitionKey,
  worthRecognising,
  type Confidence,
  type MediaSighting,
  type Recognition,
  type TrackNames
} from '../../shared/music.ts'
import type { MusicStore } from './store.ts'

/**
 * Working out what is playing, without ever making it up.
 *
 * Three things are asked, in this order, and the first that answers properly wins:
 *
 * 1. **What the page says.** `navigator.mediaSession.metadata` is a player's own announcement of its track. It is not
 *    a guess and it costs nothing, so it is asked first whatever the settings say about Vision.
 * 2. **What can be seen.** When the page says nothing, Orbis Vision looks at the tab -- the picture it already takes
 *    for every other visual check -- and reads the title and artist off the player. This is the case the whole feature
 *    exists for: a video with the song written across it and nothing published anywhere.
 * 3. **Nothing.** If neither answers, the answer is "Orbis could not work out what this is", with a button to try
 *    again. There is no fourth step where something plausible is filled in.
 *
 * ## What it will not do
 *
 * **It does not run over and over.** A sighting is recognised when it is new, when the track changes, or when the
 * answer has gone stale; the answer is kept against the sound's identity, so sitting on a page for an hour asks once.
 * Nothing is sent anywhere while a tab is paused.
 *
 * **It does not keep pictures.** The picture handed to Vision is held for the one request and dropped. Nothing is
 * written to disk, and nothing but that one tab's picture is ever sent.
 *
 * **It does not touch the page.** Reading what a page published and taking a picture of a tab change nothing about
 * either. The website's own player is never altered, moved or wrapped.
 */

/** What a page said about itself, as `media.nowPlaying` answers. */
export interface NowPlaying {
  session: { title: string; artist: string; album: string; artwork: string | null } | null
  playbackState: string
  pageTitle: string
  origin: string
  playing: boolean
  duration: number
  position: number
  muted: boolean
  kind: 'video' | 'audio' | null
}

export interface RecogniseOptions {
  store: MusicStore
  /** Asks the browser what a tab says it is playing. Null when there is no browser or no tab. */
  nowPlaying(tabId?: string): Promise<NowPlaying | null>
  /** A picture of the tab, as a data URL, for Vision to read. Null when one cannot be taken. */
  picture(tabId?: string): Promise<string | null>
  /** Asks the vision model about a picture. Returns its words, or null when it could not be asked. */
  askVision(prompt: string, picture: string): Promise<string | null>
  /** The tabs with sound, as the browser knows them. */
  sounds(): Promise<MediaSighting[]>
  /** Told whenever what Orbis thinks is playing changes. */
  onChange(state: MusicNow): void
  now?(): number
}

/** What Orbis currently believes about music in the browser. The one answer every music surface reads. */
export interface MusicNow {
  /** The sound a person means, when there is one. */
  sighting: MediaSighting | null
  recognition: Recognition | null
  /** True while a picture is being looked at, so a button can say "listening" honestly. */
  working: boolean
  /** The track in the library that is this song, when there is one. */
  inLibraryId: string | null
}

const VISION_PROMPT = [
  'This is a screenshot of a web page that is playing music.',
  'Read the song title and artist from what is actually visible -- the player, the video, the page.',
  'Reply with JSON only, shaped {"title": string, "artist": string, "album": string, "sure": boolean}.',
  'Use "" for anything that is not visible, and set "sure" to false unless you can actually read the title.',
  'Never guess a song from a channel name, a thumbnail or a genre. If you cannot read a title, reply {"title": "", "artist": "", "album": "", "sure": false}.'
].join(' ')

/** The words a vision model came back with, as names, or null when it did not actually read anything. */
export function readVisionAnswer(text: string | null): { names: TrackNames; confidence: Confidence } | null {
  if (!text) return null
  // A model may wrap its answer in prose or a code fence. Only the object is read.
  const found = /\{[\s\S]*\}/.exec(text)
  if (!found) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(found[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
  const artist = typeof parsed.artist === 'string' ? parsed.artist.trim() : ''
  const album = typeof parsed.album === 'string' ? parsed.album.trim() : ''
  const names: TrackNames = { title, artist, album }
  if (!namesUsable(names)) return null
  // "sure" is the model's own answer to whether it could read it. Anything less is offered as a maybe, not a fact.
  return { names, confidence: parsed.sure === true ? 'medium' : 'low' }
}

export class MusicRecogniser {
  private readonly o: RecogniseOptions
  private readonly now: () => number
  /** Answers already worked out, by the identity of the sound. Stops the same page being looked at twice. */
  private readonly answers = new Map<string, Recognition>()
  private state: MusicNow = { sighting: null, recognition: null, working: false, inLibraryId: null }
  /** Sounds somebody has explicitly picked, so another tab starting does not steal the answer. */
  private chosen: string | null = null
  private looking = false

  constructor(options: RecogniseOptions) {
    this.o = options
    this.now = options.now ?? Date.now
  }

  current(): MusicNow {
    return this.state
  }

  /** Somebody picked which sound they meant. Kept until it stops. */
  choose(sourceId: string | null): void {
    this.chosen = sourceId
  }

  private announce(): void {
    this.o.onChange(this.state)
  }

  /**
   * Looks at what the browser is playing and works out what it is.
   *
   * `force` is a person pressing "work out what this is": it ignores the cache and the "worth asking again" rule, and
   * it looks even when the setting says to recognise only when asked.
   */
  async look(options: { force?: boolean; tabId?: string } = {}): Promise<MusicNow> {
    const settings = await this.o.store.settings()
    if (settings.recognition === 'off' && !options.force) return this.state
    if (settings.recognition === 'manual' && !options.force) {
      // Still worth knowing that something is playing: that is what turns the button on.
      const sightings = await this.o.sounds().catch(() => [])
      this.state = { ...this.state, sighting: activeSighting(sightings, this.chosen, options.tabId) }
      this.announce()
      return this.state
    }

    const sightings = await this.o.sounds().catch(() => [])
    const sighting = activeSighting(sightings, this.chosen, options.tabId)
    if (!sighting) {
      if (this.state.sighting) {
        this.state = { sighting: null, recognition: null, working: false, inLibraryId: null }
        this.announce()
      }
      return this.state
    }

    const key = recognitionKey(sighting)
    const held = this.answers.get(key)
    if (held && !options.force) {
      this.state = { sighting, recognition: held, working: false, inLibraryId: await this.inLibrary(held, sighting.duration) }
      this.announce()
      return this.state
    }
    if (!options.force && !worthRecognising(sighting, this.state.recognition, this.now())) {
      this.state = { ...this.state, sighting }
      this.announce()
      return this.state
    }

    // What the page says, which is free and is not a guess.
    const said = fromSighting(sighting, this.now())
    if (said.names && said.confidence !== 'low') {
      this.answers.set(key, said)
      await this.note(said, sighting)
      this.state = { sighting, recognition: said, working: false, inLibraryId: await this.inLibrary(said, sighting.duration) }
      this.announce()
      return this.state
    }

    if (!settings.useVision || this.looking) {
      this.state = { sighting, recognition: said, working: false, inLibraryId: await this.inLibrary(said, sighting.duration) }
      this.announce()
      return this.state
    }

    // Looking at the tab. One picture, one request, nothing kept.
    this.looking = true
    this.state = { sighting, recognition: this.state.recognition, working: true, inLibraryId: this.state.inLibraryId }
    this.announce()
    try {
      const picture = await this.o.picture(sighting.tabId)
      if (!picture) {
        const nothing: Recognition = { ...said, why: 'Orbis could not see this tab to read what is playing.' }
        this.state = { sighting, recognition: nothing, working: false, inLibraryId: null }
        this.announce()
        return this.state
      }
      const words = await this.o.askVision(VISION_PROMPT, picture)
      const read = readVisionAnswer(words)
      const answer: Recognition = read
        ? { sourceId: sighting.sourceId, names: read.names, confidence: read.confidence, method: 'vision', at: this.now() }
        : {
            sourceId: sighting.sourceId,
            names: said.names,
            confidence: said.confidence,
            method: said.method,
            at: this.now(),
            why: said.names ? undefined : 'Orbis could not work out what this track is.'
          }
      this.answers.set(key, answer)
      // Only ever remembered as something Orbis noticed. Noticing is not keeping: that needs a press.
      if (answer.names) await this.note(answer, sighting)
      this.state = { sighting, recognition: answer, working: false, inLibraryId: await this.inLibrary(answer, sighting.duration) }
      this.announce()
      return this.state
    } finally {
      this.looking = false
    }
  }

  /** Writes a sighting into the list of things Orbis noticed. Nothing enters the library from here. */
  private async note(recognition: Recognition, sighting: MediaSighting): Promise<void> {
    if (!recognition.names) return
    await this.o.store
      .noteRecognised({
        title: recognition.names.title,
        artist: recognition.names.artist,
        album: recognition.names.album,
        provider: sighting.provider,
        url: sighting.url,
        at: recognition.at
      })
      .catch(() => undefined)
  }

  /** The library's own id for this song, when the person already has it. */
  private async inLibrary(recognition: Recognition | null, duration = 0): Promise<string | null> {
    if (!recognition?.names) return null
    const { bestMatches, matchDecision } = await import('../../shared/music.ts')
    const library = await this.o.store.all()
    const decision = matchDecision(bestMatches({ ...recognition.names, duration }, library))
    return decision.kind === 'use' ? decision.track.id : null
  }

  /** Forgets everything worked out so far. Used when the profile changes, or when somebody clears the history. */
  forget(): void {
    this.answers.clear()
    this.state = { sighting: null, recognition: null, working: false, inLibraryId: null }
    this.chosen = null
    this.announce()
  }
}

/** A sighting out of what the browser knows about a tab, so the two vocabularies meet in one place. */
export function sightingFrom(tab: { id: string; url?: string; title?: string; audible?: boolean; muted?: boolean }, reading: NowPlaying | null): MediaSighting {
  const provider = providerOf(tab.url ?? reading?.origin ?? '')
  return {
    sourceId: `${tab.id}:${provider}`,
    tabId: tab.id,
    provider,
    url: tab.url,
    playing: Boolean(reading?.playing ?? tab.audible),
    duration: reading?.duration ?? 0,
    position: reading?.position ?? 0,
    session: reading?.session
      ? { title: reading.session.title, artist: reading.session.artist, album: reading.session.album, artwork: reading.session.artwork ?? undefined }
      : undefined,
    pageTitle: reading?.pageTitle ?? tab.title
  }
}

/** Which service a page belongs to, by its address. Used for labelling only; nothing behaves differently per site. */
export function providerOf(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '')
    } catch {
      return ''
    }
  })()
  if (!host) return 'unknown'
  const known: Record<string, string> = {
    'music.youtube.com': 'youtube-music',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'open.spotify.com': 'spotify',
    'soundcloud.com': 'soundcloud',
    'music.apple.com': 'apple-music',
    'music.amazon.com': 'amazon-music',
    'bandcamp.com': 'bandcamp'
  }
  for (const [name, provider] of Object.entries(known)) if (host === name || host.endsWith(`.${name}`)) return provider
  return host
}
