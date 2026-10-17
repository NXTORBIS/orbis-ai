import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acceptRevision, buildRevisionPrompt, citedNumbers, needsRevision, unsupportedClaims } from './researchVerify.ts'

const SOURCES = [
  {
    n: 1,
    title: 'Heat pump basics',
    url: 'https://energy.example.gov/heat-pumps',
    excerpt:
      'A heat pump moves heat from outside air into a building instead of generating heat by burning fuel. Modern air source heat pumps work in outdoor temperatures down to minus 25 degrees. Installation typically costs between 4000 and 8000 dollars.'
  },
  {
    n: 2,
    title: 'Efficiency report',
    url: 'https://reports.example.org/efficiency',
    excerpt:
      'Heat pumps deliver about three units of heat for every unit of electricity they use. Efficiency drops as the outdoor temperature falls. Ground source systems stay more efficient in winter than air source systems.'
  }
]

const DRAFT = [
  'A heat pump moves heat from outside air into a building rather than burning fuel [1].',
  'Modern air source heat pumps work in outdoor temperatures down to minus 25 degrees [1].',
  'They deliver about three units of heat for every unit of electricity they use [2].',
  'The government pays half of every installation bill for homeowners in all regions [1].'
].join(' ')

test('citedNumbers reads single and grouped citations once each', () => {
  assert.deepEqual(citedNumbers('A [1]. B [2, 3]. C [1]. D [4 ,5].'), [1, 2, 3, 4, 5])
  assert.deepEqual(citedNumbers('no citations here, just [a] and (1)'), [])
})

test('the unsupported claim in the draft is found and the supported ones are not', () => {
  const found = unsupportedClaims(DRAFT, SOURCES)
  assert.equal(found.length, 1)
  assert.match(found[0].claim, /government pays half/)
  assert.equal(needsRevision(DRAFT, SOURCES), true)
})

test('a fully supported answer needs no revision, and neither does one with no sources', () => {
  const clean = DRAFT.split(' [1]. ').slice(0, 2).join(' [1]. ') + ' [1].'
  assert.equal(needsRevision(clean, SOURCES), false)
  assert.equal(needsRevision(DRAFT, []), false)
  assert.equal(needsRevision('An answer with no citations at all, only a plain claim about heat pumps.', SOURCES), false)
})

test('the prompt carries the rules, the claims, the sources and the draft, and only the cited sources', () => {
  const only1 = 'A heat pump moves heat from outside air into a building rather than burning fuel [1].'
  const claims = unsupportedClaims(only1 + ' The government pays half of every installation bill for homeowners [1].', SOURCES)
  const { system, user } = buildRevisionPrompt({ question: 'How do heat pumps work?', draft: only1, sources: SOURCES, claims })
  assert.match(system, /editor/)
  assert.match(user, /supported by the source it cites/)
  assert.match(user, /Do not add any new facts/)
  assert.match(user, /same language/)
  assert.match(user, /\[1\] Heat pump basics/)
  assert.ok(!user.includes('Efficiency report'), 'source 2 is not cited so it is not sent')
  assert.match(user, /government pays half/)
  assert.match(user, /QUESTION:\nHow do heat pumps work\?/)
  assert.match(user, /DRAFT ANSWER:\nA heat pump moves heat/)
})

test('a very long draft and long sources are clipped to a budget', () => {
  const big = [{ n: 1, excerpt: 'Word. '.repeat(20000) }]
  const draft = 'A long claim about the topic that is cited here [1]. '.repeat(1000)
  const { user } = buildRevisionPrompt({ question: 'q', draft, sources: big, claims: [] })
  assert.ok(user.length < 25000, String(user.length))
})

// ---------- acceptance ----------

const GOOD_REVISION = [
  'A heat pump moves heat from outside air into a building rather than burning fuel [1].',
  'Modern air source heat pumps work in outdoor temperatures down to minus 25 degrees [1].',
  'They deliver about three units of heat for every unit of electricity they use [2].'
].join(' ')

test('a rewrite that drops the unsupported claim is accepted', () => {
  const verdict = acceptRevision({ draft: DRAFT, revision: GOOD_REVISION, sources: SOURCES })
  assert.equal(verdict.accept, true, verdict.reason)
  assert.equal(verdict.before, 1)
  assert.equal(verdict.after, 0)
})

test('a rewrite that softens the claim to what the source says is accepted', () => {
  const softened = GOOD_REVISION + ' Installation typically costs between 4000 and 8000 dollars [1].'
  assert.equal(acceptRevision({ draft: DRAFT, revision: softened, sources: SOURCES }).accept, true)
})

test('an empty, identical or code-wrapped rewrite is rejected', () => {
  assert.equal(acceptRevision({ draft: DRAFT, revision: '   ', sources: SOURCES }).accept, false)
  assert.equal(acceptRevision({ draft: DRAFT, revision: DRAFT, sources: SOURCES }).accept, false)
  assert.equal(acceptRevision({ draft: DRAFT, revision: '```\n' + GOOD_REVISION + '\n```', sources: SOURCES }).accept, false)
})

test('a rewrite that deletes nearly everything is rejected', () => {
  const verdict = acceptRevision({ draft: DRAFT, revision: 'Heat pumps move heat [1].', sources: SOURCES })
  assert.equal(verdict.accept, false)
  assert.match(verdict.reason, /dropped most/)
})

test('a rewrite citing a source that does not exist is rejected', () => {
  const sneaky = GOOD_REVISION.replace('burning fuel [1]', 'burning fuel [7]')
  const verdict = acceptRevision({ draft: DRAFT, revision: sneaky, sources: SOURCES })
  assert.equal(verdict.accept, false)
  assert.match(verdict.reason, /source 7/)
})

test('a rewrite that brings in a new figure is rejected, one using figures from the draft or sources is not', () => {
  const invented = GOOD_REVISION + ' Most households save 1200 dollars a year [2].'
  const verdict = acceptRevision({ draft: DRAFT, revision: invented, sources: SOURCES })
  assert.equal(verdict.accept, false)
  assert.match(verdict.reason, /1200/)
  const fromSource = GOOD_REVISION + ' Installation typically costs between 4,000 and 8000 dollars [1].'
  assert.equal(acceptRevision({ draft: DRAFT, revision: fromSource, sources: SOURCES }).accept, true)
})

test('a rewrite that is no better supported is rejected', () => {
  const same = GOOD_REVISION + ' The government pays half of every installation bill for homeowners in every single region [1].'
  const verdict = acceptRevision({ draft: DRAFT, revision: same, sources: SOURCES })
  assert.equal(verdict.accept, false)
  assert.match(verdict.reason, /not better/)
})

test('list numbers and citation marks are not mistaken for new figures', () => {
  const draft = 'Here is the summary of what the sources say:\n1. A heat pump moves heat from outside air into a building rather than burning fuel [1].\n2. The government pays half of every installation bill for homeowners [1].'
  const revision = 'Here is the summary of what the sources say:\n1. A heat pump moves heat from outside air into a building rather than burning fuel [1].\n2. Installation typically costs between 4000 and 8000 dollars [1].'
  const verdict = acceptRevision({ draft, revision, sources: SOURCES })
  assert.equal(verdict.accept, true, verdict.reason)
})
