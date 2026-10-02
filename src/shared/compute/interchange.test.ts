import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  FORMATS,
  INTERCHANGE_ASSUMPTIONS,
  INTERCHANGE_LIMITS,
  LOCALES,
  buildLineage,
  checkArchive,
  checkMapping,
  decodeText,
  detectFormat,
  exportTable,
  findDuplicates,
  flattenJson,
  formatById,
  hashOf,
  isInterchangeError,
  lossFor,
  readDateIn,
  readJson,
  readNumberIn,
  readXml,
  stageImport,
  suggestMapping,
  verifyExport,
  xmlToRows,
  type ArchiveEntry,
  type FieldTarget,
  type FileReference
} from './interchange.ts'
import { isDataError, parseDelimited, type Table } from './data.ts'

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const source = (name: string, bytes: number): Omit<FileReference, 'format' | 'hash'> => ({
  id: name,
  source: 'local',
  name,
  bytes,
  modifiedAt: '',
  provenance: ''
})

const tableOf = (text: string): Table => {
  const parsed = parseDelimited(text)
  if (isDataError(parsed)) throw new Error(parsed.message)
  return parsed.table
}

describe('format detection', () => {
  test('contents and name agreeing gives certainty', () => {
    const evidence = detectFormat('data.csv', 'text/csv', 'a,b\n1,2\n3,4')
    assert.equal(evidence.chosen, 'csv')
    assert.equal(evidence.confidence, 'certain')
    assert.equal(evidence.conflict, null)
  })

  test('a name that disagrees with the contents is reported as a conflict, not resolved silently', () => {
    const evidence = detectFormat('data.csv', '', '{"a": 1}')
    assert.equal(evidence.byExtension, 'csv')
    assert.equal(evidence.byContent, 'json')
    assert.equal(evidence.chosen, 'json')
    assert.ok(evidence.conflict)
    assert.match(evidence.conflict ?? '', /went by the contents/)
  })

  test('JSON, XML, HTML and NDJSON are each recognised from their first characters', () => {
    assert.equal(detectFormat('x', '', '[1,2,3]').byContent, 'json')
    assert.equal(detectFormat('x', '', '<?xml version="1.0"?><a/>').byContent, 'xml')
    assert.equal(detectFormat('x', '', '<!DOCTYPE html><html>').byContent, 'html')
    assert.equal(detectFormat('x', '', '{"a":1}\n{"a":2}\n{"a":3}').byContent, 'ndjson')
  })

  test('a null byte marks a file as binary, which Orbis does not read', () => {
    const evidence = detectFormat('x.csv', '', 'a,b\n\u00001,2')
    assert.equal(evidence.byContent, 'binary')
  })

  test('delimited text needs a consistent field count, so prose with commas stays text', () => {
    const prose = detectFormat('x', '', 'Hello, world. This is prose.\nAnd another line without.')
    assert.notEqual(prose.byContent, 'csv')
    const real = detectFormat('x', '', 'a,b,c\n1,2,3\n4,5,6')
    assert.equal(real.byContent, 'csv')
  })

  test('an unrecognisable file with no name and no type is unknown rather than guessed', () => {
    const evidence = detectFormat('', '', 'just one line of nothing in particular')
    assert.equal(evidence.confidence, 'unknown')
    assert.equal(evidence.chosen, 'text')
  })

  test('every reason the detector gives is recorded', () => {
    const evidence = detectFormat('a.json', 'application/json', '{"a":1}')
    assert.equal(evidence.reasons.length, 3)
  })
})

describe('format capabilities', () => {
  test('what each format can carry is stated in one place', () => {
    assert.equal(FORMATS.csv.carries.units, false)
    assert.equal(FORMATS.json.carries.units, true)
    assert.equal(FORMATS.json.carries.hierarchy, true)
    assert.equal(FORMATS.csv.streaming, true)
    assert.equal(FORMATS.json.streaming, false)
  })

  test('a format Orbis reads but does not write says so, and the other way round', () => {
    assert.equal(FORMATS.xml.canImport, true)
    assert.equal(FORMATS.xml.canExport, false)
    // HTML goes both ways now that there is a writer; PDF is written by printing and never read back yet.
    assert.equal(FORMATS.html.canExport, true)
    assert.equal(FORMATS.pdf.canImport, false)
    assert.equal(FORMATS.pdf.canExport, true)
  })

  test('an unknown format id is null rather than a prototype lookup', () => {
    assert.equal(formatById('constructor'), null)
    assert.equal(formatById('nope'), null)
    assert.equal(formatById('csv')?.id, 'csv')
  })
})

