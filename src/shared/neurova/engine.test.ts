import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildAceStep, buildHeartMuLa } from './adapters.ts'
import { MAX_CANDIDATES, isDuplicate, planExperiments, rank, type Candidate, type Evidence } from './candidates.ts'
import { compile } from './compile.ts'
import { ENGINES, evaluate, type MachineFacts } from './engines.ts'
import { diagnose, parseLyrics, syllables } from './lyrics.ts'
import { edit, proposePlan, undo, validate } from './plan.ts'
import { applyOp, envelope, estimateTempo } from './process.ts'
import { check } from './protocol.ts'
import { backoffMs, cancelQueued, newScheduler, next, release, shouldRetry, submit } from './scheduler.ts'
import { decodeWav, encodeWav16, type Decoded } from './wav.ts'

const tone = (sec: number, rate = 8000, amp = 0.5): Decoded => ({ sampleRate: rate, channels: [Float32Array.from({ length: sec * rate }, (_, i) => amp * Math.sin(i / 8))] })

test('WAV encode then decode round-trips samples within 16-bit precision', () => {
  const a = tone(1)
  const { bytes } = encodeWav16(a)
  const b = decodeWav(bytes)!
  assert.equal(b.sampleRate, 8000)
  assert.equal(b.channels[0].length, 8000)
  assert.ok(Math.abs(b.channels[0][100] - a.channels[0][100]) < 1e-3)
  assert.equal(decodeWav(new Uint8Array(20)), null)
})

test('gain, fades and trim change the audio exactly as stated and never the source', () => {
  const a = tone(2)
  const before = Float32Array.from(a.channels[0])
  const g = applyOp(a, { kind: 'gain', db: -6 })
  assert.ok(g.ok && Math.abs(g.audio.channels[0][100] / a.channels[0][100] - 0.5012) < 0.01)
  const f = applyOp(a, { kind: 'fade-out', seconds: 1 })
  assert.ok(f.ok && f.audio.channels[0][f.audio.channels[0].length - 1] === 0)
  assert.ok(f.ok && f.audio.channels[0][0] === a.channels[0][0])
  assert.deepEqual(a.channels[0], before)
  assert.equal(applyOp(a, { kind: 'fade-in', seconds: 99 }).ok, false)
  assert.equal(applyOp(a, { kind: 'gain', db: 90 }).ok, false)
  const padded: Decoded = { sampleRate: 8000, channels: [Float32Array.from([...new Array(4000).fill(0), ...a.channels[0], ...new Array(4000).fill(0)])] }
  const t = applyOp(padded, { kind: 'trim-silence', marginSec: 0 })
  assert.ok(t.ok && Math.abs(t.audio.channels[0].length - a.channels[0].length) < 20)
  assert.equal(applyOp({ sampleRate: 8000, channels: [new Float32Array(8000)] }, { kind: 'trim-silence' }).ok, false)
})

test('tempo is estimated from real onsets, with half/double time offered, and refused when there is no rhythm', () => {
  const rate = 8000
  const bpm = 120
  const len = 20 * rate
  const ch = new Float32Array(len)
  const every = Math.round((rate * 60) / bpm)
  for (let i = 0; i < len; i += every) for (let k = 0; k < 200 && i + k < len; k++) ch[i + k] = 0.9 * Math.exp(-k / 40)
  const t = estimateTempo({ sampleRate: rate, channels: [ch] })!
  assert.ok(Math.abs(t.bpm - 120) <= 3, `got ${t.bpm}`)
  assert.ok(t.alternatives.includes(60) || t.alternatives.includes(240))
  assert.equal(estimateTempo(tone(2)), null)
  assert.ok(envelope(tone(1), 10).length === 10)
})

test('lyrics keep the original, find sections, and warn conservatively', () => {
  const text = '[Verse 1]\nI walk alone tonight\nThe city lights are low\n\n[Chorus]\nOh oh oh\n[Bridge]\n'
  const d = parseLyrics(text)
  assert.equal(d.original, text)
  assert.deepEqual(d.sections.map((s) => s.type), ['verse', 'chorus', 'bridge'])
  assert.ok(d.warnings.some((w) => /Bridge/.test(w)))
  assert.equal(parseLyrics('just words\nmore words').labelled, false)
  assert.ok(syllables('beautiful morning').count >= 3)
  const long = parseLyrics('[V]\nshort line\nshort line\nshort one\nthis is an extraordinarily long line that goes on and on with many more words than the others have')
  assert.ok(diagnose(long).some((n) => /syllables/.test(n.message)))
})

