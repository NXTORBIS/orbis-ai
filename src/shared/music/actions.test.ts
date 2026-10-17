import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SEEK_JUMP,
  SEEK_STEP,
  SHORTCUTS,
  canDropOnPlaylist,
  canDropOnQueue,
  dropIndex,
  groupMenu,
  moveTarget,
  playlistMenu,
  shortcutFor,
  shortcutSheet,
  trackMenu,
  type ActionId
} from './actions.ts'
import type { OrbisTrack } from '../music.ts'

const song = (extra: Partial<OrbisTrack> = {}): OrbisTrack => ({
  id: 'one',
  title: 'A song',
  artist: 'Somebody',
  album: 'A record',
  duration: 180,
  availability: 'local',
  provenance: 'user-file',
  confidence: 'high',
  method: 'file-tags',
  addedAt: 1,
  file: 'C:/music/one.mp3',
  ...extra
})

const ids = (items: readonly { readonly id: ActionId }[]): ActionId[] => items.map((one) => one.id)

describe('the menu on a song', () => {
  it('offers playing, queueing, favouriting and both places to go', () => {
    assert.deepEqual(ids(trackMenu(song())), ['play', 'play-next', 'queue-end', 'add-to-playlist', 'favourite', 'go-album', 'go-artist'])
  })

  it('switches off only the three that need sound, and says why in the service’s own words', () => {
    const items = trackMenu(song({ availability: 'reference', file: undefined }))
    const off = items.filter((one) => one.off === true)
    assert.deepEqual(
      off.map((one) => one.id),
      ['play', 'play-next', 'queue-end']
    )
    for (const one of off) assert.match(one.why ?? '', /no audio for it/)
    // Everything that does not need sound still works on a song Orbis only knows the name of.
    assert.equal(
      items.some((one) => one.id === 'favourite' && one.off !== true),
      true
    )
  })

  it('offers taking it out of favourites once it is one', () => {
    assert.equal(ids(trackMenu(song({ favourite: true }))).includes('unfavourite'), true)
    assert.equal(ids(trackMenu(song({ favourite: true }))).includes('favourite'), false)
  })

  it('offers taking it out of the queue only when it is in the queue', () => {
    assert.equal(ids(trackMenu(song())).includes('queue-remove'), false)
    assert.equal(ids(trackMenu(song(), { queueAt: 4 })).includes('queue-remove'), true)
  })

  it('offers taking it out of a playlist, and refuses for one worked out from the library', () => {
    const byHand = trackMenu(song(), { playlistId: 'list' }).find((one) => one.id === 'playlist-remove')
    assert.equal(byHand?.off, undefined)
    const workedOut = trackMenu(song(), { playlistId: 'list', playlistWorkedOut: true }).find((one) => one.id === 'playlist-remove')
    assert.equal(workedOut?.off, true)
    assert.match(workedOut?.why ?? '', /worked out from your music/)
  })

  it('does not offer a screen about nothing when the file names no album or artist', () => {
    const items = ids(trackMenu(song({ album: '', artist: '' })))
    assert.equal(items.includes('go-album'), false)
    assert.equal(items.includes('go-artist'), false)
  })
})

describe('the menu on an album, an artist and a playlist', () => {
  it('cannot play a group with no audio anywhere in it', () => {
    const items = groupMenu('album', { playable: 0 })
    assert.equal(items[0]?.id, 'play-album')
    assert.equal(items[0]?.off, true)
    assert.equal(groupMenu('artist', { playable: 3 })[0]?.off, undefined)
    assert.equal(groupMenu('artist', { playable: 3 })[0]?.id, 'play-artist')
  })

  it('cannot play an empty playlist, but can still rename and remove one', () => {
    const items = playlistMenu({ id: 'l', count: 0 })
    assert.equal(items.find((one) => one.id === 'play-playlist')?.off, true)
    assert.equal(items.find((one) => one.id === 'rename-playlist')?.off, undefined)
  })

  it('lets a playlist worked out from the library be played, because its rule is answered afresh', () => {
    const items = playlistMenu({ id: 'l', rule: { favourite: true }, count: 0 })
    assert.equal(items.find((one) => one.id === 'play-playlist')?.off, undefined)
  })
})

