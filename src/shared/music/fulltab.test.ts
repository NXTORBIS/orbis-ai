import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTWORK_BATCH,
  MUSIC_HOME,
  MUSIC_NAV,
  SCREENS,
  artworkBatches,
  clockText,
  countText,
  emptyWords,
  fillFraction,
  hueFor,
  isMusicScreen,
  meansWindowShut,
  nextRepeat,
  okIndex,
  okName,
  okRepeat,
  okSeconds,
  okTrackId,
  okTrackIds,
  okVolume,
  parseRoute,
  playbackMark,
  positionText,
  progressAt,
  routeHash,
  sameMark,
  sameRoute,
  seekTarget,
  spanText,
  tileLetter
} from './fulltab.ts'
import { NOTHING_PLAYING } from '../music.ts'

describe('full-tab music addresses', () => {
  it('reads a plain screen', () => {
    assert.deepEqual(parseRoute('#/queue'), { screen: 'queue', of: '', said: '' })
  })

  it('reads what a screen is about, escapes and all', () => {
    assert.deepEqual(parseRoute('#/album/Rock%20%26%20Roll'), { screen: 'album', of: 'Rock & Roll', said: '' })
  })

  it('reads the words somebody searched for', () => {
    assert.equal(parseRoute('#/search?q=something%20calm').said, 'something calm')
    assert.equal(parseRoute('#/search?q=something+calm').said, 'something calm')
  })

  it('lands on Home for anything it cannot read', () => {
    for (const address of ['', '#', '#/', '#/nonsense', '#/album-ish/x', 'rubbish']) {
      assert.deepEqual(parseRoute(address), MUSIC_HOME, address)
    }
  })

  it('shows the screen anyway when only the escape is broken', () => {
    const route = parseRoute('#/artist/%E0%A4%A')
    assert.equal(route.screen, 'artist')
    assert.equal(route.of, '')
  })

  it('writes an address that reads back the same', () => {
    for (const route of [
      { screen: 'home' as const, of: '', said: '' },
      { screen: 'playlist' as const, of: 'pl_12', said: '' },
      { screen: 'album' as const, of: 'Rock & Roll/Live', said: '' },
      { screen: 'search' as const, of: '', said: 'something calm & slow' }
    ]) {
      assert.deepEqual(parseRoute(routeHash(route)), route)
    }
  })

  it('knows which names are screens', () => {
    assert.ok(isMusicScreen('home'))
    assert.ok(!isMusicScreen('lyrics'))
    assert.ok(!isMusicScreen(7))
  })

  it('tells one screen from another so a press that changed nothing redraws nothing', () => {
    assert.ok(sameRoute(parseRoute('#/queue'), parseRoute('#/queue')))
    assert.ok(!sameRoute(parseRoute('#/queue'), parseRoute('#/recent')))
    assert.ok(!sameRoute(parseRoute('#/search?q=a'), parseRoute('#/search?q=b')))
  })

  it('every left-hand entry points at a real screen', () => {
    for (const entry of MUSIC_NAV) assert.ok(isMusicScreen(entry.screen), entry.screen)
    assert.equal(new Set(MUSIC_NAV.map((one) => one.screen)).size, MUSIC_NAV.length)
  })
})

describe('full-tab music numbers', () => {
  it('shows a dash rather than inventing a length', () => {
    assert.equal(clockText(0), '—')
    assert.equal(clockText(Number.NaN), '—')
    assert.equal(clockText(-5), '—')
  })

  it('shows minutes and seconds, and hours when there are any', () => {
    assert.equal(clockText(9), '0:09')
    assert.equal(clockText(65), '1:05')
    assert.equal(clockText(3725), '1:02:05')
  })

  it('a position really is zero at the start', () => {
    assert.equal(positionText(0), '0:00')
    assert.equal(positionText(61), '1:01')
  })

  it('says nothing at all for a total of no known lengths', () => {
    assert.equal(spanText(0), '')
    assert.equal(spanText(30), '')
    assert.equal(spanText(600), '10 min')
    assert.equal(spanText(3600), '1 hr')
    assert.equal(spanText(3900), '1 hr 5 min')
  })

  it('counts in words a person would use', () => {
    assert.equal(countText(1, 'song', 'songs'), '1 song')
    assert.equal(countText(0, 'song', 'songs'), '0 songs')
    assert.equal(countText(24, 'song', 'songs'), '24 songs')
  })
})

