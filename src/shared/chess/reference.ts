import { OPENING_SOURCE, datasetSize, recordFor } from './openings.ts'
import { START_FEN, applyMove } from './rules.ts'

/**
 * The reference data Chess World can use, and whether it is really here (Sections 187-190).
 *
 * ## The one rule
 *
 * **A dataset is here because something looked, not because a setting says where it would be.** A path in a
 * preference is a wish. A filename in a config file is a wish. "The folder exists" is not "the data is readable".
 * Every state below comes from a piece of evidence that says what was actually done to find out, and the one piece of
 * evidence that is only a path -- `path-only` -- can never produce "present". It produces "nobody has looked", with
 * the path shown and that sentence beside it.
 *
 * This is not a theoretical worry. A chess database that says "Tablebase: installed" because `tablebasePath` is set
 * will then quietly answer endgame questions out of the engine's guesswork while a person believes they are reading
 * perfect play. The fix is not a better check; it is refusing to call a wish a fact.
 *
 * ## Missing is not broken
 *
 * Most of this data is optional, and optional means a person has chosen not to have it -- not that something is
 * wrong. So every dataset carries `without`: what still works if it is not here. A screen showing "no tablebase"
 * next to "the engine still evaluates every position, it just cannot prove a seven-man ending" is telling the truth
 * twice. A screen showing a red cross is telling a person their chess is broken.
 *
 * `fault` is reserved for the two cases that really are faults: something required is missing, or something that is
 * here does not work.
 *
 * ## What Orbis cannot see from here, and says so
 *
 * This file is pure -- no files, no Electron, no clock -- so it does not look at a disk. It does two things:
 *
 *   - **The checks it can really do itself.** `probeOpenings` asks the opening dataset a question and reads the
 *     answer. That dataset is inside the application, so the check is complete and the result is a fact.
 *   - **Everything else is evidence handed in.** The engine's state comes from the main process, which does stat the
 *     executable and does complete a handshake with it. `engineEvidence` reads that status without inventing any
 *     part of it: a field that is not there becomes "not known", never a guess.
 *
 * Where nothing can look, the state is `uncheckable` and the reason says why. That is a worse answer than a check
 * and a much better answer than a cross or a tick.
 */

// ---------------------------------------------------------------------------------------------------------------
// What a dataset is

export type DatasetId = 'openings' | 'engine' | 'endgame-tablebase' | 'opening-book'

export interface DataSize {
  /** Bytes, when something measured them. */
  bytes?: number
  /** Rows, entries or positions, when that is what the size means. */
  entries?: number
  /** Said in words, which is the only form a screen shows. */
  words: string
}

export interface ReferenceDataset {
  id: DatasetId
  name: string
  /** What it is for, in one sentence. */
  purpose: string
  source: { name: string; url?: string }
  /**
   * The version, when Orbis itself fixes it.
   *
   * Null for anything installed or found on this computer: only a real check can say which version is there, so a
   * version printed from a constant would be a claim about a file nobody read.
   */
  version: string | null
  licence: { id: string; name: string } | null
  where: 'in-app' | 'this-computer' | 'nowhere-yet'
  /** Where it would live, in plain words. */
  whereWords: string
  /** False when not having it is a fault rather than a choice. */
  optional: boolean
  /**
   * Whether Orbis can really use this today.
   *
   * False means `not-supported`: nothing in the application reads it, so a copy of it on this computer would make no
   * difference. Said out loud, because "not installed" invites a person to go and install it.
   */
  usable: boolean
  /** Whether Orbis has a way to get it, and how. */
  install: { can: boolean; how: string }
  /** What still works without it. Never empty for an optional dataset. */
  without: string[]
  /** Anything else worth knowing that is a fact rather than a state. */
  notes: string[]
}

/**
 * The catalogue.
 *
 * Four entries, and two of them are "Orbis cannot use this yet". Listing those is the point: a person looking for
 * tablebase support needs to be told it is not there, by name, rather than finding a panel of two datasets and
 * wondering whether they missed a setting.
 *
 * The engine's facts -- where it comes from, its licence, that it is fetched rather than shipped and verified before
 * it is run -- are the ones `src/main/chess/install.ts` works to, written here because this module may not import
 * from the main process. Its *version* is deliberately not written here; it comes from the install record at
 * runtime.
 */
