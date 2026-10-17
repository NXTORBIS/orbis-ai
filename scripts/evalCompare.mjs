/**
 * Compares two run files written by scripts/evalChat.mjs.
 *
 *   node scripts/evalCompare.mjs evals/runs/baseline.json evals/runs/after.json [--all] [--chars 300]
 *
 * Prints per-metric totals for both runs, flags regressions per question, and shows the two answers side by side
 * (first 300 characters) for every question that regressed, or every question with --all.
 */
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const files = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] === '--chars'))
const showAll = argv.includes('--all')
const ci = argv.indexOf('--chars')
const chars = ci === -1 ? 300 : Number(argv[ci + 1]) || 300
if (files.length !== 2) {
  console.error('Usage: node scripts/evalCompare.mjs <before.json> <after.json> [--all] [--chars N]')
  process.exit(2)
}
const load = (p) => JSON.parse(readFileSync(p, 'utf8'))
const A = load(files[0])
const B = load(files[1])
const byId = (run) => new Map(run.results.map((r) => [r.id, r]))
const a = byId(A)
const b = byId(B)
const ids = [...a.keys()].filter((id) => b.has(id))

console.log(`before: ${A.label} (${A.model}${A.promptVariant ? `, prompt ${A.promptVariant}` : ''}, ${A.results.length} answers)`)
console.log(`after:  ${B.label} (${B.model}${B.promptVariant ? `, prompt ${B.promptVariant}` : ''}, ${B.results.length} answers)`)
if (A.model !== B.model) console.log('NOTE: the models differ, so differences mix model and prompt effects.')
if (A.systemPrompt === B.systemPrompt) console.log('NOTE: both runs used the same system prompt.')
console.log(`compared on ${ids.length} questions present in both${ids.length < Math.max(a.size, b.size) ? ` (${Math.max(a.size, b.size) - ids.length} only in one file, skipped)` : ''}\n`)

const ok = (r) => r && !r.error && r.metrics
const pairs = ids.map((id) => [a.get(id), b.get(id)])
const both = pairs.filter(([x, y]) => ok(x) && ok(y))

// ---- aggregates ----------------------------------------------------------------------------------------------
const sum = (rs, f) => rs.reduce((n, r) => n + (f(r) ?? 0), 0)
const avg = (rs, f) => (rs.length ? sum(rs, f) / rs.length : 0)
const countTrue = (rs, f) => rs.filter((r) => f(r) === true).length
const countOf = (rs, f) => rs.filter((r) => f(r) !== null && f(r) !== undefined).length
const rowsA = both.map(([x]) => x)
const rowsB = both.map(([, y]) => y)

const rows = [
  // label, getter, kind: 'avg' | 'sum' | 'bool' (count of true out of those measured), good: 'up' | 'down'
  ['errors', null, 'errors', 'down'],
  ['avg words', (r) => r.metrics.wordCount, 'avg', null],
  ['avg seconds', (r) => r.seconds, 'avg', 'down'],
  ['leads with answer', (r) => r.metrics.leadsWithAnswer, 'bool', 'up'],
  ['filler phrases (total)', (r) => r.metrics.fillerPhrases, 'sum', 'down'],
  ['within word limit', (r) => r.metrics.withinMaxWords, 'bool', 'up'],
  ['bullet count right', (r) => r.metrics.bulletsOk, 'bool', 'up'],
  ['numeric answer present', (r) => r.metrics.numericAnswerPresent, 'bool', 'up'],
  ['required text present', (r) => r.metrics.mustContainOk, 'bool', 'up'],
  ['unclosed code fence', (r) => r.metrics.unbalancedCodeFence, 'bool', 'down'],
  ['repeated sentences (total)', (r) => r.metrics.repeatedSentences, 'sum', 'down'],
  ['hedges when uncertain', (r) => r.metrics.hedged, 'bool', 'up']
]

