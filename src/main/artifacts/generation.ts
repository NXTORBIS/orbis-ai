import { buildTable, isDataError, type Column } from '../../shared/compute/data.ts'
import { readSteps, stepInstructions, type TransformStep } from '../../shared/artifacts/transform.ts'
import { emptyDocument, fromMarkdown, isDocumentError } from '../../shared/compute/document.ts'
import { ARTIFACT_KINDS, describeKinds, type ArtifactKindId } from '../../shared/artifacts/kinds.ts'
import { flowToArtifact } from '../../shared/artifacts/diagram.ts'
import type { ArtifactBody } from '../../shared/artifacts/model.ts'
import { buildable, PLAN_LIMITS, readProposal, type CreationIntent, type Problem } from '../../shared/artifacts/plan.ts'
import { modelsFor, PROVIDERS, refusalKind } from '../../shared/providers.ts'

/**
 * A sentence turned into something Orbis can keep.
 *
 * The division of labour is the one the whole Creation Engine rests on. Orion is asked for *what*: which kind of
 * thing, what to call it, which columns, or the prose of a document. Everything after that is deterministic: the
 * proposal is checked against the kinds table, the table is built by `buildTable` with the types the model named, the
 * Markdown is parsed by the same parser a pasted document goes through, and what comes out is kept, read back and
 * verified exactly as pasted text is. A model never writes a file, never names a path, and never computes a number
 * Orbis then trusts.
 *
 * Asked once, then once more with the complaint. The failures the validator produces are specific -- "columns[2] has
 * no name" -- and a specific complaint is something a model can act on. Nothing came back at all is not argued with:
 * there is nothing to be specific about, and it is also what no key looks like.
 *
 * The request to the model is made here rather than through the shared `requestJson`, because that helper turns every
 * failure into null, and a person who asked for a report deserves to be told "Orion is busy" rather than "nothing".
 */

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type Asked = { json: Record<string, unknown> } | { failed: string }

export interface GenerationOptions {
  /** Groq keys. */
  apiKeys(): Promise<string[]>
  mistralKeys?(): string[]
  fetchFn: FetchFn
  /** Replaces the request to the model entirely. For tests, and for a copy of Orbis that answers some other way. */
  ask?(system: string, user: string): Promise<Asked>
}

export interface StepsOutcome {
  /** The steps, when the model produced a list that reads and runs. */
  steps: TransformStep[] | null
  problems: string[]
  attempts: { said: string; problems: string[] }[]
  /** Set when nothing came back at all, with the reason. */
  failed: string | null
}

export interface GenerateOutcome {
  body: ArtifactBody | null
  intent: CreationIntent | null
  /** What a person should know about where this came from. Kept with the artifact. */
  notes: string[]
  problems: Problem[]
  attempts: { said: string; problems: string[] }[]
  /** Why no attempt could be made at all, when none could. */
  failed: string | null
}

const REQUEST_TIMEOUT_MS = 90_000
const MAX_TOKENS = 6000

/** What the model is told. Built each time from the kinds table, so it never names a kind Orbis cannot make. */
export function instructions(): string {
  // Only the kinds a model may name. A chart is made from a table's numbers, so it is not offered as a thing to write.
  const kinds = describeKinds()
    .filter((kind) => ARTIFACT_KINDS[kind.id as ArtifactKindId].orionMayName)
    .map((kind) => `- "${kind.id}": ${kind.describe} Formats: ${kind.writes.map((one) => one.format).join(', ')}.`)
    .join('\n')
  return `You turn a person's request into one thing Orbis will make. Answer with ONE JSON object and nothing else.

Orbis can make exactly these kinds:
${kinds}

The object:
{
  "kind": one of the kinds above,
  "title": a short name a person would call it (at most 12 words),
  "purpose": one sentence on what it is for,
  "format": optional, one of that kind's formats,
  "columns": for a table only -- a list of {"name", "type", "unit"}; type is one of text, number, integer, boolean, date, category, quantity; unit only for a quantity,
  "rows": for a table only -- optional example rows, each a list of cell values in column order,
  "markdown": for a document only -- the whole document, written as Markdown with headings, paragraphs, lists and tables,
  "nodes": for a diagram only -- a list of {"id", "label", "shape"}; shape is one of step, decision, start, end,
  "edges": for a diagram only -- a list of {"from", "to", "label"} joining node ids; label the branches of a decision ("yes", "no")
}

Rules:
- Choose "table" for anything that is rows and columns: a tracker, a log, a register, a schedule, a list of records. Choose "document" for prose: a report, a letter, a plan, notes, a guide. Choose "diagram" for a flow, a process, steps with decisions, an org chart: boxes and arrows. Never give positions; Orbis lays a diagram out.
- Never invent real-world figures, statistics, prices, names of real people, or sources. If the person wants a real figure that you do not have, write a clearly marked placeholder such as "(fill in)" rather than a number.
- For a table, leave "rows" empty unless the person asked for examples or sample data. Example rows must be obviously illustrative.
- Write dates as YYYY-MM-DD.
- Never include a password, an API key or a token, even as an example.
- Write the document or the columns completely. Do not describe what you would write; write it.`
}

