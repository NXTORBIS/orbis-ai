// Revision briefs: what a requested change would intend, never what it achieved.
import { understand, type MusicalIntent } from './intent2.ts'

export type Workflow = 'regeneration' | 'post-processing' | 'analysis-only'
export interface Labelled { text: string; basis: 'intended'; observed: 'unverified' }
export interface RevisionBrief {
  blocked?: false
  sourceVersion: string
  change: string
  preserve: Labelled[]
  modify: Labelled[]
  exclusions: string[]
  unsupported: string[]
  alternatives: string[]
  workflow: Workflow
  summaryIntended: string
}
export interface Blocked { blocked: true; conflicts: string[] }
export interface RevisionInput { base: MusicalIntent & { version?: string }; request: string; locked: string[] }

const lab = (text: string): Labelled => ({ text, basis: 'intended', observed: 'unverified' })
const STEMS = /\b(drums?|vocals?|bass|guitar|piano|voice|singing|instruments?|percussion)\b/
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()

export function reviseBrief(i: RevisionInput): RevisionBrief | Blocked {
  const req = (i.request ?? '').trim()
  const low = req.toLowerCase()
  const parsed = understand(req)

  // drift guard: change must not contradict locked entries or stated hard constraints
  const conflicts: string[] = []
  const hard = [...i.locked, ...i.base.requirements.filter((r) => r.kind === 'must' || r.priority >= 2).map((r) => r.text)]
  for (const h of hard) {
    const t = norm(h)
    if (!t) continue
    const words = t.split(' ').filter((w) => w.length > 2)
    const mentions = (s: string) => words.length > 0 && words.every((w) => s.includes(w))
    const removal = parsed.requirements.some((r) => r.kind === 'avoid' && mentions(norm(r.text))) || new RegExp('\\b(remove|drop|delete|get rid of|replace|swap out|take out)\\b[^.,;]*' + (words[words.length - 1] ?? '_'), 'i').test(low) && mentions(low)
    if (removal) conflicts.push('The change removes "' + h + '", which is locked or required.')
  }
  const instrumentalLocked = i.locked.some((l) => /\b(instrumental|no vocals?)\b/i.test(l)) || i.base.instrumental === true
  if (instrumentalLocked && /\b(add|with|include)\s+(?:\w+\s+)?(vocals?|singing|singer|lyrics)\b/.test(low)) conflicts.push('The change adds vocals, but the song is locked or marked instrumental.')
  const bpm = low.match(/\b(\d{2,3})\s*bpm\b/)
  const lockedBpm = i.locked.map((l) => l.toLowerCase().match(/\b(\d{2,3})\s*bpm\b/)).find(Boolean)
  if (bpm && lockedBpm && bpm[1] !== lockedBpm[1]) conflicts.push('The change sets ' + bpm[1] + ' bpm, but ' + lockedBpm[1] + ' bpm is locked.')
  for (const r of i.base.requirements.filter((x) => x.kind === 'avoid' && 'whole' in x.scope)) {
    if (new RegExp('\\b(add|include|with|more)\\s+(?:\\w+\\s+)?' + r.text.replace(/[^a-z0-9 ]/gi, '') + '\\b', 'i').test(low)) conflicts.push('The change brings back "' + r.text + '", which was excluded.')
  }
  if (conflicts.length) return { blocked: true, conflicts: [...new Set(conflicts)] }

  let workflow: Workflow = 'regeneration'
  const unsupported: string[] = []
  const alternatives: string[] = []
  if (/\b(remove|isolate|extract|separate|take out|strip|mute)\b/.test(low) && STEMS.test(low) && /\b(from|in)\s+(this|the|that)\s+(audio|track|song|recording|mix|file)\b|\bstems?\b/.test(low)) {
    workflow = 'analysis-only'
    unsupported.push('Removing or isolating an instrument from existing audio needs source separation, which is not available.')
    alternatives.push('Regenerate with revised wording (for example "no ' + (low.match(STEMS)?.[1] ?? 'drums') + '").')
  } else if (/\b(quieter|softer volume|louder|volume|fade[\s-]?(?:out|in)|normali[sz]e|trim|cut off the end)\b/.test(low)) workflow = 'post-processing'

  const modify = parsed.requirements.filter((r) => r.kind !== 'avoid').map((r) => lab(r.text + ('section' in r.scope ? ' (' + r.scope.section + ' only)' : '')))
  if (!modify.length && workflow !== 'analysis-only') modify.push(lab(req))
  const exclusions = [...i.base.requirements.filter((r) => r.kind === 'avoid').map((r) => r.text), ...parsed.requirements.filter((r) => r.kind === 'avoid').map((r) => r.text)]
  const touched = new Set(modify.map((m) => norm(m.text)))
  const preserve = [...i.locked.map(lab), ...i.base.requirements.filter((r) => r.kind !== 'avoid' && !touched.has(norm(r.text))).map((r) => lab(r.text))]
  const sourceVersion = i.base.version ?? 'unversioned'
  const guarantee = workflow === 'regeneration' ? ' Regeneration can change anything not stated; nothing is guaranteed until checked.' : ''
  return {
    sourceVersion, change: req, preserve, modify, exclusions: [...new Set(exclusions)], unsupported, alternatives, workflow,
    summaryIntended: 'Intended: ' + (workflow === 'analysis-only' ? 'no change is made to the audio.' : 'change "' + req + '" while trying to keep ' + (preserve.length ? preserve.length + ' stated item(s)' : 'nothing in particular') + '.') + guarantee + ' Observed result: not yet measured.'
  }
}

