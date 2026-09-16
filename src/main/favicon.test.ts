import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchFavicon, iconCandidates, sniffImageType, toSiteUrl } from './favicon.ts'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const ICO = Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x10, 0x10])

test('site addresses are normalised; non-web input is refused', () => {
  assert.equal(toSiteUrl('github.com'), 'https://github.com/')
  assert.equal(toSiteUrl('http://localhost:3000/app'), 'http://localhost:3000/app')
  assert.equal(toSiteUrl('javascript:alert(1)'), null)
  assert.equal(toSiteUrl('not a site'), null)
  assert.equal(toSiteUrl(''), null)
})

test('icon links are ranked best first, resolved, and end with /favicon.ico', () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="mask-icon" href="/pinned.svg" color="#000">
    <link rel="apple-touch-icon" href="https://cdn.example.net/touch.png">
    <link rel="icon" type="image/png" sizes="192x192" href="icons/192.png">
    <link rel="stylesheet" href="/site.css">
  </head>`
  // Large icons near 128px rank first (the 180px touch icon just ahead of the 192px one), tiny ones last.
  assert.deepEqual(iconCandidates(html, 'https://www.example.com/docs/page'), [
    'https://cdn.example.net/touch.png',
    'https://www.example.com/docs/icons/192.png',
    'https://www.example.com/favicon-16.png',
    'https://www.example.com/favicon.ico'
  ])
  assert.deepEqual(iconCandidates('', 'https://a.example/x'), ['https://a.example/favicon.ico'])
  assert.deepEqual(iconCandidates('<base href="https://static.example/"><link rel="shortcut icon" href="f.ico">', 'https://a.example/'), ['https://static.example/f.ico', 'https://a.example/favicon.ico'])
})

test('image types come from the bytes, not the headers', () => {
  assert.equal(sniffImageType(PNG), 'image/png')
  assert.equal(sniffImageType(ICO), 'image/x-icon')
  assert.equal(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml')
  assert.equal(sniffImageType(new TextEncoder().encode('<!doctype html><html>')), null)
})

test('the real icon is fetched as a data URL, falling back through candidates to /favicon.ico', async () => {
  const requests: string[] = []
  const site = (routes: Record<string, () => Response>) => async (url: string): Promise<Response> => {
    requests.push(url)
    const route = routes[url]
    return route ? route() : new Response('not found', { status: 404 })
  }
  const page = (body: string) => () => new Response(body, { headers: { 'content-type': 'text/html' } })

  const best = await fetchFavicon(
    'example.com',
    site({
      'https://example.com/': page('<link rel="icon" sizes="192x192" href="/big.png"><link rel="icon" href="/small.ico">'),
      'https://example.com/big.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } })
    })
  )
  assert.equal(best, `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)

  // A broken declared icon, and an HTML error page served as "the icon", fall through to /favicon.ico.
  const fallback = await fetchFavicon(
    'https://news.example/',
    site({
      'https://news.example/': page('<link rel="icon" href="/missing.png"><link rel="apple-touch-icon" href="/soft404.png">'),
      'https://news.example/soft404.png': () => new Response('<html>oops</html>', { headers: { 'content-type': 'image/png' } }),
      'https://news.example/favicon.ico': () => new Response(ICO, { headers: { 'content-type': 'application/octet-stream' } })
    })
  )
  assert.equal(fallback, `data:image/x-icon;base64,${Buffer.from(ICO).toString('base64')}`)

  // Unreachable page: /favicon.ico is still tried.
  const offlinePage = await fetchFavicon('https://down.example', async (url) => {
    if (url === 'https://down.example/favicon.ico') return new Response(ICO)
    throw new TypeError('fetch failed')
  })
  assert.ok(offlinePage?.startsWith('data:image/x-icon;base64,'))

  assert.equal(await fetchFavicon('https://none.example', site({ 'https://none.example/': page('<title>No icons</title>') })), null)
  assert.equal(await fetchFavicon('not a url', site({})), null)
})
