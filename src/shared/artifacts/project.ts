import { checkPath, shouldCompress, type ZipEntry } from '../portable/zip.ts'
import { CODE_LIMITS, languageById, languageForFile } from './languages.ts'

/**
 * A project: several named text files kept as one artifact.
 *
 * A code artifact is one file. Plenty of things a person asks for are not one file -- a small website is a page, a
 * stylesheet and a script; a Python exercise is a module and its test. This is that shape, and it is deliberately the
 * smallest shape that works: a list of paths with text under each, one of them named as the entry, and nothing else.
 * No folders as objects, no permissions, no timestamps, no build settings. A folder is the slash in a path, which is
 * the only form of it that cannot disagree with the files.
 *
 * ## Why one stored text form
 *
 * The engine keeps every artifact as one stored file and re-reads that file to prove what it wrote. A project with a
 * file per file on disk would need a second store, a second read-back and a second set of rules about paths, so the
 * whole project is written as one JSON document with a version number on it (`serialiseProject`), and read back by a
 * reader that refuses anything it does not recognise (`parseProject`). The sources stay text, so the secret gate still
 * reads them and the library's search still finds words in them.
 *
 * ## Why paths are refused rather than tidied
 *
 * A path is the only thing here that could reach outside the artifact, and it arrives from a model more often than from
 * a person. `checkPath` -- the same check the portable-package reader uses, so there is one answer to "is this path
 * safe" and not two -- refuses an absolute path, a drive letter, a backslash, a step that walks up, a Windows device
 * name, a trailing dot or space, and a control character. On top of that this file refuses what is wrong for a project
 * in particular: a hidden file (`.env` is the usual accident, and a `.git` folder is not content), a path deeper than a
 * project needs, and two paths that are the same file on a case-insensitive filesystem. None of it is repaired. A
 * repaired path is a file at an address nothing else in the answer refers to, which is worse than a refusal.
 *
 * Nothing here runs anything. What "run" means, and the one narrow case in which Orbis can, is in
 * `src/main/artifacts/running.ts`.
 */

export interface ProjectFile {
  /** Relative, forward slashes, already checked. */
  path: string
  /** The language id its extension means, or '' when the extension is not one Orbis knows. */
  language: string
  source: string
}

export interface Project {
  files: readonly ProjectFile[]
  /** The path of the file the project starts at. Always one of `files`. */
  entry: string
}

export interface ProjectProblem {
  error: 'empty' | 'bad-path' | 'duplicate' | 'too-many' | 'too-large' | 'not-found' | 'ambiguous' | 'parse'
  message: string
}

export const isProjectProblem = (value: unknown): value is ProjectProblem =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>) && 'message' in (value as Record<string, unknown>)

const problem = (error: ProjectProblem['error'], message: string): ProjectProblem => ({ error, message })

/**
 * How big a project may get.
 *
 * The total is the same ceiling one code file has, so "several files" cannot hold more text than "one file" was ever
 * allowed to -- the limit belongs to the person's patience and the reader's memory, not to the number of files it is
 * split across. The depth and path length are far below what a filesystem allows, because a project a person asked
 * Orbis for is a handful of files and anything deeper is a mistake worth saying out loud.
 */
export const PROJECT_LIMITS = Object.freeze({
  files: 40,
  fileCharacters: 100_000,
  totalCharacters: CODE_LIMITS.characters,
  pathLength: 120,
  depth: 6
})

/** The form the stored text carries, so a reader can tell this from any other JSON. */
export const PROJECT_FORM = 'orbis-project'
export const PROJECT_FORM_VERSION = 1

// ---------------------------------------------------------------- paths

export interface PathVerdict {
  ok: boolean
  /** The path as it will be used, when it is usable. */
  clean: string
  /** Why not, in words a person can act on. Empty when ok. */
  why: string
}

/**
 * Whether one path may be a file in a project.
 *
 * The general check first, then the project's own rules. The messages are whole sentences because they are shown: a
 * person who asked for a website and got "bad path" has been told nothing.
 */
