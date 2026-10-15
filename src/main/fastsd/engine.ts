import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, homedir } from 'node:os'
import { join } from 'node:path'

/**
 * FastSDCPU, run locally. Node-only (no Electron) so the app and the helper process can both use it.
 *
 * Upstream: https://github.com/rupeshs/fastsdcpu (MIT). The source is pinned to PINNED_COMMIT, installed into its own
 * folder with its own Python environment, and driven through its documented REST API (`POST /api/generate`,
 * `GET /api/` for liveness). Upstream's server binds 0.0.0.0, so it is started through serve_local.py which runs the
 * same app on 127.0.0.1 only.
 */
export const PINNED_COMMIT = 'b5e5cab5c2ad369c56f52b34cd61d010efa489f1'
export const UPSTREAM_URL = 'https://github.com/rupeshs/fastsdcpu.git'
export const PORT = 17861
const win = process.platform === 'win32'

export type EngineStateName = 'not-installed' | 'installing' | 'stopped' | 'starting' | 'ready' | 'generating' | 'failed'

export interface EngineState { state: EngineStateName; detail: string; backend: Backend | null }

export interface Backend {
  /** Intel OpenVINO runs the model faster on Intel CPUs; PyTorch works everywhere. */
  openvino: boolean
  modelId: string
  openvinoModelId: string
  tinyAutoEncoder: boolean
  reason: string
}

export interface MachineInfo { platform: string; arch: string; cpuModel: string; cores: number; ramGb: number }

export function machineInfo(): MachineInfo {
  const c = cpus()
  return { platform: process.platform, arch: process.arch, cpuModel: c[0]?.model ?? 'unknown', cores: c.length, ramGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10 }
}

/**
 * Picks the model and runtime from the machine, using only what upstream documents:
 * SD Turbo (default model) and its OpenVINO build, with the tiny auto-encoder for speed. OpenVINO needs an Intel CPU and
 * about 9 GB of RAM with the tiny auto-encoder (upstream's table); plain PyTorch needs about 2 GB.
 */
export function chooseBackend(m: MachineInfo): Backend {
  const intel = /intel/i.test(m.cpuModel) && m.arch === 'x64'
  const base = { modelId: 'stabilityai/sd-turbo', openvinoModelId: 'rupeshs/sd-turbo-openvino', tinyAutoEncoder: true }
  if (intel && m.ramGb >= 12) return { ...base, openvino: true, reason: 'Intel CPU with enough memory: OpenVINO build of SD Turbo with the tiny auto-encoder.' }
  if (intel) return { ...base, openvino: false, reason: `Intel CPU but only ${m.ramGb} GB of memory (OpenVINO needs about 9 GB free): PyTorch SD Turbo.` }
  return { ...base, openvino: false, reason: 'OpenVINO needs an Intel CPU: PyTorch SD Turbo.' }
}

export interface GenerateOptions {
  seed?: number
  width?: number
  height?: number
  steps?: number
  negativePrompt?: string
  /** A picture to start from (data URL, bare base64, or bytes): JPEG or PNG, at most 8 MB. Turns the request into image-to-image. */
  initImage?: string | Uint8Array
  /** How far the result may move away from `initImage`: 0.1 (close) to 0.95 (almost new). Default 0.6, upstream's own. */
  strength?: number
  signal?: AbortSignal
  onStatus?: (message: string) => void
}

export const MAX_BATCH = 4
export const MAX_INIT_IMAGE_BYTES = 8 * 1024 * 1024
export const IMAGE_SIZES = [512, 640, 768, 1024] as const
export const IMAGE_STEP_RANGE = { min: 1, max: 4 } as const

export interface ImagePreferences { size: number; steps: number }
export const DEFAULT_IMAGE_PREFERENCES: ImagePreferences = { size: 512, steps: 1 }

/** Checks a stored or supplied preference; anything unknown becomes the default rather than being passed along. */
export function cleanImagePreferences(raw: unknown): ImagePreferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const size = (IMAGE_SIZES as readonly number[]).includes(r.size as number) ? (r.size as number) : DEFAULT_IMAGE_PREFERENCES.size
  const stepsRaw = typeof r.steps === 'number' && Number.isFinite(r.steps) ? Math.round(r.steps) : DEFAULT_IMAGE_PREFERENCES.steps
  return { size, steps: Math.min(IMAGE_STEP_RANGE.max, Math.max(IMAGE_STEP_RANGE.min, stepsRaw)) }
}

