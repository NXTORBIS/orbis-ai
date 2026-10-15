// Review state is kept against the exact audio (its sha256), so changing a version's audio never inherits an approval.
export type ApprovalState = 'draft' | 'review' | 'approved' | 'exported'
export interface ApprovalEntry { state: ApprovalState; by?: string; at: number; note?: string }
export type ApprovalRecord = Record<string, ApprovalEntry>

const ORDER: Record<ApprovalState, ApprovalState[]> = {
  draft: ['review', 'approved'],
  review: ['draft', 'approved'],
  approved: ['review', 'draft', 'exported'],
  exported: ['approved', 'review', 'draft']
}
const HEX = /^[0-9a-f]{64}$/

export const stateOf = (r: ApprovalRecord, sha256: string): ApprovalState => r[sha256]?.state ?? 'draft'
export const canMove = (from: ApprovalState, to: ApprovalState): boolean => from !== to && ORDER[from].includes(to)

export function setApproval(r: ApprovalRecord, sha256: string, to: ApprovalState, now: number, by?: string, note?: string): { ok: true; record: ApprovalRecord } | { ok: false; reason: string } {
  if (!HEX.test(sha256)) return { ok: false, reason: 'That is not a known audio file.' }
  const from = stateOf(r, sha256)
  if (!canMove(from, to)) return { ok: false, reason: `A ${from} version cannot move to ${to}.` }
  return { ok: true, record: { ...r, [sha256]: { state: to, by, at: now, note } } }
}

/** The state a version shows: the one given to its current audio, never one given to older audio. */
export function versionState(r: ApprovalRecord, version: { artifactId: string }, artifacts: readonly { id: string; sha256: string }[]): ApprovalState {
  const a = artifacts.find((x) => x.id === version.artifactId)
  return a ? stateOf(r, a.sha256) : 'draft'
}

/** Drops entries for audio no version uses any more. */
export function pruneApprovals(r: ApprovalRecord, liveSha: Iterable<string>): ApprovalRecord {
  const keep = new Set(liveSha)
  return Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k)))
}

export interface DeliveryInput { sourceExists: boolean; decodable: boolean; metadataTitle: string; destinationWritable: boolean; formatSupported: boolean }
export function checkDelivery(i: DeliveryInput): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = []
  const warnings: string[] = []
  if (!i.sourceExists) blocking.push('The audio file is missing.')
  else if (!i.decodable) blocking.push('The audio file cannot be read as audio.')
  if (!i.destinationWritable) blocking.push('The destination cannot be written to.')
  if (!i.formatSupported) blocking.push('That format is not supported.')
  if (!i.metadataTitle.trim()) warnings.push('The song has no title, so a generic file name will be used.')
  return { blocking, warnings }
}