export function checkProjectPath(raw: unknown): PathVerdict {
  const no = (why: string): PathVerdict => ({ ok: false, clean: '', why })
  if (typeof raw !== 'string') return no('A file in a project needs a name.')
  const path = raw.trim()
  if (path === '') return no('A file in a project needs a name.')
  if (path.length > PROJECT_LIMITS.pathLength) {
    return no(`"${path.slice(0, 40)}…" is ${path.length} characters long, and a path in a project may be ${PROJECT_LIMITS.pathLength}.`)
  }

  const general = checkPath(path)
  if (!general.ok) return no(`"${path}" cannot be a file in a project: ${general.why}.`)

  const parts = path.split('/')
  if (parts.length > PROJECT_LIMITS.depth) {
    return no(`"${path}" is ${parts.length} folders deep, and a project goes ${PROJECT_LIMITS.depth} deep.`)
  }
  for (const part of parts) {
    /*
     * No spaces.
     *
     * A filesystem takes them, and nothing else does well: a path with a space has to be quoted in a shell, encoded in
     * an address, and guessed at when a model writes it as a heading above a file. Refusing them keeps the name a
     * person reads, the name written to disk and the name a page links to the same string.
     */
    if (part.includes(' ')) return no(`"${path}" has a space in it. A file in a project is named without spaces, so that the name a page links to and the name on disk are the same.`)
    /*
     * No hidden files, at all.
     *
     * The ones that matter are `.env` and the inside of a `.git` folder: one holds credentials and the other holds a
     * repository's own bookkeeping, and neither is content somebody asked Orbis to write. Rather than list the
     * dangerous ones and be wrong about the next one, every name beginning with a dot is refused and the reason is
     * said. A project that genuinely wants a `.gitignore` is a project somebody should write by hand.
     */
    if (part.startsWith('.')) {
      return no(`"${path}" is a hidden file. Orbis does not keep hidden files in a project: .env holds credentials and a .git folder holds a repository's own records, and neither is something to write from a sentence.`)
    }
  }
  return { ok: true, clean: path, why: '' }
}

/** The language a path's extension means, or '' when Orbis has no name for it. */
export const languageOf = (path: string): string => languageForFile(path)?.id ?? ''

/** What a person calls the language of a file, or '' when Orbis has no name for it. */
export const languageName = (id: string): string => languageById(id)?.name ?? ''

// ---------------------------------------------------------------- the entry file

/**
 * Which file a project starts at, when nobody said.
 *
 * `index.html` first, because a web project is the kind Orbis can actually do something with; then the shallowest
 * `index.html` in a folder, then any page, then the conventional names a program starts at. Last resort is the first
 * path in order, which is at least stable rather than whichever file happened to be written first.
 */
export function chooseEntry(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  const sorted = [...paths].sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : a > b ? 1 : 0))
  const page = sorted.find((one) => one === 'index.html') ?? sorted.find((one) => one.endsWith('/index.html')) ?? sorted.find((one) => /\.html?$/i.test(one))
  if (page) return page
  const start = sorted.find((one) => /^(main|app|index|program|run)\.[a-z0-9]+$/i.test(one))
  return start ?? sorted[0]
}

// ---------------------------------------------------------------- making one

/**
 * A project from a list of files, with every rule applied.
 *
 * The only way a `Project` comes into being, so nothing downstream has to wonder whether the paths were checked. It
 * reports the first thing that is wrong rather than a list, because the caller is either a model being argued with
 * once or a person who will fix one thing and try again, and a list of twelve complaints helps neither.
 */
