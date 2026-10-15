// Deterministic musical-intent understanding. Rules only: no model, no network. Unknown stays unknown.

export type Provenance = 'user-explicit' | 'rule-inference' | 'user-correction'
export type Scope = { whole: true } | { section: string }
export interface Requirement {
  id: string
  text: string
  kind: 'must' | 'prefer' | 'avoid'
  scope: Scope
  provenance: Provenance
  /** 1 = stated, 2 = user correction (wins over 1). */
  priority: number
  /** The clause in the original this came from. */
  source: string
}
export interface Inferred { id: string; text: string; confidence: 'low' | 'medium' | 'high'; provenance: 'rule-inference'; because: string }
export interface Negation { text: string; mode: 'exclusion' | 'softening' | 'allowance'; scope: Scope }
export interface Structured {
  tempoBpm?: { value: number; provenance: Provenance }
  durationSec?: { value: number; bound: 'max' | 'min' | 'exact'; provenance: Provenance }
  key?: { value: string; provenance: Provenance }
}
export interface MusicalIntent {
  schemaVersion: 1
  original: string
  requirements: Requirement[]
  inferred: Inferred[]
  arc: string[]
  questions: string[]
  conflicts: string[]
  negations: Negation[]
  structured: Structured
  instrumental: boolean | null
  hasLyrics: boolean
  notes: string[]
}

const MAX = 20000
const SEC = '(intro|verse|pre-?chorus|chorus|bridge|outro|breakdown|drop|solo|interlude|hook)'
const INJECTION = /\b(ignore|disregard|forget)\b[^.]{0,30}\b(previous|prior|above|earlier|all)\b[^.]{0,30}\b(instructions?|prompts?|rules)\b|\bsystem prompt\b|\byou are now\b|\bnew instructions?\b/i
const WORDNUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, thirty: 30 }

const num = (s: string): number | null => (/^\d+(\.\d+)?$/.test(s) ? Number(s) : WORDNUM[s.toLowerCase()] ?? null)

function scopeOf(clause: string): Scope {
  const m = clause.match(new RegExp('\\b(?:in|during|for|on)\\s+the\\s+' + SEC + '\\b', 'i'))
  return m ? { section: m[1].toLowerCase().replace('prechorus', 'pre-chorus') } : { whole: true }
}
const stripScope = (s: string) => s.replace(new RegExp('\\s*\\b(?:in|during|for|on)\\s+the\\s+' + SEC + '\\b', 'ig'), '').replace(/^\s*(and|also)\s+/i, '').trim()

