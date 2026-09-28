import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BASE_RUNTIME_POLICY,
  SANDBOX_ASSUMPTIONS,
  SANDBOX_LIMITS,
  admit,
  checkRuntimePolicy,
  contentPolicyFor,
  createSandbox,
  isMessageProblem,
  isSandboxProblem,
  markReady,
  readMessage,
  recordFault,
  runtimePolicyFor,
  sandboxHealth,
  settle,
  stopSandbox,
  startupExpired,
  type Sandbox
} from './sandbox.ts'
import { originScope } from './capabilities.ts'

const PAGE = 'page_0123456789abcdef0123456789ab'
const SELF = 'orbis-page://page_0123456789abcdef0123456789ab'
const OPERATIONS = new Set(['units.convert', 'expression.evaluate', 'plot.sample'])

const sandbox = (over: Partial<Parameters<typeof createSandbox>[0]> = {}): Sandbox => {
  const made = createSandbox({
    pageId: PAGE,
    profileId: 'default',
    trust: 'system',
    granted: ['computation.arithmetic'],
    selfOrigin: SELF,
    now: 1000,
    ...over
  })
  assert.ok(!isSandboxProblem(made), `expected a sandbox, got ${JSON.stringify(made)}`)
  return markReady(made)
}

const scopes = (...texts: string[]): ReturnType<typeof originScope>[] => texts.map((one) => originScope(one))

describe('the runtime policy', () => {
  it('gives every Page the same closed base, whatever its trust level', () => {
    const builtIn = runtimePolicyFor({ trust: 'system', granted: [] })
    const imported = runtimePolicyFor({ trust: 'imported', granted: [] })
    assert.equal(builtIn.nodeIntegration, false)
    assert.equal(imported.nodeIntegration, false)
    assert.deepEqual({ ...builtIn, allowDevTools: false }, { ...imported, allowDevTools: false })
  })

  it('never hands a Page Node, a shared world, or a way out of the sandbox', () => {
    const policy = runtimePolicyFor({ trust: 'system', granted: ['computation.arithmetic'] })
    assert.equal(policy.nodeIntegration, false)
    assert.equal(policy.contextIsolation, true)
    assert.equal(policy.sandbox, true)
    assert.equal(policy.enableRemoteModule, false)
    assert.equal(policy.webSecurity, true)
    assert.equal(policy.preload, 'page-bridge')
  })

  it('never lets a Page navigate, open a window, or run eval', () => {
    const policy = runtimePolicyFor({ trust: 'system', granted: [] })
    assert.equal(policy.allowNavigation, false)
    assert.equal(policy.allowPopups, false)
    assert.equal(policy.allowEval, false)
  })

  it('allows WebAssembly only where it was granted', () => {
    assert.equal(runtimePolicyFor({ trust: 'system', granted: [] }).allowWebAssembly, false)
    assert.equal(runtimePolicyFor({ trust: 'system', granted: ['computation.wasm'] }).allowWebAssembly, true)
  })

  it('ties developer tools to the user turning them on, never to the Page being trusted', () => {
    assert.equal(runtimePolicyFor({ trust: 'system', granted: [] }).allowDevTools, false)
    assert.equal(runtimePolicyFor({ trust: 'imported', granted: [], developerMode: true }).allowDevTools, true)
  })

  it('accepts the base policy', () => {
    assert.deepEqual(checkRuntimePolicy(BASE_RUNTIME_POLICY), [])
  })

  it('refuses every single weakening on its own', () => {
    const weakenings: Partial<Record<string, unknown>>[] = [
      { nodeIntegration: true },
      { contextIsolation: false },
      { sandbox: false },
      { webSecurity: false },
      { enableRemoteModule: true },
      { allowNavigation: true },
      { allowPopups: true },
      { allowEval: true },
      { preload: 'something-else' }
    ]
    for (const weakening of weakenings) {
      const problems = checkRuntimePolicy({ ...BASE_RUNTIME_POLICY, ...weakening })
      assert.equal(problems.length, 1, `${JSON.stringify(weakening)} was not refused`)
      assert.ok(problems[0].message.length > 20, 'a refusal should say why')
    }
  })

  it('refuses a policy that is simply missing the settings, rather than treating absent as safe', () => {
    assert.ok(checkRuntimePolicy({}).length >= 8)
  })

  it('refuses developer tools on a frame that is not sandboxed', () => {
    const problems = checkRuntimePolicy({ ...BASE_RUNTIME_POLICY, sandbox: false as never, allowDevTools: true })
    assert.ok(problems.some((one) => one.field === 'allowDevTools'))
  })
})

