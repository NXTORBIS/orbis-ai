/**
 * A Page written as code, rather than described as a specification.
 *
 * The specification route builds a calculator: boxes, calculations Orbis already has, answers. It is verified all the
 * way down -- every number comes from an engine that was tested before the Page existed -- and that is exactly what
 * caps it. It can only ever answer what the catalogue covers, so "animate a bouncing ball" gets an honest refusal
 * however clever the model is.
 *
 * This route lifts the ceiling and gives up that guarantee, deliberately and visibly. A Page here is real HTML, CSS
 * and JavaScript, so it can draw, animate, lay itself out and interact however the request needs -- and nothing
 * checks that the number it shows is right. The two kinds are not ranked. They answer different questions, and a Page
 * must say which kind it is, because "a calculator Orbis verified" and "code a model wrote" are different claims and
 * only one of them is about correctness.
 *
 * ## What does not change
 *
 * The sandbox. It is enforced by Chromium, not by the shape of what runs inside it: `nodeIntegration` off,
 * `contextIsolation` on, `sandbox` on, a session partition per Page, and a content policy of `default-src 'none'`
 * with `script-src 'self'`. Generated code runs under exactly those walls, so it still cannot reach the vault,
 * cookies, another profile, the shell, or any address outside its grants. The ceiling moved; the floor did not.
 *
 * ## Why the shell is ours
 *
 * The page's own file is written here and never by the model. It carries three things the model cannot be relied on
 * to carry: the `ready()` call without which Orbis stops the Page as failed-to-start, an error handler so a mistake
 * in the code is reported rather than leaving a blank rectangle, and a `<script src>` rather than an inline block --
 * `script-src 'self'` blocks inline scripts, so a model writing `<script>...</script>` would produce a Page that
 * silently does nothing at all.
 */

/** A file a Page is served from. The path is relative to the Page's own root and is never a directory. */
export interface PageFile {
  path: string
  content: string
}

export interface CodeProblem {
  /** What is wrong, in a sentence a person could act on. */
  message: string
  /** `error` stops the Page being built. `warning` is kept and shown. */
  severity: 'error' | 'warning'
}

/** The most a generated Page may weigh. Large enough for a real interface, small enough that a runaway is caught. */
export const MAX_CODE_BYTES = 120_000
export const MAX_STYLE_BYTES = 40_000

/**
 * What a model is allowed to hand back.
 *
 * Three files and no more: the body of the page, its style, and its script. Not a file list, because a file list is a
 * path, and a path is the thing that has to be checked before anything else -- here there is nothing to check,
 * because the names are ours.
 */
export interface CodeSpec {
  title: string
  purpose: string
  /** The body's markup. No script tags: the script goes in `script`, for the reason in the note above. */
  body: string
  style: string
  script: string
  /** What the Page does not do, or does approximately. At least one, and the model is asked for it honestly. */
  notes: readonly string[]
}

/*
 * Things that are refused in the code itself.
 *
 * Not the security boundary -- that is Chromium's, and it holds whatever is written here. These are the things that
 * would *appear* to work while quietly defeating the point: a page that fetches its own data has stopped being
 * reproducible, and one that opens a window has left the frame it was given.
 *
 * Each is matched on the source rather than at runtime, so a Page that would do these is not built, rather than built
 * and then stopped while somebody is looking at it.
 */
