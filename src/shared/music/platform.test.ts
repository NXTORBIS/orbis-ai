import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { artistsOf, canonicalTrack, compare, duplicateOf, identityKey, mergeSources, plainArtist, plainTitle, versionLabel, versionOf } from './identity.ts'
import { explainEmpty, localProvider, providersFor, searchAcross, unconfiguredProvider, type LocalTrackRow } from './provider.ts'
import { EXPLORATIONS, applyFilters, arrange, filtersFrom, parseSearch, queryFor, takeMeBack, topOf, type SearchRow } from './search.ts'

/**
 * The music platform layer: identity, providers and search.
 *
 * Every test here is about something that fails quietly. A merge that should not have happened loses a recording;
 * a search that returns nothing when nobody looked reads as "you have no music"; a top result chosen by position
 * makes the whole search feel arbitrary.
 */

const row = (patch: Partial<LocalTrackRow> = {}): LocalTrackRow => ({
  id: 't1',
  title: 'Blinding Lights',
  artist: 'The Weeknd',
  album: 'After Hours',
  duration: 200,
  year: 2019,
  genre: 'Pop',
  language: 'English',
  path: 'C:/music/blinding.mp3',
  artwork: null,
  present: true,
  ...patch
})

// ---------------------------------------------------------------- versions

describe('which version a title is', () => {
  it('reads the common ones', () => {
    assert.equal(versionOf('Song').kind, 'original')
    assert.equal(versionOf('Song (Live at Wembley)').kind, 'live')
    assert.equal(versionOf('Song - Live').kind, 'live')
    assert.equal(versionOf('Song (Acoustic)').kind, 'acoustic')
    assert.equal(versionOf('Song (Radio Edit)').kind, 'radio-edit')
    assert.equal(versionOf('Song (Extended Mix)').kind, 'extended')
    assert.equal(versionOf('Song (Instrumental)').kind, 'instrumental')
    assert.equal(versionOf('Song - 2011 Remaster').kind, 'remaster')
    assert.equal(versionOf('Song (sped up)').kind, 'sped-up')
    assert.equal(versionOf('Song (slowed + reverb)').kind, 'slowed')
    assert.equal(versionOf('Song (Demo)').kind, 'demo')
  })

  it('names who remixed it, when the title says', () => {
    const one = versionOf('Song (Calvin Harris Remix)')
    assert.equal(one.kind, 'remix')
    assert.equal(one.by, 'Calvin Harris')
    assert.equal(versionLabel(one), 'Calvin Harris remix')
    assert.equal(versionOf('Song (Remix)').by, null)
  })

  it('picks the most distinguishing fact when a title stacks them', () => {
    // Live and remastered: what a listener cares about is that it is live.
    assert.equal(versionOf('Song (Live) [Remastered 2011]').kind, 'live')
  })

  it('writes the original as nothing at all', () => {
    assert.equal(versionLabel(versionOf('Song')), '')
  })
})

describe('tidying a title and an artist', () => {
  it('takes off everything that is not the name', () => {
    assert.equal(plainTitle('Blinding Lights (Remastered 2020)'), 'blinding lights')
    assert.equal(plainTitle('Song feat. Someone'), 'song')
    assert.equal(plainTitle('Song - Live at Wembley'), 'song')
    assert.equal(plainTitle('Song (prod. by Someone)'), 'song')
  })

  it('keeps collaborators apart, so a duet is not one artist', () => {
    assert.deepEqual(artistsOf('A & B'), ['a', 'b'])
    assert.deepEqual(artistsOf('A feat. B'), ['a', 'b'])
    assert.deepEqual(artistsOf('A, B and C'), ['a', 'b', 'c'])
    assert.equal(plainArtist('The Weeknd'), 'the weeknd')
  })
})

// ---------------------------------------------------------------- identity

