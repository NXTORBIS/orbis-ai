import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addSources,
  addTurn,
  buildAsk,
  changesTopic,
  constraintIn,
  entitiesIn,
  isFollowUp,
  newSearchSession,
  referencedItems,
  rememberEntities,
  sessionTitle,
  wantsFreshResearch,
  withConstraint,
  withTopic
} from '../shared/orionSearch.ts'
import type { OrionSearchSession } from '../shared/orionSearch'
import type { SearchResult } from '../shared/orbisSearch'

const result = (title: string, site: string, snippet = ''): SearchResult => ({ title, url: `https://${site}/${title.toLowerCase().replace(/\s+/g, '-')}`, site, snippet })

/** A session a few questions deep, the way one actually gets. */
function sessionWith(questions: { q: string; a: string; results?: SearchResult[] }[]): OrionSearchSession {
  let session = newSearchSession('default', questions[0]?.q ?? 'topic', 1000)
  questions.forEach((turn, i) => {
    if (turn.results) {
      const { sources } = addSources(session, turn.results, i)
      session = { ...session, sources }
    }
    session = addTurn(session, { id: `t${i}`, question: turn.q, answer: turn.a, used: [], researched: Boolean(turn.results), at: 1000 + i }, 1000 + i)
  })
  return session
}

test('a question with nothing behind it is never treated as a follow-up', () => {
  const empty = newSearchSession('default', '', 1000)
  // "Why?" as the first thing typed is a question about nothing; pretending otherwise invents a context.
  for (const question of ['why?', 'compare them', 'what about price', 'tell me more']) {
    assert.equal(isFollowUp(question, empty), false, question)
    assert.equal(isFollowUp(question, null), false, question)
  }
})

test('once there is something behind it, a follow-up is recognised as one', () => {
  const session = sessionWith([{ q: 'Research electric cars', a: 'Several makers build them.' }])
  for (const question of ['why?', 'which has the longest range?', 'what about price', 'compare them', 'tell me more', 'explain that', 'what about India']) {
    assert.equal(isFollowUp(question, session), true, question)
  }
  // A question that stands on its own is a new question, not a continuation.
  assert.equal(isFollowUp('how does a heat pump work in an old house', session), false)
  assert.equal(isFollowUp('github.com', session), false, 'an address is not a follow-up')
})

test('asking about how things are now asks for the web again', () => {
  for (const question of ['what is the latest?', 'current price?', 'anything new today?', 'is it available now', 'has that changed', 'recent news', 'what does it cost']) {
    assert.equal(wantsFreshResearch(question), true, question)
  }
  for (const question of ['why is it built that way', 'explain the second one', 'compare them']) {
    assert.equal(wantsFreshResearch(question), false, question)
  }
})

test('"the third one" means the third one, and the fifth of four means nothing', () => {
  assert.deepEqual(referencedItems('tell me more about the third one', 5), [2])
  assert.deepEqual(referencedItems('compare the first two', 5), [0, 1])
  assert.deepEqual(referencedItems('what does source 4 say', 5), [3])
  assert.deepEqual(referencedItems('what about the last one', 5), [4])
  assert.deepEqual(referencedItems('compare both', 5), [0, 1])
  assert.deepEqual(referencedItems('what about the fifth one', 4), [], 'a source that was never found is pointed at by nothing')
  assert.deepEqual(referencedItems('tell me more', 5), [])
  assert.deepEqual(referencedItems('anything', 0), [])
})

test('a condition is kept, and stays kept', () => {
  assert.equal(constraintIn('under 80,000'), 'under 80,000')
  assert.equal(constraintIn('only Windows'), 'only Windows')
  assert.equal(constraintIn('in India'), 'in India')
  assert.equal(constraintIn('which one has the best screen for watching films on a long flight'), null, 'a whole question is not a condition')
  assert.equal(constraintIn(''), null)

  let session = newSearchSession('default', 'laptops', 1000)
  session = withConstraint(session, 'under 80,000')
  session = withConstraint(session, '16GB RAM')
  session = withConstraint(session, 'under 80,000')
  assert.deepEqual(session.constraints, ['16GB RAM', 'under 80,000'], 'saying one again moves it, rather than repeating it')
})

test('changing the subject leaves the old conditions behind', () => {
  assert.equal(changesTopic('actually, forget laptops. search for tablets instead'), true)
  assert.equal(changesTopic('never mind, different topic'), true)
  assert.equal(changesTopic('which is cheaper'), false)

  let session = withConstraint(newSearchSession('default', 'laptops', 1000), 'under 80,000')
  session = { ...session, entities: ['Dell', 'Lenovo'] }
  const after = withTopic(session, 'tablets')
  assert.equal(after.topic, 'tablets')
  assert.deepEqual(after.constraints, [], 'the old conditions were about something else')
  assert.deepEqual(after.entities, [])
})