export function understand(text: string, opts: { lyrics?: string } = {}): MusicalIntent {
  const original = typeof text === 'string' ? text : ''
  const notes: string[] = []
  let body = original
  if (body.length > MAX) { body = body.slice(0, MAX); notes.push('Input is very long; only the first ' + MAX + ' characters were analysed.') }
  const intent: MusicalIntent = { schemaVersion: 1, original, requirements: [], inferred: [], arc: [], questions: [], conflicts: [], negations: [], structured: {}, instrumental: null, hasLyrics: !!(opts.lyrics && opts.lyrics.trim()), notes }
  if (!body.trim()) { notes.push('Empty request: nothing was understood.'); return intent }
  if (INJECTION.test(body)) notes.push('The text contains instruction-like wording aimed at the assistant. It was treated as musical content, not obeyed.')

  let n = 0
  const req = (kind: Requirement['kind'], t: string, scope: Scope, source: string) => {
    const text = t.trim().replace(/[\s,]+$/, '')
    if (!text) return
    n++
    intent.requirements.push({ id: 'r' + n, text, kind, scope, provenance: 'user-explicit', priority: 1, source })
  }

  const clauses = body.split(/[.;!?\n]+/).map((s) => s.trim()).filter(Boolean)
  for (const clause of clauses) {
    const c = clause.replace(/\s+/g, ' ')
    const low = c.toLowerCase()
    const scope = scopeOf(low)

    let m = low.match(/\b(\d{2,3})\s*-?\s*bpm\b/) ?? low.match(/\btempo\s+(?:of\s+)?(\d{2,3})\b/)
    if (m) { const v = Number(m[1]); if (v >= 20 && v <= 400) intent.structured.tempoBpm = { value: v, provenance: 'user-explicit' } }
    m = low.match(/\b(under|below|less than|at most|up to|max(?:imum)?(?: of)?|over|above|more than|at least|about|around|exactly)?\s*(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|thirty)\s*(minutes?|mins?|seconds?|secs?)\b/)
    if (m) {
      const q = num(m[2])
      if (q !== null) {
        const sec = /^m/.test(m[3]) ? q * 60 : q
        const w = m[1] ?? ''
        const bound = /under|below|less|most|max|up to/.test(w) ? 'max' : /over|above|more|least/.test(w) ? 'min' : 'exact'
        if (sec > 0 && sec <= 7200) intent.structured.durationSec = { value: sec, bound, provenance: 'user-explicit' }
      }
    }
    m = low.match(/\b(?:in\s+(?:the\s+key\s+of\s+)?|key\s+of\s+)([a-g])(?:\s*(sharp|flat|#))?\s+(major|minor)\b/)
    if (m) intent.structured.key = { value: m[1].toUpperCase() + (m[2] === 'sharp' || m[2] === '#' ? '#' : m[2] === 'flat' ? 'b' : '') + ' ' + m[3], provenance: 'user-explicit' }

    const allow = low.match(/^(.*?)\bbut\s+(.+?)\s+(?:is|are|would be)\s+(?:fine|ok|okay|welcome|allowed)\b/)
    if (allow) {
      const neg = allow[1].replace(/[,\s]+$/, '').match(/^(?:no|without|avoid)\s+(.+)$/)
      if (neg) { req('avoid', stripScope(neg[1]), scope, c); intent.negations.push({ text: stripScope(neg[1]), mode: 'exclusion', scope }) }
      req('prefer', stripScope(allow[2]), scope, c)
      intent.negations.push({ text: stripScope(allow[2]), mode: 'allowance', scope })
      continue
    }
    const fine = low.match(/^(.+?)\s+(?:is|are)\s+(?:fine|ok|okay|welcome)$/)
    if (fine) { req('prefer', stripScope(fine[1]), scope, c); intent.negations.push({ text: stripScope(fine[1]), mode: 'allowance', scope }); continue }

    let consumed = false
    for (const s of low.matchAll(/\bnot\s+(?:too|very|overly|so)\s+([a-z-]+)/g)) {
      req('prefer', 'less ' + s[1], scope, c)
      intent.negations.push({ text: s[1], mode: 'softening', scope })
      consumed = true
    }
    const withoutSoft = low.replace(/\bnot\s+(?:too|very|overly|so)\s+[a-z-]+/g, '')
    for (const p of withoutSoft.split(/,|\band\b(?=\s+(?:no|without|avoid)\b)/)) {
      const e = p.trim().match(/^(?:and\s+)?(?:please\s+)?(?:no|without|avoid|never use|don't (?:use|want|include|add))\s+(.+)$/)
      if (e) {
        const t = stripScope(e[1]).replace(/\s+but\s+.*$/, '')
        const ps = scopeOf(p)
        req('avoid', t, 'section' in ps ? ps : scope, c)
        intent.negations.push({ text: t, mode: 'exclusion', scope: 'section' in ps ? ps : scope })
        consumed = true
      }
    }
    if (consumed) {
      // keep any positive remainder, e.g. "Calm piano" before the comma
      const head = withoutSoft.split(',')[0].trim()
      if (head && !/^(?:and\s+)?(?:please\s+)?(?:no|without|avoid|never|don't)\b/.test(head)) req('prefer', stripScope(head), scope, c)
      continue
    }

    const mk = low.match(new RegExp('^(?:please\\s+)?make\\s+(?:the\\s+)?(?:' + SEC + '|it|this|everything)\\s+(.+)$'))
    if (mk) {
      const sec = low.match(new RegExp('^(?:please\\s+)?make\\s+the\\s+' + SEC + '\\b'))
      req('prefer', mk[mk.length - 1].trim(), sec ? { section: sec[1].replace('prechorus', 'pre-chorus') } : { whole: true }, c)
      continue
    }
    const must = low.match(/\b(?:must|needs? to|has to|have to|definitely|always)\b\s*(.*)$/)
    if (must) { req('must', must[1] || c, scope, c); continue }
    req('prefer', stripScope(c), scope, c)
  }

  const arcSrc = clauses.find((cl) => /->|→|\bthen\b/i.test(cl) || /\b(starts?|begins?|opens?)\b.*(,|\bgrows?\b|\bends?\b)/i.test(cl))
  if (arcSrc) {
    const states = arcSrc
      .split(/\s*(?:,|->|→|\band then\b|\bthen\b|\band\b(?=\s+(?:ends?|finishes|grows?|becomes?|gets?)))\s*/i)
      .map((p) => p.replace(/^(?:it|the song|the track|song|track)?\s*(?:starts?|begins?|opens?|grows?|gets?|becomes?|builds?|turns?|ends?|finishes|goes|resolves?|fades?)\s*(?:as|with|to|into|in|more|a bit|slightly)?\s*/i, '').replace(/^(?:and|to|into)\s+/i, '').trim().toLowerCase())
      .filter((p) => p && p.length < 40)
    if (states.length >= 2) intent.arc = states
  }

  const noVocals = intent.requirements.some((r) => r.kind === 'avoid' && 'whole' in r.scope && /\b(vocals?|singing|singer|lyrics)\b/.test(r.text)) || /\binstrumental\b/i.test(body)
  const wantsVocals = /\b(?:with|add|include)\s+(?:male |female |soft |lead |backing )?(vocals?|singing|singer)\b|\bsung\b/i.test(body.replace(/\b(no|without) vocals?\b/gi, ''))
  if (noVocals) intent.instrumental = true
  else if (intent.hasLyrics || wantsVocals) intent.instrumental = false
  if (noVocals && intent.hasLyrics) intent.conflicts.push('Marked instrumental / no vocals, but lyrics were supplied.')
  if (noVocals && wantsVocals) intent.conflicts.push('Asks for no vocals and also asks for vocals.')

  let k = 0
  const inf = (t: string, confidence: Inferred['confidence'], because: string) => { k++; intent.inferred.push({ id: 'i' + k, text: t, confidence, provenance: 'rule-inference', because }) }
  if (/\blullaby\b/i.test(body)) inf('low energy', 'medium', 'the word "lullaby"')
  if (/\b(workout|gym|pumped up)\b/i.test(body)) inf('high energy', 'medium', 'workout wording')
  if (/\b(study|focus)\b/i.test(body) && intent.instrumental === null) inf('instrumental', 'low', 'study/focus wording')
  if (/\b(cinematic|epic|trailer)\b/i.test(body)) inf('wide dynamic range', 'low', 'cinematic wording')

  if (intent.instrumental === null) intent.questions.push('Should this have vocals, or be instrumental?')
  if (!intent.requirements.length) intent.questions.push('What mood or feeling should it have?')
  return intent
}

export function correct(intent: MusicalIntent, correction: string): MusicalIntent {
  const next: MusicalIntent = JSON.parse(JSON.stringify(intent))
  const text = (correction ?? '').trim()
  if (!text) { next.notes.push('Empty correction ignored.'); return next }
  const bpm = text.toLowerCase().match(/\b(\d{2,3})\s*-?\s*bpm\b/)
  if (bpm) { next.structured.tempoBpm = { value: Number(bpm[1]), provenance: 'user-correction' }; return next }
  const m = text.match(/^(?:i\s+meant\s+|actually,?\s*|no,?\s*|make it\s+)?(.+?),?\s+(?:and\s+)?(?:not|instead of|rather than)\s+(.+?)[.!]*$/i)
  const newText = (m ? m[1] : text).trim().toLowerCase()
  const old = m ? m[2].trim().toLowerCase() : null
  let hit = false
  if (old) {
    for (const r of next.requirements) {
      if (r.text.toLowerCase().includes(old)) { r.text = r.text.toLowerCase().replace(old, newText); r.provenance = 'user-correction'; r.priority = 2; hit = true }
    }
    const before = next.inferred.length
    next.inferred = next.inferred.filter((i) => !i.text.toLowerCase().includes(old))
    if (next.inferred.length !== before) hit = true
  }
  if (!hit) {
    next.requirements.push({ id: 'r' + (next.requirements.length + 1), text: newText, kind: 'prefer', scope: { whole: true }, provenance: 'user-correction', priority: 2, source: text })
    if (old) next.notes.push('Correction target "' + old + '" was not found; the correction was added as a new requirement.')
  }
  return next
}