const REFUSED: { pattern: RegExp; why: string }[] = [
  { pattern: /\beval\s*\(/, why: 'eval is refused: the content policy blocks it at runtime, so a Page using it would fail where nobody can see why.' },
  { pattern: /new\s+Function\s*\(/, why: 'new Function is refused, for the same reason as eval.' },
  { pattern: /\bimportScripts\s*\(/, why: 'importScripts would pull in code from somewhere else, which this Page cannot be checked against.' },
  { pattern: /\bwindow\.open\s*\(/, why: 'window.open is refused: a Page lives in the frame it was given.' },
  { pattern: /\bdocument\.write\s*\(/, why: 'document.write is refused: it replaces the page Orbis built, including the part that reports errors.' },
  { pattern: /\b(localStorage|sessionStorage|indexedDB)\b/, why: 'Browser storage is refused. A Page remembers through Orbis, so that what it remembers belongs to a profile and can be exported and deleted with it.' },
  { pattern: /\bnavigator\.(geolocation|mediaDevices|clipboard|credentials)\b/, why: 'That device capability is not something a Page asks the browser for. Everything a Page may reach goes through orbis.request, where it is a permission.' },
  { pattern: /\b(XMLHttpRequest|WebSocket|EventSource)\b/, why: 'A Page does not open its own connections. Anything it needs from outside comes through orbis.request, where the grants decide.' }
]

/** `fetch` is singled out, because its refusal has to explain the alternative rather than just say no. */
const FETCH = /\bfetch\s*\(/

/**
 * Whether this code may be built into a Page.
 *
 * Errors stop it. The point is not to catch a determined escape -- Chromium's sandbox is what does that -- but to
 * refuse the things that would produce a Page which looks built and does not work, and to say why in words the next
 * attempt can act on.
 */
export function checkCode(spec: Partial<CodeSpec> | null | undefined): CodeProblem[] {
  const problems: CodeProblem[] = []
  const add = (message: string, severity: CodeProblem['severity'] = 'error'): void => {
    problems.push({ message, severity })
  }

  if (!spec || typeof spec !== 'object') {
    return [{ message: 'Nothing usable came back.', severity: 'error' }]
  }

  const title = String(spec.title ?? '').trim()
  const script = String(spec.script ?? '')
  const style = String(spec.style ?? '')
  const body = String(spec.body ?? '')

  if (!title) add('A Page needs a title.')
  if (title.length > 80) add('The title is longer than 80 characters.')
  if (!String(spec.purpose ?? '').trim()) add('A Page needs one sentence saying what it is for.')
  if (!body.trim() && !script.trim()) add('A Page with no markup and no script would show nothing.')

  if (script.length > MAX_CODE_BYTES) add(`The script is ${script.length} characters, and the most a Page may have is ${MAX_CODE_BYTES}.`)
  if (style.length > MAX_STYLE_BYTES) add(`The style is ${style.length} characters, and the most a Page may have is ${MAX_STYLE_BYTES}.`)

  /*
   * A script tag in the body is the mistake that produces a silent Page.
   *
   * `script-src 'self'` blocks inline scripts, so the markup would load, the script would be refused by the content
   * policy, and the Page would sit there doing nothing with no error anybody sees.
   */
  if (/<script\b/i.test(body)) add("The body must not contain a <script> tag -- inline scripts are blocked by this Page's content policy. Put the code in `script` instead.")
  if (/\son[a-z]+\s*=/i.test(body)) add('The body must not use inline event handlers (onclick and the like); they are blocked by the content policy. Add listeners in `script`.')
  if (/<iframe\b|<object\b|<embed\b/i.test(body)) add('A Page may not host a frame, an object or an embed.')
  if (/<link\b[^>]*rel\s*=\s*["']?stylesheet/i.test(body)) add('A Page may not load an external stylesheet. Put the style in `style`.')

  const source = `${script}\n${body}`
  for (const { pattern, why } of REFUSED) {
    if (pattern.test(source)) add(why)
  }
  if (FETCH.test(source)) {
    add('A Page does not fetch for itself. Ask Orbis with orbis.request(operation, payload), where what it may reach is a permission rather than a decision the code makes.')
  }

  const notes = Array.isArray(spec.notes) ? spec.notes.filter((n) => typeof n === 'string' && n.trim().length > 0) : []
  // A warning, not an error: a Page that works and forgot to say what it approximates is still a working Page.
  if (!notes.length) add('Say at least one thing this Page does not account for.', 'warning')

  return problems
}

/** Whether the problems allow a Page to be built. */
export const buildable = (problems: readonly CodeProblem[]): boolean => !problems.some((p) => p.severity === 'error')

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The files a Page is served from.
 *
 * Three fixed names, so nothing a model wrote is ever a path. The shell is Orbis's: it says the Page has started,
 * catches what the code throws and shows it, and loads the script from its own file because an inline one would be
 * refused by the content policy.
 */
export function filesFor(spec: CodeSpec): PageFile[] {
  const shell = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(spec.title)}</title>`,
    '<link rel="stylesheet" href="page.css" />',
    '</head>',
    '<body>',
    '<div id="orbis-page-error" hidden></div>',
    spec.body,
    /*
     * The script is loaded with `defer` so the body exists before it runs.
     *
     * Generated code reaches for its elements at the top, the way most page code does. Without this it would find
     * nothing and fail on the first line, and the failure would look like the code being wrong rather than early.
     */
    '<script src="page.js" defer></script>',
    '</body>',
    '</html>'
  ].join('\n')

  /*
   * The code is wrapped, not edited.
   *
   * What the model wrote runs as it was written. Around it goes the part Orbis cannot leave to chance: `ready()`,
   * without which the Page is stopped as having failed to start, and a report for anything thrown -- because an
   * exception in a Page otherwise leaves a blank rectangle and no explanation anywhere.
   */
  const script = [
    '(() => {',
    "  'use strict';",
    '  const show = (what) => {',
    "    const box = document.getElementById('orbis-page-error');",
    '    if (!box) return;',
    '    box.hidden = false;',
    "    box.textContent = 'This Page ran into a problem: ' + what;",
    '  };',
    '  try {',
    spec.script,
    '  } catch (error) {',
    "    show(error && error.message ? error.message : String(error));",
    '  }',
    '  // Said whether or not the code worked: a Page that reports its own failure is still a Page that started.',
    "  if (window.orbis && typeof window.orbis.ready === 'function') window.orbis.ready();",
    "  window.addEventListener('error', (e) => show(e.message));",
    "  window.addEventListener('unhandledrejection', (e) => show(String(e.reason)));",
    '})();'
  ].join('\n')

  const style = [
    '/* Orbis’s own, first: a Page inherits the look rather than inventing one, and may override anything below. */',
    ':root { color-scheme: dark; }',
    'body { margin: 0; padding: 20px; background: #0b0d12; color: #e8eaf2; font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }',
    '#orbis-page-error { margin: 0 0 16px; padding: 12px 14px; border-radius: 10px; border: 1px solid #a33; background: #2a1012; color: #ffd9dc; font-size: 14px; }',
    '',
    spec.style
  ].join('\n')

  return [
    { path: 'index.html', content: shell },
    { path: 'page.js', content: script },
    { path: 'page.css', content: style }
  ]
}
