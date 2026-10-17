import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CARRIED_KEY, coalesced, firstRead, markCarried, reason, type Answer, type BrowserStore } from './keeping.ts'
import { mirrorFrom, mirrorToWrite, nothingKept } from './settings/mirror.ts'
import { DEFAULT_CHESS_SETTINGS, withField, type ChessSettings } from '../../../../shared/chess/settings.ts'

/**
 * Bringing an old record out of this window's storage and into the profile, and not sending one message per change.
 *
 * No jsdom and no React: `firstRead` takes the storage and the two channels as arguments precisely so that the
 * conditions below can be checked without a browser. What is on screen is checked elsewhere; this is the part where
 * getting it wrong loses somebody's record or hands it to the wrong person.
 */

interface Thing {
  rows: string[]
}

/** A stand-in for this window's storage, with the two failures the real one has. */
function fakeStorage(start: Record<string, string> = {}, o: { reachable?: boolean; readOnly?: boolean } = {}): BrowserStore & { held: Record<string, string> } {
  const held: Record<string, string> = { ...start }
  return {
    held,
    reachable: o.reachable ?? true,
    get: (key) => held[key] ?? null,
    set: (key, value) => {
      // Full, or blocked. The real one throws; the wrapper turns that into false, which is what is tested here.
      if (o.readOnly) return false
      held[key] = value
      return true
    },
    remove: (key) => {
      delete held[key]
    }
  }
}

/** A stand-in for the two channels, recording what was sent. */
function fakeChannel(start: Thing, o: { refused?: string | null; throws?: boolean } = {}): {
  read: () => Promise<Answer<Thing>>
  save: (value: Thing) => Promise<Answer<Thing>>
  sent: Thing[]
  held: () => Thing
} {
  let held = start
  const sent: Thing[] = []
  return {
    sent,
    held: () => held,
    read: async () => ({ value: held, notes: [], refused: o.refused ?? null }),
    save: async (value) => {
      if (o.throws) throw new Error("Error invoking remote method 'chess:save-training': Error: the pipe went away")
      sent.push(value)
      if (o.refused) return { value: held, notes: [], refused: o.refused }
      held = value
      return { value, notes: [], refused: null }
    }
  }
}

const KEY = 'orbis.chess.puzzles.v1'
const nothing = (): Thing => ({ rows: [] })
const empty = (one: Thing): boolean => one.rows.length === 0
const fromBrowser = (text: string): Thing | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as Thing).rows) ? (parsed as Thing) : null
  } catch {
    return null
  }
}

const carry = (o: {
  storage: BrowserStore
  channel: ReturnType<typeof fakeChannel>
  at?: number
}): Promise<{ value: Thing; notes: readonly string[]; refused: string | null; carried: string | null }> =>
  firstRead<Thing>({
    key: KEY,
    what: 'puzzles',
    read: o.channel.read,
    save: o.channel.save,
    isEmpty: empty,
    fromBrowser,
    storage: o.storage,
    now: () => o.at ?? 1000
  })

