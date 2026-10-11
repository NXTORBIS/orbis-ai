import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The accessibility rules that can be checked without a browser.
 *
 * Orbis has no linter and no axe pass: the only accessibility test in the repo covers generated Pages, not the
 * window those Pages open in. Most of what axe checks needs a rendered page, but the mistakes that actually happen
 * here are visible in the source -- a button whose only content is an icon and which therefore has no name at all, a
 * dialog nobody can tell apart from another, a text field with no label.
 *
 * These are the ones worth a test, because each has shipped at least once and none of them is visible by looking at
 * the screen: everything looks right, and a screen reader says "button".
 */

// fileURLToPath rather than .pathname, which leaves a space in a folder name as %20 and then finds nothing.
const ROOT = fileURLToPath(new URL('../renderer/src/', import.meta.url))

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (entry.endsWith('.tsx')) out.push(path)
  }
  return out
}

const FILES = sources(ROOT).map((path) => ({ path: path.slice(ROOT.length), text: readFileSync(path, 'utf8') }))

test('there are components to check, so a passing run means something', () => {
  assert.ok(FILES.length > 40, `found ${FILES.length} components`)
})

/**
 * Each opening tag of a given kind, with its attributes and what it wraps.
 *
 * Written by hand rather than with a regular expression because JSX defeats the obvious one: an `onClick={() => ...}`
 * contains a `>`, so "up to the first >" ends the tag in the middle of it and every attribute after that is invisible.
 * That is not a theoretical problem -- it made this very test report a correctly labelled button as unlabelled. So the
 * braces are counted, and the tag ends at the first `>` that is not inside one.
 */
function tags(text: string, name: string): { attrs: string; inner: string; at: number }[] {
  const out: { attrs: string; inner: string; at: number }[] = []
  // The backslash is doubled on purpose: this is a template literal, so a single one is eaten before the RegExp ever
  // sees it and the class becomes [s/>] -- which matches "<inputs" and nothing else. That bug made this whole test
  // pass by checking almost nothing.
  const open = new RegExp(`<${name}(?=[\\s/>])`, 'g')
  for (const match of text.matchAll(open)) {
    let i = (match.index ?? 0) + name.length + 1
    let depth = 0
    let quote = ''
    for (; i < text.length; i++) {
      const c = text[i]
      if (quote) {
        if (c === quote) quote = ''
        continue
      }
      if (c === '"' || c === "'" || c === '`') quote = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    const attrs = text.slice((match.index ?? 0) + name.length + 1, i)
    const selfClosing = attrs.trimEnd().endsWith('/')
    const close = text.indexOf(`</${name}>`, i)
    out.push({ attrs, inner: selfClosing || close < 0 ? '' : text.slice(i + 1, close), at: match.index ?? 0 })
  }
  return out
}

/**
 * Whether something else in the file names this field: a `<label for>` pointing at its id, or a `<label>` around it.
 *
 * Both are correct ways to name a field and both are used here, so a test that only looked for aria-label would
 * report dozens of correctly labelled fields and be switched off within a week.
 */
function labelledElsewhere(text: string, attrs: string, at: number): boolean {
  const id = /\bid="([^"]+)"/.exec(attrs)?.[1]
  if (id && text.includes(`htmlFor="${id}"`)) return true
  // Wrapped in a label: the nearest <label before it is nearer than the nearest </label>.
  const open = text.lastIndexOf('<label', at)
  const close = text.lastIndexOf('</label>', at)
  return open > close
}

const named = (attrs: string): boolean => /aria-label[=\s]|aria-labelledby[=\s]|aria-labelledby=|title[=\s]/.test(attrs)

