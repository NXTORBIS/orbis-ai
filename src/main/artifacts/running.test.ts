import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { isProjectProblem, makeProject, type Project } from '../../shared/artifacts/project.ts'
import { readDirectory, isZipError } from '../../shared/portable/zip.ts'
import type { CodeSpec, PageFile } from '../../shared/pages/codePage.ts'
import { checkProjectFiles, openInSandbox, resolveFrom, runnable, splitPage, verifyProjectZip, zipProject, type SandboxDeps } from './running.ts'

const made = (files: { path: string; source: string }[], entry = ''): Project => {
  const out = makeProject(files, entry)
  assert.equal(isProjectProblem(out), false, isProjectProblem(out) ? out.message : '')
  return out as Project
}

const PAGE = ['<!doctype html>', '<html><head>', '<title>Hi</title>', '<link rel="stylesheet" href="style.css">', '</head>', '<body>', '<h1 id="t">Hi</h1>', '<script src="app.js"></script>', '</body></html>'].join('\n')

const website = (): Project =>
  made([
    { path: 'index.html', source: PAGE },
    { path: 'style.css', source: 'h1 { color: red }' },
    { path: 'app.js', source: 'document.getElementById("t").textContent = "Hello"' }
  ])

/** A stand-in for the Pages host: remembers what it was handed and never opens anything. */
const fakeHost = (open: Partial<{ ok: boolean; error: string; message: string; health: unknown }> = { ok: true, health: 'running' }) => {
  const seen: { spec: CodeSpec; files: readonly PageFile[]; pageId: string }[] = []
  const closed: string[] = []
  const deps: SandboxDeps = {
    place: async (spec, files) => {
      const pageId = `page_${'a'.repeat(12)}${seen.length}`
      seen.push({ spec, files, pageId })
      return pageId
    },
    open: async () => ({ ok: open.ok ?? true, error: open.error, message: open.message, health: open.health }),
    close: (pageId) => closed.push(pageId)
  }
  return { deps, seen, closed }
}

// ---------------------------------------------------------------- can it run at all

test('a web project can run; everything else is refused by name with what to do instead', () => {
  const web = runnable(website())
  assert.equal(web.ok, true)
  assert.equal(web.ok && web.entry, 'index.html')

  const python = runnable(made([{ path: 'main.py', source: 'print(1)' }, { path: 'helper.py', source: 'x = 1' }]))
  assert.equal(python.ok, false)
  assert.equal(
    python.ok === false && python.reason,
    'This is a Python project. Orbis does not run programs on your computer; it can run a web page project in its sandbox, or you can save the files and run them yourself.'
  )

  const notes = runnable(made([{ path: 'notes.md', source: '# a' }]))
  assert.equal(notes.ok, false)
  assert.match(notes.ok === false ? notes.reason : '', /not a web page project\. Orbis does not run programs on your computer/)
})

test('nothing is ever said to run on this computer, and the notes say so every time', () => {
  const web = runnable(website())
  assert.equal(web.ok, true)
  const said = web.ok ? web.notes.join(' ') : ''
  assert.match(said, /cannot reach the network, your files, your saved passwords/)
  assert.match(said, /not as Node\. require, process and the file system are not there/)
  assert.match(said, /cannot interrupt a page that loops for ever/)
})

test('several pages are refused, because the sandbox shows one page', () => {
  const two = runnable(made([{ path: 'index.html', source: PAGE }, { path: 'about.html', source: '<body>a</body>' }]))
  assert.equal(two.ok, false)
  assert.match(two.ok === false ? two.reason : '', /shows one page at a time, and this project has 2 \(about\.html, index\.html\)/)
})

// ---------------------------------------------------------------- addresses

