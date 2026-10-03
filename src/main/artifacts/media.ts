import { basename, extname } from 'node:path'
import { safeName, titleFromText } from '../../shared/artifacts/naming.ts'
import {
  describeMedia,
  familyOf,
  isMediaRefusal,
  mediaBodyOf,
  mediaExtension,
  mediaIn,
  mediaName,
  readMedia,
  MEDIA_EXTENSIONS,
  MEDIA_KIND_WORDS,
  MEDIA_LIMITS,
  type MediaBody,
  type MediaFormatId,
  type MediaKindId,
  type MediaOutcome,
  type MediaRefusal,
  type MediaSource
} from '../../shared/artifacts/media.ts'
import type { LossReport } from '../../shared/compute/interchange.ts'

/**
 * A picture, a sound or a video kept as an artifact: the door the engine knocks on.
 *
 * The reading itself is pure and lives in src/shared/artifacts/media.ts. What is here is everything the engine needs
 * around it: the cross-check between the name a file came under and what its bytes actually are, the file turned into
 * the body and the notes an artifact is kept with, the bounded preview a card can show, and the stored bytes handed
 * back for writing without being touched.
 *
 * The rule these three kinds are built on, said once here because every function below obeys it: **the bytes are the
 * artifact**. They are written once, exactly as they arrived, and they are never written out of anything -- not
 * re-encoded, not re-sized, not converted between formats. Saving a picture copies the same bytes to the place the
 * person chose. That is why there is no writer in this file, only a reader, a checker and a way to hand the bytes
 * along. A kind whose content Orbis could regenerate can be changed by a sentence; these three cannot, and the
 * kinds table says so rather than leaving a person to find out by trying.
 *
 * Nothing here decodes, plays, transcodes, uploads or shells out. Nothing leaves the computer.
 */

export {
  describeMedia,
  mediaExtension,
  mediaFileName,
  mediaIn,
  mediaName,
  readMedia,
  verifyMedia,
  isMediaRefusal,
  MEDIA_FORMATS,
  MEDIA_KIND_WORDS,
  MEDIA_LIMITS
} from '../../shared/artifacts/media.ts'
export type { MediaBody, MediaFacts, MediaFormatId, MediaKindId, MediaOutcome, MediaRefusal, MediaSource } from '../../shared/artifacts/media.ts'

const titleOf = (name: string): string => safeName(basename(name, extname(name)), 'Picture')

/**
 * What a file is, checked against what it is called.
 *
 * The bytes decide; the name is only ever allowed to raise an objection. A file called `holiday.png` whose bytes are
 * a JPEG is refused rather than kept as a PNG, because every later question -- what extension does the saved copy
 * get, what does an `<img>` get told it is, is the file on disk still the file that was written -- would be answered
 * from the wrong one of the two. A file whose name says nothing about pictures at all (`IMG_0421`, or a picture made
 * in the chat that was never a file) is accepted on its bytes with a note saying that is what happened.
 *
 * The MP4 family is one check, not four: `.mp4`, `.m4a`, `.m4v` and `.mov` are the same container, and whether a
 * particular file holds a picture track is settled by reading the tracks, not by reading the name.
 */
export function inspectMedia(name: string, bytes: Uint8Array): MediaOutcome {
  const facts = readMedia(bytes)
  if (isMediaRefusal(facts)) return facts
  const extension = extname(String(name ?? '')).toLowerCase()
  const claimed = Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, extension) ? MEDIA_EXTENSIONS[extension] : null
  if (claimed === null) return facts
  const actual = familyOf(bytes)
  if (actual !== null && claimed !== actual) {
    return {
      error: 'mismatch',
      message: `That file is called "${basename(String(name))}", but its bytes are a ${mediaName(facts)}, not ${extension === '.svg' ? 'an SVG' : `a ${extension.slice(1).toUpperCase()}`}. Orbis goes by the bytes, and it does not keep a file whose name and contents disagree: rename it to ${mediaExtension(facts.format)} if that is what it is.`
    }
  }
  return facts
}

export interface MediaImport {
  body: MediaBody
  title: string
  /** Where it came from, in the words a person would use. The artifact's `source`. */
  source: string
  format: MediaFormatId
  notes: string[]
  /** The bytes to store as the content file, exactly as they arrived. */
  bytes: Uint8Array
  /** One line for a card: "PNG picture, 1920 × 1080, 2.1 MB". */
  describe: string
}

/**
 * A file read into something the engine can keep, or a refusal.
 *
 * The same shape `importFile` returns for a table or a document, plus the bytes -- because for these three kinds the
 * bytes cannot be rebuilt from the body and have to travel with it as far as the one write.
 */
export function importMedia(name: string, bytes: Uint8Array, about: { from?: string; title?: string } = {}): MediaImport | MediaRefusal {
  const facts = inspectMedia(name, bytes)
  if (isMediaRefusal(facts)) return facts
  const file = basename(String(name ?? ''))
  const from = about.from ?? (file === '' ? 'kept in Orbis' : `file: ${file}`)
  const title = safeName(String(about.title ?? '').trim() || titleOf(file), MEDIA_KIND_WORDS[facts.kind].name)
  const extension = extname(file).toLowerCase()
  const notes = [describeMedia(facts), ...facts.notes]
  if (extension === '' || !Object.prototype.hasOwnProperty.call(MEDIA_EXTENSIONS, extension)) {
    notes.push(`The name did not say what kind of file this is, so Orbis went by its first bytes: a ${mediaName(facts)}.`)
  }
  return { body: mediaBodyOf(facts, from), title, source: from, format: facts.format, notes, bytes, describe: describeMedia(facts) }
}

