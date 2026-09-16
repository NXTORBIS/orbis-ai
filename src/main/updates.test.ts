import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canMoveTo,
  compareVersionStrings,
  decideUpdate,
  describeUpdate,
  holdsPackage,
  idleStatus,
  isInstalling,
  isNewer,
  parseVersion,
  platformKey,
  readManifest
} from '../shared/updates.ts'
import type { ReleaseManifest, UpdateState } from '../shared/updates.ts'

const PACKAGE = { url: 'https://updates.example/orbis-1.1.0.exe', sha256: 'a'.repeat(64), size: 120_000_000 }

const manifest = (patch: Partial<ReleaseManifest> = {}): ReleaseManifest => ({
  channel: 'stable',
  latestVersion: '1.1.0',
  minimumSupportedVersion: '1.0.0',
  mandatory: false,
  releaseDate: '2026-09-16',
  releaseNotes: 'Faster startup',
  components: { browser: '1.1.0', orion: '2.3.0' },
  platforms: { 'windows-x64': PACKAGE },
  ...patch
})

const decide = (currentVersion: string, m = manifest(), channel: 'stable' | 'beta' | 'dev' | 'canary' = 'stable') =>
  decideUpdate({ currentVersion, manifest: m, channel, platform: 'win32', arch: 'x64' })

test('versions are compared as numbers, not as text', () => {
  assert.equal(compareVersionStrings('1.10.0', '1.9.0'), 1, '1.10.0 is newer than 1.9.0')
  assert.equal(compareVersionStrings('2.0.0', '1.99.99'), 1)
  assert.equal(compareVersionStrings('1.0.1', '1.0.1'), 0)
  assert.equal(compareVersionStrings('1.0.0', '1.0.1'), -1)
  assert.equal(isNewer('1.1.0', '1.0.5'), true)
  assert.equal(isNewer('1.0.5', '1.1.0'), false)
})

test('a prerelease comes before the release it leads to', () => {
  assert.equal(compareVersionStrings('1.2.0', '1.2.0-beta.1'), 1, 'the real thing beats its beta')
  assert.equal(compareVersionStrings('1.2.0-beta.2', '1.2.0-beta.1'), 1)
  assert.equal(compareVersionStrings('1.2.0-beta.10', '1.2.0-beta.9'), 1, 'counted, not spelled')
  assert.equal(compareVersionStrings('1.2.0-alpha', '1.2.0-beta'), -1)
  assert.equal(compareVersionStrings('1.2.0-beta', '1.2.0-beta.1'), -1, 'more parts is further along')
})

test('something that is not a version is read as nothing, and loses to everything', () => {
  assert.equal(parseVersion('not a version'), null)
  assert.equal(parseVersion('1.2'), null)
  assert.equal(parseVersion(''), null)
  assert.deepEqual(parseVersion('1.2.3-beta.4'), { major: 1, minor: 2, patch: 3, prerelease: 'beta.4' })
  assert.equal(compareVersionStrings('nonsense', '1.0.0'), -1)
})

test('a manifest is a claim, and every part of it is checked before it is believed', () => {
  /** The reason a manifest was refused, or '' when it was accepted. */
  const refusal = (raw: unknown): string => {
    const read = readManifest(raw)
    return read.ok ? '' : read.problem
  }

  assert.equal(readManifest(manifest()).ok, true)
  assert.match(refusal(null), /not an object/)
  assert.match(refusal({ ...manifest(), channel: 'nightly' }), /which channel/)

  const badVersion = readManifest({ ...manifest(), latestVersion: 'latest' })
  assert.equal(badVersion.ok, false)

  // A package that would be fetched over something tamperable is refused outright.
  const insecure = readManifest({ ...manifest(), platforms: { 'windows-x64': { ...PACKAGE, url: 'http://updates.example/o.exe' } } })
  assert.equal(insecure.ok, false)
  assert.match(refusal({ ...manifest(), platforms: { 'windows-x64': { ...PACKAGE, url: 'http://updates.example/o.exe' } } }), /https/)

  const noHash = readManifest({ ...manifest(), platforms: { 'windows-x64': { ...PACKAGE, sha256: 'nope' } } })
  assert.equal(noHash.ok, false)

  const silly = readManifest({ ...manifest(), platforms: { 'windows-x64': { ...PACKAGE, size: -1 } } })
  assert.equal(silly.ok, false)

  const noPackages = readManifest({ ...manifest(), platforms: {} })
  assert.equal(noPackages.ok, false)
})

test('a manifest keeps what it says about the release, including which components it expects', () => {
  const read = readManifest(manifest())
  assert.equal(read.ok, true)
  if (!read.ok) return
  assert.deepEqual(read.manifest.components, { browser: '1.1.0', orion: '2.3.0' })
  assert.equal(read.manifest.releaseNotes, 'Faster startup')
  assert.equal(read.manifest.mandatory, false)

  // A component with a version that is not a version is a reason to stop, not to shrug.
  assert.equal(readManifest({ ...manifest(), components: { orion: 'latest' } }).ok, false)
})