test('an address inside the project resolves; one pointing anywhere else does not', () => {
  assert.equal(resolveFrom('index.html', 'style.css'), 'style.css')
  assert.equal(resolveFrom('web/index.html', 'style.css'), 'web/style.css')
  assert.equal(resolveFrom('web/index.html', '../shared/a.css'), 'shared/a.css')
  assert.equal(resolveFrom('index.html', '/style.css'), 'style.css')
  assert.equal(resolveFrom('index.html', 'style.css?v=2#top'), 'style.css')
  assert.equal(resolveFrom('index.html', 'https://example.com/a.css'), null)
  assert.equal(resolveFrom('index.html', '//example.com/a.css'), null)
  assert.equal(resolveFrom('index.html', 'data:text/css,a'), null)
  assert.equal(resolveFrom('index.html', '../a.css'), null, 'above the project is outside it')
  assert.equal(resolveFrom('index.html', ''), null)
})

// ---------------------------------------------------------------- taking a page apart

test('a page is split into the body, the stylesheet and the script the sandbox serves', () => {
  const parts = splitPage(website(), 'index.html')
  assert.deepEqual(parts.problems, [])
  assert.equal(parts.body, '<h1 id="t">Hi</h1>')
  assert.match(parts.style, /\/\* style\.css \*\/\nh1 \{ color: red \}/)
  assert.match(parts.script, /document\.getElementById/)
  assert.deepEqual(parts.leftOut, [])
})

test('a style block moves into the stylesheet, and a style attribute is refused rather than quietly dropped', () => {
  const block = splitPage(made([{ path: 'index.html', source: '<style>p { margin: 0 }</style><body><p>a</p></body>' }]), 'index.html')
  assert.deepEqual(block.problems, [])
  assert.match(block.style, /from a <style> block in index\.html/)
  assert.match(block.style, /p \{ margin: 0 \}/)

  const attribute = splitPage(made([{ path: 'index.html', source: '<body><p style="margin:0">a</p><p style="color:red">b</p></body>' }]), 'index.html')
  assert.equal(attribute.problems.length, 1)
  assert.match(attribute.problems[0], /style="\.\.\." attribute/)
  assert.match(attribute.problems[0], /show unstyled with nothing saying why/)
})

test('an inline script, and an address outside the project, are each refused in words', () => {
  const inline = splitPage(made([{ path: 'index.html', source: '<body><p>a</p><script>let a = 1</script></body>' }]), 'index.html')
  assert.equal(inline.problems.length, 1)
  assert.match(inline.problems[0], /inline script is blocked by this sandbox/)

  const away = splitPage(made([{ path: 'index.html', source: '<body><link rel="stylesheet" href="https://cdn.example.com/a.css"><script src="missing.js"></script></body>' }]), 'index.html')
  assert.equal(away.problems.length, 2)
  assert.match(away.problems[0], /asks for the stylesheet "https:\/\/cdn\.example\.com\/a\.css", which is not a file in this project/)
  assert.match(away.problems[1], /asks for the script "missing\.js"/)
})

test('a file the page never asks for is said to have been left out, and pictures are said to be missing', () => {
  const parts = splitPage(
    made([
      { path: 'index.html', source: '<body><img src="logo.png"><p>a</p></body>' },
      { path: 'spare.js', source: 'let a = 1' }
    ]),
    'index.html'
  )
  assert.deepEqual(parts.leftOut, ['spare.js'])
  assert.ok(parts.notes.some((one) => /never asks for spare\.js/.test(one)))
  assert.ok(parts.notes.some((one) => /any picture it points at is not there/.test(one)))
})

