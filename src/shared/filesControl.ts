/**
 * The words the Orbis window and the Orbis Files frame use to talk about what is on screen in Files.
 *
 * Files runs in a frame of its own (`files.html`) because its stylesheet restyles the whole document. That frame is a
 * separate program: it has its own copy of every module, so the register of screens in the window cannot see a screen
 * inside it, and the one door between the application and its window (`control:window-run`) reaches the window's main
 * frame and not a subframe. There is no second channel and there must not be one.
 *
 * So the frame says what is on screen and the window asks it to do things, over the `postMessage` route the two
 * already use to say "Files is ready" and "open this tool". Two rules make that honest rather than a guess:
 *
 *  - **The frame pushes; the window never assumes.** The window holds the last thing the frame said and how long ago.
 *    Before anything has arrived, every reading is reported as unreadable with that reason -- not as an empty folder,
 *    not as nothing selected. A value nobody has sent is not a value.
 *  - **The frame says what the choices are.** The views, the sort keys and the grouping arrive in the snapshot from
 *    the Files project's own lists, so there is no second list here to drift from them.
 *
 * Pure: types, names and two small readers. Nothing here knows about Electron, React or the DOM, and the Files
 * project imports it as the one thing it shares with its host.
 */

/** Bumped when the shape below changes in a way the other side would get wrong. Sent with every snapshot. */
export const FILES_CONTROL_CONTRACT = '1.0.0'

/** What the frame says, unasked, whenever what is on screen changes. */
export const FILES_STATE_MESSAGE = 'orbis-files-state'
/** What the window asks the frame to do. */
export const FILES_CONTROL_MESSAGE = 'orbis-files-control'
/** What the frame answers. */
export const FILES_RESULT_MESSAGE = 'orbis-files-control-result'
/** The window asking for a snapshot and the command list now, for when it started listening after the frame settled. */
export const FILES_ASK_STATE_MESSAGE = 'orbis-files-ask-state'
/** The frame saying what it can be asked to do. Sent once, because it does not change while Files is running. */
export const FILES_COMMANDS_MESSAGE = 'orbis-files-commands'

/**
 * One thing the Files screen can be asked to do, as Files itself describes it.
 *
 * Read out of the Files command registry -- the same registry its toolbar, its context menus, its keyboard shortcuts
 * and its command palette all run through. There is no list of Files commands anywhere in Orbis: a command added
 * there is one Orbis can do in the same change, with its own title, its own explanation and its own idea of how
 * serious it is.
 */
export interface FilesCommand {
  id: string
  /** What it is called on screen. */
  title: string
  description: string
  /** What Files says it does: nothing but move about, change how it looks, read, change files, or delete them. */
  permission: 'navigate' | 'settings' | 'read' | 'modify' | 'destructive'
  /** True when it asks for something on screen, so nothing but a person can finish it. */
  asksFirst: boolean
}

/**
 * Everything the window can ask the Files frame to do.
 *
 * Every one of these is carried out by calling the function the Files screen's own control calls -- its `navigate`,
 * its `setSelection`, its `trashEntries`. None of them reaches the file system directly, because a second way of
 * moving a file is a second place for "did it ask first?" to be answered differently.
 */
export const FILES_CONTROLS = {
  /** Go to a folder. The pane's own `navigate`, so leaving an editor with unsaved work still asks. */
  goTo: 'goTo',
  /** Select these paths in the active pane. */
  select: 'select',
  setView: 'setView',
  setSort: 'setSort',
  setGroup: 'setGroup',
  setFilter: 'setFilter',
  /** Run one of the Files commands, by its id, through the registry every button there runs through. */
  runCommand: 'runCommand',
  /** Which of these paths the pane still lists. The reading a deletion is confirmed against. */
  stillThere: 'stillThere'
} as const

export type FilesControlName = (typeof FILES_CONTROLS)[keyof typeof FILES_CONTROLS]

/** What kind of place a pane is looking at. The Files project's own `Location` kinds, as it sends them. */
export type FilesPlace = string

/**
 * What is on screen in Files, as the frame last said it.
 *
 * Several fields are deliberately nullable, and each null means "nobody has measured this", never zero:
 * `entries` before a listing has come back, `canTrash` before the computer has been asked what it can do.
 */
export interface FilesViewState {
  contract: string
  /** The frame's own clock when it said this, so the window can say how old the reading is. */
  at: number
  /** The folder the active pane is in, or null when the place it is in is not a folder. */
  folder: string | null
  /** What kind of place it is: a folder, home, a search, a collection, a tool, an editor, a server. */
  place: FilesPlace
  /** The part of the place that is not its kind: the search text, the tool's name, the collection's id. */
  placeDetail: string
  /** The folder above, or null at the top or in a place that has no above. */
  parent: string | null
  view: string
  sortBy: string
  sortDirection: 'asc' | 'desc'
  foldersFirst: boolean
  groupBy: string
  filter: string
  /** The paths selected in the active pane. */
  selection: string[]
  /** How many things the active pane lists, or null while that has not come back. */
  entries: number | null
  listing: 'loading' | 'ready' | 'error' | 'none'
  listingProblem?: string
  tabs: number
  panes: number
  canGoBack: boolean
  canGoForward: boolean
  /** How many file operations are going on. */
  operations: number
  /** Whether this computer has a Trash. Null until it has been asked. */
  canTrash: boolean | null
  /** The allowed values, from the Files project's own lists rather than a copy kept here. */
  offers: { views: string[]; sortKeys: string[]; groupKeys: string[] }
}

