import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  COMPOSITION_ASSUMPTIONS,
  COMPOSITION_LIMITS,
  checkKind,
  isCompositionError,
  isPlainData,
  mayActOnBehalf,
  planPipeline,
  send,
  type Participant
} from './composition.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isCompositionError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

const ID_A = 'page_aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const ID_B = 'page_bbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const ID_C = 'page_cccccccccccccccccccccccccccc'

const participant = (pageId: string, over: Partial<Participant> = {}): Participant => ({
  pageId,
  accepts: [{ kind: 'table.rows', describe: 'Takes a table of rows', replies: true }],
  granted: ['computation.arithmetic'],
  running: true,
  ...over
})

const sender = (over: Partial<Participant> = {}): Participant =>
  participant(ID_A, { granted: ['page.send', 'computation.arithmetic'], ...over })

const directory = (...people: Participant[]): Map<string, Participant> =>
  new Map(people.map((one) => [one.pageId, one]))

const sendTo = (
  to: string,
  over: Partial<Parameters<typeof send>[0]> = {},
  people: Participant[] = [participant(ID_B)]
): ReturnType<typeof send> =>
  send({
    from: sender(),
    toPageId: to,
    kind: 'table.rows',
    body: { rows: [[1, 2]] },
    id: 'r1',
    directory: directory(...people),
    ...over
  })

describe('message kinds', () => {
  it('accepts a dotted name', () => {
    assert.equal(checkKind('table.rows'), null)
    assert.equal(checkKind('plot.series-data'), null)
  })

  it('refuses anything not shaped like a name', () => {
    for (const kind of ['Table.Rows', 'table rows', 'table', '.rows', 'table.', '../../etc', '']) {
      assert.ok(checkKind(kind) !== null, `"${kind}" was accepted`)
    }
  })

  it('refuses a name long enough to be an attack on a log line', () => {
    assert.ok(checkKind(`a.${'b'.repeat(COMPOSITION_LIMITS.kindLength)}`) !== null)
  })
})

describe('what counts as data', () => {
  it('accepts plain values', () => {
    assert.equal(isPlainData(null), true)
    assert.equal(isPlainData('text'), true)
    assert.equal(isPlainData(42), true)
    assert.equal(isPlainData(true), true)
    assert.equal(isPlainData([1, 'two', { three: 3 }]), true)
    assert.equal(isPlainData({ a: { b: [1, 2, null] } }), true)
  })

  it('refuses a function, however it is hidden', () => {
    assert.equal(isPlainData(() => 1), false)
    assert.equal(isPlainData({ run: () => 1 }), false)
    assert.equal(isPlainData([() => 1]), false)
  })

  it('refuses anything with a prototype of its own', () => {
    class Thing {
      value = 1
    }
    assert.equal(isPlainData(new Thing()), false)
    assert.equal(isPlainData(new Date()), false)
    assert.equal(isPlainData(new Map()), false)
    assert.equal(isPlainData(new Error('no')), false)
  })

  it('refuses a getter, which runs code when the value is read', () => {
    const sneaky = {}
    Object.defineProperty(sneaky, 'value', { get: () => 'ran', enumerable: true })
    assert.equal(isPlainData(sneaky), false)
  })

  it('refuses a number that is not finite', () => {
    assert.equal(isPlainData(Number.NaN), false)
    assert.equal(isPlainData(Number.POSITIVE_INFINITY), false)
    assert.equal(isPlainData({ n: Number.NaN }), false)
  })

  it('refuses undefined and a symbol', () => {
    assert.equal(isPlainData(undefined), false)
    assert.equal(isPlainData(Symbol('s')), false)
  })

  it('refuses something nested past a sensible depth', () => {
    let deep: unknown = 1
    for (let i = 0; i < 40; i++) deep = { deep }
    assert.equal(isPlainData(deep), false)
  })

  it('accepts an object with no prototype at all', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare.a = 1
    assert.equal(isPlainData(bare), true)
  })
})

