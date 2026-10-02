import {
  blockText,
  formatCitation,
  inlineRunsOf,
  numbering,
  outlineOf,
  resolveReferences,
  type Block,
  type CitationStyle,
  type Inline,
  type MarkKind,
  type OutlineEntry,
  type Source,
  type StructuredDocument,
  type TableCell
} from './document.ts'

/**
 * A document written as HTML, and as plain text.
 *
 * The one serialiser the document model was missing. `exportDocument` had a branch for every format but produced blank
 * lines for every block kind except headings in all of them but Markdown -- a file with the right size and the right
 * hash and nothing in it. This is what makes HTML, PDF and a readable text file possible.
 *
 * Three things are resolved before anything is written, because they are the things a stored document cannot hold:
 *
 *   - **Numbers.** "Figure 3" is computed from position by `numbering`, never stored, so moving a figure renumbers it.
 *   - **References.** A reference run becomes the text `resolveReferences` says it should show, or a visible marker
 *     saying it points at nothing. A broken reference is never silently dropped.
 *   - **Footnotes and citations.** Numbered in order of first use, with the notes gathered at the end. A citation's
 *     source has to be *given*; a document does not carry its sources, and a bibliography is never invented.
 *
 * Nothing here is a model's HTML. The blocks were already read through an allow-list, and every string that reaches the
 * page goes through `escape`. There is no script in the output and no way to put one there.
 */

export interface HtmlOptions {
  /** The sources cited, so a bibliography can be written. Absent means citations are shown by id with a note. */
  sources?: readonly Source[]
  style?: CitationStyle
  /**
   * For the print path. Adds a content-security-policy that forbids every fetch -- an image from the web is shown as
   * its alt text rather than loaded by a window nobody is watching. An HTML file somebody opens themselves gets no such
   * line, because there the images loading is the point.
   */
  forPrint?: boolean
  /** Section numbers in headings. Off unless asked, because a document written as Markdown rarely wants them. */
  numberSections?: boolean
}

export interface HtmlResult {
  html: string
  /** What could not be carried, in sentences. Empty when everything was. */
  notes: string[]
}

export const escapeHtml = (value: string): string =>
  String(value ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

/** A link target a document may carry. `javascript:` and the rest are never written, whatever the block said. */
const safeHref = (href: string): string | null => {
  const trimmed = String(href ?? '').trim()
  if (trimmed.startsWith('#')) return trimmed
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed
  return null
}

/** An image source a document may show. Only the web and inline data; never a file on this computer. */
const safeImageSource = (source: string): { href: string; external: boolean } | null => {
  const trimmed = String(source ?? '').trim()
  if (/^https?:/i.test(trimmed)) return { href: trimmed, external: true }
  if (/^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/i.test(trimmed)) return { href: trimmed, external: false }
  return null
}

const MARK_TAG: Record<MarkKind, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
  code: 'code',
  highlight: 'mark',
  subscript: 'sub',
  superscript: 'sup'
}

const withMarks = (inner: string, marks: readonly MarkKind[]): string =>
  marks.reduce((html, mark) => `<${MARK_TAG[mark]}>${html}</${MARK_TAG[mark]}>`, inner)

interface Context {
  references: Map<string, string>
  citations: Map<string, number>
  footnotes: Map<string, number>
  notes: string[]
  forPrint: boolean
  externalImages: number
  droppedLinks: number
}

