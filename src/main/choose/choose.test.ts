import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChooseStore, cleanKept, MOST_UNSAVED } from './store.ts'
import { Choose } from './service.ts'
import { isAnswered, isHandedBack, wasKept } from '../../shared/choose/reply.ts'
import { run } from '../../shared/choose/engine.ts'
import { DECISION_VERSION, DEFAULT_POLICY, isRefusal, type Decision } from '../../shared/choose/types.ts'
import { dataDirFor } from '../../shared/profiles.ts'

/**
 * Orbis Choose end to end, through the real store and the real orchestrator.
 *
 * `ask` is the only thing standing in for something: it is handed a function that returns whatever this test says
 * Orion would have said, which is what makes it possible to check the behaviour that actually matters -- what
 * happens when a model answers rubbish, hands the message back, or does not answer at all. Everything else is the
 * code that runs in the application: the same store writing real files, the same validation, the same arithmetic.
 *
 * The cases are chosen for the failures that would otherwise be invisible:
 *
 *   - a model that does not answer losing a decision somebody built up over ten messages
 *   - a save reported as done when the write failed
 *   - a what-if quietly becoming the real decision
 *   - two quick messages applying out of order, so the second overwrites the first
 *   - a control on the card costing a model call, which it has no business doing
 *   - one profile seeing another's decisions
 */

// ---------------------------------------------------------------- scaffolding

const dir = (): string => mkdtempSync(join(tmpdir(), 'orbis-choose-'))

/** What Orion would have answered for a two-option comparison. */
const LAID_OUT = JSON.stringify({
  notADecision: false,
  title: 'Which laptop',
  question: 'ThinkPad or MacBook?',
  aim: 'something that lasts a day',
  sort: 'buying',
  criteria: [
    { name: 'price', describe: '', direction: 'less-is-better', importance: 5, scaling: 'min-max', unit: 'rupees', mentioned: true },
    { name: 'battery', describe: '', direction: 'more-is-better', importance: 3, scaling: 'min-max', unit: 'hours', mentioned: true }
  ],
  constraints: [],
  alternatives: [
    {
      name: 'ThinkPad',
      describe: 'a laptop',
      mentioned: true,
      upsides: ['keyboard'],
      downsides: [],
      values: { price: { value: 80_000, origin: 'user-said' }, battery: { value: 9, origin: 'user-said' } }
    },
    {
      name: 'MacBook',
      describe: 'another laptop',
      mentioned: true,
      upsides: [],
      downsides: ['dear'],
      values: { price: { value: 120_000, origin: 'user-said' }, battery: { value: 18, origin: 'user-said' } }
    }
  ],
  preferences: [],
  assumptions: [],
  gaps: [],
  askThem: ''
})

const SAID = 'Should I get the ThinkPad or the MacBook? I care about battery and price.'

const started = (): Parameters<Choose['start']>[0] => ({
  conversationId: 'c1',
  message: SAID,
  said: SAID,
  before: [],
  sort: 'buying',
  named: ['ThinkPad', 'MacBook']
})

/**
 * A stand-in for Orion that answers from a script.
 *
 * Every prompt is recorded, so a test can assert how many model calls an operation cost -- which is the only way
 * to check that a control on the card costs none.
 */
function scripted(answers: (string | null | Error)[]): { ask(prompt: string): Promise<string | null>; asked: string[] } {
  const asked: string[] = []
  let at = 0
  return {
    asked,
    async ask(prompt: string): Promise<string | null> {
      asked.push(prompt)
      const next = answers[Math.min(at, answers.length - 1)]
      at += 1
      if (next instanceof Error) throw next
      return next
    }
  }
}

/** The wording call always comes second; this answers both without the test having to care. */
const laidOutThenWorded = (...more: (string | null | Error)[]): (string | null | Error)[] => [
  LAID_OUT,
  'The ThinkPad, mostly on price.',
  ...more
]

// ---------------------------------------------------------------- the store

