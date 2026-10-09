/**
 * Hashing, encoding and the classical ciphers — written out rather than called.
 *
 * ## Why implement SHA-256 instead of asking the platform for it
 *
 * `crypto.subtle.digest` gives the answer and teaches nothing. Here the rounds are visible: the message is padded,
 * split into blocks, expanded into sixty-four words, and eight working variables are stirred sixty-four times. A
 * laboratory whose point is "watch the avalanche happen" has to own the rounds, and the test file checks every
 * output against the published vectors so owning them costs no correctness.
 *
 * ## Encoding is not encryption, and the screen says so
 *
 * Base64 and hexadecimal hide nothing — anybody can undo them with no secret at all. Caesar and ROT13 are
 * breakable by hand in under a minute. XOR with a repeating key is breakable by anybody who knows the method.
 * Every one of these carries that sentence with it, because the single most common mistake in this area is
 * believing that unreadable means protected.
 *
 * ## What is deliberately absent
 *
 * Nothing here is for protecting anything. No password hashing, no key derivation, no modern cipher. Orbis has a
 * Secrets Vault for real secrets, and this laboratory never touches it.
 *
 * Pure. No clock, no randomness, no host access.
 */

export interface CryptoError {
  error: 'input' | 'too-big' | 'bad-key' | 'bad-encoding'
  message: string
  fix: string
}

export const isCryptoError = (value: unknown): value is CryptoError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'fix' in (value as Record<string, unknown>)

const fail = (error: CryptoError['error'], message: string, fix: string): CryptoError => ({ error, message, fix })

export const LIMITS = Object.freeze({ text: 100_000, key: 256, rounds: 64 })

// ---------------------------------------------------------------- SHA-256

/** The first thirty-two bits of the fractional parts of the cube roots of the first sixty-four primes. */
const K: readonly number[] = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2
])

/** The first thirty-two bits of the fractional parts of the square roots of the first eight primes. */
const H0: readonly number[] = Object.freeze([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])

const rotr = (value: number, by: number): number => ((value >>> by) | (value << (32 - by))) >>> 0

/** Text to bytes, the way everything else does it: UTF-8. */
export function toBytes(text: string): number[] {
  const out: number[] = []
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
  }
  return out
}

export interface HashReport {
  /** The digest, lowercase hexadecimal. */
  hex: string
  /** How many bytes the message was, and how many it became after padding. */
  bytes: number
  padded: number
  blocks: number
  /** The eight working variables after each round of the final block, for watching the mixing. */
  rounds: readonly { round: number; a: string; e: string }[]
  says: string
  notes: readonly string[]
}

/**
 * SHA-256, with the rounds kept.
 *
 * The padding rule is the part people get wrong: append a single 1 bit, then zeros until the length is 8 bytes
 * short of a multiple of 64, then the original length in bits as a 64-bit big-endian number. The length going in
 * at the end is what stops two different messages padding to the same bytes.
 */
export function sha256(text: string): HashReport | CryptoError {
  if (typeof text !== 'string') return fail('input', 'The message has to be text.', 'Type something to hash.')
  if (text.length > LIMITS.text) return fail('too-big', `That is ${text.length.toLocaleString('en-GB')} characters.`, `Use at most ${LIMITS.text.toLocaleString('en-GB')}.`)

  const message = toBytes(text)
  const bitLength = message.length * 8

  const padded = [...message, 0x80]
  while (padded.length % 64 !== 56) padded.push(0)
  // The length as 64 bits. JavaScript numbers are exact well past any message this accepts, so the high word is
  // computed by division rather than by a shift, which would overflow at 2^31.
  const high = Math.floor(bitLength / 0x100000000)
  const low = bitLength >>> 0
  padded.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff)
  padded.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff)

  const h = [...H0]
  const rounds: { round: number; a: string; e: string }[] = []
  const blocks = padded.length / 64

  for (let block = 0; block < blocks; block += 1) {
    const w = new Array<number>(64).fill(0)
    for (let one = 0; one < 16; one += 1) {
      const at = block * 64 + one * 4
      w[one] = ((padded[at] << 24) | (padded[at + 1] << 16) | (padded[at + 2] << 8) | padded[at + 3]) >>> 0
    }
    // The message schedule: sixteen words become sixty-four, each new one mixing four earlier ones.
    for (let one = 16; one < 64; one += 1) {
      const s0 = (rotr(w[one - 15], 7) ^ rotr(w[one - 15], 18) ^ (w[one - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[one - 2], 17) ^ rotr(w[one - 2], 19) ^ (w[one - 2] >>> 10)) >>> 0
      w[one] = (w[one - 16] + s0 + w[one - 7] + s1) >>> 0
    }

    let [a, b, c, d, e, f, g, hh] = h
    for (let one = 0; one < 64; one += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (hh + S1 + ch + K[one] + w[one]) >>> 0
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (S0 + maj) >>> 0
      hh = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
      if (block === blocks - 1) {
        rounds.push({ round: one, a: a.toString(16).padStart(8, '0'), e: e.toString(16).padStart(8, '0') })
      }
    }

    h[0] = (h[0] + a) >>> 0
    h[1] = (h[1] + b) >>> 0
    h[2] = (h[2] + c) >>> 0
    h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0
    h[5] = (h[5] + f) >>> 0
    h[6] = (h[6] + g) >>> 0
    h[7] = (h[7] + hh) >>> 0
  }

  return {
    hex: h.map((one) => one.toString(16).padStart(8, '0')).join(''),
    bytes: message.length,
    padded: padded.length,
    blocks,
    rounds: Object.freeze(rounds),
    says: `${message.length} byte${message.length === 1 ? '' : 's'} padded to ${padded.length}, hashed in ${blocks} block${blocks === 1 ? '' : 's'} of 64 rounds.`,
    notes: Object.freeze([
      'The padding is a single 1 bit, then zeros, then the original length in bits. The length at the end is what stops two different messages padding to the same bytes.',
      'The digest is always 256 bits however long the message is, so it cannot be undone — there is nowhere for the rest of the message to have gone.',
      'This is a hash, not encryption. It is for checking that something has not changed, never for hiding it.'
    ])
  }
}

