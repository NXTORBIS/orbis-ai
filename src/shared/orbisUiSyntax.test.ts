import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Every page the browser ships is a page that parses.
 *
 * The pages in `orbis-ui` are compiled into the Chromium binary as resources. Nothing type-checks them, nothing bundles
 * them, and a syntax error in one does not fail a build -- the page is simply served, the module fails to parse, and the
 * page does nothing at all. Silently.
 *
 * That is exactly what happened to the market strip: a `for` block closed with `})` instead of `}`, and the strip drew its
 * frame and then sat there empty. It took a browser, a console and a targeted probe to find a missing brace.
 *
 * So each one is parsed here. Not executed -- these are browser pages and there is no browser -- but parsed, which is the
 * whole of what went wrong.
 */

const ROOT = join(import.meta.dirname, '..', '..', 'orbis-ui')

/** Every JavaScript file under orbis-ui, skipping the ones that are built from TypeScript elsewhere. */
async function* pages(dir: string): AsyncGenerator<{ path: string; name: string }> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue
      yield* pages(path)
      continue
    }
    if (!entry.name.endsWith('.js')) continue
    // Built artefacts: whatever is wrong with these is wrong in their source, which the type checker already reads.
    if (entry.name.endsWith('.min.js') || entry.name.endsWith('.bundle.js')) continue
    yield { path, name: entry.name }
  }
}

/**
 * Whether a source parses as a module.
 *
 * `new Function` will not do: it parses as a script, and `import` in a script is a syntax error -- which would fail every
 * module here for the wrong reason. Parsing as a module is done by handing it to the same parser the browser uses, through
 * a dynamic import of a data URL, and catching only the syntax errors.
 *
 * Anything that fails at *run* time rather than parse time is fine: these pages expect a browser, and the point is that the
 * parser accepts them.
 */
async function parses(source: string): Promise<string | null> {
  // The imports are stripped rather than resolved: this is about syntax, and a real resolution would need a browser.
  const withoutImports = source
    .replace(/^\s*import\s+[^;\n]*from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*import\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/\bimport\s*\(/g, 'Promise.resolve(')
    // A bare `export` outside a module is a syntax error, and these are only exported for other pages to import.
    .replace(/^\s*export\s+(?=(const|let|var|function|class|async))/gm, '')
    // Both a plain `export { a, b }` and a re-export `export { a } from './x.js'`, which the first pattern does not cover.
    .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*['"][^'"]+['"])?;?\s*$/gm, '')
    .replace(/^\s*export\s*\*\s*(as\s+\w+\s*)?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, 'void ')

  try {
    // A function body is parsed as a script, which is what is left once the imports are gone.
    // eslint-disable-next-line no-new-func
    new Function(withoutImports)
    return null
  } catch (err) {
    return err instanceof SyntaxError ? err.message : null
  }
}

test('every Orbis browser page parses', async () => {
  const broken: string[] = []
  let looked = 0
  for await (const page of pages(ROOT)) {
    looked++
    const problem = await parses(await readFile(page.path, 'utf8'))
    if (problem) broken.push(`${page.path.slice(ROOT.length + 1)}: ${problem}`)
  }
  assert.ok(looked > 5, `only ${looked} pages were looked at; the folder may have moved`)
  assert.deepEqual(
    broken,
    [],
    `these are shipped inside the browser binary and a parse error in one makes it silently do nothing:\n  ${broken.join('\n  ')}`
  )
})

test('the market strip is among the pages checked', async () => {
  // The bug that caused this test was in the strip, so the test would be worthless if the strip were somehow skipped.
  const found: string[] = []
  for await (const page of pages(ROOT)) found.push(page.path.replace(/\\/g, '/'))
  assert.ok(
    found.some((p) => p.endsWith('ticker/ticker.js')),
    `the strip was not looked at. Pages found: ${found.length}`
  )
  assert.ok(found.some((p) => p.endsWith('lock/lock.js')), 'the lock surface was not looked at')
})

test('a missing brace really is caught, so this test can fail', async () => {
  // Written the way the real bug was: a `for` block closed with `})`.
  const bad = [
    'for (const one of [1, 2]) {',
    '  document.addEventListener("x", () => {',
    '    void one',
    '  })',
    '})'
  ].join('\n')
  const problem = await parses(bad)
  assert.ok(problem !== null, 'the check would not have caught the bug it exists for')
})

test('a page that only fails in a browser is not reported as broken', async () => {
  // These pages call document, chrome.send and fetch. None of that exists here, and none of it is a syntax error.
  const browserOnly = [
    'import { call } from "./helper.js"',
    'const el = document.getElementById("nothing")',
    'el.addEventListener("click", () => void call("x", []))',
    'export const thing = 1'
  ].join('\n')
  assert.equal(await parses(browserOnly), null)
})

/**
 * The same name declared twice at the top of a module.
 *
 * `new Function` above parses a function body, which is sloppy-mode script, and there two `function x()` declarations
 * are perfectly legal -- the second quietly wins. In a module they are a SyntaxError, and a SyntaxError does not fail
 * at the line: it fails the whole file, so the page loads and the feature is simply not there.
 *
 * That is what happened to the music panel. Two row builders, one for a search result and one for a library row, both
 * called `trackRow`. Twelve hundred lines of working music panel, served by the browser, parsed by nobody, doing
 * nothing. Only the browser's console ever said a word about it.
 *
 * Node's own module parser would catch it, and it needs a flag the test runner does not pass, so the declarations are
 * read instead: anything declared hard against the left margin, which is where a module's own declarations live.
 */
function declaredTwice(source: string): string[] {
  const seen = new Map<string, number>()
  const twice: string[] = []
  const DECLARATION = /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/
  for (const line of source.split('\n')) {
    // Only column zero. A declaration inside any block is in a scope of its own and may repeat a name quite legally.
    if (/^\s/.test(line)) continue
    const found = DECLARATION.exec(line)
    if (!found) continue
    const name = found[1]
    const count = (seen.get(name) ?? 0) + 1
    seen.set(name, count)
    if (count === 2) twice.push(name)
  }
  return twice
}

test('no Orbis browser page declares the same name twice', async () => {
  const broken: string[] = []
  for await (const page of pages(ROOT)) {
    const twice = declaredTwice(await readFile(page.path, 'utf8'))
    if (twice.length) broken.push(`${page.path.slice(ROOT.length + 1)}: ${twice.join(', ')}`)
  }
  assert.deepEqual(
    broken,
    [],
    `a name declared twice in a module is a SyntaxError, and it takes the whole page down silently:\n  ${broken.join('\n  ')}`
  )
})

test('a name declared twice really is caught, so this test can fail', () => {
  assert.deepEqual(declaredTwice('function a() {}\nfunction a() {}\n'), ['a'])
  // Inside a block it is another scope, and repeating a name there is ordinary code.
  assert.deepEqual(declaredTwice('if (x) {\n  const a = 1\n}\nif (y) {\n  const a = 2\n}\n'), [])
})
