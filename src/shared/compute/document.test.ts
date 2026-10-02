import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOCUMENT_ASSUMPTIONS,
  DOCUMENT_LIMITS,
  analyse,
  assignSections,
  blockText,
  checkCitations,
  decodeEntities,
  diffDocuments,
  emptyDocument,
  formatCitation,
  fromHtml,
  fromMarkdown,
  inlineText,
  insertBlock,
  isDocumentError,
  isRuledRow,
  moveBlock,
  moveSection,
  numbering,
  outlineOf,
  parseInline,
  splitRow,
  removeBlock,
  replaceAll,
  resolveReferences,
  resolveVariables,
  safeHref,
  search,
  text,
  toMarkdown,
  transformText,
  validateAgainst,
  variablesUsed,
  wrapLines,
  type Source,
  type StructuredDocument
} from './document.ts'

/** A document from Markdown, or a thrown assertion. Every test wants the document, not the union. */
const doc = (markdown: string, id = 'd1'): StructuredDocument => {
  const parsed = fromMarkdown(markdown)
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  return assignSections({ ...emptyDocument(id), blocks: parsed.blocks })
}

describe('inline parsing', () => {
  test('marks apply to the run between them', () => {
    const runs = parseInline('plain **bold** plain')
    assert.equal(runs.length, 3)
    assert.deepEqual(runs[1], text('bold', ['bold']))
    assert.deepEqual((runs[0] as { marks: string[] }).marks, [])
  })

  test('overlapping marks both apply to the run they cover', () => {
    // Well-formed: an ending marker comes directly after the words it ends. `* **` with a space before it is not one.
    const runs = parseInline('**bold *and italic***')
    const both = runs.find((one) => one.kind === 'text' && one.text.includes('and italic'))
    assert.ok(both && both.kind === 'text')
    assert.ok(both.marks.includes('bold'))
    assert.ok(both.marks.includes('italic'))
  })

  test('a code span takes its contents literally', () => {
    const runs = parseInline('use `a ** b` here')
    const code = runs.find((one) => one.kind === 'text' && one.marks.includes('code'))
    assert.ok(code && code.kind === 'text')
    assert.equal(code.text, 'a ** b')
  })

  test('a backslash escapes the character after it', () => {
    const runs = parseInline('literal \\*asterisk\\*')
    assert.equal(inlineText(runs), 'literal *asterisk*')
  })

  test('a link keeps its target and says whether it points inside the document', () => {
    const runs = parseInline('see [the section](#intro) and [a site](https://example.com)')
    const links = runs.filter((one) => one.kind === 'link')
    assert.equal(links.length, 2)
    assert.equal(links[0].kind === 'link' && links[0].internal, true)
    assert.equal(links[1].kind === 'link' && links[1].internal, false)
  })

  test('maths is kept as source, never as a rendered picture', () => {
    const runs = parseInline('the value $E = mc^2$ here')
    const math = runs.find((one) => one.kind === 'math')
    assert.ok(math && math.kind === 'math')
    assert.equal(math.source, 'E = mc^2')
  })

  test('a footnote marker becomes a run rather than literal text', () => {
    const runs = parseInline('a claim[^1] follows')
    assert.ok(runs.some((one) => one.kind === 'footnote' && one.noteId === '1'))
  })

  test('a reference contributes no text, because its text is computed', () => {
    assert.equal(inlineText([{ kind: 'reference', targetId: 'fig1', as: 'figure' }]), '')
  })
})

describe('Markdown import', () => {
  test('headings keep their level', () => {
    const document = doc('# One\n\n## Two\n\n### Three')
    assert.deepEqual(
      document.blocks.map((one) => (one.kind === 'heading' ? one.level : null)),
      [1, 2, 3]
    )
  })

  test('a fenced code block keeps its language and its exact contents', () => {
    const document = doc('```js\nconst a = 1\n  indented\n```')
    const block = document.blocks[0]
    assert.equal(block.kind, 'code')
    assert.ok(block.kind === 'code')
    assert.equal(block.language, 'js')
    assert.equal(block.source, 'const a = 1\n  indented')
  })

  test('a longer fence is not closed by a shorter one inside it', () => {
    const document = doc('````\n```\nstill inside\n```\n````')
    const block = document.blocks[0]
    assert.ok(block.kind === 'code')
    assert.match(block.source, /still inside/)
  })

  test('an unclosed fence is reported rather than silently swallowing the rest', () => {
    const parsed = fromMarkdown('```\nnever closed')
    assert.ok(!isDocumentError(parsed))
    assert.ok(parsed.notes.some((one) => /never closed/.test(one)))
  })

  test('a table needs its separator row, so a paragraph full of pipes stays a paragraph', () => {
    const table = doc('| a | b |\n| --- | --- |\n| 1 | 2 |')
    assert.equal(table.blocks[0].kind, 'table')
    const paragraph = doc('this | that | other')
    assert.equal(paragraph.blocks[0].kind, 'paragraph')
  })

  test('table alignment markers are read', () => {
    const document = doc('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |')
    const block = document.blocks[0]
    assert.ok(block.kind === 'table')
    assert.deepEqual(block.rows[0].map((one) => one.align), ['left', 'center', 'right'])
  })

  test('a task list keeps which items are done', () => {
    const document = doc('- [x] done\n- [ ] not done')
    const block = document.blocks[0]
    assert.ok(block.kind === 'list')
    assert.equal(block.style, 'task')
    assert.deepEqual(block.items.map((one) => one.checked), [true, false])
  })

  test('nesting depth is kept for indented list items', () => {
    const document = doc('- top\n  - nested\n    - deeper')
    const block = document.blocks[0]
    assert.ok(block.kind === 'list')
    assert.deepEqual(block.items.map((one) => one.depth), [0, 1, 2])
  })

  test('a quote spanning several lines becomes one block', () => {
    const document = doc('> first\n> second')
    assert.equal(document.blocks.length, 1)
    assert.equal(blockText(document.blocks[0]), 'first second')
  })

  test('anything unrecognised becomes a paragraph rather than being dropped', () => {
    const document = doc('some text that is not any construct at all')
    assert.equal(document.blocks.length, 1)
    assert.equal(document.blocks[0].kind, 'paragraph')
  })

  test('an import past the size ceiling is refused with the ceiling named', () => {
    const parsed = fromMarkdown('a'.repeat(DOCUMENT_LIMITS.textLength + 1))
    assert.ok(isDocumentError(parsed))
    assert.equal(parsed.error, 'too-large')
  })

  test('a round trip through Markdown means the same thing', () => {
    const source = '# Title\n\nA **bold** and *italic* paragraph.\n\n- one\n- two\n\n```js\ncode()\n```'
    const first = doc(source)
    const second = doc(toMarkdown(first))
    assert.deepEqual(
      first.blocks.map((one) => one.kind),
      second.blocks.map((one) => one.kind)
    )
    assert.deepEqual(first.blocks.map(blockText), second.blocks.map(blockText))
  })
})