describe('decoding', () => {
  test('plain UTF-8 decodes with nothing replaced', () => {
    const decoded = decodeText(bytesOf('hello \u00e9\u00e8 \u4e16\u754c'))
    assert.ok(!isInterchangeError(decoded))
    assert.equal(decoded.encoding, 'utf-8')
    assert.equal(decoded.replacements, 0)
    assert.equal(decoded.text, 'hello \u00e9\u00e8 \u4e16\u754c')
  })

  test('a UTF-8 byte-order mark is removed and reported', () => {
    const decoded = decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))
    assert.ok(!isInterchangeError(decoded))
    assert.equal(decoded.text, 'a')
    assert.equal(decoded.hadBom, true)
    assert.ok(decoded.notes.some((one) => /byte-order mark/.test(one)))
  })

  test('UTF-16 is recognised from its byte-order mark', () => {
    const little = decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]))
    assert.ok(!isInterchangeError(little))
    assert.equal(little.encoding, 'utf-16le')
    assert.equal(little.text, 'ab')

    const big = decodeText(new Uint8Array([0xfe, 0xff, 0x00, 0x61, 0x00, 0x62]))
    assert.ok(!isInterchangeError(big))
    assert.equal(big.encoding, 'utf-16be')
    assert.equal(big.text, 'ab')
  })

  test('bytes that are not valid UTF-8 fall back to Latin-1, and the choice is reported', () => {
    // 0xe9 alone is e-acute in Latin-1 and an incomplete sequence in UTF-8.
    const decoded = decodeText(new Uint8Array([0x61, 0xe9, 0x62]))
    assert.ok(!isInterchangeError(decoded))
    assert.equal(decoded.encoding, 'latin-1')
    assert.equal(decoded.text, 'a\u00e9b')
    assert.ok(decoded.notes.some((one) => /not valid UTF-8/.test(one)))
  })

  test('an overlong encoding is treated as invalid, not as a second spelling of the character', () => {
    // 0xc0 0xaf is an overlong '/', historically used to slip past filters.
    const decoded = decodeText(new Uint8Array([0xc0, 0xaf]))
    assert.ok(!isInterchangeError(decoded))
    assert.equal(decoded.encoding, 'latin-1')
    assert.doesNotMatch(decoded.text, /^\/$/)
  })

  test('a file past the byte ceiling is refused with a recovery that says what to do', () => {
    const decoded = decodeText(new Uint8Array(INTERCHANGE_LIMITS.bytes + 1))
    assert.ok(isInterchangeError(decoded))
    assert.equal(decoded.error, 'RESOURCE_LIMIT')
    assert.equal(decoded.phase, 'decode')
    assert.match(decoded.recovery, /Split the file/)
  })
})

