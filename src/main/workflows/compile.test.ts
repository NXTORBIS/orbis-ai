import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CapabilityDescriptor } from '../../shared/browserControl.ts'
import { compileWorkflow, describeWorkflow } from '../../shared/workflowCompile.ts'
import { newWorkflow } from '../../shared/workflows.ts'

const cap = (id: string, extra: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor => ({ id, domain: id.split('.')[0] as CapabilityDescriptor['domain'], name: id, description: id, params: {}, mutates: true, confirmation: 'none', requires: [], provider: 'main', available: true, ...extra })

test('a workflow compiles to a plan with inputs, secrets, outputs and else-if chains', () => {
  const w = newWorkflow('Keys', 'w1')
  w.inputs = [{ name: 'site', label: 'Site', type: 'url', default: 'https://a.test' }, { name: 'password', label: 'Password', type: 'secret' }]
  w.variables = { region: 'eu' }
  w.outputs = [{ name: 'key', from: 'apiKey', sensitive: true }]
  w.settings.maxIterations = 50
  w.steps = [
    { id: 'go', type: 'action', name: 'Open', capability: 'navigation.go', params: { url: '{{site}}' }, timeoutMs: 5000 },
    { id: 'which', type: 'if', name: 'Signed in?', condition: { check: 'textContains', text: 'Sign out' }, then: [{ id: 't', type: 'set', name: 'A', values: { state: 'in' } }], elseIf: [{ condition: { check: 'textContains', text: 'Verify' }, steps: [{ id: 'v', type: 'userAction', name: 'Verify', message: 'Verify it is you' }] }], else: [{ id: 'e', type: 'set', name: 'B', values: { state: 'out' } }] },
    { id: 'loop', type: 'repeat', name: 'Until done', until: { check: 'textContains', text: 'Done' }, steps: [{ id: 's', type: 'set', name: 'tok', values: { token: 'x' }, sensitive: true }] },
    { id: 'off', type: 'action', name: 'Off', capability: 'tabs.create', params: {}, enabled: false }
  ]
  const plan = compileWorkflow(w, { password: 'hunter2' })
  assert.deepEqual(plan.variables, { region: 'eu', site: 'https://a.test', password: 'hunter2' })
  assert.deepEqual(plan.sensitiveVariables?.sort(), ['password', 'token'])
  assert.deepEqual(plan.outputs, [{ name: 'key', from: 'apiKey', sensitive: true }])
  assert.equal(plan.onFailure, 'pause')
  const [go, which, loop, off] = plan.steps as unknown as Record<string, unknown>[]
  assert.equal(go.do, 'navigation.go')
  assert.equal(go.timeoutMs, 5000)
  const elseBranch = which.else as Record<string, unknown>[]
  assert.equal(elseBranch.length, 1)
  assert.ok('if' in elseBranch[0] && Array.isArray(elseBranch[0].else))
  assert.equal((loop.repeat as { max: number }).max, 50)
  assert.equal(off.enabled, false)
})

test('plan mode describes what would happen, what changes things and what asks first, without running anything', () => {
  const w = newWorkflow('Clean up', 'w2')
  w.steps = [
    { id: 'a', type: 'action', name: 'Open', capability: 'navigation.go', params: { url: 'https://a.test' } },
    { id: 'b', type: 'action', name: 'Clear', capability: 'history.clear', params: {} },
    { id: 'c', type: 'action', name: 'Ghost', capability: 'tabs.teleport', params: {} },
    { id: 'd', type: 'confirm', name: 'Sure?', message: 'Send it?' },
    { id: 'e', type: 'repeat', name: 'Each', forEach: '{{items}}', as: 'item', steps: [{ id: 'f', type: 'action', name: 'Visit', capability: 'navigation.go', params: { url: '{{item}}' }, enabled: false }] }
  ]
  const lines = describeWorkflow(w, [cap('navigation.go', { name: 'Open an address' }), cap('history.clear', { name: 'Clear history', confirmation: 'always' })])
  assert.equal(lines[0].text, 'Open: Open an address (url “https://a.test”)')
  assert.equal(lines[1].approval, 'always')
  assert.match(lines[2].text, /not available in this Orbis/)
  assert.equal(lines[3].approval, 'always')
  assert.match(lines[4].text, /repeat for each item in “\{\{items\}\}”/)
  assert.equal(lines[5].depth, 1)
  assert.equal(lines[5].disabled, true)
})
