import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PHASES,
  REMOVAL_POLICIES,
  alreadyImported,
  canResume,
  changesSince,
  newJob,
  progress,
  remaining,
  shouldRetry,
  summarise,
  totals,
  waitFor,
  type Job,
  type JobPlaylist
} from './migration.ts'

const playlist = (name: string, state: JobPlaylist['state'], extra: Partial<JobPlaylist> = {}): JobPlaylist => ({
  sourceId: name,
  name,
  trackCount: 10,
  state,
  matched: 0,
  ambiguous: 0,
  unmatched: 0,
  added: 0,
  why: null,
  ...extra
})

describe('music migration jobs', () => {
  it('a new job has done nothing and says so', () => {
    const job = newJob('j1', 'spotify', 1000)
    assert.equal(job.status, 'waiting')
    assert.equal(job.phase, 'connect')
    assert.equal(progress(job).done < 0.05, true)
  })

  it('nothing reaches finished until the last phase is done', () => {
    const job: Job = { ...newJob('j1', 'spotify', 0), phase: 'verify', status: 'running', playlists: [playlist('a', 'done')] }
    assert.ok(progress(job).done < 1)
    job.phase = 'done'
    assert.equal(progress(job).done, 1)
  })

  it('progress never goes backwards as phases advance', () => {
    const playlists = [playlist('a', 'done'), playlist('b', 'done')]
    let last = -1
    for (const phase of PHASES.map((one) => one.id)) {
      const done = progress({ ...newJob('j', 'p', 0), phase, playlists }).done
      assert.ok(done >= last, `${phase} went backwards`)
      last = done
    }
  })

  it('counts playlists inside the phases that take the time', () => {
    const job: Job = {
      ...newJob('j', 'spotify', 0),
      phase: 'import',
      playlists: [playlist('a', 'done'), playlist('b', 'done'), playlist('c', 'importing'), playlist('d', 'waiting')]
    }
    assert.match(progress(job).says, /2 of 4 playlists/)
  })

  it('totals add up from the rows rather than being tracked separately', () => {
    const job: Job = {
      ...newJob('j', 'spotify', 0),
      playlists: [playlist('a', 'done', { added: 8, matched: 9, ambiguous: 1, unmatched: 0 }), playlist('b', 'done', { added: 3, unmatched: 2 })]
    }
    const sum = totals(job)
    assert.equal(sum.playlists, 2)
    assert.equal(sum.added, 11)
    assert.equal(sum.needLook, 1)
    assert.equal(sum.unmatched, 2)
  })

  it('a finished job says what happened, not that it succeeded', () => {
    const job: Job = {
      ...newJob('j', 'spotify', 0),
      status: 'finished',
      phase: 'done',
      playlists: [playlist('a', 'done', { added: 8, unmatched: 2 })]
    }
    const said = summarise(job)
    assert.match(said, /8 tracks added/)
    assert.match(said, /2 not found/)
  })

  it('a stopped job says how far it got rather than claiming completion', () => {
    const job: Job = {
      ...newJob('j', 'spotify', 0),
      status: 'stopped',
      playlists: [playlist('a', 'done', { added: 4 }), playlist('b', 'waiting')]
    }
    assert.match(summarise(job), /1 of 2/)
    assert.doesNotMatch(summarise(job), /100/)
  })

  it('a failed job says why', () => {
    const job: Job = { ...newJob('j', 'spotify', 0), status: 'failed', failed: 'the connection went' }
    assert.match(summarise(job), /the connection went/)
  })

  it('resuming only has the playlists that are not done', () => {
    const job: Job = {
      ...newJob('j', 'spotify', 0),
      status: 'paused',
      playlists: [playlist('a', 'done'), playlist('b', 'skipped'), playlist('c', 'waiting')]
    }
    assert.deepEqual(remaining(job).map((one) => one.name), ['c'])
    assert.equal(canResume(job).can, true)
  })

  it('a finished or already-running job cannot be resumed', () => {
    assert.equal(canResume({ ...newJob('j', 'p', 0), status: 'finished' }).can, false)
    assert.equal(canResume({ ...newJob('j', 'p', 0), status: 'running' }).can, false)
    assert.equal(canResume({ ...newJob('j', 'p', 0), status: 'paused', playlists: [playlist('a', 'done')] }).can, false)
  })

  it('a row already imported is recognised by the source ids', () => {
    const seen = [{ provider: 'spotify', sourceTrackId: 't1', sourcePlaylistId: 'p1', importedAt: 1, jobId: 'j' }]
    assert.equal(alreadyImported(seen, 'spotify', 'p1', 't1'), true)
    assert.equal(alreadyImported(seen, 'spotify', 'p2', 't1'), false)
    assert.equal(alreadyImported(seen, 'apple', 'p1', 't1'), false)
    // No id from the source means it cannot be claimed as already done.
    assert.equal(alreadyImported(seen, 'spotify', 'p1', null), false)
  })

  it('an unchanged source is said plainly', () => {
    assert.match(changesSince(['a', 'b'], ['a', 'b']).says, /nothing has changed/i)
  })

  it('a track gone from the source is reported and never removed here', () => {
    const out = changesSince(['a', 'b'], ['a', 'c'])
    assert.deepEqual([...out.added], ['c'])
    assert.deepEqual([...out.removedAtSource], ['b'])
    assert.equal(out.unchanged, 1)
    assert.match(out.says, /unless you ask/i)
  })

  it('leaving it alone is the default removal policy', () => {
    assert.equal(REMOVAL_POLICIES[0].id, 'keep')
    assert.match(REMOVAL_POLICIES[0].what, /default/i)
    assert.match(REMOVAL_POLICIES[2].what, /without asking/i)
  })

  it('the service telling us how long to wait always wins', () => {
    assert.equal(waitFor(1, 30), 30_000)
    assert.equal(waitFor(1, null), 1000)
    assert.equal(waitFor(3, null), 4000)
    assert.equal(waitFor(20, null), 60_000)
  })

  it('a permission refusal is not retried', () => {
    assert.equal(shouldRetry(429, 1), true)
    assert.equal(shouldRetry(503, 1), true)
    assert.equal(shouldRetry(401, 1), false)
    assert.equal(shouldRetry(403, 1), false)
    assert.equal(shouldRetry(429, 9), false)
  })

  it('every phase is described for the screen', () => {
    for (const phase of PHASES) {
      assert.ok(phase.name.length > 2, phase.id)
      if (phase.id !== 'done') assert.ok(phase.what.length > 10, phase.id)
    }
  })
})
