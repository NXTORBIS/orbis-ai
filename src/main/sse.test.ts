import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SseParser, ThinkTagSplitter } from './sse.ts'

test('SseParser handles events split across chunks and CRLF', () => {
  const p = new SseParser()
  assert.deepEqual(p.push('data: {"a":'), [])
  assert.deepEqual(p.push('1}\r\n\r\ndata: [DO'), ['{"a":1}'])
  assert.deepEqual(p.push('NE]\n\n'), ['[DONE]'])
})

test('SseParser ignores comments and flushes a trailing event', () => {
  const p = new SseParser()
  assert.deepEqual(p.push(': keep-alive\n\ndata:x\n'), [])
  assert.deepEqual(p.flush(), ['x'])
})

test('ThinkTagSplitter separates reasoning with tags split across chunks', () => {
  const s = new ThinkTagSplitter()
  const parts = ['<thi', 'nk>plan it</th', 'ink>Answer', ' here'].map((c) => s.push(c))
  parts.push(s.flush())
  assert.equal(parts.map((p) => p.reasoning).join(''), 'plan it')
  assert.equal(parts.map((p) => p.content).join(''), 'Answer here')
})

test('ThinkTagSplitter ignores <think> once answer text has started', () => {
  const s = new ThinkTagSplitter()
  const a = s.push('Use a <think> tag')
  const b = s.flush()
  assert.equal(a.content + b.content, 'Use a <think> tag')
  assert.equal(a.reasoning + b.reasoning, '')
})

test('ThinkTagSplitter allows leading whitespace before <think>', () => {
  const s = new ThinkTagSplitter()
  const a = s.push('\n<think>hmm</think>Hi')
  assert.equal(a.reasoning, 'hmm')
  assert.equal(a.content, 'Hi')
})
