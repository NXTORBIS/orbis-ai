import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  PACKAGE_ASSUMPTIONS,
  PACKAGE_FORMAT,
  PACKAGE_FORMAT_VERSION,
  PACKAGE_LIMITS,
  checkEntryPath,
  checksumOf,
  describePackage,
  findSecrets,
  isPackageError,
  packForExport,
  readPackage,
  type PackageEntry
} from './packaging.ts'
import { MANIFEST_SCHEMA_VERSION } from './manifest.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isPackageError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

const manifest = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  pageId: 'page_0123456789abcdef0123456789ab',
  slug: 'unit-converter',
  title: 'Unit Converter',
  description: 'Converts between units of measurement, carefully, and says when two units are not comparable.',
  version: '1.0.0',
  kind: 'converter',
  categories: ['science.measurement'],
  tags: ['units'],
  icon: 'ruler',
  owner: 'imported',
  runtimeAtLeast: '1.0.0',
  capabilities: ['computation.units'],
  capabilityReasons: {},
  dependencies: [],
  search: { summary: 'Convert between units of measurement.', keywords: ['convert'], intents: ['convert'], aliases: [] },
  offline: true,
  limitations: [],
  languages: ['en'],
  ...over
})

const entries = (...paths: string[]): PackageEntry[] =>
  paths.map((path) => ({ path, content: `contents of ${path}` }))

const exported = (over: Record<string, unknown> = {}, files = entries('index.html', 'app.js')): Record<string, unknown> => {
  const result = ok(
    packForExport({
      manifest: manifest(over) as never,
      entries: files,
      packedAt: 1000,
      packedBy: 'Orbis 1.0'
    })
  )
  return JSON.parse(JSON.stringify(result.package)) as Record<string, unknown>
}

describe('paths inside a package', () => {
  it('accepts an ordinary path', () => {
    assert.equal(checkEntryPath('index.html'), null)
    assert.equal(checkEntryPath('assets/icons/logo.svg'), null)
  })

  it('refuses a climb out of the folder', () => {
    assert.ok(checkEntryPath('../evil.js') !== null)
    assert.ok(checkEntryPath('assets/../../evil.js') !== null)
    assert.ok(checkEntryPath('a/b/../../../evil.js') !== null)
  })

  it('refuses a percent-encoded climb, which a text search for .. would miss', () => {
    assert.ok(checkEntryPath('%2e%2e/evil.js') !== null)
    assert.ok(checkEntryPath('%2E%2E%2Fevil.js') !== null)
  })

  it('refuses a backslash, which is a separator on Windows', () => {
    assert.ok(checkEntryPath('..\\evil.js') !== null)
    assert.ok(checkEntryPath('a\\b.js') !== null)
  })

  it('refuses an absolute path or one naming a drive', () => {
    assert.ok(checkEntryPath('/etc/passwd') !== null)
    assert.ok(checkEntryPath('C:/Windows/System32/evil.dll') !== null)
  })

  it('refuses a null byte', () => {
    assert.ok(checkEntryPath('index.html\0.js') !== null)
  })

  it('refuses a name ending in a dot or a space, which Windows quietly strips', () => {
    // `evil.exe.` becomes `evil.exe` after being written, so a check on the written name would have passed.
    assert.ok(checkEntryPath('evil.exe.') !== null)
    assert.ok(checkEntryPath('evil.exe ') !== null)
  })

  it('refuses a name reserved by the operating system', () => {
    for (const name of ['con', 'CON.txt', 'nul', 'com1', 'LPT9.js', 'aux']) {
      assert.ok(checkEntryPath(name) !== null, `"${name}" was accepted`)
    }
  })

  it('refuses a character that cannot be in a file name', () => {
    for (const path of ['a<b.js', 'a>b.js', 'a:b.js', 'a"b.js', 'a|b.js', 'a?b.js', 'a*b.js']) {
      assert.ok(checkEntryPath(path) !== null, `"${path}" was accepted`)
    }
  })

  it('refuses an empty segment and a path that is too deep', () => {
    assert.ok(checkEntryPath('a//b.js') !== null)
    assert.ok(checkEntryPath(`${'a/'.repeat(PACKAGE_LIMITS.depth + 1)}b.js`) !== null)
  })

  it('refuses a path longer than allowed, and an empty one', () => {
    assert.ok(checkEntryPath('x'.repeat(PACKAGE_LIMITS.pathLength + 1)) !== null)
    assert.ok(checkEntryPath('') !== null)
  })

  it('names the entry that was the problem', () => {
    const problem = checkEntryPath('../evil.js')
    assert.equal(problem?.entry, '../evil.js')
  })
})

