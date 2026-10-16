import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OPENING_SOURCE, datasetSize } from './openings.ts'
import {
  REFERENCE_DATASETS, STATE_LABEL, datasetById, engineEvidence, probeOpenings, statusOf, statusesOf, summarise,
  withoutWords, type DatasetId, type Evidence
} from './reference.ts'

/**
 * What these prove.
 *
 * One rule above all the others: **the manager never says a dataset is here because something points at where it
 * would be.** A path in a setting produces "nobody has looked", with the path shown as a setting. There is no input
 * to `statusOf` that turns a wish into "present" -- including a `found` for something Orbis cannot read at all.
 *
 * After that: missing optional data is not a fault and says what still works; a dataset nobody asked about is
 * unchecked rather than absent; and the engine's own status is read without any field being invented.
 */

const EVERY_ID: DatasetId[] = REFERENCE_DATASETS.map((one) => one.id)

// ---------------------------------------------------------------------------------------------------------------
// The catalogue says enough to be worth showing

test('every dataset names itself, its source, where it would live and what works without it', () => {
  const ids = new Set<DatasetId>()
  for (const dataset of REFERENCE_DATASETS) {
    assert.ok(!ids.has(dataset.id), `${dataset.id} is listed twice`)
    ids.add(dataset.id)
    assert.equal(datasetById(dataset.id), dataset)
    assert.ok(dataset.name.length > 3, dataset.id)
    assert.ok(dataset.purpose.length > 20, `${dataset.id} must say what it is for`)
    assert.ok(dataset.source.name.length > 0, `${dataset.id} must name its source`)
    assert.ok(dataset.whereWords.length > 10, `${dataset.id} must say where it would live`)
    assert.ok(dataset.install.how.length > 10, `${dataset.id} must say how it is got, or why it cannot be`)
    if (dataset.optional) {
      assert.ok(dataset.without.length > 0, `${dataset.id} is optional, so it must say what still works without it`)
    }
    // A version printed from a constant would be a claim about a file nobody read.
    if (dataset.where !== 'in-app') {
      assert.equal(dataset.version, null, `${dataset.id} must not claim a version Orbis has not checked`)
    }
  }
  assert.ok(REFERENCE_DATASETS.length >= 4)
})

test('the opening dataset carries the licence that was actually checked', () => {
  const openings = datasetById('openings')
  assert.ok(openings)
  assert.equal(openings.source.name, OPENING_SOURCE.dataset)
  assert.equal(openings.licence?.id, OPENING_SOURCE.licence)
  assert.ok(openings.version?.includes(OPENING_SOURCE.version.slice(0, 12)))
  assert.equal(openings.optional, false, 'opening names are not optional: they ship inside Orbis')
  assert.equal(openings.where, 'in-app')
})

test('a dataset Orbis cannot read says so, rather than inviting somebody to install it', () => {
  const unusable = REFERENCE_DATASETS.filter((one) => !one.usable)
  assert.ok(unusable.length > 0, 'the catalogue is meant to list the ones that are not supported yet')
  for (const dataset of unusable) {
    assert.equal(dataset.install.can, false, `${dataset.id} cannot be installed if it cannot be read`)
    assert.equal(dataset.where, 'nowhere-yet')
    assert.ok(dataset.without.length > 0, `${dataset.id} must say what still works`)
  }
})

test('every state has words a person can read', () => {
  for (const [state, label] of Object.entries(STATE_LABEL)) {
    assert.ok(label.length > 2, state)
  }
  assert.equal(STATE_LABEL.present, 'Here')
  assert.equal(STATE_LABEL.absent, 'Not here')
})

// ---------------------------------------------------------------------------------------------------------------
// The rule: a path is not a dataset

test('a setting that points at a path NEVER makes a dataset present', () => {
  const evidence: Evidence = { kind: 'path-only', path: 'D:\\chess\\syzygy' }
  for (const dataset of REFERENCE_DATASETS) {
    const status = statusOf(dataset, evidence)
    assert.notEqual(status.state, 'present', `${dataset.id} was called present on the strength of a path`)
    assert.equal(status.location, null, `${dataset.id} must not report a path nobody looked at as a location`)
    assert.equal(status.fault, false, `${dataset.id}: not having looked is not a fault`)
    if (dataset.usable) {
      assert.equal(status.state, 'unchecked', dataset.id)
      assert.match(status.says, /nothing has looked there/)
      assert.match(status.says, /A path is not a dataset/)
      assert.ok(status.says.includes('D:\\chess\\syzygy'), 'the path is shown, as a setting')
    } else {
      assert.equal(status.state, 'not-supported', dataset.id)
    }
  }
})

