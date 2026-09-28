import test from 'node:test'
import assert from 'node:assert/strict'
import { draftValidatedWorkflow } from './orion.ts'
import type { CapabilityDescriptor } from '../../shared/browserControl.ts'

/** A capability the browser really has, in the shape the registry reports. */
const cap = (id: string, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => ({
  id,
  domain: 'navigation' as CapabilityDescriptor['domain'],
  name: id,
  description: `does ${id}`,
  params: { url: { type: 'string', description: 'where to go', required: true } },
  mutates: true,
  confirmation: 'none',
  requires: [],
  provider: 'window',
  available: true,
  ...extra
})

/** Answers as the model API would, with whatever draft the test wants Orion to have produced. */
const orionReturning = (draft: unknown): typeof fetch =>
  (async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(draft) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })) as unknown as typeof fetch

const ids = (() => {
  let n = 0
  return () => `id${(n += 1)}`
})()

test('a draft naming a capability this Orbis does not have comes back with that said', async () => {
  // The model is told to use only the listed capabilities. Being told is not being prevented, and before this the
  // draft reached the person looking fine -- the failure arrived part-way through a real run instead.
  const { workflow, issues } = await draftValidatedWorkflow(
    'open the supplier page and wipe the downloads',
    null,
    [cap('navigation.go')],
    ['key'],
    orionReturning({
      name: 'Supplier',
      description: 'x',
      steps: [
        { type: 'action', name: 'Go', capability: 'navigation.go', params: { url: 'https://example.com' } },
        { type: 'action', name: 'Wipe', capability: 'downloads.deleteEverything', params: {} }
      ]
    }),
    ids
  )
  assert.equal(workflow.steps.length, 2, 'the draft is kept whole so the editor can fix it')
  const errors = issues.filter((i) => i.level === 'error')
  assert.ok(errors.length >= 1)
  assert.match(errors.map((e) => e.message).join(' '), /downloads\.deleteEverything.*doesn't have/i)
})

test('a draft that only uses real capabilities comes back with nothing wrong', async () => {
  const { workflow, issues } = await draftValidatedWorkflow(
    'open the supplier page',
    null,
    [cap('navigation.go')],
    ['key'],
    orionReturning({
      name: 'Supplier',
      description: 'x',
      steps: [{ type: 'action', name: 'Go', capability: 'navigation.go', params: { url: 'https://example.com' } }]
    }),
    ids
  )
  assert.equal(workflow.steps.length, 1)
  assert.deepEqual(issues.filter((i) => i.level === 'error'), [])
})

test('a missing required parameter is caught before anything runs', async () => {
  const { issues } = await draftValidatedWorkflow(
    'go somewhere',
    null,
    [cap('navigation.go')],
    ['key'],
    orionReturning({
      name: 'Go',
      description: 'x',
      steps: [{ type: 'action', name: 'Go', capability: 'navigation.go', params: {} }]
    }),
    ids
  )
  assert.match(issues.map((i) => i.message).join(' '), /missing/i)
})

test('a variable used before anything creates it is caught', async () => {
  const { issues } = await draftValidatedWorkflow(
    'go to the saved address',
    null,
    [cap('navigation.go')],
    ['key'],
    orionReturning({
      name: 'Go',
      description: 'x',
      steps: [{ type: 'action', name: 'Go', capability: 'navigation.go', params: { url: '{{savedAddress}}' } }]
    }),
    ids
  )
  assert.match(issues.map((i) => i.message).join(' '), /before it is created/i)
})

test('a draft with no steps is refused rather than saved as an empty workflow', async () => {
  await assert.rejects(
    () => draftValidatedWorkflow('do something', null, [cap('navigation.go')], ['key'], orionReturning({ name: 'x', steps: [] }), ids),
    /no steps/i
  )
})