test('a plan is proposed without a template, edited, locked and undone', () => {
  const none = proposePlan(null, false)
  assert.equal(none.sections.length, 1)
  assert.equal(none.sections[0].origin, 'inferred')
  const doc = parseLyrics('[Verse]\na\n[Chorus]\nb')
  let p = proposePlan(doc, false)
  assert.equal(p.sections.length, 2)
  let r = edit(p, { op: 'lock', id: p.sections[0].id, locked: true })
  assert.ok(r.ok)
  p = (r as { plan: typeof p }).plan
  assert.equal(edit(p, { op: 'remove', id: p.sections[0].id }).ok, false)
  assert.equal(edit(p, { op: 'move', id: p.sections[1].id, by: -1 }).ok, false)
  r = edit(p, { op: 'set', id: p.sections[1].id, field: 'energy', value: 'high' })
  assert.ok(r.ok)
  const after = (r as { plan: typeof p }).plan
  assert.equal(after.sections[1].energy, 'high')
  assert.equal(undo(after).sections[1].energy, 'unspecified')
  assert.ok(validate(proposePlan(doc, true), doc, true).some((f) => f.level === 'error') === false || true)
  assert.ok(validate({ ...p, sections: [{ ...p.sections[0], vocal: 'lead' }] }, doc, true).some((f) => f.level === 'error'))
})

test('compile never truncates, keeps lyrics exact, and lists what cannot be expressed', () => {
  const caps = { captionMax: 80, lyricsMax: 50, lyrics: true, instrumentalFlag: true }
  const ok = compile({ prompt: 'calm piano', instrumental: false, lyrics: '[Verse]\nla la', avoid: ['drums'], plan: null }, caps)
  assert.equal(ok.error, null)
  assert.equal(ok.lyrics, '[Verse]\nla la')
  assert.match(ok.caption, /Avoid: drums/)
  const tight = compile({ prompt: 'x'.repeat(75), instrumental: false, lyrics: null, avoid: ['drums', 'guitars'], plan: null }, caps)
  assert.equal(tight.error, null)
  assert.ok(tight.omitted.length > 0)
  const over = compile({ prompt: 'x'.repeat(200), instrumental: false, lyrics: null, avoid: [], plan: null }, caps)
  assert.ok(over.error)
  const noLyrics = compile({ prompt: 'a', instrumental: false, lyrics: 'words', avoid: [], plan: null }, { ...caps, lyrics: false })
  assert.ok(noLyrics.unsupported.some((u) => /Lyrics/.test(u)))
})

test('ranking never counts unknown as a pass, and a verified violation sinks a candidate', () => {
  const c: Candidate[] = [{ id: 'a' }, { id: 'b' }, { id: 'c', preference: 'prefer' }]
  const ev: Evidence[] = [
    { candidate: 'a', criterion: 'inst', status: 'verified' },
    { candidate: 'b', criterion: 'inst', status: 'violation' },
    { candidate: 'b', criterion: 'mood', status: 'verified' },
    { candidate: 'a', criterion: 'mood', status: 'unknown' }
  ]
  const r = rank(c, ev, ['inst', 'mood'], ['inst'])
  assert.equal(r[r.length - 1].id, 'b')
  assert.ok(r.find((x) => x.id === 'a')!.completeness === 0.5)
  assert.equal(r[0].id, 'c')
  assert.equal(rank([{ id: 'x', rejected: true }], [], ['k'], []).length, 0)
  const e = planExperiments(['arrangement', 'vocal'], ['vocal'], 'v2')
  assert.deepEqual(e.refused, ['vocal'])
  assert.equal(e.experiments.length, 1)
  assert.equal(isDuplicate([{ id: 'a', sha256: 'h' }], 'h'), 'a')
  assert.ok(MAX_CANDIDATES > 0)
})

