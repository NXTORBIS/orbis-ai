import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bool, bytes, decode, groups, many, num, str, sub, Writer } from './protobuf.ts'

test('what is written is what is read back', () => {
  const w = new Writer()
  w.string(1, 'orbis-share')
  w.varint(2, 99)
  w.varint(3, 2)
  w.boolean(7, true)
  w.bytes(8, new Uint8Array([0, 1, 250, 255]))
  const f = decode(w.finish())
  assert.equal(str(f, 1), 'orbis-share')
  assert.equal(num(f, 2), 99)
  assert.equal(num(f, 3), 2)
  assert.equal(bool(f, 7), true)
  assert.deepEqual([...(bytes(f, 8) ?? [])], [0, 1, 250, 255])
})

test('varints of every size survive the trip', () => {
  const values = [0, 1, 127, 128, 300, 16_383, 16_384, 2_097_151, 2_097_152, 1_000_000_000, Number.MAX_SAFE_INTEGER]
  const w = new Writer()
  values.forEach((v, i) => w.varint(i + 1, v))
  const f = decode(w.finish())
  values.forEach((v, i) => assert.equal(num(f, i + 1), v, `field ${i + 1}`))
})

test('embedded messages nest', () => {
  const w = new Writer()
  w.message(5, (m) => {
    m.boolean(3, true)
    m.message(6, (pm) => {
      pm.varint(1, 32904)
      pm.bytes(2, new Uint8Array([9, 8, 7]))
    })
  })
  const f = decode(w.finish())
  const getUpdates = sub(f, 5)
  assert.ok(getUpdates)
  assert.equal(bool(getUpdates, 3), true)
  const marker = sub(getUpdates, 6)
  assert.ok(marker)
  assert.equal(num(marker, 1), 32904)
  assert.deepEqual([...(bytes(marker, 2) ?? [])], [9, 8, 7])
})

test('repeated fields keep every value, in order', () => {
  const w = new Writer()
  w.string(1, 'first')
  w.string(1, 'second')
  w.string(1, 'third')
  const f = decode(w.finish())
  assert.deepEqual(
    many(f, 1).map((x) => new TextDecoder().decode(x.value as Uint8Array)),
    ['first', 'second', 'third']
  )
})

test('groups round-trip, which CommitResponse needs', () => {
  const w = new Writer()
  w.group(1, (g) => {
    g.varint(2, 1)
    g.string(3, 'entity-7')
    g.varint(6, 12)
  })
  w.group(1, (g) => {
    g.varint(2, 1)
    g.string(3, 'entity-8')
    g.varint(6, 3)
  })
  const f = decode(w.finish())
  const rows = groups(f, 1)
  assert.equal(rows.length, 2)
  assert.equal(str(rows[0], 3), 'entity-7')
  assert.equal(num(rows[0], 6), 12)
  assert.equal(str(rows[1], 3), 'entity-8')
  assert.equal(num(rows[1], 3 + 3), 3)
})

test('a group holding a group of the same number ends at the right one', () => {
  const w = new Writer()
  w.group(1, (outer) => {
    outer.string(3, 'outer')
    outer.group(1, (inner) => inner.string(3, 'inner'))
    outer.varint(6, 42)
  })
  const f = decode(w.finish())
  const outer = groups(f, 1)
  assert.equal(outer.length, 1, 'the nested group is inside, not beside')
  assert.equal(str(outer[0], 3), 'outer')
  assert.equal(num(outer[0], 6), 42, 'the field after the nested group still belongs to the outer one')
  assert.equal(str(groups(outer[0], 1)[0], 3), 'inner')
})

// The bug this file caught first time out: a number and a group sharing a field number, read as the wrong one.
test('a field is read as the type asked for, not whatever came last', () => {
  const w = new Writer()
  w.string(1, 'the-share')
  w.group(1, (g) => g.string(3, 'an-entry'))
  const f = decode(w.finish())
  assert.equal(str(f, 1), 'the-share', 'the group does not get decoded as text')
  assert.equal(groups(f, 1).length, 1)
  assert.equal(str(groups(f, 1)[0], 3), 'an-entry')
})

test('truncated and malformed input is refused rather than guessed at', () => {
  assert.throws(() => decode(new Uint8Array([0x08])), /varint/i, 'a tag with no value')
  assert.throws(() => decode(new Uint8Array([0x12, 0x05, 1, 2])), /truncated/i, 'a length longer than the body')
  assert.throws(() => decode(new Uint8Array([0x00])), /field number 0/i)
  assert.throws(() => decode(new Uint8Array([0x0b, 0x18, 0x01])), /group/i, 'a group that never ends')
})
