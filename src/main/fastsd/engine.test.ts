import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { FastSdEngine, ImageEngineError, chooseBackend, prepareInitImage, readImagePreferences, writeImagePreferences, cleanImagePreferences, readLastGeneration, type MachineInfo } from './engine.ts'

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

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const jpegBytes = Buffer.from(jpeg, 'base64')

test('a source picture is accepted as JPEG or PNG and refused otherwise, by its bytes', () => {
  assert.equal(prepareInitImage(`data:image/jpeg;base64,${jpeg}`).mime, 'image/jpeg')
  assert.equal(prepareInitImage(png).mime, 'image/png')
  assert.equal(prepareInitImage(jpeg).mime, 'image/jpeg') // bare base64
  // A PNG that calls itself a JPEG is judged by its bytes.
  assert.equal(prepareInitImage(`data:image/jpeg;base64,${png.toString('base64')}`).mime, 'image/png')
  assert.throws(() => prepareInitImage(`data:image/gif;base64,${jpeg}`), /JPEG or a PNG/)
  assert.throws(() => prepareInitImage(Buffer.from('GIF89a-not-a-jpeg-at-all')), /JPEG or a PNG/)
  assert.throws(() => prepareInitImage('data:image/png;base64,@@@'), /not valid image data/)
  assert.throws(() => prepareInitImage(Buffer.concat([jpegBytes, Buffer.alloc(8 * 1024 * 1024)])), /8 MB/)
  assert.throws(() => prepareInitImage('A'.repeat(12_000_000)), /8 MB/)
})

test('image to image sends the picture and a clamped strength; text to image does not', async () => {
  const seen: Record<string, unknown>[] = []
  const home = installed()
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: fakeServer(() => ({ images: [jpeg], error: '' }), seen), machine: intel16 })
  await engine.generate('a lake at dawn', { seed: 1, initImage: `data:image/jpeg;base64,${jpeg}`, strength: 5 })
  await engine.generate('a lake at dawn', { seed: 1, initImage: png, strength: 0 })
  await engine.generate('a lake at dawn', { seed: 1 })
  assert.equal(seen[0].diffusion_task, 'image_to_image')
  assert.equal(seen[0].init_image, jpeg)
  assert.equal(seen[0].strength, 0.95)
  assert.equal(seen[1].strength, 0.1)
  assert.equal(seen[1].init_image, png.toString('base64'))
  assert.equal(seen[2].diffusion_task, 'text_to_image')
  assert.equal('init_image' in seen[2], false)
})

test('a bad source picture is refused before the engine is touched', async () => {
  const home = installed()
  let calls = 0
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: (async () => { calls++; return new Response('{}') }) as typeof fetch, machine: intel16 })
  await assert.rejects(() => engine.generate('a lake', { initImage: Buffer.from('nope nope nope nope') }), (e: unknown) => e instanceof ImageEngineError && e.code === 'bad-request')
  assert.equal(calls, 0)
})

test('the chosen size and steps are used, and a measured time is recorded', async () => {
  const seen: Record<string, unknown>[] = []
  const home = installed()
  assert.deepEqual(readImagePreferences(home), { size: 512, steps: 1 })
  writeImagePreferences(home, { size: 768, steps: 3 })
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn: fakeServer(() => ({ images: [jpeg], error: '' }), seen), machine: intel16 })
  assert.equal(readLastGeneration(home), null)
  await engine.generate('a lake at dawn')
  assert.equal(seen[0].image_width, 768)
  assert.equal(seen[0].image_height, 768)
  assert.equal(seen[0].inference_steps, 3)
  const last = readLastGeneration(home)
  assert.ok(last && last.width === 768 && last.steps === 3 && last.seconds >= 0)
  // Anything the engine does not offer falls back rather than being passed on.
  assert.deepEqual(cleanImagePreferences({ size: 999, steps: 40 }), { size: 512, steps: 4 })
  assert.deepEqual(cleanImagePreferences('x'), { size: 512, steps: 1 })
})

