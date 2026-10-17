import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessReply, canRetry, strongerModel } from './replyQuality.ts'
import { CHAT_MODELS } from './models.ts'
import type { ModelInfo } from './types.ts'

const ask = (userText: string, extra: { hasAttachments?: boolean; hasPageContext?: boolean } = {}) => ({ userText, ...extra })
const codes = (text: string, userText = 'Explain how a hash map works.', extra = {}): string[] => assessReply(text, ask(userText, extra)).problems.map((p) => p.code)

const LONG = [
  'A hash map stores values under keys by running each key through a hash function, which picks a bucket in an array.',
  'Lookups then go straight to that bucket instead of scanning every entry, which is why they take close to constant time.',
  'Two keys can land in the same bucket, and that collision is handled either by chaining entries together or by probing for a free slot.',
  'As the table fills up its load factor rises, so implementations grow the array and move every entry to its new position.',
  'Good hash functions spread keys evenly, because a bad one piles entries into a few buckets and slows every lookup down.',
  ''
].join(' ')

// ---------- never flag a correct reply ----------

test('short correct answers are fine: length alone is never a problem', () => {
  for (const [q, a] of [
    ['What is 2+2?', '4'],
    ['Is the sky blue?', 'Yes.'],
    ['Capital of France?', 'Paris'],
    ['Say ok', 'OK'],
    ['Yes or no: is 7 prime?', 'No, 7 is prime. Yes.'],
    ['Reply with a single word', 'Done']
  ]) {
    assert.deepEqual(assessReply(a, ask(q)), { ok: true, problems: [] }, a)
  }
})

test('an ordinary complete answer passes', () => {
  assert.equal(assessReply(`${LONG.trim()}`, ask('How do hash maps work?')).ok, true)
})

test('"Sure!" to a can-you question is the whole correct answer', () => {
  assert.equal(assessReply('Sure!', ask('Can you help me with something?')).ok, true)
  assert.equal(assessReply('Of course.', ask('Would you mind helping me?')).ok, true)
})

test('code blocks that close, and repeated code lines, are fine', () => {
  const reply = 'Here is the loop:\n\n```js\nfor (const a of items) {\n  console.log(a);\n}\nfor (const b of items) {\n  console.log(b);\n}\n```\n\nIt prints every item.'
  assert.equal(assessReply(reply, ask('Write a loop')).ok, true)
  const repeatedCode = '```\nconsole.log("hello there");\nconsole.log("hello there");\nconsole.log("hello there");\nconsole.log("hello there");\n```\n'
  assert.equal(assessReply(repeatedCode, ask('print hello 4 times')).ok, true)
})

test('a long reply ending in a list item, a heading, a table or a link is not cut off', () => {
  const listEnd = `${LONG}\n\n- first point of the list without a stop\n- second point of the list without a stop`
  const link = `${LONG}\n\nSee https://example.com/docs/hash-maps/overview-of-the-design`
  const table = `${LONG}\n\n| key | value |\n|---|---|\n| a | one |`
  const numbered = `${LONG}\n\n1. Hash the key\n2. Find the bucket`
  for (const reply of [listEnd, link, table, numbered]) assert.equal(assessReply(reply, ask('x')).ok, true, reply.slice(-40))
})

test('replies ending in a quote, bracket, emoji or digit are complete', () => {
  assert.equal(assessReply(`${LONG}He called it "a very good idea"`, ask('x')).ok, true)
  assert.equal(assessReply(`${LONG}That is all (more or less)`, ask('x')).ok, true)
  assert.equal(assessReply(`${LONG}Hope that helps 🙂`, ask('x')).ok, true)
  assert.equal(assessReply(`${LONG}It was introduced in 1995`, ask('x')).ok, true)
})

test('a short reply with no full stop is not "cut off"', () => {
  assert.equal(assessReply('Use a hash map for that', ask('Which structure?')).ok, true)
  assert.equal(assessReply('Hello there, how can I help today', ask('hi')).ok, true)
})

