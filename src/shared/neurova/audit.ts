// Intent-versus-evidence auditor. It never says a request was met unless a real measurement says so,
// and it always states what was asked, what was seen, and what that does not prove.
import type { AudioInfo } from './audio.ts'
import type { Tempo } from './process.ts'
import type { EndingKind } from './analysis.ts'

export type RequirementKind = 'verifiable' | 'conditioning' | 'assessable' | 'subjective' | 'unsupported'
export type AuditStatus =
  | 'verified' | 'likely-consistent' | 'potential-mismatch' | 'not-verified'
  | 'unsupported' | 'requires-listening' | 'user-confirmed' | 'user-rejected'
export type EvidenceReliability = 'low' | 'moderate' | 'high'

export interface Requirement {
  id: string
  text: string
  kind: RequirementKind
  /** The user said it, as opposed to Orbis inferring it. */
  explicit: boolean
  /** It was only passed to the generator as guidance; nothing forces the output to follow it. */
  conditioned: boolean
}

export interface Evidence {
  requirementId: string
  source: 'measurement' | 'estimate' | 'user'
  /** What was found, in plain terms (e.g. 'about 122 BPM'). Shown to the user verbatim. */
  value: string | number | boolean
  reliability: EvidenceReliability
  /** Whether the finding agrees with the request. Undefined when the caller cannot say. */
  matches?: boolean
  /** For source 'user': the person's own judgement. */
  userVerdict?: 'confirmed' | 'rejected'
  /** What this evidence cannot establish. */
  limitation?: string
}

export interface AuditEntry {
  requirementId: string
  status: AuditStatus
  explanation: string
  requested: string
  measured: string
  doesNotProve: string
}

function describe(e: Evidence): string {
  return `${e.source === 'measurement' ? 'Measured' : e.source === 'estimate' ? 'Estimated' : 'You said'}: ${String(e.value)} (${e.reliability} reliability)`
}

function entry(r: Requirement, status: AuditStatus, measured: string, doesNotProve: string): AuditEntry {
  const requested = `${r.explicit ? 'You asked for' : 'Inferred from your request'}: ${r.text}`
  return {
    requirementId: r.id, status, requested, measured, doesNotProve,
    explanation: `${requested}. ${measured}. What this does not prove: ${doesNotProve}`,
  }
}

const RANK: Record<string, number> = { low: 0, moderate: 1, high: 2 }

export function auditRequirements(reqs: Requirement[], evidence: Evidence[]): AuditEntry[] {
  return reqs.map((r) => {
    const ev = evidence.filter((e) => e.requirementId === r.id)
    const user = ev.find((e) => e.source === 'user' && e.userVerdict)
    if (r.kind === 'unsupported') {
      return entry(r, 'unsupported', 'Orbis has no way to produce or check this',
        'anything about whether the result has this quality; it was not attempted as a guarantee.')
    }
    if (user) {
      return entry(r, user.userVerdict === 'confirmed' ? 'user-confirmed' : 'user-rejected',
        `You judged it by listening: ${user.userVerdict}`,
        'that it holds for other listeners, or that any measurement agrees.')
    }
    if (r.kind === 'subjective') {
      const m = ev.filter((e) => e.source !== 'user')
      return entry(r, 'requires-listening',
        m.length ? `Related readings exist (${m.map(describe).join('; ')}) but taste cannot be measured` : 'Nothing measurable stands in for this',
        'whether it sounds the way you meant; only listening settles that.')
    }
    if (ev.length === 0) {
      const why = r.kind === 'conditioning' || r.conditioned
        ? 'It was given to the generator as guidance only and has not been checked afterwards'
        : 'No check has been run'
      return entry(r, 'not-verified', why, 'that the result follows the request.')
    }
    // Use the strongest piece of non-user evidence; measurements outrank estimates.
    const sorted = [...ev].sort((a, b) =>
      (a.source === 'measurement' ? 1 : 0) !== (b.source === 'measurement' ? 1 : 0)
        ? (b.source === 'measurement' ? 1 : 0) - (a.source === 'measurement' ? 1 : 0)
        : RANK[b.reliability] - RANK[a.reliability])
    const best = sorted[0]
    const measured = describe(best)
    const lim = best.limitation ?? (best.source === 'measurement'
      ? 'anything about how it sounds beyond this one figure.'
      : 'the claim itself; an estimate can be wrong, and the method has known blind spots.')
    if (best.matches === undefined) {
      return entry(r, 'not-verified', `${measured}, but it was not compared with the request`, lim)
    }
    const conditioningOnly = r.kind === 'conditioning' || (r.conditioned && best.source !== 'measurement')
    const canVerify = r.kind === 'verifiable' && best.source === 'measurement' && best.reliability !== 'low' && !conditioningOnly
    if (best.matches) {
      return entry(r, canVerify ? 'verified' : 'likely-consistent', measured,
        canVerify ? lim : `${lim} Only a direct, reliable measurement of a checkable property counts as verified.`)
    }
    return entry(r, 'potential-mismatch', measured,
      `${lim} It points away from the request but is not proof of failure${best.reliability === 'low' ? ' (low reliability)' : ''}.`)
  })
}