describe('HTML import', () => {
  test('a script tag and its contents are removed entirely', () => {
    const imported = fromHtml('<p>before</p><script>alert(1)</script><p>after</p>')
    assert.ok(!isDocumentError(imported))
    const body = imported.blocks.map(blockText).join(' ')
    assert.doesNotMatch(body, /alert/)
    assert.match(body, /before/)
    assert.match(body, /after/)
    assert.ok(imported.removed.some((one) => one.tag === 'script'))
  })

  test('an unclosed script tag still takes everything after it', () => {
    const imported = fromHtml('<p>ok</p><script>alert(1)')
    assert.ok(!isDocumentError(imported))
    assert.doesNotMatch(imported.blocks.map(blockText).join(' '), /alert/)
  })

  test('style, iframe and object are removed too', () => {
    const imported = fromHtml('<style>.a{}</style><iframe src="x"></iframe><object data="y"></object><p>kept</p>')
    assert.ok(!isDocumentError(imported))
    assert.equal(imported.blocks.filter((one) => blockText(one).trim() !== '').length, 1)
    for (const tag of ['style', 'iframe', 'object']) {
      assert.ok(imported.removed.some((one) => one.tag === tag), tag)
    }
  })

  test('marks survive but their tags do not', () => {
    const imported = fromHtml('<p>a <strong>bold</strong> word</p>')
    assert.ok(!isDocumentError(imported))
    const block = imported.blocks[0]
    assert.ok(block.kind === 'paragraph')
    const bold = block.content.find((one) => one.kind === 'text' && one.marks.includes('bold'))
    assert.ok(bold && bold.kind === 'text' && bold.text === 'bold')
  })

  test('a javascript link is dropped rather than kept as a link', () => {
    const imported = fromHtml('<p><a href="javascript:alert(1)">click</a></p>')
    assert.ok(!isDocumentError(imported))
    assert.ok(!imported.blocks.some((block) => block.kind === 'paragraph' && block.content.some((one) => one.kind === 'link')))
    assert.ok(imported.removed.some((one) => one.tag === 'unsafe-href'))
  })

  test('an ordinary link survives with its target', () => {
    const imported = fromHtml('<p><a href="https://example.com">site</a></p>')
    assert.ok(!isDocumentError(imported))
    const block = imported.blocks[0]
    assert.ok(block.kind === 'paragraph')
    const link = block.content.find((one) => one.kind === 'link')
    assert.ok(link && link.kind === 'link')
    assert.equal(link.href, 'https://example.com')
  })

  test('an unknown tag contributes its text and is counted as removed', () => {
    const imported = fromHtml('<p>a <custom-thing>kept</custom-thing> b</p>')
    assert.ok(!isDocumentError(imported))
    assert.match(blockText(imported.blocks[0]), /a kept b/)
    assert.ok(imported.removed.some((one) => one.tag === 'custom-thing'))
  })

  test('text outside any block tag becomes a paragraph rather than being lost', () => {
    const imported = fromHtml('loose text<p>in a block</p>')
    assert.ok(!isDocumentError(imported))
    assert.ok(imported.blocks.some((one) => blockText(one).includes('loose text')))
  })

  test('a table keeps its cells, its headers and its spans', () => {
    const imported = fromHtml('<table><tr><th colspan="2">Head</th></tr><tr><td>a</td><td>b</td></tr></table>')
    assert.ok(!isDocumentError(imported))
    const block = imported.blocks[0]
    assert.ok(block.kind === 'table')
    assert.equal(block.rows[0][0].header, true)
    assert.equal(block.rows[0][0].colSpan, 2)
    assert.equal(block.rows[1].length, 2)
  })

  test('a comment cannot smuggle an unbalanced tag through', () => {
    const imported = fromHtml('<!-- <script> --><p>fine</p>')
    assert.ok(!isDocumentError(imported))
    assert.equal(blockText(imported.blocks[0]), 'fine')
  })

  test('what was removed is reported, so an import is not silently lossy', () => {
    const imported = fromHtml('<script>x</script><p>a</p>')
    assert.ok(!isDocumentError(imported))
    assert.ok(imported.notes.some((one) => /anything executable, is dropped/.test(one)))
  })

  test('entities are decoded, including numeric ones, but a surrogate half is left alone', () => {
    assert.equal(decodeEntities('a &amp; b &lt;c&gt;'), 'a & b <c>')
    assert.equal(decodeEntities('&#65;&#x42;'), 'AB')
    assert.equal(decodeEntities('&#xD800;'), '&#xD800;')
    assert.equal(decodeEntities('&notanentity;'), '&notanentity;')
  })

  test('a link scheme is checked after control characters are stripped', () => {
    assert.equal(safeHref('https://example.com'), true)
    assert.equal(safeHref('#section'), true)
    assert.equal(safeHref('/relative'), true)
    assert.equal(safeHref('mailto:a@b.c'), true)
    assert.equal(safeHref('javascript:alert(1)'), false)
    assert.equal(safeHref('JaVaScRiPt:alert(1)'), false)
    assert.equal(safeHref('java\nscript:alert(1)'), false)
    assert.equal(safeHref('data:text/html,<script>'), false)
  })
})

