import { ARTIFACT_STATUS, type ChatArtifact, type StreamEvent } from '../../shared/types.ts'
import { FORMATS, type FormatId } from '../../shared/compute/interchange.ts'
import { ARTIFACT_KINDS, canWrite, type ArtifactKindId } from '../../shared/artifacts/kinds.ts'
import { isArtifactId, isConversationId, refOf, type ArtifactRecord } from '../../shared/artifacts/model.ts'
import { documentTextFromReply, titleFromText } from '../../shared/artifacts/naming.ts'
import { languageById } from '../../shared/artifacts/languages.ts'
import {
  chatIntentInstructions,
  chatIntentUser,
  kindForFormat,
  mightBeAboutArtifacts,
  plainMakeRequest,
  readChatIntent,
  type ChatArtifactIntent,
  type ChatIntentContext,
  type KnownArtifact
} from '../../shared/artifacts/chatIntent.ts'
import type { ArtifactGeneration } from './generation.ts'
import type { ArtifactResult, ArtifactService } from './service.ts'

/**
 * Making things from inside a conversation.
 *
 * A message arrives in the chat. This decides whether it asks for something Orbis keeps as a file -- to be made,
 * changed, drawn, put in another format, or asked about -- and if it does, does it with the same artifact service
 * the Create screen uses: one engine, one set of checks, one library. Nothing here builds a file. It turns "add a
 * monthly total" into an operation on the right artifact and turns the answer into a sentence and a card.
 *
 * What comes back says what the chat should do next:
 *   - not about artifacts: carry on and answer as usual;
 *   - a question about an artifact: answer as usual, with what the artifact holds put in front of the question --
 *     every figure in it worked out by Orbis first, not left to the model's arithmetic;
 *   - done: a sentence and one or more cards have been sent; finish the reply;
 *   - stopped, or failed with a sentence saying why.
 *
 * It never reports a thing as made before the service has kept it and read the copy back: the card is sent after
 * the service answers, with the record the service returned.
 *
 * No Electron in here. The model, the service and the way events reach the window are all handed in.
 */

export interface ArtifactChatOptions {
  service: ArtifactService
  generation: ArtifactGeneration
}

export interface ArtifactChatTurn {
  profileId: string
  /** The message just sent. */
  message: string
  /**
   * Files attached to it, as the text they hold. Pictures are left out: Orbis does not read them. `openAs` is the
   * name to open one under when it is made into an artifact -- a workbook arrives as rows of text, so it is opened as
   * rows of text.
   */
  attachments: { name: string; content: string; openAs?: string }[]
  /** Everything before it, oldest first, with the artifacts each reply showed. */
  history: { role: 'user' | 'assistant'; content: string; artifactIds: string[] }[]
  conversationId?: string
  incognito?: boolean
  signal: AbortSignal
  emit(event: StreamEvent): void
}

export type ArtifactChatOutcome =
  | { handled: 'no' }
  /** A question about an artifact: answer as usual, with this in front of the question. */
  | { handled: 'context'; context: string }
  | { handled: 'done' }
  | { handled: 'stopped' }
  | { handled: 'failed'; message: string }

type Kept = { record: ArtifactRecord; notes?: string[]; did?: string[] }

const MAX_KNOWN = 8

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

/** What an artifact is, in a few words a person would use. */
function describe(record: ArtifactRecord): string {
  const { rows, columns } = record.shape
  switch (record.kind) {
    case 'table':
      return rows === 0 ? `a table with ${plural(columns, 'column')} and no rows yet` : `a table with ${plural(rows, 'row')} and ${plural(columns, 'column')}`
    case 'document':
      // Headings, paragraphs, lists and tables, counted together. Not "parts": a long document is written in parts,
      // and that is a different number.
      return `a document of ${plural(rows, 'heading and paragraph', 'headings and paragraphs')}`
    case 'plot':
      return `a chart of ${plural(rows, 'point')} in ${plural(columns, 'series', 'series')}`
    case 'diagram':
      return `a flowchart with ${plural(rows, 'box', 'boxes')} and ${plural(columns, 'arrow')}`
    case 'code':
      return `a code file of ${plural(rows, 'line')}`
  }
}