/** Whether what a control wraps includes words, as opposed to only an icon or an expression. */
function hasWords(inner: string): boolean {
  const withoutTags = inner.replace(/<[^>]*>/g, ' ')
  // Text inside braces is an expression, which may well be words -- it is not something this can read, so it counts.
  if (/\{/.test(withoutTags)) return true
  return /[A-Za-z]{2,}/.test(withoutTags)
}

test('every button says what it does, by its words or by a label', () => {
  const bad: string[] = []
  for (const file of FILES) {
    for (const button of tags(file.text, 'button')) {
      if (named(button.attrs) || hasWords(button.inner)) continue
      bad.push(`${file.path}: <button${button.attrs.slice(0, 70)}>`)
    }
  }
  assert.deepEqual(bad, [], `these buttons have no name at all; a screen reader reads them as "button"`)
})

test('every dialog says which dialog it is', () => {
  const bad: string[] = []
  for (const file of FILES) {
    // The shared dialog is where `role="dialog"` is allowed to live without a name beside it in the source: it
    // takes a REQUIRED `label` and writes `aria-label` or `aria-labelledby` from it, so there is no way to render
    // an unnamed one. That is checked separately below, and it is a stronger promise than this search can make --
    // which is the point, because the moment a screen uses the shared dialog this search stops seeing it at all.
    if (file.path.endsWith('ui\\Modal.tsx') || file.path.endsWith('ui/Modal.tsx')) continue
    for (const match of file.text.matchAll(/role="dialog"/g)) {
      // The label may be before or after role= on the same tag, so the whole tag is looked at.
      const start = file.text.lastIndexOf('<', match.index ?? 0)
      const end = file.text.indexOf('>', match.index ?? 0)
      const tag = file.text.slice(start, end)
      /*
       * Only a real tag. Searching raw text cannot tell markup from prose, and it found these words inside a
       * COMMENT explaining why a dialog stays a dialog -- then walked back to the nearest `<`, which was a
       * TypeScript generic several hundred lines earlier, and reported the function it landed in. A tag has no
       * `>` inside it, so anything with one between the bracket and the match is not one.
       */
      if (tag.includes('>')) continue
      if (!named(tag)) bad.push(`${file.path}: ${tag.slice(0, 90)}`)
    }
  }
  assert.deepEqual(bad, [], 'a dialog with no name is announced only as "dialog"')
})

test('the shared dialog cannot be rendered without a name', () => {
  /*
   * The promise the search above can no longer make.
   *
   * A grep over the screen files worked only while every dialog was written out by hand. As screens move onto the
   * shared one, `role="dialog"` disappears from them and that search quietly covers less and less until it covers
   * nothing -- a guard that passes because it has stopped looking. So the promise moves here: the shared dialog
   * takes a required name and always writes it out, and this reads the component to check both halves.
   */
  const modal = FILES.find((file) => file.path.endsWith('ui\\Modal.tsx') || file.path.endsWith('ui/Modal.tsx'))
  assert.ok(modal, 'the shared dialog is gone; every dialog is hand-written again and the search above is the guard')
  assert.match(modal.text, /label: string/, 'the shared dialog takes no name')
  assert.ok(!/label\?: string/.test(modal.text), 'the name is optional, so a dialog can be rendered without one')
  assert.match(modal.text, /aria-label/, 'the name is taken and never written out')
  assert.match(modal.text, /aria-labelledby/, 'a dialog with a heading does not point at it')
})

test('every text field can be named without looking at what is beside it', () => {
  const bad: string[] = []
  // Counted, so a scanner that silently stopped finding fields cannot make this test pass by checking nothing.
  let checked = 0
  for (const file of FILES) {
    for (const field of [...tags(file.text, 'input'), ...tags(file.text, 'textarea'), ...tags(file.text, 'select')]) {
      if (/type="(hidden|checkbox|radio|range|color|file)"/.test(field.attrs)) continue
      // Only fields that lean on a placeholder. A field wrapped in its own <label> is named by it, which is the
      // common case here and is correct; a placeholder is not a name, because it disappears the moment you type.
      if (!/placeholder[=\s]/.test(field.attrs)) continue
      checked++
      if (named(field.attrs) || labelledElsewhere(file.text, field.attrs, field.at)) continue
      bad.push(`${file.path}: ${field.attrs.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  assert.ok(checked > 10, `only ${checked} fields with a placeholder were found; the scanner is not reading them`)
  assert.deepEqual(bad, [], 'a field with a placeholder and no label is named only while it is empty')
})

test('nothing is hidden from a screen reader while still being usable by the keyboard', () => {
  const bad: string[] = []
  for (const file of FILES) {
    for (const match of file.text.matchAll(/aria-hidden="true"/g)) {
      const start = file.text.lastIndexOf('<', match.index ?? 0)
      const end = file.text.indexOf('>', match.index ?? 0)
      const tag = file.text.slice(start, end)
      if (/^<(button|a|input|select|textarea)\b/.test(tag)) bad.push(`${file.path}: ${tag.slice(0, 80)}`)
    }
  }
  assert.deepEqual(bad, [], 'these can be reached by Tab and say nothing when they are')
})

test('motion respects the setting rather than being switched off by hand in each place', () => {
  // Not a rule about any one file: it checks the setting exists and is honoured somewhere, so a new animation has a
  // place to ask. The individual screens are verified by running them.
  const honoured = FILES.filter((one) => /reduceMotion|prefers-reduced-motion/.test(one.text))
  assert.ok(honoured.length > 0, 'nothing in the window reads the reduced-motion setting')
})
