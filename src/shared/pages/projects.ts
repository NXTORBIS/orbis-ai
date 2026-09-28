/**
 * A Page's saved work: autosave, checkpoints, and undo.
 *
 * Three different promises, routinely built as one feature and routinely collapsed into each other. Kept apart here,
 * because the difference between them is exactly what somebody needs to understand at the moment they have lost
 * something:
 *
 * ```
 * autosave     your work survives the app closing
 * checkpoint   a version you named, that nothing will overwrite
 * undo         a step back, for as long as this session lasts
 * ```
 *
 * Undo is **not** a backup. It lives in memory, it is bounded, and it is gone when the Page closes. A checkpoint is the
 * thing that survives. `PROJECT_ASSUMPTIONS` says so in words a Page can put on screen, because somebody who thinks undo
 * will save them tomorrow will find out at the worst possible moment.
 *
 * ## The rules that do not bend
 *
 * - **A new edit discards the redo stack.** Editing after undoing means the redone future never happened. Keeping it
 *   would let a redo overwrite work that came after it -- the single most damaging bug an undo system can have.
 * - **Autosave never overwrites a checkpoint.** A checkpoint was named on purpose; autosave is a side effect.
 * - **Nothing is unbounded.** Entries, bytes and checkpoints all have ceilings, and hitting one drops the *oldest*
 *   entry rather than refusing the newest. A Page that cannot save its latest state is worse than one that has lost its
 *   oldest undo step.
 * - **A conflicting write is reported, never merged.** Two windows editing one project cannot be reconciled by anything
 *   here without knowing what the content means, and a silent merge loses work while looking like it worked.
 *
 * Pure. No storage, no clock: `now` is always passed in.
 */

export const PROJECT_LIMITS = Object.freeze({
  /** Undo steps held. Enough for a long session, bounded so a Page cannot fill memory with its own history. */
  undoEntries: 200,
  /** The whole undo stack, in bytes of serialised content. */
  undoBytes: 8 * 1024 * 1024,
  /** A single project's content. */
  projectBytes: 2 * 1024 * 1024,
  checkpoints: 50,
  projectsPerPage: 50,
  nameLength: 120,
  /** Edits closer together than this, of the same kind, are merged into one undo step. */
  coalesceMs: 800
})

export interface ProjectError {
  error: 'too-large' | 'too-many' | 'not-found' | 'invalid-name' | 'conflict' | 'nothing-to-do' | 'invalid-content'
  message: string
}

export const isProjectError = (value: unknown): value is ProjectError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/** Why a version exists. Autosave and a deliberate save are different events and stay different here. */
export type SaveReason =
  /** The Page saved because something changed and time passed. */
  | 'autosave'
  /** Somebody asked for it. */
  | 'manual'
  /** A named version that autosave will never replace. */
  | 'checkpoint'
  /** Saved because the Page was closing. */
  | 'closing'

export interface Checkpoint {
  id: string
  name: string
  at: number
  /** The content at that moment, serialised. */
  content: string
  bytes: number
  /** What the person said about it, if anything. */
  note: string
}

export interface Project {
  id: string
  pageId: string
  name: string
  content: string
  createdAt: number
  updatedAt: number
  /** Increments on every saved change. A write carrying a stale one is a conflict. */
  revision: number
  lastReason: SaveReason
  checkpoints: readonly Checkpoint[]
  /** True when there are changes since the last save of any kind. */
  dirty: boolean
}

export interface NewProjectInput {
  id: string
  pageId: string
  name: string
  content?: string
  now: number
}

const byteLength = (text: string): number => {
  // Counted as UTF-8 rather than by `.length`, because a limit in characters is not a limit in storage: one emoji is
  // one character and four bytes, and a limit that counts characters is a limit that can be walked straight past.
  let bytes = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

export function checkProjectName(name: string): ProjectError | null {
  const trimmed = String(name ?? '').trim()
  if (trimmed === '') return { error: 'invalid-name', message: 'A project needs a name.' }
  if (trimmed.length > PROJECT_LIMITS.nameLength) {
    return { error: 'invalid-name', message: `A project name may be at most ${PROJECT_LIMITS.nameLength} characters.` }
  }
  // Control characters, which would break any list that shows the name and can hide the rest of it.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { error: 'invalid-name', message: 'A project name cannot contain control characters.' }
  }
  return null
}

