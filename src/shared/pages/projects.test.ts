import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  PROJECT_ASSUMPTIONS,
  PROJECT_LIMITS,
  addCheckpoint,
  canRedo,
  canUndo,
  checkProjectName,
  describeSaved,
  emptyHistory,
  historyLabels,
  isProjectError,
  markDirty,
  newAutosave,
  newProject,
  noteChange,
  noteSaved,
  record,
  redo,
  removeCheckpoint,
  restoreCheckpoint,
  saveProject,
  shouldAutosave,
  undo,
  type History,
  type Project
} from './projects.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isProjectError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

const project = (content = 'hello'): Project =>
  ok(newProject({ id: 'p1', pageId: 'page_abc', name: 'My work', content, now: 1000 }))

describe('naming', () => {
  it('needs a name', () => {
    assert.ok(checkProjectName('') !== null)
    assert.ok(checkProjectName('   ') !== null)
  })

  it('refuses a name longer than the limit', () => {
    assert.ok(checkProjectName('x'.repeat(PROJECT_LIMITS.nameLength + 1)) !== null)
  })

  it('refuses control characters, which can hide the rest of a name in a list', () => {
    assert.ok(checkProjectName('safe\u0000name') !== null)
    assert.ok(checkProjectName('line\nbreak') !== null)
  })

  it('accepts an ordinary name', () => {
    assert.equal(checkProjectName('Pendulum experiment 3'), null)
  })
})

describe('creating and saving', () => {
  it('starts clean at revision one', () => {
    const one = project()
    assert.equal(one.revision, 1)
    assert.equal(one.dirty, false)
    assert.equal(one.content, 'hello')
  })

  it('refuses content bigger than the limit, and leaves what is stored untouched', () => {
    const big = 'x'.repeat(PROJECT_LIMITS.projectBytes + 1)
    const refused = saveProject(project(), { content: big, reason: 'manual', now: 2000 })
    assert.ok(isProjectError(refused))
    assert.equal(refused.error, 'too-large')
    assert.match(refused.message, /what is already stored is untouched/)
  })

  it('counts bytes rather than characters, so a limit cannot be walked past with emoji', () => {
    // Four bytes each, so a quarter as many characters reaches the same limit.
    const emoji = '\u{1F600}'.repeat(Math.ceil(PROJECT_LIMITS.projectBytes / 4) + 1)
    assert.ok(emoji.length < PROJECT_LIMITS.projectBytes, 'the premise: fewer characters than the byte limit')
    assert.ok(isProjectError(saveProject(project(), { content: emoji, reason: 'manual', now: 2000 })))
  })

  it('increments the revision on every save', () => {
    const one = ok(saveProject(project(), { content: 'a', reason: 'manual', now: 2000 })) as Project
    const two = ok(saveProject(one, { content: 'b', reason: 'autosave', now: 3000 })) as Project
    assert.equal(one.revision, 2)
    assert.equal(two.revision, 3)
  })

  it('remembers why it was saved', () => {
    const saved = ok(saveProject(project(), { content: 'a', reason: 'autosave', now: 2000 })) as Project
    assert.equal(saved.lastReason, 'autosave')
  })

  it('clears the dirty flag on save', () => {
    const dirty = markDirty(project())
    assert.equal(dirty.dirty, true)
    assert.equal((ok(saveProject(dirty, { content: 'a', reason: 'manual', now: 2000 })) as Project).dirty, false)
  })

  it('refuses text that is not text', () => {
    const refused = saveProject(project(), { content: 42 as unknown as string, reason: 'manual', now: 2000 })
    assert.ok(isProjectError(refused))
    assert.equal(refused.error, 'invalid-content')
  })

  it('leaves the original project untouched on save', () => {
    const one = project()
    saveProject(one, { content: 'changed', reason: 'manual', now: 2000 })
    assert.equal(one.content, 'hello')
  })
})