describe('the content security policy', () => {
  it('starts from nothing and opens only what was granted', () => {
    const policy = contentPolicyFor({ granted: [], selfOrigin: SELF })
    assert.deepEqual([...policy.directives['default-src']], ["'none'"])
    assert.deepEqual([...policy.directives['connect-src']], ["'none'"])
    assert.deepEqual([...policy.directives['object-src']], ["'none'"])
    assert.deepEqual([...policy.directives['frame-src']], ["'none'"])
  })

  it('never permits inline script or eval, at any trust level', () => {
    for (const granted of [[], ['computation.wasm'], ['network.fetch']]) {
      const policy = contentPolicyFor({ granted, selfOrigin: SELF })
      assert.ok(!policy.header.includes("'unsafe-inline'"), policy.header)
      assert.ok(!policy.header.includes("'unsafe-eval'"), policy.header)
    }
  })

  it('says outright that a Page cannot generate and run code', () => {
    assert.ok(contentPolicyFor({ granted: [], selfOrigin: SELF }).notes.some((one) => /Inline script and eval/.test(one)))
  })

  it('permits only the origins that were granted', () => {
    const policy = contentPolicyFor({
      granted: ['network.fetch'],
      networkOrigins: scopes('https://api.example.com').filter((one) => one !== null),
      selfOrigin: SELF
    })
    assert.ok(policy.directives['connect-src'].includes('https://api.example.com'))
    assert.equal(policy.directives['connect-src'].length, 1)
  })

  it('writes a subdomain scope as a subdomain wildcard, leaving the apex out', () => {
    const policy = contentPolicyFor({
      granted: ['network.fetch'],
      networkOrigins: scopes('https://*.example.com').filter((one) => one !== null),
      selfOrigin: SELF
    })
    assert.ok(policy.directives['connect-src'].some((one) => one.includes('*.example.com')))
    assert.ok(!policy.directives['connect-src'].includes('https://example.com'))
  })

  it('permits nothing when the network was granted but no origin was', () => {
    const policy = contentPolicyFor({ granted: ['network.fetch'], networkOrigins: [], selfOrigin: SELF })
    assert.deepEqual([...policy.directives['connect-src']], ["'none'"])
    assert.ok(policy.notes.some((one) => /reaches nothing/.test(one)))
  })

  it('ignores origins supplied without the capability to use them', () => {
    const policy = contentPolicyFor({
      granted: [],
      networkOrigins: scopes('https://api.example.com').filter((one) => one !== null),
      selfOrigin: SELF
    })
    assert.deepEqual([...policy.directives['connect-src']], ["'none'"])
    assert.ok(policy.notes.some((one) => /ignored rather than applied/.test(one)))
  })

  it('adds the WebAssembly relaxation only when granted, and says what it does and does not allow', () => {
    const without = contentPolicyFor({ granted: [], selfOrigin: SELF })
    const with_ = contentPolicyFor({ granted: ['computation.wasm'], selfOrigin: SELF })
    assert.ok(!without.header.includes('wasm-unsafe-eval'))
    assert.ok(with_.directives['script-src'].includes("'wasm-unsafe-eval'"))
    assert.ok(with_.notes.some((one) => /JavaScript eval stays blocked/.test(one)))
  })

  it('keeps workers inside the Page’s own origin, so they inherit this policy', () => {
    const policy = contentPolicyFor({ granted: [], selfOrigin: SELF })
    assert.deepEqual([...policy.directives['worker-src']], [SELF])
  })

  it('refuses to let the Page be framed, frame anything, or submit a form', () => {
    const policy = contentPolicyFor({ granted: [], selfOrigin: SELF })
    assert.deepEqual([...policy.directives['frame-ancestors']], ["'none'"])
    assert.deepEqual([...policy.directives['child-src']], ["'none'"])
    assert.deepEqual([...policy.directives['form-action']], ["'none'"])
    assert.deepEqual([...policy.directives['base-uri']], ["'none'"])
  })

  it('produces a header that reads as a real policy', () => {
    const header = contentPolicyFor({ granted: [], selfOrigin: SELF }).header
    assert.match(header, /^default-src 'none'; /)
    assert.ok(header.split('; ').length >= 14)
  })
})