describe('what is kept on disk', () => {
  it('writes a decision and reads back the same one', async () => {
    const store = new ChooseStore(dir())
    const decision = decisionOf()
    const result = run(decision)
    const kept = await store.put({ id: decision.id, decision, result, scenarios: [] })
    assert.ok(kept)
    await store.flush()

    const again = await store.get(decision.id)
    assert.deepEqual(again?.decision, decision)
    assert.equal(again?.result?.leaderId, result.leaderId)
  })

  it('finds the decision open in a conversation, and the most recent when there are two', async () => {
    const store = new ChooseStore(dir())
    const old = { ...decisionOf(), id: 'older', changedAt: 1000 }
    const recent = { ...decisionOf(), id: 'newer', changedAt: 9000 }
    await store.put({ id: old.id, decision: old, result: null, scenarios: [] })
    await store.put({ id: recent.id, decision: recent, result: null, scenarios: [] })
    assert.equal((await store.openIn('c1'))?.id, 'newer')
    assert.equal(await store.openIn('somewhere-else'), null)
    assert.equal(await store.openIn(''), null)
  })

  it('one profile never sees another’s decisions', async () => {
    const userData = dir()
    const store = new ChooseStore(userData)
    const mine = { ...decisionOf(), id: 'mine' }
    await store.put({ id: mine.id, decision: mine, result: null, scenarios: [] })
    await store.flush()

    await store.useProfile('work')
    assert.equal(await store.get('mine'), null)
    const theirs = { ...decisionOf(), id: 'theirs' }
    await store.put({ id: theirs.id, decision: theirs, result: null, scenarios: [] })
    await store.flush()

    await store.useProfile('default')
    assert.ok(await store.get('mine'))
    assert.equal(await store.get('theirs'), null)

    // And each landed in its own folder, not in one file with a field saying whose it is.
    await fs.access(join(userData, dataDirFor('work'), 'choose', 'decisions.json'))
    await fs.access(join(userData, dataDirFor('default'), 'choose', 'decisions.json'))
  })

  it('keeps what was asked for and drops the rest once there are too many', async () => {
    const store = new ChooseStore(dir())
    const asked = { ...decisionOf(), id: 'asked-for', saved: true, changedAt: 1 }
    await store.put({ id: asked.id, decision: asked, result: null, scenarios: [] })

    for (let at = 0; at < MOST_UNSAVED + 5; at++) {
      const one = { ...decisionOf(), id: `passing-${at}`, changedAt: 100 + at }
      await store.put({ id: one.id, decision: one, result: null, scenarios: [] })
    }

    const all = await store.all()
    assert.equal(all.filter((one) => !one.decision.saved).length, MOST_UNSAVED)
    assert.ok(all.some((one) => one.id === 'asked-for'), 'the one they asked to keep survives whatever else does not')
    // The oldest passing ones went first.
    assert.equal(await store.get('passing-0'), null)
    assert.ok(await store.get(`passing-${MOST_UNSAVED + 4}`))
  })

  it('says a decision is kept only once it reads back as kept', async () => {
    const store = new ChooseStore(dir())
    const decision = decisionOf()
    await store.put({ id: decision.id, decision, result: null, scenarios: [] })
    assert.equal(await store.keep(decision.id), true)
    assert.equal((await store.get(decision.id))?.decision.saved, true)
    assert.equal(await store.keep('never-existed'), false)
  })

  it('refuses a stored row whose decision does not validate, rather than drawing half of it', () => {
    assert.equal(cleanKept({ decision: { id: 'x', v: DECISION_VERSION, alternatives: [] } }), null)
    assert.equal(cleanKept(null), null)
    assert.equal(cleanKept({ decision: { ...decisionOf(), v: DECISION_VERSION + 1 } }), null)

    // A result for a different decision is dropped, and the decision is still usable without it.
    const decision = decisionOf()
    const got = cleanKept({ decision, result: { ...run(decision), decisionId: 'somebody-else' }, scenarios: [] })
    assert.ok(got)
    assert.equal(got?.result, null)
  })

  it('a what-if naming things that are not in the decision is dropped on the way in', () => {
    const decision = decisionOf()
    const got = cleanKept({
      decision,
      result: null,
      scenarios: [
        { id: 's1', name: 'real', weights: { price: 9 }, madeAt: 1 },
        { id: 's2', name: 'nonsense', weights: { colour: 9 }, madeAt: 1 }
      ]
    })
    assert.equal(got?.scenarios.length, 1)
    assert.equal(got?.scenarios[0].id, 's1')
  })
})

