import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answerContext, bingTarget, excerptFor, parseBing, parseDuckDuckGo, readPage, researchBrief, runResearch, toIsoDate } from './research.ts'
import { citedNumbers, findSource, linkCitations, normalizeUrl, sameUrl } from '../shared/research.ts'
import type { ChatMessage, Research } from '../shared/types'

const base64url = (text: string): string => Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const bingLink = (url: string): string => `https://www.bing.com/ck/a?!&amp;&amp;p=abc123&amp;u=a1${base64url(url)}&amp;ntb=1`
const bingPage = (results: { url: string; title: string; snippet: string }[]): string =>
  `<html><body><ol id="b_results">${results
    .map((r) => `<li class="b_algo" data-id=""><div class="b_tpcn"></div><h2 class=""><a href="${bingLink(r.url)}" h="ID=SERP">${r.title}</a></h2><div class="b_caption"><p class="b_lineclamp2">${r.snippet}</p></div></li>`)
    .join('')}</ol></body></html>`

test('decodes Bing result links to the real page', () => {
  assert.equal(bingTarget(bingLink('https://react.dev/versions')), 'https://react.dev/versions')
  assert.equal(bingTarget('https://www.bing.com/ck/a?u=xyz'), null)
  assert.equal(bingTarget('https://example.com/page'), 'https://example.com/page')
})

test('parses Bing results with titles and snippets', () => {
  const hits = parseBing(bingPage([{ url: 'https://react.dev/blog', title: 'React <strong>Blog</strong>', snippet: 'React 20 &amp; more' }]), 'react')
  assert.deepEqual(hits, [{ title: 'React Blog', url: 'https://react.dev/blog', snippet: 'React 20 & more', query: 'react' }])
})

test('parses DuckDuckGo results and unwraps their redirect', () => {
  const html = `<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnvidianews.nvidia.com%2Fnews%2Flatest&amp;rut=1">Latest News | NVIDIA</a></h2><a class="result__snippet" href="x">New <b>GPUs</b> announced</a></div>`
  assert.deepEqual(parseDuckDuckGo(html, 'nvidia'), [{ title: 'Latest News | NVIDIA', url: 'https://nvidianews.nvidia.com/news/latest', snippet: 'New GPUs announced', query: 'nvidia' }])
})

test('reads the dates a page states, and never invents one', () => {
  const now = Date.parse('2026-09-15T12:00:00Z')
  const withMeta = readPage(
    '<html><head><title>Fallback</title><meta property="og:title" content="React 20 is out"><meta content="React" property="og:site_name"><meta property="article:published_time" content="2026-09-10T08:00:00Z"><meta property="article:modified_time" content="2026-09-12"></head><body><article><h1>React 20</h1><p>React 20 ships a new compiler and faster server rendering for every app today.</p><p>Upgrading takes a single command and most apps need no other changes at all.</p><p>The team thanks everyone who tried the release candidates over the past months.</p><p>Read the full changelog for the details of every change in this release.</p></article></body></html>',
    now
  )
  assert.equal(withMeta.title, 'React 20 is out')
  assert.equal(withMeta.publisher, 'React')
  assert.equal(withMeta.published, '2026-09-10')
  assert.equal(withMeta.updated, '2026-09-12')
  assert.match(withMeta.text, /new compiler/)

  const jsonLd = readPage('<script type="application/ld+json">{"datePublished":"2026-09-14T10:00:00+05:30"}</script><p>Some article text that is long enough to count as a paragraph here.</p>', now)
  assert.equal(jsonLd.published, '2026-09-14')

  const undated = readPage('<html><head><title>Docs</title></head><body><p>Documentation without any publication date anywhere on the page at all.</p></body></html>', now)
  assert.equal(undated.published, undefined)
  assert.equal(undated.updated, undefined)
  assert.equal(toIsoDate('2031-01-01', now), undefined, 'a future date is not a publication date')
  assert.equal(toIsoDate('1712345678', now), undefined, 'bare numbers are ambiguous')
  assert.equal(toIsoDate('not a date', now), undefined)
})

test('page text skips menus, scripts and footers', () => {
  const text = readPage('<nav><a>Home</a><p>Menu item paragraph that should never be read as content.</p></nav><main><p>The actual article paragraph with plenty of words in it to be kept.</p></main><script>var x = "script text that is long enough"</script><footer><p>Copyright footer paragraph text that is long enough.</p></footer>').text
  assert.match(text, /actual article paragraph/)
  assert.doesNotMatch(text, /Menu item|Copyright|script text/)
})

