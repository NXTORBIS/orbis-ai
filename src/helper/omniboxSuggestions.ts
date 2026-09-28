import { orbisOnlySuggestions } from '../shared/omniboxOrbis.ts'
import type { PanelStores } from './panelStores.ts'
import type { Handler } from './server.ts'

/**
 * What the browser's own address bar asks Orbis for.
 *
 * Chromium's omnibox is native and stays native; it keeps finding history, bookmarks, open tabs and search
 * suggestions by itself. This channel is the one thing it cannot do for itself -- ask Orbis what it knows -- and it
 * answers with nothing else, so no row is produced twice by two different engines.
 *
 * It is a plain request and answer, and a slow one is simply a late one: the side asking is a Chromium autocomplete
 * provider, which throws away an answer that arrives after the text has moved on.
 */
export interface OmniboxSuggestionDeps {
  stores: () => PanelStores | null | undefined
  /** Orion's predictions for the text. Already empty when the person has suggestions turned off. */
  orion: (input: string) => Promise<string[]>
  /** Whether the person's own history may be drawn on, which is a setting in the Orbis window. */
  personalized: () => Promise<boolean>
  now?: () => number
}

/** Long enough for anything anyone types into an address bar, short enough that nothing has to be trusted. */
const MAX_INPUT = 200
/** The most rows the omnibox will be offered, however many it asks for. */
const MAX_ROWS = 8
const DEFAULT_ROWS = 6
/** Enough saved research to find what is being typed, without walking a history of thousands. */
const RESEARCH_READ = 200
const WORKSPACE_READ = 200

export function createOmniboxSuggestionHandlers(deps: OmniboxSuggestionDeps): Record<string, Handler> {
  return {
    'omnibox:orbis': async ([raw, wanted]) => {
      const input = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_INPUT) : ''
      if (!input) return { rows: [] }
      const limit =
        typeof wanted === 'number' && Number.isFinite(wanted)
          ? Math.min(Math.max(Math.trunc(wanted), 1), MAX_ROWS)
          : DEFAULT_ROWS

      const stores = deps.stores() ?? {}

      // Each source answers for itself. One that is missing or unhappy costs its own rows and nothing else: an
      // address bar that stops suggesting because saved research could not be read would be a worse bargain than
      // one that quietly offers less.
      const [orion, personalized, workspaces] = await Promise.all([
        deps.orion(input).catch(() => [] as string[]),
        deps.personalized().catch(() => true),
        stores.workspaces?.list().catch(() => []) ?? Promise.resolve([])
      ])

      let research: { question: string; at: number }[] = []
      if (personalized && stores.research) {
        try {
          research = stores.research
            .withSources(RESEARCH_READ)
            .map((session) => ({ question: session.title, at: session.updatedAt }))
        } catch {
          research = []
        }
      }

      return {
        rows: orbisOnlySuggestions(
          input,
          {
            research,
            workspaces: workspaces
              .slice(0, WORKSPACE_READ)
              .map((w) => ({ id: w.id, name: w.name, tabCount: w.tabs.length })),
            orion,
            now: deps.now ? deps.now() : Date.now(),
            personalized
          },
          limit
        )
      }
    }
  }
}