test('several scripts joined into one scope is said, because it is a real way for working files to clash', () => {
  const project = made([
    { path: 'index.html', source: '<body><script src="a.js"></script><script src="b.js"></script></body>' },
    { path: 'a.js', source: 'var x = 1' },
    { path: 'b.js', source: 'var y = 2' }
  ])
  const parts = splitPage(project, 'index.html')
  assert.deepEqual(parts.problems, [])
  assert.ok(parts.notes.some((one) => /2 scripts are joined into one and run in a single scope/.test(one)))
  assert.match(parts.script, /\/\* a\.js \*\/[\s\S]*\/\* b\.js \*\//, 'in the order the page lists them')
})

// ---------------------------------------------------------------- every file checked

test('a file that looks like it holds a credential stops the run, and the reason never quotes it', () => {
  const checks = checkProjectFiles(made([{ path: 'index.html', source: '<body>a</body>' }, { path: 'app.js', source: 'const token = 1\nconst AWS = "AKIAABCDEFGHIJKLMNOP"' }]))
  assert.equal(checks.problems.length, 1)
  assert.match(checks.problems[0], /^app\.js: Not written:/)
  assert.match(checks.problems[0], /line 2/)
  assert.doesNotMatch(checks.problems[0], /AKIA/, 'a message that quotes a key has copied it')
})

test('a file that does not parse stops the run, and a language with no reader is only noted', () => {
  const broken = checkProjectFiles(made([{ path: 'data.json', source: '{"a": }' }]))
  assert.equal(broken.problems.length, 1)
  assert.match(broken.problems[0], /^data\.json: It does not read as JSON/)

  const fine = checkProjectFiles(made([{ path: 'data.json', source: '{"a": 1}' }]))
  assert.deepEqual(fine.problems, [])

  const python = checkProjectFiles(made([{ path: 'main.py', source: 'def f(:' }]))
  assert.deepEqual(python.problems, [], 'Orbis has no Python reader, so it says nothing about the file')
  assert.deepEqual(python.notes, [])
})

test('a script that uses import or export is refused up front, because it would stop the page before it ran', () => {
  const checks = checkProjectFiles(made([{ path: 'index.html', source: '<body>a</body>' }, { path: 'app.js', source: 'import a from "./b.js"\na()' }]))
  assert.equal(checks.problems.length, 1)
  assert.match(checks.problems[0], /app\.js uses import or export/)
  assert.match(checks.problems[0], /would stop the page before any of it ran/)
})

// ---------------------------------------------------------------- showing it

test('a web project reaches the sandbox as three files, with the shell Orbis wrote around it', async () => {
  const host = fakeHost()
  const outcome = await openInSandbox(website(), host.deps)
  assert.equal(outcome.ok, true, outcome.message)
  assert.equal(outcome.entry, 'index.html')
  assert.equal(outcome.health, 'running')
  assert.equal(host.seen.length, 1)
  assert.deepEqual(host.seen[0].files.map((one) => one.path), ['index.html', 'page.js', 'page.css'])
  assert.match(host.seen[0].files[0].content, /<script src="page\.js" defer><\/script>/)
  assert.match(host.seen[0].files[1].content, /document\.getElementById/)
  assert.match(host.seen[0].files[2].content, /h1 \{ color: red \}/)
  assert.ok((outcome.notes ?? []).some((one) => /cannot reach the network/.test(one)))
})

test('a project that is not a web page never reaches the sandbox', async () => {
  const host = fakeHost()
  const outcome = await openInSandbox(made([{ path: 'main.py', source: 'print(1)' }]), host.deps)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'not-runnable')
  assert.match(outcome.message ?? '', /Orbis does not run programs on your computer/)
  assert.equal(host.seen.length, 0, 'nothing was written anywhere')
})

test('the code check refusing the project is reported as the sandbox said it, and nothing is written', async () => {
  const host = fakeHost()
  const project = made([
    { path: 'index.html', source: '<body><p id="a">a</p><script src="app.js"></script></body>' },
    { path: 'app.js', source: 'fetch("/data.json").then((r) => r.json())' }
  ])
  const outcome = await openInSandbox(project, host.deps)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'refused')
  assert.match(outcome.message ?? '', /The code check refused this project/)
  assert.ok((outcome.problems ?? []).some((one) => /A Page does not fetch for itself/.test(one)))
  assert.equal(host.seen.length, 0)
  // The notes are still there, so the refusal is read beside what a run would have been.
  assert.ok((outcome.notes ?? []).some((one) => /not as Node/.test(one)))
})

test('a secret in any file stops the run before anything is written', async () => {
  const host = fakeHost()
  const project = made([
    { path: 'index.html', source: '<body><p>a</p><script src="app.js"></script></body>' },
    { path: 'app.js', source: 'const api_key = "0123456789abcdefghij"' }
  ])
  const outcome = await openInSandbox(project, host.deps)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'refused')
  assert.match(outcome.message ?? '', /Nothing was run/)
  assert.ok((outcome.problems ?? []).some((one) => /app\.js: Not written:/.test(one)))
  assert.equal(host.seen.length, 0)
})