/**
 * The size and step count the person chose. Kept in a small file beside the engine so that every process that draws
 * (the window's main process and the helper) uses the same choice without sharing a settings store.
 */
export function readImagePreferences(home: string): ImagePreferences {
  try { return cleanImagePreferences(JSON.parse(readFileSync(join(home, 'preferences.json'), 'utf8'))) } catch { return { ...DEFAULT_IMAGE_PREFERENCES } }
}

export function writeImagePreferences(home: string, prefs: unknown): ImagePreferences {
  const clean = cleanImagePreferences(prefs)
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'preferences.json'), JSON.stringify(clean))
  return clean
}

export interface LastGeneration { seconds: number; at: number; width: number; height: number; steps: number; imageToImage: boolean }

export function readLastGeneration(home: string): LastGeneration | null {
  try {
    const j = JSON.parse(readFileSync(join(home, 'last-generation.json'), 'utf8')) as Partial<LastGeneration>
    return typeof j.seconds === 'number' && Number.isFinite(j.seconds) && typeof j.at === 'number'
      ? { seconds: j.seconds, at: j.at, width: Number(j.width) || 0, height: Number(j.height) || 0, steps: Number(j.steps) || 0, imageToImage: j.imageToImage === true }
      : null
  } catch { return null }
}

export interface PreparedInitImage { base64: string; mime: 'image/jpeg' | 'image/png'; bytes: number }

/**
 * Validates a source picture. The type is decided by the bytes, never by what the data URL claims, and a picture over
 * 8 MB is refused before it is decoded.
 */
export function prepareInitImage(input: string | Uint8Array): PreparedInitImage {
  let base64: string
  let bytes: Buffer
  if (typeof input === 'string') {
    const m = /^data:([^;,]+);base64,/i.exec(input)
    if (m && !/^image\/(png|jpe?g)$/i.test(m[1])) throw new ImageEngineError('bad-request', 'The source picture must be a JPEG or a PNG.')
    base64 = (m ? input.slice(m[0].length) : input).replace(/\s+/g, '')
    if (base64.length > Math.ceil((MAX_INIT_IMAGE_BYTES * 4) / 3) + 8) throw new ImageEngineError('bad-request', 'The source picture is larger than 8 MB.')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ImageEngineError('bad-request', 'The source picture is not valid image data.')
    bytes = Buffer.from(base64, 'base64')
  } else {
    if (input.byteLength > MAX_INIT_IMAGE_BYTES) throw new ImageEngineError('bad-request', 'The source picture is larger than 8 MB.')
    bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength)
    base64 = bytes.toString('base64')
  }
  if (bytes.length > MAX_INIT_IMAGE_BYTES) throw new ImageEngineError('bad-request', 'The source picture is larger than 8 MB.')
  const jpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (!jpeg && !png) throw new ImageEngineError('bad-request', 'The source picture must be a JPEG or a PNG.')
  return { base64, mime: jpeg ? 'image/jpeg' : 'image/png', bytes: bytes.length }
}

export interface GenerateManyResult {
  results: GenerateResult[]
  errors: { index: number; code: ImageEngineError['code'] | 'unknown'; message: string }[]
  /** True when the signal fired and the remaining pictures were not attempted. */
  cancelled: boolean
}

export interface GenerateResult {
  /** data: URL of the JPEG upstream returns. */
  dataUrl: string
  seed: number
  seconds: { total: number; engineStart: number; generation: number }
  backend: Backend
}

/** Asks uv where a Python of this version lives. */
function findPython(version: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('uv', ['python', 'find', version], { windowsHide: true }, (err, stdout) => {
      const path = String(stdout).trim().split(String.fromCharCode(10))[0].trim()
      resolve(!err && path && existsSync(path) ? path : null)
    })
  })
}

export class ImageEngineError extends Error {
  readonly code: 'not-installed' | 'install-failed' | 'start-failed' | 'bad-request' | 'engine-error' | 'no-output' | 'cancelled' | 'not-stopped' | 'busy'
  constructor(code: ImageEngineError['code'], message: string) {
    super(message)
    this.name = 'ImageEngineError'
    this.code = code
  }
}

export interface EngineOptions {
  /** Folder that holds the source, environment and logs. */
  home: string
  /** serve_local.py, shipped in resources/fastsd. */
  serveScript: string
  port?: number
  /** Replaceable in tests. */
  fetchFn?: typeof fetch
  spawnFn?: typeof spawn
  machine?: MachineInfo
  /** Ends the engine process (and its children). Replaceable in tests. */
  killFn?: (child: ChildProcess) => void
  /** How long to wait for the process to be gone after killing it. */
  killTimeoutMs?: number
}