describe('outline and numbering', () => {
  const document = (): StructuredDocument => doc('# One\n\npara\n\n## One A\n\npara\n\n## One B\n\n# Two\n\n## Two A')

  test('the outline is a tree with numbers computed from position', () => {
    const outline = outlineOf(document())
    assert.equal(outline.length, 2)
    assert.equal(outline[0].number, '1')
    assert.equal(outline[0].children[0].number, '1.1')
    assert.equal(outline[0].children[1].number, '1.2')
    assert.equal(outline[1].number, '2')
    assert.equal(outline[1].children[0].number, '2.1')
  })

  test('a section counts the blocks under it, including those in its subsections', () => {
    const outline = outlineOf(document())
    // "One" holds a paragraph, two subheadings and a paragraph.
    assert.equal(outline[0].blockCount, 4)
    assert.equal(outline[0].children[0].blockCount, 1)
  })

  test('inserting a heading renumbers everything after it, because nothing stored the number', () => {
    const before = outlineOf(document())
    assert.equal(before[1].number, '2')
    const inserted = insertBlock(document(), { id: 'new', sectionId: '', kind: 'heading', level: 1, content: [text('Inserted')] }, 0)
    assert.ok(!isDocumentError(inserted))
    const after = outlineOf(inserted.document)
    assert.equal(after[0].title, 'Inserted')
    assert.equal(after[1].number, '2')
    assert.equal(after[2].number, '3')
  })

  test('each block knows the section it sits in', () => {
    const assigned = document()
    const paragraphs = assigned.blocks.filter((one) => one.kind === 'paragraph')
    assert.ok(paragraphs.every((one) => one.sectionId !== ''))
    assert.notEqual(paragraphs[0].sectionId, paragraphs[1].sectionId)
  })

  test('figures, tables and equations number separately', () => {
    const document2: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [
        { id: 'i1', sectionId: '', kind: 'image', source: 'a.png', alt: 'a', caption: '', label: '' },
        { id: 't1', sectionId: '', kind: 'table', columns: 1, rows: [], caption: '', label: '' },
        { id: 'i2', sectionId: '', kind: 'image', source: 'b.png', alt: 'b', caption: '', label: '' },
        { id: 'e1', sectionId: '', kind: 'equation', source: 'x=1', label: '' }
      ]
    }
    const numbered = numbering(document2)
    assert.deepEqual(
      numbered.map((one) => [one.as, one.number]),
      [['figure', 1], ['table', 1], ['figure', 2], ['equation', 1]]
    )
  })

  test('a reference resolves to the text it should display, and moving the target changes it', () => {
    const base: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [
        { id: 'i1', sectionId: '', kind: 'image', source: 'a.png', alt: 'a', caption: '', label: '' },
        { id: 'i2', sectionId: '', kind: 'image', source: 'b.png', alt: 'b', caption: '', label: '' },
        { id: 'p', sectionId: '', kind: 'paragraph', content: [text('see '), { kind: 'reference', targetId: 'i2', as: 'figure' }] }
      ]
    }
    assert.equal(resolveReferences(base).runsTo[0].display, 'Figure 2')
    const moved = moveBlock(base, 'i2', 0)
    assert.ok(!isDocumentError(moved))
    assert.equal(resolveReferences(moved.document).runsTo[0].display, 'Figure 1')
  })

  test('a reference to something that is not there is reported as broken', () => {
    const base: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [{ id: 'p', sectionId: '', kind: 'paragraph', content: [{ kind: 'reference', targetId: 'gone', as: 'figure' }] }]
    }
    assert.deepEqual(resolveReferences(base).broken, [{ blockId: 'gone', as: 'figure' }])
  })
})

describe('citations', () => {
  const source: Source = {
    id: 's1',
    title: 'A Paper',
    authors: ['Rao, S.'],
    year: '2024',
    publisher: 'A Journal',
    url: 'https://example.com',
    accessed: '',
    kind: 'article'
  }

  test('each style formats from what the source actually holds', () => {
    assert.match(formatCitation(source, 'apa'), /Rao, S\. \(2024\)\. A Paper\./)
    assert.match(formatCitation(source, 'mla'), /"A Paper\."/)
    assert.match(formatCitation(source, 'ieee', 3), /^\[3\]/)
    assert.match(formatCitation(source, 'chicago'), /A Journal 2024\./)
  })

  test('a missing field is left out rather than filled in', () => {
    const thin: Source = { ...source, year: '', publisher: '', url: '' }
    const formatted = formatCitation(thin, 'apa')
    assert.equal(formatted, 'Rao, S. A Paper.')
    assert.doesNotMatch(formatted, /n\.d\.|Unknown|undefined/)
  })

  test('a citation pointing at a source that is not in the list is reported', () => {
    const document = {
      ...emptyDocument('d'),
      blocks: [{ id: 'p', sectionId: '', kind: 'paragraph' as const, content: [{ kind: 'citation' as const, sourceId: 'missing', locator: '' }] }]
    }
    assert.deepEqual(checkCitations(document, [source]).missing, ['missing'])
  })

  test('a source nothing cites is reported too', () => {
    const document = emptyDocument('d')
    assert.deepEqual(checkCitations(document, [source]).uncited, ['s1'])
  })

  test('an incomplete source names the fields it is missing', () => {
    const thin: Source = { ...source, authors: [], year: '' }
    const problems = checkCitations(emptyDocument('d'), [thin])
    assert.deepEqual(problems.incomplete[0].fields.sort(), ['author', 'year'])
  })
})