export const REFERENCE_DATASETS: readonly ReferenceDataset[] = Object.freeze([
  Object.freeze({
    id: 'openings' as const,
    name: 'Opening names and ECO codes',
    purpose: 'Naming an opening, and listing the named continuations from a position.',
    source: { name: OPENING_SOURCE.dataset, url: OPENING_SOURCE.url },
    version: `${OPENING_SOURCE.version.slice(0, 12)} (${OPENING_SOURCE.versionDate})`,
    licence: { id: OPENING_SOURCE.licence, name: OPENING_SOURCE.licenceName },
    where: 'in-app' as const,
    whereWords: 'Inside Orbis. There is nothing to install and nothing to keep up to date.',
    optional: false,
    usable: true,
    install: { can: false, how: 'It ships with Orbis.' },
    without: [],
    notes: [
      'It is a list of named positions. Nothing in it counts games, players or popularity, so the opening explorer '
        + 'has no statistics and does not pretend to.'
    ]
  }),
  Object.freeze({
    id: 'engine' as const,
    name: 'Stockfish, the chess engine',
    purpose: 'Evaluating a position, finding the best moves, and playing against you.',
    source: { name: 'official-stockfish/Stockfish', url: 'https://github.com/official-stockfish/Stockfish' },
    version: null,
    licence: { id: 'GPL-3.0-or-later', name: 'GNU General Public License v3.0 or later' },
    where: 'this-computer' as const,
    whereWords: 'In your Orbis app-data folder, once it has been set up.',
    optional: true,
    usable: true,
    install: { can: true, how: 'Orbis fetches it from Stockfish’s own release when you ask it to, and checks the download before running it.' },
    without: [
      'Setting up boards, playing both sides and looking through your games all work.',
      'Bringing in and saving PGN files works.',
      'Opening names, the lessons and the endgame drills work: none of them asks the engine.',
      'What you cannot have is an evaluation, a best move, an analysed game, or an opponent.'
    ],
    notes: [
      'It is not part of the Orbis download. Stockfish is GPL-3.0 and Orbis ships no GPL code, so the engine is '
        + 'fetched from upstream onto this computer instead, with its licence text beside it.',
      'Current Stockfish releases carry their evaluation network inside the executable, so there is no separate '
        + 'network file to find.'
    ]
  }),
  Object.freeze({
    id: 'endgame-tablebase' as const,
    name: 'Endgame tablebase',
    purpose: 'Perfect play in endings with few pieces: won, drawn or lost, and in how many moves, with no search.',
    source: { name: 'Syzygy tablebases', url: 'https://github.com/syzygy1/tb' },
    version: null,
    licence: null,
    where: 'nowhere-yet' as const,
    whereWords: 'Nowhere. Orbis has no place for one and reads none.',
    optional: true,
    usable: false,
    install: {
      can: false,
      how: 'There is no way to add one yet. Nothing in Orbis reads a tablebase, so a copy on this computer would '
        + 'make no difference, and the engine is not told where to look for one.'
    },
    without: [
      'The engine still evaluates every position and still finds good moves in an ending.',
      'The endgame drills still work: the ones that claim a mate in a given number are proved by exhaustive search, '
        + 'not by a tablebase.',
      'What is missing is proof. "This king and pawn ending is won" is an assessment, and the drill says so rather '
        + 'than presenting it as certain.'
    ],
    notes: ['Seven men or fewer is where a tablebase is exact, which is why the position search offers that as a pattern.']
  }),
  Object.freeze({
    id: 'opening-book' as const,
    name: 'Opening book',
    purpose: 'Moves to play in the opening from a file of prepared lines, instead of the engine thinking about them.',
    source: { name: 'A Polyglot book (.bin), of which there is no single source' },
    version: null,
    licence: null,
    where: 'nowhere-yet' as const,
    whereWords: 'Nowhere. Orbis reads no book file.',
    optional: true,
    usable: false,
    install: { can: false, how: 'There is no way to add one yet. Nothing in Orbis reads a book file.' },
    without: [
      'The engine plays its own opening moves, which is what it does by default anyway.',
      'The opening dataset still names what is being played, and the explorer still lists the named continuations.',
      'What a book would add is move choice and variety at the start of a game, nothing else.'
    ],
    notes: ['A book is about what to play. It is not a database of games and would not help the position search.']
  })
])