describe('conflicts', () => {
  it('refuses a write from a stale revision and shows both versions', () => {
    const current = ok(saveProject(project(), { content: 'theirs', reason: 'manual', now: 2000 })) as Project
    const refused = saveProject(current, { content: 'mine', reason: 'manual', expectedRevision: 1, now: 3000 })
    assert.ok(isProjectError(refused))
    assert.equal(refused.error, 'conflict')
    const conflict = refused as { theirs: string; yours: string; theirRevision: number; yourRevision: number }
    assert.equal(conflict.theirs, 'theirs')
    assert.equal(conflict.yours, 'mine')
    assert.equal(conflict.theirRevision, 2)
    assert.equal(conflict.yourRevision, 1)
  })

  it('never merges, and says nothing was overwritten', () => {
    const current = ok(saveProject(project(), { content: 'theirs', reason: 'manual', now: 2000 })) as Project
    const refused = saveProject(current, { content: 'mine', reason: 'manual', expectedRevision: 1, now: 3000 })
    assert.ok(isProjectError(refused))
    assert.match(refused.message, /Nothing was overwritten/)
  })

  it('accepts a write carrying the current revision', () => {
    const current = project()
    const saved = saveProject(current, { content: 'mine', reason: 'manual', expectedRevision: 1, now: 2000 })
    assert.ok(!isProjectError(saved))
  })

  it('accepts a write that does not claim a revision at all', () => {
    const current = ok(saveProject(project(), { content: 'theirs', reason: 'manual', now: 2000 })) as Project
    assert.ok(!isProjectError(saveProject(current, { content: 'mine', reason: 'manual', now: 3000 })))
  })
})

describe('checkpoints', () => {
  it('captures the content at the moment it is made', () => {
    const made = ok(addCheckpoint(project('version one'), { id: 'c1', name: 'First', now: 2000 }))
    const after = ok(saveProject(made.project, { content: 'version two', reason: 'manual', now: 3000 })) as Project
    assert.equal(after.checkpoints[0].content, 'version one')
    assert.equal(after.content, 'version two')
  })

  it('is never replaced by an autosave', () => {
    const made = ok(addCheckpoint(project('kept'), { id: 'c1', name: 'First', now: 2000 }))
    let current = made.project
    for (let i = 0; i < 5; i++) {
      current = ok(saveProject(current, { content: `auto ${i}`, reason: 'autosave', now: 3000 + i })) as Project
    }
    assert.equal(current.checkpoints.length, 1)
    assert.equal(current.checkpoints[0].content, 'kept')
  })

  it('restores a checkpoint without consuming it', () => {
    const made = ok(addCheckpoint(project('original'), { id: 'c1', name: 'First', now: 2000 }))
    const changed = ok(saveProject(made.project, { content: 'changed', reason: 'manual', now: 3000 })) as Project
    const restored = ok(restoreCheckpoint(changed, 'c1', 4000)) as Project
    assert.equal(restored.content, 'original')
    assert.equal(restored.checkpoints.length, 1, 'restoring should not remove the checkpoint')
    // Restoring twice does the same thing.
    assert.equal((ok(restoreCheckpoint(restored, 'c1', 5000)) as Project).content, 'original')
  })

  it('drops the oldest when full, and says which one went', () => {
    let current = project()
    for (let i = 0; i < PROJECT_LIMITS.checkpoints; i++) {
      current = ok(addCheckpoint(current, { id: `c${i}`, name: `Point ${i}`, now: 2000 + i })).project
    }
    const overflowing = ok(addCheckpoint(current, { id: 'last', name: 'Last', now: 99_000 }))
    assert.equal(overflowing.dropped?.id, 'c0', 'the oldest should be the one dropped')
    assert.equal(overflowing.project.checkpoints.length, PROJECT_LIMITS.checkpoints)
    assert.ok(overflowing.project.checkpoints.some((one) => one.id === 'last'), 'the newest must be kept')
  })

  it('removes a checkpoint by id', () => {
    const made = ok(addCheckpoint(project(), { id: 'c1', name: 'First', now: 2000 }))
    assert.equal((ok(removeCheckpoint(made.project, 'c1')) as Project).checkpoints.length, 0)
  })

  it('reports a checkpoint that is not there', () => {
    assert.ok(isProjectError(restoreCheckpoint(project(), 'nope', 2000)))
    assert.ok(isProjectError(removeCheckpoint(project(), 'nope')))
  })

  it('needs a name', () => {
    assert.ok(isProjectError(addCheckpoint(project(), { id: 'c1', name: '', now: 2000 })))
  })

  it('keeps a note about why', () => {
    const made = ok(addCheckpoint(project(), { id: 'c1', name: 'Before the rewrite', note: 'in case', now: 2000 }))
    assert.equal(made.project.checkpoints[0].note, 'in case')
  })
})

