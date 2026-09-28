import type { ContextItem } from '../../shared/contextEngine.ts'
import { pointsAtPresent } from '../../shared/contextEngine.ts'
import type { ContextProvider } from './engine.ts'
import { looksSecret } from '../../shared/skills.ts'
import { isOverdue } from '../../shared/tasks.ts'
import { noteTitle, notePreview } from '../../shared/notes.ts'
import type { Task, TaskList } from '../../shared/tasks.ts'
import type { Note } from '../../shared/notes.ts'
import type { MemoryEntry } from '../../shared/memory.ts'
import type { OrbisBus } from '../../shared/orbisEvents.ts'

/**
 * The real sources of context, one provider each.
 *
 * Each is small on purpose. A provider's whole job is to ask one thing what it knows and say so in the shared shape --
 * it does not decide whether what it found is relevant, how much of it fits, or whether it may be trusted. Those are
 * decided once, for every source, in src/shared/contextEngine.ts.
 *
 * The one judgement providers do make is **trust**, and it is made here because only the provider knows where its text
 * came from. That judgement has a trap in it worth naming, since getting it wrong would quietly undo the whole defence:
 *
 *   A selection is `web`, not `person`.
 *
 * It is tempting to call it the person's, because selecting is something the person did. But what they selected is
 * still text a page chose to display. Marking it `person` would mean any page could acquire authority over Orbis by
 * arranging to be selected. What the act of selecting earns it is `always` -- guaranteed inclusion, because they
 * pointed at it -- and nothing more. Relevance and authority are different things, and this is where they part.
 */

/** Runs one capability for reading. Never confirms: gathering context does not change anything. */
async function read(
  control: { execute: (call: { capability: string; params: Record<string, unknown>; source: 'user' }, options: { confirm: () => Promise<boolean> }) => Promise<{ ok: boolean; data?: unknown; error?: { message?: string } }> },
  capability: string,
  params: Record<string, unknown> = {}
): Promise<unknown> {
  const result = await control.execute({ capability, params, source: 'user' }, { confirm: async () => false })
  if (!result.ok) throw new Error(result.error?.message ?? `${capability} did not answer.`)
  return result.data
}

type Control = Parameters<typeof read>[0] & {
  list?: (filter?: { availableOnly?: boolean; query?: string }, source?: 'user') => { id: string; name?: string; description?: string; mutates?: boolean; available?: boolean }[]
}

// ---------------------------------------------------------------- the page, and what is selected on it

/**
 * The page in front of the person, and their selection on it.
 *
 * Two items rather than one, because they answer different questions and deserve different weight. A selection is what
 * somebody is pointing at; the page is where they happen to be. When both exist the selection almost always wins, and
 * the engine's weighting says so without this file having to.
 *
 * The page text is `trimmable`: the beginning of a long article is worth having, and the engine marks what it cut so
 * the model can say "the part of the page I can see" rather than implying it read the whole thing.
 */
export function pageProvider(control: () => Control | null | undefined, options: { maxChars?: number } = {}): ContextProvider {
  const maxChars = options.maxChars ?? 20_000
  return {
    name: 'The page',
    kind: 'page',
    async gather(request) {
      const c = control()
      // No browser is a fact about the world, not a failure to report as one. An absent source and a broken source are
      // different things, and only the second is a gap.
      if (!c) return []

      const data = (await read(c, 'page.read', { maxChars })) as Record<string, unknown> | null
      const url = typeof data?.url === 'string' ? data.url : ''
      if (!url || !/^https?:/i.test(url)) return []
      const title = String(data?.title ?? '')
      const text = String(data?.text ?? '')
      const selection = String(data?.selection ?? '').trim()

      const out: ContextItem[] = []
      if (selection) {
        out.push({
          id: 'selection',
          kind: 'selection',
          // Still `web`: a page's text does not become the person's by being highlighted. See the note at the top.
          trust: 'web',
          text: selection,
          label: `Selected on ${title || url}`,
          url,
          always: true,
          trimmable: true
        })
      }
      if (text) {
        out.push({
          id: 'page',
          kind: 'page',
          trust: 'web',
          text,
          label: title || url,
          url,
          // Pointed at, so it is not a question of scoring: "summarise this" without this page is unanswerable.
          ...(pointsAtPresent(request.text) || !selection ? { always: pointsAtPresent(request.text) } : {}),
          trimmable: true
        })
      } else {
        // A page that is there but unreadable is worth saying out loud, since the model would otherwise assume silence
        // meant there was no page. Throwing is how a provider reports that, and the engine turns it into a gap.
        throw new Error(`the page at ${url} gave no text`)
      }
      return out
    }
  }
}

