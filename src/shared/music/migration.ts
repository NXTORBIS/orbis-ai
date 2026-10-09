/**
 * Moving a library in, as a job that can be interrupted.
 *
 * ## Why a job and not a function
 *
 * Bringing in 4,000 tracks over a rate-limited API takes minutes. The machine sleeps, the network drops, somebody
 * closes the window. A function would start again from nothing each time; a job remembers which phase it reached
 * and which playlists it finished, so resuming continues rather than re-imports.
 *
 * ## Progress is counted, never animated
 *
 * `progress()` is computed from work actually completed. There is no timer that advances a bar to look busy, and
 * nothing reaches 100 until the last phase is done — a bar that sits at 100% while work continues is a lie about
 * the one thing somebody is watching.
 *
 * ## Re-importing the same source changes nothing
 *
 * Every imported track carries where it came from, and `alreadyImported` is checked before anything is added. So
 * running the same import twice adds nothing the second time, which is what makes a resumed job safe: the parts
 * that finished are simply skipped.
 */

export type Phase = 'connect' | 'discover' | 'fetch' | 'match' | 'plan' | 'import' | 'verify' | 'done'

export const PHASES: readonly { id: Phase; name: string; what: string }[] = [
  { id: 'connect', name: 'Connecting', what: 'Checking the service is still reachable.' },
  { id: 'discover', name: 'Finding playlists', what: 'Asking which playlists are there.' },
  { id: 'fetch', name: 'Reading them', what: 'Reading the tracks out of each playlist.' },
  { id: 'match', name: 'Matching', what: 'Finding each track in your library.' },
  { id: 'plan', name: 'Working out the changes', what: 'Deciding what would be added, and what needs a look.' },
  { id: 'import', name: 'Adding them', what: 'Putting the tracks into your playlists.' },
  { id: 'verify', name: 'Checking', what: 'Reading back what was written.' },
  { id: 'done', name: 'Finished', what: '' }
]

export type Status = 'waiting' | 'running' | 'paused' | 'needs-you' | 'finished' | 'stopped' | 'failed'

export interface JobPlaylist {
  /** The source's own id. Used for resuming, so it must come from the source and not be made up. */
  sourceId: string
  name: string
  /** Null until the playlist has been read. */
  trackCount: number | null
  state: 'waiting' | 'reading' | 'matching' | 'importing' | 'done' | 'skipped' | 'failed'
  matched: number
  ambiguous: number
  unmatched: number
  added: number
  /** Why it was skipped or failed, in words. */
  why: string | null
}

export interface Job {
  id: string
  provider: string
  startedAt: number
  /** Null while it is still going. */
  endedAt: number | null
  status: Status
  phase: Phase
  playlists: JobPlaylist[]
  /** The sentence shown when the job is waiting on a person. */
  needs: string | null
  /** What went wrong, when the whole job failed. */
  failed: string | null
  /** Rows that could not be matched, carried to the unmatched centre rather than forgotten. */
  unmatchedTotal: number
  /** Set once the job has been resumed, so the history can say so. */
  resumedAt: number | null
}

export function newJob(id: string, provider: string, now: number): Job {
  return {
    id,
    provider,
    startedAt: now,
    endedAt: null,
    status: 'waiting',
    phase: 'connect',
    playlists: [],
    needs: null,
    failed: null,
    unmatchedTotal: 0,
    resumedAt: null
  }
}

/**
 * How far along, 0..1.
 *
 * Weighted by phase so the bar does not jump: discovery is quick and importing is not, and a bar that spends 90%
 * of its travel on the first 10% of the work is worse than no bar.
 */
const WEIGHTS: Readonly<Record<Phase, number>> = {
  connect: 0.02,
  discover: 0.05,
  fetch: 0.28,
  match: 0.3,
  plan: 0.05,
  import: 0.25,
  verify: 0.05,
  done: 0
}

export function progress(job: Job): { done: number; says: string } {
  const order = PHASES.map((one) => one.id)
  const at = order.indexOf(job.phase)
  if (job.phase === 'done') return { done: 1, says: 'Finished.' }

  let before = 0
  for (let i = 0; i < at; i += 1) before += WEIGHTS[order[i]]

  // Inside the current phase, count the playlists that have passed it.
  const total = job.playlists.length
  const past = (states: readonly JobPlaylist['state'][]): number => job.playlists.filter((one) => states.includes(one.state)).length
  let within = 0
  if (total > 0) {
    if (job.phase === 'fetch') within = past(['matching', 'importing', 'done', 'skipped', 'failed']) / total
    else if (job.phase === 'match') within = past(['importing', 'done', 'skipped', 'failed']) / total
    else if (job.phase === 'import') within = past(['done', 'skipped', 'failed']) / total
  }

  const done = Math.min(0.99, before + WEIGHTS[job.phase] * within)
  const phase = PHASES.find((one) => one.id === job.phase)
  const counted = total > 0 && (job.phase === 'fetch' || job.phase === 'match' || job.phase === 'import')
  return {
    done,
    says: counted ? `${phase?.name} — ${Math.round(within * total)} of ${total} playlists.` : (phase?.name ?? 'Working')
  }
}

