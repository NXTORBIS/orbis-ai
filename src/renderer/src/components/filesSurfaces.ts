import type { SideEffect } from '../../../shared/browserControl.ts'
import type { ConfirmationPolicy } from '../../../shared/browserControl.ts'
import { FILES_CONTROLS, type FilesCommand, type FilesCommandOutcome, type FilesControlName, type FilesViewState } from '../../../shared/filesControl.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What Orbis Files lets Orbis do, as data.
 *
 * Files is the awkward one of the three, and it is worth saying why rather than pretending otherwise. Markets and
 * Pages are screens in the Orbis window: their state is in the same program as the register, so a getter reads a
 * variable. Files runs in a frame of its own because its stylesheet restyles the whole document, which makes it a
 * separate program with its own copy of every module — and the one door between the application and its window
 * reaches the window's main frame, not a subframe.
 *
 * So what is declared here is not Files' state; it is **the last thing Files said**, and the difference is written
 * into every control. Before the frame has spoken, every reading comes back `readable: false` with that reason, and
 * nothing can be set. A folder reported as empty because a message had not arrived would be the worst version of the
 * fault this product keeps coming back to.
 *
 * What can be *done* is not listed here at all. It is read out of the Files command registry — the same registry its
 * toolbar, its context menus, its keyboard shortcuts and its command palette all run through — and grouped by what
 * Files itself says each command does. Five actions, one per kind of consequence, so the bar for being asked first is
 * raised exactly where Files says it should be rather than for everything or nothing.
 */

/** The window's end of the frame: the last thing it said, what it says it can do, and a way to ask it something. */
export interface FilesLink {
  /** The last snapshot and when this window received it. Null before the frame has said anything. */
  said(): { state: FilesViewState; at: number } | null
  /** What Files says it can be asked to do. Empty before it has said. */
  commands(): readonly FilesCommand[]
  /** Asks the frame for something and resolves with whatever it answered, or rejects with its own sentence. */
  ask(name: FilesControlName, params?: Record<string, unknown>): Promise<unknown>
}

// ---------------------------------------------------------------- the Files screen in the window

export const FILES_TABS = ['files', 'created', 'universe'] as const

/** What the screen that holds Files has to hand over. */
export interface FilesViewScreen {
  tab(): string
  setTab(id: string): void
  /** How many pictures Orbis has made, as the Created half lists them. */
  made(): number
  close(): void
}

/**
 * The Files screen in the window: three halves, one of which is Orbis Files itself.
 *
 * Small on purpose. Everything that can be done to files is inside the frame, and this is the thing that decides
 * whether the frame is on screen — which is what makes it the route to the surface below.
 */