export interface FilesControlRequest {
  type: typeof FILES_CONTROL_MESSAGE
  id: string
  name: FilesControlName
  params?: Record<string, unknown>
}

export type FilesControlReply =
  | { type: typeof FILES_RESULT_MESSAGE; id: string; ok: true; data?: unknown }
  | { type: typeof FILES_RESULT_MESSAGE; id: string; ok: false; message: string }

export interface FilesStateMessage {
  type: typeof FILES_STATE_MESSAGE
  state: FilesViewState
}

export interface FilesCommandsMessage {
  type: typeof FILES_COMMANDS_MESSAGE
  commands: FilesCommand[]
}

/** What running a Files command gave back. */
export interface FilesCommandOutcome {
  id: string
  title: string
  /** What Files says it does, so the window can say it in the same words. */
  permission: FilesCommand['permission']
  /** False when the command is still waiting for an answer on screen, with `waiting` saying so. */
  finished: boolean
  waiting?: string
  /** For a command that acted on a selection: how many of those paths the pane still lists. */
  stillThere?: number
  /** What was selected when it ran. */
  acted: number
}

/** Whether this is the frame saying what it can do, checked the same way and for the same reason. */
export function readFilesCommands(value: unknown): FilesCommand[] | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  if (one.type !== FILES_COMMANDS_MESSAGE || !Array.isArray(one.commands)) return null
  const allowed = ['navigate', 'settings', 'read', 'modify', 'destructive']
  return one.commands
    .filter((each): each is Record<string, unknown> => typeof each === 'object' && each !== null && typeof (each as { id?: unknown }).id === 'string')
    .map((each) => ({
      id: String(each.id),
      title: typeof each.title === 'string' ? each.title : String(each.id),
      description: typeof each.description === 'string' ? each.description : '',
      // Anything Files did not label is treated as the more serious thing, not the less: a command of unknown weight
      // that is waved through is the one that deletes something nobody approved.
      permission: (allowed.includes(String(each.permission)) ? String(each.permission) : 'modify') as FilesCommand['permission'],
      asksFirst: each.asksFirst === true
    }))
}

/**
 * Whether this is a snapshot from the frame, checked field by field.
 *
 * Everything arriving over `postMessage` is somebody else's text until it has been looked at, and a snapshot that is
 * trusted because it has the right `type` is a snapshot that can report a folder as a number. Only the shape is
 * checked here; what the values mean is the frame's business.
 */
export function readFilesState(value: unknown): FilesViewState | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  if (one.type !== FILES_STATE_MESSAGE) return null
  const state = one.state as Record<string, unknown> | undefined
  if (typeof state !== 'object' || state === null) return null
  const text = (name: string): string => (typeof state[name] === 'string' ? (state[name] as string) : '')
  const list = (from: unknown): string[] => (Array.isArray(from) ? from.filter((each): each is string => typeof each === 'string') : [])
  const offers = (state.offers ?? {}) as Record<string, unknown>
  return {
    contract: text('contract'),
    at: typeof state.at === 'number' && Number.isFinite(state.at) ? state.at : 0,
    folder: typeof state.folder === 'string' ? state.folder : null,
    place: text('place'),
    placeDetail: text('placeDetail'),
    parent: typeof state.parent === 'string' ? state.parent : null,
    view: text('view'),
    sortBy: text('sortBy'),
    sortDirection: state.sortDirection === 'asc' ? 'asc' : 'desc',
    foldersFirst: state.foldersFirst === true,
    groupBy: text('groupBy'),
    filter: text('filter'),
    selection: list(state.selection),
    // Never 0 for a listing that has not come back: that is the difference between an empty folder and no answer.
    entries: typeof state.entries === 'number' && Number.isFinite(state.entries) ? state.entries : null,
    listing: state.listing === 'loading' || state.listing === 'ready' || state.listing === 'error' ? state.listing : 'none',
    ...(typeof state.listingProblem === 'string' && state.listingProblem !== '' ? { listingProblem: state.listingProblem } : {}),
    tabs: typeof state.tabs === 'number' ? state.tabs : 0,
    panes: typeof state.panes === 'number' ? state.panes : 0,
    canGoBack: state.canGoBack === true,
    canGoForward: state.canGoForward === true,
    operations: typeof state.operations === 'number' ? state.operations : 0,
    canTrash: typeof state.canTrash === 'boolean' ? state.canTrash : null,
    offers: { views: list(offers.views), sortKeys: list(offers.sortKeys), groupKeys: list(offers.groupKeys) }
  }
}

/** Whether this is an answer to something the window asked, checked the same way and for the same reason. */
export function readFilesReply(value: unknown): { id: string; ok: boolean; data?: unknown; message?: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const one = value as Record<string, unknown>
  if (one.type !== FILES_RESULT_MESSAGE || typeof one.id !== 'string') return null
  return one.ok === true
    ? { id: one.id, ok: true, data: one.data }
    : { id: one.id, ok: false, message: typeof one.message === 'string' ? one.message : 'Files did not say what went wrong.' }
}