test('excerpts keep the passages about the question', () => {
  const text = ['Intro line about the site.', 'Unrelated cooking tips for summer.', 'The RTX 6090 GPU was announced with 48GB memory.', 'More unrelated gardening advice.'].join('\n')
  const excerpt = excerptFor(text, ['newest NVIDIA GPU announced'], 80)
  assert.match(excerpt, /RTX 6090 GPU was announced/)
  assert.doesNotMatch(excerpt, /gardening/)
})

test('research reads the exact pages found, keeps their dates and ranks readable recent pages first', async () => {
  const now = Date.parse('2026-09-15T12:00:00Z')
  const pages: Record<string, { html: string; finalUrl?: string; type?: string }> = {
    'https://example.com/old': { html: '<meta property="article:published_time" content="2024-01-01"><article><p>An old report from years ago about the same topic, with enough words to read.</p><p>It has a second paragraph so the page counts as readable content for research.</p><p>And a third paragraph to push the text well past the minimum readable length here.</p></article>' },
    'https://news.example.org/today': { html: '<meta property="article:published_time" content="2026-09-15T06:00:00Z"><meta property="og:site_name" content="Example News"><article><p>Today the company announced its newest chip, the X2, shipping next month to customers.</p><p>Analysts said the X2 doubles the speed of the previous generation in their tests.</p><p>Preorders open on Friday in the United States and in Europe at the same price.</p></article>' },
    'https://short.example.net/redirect': { html: '<article><p>This page moved; the fetch followed a redirect to the article that the user will open.</p><p>It carries no publication date anywhere, so none must be shown for it at all.</p><p>A third paragraph keeps this page comfortably above the readable text threshold.</p></article>', finalUrl: 'https://short.example.net/final-article' },
    'https://files.example.com/brochure': { html: '%PDF', type: 'application/pdf' }
  }
  const fetchFn = async (url: string): Promise<Response> => {
    if (url.startsWith('https://www.bing.com/search')) {
      return new Response(
        bingPage([
          { url: 'https://example.com/old', title: 'Old report', snippet: 'old' },
          { url: 'https://news.example.org/today', title: 'X2 announced', snippet: 'X2 chip' },
          { url: 'https://short.example.net/redirect', title: 'Moved', snippet: 'moved' },
          { url: 'https://files.example.com/brochure', title: 'Brochure', snippet: 'Brochure snippet' },
          { url: 'https://www.bing.com/images/search?q=x2', title: 'Images', snippet: '' }
        ]),
        { headers: { 'content-type': 'text/html' } }
      )
    }
    if (url.startsWith('https://html.duckduckgo.com')) throw new Error('offline')
    const page = pages[url]
    if (!page) return new Response('missing', { status: 404 })
    const res = new Response(page.html, { headers: { 'content-type': page.type ?? 'text/html; charset=utf-8' } })
    Object.defineProperty(res, 'url', { value: page.finalUrl ?? url })
    return res
  }
  const statuses: string[] = []
  const research = await runResearch({ question: 'What is the newest chip announced this week?', queries: ['newest chip announced'], recency: 'week', fetchFn, onStatus: (s) => statuses.push(s), now })
  assert.deepEqual(
    research.sources.map((s) => [s.n, s.url, s.read, s.published ?? null]),
    [
      [1, 'https://news.example.org/today', true, '2026-09-15'],
      [2, 'https://short.example.net/final-article', true, null],
      [3, 'https://example.com/old', true, '2024-01-01'],
      [4, 'https://files.example.com/brochure', false, null]
    ]
  )
  assert.equal(research.sources[0].publisher, 'Example News')
  assert.ok(!research.sources.some((s) => s.domain.includes('bing.com')), 'search engine pages are never sources')
  assert.equal(research.sources[3].excerpt, 'Brochure snippet')
  assert.deepEqual(statuses, ['Searching the web for “newest chip announced”…', 'Reading 4 sources…'])

  const brief = researchBrief(research)
  assert.match(brief, /\[1\] X2 announced — Example News — published 2026-09-15 — https:\/\/news\.example\.org\/today/)
  assert.match(brief, /\[2\] .* no date shown on the page/)
  assert.match(brief, /Search snippet only/)
  assert.match(brief, /cite only these numbers/)
})

