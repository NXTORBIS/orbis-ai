import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join, sep } from 'node:path'

import {
  PAGE_SCHEME,
  PAGE_SCHEME_PRIVILEGES,
  headersFor,
  mediaTypeFor,
  originForPage,
  resolveWithin,
  safeUrl
} from './serving.ts'

const ROOT = join('C:', 'orbis', 'pages', 'page_abc')

describe('origins', () => {
  it('gives each Page its own origin, so two Pages are cross-origin to each other', () => {
    assert.equal(originForPage('page_a'), `${PAGE_SCHEME}://page_a`)
    assert.notEqual(originForPage('page_a'), originForPage('page_b'))
  })

  it('does not let the scheme itself make cross-origin requests', () => {
    // A Page reaches the network through the origins its policy names. A CORS-enabled scheme would be a second path.
    assert.equal(PAGE_SCHEME_PRIVILEGES.privileges.corsEnabled, false)
  })

  it('does not let a Page bypass its own content policy', () => {
    assert.equal(PAGE_SCHEME_PRIVILEGES.privileges.bypassCSP, false)
  })

  it('is a standard, secure scheme, so origin rules apply and secure-context APIs work', () => {
    assert.equal(PAGE_SCHEME_PRIVILEGES.privileges.standard, true)
    assert.equal(PAGE_SCHEME_PRIVILEGES.privileges.secure, true)
  })
})

describe('resolving a request path', () => {
  it('serves index.html for the root', () => {
    assert.equal(resolveWithin(ROOT, '/'), join(ROOT, 'index.html'))
    assert.equal(resolveWithin(ROOT, ''), join(ROOT, 'index.html'))
  })

  it('serves a file inside the Page', () => {
    assert.equal(resolveWithin(ROOT, '/app.js'), join(ROOT, 'app.js'))
    assert.equal(resolveWithin(ROOT, '/assets/logo.svg'), join(ROOT, 'assets', 'logo.svg'))
  })

  it('refuses a path that climbs out with ..', () => {
    assert.equal(resolveWithin(ROOT, '/../page_other/index.html'), null)
    assert.equal(resolveWithin(ROOT, '/../../secrets.json'), null)
    assert.equal(resolveWithin(ROOT, '/assets/../../escape.txt'), null)
  })

  it('refuses a percent-encoded climb, which a text search for ".." would miss', () => {
    assert.equal(resolveWithin(ROOT, '/%2e%2e/secrets.json'), null)
    assert.equal(resolveWithin(ROOT, '/%2E%2E%2Fsecrets.json'), null)
    assert.equal(resolveWithin(ROOT, '/assets/%2e%2e%2f%2e%2e%2fsecrets.json'), null)
  })

  it('refuses a doubly-encoded climb', () => {
    // `%252e` decodes once to `%2e`, which is not a separator, so this resolves to a plain filename rather than a climb.
    const once = resolveWithin(ROOT, '/%252e%252e/secrets.json')
    assert.ok(once === null || String(once).startsWith(ROOT), `${String(once)} escaped the root`)
  })

  it('refuses a backslash climb, which is a separator on Windows', () => {
    assert.equal(resolveWithin(ROOT, '/..\\secrets.json'), null)
    assert.equal(resolveWithin(ROOT, '/%5c..%5csecrets.json'), null)
  })

  it('refuses an absolute path that would replace the root entirely', () => {
    const escaped = resolveWithin(ROOT, '/C:/Windows/System32/config/SAM')
    assert.ok(escaped === null || String(escaped).startsWith(ROOT), `${String(escaped)} escaped the root`)
  })

  it('refuses a path containing a null byte, which truncates a path in C', () => {
    assert.equal(resolveWithin(ROOT, '/app.js\0.png'), null)
    assert.equal(resolveWithin(ROOT, '/app.js%00.png'), null)
  })

  it('refuses a path that will not decode', () => {
    assert.equal(resolveWithin(ROOT, '/%'), null)
    assert.equal(resolveWithin(ROOT, '/%zz'), null)
  })

  it('ignores a query string and a fragment', () => {
    assert.equal(resolveWithin(ROOT, '/app.js?v=2'), join(ROOT, 'app.js'))
    assert.equal(resolveWithin(ROOT, '/app.js#top'), join(ROOT, 'app.js'))
  })

  it('never returns a path outside the root, for anything at all', () => {
    const attempts = [
      '/..',
      '/../',
      '/../..',
      '/./../../',
      '//etc/passwd',
      '/....//secrets',
      '/assets/..%2f..%2fsecrets',
      '/%2e%2e%5c%2e%2e%5csecrets',
      '/a/b/c/../../../../outside',
      '/\\\\server\\share\\file'
    ]
    for (const attempt of attempts) {
      const result = resolveWithin(ROOT, attempt)
      if (result === null) continue
      assert.ok(
        result === ROOT || result.startsWith(ROOT + sep),
        `"${attempt}" resolved to "${result}", which is outside the Page`
      )
    }
  })

  it('refuses a root that is not a path', () => {
    assert.equal(resolveWithin('', '/app.js'), null)
  })

  it('refuses a request that is not text', () => {
    assert.equal(resolveWithin(ROOT, undefined as unknown as string), null)
  })
})