describe('locale-sensitive reading', () => {
  test('the same string is a different number under different conventions', () => {
    assert.equal(readNumberIn('1,234', LOCALES['en-IN']), 1234)
    assert.equal(readNumberIn('1,234', LOCALES['de-DE']), 1.234)
  })

  test('a grouping separator in the wrong place is refused rather than resolved', () => {
    // 1,23 is not a grouped number under a comma grouping; reading it as 123 would invent a digit.
    assert.equal(readNumberIn('1,23', LOCALES['en-IN']), null)
    assert.equal(readNumberIn('1,234,567', LOCALES['en-IN']), 1234567)
  })

  test('a decimal comma is read where the convention has one', () => {
    assert.equal(readNumberIn('3,14', LOCALES['de-DE']), 3.14)
    assert.equal(readNumberIn('3.14', LOCALES['en-US']), 3.14)
  })

  test('something that is not a number at all is null', () => {
    assert.equal(readNumberIn('abc', LOCALES.iso), null)
    assert.equal(readNumberIn('', LOCALES.iso), null)
  })

  test('an ISO date is unambiguous and says so', () => {
    const reading = readDateIn('2026-03-04', LOCALES['en-US'])
    assert.ok(reading)
    assert.equal(reading.as, 'iso')
    assert.equal(reading.ambiguous, false)
    assert.equal(new Date(reading.value).toISOString().slice(0, 10), '2026-03-04')
  })

  test('a slashed date is read under the convention and marked ambiguous when both halves could be a month', () => {
    const british = readDateIn('03/04/2026', LOCALES['en-GB'])
    const american = readDateIn('03/04/2026', LOCALES['en-US'])
    assert.ok(british && american)
    assert.equal(british.ambiguous, true)
    assert.notEqual(british.value, american.value)
    assert.equal(new Date(british.value).toISOString().slice(0, 10), '2026-04-03')
    assert.equal(new Date(american.value).toISOString().slice(0, 10), '2026-03-04')
    assert.match(british.describe, /could be a different date under another convention/)
  })

  test('a date whose day is above twelve is not ambiguous', () => {
    const reading = readDateIn('25/12/2026', LOCALES['en-GB'])
    assert.ok(reading)
    assert.equal(reading.ambiguous, false)
  })

  test('a day that does not exist in its month is refused', () => {
    assert.equal(readDateIn('31/02/2026', LOCALES['en-GB']), null)
  })

  test('a unix timestamp is read but marked ambiguous, because it is also just a number', () => {
    const reading = readDateIn('1767225600', LOCALES.iso)
    assert.ok(reading)
    assert.equal(reading.as, 'unix-seconds')
    assert.equal(reading.ambiguous, true)
  })
})