describe('searching', () => {
  const document = (): StructuredDocument => doc('# Heading about cats\n\nA paragraph about cats and dogs.\n\n## Another\n\nMore cats.')

  test('matches carry the block and the offsets inside it', () => {
    const matches = search(document(), 'cats')
    assert.ok(!isDocumentError(matches))
    assert.equal(matches.length, 3)
    assert.ok(matches.every((one) => one.start >= 0 && one.end > one.start))
  })

  test('case sensitivity is honoured', () => {
    const insensitive = search(document(), 'CATS')
    const sensitive = search(document(), 'CATS', { caseSensitive: true })
    assert.ok(!isDocumentError(insensitive) && !isDocumentError(sensitive))
    assert.equal(insensitive.length, 3)
    assert.equal(sensitive.length, 0)
  })

  test('whole word matching does not match inside a longer word', () => {
    const document2 = doc('cat category cats')
    const partial = search(document2, 'cat')
    const whole = search(document2, 'cat', { wholeWord: true })
    assert.ok(!isDocumentError(partial) && !isDocumentError(whole))
    assert.equal(partial.length, 3)
    assert.equal(whole.length, 1)
  })

  test('an invalid regular expression is refused rather than thrown', () => {
    const matches = search(document(), '([', { regex: true })
    assert.ok(isDocumentError(matches))
    assert.equal(matches.error, 'invalid-pattern')
  })

  test('a pattern that matches nothing at all does not loop forever', () => {
    const matches = search(document(), 'x*', { regex: true, limit: 50 })
    assert.ok(!isDocumentError(matches))
    assert.equal(matches.length, 0)
  })

  test('search can be limited to sections', () => {
    const assigned = document()
    const second = assigned.blocks.find((one) => one.kind === 'heading' && inlineText(one.content) === 'Another')
    assert.ok(second)
    const matches = search(assigned, 'cats', { inSections: [second.id] })
    assert.ok(!isDocumentError(matches))
    assert.equal(matches.length, 1)
  })

  test('replace changes text runs and leaves link targets alone', () => {
    const base: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [
        {
          id: 'p',
          sectionId: '',
          kind: 'paragraph',
          content: [text('go to old'), { kind: 'link', text: 'old', href: 'https://old.example', marks: [], internal: false }]
        }
      ]
    }
    const result = replaceAll(base, 'old', 'new')
    assert.ok(!isDocumentError(result))
    assert.equal(result.replaced, 1)
    const block = result.document.blocks[0]
    assert.ok(block.kind === 'paragraph')
    assert.equal((block.content[0] as { text: string }).text, 'go to new')
    assert.equal((block.content[1] as { href: string }).href, 'https://old.example')
  })
})

describe('deterministic transforms', () => {
  test('case transforms are exactly what they say', () => {
    assert.equal(transformText('a b', { kind: 'upper' }), 'A B')
    assert.equal(transformText('A B', { kind: 'lower' }), 'a b')
    assert.equal(transformText('hello there world', { kind: 'title' }), 'Hello There World')
    assert.equal(transformText('one. two. three', { kind: 'sentence' }), 'One. Two. Three')
  })

  test('whitespace is normalised without joining separate paragraphs', () => {
    assert.equal(transformText('  a  \n\n\n\n  b  ', { kind: 'trim-whitespace' }), 'a\n\nb')
    assert.equal(transformText('a    b\tc', { kind: 'collapse-spaces' }), 'a b c')
  })

  test('sorting and deduplicating lines are exact operations', () => {
    assert.equal(transformText('c\na\nb', { kind: 'sort-lines', descending: false }), 'a\nb\nc')
    assert.equal(transformText('a\nb\nc', { kind: 'sort-lines', descending: true }), 'c\nb\na')
    assert.equal(transformText('a\nb\na\nb', { kind: 'deduplicate-lines' }), 'a\nb')
  })

  test('wrapping never breaks a word across lines', () => {
    const wrapped = wrapLines('aaaa bbbb cccc dddd', 10)
    for (const line of wrapped.split('\n')) assert.ok(line.length <= 10 || !line.includes(' '), line)
    assert.equal(wrapped.replace(/\n/g, ' '), 'aaaa bbbb cccc dddd')
  })
})

describe('variables and templates', () => {
  const template = (): StructuredDocument => doc('# Report by {{studentName}}\n\nRun on {{date}} with a result of {{result}}.')

  test('the variables a document uses are found by scanning it', () => {
    assert.deepEqual(variablesUsed(template()), ['date', 'result', 'studentName'])
  })

  test('supplied variables are replaced and reported', () => {
    const resolved = resolveVariables(template(), { studentName: 'Asha', date: '2026-01-02', result: '42' })
    assert.deepEqual(resolved.resolved, ['date', 'result', 'studentName'])
    assert.deepEqual(resolved.unresolved, [])
    assert.match(resolved.document.blocks.map(blockText).join(' '), /Report by Asha/)
  })

  test('an unresolved variable stays visible rather than becoming an empty space', () => {
    const resolved = resolveVariables(template(), { studentName: 'Asha' })
    assert.deepEqual(resolved.unresolved, ['date', 'result'])
    const body = resolved.document.blocks.map(blockText).join(' ')
    assert.match(body, /\{\{date\}\}/)
    assert.doesNotMatch(body, /Run on  with/)
  })

  test('a variable named constructor is a variable, not a lookup on Object.prototype', () => {
    const one = doc('value is {{constructor}}')
    const resolved = resolveVariables(one, {})
    assert.deepEqual(resolved.unresolved, ['constructor'])
    assert.match(blockText(resolved.document.blocks[0]), /\{\{constructor\}\}/)
  })
})