// ---------------------------------------------------------------- the other tabs

/**
 * The other tabs, as a list of what they are.
 *
 * Titles and addresses only, never their contents: forty tabs' worth of page text is not context, and reading them all
 * to find out would take longer than the answer. Somebody asking about a tab they are not on gets Orbis *finding* it
 * here and reading it deliberately, which is a capability call rather than a context item.
 */
export function tabsProvider(control: () => Control | null | undefined, options: { max?: number } = {}): ContextProvider {
  const max = options.max ?? 20
  return {
    name: 'Open tabs',
    kind: 'tabs',
    async gather() {
      const c = control()
      if (!c) return []
      const raw = await read(c, 'tabs.list')
      const list = (Array.isArray(raw) ? raw : ((raw as { tabs?: unknown[] })?.tabs ?? [])) as Record<string, unknown>[]
      const tabs = list
        .map((t) => ({ title: String(t?.title ?? ''), url: String(t?.url ?? ''), active: t?.active === true }))
        .filter((t) => t.url && /^https?:/i.test(t.url))

      if (!tabs.length) return []
      const shown = tabs.slice(0, max)
      // Counted honestly. "20 of 43" is context; "20" presented as all of them is a false statement about the browser.
      const heading = shown.length < tabs.length ? `${shown.length} of ${tabs.length} open tabs` : `${tabs.length} open tab${tabs.length === 1 ? '' : 's'}`
      return [
        {
          id: 'tabs',
          kind: 'tabs',
          // Which tabs are open is Orbis's own state. Their titles come from pages, so they are named, never followed.
          trust: 'orbis',
          label: heading,
          text: shown.map((t) => `${t.active ? '(in front) ' : ''}${t.title || '(untitled)'} — ${t.url}`).join(String.fromCharCode(10))
        }
      ]
    }
  }
}

// ---------------------------------------------------------------- what Orbis was asked to remember

/**
 * Memory, through the store's own choosing.
 *
 * `MemoryStore.relevant` already decides this: pinned entries plus a full-text match, capped, and it stamps what it
 * used so somebody can see what Orbis is actually drawing on. Re-ranking that here would be a second opinion about the
 * person's own memory, which is not this engine's business -- and it would lose the stamp.
 */
export function memoryProvider(store: () => { relevant(message: string): MemoryEntry[] } | null | undefined): ContextProvider {
  return {
    name: 'Memory',
    kind: 'memory',
    async gather(request) {
      const s = store()
      if (!s) return []
      return s.relevant(request.text).map((entry) => ({
        id: `memory:${entry.id}`,
        kind: 'memory' as const,
        trust: 'person' as const,
        text: entry.text,
        label: entry.category,
        at: entry.updatedAt,
        // Pinned means the person already answered the relevance question.
        ...(entry.pinned ? { always: true } : {})
      }))
    }
  }
}

// ---------------------------------------------------------------- tasks and notes

/**
 * Tasks, weighted towards the ones that are actually pressing.
 *
 * Done tasks are left out entirely: they are a record, and a record is something to be asked for rather than carried
 * into every conversation. What is overdue is marked as overdue, because "pay the invoice" and "pay the invoice, three
 * days late" are different facts.
 */