export class ArtifactGeneration {
  private readonly o: GenerationOptions
  private sequence = 0

  constructor(options: GenerationOptions) {
    this.o = options
  }

  async generate(request: string): Promise<GenerateOutcome> {
    const asked = String(request ?? '').trim().slice(0, PLAN_LIMITS.request)
    const attempts: GenerateOutcome['attempts'] = []
    if (asked === '') return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: 'Say what you want made.' }], attempts, failed: null }

    let complaint: string | null = null
    let lastProblems: Problem[] = []
    for (let round = 0; round < 2; round++) {
      const user =
        complaint === null
          ? asked
          : `${asked}

The last answer did not work. What was wrong:
${complaint}

Answer again, fixing those. Everything else about the format is the same.`
      const answer = await (this.o.ask ? this.o.ask(instructions(), user) : this.askJson(instructions(), user))
      if ('failed' in answer) {
        attempts.push({ said: '(nothing came back)', problems: [answer.failed] })
        return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: answer.failed }], attempts, failed: answer.failed }
      }

      const read = readProposal(answer.json)
      lastProblems = read.problems
      attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: read.problems.map((p) => `${p.severity}: ${p.message}`) })

      if (read.proposal && buildable(read.problems)) {
        const made = this.materialise(read.proposal, asked)
        if ('error' in made) {
          lastProblems = [...read.problems, { severity: 'error', message: made.error }]
          attempts[attempts.length - 1].problems.push(`error: ${made.error}`)
          complaint = `- ${made.error}`
          continue
        }
        const warnings = read.problems.filter((p) => p.severity === 'warning').map((p) => p.message)
        return { body: made.body, intent: read.proposal.intent, notes: [...made.notes, ...warnings], problems: read.problems, attempts, failed: null }
      }

      const errors = read.problems.filter((p) => p.severity === 'error')
      if (!errors.length) break
      complaint = errors.map((p) => `- ${p.message}`).join('\n')
    }

    return { body: null, intent: null, notes: [], problems: lastProblems, attempts, failed: null }
  }

  /**
   * A request to change a table, turned into steps.
   *
   * The model is given the column names and types and none of the data, and gives back a plan the engine runs. The
   * plan is read by the same validator a hand-written one goes through, then tried against the real table by
   * `check` -- so "there is no column called X" from the engine is argued with once, exactly as a malformed step is.
   */
  async planSteps(request: string, columns: readonly Pick<Column, 'name' | 'type'>[], check: (steps: TransformStep[]) => string | null): Promise<StepsOutcome> {
    const asked = request.trim().slice(0, 2000)
    const attempts: StepsOutcome['attempts'] = []
    if (asked === '') return { steps: null, problems: ['Say what you want changed.'], attempts, failed: null }
    const system = stepInstructions(columns)
    let complaint: string | null = null
    let lastProblems: string[] = []
    for (let round = 0; round < 2; round++) {
      const user =
        complaint === null
          ? asked
          : `${asked}

The last answer did not work. What was wrong:
${complaint}

Answer again, fixing those. Everything else about the format is the same.`
      const answer = await (this.o.ask ? this.o.ask(system, user) : this.askJson(system, user))
      if ('failed' in answer) {
        attempts.push({ said: '(nothing came back)', problems: [answer.failed] })
        return { steps: null, problems: [answer.failed], attempts, failed: answer.failed }
      }
      // A model that says it cannot is believed, and its reason is the answer: arguing would only produce steps that
      // do something other than what was asked.
      const cannot = typeof answer.json.cannot === 'string' ? answer.json.cannot.trim().slice(0, 300) : ''
      if (cannot !== '' && Array.isArray(answer.json.steps) && answer.json.steps.length === 0) {
        attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: [cannot] })
        return { steps: null, problems: [`That cannot be done with the steps Orbis has: ${cannot}`], attempts, failed: null }
      }
      const read = readSteps(answer.json)
      const engine = read.problems.length === 0 ? check(read.steps) : null
      lastProblems = engine ? [engine] : read.problems
      attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: lastProblems })
      if (lastProblems.length === 0) return { steps: read.steps, problems: [], attempts, failed: null }
      complaint = lastProblems.map((one) => `- ${one}`).join('\n')
    }
    return { steps: null, problems: lastProblems, attempts, failed: null }
  }

  /** The checked proposal, built with the deterministic code a pasted artifact goes through. */
  private materialise(proposal: Exclude<ReturnType<typeof readProposal>['proposal'], null>, asked: string): { body: ArtifactBody; notes: string[] } | { error: string } {
    const source = `Orion, asked for: ${asked.slice(0, 160)}`
    if (proposal.table) {
      const table = buildTable(
        proposal.table.columns.map((one) => one.name),
        proposal.table.rows,
        {
          source,
          types: proposal.table.columns.map((one) => one.type),
          units: proposal.table.columns.map((one) => one.unit)
        }
      )
      if (isDataError(table)) return { error: `The table could not be built: ${table.message}` }
      const notes = ['The columns were chosen by a model from your request.']
      if (proposal.table.rows.length > 0) notes.push('The rows are examples written by a model. They are not records of anything real.')
      return { body: { kind: 'table', table }, notes }
    }
    if (proposal.diagram) {
      const diagram = flowToArtifact({ title: proposal.intent.title, nodes: proposal.diagram.nodes, edges: proposal.diagram.edges })
      if (diagram.objects.length === 0) return { error: 'The diagram came back with no boxes.' }
      return {
        body: { kind: 'diagram', diagram },
        notes: ['The boxes and arrows were chosen by a model from your request; where they sit was worked out by Orbis.']
      }
    }
    const parsed = fromMarkdown(proposal.markdown, 'b')
    if (isDocumentError(parsed)) return { error: `The document could not be read: ${parsed.message}` }
    if (parsed.blocks.length === 0) return { error: 'The document came back empty.' }
    const document = emptyDocument('document', proposal.intent.title)
    document.blocks = parsed.blocks
    document.metadata.source = source
    return {
      body: { kind: 'document', document },
      notes: ['The text was written by a model from your request. Any figure in it was written, not measured or computed by Orbis.']
    }
  }

  /**
   * One request for one JSON answer, with the real reason when there is none.
   *
   * Walks the provider ladder for ordinary text, best model first, and every key for each; a key that is refused or
   * busy is skipped rather than retried. A model is sent only to its own service, with its own keys -- a Groq key at
   * Mistral's address is not a slow key, it is an authentication failure dressed as unreliability.
   */
  private async askJson(system: string, user: string): Promise<Asked> {
    const groq = await this.o.apiKeys()
    const mistral = this.o.mistralKeys?.() ?? []
    const choices = modelsFor('text', { groq: groq.length > 0, mistral: mistral.length > 0 })
    if (!choices.length) return { failed: 'Orion is not set up on this computer, so there is nothing to write it with.' }

    let last = 'Orion could not be reached. Check the connection and try again.'
    for (const choice of choices) {
      const keys = choice.provider === 'groq' ? groq : mistral
      // Start at a different key each time, so several requests spread across the keys rather than queue on one.
      const start = this.sequence++ % Math.max(1, keys.length)
      for (let i = 0; i < keys.length; i++) {
        const key = keys[(start + i) % keys.length]
        let res: Response
        try {
          res = await this.o.fetchFn(`${PROVIDERS[choice.provider].baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: choice.model,
              ...(choice.provider === 'groq' ? { max_completion_tokens: MAX_TOKENS } : { max_tokens: MAX_TOKENS }),
              temperature: 0.4,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          })
        } catch (err) {
          last = err instanceof Error && err.name === 'TimeoutError' ? 'Orion took too long to write it.' : 'Orion could not be reached. Check the connection and try again.'
          continue
        }
        if (!res.ok) {
          const body = await res.text().catch(() => '')
          const kind = refusalKind(res.status, body)
          if (kind === 'bad-key') last = 'Orion refused the request: the access it was set up with is not accepted.'
          else if (kind === 'not-allowed') {
            last = `The service does not allow ${choice.model} on this account.`
            // Every key on this account is refused the same model; the next model is the thing to try.
            break
          } else if (kind === 'busy') last = 'Orion is busy right now. Try again in a minute.'
          else if (res.status === 413) last = 'That request is too large for Orion in one go.'
          else last = `Orion could not answer (it returned ${res.status}).`
          continue
        }
        try {
          const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
          const content = String(payload.choices?.[0]?.message?.content ?? '')
          const parsed: unknown = JSON.parse(stripFences(content))
          if (parsed && typeof parsed === 'object') return { json: parsed as Record<string, unknown> }
          last = 'Orion answered, but not with something Orbis could read.'
        } catch {
          last = 'Orion answered, but not with something Orbis could read.'
        }
      }
    }
    return { failed: last }
  }
}

/** A JSON answer with the code fence some models put round it removed. */
const stripFences = (text: string): string => {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}