// ---------------------------------------------------------------- the whole pipeline

describe('a decision from a message', () => {
  it('lays it out, works it out, writes it down, and answers with the ranking', async () => {
    const orion = scripted(laidOutThenWorded())
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: orion.ask, now: () => 5000 })

    const answer = await choose.start(started())
    assert.ok(isAnswered(answer))
    const verdict = answer.verdict
    assert.equal(verdict.leads?.name, 'ThinkPad')
    assert.equal(verdict.rows.length, 2)
    assert.equal(verdict.rows[0].name, 'ThinkPad')
    assert.equal(verdict.says, 'The ThinkPad, mostly on price.')
    // Two model calls: one to lay it out, one to put it into words. Not three, and not one per option.
    assert.equal(orion.asked.length, 2)

    // And it is on the disk, under this conversation, ready for a follow-up.
    const open = await store.openIn('c1')
    assert.equal(open?.decision.alternatives.length, 2)
    assert.equal(open?.result?.leaderId, 'thinkpad')
  })

  it('hands the message back when Orion says it is not a decision', async () => {
    const orion = scripted(['{"notADecision": true, "title": "a question about how scoring works"}'])
    const choose = new Choose({ store: new ChooseStore(dir()), ask: orion.ask, now: () => 5000 })
    const answer = await choose.start(started())
    assert.ok(isHandedBack(answer))
    // Nothing was worked out, so nothing was asked about wording either.
    assert.equal(orion.asked.length, 1)
  })

  it('refuses, in words, when Orion answers something unusable', async () => {
    const choose = new Choose({ store: new ChooseStore(dir()), ask: scripted(['I reckon the ThinkPad.']).ask, now: () => 5000 })
    const answer = await choose.start(started())
    assert.ok(isRefusal(answer))
  })

  it('refuses when Orion does not answer at all, and when the call throws', async () => {
    const quiet = new Choose({ store: new ChooseStore(dir()), ask: scripted([null]).ask, now: () => 5000 })
    assert.ok(isRefusal(await quiet.start(started())))

    const broken = new Choose({ store: new ChooseStore(dir()), ask: scripted([new Error('no key')]).ask, now: () => 5000 })
    const answer = await broken.start(started())
    assert.ok(isRefusal(answer))
    assert.match((answer as { fix: string }).fix, /no key/)
  })

  it('uses its own wording when the model cannot provide any, rather than nothing or an invention', async () => {
    const orion = scripted([LAID_OUT, new Error('the model is down')])
    const choose = new Choose({ store: new ChooseStore(dir()), ask: orion.ask, now: () => 5000 })
    const answer = await choose.start(started())
    assert.ok(isAnswered(answer))
    // The arithmetic ran and the answer is there; only the prose is the engine's rather than Orion's.
    assert.equal(answer.verdict.leads?.name, 'ThinkPad')
    assert.match(answer.verdict.says, /ThinkPad/)
    assert.notEqual(answer.verdict.says, '')
  })

  it('throws away a model answer that ignored the instruction, rather than showing a fence', async () => {
    const orion = scripted([LAID_OUT, '```\n# Recommendation\nThe ThinkPad\n```'])
    const choose = new Choose({ store: new ChooseStore(dir()), ask: orion.ask, now: () => 5000 })
    const answer = await choose.start(started())
    assert.ok(isAnswered(answer))
    assert.ok(!answer.verdict.says.startsWith('```'))
    assert.match(answer.verdict.says, /ThinkPad/)
  })
})