export const datasetById = (id: DatasetId): ReferenceDataset | undefined => REFERENCE_DATASETS.find((one) => one.id === id)

// ---------------------------------------------------------------------------------------------------------------
// Evidence: what was actually done to find out

export type Evidence =
  /** Something looked and found it, and it works. */
  | { kind: 'found'; detail: string; location?: string; version?: string; size?: DataSize }
  /** Something looked and it is not there. */
  | { kind: 'missing'; detail: string }
  /** It is being fetched right now. */
  | { kind: 'installing'; detail: string }
  /** It is there and it does not work. */
  | { kind: 'faulty'; detail: string; location?: string }
  /** Nobody has looked yet. */
  | { kind: 'not-looked'; why: string }
  /** There is no way to look from here. */
  | { kind: 'no-way-to-look'; why: string }
  /**
   * A setting names a path and nothing has looked at it.
   *
   * This exists so that the wrong answer is impossible to give by accident. It can only ever produce "nobody has
   * looked", and the path is shown as what it is -- a setting -- rather than as a location.
   */
  | { kind: 'path-only'; path: string; why?: string }

export type DatasetState =
  | 'present'
  | 'absent'
  | 'installing'
  | 'broken'
  | 'unchecked'
  | 'uncheckable'
  | 'not-supported'

export const STATE_LABEL: Record<DatasetState, string> = {
  present: 'Here',
  absent: 'Not here',
  installing: 'Being set up',
  broken: 'Here, but not working',
  unchecked: 'Not checked',
  uncheckable: 'Cannot be checked',
  'not-supported': 'Orbis cannot use this yet'
}

export interface DatasetStatus {
  dataset: ReferenceDataset
  state: DatasetState
  /** One sentence, said plainly. */
  says: string
  /** Where a real check found it. Never a path nobody looked at. */
  location: string | null
  /** The version a real check reported, or the one Orbis fixes for data it ships. */
  version: string | null
  size: DataSize | null
  /** True when something is wrong, as opposed to something optional simply not being here. */
  fault: boolean
  /** What still works. */
  without: string[]
  /** What was done to find out, so a state can be traced back. */
  checkedBy: string
}

/**
 * What a piece of evidence makes of a dataset.
 *
 * Read the `path-only` and `usable` branches first: they are the two places this function deliberately refuses to
 * say what it is being told.
 */
export function statusOf(dataset: ReferenceDataset, evidence: Evidence): DatasetStatus {
  const base = {
    dataset,
    location: null as string | null,
    version: dataset.where === 'in-app' ? dataset.version : null,
    size: null as DataSize | null,
    without: dataset.without
  }

  // Orbis cannot read it, so where it is makes no difference. This outranks every piece of evidence on purpose:
  // "installed" would send a person looking for a setting that does not exist.
  if (!dataset.usable) {
    return {
      ...base,
      state: 'not-supported',
      says: `${dataset.install.how} ${dataset.without.length ? 'What works without it is listed below.' : ''}`.trim(),
      fault: false,
      checkedBy: 'Nothing was looked for: Orbis has no way to use this, which is a fact about Orbis rather than about this computer.'
    }
  }

  if (evidence.kind === 'path-only') {
    return {
      ...base,
      state: 'unchecked',
      says: `A setting points at ${evidence.path}, and nothing has looked there. A path is not a dataset, so this is `
        + 'shown as unchecked rather than as installed.',
      fault: false,
      checkedBy: evidence.why ?? 'A setting was read. Nothing on this computer was opened or measured.'
    }
  }

  if (evidence.kind === 'found') {
    return {
      ...base,
      state: 'present',
      says: evidence.detail,
      location: evidence.location ?? null,
      version: evidence.version ?? base.version,
      size: evidence.size ?? null,
      fault: false,
      checkedBy: 'A real check found it.'
    }
  }

  if (evidence.kind === 'installing') {
    return { ...base, state: 'installing', says: evidence.detail, fault: false, checkedBy: 'It is being fetched now.' }
  }

  if (evidence.kind === 'faulty') {
    return {
      ...base,
      state: 'broken',
      says: evidence.detail,
      location: evidence.location ?? null,
      fault: true,
      checkedBy: 'A real check found it and it did not work.'
    }
  }

  if (evidence.kind === 'missing') {
    return {
      ...base,
      state: 'absent',
      says: dataset.optional
        ? `${evidence.detail} This is optional, so nothing is wrong.`
        : `${evidence.detail} This is not optional, so something is wrong.`,
      // Missing optional data is a choice. Missing required data is a fault. That is the whole distinction.
      fault: !dataset.optional,
      checkedBy: 'A real check looked and it is not there.'
    }
  }

  if (evidence.kind === 'no-way-to-look') {
    return {
      ...base,
      state: 'uncheckable',
      says: `Whether this is here cannot be told from inside Orbis. ${evidence.why}`,
      fault: false,
      checkedBy: evidence.why
    }
  }

  return {
    ...base,
    state: 'unchecked',
    says: `Nobody has looked yet. ${evidence.why}`,
    fault: false,
    checkedBy: evidence.why
  }
}