export function makeProject(files: readonly { path: unknown; source: unknown }[], entry = ''): Project | ProjectProblem {
  if (!Array.isArray(files) || files.length === 0) return problem('empty', 'A project needs at least one file.')
  if (files.length > PROJECT_LIMITS.files) {
    return problem('too-many', `That is ${files.length} files, and a project holds ${PROJECT_LIMITS.files}.`)
  }

  const out: ProjectFile[] = []
  const seen = new Map<string, string>()
  let total = 0
  for (const one of files) {
    const verdict = checkProjectPath(one?.path)
    if (!verdict.ok) return problem('bad-path', verdict.why)
    const path = verdict.clean
    const source = typeof one.source === 'string' ? one.source : null
    if (source === null) return problem('parse', `"${path}" has no text in it. A file in a project is text; a picture or a program is not.`)
    if (source.length > PROJECT_LIMITS.fileCharacters) {
      return problem('too-large', `"${path}" is ${source.length.toLocaleString('en')} characters, and one file in a project may be ${PROJECT_LIMITS.fileCharacters.toLocaleString('en')}.`)
    }
    /*
     * Two names that are one file.
     *
     * Windows and macOS do not tell `App.js` and `app.js` apart, so a project with both is a project that loses a file
     * the moment it is written to disk or put in a zip somebody opens. Caught here, where it can still be said.
     */
    const key = path.toLowerCase()
    const already = seen.get(key)
    if (already !== undefined) {
      return already === path
        ? problem('duplicate', `"${path}" is in the project twice.`)
        : problem('duplicate', `"${path}" and "${already}" are the same file on Windows and on a Mac, which tell no difference between upper and lower case.`)
    }
    seen.set(key, path)
    total += source.length
    if (total > PROJECT_LIMITS.totalCharacters) {
      return problem('too-large', `The project is past ${PROJECT_LIMITS.totalCharacters.toLocaleString('en')} characters all together, which is the most Orbis keeps.`)
    }
    out.push({ path, language: languageOf(path), source })
  }

  /*
   * A file where a folder has to be.
   *
   * `src` as a file and `src/app.js` as a file cannot both exist: writing one makes the other impossible. A zip will
   * take both and whoever opens it gets an error with no explanation, so it is refused here instead.
   */
  for (const one of out) {
    const prefix = `${one.path.toLowerCase()}/`
    const under = out.find((other) => other.path.toLowerCase().startsWith(prefix))
    if (under) return problem('bad-path', `"${one.path}" is both a file and the folder "${under.path}" is in. One of the two has to be renamed.`)
  }

  const paths = out.map((one) => one.path)
  const wanted = typeof entry === 'string' ? entry.trim() : ''
  if (wanted !== '' && !paths.includes(wanted)) {
    return problem('not-found', `The project is said to start at "${wanted}", and there is no such file in it.`)
  }
  const chosen = wanted === '' ? chooseEntry(paths) : wanted

  const sorted = [...out].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return Object.freeze({ files: Object.freeze(sorted), entry: chosen })
}

/** One file's text replaced, as a whole new project. Nothing is edited in place: a change is a new version. */
export function setProjectFile(project: Project, path: string, source: string): Project | ProjectProblem {
  const found = project.files.find((one) => one.path === path)
  if (!found) {
    return problem('not-found', `There is no file called "${path}" in this project. It has ${projectListing(project)}.`)
  }
  return makeProject(
    project.files.map((one) => (one.path === path ? { path, source } : { path: one.path, source: one.source })),
    project.entry
  )
}

/** A file added. Refused when the path is already taken, because that is a change to a file and not an addition. */
export function addProjectFile(project: Project, path: string, source: string): Project | ProjectProblem {
  return makeProject([...project.files.map((one) => ({ path: one.path, source: one.source })), { path, source }], project.entry)
}

/** A file taken out. The entry cannot be the file taken out, or the project would start nowhere. */
export function removeProjectFile(project: Project, path: string): Project | ProjectProblem {
  const found = project.files.find((one) => one.path === path)
  if (!found) return problem('not-found', `There is no file called "${path}" in this project. It has ${projectListing(project)}.`)
  const rest = project.files.filter((one) => one.path !== path)
  if (rest.length === 0) return problem('empty', `"${path}" is the only file in the project. Remove the project instead.`)
  return makeProject(rest.map((one) => ({ path: one.path, source: one.source })), project.entry === path ? '' : project.entry)
}

// ---------------------------------------------------------------- the stored text form

/** The project as the one text the artifact store keeps. */
export function serialiseProject(project: Project): string {
  return `${JSON.stringify(
    {
      form: PROJECT_FORM,
      formVersion: PROJECT_FORM_VERSION,
      entry: project.entry,
      files: project.files.map((one) => ({ path: one.path, language: one.language, source: one.source }))
    },
    null,
    2
  )}\n`
}

/**
 * The project back out of that text.
 *
 * Deny by default: the form and its version have to be there and have to be the ones this reader knows, and then every
 * path and every size goes through `makeProject` again rather than being trusted because it was stored once. A stored
 * file can have been written by an older Orbis, edited by hand, or restored from a backup of something else.
 */
