/**
 * Which of Orbis's screens a person has asked to see, and the one function everything asks about it.
 *
 * Orbis has nineteen feature screens in one flat menu, plus the browser, Files, Chance and Settings. Everything was
 * offered to everybody, so the menu was a list nobody could scan and most of it was a list nobody wanted. The answer
 * is not to delete anything: it is to let somebody say what they are here for, and keep the rest out of the way but
 * one click from coming back.
 *
 * ## Four words, and they are not the same thing
 *
 * This file answers exactly one of them.
 *
 *   **available**    Orbis has it at all: there is a capability for it in `commandCenter.ts` and a screen behind it.
 *   **visible**      it is in *this person's* menu. That is this file, and nothing else in Orbis decides it.
 *   **enabled**      it may run. A separate question with separate switches, most of them already in Settings --
 *                    `keepSchedulesRunning`, `visualSearch`, the clipboard watcher. Hiding a screen never turns an
 *                    engine off, and turning an engine off never hides a screen.
 *   **operational**  it works *right now*: the helper is answering, the browser is reachable, there is a key, the
 *                    Stockfish binary is really on disk. `isAvailable(capability, readiness)` in `commandCenter.ts`
 *                    answers that, and this file deliberately does not pretend to.
 *
 * So a feature can be available and not visible. A feature can be visible and not operational -- and the interface
 * must say which, because "enabled but its engine is missing" reported as working is the one failure nobody goes
 * looking for.
 *
 * ## Nothing here can lock anybody out
 *
 * The essentials have no switch at all, in the type as well as in the interface: the chat, the browser, Files, the
 * palette and Settings. Settings is where the switch for everything else lives, so a choice that could hide Settings
 * is a choice somebody can make once and never undo. `setVisible` refuses an essential rather than silently ignoring
 * it, so a caller gets told.
 *
 * ## Hiding is not deleting
 *
 * A hidden feature keeps every byte. Its store is untouched, its engines keep running, its data travels in a profile
 * export. Turning it back on shows exactly what was there. An id this version does not recognise is *kept* in the
 * saved choice rather than dropped, for the same reason: a feature renamed or temporarily removed must not quietly
 * lose somebody's answer about it.
 *
 * Pure: no DOM, no storage, no Electron. Tested in `featureVisibility.test.ts`.
 */

import { CAPABILITIES, type AppFeature, type OrbisCapability } from './commandCenter.ts'

// ---------------------------------------------------------------- what can be in a menu

/**
 * The parts of Orbis that are not one of the nineteen feature screens but are still a place somebody goes.
 *
 * They are here because the question "is this visible?" is asked about them too -- the palette asks it about Files,
 * Orion asks it about the browser -- and an id the function does not recognise would have to answer "no", which for
 * the chat would be a lie with consequences.
 */
export type CoreSurface =
  /** Orbis Chat. The thing Orbis is. Never optional, never hideable, never behind a choice. */
  | 'chat'
  /** The Orbis browser. How somebody gets to the web, and where half the capabilities live. */
  | 'browser'
  /** Files: what Orbis has made and what has been given to it. */
  | 'files'
  /** Settings. Where the switch for everything else is, so it can never be the thing that is switched off. */
  | 'settings'
  /** The command palette and chat search (Ctrl+K). How somebody gets anywhere without a menu at all. */
  | 'palette'
  /** Chance: the odds, dice and decision workspace, framed in its own window. */
  | 'chance'

/** Anything the visibility question can be asked about. */
export type SurfaceId = AppFeature | CoreSurface

/** Everyone has it and there is no switch, or the person chooses. There is no third answer. */
export type Standing = 'essential' | 'optional'

export interface FeatureFacts {
  id: SurfaceId
  /** What a person calls it. For the core surfaces; for a feature screen the registry's `name` is the better answer. */
  label: string
  standing: Standing
  /** One line, in the words somebody would use. What happens on screen, not what the code calls it. */
  blurb: string
  /**
   * Other surfaces this one cannot be useful without.
   *
   * Hard: a feature whose need is hidden is not visible, however it was saved, because showing it would be a route to
   * a screen that cannot do its job. Kept small on purpose -- most of these screens stand alone.
   */
  needs: readonly SurfaceId[]
  /**
   * This one is an empty front door unless at least one of these is visible.
   *
   * Arena is the only case: it is a landing page onto Football and F1, and with both hidden it is a heading over
   * nothing. Different from `needs` because any one of them is enough.
   */
  needsAnyOf: readonly SurfaceId[]
  /** A brand-new profile starts with this one showing. */
  startsOn: boolean
  /**
   * Other parts of the interface that go away with this screen, in plain words.
   *
   * The thing three other agents need from this file and cannot get from the registry. Hiding Markets must also take
   * the price strip along the bottom, or somebody has hidden Markets and is still looking at Markets. Hiding Create
   * must take the chat's offer to turn an answer into a file, because an offer that opens a hidden screen is the
   * "never claim a thing is on when it is off" rule broken in one click.
   */
  alsoHides: readonly string[]
}

