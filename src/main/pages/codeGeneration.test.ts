import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { CODE_INSTRUCTIONS, CODE_MODEL, CodeGeneration } from './codeGeneration.ts'

const workable = {
  title: 'Bouncing ball',
  purpose: 'Shows a ball bouncing.',
  body: '<canvas id="c"></canvas>',
  style: 'canvas { width: 100%; }',
  script: "const c = document.getElementById('c')",
  notes: ['Air resistance is ignored.']
}

/** A generator whose model answers whatever the test says, in order. */
const withAnswers = (answers: (Record<string, unknown> | null)[]) => {
  const asked: { system: string; user: string; model?: string }[] = []
  const gen = new CodeGeneration({
    apiKeys: async () => ['groq'],
    mistralKeys: () => ['mistral'],
    fetchFn: (async () => new Response('')) as never,
    ask: async (system, user, _keys, _fetchFn, _ms, options) => {
      asked.push({ system, user, model: options.model })
      return answers[asked.length - 1] ?? null
    }
  })
  return { gen, asked }
}

test('a workable answer becomes three files', async () => {
  const { gen, asked } = withAnswers([workable])
  const out = await gen.build('a bouncing ball')
  assert.deepEqual(out.files?.map((f) => f.path).sort(), ['index.html', 'page.css', 'page.js'])
  assert.equal(out.spec?.title, 'Bouncing ball')
  assert.equal(asked.length, 1, 'a workable answer is not argued with')
  assert.equal(asked[0].model, CODE_MODEL, 'the model built for code is the one asked')
})

test('a bad answer is argued with once, and the complaint is specific', async () => {
  /*
   * The second attempt is given what was wrong rather than being asked again from nothing. The failures here are
   * specific -- "the body contains a script tag" -- and a specific complaint is something a model can act on.
   */
  const { gen, asked } = withAnswers([{ ...workable, body: '<div></div><script>go()</script>' }, workable])
  const out = await gen.build('a bouncing ball')
  assert.ok(out.files, 'the second attempt was accepted')
  assert.equal(asked.length, 2)
  assert.match(asked[1].user, /did not work/)
  assert.match(asked[1].user, /inline scripts are blocked/)
})

test('two bad answers stop, rather than going round for ever', async () => {
  const bad = { ...workable, script: 'fetch("https://x")' }
  const { gen, asked } = withAnswers([bad, bad])
  const out = await gen.build('fetch some data')
  assert.equal(out.files, null)
  assert.equal(asked.length, 2, 'asked twice and no more')
  assert.equal(out.attempts.length, 2)
  assert.ok(out.attempts[0].problems.some((p) => /orbis\.request/.test(p)), 'and the reason is kept')
})

test('nothing coming back is not argued with, because there is nothing to complain about', async () => {
  const { gen, asked } = withAnswers([null, null])
  const out = await gen.build('anything')
  assert.equal(out.files, null)
  assert.equal(asked.length, 1, 'asking again unchanged would be the same coin flipped')
})

test('with no Mistral key there is no code route, and nothing is requested', async () => {
  // Codestral is Mistral's. Saying so beats making a request that cannot be authenticated.
  let asks = 0
  const gen = new CodeGeneration({
    apiKeys: async () => ['groq'],
    mistralKeys: () => [],
    fetchFn: (async () => new Response('')) as never,
    ask: async () => {
      asks += 1
      return workable
    }
  })
  const out = await gen.build('a bouncing ball')
  assert.equal(out.files, null)
  assert.equal(asks, 0)
})

test('the instructions name every rule the checker enforces', () => {
  // A rule enforced but never stated is a rule the model fails for reasons it was never told.
  for (const rule of ['<script>', 'inline handler', 'fetch', 'eval', 'localStorage', 'window.open', 'iframe', 'orbis.request']) {
    assert.ok(CODE_INSTRUCTIONS.includes(rule) || CODE_INSTRUCTIONS.toLowerCase().includes(rule.toLowerCase()), `the instructions never mention ${rule}`)
  }
})
