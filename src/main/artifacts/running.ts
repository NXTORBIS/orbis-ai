import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { buildable, checkCode, filesFor, type CodeSpec, type PageFile } from '../../shared/pages/codePage.ts'
import { gateForWrite } from '../../shared/artifacts/secrets.ts'
import { checkSyntax, languageById } from '../../shared/artifacts/languages.ts'
import { languageName, projectLanguages, projectZipEntries, type Project, type ProjectProblem } from '../../shared/artifacts/project.ts'
import { isZipError, readDirectory, readEntry, ZipWriter } from '../../shared/portable/zip.ts'
import type { VerifyResult } from '../../shared/compute/interchange.ts'
import { compileJavaScript } from './codeCheck.ts'

/**
 * What "run" means in Orbis, and the one narrow case in which it means anything at all.
 *
 * The engine does not run code on this computer. Not with `child_process`, not with `eval`, not by writing a file and
 * asking the operating system to open it. That is not a limitation waiting to be lifted: a thing that writes a program
 * from a sentence and then runs it has handed whatever wrote the sentence the use of the machine, and no amount of
 * checking the text first changes that. So there is nothing in this file that executes anything, and `artifact.reveal`
 * still refuses to open a source file for the same reason.
 *
 * The exception is a web page, and it is an exception only because somewhere to run one already exists and is not
 * this computer: the Pages sandbox. A Page is a frame Chromium enforces -- no Node, no file access, no network, a
 * session of its own, and a content policy of `default-src 'none'` -- and a web project with an `index.html` is
 * exactly the shape that frame serves. So "Run" for a web project means "show it in the Pages sandbox", and for
 * everything else it means an honest refusal with what can be done instead.
 *
 * ## What the person is told before anything runs
 *
 * Three things, every time, because each of them has made somebody think the run was broken when it was working as
 * designed: it is a web page and not Node, so `require` is not there; it cannot reach the network, so a page that
 * fetches shows nothing; and Orbis cannot interrupt a page that loops for ever, so closing it is the way out.
 *
 * ## What every file goes through first
 *
 * The secret gate, so a key is never written into a sandbox folder; the language's own check, so a file that does not
 * even parse is refused here rather than failing silently behind glass; and `checkCode`, the Pages check, which
 * refuses the things that would appear to work and quietly would not.
 */

// ---------------------------------------------------------------- is there anything to run

/** The extensions a web page is made of. Nothing else is served, and nothing else is executed anywhere. */
const PAGE = /\.html?$/i
const STYLE = /\.css$/i
const SCRIPT = /\.m?js$/i

export interface Runnable {
  ok: true
  /** The file the sandbox would load. */
  entry: string
  /** What is true of the run before it happens. */
  notes: string[]
}

export interface NotRunnable {
  ok: false
  /** One or two sentences a person can act on. */
  reason: string
}

/** The sentence every refusal ends with, so the alternative is always offered and always the same one. */
const INSTEAD = 'Orbis does not run programs on your computer; it can run a web page project in its sandbox, or you can save the files and run them yourself.'

/**
 * Whether this project is one Orbis can run, and if not, why not in words.
 *
 * The answer turns on one thing: does it start at an HTML page. A project of Python, of shell scripts, or of
 * TypeScript that would have to be compiled first is refused by name, because "cannot run this" with no noun in it
 * leaves a person guessing at which part Orbis objected to.
 */
export function runnable(project: Project): Runnable | NotRunnable {
  const entry = project.files.find((one) => one.path === project.entry)
  if (!entry) return { ok: false, reason: `This project says it starts at "${project.entry}", and there is no such file in it.` }

  if (!PAGE.test(entry.path)) {
    const main = projectLanguages(project)[0]
    const called = languageName(entry.language) || main?.name || ''
    const named = called === '' || called === 'Something else' ? 'This project is not a web page project' : `This is a ${called} project`
    return { ok: false, reason: `${named}. ${INSTEAD}` }
  }

  const pages = project.files.filter((one) => PAGE.test(one.path))
  if (pages.length > 1) {
    /*
     * One page, because the sandbox serves one page.
     *
     * A Page is served from three fixed names -- `index.html`, `page.css`, `page.js` -- and that list is short on
     * purpose: a path is the thing that has to be checked, and three names Orbis chose are three names nothing has to
     * check. A project of several pages linking to each other would need that list opened up, which is a decision
     * about the sandbox and not something to slip in through Create.
     */
    return {
      ok: false,
      reason: `Orbis's sandbox shows one page at a time, and this project has ${pages.length} (${pages.map((one) => one.path).join(', ')}). It can run a project with a single page in it; otherwise save the files and open them yourself.`
    }
  }

  const notes = [
    'This runs as a web page in Orbis’s sandbox: it cannot reach the network, your files, your saved passwords, or anything else on this computer.',
    'It runs as a page script, not as Node. require, process and the file system are not there.',
    'Orbis cannot interrupt a page that loops for ever once it has started. Closing it is the way out.'
  ]
  return { ok: true, entry: entry.path, notes }
}

