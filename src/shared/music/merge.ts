/**
 * Putting one playlist into another, without anybody losing anything.
 *
 * ## A plan before a change, always
 *
 * Nothing here merges. It works out what *would* happen and says so — how many are already there, how many are
 * new, which are different versions of something, what the playlist would end up as. The merge itself happens only
 * after somebody has read that and pressed the button. A playlist is somebody's own ordering of their own music,
 * and changing it without showing the change first is the fastest way to lose their trust in the feature.
 *
 * ## Nothing is removed unless it is asked for
 *
 * `append`, `imported-order`, `keep-order` and `smart` never remove a track. Only `replace` does, it is named so
 * it cannot be chosen by accident, and the plan says in words how many tracks would go. A merge that quietly drops
 * things is indistinguishable from a bug.
 *
 * ## Versions are kept apart
 *
 * The original and the 2019 remaster are two recordings. They are shown as a *conflict* to be decided rather than
 * silently folded together or silently both kept — because which one somebody wants depends on the playlist, and
 * only they know.
 */

import { compare, identityKey, versionLabel, versionOf, type Identifiable } from './identity.ts'

export type Strategy = 'append' | 'imported-order' | 'keep-order' | 'smart' | 'replace'

export const STRATEGIES: readonly { id: Strategy; name: string; what: string; removes: boolean }[] = [
  { id: 'append', name: 'Add to the end', what: 'New tracks go after what is already there. Nothing moves.', removes: false },
  { id: 'imported-order', name: "Use the other playlist's order", what: 'The imported order wins, and anything of yours it does not mention goes after.', removes: false },
  { id: 'keep-order', name: 'Keep your order', what: 'Your playlist stays exactly as it is, and new tracks are added at the end.', removes: false },
  { id: 'smart', name: 'Work it out', what: 'New tracks go next to the ones they sit beside in the other playlist, where that is unambiguous.', removes: false },
  { id: 'replace', name: 'Replace mine with theirs', what: 'Your playlist becomes the imported one. What you had is kept in the snapshot.', removes: true }
]

export type DuplicateRule =
  | 'keep-all'
  | 'drop-exact'
  | 'drop-canonical'
  | 'prefer-original'
  | 'prefer-remaster'
  | 'prefer-local'
  | 'drop-consecutive'

export const DUPLICATE_RULES: readonly { id: DuplicateRule; name: string; what: string }[] = [
  { id: 'keep-all', name: 'Keep everything', what: 'Even the same track twice, if that is what the playlists say.' },
  { id: 'drop-exact', name: 'Drop exact repeats', what: 'The same recording twice becomes once.' },
  { id: 'drop-canonical', name: 'Drop every version but one', what: 'The original, a remaster and a live take become one track.' },
  { id: 'prefer-original', name: 'Prefer the original', what: 'Where there are versions, keep the original.' },
  { id: 'prefer-remaster', name: 'Prefer the remaster', what: 'Where there are versions, keep the newest remaster.' },
  { id: 'prefer-local', name: 'Prefer my own file', what: 'Where you own the file, keep that one.' },
  { id: 'drop-consecutive', name: 'Drop only back-to-back repeats', what: 'The same track twice in a row becomes once; twice across the playlist stays.' }
]

export interface MergeTrack extends Identifiable {
  id: string
  /** Where this one came from, kept for ever on the row. */
  source: string
  /** True when Orbis has the file, which is what "prefer my own" means. */
  local?: boolean
}

export type ConflictKind = 'version' | 'ambiguous' | 'unavailable' | 'already-present'

export interface Conflict {
  kind: ConflictKind
  /** What the imported playlist asked for. */
  wanted: MergeTrack
  /** What is already there, or what it might be. */
  against: readonly MergeTrack[]
  says: string
}

export interface MergePlan {
  /** What goes in, in the order it would go in. */
  result: readonly MergeTrack[]
  /** The playlist as it is now, so a screen can show both. */
  before: readonly MergeTrack[]
  strategy: Strategy
  duplicates: DuplicateRule
  added: readonly MergeTrack[]
  /** Already in the destination, so nothing happens to them. */
  alreadyThere: readonly MergeTrack[]
  /** Dropped by the duplicate rule, with the rule that dropped them. */
  dropped: readonly { track: MergeTrack; why: string }[]
  /** Would be removed. Only ever non-empty for `replace`. */
  removed: readonly MergeTrack[]
  conflicts: readonly Conflict[]
  /** The sentence shown above the button. */
  says: string
  /** True when anything at all would be lost, which is what makes the button a confirmation. */
  destructive: boolean
}

