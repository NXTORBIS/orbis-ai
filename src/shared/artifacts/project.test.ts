import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addProjectFile,
  checkProjectPath,
  chooseEntry,
  compareProjects,
  describeComparison,
  isProjectProblem,
  makeProject,
  parseProject,
  projectLanguages,
  projectListing,
  projectSize,
  projectZipEntries,
  PROJECT_LIMITS,
  readProjectReply,
  removeProjectFile,
  serialiseProject,
  setProjectFile,
  type Project
} from './project.ts'

const made = (files: { path: string; source: string }[], entry = ''): Project => {
  const out = makeProject(files, entry)
  assert.equal(isProjectProblem(out), false, isProjectProblem(out) ? out.message : '')
  return out as Project
}

const site = (): Project =>
  made([
    { path: 'index.html', source: '<body><h1>Hi</h1></body>' },
    { path: 'style.css', source: 'h1 { color: red }' },
    { path: 'app.js', source: 'document.title = "Hi"' }
  ])

// ---------------------------------------------------------------- paths

test('a path has to be relative, forward-slashed and shallow, and a bad one is refused rather than tidied', () => {
  assert.equal(checkProjectPath('src/app.js').clean, 'src/app.js')
  assert.equal(checkProjectPath('  index.html  ').clean, 'index.html')
  for (const bad of ['/etc/passwd', 'C:\\work\\a.js', 'src\\app.js', '../a.js', 'a/../../b.js', 'a//b.js', 'con.js', 'my file.js', 'a.js.', 'a<b>.js', '']) {
    const verdict = checkProjectPath(bad)
    assert.equal(verdict.ok, false, bad)
    assert.equal(verdict.clean, '', 'a refused path is never handed back repaired')
    assert.ok(verdict.why.length > 10, `${bad} was refused with no reason`)
  }
  assert.equal(checkProjectPath(42).ok, false)
  assert.equal(checkProjectPath('a/b/c/d/e/f/g.js').ok, false, 'deeper than a project goes')
  assert.equal(checkProjectPath(`${'a/'.repeat(4)}${'n'.repeat(130)}.js`).ok, false, 'longer than a path may be')
})

test('a hidden file is refused by name, and the reason says why .env is the one that matters', () => {
  const env = checkProjectPath('.env')
  assert.equal(env.ok, false)
  assert.match(env.why, /hidden file/)
  assert.match(env.why, /\.env holds credentials/)
  assert.equal(checkProjectPath('.git/config').ok, false)
  assert.equal(checkProjectPath('src/.env.local').ok, false, 'hidden anywhere, not only at the top')
  assert.equal(checkProjectPath('src/env.js').ok, true, 'a file that merely mentions it is fine')
})

// ---------------------------------------------------------------- making one

test('a project knows each file’s language from its extension, and says nothing about one it does not know', () => {
  const project = made([
    { path: 'index.html', source: '<p>a</p>' },
    { path: 'notes.md', source: '# a' },
    { path: 'src/main.py', source: 'print(1)' }
  ])
  assert.deepEqual(
    project.files.map((one) => [one.path, one.language]),
    [
      ['index.html', 'html'],
      ['notes.md', ''],
      ['src/main.py', 'python']
    ]
  )
  assert.deepEqual(projectLanguages(project), [
    { name: 'HTML', files: 1 },
    { name: 'Python', files: 1 },
    { name: 'Something else', files: 1 }
  ])
})

test('the files come back in one order whatever order they went in, so two versions can be compared', () => {
  const one = made([{ path: 'b.js', source: '1' }, { path: 'a.js', source: '2' }])
  const two = made([{ path: 'a.js', source: '2' }, { path: 'b.js', source: '1' }])
  assert.deepEqual(one.files.map((f) => f.path), ['a.js', 'b.js'])
  assert.deepEqual(serialiseProject(one), serialiseProject(two))
})

