// Builds ORBIS COSMOS: the Gaia Sky simulation in cosmos/, with its own Gradle build.
//
//   node scripts/cosmos-build.mjs          build if anything changed
//   node scripts/cosmos-build.mjs --force  build again regardless
//
// In order, saying so as it goes:
//   1. checks that a Java 21+ runtime is present (Gaia Sky's own minimum);
//   2. runs Gaia Sky's Gradle build for its jar, and asks Gradle which libraries it runs on (metadata only);
//   3. fetches those libraries from Maven Central, each checked against Maven's published SHA-1, and only the ones
//      that run on this computer -- the other platforms' native libraries are never downloaded;
//   4. writes cosmos/.build/build.json, which the application reads to know the simulation is ready.
//
// Nothing in cosmos/ is edited. Everything made goes under cosmos/.build and cosmos/core/build (not committed).

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cosmos = join(root, 'cosmos')
const out = join(cosmos, '.build')
const libs = join(out, 'lib')
const force = process.argv.includes('--force')
const say = (m) => console.log(`[cosmos] ${m}`)
const die = (m, code = 1) => {
  console.error(`[cosmos] ${m}`)
  process.exit(code)
}

if (process.platform !== 'win32') die('ORBIS COSMOS is built for Windows in this version of Orbis.', 2)

const upstream = JSON.parse(readFileSync(join(cosmos, 'upstream.json'), 'utf8'))
const shortRev = upstream.commit.slice(0, 7)

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

// ---- 1. Java ---------------------------------------------------------------------------------------------------------------
const java = spawnSync('java', ['-version'], { encoding: 'utf8' })
if (java.error || java.status !== 0) die('No Java runtime was found. Install Java 21 or newer (a JDK), then run this again.', 2)
const javaText = (java.stderr || java.stdout).trim()
const major = Number(/version "(\d+)/.exec(javaText)?.[1] ?? 0)
if (major < 21) die(`Gaia Sky ${upstream.tag} needs Java 21 or newer; found ${javaText.split('\n')[0]}.`, 2)
say(`using ${javaText.split('\n')[0]}`)

// ---- fingerprint: an unchanged tree is not rebuilt ----------------------------------------------------------------------------
const hash = createHash('sha1')
for (const f of [...walk(join(cosmos, 'core', 'src')), join(cosmos, 'build.gradle.kts'), join(cosmos, 'core', 'build.gradle.kts'), join(cosmos, 'upstream.json'), join(cosmos, 'orbis-resolve.init.gradle')].sort()) {
  hash.update(f.slice(cosmos.length)).update(String(statSync(f).size)).update(readFileSync(f))
}
const fingerprint = hash.digest('hex')
const stamp = join(out, 'build.json')
if (!force && existsSync(stamp)) {
  try {
    const previous = JSON.parse(readFileSync(stamp, 'utf8'))
    if (previous.fingerprint === fingerprint && existsSync(join(out, previous.jar))) {
      say(`up to date (Gaia Sky ${previous.version}, built ${previous.builtAt})`)
      process.exit(0)
    }
  } catch {
    // unreadable stamp: build again
  }
}

// ---- 2. Gaia Sky's own build ---------------------------------------------------------------------------------------------------
mkdirSync(out, { recursive: true })
const coordsFile = '.build/runtime.txt'
rmSync(join(cosmos, coordsFile), { force: true })
say('building Gaia Sky with its Gradle build (the first run downloads Gradle itself)')
const gradle = spawnSync(
  '.' + String.fromCharCode(92) + 'gradlew.bat',
  ['--console=plain', '-q', '-I', 'orbis-resolve.init.gradle', `-Dorbis.tag=${upstream.tag}`, `-Dorbis.rev=${shortRev}`, `-Dorbis.out=${coordsFile}`, ':core:jar', ':core:orbisRuntimeCoordinates'],
  { cwd: cosmos, encoding: 'utf8', shell: true }
)
if (gradle.status !== 0) {
  console.error((gradle.stdout + gradle.stderr).split('\n').filter((l) => /error|FAILED|What went wrong|wrong:/i.test(l)).slice(0, 20).join('\n') || gradle.stderr)
  die('The simulation did not build.')
}
const builtJar = readdirSync(join(cosmos, 'core', 'build', 'libs')).find((f) => /^core-.*\.jar$/.test(f))
if (!builtJar) die('The build finished but produced no jar.')

// ---- 3. libraries ----------------------------------------------------------------------------------------------------------------
const coordinates = readFileSync(join(cosmos, coordsFile), 'utf8').split('\n').filter(Boolean)
rmSync(libs, { recursive: true, force: true })
mkdirSync(libs, { recursive: true })
const CENTRAL = 'https://repo1.maven.org/maven2'

/** The extra (native) jar a module needs on this computer, if it has one. 64-bit Windows only. */
function nativeClassifier(group, name) {
  if (group === 'org.lwjgl') return 'natives-windows'
  if (group === 'com.badlogicgames.gdx' && (name === 'gdx-platform' || name === 'gdx-freetype-platform')) return 'natives-desktop'
  return null
}
async function get(url) {
  const res = await fetch(url)
  if (!res.ok) throw Object.assign(new Error(`${url} answered ${res.status}`), { status: res.status })
  return Buffer.from(await res.arrayBuffer())
}
async function fetchJar(group, name, version, classifier, required) {
  const file = `${name}-${version}${classifier ? '-' + classifier : ''}.jar`
  const url = `${CENTRAL}/${group.replace(/\./g, '/')}/${name}/${version}/${file}`
  let bytes
  try {
    bytes = await get(url)
  } catch (e) {
    if (!required && e.status === 404) return null
    throw e
  }
  const wanted = (await get(url + '.sha1')).toString('utf8').trim().split(/\s+/)[0]
  if (createHash('sha1').update(bytes).digest('hex') !== wanted) throw new Error(`${file} does not match its published checksum`)
  writeFileSync(join(libs, file), bytes)
  return { file, sha1: wanted }
}
const fetched = []
for (const c of coordinates) {
  const [group, name, version] = c.split(':')
  if (group === 'com.fasterxml.jackson' && name === 'jackson-bom') continue // a version list, not a library
  const plain = await fetchJar(group, name, version, null, false)
  if (plain) fetched.push(plain)
  const cls = nativeClassifier(group, name)
  if (cls) {
    const native = await fetchJar(group, name, version, cls, true)
    if (native) fetched.push(native)
  }
  if (!plain && !cls) {
    // No jar is fine only for an aggregate: a module whose own POM says it is just a list of other modules.
    const pom = (await get(`${CENTRAL}/${group.replace(/\./g, '/')}/${name}/${version}/${name}-${version}.pom`)).toString('utf8')
    if (!/<packaging>\s*pom\s*<\/packaging>/.test(pom)) die(`${c} could not be fetched.`)
  }
}
say(`fetched ${fetched.length} libraries (checked against Maven's SHA-1)`)
copyFileSync(join(cosmos, 'core', 'build', 'libs', builtJar), join(out, builtJar))

// ---- 4. stamp ----------------------------------------------------------------------------------------------------------------------
writeFileSync(
  stamp,
  JSON.stringify({ builtAt: new Date().toISOString(), version: upstream.tag, commit: upstream.commit, fingerprint, jar: builtJar, libraries: fetched }, null, 2)
)
say(`built Gaia Sky ${upstream.tag} (${shortRev}) into cosmos/.build`)
