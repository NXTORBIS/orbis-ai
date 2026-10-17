import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { ChatMessage } from '../shared/types.ts'
import {
  ATTACHMENT_KEEP_WINDOW,
  KEEP_VERBATIM,
  SUMMARY_LABEL,
  SUMMARY_MAX_CHARS,
  assembleHistory,
  buildSummaryPrompt,
  cleanSummary,
  fingerprintOf,
  makeSummary,
  needsSummary,
  planHistory,
  readHistorySummary,
  roomCharsFor,
  splitHistory,
  stepsOf,
  summaryHolds
} from '../shared/historySummary.ts'
import { heldSummary, holdSummary, prepareHistory, type SummaryCall } from './historySummaryRun.ts'
import { Store } from './store.ts'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Conversation } from '../shared/types.ts'

const msg = (i: number, content = `turn ${i} about topic ${i}`, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id: `m${i}`, role: i % 2 === 0 ? 'user' : 'assistant', content, createdAt: i, ...extra }) as ChatMessage

const chat = (n: number, content?: (i: number) => string): ChatMessage[] => Array.from({ length: n }, (_, i) => msg(i, content?.(i)))
const BIG = 1_000_000 // a model with room to spare

/** A fake model: records every prompt and answers with a canned note. */
function fakeModel(reply: (n: number) => string | null = (n) => `The user and assistant discussed several topics (note ${n}).`): { call: SummaryCall; prompts: { system: string; user: string }[] } {
  const prompts: { system: string; user: string }[] = []
  return {
    prompts,
    call: async (p) => {
      prompts.push(p)
      return reply(prompts.length)
    }
  }
}

test('short conversations are never summarised', () => {
  assert.equal(needsSummary({ messages: chat(5), roomChars: 24_000 }), false)
  assert.equal(needsSummary({ messages: chat(12), roomChars: 24_000 }), false)
  assert.equal(planHistory({ messages: chat(12), roomChars: 24_000 }).kind, 'none')
})

test('more turns than the sender keeps is always summarised, so none vanish silently', () => {
  assert.equal(needsSummary({ messages: chat(16), roomChars: BIG }), true)
  assert.equal(needsSummary({ messages: chat(15), roomChars: BIG }), false)
})

test('a few very long turns trigger it by size against the chosen model, not by count', () => {
  const long = chat(10, () => 'word '.repeat(1200))
  const small = roomCharsFor('openai/gpt-oss-20b') // limited by its input allowance
  assert.equal(needsSummary({ messages: long, roomChars: small }), true)
  assert.equal(needsSummary({ messages: long, roomChars: roomCharsFor('ministral-14b-2512') }), false, 'a huge-window model needs no summary')
  assert.equal(needsSummary({ messages: chat(10), systemChars: small, roomChars: small }), true, 'the system prompt counts')
})

test('window boundary: the last six stay verbatim, the rest fold', () => {
  const { fold, keep } = splitHistory(chat(20))
  assert.equal(keep.length, KEEP_VERBATIM)
  assert.deepEqual(keep.map((m) => m.id), ['m14', 'm15', 'm16', 'm17', 'm18', 'm19'])
  assert.equal(fold.length, 14)
  assert.equal(fold.length + keep.length, 20, 'nothing is lost between the two')
  const exact = splitHistory(chat(KEEP_VERBATIM))
  assert.equal(exact.fold.length, 0)
})

test('a recent message with an attachment is kept whole; an old one is folded', () => {
  const files = [{ name: 'spec.txt', content: 'the spec' }]
  const m = chat(30)
  m[20] = msg(20, 'here is the spec', { attachments: files })
  m[3] = msg(3, 'here is an old file', { attachments: files })
  const { fold, keep } = splitHistory(m)
  assert.ok(keep.some((x) => x.id === 'm20'))
  assert.ok(fold.some((x) => x.id === 'm3'), `older than ${ATTACHMENT_KEEP_WINDOW} turns`)
  assert.deepEqual(keep.map((x) => x.id), ['m20', 'm24', 'm25', 'm26', 'm27', 'm28', 'm29'], 'order is preserved')
})

