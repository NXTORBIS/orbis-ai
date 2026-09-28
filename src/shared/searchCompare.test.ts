import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptTimeline, splitComparison, yearIn } from './searchCompare.ts'
import { provenanceFor } from './searchModules.ts'

const WHERE = provenanceFor({ url: 'https://en.wikipedia.org/wiki/Someone' }, 'web')!

test('the two things being compared are found', () => {
  assert.deepEqual(splitComparison('python vs java'), { left: 'python', right: 'java' })
  assert.deepEqual(splitComparison('iPhone 15 versus Galaxy S24'), { left: 'iPhone 15', right: 'Galaxy S24' })
  assert.deepEqual(splitComparison('difference between TCP and UDP'), { left: 'TCP', right: 'UDP' })
  assert.deepEqual(splitComparison('what is the difference between HTTP and HTTPS'), { left: 'HTTP', right: 'HTTPS' })
})

test('"or" is a comparison between two things and an ordinary word everywhere else', () => {
  assert.deepEqual(splitComparison('python or java'), { left: 'python', right: 'java' })
  assert.equal(splitComparison('coffee or tea near me'), null)
})

test('what is not a comparison is not forced into one', () => {
  assert.equal(splitComparison('python tutorial'), null)
  assert.equal(splitComparison('how to install python'), null)
  assert.equal(splitComparison('which is the best laptop or desktop for me'), null)
})

test('a thing is not compared with itself', () => {
  assert.equal(splitComparison('python vs python'), null)
})

// ---------------------------------------------------------------- timelines

const PAGE = 'Albert Einstein was born on 14 March 1879 in Ulm. In 1905 he published the special theory of relativity. He received the Nobel Prize in 1921. He died in 1955.'

test('an entry the page supports on both halves is kept', () => {
  const entries = acceptTimeline([{ when: '1905', what: 'published the special theory of relativity' }], PAGE, WHERE)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].year, 1905)
  assert.equal(entries[0].provenance.site, 'en.wikipedia.org')
})

test('a real date attached to an invented event is refused', () => {
  assert.equal(acceptTimeline([{ when: '1905', what: 'won an Olympic gold medal in fencing' }], PAGE, WHERE).length, 0)
})

test('a real event given an invented date is refused', () => {
  assert.equal(acceptTimeline([{ when: '1899', what: 'published the special theory of relativity' }], PAGE, WHERE).length, 0)
})

test('entries come out in order, earliest first', () => {
  const entries = acceptTimeline(
    [
      { when: '1921', what: 'received the Nobel Prize' },
      { when: '14 March 1879', what: 'born in Ulm' },
      { when: '1905', what: 'published the special theory of relativity' }
    ],
    PAGE,
    WHERE
  )
  assert.deepEqual(entries.map((e) => e.year), [1879, 1905, 1921])
})

test('a date with no year is kept but sorted last, because the page still said it', () => {
  const page = `${PAGE} During the war he wrote to Roosevelt.`
  const entries = acceptTimeline(
    [
      { when: 'During the war', what: 'wrote to Roosevelt' },
      { when: '1905', what: 'published the special theory of relativity' }
    ],
    page,
    WHERE
  )
  assert.equal(entries.length, 2)
  assert.equal(entries[0].year, 1905)
  assert.equal(entries[1].year, null)
})

test('the same moment twice is one moment', () => {
  const entries = acceptTimeline(
    [
      { when: '1921', what: 'received the Nobel Prize' },
      { when: '1921', what: 'received the Nobel Prize' }
    ],
    PAGE,
    WHERE
  )
  assert.equal(entries.length, 1)
})

test('with no page text there is no timeline, rather than an unchecked one', () => {
  assert.equal(acceptTimeline([{ when: '1905', what: 'something' }], '', WHERE).length, 0)
})

test('the year is read out of however the date was written', () => {
  assert.equal(yearIn('14 March 1879'), 1879)
  assert.equal(yearIn('2008'), 2008)
  assert.equal(yearIn('during the war'), null)
})
