import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrionSearchSession } from '../../shared/orionSearch.ts'
import { normalizeSearchSession, resumeRequest } from '../../shared/searchSessions.ts'
import { SearchSessionStore } from './searchSessions.ts'

const session = (id: string, topic: string, extra: Partial<OrionSearchSession> = {}): OrionSearchSession => ({
  id,
  profileId: 'default',
  topic,
  turns: [{ id: 't1', question: `Research ${topic}`, answer: `Here is what I found about ${topic}.`, used: [1], researched: true, at: 100 }],
  sources: [
    { url: `https://docs.example.com/${topic.replace(/\s+/g, '-')}`, title: `${topic} documentation`, site: 'docs.example.com', snippet: '', turn: 0 },
    { url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser', site: 'wikipedia.org', snippet: '', turn: 0 }
  ],
  entities: [topic],
  constraints: [],
  startedAt: 100,
  updatedAt: 200,
  ...extra
})

function withStore(run: (store: SearchSessionStore, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'orbis-search-'))
  const store = new SearchSessionStore(dir)
  try {
    run(store, dir)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('asking to pick up earlier research is recognised, and ordinary searches are not', () => {
  assert.equal(resumeRequest('Continue my research on Chromium'), 'Chromium')
  assert.equal(resumeRequest('resume the search about electric cars.'), 'electric cars')
  assert.equal(resumeRequest('go back to my previous research into local AI models'), 'local AI models')
  for (const ordinary of ['chromium research papers', 'continue reading', 'how do I resume a download']) assert.equal(resumeRequest(ordinary), null, ordinary)
})

test('only a real session with an answer is kept, and only web links survive', () => {
  assert.equal(normalizeSearchSession({ id: 'x', turns: [] }, 'default'), null, 'nothing was answered')
  assert.equal(normalizeSearchSession({ id: '../../evil', turns: session('a', 'b').turns }, 'default'), null, 'a path is not an id')
  const kept = normalizeSearchSession(
    session('s1', 'chromium', {
      sources: [
        { url: 'javascript:alert(1)', title: 'x', site: '', snippet: '', turn: 0 },
        { url: 'file:///C:/Windows/system32', title: 'x', site: '', snippet: '', turn: 0 },
        { url: 'https://chromium.org/', title: 'Chromium', site: 'chromium.org', snippet: '', turn: 0 }
      ]
    }),
    'work'
  )!
  assert.deepEqual(kept.sources.map((s) => s.url), ['https://chromium.org/'])
  assert.equal(kept.profileId, 'work', 'it belongs to the profile it is saved in, whatever it claims')
})

test('saved research comes back exactly, is found by what was asked and where it looked, and can be deleted', () =>
  withStore((store) => {
    store.save(session('s1', 'chromium architecture'))
    store.save(session('s2', 'electric cars', { updatedAt: 300 }))
    assert.deepEqual(store.list().map((s) => s.id), ['s2', 's1'], 'newest first')

    const back = store.get('s1')!
    assert.equal(back.turns[0].answer, 'Here is what I found about chromium architecture.')
    assert.equal(back.sources.length, 2)

    assert.deepEqual(store.list('chromium').map((s) => s.id), ['s1'])
    assert.equal(store.find('Chromium')?.id, 's1', '"continue my research on Chromium" finds it')
    assert.deepEqual(store.sessionsUsing('https://en.wikipedia.org/wiki/Web_browser').map((s) => s.id).sort(), ['s1', 's2'])

    // Saving again updates rather than duplicating, and the search follows the new content.
    store.save(session('s1', 'chromium architecture', { turns: [...session('s1', 'x').turns, { id: 't2', question: 'What about Blink?', answer: 'Blink is the rendering engine.', used: [], researched: false, at: 250 }], updatedAt: 400 }))
    assert.equal(store.list().length, 2)
    assert.equal(store.get('s1')!.turns.length, 2)
    assert.deepEqual(store.list('blink').map((s) => s.id), ['s1'])

    assert.equal(store.remove('s1'), true)
    assert.equal(store.get('s1'), null)
    assert.deepEqual(store.list('blink'), [], 'the search index forgets it too')
    assert.deepEqual(store.sessionsUsing('https://docs.example.com/chromium-architecture'), [], 'and its sources')
  }))

test('each profile has its own saved research', () =>
  withStore((store, dir) => {
    store.save(session('s1', 'chromium'))
    store.useProfile('work')
    assert.deepEqual(store.list(), [])
    assert.equal(store.find('chromium'), null)
    store.save(session('s9', 'tax rules'))
    store.useProfile('default')
    assert.deepEqual(store.list().map((s) => s.id), ['s1'])
    const reopened = new SearchSessionStore(dir, 'work')
    assert.deepEqual(reopened.list().map((s) => s.id), ['s9'])
    reopened.close()
  }))
