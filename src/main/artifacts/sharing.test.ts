import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashOf } from '../../shared/compute/interchange.ts'
import {
  base64Lines,
  buildEmailDraft,
  cloudFolderAt,
  cloudFolders,
  cloudSaveNote,
  decodeWords,
  EMAIL_LIMITS,
  encodedWords,
  filenameParameters,
  headerLine,
  isSharingError,
  mailDate,
  readAddress,
  readEmailDraft,
  verifyEmailDraft,
  type CloudDeps,
  type EmailDraft
} from './sharing.ts'

/*
 * Real drafts, built and then read back by the reader in the same file -- a message whose attachment does not come
 * out again is the failure that gets sent. The cloud side runs against a map of what is on a pretend computer, which
 * is the point of the injected dependencies.
 */

const NOW = Date.UTC(2026, 9, 3, 11, 30, 15)

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff, 0x7f, 0x80, 0x41])

const draftOf = (request: Partial<Parameters<typeof buildEmailDraft>[0]> = {}): EmailDraft => {
  const made = buildEmailDraft({ subject: 'Energy report', body: 'The report is attached.', now: NOW, ...request })
  if (isSharingError(made)) throw new Error(made.message)
  return made
}

const parsedOf = (draft: EmailDraft) => {
  const back = readEmailDraft(draft.bytes)
  if (isSharingError(back)) throw new Error(back.message)
  return back
}

// ---------------------------------------------------------------- addresses

test('an address is read in the three forms people write, and a near miss is refused rather than corrected', () => {
  assert.deepEqual(readAddress('sam@example.com'), { display: '', address: 'sam@example.com' })
  assert.deepEqual(readAddress('Sam Reed <sam@example.com>'), { display: 'Sam Reed', address: 'sam@example.com' })
  assert.deepEqual(readAddress('"Reed, Sam" <sam@example.com>'), { display: 'Reed, Sam', address: 'sam@example.com' })
  assert.deepEqual(readAddress('  sam.reed+notes@mail.example.co.uk '), { display: '', address: 'sam.reed+notes@mail.example.co.uk' })

  assert.equal(readAddress('sam@localhost'), null, 'no dot in the domain')
  assert.equal(readAddress('sam at example.com'), null)
  assert.equal(readAddress('sam@@example.com'), null)
  assert.equal(readAddress('sam@example'), null)
  assert.equal(readAddress('@example.com'), null)
  assert.equal(readAddress('sam@example..com'), null)
  assert.equal(readAddress(''), null)
})

test('an address carrying a line ending is refused, because a header holding one would end the header', () => {
  assert.equal(readAddress('sam@example.com\r\nBcc: someone@else.com'), null)
  assert.equal(readAddress('sam@example.com\nX-Thing: no'), null)
})

test('a draft with an address that is not one is refused with the address quoted back', () => {
  const refused = buildEmailDraft({ to: ['sam@example.com', 'not an address'], subject: 'Hello', body: '', now: NOW })
  assert.ok(isSharingError(refused))
  assert.equal(refused.error, 'bad-address')
  assert.match(refused.message, /"not an address" is not an email address/)
})

// ---------------------------------------------------------------- the message

test('the draft is a message: CRLF throughout, marked unsent, with the date written the way the format writes one', () => {
  const draft = draftOf({ to: ['sam@example.com'] })
  assert.ok(draft.text.startsWith('MIME-Version: 1.0\r\n'))
  assert.ok(draft.text.includes('\r\nX-Unsent: 1\r\n'), 'the header that makes a mail program open it as a draft')
  assert.ok(draft.text.includes('\r\nTo: sam@example.com\r\n'))
  assert.ok(draft.text.includes('\r\nSubject: Energy report\r\n'))
  assert.equal(draft.text.replace(/\r\n/g, '').includes('\n'), false, 'no bare newline survives anywhere')
  assert.equal(draft.name, 'Energy report.eml')
  assert.equal(draft.mediaType, 'message/rfc822')
  assert.equal(draft.hash, hashOf(draft.bytes))
  assert.equal(mailDate(NOW), 'Sat, 3 Oct 2026 11:30:15 +0000')
  assert.ok(draft.text.includes(`Date: ${mailDate(NOW)}`))
})