describe('shortcuts', () => {
  it('reads a plain press', () => {
    assert.equal(shortcutFor({ key: ' ' })?.id, 'play-pause')
    assert.equal(shortcutFor({ key: 'ArrowRight' })?.id, 'on-a-bit')
    assert.equal(shortcutFor({ key: '/' })?.id, 'search')
  })

  it('tells a shifted press from an unshifted one', () => {
    assert.equal(shortcutFor({ key: 'ArrowRight', shiftKey: true })?.id, 'on-a-lot')
    assert.equal(shortcutFor({ key: '?' })?.id, 'sheet')
    assert.equal(shortcutFor({ key: '/', shiftKey: true })?.id, 'sheet')
  })

  it('still works with caps lock on, but leaves a shifted letter alone', () => {
    // Caps lock sends the capital with no shift held, and somebody with caps lock on still means mute.
    assert.equal(shortcutFor({ key: 'M' })?.id, 'mute')
    assert.equal(shortcutFor({ key: 'm' })?.id, 'mute')
    assert.equal(shortcutFor({ key: 'M', shiftKey: true }), null)
  })

  it('leaves anything held with Ctrl, Alt or the Windows key to the browser', () => {
    assert.equal(shortcutFor({ key: ' ', ctrlKey: true }), null)
    assert.equal(shortcutFor({ key: 'ArrowLeft', altKey: true }), null)
    assert.equal(shortcutFor({ key: 'f', metaKey: true }), null)
  })

  it('answers the media keys a keyboard with them sends', () => {
    assert.equal(shortcutFor({ key: 'MediaTrackNext' })?.id, 'next')
    assert.equal(shortcutFor({ key: 'MediaTrackPrevious' })?.id, 'previous')
  })

  it('says nothing about a key that is not one of ours', () => {
    assert.equal(shortcutFor({ key: 'Tab' }), null)
    assert.equal(shortcutFor({ key: 'z' }), null)
  })

  it('puts every shortcut on the sheet, so one cannot exist without being written down', () => {
    const onSheet = shortcutSheet().flatMap((group) => group.rows.map((row) => row.does))
    for (const shortcut of SHORTCUTS) assert.equal(onSheet.includes(shortcut.does), true, `${shortcut.id} is not on the sheet`)
    assert.equal(onSheet.length, SHORTCUTS.length)
  })

  it('says the real numbers on the sheet rather than words of its own', () => {
    const rows = shortcutSheet().flatMap((group) => group.rows)
    assert.equal(
      rows.some((row) => row.does === `On ${SEEK_STEP} seconds`),
      true
    )
    assert.equal(
      rows.some((row) => row.does === `Back ${SEEK_JUMP} seconds`),
      true
    )
  })

  it('has no two shortcuts answering the same press', () => {
    const seen = new Set<string>()
    for (const shortcut of SHORTCUTS) {
      for (const press of shortcut.match) {
        const key = `${press.key.toLowerCase()}|${press.shiftKey === true}`
        assert.equal(seen.has(key), false, `two shortcuts answer ${key}`)
        seen.add(key)
      }
    }
  })
})

describe('dropping', () => {
  it('refuses a playlist that is worked out from the library', () => {
    assert.deepEqual(canDropOnPlaylist({ trackIds: ['a'] }, {}), { ok: true })
    const refused = canDropOnPlaylist({ trackIds: ['a'] }, { rule: { favourite: true } })
    assert.equal(refused.ok, false)
    assert.match(refused.ok === false ? refused.why : '', /worked out from your music/)
  })

  it('refuses a drop with nothing in it', () => {
    assert.equal(canDropOnPlaylist({ trackIds: [] }, {}).ok, false)
    assert.equal(canDropOnQueue([]).ok, false)
  })

  it('will not line up a song with no audio, and uses that song’s own reason when it is the only one', () => {
    const refused = canDropOnQueue([song({ availability: 'missing', file: undefined })])
    assert.equal(refused.ok, false)
    assert.match(refused.ok === false ? refused.why : '', /not where it was/)
    assert.equal(canDropOnQueue([song({ availability: 'reference', file: undefined }), song()]).ok, true)
  })

  it('lands above a row from its top half and below it from its bottom', () => {
    assert.equal(dropIndex(3, true), 3)
    assert.equal(dropIndex(3, false), 4)
    assert.equal(dropIndex(0, true), 0)
  })

  it('takes the row out before it puts it back, so a move downwards lands where it was dropped', () => {
    assert.equal(moveTarget(2, 5), 4)
    assert.equal(moveTarget(5, 2), 2)
    assert.equal(moveTarget(2, 2), null)
    // Dropping a row just below itself is the same spot, and must do nothing rather than report a move.
    assert.equal(moveTarget(2, 3), null)
    assert.equal(moveTarget(-1, 3), null)
    assert.equal(moveTarget(1.5, 3), null)
  })
})