describe('media types', () => {
  it('names the types it knows', () => {
    assert.match(mediaTypeFor('/a/index.html'), /^text\/html/)
    assert.match(mediaTypeFor('/a/app.js'), /^text\/javascript/)
    assert.match(mediaTypeFor('/a/style.css'), /^text\/css/)
    assert.equal(mediaTypeFor('/a/logo.svg'), 'image/svg+xml')
    assert.equal(mediaTypeFor('/a/fast.wasm'), 'application/wasm')
  })

  it('ignores the case of the extension', () => {
    assert.match(mediaTypeFor('/a/INDEX.HTML'), /^text\/html/)
  })

  it('refuses to guess, so an unknown type is never served as a document', () => {
    assert.equal(mediaTypeFor('/a/data.sqlite'), 'application/octet-stream')
    assert.equal(mediaTypeFor('/a/noextension'), 'application/octet-stream')
    assert.equal(mediaTypeFor('/a/archive.zip'), 'application/octet-stream')
  })

  it('cannot be walked up a prototype chain to a type that is not one', () => {
    for (const name of ['/a/x.constructor', '/a/x.toString', '/a/x.__proto__']) {
      assert.equal(mediaTypeFor(name), 'application/octet-stream', `${name} found something on the prototype`)
    }
  })
})

describe('headers', () => {
  const headers = headersFor("default-src 'none'", 'text/html; charset=utf-8')

  it('carries the content policy on every response, not only the document', () => {
    assert.equal(headers['Content-Security-Policy'], "default-src 'none'")
    const script = headersFor("default-src 'none'", 'text/javascript; charset=utf-8')
    assert.equal(script['Content-Security-Policy'], "default-src 'none'")
  })

  it('stops the browser sniffing a type out of the bytes', () => {
    assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  })

  it('keeps a Page\u2019s resources to its own origin', () => {
    assert.equal(headers['Cross-Origin-Resource-Policy'], 'same-origin')
    assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin')
  })

  it('sends no referrer, so a Page cannot leak where it is through a request', () => {
    assert.equal(headers['Referrer-Policy'], 'no-referrer')
  })

  it('does not cache, so an edited Page is the Page that runs', () => {
    assert.equal(headers['Cache-Control'], 'no-store')
  })
})

describe('showing a URL to a person', () => {
  it('shows the origin only, never a path that might carry a token', () => {
    assert.equal(safeUrl('https://example.com/reset?token=secret-value'), 'https://example.com')
  })

  it('says so plainly when it cannot read the URL at all', () => {
    assert.match(safeUrl('not a url'), /could not read/)
  })
})
