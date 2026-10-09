import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DIFFICULTY_XP,
  TOPICS,
  promptFor,
  readReply,
  checkShape,
  checkAgainstReference,
  assemble,
  slugFor,
  isRefusal,
  type Proposed
} from './generated.ts'

/** A reply of the shape a model gives when it has done the job properly. */
const good = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Count the Vowels',
  description:
    'Read a line of lowercase letters and print how many of them are vowels. A vowel is one of a, e, i, o, u.',
  topics: ['String', 'Hash Table'],
  examples: [{ input: 'orbis', output: '2', explanation: 'o and i are vowels.' }],
  constraints: ['1 <= length <= 1000'],
  tests: [
    { input: 'orbis', expected: '2' },
    { input: 'aeiou', expected: '5' },
    { input: 'xyz', expected: '0' },
    { input: 'a', expected: '1' }
  ],
  complexity: { time: 'O(n)', space: 'O(1)' },
  hints: ['Walk the string once.'],
  reference: 'print(sum(1 for c in input() if c in "aeiou"))',
  ...over
})

/** A runner that knows the right answers, standing in for the execution service. */
const correctRunner = async (_source: string, stdin: string) => ({
  stdout: String([...stdin].filter((one) => 'aeiou'.includes(one)).length),
  origin: 'predicted' as const
})

describe('what the model is asked for', () => {
  it('asks for the code in a fence rather than inside the JSON', () => {
    const asked = promptFor({ about: 'String', difficulty: 'Easy', avoid: [], language: 'python' })
    assert.match(asked, /fenced code/i)
    assert.match(asked, /NOT inside the JSON/)
  })

  it('asks for a reference solution and says it will be checked', () => {
    const asked = promptFor({ about: 'String', difficulty: 'Easy', avoid: ['Two Sum'], language: 'python' })
    assert.match(asked, /solution/i)
    assert.match(asked, /run against your own tests/i)
    assert.match(asked, /thrown away/i)
  })

  it('names the topics it may use and the titles it may not repeat', () => {
    const asked = promptFor({ about: 'Graph', difficulty: 'Hard', avoid: ['Two Sum'], language: 'python' })
    assert.match(asked, /Two Sum/)
    for (const topic of ['Sliding Window', 'Backtracking']) assert.ok(asked.includes(topic))
  })

  it('says a problem must have exactly one right answer', () => {
    const asked = promptFor({ about: 'Array', difficulty: 'Easy', avoid: [], language: 'python' })
    assert.match(asked, /ONE correct output/)
  })
})

describe('reading the reply', () => {
  it('finds the JSON inside a fenced block', () => {
    const got = readReply('```json\n{"title":"x"}\n```')
    assert.ok(!isRefusal(got))
    assert.equal((got as { held: Record<string, unknown> }).held.title, 'x')
  })

  it('finds the JSON when words came with it', () => {
    const got = readReply('Sure! Here you go:\n{"title":"x"}\nHope that helps.')
    assert.ok(!isRefusal(got))
  })

  it('refuses when there is no JSON at all', () => {
    const got = readReply('I would rather not.')
    assert.ok(isRefusal(got))
  })

  it('refuses when the JSON will not parse', () => {
    const got = readReply('{"title": }')
    assert.ok(isRefusal(got))
  })

  it('takes the solution from the fence after the JSON', () => {
    // The shape actually asked for: the description as JSON, the program in a fence where nothing needs escaping.
    const got = readReply('{"title":"x"}\n\n```python\nprint("hello {world}")\n```')
    assert.ok(!isRefusal(got))
    assert.equal((got as { held: Record<string, unknown> }).held.reference, 'print("hello {world}")')
  })

  it('does not run the JSON on into a brace in the code', () => {
    // The reason braces are counted rather than the last one found: solutions are full of them.
    const got = readReply('{"title":"x"}\n```js\nfunction f() { return {a:1} }\n```')
    assert.ok(!isRefusal(got))
    const held = (got as { held: Record<string, unknown> }).held
    assert.equal(held.title, 'x')
    assert.match(String(held.reference), /return \{a:1\}/)
  })

  it('leaves a reference the model put inside the JSON alone', () => {
    const got = readReply('{"title":"x","reference":"print(1)"}\n```\nprint(2)\n```')
    assert.equal((got as { held: Record<string, unknown> }).held.reference, 'print(1)')
  })

  it('ignores a brace inside a JSON string', () => {
    const got = readReply('{"title":"a } b","description":"c"}\n```\nprint(1)\n```')
    assert.equal((got as { held: Record<string, unknown> }).held.title, 'a } b')
  })

  it('takes unfenced code after the JSON rather than losing the problem', () => {
    const got = readReply('{"title":"x"}\nprint(sum([1]))')
    assert.match(String((got as { held: Record<string, unknown> }).held.reference), /print/)
  })
})