test('the words say Orbis sends nothing and name who the draft opens addressed to', () => {
  const draft = draftOf({ to: ['sam@example.com', 'Pat <pat@example.org>'] })
  assert.match(draft.notes[0], /Orbis does not send email and has no mail account/)
  assert.match(draft.notes[0], /sam@example\.com, pat@example\.org/)
  assert.match(draft.notes[0], /Nothing leaves this computer until you press Send/)

  const empty = draftOf()
  assert.match(empty.notes[0], /whoever you address it to/)
  assert.ok(empty.notes.some((one) => /the To line empty/.test(one)), empty.notes.join(' | '))
})

test('the body comes back out of the message as the words that went in', () => {
  const words = 'Line one.\nLine two, with a comma; and a semicolon.\nAnd a pound sign: \u00a3120.'
  const draft = draftOf({ body: words })
  const back = parsedOf(draft)
  assert.equal(back.parts.length, 1)
  assert.equal(back.parts[0].mediaType, 'text/plain')
  assert.equal(new TextDecoder().decode(back.parts[0].bytes), words)
})

test('a subject that is not plain ASCII is written as encoded words, each inside the 75 the format allows', () => {
  const subject = `Rapport d'énergie — ${'é'.repeat(60)}`
  const draft = draftOf({ subject })
  assert.ok(draft.text.includes('Subject: =?UTF-8?B?'))
  for (const line of draft.text.split('\r\n')) {
    for (const word of line.match(/=\?UTF-8\?B\?[^?]*\?=/g) ?? []) assert.ok(word.length <= 75, `${word.length} characters`)
  }
  assert.equal(parsedOf(draft).headers.subject, subject, 'and it reads back as exactly what was asked for')
})

test('an encoded word never cuts a character in half', () => {
  const words = encodedWords('é'.repeat(40))
  assert.ok(words.length > 1)
  assert.equal(decodeWords(words.join('')), 'é'.repeat(40))
  assert.equal(decodeWords(words.join('')).includes('\ufffd'), false)
})

test('a plain ASCII header is folded rather than encoded, and a header value cannot smuggle a new header in', () => {
  const line = headerLine('Subject', `${'word '.repeat(40)}end`)
  assert.ok(line.startsWith('Subject: word'))
  for (const piece of line.split('\r\n')) assert.ok(piece.length <= EMAIL_LIMITS.header, `${piece.length} characters`)
  for (const piece of line.split('\r\n').slice(1)) assert.ok(piece.startsWith(' '))

  const sneaky = draftOf({ subject: 'Report\r\nBcc: someone@else.com' })
  assert.equal(sneaky.subject, 'Report Bcc: someone@else.com')
  assert.equal(parsedOf(sneaky).headers.bcc, undefined, 'the line ending became a space, so no second header was made')
})

// ---------------------------------------------------------------- the attachment

test('the attachment goes in and comes back out byte for byte', () => {
  const draft = draftOf({ to: ['sam@example.com'], attachment: { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF } })
  assert.ok(draft.text.includes('Content-Type: multipart/mixed; boundary="'))
  assert.deepEqual(draft.attachment, { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF.length, encoded: 20 })

  const back = parsedOf(draft)
  assert.equal(back.parts.length, 2)
  assert.equal(back.parts[0].mediaType, 'text/plain')
  assert.equal(back.parts[1].mediaType, 'application/pdf')
  assert.equal(back.parts[1].filename, 'Energy.pdf')
  assert.deepEqual(back.parts[1].bytes, PDF)
  assert.ok(draft.text.includes('Content-Disposition: attachment;\r\n filename="Energy.pdf"'))
})