describe('finding secrets', () => {
  const scan = (content: string): ReturnType<typeof findSecrets> => findSecrets([{ path: 'state.json', content }])

  it('sees a credential written as JSON, which is the form saved state is usually in', () => {
    // The key's own closing quote sits between the name and the colon, and an earlier version of this scanner could
    // not get past it -- so it read nothing in the one format that matters most.
    assert.equal(scan('{"api_key": "sk-abcdefghijklmnop1234"}').length, 1)
    assert.equal(scan('{"password": "hunter2000"}').length, 1)
    assert.equal(scan('{ "authorization" : "Bearer abcdefghijklmnopqrstuvwxyz" }').length, 1)
  })

  it('spots the common shapes', () => {
    assert.equal(scan('api_key = "sk-abcdefghijklmnop1234"').length, 1)
    assert.equal(scan('Authorization: Bearer abcdefghijklmnopqrstuvwxyz').length, 1)
    assert.equal(scan('password: "hunter2000"').length, 1)
    assert.equal(scan('-----BEGIN RSA PRIVATE KEY-----').length, 1)
    assert.equal(scan('AKIAIOSFODNN7EXAMPLE').length, 1)
    assert.equal(scan('ghp_abcdefghijklmnopqrstuvwxyz123456').length, 1)
    assert.equal(scan('xoxb-1234567890-abcdefghij').length, 1)
    assert.equal(scan('postgres://user:secretpassword@host/db').length, 1)
  })

  it('spots a JSON web token', () => {
    assert.equal(scan('token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmnop').length, 1)
  })

  it('never repeats the value it found, only where it was', () => {
    const findings = scan('api_key = "sk-do-not-copy-this-anywhere"')
    assert.equal(findings[0].entry, 'state.json')
    assert.equal(findings[0].line, 1)
    assert.match(findings[0].looksLike, /API key/)
    assert.ok(!JSON.stringify(findings).includes('do-not-copy-this'), 'a finding must not carry the secret')
  })

  it('reports the line it was on', () => {
    assert.equal(scan('fine\nalso fine\napi_key = "abcdefghijklmnop1234"').length, 1)
    assert.equal(scan('fine\nalso fine\napi_key = "abcdefghijklmnop1234"')[0].line, 3)
  })

  it('counts one finding per line rather than one per pattern', () => {
    assert.equal(scan('api_key = "abcdefghijklmnop1234" password: "hunter2000"').length, 1)
  })

  it('leaves ordinary content alone', () => {
    assert.equal(scan('{"temperature": 21.5, "unit": "degC"}').length, 0)
    assert.equal(scan('// set your api_key in settings').length, 0)
    assert.equal(scan('password: ""').length, 0)
  })
})

describe('checksums', () => {
  it('is the same for the same contents', () => {
    assert.equal(checksumOf(entries('a.js', 'b.js')), checksumOf(entries('a.js', 'b.js')))
  })

  it('does not depend on the order entries are given in', () => {
    assert.equal(checksumOf(entries('a.js', 'b.js')), checksumOf(entries('b.js', 'a.js')))
  })

  it('changes when the contents change', () => {
    const a = [{ path: 'a.js', content: 'one' }]
    const b = [{ path: 'a.js', content: 'two' }]
    assert.notEqual(checksumOf(a), checksumOf(b))
  })

  it('changes when a path changes', () => {
    assert.notEqual(checksumOf([{ path: 'a.js', content: 'x' }]), checksumOf([{ path: 'b.js', content: 'x' }]))
  })

  it('cannot be fooled by moving content between entries', () => {
    // Without a separator between the path and the contents these two would hash identically.
    const a = [{ path: 'ab', content: 'cd' }]
    const b = [{ path: 'a', content: 'bcd' }]
    assert.notEqual(checksumOf(a), checksumOf(b))
  })

  it('is a fixed-width hexadecimal string', () => {
    assert.match(checksumOf(entries('a.js')), /^[0-9a-f]{16}$/)
  })
})

