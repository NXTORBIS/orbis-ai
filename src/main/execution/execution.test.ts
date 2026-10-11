import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ExecutionService } from './service.ts'
import { isExecutionError, type RunResult } from '../../shared/cs/execution.ts'

/**
 * The Code Playground's runner, driven against a fake sandbox.
 *
 * The one thing these exist to protect is the line between a run and a guess. Both produce text that looks the
 * same on a screen, so every test checks not only the output but where it came from — and that a prediction
 * reports no running time and no memory, because nothing ran and inventing those is the easiest possible lie.
 *
 * They also check the fallback keeps its reason. That was quietly lost once: the reason a sandbox was skipped sat
 * in a field the laboratory never drew, so somebody with a wrong key would have seen "Orion thinks…" and no hint
 * at all that their sandbox had refused them.
 */

/** A Judge0 that behaves like the real one: accepts a submission, queues it for a poll or two, then answers. */
const fakeJudge0 = (reply: Record<string, unknown>, refuseWith = 0): typeof globalThis.fetch => {
  let polls = 0
  return (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.includes('/submissions?')) {
      if (refuseWith !== 0) return new Response('no', { status: refuseWith })
      return new Response(JSON.stringify({ token: 'tok-1' }), { status: 200 })
    }
    polls += 1
    // Queued for the first two polls, exactly as the real one does.
    if (polls <= 2) return new Response(JSON.stringify({ status: { id: 1, description: 'In Queue' } }), { status: 200 })
    return new Response(JSON.stringify(reply), { status: 200 })
  }) as typeof globalThis.fetch
}

const ran = (value: RunResult | { error: string }): RunResult => {
  assert.ok(!isExecutionError(value), `refused: ${isExecutionError(value) ? value.message : ''}`)
  return value as RunResult
}

test('a real run goes through the sandbox and says it really ran', async () => {
  const service = new ExecutionService({
    settings: async () => ({ url: 'https://example.test', key: 'k', keyHeader: 'X-Auth-Token' }),
    ask: async () => assert.fail('Orion must not be asked when the sandbox works'),
    fetch: fakeJudge0({
      status: { id: 3, description: 'Accepted' },
      stdout: 'Hello, Sam\n',
      stderr: null,
      compile_output: null,
      time: '0.012',
      memory: 3200,
      exit_code: 0
    })
  })
  const got = ran(await service.run({ language: 'python', source: 'print("hi")', stdin: 'Sam\n' }))
  assert.equal(got.origin, 'ran')
  assert.equal(got.verdict, 'ok')
  assert.equal(got.stdout.trim(), 'Hello, Sam')
  // A real run has both of these. A prediction has neither, and that asymmetry is the point.
  assert.equal(got.seconds, 0.012)
  assert.equal(got.memoryKb, 3200)
  assert.equal(got.exitCode, 0)
})

test('with no sandbox it asks Orion, and nothing pretends otherwise', async () => {
  const service = new ExecutionService({
    settings: async () => ({ url: '', key: '', keyHeader: 'X-Auth-Token' }),
    ask: async () => 'OUTPUT:\nHello, Sam\nWHY: it prints a greeting',
    fetch: (async () => assert.fail('the sandbox must not be called when there is none')) as unknown as typeof globalThis.fetch
  })
  const got = ran(await service.run({ language: 'python', source: 'print("hi")', stdin: 'Sam\n' }))
  assert.equal(got.origin, 'predicted')
  assert.equal(got.seconds, null, 'a reading has no running time')
  assert.equal(got.memoryKb, null, 'a reading has no memory figure')
  assert.ok(got.says.trim() !== '', 'it must say something about where this came from')
  // Matched on what it means rather than on the words "no sandbox", which the wording no longer uses: it says
  // Orion read the code instead of running it, which is the thing somebody has to understand.
  assert.ok(
    got.notes.some((one) => /reading the code rather than running it/i.test(one)),
    `the reason should be kept: ${got.notes.join(' | ')}`
  )
})