describe('validation', () => {
  const schema = {
    id: 'lab',
    name: 'Lab report',
    requiredSections: [
      { title: 'Method', describe: 'A lab report needs a method section.' },
      { title: 'Results', describe: 'A lab report needs a results section.' }
    ],
    requiredBlocks: [{ kind: 'table' as const, atLeast: 1, describe: 'A lab report needs at least one table of measurements.' }],
    requireCitations: false,
    requireTitle: true
  }

  test('a document that meets the schema passes', () => {
    const document = {
      ...doc('## Method\n\ndid things\n\n## Results\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'),
      metadata: { ...emptyDocument('d').metadata, title: 'A report' }
    }
    const result = validateAgainst(document, schema)
    assert.equal(result.ok, true)
    assert.deepEqual(result.missing, [])
  })

  test('what is actually absent is named, rather than a score being given', () => {
    const result = validateAgainst(doc('## Method\n\ndid things'), schema)
    assert.equal(result.ok, false)
    const what = result.missing.map((one) => one.what)
    assert.ok(what.includes('title'))
    assert.ok(what.some((one) => one.includes('Results')))
    assert.ok(what.some((one) => one.includes('table')))
  })

  test('a section that exists but is empty is a note, not something missing', () => {
    const document = {
      ...doc('## Method\n\n## Results\n\n| a |\n| --- |\n| 1 |'),
      metadata: { ...emptyDocument('d').metadata, title: 'A report' }
    }
    const result = validateAgainst(document, schema)
    assert.ok(result.notes.some((one) => /heading but nothing under it/.test(one)))
    assert.ok(!result.missing.some((one) => one.what.includes('Method')))
  })

  test('required citations are checked against the source list', () => {
    const withCitations = { ...schema, requireCitations: true }
    const result = validateAgainst(doc('# T\n\n## Method\n\n## Results'), withCitations)
    assert.ok(result.missing.some((one) => one.what === 'citations'))
  })
})

describe('analysis', () => {
  test('word counts are exact rather than a split on whitespace', () => {
    const document = doc("It's a well-known problem -- one nobody solved.")
    const result = analyse(document)
    // it's, a, well-known, problem, one, nobody, solved
    assert.equal(result.words, 7)
  })

  test('reading time is labelled an estimate with the rate it used', () => {
    const document = doc(Array.from({ length: 440 }, () => 'word').join(' '))
    const result = analyse(document, 220)
    assert.equal(result.readingMinutes.estimate, 2)
    assert.equal(result.readingMinutes.wordsPerMinute, 220)
    assert.match(result.readingMinutes.describe, /An estimate at 220 words a minute/)
  })

  test('a skipped heading level is reported with the reason it matters', () => {
    const result = analyse(doc('# One\n\n### Three'))
    const problem = result.problems.find((one) => one.kind === 'skipped-heading-level')
    assert.ok(problem)
    assert.match(problem.describe, /screen reader/)
  })

  test('an image with no alternative text is reported', () => {
    const document: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [{ id: 'i', sectionId: '', kind: 'image', source: 'a.png', alt: '', caption: '', label: '' }]
    }
    assert.ok(analyse(document).problems.some((one) => one.kind === 'missing-alt-text'))
  })

  test('an unsafe link that got into the model is reported by the analysis too', () => {
    const document: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [
        {
          id: 'p',
          sectionId: '',
          kind: 'paragraph',
          content: [{ kind: 'link', text: 'x', href: 'javascript:alert(1)', marks: [], internal: false }]
        }
      ]
    }
    assert.ok(analyse(document).problems.some((one) => one.kind === 'unsafe-link'))
  })

  test('blocks are counted by kind, so the shape of a document is answerable', () => {
    const result = analyse(doc('# H\n\npara\n\npara\n\n- a\n- b'))
    assert.equal(result.blocksByKind.paragraph, 2)
    assert.equal(result.blocksByKind.heading, 1)
    assert.equal(result.blocksByKind.list, 1)
  })

  test('an empty document has no reading time rather than a minute', () => {
    assert.equal(analyse(emptyDocument('d')).readingMinutes.estimate, 0)
  })
})