const renderInline = (runs: readonly Inline[], ctx: Context): string =>
  runs
    .map((run) => {
      switch (run.kind) {
        case 'text':
          return withMarks(escapeHtml(run.text), run.marks)
        case 'link': {
          const href = safeHref(run.href)
          if (href === null) {
            ctx.droppedLinks += 1
            return withMarks(escapeHtml(run.text), run.marks)
          }
          const rel = run.internal ? '' : ' rel="noopener noreferrer"'
          return `<a href="${escapeHtml(href)}"${rel}>${withMarks(escapeHtml(run.text), run.marks)}</a>`
        }
        case 'math':
          return `<code class="math">${escapeHtml(run.source)}</code>`
        case 'reference': {
          const display = ctx.references.get(run.targetId)
          return display === undefined
            ? `<span class="ref broken">[missing ${escapeHtml(run.as)}]</span>`
            : `<a class="ref" href="#${escapeHtml(run.targetId)}">${escapeHtml(display)}</a>`
        }
        case 'citation': {
          const n = ctx.citations.get(run.sourceId)
          const label = n === undefined ? escapeHtml(run.sourceId) : String(n)
          const locator = run.locator ? `, ${escapeHtml(run.locator)}` : ''
          return n === undefined
            ? `<sup class="cite unresolved">[${label}${locator}]</sup>`
            : `<sup class="cite"><a href="#source-${n}">[${label}${locator}]</a></sup>`
        }
        case 'footnote': {
          const n = ctx.footnotes.get(run.noteId)
          return n === undefined
            ? `<sup class="fn broken">[note?]</sup>`
            : `<sup class="fn"><a href="#fn-${n}" id="fnref-${n}">${n}</a></sup>`
        }
      }
    })
    .join('')

const renderCell = (cell: TableCell, ctx: Context): string => {
  const tag = cell.header ? 'th' : 'td'
  const span = `${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}`
  const align = cell.align !== 'left' ? ` style="text-align:${cell.align}"` : ''
  return `<${tag}${span}${align}>${renderInline(cell.content, ctx)}</${tag}>`
}

/** List items with depths, nested the way the depths say. A depth that jumps by two opens two lists, honestly. */
const renderList = (block: Extract<Block, { kind: 'list' }>, ctx: Context): string => {
  const tag = block.style === 'ordered' ? 'ol' : 'ul'
  const cls = block.style === 'task' ? ' class="tasks"' : ''
  const out: string[] = []
  let depth = -1
  for (const item of block.items) {
    const want = Math.max(0, item.depth)
    while (depth < want) {
      out.push(depth < 0 ? `<${tag}${cls}>` : `<${tag}>`)
      depth += 1
    }
    while (depth > want) {
      out.push(`</li></${tag}>`)
      depth -= 1
    }
    if (out.length > 1 && !out[out.length - 1].startsWith('<' + tag)) out.push('</li>')
    const box = block.style === 'task' ? `<span class="box">${item.checked ? '&#9746;' : '&#9744;'}</span> ` : ''
    out.push(`<li>${box}${renderInline(item.content, ctx)}`)
  }
  while (depth >= 0) {
    out.push(`</li></${tag}>`)
    depth -= 1
  }
  return out.join('')
}

