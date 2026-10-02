import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument, fromMarkdown, isDocumentError, text, type Block, type Source, type StructuredDocument } from './document.ts'
import { escapeHtml, toHtml, toText } from './documentHtml.ts'

const fromMd = (source: string, title = 'Doc'): StructuredDocument => {
  const parsed = fromMarkdown(source, 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const doc = emptyDocument('d', title)
  doc.blocks = parsed.blocks
  return doc
}

// Built loosely on purpose: a union of twelve block shapes makes an Omit distribute into something no literal fits.
const block = (one: object): Block => ({ sectionId: '', ...one }) as unknown as Block

test('every block kind reaches the page -- a paragraph is not an empty line', () => {
  const doc = fromMd('# Title\n\nA paragraph with **bold** and *italic*.\n\n- one\n- two\n\n> a quote\n\n```js\nlet x = 1\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n---\n')
  const { html } = toHtml(doc)
  assert.match(html, /<h1[^>]*>Title<\/h1>/)
  assert.match(html, /<p[^>]*>A paragraph with <strong>bold<\/strong> and <em>italic<\/em>\.<\/p>/)
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/)
  assert.match(html, /<blockquote[^>]*><p>a quote<\/p><\/blockquote>/)
  assert.match(html, /<pre[^>]*><code class="language-js">let x = 1<\/code><\/pre>/)
  assert.match(html, /<table[^>]*>.*<th>a<\/th>.*<td>2<\/td>.*<\/table>/s)
  assert.match(html, /<hr/)
})

test('text is escaped everywhere, and a script-shaped paragraph stays text', () => {
  const doc = fromMd('<script>alert(1)</script> & "quotes"\n')
  const { html } = toHtml(doc)
  assert.equal(html.includes('<script>'), false)
  assert.ok(html.includes('&lt;script&gt;'))
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
})

test('a link with an address Orbis will not write is kept as text, and said so', () => {
  const doc = emptyDocument('d', 'Links')
  doc.blocks = [
    block({ id: 'p1', kind: 'paragraph', content: [{ kind: 'link', text: 'safe', href: 'https://example.org', marks: [], internal: false }] }),
    block({ id: 'p2', kind: 'paragraph', content: [{ kind: 'link', text: 'unsafe', href: 'javascript:alert(1)', marks: [], internal: false }] })
  ]
  const { html, notes } = toHtml(doc)
  assert.match(html, /<a href="https:\/\/example.org" rel="noopener noreferrer">safe<\/a>/)
  assert.equal(html.includes('javascript:'), false)
  assert.match(html, /<p id="p2">unsafe<\/p>/)
  assert.ok(notes.some((one) => /1 link/.test(one)))
})

test('figures and tables are numbered by position and references resolve to that number', () => {
  const doc = emptyDocument('d', 'Figures')
  doc.blocks = [
    block({ id: 'f1', kind: 'image', source: 'data:image/png;base64,AAAA', alt: 'first', caption: 'The first', label: 'fig-a' }),
    block({ id: 'f2', kind: 'image', source: 'https://example.org/x.png', alt: 'second', caption: 'The second', label: 'fig-b' }),
    block({ id: 't1', kind: 'table', columns: 1, rows: [[{ content: [text('x')], colSpan: 1, rowSpan: 1, header: true, align: 'left' }]], caption: 'Only table', label: 'tab' }),
    block({ id: 'p1', kind: 'paragraph', content: [text('See '), { kind: 'reference', targetId: 'f2', as: 'figure' }, text(' and '), { kind: 'reference', targetId: 't1', as: 'table' }, text(' and '), { kind: 'reference', targetId: 'nope', as: 'figure' }] })
  ]
  const { html, notes } = toHtml(doc)
  assert.match(html, /<strong>Figure 1\.<\/strong> The first/)
  assert.match(html, /<strong>Figure 2\.<\/strong> The second/)
  assert.match(html, /<strong>Table 1\.<\/strong> Only table/)
  assert.match(html, /<a class="ref" href="#f2">Figure 2<\/a>/)
  assert.match(html, /<a class="ref" href="#t1">Table 1<\/a>/)
  assert.match(html, /\[missing figure\]/)
  assert.ok(notes.some((one) => /1 reference points at nothing/.test(one)))

  // Move the second figure above the first and the numbers follow, because nothing stored them.
  doc.blocks = [doc.blocks[1], doc.blocks[0], doc.blocks[2], doc.blocks[3]]
  const again = toHtml(doc).html
  assert.match(again, /<strong>Figure 1\.<\/strong> The second/)
  assert.match(again, /<a class="ref" href="#f2">Figure 1<\/a>/)
})