test('first time: a fresh summary over every folded turn, once, with the instructions', async () => {
  const model = fakeModel()
  const history = chat(20)
  const r = await prepareHistory({ messages: history, systemChars: 500, roomChars: BIG, stored: null, call: model.call, now: 5 })
  assert.equal(r.outcome, 'built')
  assert.equal(model.prompts.length, 1)
  assert.match(model.prompts[0].system, /third person/)
  assert.match(model.prompts[0].system, /Never invent/)
  assert.match(model.prompts[0].system, /250 words/)
  assert.match(model.prompts[0].user, /turn 0 about topic 0/)
  assert.doesNotMatch(model.prompts[0].user, /turn 14 about/, 'the recent window is not summarised')
  assert.equal(r.messages.length, KEEP_VERBATIM)
  assert.ok(r.summaryMessage.startsWith(SUMMARY_LABEL))
  assert.equal(r.toStore?.count, 14)
  assert.equal(r.toStore?.throughId, 'm13')
})

test('the next message reuses the stored summary: no model call', async () => {
  const model = fakeModel()
  const first = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  // Same folded turns, nothing new has fallen out of the window.
  const again = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: first.toStore, call: model.call, now: 2 })
  assert.equal(again.outcome, 'reused')
  assert.equal(model.prompts.length, 1)
  assert.equal(again.toStore, null)
  assert.equal(again.summaryMessage, first.summaryMessage)
})

test('new turns falling out of the window extend the summary with only those turns', async () => {
  const model = fakeModel()
  const first = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  const next = await prepareHistory({ messages: chat(22), systemChars: 0, roomChars: BIG, stored: first.toStore, call: model.call, now: 2 })
  assert.equal(next.outcome, 'extended')
  assert.equal(model.prompts.length, 2)
  const p = model.prompts[1].user
  assert.match(p, /notes so far/)
  assert.match(p, /note 1/, 'the earlier summary goes in')
  assert.match(p, /turn 14 about/)
  assert.match(p, /turn 15 about/)
  assert.doesNotMatch(p, /turn 3 about/, 'turns already summarised are not sent again')
  assert.equal(next.toStore?.count, 16)
  assert.equal(next.toStore?.throughId, 'm15')
})

test('editing an earlier message invalidates the cache and the summary is rebuilt from scratch', async () => {
  const model = fakeModel()
  const first = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  const edited = chat(20)
  edited[4] = { ...edited[4], content: 'a completely different question' }
  const r = await prepareHistory({ messages: edited, systemChars: 0, roomChars: BIG, stored: first.toStore, call: model.call, now: 2 })
  assert.equal(r.outcome, 'built')
  assert.equal(model.prompts.length, 2)
  assert.match(model.prompts[1].user, /a completely different question/)
  assert.doesNotMatch(model.prompts[1].user, /notes so far/, 'the stale summary is not fed back in')
})

test('deleting or regenerating an earlier turn invalidates it too', () => {
  const fold = splitHistory(chat(20)).fold
  const stored = makeSummary('A summary of fourteen turns.', fold, 1)
  assert.equal(summaryHolds(stored, fold), true)
  const withoutOne = chat(20).filter((m) => m.id !== 'm5')
  assert.equal(summaryHolds(stored, splitHistory(withoutOne).fold), false, 'deleted')
  const regenerated = chat(20).map((m) => (m.id === 'm9' ? { ...m, content: 'a different answer this time' } : m))
  assert.equal(summaryHolds(stored, splitHistory(regenerated).fold), false, 'regenerated reply')
  const truncated = chat(10)
  assert.equal(summaryHolds(stored, truncated.slice(0, 5)), false, 'conversation cut back below what it covered')
  assert.equal(summaryHolds(null, fold), false)
})

