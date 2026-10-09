/**
 * A code editor with the shape of `@monaco-editor/react`, without Monaco.
 *
 * NOT the user's file. Their `components/cs/CodeEditor.jsx` wraps Monaco, and this is what it wraps instead, so
 * their file needs no editing.
 *
 * ## Why not Monaco
 *
 * Monaco is about five megabytes and brings its own worker, its own loader and its own layout engine. Orbis
 * already ships `highlight.js`, which does the part that actually matters here — colouring code in forty
 * languages — so this builds the editor on that: a transparent textarea over a highlighted copy of the same
 * text, scrolled together. The caret, selection, undo, copy and paste are the browser's own and therefore
 * correct, which is the part a hand-written editor usually gets wrong.
 *
 * ## What it does and does not have
 *
 * It has syntax colouring, line numbers, a real tab key that indents instead of leaving the field, bracket and
 * quote closing, indent kept on a new line, and comment toggling. It has no minimap, no completions and no
 * inline errors — `options.minimap` is accepted and ignored rather than pretended at, because a fake minimap
 * would be worse than none.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import hljs from 'highlight.js/lib/common'

/** Their language ids to the ones highlight.js knows. Anything unlisted is coloured as plain text. */
const LANGUAGE = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  cpp: 'cpp',
  c: 'c',
  csharp: 'csharp',
  java: 'java',
  go: 'go',
  rust: 'rust',
  php: 'php',
  ruby: 'ruby',
  swift: 'swift',
  kotlin: 'kotlin',
  scala: 'scala',
  haskell: 'haskell',
  fsharp: 'fsharp',
  lua: 'lua',
  perl: 'perl',
  r: 'r',
  sql: 'sql',
  bash: 'bash',
  shell: 'bash',
  powershell: 'powershell',
  html: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  markdown: 'markdown',
  dart: 'dart',
  elixir: 'elixir',
  erlang: 'erlang',
  clojure: 'clojure',
  julia: 'julia',
  matlab: 'matlab',
  objectivec: 'objectivec',
  pascal: 'delphi',
  fortran: 'fortran',
  plaintext: null
}

/** What closes what, for the auto-closing. */
const CLOSES = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }

/** How a line comment starts, per language, for the comment-toggle shortcut. */
const COMMENT = {
  python: '#',
  ruby: '#',
  bash: '#',
  shell: '#',
  r: '#',
  perl: '#',
  yaml: '#',
  elixir: '#',
  julia: '#',
  sql: '--',
  haskell: '--',
  lua: '--',
  matlab: '%',
  fortran: '!'
}

const commentFor = (language) => COMMENT[language] ?? '//'

