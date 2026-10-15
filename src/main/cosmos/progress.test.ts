import assert from 'node:assert/strict'
import { test } from 'node:test'

import { advance, INITIAL, needsPerson, parseLine, parseProblem, STAGES } from './progress.ts'

// Lines copied from a real run of Gaia Sky 3.8.0.
const LOG = `[2026-10-14 19:22:58] GaiaSky - Device: Intel(R) Iris(R) Xe Graphics
[2026-10-14 19:22:58] ShaderCache - Compiling shaders: spritebatch
[2026-10-14 19:23:27] DownloadHelper - Reading 74590528 bytes
[2026-10-14 19:23:37] BatchDownloadWindow - SHA256 ok: Base data pack
[2026-10-14 19:23:49] ShaderCache - Compiling shaders: regular.billboard
[2026-10-14 19:23:58] JsonLoader - 9 objects loaded from file $data/default-data/planets.json
[2026-10-14 19:23:58] GeoJsonLoader - 180 objects loaded from file $data/default-data/countries/countries.geo.json
[2026-10-14 19:24:01] OctreeLoader - Catalog loaded with 646,400 objects
[2026-10-14 19:24:02] JsonLoader - 21 objects loaded from file $data/catalog-nbg/particles-nbg.json
[2026-10-14 19:24:02] PointDataProvider - 92,983 objects loaded from file C:/Users/ksran/.gaiasky/data/default-data/galaxy/galaxy_ArmDust.dat.gz
[2026-10-14 19:24:03] Scene - Scene graph initialised with 10,017 objects
[2026-10-14 19:24:03] SceneLoader - Initialising renderer and GUI
[2026-10-14 19:24:09] Camera focus changed to Earth`.split('\n')

test('each real log line finishes the stage it belongs to', () => {
  assert.deepEqual(
    LOG.map((l) => parseLine(l)?.stage ?? null),
    ['engine', null, 'data', 'data', 'shaders', 'solar', 'solar', 'stars', 'galaxy', 'galaxy', 'scene', 'renderer', 'ready']
  )
})

test('counts are carried exactly as the program printed them', () => {
  assert.equal(parseLine(LOG[2])?.detail, 'Downloading 71 MB')
  assert.equal(parseLine(LOG[7])?.detail, '646,400 stars')
  assert.equal(parseLine(LOG[10])?.detail, '10,017 objects')
  assert.equal(parseLine(LOG[12])?.detail, 'Focused on Earth')
})

test('the welcome screen shader says nothing about start-up', () => {
  assert.equal(parseLine('[2026-10-14 19:22:58] ShaderCache - Compiling shaders: spritebatch'), null)
})

test('a line that means nothing moves nothing', () => {
  assert.equal(parseLine('[Controllers] added manager for application, 1 managers active'), null)
  assert.equal(parseLine(''), null)
})

test('progress only rises, and only by log lines, and ends at exactly one', () => {
  let s = INITIAL
  const fractions: number[] = [s.fraction]
  for (const line of LOG) {
    const hit = parseLine(line)
    if (hit) s = advance(s, hit)
    fractions.push(s.fraction)
  }
  for (let i = 1; i < fractions.length; i++) assert.ok(fractions[i] >= fractions[i - 1])
  assert.equal(fractions[0], 0)
  assert.equal(s.fraction, 1)
  assert.equal(s.current, null)
})

test('a start with the data already present passes the data step without a line for it', () => {
  let s = INITIAL
  s = advance(s, parseLine(LOG[4])!)
  assert.equal(s.current, 'shaders')
  assert.equal(s.fraction, 2 / STAGES.length)
})

test('missing data is the one moment the program waits for a person', () => {
  assert.equal(needsPerson('[2026-10-14 19:23:01] WelcomeGui - Data files not found: C:/x/default-data'), true)
  assert.equal(needsPerson(LOG[3]), false)
})

test('failures are read from the program\'s own error lines', () => {
  assert.match(parseProblem('[2026-10-14 19:23:37 ERROR] java.nio.file.FileSystemException: x.part: in use') ?? '', /FileSystemException/)
  assert.match(parseProblem('Exception in thread "main" java.lang.IllegalStateException: no display') ?? '', /no display/)
  assert.equal(parseProblem('[2026-10-14 19:24:03] Scene - Scene graph initialised with 10,017 objects'), null)
})
