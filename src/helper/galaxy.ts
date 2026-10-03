import { GALAXY_TYPES, GALAXY_TYPE_LABELS } from '../shared/galaxy.ts'
import type { GalaxyGraph, GalaxyNode, GalaxyNodeType, GalaxyView } from '../shared/galaxy'
import { newWorkspace, withProjectItem } from '../shared/workspaces.ts'
import type { Workspace } from '../shared/workspaces'
import type { Board } from '../shared/whiteboard'
import type { Note } from '../shared/notes'
import { HelperError } from './server.ts'
import type { Handler } from './server.ts'

/**
 * Galaxy for the panel: the map Electron Orbis draws, from the same GalaxyService (built from the same stores). It can also
 * make and remove the person's own links and prepare the question about a selection, through the same service methods as the
 * Orbis window's IPC handlers.
 */

/** What the panel uses of the GalaxyService. The real one satisfies this as it is. */
export interface GalaxyDeps {
  view(view: GalaxyView): Promise<GalaxyGraph>
  describe(id: string): Promise<unknown>
  /** Rebuild on the next look, as the Orbis window does when it opens the map. */
  refresh?(): void
  link?(from: string, to: string, note?: string): Promise<unknown>
  unlink?(id: string): boolean
  askAbout?(ids: string[], question: string): Promise<string>
  /** The app's own stores, for keeping a selection. Without them the save channels say they are not connected. */
  notes?: { create(patch: Partial<Note>): Promise<Note> }
  whiteboard?: { create(patch: Partial<Board>): Promise<Board>; add(id: string, elements: unknown[]): Promise<Board> }
  workspaces?: { list(): Promise<Workspace[]>; save(workspace: Workspace): Promise<Workspace> }
}

const bad = (message: string): HelperError => new HelperError('bad-request', message)
const MAX_SELECTION = 50

const idArg = (x: unknown, max: number, what: string): string => {
  if (typeof x !== 'string' || !x || x.length > max) throw new HelperError('bad-request', `Expected ${what}.`)
  return x
}

/** The same rules the Orbis window's own request goes through: known types, bounded text and limits. */
export function readView(raw: unknown): GalaxyView {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) throw new HelperError('bad-request', 'The view must be an object.')
  const v = (raw ?? {}) as Record<string, unknown>
  const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)
  return {
    ...(Array.isArray(v.types) ? { types: v.types.filter((t): t is GalaxyNodeType => GALAXY_TYPES.includes(t as GalaxyNodeType)) } : {}),
    ...(typeof v.query === 'string' ? { query: v.query.slice(0, 200) } : {}),
    ...(typeof v.focus === 'string' ? { focus: v.focus.slice(0, 2100) } : {}),
    ...(num(v.depth) !== undefined ? { depth: num(v.depth) } : {}),
    ...(num(v.from) !== undefined ? { from: num(v.from) } : {}),
    ...(num(v.to) !== undefined ? { to: num(v.to) } : {}),
    limit: num(v.limit) !== undefined ? Math.max(10, Math.min(1500, num(v.limit)!)) : 400
  }
}

/** The selected ids, each one checked to be a star that is on the map right now. */
async function selection(d: GalaxyDeps, raw: unknown): Promise<GalaxyNode[]> {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SELECTION) throw bad(`Select between 1 and ${MAX_SELECTION} items.`)
  const ids = [...new Set(raw.map((x) => (typeof x === 'string' && x.length <= 2100 ? x : ''))) ]
  if (ids.includes('')) throw bad('Those are not items on the map.')
  const map = new Map((await d.view({ limit: 1500 })).nodes.map((n) => [n.id, n]))
  return ids.map((id) => map.get(id) ?? (() => { throw new HelperError('not-found', 'One of those is no longer on the map.') })())
}
const label = (n: GalaxyNode): string => GALAXY_TYPE_LABELS[n.type]