export function parseProject(text: unknown): Project | ProjectProblem {
  if (typeof text !== 'string' || text.trim() === '') return problem('parse', 'There is nothing to read as a project.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return problem('parse', 'This is not a project Orbis wrote: it does not read as the form a project is kept in.')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return problem('parse', 'This is not a project Orbis wrote: a project is kept as a record with its files listed inside it.')
  }
  const held = raw as Record<string, unknown>
  if (held.form !== PROJECT_FORM) return problem('parse', 'This is not a project Orbis wrote: it does not say it is one.')
  if (held.formVersion !== PROJECT_FORM_VERSION) {
    return problem('parse', `This project was kept in form ${String(held.formVersion)}, and this copy of Orbis reads form ${PROJECT_FORM_VERSION}.`)
  }
  if (!Array.isArray(held.files)) return problem('parse', 'This project has no list of files in it.')
  const files = held.files.map((one) => {
    const file = (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>
    return { path: file.path, source: file.source }
  })
  // The stored language is read and thrown away: it is worked out from the extension again, so a stored project cannot
  // claim a file is in a language its name does not say.
  return makeProject(files, typeof held.entry === 'string' ? held.entry : '')
}

// ---------------------------------------------------------------- reading a model's answer

/** A line that names a file, in the forms an answer puts one in. */
const HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:File|Filename|Path)?\s*[:\-]?\s*`?([A-Za-z0-9._][A-Za-z0-9._/\- ]{0,118})`?\s*(?:\*\*|__)?\s*:?\s*$/

/** What a fence's own info string says, when it says a path rather than only a language. */
const INFO = /^[A-Za-z0-9+#.-]*(?:[ \t]+(?:title=|file=|name=)?"?([A-Za-z0-9._][A-Za-z0-9._/\-]{0,118})"?)?[ \t]*$/

const looksLikePath = (value: string): boolean => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.includes(' ')) return false
  if (trimmed.toLowerCase() === 'dockerfile') return true
  return /\/[^/]*\.[A-Za-z0-9]{1,8}$/.test(trimmed) || /^[^/]+\.[A-Za-z0-9]{1,8}$/.test(trimmed)
}

/**
 * A project out of an answer that holds several fenced files.
 *
 * Strict on purpose. The shape it reads is the one every model writes when asked for a set of files: the path on its
 * own line -- as a heading, in bold, in backticks, or plain -- and the file's text in a fence under it. Anything else
 * is refused in words rather than half-read, because the failure of a loose reader here is not an error message: it is
 * a project missing a file, or with a file called "html", that looks finished and is not. One ambiguity is enough to
 * refuse the whole answer.
 *
 * It never reads the prose around the fences as a file, and it never invents a path: a fence that nothing named is the
 * refusal, not a file called `file1.txt`.
 */
export function readProjectReply(answer: unknown): Project | ProjectProblem {
  if (typeof answer !== 'string' || answer.trim() === '') return problem('parse', 'The answer was empty, so there is nothing to keep.')
  const text = answer.replace(/\r\n/g, '\n')
  const lines = text.split('\n')

  const found: { path: string; source: string }[] = []
  let unnamed = 0
  let at = 0
  while (at < lines.length) {
    const open = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(lines[at])
    if (!open) {
      at += 1
      continue
    }
    const indent = open[1]
    const marker = open[2]
    const info = open[3].trim()
    // The closing fence is the first line that is the same character, at least as long, and nothing else. Longer is
    // allowed because a file that itself holds a fence is written inside a longer one.
    const closes = (line: string): boolean => {
      const run = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line)
      return run !== null && run[1][0] === marker[0] && run[1].length >= marker.length
    }
    let end = at + 1
    while (end < lines.length && !closes(lines[end])) end += 1
    const bodyLines = lines.slice(at + 1, Math.min(end, lines.length))
    const source = bodyLines.map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n')

    // Named by the line above -- skipping blank lines and the prose a model writes between files.
    let named = ''
    let back = at - 1
    while (back >= 0 && lines[back].trim() === '') back -= 1
    if (back >= 0) {
      const heading = HEADING.exec(lines[back])
      if (heading && looksLikePath(heading[1])) named = heading[1].trim()
    }
    // Or by the fence's own info string, when it carries a path beside the language.
    if (named === '') {
      const inside = INFO.exec(info)
      if (inside && inside[1] && looksLikePath(inside[1])) named = inside[1].trim()
    }
    if (named === '') unnamed += 1
    else found.push({ path: named, source })

    at = end + 1
  }

  if (found.length === 0) {
    return problem(
      'ambiguous',
      unnamed > 0
        ? `The answer has ${unnamed} block${unnamed === 1 ? '' : 's'} of code in it and does not say what any of them should be called. A project needs a path above each one, such as "index.html".`
        : 'The answer has no files in it: a project is written as a path on its own line with the file in a fence under it.'
    )
  }
  if (unnamed > 0) {
    return problem(
      'ambiguous',
      `${found.length} of the ${found.length + unnamed} blocks of code in the answer are named and ${unnamed} ${unnamed === 1 ? 'is' : 'are'} not. Nothing was kept: a project with a file whose name had to be guessed is a project nobody can trust.`
    )
  }
  const names = found.map((one) => one.path)
  const twice = names.find((one, index) => names.indexOf(one) !== index)
  if (twice !== undefined) {
    return problem('duplicate', `The answer gives "${twice}" twice, with different text each time. Nothing was kept: Orbis will not choose which one you meant.`)
  }
  return makeProject(found.map((one) => ({ path: one.path, source: one.source })))
}