describe('one song, however it was found', () => {
  it('uses an industry identifier as the whole answer when there is one', () => {
    const a = { isrc: 'USUG11904206', title: 'Blinding Lights', artist: 'The Weeknd' }
    const b = { isrc: 'US-UG1-19-04206', title: 'Totally Different Name', artist: 'Somebody Else' }
    assert.equal(identityKey(a), identityKey(b))
    assert.equal(compare(a, b).verdict, 'exact-duplicate')
  })

  it('gives the same key to the same recording written two ways', () => {
    assert.equal(identityKey({ title: 'Blinding Lights', artist: 'The Weeknd' }), identityKey({ title: 'blinding lights ', artist: 'The  Weeknd' }))
  })

  it('gives different keys to different recordings of the same song', () => {
    const studio = { title: 'Song', artist: 'A' }
    const live = { title: 'Song (Live)', artist: 'A' }
    const remix = { title: 'Song (Calvin Harris Remix)', artist: 'A' }
    const other = { title: 'Song (Someone Else Remix)', artist: 'A' }
    const keys = new Set([identityKey(studio), identityKey(live), identityKey(remix), identityKey(other)])
    assert.equal(keys.size, 4, 'four recordings, four keys')
  })
})

describe('what to say when something is added', () => {
  const held = { title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200 }

  it('says it is already there', () => {
    const out = compare({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 201 }, held)
    assert.equal(out.verdict, 'exact-duplicate')
    assert.match(out.why, /Already in Orbis Music/)
    assert.ok(out.matched.includes('duration'))
  })

  it('says it is there under different details, when it is less sure', () => {
    const out = compare({ title: 'Blinding Lights', artist: 'The Weeknd' }, held)
    assert.equal(out.verdict, 'same-track-different-metadata')
    assert.ok(out.confidence < 0.9, 'and says so rather than claiming certainty')
  })

  it('never calls a remix a duplicate', () => {
    const out = compare({ title: 'Blinding Lights (Chromatics Remix)', artist: 'The Weeknd' }, held)
    assert.equal(out.verdict, 'remix')
    assert.match(out.why, /different version/i)
  })

  it('tells a live and an acoustic version apart from the studio one', () => {
    assert.equal(compare({ title: 'Blinding Lights (Live)', artist: 'The Weeknd' }, held).verdict, 'live-version')
    assert.equal(compare({ title: 'Blinding Lights (Acoustic)', artist: 'The Weeknd' }, held).verdict, 'acoustic-version')
    assert.equal(compare({ title: 'Blinding Lights - 2021 Remaster', artist: 'The Weeknd' }, held).verdict, 'remaster')
  })

  it('refuses to merge two recordings minutes apart, whatever the titles say', () => {
    const out = compare({ title: 'Blinding Lights', artist: 'The Weeknd', duration: 420 }, held)
    assert.equal(out.verdict, 'different-version')
  })

  it('says a different song is a different song', () => {
    assert.equal(compare({ title: 'Save Your Tears', artist: 'The Weeknd' }, held).verdict, 'new-track')
    assert.equal(compare({ title: 'Blinding Lights', artist: 'Somebody Else' }, held).verdict, 'new-track')
  })

  it('finds the thing already held, and nothing when there is none', () => {
    const library = [{ ...held, id: 'x1' }]
    assert.equal(duplicateOf({ title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 }, library)?.track.id, 'x1')
    assert.equal(duplicateOf({ title: 'Something Else', artist: 'Nobody' }, library), null)
  })
})

describe('the canonical shape', () => {
  it('keeps the version in the identity and out of the name', () => {
    const one = canonicalTrack({ title: 'Blinding Lights (Live)', artist: 'The Weeknd' })
    assert.equal(one.name, 'Blinding Lights')
    assert.equal(one.version.kind, 'live')
    assert.ok(one.key.includes('live'))
  })

  it('keeps both providers when the same recording is found twice', () => {
    const a = canonicalTrack({ title: 'Song', artist: 'A', provider: 'local', providerId: '1', album: null })
    const b = canonicalTrack({ title: 'Song', artist: 'A', provider: 'other', providerId: '2', album: 'An Album', year: 2019 })
    const merged = mergeSources(a, b)
    assert.equal(merged.sources.length, 2)
    assert.equal(merged.album, 'An Album', 'nothing is lost because one source left a field blank')
    assert.equal(merged.year, 2019)
  })
})

// ---------------------------------------------------------------- providers

