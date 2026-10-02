import { isInterchangeError, readXml } from '../compute/interchange.ts'

/**
 * The languages a code artifact can be in, and what Orbis can and cannot say about a file in each.
 *
 * A code artifact is a source file kept exactly as written: its language, its text, its versions, and the right
 * extension when it is saved. Orbis never runs it. What it can do for some languages is read the file the way that
 * language's own reader would and say whether it is well formed -- JSON through the JSON parser, XML through the XML
 * reader, JavaScript through the engine's compiler (in the main process, compiled and not run). For every other
 * language nothing is checked, and the interface says exactly that rather than showing a tick. "Not checked" is a
 * fact about Orbis; a tick would be a claim about the code.
 */

export type SyntaxCheck = 'json' | 'xml' | 'javascript' | null

export interface Language {
  id: string
  /** What a person calls it. */
  name: string
  /** With its dot. The first is what a saved file gets. */
  extensions: readonly string[]
  /** Other names it goes by in a fenced block or a request. */
  aliases: readonly string[]
  /** Which reader can say whether a file is well formed, if any. */
  check: SyntaxCheck
}

const language = (id: string, name: string, extensions: string[], aliases: string[] = [], check: SyntaxCheck = null): Language =>
  Object.freeze({ id, name, extensions: Object.freeze(extensions), aliases: Object.freeze(aliases), check })

export const LANGUAGES: readonly Language[] = Object.freeze([
  language('python', 'Python', ['.py'], ['py', 'python3']),
  language('javascript', 'JavaScript', ['.js', '.mjs', '.cjs'], ['js', 'node', 'nodejs'], 'javascript'),
  language('typescript', 'TypeScript', ['.ts', '.tsx'], ['ts', 'tsx']),
  language('html', 'HTML', ['.html', '.htm'], []),
  language('css', 'CSS', ['.css'], []),
  language('json', 'JSON', ['.json'], [], 'json'),
  language('sql', 'SQL', ['.sql'], ['postgres', 'postgresql', 'mysql', 'sqlite']),
  language('shell', 'Shell script', ['.sh'], ['sh', 'bash', 'zsh']),
  language('powershell', 'PowerShell', ['.ps1'], ['ps1', 'pwsh']),
  language('batch', 'Batch file', ['.bat', '.cmd'], ['bat', 'cmd']),
  language('java', 'Java', ['.java'], []),
  language('csharp', 'C#', ['.cs'], ['cs', 'c#']),
  language('c', 'C', ['.c', '.h'], []),
  language('cpp', 'C++', ['.cpp', '.cc', '.hpp'], ['c++', 'cxx']),
  language('go', 'Go', ['.go'], ['golang']),
  language('rust', 'Rust', ['.rs'], ['rs']),
  language('php', 'PHP', ['.php'], []),
  language('ruby', 'Ruby', ['.rb'], ['rb']),
  language('swift', 'Swift', ['.swift'], []),
  language('kotlin', 'Kotlin', ['.kt'], ['kt']),
  language('r', 'R', ['.r'], []),
  language('yaml', 'YAML', ['.yml', '.yaml'], ['yml']),
  language('xml', 'XML', ['.xml'], [], 'xml'),
  language('toml', 'TOML', ['.toml'], []),
  language('ini', 'INI settings', ['.ini', '.cfg'], ['cfg', 'conf']),
  language('dockerfile', 'Dockerfile', ['.dockerfile'], ['docker'])
])

export const CODE_LIMITS = Object.freeze({ characters: 400_000, lines: 20_000 })

/** A language by its id or by another name it goes by. Never by anything that merely contains it. */
export function languageById(name: string): Language | null {
  const wanted = name.trim().toLowerCase()
  if (wanted === '') return null
  return LANGUAGES.find((one) => one.id === wanted) ?? LANGUAGES.find((one) => one.name.toLowerCase() === wanted) ?? LANGUAGES.find((one) => one.aliases.includes(wanted)) ?? null
}

/** The language a file name's extension means, or null when it is not a source file Orbis knows. */
export function languageForFile(fileName: string): Language | null {
  const lower = fileName.trim().toLowerCase()
  if (lower === 'dockerfile' || lower.endsWith('/dockerfile') || lower.endsWith('\\dockerfile')) return languageById('dockerfile')
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return null
  const ext = lower.slice(dot)
  return LANGUAGES.find((one) => one.extensions.includes(ext)) ?? null
}

/** The extension a saved file in a language gets, with its dot. */
export const extensionForLanguage = (id: string): string => languageById(id)?.extensions[0] ?? '.txt'

/** Every extension that means a source file, for the open dialog. Without the ones that already open as tables or documents. */
export const CODE_ONLY_EXTENSIONS: readonly string[] = Object.freeze(
  LANGUAGES.flatMap((one) => one.extensions).filter((ext) => !['.json', '.html', '.htm', '.xml'].includes(ext))
)

export interface SyntaxResult {
  /** Whether anything was checked at all. False means Orbis has no reader for this language. */
  checked: boolean
  /** Meaningful only when `checked`. */
  wellFormed: boolean
  /** One sentence a person can act on. */
  message: string
}

const lineOf = (source: string, offset: number): number => source.slice(0, Math.max(0, offset)).split('\n').length

/**
 * Whether a file is well formed, for the languages that can be checked without an engine.
 *
 * JavaScript is not here: compiling it needs the engine, which lives in the main process. A caller that has one
 * passes it as `compile`; without it JavaScript is reported as not checked, which is true.
 */
export function checkSyntax(languageId: string, source: string, compile?: (source: string) => string | null): SyntaxResult {
  const found = languageById(languageId)
  if (!found || found.check === null) {
    return { checked: false, wellFormed: false, message: `Orbis has no checker for ${found?.name ?? languageId}, so this was not checked. It was not run.` }
  }
  if (found.check === 'json') {
    try {
      JSON.parse(source)
      return { checked: true, wellFormed: true, message: 'It reads as JSON.' }
    } catch (err) {
      const said = err instanceof Error ? err.message : 'It does not parse.'
      const at = /position (\d+)/.exec(said)
      return { checked: true, wellFormed: false, message: `It does not read as JSON${at ? ` (line ${lineOf(source, Number(at[1]))})` : ''}: ${said.replace(/\s+in JSON at position \d+.*$/, '').slice(0, 160)}.` }
    }
  }
  if (found.check === 'xml') {
    const read = readXml(source)
    return isInterchangeError(read) ? { checked: true, wellFormed: false, message: `It does not read as XML: ${read.message}` } : { checked: true, wellFormed: true, message: 'It reads as XML.' }
  }
  if (!compile) return { checked: false, wellFormed: false, message: 'JavaScript is checked by compiling it, which this copy of Orbis cannot do here, so it was not checked. It was not run.' }
  const problem = compile(source)
  if (problem === null) return { checked: true, wellFormed: true, message: 'It compiles as JavaScript. It was not run.' }
  if (problem === 'module') return { checked: false, wellFormed: false, message: 'It uses import or export, which this check cannot read, so it was not checked. It was not run.' }
  return { checked: true, wellFormed: false, message: `It does not compile as JavaScript: ${problem}` }
}

/** How many lines a source file has. An empty file has none. */
export const lineCount = (source: string): number => (source === '' ? 0 : source.replace(/\r?\n$/, '').split(/\r?\n/).length)
