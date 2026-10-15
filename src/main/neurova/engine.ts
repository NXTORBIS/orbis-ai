import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { buildAceStep, buildHeartMuLa } from '../../shared/neurova/adapters.ts'
import { compile } from '../../shared/neurova/compile.ts'
import { ENGINES, evaluate, type EngineStatus, type MachineFacts } from '../../shared/neurova/engines.ts'
import { apply, isTerminal, newJob, type Job, type JobEvent, type JobState } from '../../shared/neurova/job.ts'
import { interpret } from '../../shared/neurova/intent.ts'
import { inspectWav } from '../../shared/neurova/audio.ts'
import type { FailureCode } from '../../shared/neurova/scheduler.ts'
import { runWorker } from './runner.ts'
import type { NeurovaStore } from './store.ts'
import { newRecord, reconcile, type JobStore } from './jobStore.ts'
import { readFile } from 'node:fs/promises'
import { totalmem } from 'node:os'
import { LeaseManager, type Lease, type LeaseSnapshot } from '../../shared/neurova/leases.ts'
import { SessionHolder, WorkerSession } from './session.ts'

/** Rough memory a generation needs. A guess, capped to the budget so it serialises work instead of refusing it. */
const MEMORY_GB: Record<'ace-step' | 'heartmula', number> = { 'ace-step': 8, heartmula: 14 }

const HEART_URL = 'https://github.com/HeartMuLa/heartlib.git'
const ACE_URL = 'https://github.com/ACE-Step/ACE-Step-1.5.git'

export interface JobView {
  id: string
  projectId: string
  state: JobState
  stage: string
  error: string | null
  code: FailureCode | null
  startedAt: number
  endedAt: number | null
  outputs: number
  /** True if this ran on the processor only. */
  cpuOnly: boolean
}

export interface InstallView { step: 'idle' | 'runtime' | 'models'; running: boolean; log: string[]; error: string | null }

export interface EngineOptions {
  home: string
  /** Absolute path of ace_worker.py. */
  workerScript: string
  /** Keep the ACE-Step model loaded between songs (default true). If the session fails, the one-shot worker is used. */
  reuseModel?: boolean
  /** How long an unused loaded model is kept. Default 10 minutes. */
  idleMs?: number
  store: NeurovaStore
  jobs: JobStore
  probe(): Promise<MachineFacts>
  send(channel: string, ...args: unknown[]): void
}

const win = process.platform === 'win32'

/**
 * Owns the real engine on this machine: finds it, installs it, and runs one generation at a time.
 * Job state lives here; the window only reads it. Nothing is reported as finished until the audio file has
 * been decoded and validated.
 */
export class NeurovaEngine {
  private readonly o: EngineOptions
  private readonly jobs = new Map<string, JobView & { abort: AbortController; core: Job; seq: number }>()
  private install: InstallView = { step: 'idle', running: false, log: [], error: null }
  private readonly smoke = new Set<string>()
  private installAbort: AbortController | null = null
  private readonly leases = new LeaseManager({ memoryBudgetGb: Math.max(2, Math.floor((totalmem() / 2 ** 30) * 0.8)) })
  private readonly jobLeases = new Map<string, Lease>()
  private readonly sessions: SessionHolder

  constructor(o: EngineOptions) {
    this.o = o
    this.sessions = new SessionHolder((key) => {
      const c = JSON.parse(key) as { command: string; args: string[]; cwd: string }
      return new WorkerSession({ command: c.command, args: c.args, cwd: c.cwd, configKey: key, idleMs: this.o.idleMs })
    })
  }

  /** Who holds what right now, for the window. */
  leaseSnapshot(): LeaseSnapshot { return this.leases.snapshot() }

  /** Unloads any kept model (app quit, engine removed). */
  shutdown(): void { this.sessions.drop() }