const clampDim = (v: number | undefined, fallback: number): number => {
  const n = Math.round((v ?? fallback) / 64) * 64
  return Math.min(1024, Math.max(256, Number.isFinite(n) ? n : fallback))
}

export class FastSdEngine {
  private readonly o: EngineOptions
  private readonly port: number
  private child: ChildProcess | null = null
  private installing: Promise<void> | null = null
  private starting: Promise<void> | null = null
  private busy = false
  private current: EngineStateName = 'stopped'
  private detail = ''
  readonly log: string[] = []

  constructor(o: EngineOptions) {
    this.o = o
    this.port = o.port ?? PORT
  }

  private get fetchFn(): typeof fetch { return this.o.fetchFn ?? fetch }
  get src(): string { return join(this.o.home, 'fastsdcpu') }
  get python(): string { return join(this.src, 'env', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python') }
  private get base(): string { return `http://127.0.0.1:${this.port}` }

  isInstalled(): boolean { return existsSync(join(this.src, 'src', 'app.py')) && existsSync(this.python) && existsSync(join(this.src, '.orbis-installed')) }

  backend(): Backend { return chooseBackend(this.o.machine ?? machineInfo()) }

  state(): EngineState {
    if (this.installing) return { state: 'installing', detail: this.detail, backend: null }
    if (!this.isInstalled() && this.current !== 'failed') return { state: 'not-installed', detail: 'The local image engine has not been installed yet.', backend: null }
    return { state: this.current, detail: this.detail, backend: this.backend() }
  }

  private note(line: string): void {
    this.log.push(line.slice(0, 300))
    if (this.log.length > 300) this.log.splice(0, 150)
    this.detail = line.slice(0, 200)
  }

  private run(cmd: string, args: string[], cwd: string, signal?: AbortSignal): Promise<number> {
    return new Promise((resolve) => {
      const c = (this.o.spawnFn ?? spawn)(cmd, args, { cwd, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      const pipe = (b: Buffer): void => { for (const l of b.toString('utf8').split(/\r?\n/)) if (l.trim()) this.note(l.trim()) }
      c.stdout?.on('data', pipe)
      c.stderr?.on('data', pipe)
      c.on('error', (e) => { this.note(`could not start ${cmd}: ${e.message}`); resolve(-1) })
      c.on('close', (code) => resolve(code ?? -1))
      signal?.addEventListener('abort', () => c.kill(), { once: true })
    })
  }

  /** Clones the pinned source and builds the isolated environment exactly as upstream's install.bat does. Safe to repeat. */
  install(onStatus?: (m: string) => void, signal?: AbortSignal): Promise<void> {
    if (this.installing) return this.installing
    this.installing = (async () => {
      const say = (m: string): void => { this.note(m); onStatus?.(m) }
      this.current = 'stopped'
      try {
        if (this.busy) throw new ImageEngineError('busy', 'The image engine is drawing a picture. Repair it when that has finished.')
        // Packages cannot be replaced under a running engine.
        if (this.child) await this.terminate()
        mkdirSync(this.o.home, { recursive: true })
        if (!existsSync(join(this.src, 'src', 'app.py'))) {
          say('Downloading the image engine source…')
          if ((await this.run('git', ['clone', UPSTREAM_URL, 'fastsdcpu'], this.o.home, signal)) !== 0) throw new Error('Downloading the image engine failed.')
        }
        say('Checking out the tested version…')
        if ((await this.run('git', ['checkout', '-q', PINNED_COMMIT], this.src, signal)) !== 0) throw new Error('Could not select the tested engine version.')
        if (!existsSync(this.python)) {
          say('Creating the engine environment…')
          let made = await this.run('uv', ['venv', '--python', '3.11.6', 'env'], this.src, signal)
          if (made !== 0) {
            // uv sometimes fails to link a freshly downloaded interpreter; the interpreter itself is fine, so use its path.
            const found = await findPython('3.11')
            if (found) made = await this.run('uv', ['venv', '--python', found, 'env'], this.src, signal)
          }
          if (made !== 0) throw new Error('Creating the engine environment failed (is uv installed?).')
        }
        say('Installing the engine runtime (this is large, first time only)…')
        if ((await this.run('uv', ['pip', 'install', '--python', this.python, 'torch==2.8.0', '--index-url', 'https://download.pytorch.org/whl/cpu'], this.src, signal)) !== 0) throw new Error('Installing the engine runtime failed.')
        if ((await this.run('uv', ['pip', 'install', '--python', this.python, '-r', 'requirements.txt'], this.src, signal)) !== 0) throw new Error('Installing the engine packages failed.')
        writeFileSync(join(this.src, '.orbis-installed'), `${PINNED_COMMIT}\n`)
        this.current = 'stopped'
        say('Image engine installed.')
      } catch (e) {
        this.current = 'failed'
        const msg = e instanceof Error ? e.message : 'Installation failed.'
        this.note(msg)
        throw new ImageEngineError('install-failed', msg)
      } finally {
        this.installing = null
      }
    })()
    return this.installing
  }

  private async alive(): Promise<boolean> {
    try {
      const r = await this.fetchFn(`${this.base}/api/`, { signal: AbortSignal.timeout(1500) })
      if (!r.ok) return false
      const j = (await r.json()) as { message?: string }
      return typeof j.message === 'string' && /FastSD/i.test(j.message)
    } catch {
      return false
    }
  }

  /** Starts the local server unless one is already answering (this process or another Orbis process). */
  private start(onStatus?: (m: string) => void): Promise<void> {
    if (this.starting) return this.starting
    this.starting = (async () => {
      try {
        if (await this.alive()) { this.current = 'ready'; return }
        this.current = 'starting'
        onStatus?.('Starting the image engine…')
        const lock = join(this.o.home, 'start.lock')
        let held = false
        try { closeSync(openSync(lock, 'wx')); held = true } catch { /* another process is starting it */ }
        try {
          if (held) {
            const script = this.o.serveScript
            if (!existsSync(script)) throw new ImageEngineError('start-failed', 'The image engine launcher is missing from this installation.')
            const env = { ...process.env, PORT_ORBIS: String(this.port), PYTHONIOENCODING: 'utf-8', PATH: `${join(this.src, 'env', 'Lib', 'site-packages', 'openvino', 'libs')}${win ? ';' : ':'}${process.env.PATH ?? ''}` }
            const c = (this.o.spawnFn ?? spawn)(this.python, [script, this.src, String(this.port)], { cwd: this.src, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
            this.child = c
            const pipe = (b: Buffer): void => { for (const l of b.toString('utf8').split(/\r?\n/)) if (l.trim()) this.note(l.trim()) }
            c.stdout?.on('data', pipe)
            c.stderr?.on('data', pipe)
            c.on('close', () => { if (this.child === c) { this.child = null; if (this.current !== 'failed') this.current = 'stopped' } })
            c.on('error', (e) => this.note(`engine launch error: ${e.message}`))
          }
          // Wait for real liveness: importing torch / openvino takes a while on first start.
          const deadline = Date.now() + 5 * 60_000
          while (Date.now() < deadline) {
            if (await this.alive()) { this.current = 'ready'; return }
            if (held && !this.child) throw new ImageEngineError('start-failed', `The image engine stopped while starting. ${this.detail}`)
            await new Promise((r) => setTimeout(r, 1000))
          }
          throw new ImageEngineError('start-failed', 'The image engine did not become ready in time.')
        } finally {
          if (held) { try { unlinkSync(lock) } catch { /* gone */ } }
        }
      } catch (e) {
        this.current = 'failed'
        throw e instanceof ImageEngineError ? e : new ImageEngineError('start-failed', e instanceof Error ? e.message : 'The image engine could not start.')
      } finally {
        this.starting = null
      }
    })()
    return this.starting
  }

  /**
   * POSTs JSON and waits as long as it takes. Node's fetch gives up after five minutes without response headers, and
   * the first generation blocks while upstream downloads the model; node:http has no such limit. Tests inject
   * `fetchFn`, which is used instead.
   */
  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; json: unknown }> {
    const payload = JSON.stringify(body)
    if (this.o.fetchFn) {
      const r = await this.o.fetchFn(`${this.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload, signal })
      return { ok: r.ok, status: r.status, json: r.ok ? await r.json() : null }
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('cancelled')); return }
      const req = httpRequest({ host: '127.0.0.1', port: this.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          try { resolve({ ok: status >= 200 && status < 300, status, json: status >= 200 && status < 300 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null }) } catch (e) { reject(e) }
        })
      })
      req.on('error', reject)
      signal?.addEventListener('abort', () => req.destroy(new Error('cancelled')), { once: true })
      req.end(payload)
    }).catch((e: unknown) => {
      if (signal?.aborted) throw new ImageEngineError('cancelled', 'Cancelled.')
      throw new ImageEngineError('engine-error', `The image engine did not answer: ${e instanceof Error ? e.message : String(e)}`)
    }) as Promise<{ ok: boolean; status: number; json: unknown }>
  }

  private kill(c: ChildProcess): void {
    if (this.o.killFn) { this.o.killFn(c); return }
    if (win && c.pid !== undefined) execFile('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true }, () => undefined)
    else c.kill('SIGKILL')
  }

  /**
   * Ends the engine process this object started and resolves true only once that process has really exited. False
   * means there was nothing of ours to end (another Orbis process started the engine) or it did not exit in time.
   */
  terminate(): Promise<boolean> {
    const c = this.child
    if (!c) return Promise.resolve(false)
    if (c.exitCode !== null || c.signalCode) { if (this.child === c) this.child = null; this.current = 'stopped'; return Promise.resolve(true) }
    return new Promise((resolve) => {
      let done = false
      const finish = (ok: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (ok) { if (this.child === c) this.child = null; this.current = 'stopped' }
        resolve(ok)
      }
      const timer = setTimeout(() => finish(c.exitCode !== null || Boolean(c.signalCode)), this.o.killTimeoutMs ?? 10_000)
      c.once('close', () => finish(true))
      c.once('exit', () => finish(true))
      this.kill(c)
    })
  }

  /** Terminates only the engine process this object started. */
  stop(): void {
    void this.terminate()
  }

  /** What the engine is doing, checked: a server another Orbis process started is reported as ready, not as stopped. */
  async status(): Promise<EngineState> {
    const s = this.state()
    if (s.state === 'stopped' && (await this.alive())) return { state: 'ready', detail: 'The image engine is running.', backend: s.backend }
    return s
  }

  /** Several pictures of one prompt, one after another (the engine draws one at a time). A failure does not lose the others. */
  async generateMany(prompt: string, count: number, opt: GenerateOptions = {}): Promise<GenerateManyResult> {
    const n = Math.min(MAX_BATCH, Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)))
    const out: GenerateManyResult = { results: [], errors: [], cancelled: false }
    const baseSeed = Number.isSafeInteger(opt.seed) ? (opt.seed as number) : Math.floor(Math.random() * 2 ** 31)
    for (let i = 0; i < n; i++) {
      if (opt.signal?.aborted) { out.cancelled = true; break }
      const label = n > 1 ? `Picture ${i + 1} of ${n}: ` : ''
      try {
        // Each picture has its own seed; the same prompt with the same seed would only repeat itself.
        out.results.push(await this.generate(prompt, { ...opt, seed: (baseSeed + i * 7919) % 2 ** 31, onStatus: opt.onStatus ? (m) => opt.onStatus?.(`${label}${m}`) : undefined }))
      } catch (e) {
        const err = e instanceof ImageEngineError ? e : null
        const code = err?.code ?? 'unknown'
        out.errors.push({ index: i, code, message: e instanceof Error ? e.message : String(e) })
        if (code === 'cancelled' || code === 'not-stopped') { out.cancelled = true; break }
        // The engine is missing or will not start: the remaining pictures would fail the same way.
        if (code === 'not-installed' || code === 'install-failed' || code === 'start-failed' || code === 'bad-request') break
      }
    }
    return out
  }

  /** Ends inference for a cancelled request. The error it returns says only what is true. */
  private async cancelInference(): Promise<ImageEngineError> {
    const ended = await this.terminate()
    if (ended) {
      this.note('Stopped the image engine: the picture was cancelled.')
      return new ImageEngineError('cancelled', 'Cancelled. The image engine was stopped and starts again on the next picture.')
    }
    return new ImageEngineError('not-stopped', 'Stopped waiting, but the image engine could not be stopped and may still be drawing.')
  }

  /**
   * One image. Installs and starts the engine first when needed, reporting each real step through onStatus. Only one
   * generation runs at a time (upstream keeps one global pipeline and settings object); others wait their turn.
   */
  async generate(prompt: string, opt: GenerateOptions = {}): Promise<GenerateResult> {
    const text = prompt.trim()
    if (!text) throw new ImageEngineError('bad-request', 'There is no description to draw.')
    if (text.length > 1000) throw new ImageEngineError('bad-request', 'The description is too long for the image engine (limit 1000 characters).')
    // Checked before anything starts: a bad source picture must not cost an engine start.
    const init = opt.initImage !== undefined ? prepareInitImage(opt.initImage) : null
    const strength = Math.min(0.95, Math.max(0.1, Number.isFinite(opt.strength) ? (opt.strength as number) : 0.6))
    const t0 = Date.now()
    const status = opt.onStatus
    if (!this.isInstalled()) {
      status?.('Setting up the local image engine (first time only)…')
      await this.install(status, opt.signal)
    }
    const s0 = Date.now()
    await this.start(status)
    const engineStart = (Date.now() - s0) / 1000
    if (opt.signal?.aborted) throw new ImageEngineError('cancelled', 'Cancelled.')
    while (this.busy) {
      if (opt.signal?.aborted) throw new ImageEngineError('cancelled', 'Cancelled.')
      await new Promise((r) => setTimeout(r, 250))
    }
    this.busy = true
    this.current = 'generating'
    const backend = this.backend()
    const prefs = readImagePreferences(this.o.home)
    const seed = Number.isSafeInteger(opt.seed) ? (opt.seed as number) : Math.floor(Math.random() * 2 ** 31)
    try {
      status?.('Drawing…')
      const g0 = Date.now()
      const body = {
        prompt: text,
        negative_prompt: (opt.negativePrompt ?? '').slice(0, 500),
        image_width: clampDim(opt.width, prefs.size),
        image_height: clampDim(opt.height, prefs.size),
        inference_steps: Math.min(8, Math.max(1, Math.round(opt.steps ?? prefs.steps))),
        guidance_scale: 1,
        number_of_images: 1,
        use_seed: true,
        seed,
        use_openvino: backend.openvino,
        use_tiny_auto_encoder: backend.tinyAutoEncoder,
        lcm_model_id: backend.modelId,
        openvino_lcm_model_id: backend.openvinoModelId,
        diffusion_task: init ? 'image_to_image' : 'text_to_image',
        ...(init ? { init_image: init.base64, strength } : {})
      }
      let res: { ok: boolean; status: number; json: unknown }
      try {
        res = await this.post('/api/generate', body, opt.signal)
      } catch (e) {
        // Stopping the wait does not stop the inference: upstream has no cancel call, so the process is ended.
        if (opt.signal?.aborted) throw await this.cancelInference()
        throw e
      }
      if (!res.ok) throw new ImageEngineError('engine-error', `The image engine answered with status ${res.status}.`)
      const json = res.json as { images?: unknown; error?: unknown; latency?: unknown }
      if (typeof json.error === 'string' && json.error) throw new ImageEngineError('engine-error', `The image engine reported: ${json.error.slice(0, 300)}`)
      const first = Array.isArray(json.images) ? json.images[0] : undefined
      if (typeof first !== 'string' || first.length < 100) throw new ImageEngineError('no-output', 'The image engine finished without producing an image.')
      const bytes = Buffer.from(first, 'base64')
      // A JPEG starts FF D8 FF and ends FF D9; anything else is not the picture upstream promises.
      if (bytes.length < 200 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
        throw new ImageEngineError('no-output', 'The image engine returned data that is not a complete picture.')
      }
      const generation = (Date.now() - g0) / 1000
      try {
        writeFileSync(join(this.o.home, 'last-generation.json'), JSON.stringify({ seconds: generation, at: Date.now(), width: body.image_width, height: body.image_height, steps: body.inference_steps, imageToImage: init !== null }))
      } catch { /* a missing measurement is shown as missing */ }
      return { dataUrl: `data:image/jpeg;base64,${first}`, seed, seconds: { total: (Date.now() - t0) / 1000, engineStart, generation }, backend }
    } finally {
      this.busy = false
      if (this.current === 'generating') this.current = 'ready'
    }
  }
}

let shared: FastSdEngine | null = null

/** The one engine for this process. `serveScript` is resolved by the caller (it differs when packaged). */
export function sharedEngine(o?: Partial<EngineOptions>): FastSdEngine {
  if (!shared) {
    const home = o?.home ?? process.env.ORBIS_IMAGEGEN_HOME ?? join(process.env.APPDATA ?? join(homedir(), '.config'), 'Orbis', 'imagegen')
    const serveScript = o?.serveScript ?? process.env.ORBIS_FASTSD_SERVE ?? join(process.cwd(), 'resources', 'fastsd', 'serve_local.py')
    shared = new FastSdEngine({ ...o, home, serveScript })
  }
  return shared
}

export function readInstalledCommit(home: string): string | null {
  try { return readFileSync(join(home, 'fastsdcpu', '.orbis-installed'), 'utf8').trim() } catch { return null }
}
