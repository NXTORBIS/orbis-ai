import { extname } from 'node:path'
import { toDelimited } from '../../shared/compute/data.ts'
import { toMarkdown } from '../../shared/compute/document.ts'
import { importFile, type ScannedOffer } from './importing.ts'

/**
 * An Excel, Word or PDF file attached to a chat message.
 *
 * The chat could only ever be handed text: a file with anything else in it was skipped, which left "here is my
 * spreadsheet, what was the best month?" with nothing to answer from. The readers the Create screen opens files with
 * already turn these three into a table or a document, so the same readers are used here and the result is attached
 * as the text it holds -- a workbook's sheet as comma-separated rows, a Word or PDF file as its words in Markdown.
 *
 * Nothing is kept by attaching. The file becomes an artifact only if the person then asks for one to be made from
 * it, and that goes through the same import as any other.
 *
 * What the reader could not carry across is said, in the same words the Create screen uses, and a file longer than a
 * message can hold is cut at the end of a row or a line, with how much was left out.
 */

/** The file types read this way. Anything else is text and is attached as it is. */
export const READ_FOR_CHAT: readonly string[] = Object.freeze(['.xlsx', '.docx', '.pdf', '.pptx'])

export const isReadForChat = (name: string): boolean => READ_FOR_CHAT.includes(extname(name).toLowerCase())

export interface ReadForChat {
  /** The text the file holds, as the chat will be shown it. */
  content: string
  /** What that text is, so a later "make a spreadsheet from it" opens it the right way. */
  mimeType: 'text/csv' | 'text/markdown'
  /** What was read and what was left behind, in sentences. */
  notes: string[]
}

const WHAT: Readonly<Record<string, string>> = Object.freeze({ '.xlsx': 'Excel workbook', '.docx': 'Word document', '.pdf': 'PDF', '.pptx': 'PowerPoint deck' })

/** The text cut to a length at the end of a line, and how many lines did not fit. */
function cutAtLine(text: string, limit: number): { text: string; left: number } {
  if (text.length <= limit) return { text, left: 0 }
  const end = text.lastIndexOf('\n', limit)
  const kept = end > 0 ? text.slice(0, end) : text.slice(0, limit)
  const left = text.slice(kept.length).split('\n').filter((line) => line.trim() !== '').length
  return { text: kept, left }
}

export async function readForChat(
  name: string,
  bytes: Uint8Array,
  limit: number
): Promise<ReadForChat | { error: string; message: string; scanned?: ScannedOffer }> {
  const what = WHAT[extname(name).toLowerCase()]
  if (!what) return { error: 'unsupported', message: 'That is not a file Orbis reads this way.' }
  // The name says what it is; the first bytes have to agree. A file that is only called a workbook would otherwise
  // be read as whatever text its bytes happen to spell.
  const ext = extname(name).toLowerCase()
  const zipped = bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
  const pdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  if (ext === '.pdf' ? !pdf : !zipped) return { error: 'parse', message: `That file is named as a ${what} but does not open as one.` }
  /*
   * No consent is given here, deliberately.
   *
   * Attaching a file is not asking for its pictures to be sent anywhere. A scanned PDF comes back as the question,
   * and the question travels out with the refusal so the reply can show it -- in the chat that means one sentence
   * saying what it would take, not a file read because somebody dragged it in.
   */
  const read = await importFile(name, bytes)
  if ('error' in read) return read

  if (read.body.kind === 'table') {
    const table = read.body.table
    const whole = toDelimited(table)
    const cut = cutAtLine(whole, limit)
    const notes = [`Read from the ${what} by Orbis: ${table.rows.length.toLocaleString('en')} row${table.rows.length === 1 ? '' : 's'} and ${table.columns.length} column${table.columns.length === 1 ? '' : 's'}.`, ...read.notes]
    if (cut.left > 0) notes.push(`It is longer than one message holds: the last ${cut.left.toLocaleString('en')} rows are not attached.`)
    return { content: cut.text, mimeType: 'text/csv', notes }
  }
  if (read.body.kind === 'document') {
    const whole = toMarkdown(read.body.document)
    if (whole.trim() === '') return { error: 'parse', message: `That ${what} has no words in it that Orbis can read.` }
    const cut = cutAtLine(whole, limit)
    const notes = [`Read from the ${what} by Orbis.`, ...read.notes]
    if (cut.left > 0) notes.push(`It is longer than one message holds: the last ${cut.left.toLocaleString('en')} lines are not attached.`)
    return { content: cut.text, mimeType: 'text/markdown', notes }
  }
  return { error: 'unsupported', message: `That ${what} did not read as a table or a document.` }
}

/**
 * The name to open an attachment under when it is made into an artifact.
 *
 * A workbook attached to the chat arrives as rows of text. Opened under its own name it would be taken for a workbook
 * and refused, so it is opened as what it now is, and keeps its title.
 */
export function nameToOpenAs(name: string, mimeType: string | undefined): string {
  if (!isReadForChat(name)) return name
  const stem = name.slice(0, name.length - extname(name).length)
  if (mimeType === 'text/csv') return `${stem}.csv`
  if (mimeType === 'text/markdown') return `${stem}.md`
  return name
}