test('base64 is wrapped at 76 columns and no line of the message is longer', () => {
  const big = new Uint8Array(4000)
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 256
  const draft = draftOf({ attachment: { name: 'Data.bin', mediaType: 'application/octet-stream', bytes: big } })
  for (const line of draft.text.split('\r\n')) assert.ok(line.length <= 998, 'nothing is over the hard limit')
  const lines = base64Lines(big)
  assert.ok(lines.length > 1)
  for (const line of lines) assert.ok(line.length <= EMAIL_LIMITS.wrap, `${line.length} characters`)
  assert.deepEqual(parsedOf(draft).parts[1].bytes, big)
})

test('a file name that is not plain ASCII is written the way RFC 2231 says and reads back whole', () => {
  const name = 'Énergie — rapport.pdf'
  assert.equal(filenameParameters('plain.pdf'), 'filename="plain.pdf"')
  assert.match(filenameParameters(name), /^filename\*=UTF-8''/)
  const draft = draftOf({ attachment: { name, mediaType: 'application/pdf', bytes: PDF } })
  assert.ok(draft.text.includes("filename*=UTF-8''"))
  assert.ok(!/name="[^"]*[^\x20-\x7e]/.test(draft.text), 'no raw non-ASCII sits in a quoted parameter')
  assert.equal(parsedOf(draft).parts[1].filename, draft.attachment?.name)
})

test('a file name that could break out of the header is made safe before it is written', () => {
  const draft = draftOf({ attachment: { name: 'a"b\r\nContent-Type: evil/thing\r\n\r\nc.pdf', mediaType: 'application/pdf', bytes: PDF } })
  assert.equal(draft.attachment?.name.includes('\r'), false)
  assert.equal(draft.attachment?.name.includes('"'), false)
  const back = parsedOf(draft)
  assert.equal(back.parts.length, 2, 'no third part was smuggled in')
  assert.deepEqual(back.parts[1].bytes, PDF)
})

test('an attachment bigger than a message can carry is refused, with the common limit said in words', () => {
  const refused = buildEmailDraft({
    subject: 'Big',
    body: '',
    now: NOW,
    attachment: { name: 'Big.bin', mediaType: 'application/octet-stream', bytes: new Uint8Array(EMAIL_LIMITS.attachmentBytes + 1) }
  })
  assert.ok(isSharingError(refused))
  assert.equal(refused.error, 'too-large')
  assert.match(refused.message, /25\.0 MB/)
  assert.match(refused.message, /a third bigger/)
  assert.match(refused.message, /send a link to it instead/)
})

test('a file type that is not a file type, and an empty attachment, are refused rather than labelled', () => {
  const badType = buildEmailDraft({ subject: 'Hi', body: '', now: NOW, attachment: { name: 'x', mediaType: 'not a type', bytes: PDF } })
  assert.ok(isSharingError(badType))
  assert.equal(badType.error, 'bad-media-type')

  const empty = buildEmailDraft({ subject: 'Hi', body: '', now: NOW, attachment: { name: 'x', mediaType: 'application/pdf', bytes: new Uint8Array(0) } })
  assert.ok(isSharingError(empty))
  assert.match(empty.message, /nothing to attach/)
})

test('a draft with no subject is refused, because a mail program would show an untitled draft', () => {
  const refused = buildEmailDraft({ subject: '   ', body: 'x', now: NOW })
  assert.ok(isSharingError(refused))
  assert.match(refused.message, /needs a subject/)
})

test('the same request written twice is the same bytes, so nothing changes under a person who saves it again', () => {
  const first = draftOf({ to: ['sam@example.com'], attachment: { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF } })
  const second = draftOf({ to: ['sam@example.com'], attachment: { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF } })
  assert.equal(first.hash, second.hash)
  assert.deepEqual(first.bytes, second.bytes)
})