describe('the music on this computer', () => {
  const library = { all: () => [row(), row({ id: 't2', title: 'Save Your Tears', duration: 215 }), row({ id: 't3', title: 'Gone', artist: 'Somebody', present: false })] }

  it('is always ready, because it needs nothing', async () => {
    const provider = localProvider(library)
    assert.equal(await provider.ready(), true)
    assert.equal(provider.why(), '')
  })

  it('finds by title, artist and album', async () => {
    const provider = localProvider(library)
    const byTitle = await provider.searchTracks({ text: 'blinding' })
    assert.ok(byTitle.ok && byTitle.items.length === 1)
    const byArtist = await provider.searchTracks({ text: 'weeknd' })
    assert.ok(byArtist.ok && byArtist.items.length === 2)
  })

  it('lists a track whose file has gone, and marks it unplayable', async () => {
    const provider = localProvider(library)
    const found = await provider.searchTracks({ text: 'gone' })
    assert.ok(found.ok)
    assert.equal(found.items[0].playable, false, 'listed rather than quietly dropped')
    assert.equal(found.items[0].source, null)
    const available = await provider.getAvailability?.('t3')
    assert.equal(available?.playable, false)
    assert.match(available?.why ?? '', /moved or been deleted/)
  })

  it('narrows by year and language itself', async () => {
    const provider = localProvider(library)
    const old = await provider.searchTracks({ text: '', year: { from: 1990, to: 2000 } })
    assert.ok(old.ok && old.items.length === 0)
    const right = await provider.searchTracks({ text: '', language: 'English' })
    assert.ok(right.ok && right.items.length === 3)
  })

  it('groups artists and albums', async () => {
    const provider = localProvider(library)
    const artists = await provider.searchArtists?.({ text: '' })
    assert.ok(artists?.ok && artists.items.length === 2)
    const albums = await provider.searchAlbums?.({ text: '' })
    // Grouped by album *and* artist, so two artists on one album title are two albums.
    assert.ok(albums?.ok && albums.items[0].trackCount === 2)
  })
})

describe('a provider that is not set up', () => {
  it('never answers, and says why', async () => {
    const provider = unconfiguredProvider('catalogue', 'A catalogue', 'No catalogue is set up.')
    assert.equal(await provider.ready(), false)
    const answer = await provider.searchTracks({ text: 'anything' })
    assert.equal(answer.ok, false)
    assert.equal(answer.ok === false && answer.reason, 'No catalogue is set up.')
  })

  it('is what Orbis ships with, named honestly', () => {
    const providers = providersFor({ all: () => [] })
    assert.equal(providers.length, 2)
    assert.equal(providers[0].kind, 'local')
    assert.equal(providers[1].ready(), false)
    assert.match(providers[1].why(), /no music catalogue set up/i)
  })
})

describe('asking every provider', () => {
  const library = { all: () => [row(), row({ id: 't2', title: 'Save Your Tears' })] }

  it('keeps a record of what could not be asked', async () => {
    const result = await searchAcross(providersFor(library), { text: 'weeknd' })
    assert.equal(result.tracks.length, 2)
    assert.equal(result.nowhereToLook, false)
    const refused = result.asked.find((one) => !one.ok)
    assert.ok(refused?.reason, 'and why')
  })

  it('says there was nowhere to look, which is not the same as finding nothing', async () => {
    const result = await searchAcross([unconfiguredProvider('a', 'A', 'Not set up.')], { text: 'anything' })
    assert.equal(result.nowhereToLook, true)
    const empty = explainEmpty(result, 'anything')
    assert.match(empty.title, /nowhere to search/i)
    assert.equal(empty.retry, false)
  })

  it('tells a failure apart from an empty result', async () => {
    const broken = {
      id: 'broken',
      name: 'Broken',
      kind: 'catalogue' as const,
      ready: () => true,
      why: () => '',
      searchTracks: async () => {
        throw new Error('The service could not be reached.')
      }
    }
    const result = await searchAcross([broken], { text: 'x' })
    assert.equal(result.nowhereToLook, false)
    const empty = explainEmpty(result, 'x')
    assert.match(empty.title, /could not finish/i)
    assert.equal(empty.retry, true, 'and offers to try again')
  })

  it('does not let one broken provider take the search down', async () => {
    const broken = {
      id: 'broken',
      name: 'Broken',
      kind: 'catalogue' as const,
      ready: () => true,
      why: () => '',
      searchTracks: async () => {
        throw new Error('boom')
      }
    }
    const result = await searchAcross([broken, localProvider(library)], { text: 'weeknd' })
    assert.equal(result.tracks.length, 2)
  })

  it('merges the same recording from two providers into one row', async () => {
    const other = {
      id: 'other',
      name: 'Other',
      kind: 'catalogue' as const,
      ready: () => true,
      why: () => '',
      searchTracks: async () => ({ ok: true as const, items: [{ providerId: 'x', title: 'Blinding Lights', artist: 'The Weeknd', album: 'After Hours', duration: 200, playable: false }] })
    }
    const result = await searchAcross([localProvider({ all: () => [row()] }), other], { text: 'blinding' })
    assert.equal(result.tracks.length, 1, 'one recording, one row')
    assert.equal(result.tracks[0].playable, true, 'playable because one of them can play it')
  })

  it('puts what can be played first', async () => {
    const result = await searchAcross([localProvider({ all: () => [row({ id: 'a', present: false }), row({ id: 'b', title: 'Another', present: true })] })], { text: '' })
    assert.equal(result.tracks[0].playable, true)
  })
})

