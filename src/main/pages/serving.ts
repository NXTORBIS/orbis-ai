/**
 * Serving a Page's own files: the decisions, kept away from the browser engine that acts on them.
 *
 * `host.ts` registers the protocol and hands back responses. Everything it has to get *right* is here instead, because
 * this is the part worth testing: a path-traversal defence that has never been tested is a path-traversal defence that
 * has never been tested, and it only has to be wrong once.
 *
 * No Electron, no session, no window. Just paths, media types and headers.
 */

import { join, normalize, relative, sep } from 'node:path'

/** The scheme a Page's own files are served from. One origin per Page, so two Pages are cross-origin to each other. */
export const PAGE_SCHEME = 'orbis-page'

/** The origin for a Page: its own, and nothing else's. */
export const originForPage = (pageId: string): string => `${PAGE_SCHEME}://${pageId}`

/**
 * What the scheme is allowed to be, registered before the app is ready.
 *
 * `standard` so it has a real origin and the same-origin rules apply between Pages. `secure` so a Page counts as a
 * secure context and can use the APIs that need one. Explicitly **not** `corsEnabled`: a Page reaches the network
 * through the origins its CSP names, and letting the scheme itself make cross-origin requests would be a second path
 * that the capability system does not see.
 */
export const PAGE_SCHEME_PRIVILEGES = Object.freeze({
  scheme: PAGE_SCHEME,
  privileges: Object.freeze({
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: false,
    stream: true,
    bypassCSP: false
  })
})

/**
 * Media types, from a fixed table.
 *
 * A table rather than a guess, and `application/octet-stream` for anything not in it. Serving a file whose type nobody
 * established as `text/html` is how a data file a Page saved becomes a document running in the Page's own origin.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8'
})

export function mediaTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return 'application/octet-stream'
  const extension = path.slice(dot).toLowerCase()
  // `hasOwnProperty`, not indexing: `MEDIA_TYPES['.constructor']` would otherwise not be a string but a function.
  return Object.prototype.hasOwnProperty.call(MEDIA_TYPES, extension) ? MEDIA_TYPES[extension] : 'application/octet-stream'
}

/**
 * A request path resolved inside a Page's own directory, or null.
 *
 * Null for anything that would land outside, decided by **comparing the resolved paths** rather than by looking for
 * `..` in the text. A text check is defeated by percent-encoding, by a separator the check did not think of, and by a
 * path that is absolute rather than relative. Resolving first and then asking "is this still underneath?" is not.
 *
 * An empty path means the Page's own `index.html`, which is the only default there is: a directory listing would hand a
 * Page's whole contents to anything that asked for a folder.
 */
export function resolveWithin(root: string, requested: string): string | null {
  if (typeof root !== 'string' || root === '') return null
  if (typeof requested !== 'string') return null

  let decoded: string
  try {
    decoded = decodeURIComponent(requested)
  } catch {
    // A path that will not decode is not a path. Refusing beats guessing at what was meant.
    return null
  }
  // A null byte truncates a path for anything written in C, which is most of what ends up reading the file.
  if (decoded.includes('\0')) return null

  const withoutQuery = decoded.split('?')[0].split('#')[0]
  const trimmed = withoutQuery.replace(/^[/\\]+/, '')
  const target = normalize(join(root, trimmed === '' ? 'index.html' : trimmed))
  const inside = relative(normalize(root), target)

  if (inside === '') return target
  // Starting `..` means it climbed out; an absolute result means it replaced the root entirely.
  if (inside === '..' || inside.startsWith(`..${sep}`) || inside.startsWith('../')) return null
  if (/^[A-Za-z]:/.test(inside) || inside.startsWith(sep) || inside.startsWith('/')) return null
  return target
}

/**
 * The headers every response from a Page's own origin carries.
 *
 * The content policy travels with **every** response, not only the document. A stylesheet or a script served without it
 * would be governed by nothing, and a Page that could get one of those served from its own origin would have a corner
 * of itself outside its own policy.
 */
export function headersFor(contentSecurityPolicy: string, mediaType: string): Record<string, string> {
  return {
    'Content-Type': mediaType,
    'Content-Security-Policy': contentSecurityPolicy,
    // A media type this side chose is one that should be believed, and nothing else should be sniffed out of the bytes.
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Referrer-Policy': 'no-referrer',
    // A Page's files change when the Page is edited, and a cached old version of a Page is a Page nobody can debug.
    'Cache-Control': 'no-store'
  }
}

/** A URL safe to show a person: the origin only, never a path that may carry a token. */
export function safeUrl(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return 'somewhere Orbis could not read'
  }
}