test('an empty project, too many files, and too much text are each refused in words', () => {
  const empty = makeProject([])
  assert.equal(isProjectProblem(empty) && empty.error, 'empty')
  const many = makeProject(Array.from({ length: PROJECT_LIMITS.files + 1 }, (_, i) => ({ path: `f${i}.js`, source: 'x' })))
  assert.equal(isProjectProblem(many) && many.error, 'too-many')
  assert.match(isProjectProblem(many) ? many.message : '', /holds 40/)
  const big = makeProject([{ path: 'a.js', source: 'x'.repeat(PROJECT_LIMITS.fileCharacters + 1) }])
  assert.equal(isProjectProblem(big) && big.error, 'too-large')
  const whole = makeProject(Array.from({ length: 5 }, (_, i) => ({ path: `f${i}.js`, source: 'x'.repeat(PROJECT_LIMITS.fileCharacters) })))
  assert.equal(isProjectProblem(whole) && whole.error, 'too-large', 'five full files is past what the whole project may hold')
  const notText = makeProject([{ path: 'a.js', source: 42 }])
  assert.equal(isProjectProblem(notText) && notText.error, 'parse')
})

test('two names that are one file on Windows are refused, and so is a file where a folder has to be', () => {
  const twice = makeProject([{ path: 'a.js', source: '1' }, { path: 'a.js', source: '2' }])
  assert.equal(isProjectProblem(twice) && twice.error, 'duplicate')
  assert.match(isProjectProblem(twice) ? twice.message : '', /twice/)
  const cased = makeProject([{ path: 'App.js', source: '1' }, { path: 'app.js', source: '2' }])
  assert.equal(isProjectProblem(cased) && cased.error, 'duplicate')
  assert.match(isProjectProblem(cased) ? cased.message : '', /upper and lower case/)
  const both = makeProject([{ path: 'src', source: '1' }, { path: 'src/a.js', source: '2' }])
  assert.equal(isProjectProblem(both) && both.error, 'bad-path')
  assert.match(isProjectProblem(both) ? both.message : '', /both a file and the folder/)
})

// ---------------------------------------------------------------- the entry

test('the file a project starts at is a page when there is one, and is always a file that exists', () => {
  assert.equal(chooseEntry(['a.js', 'index.html']), 'index.html')
  assert.equal(chooseEntry(['deep/x/index.html', 'web/index.html']), 'web/index.html', 'the shallowest page')
  assert.equal(chooseEntry(['about.html', 'main.py']), 'about.html')
  assert.equal(chooseEntry(['helper.py', 'main.py']), 'main.py')
  assert.equal(chooseEntry(['b.txt', 'a.txt']), 'a.txt')
  assert.equal(chooseEntry([]), '')
  assert.equal(site().entry, 'index.html')
  const asked = made([{ path: 'a.js', source: '1' }, { path: 'b.js', source: '2' }], 'b.js')
  assert.equal(asked.entry, 'b.js')
  const missing = makeProject([{ path: 'a.js', source: '1' }], 'nope.js')
  assert.equal(isProjectProblem(missing) && missing.error, 'not-found')
})

// ---------------------------------------------------------------- the stored form

test('a project written down and read back is the same project', () => {
  const project = site()
  const read = parseProject(serialiseProject(project))
  assert.equal(isProjectProblem(read), false)
  assert.deepEqual(read, project)
})

test('the reader refuses anything that is not a project this Orbis wrote, and re-checks every path', () => {
  for (const bad of ['', 'not json', '[]', '"a"', '{}', JSON.stringify({ form: 'orbis-project' })]) {
    const read = parseProject(bad)
    assert.equal(isProjectProblem(read) && read.error, 'parse', JSON.stringify(bad))
  }
  const future = parseProject(JSON.stringify({ form: 'orbis-project', formVersion: 9, files: [] }))
  assert.match(isProjectProblem(future) ? future.message : '', /form 9/)
  // A stored file edited by hand to hold a path that walks up. Re-checked, not trusted because it was stored once.
  const hostile = parseProject(JSON.stringify({ form: 'orbis-project', formVersion: 1, entry: '', files: [{ path: '../../a.js', language: 'javascript', source: '1' }] }))
  assert.equal(isProjectProblem(hostile) && hostile.error, 'bad-path')
  // A stored file claiming a language its name does not say. The extension wins.
  const lying = parseProject(JSON.stringify({ form: 'orbis-project', formVersion: 1, entry: 'a.py', files: [{ path: 'a.py', language: 'javascript', source: 'print(1)' }] }))
  assert.equal(isProjectProblem(lying), false)
  assert.equal((lying as Project).files[0].language, 'python')
})