// ---------------------------------------------------------------- read back and checked

test('the check reads the draft back and compares the attachment byte for byte', () => {
  const draft = draftOf({ to: ['sam@example.com'], attachment: { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF } })
  const result = verifyEmailDraft(draft, draft.bytes, PDF, { bytes: draft.bytes.length, hash: draft.hash })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(result.checks.map((one) => one.what), ['written', 'checksum', 'message', 'draft', 'headers', 'attachment'])
  assert.deepEqual(result.differences, [])
  assert.deepEqual(result.reimported, { rows: 2, columns: 0 })
})

test('a draft whose attachment was changed on disk fails the check and the difference says so', () => {
  const draft = draftOf({ attachment: { name: 'Energy.pdf', mediaType: 'application/pdf', bytes: PDF } })
  const other = new Uint8Array(PDF)
  other[other.length - 1] = 0x42
  const result = verifyEmailDraft(draft, draft.bytes, other)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'attachment')?.passed, false)
  assert.ok(result.differences.some((one) => /not the same bytes/.test(one)), result.differences.join(' | '))
})

test('a draft whose unsent mark was stripped on disk fails the check', () => {
  const draft = draftOf({ to: ['sam@example.com'] })
  const tampered = new TextEncoder().encode(draft.text.replace('X-Unsent: 1\r\n', ''))
  const result = verifyEmailDraft(draft, tampered)
  assert.equal(result.ok, false)
  assert.equal(result.checks.find((one) => one.what === 'draft')?.passed, false)
})

test('a file that is not a message at all is refused by the reader', () => {
  const refused = readEmailDraft('just some text with no headers')
  assert.ok(isSharingError(refused))
  assert.match(refused.message, /no blank line between its headers and its body/)
})

// ---------------------------------------------------------------- cloud folders on this computer

const pretendComputer = (folders: Record<string, { writable?: boolean }>, files: Record<string, string> = {}): CloudDeps => ({
  async isFolder(path) {
    return Object.prototype.hasOwnProperty.call(folders, path)
  },
  async isWritable(path) {
    return folders[path]?.writable !== false
  },
  async readText(path) {
    return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null
  }
})

test('OneDrive is found from the environment, under the name the cloud program gave the folder', async () => {
  const found = await cloudFolders(
    { OneDrive: 'C:\\Users\\sam\\OneDrive', OneDriveCommercial: 'C:\\Users\\sam\\OneDrive - Contoso', USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'C:\\Users\\sam\\OneDrive': {}, 'C:\\Users\\sam\\OneDrive - Contoso': {} })
  )
  assert.deepEqual(found.map((one) => one.name), ['OneDrive', 'OneDrive - Contoso'])
  assert.deepEqual(found.map((one) => one.id), ['onedrive', 'onedrive'])
  assert.deepEqual(found.map((one) => one.writable), [true, true])
  assert.deepEqual(found.map((one) => one.keptBy), ['OneDrive', 'OneDrive'])
})

test('a folder the environment names but that is not really there is not listed', async () => {
  const found = await cloudFolders({ OneDrive: 'C:\\Users\\sam\\OneDrive', USERPROFILE: 'C:\\Users\\sam' }, pretendComputer({}))
  assert.deepEqual(found, [])
})