describe('sending', () => {
  it('delivers when both ends agree', () => {
    const result = ok(sendTo(ID_B))
    assert.equal(result.to.pageId, ID_B)
    assert.equal(result.message.kind, 'table.rows')
    assert.equal(result.expectsReply, true)
  })

  it('refuses a sender that was never allowed to send', () => {
    const refused = sendTo(ID_B, { from: sender({ granted: ['computation.arithmetic'] }) })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'not-allowed')
  })

  it('tells a sender without permission nothing about the receiver', () => {
    // The same refusal whether the receiver exists, is stopped, or was never there.
    const without = sender({ granted: [] })
    const real = send({ from: without, toPageId: ID_B, kind: 'table.rows', body: {}, id: 'r1', directory: directory(participant(ID_B)) })
    const missing = send({ from: without, toPageId: ID_C, kind: 'table.rows', body: {}, id: 'r1', directory: directory(participant(ID_B)) })
    assert.ok(isCompositionError(real) && isCompositionError(missing))
    assert.equal(real.message, missing.message)
  })

  it('gives the identical answer for a Page that does not exist and one that refuses', () => {
    // This is the whole anti-enumeration property: a Page must not be able to tell these apart.
    const missing = sendTo(ID_C)
    const refuses = sendTo(ID_B, {}, [participant(ID_B, { accepts: [] })])
    const stopped = sendTo(ID_B, {}, [participant(ID_B, { running: false })])
    const notAnId = sendTo('not-a-page-id')
    assert.ok(isCompositionError(missing) && isCompositionError(refuses) && isCompositionError(stopped) && isCompositionError(notAnId))
    assert.equal(missing.message, refuses.message)
    assert.equal(missing.message, stopped.message)
    assert.equal(missing.message, notAnId.message)
    assert.equal(missing.error, refuses.error)
  })

  it('refuses a Page sending to itself', () => {
    const refused = sendTo(ID_A, {}, [participant(ID_A)])
    assert.ok(isCompositionError(refused))
    assert.match(refused.message, /cannot send a message to itself/)
  })

  it('refuses a kind the receiver never declared', () => {
    const refused = sendTo(ID_B, { kind: 'plot.series' })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'not-available')
  })

  it('refuses a body that could carry behaviour', () => {
    const refused = sendTo(ID_B, { body: { run: () => 'gotcha' } })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'invalid-message')
    assert.match(refused.message, /plain data only/)
  })

  it('refuses a body too large, before walking it', () => {
    const refused = sendTo(ID_B, { body: { big: 'x'.repeat(COMPOSITION_LIMITS.messageBytes + 1) } })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'too-large')
  })

  it('refuses a body that cannot be serialised at all', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const refused = sendTo(ID_B, { body: cyclic })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'invalid-message')
  })

  it('counts the hop, and never takes the count from the sender', () => {
    assert.equal(ok(sendTo(ID_B)).message.hops, 1)
    assert.equal(ok(sendTo(ID_B, { hops: 3 })).message.hops, 4)
    // A sender claiming a negative or fractional count cannot lower it.
    assert.equal(ok(sendTo(ID_B, { hops: -100 })).message.hops, 1)
    assert.equal(ok(sendTo(ID_B, { hops: 2.9 })).message.hops, 3)
  })

  it('stops a message that has gone round too many times', () => {
    const refused = sendTo(ID_B, { hops: COMPOSITION_LIMITS.hops })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'too-many-hops')
    assert.match(refused.message, /in a circle/)
  })

  it('refuses when too many requests are already outstanding', () => {
    const many = Array.from({ length: COMPOSITION_LIMITS.outstanding }, (_, i) => `r${i}`)
    const refused = sendTo(ID_B, { outstanding: many })
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'too-many-outstanding')
  })

  it('says the receiver acts with its own permissions', () => {
    assert.ok(ok(sendTo(ID_B)).notes.some((one) => /Nothing the sender was allowed to do carries across/.test(one)))
  })
})