// ---------------------------------------------------------------- a model's answer

test('an answer of named fenced files becomes a project', () => {
  const answer = [
    'Here is a small website.',
    '',
    '### index.html',
    '```html',
    '<body><h1>Hi</h1></body>',
    '```',
    '',
    'And the style:',
    '',
    '**style.css**',
    '```css',
    'h1 { color: red }',
    '```',
    '',
    '`app.js`',
    '```js',
    'console.log(1)',
    '```'
  ].join('\n')
  const project = readProjectReply(answer)
  assert.equal(isProjectProblem(project), false, isProjectProblem(project) ? project.message : '')
  assert.deepEqual((project as Project).files.map((one) => one.path), ['app.js', 'index.html', 'style.css'])
  assert.equal((project as Project).entry, 'index.html')
  assert.equal((project as Project).files.find((one) => one.path === 'style.css')?.source, 'h1 { color: red }')
})

test('a path on the fence’s own line names the file too, and a plain line with a path does', () => {
  const info = readProjectReply('```html index.html\n<p>a</p>\n```')
  assert.equal((info as Project).files[0].path, 'index.html')
  const plain = readProjectReply('src/app.js:\n```\nlet a = 1\n```')
  assert.equal((plain as Project).files[0].path, 'src/app.js')
})

test('an answer that is ambiguous is refused in words rather than half-read', () => {
  const unnamed = readProjectReply('Here:\n```js\nlet a = 1\n```')
  assert.equal(isProjectProblem(unnamed) && unnamed.error, 'ambiguous')
  assert.match(isProjectProblem(unnamed) ? unnamed.message : '', /does not say what any of them should be called/)

  const half = readProjectReply('### index.html\n```html\n<p>a</p>\n```\n\nand then:\n\n```js\nlet a = 1\n```')
  assert.equal(isProjectProblem(half) && half.error, 'ambiguous')
  assert.match(isProjectProblem(half) ? half.message : '', /Nothing was kept/)

  const twice = readProjectReply('### a.js\n```js\n1\n```\n### a.js\n```js\n2\n```')
  assert.equal(isProjectProblem(twice) && twice.error, 'duplicate')
  assert.match(isProjectProblem(twice) ? twice.message : '', /will not choose which one you meant/)

  const nothing = readProjectReply('I would start with an index.html and a stylesheet.')
  assert.equal(isProjectProblem(nothing) && nothing.error, 'ambiguous')
  assert.equal(isProjectProblem(readProjectReply('')) && (readProjectReply('') as { error: string }).error, 'parse')
})

test('a file that itself holds a fence is read whole, inside the longer fence around it', () => {
  const answer = ['### notes.md', '````markdown', 'Look:', '```js', 'let a = 1', '```', 'done', '````'].join('\n')
  const project = readProjectReply(answer)
  assert.equal(isProjectProblem(project), false, isProjectProblem(project) ? project.message : '')
  assert.equal((project as Project).files[0].source, 'Look:\n```js\nlet a = 1\n```\ndone')
})

test('a path a model invented that walks up is refused by the same rule a stored one is', () => {
  const out = readProjectReply('### ../escape.js\n```js\n1\n```')
  assert.equal(isProjectProblem(out), true)
})

// ---------------------------------------------------------------- saying what it is