describe('exporting', () => {
  it('packs a Page with its manifest and files', () => {
    const result = ok(packForExport({ manifest: manifest() as never, entries: entries('index.html'), packedAt: 1000, packedBy: 'Orbis 1.0' }))
    assert.equal(result.package.manifest.format, PACKAGE_FORMAT)
    assert.equal(result.package.manifest.formatVersion, PACKAGE_FORMAT_VERSION)
    assert.equal(result.package.entries.length, 1)
    assert.equal(result.package.manifest.packedAt, 1000)
  })

  it('refuses to export something that looks like a credential', () => {
    const refused = packForExport({
      manifest: manifest() as never,
      entries: [{ path: 'state.json', content: '{"api_key": "sk-abcdefghijklmnop1234"}' }],
      packedAt: 1000,
      packedBy: 'Orbis 1.0'
    })
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'contains-secrets')
    assert.match(refused.message, /Nothing was exported/)
  })

  it('names where the credential was without quoting it', () => {
    const refused = packForExport({
      manifest: manifest() as never,
      entries: [{ path: 'state.json', content: '{"api_key": "sk-do-not-leak-this-value"}' }],
      packedAt: 1000,
      packedBy: 'Orbis 1.0'
    })
    assert.ok(isPackageError(refused))
    assert.match(refused.message, /state\.json line 1/)
    assert.ok(!refused.message.includes('do-not-leak-this'), 'the refusal must not carry the secret')
  })

  it('exports anyway when the person has chosen to, and says what they accepted', () => {
    const result = ok(
      packForExport({
        manifest: manifest() as never,
        entries: [{ path: 'state.json', content: '{"api_key": "sk-abcdefghijklmnop1234"}' }],
        packedAt: 1000,
        packedBy: 'Orbis 1.0',
        acceptSecrets: true
      })
    )
    assert.equal(result.secrets.length, 1)
    assert.ok(result.notes.some((one) => /Anybody you send this to can read them/.test(one)))
  })

  it('says outright that the checksum is not a signature', () => {
    const result = ok(packForExport({ manifest: manifest() as never, entries: entries('a.js'), packedAt: 1000, packedBy: 'Orbis 1.0' }))
    assert.ok(result.notes.some((one) => /not a signature/.test(one)))
  })

  it('says a package carries no permission', () => {
    const result = ok(packForExport({ manifest: manifest() as never, entries: entries('a.js'), packedAt: 1000, packedBy: 'Orbis 1.0' }))
    assert.ok(result.notes.some((one) => /does not carry any permission/.test(one)))
  })

  it('refuses an unsafe path on the way out, not only on the way in', () => {
    const refused = packForExport({ manifest: manifest() as never, entries: entries('../evil.js'), packedAt: 1000, packedBy: 'Orbis 1.0' })
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'unsafe-path')
  })

  it('refuses two entries differing only in case, which overwrite each other on most computers', () => {
    const refused = packForExport({
      manifest: manifest() as never,
      entries: entries('App.js', 'app.js'),
      packedAt: 1000,
      packedBy: 'Orbis 1.0'
    })
    assert.ok(isPackageError(refused))
    assert.match(refused.message, /silently replace/)
  })

  it('refuses more files than allowed', () => {
    const many = Array.from({ length: PACKAGE_LIMITS.entries + 1 }, (_, i) => ({ path: `f${i}.js`, content: 'x' }))
    const refused = packForExport({ manifest: manifest() as never, entries: many, packedAt: 1000, packedBy: 'Orbis 1.0' })
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'too-many')
  })

  it('refuses a file larger than allowed', () => {
    const refused = packForExport({
      manifest: manifest() as never,
      entries: [{ path: 'big.js', content: 'x'.repeat(PACKAGE_LIMITS.entryBytes + 1) }],
      packedAt: 1000,
      packedBy: 'Orbis 1.0'
    })
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'too-large')
  })
})