describe('permissions never pool', () => {
  it('refuses a Page acting on a capability it was not given, whoever asked', () => {
    const handler = participant(ID_B, { granted: ['computation.arithmetic'] })
    const problem = mayActOnBehalf(handler, 'device.camera')
    assert.ok(problem !== null)
    assert.match(problem.message, /Permissions belong to the Page that uses them/)
  })

  it('allows a Page to act on a capability it does have', () => {
    const handler = participant(ID_B, { granted: ['device.camera'] })
    assert.equal(mayActOnBehalf(handler, 'device.camera'), null)
  })

  it('does not let a sender’s permission reach the handler', () => {
    // The sender has the camera; the handler does not. The handler still cannot use it.
    const handler = participant(ID_B, { granted: [] })
    assert.ok(mayActOnBehalf(handler, 'device.camera') !== null)
  })
})

describe('pipelines', () => {
  const chain = (...ids: string[]): { id: string; name: string; steps: { pageId: string; produces: string; describe: string }[] } => ({
    id: 'pl1',
    name: 'Import and plot',
    steps: ids.map((pageId) => ({ pageId, produces: 'table.rows', describe: 'does a thing' }))
  })

  it('plans a chain where each step accepts what the last produces', () => {
    const plan = ok(planPipeline(chain(ID_A, ID_B), directory(participant(ID_A), participant(ID_B))))
    assert.equal(plan.willUse.length, 2)
    assert.ok(plan.notes.some((one) => /own permissions/.test(one)))
  })

  it('refuses a chain with the same Page twice, which would run in a circle', () => {
    const refused = planPipeline(chain(ID_A, ID_A), directory(participant(ID_A)))
    assert.ok(isCompositionError(refused))
    assert.match(refused.message, /run in a circle/)
  })

  it('refuses a step that does not accept what the one before it produces', () => {
    const pipeline = {
      id: 'pl1',
      name: 'Mismatch',
      steps: [
        { pageId: ID_A, produces: 'plot.series', describe: 'makes a series' },
        { pageId: ID_B, produces: 'table.rows', describe: 'wants rows' }
      ]
    }
    const refused = planPipeline(pipeline, directory(participant(ID_A), participant(ID_B)))
    assert.ok(isCompositionError(refused))
    assert.match(refused.message, /does not accept "plot\.series"/)
  })

  it('gives the same unhelpful answer for a Page that is not there, like everything else does', () => {
    const refused = planPipeline(chain(ID_A, ID_C), directory(participant(ID_A)))
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'not-available')
  })

  it('collects the risky capabilities across the whole chain, for one prompt at the start', () => {
    const plan = ok(
      planPipeline(
        chain(ID_A, ID_B),
        directory(participant(ID_A, { granted: ['device.camera'] }), participant(ID_B))
      )
    )
    assert.ok(plan.notes.some((one) => /Somewhere in this chain/.test(one)))
  })

  it('refuses an empty chain and an over-long one', () => {
    assert.ok(isCompositionError(planPipeline({ id: 'p', name: 'n', steps: [] }, directory())))
    const tooMany = {
      id: 'p',
      name: 'n',
      steps: Array.from({ length: COMPOSITION_LIMITS.steps + 1 }, (_, i) => ({
        pageId: `page_${String(i).padStart(28, '0')}`,
        produces: 'table.rows',
        describe: 'x'
      }))
    }
    assert.ok(isCompositionError(planPipeline(tooMany, directory())))
  })

  it('refuses a step producing something that is not a kind', () => {
    const pipeline = { id: 'p', name: 'n', steps: [{ pageId: ID_A, produces: 'NOT A KIND', describe: 'x' }] }
    const refused = planPipeline(pipeline, directory(participant(ID_A)))
    assert.ok(isCompositionError(refused))
    assert.equal(refused.error, 'invalid-pipeline')
  })
})

describe('assumptions', () => {
  it('says both ends have to agree', () => {
    assert.ok(COMPOSITION_ASSUMPTIONS.some((one) => /Both Pages have to agree/.test(one)))
  })

  it('says permissions never pool', () => {
    assert.ok(COMPOSITION_ASSUMPTIONS.some((one) => /Permissions never pool/.test(one)))
  })

  it('says a Page cannot find out what other Pages exist', () => {
    assert.ok(COMPOSITION_ASSUMPTIONS.some((one) => /cannot find out what other Pages exist/.test(one)))
  })
})