/**
 * The whole catalogue, with whatever evidence there is for each.
 *
 * A dataset nothing was handed in for comes back as `unchecked`, never as absent. Not having been asked about is not
 * the same as not being there, and a panel that showed the two the same way would be wrong about the one that
 * matters.
 */
export function statusesOf(evidence: Partial<Record<DatasetId, Evidence>>): DatasetStatus[] {
  return REFERENCE_DATASETS.map((dataset) =>
    statusOf(dataset, evidence[dataset.id] ?? { kind: 'not-looked', why: 'Nothing has asked about it in this window yet.' })
  )
}

// ---------------------------------------------------------------------------------------------------------------
// The one check this file can really do by itself

/**
 * Asking the opening dataset whether it is there.
 *
 * Not "is the file present" -- the dataset is inside the application, so there is no file to find. The check is
 * whether it *answers*, and there are three ways it could fail to:
 *
 *   - it reads as empty, so no opening can be named;
 *   - it reads but cannot name 1.e4, which every opening dataset names, so it has been read into the wrong shape;
 *   - it reads fewer rows than it says it holds, so rows were lost on the way in.
 *
 * The landmark is the position after 1.e4, reached by playing that move through rules.ts rather than written out as
 * a FEN, so the check exercises the same route the Opening Lab uses. It asks only that the position is *in* the
 * dataset -- what the dataset calls it is reported, never expected, because this is a check that the data is here
 * and not an opinion about what should be in it.
 *
 * The count is counted rather than quoted from the header, and a count that disagrees with the header is reported as
 * a fault rather than smoothed over.
 */