export function totals(job: Job): { playlists: number; tracks: number; added: number; matched: number; needLook: number; unmatched: number } {
  return {
    playlists: job.playlists.filter((one) => one.state === 'done').length,
    tracks: job.playlists.reduce((sum, one) => sum + (one.trackCount ?? 0), 0),
    added: job.playlists.reduce((sum, one) => sum + one.added, 0),
    matched: job.playlists.reduce((sum, one) => sum + one.matched, 0),
    needLook: job.playlists.reduce((sum, one) => sum + one.ambiguous, 0),
    unmatched: job.playlists.reduce((sum, one) => sum + one.unmatched, 0)
  }
}

/** The summary row in the history. Only ever says what happened. */
export function summarise(job: Job): string {
  const sum = totals(job)
  if (job.status === 'failed') return `Stopped — ${job.failed ?? 'something went wrong'}.`
  if (job.status === 'stopped') return `Stopped after ${sum.playlists} of ${job.playlists.length} playlists. ${sum.added} tracks were added.`
  if (job.status === 'needs-you') return job.needs ?? 'Waiting for you to decide something.'
  if (job.status !== 'finished') return progress(job).says
  const bits = [`${sum.playlists} ${sum.playlists === 1 ? 'playlist' : 'playlists'}`, `${sum.added} tracks added`]
  if (sum.needLook > 0) bits.push(`${sum.needLook} to look at`)
  if (sum.unmatched > 0) bits.push(`${sum.unmatched} not found`)
  return `${bits.join(', ')}.`
}

/** What is left to do, so resuming does not read what it already read. */
export function remaining(job: Job): JobPlaylist[] {
  return job.playlists.filter((one) => one.state !== 'done' && one.state !== 'skipped')
}

export function canResume(job: Job): { can: boolean; why: string } {
  if (job.status === 'finished') return { can: false, why: 'This one finished.' }
  if (job.status === 'running') return { can: false, why: 'It is already going.' }
  const left = remaining(job)
  if (left.length === 0) return { can: false, why: 'Everything in it is done.' }
  return { can: true, why: `${left.length} ${left.length === 1 ? 'playlist' : 'playlists'} left.` }
}

// ---------------------------------------------------------------- doing it twice

export interface Provenance {
  /** Which service it came from. */
  provider: string
  /** The source's own id for the track, which is what makes a second import recognise it. */
  sourceTrackId: string | null
  sourcePlaylistId: string
  importedAt: number
  jobId: string
}

/**
 * Whether this row was already brought in by an earlier import.
 *
 * Matched on the source's own ids rather than on the track, because the question is "did we already import *this
 * row*", not "do we have this song".
 */
export function alreadyImported(provenance: readonly Provenance[], provider: string, playlistId: string, trackId: string | null): boolean {
  if (!trackId) return false
  return provenance.some((one) => one.provider === provider && one.sourcePlaylistId === playlistId && one.sourceTrackId === trackId)
}

export interface ChangeSet {
  added: readonly string[]
  removedAtSource: readonly string[]
  unchanged: number
  says: string
}

/**
 * What changed at the source since last time.
 *
 * `removedAtSource` is reported and **never acted on** here. A track vanishing from a Spotify playlist may mean
 * it was removed, or that it went unavailable in one country for a week. Deleting from somebody's Orbis playlist
 * on that evidence loses their data to somebody else's outage, so this hands back the list and the decision.
 */
export function changesSince(
  lastSeen: readonly string[],
  nowAtSource: readonly string[]
): ChangeSet {
  const before = new Set(lastSeen)
  const after = new Set(nowAtSource)
  const added = nowAtSource.filter((one) => !before.has(one))
  const removedAtSource = lastSeen.filter((one) => !after.has(one))
  const unchanged = lastSeen.length - removedAtSource.length
  let says: string
  if (added.length === 0 && removedAtSource.length === 0) says = 'Nothing has changed there since last time.'
  else {
    const bits: string[] = []
    if (added.length) bits.push(`${added.length} new`)
    if (removedAtSource.length) bits.push(`${removedAtSource.length} no longer there`)
    says = `${bits.join(', ')}. Nothing is removed from your playlist unless you ask.`
  }
  return { added, removedAtSource, unchanged, says }
}

/** What Orbis does when a track disappears from the source. The default leaves it alone. */
export type RemovalPolicy = 'keep' | 'mark' | 'remove'

export const REMOVAL_POLICIES: readonly { id: RemovalPolicy; name: string; what: string }[] = [
  { id: 'keep', name: 'Leave it in my playlist', what: 'The default. What is in your playlist stays yours.' },
  { id: 'mark', name: 'Leave it but mark it', what: 'It stays, with a note that it is gone from the other service.' },
  { id: 'remove', name: 'Remove it too', what: 'Your playlist follows the other service exactly. Removals happen without asking.' }
]

// ---------------------------------------------------------------- waiting politely

/**
 * How long to wait before the next request.
 *
 * Doubling, capped, and a `Retry-After` from the service always wins — it is the service telling us the answer,
 * and guessing against it is how an app gets its access withdrawn.
 */
export function waitFor(attempt: number, retryAfterSeconds: number | null, base = 1000, most = 60_000): number {
  if (typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0) return Math.min(retryAfterSeconds * 1000, most * 5)
  return Math.min(base * Math.pow(2, Math.max(0, attempt - 1)), most)
}

/** Whether to try again at all. A refusal is not a hiccup. */
export function shouldRetry(status: number, attempt: number, most = 5): boolean {
  if (attempt >= most) return false
  if (status === 429) return true
  if (status >= 500) return true
  // 401/403 means the permission is wrong, and retrying it just burns the quota and looks like an attack.
  return false
}
