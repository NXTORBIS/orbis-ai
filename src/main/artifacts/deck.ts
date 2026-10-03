import { inflateRawSync } from 'node:zlib'
import { basename, extname } from 'node:path'
import { emptyDocument, text, type Block, type TableCell } from '../../shared/compute/document.ts'
import { isInterchangeError, readXml, type XmlNode } from '../../shared/compute/interchange.ts'
import { safeName } from '../../shared/artifacts/naming.ts'
import { isZipError, readDirectory, readEntry } from '../../shared/portable/zip.ts'
import type { ImportOutcome } from './importing.ts'

/**
 * A PowerPoint deck read into a document.
 *
 * A deck is a zip of XML, one file per slide, and the words on a slide are in its shapes: a title shape, body shapes
 * with their paragraphs at levels, tables, and the speaker's notes in a file beside it. That is what is read, in the
 * order the presentation shows its slides -- which is written in the presentation's own list, not in the file names.
 *
 * Each slide becomes a heading and what was under it: its paragraphs as a list (a slide is bullets far more often
 * than prose), its tables as tables, its notes as a quote. Pictures, charts, drawings, animations and where things
 * sat on the slide are not read, and the note says so. Nothing in the deck is run and nothing is fetched.
 */

export const DECK_LIMITS = Object.freeze({ slides: 500, characters: 2_000_000 })

const inflate = (data: Uint8Array): Uint8Array => new Uint8Array(inflateRawSync(data))

/** Every node of a name, anywhere beneath a node, in document order. */
function all(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const child of node.children) {
    if (child.name === name) out.push(child)
    all(child, name, out)
  }
  return out
}

const first = (node: XmlNode, name: string): XmlNode | null => all(node, name)[0] ?? null