/** Only the three types the chat's own picture path produces, matching `image:save` in src/main/index.ts exactly. */
const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i

/**
 * A picture the chat made, turned into bytes.
 *
 * A generated picture is a `data:` URL in the main process today and nothing else; this is the one step that makes it
 * a file. The type written into the URL is not believed: the bytes go straight to `importMedia`, which reads what
 * they really are. The prompt becomes the title, and `from` says where it came from, so an artifact made this way can
 * never be mistaken for a photograph somebody took.
 */
export function mediaFromDataUrl(dataUrl: string, about: { title?: string; from: string }): MediaImport | MediaRefusal {
  const match = DATA_URL.exec(String(dataUrl ?? ''))
  if (!match) return { error: 'not-media', message: 'That picture could not be read: Orbis keeps a PNG, a JPEG, a WebP or a GIF, and this was none of them.' }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(Buffer.from(match[2], 'base64'))
  } catch {
    return { error: 'damaged', message: 'That picture could not be read back out of the message it was in.' }
  }
  const title = safeName(titleFromText(String(about.title ?? ''), 'Picture'), 'Picture')
  // There is no file name here, and that is the point: the bytes are the only evidence, which is how the reader
  // prefers it. The title is what the person asked for, not what a URL claimed the type was.
  return importMedia(title, bytes, { from: about.from, title })
}

/**
 * Nothing is lost, because nothing is converted.
 *
 * Every other kind reports what a format drops on the way out. Here the stored copy and the saved copy are the same
 * bytes as the file that arrived, so there is nothing to drop and saying "lossy" would be false. What a picture
 * format itself threw away before Orbis ever saw it -- the quality a JPEG gave up when it was made -- is not
 * Orbis's to report, and guessing at it would be inventing.
 */
const MEDIA_LOSS: LossReport = Object.freeze({
  lossy: false,
  losses: [],
  carries: Object.freeze({ units: false, types: false, metadata: false, formatting: true, provenance: false, hierarchy: false })
})

/**
 * What the one write needs: the bytes, and the words the secret gate reads.
 *
 * Shaped to drop into `keep()` where `render()`'s result goes. There is no `text`, because a picture has none, and
 * `scan` is the title, where it came from and the notes -- never the bytes. A JPEG's bytes scanned for things that
 * look like keys would match by accident, loudly and forever, and there are no words in them to find.
 */
export interface MediaRendered {
  bytes: Uint8Array
  text: null
  scan: string
  format: MediaKindId
  hash: string
  loss: LossReport
  notes: string[]
  size?: { width: number; height: number }
}

export function mediaRendered(body: MediaBody, bytes: Uint8Array, title = ''): MediaRendered {
  const source = mediaIn(body)
  return {
    bytes,
    text: null,
    scan: [title, source.from, ...source.notes].filter((one) => one !== '').join('\n'),
    format: source.kind,
    hash: source.hash,
    loss: MEDIA_LOSS,
    notes: [],
    ...(source.width !== null && source.height !== null ? { size: { width: source.width, height: source.height } } : {})
  }
}

/**
 * The picture a card shows, bounded, or nothing.
 *
 * Content does not cross to the interface -- a record and a bounded preview do. For a drawing the bounded preview is
 * the SVG text the window turns into a `data:` URL itself; for a picture it is the same idea with the base64 already
 * done, which is also exactly how a picture made in the chat reaches the screen today. So the renderer needs no new
 * channel and no new element: an `<img src={preview}>` where a drawing has one.
 *
 * A picture over the ceiling gets no preview at all, and the card says its size in words instead. The honest reason:
 * making a thumbnail means decoding the picture, Orbis has a decoder for PNG only, and re-encoding would break the
 * one rule this kind is built on. A sound and a video never get one -- their bytes are the whole file, there is no
 * bounded piece of a video, and a player would need a way to serve the stored file to the window that does not exist.
 */
export function mediaPreview(source: MediaSource, bytes: Uint8Array): string {
  if (source.kind !== 'image') return ''
  if (bytes.length > MEDIA_LIMITS.previewBytes) return ''
  return `data:${source.mediaType};base64,${Buffer.from(bytes).toString('base64')}`
}

/** Why there is no picture on the card, in words, when there could have been one. */
export function previewRefusal(source: MediaSource): string {
  if (source.kind === 'image') {
    return source.bytes > MEDIA_LIMITS.previewBytes
      ? `This picture is ${(source.bytes / (1024 * 1024)).toFixed(1)} MB, too large to show here without changing it. Save it, or open it in a picture program.`
      : ''
  }
  return source.kind === 'audio'
    ? 'Orbis keeps this sound and checks it, and does not play it. Save it to listen to it.'
    : 'Orbis keeps this video and checks it, and does not play it. Save it to watch it.'
}

/** The facts a question in the chat may be answered from. Metadata only: there is nothing else to tell. */
export function mediaContext(source: MediaSource, title: string): string {
  const lines = [
    `${title} is a ${mediaName(source)}.`,
    `Size on disk: ${(source.bytes / 1024).toFixed(1)} KB.`,
    source.width !== null && source.height !== null ? `${source.width} × ${source.height} pixels.` : 'It does not say how big it is.',
    source.durationMs !== null ? `Length: ${Math.round(source.durationMs / 1000)} seconds.` : 'It does not say how long it is.',
    `Where it came from: ${source.from}.`,
    `Orbis has not looked inside it. It cannot say what is in the ${MEDIA_KIND_WORDS[source.kind].word}, only what the file says about itself.`
  ]
  return lines.join('\n')
}