/** A new, empty project. */
export function newProject(input: NewProjectInput): Project | ProjectError {
  const problem = checkProjectName(input.name)
  if (problem) return problem
  const content = input.content ?? ''
  if (byteLength(content) > PROJECT_LIMITS.projectBytes) {
    return { error: 'too-large', message: `A project may hold at most ${PROJECT_LIMITS.projectBytes / 1024} KB.` }
  }
  return Object.freeze({
    id: input.id,
    pageId: input.pageId,
    name: input.name.trim(),
    content,
    createdAt: input.now,
    updatedAt: input.now,
    revision: 1,
    lastReason: 'manual' as const,
    checkpoints: Object.freeze([]),
    dirty: false
  })
}

export interface SaveInput {
  content: string
  reason: SaveReason
  /** The revision the writer believed it was updating. A stale one is a conflict. */
  expectedRevision?: number
  now: number
}

export interface Conflict extends ProjectError {
  error: 'conflict'
  /** What is actually saved, so a Page can show both and let the person choose. */
  theirs: string
  yours: string
  theirRevision: number
  yourRevision: number
}

/**
 * A project saved.
 *
 * A write carrying an `expectedRevision` that is not the current one is refused as a conflict, and both versions come
 * back so a Page can show them side by side. Nothing here merges them: merging needs to know what the content *means*,
 * and a merge that guesses produces a file that looks saved and is wrong. Refusing is the honest answer.
 */
export function saveProject(project: Project, input: SaveInput): Project | Conflict | ProjectError {
  if (typeof input.content !== 'string') {
    return { error: 'invalid-content', message: 'A project holds text. Serialise whatever it is first.' }
  }
  const bytes = byteLength(input.content)
  if (bytes > PROJECT_LIMITS.projectBytes) {
    return {
      error: 'too-large',
      message: `That is ${Math.round(bytes / 1024)} KB, and a project may hold at most ${PROJECT_LIMITS.projectBytes / 1024} KB. Nothing was saved, so what is already stored is untouched.`
    }
  }
  if (input.expectedRevision !== undefined && input.expectedRevision !== project.revision) {
    return {
      error: 'conflict',
      message: `This project has changed since you loaded it: it is now at revision ${project.revision} and you were working from ${input.expectedRevision}. Nothing was overwritten.`,
      theirs: project.content,
      yours: input.content,
      theirRevision: project.revision,
      yourRevision: input.expectedRevision
    }
  }

  return Object.freeze({
    ...project,
    content: input.content,
    updatedAt: input.now,
    revision: project.revision + 1,
    lastReason: input.reason,
    dirty: false
  })
}

/** The project marked as having unsaved changes, without saving them. */
export const markDirty = (project: Project): Project =>
  project.dirty ? project : Object.freeze({ ...project, dirty: true })

export interface CheckpointInput {
  id: string
  name: string
  note?: string
  now: number
}

/**
 * A checkpoint: the current content, named, that nothing will overwrite.
 *
 * When the limit is reached the **oldest** is dropped, and which one went is reported rather than left to be discovered.
 * Dropping the newest would mean a person's most recent deliberate save was the one thrown away, which is exactly
 * backwards.
 */
export function addCheckpoint(
  project: Project,
  input: CheckpointInput
): { project: Project; dropped: Checkpoint | null } | ProjectError {
  const problem = checkProjectName(input.name)
  if (problem) return { ...problem, message: problem.message.replace('project', 'checkpoint') }

  const checkpoint: Checkpoint = Object.freeze({
    id: input.id,
    name: input.name.trim(),
    at: input.now,
    content: project.content,
    bytes: byteLength(project.content),
    note: String(input.note ?? '').slice(0, 500)
  })

  let kept = [...project.checkpoints, checkpoint]
  let dropped: Checkpoint | null = null
  if (kept.length > PROJECT_LIMITS.checkpoints) {
    // Oldest first, so the list is already in order and the one to drop is at the front.
    const sorted = [...kept].sort((a, b) => a.at - b.at)
    dropped = sorted[0]
    kept = kept.filter((one) => one.id !== dropped?.id)
  }

  return {
    project: Object.freeze({ ...project, checkpoints: Object.freeze(kept), updatedAt: input.now }),
    dropped
  }
}

/** A checkpoint restored into the content. The checkpoint itself is untouched, so restoring twice does the same thing. */
export function restoreCheckpoint(project: Project, checkpointId: string, now: number): Project | ProjectError {
  const checkpoint = project.checkpoints.find((one) => one.id === checkpointId)
  if (!checkpoint) return { error: 'not-found', message: 'There is no checkpoint with that id.' }
  return Object.freeze({
    ...project,
    content: checkpoint.content,
    updatedAt: now,
    revision: project.revision + 1,
    lastReason: 'manual' as const,
    dirty: false
  })
}