describe('a follow-up', () => {
  async function going(extra: (string | null | Error)[] = []): Promise<{ choose: Choose; store: ChooseStore; orion: ReturnType<typeof scripted> }> {
    const orion = scripted(laidOutThenWorded(...extra))
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: orion.ask, now: () => 5000 })
    await choose.start(started())
    return { choose, store, orion }
  }

  it('changes what it was told to and leaves everything else alone', async () => {
    const { choose, store, orion } = await going([
      JSON.stringify({ startOver: false, changes: [{ kind: 'importance', criterionId: 'price', times: 3, says: 'price matters more' }], says: 'price matters more' }),
      'Now the ThinkPad wins more clearly.'
    ])
    const before = await store.openIn('c1')

    const answer = await choose.change({ conversationId: 'c1', message: 'price matters a lot more' })
    assert.ok(isAnswered(answer))
    assert.match(answer.applied?.join(' ') ?? '', /matters 3 times as much/)

    const after = await store.openIn('c1')
    assert.equal(after?.decision.criteria.find((one) => one.id === 'price')?.importance, 15)
    // Everything that was not mentioned is exactly as it was.
    assert.equal(after?.decision.question, before?.decision.question)
    assert.equal(after?.decision.alternatives.length, before?.decision.alternatives.length)
    assert.deepEqual(after?.decision.alternatives[0].values, before?.decision.alternatives[0].values)
    assert.equal(after?.decision.id, before?.decision.id, 'the same decision, changed')
    // One entry in the history for the change.
    assert.equal((after?.decision.history.length ?? 0) - (before?.decision.history.length ?? 0), 1)
    assert.equal(orion.asked.length, 4)
  })

  it('says it is a different decision when Orion says so', async () => {
    const { choose } = await going(['{"startOver": true, "says": "that is about something else"}'])
    const answer = await choose.change({ conversationId: 'c1', message: 'which language should I learn?' })
    assert.ok(isHandedBack(answer))
    assert.match(answer.because, /different decision/)
  })

  it('loses nothing when the change cannot be worked out', async () => {
    const { choose, store } = await going([new Error('the model is down')])
    const before = JSON.stringify((await store.openIn('c1'))?.decision)
    const answer = await choose.change({ conversationId: 'c1', message: 'price matters more' })
    assert.ok(isRefusal(answer))
    assert.equal(JSON.stringify((await store.openIn('c1'))?.decision), before, 'the decision is untouched')
  })

  it('refuses a change that names something that is not there, and keeps the decision', async () => {
    const { choose, store } = await going([
      JSON.stringify({ startOver: false, changes: [{ kind: 'importance', criterionId: 'colour', times: 2, says: '' }] })
    ])
    const before = JSON.stringify((await store.openIn('c1'))?.decision)
    const answer = await choose.change({ conversationId: 'c1', message: 'colour matters more' })
    assert.ok(isRefusal(answer))
    assert.equal(JSON.stringify((await store.openIn('c1'))?.decision), before)
  })

  it('has nothing to change when no decision is open here', async () => {
    const choose = new Choose({ store: new ChooseStore(dir()), ask: scripted([LAID_OUT]).ask, now: () => 5000 })
    const answer = await choose.change({ conversationId: 'nowhere', message: 'price matters more' })
    assert.ok(isRefusal(answer))
    assert.match((answer as { problem: string }).problem, /no comparison open/)
  })

  it('a control on the card costs no model call at all', async () => {
    const { choose, store, orion } = await going()
    const was = orion.asked.length

    const answer = await choose.adjust({
      conversationId: 'c1',
      changes: [{ kind: 'importance', criterionId: 'price', times: 2, says: 'price matters more' }]
    })
    assert.ok(isAnswered(answer))
    assert.equal(orion.asked.length, was, 'dragging a control must not wait on a model')
    // It still did the real thing.
    assert.equal((await store.openIn('c1'))?.decision.criteria.find((one) => one.id === 'price')?.importance, 10)
    assert.notEqual(answer.verdict.says, '')
  })

  it('a control sending nothing usable changes nothing', async () => {
    const { choose } = await going()
    assert.ok(isRefusal(await choose.adjust({ conversationId: 'c1', changes: [] })))
  })

  it('two messages in quick succession both apply, in order, and only the last is drawn', async () => {
    const orion = scripted(laidOutThenWorded())
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: orion.ask, now: () => 5000 })
    await choose.start(started())

    /*
     * The case this is for: somebody says "price matters more" and then "and battery matters less" two seconds
     * later. Run at once, each would start from the decision as it was and the second to finish would overwrite
     * the other. Both are sent without waiting, deliberately.
     */
    const first = choose.adjust({ conversationId: 'c1', changes: [{ kind: 'importance', criterionId: 'price', times: 2, says: '' }] })
    const second = choose.adjust({ conversationId: 'c1', changes: [{ kind: 'importance', criterionId: 'battery', times: 0.5, says: '' }] })
    const [one, two] = await Promise.all([first, second])

    // Both landed.
    const open = await store.openIn('c1')
    assert.equal(open?.decision.criteria.find((one) => one.id === 'price')?.importance, 10)
    assert.equal(open?.decision.criteria.find((one) => one.id === 'battery')?.importance, 1.5)
    // And the earlier answer knows it has been overtaken, so the chat draws one card rather than two.
    assert.ok(isAnswered(one))
    assert.equal(one.stale, true)
    assert.ok(isAnswered(two))
    assert.notEqual(two.stale, true)
  })
})

