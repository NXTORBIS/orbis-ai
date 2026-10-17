import { matchOne } from '../../../../shared/surfaces.ts'
import type { SurfaceDeclaration, StateDeclaration } from '../../lib/surfaces/registry.ts'

/**
 * What the Toolkit lets Orbis do, as data.
 *
 * The shelf itself: what is being searched for, which category is showing, and which tool is open. It is here
 * rather than inside `ToolkitView` so that the whole chain can be driven in a test with no window, and because the
 * list below has to be read beside it.
 */

/**
 * The tools whose own screens say what can be done on them, by the id the Toolkit knows and the id their screen
 * registers itself under.
 *
 * A list rather than something worked out, for the same reason `CONTROLLABLE_SECTIONS` is one in Settings: whether a
 * tool is controllable is not a property of the tool, it is whether the screen inside it registers a surface. A tool
 * named here whose screen registers nothing is worse than one left out -- Orbis would open it, find nothing there,
 * and be unable to tell "it did not open" from "there is nothing on it". Add to this in the same change as the
 * `useSurface` call in the tool.
 */
export const CONTROLLABLE_TOOLS: Readonly<Record<string, { surface: string; name: string }>> = Object.freeze({
  algorithm: { surface: 'algorithm-visualizer', name: 'Algorithm Visualizer' }
})

/** What the Toolkit screen has to hand over. Each one is a live reader or a handler its own controls call. */
export interface ToolkitScreen {
  /** Every tool on the shelf, as the registry lists them. Empty until the registry has arrived. */
  tools: readonly { id: string; label: string; desc?: string; categoryId: string }[]
  /** The categories down the side, as the registry lists them. */
  categories: readonly { id: string; label: string }[]
  /** Whether the registry has arrived; it is loaded when the screen opens, not with the window. */
  loaded(): boolean
  /** Why it could not be loaded, or an empty string. */
  failed(): string
  /** The tool that is open, or null for the shelf. */
  open(): string | null
  openTool(id: string | null): void
  search(): string
  setSearch(text: string): void
  category(): string
  setCategory(id: string): void
  favourites(): readonly string[]
  /** How many tools the search and the category leave on the shelf. */
  showing(): number
  close(): void
}

export function toolkitSurface(screen: ToolkitScreen): SurfaceDeclaration {
  const ready = (): true | string => {
    const why = screen.failed()
    if (why !== '') return `The Toolkit could not be loaded: ${why}`
    return screen.loaded() ? true : 'The Toolkit is still opening. Its tools are loaded when the screen opens rather than with the window.'
  }

  const labelOf = (id: string | null): string => screen.tools.find((one) => one.id === id)?.label ?? ''

  return {
    id: 'toolkit',
    parent: null,
    name: 'Toolkit',
    about: 'The shelf of calculators, converters and laboratory tools, and the one that is open.',
    kind: 'module',
    keywords: ['toolkit', 'tools', 'tool', 'calculator', 'converter', 'shelf'],
    controls: {
      tool: {
        name: 'Tool',
        /*
         * No list of allowed values, and that is deliberate.
         *
         * There are over two thousand tools, and a list of two thousand ids in the answer to every question about
         * what is on screen would bury everything else in it. So the id is checked when it is set, against the
         * registry, and an unknown one comes back with how to find the right one.
         */
        about: 'Which tool is open. An empty value goes back to the shelf.',
        spec: { type: 'string', description: 'The tool to open, by its id or by the name on its card. Empty goes back to the shelf.' },
        get: () => screen.open() ?? '',
        writable: ready,
        set: (value) => {
          const asked = String(value ?? '').trim()
          if (asked === '') {
            screen.openTool(null)
            return
          }
          const exact = screen.tools.find((one) => one.id === asked)
          if (exact) {
            screen.openTool(exact.id)
            return
          }
          // The same forgiving match the rest of the control layer uses, rather than a second idea of what a name is.
          const found = matchOne(
            asked,
            screen.tools.map((one) => ({ value: one, id: one.id, name: one.label }))
          )
          if (found.kind === 'one') {
            screen.openTool(found.value.id)
            return
          }
          if (found.kind === 'several') throw new Error(`“${asked}” could be ${found.ids.slice(0, 6).join(', ')}${found.ids.length > 6 ? ` or ${found.ids.length - 6} more` : ''}. Say which one.`)
          throw new Error(`The Toolkit has no tool called “${asked}”. There are ${screen.tools.length}; set “search” to a word from its name to find it.`)
        },
        default: ''
      },
      search: {
        name: 'Search tools',
        about: 'Narrows the shelf to the tools whose name, description or id contains every word.',
        spec: { type: 'string', description: 'What to look for. Empty shows everything.' },
        get: () => screen.search(),
        writable: ready,
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      },
      category: {
        name: 'Category',
        about: 'Which group of tools the shelf shows. “all” is everything and “favourites” is the starred ones.',
        spec: { type: 'string', description: 'One of the categories down the side.', enum: ['all', 'favourites', ...screen.categories.map((one) => one.id)] },
        get: () => screen.category(),
        writable: ready,
        set: (value) => screen.setCategory(String(value)),
        default: 'all'
      }
    },
    actions: {
      back: {
        name: 'Back to the shelf',
        about: 'Closes the tool that is open and shows the shelf again.',
        unavailable: () => (screen.open() === null ? 'No tool is open: the shelf is already showing.' : null),
        run: () => {
          const was = screen.open()
          screen.openTool(null)
          return { was }
        },
        verify: () => ({ done: screen.open() === null, detail: screen.open() === null ? 'The shelf is showing.' : `${labelOf(screen.open())} is still open.` })
      },
      close: {
        name: 'Close the Toolkit',
        about: 'Leaves the Toolkit and goes back to where it was opened from.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: Object.entries(CONTROLLABLE_TOOLS).map(([id, one]) => ({
      id: one.surface,
      name: one.name,
      kind: 'tool' as const,
      reach: { kind: 'control' as const, control: 'tool', value: id }
    })),
    state: (): StateDeclaration => {
      const why = screen.failed()
      if (why !== '') return { activity: 'failed', detail: `The Toolkit could not be loaded: ${why}` }
      if (!screen.loaded()) return { activity: 'running', detail: 'The Toolkit is opening.' }
      const open = screen.open()
      return {
        activity: 'idle',
        detail: open === null ? `The shelf, showing ${screen.showing()} of ${screen.tools.length} tools.` : `${labelOf(open)} is open.`,
        values: { tools: screen.tools.length, categories: screen.categories.length, showing: screen.showing(), category: screen.category(), open: open ?? 'the shelf', favourites: screen.favourites().length }
      }
    }
  }
}