/** The words of one paragraph: its runs joined, a line break inside it as a space. */
const paragraphText = (paragraph: XmlNode): string =>
  paragraph.children
    .map((child) => (child.name === 'a:r' || child.name === 'a:fld' ? (first(child, 'a:t')?.text ?? '') : child.name === 'a:br' ? ' ' : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

interface Slide {
  title: string
  paragraphs: { words: string; depth: number }[]
  tables: string[][][]
  notes: string
}

function readSlide(xml: XmlNode): Omit<Slide, 'notes'> {
  let title = ''
  const paragraphs: Slide['paragraphs'] = []
  const tables: string[][][] = []
  /** How many lines the first shape with words in it gave, for a deck whose title is not marked as one. */
  let firstShape = 0

  for (const shape of all(xml, 'p:sp')) {
    const placeholder = first(shape, 'p:ph')?.attributes.type ?? ''
    const body = first(shape, 'p:txBody')
    if (!body) continue
    const lines = body.children.filter((one) => one.name === 'a:p').map((one) => ({ words: paragraphText(one), depth: Math.min(5, Math.max(0, Number(first(one, 'a:pPr')?.attributes.lvl ?? 0) || 0)) }))
    if ((placeholder === 'title' || placeholder === 'ctrTitle') && title === '') {
      title = lines.map((one) => one.words).filter((one) => one !== '').join(' ')
      continue
    }
    // The slide number, the date and the footer are furniture, not what the slide says.
    if (placeholder === 'sldNum' || placeholder === 'dt' || placeholder === 'ftr') continue
    const before = paragraphs.length
    for (const line of lines) if (line.words !== '') paragraphs.push(line)
    if (before === 0 && firstShape === 0) firstShape = paragraphs.length
  }
  // A deck written by a program often has no shape marked as the title: the title is simply the first box, one short
  // line. Taken as the title, so the slide is named for what it says rather than for its number.
  if (title === '' && firstShape === 1 && paragraphs[0].words.length <= 160) title = paragraphs.shift()!.words

  for (const table of all(xml, 'a:tbl')) {
    const rows = table.children
      .filter((one) => one.name === 'a:tr')
      .map((row) => row.children.filter((one) => one.name === 'a:tc').map((cell) => all(cell, 'a:p').map(paragraphText).filter((one) => one !== '').join(' ')))
      .filter((row) => row.length > 0)
    if (rows.length > 0) tables.push(rows)
  }
  return { title, paragraphs, tables }
}

export function readDeck(name: string, bytes: Uint8Array): ImportOutcome {
  const listing = readDirectory(bytes)
  if (isZipError(listing)) return { error: 'parse', message: 'The deck could not be opened: it is not a PowerPoint file Orbis can read.' }
  const part = (path: string): XmlNode | null => {
    const entry = listing.find((one) => one.path === path)
    if (!entry) return null
    const data = readEntry(bytes, entry, inflate)
    if (isZipError(data)) return null
    const xml = readXml(new TextDecoder().decode(data))
    return isInterchangeError(xml) ? null : xml
  }

  // The order the presentation shows its slides in: its own list, joined to files through its relationships.
  const presentation = part('ppt/presentation.xml')
  const relations = part('ppt/_rels/presentation.xml.rels')
  const targetOf = new Map((relations ? all(relations, 'Relationship') : []).map((one) => [one.attributes.Id, one.attributes.Target]))
  let paths = (presentation ? all(presentation, 'p:sldId') : [])
    .map((one) => targetOf.get(one.attributes['r:id'] ?? ''))
    .filter((one): one is string => typeof one === 'string')
    .map((one) => `ppt/${one.replace(/^\/?(ppt\/)?/, '')}`)
    .filter((one) => listing.some((entry) => entry.path === one))
  // A deck whose list could not be read is still read: by the numbers in the file names.
  const byNumber = listing.map((one) => one.path).filter((one) => /^ppt\/slides\/slide\d+\.xml$/.test(one)).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  const listed = paths.length > 0
  if (!listed) paths = byNumber
  if (paths.length === 0) return { error: 'parse', message: 'The deck has no slides in it that Orbis could read.' }

  const total = paths.length
  paths = paths.slice(0, DECK_LIMITS.slides)
  const slides: Slide[] = []
  for (const path of paths) {
    const xml = part(path)
    if (!xml) {
      slides.push({ title: '', paragraphs: [], tables: [], notes: '' })
      continue
    }
    const read = readSlide(xml)
    // The speaker's notes are in a file of their own, found through the slide's relationships.
    const slideRelations = part(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))
    const notesTarget = (slideRelations ? all(slideRelations, 'Relationship') : []).find((one) => /notesSlide$/.test(one.attributes.Type ?? ''))?.attributes.Target
    const notesXml = notesTarget ? part(`ppt/${notesTarget.replace(/^(\.\.\/)+/, '').replace(/^\/?(ppt\/)?/, '')}`) : null
    let notes = ''
    if (notesXml) {
      notes = all(notesXml, 'p:sp')
        .filter((shape) => (first(shape, 'p:ph')?.attributes.type ?? '') === 'body')
        .flatMap((shape) => all(shape, 'a:p').map(paragraphText))
        .filter((one) => one !== '')
        .join(' ')
    }
    slides.push({ ...read, notes })
  }

  const blocks: Block[] = []
  let n = 0
  const id = (): string => `s-${++n}`
  let characters = 0
  let unreadable = 0
  let cut = false
  const cell = (value: string, header: boolean): TableCell => ({ content: [text(value)], colSpan: 1, rowSpan: 1, header, align: 'left' })
  slides.forEach((slide, at) => {
    if (cut) return
    const shown = slide.title || `Slide ${at + 1}`
    if (slide.title === '' && slide.paragraphs.length === 0 && slide.tables.length === 0 && slide.notes === '') unreadable += 1
    blocks.push({ id: id(), sectionId: '', kind: 'heading', level: 2, content: [text(shown)] })
    if (slide.paragraphs.length > 0) {
      blocks.push({ id: id(), sectionId: '', kind: 'list', style: 'bullet', items: slide.paragraphs.map((one) => ({ content: [text(one.words)], checked: false, depth: one.depth })) })
    }
    for (const rows of slide.tables) {
      const columns = Math.max(...rows.map((row) => row.length))
      blocks.push({ id: id(), sectionId: '', kind: 'table', columns, rows: rows.map((row, r) => Array.from({ length: columns }, (_, c) => cell(row[c] ?? '', r === 0))), caption: '', label: '' })
    }
    // Notes that only repeat what the slide says add nothing; anything more is what the speaker meant to say.
    const said = [slide.title, ...slide.paragraphs.map((one) => one.words)].join(' ').replace(/\s+/g, ' ').trim()
    if (slide.notes !== '' && slide.notes.replace(/\s+/g, ' ').trim() !== said) {
      blocks.push({ id: id(), sectionId: '', kind: 'quote', content: [text(slide.notes)], attribution: 'Speaker notes' })
    }
    characters += said.length + slide.notes.length
    if (characters > DECK_LIMITS.characters) cut = true
  })

  const title = safeName(basename(name, extname(name)), 'Imported')
  const document = emptyDocument('imported', title)
  document.blocks = [{ id: id(), sectionId: '', kind: 'heading', level: 1, content: [text(title)] }, ...blocks]
  document.metadata.source = `file: ${basename(name)}`

  const notes = [`Read the words of ${slides.length} slide${slides.length === 1 ? '' : 's'}${total > slides.length ? ` of ${total}` : ''}: titles, text, tables and speaker notes. Pictures, charts, drawings and where things sat on a slide are not read.`]
  if (!listed) notes.push('The deck did not say what order its slides are shown in, so they are in the order of their file numbers.')
  if (unreadable > 0) notes.push(`${unreadable} slide${unreadable === 1 ? ' has' : 's have'} no words Orbis could read (a picture, a chart or an empty slide); each is still there as a heading.`)
  if (cut) notes.push(`Stopped after ${DECK_LIMITS.characters.toLocaleString('en')} characters.`)
  return { body: { kind: 'document', document }, title, source: document.metadata.source, format: 'pptx', notes }
}