describe('the checks that cost nothing', () => {
  const shaped = (over: Record<string, unknown> = {}, avoid: readonly string[] = []) =>
    checkShape(good(over), { avoid })

  it('accepts a well-formed problem', () => {
    const got = shaped()
    assert.ok(!isRefusal(got))
    assert.equal((got as Proposed).tests.length, 4)
  })

  it('refuses a title already in the library, whatever the capitals', () => {
    assert.ok(isRefusal(shaped({}, ['count the VOWELS'])))
  })

  it('refuses a topic the studio does not know', () => {
    assert.ok(isRefusal(shaped({ topics: ['Quantum Sorting'] })))
  })

  it('keeps only the topics it recognises', () => {
    const got = shaped({ topics: ['String', 'Quantum Sorting'] })
    assert.deepEqual((got as Proposed).topics, ['String'])
  })

  it('refuses fewer than three tests', () => {
    const got = shaped({ tests: [{ input: 'a', expected: '1' }, { input: 'b', expected: '0' }] })
    assert.ok(isRefusal(got))
    assert.match((got as { failed: string }).failed, /too few/)
  })

  it('does not count a test with no expected output', () => {
    const got = shaped({
      tests: [
        { input: 'a', expected: '1' },
        { input: 'b', expected: '0' },
        { input: 'c', expected: '' }
      ]
    })
    assert.ok(isRefusal(got))
  })

  it('refuses two tests that give one input different answers', () => {
    const got = shaped({
      tests: [
        { input: 'a', expected: '1' },
        { input: 'a', expected: '2' },
        { input: 'b', expected: '0' },
        { input: 'c', expected: '0' }
      ]
    })
    assert.ok(isRefusal(got))
    assert.match((got as { failed: string }).failed, /contradictory/)
  })

  it('refuses a problem with no reference solution', () => {
    const got = shaped({ reference: '' })
    assert.ok(isRefusal(got))
    assert.match((got as { problem: string }).problem, /no reference solution/i)
  })

  it('refuses a description too short to be a problem', () => {
    assert.ok(isRefusal(shaped({ description: 'Count things.' })))
  })

  it('refuses a problem with no worked example', () => {
    assert.ok(isRefusal(shaped({ examples: [] })))
  })
})

describe('checking the reference solution against the tests', () => {
  it('passes when they agree', async () => {
    const proposed = checkShape(good(), { avoid: [] }) as Proposed
    const got = await checkAgainstReference(proposed, correctRunner)
    assert.ok(!isRefusal(got))
    assert.equal((got as { checks: unknown[] }).checks.length, 4)
  })

  it('throws the problem away when its own solution disagrees', async () => {
    // One test given a wrong answer -- the common failure, and the whole reason for this check.
    const proposed = checkShape(good({
      tests: [
        { input: 'orbis', expected: '2' },
        { input: 'aeiou', expected: '4' },
        { input: 'xyz', expected: '0' },
        { input: 'a', expected: '1' }
      ]
    }), { avoid: [] }) as Proposed
    const got = await checkAgainstReference(proposed, correctRunner)
    assert.ok(isRefusal(got))
    assert.match((got as { problem: string }).problem, /disagrees with 1 of its 4 tests/)
    assert.match((got as { fix: string }).fix, /thrown away/)
  })

  it('throws it away when the reference will not run', async () => {
    const proposed = checkShape(good(), { avoid: [] }) as Proposed
    const got = await checkAgainstReference(proposed, async () => ({
      stdout: '',
      origin: 'predicted' as const,
      broke: 'SyntaxError on line 1'
    }))
    assert.ok(isRefusal(got))
    assert.match((got as { problem: string }).problem, /SyntaxError/)
  })

  it('ignores trailing whitespace, the way a judge does', async () => {
    const proposed = checkShape(good(), { avoid: [] }) as Proposed
    const got = await checkAgainstReference(proposed, async (_s, stdin) => ({
      stdout: `${[...stdin].filter((one) => 'aeiou'.includes(one)).length}  \n\n`,
      origin: 'predicted' as const
    }))
    assert.ok(!isRefusal(got))
  })

  it('says it ran when it ran, and read when it was read', async () => {
    const proposed = checkShape(good(), { avoid: [] }) as Proposed
    const ran = await checkAgainstReference(proposed, async (_s, stdin) => ({
      stdout: String([...stdin].filter((one) => 'aeiou'.includes(one)).length),
      origin: 'ran' as const
    }))
    assert.equal((ran as { checkedBy: string }).checkedBy, 'ran')
    const read = await checkAgainstReference(proposed, correctRunner)
    assert.equal((read as { checkedBy: string }).checkedBy, 'read')
  })

  it('refuses rather than throwing when the runner itself breaks', async () => {
    const proposed = checkShape(good(), { avoid: [] }) as Proposed
    const got = await checkAgainstReference(proposed, async () => {
      throw new Error('the bridge is gone')
    })
    assert.ok(isRefusal(got))
    assert.match((got as { fix: string }).fix, /the bridge is gone/)
  })
})

describe('the problem that comes out', () => {
  const build = () =>
    assemble({
      proposed: checkShape(good(), { avoid: [] }) as Proposed,
      difficulty: 'Medium',
      checkedBy: 'read',
      language: 'python',
      after: 16,
      starter: { python: 'pass\n' }
    })

  it('takes its XP from the studio table, not from the model', () => {
    assert.equal(build().xp, DIFFICULTY_XP.Medium)
    assert.equal(DIFFICULTY_XP.Medium, 50)
  })

  it('has no acceptance rate, because that would be invented', () => {
    assert.equal(build().acceptance, null)
  })

  it('says it was generated', () => {
    assert.equal(build().generated, true)
    assert.equal(build().checkedBy, 'read')
  })

  it('is numbered after the written ones', () => {
    assert.equal(build().number, 17)
    assert.equal(build().id, 'g0017')
  })

  it('hides the tests that were not shown as examples, and only those', () => {
    const made = build()
    const shown = made.tests.filter((one) => !one.hidden)
    const hidden = made.tests.filter((one) => one.hidden)
    assert.deepEqual(shown.map((one) => one.input), ['orbis'])
    assert.equal(hidden.length, 3)
  })

  it('keeps at least one hidden test', () => {
    assert.ok(build().tests.some((one) => one.hidden))
  })

  it('uses only topics the filters know', () => {
    for (const topic of build().topics) assert.ok(TOPICS.includes(topic))
  })
})

describe('slugs', () => {
  it('makes an address out of a title', () => {
    assert.equal(slugFor('Count the Vowels!'), 'count-the-vowels')
  })

  it('never comes out empty', () => {
    assert.equal(slugFor('???'), 'generated-problem')
  })
})