describe('reading a message', () => {
  it('accepts a well-formed request', () => {
    const request = readMessage({ id: 'r1', operation: 'units.convert', payload: { from: 'm' } }, OPERATIONS)
    assert.ok(!isMessageProblem(request))
    assert.equal(request.operation, 'units.convert')
  })

  it('has nowhere for a Page to state its own identity', () => {
    const request = readMessage(
      { id: 'r1', operation: 'units.convert', payload: {}, pageId: 'pg_someone_else', trust: 'system', granted: ['system.execute'] },
      OPERATIONS
    )
    assert.ok(!isMessageProblem(request))
    // The extra fields are not merely ignored downstream; they are not on the object at all.
    assert.deepEqual(Object.keys(request).sort(), ['id', 'operation', 'payload'])
  })

  it('refuses a message larger than the limit before trying to understand it', () => {
    const problem = readMessage(
      { id: 'r1', operation: 'units.convert', payload: 'x'.repeat(SANDBOX_LIMITS.messageBytes + 1) },
      OPERATIONS
    )
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'too-large')
  })

  it('refuses a message it cannot serialise at all', () => {
    const cyclic: Record<string, unknown> = { id: 'r1', operation: 'units.convert' }
    cyclic.self = cyclic
    const problem = readMessage(cyclic, OPERATIONS)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'malformed')
  })

  it('refuses anything that is not an object', () => {
    for (const raw of ['hello', 42, null, undefined, [1, 2, 3], true]) {
      assert.ok(isMessageProblem(readMessage(raw, OPERATIONS)), `${String(raw)} was accepted`)
    }
  })

  it('needs an id of a sensible length', () => {
    assert.ok(isMessageProblem(readMessage({ operation: 'units.convert' }, OPERATIONS)))
    assert.ok(isMessageProblem(readMessage({ id: '', operation: 'units.convert' }, OPERATIONS)))
    assert.ok(isMessageProblem(readMessage({ id: 'x'.repeat(129), operation: 'units.convert' }, OPERATIONS)))
  })

  it('refuses an operation name that is not shaped like one, before any lookup', () => {
    for (const operation of ['UNITS.CONVERT', 'units convert', '../../etc', 'units.', '.convert', 'units..convert', '']) {
      const problem = readMessage({ id: 'r1', operation }, OPERATIONS)
      assert.ok(isMessageProblem(problem), `"${operation}" was accepted`)
      assert.equal(problem.error, 'malformed')
    }
  })

  it('refuses an operation name that is absurdly long', () => {
    const problem = readMessage({ id: 'r1', operation: `a.${'b'.repeat(200)}` }, OPERATIONS)
    assert.ok(isMessageProblem(problem))
  })

  it('refuses a name it does not know', () => {
    const problem = readMessage({ id: 'r1', operation: 'system.execute' }, OPERATIONS)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'unknown-operation')
  })

  it('cannot be walked up a prototype chain', () => {
    // The classic: a plain-object lookup would find `Object.prototype.constructor` and treat it as a known operation.
    for (const operation of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const problem = readMessage({ id: 'r1', operation }, OPERATIONS)
      assert.ok(isMessageProblem(problem), `"${operation}" walked past the guard`)
    }
  })

  it('passes the payload through untouched, because validating it is the operation’s job', () => {
    const request = readMessage({ id: 'r1', operation: 'units.convert', payload: { deep: { thing: [1, 2] } } }, OPERATIONS)
    assert.ok(!isMessageProblem(request))
    assert.deepEqual(request.payload, { deep: { thing: [1, 2] } })
  })
})

