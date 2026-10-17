import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  LIBRARY_KEEPS,
  LIBRARY_SORTS,
  LIBRARY_VIEWS,
  ROW_BLOCK,
  availabilityPill,
  countForKeep,
  dateAddedText,
  findGroups,
  fromStored,
  groupPlays,
  groupSeconds,
  groupSub,
  groupTrackIds,
  isGroupView,
  keepGroups,
  keepTracks,
  keepsTrack,
  libraryCounts,
  libraryKeep,
  librarySort,
  libraryView,
  nearEnd,
  playableIds,
  playsText,
  shownRows,
  sortGroups,
  sortStartsDown,
  storedFor
} from './libraryShelf.ts'
import type { Grouped, OrbisTrack } from '../music.ts'

/** A song with only the fields these checks read. Everything else on a real track is irrelevant here. */
function song(of: Partial<OrbisTrack> & { id: string }): OrbisTrack {
  const availability = of.availability ?? 'local'
  return {
    title: 'A song',
    artist: 'Somebody',
    album: 'A record',
    duration: 180,
    provenance: 'user-file',
    confidence: 'high',
    method: 'file-tags',
    addedAt: 1_700_000_000_000,
    availability,
    // A local row with no file is the state the store rewrites on the way in, so the tests have to be able to build
    // one on purpose: it is exactly the row a chip must not count as being here.
    file: 'file' in of ? of.file : availability === 'local' ? 'C:/some/file.mp3' : undefined,
    ...of
  } as OrbisTrack
}

const group = (name: string, tracks: readonly OrbisTrack[], extra: Partial<Grouped> = {}): Grouped => ({
  name,
  tracks: [...tracks],
  ...extra
})

describe('which list is showing', () => {
  it('reads the five names and nothing else', () => {
    assert.equal(libraryView('albums'), 'albums')
    assert.equal(libraryView('playlists'), 'playlists')
    assert.equal(libraryView('favourites'), 'songs', 'Favourites is a chip, not a list')
    assert.equal(libraryView(''), 'songs')
    assert.equal(libraryView(undefined), 'songs')
    assert.equal(libraryView(7), 'songs')
  })

  it('offers every list exactly once', () => {
    assert.equal(LIBRARY_VIEWS.length, 5)
    assert.equal(new Set(LIBRARY_VIEWS.map((one) => one.view)).size, 5)
    for (const one of LIBRARY_VIEWS) assert.ok(one.label.length > 0)
  })

  it('knows the songs table is the only one that is not groups', () => {
    assert.equal(isGroupView('songs'), false)
    assert.equal(isGroupView('albums'), true)
    assert.equal(isGroupView('playlists'), true)
  })
})

describe('the filter chips', () => {
  const here = song({ id: 'a' })
  const reference = song({ id: 'b', availability: 'reference', file: undefined })
  const missing = song({ id: 'c', availability: 'missing', file: 'C:/gone.mp3' })
  const liar = song({ id: 'd', availability: 'local', file: undefined })
  const loved = song({ id: 'e', favourite: true })
  const all = [here, reference, missing, liar, loved]

  it('reads a chip name and falls back to everything', () => {
    assert.equal(libraryKeep('reference'), 'reference')
    assert.equal(libraryKeep('nonsense'), 'all')
    assert.equal(LIBRARY_KEEPS.length, 5)
  })

  it('does not count a row that claims to be here with no file', () => {
    assert.equal(keepsTrack(liar, 'here'), false)
    assert.equal(keepsTrack(here, 'here'), true)
  })

  it('keeps a reference song as a song, and only on its own chip', () => {
    assert.deepEqual(
      keepTracks(all, 'reference').map((one) => one.id),
      ['b']
    )
    assert.equal(keepTracks(all, 'all').length, 5, 'everything means everything, reference songs included')
  })

  it('counts each state, and the counts match what the chip keeps', () => {
    const counts = libraryCounts(all)
    assert.deepEqual(counts, { all: 5, here: 2, reference: 1, missing: 1, favourites: 1 })
    for (const entry of LIBRARY_KEEPS) {
      assert.equal(countForKeep(counts, entry.keep), keepTracks(all, entry.keep).length, `the ${entry.keep} chip`)
    }
  })

  it('drops a group with nothing left in it rather than showing an empty one', () => {
    const groups = [group('With audio', [here]), group('Only names', [reference])]
    assert.deepEqual(
      keepGroups(groups, 'here').map((one) => one.name),
      ['With audio']
    )
    assert.equal(keepGroups(groups, 'all').length, 2)
  })

  it('leaves the original groups alone when it narrows one', () => {
    const mixed = group('Both', [here, reference])
    const left = keepGroups([mixed], 'here')
    assert.equal(left[0]?.tracks.length, 1)
    assert.equal(mixed.tracks.length, 2, 'the group it was given must not be edited')
  })
})

