import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SessionHolder, WorkerSession } from './session.ts'

// A scripted serve-mode worker. It proves the session's handling of the protocol, not any music model.
// The request's `mode` field scripts its behaviour; the file name carries its pid so reuse is visible.
async function fake(): Promise<{ file: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'nvs-'))
  const file = join(dir, 'serve.cjs')
  await writeFile(file, `
const rl = require('readline').createInterface({ input: process.stdin });
let count = 0;
rl.on('line', (line) => {
  const r = JSON.parse(line);
  if (r.cmd === 'quit') process.exit(0);
  let n = 0;
  const say = (msg) => console.log(JSON.stringify({ v: 1, job: r.job, seq: ++n, msg }));
  count++;
  say({ type: 'ready' });
  if (r.mode === 'crash') process.exit(7);
  if (r.mode === 'hang') return;
  if (r.mode === 'error') { say({ type: 'error', code: 'INFERENCE_FAILED', message: 'bad' }); return; }
  say({ type: 'stage', stage: 'generating' });
  say({ type: 'output', path: 'song-' + process.pid + '-' + count + '.wav' });
  say({ type: 'done' });
});
rl.on('close', () => process.exit(0));
`)
  return { file, dir }
}
const mk = async (extra: { idleMs?: number; key?: string; args?: string[] } = {}) => {
  const f = await fake()
  const s = new WorkerSession({ command: process.execPath, args: extra.args ?? [f.file], configKey: extra.key ?? 'k', idleMs: extra.idleMs ?? 60_000, graceMs: 300 })
  return { s, f, job: (id: string, mode = 'ok', signal?: AbortSignal) => s.run({ job: id, outDir: f.dir, request: { mode }, startupMs: 3000, signal }) }
}
const pid = (outs: string[]): string => outs[0].split('-')[1]

test('consecutive jobs reuse one process', async () => {
  const { s, job } = await mk()
  const a = await job('j1')
  const b = await job('j2')
  assert.equal(a.state, 'done')
  assert.equal(b.state, 'done')
  assert.equal(pid(a.outputs), pid(b.outputs))
  assert.equal(s.spawns, 1)
  s.close()
})

test('a crash is detected and the next job starts a fresh process', async () => {
  const { s, job } = await mk()
  const a = await job('j1')
  const c = await job('j2', 'crash')
  assert.equal(c.state, 'failed')
  assert.equal(c.code, 'WORKER_CRASHED')
  assert.equal(c.startFailure, false) // it had said ready: not safe to treat as a start failure
  const d = await job('j3')
  assert.equal(d.state, 'done')
  assert.notEqual(pid(a.outputs), pid(d.outputs))
  assert.equal(s.spawns, 2)
  s.close()
})

test('cancel kills the process; the next job is fresh', async () => {
  const { s, job } = await mk()
  const a = await job('j1')
  const ac = new AbortController()
  const p = job('j2', 'hang', ac.signal)
  setTimeout(() => ac.abort(), 200)
  const c = await p
  assert.equal(c.state, 'cancelled')
  const d = await job('j3')
  assert.equal(d.state, 'done')
  assert.notEqual(pid(a.outputs), pid(d.outputs))
  s.close()
})

test('a worker error keeps the job failed and does not poison the session', async () => {
  const { s, job } = await mk()
  const e = await job('j1', 'error')
  assert.equal(e.state, 'failed')
  assert.equal(e.message, 'bad')
  const ok = await job('j2')
  assert.equal(ok.state, 'done')
  s.close()
})

test('idle timeout unloads the process; the next job starts a new one', async () => {
  const { s, job } = await mk({ idleMs: 150 })
  const a = await job('j1')
  assert.ok(s.alive)
  await new Promise((r) => setTimeout(r, 700))
  assert.equal(s.alive, false)
  const b = await job('j2')
  assert.notEqual(pid(a.outputs), pid(b.outputs))
  s.close()
})

test('a second job while one is running is refused', async () => {
  const { s, job } = await mk()
  const ac = new AbortController()
  const first = job('j1', 'hang', ac.signal)
  const second = await job('j2')
  assert.equal(second.state, 'failed')
  ac.abort()
  await first
  s.close()
})

test('a worker that never speaks is a start failure (safe to retry one-shot)', async () => {
  const f = await fake()
  const s = new WorkerSession({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], configKey: 'k', graceMs: 200 })
  const r = await s.run({ job: 'j', outDir: f.dir, request: {}, startupMs: 300 })
  assert.equal(r.code, 'TIMEOUT')
  assert.equal(r.startFailure, true)
  const m = new WorkerSession({ command: join(f.dir, 'no-such-binary'), args: [], configKey: 'k' })
  const r2 = await m.run({ job: 'j', outDir: f.dir, request: {}, startupMs: 2000 })
  assert.equal(r2.state, 'failed')
  assert.equal(r2.startFailure, true)
})

test('the holder never reuses a session for a different config, and drop ends it', async () => {
  const f = await fake()
  const made: WorkerSession[] = []
  const h = new SessionHolder((key) => { const s = new WorkerSession({ command: process.execPath, args: [f.file], configKey: key, graceMs: 200 }); made.push(s); return s })
  const a = h.get('A')
  assert.equal(h.get('A'), a)
  const r = await a.run({ job: 'j1', outDir: f.dir, request: {}, startupMs: 3000 })
  assert.equal(r.state, 'done')
  assert.ok(a.alive)
  const b = h.get('B')
  assert.notEqual(a, b)
  await new Promise((res) => setTimeout(res, 300))
  assert.equal(a.alive, false)
  h.drop()
  assert.equal(h.current, null)
})