const sameRecording = (a: Identifiable, b: Identifiable): boolean => identityKey(a) === identityKey(b)

const sameSong = (a: Identifiable, b: Identifiable): boolean => {
  const verdict = compare(a, b).verdict
  return verdict !== 'new-track'
}

/** Which of two versions a rule prefers. Null when the rule has no opinion about this pair. */
function preferred(rule: DuplicateRule, a: MergeTrack, b: MergeTrack): MergeTrack | null {
  if (rule === 'prefer-local') {
    if (a.local && !b.local) return a
    if (b.local && !a.local) return b
    return null
  }
  if (rule === 'prefer-original') {
    const left = versionOf(a.title).kind
    const right = versionOf(b.title).kind
    if (left === 'original' && right !== 'original') return a
    if (right === 'original' && left !== 'original') return b
    return null
  }
  if (rule === 'prefer-remaster') {
    const left = versionOf(a.title)
    const right = versionOf(b.title)
    if (left.kind === 'remaster' && right.kind !== 'remaster') return a
    if (right.kind === 'remaster' && left.kind !== 'remaster') return b
    return null
  }
  return null
}

/**
 * What a merge would do.
 *
 * Deliberately total: every imported track ends up in exactly one of `added`, `alreadyThere`, `dropped` or a
 * conflict, so the counts on the screen add up to the number of tracks somebody can see in the source playlist.
 * A plan whose numbers do not add up is a plan nobody can check.
 */
export function planMerge(options: {
  destination: readonly MergeTrack[]
  incoming: readonly MergeTrack[]
  strategy: Strategy
  duplicates: DuplicateRule
  /** Tracks the source named that cannot be played anywhere. Carried through as conflicts, never dropped quietly. */
  unavailable?: readonly MergeTrack[]
}): MergePlan {
  const { destination, incoming, strategy, duplicates } = options
  const unavailable = options.unavailable ?? []

  const added: MergeTrack[] = []
  const alreadyThere: MergeTrack[] = []
  const dropped: { track: MergeTrack; why: string }[] = []
  const conflicts: Conflict[] = []

  const unavailableIds = new Set(unavailable.map((one) => one.id))

  for (const one of incoming) {
    if (unavailableIds.has(one.id)) {
      conflicts.push({
        kind: 'unavailable',
        wanted: one,
        against: [],
        says: 'Nothing Orbis is connected to can play this one. It is kept as a reference.'
      })
      // Still added: a reference somebody can see is better than a track that silently disappeared.
      added.push(one)
      continue
    }

    const exact = destination.find((two) => sameRecording(two, one))
    if (exact) {
      alreadyThere.push(one)
      continue
    }

    const otherVersion = destination.find((two) => sameSong(two, one))
    if (otherVersion) {
      if (duplicates === 'drop-canonical') {
        dropped.push({ track: one, why: `Another version is already there (${versionLabel(versionOf(otherVersion.title))}).` })
        continue
      }
      const pick = preferred(duplicates, one, otherVersion)
      if (pick === otherVersion) {
        dropped.push({ track: one, why: 'The version already in the playlist is the preferred one.' })
        continue
      }
      if (pick === one) {
        // Replacing a version is a change to what is there, so it is a conflict to confirm rather than a silent swap.
        conflicts.push({
          kind: 'version',
          wanted: one,
          against: [otherVersion],
          says: `You have ${versionLabel(versionOf(otherVersion.title))}; this is ${versionLabel(versionOf(one.title))}.`
        })
        added.push(one)
        continue
      }
      conflicts.push({
        kind: 'version',
        wanted: one,
        against: [otherVersion],
        says: `A different version of this is already in the playlist (${versionLabel(versionOf(otherVersion.title))}).`
      })
      added.push(one)
      continue
    }

    added.push(one)
  }

  // ---- duplicates inside the incoming list itself
  const kept: MergeTrack[] = []
  for (const one of added) {
    if (duplicates === 'keep-all') {
      kept.push(one)
      continue
    }
    if (duplicates === 'drop-consecutive') {
      const last = kept[kept.length - 1]
      if (last && sameRecording(last, one)) {
        dropped.push({ track: one, why: 'The same track twice in a row.' })
        continue
      }
      kept.push(one)
      continue
    }
    const already = kept.find((two) => (duplicates === 'drop-canonical' ? sameSong(two, one) : sameRecording(two, one)))
    if (already) {
      dropped.push({ track: one, why: 'Already in this import.' })
      continue
    }
    kept.push(one)
  }

  // ---- the resulting order
  let result: MergeTrack[]
  let removed: MergeTrack[] = []

  switch (strategy) {
    case 'replace':
      result = [...kept]
      // Everything of theirs that the import does not mention is going. Said plainly, and kept in the snapshot.
      removed = destination.filter((one) => !kept.some((two) => sameRecording(one, two)))
      break
    case 'imported-order': {
      const mine = destination.filter((one) => !incoming.some((two) => sameRecording(one, two)))
      const theirs = incoming.map((one) => destination.find((two) => sameRecording(two, one)) ?? kept.find((two) => sameRecording(two, one))).filter((one): one is MergeTrack => !!one)
      result = [...dedupe(theirs), ...mine]
      break
    }
    case 'smart': {
      /*
       * Each new track goes after the track it follows in the source, when that track is in the destination.
       *
       * It is the least surprising place for it: somebody who put two songs together in Spotify meant them to sit
       * together. Where the neighbour is not there, it falls back to the end rather than guessing.
       */
      result = [...destination]
      for (const one of kept) {
        const at = incoming.findIndex((two) => two.id === one.id)
        const before = at > 0 ? incoming[at - 1] : null
        const anchor = before ? result.findIndex((two) => sameRecording(two, before)) : -1
        if (anchor >= 0) result.splice(anchor + 1, 0, one)
        else result.push(one)
      }
      break
    }
    case 'keep-order':
    case 'append':
    default:
      result = [...destination, ...kept]
      break
  }

  const destructive = removed.length > 0
  const says = destructive
    ? `${kept.length} added, and ${removed.length} of yours removed. What you had is kept in the snapshot.`
    : `${destination.length} now, ${kept.length} added, ${result.length} after. Nothing of yours is removed.`

  return {
    result,
    before: destination,
    strategy,
    duplicates,
    added: kept,
    alreadyThere,
    dropped,
    removed,
    conflicts,
    says,
    destructive
  }
}