test('a sandbox that would not open is reported as it said, and the page is closed again', async () => {
  const host = fakeHost({ ok: false, error: 'startup-timeout', message: 'This Page did not finish starting.' })
  const outcome = await openInSandbox(website(), host.deps)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'not-opened')
  assert.equal(outcome.message, 'This Page did not finish starting.')
  assert.deepEqual(outcome.problems, ['startup-timeout'])
  assert.deepEqual(host.closed, host.seen.map((one) => one.pageId))
})

test('a sandbox that could not be written to says so rather than reporting a run', async () => {
  const deps: SandboxDeps = {
    place: async () => {
      throw new Error('the folder is in use')
    },
    open: async () => ({ ok: true })
  }
  const outcome = await openInSandbox(website(), deps)
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'not-placed')
  assert.match(outcome.message ?? '', /could not be put where the sandbox serves them: the folder is in use/)
})

// ---------------------------------------------------------------- out as a zip

test('a project becomes a zip whose every file reads back as the text that went in', () => {
  const project = website()
  const zipped = zipProject(project, 1_700_000_000_000)
  assert.equal(isProjectProblem(zipped), false, isProjectProblem(zipped) ? zipped.message : '')
  const archive = zipped as { bytes: Uint8Array; entries: string[]; notes: string[] }
  assert.deepEqual(archive.entries, ['app.js', 'index.html', 'style.css'])

  const listing = readDirectory(archive.bytes)
  assert.equal(isZipError(listing), false)
  assert.deepEqual((listing as { path: string }[]).map((one) => one.path).sort(), ['app.js', 'index.html', 'style.css'])

  const verified = verifyProjectZip(project, archive.bytes, (data) => new Uint8Array(inflateRawSync(data)))
  assert.equal(verified.ok, true, verified.differences.join(' '))
  assert.deepEqual(verified.differences, [])
  assert.equal(verified.checks.find((one) => one.what === 'files')?.passed, true)
  assert.match(verified.checks.find((one) => one.what === 'files')?.describe ?? '', /3 of 3 files read back/)
  assert.ok(archive.notes.some((one) => /Nothing in it runs by being opened/.test(one)))
})

test('the same project zipped twice gives the same bytes, so checking the file afterwards means something', () => {
  const project = website()
  assert.deepEqual(zipProject(project, 1_000), zipProject(project, 1_000))
})

test('an archive that is not one, or that does not hold what the project holds, is reported as not verified', () => {
  const project = website()
  const nothing = verifyProjectZip(project, new Uint8Array([1, 2, 3]))
  assert.equal(nothing.ok, false)
  assert.equal(nothing.checks[0].passed, false)
  assert.match(nothing.checks[0].describe, /does not read back as an archive/)

  const partial = zipProject(made([{ path: 'index.html', source: PAGE }]), 0) as { bytes: Uint8Array }
  const missing = verifyProjectZip(project, partial.bytes)
  assert.equal(missing.ok, false)
  assert.ok(missing.differences.some((one) => /"app\.js" is not in the archive/.test(one)))
  assert.match(missing.checks.find((one) => one.what === 'files')?.describe ?? '', /1 of 3 files/)

  const changed = zipProject(made([{ path: 'index.html', source: 'different' }]), 0) as { bytes: Uint8Array }
  const differs = verifyProjectZip(made([{ path: 'index.html', source: PAGE }]), changed.bytes)
  assert.equal(differs.ok, false)
  assert.ok(differs.differences.some((one) => /does not read back as the text that was written/.test(one)))
})

test('a zip of a large deflatable file still reads back exactly', () => {
  const project = made([{ path: 'index.html', source: `<body>${'a'.repeat(5000)}</body>` }])
  const archive = zipProject(project, 0) as { bytes: Uint8Array }
  assert.equal(verifyProjectZip(project, archive.bytes).ok, true)
})