describe('two comparisons in one conversation', () => {
  /** Two decisions, both in c1, the second touched more recently. */
  async function both(): Promise<{ choose: Choose; store: ChooseStore; first: string; second: string }> {
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: scripted([LAID_OUT]).ask, now: () => 5000 })
    const first = { ...decisionOf(), id: 'laptops', changedAt: 1000 }
    const second = {
      ...decisionOf(),
      id: 'projects',
      changedAt: 9000,
      criteria: [{ id: 'effort', name: 'effort', describe: '', direction: 'less-is-better' as const, importance: 1, scaling: 'min-max' as const, unit: '', origin: 'user-said' as const }],
      alternatives: decisionOf().alternatives.map((one) => ({ ...one, values: { effort: { value: one.id === 'a' ? 5 : 9, origin: 'user-said' as const } } }))
    }
    await store.put({ id: first.id, decision: first, result: null, scenarios: [] })
    await store.put({ id: second.id, decision: second, result: null, scenarios: [] })
    return { choose, store, first: first.id, second: second.id }
  }

  it('a card\u2019s controls change that card\u2019s comparison, not whichever was touched last', async () => {
    /*
     * The fault this is for. Somebody asks about laptops, then about what to build first, then scrolls back up
     * and presses "price matters more" on the laptop card. Without the id, that went to whichever comparison was
     * most recent -- the projects one -- and either refused with a message about a criterion that is not there,
     * or, if both happened to weigh something called price, silently changed the wrong one.
     */
    const { choose, store, first, second } = await both()
    const answer = await choose.adjust({
      conversationId: 'c1',
      decisionId: first,
      changes: [{ kind: 'importance', criterionId: 'price', times: 2, says: '' }]
    })
    assert.ok(isAnswered(answer))
    assert.equal(answer.verdict.decisionId, first)
    assert.equal((await store.get(first))?.decision.criteria[0].importance, 2)
    assert.equal((await store.get(second))?.decision.criteria[0].importance, 1, 'the other comparison is untouched')
  })

  it('a typed follow-up, which names nothing, still means the one you were last working on', async () => {
    const { choose, store, second } = await both()
    const answer = await choose.adjust({ conversationId: 'c1', changes: [{ kind: 'importance', criterionId: 'effort', times: 3, says: '' }] })
    assert.ok(isAnswered(answer))
    assert.equal(answer.verdict.decisionId, second)
    assert.equal((await store.get(second))?.decision.criteria[0].importance, 3)
  })

  it('a card cannot reach a comparison belonging to another conversation', async () => {
    const { choose, store, first } = await both()
    const elsewhere = { ...decisionOf(), id: 'somebody-elses', conversationId: 'c2' }
    await store.put({ id: elsewhere.id, decision: elsewhere, result: null, scenarios: [] })

    const answer = await choose.adjust({
      conversationId: 'c1',
      decisionId: 'somebody-elses',
      changes: [{ kind: 'importance', criterionId: 'price', times: 2, says: '' }]
    })
    assert.ok(isRefusal(answer))
    assert.equal((await store.get('somebody-elses'))?.decision.criteria[0].importance, 1)
    // And the one in this conversation is untouched too: a refused request changes nothing at all.
    assert.equal((await store.get(first))?.decision.criteria[0].importance, 1)
  })

  it('keeping from a card keeps that card\u2019s comparison', async () => {
    const { choose, store, first, second } = await both()
    const kept = await choose.keep({ conversationId: 'c1', decisionId: first })
    assert.ok(wasKept(kept))
    assert.equal((await store.get(first))?.decision.saved, true)
    assert.equal((await store.get(second))?.decision.saved, false)
  })
})

