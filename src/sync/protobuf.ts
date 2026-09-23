/**
 * Just enough protocol buffers to speak Chromium's sync protocol.
 *
 * The browser talks to a sync server in protobuf, so a server that is not Google's has to read and write the same bytes.
 * This is the wire format only — varints, length-delimited fields and groups — with no schema and no code generation:
 * the fields that matter are read by number at the point of use (see protocol.ts), which is the whole of what is needed
 * and avoids carrying a protobuf compiler and 94 .proto files into the build.
 *
 * Wire types, from the protobuf spec: 0 varint, 1 fixed64, 2 length-delimited, 3 start group, 4 end group, 5 fixed32.
 * Groups are obsolete in new protobuf code but Chromium's CommitResponse still uses one (`repeated group EntryResponse`),
 * so they are here.
 */

export const WIRE = { VARINT: 0, FIXED64: 1, BYTES: 2, GROUP_START: 3, GROUP_END: 4, FIXED32: 5 } as const

export interface Field {
  no: number
  wire: number
  /** Varints and fixed widths arrive as a number; everything length-delimited (and a group's body) as bytes. */
  value: number | Uint8Array
}

/** Every field in the message, in the order it appeared. Repeated fields simply appear more than once. */
export function decode(bytes: Uint8Array): Field[] {
  const out: Field[] = []
  let i = 0
  const varint = (): number => {
    let result = 0
    let shift = 0
    for (;;) {
      if (i >= bytes.length) throw new Error('Truncated varint.')
      const byte = bytes[i++]
      // Numbers beyond 2^53 cannot be held exactly; sync ids and versions stay far below that.
      result += (byte & 0x7f) * Math.pow(2, shift)
      if ((byte & 0x80) === 0) return result
      shift += 7
      if (shift > 63) throw new Error('Varint too long.')
    }
  }
  while (i < bytes.length) {
    const tag = varint()
    const no = tag >>> 3
    const wire = tag & 7
    if (no === 0) throw new Error('Field number 0 is not valid.')
    if (wire === WIRE.VARINT) out.push({ no, wire, value: varint() })
    else if (wire === WIRE.FIXED64) { out.push({ no, wire, value: bytes.slice(i, i + 8) }); i += 8 }
    else if (wire === WIRE.FIXED32) { out.push({ no, wire, value: bytes.slice(i, i + 4) }); i += 4 }
    else if (wire === WIRE.BYTES) {
      const len = varint()
      if (i + len > bytes.length) throw new Error('Truncated length-delimited field.')
      out.push({ no, wire, value: bytes.slice(i, i + len) })
      i += len
    } else if (wire === WIRE.GROUP_START) {
      // A group runs to its matching end tag; nested groups of the same number are counted so the right one ends it.
      const start = i
      let depth = 1
      while (i < bytes.length && depth > 0) {
        const inner = varint()
        const innerNo = inner >>> 3
        const innerWire = inner & 7
        if (innerWire === WIRE.GROUP_START && innerNo === no) depth++
        else if (innerWire === WIRE.GROUP_END && innerNo === no) { depth--; if (depth === 0) break }
        else if (innerWire === WIRE.VARINT) varint()
        else if (innerWire === WIRE.FIXED64) i += 8
        else if (innerWire === WIRE.FIXED32) i += 4
        else if (innerWire === WIRE.BYTES) {
          // Read the length before moving: `i += varint()` takes i's value first and then overwrites the advance
          // varint() made, which silently lands the reader inside the field it meant to step over.
          const len = varint()
          i += len
        } else if (innerWire === WIRE.GROUP_END) throw new Error('Group ended with the wrong field number.')
      }
      if (depth !== 0) throw new Error('Unterminated group.')
      // The bytes of the group's body, without its end tag: readable with decode() like any message.
      const endTagLength = sizeOfVarint((no << 3) | WIRE.GROUP_END)
      out.push({ no, wire, value: bytes.slice(start, i - endTagLength) })
    } else throw new Error(`Unknown wire type ${wire}.`)
  }
  return out
}

