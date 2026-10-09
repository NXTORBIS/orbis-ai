import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PHYSICS_SECTIONS, PHYSICS_TOPICS, PHYSICS_COUNTS, searchTopics, topicFor } from './topics.ts'

/**
 * The topic list and the studio's own registry must agree.
 *
 * `topics.ts` is generated from `src/renderer/src/physics/lib/registry.js` because the main process needs the list
 * and cannot import 230 React components to get it. Two copies of a list drift: a topic added to the studio and
 * missing here is one Orion cannot open, and nobody notices until somebody asks for it by name.
 *
 * The duplicate check is here because four ids really were used twice. A topic is looked up by its id, so in each
 * pair the second simulation could never be reached at all — Quantum Superposition, Cosmic Expansion and Quantum
 * Field Theory were all present in the registry and unreachable in the studio.
 */

const registry = (): string => {
  const path = join(process.cwd(), 'src', 'renderer', 'src', 'physics', 'lib', 'registry.js')
  return readFileSync(path, 'utf8')
}

test('every topic in the studio is in the list the rest of Orbis reads', () => {
  const source = registry()
  const body = source.slice(source.indexOf('export const SECTIONS'))
  const ids = [...body.matchAll(/\bt\('([A-Za-z0-9_-]+)'/g)].map((one) => one[1])

  assert.equal(ids.length, PHYSICS_TOPICS.length, `the registry has ${ids.length} topics and the list has ${PHYSICS_TOPICS.length}`)
  for (const id of ids) {
    assert.ok(topicFor(id) !== null, `the studio has "${id}" and the list does not — Orion could not open it`)
  }
  for (const one of PHYSICS_TOPICS) {
    assert.ok(ids.includes(one.id), `the list has "${one.id}" and the studio does not — opening it would show nothing`)
  }
})

test('no two topics share an id, because the second one would be unreachable', () => {
  const seen = new Set<string>()
  for (const one of PHYSICS_TOPICS) {
    assert.ok(!seen.has(one.id), `two topics are called "${one.id}"; the second can never be opened`)
    seen.add(one.id)
  }
  assert.equal(seen.size, PHYSICS_TOPICS.length)
})

test('every topic belongs to a section that exists', () => {
  const sections = new Set(PHYSICS_SECTIONS.map((one) => one.id))
  for (const one of PHYSICS_TOPICS) {
    assert.ok(sections.has(one.section), `"${one.id}" is in section "${one.section}", which is not one`)
    assert.ok(one.name.trim() !== '', `"${one.id}" has no name`)
    assert.ok(one.about.trim() !== '', `"${one.id}" says nothing about itself`)
  }
  // Every section must have something in it, or the studio shows an empty heading.
  for (const section of PHYSICS_SECTIONS) {
    assert.ok(PHYSICS_TOPICS.some((one) => one.section === section.id), `section "${section.id}" is empty`)
  }
})

test('every topic names a simulation the studio actually imports', () => {
  const source = registry()
  // Two of them are pages rather than simulations, so they come from one level up rather than from sims/.
  const imported = new Set([...source.matchAll(/import\s+(\w+)\s+from\s+'\.\.\/(?:sims\/)?[A-Za-z]/g)].map((one) => one[1]))
  const used = [...source.slice(source.indexOf('export const SECTIONS')).matchAll(/\bt\('[A-Za-z0-9_-]+',\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"),\s*(\w+),/g)].map((one) => one[1])
  assert.equal(used.length, PHYSICS_TOPICS.length)
  for (const name of used) {
    assert.ok(imported.has(name), `the registry uses "${name}" without importing it`)
  }
})

test('search finds a topic the way somebody would ask for one', () => {
  assert.ok(searchTopics('projectile').some((one) => one.id === 'projectile'))
  assert.ok(searchTopics('double pendulum').some((one) => /pendulum/i.test(one.name)))
  assert.ok(searchTopics('phase space').length > 0)
  assert.equal(searchTopics('').length, PHYSICS_TOPICS.length)
  assert.equal(searchTopics('definitely not a physics topic at all').length, 0)
  // The four that were unreachable must each be findable by their own name now.
  for (const name of ['Quantum Superposition', 'Cosmic Expansion', 'Quantum Field Theory']) {
    const hit = searchTopics(name)
    assert.ok(hit.some((one) => one.name === name), `"${name}" cannot be found`)
  }
})

test('the counts are the real ones', () => {
  assert.equal(PHYSICS_COUNTS.topics, PHYSICS_TOPICS.length)
  assert.equal(PHYSICS_COUNTS.sections, PHYSICS_SECTIONS.length)
  assert.ok(PHYSICS_TOPICS.length >= 240, `only ${PHYSICS_TOPICS.length} topics`)
  assert.equal(PHYSICS_SECTIONS.length, 15)
})
