import { matchOne } from '../../../../shared/surfaces.ts'
import type { SurfaceDeclaration, StateDeclaration } from '../../lib/surfaces/registry.ts'

/**
 * What the Laboratories screen lets Orbis do: find one of the sixty-odd laboratories, and open it.
 *
 * ## Why this is a screen worth describing
 *
 * Every laboratory is already controllable down to its parameters once it is open -- that is
 * `components/native/labSurfaces.ts`, built from each app's own declared parameters. What was missing was the step
 * before it. The catalogue is the only screen in Orbis that knows what laboratories exist, and until now Orbis could
 * put it in front of somebody and then not read a word of it: not how many there are, not what they are called, not
 * which subject a thing belongs to, and it could not open one. "Open the circuit laboratory" had to be done by hand.
 *
 * ## Nothing here lists a laboratory
 *
 * The catalogue comes from the main process's own registry, which is what the screen draws from. A laboratory added
 * tomorrow is findable and openable here the same day, with no edit to this file -- the same reason the screen itself
 * lists nothing.
 *
 * ## It is honest about not having read the catalogue
 *
 * The list arrives after the screen opens. Until it has, asking how many laboratories there are has no answer, and a
 * getter that answered `0` would be reporting an empty product because a read had not finished. So those getters
 * throw, and what comes back is `readable: false` with the reason -- which is the rule everywhere in Orbis: a value
 * that was never read is not nought.
 */

/** One laboratory, as the registry describes it to the screen. */
export interface LabsEntry {
  id: string
  name: string
  summary: string
  /** Its subject, by the id the registry uses: `physics`, `chemistry`, `computing`… */
  domain: string
  /** Other names for it: "projectile motion", "trajectory". What somebody is likely to ask for it by. */
  aliases?: readonly string[]
  tags?: readonly string[]
  /** What it says it will not do, which is often the most useful line on its card. */
  limitations?: readonly string[]
  /** The registry's own sentence saying it cannot open here, or null. */
  blocked?: string | null
}

/** What the Laboratories screen hands over. Each one is a live reader or the handler its own control already calls. */
export interface LabsCatalogueScreen {
  /** Every laboratory the registry listed, or null while the catalogue has not been read. */
  catalogue(): readonly LabsEntry[] | null
  /** Why the catalogue could not be read, or null. */
  refused(): string | null
  search(): string
  setSearch(text: string): void
  /**
   * The laboratories the search leaves showing, in the order the screen draws them.
   *
   * The screen's own filtered list rather than a filter written here: two tests for "does this match" would disagree
   * the first time either changed, and the one on screen would be right.
   */
  matching(): readonly LabsEntry[]
  /**
   * Opens one, by the id the registry knows it by -- the screen's own card handler.
   *
   * It is the shell that opens a laboratory rather than this screen: one lives in a card attached to a message, so
   * the conversation has to be found or started and the card added to it. This calls the same function the card does.
   */
  open(appId: string): void
  /**
   * The laboratories open in the conversation now, by app id.
   *
   * This is what makes opening one *confirmable*. The screen that asks for it closes itself a moment later, so
   * nothing on this screen could report the answer; what can is the conversation the card was added to. A laboratory
   * that was already open reads as open, which is the honest answer either way.
   */
  openHere(): readonly string[]
  close(): void
}

/** Waits for something to become true of the conversation, because opening a laboratory is several steps of work. */
async function settle(check: () => boolean, ms = 4000): Promise<boolean> {
  const end = Date.now() + ms
  for (;;) {
    try {
      if (check()) return true
    } catch {
      // Cannot answer yet is not an answer of no.
    }
    if (Date.now() >= end) return false
    await new Promise((wake) => setTimeout(wake, 40))
  }
}