describe('editing', () => {
  const base = (): StructuredDocument => doc('# One\n\nalpha\n\n# Two\n\nbeta')

  test('a block is inserted at the position asked for', () => {
    const result = insertBlock(base(), { id: 'new', sectionId: '', kind: 'paragraph', content: [text('gamma')] }, 1)
    assert.ok(!isDocumentError(result))
    assert.equal(blockText(result.document.blocks[1]), 'gamma')
    assert.equal(result.event.kind, 'BLOCK_ADDED')
  })

  test('an out-of-range position is clamped rather than refused', () => {
    const result = insertBlock(base(), { id: 'new', sectionId: '', kind: 'paragraph', content: [text('end')] }, 9999)
    assert.ok(!isDocumentError(result))
    assert.equal(blockText(result.document.blocks[result.document.blocks.length - 1]), 'end')
  })

  test('a duplicate id is refused', () => {
    const document = base()
    const existing = document.blocks[0]
    assert.ok(isDocumentError(insertBlock(document, { ...existing }, 0)))
  })

  test('removing a block warns about what referred to it', () => {
    const document: StructuredDocument = {
      ...emptyDocument('d'),
      blocks: [
        { id: 'i1', sectionId: '', kind: 'image', source: 'a.png', alt: 'a', caption: '', label: '' },
        { id: 'p', sectionId: '', kind: 'paragraph', content: [{ kind: 'reference', targetId: 'i1', as: 'figure' }] }
      ]
    }
    const result = removeBlock(document, 'i1')
    assert.ok(!isDocumentError(result))
    assert.deepEqual(result.breaks, ['p'])
  })

  test('moving a section takes everything under it', () => {
    const result = moveSection(base(), base().blocks[2].id, 0)
    assert.ok(!isDocumentError(result))
    assert.equal(inlineText((result.document.blocks[0] as unknown as { content: never[] }).content), 'Two')
    assert.equal(blockText(result.document.blocks[1]), 'beta')
    assert.match(result.event.describe, /taking 1 block/)
  })

  test('moving a block to where it already is changes nothing', () => {
    const document = base()
    const result = moveBlock(document, document.blocks[0].id, 0)
    assert.ok(!isDocumentError(result))
    assert.deepEqual(result.document.blocks.map((one) => one.id), document.blocks.map((one) => one.id))
  })

  test('a block that is not there cannot be moved or removed', () => {
    assert.ok(isDocumentError(moveBlock(base(), 'nope', 0)))
    assert.ok(isDocumentError(removeBlock(base(), 'nope')))
  })
})

describe('diff', () => {
  const before = (): StructuredDocument => doc('# One\n\nalpha\n\nbeta\n\ngamma')

  test('a moved block reads as moved, not as a delete and an add', () => {
    const start = before()
    const moved = moveBlock(start, start.blocks[3].id, 1)
    assert.ok(!isDocumentError(moved))
    const difference = diffDocuments(start, moved.document)
    const change = difference.changes.find((one) => one.blockId === start.blocks[3].id)
    assert.equal(change?.kind, 'moved')
    assert.match(change?.describe ?? '', /with its content unchanged/)
    assert.equal(difference.changes.filter((one) => one.kind === 'removed').length, 0)
  })

  test('an edited block reads as changed', () => {
    const start = before()
    const after: StructuredDocument = {
      ...start,
      blocks: start.blocks.map((one) => (one.id === start.blocks[1].id ? { ...one, kind: 'paragraph' as const, content: [text('edited')] } : one))
    }
    const difference = diffDocuments(start, after)
    assert.equal(difference.changes.find((one) => one.blockId === start.blocks[1].id)?.kind, 'changed')
  })

  test('adds and removes are both reported', () => {
    const start = before()
    const inserted = insertBlock(start, { id: 'new', sectionId: '', kind: 'paragraph', content: [text('delta')] }, 1)
    assert.ok(!isDocumentError(inserted))
    const removed = removeBlock(inserted.document, start.blocks[2].id)
    assert.ok(!isDocumentError(removed))
    const difference = diffDocuments(start, removed.document)
    assert.equal(difference.changes.filter((one) => one.kind === 'added').length, 1)
    assert.equal(difference.changes.filter((one) => one.kind === 'removed').length, 1)
    assert.match(difference.summary, /1 added, 1 removed/)
  })

  test('two identical documents have nothing to report', () => {
    assert.equal(diffDocuments(before(), before()).summary, 'Nothing changed.')
  })
})

describe('the assumptions are stated', () => {
  test('the list names what the engine does and refuses to do', () => {
    assert.ok(DOCUMENT_ASSUMPTIONS.length >= 7)
    assert.ok(DOCUMENT_ASSUMPTIONS.some((one) => /allow-list/.test(one)))
    assert.ok(DOCUMENT_ASSUMPTIONS.some((one) => /computed from position/.test(one)))
    assert.ok(DOCUMENT_ASSUMPTIONS.some((one) => /never filled in/.test(one)))
  })
})

