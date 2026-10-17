import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

/**
 * Whether the screen declarations are joined up to the code that uses them, and the capability ids are not shadowed.
 *
 * Two faults this guards, both silent. A declaration file that nothing imports is a screen that says what it can do and
 * never tells anybody -- it looks finished in the code and is unreachable in the window. And `BrowserControl.register`
 * replaces whatever was registered under the same id, so a second capability that reuses an id quietly deletes the
 * first one: the first is still in the code, and nothing that asks for it gets it.
 *
 * Both are read from the source tree rather than from a running window, so they hold without a window and without
 * React. The scans only look at literal `id: '...'` capability declarations and at `*Surfaces.ts` / `*Surface.ts`
 * modules under the renderer's components.
 */

const REPO = resolve(import.meta.dirname, '../../..')

function walk(dir: string, keep: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, keep, out)
    else if (keep(full)) out.push(full)
  }
  return out
}

const isTest = (file: string): boolean => /\.test\.(ts|tsx|js|jsx)$/.test(file)

test('every capability id declared in the main process is declared once', () => {
  const files = walk(join(REPO, 'src/main'), (file) => file.endsWith('.ts') && !isTest(file))
  const where = new Map<string, string[]>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const re = /^\s*id:\s*'([a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9-]*)'/gm
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      const line = text.slice(0, match.index).split('\n').length
      const list = where.get(match[1]) ?? []
      list.push(`${file.slice(REPO.length + 1).replace(/\\/g, '/')}:${line}`)
      where.set(match[1], list)
    }
  }
  const twice = [...where.entries()].filter(([, places]) => places.length > 1)
  assert.deepEqual(
    twice.map(([id, places]) => `${id} at ${places.join(' and ')}`),
    [],
    'a second capability with the same id silently replaces the first in BrowserControl.register'
  )
  assert.ok(where.size > 100, `only ${where.size} capability ids were found; the scan has probably stopped seeing them`)
})

test('every screen declaration file under the renderer is imported by something that is not a test', () => {
  const components = join(REPO, 'src/renderer/src')
  // The register itself (lib/surfaces) and the two components that draw nothing but mount a declaration are not
  // declarations, even though their names end the same way.
  const declarations = walk(
    components,
    (file) => /[sS]urfaces?\.(ts|tsx)$/.test(file) && !isTest(file) && !/DeclareSurface\.tsx$/.test(file) && !/[\\/]lib[\\/]surfaces[\\/]/.test(file)
  )
  const users = walk(components, (file) => /\.(ts|tsx|js|jsx)$/.test(file) && !isTest(file))
  const sources = users.map((file) => ({ file, text: readFileSync(file, 'utf8') }))

  const orphans: string[] = []
  for (const declaration of declarations) {
    const name = basename(declaration).replace(/\.(ts|tsx)$/, '')
    const imported = sources.some(
      (source) => source.file !== declaration && new RegExp(`from\\s+['"][^'"]*/${name}['"]`).test(source.text)
    )
    if (!imported) orphans.push(declaration.slice(REPO.length + 1).replace(/\\/g, '/'))
  }
  assert.deepEqual(orphans, [], 'these declare screens that no screen mounts, so they can never be reached from the window')
  assert.ok(declarations.length > 10, 'the scan found too few declaration files to mean anything')
})