test('a dataset Orbis cannot read stays not-supported even when something says it found it', () => {
  const tablebase = datasetById('endgame-tablebase')
  assert.ok(tablebase)
  const found: Evidence = { kind: 'found', detail: 'Six-man tables are on the disk.', location: 'D:\\syzygy', size: { bytes: 1, words: '150 GB' } }
  const status = statusOf(tablebase, found)
  assert.equal(status.state, 'not-supported')
  assert.equal(status.location, null, 'a location would suggest Orbis is using it')
  assert.equal(status.size, null)
  assert.equal(status.fault, false)
  assert.match(status.says, /no way to add one yet|makes no difference/)
})

test('a dataset nobody asked about is unchecked, not absent', () => {
  const statuses = statusesOf({})
  assert.equal(statuses.length, REFERENCE_DATASETS.length)
  for (const status of statuses) {
    assert.notEqual(status.state, 'present', `${status.dataset.id} cannot be present with no evidence`)
    assert.notEqual(status.state, 'absent', `${status.dataset.id} cannot be absent with no evidence`)
    assert.ok(
      status.state === 'unchecked' || status.state === 'not-supported',
      `${status.dataset.id} came back as ${status.state}`
    )
    assert.equal(status.fault, false)
  }
})

test('nowhere to look is a different answer from not having looked', () => {
  const engine = datasetById('engine')
  assert.ok(engine)
  const cannot = statusOf(engine, { kind: 'no-way-to-look', why: 'This window has no way to ask the main process.' })
  assert.equal(cannot.state, 'uncheckable')
  assert.match(cannot.says, /cannot be told from inside Orbis/)
  assert.equal(cannot.fault, false)
  const notYet = statusOf(engine, { kind: 'not-looked', why: 'Nothing has asked yet.' })
  assert.equal(notYet.state, 'unchecked')
  assert.notEqual(cannot.says, notYet.says)
})

// ---------------------------------------------------------------------------------------------------------------
// Missing is not broken

test('an optional dataset that is not there is not a fault, and says what still works', () => {
  const engine = datasetById('engine')
  assert.ok(engine)
  const status = statusOf(engine, { kind: 'missing', detail: 'The chess engine has not been set up on this computer.' })
  assert.equal(status.state, 'absent')
  assert.equal(status.fault, false)
  assert.match(status.says, /This is optional, so nothing is wrong/)
  assert.ok(withoutWords(status).length > 0)
  assert.ok(withoutWords(status).some((line) => /PGN/.test(line)), 'it should say the things that still work')
})

test('something required that is not there IS a fault', () => {
  const openings = datasetById('openings')
  assert.ok(openings)
  assert.equal(openings.optional, false)
  const status = statusOf(openings, { kind: 'missing', detail: 'The opening dataset read as empty.' })
  assert.equal(status.state, 'absent')
  assert.equal(status.fault, true)
  assert.match(status.says, /not optional, so something is wrong/)
})

test('something that is here and does not work is a fault, and is not called missing', () => {
  const engine = datasetById('engine')
  assert.ok(engine)
  const status = statusOf(engine, { kind: 'faulty', detail: 'The engine started and never said hello.', location: 'C:\\x\\stockfish.exe' })
  assert.equal(status.state, 'broken')
  assert.equal(status.fault, true)
  assert.equal(status.location, 'C:\\x\\stockfish.exe', 'a real check found it, so where it is may be shown')
  assert.notEqual(STATE_LABEL[status.state], STATE_LABEL.absent)
})

test('what still works is only offered when something is not working', () => {
  const engine = datasetById('engine')
  assert.ok(engine)
  const here = statusOf(engine, { kind: 'found', detail: 'Stockfish 19 is ready.' })
  assert.deepEqual(withoutWords(here), [], 'nothing needs explaining when it is here')
  const going = statusOf(engine, { kind: 'installing', detail: 'Fetching it now.' })
  assert.deepEqual(withoutWords(going), [])
  const gone = statusOf(engine, { kind: 'missing', detail: 'Not set up.' })
  assert.ok(withoutWords(gone).length > 0)
})

// ---------------------------------------------------------------------------------------------------------------
// The one check this module really does

test('the opening dataset is checked by asking it, and the count is counted', () => {
  const evidence = probeOpenings()
  assert.equal(evidence.kind, 'found', JSON.stringify(evidence))
  if (evidence.kind !== 'found') return
  assert.equal(evidence.size?.entries, datasetSize())
  assert.equal(evidence.size?.entries, OPENING_SOURCE.entries, 'what was read must match what the dataset claims')
  assert.equal(evidence.location, 'Inside Orbis')
  // The landmark really was looked up, and what it is called is reported rather than expected.
  assert.match(evidence.detail, /the position after 1\.e4/)
  const openings = datasetById('openings')
  assert.ok(openings)
  const status = statusOf(openings, evidence)
  assert.equal(status.state, 'present')
  assert.equal(status.fault, false)
  assert.equal(status.size?.entries, datasetSize())
  assert.ok(status.version?.length)
  assert.match(status.checkedBy, /real check/)
})