describe('bringing the old copy across', () => {
  it('brings it in when the profile has nothing, and leaves the old copy where it is', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['a year of puzzles'] }) })
    const channel = fakeChannel(nothing())

    const answer = await carry({ storage, channel })

    assert.deepEqual(answer.value.rows, ['a year of puzzles'])
    assert.match(String(answer.carried), /brought into this profile/)
    assert.deepEqual(channel.sent, [{ rows: ['a year of puzzles'] }])
    // Never removed: somebody who goes back to an older Orbis must not find their record gone.
    assert.equal(storage.held[KEY], JSON.stringify({ rows: ['a year of puzzles'] }))
  })

  it('records the move where every profile can see it, not in the profile', async () => {
    /*
     * The record of having moved the copy has to live beside the copy, because the copy belongs to this computer and
     * there is exactly one of it. A record kept in the profile would be absent for the second profile, which would
     * then help itself to the first person's puzzles.
     */
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) })
    await carry({ storage, channel: fakeChannel(nothing()), at: 1234 })

    assert.deepEqual(JSON.parse(storage.held[CARRIED_KEY]) as Record<string, number>, { [KEY]: 1234 })
  })

  it('does not hand the same copy to a second profile', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) })
    const mine = fakeChannel(nothing())
    await carry({ storage, channel: mine })
    assert.equal(mine.sent.length, 1)

    // A different profile, with nothing of its own, on the same computer and the same window storage.
    const theirs = fakeChannel(nothing())
    const second = await carry({ storage, channel: theirs })

    assert.deepEqual(second.value.rows, [], 'the second profile starts empty')
    assert.equal(second.carried, null)
    assert.deepEqual(theirs.sent, [], 'and nothing of the first person was written into it')
  })

  it('does not bring it in again after the profile has been emptied on purpose', async () => {
    // The same guard, from the other direction: a carry-over that could repeat would resurrect a collection somebody
    // deliberately deleted.
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) })
    await carry({ storage, channel: fakeChannel(nothing()) })

    const again = fakeChannel(nothing())
    await carry({ storage, channel: again })
    assert.deepEqual(again.sent, [])
  })

  it('brings nothing back into a record somebody emptied on purpose', async () => {
    /*
     * "Forget everything" makes the profile empty, which is the one case where empty is a decision rather than a
     * state. It settles the old copy's claim on the way, so this does not bring it all back on the next launch --
     * which is the opposite of what the button said.
     */
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['everything I asked to forget'] }) })
    markCarried(storage, KEY, 5)

    const channel = fakeChannel(nothing())
    const answer = await carry({ storage, channel })

    assert.deepEqual(answer.value.rows, [])
    assert.deepEqual(channel.sent, [])
    assert.equal(storage.held[KEY], JSON.stringify({ rows: ['everything I asked to forget'] }), 'and the old copy is still not deleted')
  })

  it('leaves a profile that already holds something alone', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['the old copy'] }) })
    const channel = fakeChannel({ rows: ['what the profile already has'] })

    const answer = await carry({ storage, channel })

    assert.deepEqual(answer.value.rows, ['what the profile already has'])
    assert.equal(answer.carried, null)
    assert.deepEqual(channel.sent, [])
    assert.equal(storage.held[CARRIED_KEY], undefined, 'and nothing is recorded, because nothing was moved')
  })

  it('writes nothing over a profile file that could not be read, however empty it looks', async () => {
    /*
     * The case that matters most. The file is there and Orbis could not make sense of it, so the store answered with
     * defaults and `refused` set. Writing an old copy on top of it is exactly the loss the store refused to allow.
     */
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['the old copy'] }) })
    const channel = fakeChannel(nothing(), { refused: 'Orbis could not read your puzzles. It has been left exactly as it is.' })

    const answer = await carry({ storage, channel })

    assert.match(String(answer.refused), /left exactly as it is/)
    assert.equal(answer.carried, null)
    assert.deepEqual(channel.sent, [])
  })

  it('leaves an old copy it cannot read exactly where it is, and says so', async () => {
    const storage = fakeStorage({ [KEY]: '{ this is not json' })
    const channel = fakeChannel(nothing())

    const answer = await carry({ storage, channel })

    assert.deepEqual(answer.value.rows, [])
    assert.equal(answer.carried, null)
    assert.ok(answer.notes.some((one) => /could not read it, so nothing was brought into this profile/.test(one)))
    assert.equal(storage.held[KEY], '{ this is not json', 'still there for somebody to recover')
    assert.equal(storage.held[CARRIED_KEY], undefined, 'and not recorded as moved, because it was not')
  })

  it('refuses to move a copy when it cannot record that it moved it', async () => {
    /*
     * Storage that can be read and not written -- full, or blocked for writing. Moving the copy without being able
     * to record the move means moving it again for the next profile that opens Chess World, which is the one
     * outcome worth more than the convenience of an automatic move.
     */
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) }, { readOnly: true })
    const channel = fakeChannel(nothing())

    const answer = await carry({ storage, channel })

    assert.deepEqual(channel.sent, [])
    assert.ok(answer.notes.some((one) => /Nothing has been lost; it is all still there/.test(one)))
  })

  it('takes the record back when the save was refused, so the next launch tries again', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) })
    // A read that works and a save that is refused: the file became unwritable between the two.
    const channel = {
      ...fakeChannel(nothing()),
      read: async (): Promise<Answer<Thing>> => ({ value: nothing(), notes: [], refused: null }),
      save: async (): Promise<Answer<Thing>> => ({ value: nothing(), notes: [], refused: 'Orbis could not read what is already saved here.' })
    }

    const answer = await firstRead<Thing>({
      key: KEY, what: 'puzzles', read: channel.read, save: channel.save, isEmpty: empty, fromBrowser, storage, now: () => 1
    })

    assert.notEqual(answer.refused, null)
    assert.equal(answer.carried, null)
    assert.equal(JSON.parse(storage.held[CARRIED_KEY] ?? '{}')[KEY], undefined, 'nothing landed, so there is nothing to protect')
  })

  it('takes the record back when the save could not be sent at all', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }) })
    const channel = fakeChannel(nothing(), { throws: true })

    const answer = await carry({ storage, channel })

    assert.equal(answer.carried, null)
    assert.ok(answer.notes.some((one) => /the pipe went away/.test(one)), 'and the reason is in the sentence')
    assert.ok(answer.notes.some((one) => /try again next time/.test(one)))
    assert.equal(JSON.parse(storage.held[CARRIED_KEY] ?? '{}')[KEY], undefined)
  })

  it('does nothing at all when this window will not let Orbis use its storage', async () => {
    const storage = fakeStorage({}, { reachable: false })
    const channel = fakeChannel(nothing())

    const answer = await carry({ storage, channel })

    assert.equal(answer.carried, null)
    assert.deepEqual(channel.sent, [])
  })

  it('reads junk in the record of what has moved as nothing having moved', async () => {
    // Better to move a copy twice into the same profile -- which is harmless, the second is the same bytes -- than to
    // refuse for ever because one key went bad.
    const storage = fakeStorage({ [KEY]: JSON.stringify({ rows: ['mine'] }), [CARRIED_KEY]: 'not json' })
    const channel = fakeChannel(nothing())

    const answer = await carry({ storage, channel })

    assert.match(String(answer.carried), /brought into this profile/)
  })
})

