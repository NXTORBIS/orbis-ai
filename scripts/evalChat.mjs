/**
 * Runs every question in evals/questions.json through the real chat path (src/main/nim.ts streamChat with the system
 * prompt from src/main/prompt.ts) and saves the answers with measured metrics. No Electron needed: Node strips the
 * types from the .ts files.
 *
 *   node scripts/evalChat.mjs --label baseline [--model <id>] [--limit N] [--concurrency 2] [--out evals/runs/<label>.json]
 *                             [--effort low|medium|high|max] [--prompt-variant <name>] [--only id,id]
 *
 * Keys are read from .env / .env.local exactly as electron.vite.config.ts does (Vite loadEnv, GROQ_ and MISTRAL_
 * prefixes). They are never printed or written: every string that leaves this script goes through `scrub`.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)

const { streamChat } = await import('../src/main/nim.ts')
const { buildSystemPrompt } = await import('../src/main/prompt.ts')
const { DEFAULT_MODEL, isKnownModel, modelInfo, providerOf } = await import('../src/shared/models.ts')
const { analyzeAnswer } = await import('../src/shared/answerMetrics.ts')

// ---- keys, and making sure none of them can leak -------------------------------------------------------------
const env = loadEnv('development', root, ['GROQ_', 'MISTRAL_'])
const list = (v) => (v ?? '').split(/[\s,]+/).filter(Boolean)
const groqKeys = list(env.GROQ_API_KEY)
const mistralKeys = list(env.MISTRAL_API_KEY)
const secrets = [...groqKeys, ...mistralKeys].filter((k) => k.length >= 6)

/** Removes any key, any key-shaped token, and any Authorization value from text before it is shown or saved. */
function scrub(text, strict = true) {
  let out = String(text ?? '')
  for (const s of secrets) out = out.split(s).join('[key]')
  out = out.replace(/\b(?:gsk|sk|xai|pk)[-_][A-Za-z0-9_-]{8,}/g, '[key]').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [key]')
  // Error text only: any long unbroken token could be part of a key. A model's answer may legitimately contain hashes.
  return strict ? out.replace(/\b[A-Za-z0-9]{32,}\b/g, '[key]') : out
}

// ---- arguments -----------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 || i + 1 >= args.length ? fallback : args[i + 1]
}
const model = flag('model', DEFAULT_MODEL)
const label = flag('label', 'run').replace(/[^\w.-]+/g, '_')
const limit = Number(flag('limit', '0')) || 0
const concurrency = Math.max(1, Number(flag('concurrency', '2')) || 2)
const effort = flag('effort', 'high')
const variant = flag('prompt-variant', undefined)
const only = flag('only', '')
  ? flag('only', '').split(',')
  : null
if (!isKnownModel(model)) {
  console.error(`Unknown model "${model}". Use an id from src/shared/models.ts (default ${DEFAULT_MODEL}). Nothing was sent.`)
  process.exit(2)
}
const outPath = resolve(root, flag('out', `evals/runs/${label}.json`))

// ---- inputs --------------------------------------------------------------------------------------------------
let questions = JSON.parse(readFileSync(resolve(root, 'evals/questions.json'), 'utf8'))
if (only) questions = questions.filter((q) => only.includes(q.id))
if (limit > 0) questions = questions.slice(0, limit)

const settings = { assistantName: 'Orbis', userName: '', userTitle: '', systemPrompt: '' }
const systemPrompt = variant ? buildSystemPrompt(settings, new Date(), variant) : buildSystemPrompt(settings)

let run = { label, model, effort, promptVariant: variant ?? null, systemPrompt, startedAt: new Date().toISOString(), results: [] }
if (existsSync(outPath)) {
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'))
    if (prev && Array.isArray(prev.results)) {
      if (prev.model !== model) {
        console.error(`Refusing to resume: ${outPath} was run with a different model. Use another --label or --out.`)
        process.exit(2)
      }
      run = { ...prev, systemPrompt: prev.systemPrompt ?? systemPrompt }
      if (prev.systemPrompt && prev.systemPrompt !== systemPrompt) {
        console.error('Warning: the system prompt differs from the one in this file; resumed answers mix prompts.')
      }
    }
  } catch {
    console.error(`Could not read ${outPath}; starting it fresh.`)
  }
}

const done = new Set(run.results.filter((r) => !r.error).map((r) => r.id))
const todo = questions.filter((q) => !done.has(q.id))