export function labsCatalogueSurface(screen: LabsCatalogueScreen): SurfaceDeclaration {
  /** The list, or the sentence saying why there is no list. Said as a sentence: a bare "no" has no fix in it. */
  const listed = (): readonly LabsEntry[] => {
    const why = screen.refused()
    if (why !== null && why !== '') throw new Error(`The catalogue of laboratories could not be read: ${why}`)
    const got = screen.catalogue()
    if (got === null) throw new Error('The catalogue has not been read yet. It is read when this screen opens rather than with the window.')
    return got
  }

  const ready = (): true | string => {
    try {
      listed()
      return true
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /** The subjects the registry really used, in the order the screen groups them, rather than a list written here. */
  const subjects = (): string[] => [...new Set(listed().map((one) => one.domain))]

  /**
   * Which laboratory somebody meant.
   *
   * The same matching the control layer uses on a path, so "circuit", "Circuit Laboratory" and its id all reach the
   * same card -- and two that answer equally well are never chosen between, because picking one is how an automation
   * opens the wrong thing and reports success.
   */
  const find = (asked: string): LabsEntry => {
    const all = listed()
    const hit = matchOne(
      asked,
      all.map((one) => ({ id: one.id, name: one.name, keywords: [one.domain, ...(one.aliases ?? []), ...(one.tags ?? [])], value: one }))
    )
    if (hit.kind === 'one') {
      /*
       * The registry's own refusal, said before anything is opened.
       *
       * A laboratory can be in the catalogue and still not openable here -- it needs something this computer has not
       * got. Pressing on would put a card in the conversation that cannot do anything, and the sentence the registry
       * already has is better than that.
       */
      const stopped = hit.value.blocked
      if (stopped !== null && stopped !== undefined && stopped !== '') throw new Error(`${hit.value.name} cannot open here: ${stopped}`)
      return hit.value
    }
    if (hit.kind === 'several') {
      throw new Error(`“${asked}” could be any of ${hit.ids.length}: ${hit.ids.join(', ')}. Name one of them.`)
    }
    throw new Error(
      `No laboratory is called “${asked}”. There are ${all.length}, by subject: ${subjects().join(', ')}. Set search to a word and read the state to see what matches.`
    )
  }

  return {
    id: 'labs',
    parent: null,
    name: 'Laboratories',
    about: 'Every laboratory, studio and simulation Orbis has, grouped by subject, and the way into one of them.',
    kind: 'module',
    keywords: ['laboratories', 'laboratory', 'lab', 'labs', 'catalogue', 'simulation', 'simulations', 'experiment', 'experiments', 'studio', 'studios', 'science'],
    controls: {
      search: {
        name: 'Search',
        about: 'Narrows the catalogue by name, by what a laboratory does, or by its tags. Empty shows all of them.',
        spec: { type: 'string', description: 'What to look for — a subject like physics, or a thing to do like titration. Empty shows everything.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      }
    },
    actions: {
      /*
       * An action rather than a control, because opening one is not a value this screen holds.
       *
       * A laboratory opens as a card in the conversation and this screen closes behind it, so there is nothing here
       * to read back afterwards -- which is what a control's confirmation rests on. What can be read is the
       * conversation, and that is what `verify` asks.
       */
      open: {
        name: 'Open a laboratory',
        about: 'Opens one of them as a card in the conversation. Named by its id or by the name on its card.',
        params: {
          lab: {
            type: 'string',
            description: 'Which laboratory: its id, the name on its card, or a word from what it does.',
            required: true
          }
        },
        // It starts a simulation and writes a card into the conversation, which is more than changing what is drawn.
        effects: ['write'],
        unavailable: () => {
          const why = ready()
          return why === true ? null : why
        },
        run: (params) => {
          const want = find(String(params.lab ?? ''))
          const already = screen.openHere().includes(want.id)
          screen.open(want.id)
          return { appId: want.id, name: want.name, already }
        },
        verify: async (data) => {
          const got = data as { appId: string; name: string; already: boolean }
          const there = await settle(() => screen.openHere().includes(got.appId))
          if (!there) {
            return { done: false, detail: `${got.name} has not appeared in the conversation. Either it refused to open, or it is still opening.` }
          }
          return {
            done: true,
            detail: got.already
              ? `${got.name} was already open in this conversation, and still is. Everything on it is at ${got.appId}/…`
              : `${got.name} is open in the conversation. Everything on it is at ${got.appId}/… — its parameters, its clock and its views.`
          }
        }
      },
      clearSearch: {
        name: 'Clear the search',
        about: 'Puts the whole catalogue back.',
        unavailable: () => (screen.search() === '' ? 'Nothing is being searched for.' : null),
        run: () => {
          const was = screen.search()
          screen.setSearch('')
          return { was }
        },
        verify: async () => {
          const empty = await settle(() => screen.search() === '', 1500)
          return { done: empty, detail: empty ? 'The whole catalogue is showing again.' : `The search still says “${screen.search()}”.` }
        }
      },
      close: {
        name: 'Close the laboratories',
        about: 'Goes back to the conversation. Nothing that is open in it is closed.',
        run: () => {
          screen.close()
          return { closed: true }
        }
        /*
         * No `verify`, deliberately.
         *
         * Closing this screen unmounts it, so the only thing that could be asked afterwards is gone with it. The
         * outcome therefore says `attempted` in words -- it was done and nothing here could confirm it -- which is
         * true, and what confirms it is the window's own `screen` control reading `chat`.
         */
      }
    },
    /*
     * No possible children, and that is the honest shape of this screen.
     *
     * Opening a laboratory does not register anything underneath this one: the card appears in the conversation and
     * registers a screen of its own at the top level, under the laboratory's own id. Claiming it as a child here
     * would make a walk take a real step and then be unable to tell "it did not open" from "there is nothing there".
     * The `open` action says where it really went.
     */
    state: (): StateDeclaration => {
      const why = screen.refused()
      if (why !== null && why !== '') {
        return { activity: 'failed', detail: `The catalogue of laboratories could not be read: ${why}`, values: { searching: screen.search() } }
      }
      const all = screen.catalogue()
      if (all === null) {
        return { activity: 'running', detail: 'Reading the catalogue of laboratories.', values: { searching: screen.search() } }
      }
      const open = screen.openHere()
      const bySubject: Record<string, number> = {}
      for (const one of all) bySubject[one.domain] = (bySubject[one.domain] ?? 0) + 1
      const want = screen.search().trim()
      return {
        activity: 'idle',
        detail:
          want === ''
            ? `${all.length} laboratories, grouped by subject. Open one with the open action.`
            : `${screen.matching().length} of ${all.length} match “${want}”.`,
        values: {
          laboratories: all.length,
          matching: screen.matching().length,
          searching: screen.search(),
          subjects: bySubject,
          // Shallow on purpose: sixty names and sixty summaries in the answer to every question would bury it.
          ...(want === '' ? {} : { matches: screen.matching().slice(0, 25).map((one) => ({ id: one.id, name: one.name, subject: one.domain })) }),
          ...(open.length ? { openInThisConversation: [...open] } : {})
        }
      }
    }
  }
}