// ---------------------------------------------------------------- saying what it is

/** How many files and which, for a card. "5 files: index.html, style.css, app.js and 2 more". */
export function projectListing(project: Project, show = 3): string {
  const count = project.files.length
  const names = project.files.map((one) => one.path)
  const shown = names.slice(0, Math.max(1, show))
  const rest = count - shown.length
  return `${count} file${count === 1 ? '' : 's'}: ${shown.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`
}

/** The languages a project is in, most files first, for a card and for the notes. */
export function projectLanguages(project: Project): { name: string; files: number }[] {
  const counts = new Map<string, number>()
  for (const one of project.files) {
    const name = languageName(one.language) || 'Something else'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => b.files - a.files || (a.name < b.name ? -1 : 1))
}

/** How big it is, in the two numbers that matter. */
export const projectSize = (project: Project): { files: number; characters: number } => ({
  files: project.files.length,
  characters: project.files.reduce((n, one) => n + one.source.length, 0)
})

// ---------------------------------------------------------------- one version against another

export interface ProjectComparison {
  added: string[]
  removed: string[]
  changed: string[]
  unchanged: string[]
  /** Whether the file the project starts at is a different file now. */
  entryMoved: boolean
}

/** What changed between two versions of a project, by path and by text. Nothing is guessed about a rename. */
export function compareProjects(before: Project, after: Project): ProjectComparison {
  const was = new Map(before.files.map((one) => [one.path, one.source]))
  const now = new Map(after.files.map((one) => [one.path, one.source]))
  const added = [...now.keys()].filter((path) => !was.has(path)).sort()
  const removed = [...was.keys()].filter((path) => !now.has(path)).sort()
  const shared = [...now.keys()].filter((path) => was.has(path)).sort()
  return {
    added,
    removed,
    changed: shared.filter((path) => was.get(path) !== now.get(path)),
    unchanged: shared.filter((path) => was.get(path) === now.get(path)),
    entryMoved: before.entry !== after.entry
  }
}

/**
 * That comparison as a sentence.
 *
 * Written for the version list, where "changed" on its own tells nobody what happened. A rename is not claimed: a file
 * gone and a file arrived are reported as exactly that, because the only way to know they are the same file is to be
 * told, and nobody told us.
 */
export function describeComparison(comparison: ProjectComparison): string {
  const parts: string[] = []
  const list = (paths: readonly string[]): string => (paths.length <= 3 ? paths.join(', ') : `${paths.slice(0, 3).join(', ')} and ${paths.length - 3} more`)
  if (comparison.changed.length > 0) parts.push(`${comparison.changed.length} changed (${list(comparison.changed)})`)
  if (comparison.added.length > 0) parts.push(`${comparison.added.length} added (${list(comparison.added)})`)
  if (comparison.removed.length > 0) parts.push(`${comparison.removed.length} taken out (${list(comparison.removed)})`)
  if (parts.length === 0) return 'The files are the same as they were.'
  const kept = comparison.unchanged.length
  const moved = comparison.entryMoved ? ' The project starts at a different file now.' : ''
  return `${parts.join('; ')}${kept > 0 ? `; ${kept} left alone` : ''}.${moved}`
}

// ---------------------------------------------------------------- out as a zip

/**
 * The entries a zip of this project holds.
 *
 * The bytes and the decision about compressing, and no writing: the archive itself is put together in the main process
 * (`zipProject` in src/main/artifacts/running.ts), where the deflater lives. One entry per file and nothing added --
 * no manifest, no readme, no note about Orbis. A zip somebody opens should be the files they were shown and not a
 * folder with extras in it they have to delete.
 *
 * `modified` is handed in rather than read from a clock, so the same project zipped twice gives the same bytes and the
 * read-back check means something.
 */
export function projectZipEntries(project: Project, modified = 0): ZipEntry[] {
  const encoder = new TextEncoder()
  return project.files.map((one) => {
    const data = encoder.encode(one.source)
    return { path: one.path, data, compress: shouldCompress(one.path, data.length), modified }
  })
}