  private dir(id: 'ace-step' | 'heartmula' = 'ace-step'): string { return join(this.o.home, 'engines', id === 'heartmula' ? 'heartlib' : 'ace-step') }
  private python(id: 'ace-step' | 'heartmula' = 'ace-step'): string { return join(this.dir(id), '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python') }
  private checkpoints(id: 'ace-step' | 'heartmula' = 'ace-step'): string { return id === 'heartmula' ? join(this.dir(id), 'ckpt') : join(this.dir(id), 'checkpoints') }

  async facts(): Promise<MachineFacts> {
    const base = await this.o.probe()
    const list = async (id: 'ace-step' | 'heartmula'): Promise<string[]> => (existsSync(this.checkpoints(id)) ? readdir(this.checkpoints(id)).catch(() => [] as string[]) : [])
    return {
      ...base,
      filesFound: { 'ace-step': await list('ace-step'), heartmula: await list('heartmula') },
      runtimeInstalled: { 'ace-step': existsSync(this.python()), heartmula: existsSync(this.python('heartmula')) }
    }
  }

  async status(): Promise<EngineStatus[]> {
    const f = await this.facts()
    return ENGINES.map((m) => evaluate(m, f, this.smoke.has(m.id)))
  }

  installStatus(): InstallView { return { ...this.install, log: this.install.log.slice(-30) } }
  async listJobs(): Promise<JobView[]> {
    const live = [...this.jobs.values()].map(({ abort: _a, core: _c, seq: _s, ...v }) => v)
    const liveIds = new Set(live.map((v) => v.id))
    const saved = (await this.o.jobs.list()).filter((r) => !liveIds.has(r.id)).map((r): JobView => ({
      id: r.id, projectId: r.projectId, state: r.state, stage: r.stage ?? '', error: r.error, code: r.code, startedAt: r.startedAt ?? r.createdAt, endedAt: r.endedAt, outputs: r.outputSha256 ? 1 : 0, cpuOnly: false
    }))
    return [...live, ...saved].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)
  }

  /** At startup: anything saved as running with no live worker is marked interrupted. Never restarted automatically. */
  async recover(): Promise<{ interrupted: number }> {
    const report = await reconcile(this.o.jobs, { isRunning: (id) => this.jobs.has(id), outputExists: async (p) => existsSync(p) })
    return { interrupted: report.interrupted.length }
  }

  private note(line: string): void {
    this.install.log.push(line.slice(0, 300))
    if (this.install.log.length > 200) this.install.log.splice(0, 100)
    this.o.send('neurova:install-changed')
  }

  private run(cmd: string, args: string[], cwd: string, signal: AbortSignal): Promise<number> {
    return new Promise((res) => {
      const c = spawn(cmd, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const pipe = (b: Buffer): void => { for (const l of b.toString('utf8').split(/\r?\n/)) if (l.trim()) this.note(l.trim()) }
      c.stdout.on('data', pipe)
      c.stderr.on('data', pipe)
      c.on('error', (e) => { this.note(`could not start ${cmd}: ${e.message}`); res(-1) })
      c.on('close', (code) => res(code ?? -1))
      signal.addEventListener('abort', () => c.kill(), { once: true })
    })
  }

  /** Clones the upstream repository and builds its own isolated environment. Never touches global Python. */
  async installRuntime(engineId: 'ace-step' | 'heartmula' = 'ace-step'): Promise<void> {
    if (this.install.running) throw new Error('An installation is already running.')
    const held = this.leases.acquire({ owner: 'the engine installation', resources: ['cpu-heavy'], memoryGb: 1 })
    if (!held.ok) throw new Error(`The engine cannot be installed right now: ${held.reason}`)
    this.sessions.drop()
    this.install = { step: 'runtime', running: true, log: [], error: null }
    this.installAbort = new AbortController()
    try {
      await mkdir(join(this.o.home, 'engines'), { recursive: true })
      const heart = engineId === 'heartmula'
      if (!existsSync(join(this.dir(engineId), 'pyproject.toml'))) {
        const code = await this.run('git', ['clone', '--depth', '1', heart ? HEART_URL : ACE_URL, heart ? 'heartlib' : 'ace-step'], join(this.o.home, 'engines'), this.installAbort.signal)
        if (code !== 0) throw new Error('Downloading the engine source failed.')
      }
      const signal = this.installAbort.signal
      if (heart) {
        // heartlib documents `pip install -e .` (3.10 recommended; uv's 3.10 build failed here, 3.12 is used) and ships no lock file, so it gets its own venv.
        if ((await this.run('uv', ['venv', '--python', '3.12'], this.dir(engineId), signal)) !== 0) throw new Error('Creating the HeartMuLa environment failed.')
        if ((await this.run('uv', ['pip', 'install', '--python', this.python(engineId), '-e', '.', 'huggingface_hub'], this.dir(engineId), signal)) !== 0) throw new Error('Installing HeartMuLa failed.')
      } else if ((await this.run('uv', ['sync'], this.dir(), signal)) !== 0) throw new Error('Building the engine environment failed.')
    } catch (e) {
      this.install.error = e instanceof Error ? e.message : 'Installation failed.'
    } finally {
      this.leases.release(held.lease)
      this.install.running = false
      this.o.send('neurova:install-changed')
    }
  }

  /** Downloads the official model files with the engine's own downloader (several gigabytes). */
  async installModels(engineId: 'ace-step' | 'heartmula' = 'ace-step'): Promise<void> {
    if (this.install.running) throw new Error('An installation is already running.')
    if (!existsSync(this.python(engineId))) throw new Error('Install the engine first.')
    const held = this.leases.acquire({ owner: 'the model download', resources: ['cpu-heavy'], memoryGb: 1 })
    if (!held.ok) throw new Error(`The models cannot be downloaded right now: ${held.reason}`)
    this.install = { step: 'models', running: true, log: [], error: null }
    this.installAbort = new AbortController()
    try {
      const code = engineId === 'heartmula'
        ? await this.run(this.python(engineId), ['-c', "from huggingface_hub import snapshot_download as s; s('HeartMuLa/HeartMuLaGen', local_dir='ckpt'); s('HeartMuLa/HeartMuLa-oss-3B-happy-new-year', local_dir='ckpt/HeartMuLa-oss-3B'); s('HeartMuLa/HeartCodec-oss-20260123', local_dir='ckpt/HeartCodec-oss')"], this.dir(engineId), this.installAbort.signal)
        : await this.run('uv', ['run', 'acestep-download'], this.dir(), this.installAbort.signal)
      if (code !== 0) throw new Error('Downloading the model files failed or was stopped. Files already downloaded are kept.')
    } catch (e) {
      this.install.error = e instanceof Error ? e.message : 'Download failed.'
    } finally {
      this.leases.release(held.lease)
      this.install.running = false
      this.o.send('neurova:install-changed')
    }
  }

  cancelInstall(): void { this.installAbort?.abort() }

  private emit(id: string): void { this.o.send('neurova:jobs-changed', id) }

  private step(id: string, to: JobState, extra: Partial<JobEvent> = {}): void {
    const j = this.jobs.get(id)
    if (!j) return
    j.seq += 1
    const next = apply(j.core, { jobId: id, seq: j.seq, to, ...extra })
    if (next === j.core) return
    j.core = next
    j.state = next.state
    j.error = next.error
    if (isTerminal(next.state)) j.endedAt = Date.now()
    void this.o.jobs.update(id, { state: next.state, stage: j.stage, error: next.error, code: j.code }, undefined)
    this.emit(id)
  }

  async generate(projectId: string, input: { prompt: string; lyrics?: string; instrumental?: boolean; durationSec?: number; seed?: number; engine?: 'ace-step' | 'heartmula'; tags?: string[] }): Promise<string> {
    const engineId = input.engine ?? 'ace-step'
    const manifest = ENGINES.find((m) => m.id === engineId) ?? ENGINES[0]
    const intent = interpret({ prompt: input.prompt, lyrics: input.lyrics })
    if (!intent.ok) throw new Error(intent.error)
    if (intent.intent.conflicts.length) throw new Error(intent.intent.conflicts[0])
    if ([...this.jobs.values()].some((j) => !isTerminal(j.state))) throw new Error('A song is already being made. Wait for it or cancel it.')
    const facts = await this.facts()
    const st = evaluate(manifest, facts, this.smoke.has(engineId))
    if (st.readiness === 'no-runtime' || st.readiness === 'no-model' || st.readiness === 'low-disk') throw new Error(st.reason)
    const instrumental = input.instrumental ?? intent.intent.instrumental === true
    const compiled = compile(
      { prompt: intent.intent.original, instrumental, lyrics: intent.intent.lyrics, avoid: intent.intent.avoid, plan: null },
      { captionMax: 512, lyricsMax: 4096, lyrics: true, instrumentalFlag: true }
    )
    if (compiled.error) throw new Error(compiled.error)
    let built: { value: { params: Record<string, unknown>; config: Record<string, unknown> } }
    if (engineId === 'heartmula') {
      const tags = input.tags ?? []
      const h = buildHeartMuLa({ caption: compiled.caption, lyrics: compiled.lyrics, instrumental, durationSec: input.durationSec, seed: input.seed }, { modelPath: this.checkpoints('heartmula'), script: '', savePath: '', lyricsPath: '', tagsPath: '', tags })
      if (!h.ok) throw new Error(h.error)
      built = { value: { params: { lyrics: compiled.lyrics ?? '', tags: tags.map((t) => t.trim()).join(','), max_audio_length_ms: Math.round((input.durationSec ?? 30) * 1000) }, config: {} } }
    } else {
      const a = buildAceStep({ caption: compiled.caption, lyrics: compiled.lyrics, instrumental, durationSec: input.durationSec, seed: input.seed })
      if (!a.ok) throw new Error(a.error)
      built = { value: a.value as never }
    }
    const got = this.leases.acquire({ owner: 'a song', resources: facts.gpuName ? ['cpu-heavy', 'gpu'] : ['cpu-heavy'], memoryGb: Math.min(MEMORY_GB[engineId], this.leases.snapshot().memoryBudgetGb) })
    if (!got.ok) throw new Error(`A song cannot be made right now: ${got.reason}`)
    const id = randomUUID()
    this.jobLeases.set(id, got.lease)
    const core = newJob(id)
    const view = { id, projectId, state: core.state, stage: 'queued', error: null, code: null, startedAt: Date.now(), endedAt: null, outputs: 0, cpuOnly: !facts.gpuName, abort: new AbortController(), core, seq: 0 }
    this.jobs.set(id, view)
    try {
      await this.o.jobs.put(newRecord({ id, projectId, request: { prompt: intent.intent.original, lyrics: intent.intent.lyrics ?? '', instrumental, durationSec: input.durationSec ?? 0, seed: input.seed ?? null }, engineId }))
    } catch (e) {
      this.freeLease(id)
      this.jobs.delete(id)
      throw e
    }
    this.emit(id)
    void this.execute(id, projectId, built.value, facts, instrumental, engineId)
    return id
  }

  private async execute(id: string, projectId: string, req: { params: Record<string, unknown>; config: Record<string, unknown> }, facts: MachineFacts, instrumental: boolean, engineId: 'ace-step' | 'heartmula'): Promise<void> {
    const j = this.jobs.get(id)!
    const outDir = join(this.o.home, 'jobs', id)
    try {
      this.step(id, 'preparing')
      await mkdir(outDir, { recursive: true })
      const reqFile = join(outDir, 'request.json')
      await writeFile(reqFile, JSON.stringify({ job: id, engine_dir: this.dir(engineId), ckpt_dir: this.checkpoints(engineId), out_dir: outDir, device: facts.gpuName ? 'auto' : 'cpu', params: req.params, config: req.config }))
      const script = engineId === 'heartmula' ? join(dirname(this.o.workerScript), 'heart_worker.py') : this.o.workerScript
      if (!existsSync(script)) throw new Error('The engine worker script is missing from this installation.')
      this.step(id, 'generating')
      j.stage = 'starting the engine'
      const onEvent = (e: { msg: { type: string; stage?: string } }): void => {
        if (e.msg.type === 'stage' && e.msg.stage) j.stage = e.msg.stage
        this.emit(id)
      }
      const oneShot = (): ReturnType<typeof runWorker> => runWorker({
        command: this.python(engineId),
        args: [script, reqFile],
        cwd: this.dir(engineId),
        job: id,
        outDir,
        startupMs: 10 * 60_000,
        graceMs: 8000,
        signal: j.abort.signal,
        onEvent
      })
      let result: Awaited<ReturnType<typeof runWorker>>
      if (engineId === 'ace-step' && this.o.reuseModel !== false) {
        // Kept-model path. A different setup never shares a process; a failure to start falls back to one-shot.
        const key = JSON.stringify({ command: this.python(engineId), args: [script, '--serve'], cwd: this.dir(engineId), ckpt: this.checkpoints(engineId), device: facts.gpuName ? 'auto' : 'cpu' })
        const r = await this.sessions.get(key).run({
          job: id,
          outDir,
          request: JSON.parse(await readFile(reqFile, 'utf8')) as Record<string, unknown>,
          startupMs: 10 * 60_000,
          signal: j.abort.signal,
          onEvent
        })
        if (r.startFailure && r.state === 'failed' && !j.abort.signal.aborted) {
          this.sessions.drop()
          j.stage = 'starting the engine'
          result = await oneShot()
        } else {
          if (r.state !== 'done') this.sessions.drop()
          result = r
        }
      } else {
        if (engineId !== 'ace-step') this.sessions.drop() // free the loaded model's memory for the other engine
        result = await oneShot()
      }
      if (result.state === 'cancelled') {
        this.step(id, 'cancelling')
        this.step(id, 'cancelled')
        j.code = 'CANCELLED'
        return
      }
      if (result.state !== 'done') {
        j.code = result.code
        this.step(id, 'failed', { error: result.message ?? 'The engine failed.' })
        return
      }
      this.step(id, 'validating')
      j.stage = 'checking the audio'
      const file = join(outDir, result.outputs[0])
      const bytes = await readFile(file)
      const check = inspectWav(bytes)
      if (!check.ok) {
        j.code = 'OUTPUT_INVALID'
        this.step(id, 'failed', { error: `The engine produced a file that is not valid audio: ${check.reason}` })
        return
      }
      if (check.info.peak === 0) {
        j.code = 'OUTPUT_INVALID'
        this.step(id, 'failed', { error: 'The engine produced silence, so it was not kept as a song.' })
        return
      }
      const note = `Generated by ${ENGINES.find((m) => m.id === engineId)?.name ?? engineId} (${facts.gpuName ? 'GPU' : 'CPU only'}). ${instrumental ? 'Instrumental.' : ''}`.trim()
      await this.o.store.importAudio(projectId, file, 'Generated song', note, 'generated')
      this.smoke.add(engineId)
      j.outputs = 1
      this.step(id, 'completed', { outputPath: file })
    } catch (e) {
      j.code = 'UNKNOWN'
      this.step(id, 'failed', { error: e instanceof Error ? e.message : 'Generation failed.' })
    } finally {
      this.freeLease(id)
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private freeLease(id: string): void {
    const l = this.jobLeases.get(id)
    this.jobLeases.delete(id)
    if (l) this.leases.release(l)
  }

  cancel(id: string): boolean {
    const j = this.jobs.get(id)
    if (!j || isTerminal(j.state)) return false
    j.abort.abort()
    return true
  }
}