if (providerOf(model) === 'mistral' ? mistralKeys.length === 0 : groqKeys.length === 0) {
  console.error(`No ${providerOf(model) === 'mistral' ? 'MISTRAL_API_KEY' : 'GROQ_API_KEY'} found in .env / .env.local. Nothing was sent.`)
  process.exit(1)
}

// ---- one question --------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One attempt. Returns what happened without ever throwing, and without any header or key in it. */
async function attempt(question) {
  let status = null
  const usagePending = []
  let usage = null
  const fetchFn = async (url, init) => {
    const res = await fetch(url, init)
    status = res.status
    if (res.ok && res.body) {
      const copy = res.clone()
      usagePending.push(
        copy
          .text()
          .then((t) => {
            for (const line of t.split('\n')) {
              if (!line.startsWith('data:') || !line.includes('"usage"')) continue
              try {
                const j = JSON.parse(line.slice(5))
                const u = j.usage ?? j.x_groq?.usage
                if (u && typeof u === 'object') usage = { prompt: u.prompt_tokens ?? null, completion: u.completion_tokens ?? null, total: u.total_tokens ?? null }
              } catch {}
            }
          })
          .catch(() => {})
      )
    }
    return res
  }
  let text = ''
  let usedModel = model
  let error = null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 180_000)
  const t0 = Date.now()
  try {
    await streamChat({
      apiKeys: groqKeys,
      mistralKeys,
      model,
      messages: [{ role: 'user', content: question.text }],
      systemPrompt,
      reasoningEffort: effort,
      autoFallback: false,
      signal: controller.signal,
      fetchFn,
      emit: (e) => {
        if (e.type === 'delta' && e.content) text += e.content
        else if (e.type === 'done') usedModel = e.model
        else if (e.type === 'error') error = e.message
        else if (e.type === 'aborted') error = 'timed out after 180 s'
      }
    })
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  } finally {
    clearTimeout(timer)
  }
  await Promise.allSettled(usagePending)
  if (!error && !text.trim()) error = 'the model returned an empty answer'
  // streamChat quietly hands over to other models when the chosen one fails (the larger-memory Mistral models are
  // always in its chain). An answer from a different model would make a before/after comparison meaningless.
  if (!error && usedModel !== model) error = `answered by ${usedModel} instead of ${model} (the chosen model failed and the app's own fallback took over)`
  return { text, usedModel, error: error === null ? null : scrub(error), status, usage, seconds: Math.round((Date.now() - t0) / 100) / 10 }
}

async function runQuestion(question) {
  let r = await attempt(question)
  // One retry, after a pause, when the service said "busy". Never a loop.
  if (r.error && r.status === 429) {
    console.log(`  ${question.id}: rate limited, waiting 20 s for one retry`)
    await sleep(20_000)
    r = await attempt(question)
  }
  const metrics = r.error ? null : analyzeAnswer(r.text, question.expect ?? {})
  return {
    id: question.id,
    bucket: question.bucket,
    question: question.text,
    expect: question.expect ?? null,
    answer: scrub(r.text, false),
    model: r.usedModel,
    seconds: r.seconds,
    usage: r.usage,
    metrics,
    error: r.error
  }
}

// ---- run, saving after every question ------------------------------------------------------------------------
function save() {
  const order = new Map(questions.map((q, i) => [q.id, i]))
  run.results.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
  run.updatedAt = new Date().toISOString()
  mkdirSync(dirname(outPath), { recursive: true })
  const tmp = `${outPath}.tmp`
  writeFileSync(tmp, JSON.stringify(run, null, 2))
  renameSync(tmp, outPath)
}

console.log(`Model ${model} (${modelInfo(model).label}) | ${questions.length} questions, ${done.size} already done, ${todo.length} to run | concurrency ${concurrency}`)
let next = 0
let failed = 0
async function worker() {
  while (next < todo.length) {
    const q = todo[next++]
    const result = await runQuestion(q)
    run.results = run.results.filter((x) => x.id !== q.id)
    run.results.push(result)
    save()
    if (result.error) failed++
    console.log(`  ${result.error ? 'FAIL' : 'ok  '} ${q.id.padEnd(11)} ${String(result.seconds).padStart(5)}s ${result.error ? scrub(result.error).slice(0, 120) : `${result.metrics.wordCount} words`}`)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
save()
console.log(`Saved ${run.results.length} results to ${outPath}${failed ? ` (${failed} failed; re-run the same command to retry only those)` : ''}`)
process.exit(failed && failed === todo.length ? 1 : 0)