function dedupe(tracks: readonly MergeTrack[]): MergeTrack[] {
  const out: MergeTrack[] = []
  for (const one of tracks) if (!out.some((two) => sameRecording(two, one))) out.push(one)
  return out
}

// ---------------------------------------------------------------- several playlists at once

export interface BulkRow {
  sourceId: string
  sourceName: string
  /** The destination playlist id, or null for "make a new one". */
  destinationId: string | null
  destinationName: string
  action: 'merge' | 'create' | 'skip'
}

export interface BulkSummary {
  merges: number
  creates: number
  skips: number
  sourceTracks: number
  newTracks: number
  conflicts: number
  says: string
}

export function summariseBulk(rows: readonly BulkRow[], plans: ReadonlyMap<string, MergePlan>): BulkSummary {
  const merges = rows.filter((one) => one.action === 'merge').length
  const creates = rows.filter((one) => one.action === 'create').length
  const skips = rows.filter((one) => one.action === 'skip').length
  let sourceTracks = 0
  let newTracks = 0
  let conflicts = 0
  for (const row of rows) {
    if (row.action === 'skip') continue
    const plan = plans.get(row.sourceId)
    if (!plan) continue
    sourceTracks += plan.added.length + plan.alreadyThere.length + plan.dropped.length
    newTracks += plan.added.length
    conflicts += plan.conflicts.length
  }
  return {
    merges,
    creates,
    skips,
    sourceTracks,
    newTracks,
    conflicts,
    says: `${merges + creates} playlists, ${newTracks} new tracks${conflicts > 0 ? `, ${conflicts} to look at` : ''}.`
  }
}

// ---------------------------------------------------------------- putting it back

export interface Snapshot {
  playlistId: string
  takenAt: number
  name: string
  tracks: readonly string[]
  /** What the merge was, in words, for the row in the history. */
  because: string
}

export function snapshotOf(playlistId: string, name: string, tracks: readonly string[], because: string, now: number): Snapshot {
  return { playlistId, name, tracks: [...tracks], takenAt: now, because }
}

/**
 * Whether a snapshot can still be put back.
 *
 * It cannot if the playlist has been edited since, because putting it back would then throw away work done after
 * the merge — which is the thing undo is supposed to prevent, not cause.
 */
export function canUndo(snapshot: Snapshot, playlistUpdatedAt: number, lastMergeAt: number | null): { can: boolean; why: string } {
  if (lastMergeAt === null) return { can: false, why: 'Nothing has been merged into this playlist.' }
  if (playlistUpdatedAt > lastMergeAt + 1000) {
    return { can: false, why: 'This playlist has been edited since the merge, so putting it back would undo that too.' }
  }
  return { can: true, why: `Puts it back to ${snapshot.tracks.length} tracks.` }
}
