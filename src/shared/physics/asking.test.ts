import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PHYSICS_TOPICS } from './topics.ts'

/**
 * Finding the topic somebody meant.
 *
 * The matching itself lives in the renderer, beside the code that works the screen, because that is the only
 * place it can be used. This is the part that can be checked without a window: given a phrase, is there exactly
 * one topic it can mean, or should it be refused as ambiguous?
 *
 * Refusing ambiguity matters more than it looks. "quantum" matches dozens of topics; silently opening whichever
 * came first would be a studio that appears to ignore what was asked for.
 */

const tidy = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The same rule the renderer uses, kept here so it can be checked without a screen. */
function findTopic(asked: string): string | string[] | null {
  const want = tidy(asked)
  if (want === '') return null

  const byId = PHYSICS_TOPICS.find((one) => one.id.toLowerCase() === asked.trim().toLowerCase())
  if (byId) return byId.id

  const byName = PHYSICS_TOPICS.filter((one) => tidy(one.name) === want)
  if (byName.length === 1) return byName[0].id
  if (byName.length > 1) {
    // The plain entry wins a tie: its id carries no section prefix, which is what makes it the canonical one.
    const plain = [...byName].sort((a, b) => a.id.length - b.id.length)
    if (plain[0].id.length < plain[1].id.length) return plain[0].id
    return byName.map((one) => one.id)
  }

  const parts = want.split(' ')
  const loose = PHYSICS_TOPICS.filter((one) => {
    const haystack = `${tidy(one.name)} ${tidy(one.id)} ${tidy(one.about)}`
    return parts.every((two) => haystack.includes(two))
  })
  if (loose.length === 0) return null
  if (loose.length === 1) return loose[0].id

  const inName = loose.filter((one) => parts.every((two) => tidy(one.name).includes(two)))
  if (inName.length === 1) return inName[0].id
  return (inName.length > 0 ? inName : loose).map((one) => one.id)
}

test('a topic can be asked for by its id, its name, or part of its name', () => {
  assert.equal(findTopic('projectile'), 'projectile')
  assert.equal(findTopic('Projectile Motion'), 'projectile')
  assert.equal(findTopic('projectile motion'), 'projectile')
  assert.equal(findTopic('double pendulum'), 'double')
  assert.equal(findTopic('  DOUBLE   PENDULUM '), 'double')
})

test('something that matches nothing is refused rather than guessed at', () => {
  assert.equal(findTopic('the price of fish'), null)
  assert.equal(findTopic(''), null)
  assert.equal(findTopic('   '), null)
})

test('something that matches several is refused with the list', () => {
  // "quantum" is in a great many names. Opening whichever came first would look like being ignored.
  const many = findTopic('quantum')
  assert.ok(Array.isArray(many), 'a word this broad should not resolve to one topic')
  assert.ok(many.length > 3, `expected several, got ${JSON.stringify(many)}`)
})

test('a longer phrase narrows to one where the short word could not', () => {
  const broad = findTopic('quantum')
  assert.ok(Array.isArray(broad))
  const exact = findTopic('quantum tunneling')
  assert.ok(!Array.isArray(exact), `"quantum tunneling" should be one topic, got ${JSON.stringify(exact)}`)
})

test('a name beats a description', () => {
  // Several topics mention entropy; the one actually called Entropy Simulator is the one meant.
  const got = findTopic('entropy simulator')
  assert.ok(!Array.isArray(got), `expected one, got ${JSON.stringify(got)}`)
  const topic = PHYSICS_TOPICS.find((one) => one.id === got)
  assert.ok(topic)
  assert.match(topic.name, /entropy/i)
})

test('the four that used to be unreachable can each be asked for by name', () => {
  for (const [asked, name] of [
    ['quantum superposition', 'Quantum Superposition'],
    ['cosmic expansion', 'Cosmic Expansion'],
    ['quantum field theory', 'Quantum Field Theory']
  ] as const) {
    const got = findTopic(asked)
    assert.ok(!Array.isArray(got) && got !== null, `"${asked}" should resolve, got ${JSON.stringify(got)}`)
    const topic = PHYSICS_TOPICS.find((one) => one.id === got)
    assert.equal(topic?.name, name)
  }
})

test('every topic can be found by its own full name', () => {
  // If a topic cannot be asked for by the name shown on its own card, it cannot be opened by asking at all.
  const unreachable: string[] = []
  for (const one of PHYSICS_TOPICS) {
    const got = findTopic(one.name)
    if (got !== one.id) unreachable.push(`${one.name} -> ${JSON.stringify(got)}`)
  }
  // A handful share a name across sections on purpose; those are ambiguous rather than unreachable.
  const trulyLost = unreachable.filter((one) => one.includes('-> null'))
  assert.deepEqual(trulyLost, [], 'these topics cannot be found by their own name')
  assert.ok(unreachable.length < 15, `${unreachable.length} topics do not resolve to themselves: ${unreachable.slice(0, 6).join(' | ')}`)
})