const formatName = (format: FormatId): string => FORMATS[format].name

export class ArtifactChat {
  private readonly o: ArtifactChatOptions

  constructor(options: ArtifactChatOptions) {
    this.o = options
  }

  /** Decide, then do. For callers with nothing else to weigh the decision against. */
  async consider(turn: ArtifactChatTurn): Promise<ArtifactChatOutcome> {
    const intent = await this.decide(turn)
    if (intent === 'stopped') return { handled: 'stopped' }
    return intent ? this.carryOut(intent, turn) : { handled: 'no' }
  }

  /** The intent carried out. Every failure comes back as a sentence; nothing is thrown at the chat. */
  async carryOut(intent: ChatArtifactIntent, turn: ArtifactChatTurn): Promise<ArtifactChatOutcome> {
    try {
      return await this.act(intent, turn)
    } catch (err) {
      console.error(`[artifacts] a chat request (${intent.act}) failed`, err)
      return { handled: 'failed', message: err instanceof Error && err.message.length < 300 ? err.message : 'That did not work.' }
    }
  }

  /**
   * What the message is asking for, if it is asking for an artifact at all. Reads; changes nothing.
   *
   * Separate from doing it so the chat can run this next to its other question ("is this a browser task?") and only
   * then act, once, on whichever answer wins.
   */
  async decide(turn: ArtifactChatTurn): Promise<ChatArtifactIntent | null | 'stopped'> {
    const message = turn.message.trim()
    if (message === '') return null

    // What was made in this conversation: the ids its earlier replies showed, checked against the library. An id on
    // a message is something the window sent; only the id is believed, and only if the library has it.
    const shown = turn.history.flatMap((one) => one.artifactIds).filter(isArtifactId)
    const previousWasArtifact = [...turn.history].reverse().find((one) => one.role === 'assistant')?.artifactIds.some(isArtifactId) ?? false
    const hasReply = turn.history.some((one) => one.role === 'assistant' && one.content.trim() !== '')

    if (!mightBeAboutArtifacts(message, { artifacts: shown.length, previousWasArtifact, attachments: turn.attachments.length })) return null

    const known = await this.known(turn.profileId, shown, turn.conversationId)
    if (turn.signal.aborted) return 'stopped'
    const context: ChatIntentContext = { artifacts: known, previousWasArtifact: previousWasArtifact && known.length > 0, hasReply, attachments: turn.attachments.map((one) => one.name), message }

    const answer = await this.o.generation.askQuick(chatIntentInstructions(), chatIntentUser(context, turn.history.map((one) => ({ role: one.role, content: one.content }))), turn.signal)
    if (turn.signal.aborted) return 'stopped'
    // No model could be asked: only the plainest requests are acted on, and everything else is an ordinary reply.
    if ('failed' in answer) {
      console.warn(`[artifacts] the quick question about a chat message could not be asked: ${answer.failed}`)
      return plainMakeRequest(message)
    }
    return readChatIntent(answer.json, context)
  }

  /** The artifacts this conversation has, newest last, each read from the library as it is now. */
  private async known(profileId: string, shown: string[], conversationId: string | undefined): Promise<KnownArtifact[]> {
    const ids: string[] = []
    // What the library says was made for this conversation comes first, so a card lost to "regenerate" is still known.
    if (isConversationId(conversationId)) {
      const listed = await this.o.service.run(profileId, { operation: 'artifact.list', within: conversationId })
      if (listed.ok) for (const one of (listed.value as { record: ArtifactRecord }[]).sort((a, b) => a.record.createdAt - b.record.createdAt)) ids.push(one.record.artifactId)
    }
    for (const id of shown) {
      const at = ids.indexOf(id)
      if (at >= 0) ids.splice(at, 1)
      ids.push(id)
    }
    const out: KnownArtifact[] = []
    for (const artifactId of ids.slice(-MAX_KNOWN)) {
      const read = await this.o.service.run(profileId, { operation: 'artifact.read', artifactId })
      if (!read.ok) continue
      const value = read.value as { record: ArtifactRecord; columns: { name: string; type: string }[] }
      out.push({ handle: `A${out.length + 1}`, artifactId, title: value.record.title, kind: value.record.kind, columns: value.columns.map((one) => ({ name: one.name, type: one.type })) })
    }
    return out
  }