test('the things being talked about are remembered, so they need not be said again', () => {
  const found = entitiesIn('Compare NVIDIA and AMD graphics cards, especially the RTX 4090')
  assert.ok(found.includes('NVIDIA'), found.join(', '))
  assert.ok(found.includes('AMD'))
  assert.ok(found.some((e) => e.includes('4090')))
  // Ordinary words are not treated as things.
  assert.ok(!entitiesIn('Which is cheaper and why').some((e) => ['Which', 'Why', 'And'].includes(e)))

  let session = newSearchSession('default', 'graphics cards', 1000)
  session = addTurn(session, { id: 't1', question: 'Compare NVIDIA and AMD', answer: 'Both make cards.', used: [], researched: true, at: 1001 })
  assert.ok(session.entities.includes('NVIDIA') && session.entities.includes('AMD'))
  // The list does not grow without limit.
  assert.ok(rememberEntities(session, 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi').length <= 12)
})

test('sources are numbered once and keep their numbers all session', () => {
  const session = newSearchSession('default', 'cars', 1000)
  const first = addSources(session, [result('Tesla', 'tesla.com'), result('BYD', 'byd.com')], 0)
  assert.deepEqual(first.added, [0, 1])

  const withFirst = { ...session, sources: first.sources }
  // The same page found again keeps the number it already had, so a citation never shifts under the user.
  const second = addSources(withFirst, [result('BYD', 'byd.com'), result('Rivian', 'rivian.com')], 1)
  assert.deepEqual(second.added, [1, 2])
  assert.equal(second.sources.length, 3)
  assert.equal(second.sources[1].site, 'byd.com')
})

test('what Orion is told carries the session, not the whole of it', () => {
  const session = sessionWith([
    { q: 'Research electric cars', a: 'Several makers build them.', results: [result('Tesla Model 3', 'tesla.com', 'Range 600km'), result('BYD Seal', 'byd.com', 'Range 570km')] },
    { q: 'Which has the longest range?', a: 'The Tesla, at 600km [1].' },
    { q: 'What about price?', a: 'The BYD is cheaper [2].' }
  ])
  const withRules = withConstraint({ ...session, topic: 'electric cars' }, 'under 40,000')

  const ask = buildAsk(withRules, 'compare the first two')
  assert.match(ask.prompt, /about: electric cars/)
  assert.match(ask.prompt, /Conditions the user has set[^\n]*under 40,000/)
  assert.match(ask.prompt, /Which has the longest range\?/, 'the recent exchanges are there')
  assert.match(ask.prompt, /\[1\] Tesla Model 3/)
  assert.match(ask.prompt, /points at \[1\] and \[2\]/)
  assert.deepEqual(ask.offered, [0, 1])
  assert.match(ask.prompt, /search session, not a chat/)
  assert.match(ask.prompt, /Never claim to remember something that is not written above/)
})

test('a long session does not send everything every time', () => {
  let session = newSearchSession('default', 'laptops', 1000)
  const many: SearchResult[] = []
  for (let i = 0; i < 30; i++) many.push(result(`Laptop ${i}`, `site${i}.example`, 'x'.repeat(400)))
  session = { ...session, sources: addSources(session, many, 0).sources }
  for (let i = 0; i < 12; i++) {
    session = addTurn(session, { id: `t${i}`, question: `Question number ${i} about something`, answer: 'y'.repeat(900), used: [], researched: false, at: 1000 + i })
  }

  const ask = buildAsk(session, 'which is cheapest')
  assert.ok(ask.offered.length <= 8, `offered ${ask.offered.length} sources`)
  assert.ok(!ask.prompt.includes('Question number 3'), 'the distant past is left out')
  assert.match(ask.prompt, /Question number 11/, 'the recent past is not')
  assert.ok(ask.prompt.length < 12_000, `the prompt stays a prompt (${ask.prompt.length})`)
})

test('a question about how things are now is marked as needing the web again', () => {
  const session = sessionWith([{ q: 'Research electric cars', a: 'Several makers.' }])
  assert.equal(buildAsk(session, 'check the current prices').fresh, true)
  assert.equal(buildAsk(session, 'why is that').fresh, false)
  assert.equal(buildAsk(session, 'why is that', { fresh: true }).fresh, true, 'and can be asked for outright')
})

test('a session with no sources still answers, and says it has none', () => {
  const session = sessionWith([{ q: 'Research something obscure', a: 'Nothing came back.' }])
  const ask = buildAsk(session, 'tell me more')
  assert.deepEqual(ask.offered, [])
  assert.ok(!ask.prompt.includes('Sources found in this session'), 'no sources means no list of them')
  assert.match(ask.prompt, /If the sources do not answer it, say so plainly/)
})

test('a session belongs to one profile and is named after what it is about', () => {
  const session = newSearchSession('work', 'Research the latest AI chips', 1000)
  assert.equal(session.profileId, 'work')
  assert.equal(sessionTitle(session), 'Research the latest AI chips')
  assert.notEqual(newSearchSession('work', 'a', 1000).id, newSearchSession('work', 'a', 1000).id, 'two sessions are two sessions')
})

test('nothing in a session comes from Orbis Chat', () => {
  // The only way anything enters a session is through its own turns and its own sources; there is no other door.
  const session = sessionWith([{ q: 'Research electric cars', a: 'Several makers build them.', results: [result('Tesla', 'tesla.com', 'Range 600km')] }])
  const ask = buildAsk(session, 'which is best')
  const everything = JSON.stringify(session) + ask.prompt
  assert.ok(!/conversation|chat history|messages/i.test(everything), 'a session has no notion of a chat at all')
  assert.ok(ask.prompt.includes('Tesla'), 'only what this session found')
})
