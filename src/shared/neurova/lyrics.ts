// Lyric structure and diagnostics. The original text is kept byte-for-byte; nothing here rewrites it.

export type SectionType = 'intro' | 'verse' | 'pre-chorus' | 'chorus' | 'post-chorus' | 'bridge' | 'breakdown' | 'instrumental' | 'solo' | 'interlude' | 'outro' | 'free'

export interface LyricSection {
  id: string
  label: string
  type: SectionType
  lines: string[]
  /** 0-based line in the original text where the marker (or first line, if unlabelled) sits. */
  at: number
}

export interface LyricDocument {
  /** Exactly what was supplied. */
  original: string
  sections: LyricSection[]
  labelled: boolean
  warnings: string[]
}

const MARKER = /^\s*\[([^\]\n]{1,60})\]\s*$/

const TYPES: [RegExp, SectionType][] = [
  [/^pre[\s-]?chorus/i, 'pre-chorus'],
  [/^post[\s-]?chorus/i, 'post-chorus'],
  [/^(chorus|refrain|hook)/i, 'chorus'],
  [/^verse/i, 'verse'],
  [/^intro/i, 'intro'],
  [/^(outro|coda)/i, 'outro'],
  [/^bridge/i, 'bridge'],
  [/^break/i, 'breakdown'],
  [/^instrumental/i, 'instrumental'],
  [/^solo/i, 'solo'],
  [/^interlude/i, 'interlude']
]

export const typeOf = (label: string): SectionType => TYPES.find(([re]) => re.test(label.trim()))?.[1] ?? 'free'

export function parseLyrics(text: string): LyricDocument {
  const raw = text ?? ''
  const rows = raw.split(/\r?\n/)
  const sections: LyricSection[] = []
  const warnings: string[] = []
  let cur: LyricSection | null = null
  let labelled = false
  rows.forEach((row, i) => {
    const m = MARKER.exec(row)
    if (m) {
      labelled = true
      cur = { id: `s${sections.length + 1}`, label: m[1].trim(), type: typeOf(m[1]), lines: [], at: i }
      sections.push(cur)
      return
    }
    if (!row.trim()) return
    if (!cur) {
      cur = { id: `s${sections.length + 1}`, label: 'Lyrics', type: 'free', lines: [], at: i }
      sections.push(cur)
    }
    cur.lines.push(row)
  })
  for (const s of sections) {
    if (!s.lines.length && s.type !== 'instrumental' && s.type !== 'solo' && s.type !== 'interlude' && s.type !== 'intro' && s.type !== 'breakdown') {
      warnings.push(`"${s.label}" has no lines under it.`)
    }
  }
  if (labelled && rows.some((r, i) => r.trim() && !MARKER.test(r) && !sections.some((s) => s.at <= i))) {
    warnings.push('Some lines come before the first section marker; they are kept as their own section.')
  }
  const names = sections.map((s) => s.label.toLowerCase())
  if (new Set(names).size !== names.length) warnings.push('Some section names repeat; they are treated as repeats, not merged.')
  return { original: raw, sections, labelled, warnings }
}

const VOWELS = /[aeiouyàáâäãåæèéêëìíîïòóôöõùúûüœ]+/gi

/** Rough syllable count. Reliable only for English-like spellings; says so through `approximate`. */
export function syllables(line: string): { count: number; approximate: boolean } {
  const words = line.toLowerCase().match(/[\p{L}']+/gu) ?? []
  const nonLatin = /[^\u0000-ɏ\s\p{P}\p{N}]/u.test(line)
  let total = 0
  for (const w of words) {
    let n = (w.match(VOWELS) ?? []).length
    if (/[^aeiouy]e$/.test(w) && n > 1) n--
    total += Math.max(1, n)
  }
  return { count: nonLatin ? 0 : total, approximate: true }
}

export interface LyricNotice { section: string; line?: number; message: string }

/** Conservative notices about singability. Each is a possibility, never a verdict. */
export function diagnose(doc: LyricDocument): LyricNotice[] {
  const out: LyricNotice[] = []
  for (const s of doc.sections) {
    const counts = s.lines.map((l) => syllables(l).count).filter((n) => n > 0)
    if (counts.length < 3) continue
    const sorted = [...counts].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    s.lines.forEach((l, i) => {
      const c = syllables(l).count
      if (median > 0 && c > median * 1.8 && c - median >= 6) {
        out.push({ section: s.label, line: i + 1, message: `This line has about ${c} syllables against a typical ${median} in the section, so it may be hard to fit to the same phrase.` })
      }
    })
    const words = s.lines.join(' ').toLowerCase().match(/[\p{L}']+/gu) ?? []
    for (let i = 0; i + 2 < words.length; i++) {
      if (words[i] === words[i + 1] && words[i] === words[i + 2] && words[i].length > 2) {
        out.push({ section: s.label, message: `"${words[i]}" appears three times in a row; check this is meant.` })
        break
      }
    }
  }
  return out
}

/** The section order the singer is expected to follow, taken from the markers as written. */
export const order = (doc: LyricDocument): string[] => doc.sections.map((s) => s.label)
