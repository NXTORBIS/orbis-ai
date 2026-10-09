import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MusicLibrary } from './library.ts'
import { MusicStore } from './store.ts'
import { playableOffline } from '../../shared/music.ts'

/**
 * These write real audio files to a real folder and import them, because that is the only way to know the import
 * works. The files are small but genuine: a correct ID3 tag, a real MPEG frame header, a Xing header where a decoder
 * looks for it -- so the length in the library is read out of the file exactly as it would be from somebody's own
 * music.
 */

const bytes = (...values: (number | number[] | string | Uint8Array)[]): Uint8Array => {
  const out: number[] = []
  for (const value of values) {
    if (typeof value === 'number') out.push(value & 0xff)
    else if (typeof value === 'string') for (const char of value) out.push(char.charCodeAt(0) & 0xff)
    else for (const n of value) out.push(n & 0xff)
  }
  return new Uint8Array(out)
}
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const synchSafe = (n: number): number[] => [(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]

const textFrame = (name: string, value: string): Uint8Array => {
  const body = bytes(0x03, value)
  return bytes(name, be32(body.length), [0, 0], body)
}

/** A real MP3: an ID3v2.3 tag, then one frame carrying a Xing header that says how many frames there are. */
const mp3 = (tags: { title?: string; artist?: string; album?: string; track?: string }, frames = 7000, picture?: Uint8Array): Uint8Array => {
  const parts: Uint8Array[] = []
  if (tags.title) parts.push(textFrame('TIT2', tags.title))
  if (tags.artist) parts.push(textFrame('TPE1', tags.artist))
  if (tags.album) parts.push(textFrame('TALB', tags.album))
  if (tags.track) parts.push(textFrame('TRCK', tags.track))
  if (picture) {
    const body = bytes(0x00, 'image/jpeg', 0x00, 0x03, 'Cover', 0x00, picture)
    parts.push(bytes('APIC', be32(body.length), [0, 0], body))
  }
  const tag = bytes(...parts)
  const header = bytes('ID3', [3, 0], 0x00, synchSafe(tag.length), tag)
  const frame = bytes([0xff, 0xfb, 0x90, 0x00], new Uint8Array(32), bytes('Xing', be32(0x01), be32(frames)), new Uint8Array(417 - 4 - 32 - 12))
  return bytes(header, frame)
}

/** Seconds for a given number of frames, which is what the reader must come back with. */
const seconds = (frames: number): number => (frames * 1152) / 44100

interface World {
  store: MusicStore
  library: MusicLibrary
  dir: string
  music: string
  write(name: string, data: Uint8Array): Promise<string>
}

let ids = 0
const world = async (): Promise<World> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-music-'))
  const music = join(dir, 'Music')
  await fs.mkdir(music, { recursive: true })
  const store = new MusicStore(dir)
  const library = new MusicLibrary(store, () => `t${++ids}`)
  return {
    store,
    library,
    dir,
    music,
    write: async (name, data) => {
      const path = join(music, name)
      await fs.writeFile(path, data)
      return path
    }
  }
}

// ---------------------------------------------------------------- importing a real file