const facts = (one: FeatureFacts): FeatureFacts => Object.freeze({ ...one })

/**
 * Every surface, classified.
 *
 * Judged by reading what each one is in this repository, not by its name. The notes say why for the ones where the
 * answer is arguable, because the arguable ones are where this decision will be re-litigated.
 */
export const FEATURE_FACTS: readonly FeatureFacts[] = Object.freeze([
  // ---------------------------------------------------------------- the core surfaces: no switch, ever

  facts({
    id: 'chat',
    label: 'Orbis Chat',
    standing: 'essential',
    blurb: 'Where you talk to Orion, and where everything starts.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'browser',
    label: 'Browser',
    standing: 'essential',
    // Sixty-two of the eighty-one capabilities are the browser's. It is not a feature beside the others; it is one
    // of the two halves of Orbis, and the only thing that can open a web page.
    blurb: 'The web, in Orbis’s own browser.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'files',
    label: 'Files',
    standing: 'essential',
    // Everything the other screens make lands here -- documents from Create, pictures from the image engine, what
    // was downloaded. Hiding it would hide the output of features that are still on.
    blurb: 'Everything Orbis has made for you, and everything you have given it.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'palette',
    label: 'Search and the command palette',
    standing: 'essential',
    // The way back. Somebody who hides every screen must still be able to type the name of the one they want.
    blurb: 'Type what you want and go straight to it.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'settings',
    label: 'Settings',
    standing: 'essential',
    // The switch for everything else is in here. A choice that could hide this is a choice nobody could undo.
    blurb: 'Everything you can change, including which features you see.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'chance',
    label: 'Chance',
    standing: 'optional',
    /*
     * The one core surface that is a choice.
     *
     * It sits in the sidebar's top rows beside Files and the browser, which reads as essential, but it is not one of
     * the ways somebody gets anywhere: it is a workspace about odds and decisions, its own project framed in a
     * window. A person who never gambles and never rolls dice has no use for it, and nothing else in Orbis stops
     * working when it is away. On by default, because it is already in everybody's sidebar and taking it away
     * without being asked would be a change rather than a choice.
     */
    blurb: 'Odds, dice and working out what to pick.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: ['the Chance row in the sidebar']
  }),

  // ---------------------------------------------------------------- the four small personal ones: essential
  //
  // These are the ones worth arguing about, and the argument came out the same way four times.
  //
  // Each is small, personal, and -- crucially -- *already running whether or not its screen is on view*. The
  // clipboard watcher captures, the schedules fire, a meeting is recorded, a workspace is saved from the browser's
  // own sidebar. A switch here would hide the only window onto something still happening, which is precisely the
  // "never claim a thing is on when it is off" failure, pointing the other way: a background thing running with
  // nowhere to see it.
  //
  // They also already have switches, and the switches are about *enabled*, not *visible*: `keepSchedulesRunning`
  // and `wakeForSchedules` in Settings decide whether schedules run at all, and the clipboard has its own paused
  // state. Adding four visibility switches beside those would give each of these two switches meaning different
  // things, which is four more ways to be confused rather than four fewer rows.
  //
  // So: four always-present screens, no switches, no clutter saved by hiding them -- they are four rows out of
  // nineteen and the cheapest four.

  facts({
    id: 'notes',
    label: 'Notes',
    standing: 'essential',
    blurb: 'Notes you keep, and what was said in a meeting.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'clipboard',
    label: 'Clipboard',
    standing: 'essential',
    blurb: 'What you have copied lately.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'workspaces',
    label: 'Workspaces',
    standing: 'essential',
    blurb: 'Sets of tabs kept together and reopened as one.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'schedules',
    label: 'Schedules',
    standing: 'essential',
    blurb: 'Things Orbis does at a time you chose.',
    needs: [],
    needsAnyOf: [],
    startsOn: true,
    alsoHides: []
  }),

  // ---------------------------------------------------------------- the specialist workspaces: a choice
  //
  // Each of these is a whole program behind one row. Somebody who does not play chess has no use for a chess club,
  // and offering it to them is the clutter. All of them keep their data and keep working when they are away.

  facts({
    id: 'create',
    label: 'Create',
    standing: 'optional',
    blurb: 'Make tables and documents, saved as real files.',
    needs: [],
    needsAnyOf: [],
    // On for a new profile. It is where an answer in the chat becomes a file somebody can send, which is a general
    // want rather than a specialist one -- it is the only optional screen the chat itself hands work to.
    startsOn: true,
    alsoHides: ['the chat’s offer to turn an answer into a document or a table']
  }),
  facts({
    id: 'pages',
    label: 'Pages',
    standing: 'optional',
    blurb: 'Small tools with their own addresses, including ones Orion builds for you.',
    needs: [],
    needsAnyOf: [],
    // On for a new profile: it is the general-purpose "I need a tool for this" surface, not a subject.
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'toolkit',
    label: 'Toolkit',
    standing: 'optional',
    blurb: 'Thousands of calculators and converters that work without the internet.',
    needs: [],
    needsAnyOf: [],
    // On for a new profile, for the same reason as Pages: everybody converts something eventually.
    startsOn: true,
    alsoHides: []
  }),
  facts({
    id: 'whiteboard',
    label: 'Whiteboard',
    standing: 'optional',
    blurb: 'Boards to draw on and gather things on.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'chess',
    label: 'Chess World',
    standing: 'optional',
    blurb: 'Play the engine, study your games, train, and follow live tournaments.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'markets',
    label: 'Markets',
    standing: 'optional',
    blurb: 'Live prices, charts and watchlists.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    // The strip along the bottom of the window reads the Markets feed. Somebody who has hidden Markets and is still
    // watching prices scroll past has not hidden Markets.
    alsoHides: ['the price strip along the bottom of the window']
  }),
  facts({
    id: 'labs',
    label: 'Laboratories',
    standing: 'optional',
    blurb: 'Experiments you can run, by subject.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'student',
    label: 'Student',
    standing: 'optional',
    blurb: 'Focus sessions, goals, daily learning and Orbi.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'courses',
    label: 'Courses',
    standing: 'optional',
    // Courses carries its own lesson content and its own lab blocks; it does not open the Laboratories screen, so
    // it is not listed as needing it. Checked by reading the engine rather than assumed from the names.
    blurb: 'Learn a subject properly, with what you know actually measured.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'neurova',
    label: 'NEUROVA',
    standing: 'optional',
    blurb: 'Song projects: keep versions of your audio, check it, and export it.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'arcade',
    label: 'Arcade',
    standing: 'optional',
    blurb: 'Games that work with no connection, and keep your scores.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'cosmos',
    label: 'ORBIS COSMOS',
    standing: 'optional',
    blurb: 'A 3D universe you can fly through, to scale.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'eye',
    label: 'OrbisEye',
    standing: 'optional',
    blurb: 'A live 3D Earth: aircraft, ships, satellites, earthquakes and cameras.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),

  // ---- the Arena and its sports

  facts({
    id: 'arena',
    label: 'Arena',
    standing: 'optional',
    blurb: 'The front door to live sport in Orbis.',
    needs: [],
    // The only `needsAnyOf` in the table, and it is not tidiness. Arena is a landing page: it lists what sport
    // Orbis carries and sends you into it. With Football and F1 both hidden it is a heading over an empty page,
    // which is a route that renders as live and goes nowhere -- the bug this product has shipped before.
    needsAnyOf: ['football', 'f1'],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'football',
    label: 'Football',
    standing: 'optional',
    // Not listed as needing Arena: the launcher and the palette open Football directly, and it is a whole screen on
    // its own. Arena is a convenience on top, not a container.
    blurb: 'Live scores, fixtures, tables and form.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  }),
  facts({
    id: 'f1',
    label: 'F1',
    standing: 'optional',
    blurb: 'Formula 1: the calendar, results, standings and lap times.',
    needs: [],
    needsAnyOf: [],
    startsOn: false,
    alsoHides: []
  })
])

const BY_ID: ReadonlyMap<string, FeatureFacts> = new Map(FEATURE_FACTS.map((one) => [one.id as string, one]))

export const factsFor = (id: string): FeatureFacts | undefined => BY_ID.get(id)

/** Everything with no switch. Always visible, in every profile, for ever. */
export const ESSENTIAL_IDS: readonly SurfaceId[] = Object.freeze(FEATURE_FACTS.filter((one) => one.standing === 'essential').map((one) => one.id))

/** Everything somebody chooses. These are the switches the interface draws. */
export const OPTIONAL_IDS: readonly SurfaceId[] = Object.freeze(FEATURE_FACTS.filter((one) => one.standing === 'optional').map((one) => one.id))

export const isEssential = (id: string): boolean => BY_ID.get(id)?.standing === 'essential'

/** What a brand-new profile starts with: the essentials, plus Create, Pages and Toolkit. See `newChoice` for why. */
export const STARTING_IDS: readonly SurfaceId[] = Object.freeze(FEATURE_FACTS.filter((one) => one.startsOn).map((one) => one.id))

/**
 * The one line to show for a surface, preferring the registry's own words for a feature screen.
 *
 * The registry already writes a description for each of the nineteen, and two copies of a sentence is one copy that
 * goes stale. `blurb` above is the answer for the six core surfaces, which have no capability of their own, and the
 * fallback for anything else.
 */
export function blurbFor(id: string): string {
  const capability = CAPABILITIES.find((one) => one.app === id)
  return capability?.description ?? BY_ID.get(id)?.blurb ?? ''
}

/** The capability behind a feature screen, when there is one. The six core surfaces have none. */
export const capabilityFor = (id: string): OrbisCapability | undefined => CAPABILITIES.find((one) => one.app === id)

// ---------------------------------------------------------------- shared services, which are nobody's switch

/**
 * The things several features are built on, which must never become a switch.
 *
 * Written down because the failure mode is specific and expensive: somebody adds a switch for a *screen* and
 * accidentally takes out a *service* the chat was using, and the chat gets quietly worse with nothing to point at.
 * Hiding Markets takes the price strip; it must not take the market feed the chat quotes from. Hiding Pages takes
 * the Pages library; it must not take the compute engines the chat adds up with.
 *
 * None of these has an entry in `FEATURE_FACTS`, and that is the point. They are not places somebody goes.
 */
export const SHARED_SERVICES: readonly { id: string; label: string; where: string; blurb: string; usedBy: readonly string[] }[] = Object.freeze([
  Object.freeze({
    id: 'registry',
    label: 'The capability list',
    where: 'src/shared/commandCenter.ts',
    blurb: 'What Orbis can do, as one list, which both the window and the browser read.',
    usedBy: Object.freeze(['palette', 'browser', 'chat', 'settings'])
  }),
  Object.freeze({
    id: 'orion',
    label: 'Orion',
    where: 'the model layer',
    blurb: 'The model that answers. Every screen that asks a question asks it.',
    usedBy: Object.freeze(['chat', 'create', 'pages', 'student', 'courses', 'neurova', 'labs', 'eye'])
  }),
  Object.freeze({
    id: 'compute',
    label: 'The compute engines',
    where: 'src/shared/compute',
    blurb: 'The maths and science engines. They work things out; they are not a screen.',
    usedBy: Object.freeze(['pages', 'labs', 'toolkit', 'courses', 'chat'])
  }),
  Object.freeze({
    id: 'context',
    label: 'The Context Engine',
    where: 'src/shared/contextEngine.ts',
    blurb: 'What Orbis knows about what you are doing right now, gathered from everywhere.',
    usedBy: Object.freeze(['chat', 'palette', 'browser'])
  }),
  Object.freeze({
    id: 'ambient',
    label: 'Ambient Intelligence',
    where: 'src/shared/ambient',
    blurb: 'The quiet watcher that feeds the Context Engine. It has no screen of its own.',
    usedBy: Object.freeze(['chat'])
  }),
  Object.freeze({
    id: 'notifications',
    label: 'Notifications',
    where: 'src/shared/notifications.ts',
    blurb: 'The one place that interrupts you. Everything that needs to tell you something goes through it.',
    usedBy: Object.freeze(['chat', 'schedules', 'markets', 'browser', 'student'])
  }),
  Object.freeze({
    id: 'temporal',
    label: 'The schedule runner',
    where: 'src/shared/temporal',
    blurb: 'What makes a thing happen at a time you chose. It runs whether or not the Schedules screen is open.',
    usedBy: Object.freeze(['schedules', 'chat', 'browser', 'markets'])
  }),
  Object.freeze({
    id: 'marketFeed',
    label: 'The market feed',
    where: 'src/shared/markets',
    blurb: 'Where prices come from. The chat quotes it too, so it outlives the Markets screen.',
    usedBy: Object.freeze(['markets', 'chat'])
  }),
  Object.freeze({
    id: 'assets',
    label: 'Logos and pictures',
    where: 'src/shared/assets.ts',
    blurb: 'The pictures for a company, a coin or a team, looked up once for whoever needs one.',
    usedBy: Object.freeze(['markets', 'football', 'f1', 'chat'])
  }),
  Object.freeze({
    id: 'control',
    label: 'The browser control bridge',
    where: 'src/main/browserControl',
    blurb: 'How Orbis works its own browser. Every capability that touches a page goes through it.',
    usedBy: Object.freeze(['browser', 'chat', 'palette'])
  }),
  Object.freeze({
    id: 'profiles',
    label: 'Profiles and settings',
    where: 'src/shared/profiles.ts, src/main/store.ts',
    blurb: 'Who is using Orbis, and what they have chosen. Including this very choice.',
    usedBy: Object.freeze(['settings', 'chat', 'browser'])
  }),
  Object.freeze({
    id: 'storage',
    label: 'The small JSON store',
    where: 'src/main/storage/jsonFile.ts',
    blurb: 'What every feature keeps its own things in, one file at a time.',
    usedBy: Object.freeze(['settings', 'notes', 'schedules', 'clipboard', 'workspaces'])
  })
])

// ---------------------------------------------------------------- what is saved

/**
 * The shape of the saved choice.
 *
 * The version is **inside** the payload rather than in `JsonFile`'s own wrapper, deliberately. `JsonFile` throws on a
 * file written by a newer Orbis, and a throw there means the file is moved aside -- which for this file would mean
 * somebody going back one version loses every choice they made. Reading the version here instead lets a newer file be
 * read for everything this version understands, kept exactly as it is, and refused for writing. Nothing is lost
 * either way.
 */
export interface VisibilityChoice {
  /** The shape this was written at. */
  version: number
  /**
   * The optional surfaces that are showing.
   *
   * Only the optional ones. An essential is never in here and never needs to be: it is visible by the type of thing
   * it is, so a saved list that happened to omit it could not take it away.
   */
  shown: readonly SurfaceId[]
  /**
   * Ids in the file this version does not recognise, kept exactly as found.
   *
   * A feature renamed, or removed for a release and brought back, must not quietly lose somebody's answer. They are
   * never visible -- there is nothing to show -- and they are written back untouched.
   */
  unknown: readonly string[]
  /** True once the person has actually been asked. False means the set above is Orbis's guess, not their answer. */
  chosen: boolean
  /** When they last changed it. 0 when they never have. */
  chosenAt: number
  /**
   * True when the file was written by a newer Orbis than this one.
   *
   * The store refuses to write over it: this version would be writing back a worse copy, dropping whatever the newer
   * one knew about. Everything this version does understand is still read and still used, so the app works.
   */
  fromNewer: boolean
}

export const VISIBILITY_VERSION = 1

/**
 * What a brand-new profile gets: the essentials, plus Create, Pages and Toolkit.
 *
 * Not everything -- everything is today's clutter, and a nineteen-row menu on the first run is the problem this is
 * being built to fix. Not nothing either: an app that opens onto an empty menu reads as broken, and a person who has
 * to go and switch things on before Orbis does anything has been handed a setup task instead of an assistant.
 *
 * So: the five ways of getting anywhere, the four small personal screens, Chance where it already is, and exactly
 * three of the specialist ones -- the three that are not a subject. Create is where an answer becomes a file.
 * Pages and Toolkit are the generic "I need a tool for this" surfaces. Everything else -- chess, sport, markets,
 * space, courses, study, music, labs, boards -- is an interest somebody declares, and a declared interest is a
 * choice rather than a default. Twelve rows instead of twenty-five, and every one of the other thirteen is one
 * switch away.
 */
export const newChoice = (now = 0): VisibilityChoice =>
  Object.freeze({
    version: VISIBILITY_VERSION,
    shown: Object.freeze(OPTIONAL_IDS.filter((id) => BY_ID.get(id)?.startsOn === true)),
    unknown: Object.freeze([]),
    chosen: false,
    chosenAt: now,
    fromNewer: false
  })

/**
 * What somebody who already uses Orbis gets: everything, exactly as it is today.
 *
 * The hard rule of this whole change. Somebody who has been using Orbis for months must not open it to find
 * thirteen screens gone and an onboarding step in front of them. There is no saved choice for them because the
 * choice did not exist when they started, and absence of a choice is not a choice. So an installation that has
 * already finished setting up gets the menu it had, `chosen` stays false, and the next time they are in Settings
 * they can take things off themselves.
 *
 * Nothing is written when this is used. It is worked out again on every start, which costs nothing and means the
 * guess is never frozen into a file as though the person had made it.
 */
export const everythingChoice = (now = 0): VisibilityChoice =>
  Object.freeze({
    version: VISIBILITY_VERSION,
    shown: Object.freeze([...OPTIONAL_IDS]),
    unknown: Object.freeze([]),
    chosen: false,
    chosenAt: now,
    fromNewer: false
  })

/**
 * Whatever was in the file, as a choice this code will use, plus what could not be read.
 *
 * Never throws and never falls back to defaults wholesale: a value it cannot make sense of costs that one value and
 * is said out loud in `notes`. The caller decides what to show somebody; this decides what is true.
 *
 * `settled` is what an installation with no file at all gets -- `everythingChoice` for somebody already using Orbis,
 * `newChoice` for a first run. It is asked for here rather than guessed because this file cannot know, and guessing
 * wrong in one direction drops an existing person into onboarding.
 */
export function readVisibility(raw: unknown, o: { settled: boolean; now?: number } = { settled: false }): { value: VisibilityChoice; notes: string[] } {
  const now = o.now ?? 0
  const blank = (): VisibilityChoice => (o.settled ? everythingChoice(now) : newChoice(now))

  if (raw === null || raw === undefined) return { value: blank(), notes: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      value: blank(),
      notes: ['What was saved about which features you see was not in a shape Orbis understands, so it has started from the usual set. Nothing else has been changed.']
    }
  }

  const given = raw as Record<string, unknown>
  const notes: string[] = []

  const version = typeof given.version === 'number' && Number.isFinite(given.version) && given.version >= 1 ? Math.floor(given.version) : 1
  if (typeof given.version !== 'number') notes.push('What was saved did not say which version of Orbis wrote it, so it has been read as the oldest shape.')

  const fromNewer = version > VISIBILITY_VERSION
  if (fromNewer) {
    notes.push(
      `A newer version of Orbis saved which features you see (version ${version}; this one reads ${VISIBILITY_VERSION}). Everything this version understands is being used, and it will not be written over.`
    )
  }

  const optional = new Set<string>(OPTIONAL_IDS as readonly string[])
  const shown: SurfaceId[] = []
  const unknown: string[] = []

  if (!Array.isArray(given.shown)) {
    // No list at all is a different thing from an empty list, and the difference matters: empty is "I turned
    // everything off", which is allowed, and missing is "this field is damaged", which must not read as that.
    notes.push('The list of features you had showing could not be read, so the usual set is showing instead. Nothing has been turned off for you.')
    return {
      value: Object.freeze({ ...blank(), version, fromNewer, chosen: given.chosen === true, chosenAt: readWhen(given.chosenAt) }),
      notes
    }
  }

  const dropped: string[] = []
  for (const entry of given.shown) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > 64) {
      dropped.push(String(entry).slice(0, 40))
      continue
    }
    if (optional.has(entry)) {
      if (!shown.includes(entry as SurfaceId)) shown.push(entry as SurfaceId)
      continue
    }
    if (isEssential(entry)) {
      // Harmless and worth no note: an essential in the list changes nothing, because essentials are visible by
      // what they are. An older file, or one edited by hand, may well list them.
      continue
    }
    if (!unknown.includes(entry)) unknown.push(entry)
  }

  // Anything in the saved file this version does not recognise is carried, not dropped.
  for (const entry of Array.isArray(given.unknown) ? given.unknown : []) {
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= 64 && !unknown.includes(entry) && !optional.has(entry) && !isEssential(entry)) {
      unknown.push(entry)
    }
  }

  if (dropped.length > 0) notes.push(`${dropped.length === 1 ? 'One entry' : `${dropped.length} entries`} in your list of features made no sense and have been left out.`)
  if (unknown.length > 0) {
    notes.push(
      `Your choices mention ${unknown.length === 1 ? 'a feature' : `${unknown.length} features`} this version of Orbis does not have (${unknown.join(', ')}). They are being kept exactly as they are, in case they come back.`
    )
  }

  return {
    value: Object.freeze({
      version,
      shown: Object.freeze(shown),
      unknown: Object.freeze(unknown),
      chosen: given.chosen === true,
      chosenAt: readWhen(given.chosenAt),
      fromNewer
    }),
    notes
  }
}

