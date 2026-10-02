import { Script } from 'node:vm'

/**
 * Whether a piece of JavaScript compiles.
 *
 * `new Script` parses and compiles; it does not run. Nothing is ever executed here -- there is no `runInContext`, no
 * `eval`, and the script object is dropped the moment it exists. What comes back is null when it compiles, the
 * engine's own complaint with its line when it does not, and the word "module" when the file uses import or export,
 * which a plain script cannot contain and this check therefore cannot read.
 */
export function compileJavaScript(source: string): string | null {
  try {
    // eslint-disable-next-line no-new
    new Script(source, { filename: 'artifact.js' })
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'It does not compile.'
    if (/Cannot use import statement outside a module|Unexpected token 'export'|import\.meta/.test(message)) return 'module'
    const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : ''
    const line = /artifact\.js:(\d+)/.exec(stack)
    return `${message}${line ? ` (line ${line[1]})` : ''}`.slice(0, 200)
  }
}
