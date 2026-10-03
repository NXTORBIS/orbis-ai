/**
 * Finding the parts of several attached files that actually answer a question.
 *
 * Attachments were flattened: every file's text, one after another, into the message. That works for one short file
 * and fails in two ways as soon as there are several. The budget runs out, so the later files are cut to nothing and
 * the answer is confidently based on half the evidence; and the model has to find the relevant paragraph itself
 * inside sixty thousand characters of material, which is exactly the thing it is worst at.
 *
 * So the files are cut into passages, the passages are scored against the question, and the ones that answer it are
 * sent -- with the name of the file and where in it they came from, so the answer can say which file said what.
 *
 * Three rules:
 *
 * **Every file gets a hearing.** The best passages overall would let one long file crowd out a short one that
 * contained the actual answer, which is the failure this replaces. Each file contributes its best passages first, in
 * turn, before anything contributes a second round.
 *
 * **A file that was searched and had nothing is said, not dropped.** "Nothing in B matched" is information. Silently
 * omitting a file makes it look as though it was read and agreed.
 *
 * **Nothing is summarised here.** The passages are the file's own words, cut at boundaries. Shortening by rewriting
 * would put a paraphrase where the evidence should be.
 */

export interface AttachedFile {
  name: string
  text: string
}

export interface Passage {
  file: string
  /** Which passage of that file, counting from 1 -- so an answer can say roughly where it was. */
  at: number
  text: string
  /** How well it matched, 0 upwards. Zero means it was taken only to represent its file. */
  score: number
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu

const COMMON = new Set([
  'the','a','an','and','or','but','if','of','to','in','on','for','with','as','by','at','from','is','are','was','were','be','been','being','it','its','this','that','these','those','not','no','you','your','we','our','they','their','there','here','what','which','who','when','where','how','all','any','more','most','other','some','such','than','then','so','too','very','just','also','can','could','will','would','should','may','might','has','have','had','do','does','did','about','into','over','after','before','me','my','i'
])

const words = (text: string): string[] => (text.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 2 && !COMMON.has(w))

/** Roughly how long a passage should be. Long enough to carry an argument, short enough that several fit. */
export const PASSAGE_CHARS = 900

/**
 * A file cut into passages, at paragraph boundaries where there are any.
 *
 * Paragraphs rather than a fixed length because a table row or a sentence cut in half is evidence nobody can use, and
 * because a document's own breaks are where its author changed subject.
 */
export function passagesOf(file: AttachedFile): Passage[] {
  const blocks = file.text.split(/\n{2,}/).map((one) => one.trim()).filter(Boolean)
  const out: Passage[] = []
  let current = ''
  const push = (): void => {
    if (current.trim()) out.push({ file: file.name, at: out.length + 1, text: current.trim(), score: 0 })
    current = ''
  }
  for (const block of blocks.length ? blocks : [file.text.trim()].filter(Boolean)) {
    if (block.length > PASSAGE_CHARS * 2) {
      // A single enormous block (a CSV, a minified page) is cut by length, at a line where possible.
      push()
      for (let i = 0; i < block.length; i += PASSAGE_CHARS) {
        const slice = block.slice(i, i + PASSAGE_CHARS)
        const end = i + PASSAGE_CHARS < block.length ? slice.lastIndexOf('\n') : -1
        out.push({ file: file.name, at: out.length + 1, text: (end > PASSAGE_CHARS / 2 ? slice.slice(0, end) : slice).trim(), score: 0 })
      }
      continue
    }
    if (current.length + block.length > PASSAGE_CHARS) push()
    current = current ? `${current}\n\n${block}` : block
  }
  push()
  return out
}

/**
 * How well a passage answers a question.
 *
 * A word is worth more when it is rare across the files: a word in every passage distinguishes nothing, and a word in
 * one tells you exactly where to look. That is the whole of the ranking, and it is deliberately the simplest thing
 * that has that property rather than anything that needs a model.
 */
export function scorePassages(question: string, passages: readonly Passage[]): Passage[] {
  const wanted = [...new Set(words(question))]
  if (!wanted.length || !passages.length) return passages.map((one) => ({ ...one }))

  const inHowMany = new Map<string, number>()
  const bags = passages.map((one) => new Set(words(one.text)))
  for (const bag of bags) for (const word of bag) inHowMany.set(word, (inHowMany.get(word) ?? 0) + 1)

  return passages.map((one, i) => {
    let score = 0
    for (const word of wanted) {
      if (!bags[i].has(word)) continue
      const spread = inHowMany.get(word) ?? 1
      // Rarer across the set is worth more; a word in every passage is worth almost nothing.
      score += Math.log(1 + passages.length / spread)
    }
    return { ...one, score }
  })
}

export interface Chosen {
  passages: Passage[]
  /** Files that were searched and had nothing matching. Said, because silence looks like agreement. */
  nothingIn: string[]
  /** Files that had something, in the order they first contributed. */
  usedFrom: string[]
}

/**
 * The passages to send, within a budget, taking from each file in turn.
 *
 * Round-robin rather than best-overall: one long file would otherwise crowd out a short one holding the actual
 * answer, which is the exact failure flattening already had. A file whose best passage matched nothing at all still
 * gives its first passage on the first round, so "I looked at this file" is true of every file attached.
 */
export function chooseContext(question: string, files: readonly AttachedFile[], budget: number): Chosen {
  const real = files.filter((one) => one.text.trim() !== '')
  if (!real.length) return { passages: [], nothingIn: files.map((one) => one.name), usedFrom: [] }

  const byFile = real.map((file) => scorePassages(question, passagesOf(file)).sort((a, b) => b.score - a.score || a.at - b.at))

  const chosen: Passage[] = []
  const usedFrom: string[] = []
  let spent = 0
  const rounds = Math.max(...byFile.map((one) => one.length))
  for (let round = 0; round < rounds && spent < budget; round++) {
    for (let f = 0; f < byFile.length && spent < budget; f++) {
      const passage = byFile[f][round]
      if (!passage) continue
      // Past the first round, a passage that matched nothing is not worth the room.
      if (round > 0 && passage.score <= 0) continue
      if (spent + passage.text.length > budget && chosen.length) continue
      chosen.push(passage)
      spent += passage.text.length
      if (!usedFrom.includes(passage.file)) usedFrom.push(passage.file)
    }
  }

  const matched = new Set(chosen.filter((one) => one.score > 0).map((one) => one.file))
  return { passages: chosen, nothingIn: real.filter((one) => !matched.has(one.name)).map((one) => one.name), usedFrom }
}

const LF = String.fromCharCode(10)

/**
 * What to put in the message: the passages, each labelled with the file it came from.
 *
 * Labelled because an answer drawing on three files has to be able to say which one said what, and because a passage
 * with no source attached is indistinguishable from something the model remembered.
 */
export function contextFrom(chosen: Chosen): string {
  if (!chosen.passages.length) return ''
  const parts = chosen.passages.map((one) => `<from file="${one.file}" part="${one.at}">${LF}${one.text}${LF}</from>`)
  const note =
    chosen.nothingIn.length > 0
      ? `${LF}${LF}These files were searched and had nothing matching the question: ${chosen.nothingIn.join(', ')}. Say so if it matters; do not answer from them.`
      : ''
  return [
    'The relevant parts of the attached files. These are the files’ own words, not a summary, and the parts that did not match the question are not here.',
    'Say which file a claim comes from. Do not claim a file says something that is not in the text below.',
    ...parts,
    note
  ]
    .filter(Boolean)
    .join(LF)
}