export function tasksProvider(
  store: () => { allTasks?: () => Promise<Task[]>; allLists?: () => Promise<TaskList[]> } | null | undefined,
  options: { max?: number } = {}
): ContextProvider {
  const max = options.max ?? 12
  return {
    name: 'Tasks',
    kind: 'task',
    async gather(_request, signal) {
      const s = store()
      if (!s?.allTasks) return []
      const tasks = await s.allTasks()
      if (signal.aborted) return []
      const lists = s.allLists ? await s.allLists().catch(() => [] as TaskList[]) : []
      const named = new Map(lists.map((l) => [l.id, l.name]))
      const now = Date.now()

      return tasks
        .filter((t) => !t.done)
        // Soonest first, and anything undated after everything dated: a deadline is the thing that makes a task urgent.
        .sort((a, b) => (a.due ?? Number.POSITIVE_INFINITY) - (b.due ?? Number.POSITIVE_INFINITY))
        .slice(0, max)
        .map((task) => {
          const where = named.get(task.listId)
          const late = isOverdue(task, now)
          const when = task.due !== undefined ? `${late ? 'overdue, was due' : 'due'} ${new Date(task.due).toISOString().slice(0, 10)}` : ''
          return {
            id: `task:${task.id}`,
            kind: 'task' as const,
            trust: 'person' as const,
            text: [task.title, when, where ? `in ${where}` : ''].filter(Boolean).join(' — '),
            label: 'task',
            at: task.due ?? task.createdAt
          }
        })
    }
  }
}

/**
 * Notes, as titles and openings.
 *
 * A note's preview rather than its body, because a hundred-thousand-character note is allowed and would eat the entire
 * budget to answer a question it had nothing to do with. A note the request actually matches is worth opening properly,
 * and opening it is a capability rather than a thing to do to every note in advance.
 */
export function notesProvider(store: () => { all(): Promise<Note[]> } | null | undefined, options: { max?: number } = {}): ContextProvider {
  const max = options.max ?? 10
  return {
    name: 'Notes',
    kind: 'note',
    async gather(_request, signal) {
      const s = store()
      if (!s) return []
      const notes = await s.all()
      if (signal.aborted) return []
      return notes
        .filter((n) => !n.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, max)
        .map((note) => ({
          id: `note:${note.id}`,
          kind: 'note' as const,
          trust: 'person' as const,
          text: `${noteTitle(note)}: ${notePreview(note, 240)}`,
          label: 'note',
          at: note.updatedAt,
          ...(note.pinned ? { always: true } : {})
        }))
    }
  }
}

// ---------------------------------------------------------------- the clipboard

/**
 * What is on the clipboard -- but only when asked about, and never when it looks like a secret.
 *
 * Both conditions are deliberate. A clipboard is where passwords live for a few seconds on their way into a login
 * field, so including it in every request would eventually send one to a model. So: it is gathered only when the
 * request actually reaches for it, and anything shaped like a credential is left out with a plain reason rather than
 * quietly omitted, so nobody is left wondering why Orbis could not see what they copied.
 */
const ASKS_ABOUT_CLIPBOARD = /\b(clip ?board|copied|copy|paste|pasted|cut)\b/i

export function clipboardProvider(store: () => { all(): Promise<{ id: string; kind: string; content: string; preview: string; copiedAt: number }[]> } | null | undefined): ContextProvider {
  return {
    name: 'Clipboard',
    kind: 'clipboard',
    async gather(request, signal) {
      if (!ASKS_ABOUT_CLIPBOARD.test(request.text)) return []
      const s = store()
      if (!s) return []
      const items = await s.all()
      if (signal.aborted) return []
      const latest = items.filter((i) => i.kind === 'text' && i.content).sort((a, b) => b.copiedAt - a.copiedAt)[0]
      if (!latest) return []
      if (looksSecret(latest.content)) {
        throw new Error('what is on the clipboard looks like a password or key, so Orbis left it out')
      }
      return [
        {
          id: `clipboard:${latest.id}`,
          kind: 'clipboard',
          // Copied by the person, from wherever. Not their own words, so not `person`; not Orbis's state either.
          trust: 'web',
          text: latest.content,
          label: 'On the clipboard',
          at: latest.copiedAt,
          trimmable: true
        }
      ]
    }
  }
}

// ---------------------------------------------------------------- the time, and who is asking

