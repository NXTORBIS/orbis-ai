/**
 * MD5, for the checksums download pages still publish.
 *
 * Web Crypto deliberately does not offer MD5 — it is broken for anything to do with
 * security. But released files are very often accompanied by an MD5 or SHA-256 checksum,
 * and confirming a download arrived intact means being able to compute the one that was
 * published. This is a direct implementation of RFC 1321, used for integrity checking
 * only, never for passwords, signatures or anything an attacker would care about.
 */

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// K[i] = floor(2^32 × |sin(i + 1)|), the standard constant table.
const K = new Uint32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

/** MD5 of a file's bytes, as a lowercase hex string. */
export function md5Hex(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const len = bytes.length;
  const bitLen = len * 8;

  // Pad to a multiple of 64 bytes: a single 1 bit, zeros, then the length in bits.
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  const words = new Uint32Array(16);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, true);
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + K[i] + words[g]) | 0;
      const s = SHIFTS[i];
      const rotated = (sum << s) | (sum >>> (32 - s));
      const previous = d;
      d = c;
      c = b;
      b = (b + rotated) | 0;
      a = previous;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
  }

  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0 >>> 0, true);
  outView.setUint32(4, h1 >>> 0, true);
  outView.setUint32(8, h2 >>> 0, true);
  outView.setUint32(12, h3 >>> 0, true);
  return Array.from(out).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}