test('for print, the page forbids every fetch and says how many web images became alt text', () => {
  const doc = emptyDocument('d', 'Print')
  doc.blocks = [block({ id: 'f1', kind: 'image', source: 'https://example.org/x.png', alt: 'remote', caption: '', label: '' })]
  const print = toHtml(doc, { forPrint: true })
  assert.match(print.html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"/)
  assert.ok(print.notes.some((one) => /1 image from the web/.test(one)))
  const screen = toHtml(doc)
  assert.equal(screen.html.includes('Content-Security-Policy'), false)
  assert.equal(screen.notes.length, 0)
})

test('footnotes are numbered in order of use and gathered at the end', () => {
  const doc = emptyDocument('d', 'Notes')
  doc.blocks = [
    block({ id: 'p1', kind: 'paragraph', content: [text('Claim'), { kind: 'footnote', noteId: 'n-b' }, text(' and claim'), { kind: 'footnote', noteId: 'n-a' }] }),
    block({ id: 'n1', kind: 'footnote', noteId: 'n-a', content: [text('The A note')] }),
    block({ id: 'n2', kind: 'footnote', noteId: 'n-b', content: [text('The B note')] })
  ]
  const { html } = toHtml(doc)
  assert.match(html, /<a href="#fn-1" id="fnref-1">1<\/a><\/sup> and claim<sup class="fn"><a href="#fn-2" id="fnref-2">2<\/a>/)
  assert.match(html, /<li id="fn-1">The B note/)
  assert.match(html, /<li id="fn-2">The A note/)
})

test('citations get a reference list only when the sources are given, and say so otherwise', () => {
  const doc = emptyDocument('d', 'Cited')
  doc.blocks = [block({ id: 'p1', kind: 'paragraph', content: [text('Known'), { kind: 'citation', sourceId: 's1', locator: 'p. 4' }] })]
  const sources: Source[] = [{ id: 's1', title: 'A paper', authors: ['Rao, S.'], year: '2024', publisher: 'J. Things', url: '', accessed: '', kind: 'article' }]
  const withSources = toHtml(doc, { sources })
  assert.match(withSources.html, /<sup class="cite"><a href="#source-1">\[1, p\. 4\]<\/a><\/sup>/)
  assert.match(withSources.html, /<section class="references">.*Rao, S\. \(2024\)\. A paper\. J\. Things\./s)
  assert.equal(withSources.notes.length, 0)
  const without = toHtml(doc)
  assert.match(without.html, /<sup class="cite unresolved">\[s1, p\. 4\]<\/sup>/)
  assert.equal(without.html.includes('class="references"'), false)
  assert.ok(without.notes.some((one) => /1 citation points at a source this document does not carry/.test(one)))
})

test('a title from metadata is written only when no top heading already carries it', () => {
  assert.match(toHtml(fromMd('Just a paragraph.\n', 'My Title')).html, /<h1 class="title">My Title<\/h1>/)
  assert.equal(toHtml(fromMd('# Real Heading\n\nText.\n', 'My Title')).html.includes('class="title"'), false)
  assert.match(toHtml(fromMd('x\n', 'A & B')).html, /<title>A &amp; B<\/title>/)
})

test('plain text keeps every paragraph and marks the structure', () => {
  const doc = fromMd('# Title\n\nFirst paragraph.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  const out = toText(doc)
  assert.match(out, /^Title\n=====\n/)
  assert.ok(out.includes('First paragraph.'))
  assert.ok(out.includes('- one\n- two'))
  assert.ok(out.includes('a\tb\n1\t2'))
})