describe('a what-if', () => {
  async function going(extra: (string | null | Error)[] = []): Promise<{ choose: Choose; store: ChooseStore }> {
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: scripted(laidOutThenWorded(...extra)).ask, now: () => 5000 })
    await choose.start(started())
    return { choose, store }
  }

  it('answers the hypothetical and leaves the real figures exactly as they were', async () => {
    const { choose, store } = await going([
      JSON.stringify({ name: 'battery is everything', weights: { battery: 40, price: 1 } }),
      'The MacBook, if battery is what counts.'
    ])
    const before = JSON.stringify((await store.openIn('c1'))?.decision)

    const answer = await choose.whatIf({ conversationId: 'c1', message: 'what if battery mattered far more?' })
    assert.ok(isAnswered(answer))
    assert.equal(answer.scenario, 'battery is everything')
    assert.equal(answer.verdict.leads?.name, 'MacBook')
    assert.equal(answer.difference?.leaderChanged, true)
    assert.equal(answer.difference?.wasLeading, 'thinkpad')
    assert.equal(answer.difference?.nowLeading, 'macbook')

    // The decision itself did not move, so "go back to the original" needs nothing undone.
    const after = await store.openIn('c1')
    assert.equal(JSON.stringify(after?.decision), before)
    assert.equal(after?.result?.leaderId, 'thinkpad')
    // The what-if is remembered beside it, not instead of it.
    assert.equal(after?.scenarios.length, 1)
  })

  it('says a what-if makes no difference rather than dressing it up as a change', async () => {
    const { choose } = await going([
      JSON.stringify({ name: 'a nudge', weights: { price: 5.0001 } }),
      'It makes no difference.'
    ])
    const answer = await choose.whatIf({ conversationId: 'c1', message: 'what if price mattered a tiny bit more?' })
    assert.ok(isAnswered(answer))
    assert.equal(answer.difference?.sameAnswer, true)
  })

  it('refuses a what-if that cannot be expressed as a change to this comparison', async () => {
    const { choose } = await going([JSON.stringify({ cannotDo: 'that is about something not in this comparison' })])
    const answer = await choose.whatIf({ conversationId: 'c1', message: 'what if it rains?' })
    assert.ok(isRefusal(answer))
    assert.match((answer as { fix: string }).fix, /not in this comparison/)
  })
})

describe('asking for more of the working', () => {
  it('answers without changing or recomputing anything', async () => {
    const orion = scripted(laidOutThenWorded('The MacBook loses on price, and that is most of it.'))
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: orion.ask, now: () => 5000 })
    await choose.start(started())
    const before = JSON.stringify(await store.openIn('c1'))

    const answer = await choose.explain({ conversationId: 'c1', of: 'why-not', message: 'why not the MacBook?' })
    assert.ok(isAnswered(answer))
    assert.match(answer.verdict.says, /MacBook/)
    // Nothing on disk moved, and the run number did not advance: a question is not a change.
    assert.equal(JSON.stringify(await store.openIn('c1')), before)
    assert.equal(answer.verdict.run, 1)
    // One extra model call for the words, and no more.
    assert.equal(orion.asked.length, 3)
  })

  it('falls back to the engine’s own account when the model cannot answer', async () => {
    const choose = new Choose({
      store: new ChooseStore(dir()),
      ask: scripted(laidOutThenWorded(new Error('down'))).ask,
      now: () => 5000
    })
    await choose.start(started())
    const answer = await choose.explain({ conversationId: 'c1', of: 'how-it-worked', message: 'how did you work that out?' })
    assert.ok(isAnswered(answer))
    assert.match(answer.verdict.says, /added up|importance/)
  })

  it('answers with the best it has when they say to stop asking', async () => {
    const choose = new Choose({
      store: new ChooseStore(dir()),
      ask: scripted(laidOutThenWorded('The ThinkPad.')).ask,
      now: () => 5000
    })
    await choose.start(started())
    const answer = await choose.justDecide({ conversationId: 'c1', message: 'just decide' })
    assert.ok(isAnswered(answer))
    assert.equal(answer.verdict.ask, null, 'no question when they asked to be told')
  })
})