const readWhen = (raw: unknown): number => (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0)

// ---------------------------------------------------------------- the one question

/**
 * What is true about one surface for one person, right now.
 *
 * `operational` is deliberately absent. This file knows nothing about whether the helper is answering or Stockfish
 * is on disk, and inventing an answer for it is how a feature gets reported as working when its engine is missing.
 * Compose it: `state.visible && isAvailable(capability, readiness)` from `commandCenter.ts`.
 */
export interface FeatureState {
  id: string
  /** Orbis has this at all. False for an id from a newer version, or a feature that has been removed. */
  available: boolean
  /** It is in this person's menu. */
  visible: boolean
  /** It has no switch, so nothing can take it away. */
  essential: boolean
  /** The person has it switched on. True for an essential. Meaningless when `available` is false. */
  chosen: boolean
  /**
   * Why it is not showing, in words somebody can be shown. Null when it is showing.
   *
   * The thing Orion says instead of silently failing. It never claims a feature is on when it is off, and it never
   * claims a feature exists when it does not.
   */
  hiddenBecause: string | null
  /** Surfaces this one needs that are themselves hidden. Empty when nothing is in the way. */
  blockedBy: readonly string[]
}

/**
 * Is this feature visible to this person right now?
 *
 * **The one function. Every caller asks this, and nothing keeps its own list.** The launcher, the palette, the slash
 * commands and Orion all go through here, because the last time two halves of Orbis each kept a list of the features
 * they drifted nine features apart and neither side could tell.
 *
 * `choice` may be null -- while Orbis is still starting, or in a context that has not loaded it. Null answers the
 * only safe thing: the essentials, and nothing else. It does not answer "everything", because reporting a hidden
 * feature as visible is the failure that matters.
 */