test('a sandbox that refuses falls back, and keeps the reason it fell back', async () => {
  const service = new ExecutionService({
    settings: async () => ({ url: 'https://example.test', key: 'wrong', keyHeader: 'X-Auth-Token' }),
    ask: async () => 'OUTPUT:\n42\nWHY: it prints the answer',
    fetch: fakeJudge0({}, 401)
  })
  const got = ran(await service.run({ language: 'python', source: 'print(42)', stdin: '' }))
  assert.equal(got.origin, 'predicted')
  // Somebody with a wrong key has to be able to find that out from the screen.
  assert.ok(got.notes.some((one) => /401|key/i.test(one)), `the failure should be named: ${got.notes.join(' | ')}`)
})

test('with neither available it refuses rather than inventing output', async () => {
  const service = new ExecutionService({
    settings: async () => ({ url: '', key: '', keyHeader: 'X-Auth-Token' }),
    ask: async () => null,
    fetch: (async () => new Response('', { status: 500 })) as typeof globalThis.fetch
  })
  const got = await service.run({ language: 'python', source: 'print(1)', stdin: '' })
  assert.ok(isExecutionError(got), 'no output is better than made-up output')
  assert.match(got.fix, /Settings/i)
})

test('a compile error comes back as one, and still counts as having run', async () => {
  const service = new ExecutionService({
    settings: async () => ({ url: 'https://example.test', key: '', keyHeader: 'X-Auth-Token' }),
    ask: async () => assert.fail('should not be asked'),
    fetch: fakeJudge0({
      status: { id: 6, description: 'Compilation Error' },
      stdout: null,
      stderr: null,
      compile_output: "main.c:2:3: error: expected ';'",
      time: null,
      memory: null,
      exit_code: null
    })
  })
  const got = ran(await service.run({ language: 'c', source: 'int main(){return 0}', stdin: '' }))
  assert.equal(got.verdict, 'compile-error')
  assert.match(got.compileOutput, /expected/)
  // It failed, but a real compiler failed it. That is not the same as a guess that it would fail.
  assert.equal(got.origin, 'ran')
})

test('rubbish is refused before anything is sent anywhere', async () => {
  let called = false
  const service = new ExecutionService({
    settings: async () => ({ url: 'https://example.test', key: '', keyHeader: 'X-Auth-Token' }),
    ask: async () => 'x',
    fetch: (async () => {
      called = true
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch
  })
  assert.ok(isExecutionError(await service.run({ language: 'not-a-language', source: 'x', stdin: '' })))
  assert.ok(isExecutionError(await service.run({ language: 'python', source: '', stdin: '' })))
  assert.ok(isExecutionError(await service.run({ language: 'python', source: 'x'.repeat(200_000), stdin: '' })))
  assert.equal(called, false, 'nothing should have left this machine')
})

test('asking for a prediction on purpose skips the sandbox even when there is one', async () => {
  let touched = false
  const service = new ExecutionService({
    settings: async () => ({ url: 'https://example.test', key: 'k', keyHeader: 'X-Auth-Token' }),
    ask: async () => 'OUTPUT:\n7',
    fetch: (async () => {
      touched = true
      return new Response('{}', { status: 200 })
    }) as typeof globalThis.fetch
  })
  const got = ran(await service.run({ language: 'python', source: 'print(7)', stdin: '', predictOnly: true }))
  assert.equal(got.origin, 'predicted')
  assert.equal(touched, false, 'the sandbox should not have been touched')
})

test('ready() says what will happen before anybody presses Run', async () => {
  const withSandbox = new ExecutionService({ settings: async () => ({ url: 'https://x.test', key: '', keyHeader: 'X' }), ask: async () => '' })
  const without = new ExecutionService({ settings: async () => ({ url: '', key: '', keyHeader: 'X' }), ask: async () => '' })
  assert.equal((await withSandbox.ready()).sandbox, true)
  const none = await without.ready()
  assert.equal(none.sandbox, false)
  // Somebody must not press Run expecting a real answer and get a reading without warning. Matched on the
  // distinction rather than on the word "guess", which the wording deliberately stopped using -- it reads as a
  // judgement about the model rather than a statement about what happened.
  assert.match(none.says, /reading rather than a run/i)
})