test('a poem or song may repeat its chorus', () => {
  const song = 'Oh we sing it loud tonight\nVerse one carries on\nOh we sing it loud tonight\nVerse two carries on\nOh we sing it loud tonight\nVerse three carries on.'
  assert.equal(assessReply(song, ask('Write a song with a chorus')).ok, true)
})

test('a refusal to see something is fine when the message needed it', () => {
  const sorry = "I'm sorry, but I can't access that link."
  assert.equal(assessReply(sorry, ask('Summarise https://example.com/post for me')).ok, true)
  assert.equal(assessReply("I can't see your screen.", ask('What is on my screen right now?')).ok, true)
  assert.equal(assessReply("I cannot view images in this chat.", ask('What is in this image?')).ok, true)
  assert.equal(assessReply("I can't access live weather data.", ask('Will it rain tomorrow, weather please?')).ok, true)
})

test('a safety refusal is not a weak reply', () => {
  assert.equal(assessReply("I can't help with that request.", ask('How do I pick someone else\'s lock?')).ok, true)
})

test('a refusal to see is not flagged at all when an attachment or page was given', () => {
  assert.equal(assessReply("I'm unable to access the file you mentioned.", ask('Explain the thing', { hasAttachments: true })).ok, true)
  assert.equal(assessReply("I cannot see the page.", ask('Explain the thing', { hasPageContext: true })).ok, true)
})

// ---------- weak replies ----------

test('empty and whitespace-only replies are weak', () => {
  assert.deepEqual(codes(''), ['empty'])
  assert.deepEqual(codes('   \n\t \n'), ['empty'])
})

test('filler alone is weak, filler with substance is not', () => {
  assert.deepEqual(codes('Sure!', 'Explain how a hash map works.'), ['filler'])
  assert.deepEqual(codes('Certainly. Let me think about that...', 'Explain recursion in detail please'), ['filler'])
  assert.deepEqual(codes('Great question!', 'What is a monad?'), ['filler'])
  assert.deepEqual(codes('Here you go.', 'Write me a haiku about rain'), ['filler'])
  assert.equal(assessReply('Sure! A hash map maps keys to values.', ask('Explain a hash map')).ok, true)
  assert.equal(assessReply('Pressure and ensure are not filler words.', ask('x')).ok, true)
})

test('an unclosed code fence is weak', () => {
  assert.ok(codes('Here is the function:\n\n```ts\nexport function add(a: number, b: number) {\n  return a +').includes('unclosed-code'))
  assert.ok(codes('Text\n```\ncode\n```\nmore\n```\nopened again').includes('unclosed-code'))
})

test('a reply ending on a colon, or an empty list marker, is weak', () => {
  assert.ok(codes('The steps to set this up are as follows:').includes('dangling'))
  assert.ok(codes('The options are:\n\n- speed\n- memory\n-').includes('dangling'))
  assert.ok(codes('Things to check:\n1.').includes('dangling'))
  assert.ok(codes('The steps are:\n\n1. Install it\n2.').includes('dangling'))
})

test('a long reply that stops mid-sentence is weak', () => {
  assert.ok(codes(`${LONG}Collisions are resolved by walking the chain until the key matches, and if the load factor grows too high the table is resized and every entry is`).includes('cut-off'))
})

test('the same line three times is weak; the same sentence three times is weak', () => {
  assert.ok(codes('I will now explain the idea.\nI will now explain the idea.\nI will now explain the idea.').includes('repetition'))
  assert.ok(codes('The answer is forty two and that is final. The answer is forty two and that is final. The answer is forty two and that is final.').includes('repetition'))
})

test('a degenerate loop with no line breaks is weak', () => {
  const loop = `Okay. ${'and then the thing happens again, '.repeat(8)}`
  assert.ok(codes(loop).includes('repetition'))
})