export function isVisible(id: string, choice: VisibilityChoice | null): boolean {
  return featureState(id, choice).visible
}

/** The whole answer for one surface. `isVisible` is this with everything but the one field thrown away. */
export function featureState(id: string, choice: VisibilityChoice | null): FeatureState {
  const known = BY_ID.get(id)
  if (!known) {
    return {
      id,
      available: false,
      visible: false,
      essential: false,
      chosen: false,
      hiddenBecause: `Orbis does not have anything called "${id}".`,
      blockedBy: Object.freeze([])
    }
  }

  if (known.standing === 'essential') {
    return { id, available: true, visible: true, essential: true, chosen: true, hiddenBecause: null, blockedBy: Object.freeze([]) }
  }

  const chosen = choice !== null && choice.shown.includes(known.id)
  if (!chosen) {
    return {
      id,
      available: true,
      visible: false,
      essential: false,
      chosen: false,
      hiddenBecause: `${known.label} is switched off, so it is not in your menu. Everything it had is still there, and it comes straight back when you turn it on in Settings.`,
      blockedBy: Object.freeze([])
    }
  }

  // Its dependencies are asked about through this same function, so a need that is itself blocked blocks this one.
  const blocked = known.needs.filter((need) => !isVisible(need, choice))
  if (blocked.length > 0) {
    const names = blocked.map((need) => BY_ID.get(need)?.label ?? need)
    return {
      id,
      available: true,
      visible: false,
      essential: false,
      chosen: true,
      hiddenBecause: `${known.label} is switched on, but it needs ${names.join(' and ')}, which ${blocked.length === 1 ? 'is' : 'are'} switched off. Turn ${blocked.length === 1 ? 'that' : 'those'} on and it will be in your menu.`,
      blockedBy: Object.freeze(blocked as string[])
    }
  }

  if (known.needsAnyOf.length > 0 && !known.needsAnyOf.some((one) => isVisible(one, choice))) {
    const names = known.needsAnyOf.map((one) => BY_ID.get(one)?.label ?? one)
    return {
      id,
      available: true,
      visible: false,
      essential: false,
      chosen: true,
      hiddenBecause: `${known.label} is switched on, but it is only a way in to ${names.join(' and ')}, and ${names.length === 1 ? 'that is' : 'both of those are'} switched off, so there would be nothing on it.`,
      blockedBy: Object.freeze(known.needsAnyOf as string[])
    }
  }

  return { id, available: true, visible: true, essential: false, chosen: true, hiddenBecause: null, blockedBy: Object.freeze([]) }
}

