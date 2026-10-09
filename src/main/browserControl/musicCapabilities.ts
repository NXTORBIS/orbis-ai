import type { BrowserControl } from './registry.ts'
import { fail } from './registry.ts'
import type { ParamSpec } from '../../shared/browserControl.ts'
import type { MusicHandle } from '../music/service.ts'
import { playableOffline, whyNotPlayable, type OrbisTrack } from '../../shared/music.ts'

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
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const num = (description: string, required = false, range?: { min?: number; max?: number }): ParamSpec => ({ type: 'number', description, required, ...range })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })

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
}