const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
const table = [['metric', 'before', 'after', 'change']]
for (const [name, get, kind] of rows) {
  let va
  let vb
  if (kind === 'errors') {
    va = pairs.filter(([x]) => x.error).length
    vb = pairs.filter(([, y]) => y.error).length
  } else if (kind === 'avg') {
    va = avg(rowsA, get)
    vb = avg(rowsB, get)
  } else if (kind === 'sum') {
    va = sum(rowsA, get)
    vb = sum(rowsB, get)
  } else {
    const n = countOf(rowsA, get)
    va = `${countTrue(rowsA, get)}/${n}`
    vb = `${countTrue(rowsB, get)}/${countOf(rowsB, get)}`
    table.push([name, va, vb, countTrue(rowsB, get) - countTrue(rowsA, get) > 0 ? `+${countTrue(rowsB, get) - countTrue(rowsA, get)}` : String(countTrue(rowsB, get) - countTrue(rowsA, get))])
    continue
  }
  const d = vb - va
  table.push([name, fmt(va), fmt(vb), (d > 0 ? '+' : '') + fmt(d)])
}
const widths = table[0].map((_, c) => Math.max(...table.map((r) => r[c].length)))
for (const [i, r] of table.entries()) {
  console.log(r.map((cell, c) => (c === 0 ? cell.padEnd(widths[c]) : cell.padStart(widths[c]))).join('  '))
  if (i === 0) console.log(widths.map((w) => '-'.repeat(w)).join('  '))
}

// ---- regressions and improvements ----------------------------------------------------------------------------
function judge(x, y) {
  const reg = []
  const imp = []
  if (!x.error && y.error) reg.push('now errors: ' + String(y.error).slice(0, 80))
  if (x.error && !y.error) imp.push('error gone')
  if (!ok(x) || !ok(y)) return { reg, imp }
  const m = x.metrics
  const n = y.metrics
  const flip = (label, before, after, goodWhen) => {
    if (before === null || after === null || before === after) return
    ;(after === goodWhen ? imp : reg).push(label)
  }
  if (n.fillerPhrases > m.fillerPhrases) reg.push(m.fillerPhrases === 0 ? 'now has filler' : `more filler (${m.fillerPhrases} to ${n.fillerPhrases})`)
  else if (n.fillerPhrases < m.fillerPhrases) imp.push('less filler')
  flip('no longer leads with the answer', m.leadsWithAnswer, n.leadsWithAnswer, true)
  flip(n.withinMaxWords ? 'back within word limit' : 'now over the word limit', m.withinMaxWords, n.withinMaxWords, true)
  flip(n.bulletsOk ? 'bullet count now right' : `bullet count now wrong (${n.bulletCount})`, m.bulletsOk, n.bulletsOk, true)
  flip(n.numericAnswerPresent ? 'numeric answer now present' : 'numeric answer now missing or wrong', m.numericAnswerPresent, n.numericAnswerPresent, true)
  flip(n.mustContainOk ? 'required text now present' : `required text now missing (${n.mustContainMissing.join(', ')})`, m.mustContainOk, n.mustContainOk, true)
  flip(n.unbalancedCodeFence ? 'now has an unclosed code fence' : 'code fence fixed', m.unbalancedCodeFence, n.unbalancedCodeFence, false)
  flip(n.hedged ? 'now hedges' : 'no longer hedges when uncertain', m.hedged, n.hedged, true)
  if (n.repeatedSentences > m.repeatedSentences) reg.push('more repeated sentences')
  else if (n.repeatedSentences < m.repeatedSentences) imp.push('fewer repeated sentences')
  return { reg, imp }
}

const judged = pairs.map(([x, y]) => ({ x, y, ...judge(x, y) }))
const regressed = judged.filter((j) => j.reg.length)
const improved = judged.filter((j) => j.imp.length)
console.log(`\n${regressed.length} question(s) regressed, ${improved.length} improved, ${judged.length - new Set([...regressed, ...improved]).size} unchanged on these metrics`)

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const clip = (s) => (flat(s).length > chars ? flat(s).slice(0, chars) + '...' : flat(s))
for (const j of judged) {
  if (!showAll && !j.reg.length) continue
  console.log(`\n== ${j.x.id} [${j.x.bucket}] ${j.reg.length ? 'REGRESSED: ' + j.reg.join('; ') : ''}${j.imp.length ? (j.reg.length ? ' | ' : '') + 'improved: ' + j.imp.join('; ') : ''}`)
  console.log(`Q: ${clip(j.x.question)}`)
  console.log(`before (${j.x.error ? 'error' : j.x.metrics.wordCount + ' words'}): ${j.x.error ? 'ERROR ' + j.x.error : clip(j.x.answer)}`)
  console.log(`after  (${j.y.error ? 'error' : j.y.metrics.wordCount + ' words'}): ${j.y.error ? 'ERROR ' + j.y.error : clip(j.y.answer)}`)
}
if (!showAll && !regressed.length) console.log('No regressions. Use --all to see every pair side by side.')
console.log('\nThese are counts and checks, not a quality score; read the answers before trusting a result.')