/** Every surface showing in this person's menu, in the table's order. Essentials always among them. */
export const visibleSurfaces = (choice: VisibilityChoice | null): readonly SurfaceId[] =>
  Object.freeze(FEATURE_FACTS.filter((one) => isVisible(one.id, choice)).map((one) => one.id))

/** The nineteen feature screens that are showing: `visibleSurfaces` without the core ones. */
export const visibleFeatures = (choice: VisibilityChoice | null): readonly AppFeature[] =>
  Object.freeze(visibleSurfaces(choice).filter((id): id is AppFeature => capabilityFor(id) !== undefined))

/** Every surface available and not showing, so something can offer to turn one on. */
export const hiddenSurfaces = (choice: VisibilityChoice | null): readonly SurfaceId[] =>
  Object.freeze(FEATURE_FACTS.filter((one) => !isVisible(one.id, choice)).map((one) => one.id))

/**
 * One sentence about a surface, for Orion to say when it is asked to open something.
 *
 * The whole of rule four in one function: never claim a thing is on when it is off, say what is true, and offer the
 * way out. Nothing here ever says a hidden feature opened.
 */
export function describeVisibility(id: string, choice: VisibilityChoice | null): string {
  const state = featureState(id, choice)
  if (!state.available) return state.hiddenBecause ?? `Orbis does not have anything called "${id}".`
  if (state.visible) return `${BY_ID.get(id)?.label ?? id} is switched on.`
  return state.hiddenBecause ?? `${BY_ID.get(id)?.label ?? id} is switched off.`
}