test('research reads the results that best match the question first, and searches the question as asked', async () => {
  const article = (words: string): string => `<article><p>${words} ${'with enough further words to count as a readable paragraph of page text. '.repeat(3)}</p><p>${'Another paragraph of ordinary text for the page body. '.repeat(3)}</p></article>`
  const searched: string[] = []
  const fetchFn = async (url: string): Promise<Response> => {
    if (url.startsWith('https://www.bing.com/search')) {
      searched.push(new URL(url).searchParams.get('q') ?? '')
      return new Response(
        bingPage([
          { url: 'https://react.dev/learn', title: 'Quick Start – React', snippet: 'Welcome to the React documentation.' },
          { url: 'https://react.dev/', title: 'React', snippet: 'The library for web and native user interfaces.' },
          { url: 'https://react.dev/versions', title: 'React Versions – React', snippet: 'The latest version of React is listed here.' }
        ]),
        { headers: { 'content-type': 'text/html' } }
      )
    }
    if (url.startsWith('https://html.duckduckgo.com')) throw new Error('offline')
    return new Response(article(`Page ${url}`), { headers: { 'content-type': 'text/html' } })
  }
  const research = await runResearch({ question: 'What is the latest stable version of React?', queries: ['React stable release 2026'], recency: 'any', fetchFn })
  assert.equal(research.sources[0].url, 'https://react.dev/versions', 'the page titled "React Versions" is read first')
  assert.deepEqual(searched, ['React stable release 2026', 'What is the latest stable version of React?'])
})

test('research says plainly when the web could not be searched', async () => {
  const research = await runResearch({ question: 'latest news', queries: ['latest news'], recency: 'day', fetchFn: async () => Promise.reject(new Error('offline')) })
  assert.equal(research.sources.length, 0)
  assert.equal(research.problem, "the web search couldn't be reached")
  assert.match(researchBrief(research), /couldn't get current information/)
})

const sampleResearch = (id: string, urls: string[]): Research => ({
  id,
  question: 'q',
  queries: ['q'],
  recency: 'any',
  retrievedAt: 0,
  sources: urls.map((url, i) => ({ n: i + 1, title: `T${i + 1}`, url, domain: new URL(url).hostname, snippet: '', excerpt: 'e', query: 'q', read: true }))
})

test('citations become source links outside code, and only for real sources', () => {
  const sources = sampleResearch('r', ['https://a.com/1', 'https://b.com/2']).sources
  assert.equal(linkCitations('React 20 is out [1][2]. See [3].', sources), 'React 20 is out [1](#orbis-source-1)[2](#orbis-source-2). See [3].')
  assert.equal(linkCitations('Use `arr[1]` and\n```\nx[2]\n```\nthen [2]', sources), 'Use `arr[1]` and\n```\nx[2]\n```\nthen [2](#orbis-source-2)')
  assert.equal(linkCitations('[1](https://x.com) and [2]: note', sources), '[1](https://x.com) and [2]: note')
  assert.deepEqual(citedNumbers('A [2], B [1][2], `c[1]`, D [9]', sources), [2, 1])
})

test('recognises a research source open in the browser, even with tracking or www differences', () => {
  assert.ok(sameUrl('https://www.example.com/a/?utm_source=x#top', 'https://example.com/a'))
  assert.equal(normalizeUrl('https://Example.com/path/?q=1&utm_medium=y'), 'example.com/path?q=1')
  const research = sampleResearch('r1', ['https://a.com/one', 'https://b.com/two'])
  const messages: ChatMessage[] = [
    { id: '1', role: 'user', content: 'latest?', createdAt: 0 },
    { id: '2', role: 'assistant', content: 'answer [2]', research, createdAt: 0 }
  ]
  assert.equal(findSource(messages, 'https://www.b.com/two#section')?.source.n, 2)
  assert.equal(findSource(messages, 'https://c.com/'), undefined)
})

test('follow-up context carries the open page and earlier sources without clashing numbers', () => {
  const earlier = sampleResearch('old', ['https://a.com/one'])
  const fresh = sampleResearch('new', ['https://n.com/new'])
  const onlyEarlier = answerContext({ earlier, browser: { url: 'https://a.com/one', title: 'One' }, onScreen: 1, pageText: 'Visible page words', includePage: true })
  assert.match(onlyEarlier, /\[1\] T1/)
  assert.match(onlyEarlier, /source \[1\] of the earlier research/)
  assert.match(onlyEarlier, /Visible page words/)
  const both = answerContext({ research: fresh, earlier, browser: { url: 'https://a.com/one', title: 'One' }, onScreen: 1, pageText: null, includePage: true })
  assert.match(both, /\[1\] T1 — n\.com/)
  assert.match(both, /E1 T1 — a\.com/)
  assert.match(both, /source E1 of the earlier research/)
  assert.match(both, /text couldn't be read/)
  assert.doesNotMatch(answerContext({ earlier, browser: { url: 'https://z.com', title: 'Z' }, includePage: false }), /looking at this page/)
})