  // ---------------------------------------------------------------- doing it

  private async act(intent: ChatArtifactIntent, turn: ArtifactChatTurn): Promise<ArtifactChatOutcome> {
    const status = (message: string): void => turn.emit({ type: 'status', message })
    const run = (request: Record<string, unknown>): Promise<ArtifactResult> =>
      this.o.service.run(turn.profileId, { ...request, ...(isConversationId(turn.conversationId) ? { conversationId: turn.conversationId } : {}) }, turn.signal, status)
    const cards: ChatArtifact[] = []
    const said: string[] = []
    const card = (record: ArtifactRecord, action: ChatArtifact['action'], did: string[], format?: FormatId | null): void => {
      cards.push({ ref: refOf(record), action, did: did.slice(0, 8).map((one) => one.slice(0, 400)), ...(format && canWrite(record.kind, format) ? { format } : {}) })
    }
    const kept = (result: ArtifactResult): Kept | ArtifactChatOutcome => {
      if (result.ok) return result.value as Kept
      if (turn.signal.aborted || result.error === 'cancelled') return { handled: 'stopped' }
      return { handled: 'failed', message: failureSentence(result) }
    }
    const isOutcome = (value: Kept | ArtifactChatOutcome): value is ArtifactChatOutcome => 'handled' in value

    /**
     * The artifact to hand over in the format that was named, and what was done to get there.
     *
     * A document format for something that is not a document is a real conversion: the table, chart or code is put
     * into a document. A spreadsheet format for a document takes the document's first table out. Anything else is
     * said plainly rather than faked with a file extension.
     */
    const inFormat = async (record: ArtifactRecord, format: FormatId | null): Promise<{ record: ArtifactRecord; format: FormatId | null; extra: string | null } | ArtifactChatOutcome> => {
      if (!format || canWrite(record.kind, format)) return { record, format, extra: null }
      const wants = kindForFormat(format)
      if (wants === 'document' && record.kind !== 'document') {
        status(ARTIFACT_STATUS.building)
        const converted = kept(await run({ operation: 'artifact.asDocument', artifactId: record.artifactId }))
        if (isOutcome(converted)) return converted
        return { record: converted.record, format, extra: `To save it as ${formatName(format)}, I put it into a document, row for row, with nothing rewritten.` }
      }
      if (wants === 'table' && record.kind === 'document') {
        status(ARTIFACT_STATUS.building)
        const taken = await run({ operation: 'artifact.extractTable', artifactId: record.artifactId, index: 1 })
        if (taken.ok) return { record: (taken.value as Kept).record, format, extra: `To save it as ${formatName(format)}, I took the first table out of the document.` }
        return { record, format: null, extra: `It cannot be saved as ${formatName(format)}: ${taken.message}` }
      }
      const offered = ARTIFACT_KINDS[record.kind].writes.map((one) => formatName(one)).join(', ')
      return { record, format: null, extra: `${ARTIFACT_KINDS[record.kind].name === 'Code' ? 'Code' : `A ${ARTIFACT_KINDS[record.kind].name.toLowerCase()}`} cannot be saved as ${formatName(format)}. It can be saved as: ${offered}.` }
    }

    const previousReply = (): string => [...turn.history].reverse().find((one) => one.role === 'assistant' && one.content.trim() !== '')?.content ?? ''

    /** The attached file the message means -- the one it names, or the first -- kept as an artifact. */
    const keepAttachment = async (): Promise<ArtifactResult> => {
      const lower = turn.message.toLowerCase()
      const file = turn.attachments.find((one) => lower.includes(one.name.toLowerCase())) ?? turn.attachments[0]
      if (!file) return { ok: false, operation: 'artifact.import', error: 'bad-input', message: 'There is no attached file to make it from.' }
      return this.o.service.importBytes(turn.profileId, file.openAs ?? file.name, new TextEncoder().encode(file.content), { conversationId: turn.conversationId })
    }
    /** An attached data file kept as a table, for a chart or a report asked for in the same breath. */
    const tableFromAttachment = async (): Promise<KnownArtifact | ArtifactChatOutcome> => {
      status(ARTIFACT_STATUS.reading)
      const made = kept(await keepAttachment())
      if (isOutcome(made)) return made
      if (made.record.kind !== 'table') {
        // Kept a moment ago only to be drawn from. It is not a table, so it is not left behind as something nobody asked for.
        await this.o.service.run(turn.profileId, { operation: 'artifact.remove', artifactId: made.record.artifactId })
        return { handled: 'failed', message: `"${made.record.title}" did not read as a table, so there are no numbers in it to work from.` }
      }
      card(made.record, 'kept', made.record.notes)
      said.push(`I kept the attached file as **${made.record.title}**: ${describe(made.record)}. Nothing in it was rewritten.`)
      return { handle: 'A0', artifactId: made.record.artifactId, title: made.record.title, kind: 'table', columns: [] }
    }

    switch (intent.act) {
      case 'make': {
        // A report asked for about an attached data file: the file is kept as a table first, and the report is made
        // from the table like any other.
        let from = intent.target
        if (!from && intent.kind === 'document' && intent.source === 'attachment' && turn.attachments.some((one) => /\.(csv|tsv)$/i.test(one.openAs ?? one.name))) {
          const table = await tableFromAttachment()
          if ('handled' in table) return table
          from = table
        }
        // A report made out of a table is computed, not written: every figure in it is the data engine's.
        if (from?.kind === 'table' && intent.kind === 'document') {
          const source = from
          status(ARTIFACT_STATUS.reading)
          const analysed = kept(await run({ operation: 'artifact.analyse', artifactId: source.artifactId }))
          if (isOutcome(analysed)) return analysed
          let report = analysed.record
          const did = [`Every figure in it was worked out by Orbis from "${source.title}". None was written by a model.`]
          // One chart of the table, when one can be drawn, placed in the report as a figure.
          status(ARTIFACT_STATUS.drawing)
          const chart = await run({ operation: 'artifact.chart', artifactId: source.artifactId, request: 'Draw the one chart that shows this table best.' })
          if (turn.signal.aborted) return { handled: 'stopped' }
          if (chart.ok) {
            const drawn = (chart.value as Kept).record
            const placed = await run({ operation: 'artifact.place', artifactId: report.artifactId, figureId: drawn.artifactId })
            if (placed.ok) {
              report = (placed.value as Kept).record
              did.push(`It shows the chart "${drawn.title}", drawn from the same table.`)
            }
          } else {
            did.push('No chart was added: none could be drawn from this table.')
          }
          const ready = await inFormat(report, intent.format)
          if ('handled' in ready) return ready
          card(ready.record, 'made', did, ready.format)
          said.push(`I made **${ready.record.title}** from **${source.title}**: ${describe(ready.record)}. ${did.join(' ')}`)
          if (ready.extra) said.push(ready.extra)
          break
        }

        // "Put that in Excel", said about a reply that has a table in it: the table is there to be read, so it is
        // kept as it stands. Asking a model to write it out again would be a chance to change a number for nothing.
        if (!intent.target && intent.kind === 'table' && (intent.source === 'reply' || intent.source === 'message')) {
          const text = intent.source === 'reply' ? documentTextFromReply(previousReply()) : materialIn(turn.message)
          if (tableTextIn(text) !== text) return this.act({ ...intent, act: 'keep' }, turn)
        }

        status(ARTIFACT_STATUS.writing)
        // Material: another artifact, the reply before, an attached file, or nothing at all.
        let material = ''
        if (intent.target) material = (await this.o.service.contextOf(turn.profileId, intent.target.artifactId, 12_000))?.text ?? ''
        else if (intent.source === 'reply') material = previousReply()
        else if (intent.source === 'attachment') material = turn.attachments.map((one) => `File "${one.name}":\n${one.content}`).join('\n\n')
        else if (intent.source === 'message') material = turn.message
        const made = kept(await run({ operation: 'artifact.generate', request: intent.request, kind: intent.kind, ...(material ? { context: material } : {}) }))
        if (isOutcome(made)) return made
        const ready = await inFormat(made.record, intent.format)
        if ('handled' in ready) return ready
        if (ready.record.artifactId !== made.record.artifactId) card(made.record, 'made', made.record.notes)
        card(ready.record, 'made', ready.record.notes, ready.format)
        said.push(`I made **${made.record.title}**: ${describe(made.record)}.`)
        if (material.length > 14_000) said.push('The material was longer than Orion can be handed at once, so it was made from the first part of it.')
        if (ready.extra) said.push(ready.extra)
        break
      }

      case 'keep': {
        status(ARTIFACT_STATUS.building)
        let result: ArtifactResult
        if (intent.source === 'attachment') {
          result = await keepAttachment()
        } else {
          const text = intent.source === 'reply' ? documentTextFromReply(previousReply()) : materialIn(turn.message)
          if (text.trim() === '') return { handled: 'failed', message: intent.source === 'reply' ? 'There is no earlier reply to turn into a file.' : 'There is nothing in the message to make it from.' }
          const from = intent.source === 'reply' ? 'a chat reply' : 'typed into the chat'
          if (intent.kind === 'table') {
            result = await run({ operation: 'artifact.create', kind: 'table', title: titleFromText(text, 'Table'), text: tableTextIn(text), source: from })
            // The words held no table Orbis could read as one. Orion writes the table out from them, and the card says so.
            if (!result.ok && result.error === 'parse') {
              status(ARTIFACT_STATUS.writing)
              result = await run({ operation: 'artifact.generate', request: intent.request, kind: 'table', context: text })
            }
          } else if (intent.kind === 'code') {
            const fenced = /^```([A-Za-z0-9+#-]+)[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text.trim())
            const language = fenced ? languageById(fenced[1]) : null
            result = language
              ? await run({ operation: 'artifact.create', kind: 'code', title: `${language.name} from the chat`, language: language.id, text: `${fenced![2]}\n`, source: from })
              : await run({ operation: 'artifact.create', kind: 'document', title: titleFromText(text, 'Chat reply'), text, source: from })
          } else {
            result = await run({ operation: 'artifact.create', kind: 'document', title: titleFromText(text, 'Chat reply'), text, source: from })
          }
        }
        const made = kept(result)
        if (isOutcome(made)) return made
        const ready = await inFormat(made.record, intent.format)
        if ('handled' in ready) return ready
        if (ready.record.artifactId !== made.record.artifactId) card(made.record, 'kept', made.record.notes)
        card(ready.record, 'kept', ready.record.notes, ready.format)
        said.push(`I kept that as **${made.record.title}**: ${describe(made.record)}. Nothing in it was rewritten.`)
        if (ready.extra) said.push(ready.extra)
        break
      }

      case 'change': {
        const target = intent.target!
        if (target.kind === 'plot') return this.redraw(target, intent, turn, run, kept)
        status(ARTIFACT_STATUS.changing)
        const changed = kept(
          target.kind === 'table'
            ? await run({ operation: 'artifact.transform', artifactId: target.artifactId, request: intent.request })
            : await run({ operation: 'artifact.revise', artifactId: target.artifactId, request: intent.request })
        )
        if (isOutcome(changed)) return changed
        const did = changed.did ?? changed.record.notes.slice(0, 3)
        card(changed.record, 'changed', did)
        said.push(`I changed **${changed.record.title}**. It is now version ${changed.record.version}, and the one before is kept.${changed.did?.length ? ` ${changed.did.join(' ')}` : ''}`)
        break
      }

      case 'chart': {
        // "Chart the attached file": the file is kept as a table first, and the chart is drawn from the table.
        let target = intent.target
        if (!target) {
          const table = await tableFromAttachment()
          if ('handled' in table) return table
          target = table
        }
        if (target.kind === 'plot') return this.redraw(target, intent, turn, run, kept)
        status(ARTIFACT_STATUS.drawing)
        const drawn = kept(await run({ operation: 'artifact.chart', artifactId: target.artifactId, request: intent.request }))
        if (isOutcome(drawn)) return drawn
        card(drawn.record, 'drew', drawn.record.notes, intent.format)
        said.push(`I drew **${drawn.record.title}** from **${target.title}**. The numbers are the table's own.`)
        const cannot = notDrawable(turn.message)
        if (cannot) said.push(cannot)
        if (intent.into) {
          status(ARTIFACT_STATUS.building)
          const placed = await run({ operation: 'artifact.place', artifactId: intent.into.artifactId, figureId: drawn.record.artifactId })
          if (placed.ok) {
            const document = (placed.value as Kept).record
            card(document, 'changed', document.notes.slice(0, 1))
            said.push(`It is now a figure in **${document.title}**.`)
          } else if (turn.signal.aborted) return { handled: 'stopped' }
          else said.push(`It could not be put into **${intent.into.title}**: ${placed.message}`)
        }
        break
      }

      case 'export': {
        const target = intent.target!
        const read = await run({ operation: 'artifact.read', artifactId: target.artifactId })
        if (!read.ok) return { handled: 'failed', message: failureSentence(read) }
        const record = (read.value as { record: ArtifactRecord }).record
        const ready = await inFormat(record, intent.format)
        if ('handled' in ready) return ready
        card(ready.record, ready.record.artifactId === record.artifactId ? 'shown' : 'made', ready.record.artifactId === record.artifactId ? [] : ready.record.notes, ready.format)
        if (ready.format) said.push(`**${ready.record.title}** is ready as ${formatName(ready.format)}. Press Download on the card and it goes to your Downloads folder, checked after it is written.`)
        if (ready.extra) said.push(ready.extra)
        break
      }

      case 'ask': {
        const held = await this.o.service.contextOf(turn.profileId, intent.target!.artifactId)
        if (!held) return { handled: 'no' }
        return {
          handled: 'context',
          context: `The person is asking about something Orbis made and keeps for them in this conversation. This is what it holds (version ${held.version}). Answer from it and from nothing else. Any figure marked as worked out by Orbis is exact: quote it, never recompute it. Write each number as it is there: never add a currency sign, a unit or a percent sign that the table does not have. Just answer the question, in plain words: do not mention these notes, how they are laid out, or where in them a figure was found. If the answer needs rows that are not shown, say so.\n<<<\n${held.text}\n>>>`
        }
      }
    }

    if (turn.signal.aborted) return { handled: 'stopped' }
    if (cards.length === 0) return { handled: 'failed', message: said.join(' ') || 'Nothing was made.' }
    if (turn.incognito) said.push('This chat is incognito and will not be saved, but what was made is kept in Create until you remove it.')
    turn.emit({ type: 'delta', content: said.join('\n\n') })
    for (const one of cards) turn.emit({ type: 'artifact', artifact: one })
    return { handled: 'done' }
  }

  /** A chart there already is, drawn again from the table it came from: its next version, not another chart. */
  private async redraw(
    chart: KnownArtifact,
    intent: ChatArtifactIntent,
    turn: ArtifactChatTurn,
    run: (request: Record<string, unknown>) => Promise<ArtifactResult>,
    kept: (result: ArtifactResult) => Kept | ArtifactChatOutcome
  ): Promise<ArtifactChatOutcome> {
    const read = await run({ operation: 'artifact.read', artifactId: chart.artifactId })
    if (!read.ok) return { handled: 'failed', message: failureSentence(read) }
    const from = (read.value as { record: ArtifactRecord }).record.derivedFrom
    if (!from) return { handled: 'failed', message: `"${chart.title}" does not remember the table it was drawn from, so it cannot be redrawn. Draw a new chart from the table.` }
    turn.emit({ type: 'status', message: ARTIFACT_STATUS.drawing })
    const drawn = kept(await run({ operation: 'artifact.chart', artifactId: from.artifactId, request: intent.request, replace: chart.artifactId }))
    if ('handled' in drawn) return drawn
    const cannot = notDrawable(turn.message)
    turn.emit({ type: 'delta', content: `I redrew the chart: it is now **${drawn.record.title}**, version ${drawn.record.version}, and the one before is kept. The numbers are still the table's own.${cannot ? `\n\n${cannot}` : ''}` })
    turn.emit({ type: 'artifact', artifact: { ref: refOf(drawn.record), action: 'changed', did: drawn.record.notes.slice(0, 3), ...(intent.format && canWrite('plot', intent.format) ? { format: intent.format } : {}) } })
    return { handled: 'done' }
  }
}

const NOT_DRAWN = /\b(donut|doughnut|histogram|radar|spider|heat ?map|gantt|tree ?map|sankey|bubble|waterfall|funnel|box ?plot|candlestick|gauge)\b/i

/**
 * A sentence for when the message asked for a kind of chart Orbis does not draw.
 *
 * It draws lines, bars, points, areas, steps and pies. Asked for a histogram, it still draws what it can from the
 * same numbers -- and says so, because a bar chart handed over in answer to "a histogram" with nothing said looks
 * like the thing that was asked for and is not.
 */
export function notDrawable(message: string): string | null {
  const asked = NOT_DRAWN.exec(message)?.[1]
  return asked ? `Orbis does not draw a ${asked.toLowerCase()} chart yet. It draws lines, bars, points, areas, steps and pies, so this is one of those from the same numbers.` : null
}

/** Why something was not made, in a sentence a person can act on. The model's own mistakes are named, briefly. */
function failureSentence(result: Extract<ArtifactResult, { ok: false }>): string {
  if (result.error === 'secrets') return `${result.message} It was not written. Take the key or password out and ask again, or make it on the Create screen, which shows each one and lets you decide.`
  return result.message
}

/** The part of a message that is the material, when the request and the material came in one message. */
export function materialIn(message: string): string {
  const text = message.replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  // "Make a spreadsheet from this:" and then the data: everything after the first line is the material.
  if (lines.length > 1 && lines[0].trim().length <= 200) {
    const rest = lines.slice(1).join('\n').trim()
    if (rest !== '') return rest
  }
  // One line: the material is after the colon, if there is one.
  const colon = text.indexOf(':')
  return colon >= 0 && colon < 200 ? text.slice(colon + 1).trim() : ''
}

/**
 * The table in a piece of text, as text the table reader can read.
 *
 * A Markdown table is handed over from its first row to its last, with the sentences round it left out, because the
 * reader would otherwise take "Here is the table:" for a heading row. Anything else is handed over whole and the
 * reader decides.
 */
export function tableTextIn(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const ruled = lines.findIndex((line, i) => i > 0 && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line) && lines[i - 1].includes('|'))
  if (ruled < 0) return text
  let end = ruled + 1
  while (end < lines.length && lines[end].includes('|') && lines[end].trim() !== '') end += 1
  return lines.slice(ruled - 1, end).join('\n')
}

/** Which artifact kinds a chat request may ask to have made from nothing. For the caller that needs the list. */
export const CHAT_MAKEABLE: readonly ArtifactKindId[] = Object.freeze(['table', 'document', 'diagram', 'code'])