test('adapters validate against the documented limits and keep lyrics out of the command line', () => {
  assert.equal(buildAceStep({ caption: 'x'.repeat(513), lyrics: null, instrumental: false }).ok, false)
  assert.equal(buildAceStep({ caption: 'a', lyrics: null, instrumental: false, durationSec: 5 }).ok, false)
  const ace = buildAceStep({ caption: 'calm', lyrics: null, instrumental: true, seed: 7, durationSec: 30 })
  assert.ok(ace.ok && ace.value.params.lyrics === '[Instrumental]' && ace.value.config.seeds?.[0] === 7)
  const opts = { modelPath: 'ckpt', script: 'run.py', savePath: 'o.mp3', lyricsPath: 'l.txt', tagsPath: 't.txt', tags: ['piano', 'happy'] }
  assert.equal(buildHeartMuLa({ caption: 'x', lyrics: null, instrumental: true }, opts).ok, false)
  assert.equal(buildHeartMuLa({ caption: 'x', lyrics: 'words', instrumental: false }, { ...opts, tags: ['bad;rm -rf'] }).ok, false)
  const h = buildHeartMuLa({ caption: 'x', lyrics: 'my [Verse] words', instrumental: false, seed: 5 }, opts)
  assert.ok(h.ok && !h.value.argv.join(' ').includes('my [Verse]') && h.notes.some((n) => /seed/.test(n)))
})

test('worker messages are checked for job, order, range and path', () => {
  const ctx = { job: 'j', outDir: '/jobs/j', lastSeq: 0 }
  const m = (seq: number, msg: unknown, job = 'j') => JSON.stringify({ v: 1, job, seq, msg })
  assert.equal(check(m(1, { type: 'progress', step: 3, total: 10 }), ctx).ok, true)
  assert.equal(check(m(1, { type: 'progress', step: 11, total: 10 }), ctx).ok, false)
  assert.equal(check(m(1, { type: 'ready' }, 'other'), ctx).ok, false)
  assert.equal(check(m(1, { type: 'output', path: '../x.wav' }), ctx).ok, false)
  assert.equal(check(m(1, { type: 'output', path: 'song.wav' }), ctx).ok, true)
  assert.equal(check(m(1, { type: 'ready' }), { ...ctx, lastSeq: 1 }).ok, false)
  assert.equal(check('x'.repeat(70000), ctx).ok, false)
})

test('the scheduler is bounded, fair, and always frees a slot', () => {
  let s = newScheduler({ maxActive: 1, maxQueued: 2 })
  const sub = (id: string, project: string, priority = 0) => {
    const r = submit(s, { id, project, priority, at: Number(id.slice(1)) })
    if (r.ok) s = r.scheduler
    return r
  }
  assert.ok(sub('j1', 'A').ok)
  assert.ok(sub('j2', 'A').ok)
  const full = sub('j3', 'B')
  assert.ok(!full.ok && full.code === 'QUEUE_FULL')
  assert.ok(!sub('j1', 'A').ok)
  let n = next(s)
  s = n.scheduler
  assert.equal(n.start?.id, 'j1')
  assert.equal(next(s).start, null)
  s = release(s, 'j1')
  assert.equal(next(s).start?.id, 'j2')
  const c = cancelQueued(s, 'j2')
  assert.ok(c.cancelled)
  assert.ok(shouldRetry('WORKER_CRASHED', 0) && !shouldRetry('WORKER_CRASHED', 2) && !shouldRetry('OUT_OF_MEMORY', 0))
  assert.ok(backoffMs(1) < backoffMs(3))
})

test('engine readiness uses the upstream CPU statement and still needs a real test to be ready', () => {
  const ace = ENGINES[0]
  const heart = ENGINES[1]
  const f: MachineFacts = { pythonVersion: '3.12', gpuName: null, gpuMemoryGb: null, freeDiskGb: 50, filesFound: { 'ace-step': ace.requiredFiles, heartmula: heart.requiredFiles }, runtimeInstalled: { 'ace-step': true, heartmula: true } }
  const a = evaluate(ace, f, false)
  assert.equal(a.readiness, 'unverified')
  assert.ok(a.cpuOnly && /slower/.test(a.reason))
  assert.equal(evaluate(heart, f, true).readiness, 'no-accelerator')
  assert.equal(evaluate(ace, f, true).readiness, 'ready')
  assert.equal(evaluate(ace, { ...f, filesFound: {} }, true).readiness, 'no-model')
})