describe('full-tab music stand-in covers', () => {
  it('gives one song the same colour every time', () => {
    assert.equal(hueFor('Album|Artist|Title'), hueFor('Album|Artist|Title'))
    assert.notEqual(hueFor('one'), hueFor('two'))
  })

  it('stays a hue', () => {
    for (const text of ['', 'a', 'a very long title indeed with lots of words in it']) {
      const hue = hueFor(text)
      assert.ok(hue >= 0 && hue < 360, text)
    }
  })

  it('takes the first real letter, or a note when there is none', () => {
    assert.equal(tileLetter('  something'), 'S')
    assert.equal(tileLetter('9 Crimes'), '9')
    assert.equal(tileLetter('!!!'), '♪')
    assert.equal(tileLetter(''), '♪')
  })
})

describe('full-tab music seek bar', () => {
  const playing = { playing: true, position: 30, duration: 200 }

  it('carries the position on with the clock while it is playing', () => {
    assert.equal(progressAt(playing, 1000, 1000), 30)
    assert.equal(progressAt(playing, 1000, 2000), 31)
  })

  it('stands still when the player says it is paused', () => {
    assert.equal(progressAt({ ...playing, playing: false }, 1000, 9000), 30)
  })

  it('stops guessing after a few seconds, so a sleeping tab does not draw the bar somewhere the music never reached', () => {
    assert.equal(progressAt(playing, 1000, 600000), 35)
  })

  it('never runs past the end of the track', () => {
    assert.equal(progressAt({ playing: true, position: 199, duration: 200 }, 1000, 6000), 200)
  })

  it('treats a track of unknown length as having no end rather than ending at zero', () => {
    assert.equal(progressAt({ playing: true, position: 10, duration: 0 }, 1000, 3000), 12)
  })

  it('refuses to seek in a track with no known length', () => {
    assert.equal(seekTarget(0.5, 0), null)
    assert.equal(seekTarget(0.5, 200), 100)
    assert.equal(seekTarget(-1, 200), 0)
    assert.equal(seekTarget(9, 200), 200)
  })

  it('leaves the bar empty when there is no length to fill against', () => {
    assert.equal(fillFraction(50, 0), 0)
    assert.equal(fillFraction(50, 200), 0.25)
    assert.equal(fillFraction(500, 200), 1)
  })
})

describe('full-tab music change watching', () => {
  const base = { ...NOTHING_PLAYING, problem: null }

  it('ignores the position, so the page does not redraw itself once a second forever', () => {
    const a = playbackMark({ ...base, position: 1 })
    const b = playbackMark({ ...base, position: 99 })
    assert.ok(sameMark(a, b))
  })

  it('notices a new track, a pause, a new queue and a refusal', () => {
    const a = playbackMark(base)
    assert.ok(!sameMark(a, playbackMark({ ...base, trackId: 'one' })))
    assert.ok(!sameMark(a, playbackMark({ ...base, playing: true })))
    assert.ok(!sameMark(a, playbackMark({ ...base, queue: ['one', 'two'] })))
    assert.ok(!sameMark(a, playbackMark({ ...base, problem: 'This computer cannot play that.' })))
    assert.ok(!sameMark(a, playbackMark({ ...base, repeat: 'one' })))
  })

  it('treats a missing answer as different from any answer', () => {
    assert.ok(sameMark(null, null))
    assert.ok(!sameMark(null, playbackMark(base)))
  })
})

describe('full-tab music cover batches', () => {
  const none = new Set<string>()

  it('asks for nothing when everything is held or already tried', () => {
    assert.deepEqual(artworkBatches(['a', 'b'], new Set(['a']), new Set(['b'])), [])
  })

  it('keeps the order it was given, so the top of the screen is fetched first', () => {
    assert.deepEqual(artworkBatches(['c', 'a', 'b'], none, none), [['c', 'a', 'b']])
  })

  it('drops repeats and anything that is not a usable id', () => {
    assert.deepEqual(artworkBatches(['a', 'a', '', 'b'], none, none), [['a', 'b']])
  })

  it('splits into batches the music service will accept', () => {
    const wanted = Array.from({ length: 140 }, (_, i) => `t${i}`)
    const out = artworkBatches(wanted, none, none, 3)
    assert.equal(out.length, 3)
    assert.equal(out[0].length, ARTWORK_BATCH)
    assert.equal(out[2].length, 20)
  })

  it('asks for one batch unless told otherwise', () => {
    const wanted = Array.from({ length: 140 }, (_, i) => `t${i}`)
    assert.deepEqual(artworkBatches(wanted, none, none).length, 1)
  })
})

