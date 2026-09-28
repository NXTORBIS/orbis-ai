import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSuggestions, detectIntents, isAddress, parseWebSuggestions, pickKey, recentSuggestions, searchQueryOf, toUrl, urlKey } from '../shared/omnibox.ts'
import type { OmniSources } from '../shared/omnibox.ts'

const NOW = Date.parse('2026-09-15T10:00:00Z')
const H = 3_600_000

const sources = (over: Partial<OmniSources> = {}): OmniSources => ({
  history: [],
  bookmarks: [],
  searches: [],
  picks: {},
  research: [],
  web: [],
  orion: [],
  now: NOW,
  personalized: true,
  ...over
})

test('addresses open directly; everything else searches', () => {
  assert.equal(toUrl('youtube.com'), 'https://youtube.com')
  assert.equal(toUrl('github.com'), 'https://github.com')
  assert.equal(toUrl('localhost:5173/app'), 'http://localhost:5173/app')
  assert.equal(toUrl('https://example.com/a b'), 'https://example.com/a b')
  // A search belongs to Orbis now, rather than being handed to somebody else's site.
  assert.equal(toUrl('latest NVIDIA GPU'), 'orbis://search?q=latest%20NVIDIA%20GPU')
  assert.match(toUrl('how do I install React'), /^orbis:\/\/search\?q=/)
  // Asking for a particular engine still goes there, so nothing is taken away.
  assert.match(toUrl('!g latest NVIDIA GPU'), /google\.com\/search\?q=latest%20NVIDIA%20GPU$/)
  assert.equal(toUrl('orbis://settings'), 'orbis://settings')
  // File-like words are searches, not sites.
  assert.equal(isAddress('node.js'), false)
  assert.equal(isAddress('index.html'), false)
  assert.equal(isAddress('www.example.md'), true)
  assert.equal(isAddress('docs.github.io'), true)
})

test('intent detection finds questions and result types', () => {
  assert.deepEqual(detectIntents('youtube.com'), ['url'])
  assert.equal(detectIntents('how do I install React')[0], 'question')
  assert.ok(detectIntents('iphone 17 price').includes('shopping'))
  assert.ok(detectIntents('cat pictures').includes('images'))
  assert.ok(detectIntents('dune trailer').includes('videos'))
  assert.equal(detectIntents('best laptop for').at(-1), 'search')
})

test('search queries are recognised in engine result URLs', () => {
  assert.equal(searchQueryOf('https://www.google.com/search?q=best+ai+models&sca=1'), 'best ai models')
  assert.equal(searchQueryOf('https://www.youtube.com/results?search_query=lofi'), 'lofi')
  assert.equal(searchQueryOf('https://github.com/search?q=x'), null)
  assert.equal(urlKey('https://www.GitHub.com/a/#x'), 'github.com/a')
})

test('the first suggestion is what Enter does with the typed text', () => {
  assert.equal(buildSuggestions('github.com', sources()).items[0].url, 'https://github.com')
  const q = buildSuggestions('best laptop for', sources({ web: ['best laptop for students', 'best laptop for programming'] }))
  assert.equal(q.items[0].kind, 'query')
  assert.equal(q.items[0].query, 'best laptop for')
  assert.deepEqual(q.items.slice(1).map((i) => i.text), ['best laptop for students', 'best laptop for programming'])
  assert.equal(buildSuggestions('   ', sources()).items.length, 0)
})

test('a frequently visited site completes inline and leads the list', () => {
  const history = [0, 1, 2, 3].map((n) => ({ url: `https://github.com/anthropics/repo${n}`, title: `Repo ${n}`, visitedAt: NOW - n * H }))
  const r = buildSuggestions('git', sources({ history, web: ['git commands', 'gitlab'] }))
  assert.equal(r.completion, 'github.com')
  assert.equal(r.items[0].url, 'https://github.com/')
  assert.ok(r.items.some((i) => i.kind === 'history'))
  // Right after deleting, the typed text itself leads again.
  const deleting = buildSuggestions('git', sources({ history }), 8, false)
  assert.equal(deleting.completion, null)
  assert.equal(deleting.items[0].kind, 'query')
  // Nothing personal when personalized suggestions are off.
  const off = buildSuggestions('git', sources({ history, personalized: false, web: ['git commands'] }))
  assert.equal(off.completion, null)
  assert.ok(off.items.every((i) => i.kind !== 'history'))
})

test('previous searches continue before generic web suggestions', () => {
  const r = buildSuggestions(
    'best AI',
    sources({ searches: [{ query: 'best AI models', searchedAt: NOW - 2 * H, count: 3 }], web: ['best ai tools', 'best ai image generator'] })
  )
  assert.equal(r.items[1].text, 'best AI models')
  assert.equal(r.items[1].kind, 'search')
  assert.equal(r.items[1].removable, 'search')
})