test('a batch makes up to four, each with its own seed, and reports a partial failure', async () => {
  const seen: Record<string, unknown>[] = []
  const home = installed()
  let n = 0
  const fetchFn = fakeServer(() => (++n === 2 ? { images: [], error: 'out of memory' } : { images: [jpeg], error: '' }), seen)
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn, machine: intel16 })
  const out = await engine.generateMany('a lake at dawn', 9, {})
  assert.equal(seen.length, 4) // capped
  assert.equal(new Set(seen.map((b) => b.seed)).size, 4)
  assert.equal(out.results.length, 3)
  assert.equal(out.errors.length, 1)
  assert.equal(out.errors[0].index, 1)
  assert.equal(out.errors[0].code, 'engine-error')
  assert.equal(out.cancelled, false)
})

test('a batch does not start more pictures once its signal has fired', async () => {
  const home = installed()
  const ac = new AbortController()
  let calls = 0
  const fetchFn = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/api/')) return new Response(JSON.stringify({ message: 'Welcome to FastSD CPU API' }))
    calls++
    ac.abort()
    return new Response(JSON.stringify({ images: [jpeg], error: '' }))
  }) as typeof fetch
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn, machine: intel16 })
  const out = await engine.generateMany('a lake at dawn', 4, { signal: ac.signal })
  assert.equal(calls, 1)
  assert.equal(out.results.length, 1)
  assert.equal(out.cancelled, true)
})

/** A fake engine process the engine believes it started, plus a server that answers once it has "started". */
function cancellable(opts: { dies: boolean }) {
  const home = installed()
  let up = false
  const child = new EventEmitter() as EventEmitter & { pid: number; exitCode: number | null; signalCode: string | null; killed: boolean; stdout: EventEmitter; stderr: EventEmitter; kill(): boolean }
  child.pid = 4242
  child.exitCode = null
  child.signalCode = null
  child.killed = false
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  let killed = 0
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/api/')) {
      if (!up) throw new Error('refused')
      return new Response(JSON.stringify({ message: 'Welcome to FastSD CPU API' }))
    }
    // Inference that never finishes unless the request is abandoned.
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }) as typeof fetch
  const engine = new FastSdEngine({
    home,
    serveScript: join(home, 'serve.py'),
    fetchFn,
    machine: intel16,
    killTimeoutMs: 80,
    spawnFn: (() => { up = true; return child as unknown as ChildProcess }) as never,
    killFn: () => {
      killed++
      if (opts.dies) { child.exitCode = 1; child.emit('close', 1) }
    }
  })
  return { engine, child, killed: () => killed }
}

test('cancelling mid-inference ends the engine process and says cancelled only once it has exited', async () => {
  const { engine, child, killed } = cancellable({ dies: true })
  const ac = new AbortController()
  const outcome = engine.generate('a lake at dawn', { signal: ac.signal }).then(() => null, (e: unknown) => e)
  // Wait until the request is really in flight.
  while (engine.state().state !== 'generating') await new Promise((r) => setTimeout(r, 10))
  ac.abort()
  const err = await outcome
  assert.ok(err instanceof ImageEngineError)
  assert.equal(err.code, 'cancelled')
  assert.equal(killed(), 1)
  assert.notEqual(child.exitCode, null) // the process really went
  assert.equal(engine.state().state, 'stopped')
})

test('if the engine process does not exit, the cancel is not reported as done', async () => {
  const { engine } = cancellable({ dies: false })
  const ac = new AbortController()
  const outcome = engine.generate('a lake at dawn', { signal: ac.signal }).then(() => null, (e: unknown) => e)
  while (engine.state().state !== 'generating') await new Promise((r) => setTimeout(r, 10))
  ac.abort()
  const err = await outcome
  assert.ok(err instanceof ImageEngineError)
  assert.equal(err.code, 'not-stopped')
})

test('cancelling when this process did not start the engine does not claim it was stopped', async () => {
  const home = installed()
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/api/')) return new Response(JSON.stringify({ message: 'Welcome to FastSD CPU API' }))
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  }) as typeof fetch
  const engine = new FastSdEngine({ home, serveScript: join(home, 'serve.py'), fetchFn, machine: intel16 })
  const ac = new AbortController()
  const outcome = engine.generate('a lake at dawn', { signal: ac.signal }).then(() => null, (e: unknown) => e)
  while (engine.state().state !== 'generating') await new Promise((r) => setTimeout(r, 10))
  ac.abort()
  const err = await outcome
  assert.ok(err instanceof ImageEngineError)
  assert.equal(err.code, 'not-stopped')
})