test('a numbered list is written counting up at each depth, and reads back as the same list', () => {
  const parsed = fromMarkdown('1. First\n1. Second\n  1. Inner one\n  1. Inner two\n1. Third\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  const document = emptyDocument('d', 'Numbered')
  document.blocks = parsed.blocks
  const written = toMarkdown(document)
  assert.ok(written.includes('1. First\n2. Second\n  1. Inner one\n  2. Inner two\n3. Third'), written)
  const again = fromMarkdown(written, 'b')
  if (isDocumentError(again)) throw new Error(again.message)
  assert.deepEqual(again.blocks.map((one) => one.kind), parsed.blocks.map((one) => one.kind))
  const items = (blocks: typeof parsed.blocks): number => blocks.reduce((n, one) => n + (one.kind === 'list' ? one.items.length : 0), 0)
  assert.equal(items(again.blocks), 5)
})

test('a picture on a line of its own is a figure with its caption, and reads back as the same blocks it was written with', () => {
  const parsed = fromMarkdown('# Report\n\nWords before.\n![Energy by site](artifact:artifact_0123456789abcdef0123456789abcdef)\n\n*Energy by site, October*\n\nWords after, with an ![inline](https://example.com/x.png) picture that stays in its sentence.\n', 'b')
  if (isDocumentError(parsed)) throw new Error(parsed.message)
  assert.deepEqual(parsed.blocks.map((one) => one.kind), ['heading', 'paragraph', 'image', 'paragraph'])
  const figure = parsed.blocks[2]
  if (figure.kind !== 'image') throw new Error('not a figure')
  assert.equal(figure.source, 'artifact:artifact_0123456789abcdef0123456789abcdef')
  assert.equal(figure.alt, 'Energy by site')
  assert.equal(figure.caption, 'Energy by site, October')

  const document = emptyDocument('d', 'Report')
  document.blocks = parsed.blocks
  const again = fromMarkdown(toMarkdown(document), 'b')
  if (isDocumentError(again)) throw new Error(again.message)
  assert.deepEqual(again.blocks.map((one) => one.kind), ['heading', 'paragraph', 'image', 'paragraph'])
  const back = again.blocks[2]
  assert.ok(back.kind === 'image' && back.caption === 'Energy by site, October' && back.source === figure.source)
})

describe('a marker is emphasis only where it can be', () => {
  const plain = (source: string): void => {
    const runs = parseInline(source)
    assert.equal(inlineText(runs), source, source)
    assert.ok(runs.every((one) => one.kind !== 'text' || one.marks.length === 0), `${source} has no emphasis in it`)
  }

  test('an underscore inside a word is an underscore', () => {
    plain('the file_name and other_name are snake_case_words')
    plain('Use the token ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6 to push.')
    plain('read my_object.some_field and the_other__one')
    // A name wrapped in double underscores IS bold in Markdown, here as everywhere; a code span is how it is kept.
    assert.deepEqual(parseInline('call `__init__` first'), [text('call '), text('__init__', ['code']), text(' first')])
  })

  test('a star with a space after it, or with nothing to end it, is a star', () => {
    plain('2 * 3 * 4 = 24')
    plain('5 stars * and one more')
    plain('*unclosed at the start')
    plain('ends with a star*')
    plain('a ** b is a to the power b')
    plain('if (a==b && c==d) then x~~y')
    plain('rated 4* by most, 5* by some')
  })

  test('real emphasis still reads as emphasis, with either marker', () => {
    assert.deepEqual(parseInline('*one* and _two_ and **three** and __four__'), [
      text('one', ['italic']),
      text(' and '),
      text('two', ['italic']),
      text(' and '),
      text('three', ['bold']),
      text(' and '),
      text('four', ['bold'])
    ])
    assert.deepEqual(parseInline('~~gone~~ and ==marked=='), [text('gone', ['strike']), text(' and '), text('marked', ['highlight'])])
    const mixed = parseInline('***both***')
    assert.deepEqual(mixed, [text('both', ['bold', 'italic'])])
    const inside = parseInline('*the snake_case name*')
    assert.deepEqual(inside, [text('the snake_case name', ['italic'])], 'an underscore inside italics made with stars is still an underscore')
  })

  test('one stray marker does not change the style of what follows it', () => {
    const runs = parseInline('3 * 4 is twelve, and *this* is italic')
    assert.equal(inlineText(runs), '3 * 4 is twelve, and this is italic')
    assert.deepEqual(runs.filter((one) => one.kind === 'text' && one.marks.includes('italic')).map((one) => (one as { text: string }).text), ['this'])
    const stray = parseInline('*opened and never closed, with a `code *star*` after')
    assert.equal(inlineText(stray), '*opened and never closed, with a code *star* after')
  })

  test('many stray markers are settled without reading the text over and over', () => {
    const source = Array.from({ length: 4000 }, (_, i) => `*w${i}`).join(' ')
    const started = Date.now()
    const runs = parseInline(source)
    assert.equal(inlineText(runs), source)
    assert.ok(Date.now() - started < 2000, 'bounded')
  })

  test('written back, emphasis goes round the words and never round the space beside them', () => {
    const document = emptyDocument('d', 'Spaces')
    document.blocks = [
      { id: 'p1', sectionId: '', kind: 'paragraph', content: [text('before'), text(' bold ', ['bold']), text('after'), text(' ', ['italic']), text('x_y', ['italic'])] }
    ]
    const written = toMarkdown(document)
    assert.equal(written.trim(), 'before **bold** after *x_y*')
    const again = fromMarkdown(written, 'b')
    if (isDocumentError(again)) throw new Error(again.message)
    const first = again.blocks[0]
    assert.ok(first.kind === 'paragraph')
    if (first.kind !== 'paragraph') return
    assert.equal(inlineText(first.content), 'before bold after x_y')
    assert.deepEqual(first.content.filter((one) => one.kind === 'text' && one.marks.includes('bold')).map((one) => (one as { text: string }).text), ['bold'])
  })
})

describe('an ending pairs with the nearest beginning, and programming prose is left alone', () => {
  const plainText = (source: string): void => {
    const runs = parseInline(source)
    assert.equal(inlineText(runs), source, source)
    assert.ok(runs.every((one) => one.kind !== 'text' || one.marks.length === 0), `${source} has no emphasis in it`)
  }
  const styled = (source: string, mark: 'italic' | 'bold'): string[] =>
    parseInline(source)
      .filter((one) => one.kind === 'text' && one.marks.includes(mark))
      .map((one) => (one as { text: string }).text)

  test('stars that are part of the code are stars', () => {
    plainText('Use *args and **kwargs')
    plainText('char *s, **argv')
    plainText('def f(*args, **kwargs):')
    plainText('2*3*4 is 24, and x**2 is x squared')
    plainText('a pointer **p and a pointer *q')
  })

  test('real emphasis after a stray marker is still emphasis, on the right words', () => {
    assert.deepEqual(styled('2*3 is *not* 5', 'italic'), ['not'])
    assert.equal(inlineText(parseInline('2*3 is *not* 5')), '2*3 is not 5')
    assert.deepEqual(styled('x**2 is **not** the same', 'bold'), ['not'])
    assert.equal(inlineText(parseInline('x**2 is **not** the same')), 'x**2 is not the same')
    assert.deepEqual(styled('**Warning: do *not* do this', 'italic'), ['not'])
    assert.equal(inlineText(parseInline('**Warning: do *not* do this')), '**Warning: do not do this')
    assert.deepEqual(styled('*a *b* c', 'italic'), ['b'])
    assert.equal(inlineText(parseInline('*a *b* c')), '*a b c')
  })

  test('a stray marker inside real emphasis keeps the emphasis round it', () => {
    const runs = parseInline('**bold with a *stray star** after')
    assert.equal(inlineText(runs), 'bold with a *stray star after')
    assert.deepEqual(runs.filter((one) => one.kind === 'text' && one.marks.includes('bold')).map((one) => (one as { text: string }).text), ['bold with a *stray star'])
    assert.equal(runs.some((one) => one.kind === 'text' && one.marks.includes('italic')), false)
  })

  test('two prices are two prices, and maths between dollar signs is still maths', () => {
    plainText('It costs $5 to $10 a month')
    plainText('a total of $12 000. June alone brought $3 000')
    plainText('between $1,200 and $1,800')
    const runs = parseInline('the area is $\\pi r^2$ exactly')
    assert.deepEqual(runs.map((one) => one.kind), ['text', 'math', 'text'])
  })

  test('many markers of every sort are settled in one pass', () => {
    const source = Array.from({ length: 3000 }, (_, i) => (i % 3 === 0 ? `*w${i}` : i % 3 === 1 ? `**w${i}` : `w${i}*`)).join(' ')
    const started = Date.now()
    const runs = parseInline(source)
    assert.ok(Date.now() - started < 1500, 'bounded')
    assert.ok(inlineText(runs).length > 0)
  })
})

describe('what is written reads back as what it was', () => {
  const paragraph = (content: ReturnType<typeof parseInline>): string => {
    const document = emptyDocument('d', 'T')
    document.blocks = [{ id: 'p', sectionId: '', kind: 'paragraph', content }]
    return toMarkdown(document).trim()
  }
  const back = (markdown: string): ReturnType<typeof parseInline> => {
    const read = fromMarkdown(markdown, 'b')
    if (isDocumentError(read)) throw new Error(read.message)
    const first = read.blocks[0]
    if (first.kind !== 'paragraph') throw new Error(first.kind)
    return first.content
  }

  test('text that would read back as emphasis is written so that it does not', () => {
    // A cell or a sentence that really holds stars: not italics, and not to become italics by being saved.
    for (const words of ['*args* and **kwargs**', 'a_b_ and _c_', 'costs $5$ flat', 'see [this](that) literally', '~~not struck~~ and ==not marked==', 'a \\ backslash and a ` tick']) {
      const written = paragraph([text(words)])
      const read = back(written)
      assert.equal(inlineText(read), words, written)
      assert.ok(read.every((one) => one.kind === 'text' && one.marks.length === 0), `${written} came back plain`)
    }
  })

  test('ordinary text is written with nothing added to it', () => {
    assert.equal(paragraph([text('The file_name and other_name, 2 * 3 * 4, and *args.')]), 'The file_name and other_name, 2 * 3 * 4, and *args.')
    assert.equal(paragraph([text('plain '), text('bold', ['bold']), text(' and snake_case')]), 'plain **bold** and snake_case')
  })

  test('a long run of space inside emphasis is written in no time at all', () => {
    const started = Date.now()
    const written = paragraph([text(`a${' \t'.repeat(60_000)}b`, ['bold'])])
    assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`)
    assert.ok(written.startsWith('**a'))
  })

  test('code with a fence inside it is fenced by a longer one, and reads back as one block', () => {
    const document = emptyDocument('d', 'T')
    const source = 'const md = `\n```js\nx\n```\n`'
    document.blocks = [{ id: 'c', sectionId: '', kind: 'code', language: 'javascript', source, showLineNumbers: false }]
    const written = toMarkdown(document)
    assert.ok(written.includes('````javascript'), written)
    const read = fromMarkdown(written, 'b')
    if (isDocumentError(read)) throw new Error(read.message)
    assert.equal(read.blocks.length, 1)
    assert.ok(read.blocks[0].kind === 'code' && read.blocks[0].source === source)
  })

  test('a table cell holding a bar or a line break stays one cell', () => {
    const document = emptyDocument('d', 'T')
    const cell = (value: string) => ({ content: [text(value)], colSpan: 1, rowSpan: 1, header: false, align: 'left' as const })
    document.blocks = [{ id: 't', sectionId: '', kind: 'table', columns: 2, caption: '', label: '', rows: [[cell('command'), cell('meaning')], [cell('ls | wc -l'), cell('count files')], [cell('a\nb'), cell('two lines')]] }]
    const written = toMarkdown(document)
    assert.ok(written.includes('ls \\| wc -l'), written)
    const read = fromMarkdown(written, 'b')
    if (isDocumentError(read)) throw new Error(read.message)
    const table = read.blocks[0]
    assert.ok(table.kind === 'table')
    if (table.kind !== 'table') return
    assert.deepEqual(table.rows.map((row) => row.map((one) => inlineText(one.content))), [['command', 'meaning'], ['ls | wc -l', 'count files'], ['a\nb', 'two lines']])
  })

  test('a row is split at its bars, an escaped bar is not one, and a ruled line is found without trying every way to share out its spaces', () => {
    assert.deepEqual(splitRow('| a | b \\| c | d |'), ['a', 'b | c', 'd'])
    assert.deepEqual(splitRow('a | b'), ['a', 'b'])
    assert.deepEqual(splitRow('| one<br>two | 3 |'), ['one\ntwo', '3'])
    assert.equal(isRuledRow('| --- | :---: | ---: |'), true)
    assert.equal(isRuledRow('---|---'), true)
    assert.equal(isRuledRow('| a | b |'), false)
    assert.equal(isRuledRow('just words'), false)
    const started = Date.now()
    assert.equal(isRuledRow(`${' '.repeat(200_000)}B,2`), false)
    assert.equal(isRuledRow(`${' \t'.repeat(100_000)}| x`), false)
    assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`)
  })
})