describe('not one message per change', () => {
  const later = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

  it('sends the newest value and nothing in between', async () => {
    const sent: number[] = []
    const send = coalesced<number>(async (one) => void sent.push(one), { delayMs: 20, maxDelayMs: 500 })

    send.queue(1)
    send.queue(2)
    send.queue(3)
    assert.deepEqual(sent, [], 'nothing has gone yet')

    await later(40)
    assert.deepEqual(sent, [3], 'one message, carrying the newest value')
  })

  it('still sends during a stream of changes that never pauses', async () => {
    /*
     * The failure a plain debounce has: a timer that restarts on every change never fires while somebody keeps
     * working, so a long session saves nothing at all. The second timer does not restart.
     */
    const sent: number[] = []
    const send = coalesced<number>(async (one) => void sent.push(one), { delayMs: 1000, maxDelayMs: 30 })

    for (let i = 1; i <= 6; i++) {
      send.queue(i)
      await later(10)
    }
    await later(20)

    assert.ok(sent.length >= 1, 'something was sent although the short timer never ran out')
    assert.ok(sent.length <= 3, `and not one per change (${sent.length} for six changes)`)
  })

  it('sends what is waiting when it is asked to, which is what closing does', async () => {
    const sent: number[] = []
    const send = coalesced<number>(async (one) => void sent.push(one), { delayMs: 5000, maxDelayMs: 5000 })

    send.queue(7)
    assert.equal(send.waiting(), true)
    await send.flush()

    assert.deepEqual(sent, [7])
    assert.equal(send.waiting(), false)
  })

  it('throws away what is waiting when a record is started again', async () => {
    const sent: number[] = []
    const send = coalesced<number>(async (one) => void sent.push(one), { delayMs: 10 })

    send.queue(1)
    send.drop()
    await later(30)

    assert.deepEqual(sent, [], 'a value dropped is a value never sent')
  })

  it('keeps sends in the order they were made, so a later value cannot be overtaken', async () => {
    const sent: number[] = []
    const send = coalesced<number>(async (one) => {
      // The first send is slow. Without chaining, the second would land first and the older value would win.
      await later(one === 1 ? 30 : 0)
      sent.push(one)
    }, { delayMs: 1 })

    send.queue(1)
    await later(10)
    send.queue(2)
    await send.flush()
    await later(60)

    assert.deepEqual(sent, [1, 2])
  })

  it('a send that failed does not stop the next one', async () => {
    const sent: number[] = []
    const send = coalesced<number>(async (one) => {
      if (one === 1) throw new Error('the pipe went away')
      sent.push(one)
    }, { delayMs: 1 })

    send.queue(1)
    await later(10)
    send.queue(2)
    await send.flush()
    await later(10)

    assert.deepEqual(sent, [2])
  })
})

