import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createStudentHandlers, type StudentHelperDeps } from './student.ts'
import { HelperError } from './server.ts'

/**
 * What the browser may ask Orbis Student.
 *
 * This is a boundary between a web page's process and somebody's study record, so the tests here are mostly about
 * what it refuses: an address that is not a page, an empty card, a request when Orbis is not running — and the
 * absence of any channel that could read the learning record or loosen a session's rules.
 */

const spy = (): { deps: StudentHelperDeps; calls: { name: string; args: unknown[] }[] } => {
  const calls: { name: string; args: unknown[] }[] = []
  const note = (name: string, args: unknown[]): void => {
    calls.push({ name, args })
  }
  return {
    calls,
    deps: {
      state: async () => {
        note('state', [])
        return { running: true, title: 'Physics', subject: 'Physics', level: 'focus', minutesLeft: 12, paused: false, locked: false }
      },
      saveCard: async (front, back, subject) => {
        note('saveCard', [front, back, subject])
        return { ok: true }
      },
      saveMistake: async (concept, detail, subject) => {
        note('saveMistake', [concept, detail, subject])
        return { ok: true }
      },
      saveResource: async (url, title, subject) => {
        note('saveResource', [url, title, subject])
        return { ok: true }
      },
      start: async (minutes, subject) => {
        note('start', [minutes, subject])
        return { ok: true }
      },
      end: async () => {
        note('end', [])
        return { ok: true }
      },
      draftFromPage: async () => {
        note('draftFromPage', [])
        return { ok: true, cards: [{ front: 'From the page', back: 'An answer' }] }
      }
    }
  }
}

const refusal = async (run: () => Promise<unknown> | unknown): Promise<HelperError> => {
  try {
    await run()
  } catch (err) {
    assert.ok(err instanceof HelperError, String(err))
    return err
  }
  throw new Error('that should have been refused')
}

describe('Student, from the browser', () => {
  it('offers exactly the things a page is allowed to ask, and no more', () => {
    const handlers = createStudentHandlers(() => spy().deps)
    assert.deepEqual(Object.keys(handlers).sort(), [
      'student:draftFromPage',
      'student:endFocus',
      'student:saveCard',
      'student:saveMistake',
      'student:saveResource',
      'student:startFocus',
      'student:state'
    ])
  })

  it('drafts from a page without saving anything, and without trusting the page', async () => {
    const { deps, calls } = spy()
    const out = (await createStudentHandlers(() => deps)['student:draftFromPage'](['text a page supplied'], {} as never)) as { cards: unknown[] }
    assert.equal(calls[0].name, 'draftFromPage')
    // Nothing the page sent is passed on: Orbis reads the real tab itself.
    assert.deepEqual(calls[0].args, [])
    assert.equal(out.cards.length, 1)
    // And nothing was saved: drafting and keeping are different things, and keeping happens in the window.
    assert.ok(!calls.some((one) => one.name === 'saveCard'))
  })

  it('has no channel that could read the learning record', () => {
    const names = Object.keys(createStudentHandlers(() => spy().deps)).join(' ')
    for (const forbidden of ['mastery', 'learning', 'plan', 'report', 'xp', 'goals', 'concepts', 'snapshot', 'next']) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be reachable from a page`)
    }
  })

  it('has no channel that could loosen a session', () => {
    const names = Object.keys(createStudentHandlers(() => spy().deps)).join(' ')
    for (const forbidden of ['allow', 'policy', 'unblock', 'settings', 'pause']) {
      assert.ok(!names.includes(forbidden), `${forbidden} must not be reachable from a page`)
    }
  })

  it('says Orbis is not open rather than failing quietly', async () => {
    const handlers = createStudentHandlers(() => null)
    const err = await refusal(() => handlers['student:state']([], {} as never))
    assert.equal(err.code, 'unavailable')
    assert.match(err.message, /open orbis/i)
  })

  it('reports what is running, and nothing more than that', async () => {
    const { deps } = spy()
    const out = (await createStudentHandlers(() => deps)['student:state']([], {} as never)) as Record<string, unknown>
    assert.deepEqual(Object.keys(out).sort(), ['level', 'locked', 'minutesLeft', 'paused', 'running', 'subject', 'title'])
  })

  it('keeps a card, trimmed and with its subject', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:saveCard'](['  What is velocity?  ', ' Rate of change of position ', ' Physics '], {} as never)
    assert.deepEqual(calls[0].args, ['What is velocity?', 'Rate of change of position', 'Physics'])
  })

  it('refuses half a card', async () => {
    const { deps } = spy()
    const handlers = createStudentHandlers(() => deps)
    const err = await refusal(() => handlers['student:saveCard'](['front only', '   ', null], {} as never))
    assert.equal(err.code, 'bad-request')
  })

  it('treats a missing subject as no subject rather than as the word null', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:saveMistake'](['Acceleration', 'Used velocity instead', ''], {} as never)
    assert.equal(calls[0].args[2], null)
  })

  it('saves a real page', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:saveResource'](['https://example.org/notes', 'Notes', null], {} as never)
    assert.equal(calls[0].args[0], 'https://example.org/notes')
  })

  it('refuses an address that is not a web page', async () => {
    const { deps } = spy()
    const handlers = createStudentHandlers(() => deps)
    for (const bad of ['javascript:alert(1)', 'file:///c:/secrets.txt', 'chrome://settings', 'data:text/html,hi', '', 'not a url']) {
      const err = await refusal(() => handlers['student:saveResource']([bad, 'Title', null], {} as never))
      assert.equal(err.code, 'bad-request', bad)
    }
  })

  it('gives a page with no title a name rather than an empty one', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:saveResource'](['https://example.org/', '', null], {} as never)
    assert.equal(calls[0].args[1], 'Untitled page')
  })

  it('clamps a silly session length instead of refusing it', async () => {
    const { deps, calls } = spy()
    const handlers = createStudentHandlers(() => deps)
    await handlers['student:startFocus']([99999, null], {} as never)
    assert.equal(calls[0].args[0], 600)
    await handlers['student:startFocus']([0, null], {} as never)
    assert.equal(calls[1].args[0], 1)
  })

  it('treats no length as no length, so the defaults decide', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:startFocus']([null, null], {} as never)
    assert.equal(calls[0].args[0], null)
  })

  it('always lets a session be ended, and takes no arguments to do it', async () => {
    const { deps, calls } = spy()
    const out = (await createStudentHandlers(() => deps)['student:endFocus'](['anything'], {} as never)) as { ok: boolean }
    assert.equal(out.ok, true)
    assert.deepEqual(calls[0].args, [])
  })

  it('never passes on the text of an error from further in', async () => {
    const deps: StudentHelperDeps = {
      ...spy().deps,
      saveCard: async () => {
        throw new Error('could not write C:/Users/someone/Orbis/student/flashcards.json')
      }
    }
    const err = await refusal(() => createStudentHandlers(() => deps)['student:saveCard'](['a', 'b', null], {} as never))
    assert.equal(err.code, 'failed')
    assert.ok(!err.message.includes('Users'))
  })

  it('caps what a page can send, rather than passing a megabyte through', async () => {
    const { deps, calls } = spy()
    await createStudentHandlers(() => deps)['student:saveCard'](['x'.repeat(5000), 'y'.repeat(9000), 'z'.repeat(500)], {} as never)
    assert.equal((calls[0].args[0] as string).length, 500)
    assert.equal((calls[0].args[1] as string).length, 2000)
    assert.equal((calls[0].args[2] as string).length, 80)
  })
})