const sizeOfVarint = (value: number): number => {
  let size = 1
  let v = Math.floor(value / 128)
  while (v > 0) { size++; v = Math.floor(v / 128) }
  return size
}

/**
 * A field's last value of the wire type being asked for, which is what protobuf says an optional field means when it
 * appears more than once. The wire type is part of the question on purpose: a number and a group can share a field
 * number across different messages, and reading one as the other silently yields nonsense rather than nothing.
 */
export const one = (fields: Field[], no: number, wire?: number): Field | undefined => {
  let found: Field | undefined
  for (const f of fields) if (f.no === no && (wire === undefined || f.wire === wire)) found = f
  return found
}
export const many = (fields: Field[], no: number, wire?: number): Field[] =>
  fields.filter((f) => f.no === no && (wire === undefined || f.wire === wire))
export const num = (fields: Field[], no: number, fallback = 0): number => {
  const f = one(fields, no, WIRE.VARINT)
  return f && typeof f.value === 'number' ? f.value : fallback
}
export const bool = (fields: Field[], no: number, fallback = false): boolean => {
  const f = one(fields, no, WIRE.VARINT)
  return f && typeof f.value === 'number' ? f.value !== 0 : fallback
}
export const bytes = (fields: Field[], no: number): Uint8Array | undefined => {
  const f = one(fields, no, WIRE.BYTES)
  return f && f.value instanceof Uint8Array ? f.value : undefined
}
export const str = (fields: Field[], no: number, fallback = ''): string => {
  const b = bytes(fields, no)
  return b ? new TextDecoder().decode(b) : fallback
}
/** An embedded message, read as its own field list. */
export const sub = (fields: Field[], no: number): Field[] | undefined => {
  const b = bytes(fields, no)
  return b ? decode(b) : undefined
}
/** The bodies of a repeated group, each readable with decode(). */
export const groups = (fields: Field[], no: number): Field[][] =>
  many(fields, no, WIRE.GROUP_START).map((f) => decode(f.value as Uint8Array))

export class Writer {
  private readonly parts: Uint8Array[] = []

  private raw(bytes: Uint8Array): this {
    this.parts.push(bytes)
    return this
  }

  private varintBytes(value: number): Uint8Array {
    if (value < 0 || !Number.isFinite(value)) throw new Error('Only non-negative varints are written here.')
    const out: number[] = []
    let v = Math.floor(value)
    do {
      const byte = v % 128
      v = Math.floor(v / 128)
      out.push(v > 0 ? byte | 0x80 : byte)
    } while (v > 0)
    return new Uint8Array(out)
  }

  private tag(no: number, wire: number): this {
    return this.raw(this.varintBytes((no << 3) | wire))
  }

  varint(no: number, value: number): this {
    return this.tag(no, WIRE.VARINT).raw(this.varintBytes(value))
  }

  boolean(no: number, value: boolean): this {
    return this.varint(no, value ? 1 : 0)
  }

  bytes(no: number, value: Uint8Array): this {
    return this.tag(no, WIRE.BYTES).raw(this.varintBytes(value.length)).raw(value)
  }

  string(no: number, value: string): this {
    return this.bytes(no, new TextEncoder().encode(value))
  }

  /** An embedded message, written by the given function. */
  message(no: number, write: (w: Writer) => void): this {
    const inner = new Writer()
    write(inner)
    return this.bytes(no, inner.finish())
  }

  /** A group: its body between a start and an end tag, which is how CommitResponse carries its entries. */
  group(no: number, write: (w: Writer) => void): this {
    const inner = new Writer()
    write(inner)
    return this.tag(no, WIRE.GROUP_START).raw(inner.finish()).tag(no, WIRE.GROUP_END)
  }

  finish(): Uint8Array {
    const size = this.parts.reduce((n, p) => n + p.length, 0)
    const out = new Uint8Array(size)
    let at = 0
    for (const p of this.parts) { out.set(p, at); at += p.length }
    return out
  }
}