test('Dropbox is found from its own pointer file, and only the path is taken out of it', async () => {
  const info = JSON.stringify({
    personal: { path: 'C:\\Users\\sam\\Dropbox', host: 123456, subscription_type: 'Basic' },
    business: { path: 'C:\\Users\\sam\\Dropbox (Contoso)', host: 7 }
  })
  const found = await cloudFolders(
    { APPDATA: 'C:\\Users\\sam\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'C:\\Users\\sam\\Dropbox': {}, 'C:\\Users\\sam\\Dropbox (Contoso)': {} }, { 'C:\\Users\\sam\\AppData\\Roaming\\Dropbox\\info.json': info })
  )
  assert.deepEqual(found.map((one) => one.name), ['Dropbox (personal)', 'Dropbox (business)'])
  assert.deepEqual(found.map((one) => one.path), ['C:\\Users\\sam\\Dropbox', 'C:\\Users\\sam\\Dropbox (Contoso)'])
  assert.deepEqual(found.map((one) => one.keptBy), ['Dropbox', 'Dropbox'])
})

test('a pointer file that is not readable JSON leaves Dropbox out instead of throwing', async () => {
  const found = await cloudFolders(
    { LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local', USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'C:\\Users\\sam\\Dropbox': {} }, { 'C:\\Users\\sam\\AppData\\Local\\Dropbox\\info.json': '{ this is not json' })
  )
  assert.deepEqual(found, [])
})

test('Google Drive is found on the drive it mounted, and iCloud Drive in the user own folder', async () => {
  const found = await cloudFolders(
    { USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'G:\\My Drive': {}, 'C:\\Users\\sam\\iCloudDrive': {} })
  )
  assert.deepEqual(found.map((one) => one.path), ['G:\\My Drive', 'C:\\Users\\sam\\iCloudDrive'])
  assert.deepEqual(found.map((one) => one.name), ['Google Drive', 'iCloud Drive'])
  assert.deepEqual(found.map((one) => one.keptBy), ['Google Drive for desktop', 'iCloud'])
})

test('the same folder reached two ways is listed once', async () => {
  const found = await cloudFolders(
    { OneDrive: 'C:\\Users\\sam\\OneDrive', OneDriveConsumer: 'C:\\Users\\sam\\OneDrive\\', USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'C:\\Users\\sam\\OneDrive': {}, 'C:\\Users\\sam\\OneDrive\\': {} })
  )
  assert.equal(found.length, 1)
})

test('a folder Orbis cannot write into is listed saying so, and refused as a destination with what to check', async () => {
  const found = await cloudFolders(
    { OneDrive: 'C:\\Users\\sam\\OneDrive', USERPROFILE: 'C:\\Users\\sam' },
    pretendComputer({ 'C:\\Users\\sam\\OneDrive': { writable: false } })
  )
  assert.deepEqual(found.map((one) => one.writable), [false])
  const refused = cloudFolderAt(found, 'C:\\Users\\sam\\OneDrive')
  assert.ok(isSharingError(refused))
  assert.match(refused.message, /cannot write into OneDrive/)
  assert.match(refused.message, /OneDrive is running/)
})

test('a destination that is not one of the folders that were found is refused, so no path a caller invents is written to', () => {
  const refused = cloudFolderAt([], 'C:\\Windows\\System32')
  assert.ok(isSharingError(refused))
  assert.match(refused.message, /not one of the cloud folders Orbis found/)
})

test('a destination that is one of them comes back, by the path however it was spelled', async () => {
  const found = await cloudFolders({ OneDrive: 'C:\\Users\\sam\\OneDrive', USERPROFILE: 'C:\\Users\\sam' }, pretendComputer({ 'C:\\Users\\sam\\OneDrive': {} }))
  const chosen = cloudFolderAt(found, 'c:\\users\\sam\\onedrive\\')
  assert.ok(!isSharingError(chosen))
  assert.equal(chosen.path, 'C:\\Users\\sam\\OneDrive')
})

test('the words after saving into a cloud folder say the cloud program uploads it and Orbis did not', () => {
  const note = cloudSaveNote({ id: 'onedrive', name: 'OneDrive', path: 'C:\\Users\\sam\\OneDrive', writable: true, keptBy: 'OneDrive' }, 'Energy.xlsx')
  assert.match(note, /"Energy\.xlsx" was saved into OneDrive on this computer/)
  assert.match(note, /uploads what appears in that folder/)
  assert.match(note, /Orbis did not upload it, has no account there/)
})
