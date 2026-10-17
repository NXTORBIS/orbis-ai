import type { BrowserControl } from './registry.ts'
import { fail } from './registry.ts'
import type { ParamSpec } from '../../shared/browserControl.ts'
import type { MusicHandle } from '../music/service.ts'
import { playableOffline, whyNotPlayable, type OrbisTrack } from '../../shared/music.ts'
import { DEFAULT_MUSIC_SETTINGS, MUSIC_SETTING_VALUES, type MusicSettings } from '../music/store.ts'
import { MODE_SHAPE } from '../../shared/music/intent.ts'
import { DISCOVERY_LEVELS } from '../../shared/music/config.ts'

/**
 * What Orion, the Orb, a workflow or a spoken command may do about music.
 *
 * One registration, four surfaces: a spoken "pause the music" becomes a transcript, the transcript becomes an Orion
 * request, Orion calls a capability here, and a workflow step calls the same one. So there is exactly one place that
 * decides what may be asked of Orbis Music, and adding a surface adds no new answer.
 *
 * Three rules shape all of it.
 *
 * **Nothing here can say something is playing when it is not.** Every answer is read from the player's own state,
 * which is read from the audio element. "What is playing?" has three honest answers -- a track of the person's own, a
 * website's own sound that Orbis can see but does not own, or nothing -- and `source` says which.
 *
 * **Nothing here acquires audio.** `music.keepHeard` is the whole of the add flow, and the most it can do is link a
 * song to a file the person already has or keep its name. There is no capability that downloads, and no argument that
 * makes one.
 *
 * **Every action is checked afterwards.** `verify` asks the player what actually happened, so Orion cannot report a
 * pause that did not take -- which matters most for the one case that really can refuse, a track with no audio.
 *
 * ## Why this is Music's whole controllable surface
 *
 * Orbis's other modules are now reachable down to a parameter through the `screens` protocol
 * (`docs/orbis-control.md`), where a screen in the Orbis window declares what can be read, set and done on it. Music
 * has no screen in that window: its one screen is the browser's own panel, a different document in a different
 * program. A surface registered here would describe nothing that is on screen, and every setter on it would be a
 * second code path beside the one the panel's own controls use.
 *
 * So Music goes as deep through its own domain instead, and keeps the same rules the protocol enforces. What makes
 * that possible is that nothing below describes a parameter twice: the preferences, their types and their allowed
 * values come from the music store's own `DEFAULT_MUSIC_SETTINGS` and `MUSIC_SETTING_VALUES`, and the listening modes
 * and discovery levels from the ranker's own `MODE_SHAPE` and `DISCOVERY_LEVELS`. Something added to those is
 * something Orion can use with no edit here.
 *
 * And one habit of the service to keep in mind: **it does not check what it is given.** An unrecognised repeat mode
 * quietly becomes `off`, an unrecognised listening mode goes to the ranker anyway, and a queue position it cannot use
 * is ignored with nothing said. Every refusal below is here because of that.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const num = (description: string, required = false, range?: { min?: number; max?: number }): ParamSpec => ({ type: 'number', description, required, ...range })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })

/** What kind of value a music preference holds, and whether it can be set from here at all. */
interface SettingKind {
  type: 'boolean' | 'number' | 'string'
  values?: readonly string[]
  min?: number
  max?: number
  /** True, or the sentence saying what would have to change first. */
  settable: true | string
}
/**
 * Reading a preference's value out of what was asked, against the kind the music store gives it.
 *
 * Everything arrives as text from a spoken or written request, and a switch set to the word "maybe" has to be refused
 * with the two words it takes rather than becoming false -- being told "done" about a preference nobody asked for is
 * the fault this avoids.
 */
const readValue = (
  kind: { type: 'boolean' | 'number' | 'string'; values?: readonly string[]; min?: number; max?: number },
  given: unknown
): { ok: true; value: unknown } | { ok: false; why: string } => {
  if (kind.type === 'boolean') {
    if (typeof given === 'boolean') return { ok: true, value: given }
    const word = String(given ?? '').trim().toLowerCase()
    if (['true', 'on', 'yes'].includes(word)) return { ok: true, value: true }
    if (['false', 'off', 'no'].includes(word)) return { ok: true, value: false }
    return { ok: false, why: `This one is a switch: it takes true or false. "${String(given).slice(0, 40)}" was given.` }
  }
  if (kind.type === 'number') {
    const value = typeof given === 'number' ? given : Number(String(given ?? '').trim())
    if (!Number.isFinite(value)) return { ok: false, why: `This one is a number from ${kind.min ?? 0} to ${kind.max ?? 1}. "${String(given).slice(0, 40)}" was given.` }
    // Refused with the range rather than clamped: 400 silently becoming 1 is an automation told it got what it asked for.
    if (value < (kind.min ?? 0) || value > (kind.max ?? 1)) return { ok: false, why: `This one goes from ${kind.min ?? 0} to ${kind.max ?? 1}. ${value} is outside that.` }
    return { ok: true, value }
  }
  const word = String(given ?? '').trim().toLowerCase()
  if (kind.values && !kind.values.includes(word)) {
    return { ok: false, why: `This one takes one of: ${kind.values.join(', ')}. "${String(given).slice(0, 40)}" was given.` }
  }
  return { ok: true, value: word }
}