describe('JSON', () => {
  test('invalid JSON gives a message and a recovery pointing at the position', () => {
    const result = readJson('{"a": 1,}')
    assert.ok(isInterchangeError(result))
    assert.equal(result.error, 'PARSE_ERROR')
    assert.match(result.recovery, /trailing comma|editor/)
  })

  test('nodes and depth are measured', () => {
    const result = readJson('{"a": {"b": {"c": [1, 2]}}}')
    assert.ok(!isInterchangeError(result))
    assert.ok(result.maxDepth >= 4)
    assert.ok(result.nodes >= 6)
  })

  test('JSON nested past the depth ceiling is refused', () => {
    let deep = '1'
    for (let i = 0; i < INTERCHANGE_LIMITS.depth + 5; i++) deep = `[${deep}]`
    const result = readJson(deep)
    assert.ok(isInterchangeError(result))
    assert.equal(result.error, 'RESOURCE_LIMIT')
  })

  test('flattening is reported as irreversible', () => {
    const flattened = flattenJson([{ a: { b: 1 } }])
    assert.deepEqual(flattened.columns, ['a.b'])
    assert.equal(flattened.rows[0]['a.b'], '1')
    assert.ok(flattened.notes.some((one) => /cannot be undone/.test(one)))
  })

  test('deep structure beyond the flatten depth is kept as JSON text rather than expanded further', () => {
    const flattened = flattenJson([{ a: { b: { c: { d: 1 } } } }], { maxDepth: 2 })
    assert.equal(flattened.columns.length, 1)
    assert.match(flattened.rows[0][flattened.columns[0]], /"d":1/)
  })

  test('a key of __proto__ becomes a column, not a change to the row\u2019s prototype', () => {
    const flattened = flattenJson([JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}')])
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.ok(flattened.columns.some((one) => one.startsWith('__proto__')))
  })

  test('a single object becomes one row and says so', () => {
    const flattened = flattenJson({ a: 1 })
    assert.equal(flattened.rows.length, 1)
    assert.ok(flattened.notes.some((one) => /became one row/.test(one)))
  })
})

describe('XML', () => {
  test('a document type declaration is refused outright', () => {
    const result = readXml('<!DOCTYPE a [<!ENTITY x "y">]><a/>')
    assert.ok(isInterchangeError(result))
    assert.match(result.message, /expand without limit or that read a file/)
  })

  test('an entity declaration without a doctype is refused too', () => {
    assert.ok(isInterchangeError(readXml('<!ENTITY x "y"><a/>')))
  })

  test('elements, attributes and text are read', () => {
    const root = readXml('<rows><row id="1"><name>Asha</name></row><row id="2"><name>Bo</name></row></rows>')
    assert.ok(!isInterchangeError(root))
    assert.equal(root.name, 'rows')
    assert.equal(root.children.length, 2)
    assert.equal(root.children[0].attributes.id, '1')
    assert.equal(root.children[0].children[0].text, 'Asha')
  })

  test('mismatched tags are refused with both names', () => {
    const result = readXml('<a><b></a></b>')
    assert.ok(isInterchangeError(result))
    assert.match(result.message, /opens <b> and closes <\/a>/)
  })

  test('two root elements are refused', () => {
    assert.ok(isInterchangeError(readXml('<a/><b/>')))
  })

  test('an unclosed tag is refused, naming it', () => {
    const result = readXml('<a><b></b>')
    assert.ok(isInterchangeError(result))
    assert.match(result.message, /never closes <a>/)
  })

  test('entities in text and attributes are decoded', () => {
    const root = readXml('<a x="1 &amp; 2">3 &lt; 4</a>')
    assert.ok(!isInterchangeError(root))
    assert.equal(root.attributes.x, '1 & 2')
    assert.equal(root.text, '3 < 4')
  })

  test('repeated children become rows', () => {
    const root = readXml('<rows><row id="1"><name>Asha</name></row><row id="2"><name>Bo</name></row></rows>')
    assert.ok(!isInterchangeError(root))
    const converted = xmlToRows(root)
    assert.equal(converted.rows.length, 2)
    assert.ok(converted.columns.includes('@id'))
    assert.ok(converted.columns.includes('name'))
    assert.equal(converted.rows[0].name, 'Asha')
  })
})

describe('staged import', () => {
  test('CSV stages into a table with a preview', () => {
    const text = 'name,score\nAsha,94\nBo,88'
    const staged = stageImport(source('scores.csv', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(staged))
    assert.equal(staged.preview.rows, 2)
    assert.deepEqual(staged.preview.columns, ['name', 'score'])
    assert.equal(staged.preview.sampleRows.length, 2)
    assert.equal(staged.table?.rows.length, 2)
  })

  test('the preview says what the format cannot carry', () => {
    const text = 'a,b\n1,2'
    const staged = stageImport(source('x.csv', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(staged))
    assert.ok(staged.preview.notes.some((one) => /nowhere to put a unit/.test(one)))
  })

  test('a format conflict reaches the preview as an issue', () => {
    const text = '{"a": 1}'
    const staged = stageImport(source('data.csv', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(staged))
    assert.ok(staged.preview.issues.some((one) => one.kind === 'format-conflict'))
  })

  test('nothing is committed when the parse fails partway', () => {
    const staged = stageImport(source('x.json', 10), bytesOf('{"a": 1,}'))
    assert.ok(isInterchangeError(staged))
    assert.equal(staged.phase, 'parse')
  })

  test('HTML is staged with what was removed reported as an issue', () => {
    const text = '<p>kept</p><script>alert(1)</script>'
    const staged = stageImport(source('page.html', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(staged))
    assert.ok(staged.preview.issues.some((one) => one.kind === 'sanitised'))
    assert.ok(staged.document)
  })

  test('newline-delimited JSON reports which line failed', () => {
    // The format is given rather than detected: a file whose second line is not JSON does not *look* like NDJSON, and
    // detection says so. This is the path where somebody has confirmed the format themselves.
    const staged = stageImport(source('x.ndjson', 20), bytesOf('{"a":1}\nnot json\n'), { format: 'ndjson' })
    assert.ok(isInterchangeError(staged))
    assert.match(staged.message, /Line 2/)
  })

  test('valid newline-delimited JSON stages one row per line', () => {
    const text = '{"a":1}\n{"a":2}\n{"a":3}'
    const staged = stageImport(source('x.ndjson', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(staged))
    assert.equal(staged.preview.file.format, 'ndjson')
    assert.equal(staged.preview.rows, 3)
  })

  test('a binary file is refused rather than interpreted', () => {
    const staged = stageImport(source('x.bin', 4), new Uint8Array([0, 1, 2, 3]))
    assert.ok(isInterchangeError(staged))
    assert.equal(staged.error, 'UNSUPPORTED_FORMAT')
  })

  test('an explicit format overrides detection', () => {
    const text = 'a,b\n1,2'
    const staged = stageImport(source('x', text.length), bytesOf(text), { format: 'text' })
    assert.ok(!isInterchangeError(staged))
    assert.equal(staged.preview.file.format, 'text')
    assert.equal(staged.table, null)
  })

  test('a file gets a content hash, and the same bytes give the same hash', () => {
    const text = 'a,b\n1,2'
    const first = stageImport(source('x.csv', text.length), bytesOf(text))
    const second = stageImport(source('other.csv', text.length), bytesOf(text))
    assert.ok(!isInterchangeError(first) && !isInterchangeError(second))
    assert.equal(first.preview.file.hash, second.preview.file.hash)
    assert.notEqual(first.preview.file.hash, hashOf(bytesOf('different')))
  })

  test('duplicates are reported, never removed', () => {
    const files: FileReference[] = [
      { ...source('a', 1), format: 'csv', hash: 'same' },
      { ...source('b', 1), format: 'csv', hash: 'same' },
      { ...source('c', 1), format: 'csv', hash: 'other' }
    ]
    const duplicates = findDuplicates(files)
    assert.equal(duplicates.length, 1)
    assert.deepEqual(duplicates[0].files, ['a', 'b'])
  })
})

describe('mapping', () => {
  const fields: FieldTarget[] = [
    { id: 'time', name: 'Time', type: 'date', unit: '', required: true, describe: '' },
    { id: 'temperature', name: 'Temperature', type: 'quantity', unit: 'K', required: true, describe: '' },
    { id: 'note', name: 'Note', type: 'text', unit: '', required: false, describe: '' }
  ]

  test('an exact name match is certain', () => {
    const suggestions = suggestMapping(['Time', 'Temperature'], fields)
    assert.equal(suggestions[0].confidence, 'certain')
    assert.equal(suggestions[0].field, 'time')
  })

  test('a partial name match is likely rather than certain', () => {
    const suggestions = suggestMapping(['temperature_c'], fields)
    assert.equal(suggestions[0].field, 'temperature')
    assert.equal(suggestions[0].confidence, 'likely')
  })

  test('a column matching nothing is left unmapped rather than matched on type', () => {
    const suggestions = suggestMapping(['xyz123'], fields)
    assert.equal(suggestions[0].field, null)
    assert.match(suggestions[0].why, /would be a guess/)
  })

  test('a missing required field makes the mapping unusable, and it is named', () => {
    const check = checkMapping(['Time'], fields, { columns: { Time: 'time' }, locale: 'iso' })
    assert.equal(check.ok, false)
    assert.deepEqual(check.missingRequired, ['Temperature'])
  })

  test('dropped columns are named before the import, not discovered after', () => {
    const check = checkMapping(['Time', 'Temperature', 'spare'], fields, {
      columns: { Time: 'time', Temperature: 'temperature' },
      locale: 'iso'
    })
    assert.deepEqual(check.unmapped, ['spare'])
    assert.ok(check.notes.some((one) => /will be dropped/.test(one)))
  })

  test('two columns mapped to one field is a conflict', () => {
    const check = checkMapping(['Time', 'Temperature', 'temp2'], fields, {
      columns: { Time: 'time', Temperature: 'temperature', temp2: 'temperature' },
      locale: 'iso'
    })
    assert.equal(check.ok, false)
    assert.equal(check.duplicates.length, 1)
  })

  test('a column named constructor is a column, not a lookup on Object.prototype', () => {
    const check = checkMapping(['constructor'], fields, { columns: {}, locale: 'iso' })
    assert.deepEqual(check.unmapped, ['constructor'])
  })
})

describe('lineage', () => {
  test('steps are ordered so each one comes after what it used', () => {
    const lineage = buildLineage([
      { id: 'c', operation: 'analyse', from: ['b'], parameters: {}, engineVersion: '1', describe: '' },
      { id: 'a', operation: 'import', from: [], parameters: {}, engineVersion: '1', describe: '' },
      { id: 'b', operation: 'clean', from: ['a'], parameters: {}, engineVersion: '1', describe: '' }
    ])
    assert.ok(!isInterchangeError(lineage))
    assert.deepEqual(lineage.order, ['a', 'b', 'c'])
  })

  test('a circular lineage is refused rather than walked', () => {
    const lineage = buildLineage([
      { id: 'a', operation: 'x', from: ['b'], parameters: {}, engineVersion: '1', describe: '' },
      { id: 'b', operation: 'y', from: ['a'], parameters: {}, engineVersion: '1', describe: '' }
    ])
    assert.ok(isInterchangeError(lineage))
    assert.match(lineage.message, /depends on itself/)
  })

  test('a step referring to something that is not there is refused', () => {
    const lineage = buildLineage([{ id: 'a', operation: 'x', from: ['missing'], parameters: {}, engineVersion: '1', describe: '' }])
    assert.ok(isInterchangeError(lineage))
    assert.match(lineage.message, /not in the lineage/)
  })
})

describe('export', () => {
  const table = (): Table => tableOf('name,score\nAsha,94\nBo,88')

  test('CSV writes and reads back to the same shape', () => {
    const exported = exportTable(table(), { format: 'csv' })
    assert.ok(!isInterchangeError(exported))
    const verified = verifyExport(table(), exported)
    assert.equal(verified.ok, true)
    assert.deepEqual(verified.reimported, { rows: 2, columns: 2 })
  })

  test('every check a verification ran is named, so "verified" means something', () => {
    const exported = exportTable(table(), { format: 'csv' })
    assert.ok(!isInterchangeError(exported))
    const verified = verifyExport(table(), exported)
    assert.deepEqual(verified.checks.map((one) => one.what).sort(), ['checksum', 'round trip', 'size'])
  })

  test('a corrupted export fails its checksum check', () => {
    const exported = exportTable(table(), { format: 'csv' })
    assert.ok(!isInterchangeError(exported))
    const verified = verifyExport(table(), { ...exported, text: `${exported.text}\nextra,row` })
    assert.equal(verified.ok, false)
    assert.equal(verified.checks.find((one) => one.what === 'checksum')?.passed, false)
  })

  test('JSON with metadata keeps the column types and units that CSV cannot', () => {
    const exported = exportTable(table(), { format: 'json', includeMetadata: true })
    assert.ok(!isInterchangeError(exported))
    const parsed = JSON.parse(exported.text)
    assert.ok(Array.isArray(parsed.columns))
    assert.equal(parsed.columns[0].name, 'name')
    assert.equal(parsed.rows.length, 2)
  })

  test('a format Orbis does not write is refused, not attempted', () => {
    const exported = exportTable(table(), { format: 'xml' })
    assert.ok(isInterchangeError(exported))
    assert.equal(exported.error, 'UNSUPPORTED_FORMAT')
    assert.match(exported.recovery, /CSV, JSON, Markdown or plain text/)
  })

  test('what a format will lose is named before the export, by name', () => {
    const loss = lossFor('csv', { units: true, hierarchy: true, provenance: true })
    assert.ok(!isInterchangeError(loss))
    assert.equal(loss.lossy, true)
    const what = loss.losses.map((one) => one.what)
    assert.ok(what.includes('Units'))
    assert.ok(what.includes('Nested structure'))
    assert.ok(what.includes('Provenance'))
  })

  test('a format that can carry everything asked of it reports no loss', () => {
    const loss = lossFor('json', { units: true, hierarchy: true, provenance: true })
    assert.ok(!isInterchangeError(loss))
    assert.equal(loss.lossy, false)
  })

  test('Markdown folds units into the headings and says they will not come back', () => {
    const parsed = parseDelimited('length\n1\n2')
    assert.ok(!isDataError(parsed))
    // Retyping the column to a quantity is what gives it a unit to lose.
    const withUnit: Table = {
      ...parsed.table,
      columns: parsed.table.columns.map((one) => ({ ...one, unit: { display: 'm' } as never }))
    }
    const exported = exportTable(withUnit, { format: 'markdown' })
    assert.ok(!isInterchangeError(exported))
    assert.match(exported.text, /length \(m\)/)
    assert.ok(exported.notes.some((one) => /will not come back as units/.test(one)))
  })

  test('a type that comes back differently is a difference, not a failed check', () => {
    const numeric = tableOf('n\n1\n2\n3')
    const exported = exportTable(numeric, { format: 'csv' })
    assert.ok(!isInterchangeError(exported))
    const verified = verifyExport(numeric, exported)
    // The shape survives; whether the type does is a property of CSV, and is reported as such.
    assert.equal(verified.checks.find((one) => one.what === 'round trip')?.passed, true)
  })
})

describe('archives', () => {
  const entry = (path: string, bytes = 100, compressedBytes = 50): ArchiveEntry => ({ path, bytes, compressedBytes })

  test('an ordinary archive is safe', () => {
    const check = checkArchive([entry('a.csv'), entry('folder/b.csv')])
    assert.equal(check.safe, true)
    assert.ok(check.notes.some((one) => /stays inside the folder/.test(one)))
  })

  test('a path that climbs out is caught', () => {
    const check = checkArchive([entry('../../etc/passwd')])
    assert.equal(check.safe, false)
    assert.equal(check.problems[0].kind, 'path-traversal')
  })

  test('a Windows-style separator does not hide a climbing path', () => {
    const check = checkArchive([entry('..\\..\\windows\\system32\\x')])
    assert.equal(check.safe, false)
    assert.ok(check.problems.some((one) => one.kind === 'path-traversal'))
  })

  test('an absolute path is caught, on either platform\u2019s spelling', () => {
    assert.ok(checkArchive([entry('/etc/passwd')]).problems.some((one) => one.kind === 'absolute-path'))
    assert.ok(checkArchive([entry('C:/Windows/x')]).problems.some((one) => one.kind === 'absolute-path'))
  })

  test('a null byte in a path is caught', () => {
    assert.ok(checkArchive([entry('safe.csv\u0000.exe')]).problems.some((one) => one.kind === 'null-byte'))
  })

  test('an entry that expands enormously is caught, which no path check would find', () => {
    const check = checkArchive([entry('bomb.txt', 1_000_000_000, 1000)])
    assert.equal(check.safe, false)
    assert.ok(check.problems.some((one) => one.kind === 'expansion'))
  })

  test('entries that each look reasonable but add up to a bomb are caught by the total', () => {
    // Each entry is 100 times its compressed size, under the per-entry limit; together they still expand 100-fold.
    const entries = Array.from({ length: 50 }, (_, i) => entry(`f${i}.txt`, 100_000_000, 1_000_000))
    const check = checkArchive(entries)
    assert.equal(check.safe, false)
    assert.ok(check.problems.some((one) => one.kind === 'too-large' || one.kind === 'expansion'))
  })

  test('too many entries is caught before anything is extracted', () => {
    const entries = Array.from({ length: INTERCHANGE_LIMITS.archiveEntries + 1 }, (_, i) => entry(`f${i}`))
    assert.ok(checkArchive(entries).problems.some((one) => one.kind === 'too-many-entries'))
  })
})

describe('the assumptions are stated', () => {
  test('the list names what the engine will and will not do', () => {
    assert.ok(INTERCHANGE_ASSUMPTIONS.length >= 8)
    assert.ok(INTERCHANGE_ASSUMPTIONS.some((one) => /extension is a claim/.test(one)))
    assert.ok(INTERCHANGE_ASSUMPTIONS.some((one) => /staged and only committed/.test(one)))
    assert.ok(INTERCHANGE_ASSUMPTIONS.some((one) => /never called a signature/.test(one)))
  })
})