export default function Editor({
  value,
  language,
  onChange,
  onMount,
  theme,
  height,
  loading,
  options = {},
  className = ''
}) {
  const text = value ?? ''
  const box = useRef(null)
  const shown = useRef(null)
  const [at, setAt] = useState({ line: 1, column: 1 })

  const readOnly = options.readOnly === true
  const tabSize = Number.isFinite(options.tabSize) ? options.tabSize : 4
  const indent = ' '.repeat(Math.max(1, Math.min(8, tabSize)))
  const wrap = options.wordWrap === 'on'

  const kind = LANGUAGE[language] ?? (language && hljs.getLanguage(language) ? language : null)

  /*
   * The coloured copy.
   *
   * A trailing newline needs a character after it or the highlighted block is one line shorter than the textarea
   * and the two scroll out of step at the bottom.
   */
  const coloured = useMemo(() => {
    const body = text.endsWith('\n') ? text + ' ' : text
    if (!kind) return escape(body)
    try {
      return hljs.highlight(body, { language: kind, ignoreIllegals: true }).value
    } catch {
      // An unknown language is coloured as plain text rather than throwing the editor away.
      return escape(body)
    }
  }, [text, kind])

  const lines = useMemo(() => text.split('\n').length, [text])

  // The two layers have to scroll as one, or the colours drift away from the characters.
  const follow = useCallback(() => {
    const a = box.current
    const b = shown.current
    if (!a || !b) return
    b.scrollTop = a.scrollTop
    b.scrollLeft = a.scrollLeft
    const gutter = b.parentElement?.querySelector('.cse-gutter')
    if (gutter) gutter.scrollTop = a.scrollTop
  }, [])

  useLayoutEffect(follow, [coloured, follow])

  // Their wrapper calls onMount with an editor object; give it the few methods anything would reach for.
  useEffect(() => {
    if (typeof onMount !== 'function' || !box.current) return
    const el = box.current
    onMount({
      getValue: () => el.value,
      setValue: (next) => {
        el.value = next
        onChange?.(next)
      },
      focus: () => el.focus(),
      getModel: () => ({ getLineCount: () => el.value.split('\n').length }),
      layout: () => undefined,
      // Present so a caller can ask, rather than discovering the absence by a thrown error.
      getPosition: () => ({ lineNumber: at.line, column: at.column })
    })
    // Only once, when the element exists: a wrapper expecting one mount should get one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const whereIsTheCaret = useCallback(() => {
    const el = box.current
    if (!el) return
    const before = el.value.slice(0, el.selectionStart)
    const rows = before.split('\n')
    setAt({ line: rows.length, column: rows[rows.length - 1].length + 1 })
  }, [])

  const type = (next, caret) => {
    const el = box.current
    onChange?.(next)
    // React controls the value, so the caret has to be put back after the re-render.
    requestAnimationFrame(() => {
      if (!el) return
      el.selectionStart = caret
      el.selectionEnd = caret
      whereIsTheCaret()
    })
  }

  const onKey = (event) => {
    if (readOnly) return
    const el = event.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const all = el.value

    // Tab indents rather than leaving the field, which is the single most important key in a code editor.
    if (event.key === 'Tab') {
      event.preventDefault()
      if (start !== end || event.shiftKey) {
        // A selection, or shift: indent or outdent every line it touches.
        const from = all.lastIndexOf('\n', start - 1) + 1
        const to = all.indexOf('\n', end) === -1 ? all.length : all.indexOf('\n', end)
        const block = all.slice(from, to)
        const moved = event.shiftKey
          ? block.split('\n').map((one) => one.replace(new RegExp('^' + indent.slice(0, 1) + '{1,' + indent.length + '}'), '')).join('\n')
          : block.split('\n').map((one) => indent + one).join('\n')
        type(all.slice(0, from) + moved + all.slice(to), from + moved.length)
        return
      }
      type(all.slice(0, start) + indent + all.slice(end), start + indent.length)
      return
    }

    // A new line keeps the indent of the one it came from, and opens a block when it follows a brace.
    if (event.key === 'Enter') {
      const from = all.lastIndexOf('\n', start - 1) + 1
      const leading = (all.slice(from, start).match(/^[ \t]*/) ?? [''])[0]
      const opensBlock = /[([{:]$/.test(all.slice(0, start).trimEnd())
      const deeper = opensBlock ? leading + indent : leading
      event.preventDefault()
      const closing = all.slice(end).trimStart()[0]
      if (opensBlock && closing && ')]}'.includes(closing)) {
        // Put the closing brace on its own line, the way an editor does.
        const insert = '\n' + deeper + '\n' + leading
        type(all.slice(0, start) + insert + all.slice(end), start + 1 + deeper.length)
        return
      }
      type(all.slice(0, start) + '\n' + deeper + all.slice(end), start + 1 + deeper.length)
      return
    }

    // Brackets and quotes close themselves, and wrap a selection rather than replacing it.
    if (options.autoClosingBrackets !== 'never' && CLOSES[event.key]) {
      const shut = CLOSES[event.key]
      if (start !== end) {
        event.preventDefault()
        type(all.slice(0, start) + event.key + all.slice(start, end) + shut + all.slice(end), end + 2)
        return
      }
      // Not before a word, or typing an apostrophe inside a word would add a stray quote.
      const after = all[start]
      if (after === undefined || /[\s)\]},;:]/.test(after)) {
        event.preventDefault()
        type(all.slice(0, start) + event.key + shut + all.slice(end), start + 1)
        return
      }
    }

    // Typing a closing character that is already there steps over it.
    if (')]}"\'`'.includes(event.key) && all[start] === event.key && start === end) {
      event.preventDefault()
      type(all, start + 1)
      return
    }

    // Backspace over an empty pair removes both.
    if (event.key === 'Backspace' && start === end && start > 0) {
      const before = all[start - 1]
      if (CLOSES[before] && all[start] === CLOSES[before]) {
        event.preventDefault()
        type(all.slice(0, start - 1) + all.slice(start + 1), start - 1)
        return
      }
    }

    // Comment the selected lines out, and back in.
    if ((event.ctrlKey || event.metaKey) && event.key === '/') {
      event.preventDefault()
      const mark = commentFor(language)
      const from = all.lastIndexOf('\n', start - 1) + 1
      const to = all.indexOf('\n', end) === -1 ? all.length : all.indexOf('\n', end)
      const rows = all.slice(from, to).split('\n')
      const allCommented = rows.every((one) => one.trim() === '' || one.trimStart().startsWith(mark))
      const moved = rows
        .map((one) => {
          if (one.trim() === '') return one
          if (allCommented) return one.replace(new RegExp('^(\\s*)' + mark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?'), '$1')
          const lead = (one.match(/^\s*/) ?? [''])[0]
          return lead + mark + ' ' + one.slice(lead.length)
        })
        .join('\n')
      type(all.slice(0, from) + moved + all.slice(to), from + moved.length)
    }
  }

  if (loading && text === '' && value === undefined) return loading

  return (
    <div
      className={`cse${wrap ? ' wrap' : ''}${theme === 'light' || theme === 'vs' ? ' light' : ''} ${className}`.trim()}
      style={height ? { height } : undefined}
    >
      {options.lineNumbers !== 'off' && (
        <div className="cse-gutter" aria-hidden>
          {Array.from({ length: lines }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </div>
      )}

      <div className="cse-stack">
        {/* The coloured copy, underneath and inert. */}
        <pre className="cse-shown" ref={shown} aria-hidden>
          <code dangerouslySetInnerHTML={{ __html: coloured }} />
        </pre>

        {/* The real field, transparent text over it, so the caret and selection are the browser's own. */}
        <textarea
          ref={box}
          className="cse-box"
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap={wrap ? 'soft' : 'off'}
          aria-label={`Code, ${language ?? 'plain text'}`}
          onChange={(event) => onChange?.(event.target.value)}
          onScroll={follow}
          onKeyDown={onKey}
          onKeyUp={whereIsTheCaret}
          onClick={whereIsTheCaret}
          onSelect={whereIsTheCaret}
        />
      </div>

      <div className="cse-status">
        <span>
          Line {at.line}, column {at.column}
        </span>
        <span>
          {lines} {lines === 1 ? 'line' : 'lines'} · {kind ?? 'plain text'}
        </span>
      </div>
    </div>
  )
}

function escape(text) {
  return String(text).replace(/[&<>]/g, (one) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[one])
}

/** `useMonaco` is part of the package's shape. There is no Monaco here, so it is honestly null. */
export const useMonaco = () => null
export { Editor as DiffEditor }
