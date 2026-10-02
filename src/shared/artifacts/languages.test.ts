import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMATS, detectFormat } from '../compute/interchange.ts'
import { checkSyntax, CODE_ONLY_EXTENSIONS, extensionForLanguage, languageById, languageForFile, LANGUAGES, lineCount } from './languages.ts'

test('every language has its own id, name and extensions, and no extension means two languages', () => {
  assert.equal(new Set(LANGUAGES.map((one) => one.id)).size, LANGUAGES.length)
  assert.equal(new Set(LANGUAGES.map((one) => one.name)).size, LANGUAGES.length)
  const extensions = LANGUAGES.flatMap((one) => one.extensions)
  assert.equal(new Set(extensions).size, extensions.length)
  for (const one of LANGUAGES) {
    assert.match(one.id, /^[a-z][a-z0-9]*$/)
    assert.ok(one.extensions.length > 0 && one.extensions.every((ext) => /^\.[a-z0-9]+$/.test(ext)), one.id)
  }
  const names = LANGUAGES.flatMap((one) => [one.id, ...one.aliases])
  assert.equal(new Set(names).size, names.length, 'no alias means two languages')
})

test('a language is found by id, by name or by another name it goes by, and never by a near miss', () => {
  assert.equal(languageById('python')?.id, 'python')
  assert.equal(languageById(' PY ')?.id, 'python')
  assert.equal(languageById('C#')?.id, 'csharp')
  assert.equal(languageById('c++')?.id, 'cpp')
  assert.equal(languageById('bash')?.id, 'shell')
  assert.equal(languageById('pythonic'), null)
  assert.equal(languageById(''), null)
  assert.equal(languageById('markdown'), null, 'a document is not code')
})

test('a file name says its language by its extension, and a saved file gets the first one', () => {
  assert.equal(languageForFile('report.PY')?.id, 'python')
  assert.equal(languageForFile('C:\\work\\app.test.tsx')?.id, 'typescript')
  assert.equal(languageForFile('Dockerfile')?.id, 'dockerfile')
  assert.equal(languageForFile('notes.txt'), null)
  assert.equal(languageForFile('README'), null)
  assert.equal(extensionForLanguage('javascript'), '.js')
  assert.equal(extensionForLanguage('yaml'), '.yml')
  assert.equal(extensionForLanguage('nope'), '.txt')
})

test('adding code did not change what any other file opens as', () => {
  // The format registry is asked by file name all over Orbis. A source file must not suddenly be a format it has no reader for.
  assert.deepEqual(FORMATS.code.extensions, ['.code'])
  for (const name of ['data.json', 'page.html', 'feed.xml', 'notes.md', 'table.csv']) assert.notEqual(detectFormat(name, '', '').chosen, 'code', name)
  assert.notEqual(detectFormat('script.py', '', 'print(1)').chosen, 'code')
  assert.equal(detectFormat('script.py', '', 'print(1)').byExtension, null, 'a source file name is not claimed by the registry')
  assert.equal(CODE_ONLY_EXTENSIONS.includes('.json'), false, 'JSON still opens as the table it holds')
  assert.equal(CODE_ONLY_EXTENSIONS.includes('.html'), false, 'HTML still opens as the document it holds')
  assert.ok(CODE_ONLY_EXTENSIONS.includes('.py') && CODE_ONLY_EXTENSIONS.includes('.sql'))
})

test('JSON and XML are read by their own readers, and a fault says where', () => {
  assert.deepEqual(checkSyntax('json', '{"a": [1, 2]}'), { checked: true, wellFormed: true, message: 'It reads as JSON.' })
  const bad = checkSyntax('json', '{\n  "a": 1,\n  "b": \n}')
  assert.equal(bad.checked, true)
  assert.equal(bad.wellFormed, false)
  assert.match(bad.message, /^It does not read as JSON/)
  assert.equal(checkSyntax('xml', '<a><b>1</b></a>').wellFormed, true)
  const xml = checkSyntax('xml', '<a><b>1</a>')
  assert.equal(xml.checked && !xml.wellFormed, true)
})

test('a language with no reader is reported as not checked, never as fine', () => {
  const python = checkSyntax('python', 'def f(:\n  pass')
  assert.equal(python.checked, false)
  assert.equal(python.wellFormed, false)
  assert.match(python.message, /no checker for Python, so this was not checked\. It was not run\./)
  const unknown = checkSyntax('klingon', 'x')
  assert.equal(unknown.checked, false)
})

test('JavaScript is checked only when an engine is handed in, and import/export is said to be unreadable rather than wrong', () => {
  const without = checkSyntax('javascript', 'let x = 1')
  assert.equal(without.checked, false)
  assert.match(without.message, /was not checked/)
  assert.deepEqual(checkSyntax('javascript', 'let x = 1', () => null), { checked: true, wellFormed: true, message: 'It compiles as JavaScript. It was not run.' })
  const broken = checkSyntax('javascript', 'let = ', () => 'Unexpected end of input (line 1)')
  assert.equal(broken.checked && !broken.wellFormed, true)
  assert.match(broken.message, /does not compile as JavaScript: Unexpected end of input \(line 1\)/)
  const module = checkSyntax('javascript', 'export const a = 1', () => 'module')
  assert.equal(module.checked, false)
  assert.match(module.message, /uses import or export, which this check cannot read/)
})

test('lines are counted the way a person counts them', () => {
  assert.equal(lineCount(''), 0)
  assert.equal(lineCount('a'), 1)
  assert.equal(lineCount('a\n'), 1)
  assert.equal(lineCount('a\nb\r\nc\n'), 3)
  assert.equal(lineCount('a\n\nb'), 3)
})