describe('putting a list in order', () => {
  it('offers six orders, each on a field the library really has', () => {
    assert.deepEqual(
      LIBRARY_SORTS.map((one) => one.sort),
      ['added', 'title', 'artist', 'album', 'duration', 'plays']
    )
    assert.equal(librarySort('plays'), 'plays')
    assert.equal(librarySort('popularity'), 'added', 'there is no popularity figure anywhere in Orbis Music')
  })

  it('starts the orders the way a person would expect', () => {
    assert.equal(sortStartsDown('added'), true)
    assert.equal(sortStartsDown('plays'), true)
    assert.equal(sortStartsDown('title'), false)
  })

  it('adds up only the lengths that are known, and says how many were not', () => {
    const measured = groupSeconds(group('x', [song({ id: 'a', duration: 100 }), song({ id: 'b', duration: 0 }), song({ id: 'c', duration: 50 })]))
    assert.deepEqual(measured, { seconds: 150, unknown: 1 })
  })

  it('adds up play counts, treating never played as none', () => {
    assert.equal(groupPlays(group('x', [song({ id: 'a', playCount: 3 }), song({ id: 'b' })])), 3)
  })

  it('orders groups by name, artist, length, plays and what was added last', () => {
    const beta = group('Beta', [song({ id: 'a', duration: 10, playCount: 1, addedAt: 2000 })], { by: 'Zed' })
    const alpha = group('Alpha', [song({ id: 'b', duration: 100, playCount: 9, addedAt: 1000 })], { by: 'Ann' })
    const names = (sort: Parameters<typeof sortGroups>[1], down: boolean): string[] => sortGroups([beta, alpha], sort, down).map((one) => one.name)
    assert.deepEqual(names('title', false), ['Alpha', 'Beta'])
    assert.deepEqual(names('title', true), ['Beta', 'Alpha'])
    assert.deepEqual(names('artist', false), ['Alpha', 'Beta'])
    assert.deepEqual(names('duration', true), ['Alpha', 'Beta'])
    assert.deepEqual(names('plays', true), ['Alpha', 'Beta'])
    assert.deepEqual(names('added', true), ['Beta', 'Alpha'])
  })

  it('leaves the list it was given alone', () => {
    const groups = [group('B', []), group('A', [])]
    sortGroups(groups, 'title', false)
    assert.deepEqual(
      groups.map((one) => one.name),
      ['B', 'A']
    )
  })

  it('matches every typed word against a group name or its artist', () => {
    const groups = [group('Blue Lines', [], { by: 'Massive Attack' }), group('Red Lines', [], { by: 'Someone Else' })]
    assert.deepEqual(
      findGroups(groups, 'blue').map((one) => one.name),
      ['Blue Lines']
    )
    assert.deepEqual(
      findGroups(groups, 'lines massive').map((one) => one.name),
      ['Blue Lines'],
      'two words narrow rather than widen'
    )
    assert.equal(findGroups(groups, '   ').length, 2)
  })
})