describe('creating a box', () => {
  it('starts not ready, so nothing is accepted before the Page has started', () => {
    const made = createSandbox({ pageId: PAGE, profileId: 'default', trust: 'system', granted: [], selfOrigin: SELF, now: 0 })
    assert.ok(!isSandboxProblem(made))
    assert.equal(made.state, 'starting')
  })

  it('refuses something that is not a page id', () => {
    const problem = createSandbox({ pageId: 'not-an-id', profileId: 'default', trust: 'system', granted: [], selfOrigin: SELF, now: 0 })
    assert.ok(isSandboxProblem(problem))
    assert.equal(problem.error, 'invalid-page')
  })

  it('refuses a missing profile', () => {
    const problem = createSandbox({ pageId: PAGE, profileId: '', trust: 'system', granted: [], selfOrigin: SELF, now: 0 })
    assert.ok(isSandboxProblem(problem))
    assert.equal(problem.error, 'invalid-profile')
  })

  it('refuses an origin containing anything that could end a policy directive early', () => {
    for (const origin of ['orbis-page://a b', "orbis-page://a'", 'orbis-page://a;script-src *', 'not-an-origin', '']) {
      const problem = createSandbox({ pageId: PAGE, profileId: 'default', trust: 'system', granted: [], selfOrigin: origin, now: 0 })
      assert.ok(isSandboxProblem(problem), `"${origin}" was accepted`)
    }
  })

  it('drops a granted capability the registry has never heard of', () => {
    const made = createSandbox({
      pageId: PAGE,
      profileId: 'default',
      trust: 'imported',
      granted: ['computation.wasm', 'made.up.capability', 'constructor'],
      selfOrigin: SELF,
      now: 0
    })
    assert.ok(!isSandboxProblem(made))
    // The real one still took effect, and the invented ones opened nothing.
    assert.equal(made.policy.allowWebAssembly, true)
  })

  it('drops an origin that will not parse rather than putting the text in the policy', () => {
    const made = createSandbox({
      pageId: PAGE,
      profileId: 'default',
      trust: 'imported',
      granted: ['network.fetch'],
      networkOrigins: ["https://ok.example.com", "not an origin; script-src *"],
      selfOrigin: SELF,
      now: 0
    })
    assert.ok(!isSandboxProblem(made))
    assert.ok(!made.content.header.includes('script-src *'))
    assert.ok(made.content.directives['connect-src'].includes('https://ok.example.com'))
  })

  it('carries a policy that passes its own check', () => {
    assert.deepEqual(checkRuntimePolicy(sandbox().policy), [])
  })
})

describe('admitting messages', () => {
  const message = (id: string): unknown => ({ id, operation: 'units.convert', payload: {} })

  it('refuses everything until the Page says it is ready', () => {
    const made = createSandbox({ pageId: PAGE, profileId: 'default', trust: 'system', granted: [], selfOrigin: SELF, now: 0 })
    assert.ok(!isSandboxProblem(made))
    const problem = admit(made, message('r1'), OPERATIONS, 100)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'not-ready')
  })

  it('accepts a message once ready and records it as outstanding', () => {
    const result = admit(sandbox(), message('r1'), OPERATIONS, 1000)
    assert.ok(!isMessageProblem(result))
    assert.deepEqual([...result.sandbox.inFlight], ['r1'])
  })

  it('refuses a repeated request id, which would make two answers indistinguishable', () => {
    const first = admit(sandbox(), message('r1'), OPERATIONS, 1000)
    assert.ok(!isMessageProblem(first))
    const second = admit(first.sandbox, message('r1'), OPERATIONS, 1001)
    assert.ok(isMessageProblem(second))
    assert.match(second.message, /already outstanding/)
  })

  it('refuses more outstanding requests than the limit', () => {
    let box = sandbox()
    for (let i = 0; i < SANDBOX_LIMITS.inFlight; i++) {
      const result = admit(box, message(`r${i}`), OPERATIONS, 1000)
      assert.ok(!isMessageProblem(result))
      box = result.sandbox
    }
    const problem = admit(box, message('one-too-many'), OPERATIONS, 1000)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'too-many-in-flight')
  })

  it('throttles a Page sitting in a loop', () => {
    let box = sandbox()
    for (let i = 0; i < SANDBOX_LIMITS.messagesPerWindow; i++) {
      const result = admit(box, message(`r${i}`), OPERATIONS, 1000)
      if (isMessageProblem(result)) {
        // The in-flight limit bites first, which is correct; settle and keep going to reach the rate limit.
        assert.equal(result.error, 'too-many-in-flight')
        box = settle(box, box.inFlight[0])
        continue
      }
      box = settle(result.sandbox, `r${i}`)
    }
    const problem = admit(box, message('flood'), OPERATIONS, 1000)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'rate-limited')
  })

  it('lets the Page through again once the window has rolled over', () => {
    let box = sandbox()
    for (let i = 0; i < SANDBOX_LIMITS.messagesPerWindow; i++) {
      const result = admit(box, message(`r${i}`), OPERATIONS, 1000)
      if (isMessageProblem(result)) {
        box = settle(box, box.inFlight[0])
        continue
      }
      box = settle(result.sandbox, `r${i}`)
    }
    const later = admit(box, message('after'), OPERATIONS, 1000 + SANDBOX_LIMITS.windowMs + 1)
    assert.ok(!isMessageProblem(later))
  })

  it('refuses everything from a stopped box, for ever', () => {
    const stopped = stopSandbox(sandbox(), { kind: 'crashed', detail: 'the Page stopped responding' }, 2000)
    const problem = admit(stopped, message('r1'), OPERATIONS, 3000)
    assert.ok(isMessageProblem(problem))
    assert.equal(problem.error, 'stopped')
    // Marking it ready again does not bring it back.
    assert.equal(markReady(stopped).state, 'stopped')
  })

  it('clears outstanding requests when the box stops', () => {
    const result = admit(sandbox(), message('r1'), OPERATIONS, 1000)
    assert.ok(!isMessageProblem(result))
    assert.deepEqual([...stopSandbox(result.sandbox).inFlight], [])
  })

  it('counts a request as served when it settles', () => {
    const result = admit(sandbox(), message('r1'), OPERATIONS, 1000)
    assert.ok(!isMessageProblem(result))
    const settled = settle(result.sandbox, 'r1')
    assert.equal(settled.served, 1)
    assert.deepEqual([...settled.inFlight], [])
  })

  it('ignores settling something that was never outstanding', () => {
    const box = sandbox()
    assert.equal(settle(box, 'never-sent').served, 0)
  })

  it('leaves the original box untouched, so a stale reference cannot be acted on', () => {
    const box = sandbox()
    const result = admit(box, message('r1'), OPERATIONS, 1000)
    assert.ok(!isMessageProblem(result))
    assert.deepEqual([...box.inFlight], [], 'the original was mutated')
  })
})

