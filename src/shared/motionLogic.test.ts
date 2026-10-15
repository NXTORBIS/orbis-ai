import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rehypeGlide } from './chatGlide.ts'
import { gapSeconds, placeCars } from './f1/raceStrip.ts'
import { DONE_FOR_MS, orbMood } from './orbMood.ts'

const base = { streaming: false, hasContent: false, failed: false, finishedAt: null as number | null, now: 10_000 }

test('the Orb: thinking before words, answering once they arrive, done briefly, error until the next reply', () => {
  assert.equal(orbMood({ ...base }), 'idle')
  assert.equal(orbMood({ ...base, streaming: true }), 'thinking')
  assert.equal(orbMood({ ...base, streaming: true, hasContent: true }), 'answering')
  assert.equal(orbMood({ ...base, finishedAt: 10_000 - 500 }), 'done')
  assert.equal(orbMood({ ...base, finishedAt: 10_000 - DONE_FOR_MS - 1 }), 'idle')
  assert.equal(orbMood({ ...base, failed: true, finishedAt: 9_900 }), 'error')
  // a new reply starting clears an old failure
  assert.equal(orbMood({ ...base, failed: true, streaming: true }), 'thinking')
})

const text = (value: string) => ({ type: 'text', value })
const el = (tagName: string, children: unknown[], properties: Record<string, unknown> = {}) => ({ type: 'element', tagName, properties, children })

test('glide wraps the words of the last block only, never code or links, and keeps the spaces', () => {
  const first = el('p', [text('Old words stay')])
  const last = el('p', [text('New '), el('code', [text('let x')]), text(' and '), el('a', [text('link')]), text(' words')])
  const tree = { type: 'root', children: [first, last] }
  rehypeGlide()(tree as never)
  assert.equal((first.children[0] as { type: string }).type, 'text')
  const kinds = last.children.map((c) => (c as { type: string; tagName?: string }).tagName ?? 'text')
  assert.ok(kinds.includes('code') && kinds.includes('a'))
  const spans = last.children.filter((c) => (c as { tagName?: string }).tagName === 'span')
  assert.deepEqual(spans.map((s) => ((s as { children: { value: string }[] }).children[0].value)), ['New', 'and', 'words'])
  const joined = last.children.map((c) => ((c as { value?: string }).value ?? (c as { children?: { value?: string }[] }).children?.[0]?.value ?? '')).join('')
  assert.equal(joined.replace(/\s+/g, ' ').trim(), 'New let x and link words')
})

test('race strip: the leader at the right, others by their real gap, lapped cars marked at the edge', () => {
  assert.equal(gapSeconds('+12.345'), 12.345)
  assert.equal(gapSeconds('LAP 5'), null)
  assert.equal(gapSeconds('1L'), null)
  const { cars, scaleSeconds } = placeCars([
    { number: '1', code: 'VER', colour: null, position: 1, gapToLeader: null },
    { number: '4', code: 'NOR', colour: null, position: 2, gapToLeader: '+5.000' },
    { number: '16', code: 'LEC', colour: null, position: 3, gapToLeader: '+20.000' },
    { number: '44', code: 'HAM', colour: null, position: 4, gapToLeader: '1L' }
  ])
  assert.equal(scaleSeconds, 20)
  assert.ok(cars[0].x > cars[1].x && cars[1].x > cars[2].x)
  assert.equal(cars[3].lapped, true)
  assert.equal(cars[3].x, 4)
  assert.ok(cars.every((c) => c.x >= 4 && c.x <= 94))
})
