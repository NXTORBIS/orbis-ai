import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { COSMETICS } from './orbi.ts'

/**
 * Every thing that can go in Orbi's room has a picture of its own.
 *
 * The room draws a plain crate for anything it does not recognise, which is the right fallback and the wrong thing
 * to ship: a new item added to the list would quietly appear as a box and nobody would notice. This reads the art
 * file and checks the two lists agree.
 *
 * It is a text check rather than a render because the renderer has no DOM in tests — and what matters here is the
 * pairing of the lists, not the shape of a path.
 */

test('every room item has something drawn for it', async () => {
  const art = await readFile(resolve(import.meta.dirname, '../../renderer/src/components/student/roomArt.tsx'), 'utf8')
  const missing = COSMETICS.filter((one) => one.kind === 'room').filter((one) => !art.includes(`'${one.id}'`))
  assert.deepEqual(
    missing.map((one) => one.id),
    [],
    'these room items would draw as a plain crate: add them to ROOM_ART in roomArt.tsx'
  )
})

test('nothing is drawn for something that is not a room item', async () => {
  const art = await readFile(resolve(import.meta.dirname, '../../renderer/src/components/student/roomArt.tsx'), 'utf8')
  const drawn = [...art.matchAll(/^ {2}'(room-[\w-]+)':/gm)].map((one) => one[1])
  const known = new Set(COSMETICS.filter((one) => one.kind === 'room').map((one) => one.id))
  for (const id of drawn) assert.ok(known.has(id), `${id} is drawn but is not a room item any more`)
})

test('the art file names no image or network address', async () => {
  // Drawn in code, on purpose: the room has to work offline and stay sharp at any size.
  const art = await readFile(join(resolve(import.meta.dirname, '../../renderer/src/components/student'), 'roomArt.tsx'), 'utf8')
  assert.ok(!/https?:\/\//.test(art))
  assert.ok(!/\.(png|jpe?g|svg|gif|webp)['"]/i.test(art))
})