/** A track as Orion is shown it: the names, how long, whether it can actually be played, and nothing about the disk. */
const forOrion = (track: OrbisTrack): Record<string, unknown> => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  album: track.album,
  duration: Math.round(track.duration),
  favourite: track.favourite === true,
  playableOffline: playableOffline(track),
  // Why it cannot be played, when it cannot. The reason is the one a person is shown.
  unavailable: whyNotPlayable(track) ?? undefined,
  plays: track.playCount ?? 0
})

export function registerMusicCapabilities(o: { control: BrowserControl; music: () => MusicHandle | null }): void {
  const music = (): MusicHandle => o.music() ?? fail('unavailable', 'Orbis Music is not ready yet.', true)
  const common = { domain: 'music' as const }

  // ---------------------------------------------------------------- looking

  o.control.register({
    ...common,
    id: 'music.current',
    name: 'What is playing',
    description:
      'What is playing right now: a track of the person\'s own through Orbis Music, or a website\'s own sound that Orbis can see, or nothing. Includes where it has got to, how long it is, the queue, and whether Orbis knows the name of a song playing on a web page.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const handle = music()
      const [state, heard] = [await handle.snapshot(), handle.heard()]
      const playback = state.playback
      return {
        // The one answer everything else reads. Never worked out from anything but the player's own state.
        source: playback.owner === 'orbis-music' ? 'orbis-music' : playback.owner === 'website' ? 'website' : 'nothing',
        playing: playback.playing,
        position: Math.round(playback.position),
        duration: Math.round(playback.duration),
        shuffle: playback.shuffle,
        repeat: playback.repeat,
        volume: Math.round(playback.volume * 100) / 100,
        muted: playback.muted,
        track: state.track ? forOrion(state.track) : null,
        queue: state.queue.slice(0, 50).map(forOrion),
        problem: playback.problem ?? undefined,
        /*
         * What is playing on a web page, when something is.
         *
         * Separate from `track` on purpose: a song heard on a page is not a song the person has. `inYourMusic` says
         * whether they already own it, which is what makes "add this" answerable without guessing.
         */
        onAPage: heard.sighting
          ? {
              provider: heard.sighting.provider,
              playing: heard.sighting.playing,
              recognised: heard.recognition?.names ?? null,
              howSure: heard.recognition?.confidence ?? null,
              workedOutBy: heard.recognition?.method ?? null,
              couldNotTell: heard.recognition?.names ? undefined : (heard.recognition?.why ?? undefined),
              inYourMusic: heard.inLibraryId ?? undefined
            }
          : null
      }
    }
  })

  o.control.register({
    ...common,
    id: 'music.search',
    name: 'Search your music',
    description: 'Finds tracks in the person\'s own music library by title, artist, album or genre. Answers only with what is actually stored.',
    params: {
      query: str('Words to look for.'),
      favourite: bool('Only favourites.'),
      offlineOnly: bool('Only tracks with audio on this computer.'),
      limit: num('How many at most (default 25).', false, { min: 1, max: 200 })
    },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const found = await music().store.search({
        search: typeof p.query === 'string' ? p.query : undefined,
        favourite: p.favourite === true ? true : undefined,
        offlineOnly: p.offlineOnly === true ? true : undefined
      })
      const limit = typeof p.limit === 'number' ? Math.min(Math.max(p.limit, 1), 200) : 25
      return { found: found.length, tracks: found.slice(0, limit).map(forOrion) }
    }
  })

  o.control.register({
    ...common,
    id: 'music.playlists',
    name: 'Your playlists',
    description: 'The person\'s playlists, with how many tracks each holds. A playlist worked out from a rule is marked as such.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const handle = music()
      const lists = await handle.store.lists()
      const out = []
      for (const list of lists) {
        const tracks = await handle.store.listTracks(list.id)
        out.push({ id: list.id, name: list.name, tracks: tracks.length, workedOut: Boolean(list.rule), playable: tracks.filter(playableOffline).length })
      }
      return { playlists: out }
    }
  })

  // ---------------------------------------------------------------- playing

  o.control.register({
    ...common,
    id: 'music.play',
    name: 'Play music',
    description:
      'Plays the person\'s own music. With no argument, carries on what was playing. With words, finds the best match in their library and plays it. Refuses, with a reason, anything Orbis has no audio for.',
    params: { query: str('A track, artist or album to find and play.'), trackId: str('An exact track, from music.search.') },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      if (typeof p.trackId === 'string' && p.trackId) {
        const outcome = await handle.player.playTrack(p.trackId)
        if (!outcome.ok) fail('invalid-params', outcome.why ?? 'That track could not be played.', true)
        const track = await handle.store.track(p.trackId)
        return { playing: track ? forOrion(track) : null }
      }
      if (typeof p.query === 'string' && p.query.trim()) {
        const found = await handle.store.search({ search: p.query, offlineOnly: true })
        if (found.length === 0) {
          // Honest about the difference: they may well have the song by name and not have the audio.
          const known = await handle.store.search({ search: p.query })
          fail(
            'not-found',
            known.length > 0
              ? `Orbis knows "${known[0].title}" but has no audio for it on this computer. Importing a copy is what makes it playable.`
              : `There is nothing in your music matching "${p.query.slice(0, 60)}".`,
            true
          )
        }
        const outcome = await handle.player.playAll(found.map((track) => track.id))
        if (!outcome.ok) fail('failed', outcome.why ?? 'That could not be played.', true)
        return { playing: forOrion(found[0]), queued: found.length }
      }
      handle.player.play()
      const state = await handle.snapshot()
      if (!state.playback.trackId) fail('not-found', 'There is nothing to carry on with. Ask for something to play.', true)
      return { playing: state.track ? forOrion(state.track) : null }
    },
    verify: async () => {
      const state = await music().snapshot()
      return {
        verified: state.playback.playing,
        detail: state.playback.playing ? `Playing ${state.track?.title ?? 'a track'}.` : (state.playback.problem ?? 'It did not start.')
      }
    }
  })

  o.control.register({
    ...common,
    id: 'music.playPlaylist',
    name: 'Play a playlist',
    description: 'Plays one of the person\'s playlists by name. Only the tracks with audio on this computer are played.',
    params: { name: str('The playlist\'s name.', true), shuffle: bool('Play it in a shuffled order.') },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      const wanted = String(p.name ?? '').trim().toLowerCase()
      const lists = await handle.store.lists()
      const list = lists.find((one) => one.name.toLowerCase() === wanted) ?? lists.find((one) => one.name.toLowerCase().includes(wanted))
      if (!list) fail('not-found', `There is no playlist called "${String(p.name).slice(0, 60)}".`, true)
      if (p.shuffle === true) await handle.player.setShuffle(true)
      const outcome = await handle.port.playPlaylist(list!.id)
      if (!outcome.ok) fail('failed', outcome.why ?? 'That playlist could not be played.', true)
      return { playlist: list!.name }
    },
    verify: async () => {
      const state = await music().snapshot()
      return { verified: state.playback.playing, detail: state.playback.playing ? `Playing ${state.track?.title ?? 'the playlist'}.` : 'It did not start.' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.pause',
    name: 'Pause music',
    description: 'Pauses what Orbis Music is playing. A website\'s own sound is paused with media.pause instead, because that player is the website\'s.',
    params: {},
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async () => {
      const handle = music()
      const before = await handle.snapshot()
      if (before.playback.owner !== 'orbis-music') {
        // Said plainly rather than quietly doing nothing: a website's player is not Orbis's to pause from here.
        return { paused: false, detail: before.playback.owner === 'website' ? 'The sound is a web page\'s own. Pausing it is media.pause.' : 'Orbis Music is not playing.' }
      }
      handle.player.pause()
      return { paused: true }
    },
    verify: async () => {
      const state = await music().snapshot()
      // A sound that is not Orbis's was never this capability's to stop. Saying so is the right outcome, so checking
      // afterwards has to agree -- otherwise Orion is told the call failed when it did exactly what it should.
      if (state.playback.owner !== 'orbis-music') {
        return { verified: true, detail: state.playback.owner === 'website' ? 'The sound belongs to a web page, so Orbis Music left it alone.' : 'Orbis Music was not playing.' }
      }
      return { verified: !state.playback.playing, detail: state.playback.playing ? 'It is still playing.' : 'It is paused.' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.next',
    name: 'Next track',
    description: 'Moves to the next track in the queue.',
    params: {},
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async () => {
      const handle = music()
      const before = handle.player.current().trackId
      await handle.player.next()
      const after = await handle.snapshot()
      return { moved: after.playback.trackId !== before, track: after.track ? forOrion(after.track) : null }
    }
  })

  o.control.register({
    ...common,
    id: 'music.previous',
    name: 'Previous track',
    description: 'Goes back to the track before this one, or starts this one again when it is well under way.',
    params: {},
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async () => {
      const handle = music()
      await handle.player.previous()
      const after = await handle.snapshot()
      return { track: after.track ? forOrion(after.track) : null, position: Math.round(after.playback.position) }
    }
  })

  o.control.register({
    ...common,
    id: 'music.seek',
    name: 'Jump to a point in the track',
    description: 'Moves to a number of seconds into the track that is playing.',
    params: { seconds: num('How many seconds in.', true, { min: 0 }) },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      if (!handle.player.current().trackId) fail('not-found', 'Orbis Music is not playing anything to jump about in.', true)
      handle.player.seek(Number(p.seconds))
      return { seconds: Number(p.seconds) }
    },
    verify: async (_data, p) => {
      const state = await music().snapshot()
      const wanted = Number((p as { seconds?: number }).seconds ?? 0)
      const close = Math.abs(state.playback.position - wanted) < 2
      return { verified: close, detail: `It is at ${Math.round(state.playback.position)} seconds.` }
    }
  })

  o.control.register({
    ...common,
    id: 'music.volume',
    name: 'Set the music volume',
    description: 'Sets how loud Orbis Music is, from 0 to 1. This is Orbis\'s own volume, not the computer\'s and not a web page\'s.',
    params: { level: num('From 0 (silent) to 1 (full).', true, { min: 0, max: 1 }), muted: bool('Silence it without changing the level.') },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      if (typeof p.muted === 'boolean') handle.player.setMuted(p.muted)
      if (typeof p.level === 'number') await handle.player.setVolume(p.level)
      const state = handle.player.current()
      return { level: Math.round(state.volume * 100) / 100, muted: state.muted }
    }
  })

  /*
   * Shuffle and repeat: read by `music.current` since the beginning, and settable by nothing.
   *
   * The gap was real rather than cosmetic. "What is playing?" answered with `shuffle` and `repeat` in it, so anything
   * reading that answer could see them -- and there was no capability that could change either, which means a spoken
   * "shuffle my music" had no way through at all. Both go through `handle.ask`, the one operation runner the window
   * and the browser's own panel both use, so this is the same door rather than a second one.
   */
  o.control.register({
    ...common,
    id: 'music.shuffle',
    name: 'Shuffle the music',
    description: 'Turns shuffling on or off for Orbis Music. Shuffling changes the order the queue is played in; it never changes what is in the queue.',
    params: { on: bool('True to shuffle, false to play in order.', true) },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      await music().ask('shuffle', p.on === true)
      return { shuffle: p.on === true }
    },
    verify: async (_data, p) => {
      const state = await music().snapshot()
      const wanted = (p as { on?: boolean }).on === true
      return { verified: state.playback.shuffle === wanted, detail: state.playback.shuffle ? 'Shuffling is on.' : 'Shuffling is off.' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.repeat',
    name: 'Repeat the music',
    description: 'Sets what happens at the end: off stops, all starts the queue again, one plays the same track over.',
    params: { mode: str('off, all, or one.', true) },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const mode = String(p.mode ?? '').trim().toLowerCase()
      // Refused with the three words rather than quietly becoming "off", which is what the operation runner does with
      // anything it does not recognise -- and being told "done" about a mode nobody asked for is the worse answer.
      if (!['off', 'all', 'one'].includes(mode)) fail('invalid-params', `"mode" must be one of: off, all, one. "${String(p.mode).slice(0, 40)}" was given.`, true)
      await music().ask('repeat', mode)
      return { repeat: mode }
    },
    verify: async (_data, p) => {
      const state = await music().snapshot()
      const wanted = String((p as { mode?: string }).mode ?? '').trim().toLowerCase()
      return { verified: state.playback.repeat === wanted, detail: `Repeat is ${state.playback.repeat}.` }
    }
  })

  o.control.register({
    ...common,
    id: 'music.queue',
    name: 'Add to the queue',
    description: 'Puts tracks in the queue, either straight after the one playing or at the end.',
    params: { query: str('A track, artist or album to find.', true), next: bool('Play it next rather than last.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      const found = await handle.store.search({ search: String(p.query ?? ''), offlineOnly: true })
      if (found.length === 0) fail('not-found', `There is nothing playable in your music matching "${String(p.query).slice(0, 60)}".`, true)
      const ids = found.slice(0, 50).map((track) => track.id)
      if (p.next === true) handle.player.queueNext(ids)
      else handle.player.queueEnd(ids)
      return { added: ids.length, first: forOrion(found[0]), where: p.next === true ? 'next' : 'end' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.favourite',
    name: 'Favourite a track',
    description: 'Marks the track playing, or a named one, as a favourite -- or takes the mark off.',
    params: { trackId: str('Which track (default: the one playing).'), favourite: bool('True to mark it, false to unmark it.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      const trackId = typeof p.trackId === 'string' && p.trackId ? p.trackId : handle.player.current().trackId
      if (!trackId) fail('not-found', 'There is no track to mark.', true)
      const on = p.favourite !== false
      const track = await handle.store.setFavourite(trackId!, on)
      if (!track) fail('not-found', 'That track is not in your music.', true)
      return { track: forOrion(track!), favourite: on }
    }
  })

  // ---------------------------------------------------------------- what is playing on a page

  o.control.register({
    ...common,
    id: 'music.recognise',
    name: 'Work out what is playing on this page',
    description:
      'Looks at the page playing music and works out the song: what the page itself published first, then by reading the player on screen. Answers "could not tell" rather than guessing. Changes nothing on the page.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const heard = await music().look({ force: true })
      if (!heard.sighting) return { playing: false, detail: 'Nothing in the browser is playing.' }
      return {
        playing: heard.sighting.playing,
        provider: heard.sighting.provider,
        recognised: heard.recognition?.names ?? null,
        howSure: heard.recognition?.confidence ?? null,
        workedOutBy: heard.recognition?.method ?? null,
        couldNotTell: heard.recognition?.names ? undefined : (heard.recognition?.why ?? 'Orbis could not work out what this is.'),
        inYourMusic: heard.inLibraryId ?? undefined
      }
    }
  })

  o.control.register({
    ...common,
    id: 'music.keepHeard',
    name: 'Add the song playing to your music',
    description:
      'Keeps the song playing on the page. If the person already has the file, that file is linked. If several files might be it, Orbis says which to choose. If they have no copy, the name is kept and Orbis says plainly that there is no audio. Nothing is ever downloaded, and protected streams are never turned into files.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => {
      const handle = music()
      const heard = handle.heard()
      const names = heard.recognition?.names
      if (!names) fail('not-found', heard.recognition?.why ?? 'Orbis does not know what is playing, so there is nothing to keep.', true)
      const outcome = await handle.library.addHeard(names!, heard.sighting?.duration ?? 0, {
        provider: heard.sighting?.provider ?? 'unknown',
        url: heard.sighting?.url
      })
      switch (outcome.kind) {
        case 'already':
          return { kept: true, how: 'you already have it', track: forOrion(outcome.track) }
        case 'linked':
          return { kept: true, how: 'linked to your own copy', track: forOrion(outcome.track) }
        case 'reference':
          return {
            kept: true,
            how: 'saved by name only',
            track: forOrion(outcome.track),
            detail: 'There is no audio for this on this computer. Importing your own copy is what makes it playable.'
          }
        case 'ask':
          return { kept: false, how: 'several files might be it', choices: outcome.choices.map(forOrion) }
        default:
          return { kept: false, how: 'refused', detail: outcome.why }
      }
    },
    verify: async (data) => {
      const answer = data as { kept?: boolean; track?: { id?: string } }
      if (!answer?.kept || !answer.track?.id) return { verified: false, detail: 'Nothing was added.' }
      const track = await music().store.track(String(answer.track.id))
      return { verified: Boolean(track), detail: track ? `"${track.title}" is in your music.` : 'It is not in the library.' }
    }
  })
  // ---------------------------------------------------------------- stopping, and the queue itself

  o.control.register({
    ...common,
    id: 'music.stop',
    name: 'Stop the music',
    description: 'Stops Orbis Music and lets go of the track. Different from pausing: pausing keeps the place, this does not.',
    params: {},
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    already: async () => {
      const state = await music().snapshot()
      // Stopping what is already stopped is harmless, but reported as done it hides that nothing was playing.
      return state.playback.owner === 'orbis-music' && state.playback.trackId ? null : 'Orbis Music is not playing anything.'
    },
    run: async () => {
      await music().ask('stop')
      return { stopped: true }
    },
    verify: async () => {
      const state = await music().snapshot()
      const quiet = !state.playback.playing && !state.playback.trackId
      return { verified: quiet, detail: quiet ? 'Orbis Music has stopped.' : 'Something is still playing.' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.queueChange',
    name: 'Change the queue',
    description:
      'Takes a track out of the queue, moves one up or down it, or empties it. Positions are counted from 1, as they are on screen. Emptying the queue never stops what is playing and never touches the library.',
    params: {
      what: { type: 'string', description: 'remove, move, or clear.', required: true, enum: ['remove', 'move', 'clear'] },
      position: num('Which one, counting from 1. Needed for remove and move.', false, { min: 1 }),
      to: num('Where it should end up, counting from 1. Needed for move.', false, { min: 1 })
    },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    // The length before, so afterwards there is something real to compare with rather than a guess at what happened.
    observe: async () => (await music().snapshot()).queue.length,
    run: async (p, _ctx, before) => {
      const handle = music()
      const what = String(p.what)
      if (what === 'clear') {
        if (before === 0) return { what, emptied: 0 }
        await handle.ask('queue-clear')
        return { what, emptied: before }
      }
      const position = Number(p.position)
      if (!Number.isInteger(position) || position < 1) fail('invalid-params', '"position" is which one in the queue, counting from 1.', true)
      /*
       * Refused with the real length rather than quietly doing nothing.
       *
       * The runner below takes an index and ignores one it cannot use, so without this a request for the eleventh of
       * three would come back having done nothing at all and be reported as a queue that was changed.
       */
      if (position > before) {
        fail('invalid-params', before === 0 ? 'There is nothing in the queue.' : `The queue has ${before} in it, so there is no number ${position}.`, true)
      }
      if (what === 'remove') {
        await handle.ask('queue-remove', position - 1)
        return { what, position, wasInQueue: before }
      }
      const to = Number(p.to)
      if (!Number.isInteger(to) || to < 1 || to > before) {
        fail('invalid-params', `"to" is where it should end up, from 1 to ${before}.`, true)
      }
      await handle.ask('queue-reorder', position - 1, to - 1)
      return { what, position, to, wasInQueue: before }
    },
    verify: async (data, _p, _ctx, before) => {
      const answer = data as { what?: string }
      const now = (await music().snapshot()).queue.length
      if (answer.what === 'clear') return { verified: now === 0, detail: now === 0 ? 'The queue is empty.' : `${now} are still in the queue.` }
      if (answer.what === 'remove') {
        return { verified: now === before - 1, detail: now === before - 1 ? `${now} left in the queue.` : `The queue still has ${now} in it.` }
      }
      // A move changes the order, not the count -- which is all the queue's own reading can confirm from here.
      return { verified: now === before, detail: `${now} in the queue, in a different order.` }
    }
  })

  // ---------------------------------------------------------------- playlists

  o.control.register({
    ...common,
    id: 'music.playlist',
    name: 'Make and change playlists',
    description:
      'Makes a playlist, renames one, puts tracks in or takes them out, or deletes one. Deleting a playlist never deletes the songs in it -- a playlist holds references, not copies -- and that is said when it is deleted.',
    keywords: ['playlist', 'collection', 'mix', 'rename', 'delete'],
    params: {
      what: { type: 'string', description: 'create, rename, add, remove, or delete.', required: true, enum: ['create', 'rename', 'add', 'remove', 'delete'] },
      playlist: str('Which playlist, by name or id. Needed for everything but create.'),
      name: str('The name. Needed for create and rename.'),
      query: str('Words finding the tracks to put in or take out.')
    },
    mutates: true,
    /*
     * A delete declared as a delete.
     *
     * `effects` is what the policy and the approval prompt read, and this capability can delete, so it declares it for
     * every call rather than being the quiet one. Which call is actually consequential is decided in `assess` below,
     * so renaming a playlist does not ask the person about a deletion.
     */
    effects: ['write', 'delete'],
    confirmation: 'when-consequential',
    assess: (p) =>
      String(p.what) === 'delete'
        ? { decision: 'confirm' as const, reason: 'Deleting a playlist cannot be undone from here. The songs in it stay in your music.' }
        : { decision: 'run' as const, reason: 'This changes a playlist, and deletes nothing.' },
    describe: (p) => {
      const what = String(p.what)
      const which = typeof p.playlist === 'string' ? `"${p.playlist}"` : 'a playlist'
      if (what === 'create') return `Make a playlist called "${String(p.name ?? '')}"`
      if (what === 'rename') return `Rename ${which} to "${String(p.name ?? '')}"`
      if (what === 'delete') return `Delete ${which}. The songs in it stay in your music.`
      return `${what === 'add' ? 'Put' : 'Take'} tracks matching "${String(p.query ?? '')}" ${what === 'add' ? 'into' : 'out of'} ${which}`
    },
    run: async (p) => {
      const handle = music()
      const what = String(p.what)
      const name = typeof p.name === 'string' ? p.name.trim() : ''

      if (what === 'create') {
        if (!name) fail('invalid-params', 'A playlist needs a name.', true)
        const made = (await handle.ask('create-playlist', name, [])) as { id?: string; name?: string } | null
        if (!made?.id) fail('failed', 'Orbis Music could not make that playlist.', true)
        return { what, playlist: { id: made!.id, name: made!.name ?? name }, tracks: 0 }
      }

      // Found by the name it has on screen, because that is what somebody says. Two of the same name is never guessed at.
      const lists = await handle.store.lists()
      const asked = typeof p.playlist === 'string' ? p.playlist.trim() : ''
      if (!asked) fail('invalid-params', 'Say which playlist.', true)
      const exact = lists.filter((one) => one.id === asked || one.name.toLowerCase() === asked.toLowerCase())
      const loose = exact.length ? exact : lists.filter((one) => one.name.toLowerCase().includes(asked.toLowerCase()))
      if (loose.length === 0) {
        fail(
          'not-found',
          lists.length === 0
            ? 'You have no playlists yet.'
            : `You have no playlist called "${asked.slice(0, 60)}". You have: ${lists.map((one) => one.name).join(', ')}.`,
          true
        )
      }
      if (loose.length > 1) {
        fail('invalid-params', `"${asked.slice(0, 60)}" matches ${loose.length} of your playlists: ${loose.map((one) => one.name).join(', ')}. Say which.`, true)
      }
      const list = loose[0]

      if (what === 'rename') {
        if (!name) fail('invalid-params', 'Say what to call it.', true)
        await handle.ask('rename-playlist', list.id, name)
        return { what, playlist: { id: list.id, name }, wasCalled: list.name }
      }
      if (what === 'delete') {
        const held = await handle.store.listTracks(list.id)
        await handle.ask('remove-playlist', list.id)
        return {
          what,
          playlist: { id: list.id, name: list.name },
          held: held.length,
          detail: `The ${held.length} ${held.length === 1 ? 'song' : 'songs'} in it are still in your music.`
        }
      }

      const query = typeof p.query === 'string' ? p.query.trim() : ''
      if (!query) fail('invalid-params', 'Say which tracks.', true)
      const before = await handle.store.listTracks(list.id)
      if (what === 'add') {
        const found = await handle.store.search({ search: query })
        if (found.length === 0) fail('not-found', `There is nothing in your music matching "${query.slice(0, 60)}".`, true)
        const ids = found.slice(0, 200).map((one) => one.id)
        await handle.ask('add-to-playlist', list.id, ids)
        const after = await handle.store.listTracks(list.id)
        return { what, playlist: { id: list.id, name: list.name }, matched: ids.length, added: after.length - before.length, tracks: after.length }
      }
      const inList = before.filter((one) => [one.title, one.artist, one.album].some((field) => (field ?? '').toLowerCase().includes(query.toLowerCase())))
      if (inList.length === 0) fail('not-found', `There is nothing in "${list.name}" matching "${query.slice(0, 60)}".`, true)
      for (const one of inList) await handle.ask('remove-from-playlist', list.id, one.id)
      const after = await handle.store.listTracks(list.id)
      return { what, playlist: { id: list.id, name: list.name }, removed: before.length - after.length, tracks: after.length }
    },
    verify: async (data) => {
      const answer = data as { what?: string; playlist?: { id?: string; name?: string }; tracks?: number }
      const id = answer.playlist?.id
      if (!id) return { verified: false, detail: 'Orbis Music did not say which playlist that was.' }
      const held = await music().store.list(id)
      if (answer.what === 'delete') {
        return { verified: !held, detail: held ? `"${held.name}" is still there.` : `"${answer.playlist?.name}" is gone. The songs in it are still in your music.` }
      }
      if (!held) return { verified: false, detail: 'That playlist is not there.' }
      if (answer.what === 'rename') return { verified: held.name === answer.playlist?.name, detail: `It is called "${held.name}".` }
      if (answer.what === 'create') return { verified: true, detail: `"${held.name}" is in your playlists, with nothing in it yet.` }
      return { verified: held.tracks.length === answer.tracks, detail: `"${held.name}" has ${held.tracks.length} in it.` }
    }
  })

  // ---------------------------------------------------------------- the preferences

  /**
   * Every music preference, with the type and the values the music store itself gives it.
   *
   * Built from `DEFAULT_MUSIC_SETTINGS` and `MUSIC_SETTING_VALUES` rather than written out, so a preference added to
   * the store is one Orion can read and set with no edit here -- and one that could never be offered with a type or a
   * list of values the store would then refuse.
   */
  const settingKinds = (): Record<string, SettingKind> => {
    const out: Record<string, SettingKind> = {}
    for (const [key, value] of Object.entries(DEFAULT_MUSIC_SETTINGS)) {
      const choices = (MUSIC_SETTING_VALUES as Record<string, readonly string[] | undefined>)[key]
      if (choices) out[key] = { type: 'string', values: choices, settable: true }
      else if (typeof value === 'boolean') out[key] = { type: 'boolean', settable: true }
      else if (typeof value === 'number') out[key] = { type: 'number', min: 0, max: 1, settable: true }
      // A list of folders needs a person at a file picker, so it is a reading here and says what to do instead.
      else if (Array.isArray(value)) out[key] = { type: 'string', settable: 'Folders are chosen at a file picker in the Orbis window, so they cannot be set from here.' }
      else out[key] = { type: 'string', settable: 'Orbis does not know what kind of value this is, so it will not set it.' }
    }
    return out
  }

  o.control.register({
    ...common,
    id: 'music.settings',
    name: 'Your music preferences',
    description:
      'Every Orbis Music preference as it is now, with what each one may be set to and which cannot be set from here. Reads the stored preferences; it never guesses a default for one it could not read.',
    keywords: ['preference', 'setting', 'recognition', 'resume', 'mini player', 'folders', 'sort', 'view'],
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const held = (await music().store.settings()) as unknown as Record<string, unknown>
      const kinds = settingKinds()
      return {
        preferences: Object.entries(kinds).map(([name, kind]) => ({
          name,
          value: held[name],
          type: kind.type,
          values: kind.values,
          min: kind.min,
          max: kind.max,
          settable: kind.settable === true,
          whyNot: kind.settable === true ? undefined : kind.settable,
          default: (DEFAULT_MUSIC_SETTINGS as unknown as Record<string, unknown>)[name]
        })),
        watchingFolders: Array.isArray(held.folders) ? held.folders.length : 0
      }
    }
  })

  o.control.register({
    ...common,
    id: 'music.setPreference',
    name: 'Change a music preference',
    description:
      'Changes one Orbis Music preference. The name and the value are checked against what the music store itself allows, and anything else is refused with the list rather than quietly becoming the default.',
    keywords: ['preference', 'setting', 'recognition', 'resume', 'mini player', 'sort', 'view', 'play on start'],
    params: {
      name: str('Which preference. music.settings lists them.', true),
      value: { type: 'string', description: 'What to set it to. A switch takes true or false; a volume takes 0 to 1.', required: true }
    },
    mutates: true,
    effects: ['write'],
    confirmation: 'none',
    describe: (p) => `Set the music preference "${String(p.name)}" to ${String(p.value)}`,
    // What it held before, so an undo puts back what was really there rather than the default.
    observe: async () => music().store.settings(),
    already: async (p) => {
      const kinds = settingKinds()
      const name = String(p.name ?? '')
      const kind = kinds[name]
      if (!kind || kind.settable !== true) return null
      const held = (await music().store.settings()) as unknown as Record<string, unknown>
      const wanted = readValue(kind, p.value)
      // A value that cannot even be read is not "already set": it goes on to be refused with what it should have been.
      if (!wanted.ok) return null
      return held[name] === wanted.value ? `"${name}" is already ${String(wanted.value)}.` : null
    },
    run: async (p) => {
      const kinds = settingKinds()
      const name = String(p.name ?? '')
      const kind = kinds[name]
      if (!kind) fail('invalid-params', `There is no music preference called "${name.slice(0, 40)}". There is: ${Object.keys(kinds).join(', ')}.`, true)
      if (kind!.settable !== true) fail('invalid-params', kind!.settable as string, true)
      const wanted = readValue(kind!, p.value)
      // Refused with what it should have been, rather than written as whatever the value happened to turn into.
      if (!wanted.ok) return fail('invalid-params', wanted.why, true)
      const saved = (await music().ask('save-settings', { [name]: wanted.value })) as MusicSettings | null
      const got = saved ? (saved as unknown as Record<string, unknown>)[name] : undefined
      return { name, value: got, asked: wanted.value }
    },
    verify: async (data) => {
      const answer = data as { name?: string; asked?: unknown }
      // Asked of the store again rather than trusting what the save handed back.
      const held = (await music().store.settings()) as unknown as Record<string, unknown>
      const now = held[String(answer.name)]
      return { verified: now === answer.asked, detail: `"${answer.name}" is ${String(now)}.` }
    },
    undo: ({ params, before }) => {
      const name = String(params.name ?? '')
      const was = (before as unknown as Record<string, unknown>)[name]
      return was === undefined ? null : { capability: 'music.setPreference', params: { name, value: String(was) } }
    }
  })

  // ---------------------------------------------------------------- how Orbis chooses

  o.control.register({
    ...common,
    id: 'music.listening',
    name: 'How Orbis should choose music',
    description:
      'Sets what the listening is for -- focus, workout, sleep and the rest -- and how far from the familiar Orbis may go. Neither one plays anything; they change what Orbis would choose next.',
    keywords: ['mode', 'mood', 'focus', 'workout', 'sleep', 'discovery', 'adventurous', 'familiar', 'taste'],
    params: {
      mode: { type: 'string', description: 'What the listening is for, or "none" to stop asking for one.', enum: [...Object.keys(MODE_SHAPE), 'none'] },
      discovery: { type: 'string', description: 'How far from the familiar.', enum: Object.keys(DISCOVERY_LEVELS) }
    },
    mutates: true,
    effects: ['write'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      const mode = typeof p.mode === 'string' ? p.mode.trim().toLowerCase() : ''
      const discovery = typeof p.discovery === 'string' ? p.discovery.trim().toLowerCase() : ''
      if (!mode && !discovery) fail('invalid-params', 'Say a mode, a discovery level, or both.', true)
      const out: Record<string, unknown> = {}
      if (mode) {
        /*
         * Nothing checks the two names here, and that is deliberate.
         *
         * Declaring them as a `ParamSpec` enum is what refuses an unknown one, before `run` is reached and with the
         * whole list in the refusal -- the same check and the same wording as every other capability's parameters.
         * A second check written here would be unreachable, and the day somebody changed one of the two lists it
         * would be unreachable and wrong. The thing that matters is that the operation runner itself does *not*
         * check: it hands an unknown mode to the ranker, which then chooses by a shape nobody asked for.
         */
        await handle.ask('mode', mode === 'none' ? null : mode)
        out.mode = mode === 'none' ? null : mode
      }
      if (discovery) {
        // What came back is the tuning as it now is, in numbers -- the level is a name for one of them.
        out.tuning = await handle.ask('discovery-level', discovery)
        out.discovery = discovery
      }
      return out
    },
    /*
     * Only half of this can be confirmed, and the words say which half.
     *
     * Setting a discovery level comes back with the ranker's tuning as it now is, so the number the level stands for
     * can be compared with the number the ranker really holds -- a reading, and a wrong one fails. The listening mode
     * is held inside the ranker and nothing reads it back, so there is nothing to compare it with. Said as unverified
     * it would be retried and then reported as a failure, which is wrong about something that worked; said with the
     * registry's own wording for no check at all -- "Confirmed by the action itself" -- it would claim a reading that
     * nobody took. So it passes, and the sentence a person is shown says it is what was asked for rather than what
     * was read. The way to make it a real reading is for the engine to answer what mode it is in.
     */
    verify: (data) => {
      const answer = data as { mode?: string | null; discovery?: string; tuning?: { discovery?: number } }
      const aboutMode = 'mode' in answer ? ` The mode was set to ${String(answer.mode)}; nothing reads a mode back, so that part is what was asked for rather than what was read.` : ''
      if (answer.discovery) {
        const wanted = DISCOVERY_LEVELS[answer.discovery as keyof typeof DISCOVERY_LEVELS]
        const got = answer.tuning?.discovery
        const right = typeof got === 'number' && Math.abs(got - wanted) < 0.001
        return {
          verified: right,
          detail: right ? `Orbis is choosing at ${answer.discovery} (${got}).${aboutMode}` : `Orbis is choosing at ${String(got)}, which is not the ${wanted} that ${answer.discovery} means.`
        }
      }
      return { verified: true, detail: aboutMode.trim() }
    }
  })

  o.control.register({
    ...common,
    id: 'music.dj',
    name: 'Let Orbis keep the music going',
    description:
      "Turns the DJ on or off. With it on, Orbis keeps the queue filled from the person's own music as it empties. It only ever plays what they already have.",
    keywords: ['dj', 'autoplay', 'keep playing', 'carry on', 'endless'],
    params: { on: bool('True to let Orbis keep it going, false to stop.', true) },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const answer = (await music().ask('dj', p.on === true)) as { ok?: boolean; dj?: boolean; why?: string } | null
      // The runner refuses this when there is too little music to choose from, and says why. That reason is the answer.
      if (answer && answer.ok === false) fail('unavailable', answer.why ?? 'Orbis cannot keep the music going yet.', true)
      return { dj: answer?.dj ?? p.on === true }
    }
  })

  o.control.register({
    ...common,
    id: 'music.radio',
    name: 'Start a station',
    description:
      "Starts a station that keeps going: from a track in the person's music when one is named, or from what Orbis knows of their taste when none is. Everything it plays is music they already have.",
    keywords: ['radio', 'station', 'more like this', 'similar'],
    params: { query: str('A track to build it around. Left out, Orbis builds it from what it knows.') },
    mutates: true,
    effects: ['execute'],
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      let seed: string | undefined
      const query = typeof p.query === 'string' ? p.query.trim() : ''
      if (query) {
        const found = await handle.store.search({ search: query, offlineOnly: true })
        if (found.length === 0) fail('not-found', `There is nothing playable in your music matching "${query.slice(0, 60)}".`, true)
        seed = found[0].id
      }
      const answer = (await handle.ask('radio', seed)) as { ok?: boolean; why?: string } | null
      if (answer && answer.ok === false) fail('unavailable', answer.why ?? 'Orbis could not start a station.', true)
      const after = await handle.snapshot()
      const from = seed ? await handle.store.track(seed) : null
      return { startedFrom: from ? forOrion(from) : null, playing: after.track ? forOrion(after.track) : null, queued: after.queue.length }
    },
    verify: async () => {
      const state = await music().snapshot()
      const going = state.playback.owner === 'orbis-music' && Boolean(state.playback.trackId)
      return { verified: going, detail: going ? `The station is playing "${state.track?.title ?? 'something'}".` : 'Nothing is playing.' }
    }
  })

  o.control.register({
    ...common,
    id: 'music.why',
    name: 'Why this track',
    description:
      "What made Orbis choose the track playing, or a named one: what in the person's listening it leans on, and how sure Orbis is. Answers \"not sure yet\" rather than inventing a reason.",
    keywords: ['why', 'reason', 'chosen', 'taste'],
    params: { trackId: str('Which track (default: the one playing).') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const handle = music()
      const trackId = typeof p.trackId === 'string' && p.trackId ? p.trackId : handle.player.current().trackId
      if (!trackId) fail('not-found', 'Nothing is playing, so there is nothing to explain.', true)
      const answer = await handle.ask('why', trackId)
      // Nothing measured yet is said as that. A made-up reason about somebody's own taste is the worst answer here.
      if (!answer) return { trackId, known: false, detail: 'Orbis has not listened with you long enough to say why.' }
      return { trackId, known: true, affinity: answer }
    }
  })
}
