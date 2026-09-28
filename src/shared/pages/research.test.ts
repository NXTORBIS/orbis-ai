import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  RESEARCH_ASSUMPTIONS,
  assessClaim,
  assessFinding,
  checkScope,
  checkSource,
  contradictions,
  findGaps,
  health,
  isResearchError,
  link,
  type Claim,
  type Evidence,
  type Question,
  type Scope,
  type Source
} from './research.ts'

const source = (id: string, options: Partial<Source> = {}): Source => ({
  id,
  kind: options.kind ?? 'paper',
  title: options.title ?? `Paper ${id}`,
  authors: options.authors ?? ['Rao, S.'],
  publisher: options.publisher ?? 'A Journal',
  year: options.year ?? '2024',
  url: options.url ?? '',
  accessedAt: options.accessedAt ?? '2026-01-01',
  access: options.access ?? 'read',
  foundVia: options.foundVia ?? 'search',
  tags: options.tags ?? [],
  notes: options.notes ?? ''
})

const claim = (id: string, options: Partial<Claim> = {}): Claim => ({
  id,
  text: options.text ?? `Claim ${id}`,
  questionId: options.questionId ?? null,
  status: options.status ?? 'unexamined',
  ownAssertion: options.ownAssertion ?? false,
  tags: options.tags ?? []
})

const evidence = (id: string, claimId: string, sourceId: string, direction: Evidence['direction'] = 'supports'): Evidence => ({
  id,
  claimId,
  sourceId,
  direction,
  excerpt: 'the relevant words from the source',
  locator: 'p. 4',
  strength: 'direct',
  notes: ''
})

describe('sources', () => {
  test('a source that was only discovered cannot be cited from', () => {
    const check = checkSource(source('s', { access: 'discovered' }))
    assert.equal(check.usable, false)
    assert.match(check.describe, /a search result is not a source/)
  })

  test('a read source is usable', () => {
    assert.equal(checkSource(source('s')).usable, true)
  })

  test('a missing field is named rather than filled in', () => {
    const check = checkSource(source('s', { title: '', year: '' }))
    assert.deepEqual(check.missing.sort(), ['title', 'year'])
    assert.match(check.describe, /incomplete rather than wrong/)
  })

  test('a web source needs a url and a paper does not', () => {
    assert.ok(checkSource(source('s', { kind: 'web', url: '' })).missing.includes('url'))
    assert.ok(!checkSource(source('s', { kind: 'paper', url: '' })).missing.includes('url'))
  })

  test('an unavailable source says what rests on it is unsupported', () => {
    const check = checkSource(source('s', { access: 'paywalled' }))
    assert.equal(check.usable, false)
    assert.match(check.describe, /rather than supported by something unavailable/)
  })
})

describe('linking evidence', () => {
  const sources = [source('s1'), source('s2', { access: 'discovered' })]
  const claims = [claim('c1')]

  test('evidence from a read source links', () => {
    const result = link({ ...evidence('e', 'c1', 's1') }, 'e1', sources, claims)
    assert.ok(!isResearchError(result))
    assert.equal(result.id, 'e1')
  })

  test('evidence from an unopened source is refused', () => {
    const result = link({ ...evidence('e', 'c1', 's2') }, 'e1', sources, claims)
    assert.ok(isResearchError(result))
    assert.equal(result.error, 'source-not-read')
  })

  test('evidence with no excerpt is refused, because nobody could check it', () => {
    const result = link({ ...evidence('e', 'c1', 's1'), excerpt: '  ' }, 'e1', sources, claims)
    assert.ok(isResearchError(result))
    assert.match(result.message, /nobody can check it/)
  })

  test('evidence for a claim that is not there is refused', () => {
    assert.ok(isResearchError(link({ ...evidence('e', 'nope', 's1') }, 'e1', sources, claims)))
  })

  test('an excerpt longer than the limit is refused', () => {
    const result = link({ ...evidence('e', 'c1', 's1'), excerpt: 'x'.repeat(5000) }, 'e1', sources, claims)
    assert.ok(isResearchError(result))
    assert.match(result.message, /Quote the part that bears on the claim/)
  })
})