/**
 * The date and time, always.
 *
 * The one piece of context that is needed by almost every question and supplied by none of them. A model asked "what
 * is on next week" without this answers from the date it was trained, which is wrong in a way that looks right.
 */
export function timeProvider(options: { now?: () => Date } = {}): ContextProvider {
  const now = options.now ?? (() => new Date())
  return {
    name: 'The date',
    kind: 'time',
    async gather() {
      const d = now()
      let zone = ''
      try {
        zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
      } catch {
        // A machine that cannot name its own time zone still knows the time. Say what is known.
      }
      return [
        {
          id: 'time',
          kind: 'time',
          trust: 'orbis',
          label: 'Date and time',
          text: `${d.toISOString()}${zone ? ` (the person's time zone is ${zone})` : ''}`,
          at: d.getTime(),
          always: true
        }
      ]
    }
  }
}

/** Who is using Orbis, in the words they used about themselves. Nothing inferred, nothing added. */
export function profileProvider(get: () => { name?: string; title?: string; instructions?: string } | null | undefined): ContextProvider {
  return {
    name: 'Profile',
    kind: 'profile',
    async gather() {
      const p = get()
      const parts = [p?.name ? `They are called ${p.name}` : '', p?.title ? `who describes themselves as ${p.title}` : ''].filter(Boolean)
      const out: ContextItem[] = []
      if (parts.length) out.push({ id: 'profile', kind: 'profile', trust: 'person', text: parts.join(', '), label: 'Who is asking', always: true })
      // Their standing instructions are theirs, so they are included whole and always -- they are the one thing here
      // that is meant to shape an answer rather than inform it.
      if (p?.instructions?.trim()) out.push({ id: 'profile:instructions', kind: 'profile', trust: 'person', text: p.instructions.trim(), label: 'Their standing instructions', always: true })
      return out
    }
  }
}

// ---------------------------------------------------------------- what Orbis can do, and what just happened

/**
 * What Orbis can do here, right now -- offered only when the request sounds like it wants something done.
 *
 * The full registry is over a hundred capabilities and would spend most of a budget describing itself. A question about
 * a page does not need to know that Orbis can rename a tab group. So this is gathered when asked for, and the engine's
 * per-kind ceiling caps it even then.
 */
export function capabilityProvider(control: () => Control | null | undefined, options: { max?: number } = {}): ContextProvider {
  const max = options.max ?? 40
  return {
    name: 'What Orbis can do',
    kind: 'capability',
    async gather(request) {
      const c = control()
      if (!c?.list) return []
      // Matched against the request rather than listed wholesale, and only what is available right now: a capability
      // the browser has but cannot currently run is not something to offer.
      const found = c.list({ availableOnly: true, query: request.text }, 'user')
      if (!found.length) return []
      return found.slice(0, max).map((cap) => ({
        id: `capability:${cap.id}`,
        kind: 'capability' as const,
        trust: 'orbis' as const,
        text: `${cap.id}${cap.description ? ` — ${cap.description}` : cap.name ? ` — ${cap.name}` : ''}${cap.mutates ? ' (changes something)' : ''}`,
        label: 'can do'
      }))
    }
  }
}

/**
 * What has just happened, off the event bus.
 *
 * The bus keeps a bounded recent history for diagnosis, and this is the one place that history is legitimately useful
 * in an answer: "why did that download fail" is a question about something that happened a moment ago. It stays
 * strictly a record of events -- the bus is not a source of truth about current state, and nothing here treats it as
 * one.
 */
export function eventsProvider(bus: OrbisBus | null | undefined, options: { max?: number } = {}): ContextProvider {
  const max = options.max ?? 12
  return {
    name: 'What just happened',
    kind: 'event',
    async gather(request) {
      if (!bus) return []
      const recent = bus.recent(60).filter((e) => (request.profileId === undefined || e.profileId === undefined ? true : e.profileId === request.profileId))
      if (!recent.length) return []
      return recent.slice(-max).map((e) => ({
        id: `event:${e.id}`,
        kind: 'event' as const,
        trust: 'orbis' as const,
        text: `${e.name} (from ${e.source})`,
        label: 'happened',
        at: e.at
      }))
    }
  }
}
