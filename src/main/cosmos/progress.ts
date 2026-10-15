/**
 * What the simulation says it has done, read off its own log.
 *
 * ORBIS COSMOS runs Gaia Sky as a program of its own. Gaia Sky prints a line each time it finishes a piece of its
 * start-up: a data pack downloaded and checked, its shaders compiled, the Solar System built, a star catalogue read.
 * Those lines are the only honest measure of progress it offers, so the loading screen is driven by them and by
 * nothing else -- no timers, no easing towards a made-up end. If the program stalls, the bar stalls, and the screen
 * says which step it is waiting for.
 *
 * Pure: no Electron, no files, so the rules can be tested against real log text.
 */

export type StageId = 'engine' | 'data' | 'shaders' | 'solar' | 'stars' | 'galaxy' | 'scene' | 'renderer' | 'ready'

export interface StageDef {
  id: StageId
  /** What is being waited for, in the words the screen shows while it is the current step. */
  label: string
  /** What it says once it is done. */
  done: string
}

/** In the order the program does them. */
export const STAGES: readonly StageDef[] = [
  { id: 'engine', label: 'Starting the graphics engine', done: 'Graphics engine started' },
  { id: 'data', label: 'Checking the star and planet data', done: 'Data ready' },
  { id: 'shaders', label: 'Compiling the rendering shaders', done: 'Shaders compiled' },
  { id: 'solar', label: 'Building the Solar System', done: 'Solar System built' },
  { id: 'stars', label: 'Reading the Gaia star catalogue', done: 'Star catalogue loaded' },
  { id: 'galaxy', label: 'Placing the Milky Way, nebulae and galaxies', done: 'Galaxies and nebulae placed' },
  { id: 'scene', label: 'Assembling the universe', done: 'Universe assembled' },
  { id: 'renderer', label: 'Preparing the renderer and controls', done: 'Renderer and controls ready' },
  { id: 'ready', label: 'Settling the camera', done: 'Simulation running' }
]

export interface StageHit {
  stage: StageId
  /** A fact the log line carries (a count, a name), or null. Shown as is; never invented. */
  detail: string | null
}

const mb = (bytes: string): string => `${Math.round(Number(bytes) / 1048576)} MB`

/** One rule per log line shape. The first that matches wins, and a line matching none is ignored. */
const RULES: readonly { test: RegExp; stage: StageId; detail(m: RegExpExecArray): string | null }[] = [
  { test: /GaiaSky - Device: (.+)$/, stage: 'engine', detail: (m) => m[1].trim() },
  { test: /GaiaSky - Display mode: (.+?) - Fullscreen/, stage: 'engine', detail: (m) => `Display ${m[1]}` },
  { test: /DownloadHelper - Reading (\d+) bytes/, stage: 'data', detail: (m) => `Downloading ${mb(m[1])}` },
  { test: /BatchDownloadWindow - SHA256 ok: (.+)$/, stage: 'data', detail: (m) => `Verified: ${m[1].trim()}` },
  // The welcome screen's own shader is compiled before the data check, so it says nothing about this step.
  { test: /ShaderCache - Compiling shaders: (?!spritebatch$)(\S+)/, stage: 'shaders', detail: (m) => m[1] },
  { test: /(?:JsonLoader|GeoJsonLoader) - ([\d,]+) objects loaded from file \$data\/default-data\/(\S+?)\.(?:geo\.)?json/, stage: 'solar', detail: (m) => `${m[1]} objects from ${m[2]}` },
  { test: /OctreeLoader - Catalog loaded with ([\d,]+) objects/, stage: 'stars', detail: (m) => `${m[1]} stars` },
  { test: /PointDataProvider - ([\d,]+) objects loaded from file \S*\/(galaxy_\w+)/, stage: 'galaxy', detail: (m) => `${m[1]} points of ${m[2].replace('galaxy_', '')}` },
  { test: /JsonLoader - ([\d,]+) objects loaded from file \$data\/catalog-(\S+?)\//, stage: 'galaxy', detail: (m) => `${m[1]} objects of ${m[2]}` },
  { test: /Scene - Scene graph initialised with ([\d,]+) objects/, stage: 'scene', detail: (m) => `${m[1]} objects` },
  { test: /SceneLoader - Initialising renderer and GUI/, stage: 'renderer', detail: () => null },
  { test: /Camera focus changed to (\w+)/, stage: 'ready', detail: (m) => `Focused on ${m[1]}` }
]

/** The stage a log line finishes, if any. */
export function parseLine(line: string): StageHit | null {
  for (const r of RULES) {
    const m = r.test.exec(line)
    if (m) return { stage: r.stage, detail: r.detail(m) }
  }
  return null
}

/**
 * Whether a log line says the program is waiting for a person.
 *
 * On the very first start there is no data on this computer. Gaia Sky then shows its own screen for choosing the data
 * packs to download and waits for the Download button; nothing proceeds until somebody presses it. That is not a
 * stall to be waited out behind a loading screen, so the window is shown instead.
 */
export function needsPerson(line: string): boolean {
  return /WelcomeGui - Data files not found/.test(line)
}

/**
 * A log line that reports a failure, as a person could read it, or null.
 *
 * Windows reports that the downloaded archive "is being used by another process" while Gaia Sky tidies up after
 * unpacking it; the data is checked (SHA256 ok) and used regardless, so that line is not a failure by itself. What
 * decides failure is the program ending before it is ready; this only supplies the words.
 */
export function parseProblem(line: string): string | null {
  const m = /\bERROR\] (.+)$/.exec(line) ?? /Exception in thread "[^"]*" (.+)$/.exec(line) ?? /(java\.lang\.\w+Error.*)$/.exec(line)
  return m ? m[1].trim().slice(0, 300) : null
}

export interface ProgressState {
  /** Stages that have been seen, in order of first sight. */
  seen: StageId[]
  /** The stage being waited on: the first one not yet left behind. */
  current: StageId | null
  /** 0..1: stages left behind over all stages. Never advanced by anything but a log line. */
  fraction: number
}

/**
 * A stage counts as finished when a line from a later stage has been seen, because the log reports each stage's
 * output as it goes. The last stage is finished when its own line has been seen.
 */
export function advance(state: ProgressState, hit: StageHit): ProgressState {
  const seen = state.seen.includes(hit.stage) ? state.seen : [...state.seen, hit.stage]
  const order = STAGES.map((s) => s.id)
  const highest = Math.max(...seen.map((s) => order.indexOf(s)))
  const doneCount = seen.includes('ready') ? STAGES.length : highest
  return { seen, current: doneCount >= STAGES.length ? null : order[doneCount], fraction: doneCount / STAGES.length }
}

export const INITIAL: ProgressState = { seen: [], current: 'engine', fraction: 0 }
