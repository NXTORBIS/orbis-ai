import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isAlgorithmError, type Run } from './trace.ts'
import { STRING_NAMES, knuthMorrisPratt, naiveMatch, rabinKarp, runString, type MatchResult } from './strings.ts'

/**
 * The three matchers, checked against what JavaScript's own `indexOf` finds.
 *
 * Every expectation here comes from the language's own search rather than from the implementations, because a test
 * that asserts whatever the code produces proves only that the code agrees with itself. The three must also agree
 * with *each other* on every case: they solve the same problem, and a disagreement is a bug in one of them.
 */

const ran = (what: string, run: Run | { error: string; message: string }): Run => {
  assert.ok(!isAlgorithmError(run), `${what} was refused: ${isAlgorithmError(run) ? run.message : ''}`)
  return run as Run
}

/** Every position `pattern` starts at in `text`, from the language itself. */
function everyPosition(text: string, pattern: string): number[] {
  const out: number[] = []
  for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) out.push(at)
  return out
}

const CASES: readonly (readonly [string, string])[] = Object.freeze([
  ['abacabadabacaba', 'abacaba'],
  ['aaaaaaaaab', 'aaab'],
  ['aaaaaaaaaa', 'aaa'],
  ['hello world', 'o w'],
  ['hello world', 'xyz'],
  ['mississippi', 'issi'],
  ['mississippi', 'i'],
  ['abcabcabcabc', 'abcabc'],
  ['the quick brown fox', 'fox'],
  ['the quick brown fox', 'the'],
  ['aba', 'aba'],
  ['ababababab', 'abab']
])

describe('the three string matchers', () => {
  for (const name of STRING_NAMES) {
    it(`${name} finds exactly what indexOf finds`, () => {
      for (const [text, pattern] of CASES) {
        const run = ran(`${name} on "${pattern}" in "${text}"`, runString(name, text, pattern))
        const result = run.result as MatchResult
        assert.deepEqual(
          [...result.at],
          everyPosition(text, pattern),
          `${name} disagrees with indexOf on "${pattern}" in "${text}"`
        )
        assert.equal(result.found, everyPosition(text, pattern).length > 0)
        assert.equal(run.cut, false, `${name} hit the step ceiling on a tiny input`)
      }
    })
  }

  it('the three agree with each other on every case', () => {
    for (const [text, pattern] of CASES) {
      const answers = STRING_NAMES.map((name) => {
        const run = ran(name, runString(name, text, pattern))
        return (run.result as MatchResult).at
      })
      for (let one = 1; one < answers.length; one += 1) {
        assert.deepEqual([...answers[one]], [...answers[0]], `${STRING_NAMES[one]} and ${STRING_NAMES[0]} disagree on "${pattern}" in "${text}"`)
      }
    }
  })

  it('refuses what it cannot search, by name', () => {
    assert.ok(isAlgorithmError(naiveMatch('abc', '')), 'an empty pattern was accepted')
    assert.ok(isAlgorithmError(naiveMatch('ab', 'abcdef')), 'a pattern longer than the text was accepted')
    assert.ok(isAlgorithmError(runString('nope' as never, 'abc', 'a')), 'an unknown algorithm was accepted')
  })
})

describe('what the counts show', () => {
  it('KMP never compares more than the naive matcher on the hard case', () => {
    // 'aaaaaaaaab' with 'aaab' is the case the naive matcher is bad at: every window nearly matches.
    const text = 'aaaaaaaaaaaaaaaaaaab'
    const pattern = 'aaab'
    const naive = ran('naive', naiveMatch(text, pattern))
    const kmp = ran('kmp', knuthMorrisPratt(text, pattern))
    assert.ok(
      kmp.counts.comparisons < naive.counts.comparisons,
      `KMP made ${kmp.counts.comparisons} comparisons and the naive matcher ${naive.counts.comparisons}; on this input KMP must do fewer, which is the whole reason it exists`
    )
  })

  it('counts the comparisons the trace actually recorded', () => {
    for (const name of STRING_NAMES) {
      const run = ran(name, runString(name, 'mississippi', 'issi'))
      const result = run.result as MatchResult
      assert.equal(result.comparisons, run.counts.comparisons, `${name} reports a count its trace does not support`)
    }
  })

  it('Rabin-Karp reports its spurious hits rather than hiding them', () => {
    const run = ran('rabin-karp', rabinKarp('abacabadabacaba', 'abacaba'))
    const result = run.result as MatchResult
    assert.equal(typeof result.spurious, 'number')
    assert.ok(result.spurious >= 0)
  })

  it('every matcher records steps worth watching', () => {
    for (const name of STRING_NAMES) {
      const run = ran(name, runString(name, 'abacabadabacaba', 'abacaba'))
      assert.ok(run.steps.length > 5, `${name} recorded only ${run.steps.length} steps`)
      for (const step of run.steps) assert.ok(step.says.length > 0, `${name} recorded a step that says nothing`)
    }
  })

  it('KMP builds its table before it matches', () => {
    const run = ran('kmp', knuthMorrisPratt('abacabadabacaba', 'abacaba'))
    const said = run.steps.map((one) => one.says).join(' | ')
    assert.ok(said.includes('build the table'), 'the table build is not in the trace, so half the algorithm is invisible')
    assert.ok(
      run.steps.some((one) => one.says.includes('table is [')),
      'the finished table is never shown'
    )
  })
})