describe('importing', () => {
  it('reads back what was exported', () => {
    const result = ok(readPackage(exported()))
    assert.equal(result.manifest.title, 'Unit Converter')
    assert.equal(result.entries.length, 2)
    assert.equal(result.intact, true)
  })

  it('round trips content unchanged', () => {
    const tricky = [
      { path: 'a.json', content: '{"quote":"\\"","newline":"line1\\nline2","tab":"\\t","unicode":"\u00e9\u4e2d\u{1F600}"}' }
    ]
    const result = ok(readPackage(exported({}, tricky)))
    assert.equal(result.entries[0].content, tricky[0].content)
  })

  it('never grants anything: capabilities come back as requests', () => {
    const result = ok(readPackage(exported()))
    assert.equal(result.requested.length, 1)
    assert.equal(result.requested[0].id, 'computation.units')
    assert.ok(result.beforeYouDecide.some((one) => /Asking is not being given it/.test(one)))
  })

  it('says outright that a matching checksum is not proof of who made it', () => {
    const result = ok(readPackage(exported()))
    assert.ok(result.beforeYouDecide.some((one) => /Orbis does not sign packages/.test(one)))
  })

  it('says a Page from a file has not been read by anybody', () => {
    const result = ok(readPackage(exported()))
    assert.ok(result.beforeYouDecide.some((one) => /Nobody at Orbis has looked at it/.test(one)))
  })

  it('notices a package whose contents no longer match its checksum', () => {
    const tampered = exported() as { entries: { path: string; content: string }[] }
    tampered.entries[0].content = 'something else entirely'
    const result = ok(readPackage(tampered))
    assert.equal(result.intact, false)
    assert.ok(result.warnings.some((one) => /damaged or was changed/.test(one)))
    assert.ok(result.beforeYouDecide.some((one) => /no way to tell which/.test(one)))
  })

  it('reports a capability this Orbis does not have, rather than ignoring it', () => {
    const result = ok(readPackage(exported({ capabilities: ['computation.units', 'telepathy.read'] })))
    assert.deepEqual([...result.unknownCapabilities], ['telepathy.read'])
    assert.ok(result.warnings.some((one) => /does not have/.test(one)))
    // The known one still came through, so one unrecognised capability does not make the Page unopenable.
    assert.deepEqual(result.requested.map((one) => one.id), ['computation.units'])
    assert.ok(result.warnings.some((one) => /written for a newer Orbis/.test(one)))
  })

  it('cannot be walked up a prototype chain to a capability that is not one', () => {
    const result = ok(readPackage(exported({ capabilities: ['constructor', 'toString'] })))
    assert.equal(result.requested.length, 0)
    assert.equal(result.unknownCapabilities.length, 2)
  })

  it('calls out a Page asking for nothing as the safest kind', () => {
    const result = ok(readPackage(exported({ capabilities: [] })))
    assert.ok(result.beforeYouDecide.some((one) => /safest kind of Page/.test(one)))
  })

  it('refuses an unsafe path before anything could be written', () => {
    const bad = exported() as { entries: { path: string; content: string }[] }
    bad.entries.push({ path: '../../autostart/run.bat', content: 'harm' })
    const refused = readPackage(bad)
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'unsafe-path')
  })

  it('refuses a file that is not an Orbis package at all', () => {
    assert.ok(isPackageError(readPackage({ hello: 'world' })))
    assert.ok(isPackageError(readPackage('a string')))
    assert.ok(isPackageError(readPackage(null)))
    assert.ok(isPackageError(readPackage([1, 2, 3])))
  })

  it('refuses a package from a newer Orbis, and says to update', () => {
    const future = exported() as { manifest: Record<string, unknown> }
    future.manifest.formatVersion = PACKAGE_FORMAT_VERSION + 1
    const refused = readPackage(future)
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'unsupported-version')
    assert.match(refused.message, /Update Orbis/)
  })

  it('refuses a package whose Page manifest is not valid', () => {
    const broken = exported() as { manifest: Record<string, unknown> }
    broken.manifest.page = { slug: 'x' }
    const refused = readPackage(broken)
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'malformed')
  })

  it('refuses a decompression bomb by its expansion ratio', () => {
    const big = exported({}, [{ path: 'big.txt', content: 'x'.repeat(1_000_000) }])
    const refused = readPackage(big, 1000)
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'too-large')
    assert.match(refused.message, /times larger/)
  })

  it('accepts a normally-compressed package', () => {
    const normal = exported({}, [{ path: 'a.txt', content: 'x'.repeat(10_000) }])
    assert.ok(!isPackageError(readPackage(normal, 5000)))
  })

  it('refuses more entries than allowed', () => {
    const many = { manifest: { format: PACKAGE_FORMAT, formatVersion: 1, page: manifest(), checksum: 'x', entries: [] }, entries: Array.from({ length: PACKAGE_LIMITS.entries + 1 }, (_, i) => ({ path: `f${i}.js`, content: 'x' })) }
    const refused = readPackage(many)
    assert.ok(isPackageError(refused))
    assert.equal(refused.error, 'too-many')
  })

  it('refuses an entry that is not a file', () => {
    const bad = exported() as { entries: unknown[] }
    bad.entries.push('not a file')
    assert.ok(isPackageError(readPackage(bad)))
  })

  it('refuses the same path twice', () => {
    const bad = exported() as { entries: { path: string; content: string }[] }
    bad.entries.push({ path: 'index.html', content: 'different' })
    const refused = readPackage(bad)
    assert.ok(isPackageError(refused))
    assert.match(refused.message, /appears twice/)
  })

  it('describes a package in one line', () => {
    const result = ok(readPackage(exported()))
    assert.match(describePackage(result), /Unit Converter 1\.0\.0/)
    assert.match(describePackage(result), /2 files/)
  })
})

describe('assumptions', () => {
  it('states that a package is somebody else\u2019s program', () => {
    assert.ok(PACKAGE_ASSUMPTIONS.some((one) => /somebody else/.test(one)))
  })

  it('states that the checksum is not a signature', () => {
    assert.ok(PACKAGE_ASSUMPTIONS.some((one) => /not a signature/.test(one)))
  })

  it('states that importing grants nothing', () => {
    assert.ok(PACKAGE_ASSUMPTIONS.some((one) => /Importing grants nothing/.test(one)))
  })

  it('states the limit of the secret scan rather than overselling it', () => {
    assert.ok(PACKAGE_ASSUMPTIONS.some((one) => /would not catch one somebody set out to hide/.test(one)))
  })
})