// ---------------------------------------------------------------- search

describe('reading what somebody typed', () => {
  it('leaves a name alone', () => {
    const out = parseSearch('Blinding Lights')
    assert.equal(out.text.toLowerCase(), 'blinding lights')
    assert.ok(out.described < 0.3, 'a name is not a description')
  })

  it('reads a description as constraints rather than as a name', () => {
    const out = parseSearch("calm songs I haven't heard")
    assert.ok(out.described > 0.5)
    assert.equal(out.filters.heard, 'unheard')
  })

  it('keeps the name out of a description that has one', () => {
    const out = parseSearch('songs like Blinding Lights')
    assert.match(out.text.toLowerCase(), /blinding lights/)
  })

  it('reads a decade and a year', () => {
    assert.deepEqual(filtersFrom('songs from the 2010s', {}).year, { from: 2010, to: 2019 })
    assert.deepEqual(filtersFrom('that 1999 song', {}).year, { from: 1999, to: 1999 })
  })

  it('reads a language, when the request named one', () => {
    const out = parseSearch('Tamil songs for running')
    assert.equal(out.filters.language?.toLowerCase(), 'tamil')
  })

  it('says which words it could not read', () => {
    const out = parseSearch('play something in the key of blurble')
    assert.ok(Array.isArray(out.notUnderstood))
  })

  it('hands the provider only the narrowings it can do itself', () => {
    const query = queryFor(parseSearch('Tamil songs from the 2010s'))
    assert.equal(query.year?.from, 2010)
    assert.equal(query.language?.toLowerCase(), 'tamil')
  })

  it('does nothing with an empty search', () => {
    const out = parseSearch('   ')
    assert.equal(out.text, '')
    assert.equal(out.described, 0)
  })
})

describe('arranging what came back', () => {
  const make = (patch: Partial<SearchRow> = {}): SearchRow => ({
    canonical: canonicalTrack({ title: 'Blinding Lights', artist: 'The Weeknd', duration: 200, year: 2019 }),
    from: 'local',
    playable: true,
    source: 'C:/music/x.mp3',
    artwork: null,
    inLibrary: false,
    libraryId: null,
    favourite: false,
    plays: 0,
    ...patch
  })

  it('offers a top result only when one row is clearly ahead', () => {
    const exact = make()
    const other = make({ canonical: canonicalTrack({ title: 'Blinding Lights (Remix)', artist: 'The Weeknd' }) })
    assert.equal(topOf([exact, other], 'Blinding Lights'), exact)
  })

  it('offers none when nothing stands out', () => {
    const a = make({ canonical: canonicalTrack({ title: 'One', artist: 'A' }) })
    const b = make({ canonical: canonicalTrack({ title: 'Two', artist: 'B' }) })
    assert.equal(topOf([a, b], 'something else entirely'), null, 'a top result is not just the first row')
  })

  it('prefers the original over a remix for a plain name', () => {
    const original = make()
    const remix = make({ canonical: canonicalTrack({ title: 'Blinding Lights (Remix)', artist: 'The Weeknd' }), plays: 1 })
    assert.equal(topOf([remix, original], 'Blinding Lights'), original)
  })

  it('pushes something that cannot be played down', () => {
    const broken = make({ playable: false })
    const fine = make({ canonical: canonicalTrack({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'x' }), playable: true, plays: 3 })
    assert.equal(topOf([broken, fine], 'Blinding Lights'), fine)
  })

  it('filters on things no provider could know', () => {
    const rows = [make({ plays: 0 }), make({ canonical: canonicalTrack({ title: 'Heard', artist: 'A' }), plays: 9 })]
    assert.equal(applyFilters(rows, { heard: 'unheard' }).length, 1)
    assert.equal(applyFilters(rows, { heard: 'heard' })[0].plays, 9)
    assert.equal(applyFilters([make({ playable: false })], { playable: true }).length, 0)
    assert.equal(applyFilters([make({ favourite: true }), make()], { favourite: true }).length, 1)
  })

  it('gives a reason rather than a blank when there is nothing', () => {
    const result = { tracks: [], artists: [], albums: [], asked: [{ id: 'a', name: 'A', ok: false, ready: false, reason: 'Not set up.' }], nowhereToLook: true }
    const out = arrange(result, [], parseSearch('anything'), explainEmpty)
    assert.ok(out.empty)
    assert.match(out.empty?.title ?? '', /nowhere/i)
  })

  it('does not repeat the top result in the list below it', () => {
    const exact = make()
    const other = make({ canonical: canonicalTrack({ title: 'Blinding Lights (Remix)', artist: 'The Weeknd' }) })
    const out = arrange({ tracks: [], artists: [], albums: [], asked: [], nowhereToLook: false }, [exact, other], parseSearch('Blinding Lights'), explainEmpty)
    assert.equal(out.top, exact)
    assert.ok(!out.tracks.includes(exact))
  })
})