test('a real file is read, and everything in the library came out of it', async () => {
  const w = await world()
  const path = await w.write('blinding.mp3', mp3({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', track: '9/14' }, 7000))

  const result = await w.library.importFile(path)
  assert.equal(result.kind, 'added', result.why)
  const track = result.track!
  assert.equal(track.title, 'Blinding Lights')
  assert.equal(track.artist, 'The Weeknd')
  assert.equal(track.trackNumber, 9)
  assert.ok(Math.abs(track.duration - seconds(7000)) < 0.01, `length ${track.duration} came from the file`)
  assert.equal(track.availability, 'local')
  assert.equal(track.method, 'file-tags')
  assert.equal(playableOffline(track), true)
  assert.equal(track.file, path)
  assert.ok(track.fileSize && track.fileSize > 0)

  assert.equal((await w.store.all()).length, 1)
})

test('a file with no tags is named after the file, which is at least true', async () => {
  const w = await world()
  const path = await w.write('some_song_name.mp3', mp3({}, 100))
  const result = await w.library.importFile(path)
  assert.equal(result.track?.title, 'some song name')
  assert.equal(result.track?.artist, '', 'and the artist stays blank rather than being guessed')
  assert.equal(result.track?.confidence, 'medium')
})

test('artwork is written into the profile, with the picture the file carried', async () => {
  const w = await world()
  const picture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7])
  const path = await w.write('art.mp3', mp3({ title: 'With Art' }, 100, picture))
  const result = await w.library.importFile(path)
  const artwork = result.track?.artwork
  assert.ok(artwork, 'there is a picture')
  assert.deepEqual([...(await fs.readFile(artwork!))], [...picture], 'and it is the one from the file')
})

test('a tag holding something that is not a picture does not become one', async () => {
  const w = await world()
  const notAPicture = new TextEncoder().encode('this is not an image at all')
  const path = await w.write('bad-art.mp3', mp3({ title: 'No Art' }, 100, notAPicture))
  const result = await w.library.importFile(path)
  assert.equal(result.track?.artwork, undefined)
})

test('the same file imported twice is the same one track', async () => {
  const w = await world()
  const path = await w.write('one.mp3', mp3({ title: 'Once' }, 100))
  await w.library.importFile(path)
  const again = await w.library.importFile(path)
  assert.equal(again.kind, 'already')
  assert.equal((await w.store.all()).length, 1)
})

test('a file that is not audio is refused, and nothing is added', async () => {
  const w = await world()
  const path = await w.write('notes.mp3', new TextEncoder().encode('Dear diary, this is not a song.'))
  const result = await w.library.importFile(path)
  assert.equal(result.kind, 'failed')
  assert.match(result.why ?? '', /not an audio file/)
  assert.equal((await w.store.all()).length, 0, 'a broken file never becomes a healthy track')
})

test('a file that is not there, an empty file, and a folder each say what is wrong', async () => {
  const w = await world()
  assert.match((await w.library.importFile(join(w.music, 'nothing.mp3'))).why ?? '', /not there/)
  const empty = await w.write('empty.mp3', new Uint8Array(0))
  assert.match((await w.library.importFile(empty)).why ?? '', /empty/)
  assert.match((await w.library.importFile(w.music)).why ?? '', /folder, not an audio file/)
})

// ---------------------------------------------------------------- several files, and a folder

test('importing several files reports what really happened to each', async () => {
  const w = await world()
  const good = await w.write('a.mp3', mp3({ title: 'A' }, 100))
  const alsoGood = await w.write('b.mp3', mp3({ title: 'B' }, 200))
  const bad = await w.write('c.mp3', new TextEncoder().encode('nope'))

  const seen: number[] = []
  const outcome = await w.library.importFiles([good, alsoGood, bad], (progress) => seen.push(progress.done))
  assert.deepEqual([outcome.added, outcome.failed, outcome.already], [2, 1, 0])
  assert.equal(outcome.total, 3)
  assert.ok(seen.length >= 3, 'progress was reported as it went, not made up at the end')
  assert.deepEqual(
    (await w.store.all()).map((t) => t.title).sort(),
    ['A', 'B']
  )
})

test('a folder is read, including the folders inside it', async () => {
  const w = await world()
  await w.write('top.mp3', mp3({ title: 'Top' }, 100))
  await fs.mkdir(join(w.music, 'Album'), { recursive: true })
  await fs.writeFile(join(w.music, 'Album', 'inner.mp3'), mp3({ title: 'Inner' }, 100))
  await fs.writeFile(join(w.music, 'notes.txt'), 'not music')

  const outcome = await w.library.scanFolder(w.music)
  assert.equal(outcome.added, 2, 'both songs, and not the text file')
  assert.equal(outcome.total, 2)
})

test('a scan that is stopped keeps what it had already read', async () => {
  const w = await world()
  for (let i = 0; i < 6; i += 1) await w.write(`song${i}.mp3`, mp3({ title: `Song ${i}` }, 100))

  let stopped = false
  const running = w.library.scanFolder(w.music, (progress) => {
    if (progress.done >= 2 && !stopped) {
      stopped = true
      w.library.stopScan()
    }
  })
  const outcome = await running
  assert.ok(outcome.added >= 2 && outcome.added < 6, `${outcome.added} were kept`)
  assert.equal((await w.store.all()).length, outcome.added, 'and the library holds exactly those')
  assert.equal(w.library.scanning, false)
})

// ---------------------------------------------------------------- files that move or go

test('a file that has gone makes its track missing, and nothing is deleted', async () => {
  const w = await world()
  const path = await w.write('gone.mp3', mp3({ title: 'Gone' }, 100))
  const added = await w.library.importFile(path)
  await fs.rm(path)

  const checked = await w.library.checkFiles()
  assert.equal(checked.missing.length, 1)
  const track = await w.store.track(added.track!.id)
  assert.equal(track?.availability, 'missing')
  assert.equal(playableOffline(track!), false)
  assert.equal(track?.title, 'Gone', 'everything about it is kept, so it can be found again')
})

test('a file that comes back is available again', async () => {
  const w = await world()
  const path = await w.write('drive.mp3', mp3({ title: 'On A Drive' }, 100))
  const added = await w.library.importFile(path)
  await fs.rm(path)
  await w.library.checkFiles()
  await w.write('drive.mp3', mp3({ title: 'On A Drive' }, 100))

  const checked = await w.library.checkFiles()
  assert.equal(checked.returned.length, 1)
  assert.equal((await w.store.track(added.track!.id))?.availability, 'local')
})

test('pointing a track at a new file checks the file first', async () => {
  const w = await world()
  const path = await w.write('moved.mp3', mp3({ title: 'Moved' }, 7000))
  const added = await w.library.importFile(path)
  await fs.rm(path)
  await w.library.checkFiles()

  const refused = await w.library.relink(added.track!.id, join(w.music, 'nothing.mp3'))
  assert.equal(refused.kind, 'failed')
  assert.equal((await w.store.track(added.track!.id))?.availability, 'missing', 'and the track is left as it was')

  const elsewhere = await w.write('elsewhere.mp3', mp3({ title: 'Moved' }, 3000))
  const linked = await w.library.relink(added.track!.id, elsewhere)
  assert.equal(linked.kind, 'added')
  const track = await w.store.track(added.track!.id)
  assert.equal(track?.availability, 'local')
  assert.ok(Math.abs((track?.duration ?? 0) - seconds(3000)) < 0.01, 'and its length is the new file\'s')
})

test('likely replacements are found by name, not by where the file used to be', async () => {
  const w = await world()
  const path = await w.write('starboy.mp3', mp3({ title: 'Starboy' }, 100))
  const added = await w.library.importFile(path)
  await fs.rm(path)
  await w.library.checkFiles()
  await fs.mkdir(join(w.music, 'Moved'), { recursive: true })
  await fs.writeFile(join(w.music, 'Moved', 'starboy.mp3'), mp3({ title: 'Starboy' }, 100))
  await w.store.saveSettings({ folders: [w.music] })

  const found = await w.library.findReplacements(added.track!.id)
  assert.equal(found.length, 1)
  assert.match(found[0], /Moved/)
})

// ---------------------------------------------------------------- what was heard while browsing

test('a song heard with no copy is kept by name and never claims to be playable', async () => {
  const w = await world()
  const outcome = await w.library.addHeard({ title: 'Starboy', artist: 'The Weeknd', album: '' }, 230, { provider: 'youtube', url: 'https://example.test/x' })
  assert.equal(outcome.kind, 'reference')
  const kept = (await w.store.all())[0]
  assert.equal(kept.availability, 'reference')
  assert.equal(kept.file, undefined)
  assert.equal(playableOffline(kept), false)
  assert.equal((await w.store.recognisedList()).length, 1, 'and it is noted as something Orbis noticed')
})

test('a song heard that the person already has is linked to their own file', async () => {
  const w = await world()
  const path = await w.write('have.mp3', mp3({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }, 7000))
  await w.library.importFile(path)

  const outcome = await w.library.addHeard({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours' }, Math.round(seconds(7000)), { provider: 'youtube' })
  assert.equal(outcome.kind, 'already')
  assert.equal((await w.store.all()).length, 1, 'no second row for a song they already have')
})

test('finding your own copy later turns the kept name into that file, not a second row', async () => {
  const w = await world()
  await w.library.addHeard({ title: 'Starboy', artist: 'The Weeknd', album: '' }, 230, { provider: 'youtube' })
  const path = await w.write('starboy.mp3', mp3({ title: 'Starboy', artist: 'The Weeknd' }, 8800))

  const imported = await w.library.importFile(path)
  assert.equal(imported.kind, 'added')
  const all = await w.store.all()
  assert.equal(all.length, 1, 'one song, now with a file')
  assert.equal(all[0].availability, 'local')
  assert.equal(playableOffline(all[0]), true)
})

test('what a person typed is never overwritten by a file\'s tags', async () => {
  const w = await world()
  const heard = await w.library.addHeard({ title: 'Starboy', artist: 'The Weeknd', album: '' }, 230, { provider: 'youtube' })
  const reference = heard.kind === 'reference' ? heard.track : null
  await w.store.update(reference!.id, { title: 'Starboy (my favourite)' }, true)
  const path = await w.write('starboy.mp3', mp3({ title: 'Starboy', artist: 'The Weeknd' }, 8800))

  await w.library.importFile(path)
  const all = await w.store.all()
  assert.equal(all.length, 1)
  assert.equal(all[0].title, 'Starboy (my favourite)', 'their words stand')
  assert.equal(all[0].availability, 'local', 'and the file is still linked')
})

// ---------------------------------------------------------------- duplicates and deleting

test('tracks that look like the same recording are grouped, and nothing is removed', async () => {
  const w = await world()
  await w.library.importFile(await w.write('one.mp3', mp3({ title: 'Twice', artist: 'Someone' }, 1000)))
  await w.library.importFile(await w.write('two.mp3', mp3({ title: 'Twice', artist: 'Someone' }, 1000)))
  const groups = await w.library.duplicates()
  assert.equal(groups.length, 1)
  assert.equal(groups[0].length, 2)
  assert.equal((await w.store.all()).length, 2, 'both are still there; which to keep is theirs to decide')
})

test('removing a track from the library leaves the file exactly where it is', async () => {
  const w = await world()
  const path = await w.write('keep.mp3', mp3({ title: 'Keep The File' }, 100))
  const added = await w.library.importFile(path)
  await w.store.remove(added.track!.id)
  assert.equal((await w.store.all()).length, 0)
  assert.ok(await fs.stat(path), 'the file is untouched')
})

test('deleting the file is a different act, and says so when it cannot', async () => {
  const w = await world()
  const path = await w.write('bye.mp3', mp3({ title: 'Delete Me' }, 100))
  const added = await w.library.importFile(path)
  const outcome = await w.library.deleteFile(added.track!.id)
  assert.equal(outcome.ok, true)
  await assert.rejects(() => fs.stat(path), 'the file really is gone')
  assert.equal((await w.store.all()).length, 0)

  const missing = await w.library.deleteFile('nothing')
  assert.equal(missing.ok, false)
  assert.match(missing.why ?? '', /not in your music/)
})

// ---------------------------------------------------------------- the library around the tracks

test('playlists hold references, so deleting one keeps every song', async () => {
  const w = await world()
  const a = await w.library.importFile(await w.write('a.mp3', mp3({ title: 'A' }, 100)))
  const b = await w.library.importFile(await w.write('b.mp3', mp3({ title: 'B' }, 200)))
  const list = await w.store.createList('Evening')
  await w.store.addToList(list.id, [a.track!.id, b.track!.id])

  assert.deepEqual((await w.store.listTracks(list.id)).map((t) => t.title), ['A', 'B'])
  await w.store.reorderList(list.id, 1, 0)
  assert.deepEqual((await w.store.listTracks(list.id)).map((t) => t.title), ['B', 'A'])

  await w.store.removeList(list.id)
  assert.equal((await w.store.all()).length, 2, 'the songs are still there')
})

test('a playlist cannot hold a track that is not in the library', async () => {
  const w = await world()
  const list = await w.store.createList('Nothing')
  await w.store.addToList(list.id, ['made-up'])
  assert.deepEqual((await w.store.list(list.id))?.tracks, [])
})

test('a worked-out playlist asks the library every time it is opened', async () => {
  const w = await world()
  const a = await w.library.importFile(await w.write('a.mp3', mp3({ title: 'A' }, 100)))
  await w.library.importFile(await w.write('b.mp3', mp3({ title: 'B' }, 200)))
  const list = await w.store.createList('Favourites', [], { favourite: true })
  assert.deepEqual(await w.store.listTracks(list.id), [])

  await w.store.setFavourite(a.track!.id, true)
  assert.deepEqual((await w.store.listTracks(list.id)).map((t) => t.title), ['A'], 'no list was edited; the answer changed')
})

test('a play is recorded only when it is asked for, and counts once', async () => {
  const w = await world()
  const a = await w.library.importFile(await w.write('a.mp3', mp3({ title: 'A' }, 7000)))
  await w.store.recordPlay(a.track!.id, 120)
  const track = await w.store.track(a.track!.id)
  assert.equal(track?.playCount, 1)
  assert.ok(track?.lastPlayedAt)
  assert.deepEqual((await w.store.recentlyPlayed()).map((t) => t.title), ['A'])

  await w.store.clearHistory()
  assert.deepEqual(await w.store.recentlyPlayed(), [], 'and clearing listening history keeps the library')
  assert.equal((await w.store.all()).length, 1)
})

test('the library is per profile, and one is never shown in another', async () => {
  const w = await world()
  await w.library.importFile(await w.write('mine.mp3', mp3({ title: 'Mine' }, 100)))
  assert.equal((await w.store.all()).length, 1)

  await w.store.useProfile('work')
  assert.deepEqual(await w.store.all(), [], 'a different profile starts with no music')
  await w.library.importFile(await w.write('work.mp3', mp3({ title: 'Work' }, 100)))
  assert.deepEqual((await w.store.all()).map((t) => t.title), ['Work'])

  await w.store.useProfile('default')
  assert.deepEqual((await w.store.all()).map((t) => t.title), ['Mine'], 'and the first one is exactly as it was')
})

test('what the panel shows about the library is counted, not estimated', async () => {
  const w = await world()
  await w.library.importFile(await w.write('local.mp3', mp3({ title: 'Local' }, 100)))
  await w.library.addHeard({ title: 'Heard', artist: 'Somebody', album: '' }, 200, { provider: 'youtube' })
  const summary = await w.store.summary()
  assert.deepEqual({ tracks: summary.tracks, offline: summary.offline, reference: summary.reference }, { tracks: 2, offline: 1, reference: 1 })
})

test('a library row that says it is here but names no file is read back as not here', async () => {
  const w = await world()
  // What a damaged or hand-edited file could hold. A play button that cannot work is worse than an honest blank.
  const path = join(w.dir, 'music', 'tracks.json')
  await fs.mkdir(join(w.dir, 'music'), { recursive: true })
  await fs.writeFile(path, JSON.stringify([{ id: 'x', title: 'Claims To Be Here', availability: 'local', addedAt: Date.now() }]))
  const store = new MusicStore(w.dir)
  const read = (await store.all())[0]
  assert.equal(read.availability, 'reference')
  assert.equal(playableOffline(read), false)
})