/** How many bits differ between two hex digests. The avalanche, counted. */
export function differingBits(a: string, b: string): number {
  let out = 0
  for (let one = 0; one < Math.min(a.length, b.length); one += 1) {
    let x = parseInt(a[one], 16) ^ parseInt(b[one], 16)
    while (x > 0) {
      out += x & 1
      x >>= 1
    }
  }
  return out
}

// ---------------------------------------------------------------- encoding

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64, written out so the three-bytes-into-four-characters shape is visible. */
export function toBase64(text: string): string | CryptoError {
  if (typeof text !== 'string') return fail('input', 'The text has to be text.', 'Type something.')
  if (text.length > LIMITS.text) return fail('too-big', 'That is too long to encode here.', `Use at most ${LIMITS.text.toLocaleString('en-GB')} characters.`)
  const bytes = toBytes(text)
  let out = ''
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]
    const b = bytes[at + 1]
    const c = bytes[at + 2]
    // Three bytes are twenty-four bits, which is four lots of six. The padding is for when there are not three.
    out += BASE64[a >> 2]
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : BASE64[c & 63]
  }
  return out
}

export function fromBase64(encoded: string): string | CryptoError {
  if (typeof encoded !== 'string') return fail('input', 'That is not text.', 'Paste some Base64.')
  const clean = encoded.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    return fail('bad-encoding', 'That is not Base64 — it has characters the alphabet does not use.', 'Base64 uses A–Z, a–z, 0–9, + and /, with = only at the end.')
  }
  const bytes: number[] = []
  const body = clean.replace(/=+$/, '')
  for (let at = 0; at < body.length; at += 4) {
    const chunk = [0, 1, 2, 3].map((one) => BASE64.indexOf(body[at + one] ?? 'A'))
    bytes.push((chunk[0] << 2) | (chunk[1] >> 4))
    if (body[at + 2] !== undefined) bytes.push(((chunk[1] & 15) << 4) | (chunk[2] >> 2))
    if (body[at + 3] !== undefined) bytes.push(((chunk[2] & 3) << 6) | chunk[3])
  }
  return fromBytes(bytes)
}

/** Bytes back to text, reading UTF-8. Invalid sequences become the replacement character rather than throwing. */
export function fromBytes(bytes: readonly number[]): string {
  let out = ''
  for (let at = 0; at < bytes.length; ) {
    const one = bytes[at]
    if (one < 0x80) {
      out += String.fromCodePoint(one)
      at += 1
    } else if (one >= 0xc0 && one < 0xe0 && at + 1 < bytes.length) {
      out += String.fromCodePoint(((one & 0x1f) << 6) | (bytes[at + 1] & 0x3f))
      at += 2
    } else if (one >= 0xe0 && one < 0xf0 && at + 2 < bytes.length) {
      out += String.fromCodePoint(((one & 0x0f) << 12) | ((bytes[at + 1] & 0x3f) << 6) | (bytes[at + 2] & 0x3f))
      at += 3
    } else if (one >= 0xf0 && at + 3 < bytes.length) {
      out += String.fromCodePoint(((one & 0x07) << 18) | ((bytes[at + 1] & 0x3f) << 12) | ((bytes[at + 2] & 0x3f) << 6) | (bytes[at + 3] & 0x3f))
      at += 4
    } else {
      out += '�'
      at += 1
    }
  }
  return out
}

export const toHex = (text: string): string =>
  toBytes(text)
    .map((one) => one.toString(16).padStart(2, '0'))
    .join(' ')

// ---------------------------------------------------------------- the classical ciphers

/** Shift every letter along the alphabet. Case is kept; anything that is not a letter is left alone. */
export function caesar(text: string, shift: number): string {
  const by = ((Math.trunc(shift) % 26) + 26) % 26
  let out = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    if (code >= 65 && code <= 90) out += String.fromCharCode(((code - 65 + by) % 26) + 65)
    else if (code >= 97 && code <= 122) out += String.fromCharCode(((code - 97 + by) % 26) + 97)
    else out += character
  }
  return out
}