describe('health and faults', () => {
  it('notices a Page that never finished starting', () => {
    const made = createSandbox({ pageId: PAGE, profileId: 'default', trust: 'system', granted: [], selfOrigin: SELF, now: 0 })
    assert.ok(!isSandboxProblem(made))
    assert.equal(startupExpired(made, SANDBOX_LIMITS.startupMs + 1), true)
    assert.equal(startupExpired(made, 100), false)
    assert.ok(sandboxHealth(made, SANDBOX_LIMITS.startupMs + 1).describe.some((one) => /not started within the time allowed/.test(one)))
  })

  it('reports a running Page as running', () => {
    const health = sandboxHealth(sandbox(), 1000)
    assert.equal(health.state, 'ready')
    assert.ok(health.describe.includes('Running normally.'))
  })

  it('reports how much of the request budget is used', () => {
    let box = sandbox()
    for (let i = 0; i < 110; i++) {
      const result = admit(box, { id: `r${i}`, operation: 'units.convert' }, OPERATIONS, 1000)
      if (isMessageProblem(result)) {
        box = settle(box, box.inFlight[0])
        continue
      }
      box = settle(result.sandbox, `r${i}`)
    }
    const health = sandboxHealth(box, 1000)
    assert.ok(health.load > 0.8, `load was ${health.load}`)
    assert.ok(health.describe.some((one) => /request budget/.test(one)))
  })

  it('never reports a load above one', () => {
    assert.ok(sandboxHealth(sandbox(), 1000).load <= 1)
  })

  it('keeps faults and shows the most recent ones', () => {
    let box = sandbox()
    for (let i = 0; i < 5; i++) box = recordFault(box, { kind: 'operation-timeout', detail: `timed out ${i}` }, 1000 + i)
    const health = sandboxHealth(box, 1000)
    assert.equal(health.faults, 5)
    assert.ok(health.describe.includes('timed out 4'))
    assert.ok(!health.describe.includes('timed out 0'), 'only the recent ones belong in a summary')
  })

  it('records the fault that stopped the box', () => {
    const stopped = stopSandbox(sandbox(), { kind: 'policy-violation', detail: 'tried to navigate' }, 5000)
    assert.equal(stopped.faults.length, 1)
    assert.equal(stopped.faults[0].at, 5000)
    assert.equal(stopped.faults[0].kind, 'policy-violation')
  })

  it('reports a stopped box as stopped', () => {
    assert.equal(sandboxHealth(stopSandbox(sandbox()), 1000).state, 'stopped')
  })
})

describe('assumptions', () => {
  it('states what the box protects against', () => {
    assert.ok(SANDBOX_ASSUMPTIONS.length >= 7)
    assert.ok(SANDBOX_ASSUMPTIONS.some((one) => /never states its own identity/.test(one)))
    assert.ok(SANDBOX_ASSUMPTIONS.some((one) => /Inline script and eval are refused/.test(one)))
  })

  it('states outright that it is not a defence against a browser-engine exploit', () => {
    assert.ok(SANDBOX_ASSUMPTIONS.some((one) => /not a defence against an exploit of the browser engine/.test(one)))
  })
})