describe('the two things the real library caught', () => {
  it('matches an untagged file against itself, instead of making a second copy', () => {
    // A file with no artist tag. Both sides name nobody, so there is nothing to disagree about.
    const held = { title: 'Orbis Panel Check', artist: '', duration: 120 }
    const out = compare({ title: 'Orbis Panel Check', artist: '', duration: 120 }, held)
    assert.notEqual(out.verdict, 'new-track', 'the same untagged file is not a new track')
    assert.equal(duplicateOf({ title: 'Orbis Panel Check', artist: '', duration: 120 }, [{ ...held, id: 'x' }])?.track.id, 'x')
  })

  it('still tells two untagged files apart when they are different lengths', () => {
    const a = { title: 'Track', artist: '', duration: 120 }
    const b = { title: 'Track', artist: '', duration: 400 }
    assert.notEqual(identityKey(a), identityKey(b))
    assert.equal(compare(a, b).verdict, 'different-version')
  })

  it('does not call a missing catalogue a failed search', () => {
    const result = {
      tracks: [],
      artists: [],
      albums: [],
      // One provider answered fine; the other was never set up. Nothing broke.
      asked: [
        { id: 'local', name: 'Local', ok: true, ready: true },
        { id: 'catalogue', name: 'Catalogue', ok: false, ready: false, reason: 'No catalogue is set up.' }
      ],
      nowhereToLook: false
    }
    const out = explainEmpty(result, 'something')
    assert.match(out.title, /Nothing matched/)
    assert.equal(out.retry, false, 'there is nothing to try again')
    assert.match(out.detail, /No catalogue is set up/, 'and the reason is still said')
  })

  it('does say so when a provider that was ready then failed', () => {
    const result = {
      tracks: [],
      artists: [],
      albums: [],
      asked: [{ id: 'x', name: 'X', ok: false, ready: true, reason: 'The service timed out.' }],
      nowhereToLook: false
    }
    const out = explainEmpty(result, 'something')
    assert.match(out.title, /could not finish/i)
    assert.equal(out.retry, true)
  })
})

describe('the named ways of exploring', () => {
  it('each is a real set of constraints rather than a label', () => {
    for (const one of EXPLORATIONS) {
      assert.ok(Object.keys(one.constraints).length > 0, `${one.id} has no constraints`)
      assert.ok(one.blurb.length > 0)
    }
  })

  it('surprise means novelty with the taste still enforced, not random', () => {
    const surprise = EXPLORATIONS.find((one) => one.id === 'surprise')
    assert.equal(surprise?.constraints.heard, 'only-new')
    assert.ok((surprise?.constraints.discovery ?? 0) > 0.5)
    assert.ok((surprise?.constraints.discovery ?? 1) < 1, 'never pure randomness')
  })

  it('takes a year or a decade out of "take me back", and guesses nothing else', () => {
    assert.deepEqual(takeMeBack('take me back to 2018'), { from: 2018, to: 2018 })
    assert.deepEqual(takeMeBack('take me back to the 90s'), null, 'two digits is ambiguous, so it is refused')
    assert.deepEqual(takeMeBack('take me back to the 1990s'), { from: 1990, to: 1999 })
    assert.equal(takeMeBack('take me back to last summer'), null, 'Orbis does not know what last summer sounded like')
  })
})