describe('full-tab music input checking', () => {
  it('refuses a track id the music service would quietly accept', () => {
    assert.equal(okTrackId('t1'), 't1')
    assert.equal(okTrackId(''), null)
    assert.equal(okTrackId('x'.repeat(65)), null)
    assert.equal(okTrackId(7), null)
  })

  it('drops what cannot be used out of a list rather than refusing the lot', () => {
    assert.deepEqual(okTrackIds(['a', '', 1, 'b']), ['a', 'b'])
    assert.deepEqual(okTrackIds('a'), [])
    assert.equal(okTrackIds(Array.from({ length: 900 }, (_, i) => `t${i}`)).length, 500)
  })

  it('trims a name and refuses one with nothing left of it', () => {
    assert.equal(okName('  Evening  '), 'Evening')
    assert.equal(okName('   '), null)
    assert.equal(okName('x'.repeat(201)), null)
  })

  it('refuses numbers the service would silently fall back on', () => {
    assert.equal(okSeconds(12.5), 12.5)
    assert.equal(okSeconds(-1), null)
    assert.equal(okSeconds(90000), null)
    assert.equal(okSeconds(Number.NaN), null)
    assert.equal(okVolume(0.5), 0.5)
    assert.equal(okVolume(1.5), null)
    assert.equal(okIndex(0), 0)
    assert.equal(okIndex(1.5), null)
    assert.equal(okIndex(-1), null)
  })

  it('refuses a repeat mode rather than letting it quietly become off', () => {
    assert.equal(okRepeat('one'), 'one')
    assert.equal(okRepeat('ONE'), null)
    assert.equal(okRepeat(null), null)
  })

  it('cycles repeat the way the button reads', () => {
    assert.equal(nextRepeat('off'), 'all')
    assert.equal(nextRepeat('all'), 'one')
    assert.equal(nextRepeat('one'), 'off')
  })
})

describe('full-tab music empty screens', () => {
  it('never says you have no music when it simply could not look', () => {
    const shut = emptyWords('unreachable', 'music')
    assert.match(shut.title, /not open/)
    assert.ok(shut.retry)
    const failed = emptyWords('failed', 'playlists', 'Something broke.')
    assert.equal(failed.detail, 'Something broke.')
    assert.ok(failed.retry)
  })

  it('offers no retry for a library that really is empty', () => {
    const empty = emptyWords('empty', 'playlists')
    assert.equal(empty.title, 'No playlists yet')
    assert.ok(!empty.retry)
  })

  it('tells the Orbis window being shut apart from anything else going wrong', () => {
    assert.ok(meansWindowShut('Orbis Music is not available. Open the Orbis window and it connects by itself.'))
    assert.ok(meansWindowShut('Orbis is not running.'))
    assert.ok(!meansWindowShut('That playlist is not valid.'))
  })
})

/*
 * The one failure no amount of unit testing caught: nine screens were built in parallel, and two of them were
 * finished, correct, and reachable from nothing. One was never imported, so its `registerScreen` never ran and its
 * address landed on the "nobody has written this screen yet" sentence; four more names were being linked to from
 * other screens with no file behind them at all.
 *
 * So this walks the files rather than the behaviour. It is the only check here that reads the repository, because it
 * is asking a question about the repository: is every screen this page can be addressed at actually joined up.
 */
describe('every music screen is joined up', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = resolve(here, '../../..')
  const screensDir = resolve(root, 'extension-src/music/screens')
  const mainFile = resolve(root, 'extension-src/music/main.ts')

  /** Which screen name each file claims, read out of its own `registerScreen` call. */
  const claims = new Map<string, string>()
  for (const name of readdirSync(screensDir)) {
    if (!name.endsWith('.ts')) continue
    const found = readFileSync(resolve(screensDir, name), 'utf8').match(/^\s*screen: '([a-z-]+)',$/m)
    if (found) claims.set(found[1], name)
  }

  it('every screen the address bar accepts has a file that claims it', () => {
    const missing = SCREENS.filter((one) => !claims.has(one))
    assert.deepEqual(missing, [], `these screens can be addressed but nothing claims them: ${missing.join(', ')}`)
  })

  it('every screen file is imported, so its registration actually runs', () => {
    const main = readFileSync(mainFile, 'utf8')
    const unimported = [...claims.values()].filter((file) => !main.includes(`import './screens/${file}'`))
    assert.deepEqual(unimported, [], `these screens are built but never imported, so they are reachable from nothing: ${unimported.join(', ')}`)
  })

  it('every entry down the left goes to a screen that exists', () => {
    const broken = MUSIC_NAV.filter((one) => !claims.has(one.screen)).map((one) => one.label)
    assert.deepEqual(broken, [], `these entries are in the left-hand list with no screen behind them: ${broken.join(', ')}`)
  })

  it('no two screen files claim the same name, because the second would silently replace the first', () => {
    const counts = new Map<string, number>()
    for (const name of readdirSync(screensDir)) {
      if (!name.endsWith('.ts')) continue
      for (const found of readFileSync(resolve(screensDir, name), 'utf8').matchAll(/^\s*screen: '([a-z-]+)',$/gm)) {
        counts.set(found[1], (counts.get(found[1]) ?? 0) + 1)
      }
    }
    const twice = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)
    assert.deepEqual(twice, [], `claimed more than once: ${twice.join(', ')}`)
  })
})
