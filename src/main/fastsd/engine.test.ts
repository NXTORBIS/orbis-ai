import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FastSdEngine, ImageEngineError, chooseBackend, type MachineInfo } from './engine.ts'

const intel16: MachineInfo = { platform: 'win32', arch: 'x64', cpuModel: 'Intel(R) Core(TM) i7-12700', cores: 20, ramGb: 16 }

/** A real-looking installed tree, so the engine believes it is installed. */
function installed(): string {
  const home = mkdtempSync(join(tmpdir(), 'fastsd-'))
  const src = join(home, 'fastsdcpu')
  mkdirSync(join(src, 'src'), { recursive: true })
  mkdirSync(join(src, 'env', 'Scripts'), { recursive: true })
  writeFileSync(join(src, 'src', 'app.py'), '')
  writeFileSync(join(src, 'env', 'Scripts', 'python.exe'), '')
  writeFileSync(join(src, 'env', 'python'), '')
  writeFileSync(join(src, '.orbis-installed'), 'x\n')
  writeFileSync(join(home, 'serve.py'), '')
  return home
}

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])]).toString('base64')

function fakeServer(reply: (body: Record<string, unknown>) => unknown, seen: Record<string, unknown>[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.endsWith('/api/')) return new Response(JSON.stringify({ message: 'Welcome to FastSD CPU API' }))
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    seen.push(body)
    return new Response(JSON.stringify(reply(body)))
  }) as typeof fetch
}

test('the backend is chosen from the machine: OpenVINO only on Intel with enough memory', () => {
  assert.equal(chooseBackend(intel16).openvino, true)
  assert.equal(chooseBackend({ ...intel16, ramGb: 8 }).openvino, false)
  assert.equal(chooseBackend({ ...intel16, cpuModel: 'AMD Ryzen 7 5800X' }).openvino, false)
  assert.equal(chooseBackend({ ...intel16, arch: 'arm64' }).openvino, false)
  assert.equal(chooseBackend(intel16).modelId, 'stabilityai/sd-turbo')
})

test('a request reaches the documented endpoint with validated settings, and the picture is returned', async () => {
  const seen: Record<string, unknown>[] = []
  const home = installed()
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: fakeServer(() => ({ images: [jpeg], latency: 1.2, error: '' }), seen), machine: intel16 })
  const r = await engine.generate('a lake at dawn', { seed: 42, width: 700, height: 99999, steps: 99 })
  assert.match(r.dataUrl, /^data:image\/jpeg;base64,/)
  assert.equal(r.seed, 42)
  const b = seen[0]
  assert.equal(b.prompt, 'a lake at dawn')
  assert.equal(b.use_seed, true)
  assert.equal(b.image_width, 704) // rounded to a multiple of 64
  assert.equal(b.image_height, 1024) // clamped to upstream's largest size
  assert.equal(b.inference_steps, 8)
  assert.equal(b.diffusion_task, 'text_to_image')
  assert.equal(b.use_openvino, true)
  assert.equal(engine.state().state, 'ready')
})

test('an engine error is reported, not turned into a picture', async () => {
  const home = installed()
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: fakeServer(() => ({ images: [], latency: 0, error: 'out of memory' })), machine: intel16 })
  await assert.rejects(() => engine.generate('x y'), (e: unknown) => e instanceof ImageEngineError && e.code === 'engine-error' && /out of memory/.test(e.message))
})

test('data that is not a whole JPEG is refused', async () => {
  const home = installed()
  const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(400, 7)]).toString('base64')
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: fakeServer(() => ({ images: [truncated], error: '' })), machine: intel16 })
  await assert.rejects(() => engine.generate('x y'), (e: unknown) => e instanceof ImageEngineError && e.code === 'no-output')
})

test('empty and oversized descriptions are refused before anything runs', async () => {
  const home = installed()
  let calls = 0
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: (async () => { calls++; return new Response('{}') }) as typeof fetch, machine: intel16 })
  await assert.rejects(() => engine.generate('   '), (e: unknown) => e instanceof ImageEngineError && e.code === 'bad-request')
  await assert.rejects(() => engine.generate('a'.repeat(1001)), (e: unknown) => e instanceof ImageEngineError && e.code === 'bad-request')
  assert.equal(calls, 0)
})

test('without an install the state says so', () => {
  const engine = new FastSdEngine({ home: mkdtempSync(join(tmpdir(), 'fastsd-')), serveScript: 'x', machine: intel16 })
  assert.equal(engine.state().state, 'not-installed')
})

test('two requests never run at once', async () => {
  const home = installed()
  let active = 0
  let peak = 0
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/api/')) return new Response(JSON.stringify({ message: 'Welcome to FastSD CPU API' }))
    active++
    peak = Math.max(peak, active)
    await new Promise((r) => setTimeout(r, 40))
    active--
    return new Response(JSON.stringify({ images: [jpeg], error: '' }))
  }) as typeof fetch
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn, machine: intel16 })
  await Promise.all([engine.generate('one two'), engine.generate('three four')])
  assert.equal(peak, 1)
})