/** Caesar by thirteen, which is its own inverse — which is the only reason it has its own name. */
export const rot13 = (text: string): string => caesar(text, 13)

export interface BreakReport {
  /** Every shift, with what it gives and how English-like that looks. */
  tries: readonly { shift: number; text: string; score: number }[]
  /** The shift that scored best. */
  best: number
  says: string
}

/**
 * Break a Caesar cipher by trying all twenty-six shifts and scoring each for letter frequency.
 *
 * There is no cleverness here and that is the lesson: a cipher with twenty-six keys can be broken by trying all
 * twenty-six, and the score only picks which one to show first.
 */
export function breakCaesar(text: string): BreakReport | CryptoError {
  if (typeof text !== 'string' || text.length === 0) return fail('input', 'There is nothing to break.', 'Paste some enciphered text.')
  // How often each letter appears in English, per mille. Used only for scoring, never for deciding.
  const ENGLISH: Readonly<Record<string, number>> = {
    e: 127, t: 91, a: 82, o: 75, i: 70, n: 67, s: 63, h: 61, r: 60, d: 43, l: 40, c: 28, u: 28,
    m: 24, w: 24, f: 22, g: 20, y: 20, p: 19, b: 15, v: 10, k: 8, j: 2, x: 2, q: 1, z: 1
  }
  const tries = Array.from({ length: 26 }, (_, shift) => {
    const made = caesar(text, -shift)
    let score = 0
    for (const character of made.toLowerCase()) score += ENGLISH[character] ?? 0
    return { shift, text: made, score }
  })
  const best = [...tries].sort((a, b) => b.score - a.score)[0]
  return {
    tries: Object.freeze(tries),
    best: best.shift,
    says: `Shift ${best.shift} scores highest: "${best.text.slice(0, 60)}${best.text.length > 60 ? '…' : ''}"`
  }
}

export interface XorReport {
  /** The result as hexadecimal, because XOR of text usually is not text. */
  hex: string
  /** And as text, where it happens to be printable. */
  text: string
  keyLength: number
  says: string
  notes: readonly string[]
}

/**
 * XOR each byte with a repeating key.
 *
 * Its own inverse, which is why one function does both directions. It is also the easiest cipher in the world to
 * break once the key length is known — and the key length shows up as a repeating pattern in the output, which is
 * why the report says how long the key was rather than treating it as a secret.
 */
export function xorCipher(text: string, key: string): XorReport | CryptoError {
  if (typeof text !== 'string') return fail('input', 'The text has to be text.', 'Type something.')
  if (typeof key !== 'string' || key.length === 0) return fail('bad-key', 'There is no key.', 'Type a key of at least one character.')
  if (key.length > LIMITS.key) return fail('bad-key', `A key of ${key.length} characters is longer than this uses.`, `Use at most ${LIMITS.key}.`)

  const bytes = toBytes(text)
  const keyBytes = toBytes(key)
  const out = bytes.map((one, at) => one ^ keyBytes[at % keyBytes.length])

  return {
    hex: out.map((one) => one.toString(16).padStart(2, '0')).join(''),
    text: fromBytes(out),
    keyLength: keyBytes.length,
    says: `${bytes.length} bytes XOR'd with a ${keyBytes.length}-byte key, repeating ${Math.ceil(bytes.length / keyBytes.length)} times.`,
    notes: Object.freeze([
      'XOR is its own inverse: run the result through the same key and the original comes back.',
      'A repeating key leaves a repeating pattern. Anybody who guesses the key length can break each position separately by letter frequency, which is why this is a demonstration and not protection.',
      'Shown as hexadecimal because XOR of text is usually not text, and pretending otherwise would hide bytes that cannot be printed.'
    ])
  }
}

/** Undo XOR. The same operation, named so nobody has to work that out. */
export function xorFromHex(hex: string, key: string): string | CryptoError {
  const clean = hex.replace(/\s/g, '')
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    return fail('bad-encoding', 'That is not hexadecimal.', 'Use pairs of 0–9 and a–f.')
  }
  if (key.length === 0) return fail('bad-key', 'There is no key.', 'Type the key it was encrypted with.')
  const keyBytes = toBytes(key)
  const bytes: number[] = []
  for (let at = 0; at < clean.length; at += 2) bytes.push(parseInt(clean.slice(at, at + 2), 16))
  return fromBytes(bytes.map((one, at) => one ^ keyBytes[at % keyBytes.length]))
}

export const CRYPTO_NOTES: readonly string[] = Object.freeze([
  'Nothing in this laboratory protects anything. Base64 and hexadecimal hide nothing at all; Caesar and ROT13 are broken by trying twenty-six keys; XOR with a repeating key is broken by anybody who knows the method.',
  'Orbis keeps real secrets in the Secrets Vault, which this laboratory cannot see and never touches.'
])