// ---------------------------------------------------------------- diagnostics
export interface Diagnostic {
  id: string
  severity: 'info' | 'notice' | 'warning' | 'error'
  summary: string
  evidence: string
  suggestion: string
  dismissed: boolean
  /** The measured numbers behind the finding. Kept when the finding is dismissed. */
  measurement?: Record<string, number | string>
}

const fmt = (n: number, p = 2): string => String(Math.round(n * 10 ** p) / 10 ** p)

export function diagnostics(info: AudioInfo, tempo?: Tempo | null, ending?: EndingKind | null): Diagnostic[] {
  const out: Diagnostic[] = []
  if (info.frames === 0 || info.durationSec <= 0) {
    out.push({
      id: 'empty', severity: 'error', summary: 'The file holds no audio.', dismissed: false,
      evidence: `Frames: ${info.frames}.`, suggestion: 'Generate or import again.',
      measurement: { frames: info.frames },
    })
    return out
  }
  if (info.peak === 0) {
    out.push({
      id: 'silent', severity: 'error', summary: 'Every sample is exactly zero.', dismissed: false,
      evidence: `Largest sample is 0 across ${fmt(info.durationSec)} s.`, suggestion: 'Discard this version; nothing is audible.',
      measurement: { peak: 0, durationSec: info.durationSec },
    })
  }
  if (info.durationSec > 0 && info.durationSec < 1) {
    out.push({
      id: 'very-short', severity: 'notice', summary: 'The audio is under one second long.', dismissed: false,
      evidence: `Duration ${fmt(info.durationSec, 3)} s.`, suggestion: 'If you expected a full piece, the generation may have been cut off.',
      measurement: { durationSec: info.durationSec },
    })
  }
  if (info.clippedSamples > 0) {
    out.push({
      id: 'clipping', severity: info.clippedSamples > 100 ? 'warning' : 'notice',
      summary: `${info.clippedSamples} samples sit at full scale.`, dismissed: false,
      evidence: `${info.clippedSamples} samples at or above 0.999 of full scale; peak ${fmt(info.peak, 4)}.`,
      suggestion: 'Lower the gain a little. Whether the clipping is audible depends on how many samples and where.',
      measurement: { clippedSamples: info.clippedSamples, peak: info.peak },
    })
  }
  if (info.lowEnergy.length > 0) {
    const total = info.lowEnergy.reduce((a, s) => a + (s.endSec - s.startSec), 0)
    out.push({
      id: 'quiet-stretches', severity: 'info',
      summary: `${info.lowEnergy.length} very quiet stretch${info.lowEnergy.length === 1 ? '' : 'es'} found.`, dismissed: false,
      evidence: `${fmt(total, 1)} s total below ${info.lowEnergyThresholdDb} dB, e.g. ${fmt(info.lowEnergy[0].startSec, 1)} s to ${fmt(info.lowEnergy[0].endSec, 1)} s.`,
      suggestion: 'Fine if the quiet is intentional. Otherwise trim it or generate again.',
      measurement: { stretches: info.lowEnergy.length, totalSec: total, thresholdDb: info.lowEnergyThresholdDb },
    })
  }
  if (info.warnings.some((w) => /trunc|shorter|declared|cut/i.test(w))) {
    out.push({
      id: 'truncated', severity: 'warning', summary: 'The file looks cut off.', dismissed: false,
      evidence: info.warnings.filter((w) => /trunc|shorter|declared|cut/i.test(w)).join(' '),
      suggestion: 'The end may be missing. Re-export or generate again.',
      measurement: { warnings: info.warnings.length },
    })
  }
  if (ending && ending.kind === 'abrupt' && info.durationSec >= 5) {
    out.push({
      id: 'abrupt-ending', severity: 'notice', summary: 'The audio seems to stop while still loud.', dismissed: false,
      evidence: `Final 50 ms level ${fmt(ending.finalLevelDb, 1)} dB, slope ${fmt(ending.slopeDbPerSec, 1)} dB/s (${ending.reliability} reliability).`,
      suggestion: 'A short fade-out would soften it. This cannot tell a cut from a deliberate hard stop.',
      measurement: { finalLevelDb: ending.finalLevelDb, slopeDbPerSec: ending.slopeDbPerSec },
    })
  }
  if (tempo && tempo.reliability === 'low') {
    out.push({
      id: 'tempo-unclear', severity: 'info', summary: 'No clear tempo stands out.', dismissed: false,
      evidence: `Best reading ${fmt(tempo.bpm, 0)} BPM, low reliability; alternatives ${tempo.alternatives.map((a) => fmt(a, 0)).join(', ') || 'none'}.`,
      suggestion: 'Do not rely on this figure for syncing or time-stretching.',
      measurement: { bpm: tempo.bpm },
    })
  }
  return out
}

/** Marks one diagnostic dismissed. The measurement and evidence stay attached. */
export function dismiss(list: Diagnostic[], id: string): Diagnostic[] {
  return list.map((d) => (d.id === id ? { ...d, dismissed: true } : d))
}
