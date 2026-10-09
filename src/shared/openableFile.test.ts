import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { endingOf, mayOpen, whyNotOpenable } from './openableFile.ts'

test('an ordinary download opens', () => {
  for (const name of ['C:/Users/a/Downloads/invoice.pdf', '/home/a/photo.JPG', 'notes.txt', 'book.epub', 'sheet.xlsx', 'page.html', 'song.mp3']) {
    assert.equal(mayOpen(name), true, name)
  }
})

test('a file that would run is refused, and the reason says what it is', () => {
  const why = whyNotOpenable('C:/Users/a/Downloads/invoice.pdf.exe')
  assert.ok(why)
  assert.ok(why.includes('.exe'), why)
  assert.ok(why.includes('run it'), why)
  assert.ok(why.includes('shown in its folder'), 'and says what happened instead')
  for (const name of ['a.bat', 'a.cmd', 'a.ps1', 'a.lnk', 'a.url', 'a.scr', 'a.msi', 'a.vbs', 'a.hta', 'a.jar', 'a.iso', 'a.dmg', 'a.app', 'a.sh', 'a.docm', 'a.reg', 'a.settingcontent-ms']) {
    assert.equal(mayOpen(name), false, name)
  }
})

test('the ending is read the way the computer reads it, not the way the name looks', () => {
  assert.equal(endingOf('a/b/thing.tar.gz'), 'gz')
  assert.equal(endingOf('.gitignore'), '', 'a leading dot is the whole name')
  assert.equal(endingOf('C:\\x\\y.EXE'), 'exe')
  assert.equal(endingOf('folder/'), '')
})

test('a trailing dot or space does not get a program past it, because Windows strips them too', () => {
  assert.equal(mayOpen('thing.exe.'), false)
  assert.equal(mayOpen('thing.exe '), false)
  assert.equal(mayOpen('thing.exe. . '), false)
})

test('an upper-case or mixed-case ending is the same ending', () => {
  assert.equal(mayOpen('Thing.ExE'), false)
  assert.equal(mayOpen('Thing.PDF'), true)
})

test('a file with no type at all is refused, because there is nothing to check', () => {
  assert.ok(whyNotOpenable('C:/Users/a/Downloads/invoice')?.includes('no file type'))
})

test('nothing at all is refused, and does not throw', () => {
  assert.ok(whyNotOpenable(''))
  assert.ok(whyNotOpenable('   '))
  assert.ok(whyNotOpenable(undefined as unknown as string))
})