export function probeOpenings(): Evidence {
  let entries = 0
  try {
    entries = datasetSize()
  } catch (error) {
    return { kind: 'faulty', detail: `The opening dataset could not be read: ${error instanceof Error ? error.message : 'it threw while being parsed'}.` }
  }
  if (entries === 0) {
    return { kind: 'missing', detail: 'The opening dataset read as empty, so no opening can be named.' }
  }
  const landmark = applyMove(START_FEN, 'e4')
  const known = landmark ? recordFor(landmark.after) : null
  if (!known) {
    return {
      kind: 'faulty',
      detail: `The opening dataset parsed ${entries.toLocaleString()} positions and cannot name the position after `
        + '1.e4. It has been read into the wrong shape rather than being missing.'
    }
  }
  if (entries !== OPENING_SOURCE.entries) {
    return {
      kind: 'faulty',
      detail: `The opening dataset says it holds ${OPENING_SOURCE.entries.toLocaleString()} positions and `
        + `${entries.toLocaleString()} were read. Rows were lost on the way in.`,
      location: 'Inside Orbis'
    }
  }
  return {
    kind: 'found',
    detail: `${entries.toLocaleString()} named positions, read and answering: it calls the position after 1.e4 `
      + `"${known.name}" (${known.eco}).`,
    location: 'Inside Orbis',
    size: { entries, words: `${entries.toLocaleString()} named positions` }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reading the engine's own status, without inventing any of it

/**
 * Engine states, as `src/main/chess/engine.ts` names them.
 *
 * Written out here rather than imported, because this module may not reach into the main process. A state that is
 * not in this list is treated as "it said something this does not understand", which is reported as not known
 * instead of being bent into the nearest state.
 */
const ENGINE_STATES = new Set([
  'not-installed', 'installing', 'stopped', 'starting', 'handshaking', 'ready', 'searching', 'stopping', 'failed'
])

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)

/**
 * What the engine's status means for the catalogue.
 *
 * The status is read as `unknown` on purpose. The renderer's declared type for it is narrower than what the main
 * process really sends, and this has to be right either way: every field is read defensively, and one that is not
 * there simply is not reported. Nothing is filled in.
 *
 * The important mapping is that **installed is not the same as running**. `stopped` with an executable found means
 * the data is here and nothing is using it, which is `present`. `failed` means it is here and does not work, which
 * is `broken`. Only `not-installed` is `absent`.
 */
export function engineEvidence(status: unknown): Evidence {
  if (status === null || typeof status !== 'object') {
    return { kind: 'not-looked', why: 'The engine has not been asked about yet.' }
  }
  const record = status as Record<string, unknown>
  const state = text(record.state)
  const detail = text(record.detail)
  const location = text(record.binaryPath)
  const version = text(record.installedVersion)
  if (state === undefined || !ENGINE_STATES.has(state)) {
    return {
      kind: 'not-looked',
      why: state === undefined
        ? 'The engine answered without saying what state it is in.'
        : `The engine said it is "${state}", which this version of the panel does not recognise, so nothing is claimed about it.`
    }
  }
  if (state === 'installing') {
    return { kind: 'installing', detail: detail ?? 'The engine is being fetched now.' }
  }
  if (state === 'not-installed') {
    return { kind: 'missing', detail: detail ?? 'The chess engine has not been set up on this computer.' }
  }
  if (state === 'failed') {
    return {
      kind: 'faulty',
      detail: detail ?? 'The engine is on this computer and did not start.',
      ...(location ? { location } : {})
    }
  }
  const name = text(record.name)
  const running = state === 'ready' || state === 'searching' || state === 'stopping'
  return {
    kind: 'found',
    detail: running
      ? `${name ?? 'The engine'} is set up and has answered. ${detail ?? ''}`.trim()
      : `The engine is set up on this computer and is not running at the moment.`,
    ...(location ? { location } : {}),
    ...(version ? { version } : {})
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Saying it all in one line

export interface ReferenceSummary {
  present: number
  absent: number
  /** Datasets Orbis cannot use at all. Not counted as absent: nothing is missing, the feature is. */
  unsupported: number
  /** Datasets nobody could look at, or has not looked at. */
  unknown: number
  faults: number
  words: string
}

/** The panel's heading: a count of each state, and never a single number dressed up as health. */
export function summarise(statuses: readonly DatasetStatus[]): ReferenceSummary {
  let present = 0
  let absent = 0
  let unsupported = 0
  let unknown = 0
  let faults = 0
  for (const one of statuses) {
    if (one.state === 'present') present += 1
    else if (one.state === 'absent') absent += 1
    else if (one.state === 'not-supported') unsupported += 1
    else if (one.state === 'unchecked' || one.state === 'uncheckable') unknown += 1
    if (one.fault) faults += 1
  }
  const bits: string[] = [`${present} of ${statuses.length} here`]
  if (absent) bits.push(`${absent} not set up`)
  if (unsupported) bits.push(`${unsupported} Orbis cannot use yet`)
  if (unknown) bits.push(`${unknown} not checked`)
  const words = faults
    ? `${bits.join(', ')}. ${faults} ${faults === 1 ? 'is' : 'are'} a fault rather than a choice.`
    : `${bits.join(', ')}. Nothing here is broken.`
  return { present, absent, unsupported, unknown, faults, words }
}

/** What a dataset's absence costs, in the words a person needs. Empty when it is here. */
export function withoutWords(status: DatasetStatus): string[] {
  if (status.state === 'present' || status.state === 'installing') return []
  return status.without
}
