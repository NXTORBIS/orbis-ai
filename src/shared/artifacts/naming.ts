/**
 * File names, made safe and made unique.
 *
 * Lifted out of `chromiumCapabilities2.ts`, where the same two functions were module-local, because there are five
 * filename sanitisers in this repository and each one forgets a different character. This is the one; the others are
 * to be pointed at it as they are touched.
 *
 * Pure on purpose. `unique` takes a function that says whether a name is taken rather than looking at a disk, so it
 * can be tested with a Set and used against a folder, a ZIP's entry list or a dialog's suggestion alike.
 */

/** Characters no filesystem Orbis runs on will take in a name, plus the control range. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]+/g

/** Names Windows reserves whatever the extension. A file called `con.csv` cannot be created there. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A name a file can have, from whatever a person or a model typed.
 *
 * Forbidden characters become spaces, runs of space collapse, the ends are trimmed, trailing dots go (Windows strips
 * them silently, which makes `report.` and `report` the same file), and the result is cut to 80 characters so a
 * title the length of a paragraph does not become a path longer than the system allows.
 */
export function safeName(name: string, fallback = 'artifact'): string {
  const cleaned = String(name ?? '')
    .replace(FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim()
  if (cleaned === '' || RESERVED.test(cleaned)) return fallback
  return cleaned
}

/**
 * `base` with `ext`, or `base (2)` with `ext`, and so on, up to the first name `exists` says is free.
 *
 * Counting starts at 2 because "report" and "report (1)" reads as though there were a "report (0)"; this is the
 * convention every desktop uses, and matching it means a person's own duplicates and Orbis's look the same.
 */
export function unique(base: string, ext: string, exists: (candidate: string) => boolean, limit = 10_000): string {
  const first = `${base}${ext}`
  if (!exists(first)) return first
  for (let n = 2; n <= limit; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!exists(candidate)) return candidate
  }
  throw new Error(`Could not find a free name for "${base}${ext}" after ${limit} tries.`)
}

/** A name for something kept from a piece of text: its first heading, or its first few words. */
export function titleFromText(text: string, fallback = 'Document'): string {
  const lines = text.split(/\r?\n/).map((one) => one.trim())
  const heading = lines.find((one) => /^#{1,6}\s+\S/.test(one))
  const first = heading ? heading.replace(/^#{1,6}\s+/, '') : (lines.find((one) => one !== '') ?? '')
  const plain = first
    .replace(/[*_`~>#]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain === '') return fallback
  const words = plain.split(' ')
  const short = words.slice(0, 9).join(' ')
  return (words.length > 9 ? `${short}…` : short).slice(0, 80)
}

/**
 * The document in a chat reply.
 *
 * A model asked for "a document, as Markdown" often answers with the whole thing inside one fenced block. Kept as it
 * stands that is a document with a single code block in it, which is not what anybody meant. When the reply is exactly
 * one fence marked as Markdown (or unmarked) and nothing else, the document is what is inside. Anything else -- prose
 * with code in it, two fences, a fence of some other language -- is kept exactly as it was written.
 */
export function documentTextFromReply(reply: string): string {
  const text = reply.trim()
  const fenced = /^```(markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)
  if (!fenced) return reply
  const inside = fenced[2]
  // A fence inside the fence means the outer one was not simply wrapping a document.
  if (/^```/m.test(inside)) return reply
  // An unmarked fence is only unwrapped when what is inside reads as a document: a heading or a table.
  if (!fenced[1] && !/^#{1,6}\s+\S/m.test(inside) && !/^\|.*\|\s*$/m.test(inside)) return reply
  return inside
}