// ---------------------------------------------------------------- one page, taken apart

export interface PageParts {
  /** What goes inside the body Orbis builds. */
  body: string
  style: string
  script: string
  /** Reasons it cannot be run, in words. Empty when it can. */
  problems: string[]
  /** Things that are true of the run, which a person should know before reading the screen. */
  notes: string[]
  /** Files of the project the page never asked for, so nothing claims they ran. */
  leftOut: string[]
}

/** An address a page points at, as a path inside the project, or null when it points outside it. */
export function resolveFrom(entry: string, href: string): string | null {
  const clean = href.split('#')[0].split('?')[0].trim()
  if (clean === '') return null
  // A scheme or a protocol-relative address is somewhere else, and somewhere else is not in this project.
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null
  const base = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')).split('/') : []
  const parts = clean.startsWith('/') ? clean.slice(1).split('/') : [...base, ...clean.split('/')]
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.length > 0 ? out.join('/') : null
}

const attribute = (tag: string, name: string): string => {
  const quoted = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag)
  if (quoted) return quoted[2] ?? quoted[3] ?? ''
  const bare = new RegExp(`\\s${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag)
  return bare ? bare[1] : ''
}

/**
 * One HTML file split into the three parts the sandbox serves.
 *
 * The sandbox does not serve a document; it serves a body, a stylesheet and a script, and writes the shell around them
 * itself -- because the shell carries the `ready()` call and the error reporting that a generated page cannot be
 * relied on to carry. So an ordinary HTML file has to be taken apart, and taking it apart is where the honest work is:
 *
 *   - A `<style>` block and a `style=""` attribute are both blocked by `style-src 'self'`. The block can be moved into
 *     the stylesheet, so it is. The attribute cannot, so a page using one is refused rather than shown unstyled with
 *     nothing said -- which is what would otherwise happen, since the Pages check does not look for either.
 *   - A `<link rel=stylesheet>` and a `<script src>` pointing at a file in this project become that file's text. One
 *     pointing anywhere else is refused: the sandbox cannot fetch it and a page missing its script is not a run.
 *   - An inline `<script>` is refused by the Pages check anyway; it is named here so the message says which tag.
 *
 * Several stylesheets and several scripts are allowed and joined in the order the page lists them -- with a note,
 * because the sandbox puts the whole script in one scope, so two files that each declare the same name at the top
 * level will collide where as separate files they would not have.
 */
export function splitPage(project: Project, entry: string): PageParts {
  const file = project.files.find((one) => one.path === entry)
  const parts: PageParts = { body: '', style: '', script: '', problems: [], notes: [], leftOut: [] }
  if (!file) {
    parts.problems.push(`There is no file called "${entry}" in this project.`)
    return parts
  }

  const used = new Set<string>([entry])
  const styles: string[] = []
  const scripts: string[] = []
  let html = file.source

  // Taken out before the body is read, because a stylesheet and a script usually sit in the head.
  html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_whole, inner: string) => {
    styles.push(`/* from a <style> block in ${entry} */\n${inner.trim()}`)
    return ''
  })
  html = html.replace(/<link\b[^>]*>/gi, (tag: string) => {
    const rel = attribute(tag, 'rel').toLowerCase()
    if (!rel.split(/\s+/).includes('stylesheet')) return ''
    const href = attribute(tag, 'href')
    const path = resolveFrom(entry, href)
    const found = path === null ? undefined : project.files.find((one) => one.path === path)
    if (!found) {
      parts.problems.push(`The page asks for the stylesheet "${href}", which is not a file in this project. The sandbox fetches nothing, so it could not be loaded.`)
      return ''
    }
    if (!STYLE.test(found.path)) parts.notes.push(`"${found.path}" is loaded as a stylesheet although its name does not end in .css.`)
    used.add(found.path)
    styles.push(`/* ${found.path} */\n${found.source}`)
    return ''
  })
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (_whole, rest: string, inner: string) => {
    const tag = `<script${rest}>`
    const src = attribute(tag, 'src')
    if (src === '') {
      parts.problems.push(`The page has a <script> block written into it. An inline script is blocked by this sandbox's content policy, so it would never run. Put the code in a .js file and point at it with <script src>.`)
      return ''
    }
    if (inner.trim() !== '') parts.notes.push('A <script src> tag also had code inside it. A browser ignores that code, and so does this.')
    const path = resolveFrom(entry, src)
    const found = path === null ? undefined : project.files.find((one) => one.path === path)
    if (!found) {
      parts.problems.push(`The page asks for the script "${src}", which is not a file in this project. The sandbox fetches nothing, so it could not be loaded.`)
      return ''
    }
    used.add(found.path)
    scripts.push(`/* ${found.path} */\n${found.source}`)
    return ''
  })
  // A self-closing or unclosed script tag with a src on it, which browsers tolerate and this would otherwise miss.
  html = html.replace(/<script\b[^>]*\/?>/gi, (tag: string) => {
    const src = attribute(tag, 'src')
    if (src !== '') parts.problems.push(`The page has a <script> tag for "${src}" that is never closed. Close it with </script>, or the rest of the page is inside it as far as a browser is concerned.`)
    return ''
  })

  const body = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html)
  if (body) parts.body = body[1].trim()
  else {
    parts.body = html
      .replace(/<!doctype[^>]*>/gi, '')
      .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, '')
      .replace(/<\/?html\b[^>]*>/gi, '')
      .replace(/<\/?body\b[^>]*>/gi, '')
      .trim()
  }

  const inline = parts.body.match(/\sstyle\s*=\s*["']/gi)
  if (inline) {
    parts.problems.push(
      `The page sets its own styles on ${inline.length} element${inline.length === 1 ? '' : 's'} with a style="..." attribute. This sandbox's content policy blocks those, so the page would show unstyled with nothing saying why. Move them into a .css file.`
    )
  }
  if (/<img\b/i.test(parts.body)) {
    parts.notes.push('The page shows pictures. A project holds text files, so any picture it points at is not there and will show as a broken image.')
  }
  if (styles.length > 1) parts.notes.push(`${styles.length} stylesheets are joined into one, in the order the page lists them.`)
  if (scripts.length > 1) {
    parts.notes.push(`${scripts.length} scripts are joined into one and run in a single scope, so two files that each declare the same name at the top level will clash here where as separate files they would not.`)
  }

  parts.style = styles.join('\n\n')
  parts.script = scripts.join('\n;\n')
  parts.leftOut = project.files.map((one) => one.path).filter((path) => !used.has(path))
  if (parts.leftOut.length > 0) {
    parts.notes.push(`The page never asks for ${parts.leftOut.join(', ')}, so ${parts.leftOut.length === 1 ? 'it was' : 'they were'} not part of the run.`)
  }
  return parts
}

// ---------------------------------------------------------------- every file, checked first

export interface FileChecks {
  problems: string[]
  notes: string[]
}

/**
 * The secret gate and the language's own reader, over every file in the project.
 *
 * Both run before anything is written anywhere. The gate because a sandbox folder is still a folder on this computer
 * and a key written into one has been written down; the reader because a file that does not parse would fail behind
 * glass where the only evidence is a blank rectangle.
 */
export function checkProjectFiles(project: Project): FileChecks {
  const out: FileChecks = { problems: [], notes: [] }
  for (const one of project.files) {
    const gate = gateForWrite(one.path, one.source, false)
    if (!gate.ok) {
      // The gate's own message names the lines and never quotes what it found.
      out.problems.push(`${one.path}: ${gate.message}`)
      continue
    }
    const language = languageById(one.language)
    if (!language || language.check === null) continue
    const checked = checkSyntax(one.language, one.source, compileJavaScript)
    if (checked.checked && !checked.wellFormed) out.problems.push(`${one.path}: ${checked.message}`)
    else if (!checked.checked && SCRIPT.test(one.path)) {
      /*
       * A file with `import` or `export` in it is the trap worth catching here.
       *
       * The sandbox wraps the script in one function, where a top-level `import` is a syntax error for the whole file.
       * The page would then never call `ready()`, and ten seconds later Orbis would stop it as "did not finish
       * starting" -- with nothing on screen saying why. Refused up front instead.
       */
      if (compileJavaScript(one.source) === 'module') {
        out.problems.push(`${one.path} uses import or export. The sandbox runs a script, not a module, so this file would stop the page before any of it ran. Write it as a plain script, or save the files and run them yourself.`)
      } else out.notes.push(`${one.path}: ${checked.message}`)
    }
  }
  return out
}

// ---------------------------------------------------------------- showing it

export interface SandboxDeps {
  /**
   * Writes the three files somewhere the sandbox serves from, and gives back the id they are served under.
   *
   * In the app this is the one new method on `CodePages` (see the wiring note): the same `CodeStore.write` the
   * generated route uses, with the id remembered so the host will open it. Injected so this file can be tested
   * without Electron, a profile folder or a window.
   */
  place(spec: CodeSpec, files: readonly PageFile[]): Promise<string>
  /** Opens that id in the sandboxed view, and says what the sandbox said. `CodePages.open`, with the caller's window. */
  open(pageId: string): Promise<{ ok: boolean; error?: string; message?: string; health?: unknown }>
  /** Closes it again, for a run that opened and could show nothing. `CodePages.close`. */
  close?(pageId: string): void
}

export interface RunOutcome {
  ok: boolean
  pageId?: string
  /** The file the sandbox loaded. */
  entry?: string
  /** What the sandbox says about itself, straight through and not summarised. */
  health?: unknown
  /** Every reason nothing ran. */
  problems?: string[]
  /** What is true of the run. Shown whether it worked or not. */
  notes?: string[]
  reason?: 'not-runnable' | 'refused' | 'not-placed' | 'not-opened'
  message?: string
}

/**
 * A web project shown in the Pages sandbox.
 *
 * Nothing here is clever. It asks whether the project can run at all, takes the page apart, checks every file, asks
 * the Pages check what it thinks, and only then hands the three files over. Every refusal along the way comes back as
 * words rather than a code, and the sandbox's own answer -- including the Pages check refusing the project outright --
 * is reported as the sandbox said it, because a run that was stopped by the sandbox and a run that failed are
 * different facts and only the sandbox knows which.
 */
export async function openInSandbox(project: Project, deps: SandboxDeps): Promise<RunOutcome> {
  const can = runnable(project)
  if (!can.ok) return { ok: false, reason: 'not-runnable', message: can.reason }

  const files = checkProjectFiles(project)
  const parts = splitPage(project, can.entry)
  const notes = [...can.notes, ...parts.notes, ...files.notes]
  const problems = [...files.problems, ...parts.problems]
  if (problems.length > 0) {
    return { ok: false, reason: 'refused', message: 'Nothing was run.', problems, notes }
  }

  const spec: CodeSpec = {
    title: can.entry,
    purpose: `A run of this project's ${can.entry} in Orbis's sandbox.`,
    body: parts.body,
    style: parts.style,
    script: parts.script,
    notes: [...notes]
  }

  /*
   * The Pages check, on the project's own code.
   *
   * It refuses what would look like it worked: a page that fetches, one that reaches for browser storage, one that
   * opens a window. Those refusals are the sandbox's own words and are passed through as they are -- rewording them
   * here would mean two descriptions of one rule, which drift.
   */
  const said = checkCode(spec)
  if (!buildable(said)) {
    return {
      ok: false,
      reason: 'refused',
      message: 'The code check refused this project, so nothing was run.',
      problems: said.filter((one) => one.severity === 'error').map((one) => one.message),
      notes
    }
  }
  for (const warning of said.filter((one) => one.severity === 'warning')) notes.push(warning.message)

  let pageId: string
  try {
    pageId = await deps.place(spec, filesFor(spec))
  } catch (err) {
    return { ok: false, reason: 'not-placed', message: `The files could not be put where the sandbox serves them: ${err instanceof Error ? err.message : 'unknown reason'}.`, notes }
  }

  const opened = await deps.open(pageId)
  if (!opened.ok) {
    deps.close?.(pageId)
    return { ok: false, reason: 'not-opened', message: opened.message ?? 'The sandbox would not open this page.', problems: opened.error ? [opened.error] : [], notes, pageId }
  }
  return { ok: true, pageId, entry: can.entry, health: opened.health, notes }
}

// ---------------------------------------------------------------- out as a zip

export interface ZipOutcome {
  bytes: Uint8Array
  /** Every path in the archive, in the order it was written. */
  entries: string[]
  notes: string[]
}

/**
 * The project as a zip archive.
 *
 * Orbis's own writer, the one the portable package uses, rather than a second one: it checks every path as it is added,
 * refuses two entries at one path, and writes the UTF-8 flag so a non-English file name reads back as what it was. The
 * deflater is handed in so the same function can be tested with a stub, and the timestamp is handed in so the same
 * project zipped twice gives the same bytes -- which is what makes checking the file afterwards mean anything.
 */
export function zipProject(
  project: Project,
  modified = 0,
  deflate: (data: Uint8Array) => Uint8Array = (data) => new Uint8Array(deflateRawSync(data))
): ZipOutcome | ProjectProblem {
  const writer = new ZipWriter(deflate)
  const chunks: Uint8Array[] = []
  const entries: string[] = []
  for (const entry of projectZipEntries(project, modified)) {
    const written = writer.add(entry)
    if (isZipError(written)) return { error: 'bad-path', message: `"${entry.path}" could not go into the archive: ${written.message}` }
    chunks.push(written)
    entries.push(entry.path)
  }
  chunks.push(writer.finish())
  const total = chunks.reduce((n, one) => n + one.length, 0)
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return {
    bytes,
    entries,
    notes: [
      `${entries.length} file${entries.length === 1 ? '' : 's'} in a zip archive, each as the text it is. No folders beyond the ones in the paths, and nothing added.`,
      'A zip carries no permissions and no record of this computer. Nothing in it runs by being opened.'
    ]
  }
}

/**
 * The archive read back and compared with the project it was written from.
 *
 * The point of the exercise: the file on disk is listed from its own central directory, every entry is inflated with
 * its size and checksum checked, and the text that comes out is compared character for character with the text that
 * went in. Anything that does not match is named. A missing file and a changed file are reported separately, because
 * they are different accidents.
 */
export function verifyProjectZip(
  project: Project,
  readBack: Uint8Array,
  inflate: (data: Uint8Array) => Uint8Array = (data) => new Uint8Array(inflateRawSync(data))
): VerifyResult {
  const checks: VerifyResult['checks'] = []
  const differences: string[] = []
  const listing = readDirectory(readBack)
  if (isZipError(listing)) {
    checks.push({ what: 'archive', passed: false, describe: `The file does not read back as an archive: ${listing.message}` })
    return { ok: false, checks, reimported: null, differences: [listing.message] }
  }
  checks.push({ what: 'archive', passed: true, describe: `The file reads back as an archive of ${listing.length} ${listing.length === 1 ? 'entry' : 'entries'}.` })

  const found = new Map(listing.map((one) => [one.path, one]))
  const decoder = new TextDecoder()
  let same = 0
  for (const file of project.files) {
    const entry = found.get(file.path)
    if (!entry) {
      differences.push(`"${file.path}" is not in the archive.`)
      continue
    }
    found.delete(file.path)
    const data = readEntry(readBack, entry, inflate)
    if (isZipError(data)) {
      differences.push(`"${file.path}" could not be read back: ${data.message}`)
      continue
    }
    if (decoder.decode(data) !== file.source) differences.push(`"${file.path}" does not read back as the text that was written.`)
    else same += 1
  }
  for (const extra of found.keys()) differences.push(`The archive holds "${extra}", which is not in the project.`)

  checks.push({
    what: 'files',
    passed: same === project.files.length && differences.length === 0,
    describe: `${same} of ${project.files.length} file${project.files.length === 1 ? '' : 's'} read back as the text that was written.`
  })
  return { ok: differences.length === 0, checks, reimported: { rows: same, columns: 0 }, differences }
}