test('two repeats are normal', () => {
  assert.equal(assessReply('Yes, that works. Yes, that works as described.\nThe result is clear enough.\nThe result is clear enough.', ask('x')).ok, true)
})

test('"I cannot access" to a plain question is weak', () => {
  assert.deepEqual(codes("I'm sorry, but I cannot access that information.", 'What is the boiling point of water?'), ['false-refusal'])
  assert.deepEqual(codes("I can't see what you are asking.", 'Why is the sky blue?'), ['false-refusal'])
  assert.deepEqual(codes('I am unable to view that.', 'How many legs does a spider have?'), ['false-refusal'])
})

test('a long answer that happens to mention being unable to access something is not a bare refusal', () => {
  const answer = `${LONG}Note that I cannot access your database, so adjust the table name.`
  assert.equal(assessReply(answer, ask('How do I back up a database?')).ok, true)
})

test('several problems are all reported', () => {
  const found = codes('Here is the code:\n```\nfoo(\n```\n```\nbar(', 'x')
  assert.ok(found.includes('unclosed-code'))
})

test('blank input types do not throw', () => {
  assert.equal(assessReply(undefined as unknown as string, ask('x')).ok, false)
  assert.equal(assessReply('fine.', { userText: undefined as unknown as string }).ok, true)
})

// ---------- choosing the stronger model ----------

const model = (id: string, strengths: ModelInfo['strengths'], extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  label: id,
  description: '',
  reasoningEffort: false,
  echoReasoning: false,
  contextWindow: 100000,
  strengths,
  ...extra
})

test('never the same model, and never the same weights under another name', () => {
  const table = [model('a', ['everyday']), model('b', ['everyday', 'reasoning'], { apiModel: 'a' }), model('c', ['everyday'])]
  const next = strongerModel('a', {}, table)
  assert.equal(next?.id, 'c')
  assert.equal(strongerModel('a', {}, [model('a', ['everyday']), model('b', ['reasoning'], { apiModel: 'a' })]), null)
})

test('prefers a model that reasons, then one for the need, then everyday', () => {
  const table = [model('quick', ['everyday']), model('coder', ['code']), model('thinker', ['reasoning']), model('writer', ['writing'])]
  assert.equal(strongerModel('quick', { need: 'code' }, table)?.id, 'thinker')
  const noThinker = [model('quick', ['everyday']), model('coder', ['code']), model('writer', ['writing'])]
  assert.equal(strongerModel('quick', { need: 'code' }, noThinker)?.id, 'coder')
  assert.equal(strongerModel('coder', {}, [model('coder', ['code']), model('quick', ['everyday'])])?.id, 'quick')
})

test('models that list no strengths are never chosen', () => {
  assert.equal(strongerModel('a', {}, [model('a', ['everyday']), model('mystery', undefined)]), null)
})

test('in the real table a weak ORION Core reply goes to a different, reasoning-capable model', () => {
  const next = strongerModel('openai/gpt-oss-20b', { roomNeeded: 500 })
  assert.ok(next)
  assert.notEqual(next!.id, 'openai/gpt-oss-20b')
  assert.ok(next!.strengths!.includes('reasoning'))
  assert.ok(CHAT_MODELS.some((m) => m.id === next!.id))
})

test('in the real table the strongest model is never retried on itself', () => {
  for (const m of CHAT_MODELS) {
    const next = strongerModel(m.id, { roomNeeded: 100 })
    if (next) {
      assert.notEqual(next.id, m.id)
      assert.notEqual(next.apiModel ?? next.id, m.apiModel ?? m.id)
    }
  }
})

test('a message with a picture, or one that was stopped, is not retried', () => {
  assert.equal(canRetry({ hasImages: true, aborted: false }), false)
  assert.equal(canRetry({ hasImages: false, aborted: true }), false)
  assert.equal(canRetry({ hasImages: false, aborted: false }), true)
})