describe('keeping one, and finding it again', () => {
  it('only says it is kept once the write came back, and lists it afterwards', async () => {
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: scripted(laidOutThenWorded('The ThinkPad.')).ask, now: () => 5000 })
    await choose.start(started())

    const kept = await choose.keep({ conversationId: 'c1' })
    assert.ok(wasKept(kept))
    assert.equal(kept.title, 'Which laptop')

    const list = await choose.kept()
    assert.equal(list.decisions.length, 1)
    assert.equal(list.decisions[0].title, 'Which laptop')
    assert.equal(list.decisions[0].leads, 'ThinkPad')
  })

  it('has nothing to keep when nothing is open here', async () => {
    const choose = new Choose({ store: new ChooseStore(dir()), ask: scripted([LAID_OUT]).ask, now: () => 5000 })
    assert.ok(isRefusal(await choose.keep({ conversationId: 'nowhere' })))
  })

  it('brings a kept one into another conversation, and follow-ups land on it there', async () => {
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: scripted(laidOutThenWorded('The ThinkPad.')).ask, now: () => 5000 })
    const first = await choose.start(started())
    assert.ok(isAnswered(first))
    await choose.keep({ conversationId: 'c1' })
    const id = first.verdict.decisionId

    const again = await choose.reopen({ decisionId: id, conversationId: 'c2', message: '' })
    assert.ok(isAnswered(again))
    assert.equal(again.verdict.leads?.name, 'ThinkPad')
    // It now belongs to the new conversation, so the next message there changes this one.
    assert.equal((await store.openIn('c2'))?.decision.id, id)
  })

  it('says so when a kept one is no longer there', async () => {
    const choose = new Choose({ store: new ChooseStore(dir()), ask: scripted([LAID_OUT]).ask, now: () => 5000 })
    assert.ok(isRefusal(await choose.reopen({ decisionId: 'never-existed', conversationId: 'c1', message: '' })))
  })

  it('forgets one when asked, and says whether there was one to forget', async () => {
    const store = new ChooseStore(dir())
    const choose = new Choose({ store, ask: scripted(laidOutThenWorded('The ThinkPad.')).ask, now: () => 5000 })
    const first = await choose.start(started())
    assert.ok(isAnswered(first))
    assert.deepEqual(await choose.forget({ decisionId: first.verdict.decisionId }), { gone: true })
    assert.deepEqual(await choose.forget({ decisionId: first.verdict.decisionId }), { gone: false })
    assert.equal(await store.openIn('c1'), null)
  })

  it('sketches the open decision for a long conversation, without the transcript', async () => {
    const choose = new Choose({
      store: new ChooseStore(dir()),
      ask: scripted(laidOutThenWorded('The ThinkPad.')).ask,
      now: () => 5000
    })
    await choose.start(started())
    const got = await choose.sketch('c1')
    assert.ok(got)
    assert.match(got.sketch, /ThinkPad/)
    assert.match(got.sketch, /price/)
    assert.equal(await choose.sketch('nowhere'), null)
  })
})

// ---------------------------------------------------------------- scaffolding used above

function decisionOf(): Decision {
  return {
    id: 'd1',
    v: DECISION_VERSION,
    title: 'A decision',
    question: 'which one?',
    aim: '',
    alternatives: [
      { id: 'a', name: 'A', describe: '', values: { price: { value: 10, origin: 'user-said' } }, upsides: [], downsides: [], origin: 'user-said' },
      { id: 'b', name: 'B', describe: '', values: { price: { value: 20, origin: 'user-said' } }, upsides: [], downsides: [], origin: 'user-said' }
    ],
    criteria: [
      { id: 'price', name: 'price', describe: '', direction: 'less-is-better', importance: 1, scaling: 'min-max', unit: '', origin: 'user-said' }
    ],
    constraints: [],
    preferences: [],
    assumptions: [],
    gaps: [],
    policy: { ...DEFAULT_POLICY },
    conversationId: 'c1',
    saved: false,
    sort: 'other',
    madeAt: 1000,
    changedAt: 1000,
    history: []
  }
}