/** Bits of interface that go with a hidden feature, so nothing is left behind pointing at a screen that is away. */
export const alsoHiddenWith = (id: string): readonly string[] => BY_ID.get(id)?.alsoHides ?? Object.freeze([])

// ---------------------------------------------------------------- changing it

/**
 * Turning one feature on or off.
 *
 * Refuses rather than ignores, because a caller that is told nothing cannot tell somebody whether their switch
 * landed -- and a switch that reports success and changed nothing is the failure worth more than all the others.
 * Three refusals: an essential has no switch, a feature Orbis does not have cannot be switched, and a choice written
 * by a newer Orbis is not written over.
 */
export function setVisible(choice: VisibilityChoice, id: string, on: boolean, now = 0): { value: VisibilityChoice; refused: string | null } {
  const known = BY_ID.get(id)
  if (!known) return { value: choice, refused: `Orbis does not have anything called "${id}", so there is nothing to switch.` }
  if (known.standing === 'essential') {
    return {
      value: choice,
      refused: `${known.label} is part of Orbis rather than a feature you choose, so it cannot be switched off. It is how you get to everything else, including this switch.`
    }
  }
  if (choice.fromNewer) {
    return {
      value: choice,
      refused: 'A newer version of Orbis saved which features you see, and this version will not write over it -- that would lose whatever the newer one knew. Open Orbis in the newer version to change this.'
    }
  }

  const already = choice.shown.includes(known.id)
  if (already === on) return { value: choice, refused: null }

  return {
    value: Object.freeze({
      ...choice,
      version: VISIBILITY_VERSION,
      shown: Object.freeze(on ? [...choice.shown, known.id] : choice.shown.filter((one) => one !== known.id)),
      chosen: true,
      chosenAt: now
    }),
    refused: null
  }
}