describe('words a person reads', () => {
  it('gives a dash rather than a date nobody added anything on', () => {
    assert.equal(dateAddedText(0), '—')
    assert.equal(dateAddedText(undefined), '—')
    assert.equal(dateAddedText(Number.NaN), '—')
    assert.equal(dateAddedText(-5), '—')
  })

  it('names the month in words', () => {
    const when = new Date(2024, 2, 4, 12).getTime()
    assert.equal(dateAddedText(when), '4 Mar 2024')
  })

  it('says nothing at all for a song that has never been played', () => {
    assert.equal(playsText(0), '')
    assert.equal(playsText(undefined), '')
    assert.equal(playsText(1), '1 play')
    assert.equal(playsText(12), '12 plays')
  })

  it('names which of the three reasons a song cannot be played', () => {
    assert.equal(availabilityPill(song({ id: 'a' })), null)
    assert.equal(availabilityPill(song({ id: 'b', availability: 'reference', file: undefined })), 'No audio here')
    assert.equal(availabilityPill(song({ id: 'c', availability: 'missing', file: 'C:/gone.mp3' })), 'File missing')
    assert.equal(availabilityPill(song({ id: 'd', availability: 'unsupported', file: 'C:/odd.xyz' })), 'Cannot be played')
    assert.equal(availabilityPill(song({ id: 'e', availability: 'local', file: undefined })), 'No audio here', 'a row with no file is not playable')
  })

  it('writes a second line only out of what the group holds', () => {
    const one = song({ id: 'a', album: 'A record' })
    const two = song({ id: 'b', album: 'Another' })
    assert.equal(groupSub(group('A record', [one], { by: 'Someone', year: 1999 }), 'albums'), 'Someone · 1999 · 1 song')
    assert.equal(groupSub(group('A record', [one], { by: 'Someone' }), 'albums'), 'Someone · 1 song', 'no year means no year')
    assert.equal(groupSub(group('Someone', [one, two]), 'artists'), '2 songs · 2 albums')
    assert.equal(groupSub(group('Jazz', [one, two]), 'genres'), '2 songs')
  })

  it('hands back the ids in the order they are listed, and only the playable ones when asked', () => {
    const tracks = [song({ id: 'a' }), song({ id: 'b', availability: 'reference', file: undefined }), song({ id: 'c' })]
    assert.deepEqual(groupTrackIds(group('x', tracks)), ['a', 'b', 'c'])
    assert.deepEqual(playableIds(tracks), ['a', 'c'])
  })
})

describe('how much of a long list is drawn', () => {
  it('grows a block at a time and never past the end', () => {
    assert.equal(shownRows(50_000, 1), ROW_BLOCK)
    assert.equal(shownRows(50_000, 3), ROW_BLOCK * 3)
    assert.equal(shownRows(10, 3), 10)
    assert.equal(shownRows(0, 5), 0)
  })

  it('never draws less than one block, however odd the number of blocks is', () => {
    assert.equal(shownRows(500, 0), ROW_BLOCK)
    assert.equal(shownRows(500, -4), ROW_BLOCK)
  })

  it('asks for more only near the bottom', () => {
    assert.equal(nearEnd(0, 800, 5000), false)
    assert.equal(nearEnd(3900, 800, 5000), true)
    assert.equal(nearEnd(0, 800, 900), true, 'a list shorter than the screen is already at its end')
  })
})

describe('the stored preference', () => {
  it('folds the songs table plus the Favourites chip into the one stored value', () => {
    assert.equal(storedFor('songs', 'favourites'), 'favourites')
    assert.equal(storedFor('songs', 'all'), 'songs')
    assert.equal(storedFor('albums', 'favourites'), 'albums', 'the stored value cannot hold both, so the list wins')
  })

  it('unfolds it again', () => {
    assert.deepEqual(fromStored('favourites'), { view: 'songs', keep: 'favourites' })
    assert.deepEqual(fromStored('genres'), { view: 'genres', keep: 'all' })
    assert.deepEqual(fromStored(null), { view: 'songs', keep: 'all' })
  })

  it('comes back to where it started', () => {
    for (const entry of LIBRARY_VIEWS) {
      const back = fromStored(storedFor(entry.view, 'all'))
      assert.equal(back.view, entry.view)
      assert.equal(back.keep, 'all')
    }
  })
})
