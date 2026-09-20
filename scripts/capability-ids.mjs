// Lists the control-layer capability ids the Electron browser registered (read from git history: the commit before the Electron browser UI
// was removed) and the ids registered now, and prints which are gone, which are new and how many are kept.
//   node scripts/capability-ids.mjs [oldCommit] [--table]
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OLD = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'cf38507^'
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// A capability id is a quoted 'domain.name' whose domain is one of the control layer's domains (ControlDomain), whether it is written as
// `id: '...'` or passed to a registering helper.
const domainType = readFileSync('src/shared/browserControl.ts', 'utf8').split('export type ControlDomain =')[1].split('\n\n')[0]
const DOMAINS = [...domainType.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1])
const ID = new RegExp(`'((?:${DOMAINS.join('|')})\\.[a-z][a-zA-Z0-9-]*)'`, 'g')
const idsOf = (text) => new Set([...text.matchAll(ID)].map((m) => m[1]))
const add = (map, file, ids) => ids.forEach((id) => (map.has(id) ? null : map.set(id, file)))
const slash = (path) => path.split(String.fromCharCode(92)).join('/')
const isSource = (f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)

// Then: everything the main process registered, and everything the window registered (browser panel, address bar, app shell).
const then = new Map()
for (const file of git('ls-tree', '-r', '--name-only', OLD, '--', 'src/main/browserControl', 'src/renderer/src').split('\n').filter(isSource)) {
  const text = git('show', `${OLD}:${file}`)
  if (file.startsWith('src/main/browserControl/') || text.includes('useControlScope(')) add(then, file, [...idsOf(text)])
}

// Now: the app's own capabilities, the shared page/CAPTCHA/UI capabilities, Chromium's, and what the address bar still provides.
const now = new Map()
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
for (const file of [...walk('src/main/browserControl'), ...walk('src/main/chromium'), 'src/main/browserCapabilities.ts', 'src/renderer/src/components/UrlBar.tsx'].map(slash).filter(isSource)) {
  add(now, file, [...idsOf(readFileSync(file, 'utf8'))])
}

const gone = [...then.keys()].filter((id) => !now.has(id)).sort()
const added = [...now.keys()].filter((id) => !then.has(id)).sort()
console.log(JSON.stringify({ then: then.size, now: now.size, kept: then.size - gone.length, gone, added }, null, 2))
if (process.argv.includes('--table')) for (const id of gone) console.log(`${id}\t${then.get(id)}`)