/**
 * Replacing the whole set at once: what the picker and the first-run step send.
 *
 * Anything unrecognised in `ids` is reported rather than silently dropped, and essentials in the list are simply not
 * stored -- they are visible by what they are, so storing them would be storing something that cannot be false.
 */
export function chooseVisible(choice: VisibilityChoice, ids: readonly unknown[], now = 0): { value: VisibilityChoice; refused: string | null; notes: string[] } {
  if (choice.fromNewer) {
    return {
      value: choice,
      refused: 'A newer version of Orbis saved which features you see, and this version will not write over it -- that would lose whatever the newer one knew. Open Orbis in the newer version to change this.',
      notes: []
    }
  }

  const optional = new Set<string>(OPTIONAL_IDS as readonly string[])
  const shown: SurfaceId[] = []
  const notes: string[] = []
  const unrecognised: string[] = []

  for (const raw of ids) {
    const id = typeof raw === 'string' ? raw : ''
    if (optional.has(id)) {
      if (!shown.includes(id as SurfaceId)) shown.push(id as SurfaceId)
      continue
    }
    if (isEssential(id)) continue
    unrecognised.push(String(raw).slice(0, 40))
  }

  if (unrecognised.length > 0) notes.push(`Orbis has nothing called ${unrecognised.join(', ')}, so ${unrecognised.length === 1 ? 'it was' : 'they were'} left out of your choice.`)

  return {
    // The table's order, not the order they arrived in, so a saved file reads the same way every time.
    value: Object.freeze({ ...choice, version: VISIBILITY_VERSION, shown: Object.freeze(OPTIONAL_IDS.filter((one) => shown.includes(one))), chosen: true, chosenAt: now }),
    refused: null,
    notes
  }
}