const renderBlock = (block: Block, ctx: Context, numbers: Map<string, { as: string; number: number }>, sections: Map<string, string>, numberSections: boolean): string => {
  const id = ` id="${escapeHtml(block.id)}"`
  switch (block.kind) {
    case 'paragraph':
      return `<p${id}>${renderInline(block.content, ctx)}</p>`
    case 'heading': {
      const number = numberSections ? sections.get(block.id) : undefined
      const prefix = number ? `<span class="num">${escapeHtml(number)}</span> ` : ''
      return `<h${block.level}${id}>${prefix}${renderInline(block.content, ctx)}</h${block.level}>`
    }
    case 'list':
      return renderList(block, ctx)
    case 'quote': {
      const attribution = block.attribution ? `<footer>&mdash; ${escapeHtml(block.attribution)}</footer>` : ''
      return `<blockquote${id}><p>${renderInline(block.content, ctx)}</p>${attribution}</blockquote>`
    }
    case 'code': {
      const lang = block.language ? ` class="language-${escapeHtml(block.language)}"` : ''
      const lines = block.showLineNumbers ? ' data-line-numbers="true"' : ''
      return `<pre${id}${lines}><code${lang}>${escapeHtml(block.source)}</code></pre>`
    }
    case 'equation': {
      const n = numbers.get(block.id)
      const label = n ? `<figcaption>(${n.number})</figcaption>` : ''
      return `<figure class="equation"${id}><code class="math">${escapeHtml(block.source)}</code>${label}</figure>`
    }
    case 'table': {
      const n = numbers.get(block.id)
      const caption = n || block.caption ? `<caption>${n ? `<strong>Table ${n.number}.</strong> ` : ''}${escapeHtml(block.caption)}</caption>` : ''
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => renderCell(cell, ctx)).join('')}</tr>`).join('')
      return `<table${id}>${caption}<tbody>${rows}</tbody></table>`
    }
    case 'image': {
      const n = numbers.get(block.id)
      const source = safeImageSource(block.source)
      if (source?.external) ctx.externalImages += 1
      const picture = source
        ? `<img src="${escapeHtml(source.href)}" alt="${escapeHtml(block.alt)}">`
        : `<p class="image-missing">${escapeHtml(block.alt || 'image')}</p>`
      const caption = n || block.caption ? `<figcaption>${n ? `<strong>Figure ${n.number}.</strong> ` : ''}${escapeHtml(block.caption)}</figcaption>` : ''
      return `<figure class="image"${id}>${picture}${caption}</figure>`
    }
    case 'callout': {
      const title = block.title ? `<strong class="callout-title">${escapeHtml(block.title)}</strong>` : ''
      return `<aside class="callout ${escapeHtml(block.tone)}"${id}>${title}<p>${renderInline(block.content, ctx)}</p></aside>`
    }
    case 'divider':
      return `<hr${id}>`
    case 'footnote':
      // Gathered and written at the end, in order of first use.
      return ''
    case 'embed': {
      const stale = block.live ? '' : ' <span class="stale">(may be out of date)</span>'
      return `<figure class="embed"${id}><pre>${escapeHtml(block.snapshot)}</pre><figcaption>${escapeHtml(block.source.describe)}${stale}</figcaption></figure>`
    }
  }
}

const STYLE = `
:root { color-scheme: light; }
html { font-family: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1d24; background: #fff; }
body { margin: 0; }
article { max-width: 46em; margin: 0 auto; padding: 2.5em 1.5em; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; page-break-after: avoid; break-after: avoid; }
h1 { font-size: 2em; margin-top: 0; } h2 { font-size: 1.5em; } h3 { font-size: 1.2em; }
h1.title { border-bottom: 1px solid #d8dbe2; padding-bottom: 0.3em; }
.num { color: #6b7280; margin-right: 0.4em; }
p { margin: 0 0 0.9em; }
a { color: #0b5fb0; }
blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 3px solid #c9ced8; color: #3b4150; }
blockquote footer { font-size: 0.9em; color: #6b7280; }
pre { background: #f4f5f8; border: 1px solid #e1e4ea; border-radius: 4px; padding: 0.8em 1em; overflow: auto; font-size: 0.9em; page-break-inside: avoid; break-inside: avoid; }
code { font-family: Consolas, "Cascadia Mono", "SF Mono", Menlo, monospace; }
code.math { background: #f4f5f8; padding: 0 0.3em; border-radius: 3px; }
figure { margin: 1.2em 0; page-break-inside: avoid; break-inside: avoid; }
figure.image img { max-width: 100%; height: auto; display: block; }
figure.equation { text-align: center; } figure.equation figcaption { display: inline; margin-left: 1em; color: #6b7280; }
figcaption, caption { font-size: 0.9em; color: #4b5160; margin-top: 0.4em; text-align: left; caption-side: bottom; }
table { border-collapse: collapse; width: 100%; margin: 1.2em 0; page-break-inside: avoid; break-inside: avoid; font-size: 0.95em; }
th, td { border: 1px solid #d8dbe2; padding: 0.35em 0.6em; vertical-align: top; }
th { background: #f4f5f8; text-align: left; }
aside.callout { border: 1px solid #d8dbe2; border-left-width: 4px; border-radius: 4px; padding: 0.7em 1em; margin: 1em 0; background: #f8f9fb; }
aside.callout.note { border-left-color: #0b5fb0; } aside.callout.warning { border-left-color: #c77d00; }
aside.callout.success { border-left-color: #1f8a4c; } aside.callout.danger { border-left-color: #b3261e; }
aside.callout .callout-title { display: block; margin-bottom: 0.3em; }
aside.callout p { margin: 0; }
hr { border: 0; border-top: 1px solid #d8dbe2; margin: 1.6em 0; }
ul.tasks { list-style: none; padding-left: 0.4em; }
.ref.broken, .cite.unresolved, .fn.broken { color: #b3261e; }
.image-missing { color: #6b7280; font-style: italic; }
.stale { color: #c77d00; font-size: 0.85em; }
section.footnotes, section.references { margin-top: 2.5em; padding-top: 1em; border-top: 1px solid #d8dbe2; font-size: 0.9em; }
section.footnotes h2, section.references h2 { font-size: 1.1em; margin-top: 0; }
figure.embed pre { font-size: 0.85em; }
@page { size: A4; margin: 18mm 16mm; }
@media print { article { max-width: none; padding: 0; } a { color: inherit; text-decoration: none; } }
`

/** A document as a complete HTML page. */
export function toHtml(document: StructuredDocument, options: HtmlOptions = {}): HtmlResult {
  const forPrint = options.forPrint === true
  const ctx: Context = { references: new Map(), citations: new Map(), footnotes: new Map(), notes: [], forPrint, externalImages: 0, droppedLinks: 0 }

  // What every reference should say, and the ones that say nothing. A broken one is written as a visible marker.
  const resolved = resolveReferences(document)
  for (const one of resolved.runsTo) ctx.references.set(one.blockId, one.display)
  if (resolved.broken.length > 0) {
    ctx.notes.push(`${resolved.broken.length} reference${resolved.broken.length === 1 ? '' : 's'} point${resolved.broken.length === 1 ? 's' : ''} at nothing and ${resolved.broken.length === 1 ? 'is' : 'are'} marked in the text.`)
  }

  const numbers = new Map(numbering(document).map((one) => [one.blockId, { as: one.as, number: one.number }]))
  const sections = new Map<string, string>()
  const walk = (entries: OutlineEntry[]): void => {
    for (const entry of entries) {
      sections.set(entry.blockId, entry.number)
      walk(entry.children)
    }
  }
  walk(outlineOf(document))

  // Footnotes and citations numbered in order of first use, which is the only order a reader can follow.
  const footnoteBlocks = new Map(document.blocks.filter((one): one is Extract<Block, { kind: 'footnote' }> => one.kind === 'footnote').map((one) => [one.noteId, one]))
  const sourcesById = new Map((options.sources ?? []).map((one) => [one.id, one]))
  const citedOrder: string[] = []
  for (const block of document.blocks) {
    for (const run of inlineRunsOf(block)) {
      if (run.kind === 'footnote' && footnoteBlocks.has(run.noteId) && !ctx.footnotes.has(run.noteId)) ctx.footnotes.set(run.noteId, ctx.footnotes.size + 1)
      if (run.kind === 'citation' && sourcesById.has(run.sourceId) && !ctx.citations.has(run.sourceId)) {
        ctx.citations.set(run.sourceId, ctx.citations.size + 1)
        citedOrder.push(run.sourceId)
      }
    }
  }
  const unresolvedCitations = new Set<string>()
  for (const block of document.blocks) {
    for (const run of inlineRunsOf(block)) if (run.kind === 'citation' && !ctx.citations.has(run.sourceId)) unresolvedCitations.add(run.sourceId)
  }
  if (unresolvedCitations.size > 0) {
    ctx.notes.push(`${unresolvedCitations.size} citation${unresolvedCitations.size === 1 ? '' : 's'} point${unresolvedCitations.size === 1 ? 's' : ''} at a source this document does not carry, so no reference entry was written for ${unresolvedCitations.size === 1 ? 'it' : 'them'}.`)
  }

  const hasTopHeading = document.blocks.some((one) => one.kind === 'heading' && one.level === 1)
  const parts: string[] = []
  if (document.metadata.title !== '' && !hasTopHeading) parts.push(`<h1 class="title">${escapeHtml(document.metadata.title)}</h1>`)
  for (const block of document.blocks) {
    const html = renderBlock(block, ctx, numbers, sections, options.numberSections === true)
    if (html !== '') parts.push(html)
  }

  if (ctx.footnotes.size > 0) {
    const items = [...ctx.footnotes.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([noteId, n]) => `<li id="fn-${n}">${renderInline(footnoteBlocks.get(noteId)!.content, ctx)} <a href="#fnref-${n}" class="backref">&#8617;</a></li>`)
    parts.push(`<section class="footnotes"><h2>Notes</h2><ol>${items.join('')}</ol></section>`)
  }
  if (citedOrder.length > 0) {
    const style = options.style ?? 'apa'
    const items = citedOrder.map((sourceId, i) => `<li id="source-${i + 1}">${escapeHtml(formatCitation(sourcesById.get(sourceId)!, style, i + 1))}</li>`)
    parts.push(`<section class="references"><h2>References</h2><ol>${items.join('')}</ol></section>`)
  }

  if (forPrint && ctx.externalImages > 0) {
    ctx.notes.push(`${ctx.externalImages} image${ctx.externalImages === 1 ? '' : 's'} from the web ${ctx.externalImages === 1 ? 'is' : 'are'} shown as alt text: the print window fetches nothing.`)
  }
  if (ctx.droppedLinks > 0) ctx.notes.push(`${ctx.droppedLinks} link${ctx.droppedLinks === 1 ? '' : 's'} with an address Orbis does not write ${ctx.droppedLinks === 1 ? 'was' : 'were'} kept as text.`)

  const meta = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    // Nothing may be fetched by the print window. Inline style is the page's own; there is no script to allow.
    forPrint ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">` : '',
    document.metadata.author ? `<meta name="author" content="${escapeHtml(document.metadata.author)}">` : '',
    document.metadata.tags.length > 0 ? `<meta name="keywords" content="${escapeHtml(document.metadata.tags.join(', '))}">` : '',
    '<meta name="generator" content="Orbis">'
  ].filter((one) => one !== '')

  const lang = escapeHtml(document.metadata.language || 'en')
  const title = escapeHtml(document.metadata.title || 'Document')
  const html = `<!doctype html>\n<html lang="${lang}">\n<head>\n${meta.join('\n')}\n<title>${title}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n<article>\n${parts.join('\n')}\n</article>\n</body>\n</html>\n`
  return { html, notes: ctx.notes }
}

/**
 * A document as plain text that a person can read.
 *
 * Headings underlined, lists marked, tables tab-separated, figures by their captions. Nothing is dropped: the old
 * plain-text path returned an empty string for a paragraph, which is the one block kind every document is mostly made
 * of. Numbers are resolved the same way as for HTML, so "Figure 2" means the same thing in both.
 */
export function toText(document: StructuredDocument): string {
  const numbers = new Map(numbering(document).map((one) => [one.blockId, one]))
  const out: string[] = []
  if (document.metadata.title !== '' && !document.blocks.some((one) => one.kind === 'heading' && one.level === 1)) {
    out.push(document.metadata.title, '='.repeat(Math.min(document.metadata.title.length, 72)), '')
  }
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading': {
        const line = blockText(block)
        out.push(line, (block.level <= 1 ? '=' : '-').repeat(Math.min(Math.max(line.length, 3), 72)), '')
        break
      }
      case 'paragraph':
      case 'quote':
      case 'callout':
      case 'footnote':
        out.push(block.kind === 'quote' ? `> ${blockText(block)}` : blockText(block), '')
        break
      case 'list':
        for (const item of block.items) {
          const mark = block.style === 'ordered' ? '1.' : block.style === 'task' ? (item.checked ? '[x]' : '[ ]') : '-'
          out.push(`${'  '.repeat(Math.max(0, item.depth))}${mark} ${item.content.map((one) => ('text' in one ? one.text : 'source' in one ? one.source : '')).join('')}`)
        }
        out.push('')
        break
      case 'code':
        out.push(block.source, '')
        break
      case 'equation': {
        const n = numbers.get(block.id)
        out.push(n ? `${block.source}    (${n.number})` : block.source, '')
        break
      }
      case 'table': {
        const n = numbers.get(block.id)
        if (n || block.caption) out.push(`${n ? `Table ${n.number}. ` : ''}${block.caption}`.trim())
        out.push(...block.rows.map((row) => row.map((cell) => cell.content.map((one) => ('text' in one ? one.text : '')).join('')).join('\t')), '')
        break
      }
      case 'image': {
        const n = numbers.get(block.id)
        out.push(`[${n ? `Figure ${n.number}: ` : ''}${block.alt || block.caption || 'image'}]`, '')
        break
      }
      case 'divider':
        out.push('-'.repeat(24), '')
        break
      case 'embed':
        out.push(block.snapshot, `(${block.source.describe}${block.live ? '' : ', may be out of date'})`, '')
        break
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