export function filesViewSurface(screen: FilesViewScreen): SurfaceDeclaration {
  return {
    id: 'files',
    parent: null,
    name: 'Files',
    about: 'Orbis Files, the pictures Orbis has made, and the Universe explorer.',
    kind: 'module',
    keywords: ['files', 'folders', 'documents', 'explorer', 'images'],
    controls: {
      tab: {
        name: 'Half',
        about: 'Which of the three halves is on screen.',
        spec: { type: 'string', description: 'Which half is on screen: Files itself, what Orbis has made, or Universe.', enum: [...FILES_TABS] },
        get: () => screen.tab(),
        set: (value) => screen.setTab(String(value)),
        default: 'files'
      }
    },
    actions: {
      close: {
        name: 'Back to chat',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: [
      {
        id: 'browser',
        name: 'Browsing files',
        kind: 'tool' as const,
        // Showing the half is all it takes; the frame then says what is on screen and `files/browser` appears.
        reach: { kind: 'control' as const, control: 'tab', value: 'files' }
      }
    ],
    state: () => ({ values: { half: screen.tab(), picturesOrbisMade: screen.made() } })
  }
}

// ---------------------------------------------------------------- browsing files, through the frame

/** What each kind of consequence Files declares means for an action: what it does, and whether to ask first. */
const CONSEQUENCE: Record<FilesCommand['permission'], { id: string; name: string; about: string; effects: readonly SideEffect[]; confirmation: ConfirmationPolicy }> = {
  navigate: {
    id: 'go',
    name: 'Go somewhere in Files',
    about: 'Moving about: a folder, a tab, back, forward, up, refresh. Nothing on this computer is changed.',
    effects: ['write'],
    confirmation: 'none'
  },
  settings: {
    id: 'look',
    name: 'Change how Files looks',
    about: 'The view, the grouping, which panels are shown. Nothing on this computer is changed.',
    effects: ['write'],
    confirmation: 'none'
  },
  read: {
    id: 'inspect',
    name: 'Look something up in Files',
    about: 'Reading: checksums, text recognition, where something came from. Nothing is changed.',
    effects: ['read'],
    confirmation: 'none'
  },
  modify: {
    id: 'change',
    name: 'Change files',
    about: 'Copying, moving, renaming, compressing, writing. These change what is on this computer.',
    effects: ['write'],
    confirmation: 'when-consequential'
  },
  destructive: {
    id: 'delete',
    name: 'Delete files',
    about: 'Files says these destroy something. Orbis asks first, every time.',
    effects: ['delete'],
    confirmation: 'always'
  }
}

/**
 * Browsing files, as something Orbis can work.
 *
 * Registered by the frame's host as soon as the frame says it is ready, and gone when the frame is. Six controls for
 * the things that hold a value and five actions for everything Files can do, each one carrying the commands Files
 * puts at that level of consequence.
 */
export function filesBrowserSurface(link: FilesLink): SurfaceDeclaration {
  /** The last snapshot, or the reason there is not one. Everything below goes through this. */
  const now = (): FilesViewState => {
    const said = link.said()
    // Thrown rather than answered with a blank: a control that reports an empty folder because a message has not
    // arrived is the fault this whole protocol is shaped around.
    if (!said) throw new Error('Files has not said what is on screen yet.')
    return said.state
  }
  /** Lazily, like every `writable`: built eagerly it would run before the frame had spoken and lose the whole screen. */
  const spoken = (): true | string => (link.said() ? true : 'Files has not said what is on screen yet, so nothing on it can be set.')
  const offers = (what: 'views' | 'sortKeys' | 'groupKeys'): string[] => link.said()?.state.offers[what] ?? []

  /** The commands Files puts at this level, leaving out the ones only a person can finish. */
  const at = (permission: FilesCommand['permission']): FilesCommand[] => link.commands().filter((one) => one.permission === permission && !one.asksFirst)
  const asksFirst = (permission: FilesCommand['permission']): number => link.commands().filter((one) => one.permission === permission && one.asksFirst).length

  /** One action per kind of consequence, with Files' own commands in it. */
  const consequence = (permission: FilesCommand['permission']): SurfaceDeclaration['actions'] => {
    const shape = CONSEQUENCE[permission]
    const offered = at(permission)
    const waiting = asksFirst(permission)
    return {
      [shape.id]: {
        name: shape.name,
        about: `${shape.about}${waiting > 0 ? ` ${waiting} more ask for something on screen, so only a person can finish those.` : ''}`,
        params: {
          command: {
            type: 'string',
            // Files' own titles, so the list reads as the menu does. The whole set of ids is in `enum` beside it.
            description:
              offered.length > 0
                ? `Which one. For example: ${offered
                    .slice(0, 6)
                    .map((one) => `${one.id} (${one.title})`)
                    .join(', ')}${offered.length > 6 ? `, and ${offered.length - 6} more — every id is in this parameter’s values.` : '.'}`
                : 'Files has offered nothing at this level.',
            required: true,
            enum: offered.map((one) => one.id)
          }
        },
        effects: shape.effects,
        confirmation: shape.confirmation,
        unavailable: () => {
          const why = spoken()
          if (why !== true) return why
          return offered.length > 0 ? null : 'Files has not offered anything at this level.'
        },
        run: async (params) => link.ask(FILES_CONTROLS.runCommand, { id: String(params.command) }),
        /*
         * What Files said happened, read out of its own answer.
         *
         * Three different endings, and they are not interchangeable: it finished, it is still waiting for somebody to
         * answer a dialog in Files, or it was a deletion and the things are still listed. Reporting the second as done
         * is how an automation comes to report a file deleted that is sitting in a confirmation box.
         */
        verify: (data) => {
          const outcome = data as FilesCommandOutcome
          if (!outcome || typeof outcome !== 'object') return { done: false, detail: 'Files did not say what happened.' }
          if (!outcome.finished) return { done: false, detail: outcome.waiting ?? `${outcome.title} has not finished.` }
          if (typeof outcome.stillThere === 'number') {
            return outcome.stillThere === 0
              ? { done: true, detail: `${outcome.title}: ${outcome.acted} ${outcome.acted === 1 ? 'item is' : 'items are'} no longer listed.` }
              : { done: false, detail: `${outcome.stillThere} of ${outcome.acted} are still listed.` }
          }
          return { done: true, detail: `Files did ${outcome.title}${outcome.acted > 0 ? ` on ${outcome.acted} ${outcome.acted === 1 ? 'item' : 'items'}` : ''}.` }
        }
      }
    }
  }

  return {
    id: 'browser',
    parent: 'files',
    name: 'Browsing files',
    about: 'The folder that is open, how it is shown, what is selected, and everything Files can be asked to do.',
    kind: 'tool',
    keywords: ['browse', 'folder', 'directory', 'selection', 'explorer'],
    controls: {
      folder: {
        name: 'Folder',
        about: 'The folder the active pane is in. Setting it goes there.',
        spec: { type: 'string', description: 'The full path of a folder on this computer.' },
        get: () => {
          const state = now()
          // A search, a tool and the home screen are all real places and none of them is a folder, so the reading
          // says which one it is in rather than answering with an empty path.
          if (state.folder === null) throw new Error(`Files is not in a folder: it is showing ${state.place}${state.placeDetail ? ` (${state.placeDetail})` : ''}.`)
          return state.folder
        },
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.goTo, { path: String(value ?? '') }))
      },
      view: {
        name: 'View',
        about: 'How the folder is laid out.',
        // Files' own list, as it sent it. There is no copy of it in this window.
        spec: { type: 'string', description: 'How the folder is laid out.', enum: offers('views') },
        get: () => now().view,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.setView, { view: String(value) }))
      },
      sortBy: {
        name: 'Sort by',
        spec: { type: 'string', description: 'Which column the list is ordered by.', enum: offers('sortKeys') },
        get: () => now().sortBy,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.setSort, { key: String(value) }))
      },
      sortDirection: {
        name: 'Sort direction',
        spec: { type: 'string', description: 'Up or down.', enum: ['asc', 'desc'] },
        get: () => now().sortDirection,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.setSort, { direction: value === 'asc' ? 'asc' : 'desc' }))
      },
      foldersFirst: {
        name: 'Folders first',
        spec: { type: 'boolean', description: 'Whether folders are kept above files however the list is sorted.' },
        get: () => now().foldersFirst,
        writable: spoken,
        set: async (on) => void (await link.ask(FILES_CONTROLS.setSort, { foldersFirst: on === true }))
      },
      groupBy: {
        name: 'Group by',
        spec: { type: 'string', description: 'What the list is grouped under. “none” for a flat list.', enum: offers('groupKeys') },
        get: () => now().groupBy,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.setGroup, { key: String(value) }))
      },
      filter: {
        name: 'Filter',
        about: 'Narrows what the folder shows. It does not search; it hides what does not match.',
        spec: { type: 'string', description: 'What to narrow the folder to. Empty shows everything.' },
        get: () => now().filter,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.setFilter, { text: String(value ?? '') })),
        default: ''
      },
      selection: {
        name: 'Selection',
        about: 'The paths selected in the active pane. Everything Files does to files is done to these.',
        spec: { type: 'array', description: 'The full paths to select. An empty list selects nothing.' },
        get: () => now().selection,
        writable: spoken,
        set: async (value) => void (await link.ask(FILES_CONTROLS.select, { paths: Array.isArray(value) ? value : [] }))
      }
    },
    actions: {
      ...consequence('navigate'),
      ...consequence('settings'),
      ...consequence('read'),
      ...consequence('modify'),
      ...consequence('destructive')
    },
    state: () => {
      const said = link.said()
      if (!said) {
        return { activity: 'idle', detail: 'Files has not said what is on screen yet.', values: { said: 'nothing yet', commands: link.commands().length } }
      }
      const state = said.state
      return {
        activity: state.operations > 0 ? 'running' : state.listing === 'loading' ? 'running' : state.listing === 'error' ? 'failed' : 'idle',
        detail: state.listingProblem ?? (state.operations > 0 ? `${state.operations} file ${state.operations === 1 ? 'operation' : 'operations'} going on` : undefined),
        values: {
          place: state.place,
          folder: state.folder ?? `not a folder: ${state.place}${state.placeDetail ? ` (${state.placeDetail})` : ''}`,
          // Never 0 for a folder that has not been read: that is an empty folder, which is a different fact.
          items: state.entries === null ? `the listing is ${state.listing}` : state.entries,
          selected: state.selection.length,
          view: state.view,
          sort: `${state.sortBy} ${state.sortDirection}${state.foldersFirst ? ', folders first' : ''}`,
          grouping: state.groupBy,
          filtering: state.filter === '' ? false : state.filter,
          tabs: state.tabs,
          panes: state.panes,
          operations: state.operations,
          hasTrash: state.canTrash === null ? 'not asked yet' : state.canTrash,
          canBeAskedTo: link.commands().length,
          lastSaid: `${Math.max(0, Math.round((Date.now() - said.at) / 1000))}s ago`
        }
      }
    }
  }
}