describe('the copy kept for the first frame', () => {
  const chosen = (): ChessSettings => withField(DEFAULT_CHESS_SETTINGS, 'board.theme', 'walnut')

  it('is never written from settings nothing has chosen', () => {
    /*
     * The one rule, and the loss it prevents. On the first launch after the settings moved into the profile, the
     * profile has no settings file, so what it answers with is the defaults -- and a mirror that wrote whatever the
     * profile last said would put stock settings over a year of somebody's own, a moment before anything had a
     * chance to move them across. What would then move across is the stock ones.
     */
    assert.equal(mirrorToWrite(DEFAULT_CHESS_SETTINGS), null)
    assert.notEqual(mirrorToWrite(chosen()), null)
  })

  it('knows a chosen setting from a default one, whatever order the keys were written in', () => {
    assert.equal(nothingKept(DEFAULT_CHESS_SETTINGS), true)
    assert.equal(nothingKept(chosen()), false)

    // The same settings with their groups written in a different order are the same settings. Comparing two pieces
    // of JSON would answer "different" here, which would write a mirror that must not be written.
    const shuffled = {
      analysis: { ...DEFAULT_CHESS_SETTINGS.analysis },
      engine: { ...DEFAULT_CHESS_SETTINGS.engine },
      sound: { ...DEFAULT_CHESS_SETTINGS.sound },
      moves: { ...DEFAULT_CHESS_SETTINGS.moves },
      board: { ...DEFAULT_CHESS_SETTINGS.board }
    } as ChessSettings
    assert.notEqual(JSON.stringify(shuffled), JSON.stringify(DEFAULT_CHESS_SETTINGS))
    assert.equal(nothingKept(shuffled), true)
  })

  it('reads one bad value in the copy as one bad value, not as no copy at all', () => {
    const read = mirrorFrom(JSON.stringify({ board: { theme: 'walnut', cursor: 'nonsense' } }))
    assert.equal(read?.board.theme, 'walnut')
    assert.equal(read?.board.cursor, DEFAULT_CHESS_SETTINGS.board.cursor)
  })

  it('is nothing when there is nothing there, and nothing when what is there is not readable', () => {
    assert.equal(mirrorFrom(null), null)
    assert.equal(mirrorFrom('   '), null)
    assert.equal(mirrorFrom('{ not json'), null)
  })
})

describe('what somebody is told went wrong', () => {
  it('takes the channel’s own wrapping off the front of the reason', () => {
    const wrapped = new Error("Error invoking remote method 'chess:training': Error: That game is not here any more.")
    assert.equal(reason(wrapped), 'That game is not here any more.')
  })

  it('says something rather than nothing when what was thrown was not an error', () => {
    assert.equal(reason('a string'), 'no reason was given')
  })
})