describe('undo', () => {
  const edit = (history: History, before: string, after: string, at: number, kind = 'edit'): History =>
    record(history, { before, after, kind, describe: kind, now: at, coalesce: false })

  it('steps back to the content before an edit', () => {
    const history = edit(emptyHistory, 'a', 'b', 1000)
    const stepped = undo(history)
    assert.ok(stepped !== null)
    assert.equal(stepped.content, 'a')
  })

  it('steps forward again', () => {
    const history = edit(emptyHistory, 'a', 'b', 1000)
    const back = undo(history)
    assert.ok(back !== null)
    const forward = redo(back.history)
    assert.ok(forward !== null)
    assert.equal(forward.content, 'b')
  })

  it('has nothing to undo or redo when empty', () => {
    assert.equal(undo(emptyHistory), null)
    assert.equal(redo(emptyHistory), null)
    assert.equal(canUndo(emptyHistory), false)
    assert.equal(canRedo(emptyHistory), false)
  })

  it('discards the future when a new edit is made after undoing', () => {
    // The bug this prevents: redoing after a new edit would overwrite work done after the undo.
    let history = edit(emptyHistory, 'a', 'b', 1000)
    history = edit(history, 'b', 'c', 2000)
    const back = undo(history)
    assert.ok(back !== null)
    assert.equal(canRedo(back.history), true)

    const afterNewEdit = edit(back.history, 'b', 'different', 3000)
    assert.equal(canRedo(afterNewEdit), false, 'the redone future must be gone')
    assert.equal(redo(afterNewEdit), null)
  })

  it('merges consecutive edits of the same kind, keeping the original starting point', () => {
    let history = record(emptyHistory, { before: '', after: 'h', kind: 'typing', describe: 'typing', now: 1000, coalesce: true })
    history = record(history, { before: 'h', after: 'he', kind: 'typing', describe: 'typing', now: 1100, coalesce: true })
    history = record(history, { before: 'he', after: 'hel', kind: 'typing', describe: 'typing', now: 1200, coalesce: true })
    assert.equal(history.past.length, 1, 'typing a word should be one undo step')

    const back = undo(history)
    assert.ok(back !== null)
    assert.equal(back.content, '', 'one undo should go back past the whole run, not one keystroke')
  })

  it('does not merge across a pause', () => {
    let history = record(emptyHistory, { before: '', after: 'a', kind: 'typing', describe: 'typing', now: 1000, coalesce: true })
    history = record(history, {
      before: 'a',
      after: 'ab',
      kind: 'typing',
      describe: 'typing',
      now: 1000 + PROJECT_LIMITS.coalesceMs + 1,
      coalesce: true
    })
    assert.equal(history.past.length, 2)
  })

  it('does not merge edits of different kinds', () => {
    let history = record(emptyHistory, { before: '', after: 'a', kind: 'typing', describe: 'typing', now: 1000, coalesce: true })
    history = record(history, { before: 'a', after: '', kind: 'delete', describe: 'delete', now: 1050, coalesce: true })
    assert.equal(history.past.length, 2)
  })

  it('ignores an edit that changed nothing', () => {
    assert.equal(record(emptyHistory, { before: 'a', after: 'a', kind: 'edit', describe: 'edit', now: 1000 }), emptyHistory)
  })

  it('drops the oldest step when full, never refusing to record the newest', () => {
    let history = emptyHistory
    for (let i = 0; i < PROJECT_LIMITS.undoEntries + 10; i++) {
      history = edit(history, `v${i}`, `v${i + 1}`, 1000 + i)
    }
    assert.equal(history.past.length, PROJECT_LIMITS.undoEntries)
    const back = undo(history)
    assert.ok(back !== null)
    // The most recent edit is still undoable, which is the thing that matters.
    assert.equal(back.content, `v${PROJECT_LIMITS.undoEntries + 9}`)
  })

  it('keeps the whole stack under its byte ceiling', () => {
    let history = emptyHistory
    const chunk = 'x'.repeat(200_000)
    for (let i = 0; i < 100; i++) history = edit(history, chunk + i, chunk + (i + 1), 1000 + i)
    assert.ok(history.bytes <= PROJECT_LIMITS.undoBytes, `held ${history.bytes} bytes`)
    assert.ok(history.past.length >= 1, 'it must always keep at least the most recent step')
  })

  it('gives menu labels, and null where the action is unavailable', () => {
    assert.deepEqual(historyLabels(emptyHistory), { undo: null, redo: null })
    const history = record(emptyHistory, { before: 'a', after: 'b', kind: 'edit', describe: 'adding a row', now: 1000 })
    assert.equal(historyLabels(history).undo, 'Undo adding a row')
    const back = undo(history)
    assert.ok(back !== null)
    assert.equal(historyLabels(back.history).redo, 'Redo adding a row')
  })

  it('says what it did', () => {
    const history = record(emptyHistory, { before: 'a', after: 'b', kind: 'edit', describe: 'adding a row', now: 1000 })
    const back = undo(history)
    assert.equal(back?.describe, 'Undid adding a row.')
  })

  it('leaves the original history untouched', () => {
    const history = edit(emptyHistory, 'a', 'b', 1000)
    undo(history)
    assert.equal(history.past.length, 1)
    assert.equal(history.future.length, 0)
  })
})