describe('assessing claims', () => {
  test('a claim with nothing behind it is a gap, not a judgement about truth', () => {
    const assessment = assessClaim(claim('c1'), [])
    assert.equal(assessment.status, 'unsupported')
    assert.match(assessment.describe, /not a judgement about whether it is true/)
  })

  test('an own assertion is recorded as one rather than as unsupported', () => {
    const assessment = assessClaim(claim('c1', { ownAssertion: true }), [])
    assert.equal(assessment.status, 'asserted')
    assert.match(assessment.describe, /not the same as being unsupported/)
  })

  test('support is counted by source, not by quotation', () => {
    const assessment = assessClaim(claim('c1'), [
      evidence('e1', 'c1', 's1'),
      evidence('e2', 'c1', 's1'),
      evidence('e3', 'c1', 's1')
    ])
    assert.equal(assessment.supporting, 3)
    assert.equal(assessment.supportingSources.length, 1)
    assert.equal(assessment.singleSource, true)
    assert.match(assessment.describe, /one source agreeing with itself, not 3 independent confirmations/)
  })

  test('two sources agreeing is reported as two sources', () => {
    const assessment = assessClaim(claim('c1'), [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2')])
    assert.equal(assessment.status, 'supported')
    assert.equal(assessment.singleSource, false)
    assert.equal(assessment.supportingSources.length, 2)
  })

  test('sources on both sides make a claim contested, and neither side wins', () => {
    const assessment = assessClaim(claim('c1'), [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2', 'contradicts')])
    assert.equal(assessment.status, 'contested')
    assert.match(assessment.describe, /nothing here decides between them/)
  })

  test('only contradicting evidence makes a claim contradicted', () => {
    const assessment = assessClaim(claim('c1'), [evidence('e1', 'c1', 's1', 'contradicts')])
    assert.equal(assessment.status, 'contradicted')
  })

  test('qualifying evidence is counted separately from support', () => {
    const assessment = assessClaim(claim('c1'), [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2', 'qualifies')])
    assert.equal(assessment.qualifying, 1)
    assert.match(assessment.describe, /qualify it rather than supporting or contradicting/)
  })
})

describe('scope', () => {
  const scope: Scope = {
    topic: 'AI in education',
    from: '2020',
    to: '2026',
    regions: ['India'],
    sourceKinds: ['paper', 'report'],
    languages: ['en'],
    excluded: ['promotional'],
    describe: ''
  }

  test('a source inside the scope is reported as inside it', () => {
    assert.equal(checkScope(source('s', { year: '2023' }), scope).inScope, true)
  })

  test('a source from before the range is outside, with the reason', () => {
    const check = checkScope(source('s', { year: '2010' }), scope)
    assert.equal(check.inScope, false)
    assert.match(check.reasons[0], /before the 2020/)
  })

  test('being outside the scope is a mismatch to decide about, not a verdict', () => {
    const check = checkScope(source('s', { kind: 'news' }), scope)
    assert.equal(check.inScope, false)
    assert.match(check.describe, /not a reason it is wrong/)
  })

  test('an excluded term is matched against the title and notes', () => {
    const check = checkScope(source('s', { title: 'A promotional whitepaper' }), scope)
    assert.equal(check.inScope, false)
    assert.ok(check.reasons.some((one) => /promotional/.test(one)))
  })
})

describe('gaps', () => {
  test('a question with nothing bearing on it is a gap with something to do', () => {
    const questions: Question[] = [{ id: 'q1', text: 'Does it help?', parent: null, answered: false, notes: '' }]
    const gaps = findGaps(questions, [], [], [])
    assert.equal(gaps.length, 1)
    assert.equal(gaps[0].kind, 'unanswered-question')
    assert.match(gaps[0].suggestion, /record that it turned out not to be answerable/)
  })

  test('a claim resting on one source is a gap naming the source', () => {
    const claims = [claim('c1')]
    const gaps = findGaps([], claims, [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's1')], [])
    const gap = gaps.find((one) => one.kind === 'single-source')
    assert.ok(gap)
    assert.match(gap.suggestion, /One source agreeing with itself several times is still one source/)
  })

  test('an unopened source is a gap saying a list of them is unfinished work', () => {
    const gaps = findGaps([], [], [], [source('s1', { access: 'discovered' })])
    const gap = gaps.find((one) => one.kind === 'unread-source')
    assert.ok(gap)
    assert.match(gap.suggestion, /not a bibliography/)
  })

  test('a source read and never cited is a gap, and both outcomes are results', () => {
    const gaps = findGaps([], [], [], [source('s1')])
    const gap = gaps.find((one) => one.kind === 'uncited-source')
    assert.ok(gap)
    assert.match(gap.suggestion, /Both are results/)
  })

  test('a cited source with missing details is a gap naming the fields', () => {
    const claims = [claim('c1')]
    const gaps = findGaps([], claims, [evidence('e1', 'c1', 's1')], [source('s1', { year: '' })])
    const gap = gaps.find((one) => one.kind === 'incomplete-source')
    assert.ok(gap)
    assert.match(gap.describe, /year/)
  })

  test('a contested claim suggests looking at what the sources measured', () => {
    const claims = [claim('c1')]
    const gaps = findGaps([], claims, [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2', 'contradicts')], [])
    const gap = gaps.find((one) => one.kind === 'contested')
    assert.match(gap?.suggestion ?? '', /two different questions answered correctly/)
  })

  test('no gap ever says only that more research is needed', () => {
    const questions: Question[] = [{ id: 'q1', text: 'Q', parent: null, answered: false, notes: '' }]
    const gaps = findGaps(questions, [claim('c1')], [], [source('s1', { access: 'discovered' })])
    assert.ok(gaps.length > 0)
    for (const gap of gaps) assert.doesNotMatch(gap.suggestion, /more research is needed/i)
  })
})

describe('contradictions', () => {
  test('both sides are kept with the words they came from', () => {
    const claims = [claim('c1', { text: 'X improves Y' })]
    const found = contradictions(claims, [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2', 'contradicts')])
    assert.equal(found.length, 1)
    assert.equal(found[0].supporting.length, 1)
    assert.equal(found[0].contradicting.length, 1)
    assert.ok(found[0].supporting[0].excerpt.length > 0)
    assert.match(found[0].describe, /nothing here decides which is right/)
  })

  test('a claim with support on one side only is not a contradiction', () => {
    assert.equal(contradictions([claim('c1')], [evidence('e1', 'c1', 's1')]).length, 0)
  })
})

describe('findings', () => {
  const claims = [claim('c1'), claim('c2')]

  test('a finding resting on no claim is refused as an opinion', () => {
    const result = assessFinding({ id: 'f1', statement: 'It works', claimIds: [], limitations: [] }, claims, [])
    assert.ok(isResearchError(result))
    assert.match(result.message, /it is an opinion/)
  })

  test('a finding takes its support from the weakest claim it rests on', () => {
    const supporting = [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2')]
    const result = assessFinding({ id: 'f1', statement: 'It works', claimIds: ['c1', 'c2'], limitations: [] }, claims, supporting)
    assert.ok(!isResearchError(result))
    // c2 has nothing behind it.
    assert.equal(result.support, 'unsupported')
    assert.match(result.describe, /the conclusion does not follow yet/)
  })

  test('a finding on well-supported claims is well supported', () => {
    const supporting = [
      evidence('e1', 'c1', 's1'),
      evidence('e2', 'c1', 's2'),
      evidence('e3', 'c2', 's1'),
      evidence('e4', 'c2', 's3')
    ]
    const result = assessFinding({ id: 'f1', statement: 'It works', claimIds: ['c1', 'c2'], limitations: [] }, claims, supporting)
    assert.ok(!isResearchError(result))
    assert.equal(result.support, 'well-supported')
  })

  test('a contested claim makes the finding mixed, and the weak link is a limitation', () => {
    const supporting = [
      evidence('e1', 'c1', 's1'),
      evidence('e2', 'c1', 's2'),
      evidence('e3', 'c2', 's1'),
      evidence('e4', 'c2', 's2', 'contradicts')
    ]
    const result = assessFinding({ id: 'f1', statement: 'It works', claimIds: ['c1', 'c2'], limitations: [] }, claims, supporting)
    assert.ok(!isResearchError(result))
    assert.equal(result.support, 'mixed')
    assert.ok(result.limitations.some((one) => /contested/.test(one)))
    assert.match(result.describe, /averaging would hide it/)
  })

  test('a finding resting on a claim that is not in the project is refused', () => {
    const result = assessFinding({ id: 'f1', statement: 'x', claimIds: ['missing'], limitations: [] }, claims, [])
    assert.ok(isResearchError(result))
  })
})

describe('health', () => {
  test('every figure is a count of real records', () => {
    const questions: Question[] = [{ id: 'q1', text: 'Q', parent: null, answered: false, notes: '' }]
    const claims = [claim('c1', { questionId: 'q1' })]
    const result = health(questions, claims, [evidence('e1', 'c1', 's1'), evidence('e2', 'c1', 's2')], [source('s1'), source('s2')])
    assert.equal(result.questions.answered, 1)
    assert.equal(result.sources.read, 2)
    assert.equal(result.claims.supported, 1)
  })

  test('unopened sources are called out as not citable', () => {
    const result = health([], [], [], [source('s1', { access: 'discovered' })])
    assert.equal(result.sources.unread, 1)
    assert.ok(result.notes.some((one) => /Nothing can be cited from them/.test(one)))
  })

  test('unavailable sources are called out, and what rested on them is unsupported', () => {
    const result = health([], [], [], [source('s1', { access: 'paywalled' })])
    assert.ok(result.notes.some((one) => /rather than supported by something unavailable/.test(one)))
  })

  test('own assertions are counted separately', () => {
    const result = health([], [claim('c1', { ownAssertion: true })], [], [])
    assert.equal(result.claims.asserted, 1)
    assert.ok(result.notes.some((one) => /not the same as being unsupported/.test(one)))
  })

  test('a question with only an unsupported claim is not counted as answered', () => {
    const questions: Question[] = [{ id: 'q1', text: 'Q', parent: null, answered: false, notes: '' }]
    const result = health(questions, [claim('c1', { questionId: 'q1' })], [], [])
    assert.equal(result.questions.answered, 0)
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(RESEARCH_ASSUMPTIONS.length >= 9)
    assert.ok(RESEARCH_ASSUMPTIONS.some((one) => /A search result is not a source/.test(one)))
    assert.ok(RESEARCH_ASSUMPTIONS.some((one) => /counted by source, not by quotation/.test(one)))
    assert.ok(RESEARCH_ASSUMPTIONS.some((one) => /not "Untitled"/.test(one)))
  })
})