export function removeCheckpoint(project: Project, checkpointId: string): Project | ProjectError {
  if (!project.checkpoints.some((one) => one.id === checkpointId)) {
    return { error: 'not-found', message: 'There is no checkpoint with that id.' }
  }
  return Object.freeze({
    ...project,
    checkpoints: Object.freeze(project.checkpoints.filter((one) => one.id !== checkpointId))
  })
}

// ---------------------------------------------------------------- undo

export interface HistoryEntry {
  /** The content *before* this edit. Undo restores it. */
  before: string
  after: string
  /** What kind of edit this was, used to decide whether two of them merge. */
  kind: string
  at: number
  /** A sentence for an undo menu: "Undo typing", "Undo delete row". */
  describe: string
}

export interface History {
  readonly past: readonly HistoryEntry[]
  readonly future: readonly HistoryEntry[]
  /** Bytes held across both stacks, so the ceiling is on the whole thing rather than per entry. */
  readonly bytes: number
}

export const emptyHistory: History = Object.freeze({ past: Object.freeze([]), future: Object.freeze([]), bytes: 0 })

const entryBytes = (entry: HistoryEntry): number => byteLength(entry.before) + byteLength(entry.after)

const recount = (past: readonly HistoryEntry[], future: readonly HistoryEntry[]): number =>
  [...past, ...future].reduce((total, one) => total + entryBytes(one), 0)

export interface RecordInput {
  before: string
  after: string
  kind: string
  describe: string
  now: number
  /** Whether an edit of the same kind, close in time, should merge into the previous step. */
  coalesce?: boolean
}

/**
 * An edit recorded.
 *
 * Two things happen here that are easy to get wrong and expensive to get wrong:
 *
 * **The future is discarded.** Recording an edit after an undo means the redone future never happened. Keeping it would
 * let a later redo overwrite work done after the undo, which is the way an undo system destroys something nobody can
 * get back.
 *
 * **Consecutive edits of the same kind merge.** Typing a sentence should be one undo step, not forty. The merged step
 * keeps the *original* `before`, so undoing it goes back to before the whole run rather than one keystroke.
 */
export function record(history: History, input: RecordInput): History {
  if (input.before === input.after) return history

  const entry: HistoryEntry = {
    before: input.before,
    after: input.after,
    kind: input.kind,
    at: input.now,
    describe: input.describe
  }

  const previous = history.past[history.past.length - 1]
  const merges =
    input.coalesce === true &&
    previous !== undefined &&
    previous.kind === input.kind &&
    input.now - previous.at <= PROJECT_LIMITS.coalesceMs

  let past: HistoryEntry[]
  if (merges && previous) {
    // The original `before` is kept, so one undo goes back past the whole run of typing rather than one character.
    past = [...history.past.slice(0, -1), { ...entry, before: previous.before }]
  } else {
    past = [...history.past, entry]
  }

  // Recording an edit means the redone future never happened.
  let future: HistoryEntry[] = []

  // Trimmed from the oldest end. Losing the oldest undo step is a small loss; refusing to record the newest edit would
  // mean the thing just done cannot be undone at all, which is a much bigger one.
  while (past.length > PROJECT_LIMITS.undoEntries) past.shift()
  let bytes = recount(past, future)
  while (bytes > PROJECT_LIMITS.undoBytes && past.length > 1) {
    past.shift()
    bytes = recount(past, future)
  }

  return Object.freeze({ past: Object.freeze(past), future: Object.freeze(future), bytes })
}

export interface StepResult {
  history: History
  content: string
  describe: string
}

export const canUndo = (history: History): boolean => history.past.length > 0
export const canRedo = (history: History): boolean => history.future.length > 0

/** One step back. Null when there is nothing to undo, so a caller cannot act on a step that does not exist. */
export function undo(history: History): StepResult | null {
  const entry = history.past[history.past.length - 1]
  if (entry === undefined) return null
  const past = history.past.slice(0, -1)
  const future = [entry, ...history.future]
  return {
    history: Object.freeze({ past: Object.freeze(past), future: Object.freeze(future), bytes: recount(past, future) }),
    content: entry.before,
    describe: `Undid ${entry.describe}.`
  }
}

