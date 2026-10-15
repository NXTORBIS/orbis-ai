// Ranking and exploring candidates without inventing certainty.
// Missing evidence is never counted as a pass, and nothing here produces a single "quality" number.

export type Status = 'verified' | 'likely' | 'possible-deviation' | 'violation' | 'unknown'

export interface Evidence { candidate: string; criterion: string; status: Status; note?: string }

export interface Candidate { id: string; sha256?: string; preference?: 'strong' | 'prefer' | null; rejected?: boolean }

export interface Ranked {
  id: string
  /** 1 = first. Equal standing shares a position. */
  position: number
  met: number
  unknown: number
  deviations: number
  violations: string[]
  /** How much of the asked-for evidence exists at all, 0..1. Not a quality measure. */
  completeness: number
  reasons: string[]
}

export function rank(cands: Candidate[], evidence: Evidence[], criteria: string[], hard: string[]): Ranked[] {
  const rows = cands.filter((c) => !c.rejected).map((c) => {
    const mine = evidence.filter((e) => e.candidate === c.id && criteria.includes(e.criterion))
    const statusOf = (k: string): Status => mine.find((e) => e.criterion === k)?.status ?? 'unknown'
    const met = criteria.filter((k) => ['verified', 'likely'].includes(statusOf(k))).length
    const unknown = criteria.filter((k) => statusOf(k) === 'unknown').length
    const deviations = criteria.filter((k) => statusOf(k) === 'possible-deviation').length
    const violations = hard.filter((k) => statusOf(k) === 'violation')
    const reasons: string[] = []
    if (violations.length) reasons.push(`Verified violation of: ${violations.join(', ')}.`)
    if (c.preference === 'strong') reasons.push('You strongly prefer this one.')
    else if (c.preference === 'prefer') reasons.push('You prefer this one.')
    if (unknown) reasons.push(`${unknown} of ${criteria.length} criteria could not be checked.`)
    if (deviations) reasons.push(`${deviations} possible deviation${deviations === 1 ? '' : 's'}.`)
    return { id: c.id, met, unknown, deviations, violations, completeness: criteria.length ? (criteria.length - unknown) / criteria.length : 0, reasons, pref: c.preference === 'strong' ? 2 : c.preference === 'prefer' ? 1 : 0 }
  })
  rows.sort((a, b) => (a.violations.length ? 1 : 0) - (b.violations.length ? 1 : 0) || b.pref - a.pref || b.met - a.met || a.deviations - b.deviations)
  let pos = 0
  let prev = ''
  return rows.map((r, i) => {
    const key = `${r.violations.length > 0}|${r.pref}|${r.met}|${r.deviations}`
    if (key !== prev) { pos = i + 1; prev = key }
    const { pref: _p, ...rest } = r
    return { ...rest, position: pos }
  })
}

export interface Experiment { id: string; axis: string; summary: string; preserved: string[]; changed: string[]; notGuaranteed: string[] }

/** One experiment per axis. An axis the user locked is refused rather than varied. */
export function planExperiments(axes: string[], fixed: string[], baseline: string): { experiments: Experiment[]; refused: string[] } {
  const refused = axes.filter((a) => fixed.includes(a))
  const experiments = axes.filter((a) => !fixed.includes(a)).map((axis, i) => ({
    id: `exp-${i + 1}`,
    axis,
    summary: `Vary ${axis} from ${baseline}, keeping everything you locked.`,
    preserved: [...fixed],
    changed: [axis],
    notGuaranteed: ['Other qualities may also differ: the engine makes a whole new recording.']
  }))
  return { experiments, refused }
}

export const isDuplicate = (cands: Candidate[], sha256: string): string | null => cands.find((c) => c.sha256 === sha256)?.id ?? null

export const MAX_CANDIDATES = 24