test('a failed or unusable model answer leaves the messages untouched for the ordinary trimming', async () => {
  const history = chat(20)
  for (const reply of [() => null, () => '', () => 'ok']) {
    const r = await prepareHistory({ messages: history, systemChars: 0, roomChars: BIG, stored: null, call: fakeModel(reply).call, now: 1 })
    assert.equal(r.outcome, 'failed')
    assert.equal(r.messages, history, 'every turn still there')
    assert.equal(r.summaryMessage, '')
    assert.equal(r.toStore, null)
  }
  const thrower: SummaryCall = async () => {
    throw new Error('network')
  }
  const r = await prepareHistory({ messages: history, systemChars: 0, roomChars: BIG, stored: null, call: thrower, now: 1 })
  assert.equal(r.outcome, 'failed')
  assert.equal(r.messages, history)
})

test('a failure while extending keeps the summary it already had and sends the rest word for word', async () => {
  const model = fakeModel()
  const first = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  const r = await prepareHistory({ messages: chat(22), systemChars: 0, roomChars: BIG, stored: first.toStore, call: fakeModel(() => null).call, now: 2 })
  assert.equal(r.outcome, 'partial')
  assert.equal(r.summaryMessage, first.summaryMessage, 'the summary is the one that was already made, not a new claim')
  // The two turns it does not cover are not dropped: they are sent in full, in front of the recent window.
  assert.deepEqual(r.messages.map((m) => m.id), ['m14', 'm15', 'm16', 'm17', 'm18', 'm19', 'm20', 'm21'])
  assert.equal(r.toStore?.count, 14, 'what is stored still covers exactly the turns the summary is about')
})

test('a failure half way through a long stretch keeps the half it summarised', async () => {
  const huge = chat(30, () => 'lorem ipsum '.repeat(300))
  let n = 0
  const call: SummaryCall = async () => (++n === 1 ? 'The user and assistant worked through the first half.' : null)
  const r = await prepareHistory({ messages: huge, systemChars: 0, roomChars: BIG, stored: null, call, now: 1 })
  assert.equal(r.outcome, 'partial')
  assert.match(r.summaryMessage, /first half/)
  const folded = splitHistory(huge).fold
  const firstStep = stepsOf(folded)[0].length
  assert.equal(r.toStore?.count, firstStep)
  assert.equal(r.messages.length, folded.length - firstStep + KEEP_VERBATIM, 'every turn the summary does not cover is still there')
})