/** One step forward. Null when there is nothing to redo. */
export function redo(history: History): StepResult | null {
  const entry = history.future[0]
  if (entry === undefined) return null
  const past = [...history.past, entry]
  const future = history.future.slice(1)
  return {
    history: Object.freeze({ past: Object.freeze(past), future: Object.freeze(future), bytes: recount(past, future) }),
    content: entry.after,
    describe: `Redid ${entry.describe}.`
  }
}

/** What the undo and redo menu items should say. Null where the action is unavailable. */
export function historyLabels(history: History): { undo: string | null; redo: string | null } {
  const back = history.past[history.past.length - 1]
  const forward = history.future[0]
  return {
    undo: back ? `Undo ${back.describe}` : null,
    redo: forward ? `Redo ${forward.describe}` : null
  }
}

// ---------------------------------------------------------------- autosave

export interface AutosaveState {
  /** When the content last changed. */
  changedAt: number | null
  /** When it was last written. */
  savedAt: number | null
  /** How long to wait after a change before writing. */
  afterMs: number
  /** The longest the Page will go with unsaved changes, however much typing continues. */
  atMostMs: number
}

export const newAutosave = (afterMs = 2000, atMostMs = 30_000): AutosaveState =>
  Object.freeze({ changedAt: null, savedAt: null, afterMs, atMostMs })

export interface AutosaveDecision {
  save: boolean
  /** Why, in words, for a Page that shows "Saving..." or "Saved just now". */
  because: string
  /** When to ask again, as a delay in milliseconds. Null when there is nothing pending. */
  againInMs: number | null
}

/**
 * Whether it is time to autosave.
 *
 * Two clocks, not one. Waiting a quiet moment after the last change keeps a save out of the middle of somebody typing;
 * but somebody who types continuously for a minute would then never get a save at all, so a second, longer clock runs
 * from the *first* unsaved change and fires regardless. A debounce on its own has exactly that hole, and it shows up
 * only when the app crashes during a long stretch of work.
 */
export function shouldAutosave(state: AutosaveState, now: number): AutosaveDecision {
  if (state.changedAt === null) {
    return { save: false, because: 'There is nothing unsaved.', againInMs: null }
  }
  const sinceChange = now - state.changedAt
  const firstUnsaved = state.savedAt === null ? state.changedAt : Math.max(state.savedAt, state.changedAt)
  const sinceSave = state.savedAt === null ? sinceChange : now - state.savedAt

  if (sinceChange >= state.afterMs) {
    return { save: true, because: 'Nothing has changed for a moment, so this is a good time to save.', againInMs: null }
  }
  if (sinceSave >= state.atMostMs) {
    return {
      save: true,
      because: `It has been ${Math.round(sinceSave / 1000)} seconds since the last save and changes have kept coming, so this saves anyway.`,
      againInMs: null
    }
  }
  void firstUnsaved
  return {
    save: false,
    because: 'There are unsaved changes, and this is waiting for a pause.',
    againInMs: Math.max(0, Math.min(state.afterMs - sinceChange, state.atMostMs - sinceSave))
  }
}

export const noteChange = (state: AutosaveState, now: number): AutosaveState =>
  Object.freeze({ ...state, changedAt: now })

export const noteSaved = (state: AutosaveState, now: number): AutosaveState =>
  Object.freeze({ ...state, savedAt: now, changedAt: null })

/** How to describe the saved state, for the line a Page shows near its title. */
export function describeSaved(state: AutosaveState, now: number): string {
  if (state.changedAt !== null) return 'Unsaved changes'
  if (state.savedAt === null) return 'Not saved yet'
  const ago = now - state.savedAt
  if (ago < 5000) return 'Saved just now'
  if (ago < 60_000) return `Saved ${Math.round(ago / 1000)} seconds ago`
  if (ago < 3_600_000) return `Saved ${Math.round(ago / 60_000)} minutes ago`
  return `Saved ${Math.round(ago / 3_600_000)} hours ago`
}

/** What these promises are and are not, for a Page to put on screen. */
export const PROJECT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Undo is not a backup. It lives in memory, it is limited to a few hundred steps, and it is gone when the Page closes. A checkpoint is the thing that survives.',
  'Making an edit after undoing discards everything that was undone. There is no way back to it.',
  'Autosave waits for a pause in your typing, and saves anyway if the pause never comes.',
  'Autosave never replaces a checkpoint. A checkpoint is only replaced by you.',
  'When the history or the checkpoints reach their limit, the oldest goes. What you did most recently is what is kept.',
  'If the same project was changed somewhere else, the save is refused and both versions are shown. Nothing is merged, because merging would need to understand what the content means.'
])