// ---------------------------------------------------------------------------------------------------------------
// Reading the engine's status without inventing any of it

test('the engine\u2019s state is read as the engine reports it, and installed is not the same as running', () => {
  const cases: { status: unknown; kind: Evidence['kind']; state: string }[] = [
    { status: { state: 'not-installed', detail: 'Not set up yet.' }, kind: 'missing', state: 'absent' },
    { status: { state: 'installing', detail: 'Fetching.' }, kind: 'installing', state: 'installing' },
    { status: { state: 'failed', detail: 'It stopped on its own.' }, kind: 'faulty', state: 'broken' },
    { status: { state: 'stopped', binaryPath: 'C:\\a\\stockfish.exe' }, kind: 'found', state: 'present' },
    { status: { state: 'ready', detail: 'Stockfish 19 is ready.', name: 'Stockfish 19' }, kind: 'found', state: 'present' },
    { status: { state: 'searching', name: 'Stockfish 19' }, kind: 'found', state: 'present' },
    { status: { state: 'starting' }, kind: 'found', state: 'present' },
    { status: { state: 'handshaking' }, kind: 'found', state: 'present' }
  ]
  const engine = datasetById('engine')
  assert.ok(engine)
  for (const one of cases) {
    const evidence = engineEvidence(one.status)
    assert.equal(evidence.kind, one.kind, JSON.stringify(one.status))
    assert.equal(statusOf(engine, evidence).state, one.state, JSON.stringify(one.status))
  }
  // Installed and not running says so, rather than reading as ready.
  const stopped = engineEvidence({ state: 'stopped', binaryPath: 'C:\\a\\stockfish.exe' })
  assert.equal(stopped.kind, 'found')
  if (stopped.kind === 'found') {
    assert.match(stopped.detail, /not running at the moment/)
    assert.equal(stopped.location, 'C:\\a\\stockfish.exe')
  }
})

test('a field the engine did not send is not filled in', () => {
  const bare = engineEvidence({ state: 'ready' })
  assert.equal(bare.kind, 'found')
  if (bare.kind === 'found') {
    assert.equal(bare.location, undefined, 'no path was sent, so none is reported')
    assert.equal(bare.version, undefined, 'no version was sent, so none is reported')
    assert.match(bare.detail, /The engine is set up/)
  }
  const withVersion = engineEvidence({ state: 'ready', installedVersion: 'sf_19', binaryPath: 'C:\\a\\b.exe', name: 'Stockfish 19' })
  assert.equal(withVersion.kind, 'found')
  if (withVersion.kind === 'found') {
    assert.equal(withVersion.version, 'sf_19')
    const engine = datasetById('engine')
    assert.ok(engine)
    assert.equal(statusOf(engine, withVersion).version, 'sf_19', 'the version comes from the check, not from a constant')
  }
})

test('an answer the panel does not understand is reported as not known, never bent into a state', () => {
  for (const status of [null, undefined, 'ready', 42, {}, { state: '' }, { state: 'thinking-about-it' }]) {
    const evidence = engineEvidence(status)
    assert.equal(evidence.kind, 'not-looked', JSON.stringify(status))
  }
  const odd = engineEvidence({ state: 'thinking-about-it' })
  assert.equal(odd.kind, 'not-looked')
  if (odd.kind === 'not-looked') assert.match(odd.why, /does not recognise/)
})

// ---------------------------------------------------------------------------------------------------------------
// The heading

test('the summary counts each state apart and does not dress a fault up as a score', () => {
  const statuses = statusesOf({ openings: probeOpenings(), engine: engineEvidence({ state: 'not-installed', detail: 'Not set up.' }) })
  const summary = summarise(statuses)
  assert.equal(summary.present, 1)
  assert.equal(summary.absent, 1)
  assert.equal(summary.unsupported, 2)
  assert.equal(summary.unknown, 0)
  assert.equal(summary.faults, 0)
  assert.match(summary.words, /1 of 4 here/)
  assert.match(summary.words, /1 not set up/)
  assert.match(summary.words, /2 Orbis cannot use yet/)
  assert.match(summary.words, /Nothing here is broken/)

  const withFault = summarise(statusesOf({
    openings: { kind: 'missing', detail: 'The opening dataset read as empty.' },
    engine: engineEvidence({ state: 'failed', detail: 'It would not start.' })
  }))
  assert.equal(withFault.faults, 2)
  assert.match(withFault.words, /2 are a fault rather than a choice/)
})

test('every dataset in the catalogue can be asked about by name', () => {
  for (const id of EVERY_ID) {
    const statuses = statusesOf({ [id]: { kind: 'not-looked', why: 'Nothing has asked.' } })
    assert.equal(statuses.length, REFERENCE_DATASETS.length)
    assert.ok(statuses.every((one) => one.says.length > 10))
  }
  assert.equal(datasetById('engine')?.id, 'engine')
})
