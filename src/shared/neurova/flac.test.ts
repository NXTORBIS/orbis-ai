import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { encodeFlac, encodeFlacPcm, decodeFlacForTest, md5 } from './flac.ts'
import { bandEnergy } from './bands.ts'

const sine = (n: number, hz: number, rate: number, a = 0.5): Float32Array => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * hz * i) / rate))
const ints = (f: Float32Array, scale: number): Int32Array => Int32Array.from(f, (v) => Math.round(v * scale))

function roundTrip(chs: Int32Array[], rate: number, bits: 16 | 24): void {
  const { bytes } = encodeFlacPcm(chs, rate, bits)
  const r = decodeFlacForTest(bytes)
  assert.equal(r.sampleRate, rate)
  assert.equal(r.bits, bits)
  assert.ok(r.md5Ok)
  chs.forEach((c, i) => assert.deepEqual(r.channels[i], c))
}

test('md5 matches node crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(200)]) assert.equal(Buffer.from(md5(Buffer.from(s))).toString('hex'), createHash('md5').update(s).digest('hex'))
})

test('sine, noise, silence round trip bit-exact at 16 and 24 bit', () => {
  roundTrip([ints(sine(10000, 440, 44100), 32767)], 44100, 16)
  roundTrip([ints(sine(9000, 997, 48000, 0.9), 8388607)], 48000, 24)
  let s = 1
  const noise = Int32Array.from({ length: 9000 }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 65536) - 32768 })
  roundTrip([noise], 22050, 16)
  roundTrip([new Int32Array(5000)], 44100, 16)
})

test('short stereo clip and tiny clips round trip', () => {
  roundTrip([ints(sine(5000, 300, 44100), 32767), ints(sine(5000, 700, 44100), 32767)], 44100, 16)
  roundTrip([Int32Array.from([1, -1, 5])], 8000, 16)
})

test('float input: 16-bit-origin samples are exact, out-of-range is clamped and counted, silence compresses', () => {
  const src = Float32Array.from([0, 1 / 32768, -3 / 32768, 0.5, -0.5, 2, -2])
  const r = encodeFlac({ sampleRate: 44100, channels: [src] })
  assert.equal(r.clamped, 2)
  const dec = decodeFlacForTest(r.bytes)
  assert.deepEqual(Array.from(dec.channels[0].slice(0, 5)), [0, 256, -768, 4194304, -4194304])
  const quiet = encodeFlac({ sampleRate: 44100, channels: [new Float32Array(44100)] })
  assert.ok(quiet.bytes.length < 400)
})

test('band energy finds a tone in the right band and is labelled as measurement', () => {
  const r = bandEnergy({ sampleRate: 44100, channels: [sine(44100, 1000, 44100, 0.5)] })
  assert.ok(r.ok)
  if (!r.ok) return
  const top = [...r.bands].sort((a, b) => b.energyDb - a.energyDb)[0]
  assert.equal(top.name, 'mid')
  assert.ok(Math.abs(top.energyDb - 10 * Math.log10(0.125)) < 1)
  assert.ok(r.speechBandShare > 0.95)
  assert.match(r.caveat, /does not detect vocals/)
  const lo = bandEnergy({ sampleRate: 44100, channels: [sine(44100, 100, 44100)] })
  assert.ok(lo.ok && lo.speechBandShare < 0.1)
  assert.equal(bandEnergy({ sampleRate: 44100, channels: [new Float32Array(10)] }).ok, false)
})