const key = (r: { kind: string; text: string; scope: unknown }) => r.kind + '|' + r.text.toLowerCase() + '|' + JSON.stringify(r.scope)
export interface Diff { preserved: string[]; changed: string[]; notGuaranteed: string[] }

export function describeDiff(prev: MusicalIntent, next: MusicalIntent): Diff {
  const a = new Map(prev.requirements.map((r) => [key(r), r]))
  const b = new Map(next.requirements.map((r) => [key(r), r]))
  const preserved: string[] = []
  const changed: string[] = []
  for (const [k, r] of b) (a.has(k) ? preserved : changed).push((a.has(k) ? '' : 'added: ') + r.kind + ' ' + r.text)
  for (const [k, r] of a) if (!b.has(k)) changed.push('removed: ' + r.kind + ' ' + r.text)
  for (const f of ['tempoBpm', 'durationSec', 'key'] as const) {
    const x = JSON.stringify(prev.structured[f]?.value ?? null)
    const y = JSON.stringify(next.structured[f]?.value ?? null)
    if (x === y) { if (x !== 'null') preserved.push(f + ' ' + x) } else changed.push(f + ': ' + x + ' -> ' + y)
  }
  if (JSON.stringify(prev.arc) !== JSON.stringify(next.arc)) changed.push('emotional arc: ' + (prev.arc.join(' > ') || 'none') + ' -> ' + (next.arc.join(' > ') || 'none'))
  if (prev.instrumental !== next.instrumental) changed.push('instrumental: ' + prev.instrumental + ' -> ' + next.instrumental)
  return { preserved, changed, notGuaranteed: ['Anything not listed (timbre, melody, arrangement details) may differ on regeneration.', 'Preserved items are intended, not verified, until the result is measured.'] }
}

export interface Attempt { change: string; outcome: 'unsuccessful' | 'successful' | 'unknown' }
export function isRepeatedAttempt(history: Attempt[], change: string): { repeated: boolean; of?: number } {
  const toks = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !['the', 'and', 'make', 'it', 'more', 'please'].includes(w)))
  const t = toks(change)
  if (!t.size) return { repeated: false }
  for (let i = 0; i < history.length; i++) {
    if (history[i].outcome !== 'unsuccessful') continue
    const h = toks(history[i].change)
    const inter = [...t].filter((w) => h.has(w)).length
    const union = new Set([...t, ...h]).size
    if (union && inter / union >= 0.8) return { repeated: true, of: i }
  }
  return { repeated: false }
}