describe('autosave', () => {
  it('does nothing when there is nothing unsaved', () => {
    const decision = shouldAutosave(newAutosave(), 5000)
    assert.equal(decision.save, false)
    assert.equal(decision.againInMs, null)
  })

  it('waits for a pause before saving', () => {
    const state = noteChange(newAutosave(2000, 30_000), 1000)
    assert.equal(shouldAutosave(state, 1500).save, false)
    assert.equal(shouldAutosave(state, 3000).save, true)
  })

  it('says how long to wait before asking again', () => {
    const state = noteChange(newAutosave(2000, 30_000), 1000)
    const decision = shouldAutosave(state, 1500)
    assert.equal(decision.againInMs, 1500)
  })

  it('saves anyway when the pause never comes', () => {
    // Continuous typing: the change time keeps moving, so a plain debounce would never fire.
    let state = noteSaved(newAutosave(2000, 10_000), 1000)
    let now = 1000
    let saved = false
    for (let i = 0; i < 200; i++) {
      now += 100
      state = noteChange(state, now)
      if (shouldAutosave(state, now).save) {
        saved = true
        break
      }
    }
    assert.equal(saved, true, 'continuous typing must still get saved')
    assert.ok(now - 1000 <= 11_000, `it waited ${now - 1000}ms, longer than the ceiling`)
  })

  it('explains why it is saving', () => {
    // The change is recent, so the pause has not come; but it is long enough since the last save that it saves anyway.
    let state = noteSaved(newAutosave(2000, 10_000), 1000)
    state = noteChange(state, 11_500)
    const forced = shouldAutosave(state, 12_000)
    assert.equal(forced.save, true)
    assert.match(forced.because, /kept coming/)
    assert.match(shouldAutosave(noteChange(newAutosave(2000, 30_000), 1000), 4000).because, /good time to save/)
  })

  it('forgets the pending change once saved', () => {
    const state = noteSaved(noteChange(newAutosave(), 1000), 2000)
    assert.equal(state.changedAt, null)
    assert.equal(shouldAutosave(state, 9000).save, false)
  })

  it('describes the saved state in words', () => {
    assert.equal(describeSaved(newAutosave(), 1000), 'Not saved yet')
    assert.equal(describeSaved(noteChange(newAutosave(), 1000), 2000), 'Unsaved changes')
    assert.equal(describeSaved(noteSaved(newAutosave(), 1000), 2000), 'Saved just now')
    assert.match(describeSaved(noteSaved(newAutosave(), 0), 30_000), /30 seconds ago/)
    assert.match(describeSaved(noteSaved(newAutosave(), 0), 600_000), /10 minutes ago/)
    assert.match(describeSaved(noteSaved(newAutosave(), 0), 7_200_000), /2 hours ago/)
  })
})

describe('assumptions', () => {
  it('says outright that undo is not a backup', () => {
    assert.ok(PROJECT_ASSUMPTIONS.some((one) => /Undo is not a backup/.test(one)))
  })

  it('warns that editing after undoing discards what was undone', () => {
    assert.ok(PROJECT_ASSUMPTIONS.some((one) => /discards everything that was undone/.test(one)))
  })

  it('says a conflicting save is refused rather than merged', () => {
    assert.ok(PROJECT_ASSUMPTIONS.some((one) => /Nothing is merged/.test(one)))
  })
})
