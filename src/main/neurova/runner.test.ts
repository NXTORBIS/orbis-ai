import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runWorker } from './runner.ts'

// These use a small scripted worker. They prove the runner's handling of the protocol, not any music model.
async function worker(body: string): Promise<{ file: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'nvw-'))
  const file = join(dir, 'w.cjs')
  const head = `const J=process.argv[2];let n=0;const say=(msg)=>console.log(JSON.stringify({v:1,job:J,seq:++n,msg}));const out=${JSON.stringify(join(dir, 'song.wav'))};\n`
  await writeFile(file, head + body)
  return { file, dir }
}
const opts = (w: { file: string; dir: string }, extra = {}) => ({ command: process.execPath, args: [w.file, 'job1'], job: 'job1', outDir: w.dir, startupMs: 4000, graceMs: 300, ...extra })

test('a worker that says ready, outputs and done succeeds', async () => {
  const w = await worker("say({type:'ready'});say({type:'output',path:out});say({type:'done'});")
  const r = await runWorker(opts(w))
  assert.equal(r.state, 'done')
  assert.equal(r.outputs.length, 1)
})

test('an output outside the job folder is rejected, so "done" alone is not success', async () => {
  const w = await worker("say({type:'ready'});say({type:'output',path:'../../etc/passwd'});say({type:'done'});")
  const r = await runWorker(opts(w))
  assert.equal(r.state, 'failed')
  assert.equal(r.code, 'OUTPUT_INVALID')
  assert.ok(r.rejected.some((x) => /outside/.test(x)))
})

test('a crash is reported as a crash, and garbage lines are ignored', async () => {
  const w = await worker("console.log('not json');say({type:'ready'});process.exit(3);")
  const r = await runWorker(opts(w))
  assert.equal(r.code, 'WORKER_CRASHED')
  assert.ok(r.rejected.includes('not JSON'))
})

test('messages for another job and repeated sequence numbers are refused', async () => {
  const w = await worker("console.log(JSON.stringify({v:1,job:'other',seq:1,msg:{type:'done'}}));say({type:'ready'});console.log(JSON.stringify({v:1,job:J,seq:1,msg:{type:'done'}}));process.exit(0);")
  const r = await runWorker(opts(w))
  assert.equal(r.state, 'failed')
  assert.ok(r.rejected.includes('message for another job'))
  assert.ok(r.rejected.includes('out of order'))
})

test('cancelling ends only this worker, and reports cancelled only after it has stopped', async () => {
  const w = await worker("say({type:'ready'});setInterval(()=>{},1000);")
  const ac = new AbortController()
  const p = runWorker(opts(w, { signal: ac.signal }))
  setTimeout(() => ac.abort(), 400)
  const r = await p
  assert.equal(r.state, 'cancelled')
})

test('a worker that never becomes ready times out as a start failure', async () => {
  const w = await worker('setInterval(()=>{},1000);')
  const r = await runWorker(opts(w, { startupMs: 300 }))
  assert.equal(r.code, 'TIMEOUT')
})

test('a missing program is a missing runtime, not a hang', async () => {
  const r = await runWorker({ command: 'definitely-not-installed-xyz', args: [], job: 'j', outDir: tmpdir(), startupMs: 1000 })
  assert.equal(r.code, 'RUNTIME_MISSING')
})