test('a card is told how many files and which', () => {
  assert.equal(projectListing(site()), '3 files: app.js, index.html, style.css')
  const big = made(Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.js`, source: 'x' })))
  assert.equal(projectListing(big), '6 files: f0.js, f1.js, f2.js and 3 more')
  assert.equal(projectListing(made([{ path: 'a.js', source: 'x' }])), '1 file: a.js')
  assert.deepEqual(projectSize(site()), { files: 3, characters: 24 + 17 + 21 })
})

// ---------------------------------------------------------------- changing it

test('one file changed is a whole new project, and the old one is untouched', () => {
  const before = site()
  const after = setProjectFile(before, 'style.css', 'h1 { color: blue }')
  assert.equal(isProjectProblem(after), false)
  assert.equal(before.files.find((one) => one.path === 'style.css')?.source, 'h1 { color: red }')
  assert.equal((after as Project).files.find((one) => one.path === 'style.css')?.source, 'h1 { color: blue }')
  const missing = setProjectFile(before, 'nope.css', 'x')
  assert.equal(isProjectProblem(missing) && missing.error, 'not-found')
  assert.match(isProjectProblem(missing) ? missing.message : '', /3 files: app\.js/)
})

test('a file added, and a file taken out, each keep the project legal', () => {
  const added = addProjectFile(site(), 'about.html', '<p>about</p>')
  assert.equal((added as Project).files.length, 4)
  const again = addProjectFile(site(), 'app.js', 'x')
  assert.equal(isProjectProblem(again) && again.error, 'duplicate')
  const gone = removeProjectFile(site(), 'style.css')
  assert.deepEqual((gone as Project).files.map((one) => one.path), ['app.js', 'index.html'])
  // The entry taken out: the project is given a new starting file rather than one that is not there.
  const noEntry = removeProjectFile(site(), 'index.html')
  assert.equal((noEntry as Project).entry, 'app.js')
  const last = removeProjectFile(made([{ path: 'a.js', source: '1' }]), 'a.js')
  assert.equal(isProjectProblem(last) && last.error, 'empty')
})

test('two versions are compared by path and by text, and a rename is not claimed', () => {
  const before = site()
  const after = made([
    { path: 'index.html', source: '<body><h1>Hi</h1></body>' },
    { path: 'style.css', source: 'h1 { color: blue }' },
    { path: 'main.js', source: 'document.title = "Hi"' }
  ])
  const comparison = compareProjects(before, after)
  assert.deepEqual(comparison.added, ['main.js'])
  assert.deepEqual(comparison.removed, ['app.js'])
  assert.deepEqual(comparison.changed, ['style.css'])
  assert.deepEqual(comparison.unchanged, ['index.html'])
  assert.equal(comparison.entryMoved, false)
  const said = describeComparison(comparison)
  assert.match(said, /1 changed \(style\.css\)/)
  assert.match(said, /1 added \(main\.js\)/)
  assert.match(said, /1 taken out \(app\.js\)/)
  assert.match(said, /1 left alone/)
  assert.doesNotMatch(said, /renamed/, 'app.js becoming main.js is a guess nobody made')
  assert.equal(describeComparison(compareProjects(before, before)), 'The files are the same as they were.')
  const moved = compareProjects(before, made([{ path: 'app.js', source: 'document.title = "Hi"' }]))
  assert.match(describeComparison(moved), /starts at a different file now/)
})

// ---------------------------------------------------------------- out as a zip

test('the zip entries are the files and nothing else, with the same bytes every time', () => {
  const project = site()
  const entries = projectZipEntries(project)
  assert.deepEqual(entries.map((one) => one.path), ['app.js', 'index.html', 'style.css'])
  assert.equal(new TextDecoder().decode(entries[1].data), '<body><h1>Hi</h1></body>')
  assert.ok(entries.every((one) => one.compress === false), 'a file of a few bytes is not worth deflating')
  assert.deepEqual(projectZipEntries(project), entries)
  assert.equal(projectZipEntries(project, 1_700_000_000_000)[0].modified, 1_700_000_000_000)
})