export function createGalaxyHandlers(getDeps: () => GalaxyDeps | null | undefined): Record<string, Handler> {
  const deps = (): GalaxyDeps => {
    const d = getDeps()
    if (!d) throw new HelperError('unavailable', 'Galaxy is not ready yet. Try again in a moment.')
    return d
  }
  return {
    'galaxy:view': async (a) => {
      const d = deps()
      const view = readView(a[0])
      d.refresh?.()
      return d.view(view)
    },
    /** Projects a selection can be added to: name and how many things each holds. */
    'galaxy:projects': async () => {
      const spaces = deps().workspaces
      if (!spaces) throw new HelperError('unavailable', 'Projects are not connected in this build.')
      return (await spaces.list()).filter((w) => w.project).map((w) => ({ id: w.id, name: w.name, items: w.project!.items.length }))
    },
    /** Adds the selection to a project (an existing one, or a new one named here). The project refers to them; nothing is copied. */
    'galaxy:save-project': async (a) => {
      const d = deps()
      if (!d.workspaces) throw new HelperError('unavailable', 'Projects are not connected in this build.')
      const nodes = (await selection(d, a[1])).filter((n) => n.type !== 'workspace')
      if (!nodes.length) throw bad('Projects hold research, notes, tasks, memories, skills and pages, not other workspaces.')
      const t = a[0]
      let space: Workspace
      if (typeof t === 'string') {
        if (!t || t.length > 80) throw bad('Expected a project.')
        const found = (await d.workspaces.list()).find((w) => w.id === t && w.project)
        if (!found) throw new HelperError('not-found', 'That project no longer exists.')
        space = found
      } else if (t && typeof t === 'object' && typeof (t as { newName?: unknown }).newName === 'string') {
        const name = (t as { newName: string }).newName.replace(/\s+/g, ' ').trim().slice(0, 60)
        if (!name) throw bad('A project needs a name.')
        space = newWorkspace({ name, project: { goal: '', instructions: '', model: '', outputFormat: '', items: [] } })
      } else throw bad('Choose a project, or give a new one a name.')
      for (const n of nodes) space = withProjectItem(space, n.id)
      const saved = await d.workspaces.save(space)
      return { id: saved.id, name: saved.name, added: nodes.length, items: saved.project?.items.length ?? 0 }
    },
    /** A note listing the selection, exactly as the Orbis window writes it. */
    'galaxy:save-note': async (a) => {
      const d = deps()
      if (!d.notes) throw new HelperError('unavailable', 'Notes are not connected in this build.')
      const nodes = await selection(d, a[0])
      const lines = nodes.map((n) => `- ${label(n)}: ${n.label}${n.url ? ` (${n.url})` : ''}`)
      const first = nodes[0]
      const note = await d.notes.create({
        title: nodes.length === 1 ? first.label.slice(0, 120) : `Galaxy: ${nodes.length} items`,
        body: `From Galaxy:\n\n${lines.join('\n')}`,
        ...(nodes.length === 1 && first.url && /^https?:\/\//i.test(first.url) ? { source: { url: first.url, title: first.label, savedAt: Date.now() } } : {})
      })
      return { id: note.id, title: note.title, count: nodes.length }
    },
    /** A new whiteboard with one card per selected item. */
    'galaxy:save-board': async (a) => {
      const d = deps()
      if (!d.whiteboard) throw new HelperError('unavailable', 'Whiteboards are not connected in this build.')
      const nodes = await selection(d, a[0])
      const board = await d.whiteboard.create({ name: `Galaxy \u2014 ${nodes[0].label.slice(0, 40)}` })
      const elements = nodes.map((n, i) => ({
        kind: 'note',
        at: { x: 60 + (i % 4) * 220, y: 60 + Math.floor(i / 4) * 180 },
        width: 200,
        height: 150,
        text: `${label(n)}\n${n.label}${n.detail ? `\n${n.detail}` : ''}${n.url ? `\n${n.url}` : ''}`
      }))
      await d.whiteboard.add(board.id, elements)
      return { id: board.id, name: board.name, count: elements.length }
    },
    'galaxy:describe': async (a) => {
      if (typeof a[0] !== 'string' || !a[0] || a[0].length > 2100) throw new HelperError('bad-request', 'Expected a node id.')
      return deps().describe(a[0])
    },
    'galaxy:link': async (a) => {
      const d = deps()
      if (!d.link) throw new HelperError('unavailable', 'Linking is not available.')
      if (a[2] !== undefined && a[2] !== null && typeof a[2] !== 'string') throw new HelperError('bad-request', 'The note must be text.')
      const note = typeof a[2] === 'string' ? a[2].slice(0, 200) || undefined : undefined
      return d.link(idArg(a[0], 2100, 'a node id'), idArg(a[1], 2100, 'a node id'), note)
    },
    'galaxy:unlink': async (a) => {
      const d = deps()
      if (!d.unlink) throw new HelperError('unavailable', 'Unlinking is not available.')
      return d.unlink(idArg(a[0], 80, 'a link id'))
    },
    'galaxy:ask': async (a) => {
      const d = deps()
      if (!d.askAbout) throw new HelperError('unavailable', 'Asking Orion is not available.')
      if (!Array.isArray(a[0]) || a[0].length > 40 || a[0].some((i) => typeof i !== 'string' || !i || i.length > 2100)) throw new HelperError('bad-request', 'Expected up to 40 node ids.')
      if (a[1] !== undefined && typeof a[1] !== 'string') throw new HelperError('bad-request', 'The question must be text.')
      return d.askAbout(a[0] as string[], ((a[1] as string | undefined) ?? '').slice(0, 1000))
    }
  }
}