test('picks the user keeps choosing rank higher; unrelated history never appears', () => {
  const web = ['react tutorial', 'react docs', 'react native']
  const plain = buildSuggestions('react', sources({ web }))
  assert.equal(plain.items[1].text, 'react tutorial')
  const learned = buildSuggestions('react', sources({ web, picks: { [pickKey({ text: 'react docs', query: 'react docs' })]: { count: 5, lastAt: NOW } } }))
  assert.equal(learned.items[1].text, 'react docs')
  const noisy = buildSuggestions('react', sources({ history: [{ url: 'https://weather.example/', title: 'Weather', visitedAt: NOW }] }))
  assert.equal(noisy.items.length, 1)
})

test('site searches, result types and Orion predictions are offered with the right destination', () => {
  const r = buildSuggestions('youtube lofi beats', sources({ orion: ['youtube lofi beats to study'] }))
  const site = r.items.find((i) => i.kind === 'site')
  assert.equal(site?.url, 'https://www.youtube.com/results?search_query=lofi%20beats')
  const orion = r.items.find((i) => i.kind === 'orion')
  assert.equal(orion?.query, 'youtube lofi beats to study')
  assert.equal(orion?.detail, undefined, 'Orion predictions carry no label')
  const images = buildSuggestions('mars wallpapers', sources()).items.find((i) => i.kind === 'vertical')
  assert.match(images?.url ?? '', /tbm=isch/)
})

test('before typing, only real recent activity is shown, grouped', () => {
  assert.deepEqual(recentSuggestions(sources()), [])
  const list = recentSuggestions(
    sources({
      history: [
        { url: 'https://www.google.com/search?q=nvidia+gpu', title: 'nvidia gpu - Google Search', visitedAt: NOW - H },
        { url: 'https://news.example/a', title: 'A', visitedAt: NOW - 2 * H },
        { url: 'https://docs.example/', title: 'Docs', visitedAt: NOW - 3 * H },
        { url: 'https://docs.example/', title: 'Docs', visitedAt: NOW - 30 * H }
      ],
      research: [{ question: 'What changed in React 20?', at: NOW - 5 * H }],
      currentUrl: 'https://news.example/a'
    })
  )
  assert.deepEqual(
    list.map((s) => [s.section, s.text]),
    [
      ['Recent searches', 'nvidia gpu'],
      ['Recently visited', 'Docs'],
      ['Researched with Orion', 'What changed in React 20?']
    ]
  )
  assert.deepEqual(recentSuggestions(sources({ personalized: false, searches: [{ query: 'x', searchedAt: NOW, count: 1 }] })), [])
})

test('web suggestion responses are cleaned and de-duplicated', () => {
  assert.deepEqual(parseWebSuggestions(['react', ['react', 'React docs', 'react  docs', 'react hooks', 42]], 'react'), ['React docs', 'react hooks'])
  assert.deepEqual(parseWebSuggestions({ nope: true }, 'x'), [])
})

// ---------------------------------------------------------------- pages that are already open

test('a page that is already open is offered as a switch, not a second copy of itself', () => {
  const result = buildSuggestions('physics', sources({
    history: [{ url: 'https://example.com/physics', title: 'Physics notes', visitedAt: NOW - H, visits: 5 } as never],
    tabs: [{ id: 't7', title: 'Physics notes', url: 'https://example.com/physics' }]
  }))
  const forPage = result.items.filter((i) => i.url === 'https://example.com/physics')
  // One row, not two: the same page offered twice wastes a slot and makes somebody choose between identical things.
  assert.equal(forPage.length, 1)
  assert.equal(forPage[0].kind, 'tab')
  assert.equal(forPage[0].tabId, 't7')
})

test('switching to an open page outranks the same page in history', () => {
  const result = buildSuggestions('physics', sources({
    history: [{ url: 'https://example.com/physics', title: 'Physics notes', visitedAt: NOW - H, visits: 9 } as never],
    tabs: [{ id: 't1', title: 'Physics notes', url: 'https://example.com/physics' }]
  }))
  const first = result.items.find((i) => i.url === 'https://example.com/physics')
  assert.equal(first?.kind, 'tab', 'the open tab is what is offered')
})

test('the tab you are already looking at is not offered', () => {
  const result = buildSuggestions('physics', sources({
    tabs: [{ id: 't1', title: 'Physics notes', url: 'https://example.com/physics', active: true }]
  }))
  assert.equal(result.items.some((i) => i.kind === 'tab'), false)
})

test('a tab in a group says which group, so two similar pages can be told apart', () => {
  const result = buildSuggestions('physics', sources({
    tabs: [{ id: 't1', title: 'Physics notes', url: 'https://example.com/physics', group: 'JEE Preparation' }]
  }))
  assert.equal(result.items.find((i) => i.kind === 'tab')?.detail, 'Open in JEE Preparation')
})

test('a workspace is offered by name, and says how many tabs it holds', () => {
  const result = buildSuggestions('jee', sources({ workspaces: [{ id: 'w1', name: 'JEE Preparation', tabCount: 6 }] }))
  const workspace = result.items.find((i) => i.kind === 'workspace')
  assert.equal(workspace?.workspaceId, 'w1')
  assert.equal(workspace?.detail, 'Workspace · 6 tabs')
})

test('tabs and workspaces are absent rather than empty when nothing was passed', () => {
  const result = buildSuggestions('physics', sources())
  assert.equal(result.items.some((i) => i.kind === 'tab' || i.kind === 'workspace'), false)
})