test('an update is offered when there is a newer one for this computer', () => {
  const decision = decide('1.0.0')
  assert.equal(decision.action, 'update')
  if (decision.action !== 'update') return
  assert.equal(decision.version, '1.1.0')
  assert.equal(decision.package.url, PACKAGE.url)
  assert.equal(decision.mandatory, false)
})

test('being up to date is not an update', () => {
  const decision = decide('1.1.0')
  assert.equal(decision.action, 'none')
  assert.match(decision.action === 'none' ? decision.reason : '', /up to date/)
})

test('an update never goes backwards, however much the server insists', () => {
  const decision = decide('2.0.0')
  assert.equal(decision.action, 'refuse', 'a downgrade is how a fixed problem comes back')
  assert.match(decision.action === 'refuse' ? decision.reason : '', /older/)
})

test('a release for another channel is not installed by mistake', () => {
  const decision = decide('1.0.0', manifest({ channel: 'beta' }), 'stable')
  assert.equal(decision.action, 'refuse')
  assert.match(decision.action === 'refuse' ? decision.reason : '', /beta/)
  // On the beta channel the same manifest is fine.
  assert.equal(decide('1.0.0', manifest({ channel: 'beta' }), 'beta').action, 'update')
})

test('a package for another kind of computer is not offered', () => {
  const armOnly = manifest({ platforms: { 'windows-arm64': PACKAGE } })
  const decision = decideUpdate({ currentVersion: '1.0.0', manifest: armOnly, channel: 'stable', platform: 'win32', arch: 'x64' })
  assert.equal(decision.action, 'none')
  assert.match(decision.action === 'none' ? decision.reason : '', /windows-x64/)

  assert.equal(platformKey('win32', 'x64'), 'windows-x64')
  assert.equal(platformKey('darwin', 'arm64'), 'macos-arm64')
  assert.equal(platformKey('linux', 'x64'), 'linux-x64')
})

test('a version below the minimum supported is told it must move on, not merely invited', () => {
  const decision = decide('0.9.0', manifest({ minimumSupportedVersion: '1.0.0' }))
  assert.equal(decision.action, 'unsupported')
  if (decision.action !== 'unsupported') return
  assert.equal(decision.version, '1.1.0')
  assert.equal(decision.package.url, PACKAGE.url)
})

test('a mandatory release says so', () => {
  const decision = decide('1.0.0', manifest({ mandatory: true }))
  assert.equal(decision.action, 'update')
  assert.equal(decision.action === 'update' ? decision.mandatory : false, true)
})

test('an update moves through its states in order, and cannot skip the checking', () => {
  assert.equal(canMoveTo('idle', 'checking'), true)
  assert.equal(canMoveTo('checking', 'update-available'), true)
  assert.equal(canMoveTo('update-available', 'downloading'), true)
  assert.equal(canMoveTo('downloading', 'verifying'), true)
  assert.equal(canMoveTo('verifying', 'ready-to-install'), true)
  assert.equal(canMoveTo('ready-to-install', 'preparing'), true)

  // Nothing is installed without having been checked first.
  assert.equal(canMoveTo('downloading', 'ready-to-install'), false)
  assert.equal(canMoveTo('idle', 'installing'), false)
  assert.equal(canMoveTo('update-available', 'installing'), false)
  // A package that fails its checks is fetched again rather than used.
  assert.equal(canMoveTo('verifying', 'downloading'), true)
})

test('once it is being put in place, stopping means putting the old one back', () => {
  for (const state of ['preparing', 'installing', 'validating', 'restarting'] as UpdateState[]) {
    assert.equal(isInstalling(state), true, `${state} is past the point of simply cancelling`)
  }
  for (const state of ['idle', 'downloading', 'ready-to-install'] as UpdateState[]) assert.equal(isInstalling(state), false)

  assert.equal(canMoveTo('installing', 'cancelled'), false, 'an install is not cancelled, it is rolled back')
  assert.equal(canMoveTo('installing', 'rolling-back'), true)
  assert.equal(canMoveTo('validating', 'rolling-back'), true, 'a new version that will not start goes back')
  assert.equal(canMoveTo('rolling-back', 'idle'), true)
})

test('a downloaded package is worth keeping between runs; a half-finished check is not', () => {
  assert.equal(holdsPackage('ready-to-install'), true)
  assert.equal(holdsPackage('paused'), true)
  assert.equal(holdsPackage('downloading'), false, 'an unfinished download is not a package')
  assert.equal(holdsPackage('idle'), false)
})

test('what the user reads says what is actually happening', () => {
  const base = idleStatus('1.0.0')
  assert.match(describeUpdate({ ...base, state: 'no-update' }), /1\.0\.0 is up to date/)
  assert.match(describeUpdate({ ...base, state: 'update-available', availableVersion: '1.1.0' }), /1\.1\.0 is available/)
  assert.match(describeUpdate({ ...base, state: 'downloading', availableVersion: '1.1.0', progress: 0.78 }), /78%/)
  assert.match(describeUpdate({ ...base, state: 'ready-to-install', availableVersion: '1.1.0' }), /ready/)
  assert.match(describeUpdate({ ...base, state: 'rolling-back' }), /previous version/)
  // A failure says what went wrong rather than "something went wrong".
  assert.equal(describeUpdate({ ...base, state: 'failed', problem: 'the download was corrupted' }), 'the download was corrupted')
})
