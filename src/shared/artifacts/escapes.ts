/**
 * Code that arrives as one long line with the two characters `\n` where its line breaks should be.
 *
 * A model that writes a file inside a JSON argument sometimes escapes it twice, so what reaches Orbis is
 * `import random\nfrom x import y\n\ndef f(): ...` on a single line, which does not run. The repair is deliberately
 * narrow, because a one-line program that really contains `\n` in a string must be left alone:
 *
 *  - the text has no real line break at all;
 *  - and `\n` is followed by something that starts a statement (import, def, a comment, an assignment...) at least twice.
 *
 * An escaped backslash (`\\n`, which is a backslash and an `n` in the intended source) is kept as it was meant.
 */
export function restoreEscapedBreaks(text: string): { text: string; fixed: boolean } {
  if (text.includes('\n')) return { text, fixed: false }
  const starts = /\\n(?=\s*(?:import\s|from\s|def\s|class\s|if\s|elif\s|else:|for\s|while\s|return\b|print\(|#|@|[A-Za-z_][\w.]*\s*=[^=]|\}|\{|<\/|<\w|using\s|package\s|public\s|const\s|let\s|var\s|function\s|#include|SELECT\s|INSERT\s|CREATE\s))/g
  const hits = text.match(starts)
  if (!hits || hits.length < 2) return { text, fixed: false }
  const out = text
    .replace(/\\\\/g, '\u0000')
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\u0000/g, '\\')
  return { text: out, fixed: true }
}