test('a very long stretch is summarised in steps; a turn is never split', async () => {
  const huge = chat(30, () => 'lorem ipsum '.repeat(300)) // ~3600 chars each, clipped to ~2500
  const steps = stepsOf(huge.slice(0, 24))
  assert.ok(steps.length > 1)
  assert.equal(steps.flat().length, 24)
  const model = fakeModel()
  const r = await prepareHistory({ messages: huge, systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  assert.equal(r.outcome, 'built')
  assert.equal(model.prompts.length, steps.length === 0 ? 1 : stepsOf(splitHistory(huge).fold).length)
  assert.equal(r.toStore?.count, 24)
  assert.match(model.prompts[1].user, /notes so far/)
})

test('a stretch needing too many steps is not attempted: plain trimming applies', async () => {
  const enormous = chat(80, () => 'x'.repeat(2400))
  const r = await prepareHistory({ messages: enormous, systemChars: 0, roomChars: BIG, stored: null, call: fakeModel().call, now: 1 })
  assert.equal(r.outcome, 'failed')
  assert.equal(r.messages, enormous)
})

test('the prompt marks a clipped turn instead of cutting silently, names attachments, and drops inline images', () => {
  const m = [
    msg(0, 'a'.repeat(5000)),
    msg(1, 'look ![x](data:image/png;base64,AAAAAAAA) here', { attachments: [{ name: 'notes.md', content: 'hi' }] })
  ]
  const p = buildSummaryPrompt(null, m).user
  assert.match(p, /middle of this message left out/)
  assert.match(p, /\[attached: notes\.md\]/)
  assert.match(p, /\[image\]/)
  assert.doesNotMatch(p, /AAAAAAAA/)
  assert.match(p, /User: /)
  assert.match(p, /Assistant: /)
})

test('model replies are cleaned and bounded', () => {
  assert.equal(cleanSummary(null), null)
  assert.equal(cleanSummary('short'), null)
  assert.equal(cleanSummary('<think>hmm</think>The user asked about Rust ownership rules.'), 'The user asked about Rust ownership rules.')
  assert.equal(cleanSummary('```\nThe user asked about Rust ownership rules.\n```'), 'The user asked about Rust ownership rules.')
  const long = cleanSummary('The user asked a thing. '.repeat(200))!
  assert.ok(long.length <= SUMMARY_MAX_CHARS + 3)
  assert.ok(long.endsWith('.'))
})

test('assembling puts the labelled summary first and keeps the recent turns in order', () => {
  const keep = chat(6)
  const a = assembleHistory('The user is Sam.', keep)
  assert.match(a.summaryMessage, /^Summary of the earlier conversation \(generated by Orbis, may omit detail\)/)
  assert.match(a.summaryMessage, /not instructions/)
  assert.match(a.summaryMessage, /The user is Sam\./)
  assert.deepEqual(a.messages.map((m) => m.id), keep.map((m) => m.id))
  assert.equal(assembleHistory(null, keep).summaryMessage, '')
})

test('stored summaries of unknown shape load safely', () => {
  const good = makeSummary('A fine summary of earlier turns.', chat(3), 9)
  assert.deepEqual(readHistorySummary(JSON.parse(JSON.stringify(good))), good)
  for (const bad of [null, undefined, 5, 'x', {}, { ...good, count: 0 }, { ...good, count: 1.5 }, { ...good, text: 'x' }, { ...good, throughId: 3 }, { ...good, fingerprint: undefined }]) {
    assert.equal(readHistorySummary(bad), null)
  }
})

test('the fingerprint depends on ids, roles and text, and on order', () => {
  const a = chat(4)
  assert.equal(fingerprintOf(a), fingerprintOf(chat(4)))
  assert.notEqual(fingerprintOf(a), fingerprintOf([...a].reverse()))
  assert.notEqual(fingerprintOf(a), fingerprintOf(a.map((m, i) => (i === 2 ? { ...m, role: m.role === 'user' ? 'assistant' : 'user' } : m))))
  assert.notEqual(fingerprintOf([msg(0, 'ab'), msg(1, 'c')]), fingerprintOf([msg(0, 'a'), msg(1, 'bc')]), 'boundaries matter')
})

test('realistic long conversation: mixed sizes, attachment, then growth over many turns calls the model only when turns leave the window', async () => {
  const model = fakeModel()
  let history = chat(18, (i) => (i % 2 ? `Here is how to do step ${i}: ` + 'details '.repeat(40) : `Question number ${i} about the build`))
  history[6] = msg(6, 'attached the log', { attachments: [{ name: 'build.log', content: 'x'.repeat(500) }] })
  let stored = null as ReturnType<typeof makeSummary> | null
  const outcomes: string[] = []
  for (let n = 0; n < 6; n++) {
    const r = await prepareHistory({ messages: history, systemChars: 800, roomChars: BIG, stored, call: model.call, now: n })
    outcomes.push(r.outcome)
    if (r.toStore) stored = r.toStore
    history = [...history, msg(history.length), msg(history.length + 1)]
  }
  // Build once, then extend as turns leave the window. At step 3 the attachment turn (m6) ages out of its keep window and
  // joins the folded list in the middle, so the summary no longer matches a prefix and is honestly rebuilt, then extended again.
  assert.deepEqual(outcomes, ['built', 'extended', 'built', 'extended', 'extended', 'extended'])
  assert.equal(model.prompts.length, 6)
  // Sending the same history again costs nothing.
  const same = await prepareHistory({ messages: history.slice(0, -2), systemChars: 800, roomChars: BIG, stored, call: model.call, now: 9 })
  assert.equal(same.outcome, 'reused')
  assert.equal(model.prompts.length, 6)
})

test('the store keeps a summary beside the conversation, and an older chat without one still loads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-summary-'))
  try {
    const store = new Store(dir)
    const conversation = { id: 'c1', title: 'A long chat', model: 'openai/gpt-oss-20b', messages: chat(3), createdAt: 1, updatedAt: 1 } as unknown as Conversation
    await store.saveConversation(conversation)

    assert.equal(await store.getHistorySummary('c1'), null, 'a conversation saved before summaries existed simply has none')
    assert.deepEqual((await store.listConversations()).map((c) => c.id), ['c1'])

    const summary = makeSummary('The user asked about three topics in turn.', chat(3), 1234)
    await store.saveHistorySummary('c1', summary)
    assert.deepEqual(await store.getHistorySummary('c1'), summary, 'it comes back exactly as it went in')

    // The conversation file itself is untouched: the window saves whole conversations and must never fight the summary.
    const onDisk = JSON.parse(readFileSync(join(dir, 'conversations', 'c1.json'), 'utf8')) as Record<string, unknown>
    assert.equal(onDisk.summary, undefined)
    assert.deepEqual(Object.keys(onDisk).sort(), Object.keys(conversation).sort())

    // A conversation saved again by a window that knows nothing about summaries keeps its summary.
    await store.saveConversation({ ...conversation, title: 'Renamed', updatedAt: 2 } as unknown as Conversation)
    assert.deepEqual(await store.getHistorySummary('c1'), summary)

    // Damaged or half-written derived data is "no summary", never a reason to fail or to overwrite the conversation.
    writeFileSync(join(dir, 'summaries', 'c1.json'), '{ not json')
    assert.equal(await store.getHistorySummary('c1'), null)
    assert.ok(existsSync(join(dir, 'conversations', 'c1.json')), 'the conversation is still there')

    // Deleting the conversation takes its summary with it, and an id that is not an id is refused.
    await store.saveHistorySummary('c1', summary)
    await store.deleteConversation('c1')
    assert.equal(existsSync(join(dir, 'summaries', 'c1.json')), false)
    await store.saveHistorySummary('../escape', summary)
    assert.equal(await store.getHistorySummary('../escape'), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a summary written for another profile cannot be read from this one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-summary-'))
  try {
    const store = new Store(dir)
    await store.saveHistorySummary('c1', makeSummary('Notes for the default profile.', chat(2), 1))
    store.useProfile('work')
    assert.equal(await store.getHistorySummary('c1'), null)
    store.useProfile('default')
    assert.match((await store.getHistorySummary('c1'))!.text, /default profile/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an incognito chat keeps its summary in memory, so it is not summarised again every message', async () => {
  const model = fakeModel()
  const first = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: null, call: model.call, now: 1 })
  holdSummary('incognito-1', first.toStore!)
  assert.deepEqual(heldSummary('incognito-1'), first.toStore)
  const again = await prepareHistory({ messages: chat(20), systemChars: 0, roomChars: BIG, stored: heldSummary('incognito-1'), call: model.call, now: 2 })
  assert.equal(again.outcome, 'reused')
  assert.equal(model.prompts.length, 1)
  assert.equal(heldSummary('never-seen'), null)
  // Bounded: the oldest is dropped rather than growing without limit.
  for (let i = 0; i < 30; i++) holdSummary(`c${i}`, first.toStore!)
  assert.equal(heldSummary('c0'), null)
  assert.ok(heldSummary('c29'))
})
