import { buildTable, isDataError, type Column } from '../../shared/compute/data.ts'
import { readSteps, stepInstructions, type TransformStep } from '../../shared/artifacts/transform.ts'
import { checkSyntax, languageById, LANGUAGES } from '../../shared/artifacts/languages.ts'
import { compileJavaScript } from './codeCheck.ts'
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

/** Which of a table's columns to draw, and how. Names, not numbers. */
export interface ChartPlan {
  x: string
  y: string[]
  kind: 'line' | 'bar' | 'scatter' | 'area' | 'step'
}

export interface ChartOutcome {
  plan: ChartPlan | null
  problems: string[]
  attempts: { said: string; problems: string[] }[]
  failed: string | null
}

const CHART_KINDS = ['line', 'bar', 'scatter', 'area', 'step'] as const

/** What the model is told when it is asked which columns to draw. */
export function chartInstructions(columns: readonly Pick<Column, 'name' | 'type'>[]): string {
  return `You choose how to draw ONE chart from a table. Answer with JSON only: {"x": column name, "y": [column names], "kind": one of ${CHART_KINDS.join(', ')}}.

The table's columns (name: type):
${columns.map((one) => `  ${one.name}: ${one.type}`).join('\n')}

Rules:
- "x" is what runs along the bottom: a date, a category or a number. "y" is one to four columns that hold numbers.
- Use only the column names above, written exactly as they are.
- Choose "bar" to compare categories, "line" for something over time or in order, "scatter" for one number against another, "area" for a total over time, "step" for a level that changes at moments.
- You are not shown the data and must not write any values. You only choose columns.
- If no chart can be drawn from these columns (for example none holds numbers), answer {"cannot": "why, in one sentence"}.`
}

/** A chart plan read from a model's answer: every name has to be a column that is there. */
export function readChartPlan(raw: unknown, columns: readonly Pick<Column, 'name' | 'type'>[]): { plan: ChartPlan | null; problems: string[] } {
  const problems: string[] = []
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { plan: null, problems: ['The answer has to be one JSON object.'] }
  const r = raw as Record<string, unknown>
  const named = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const wanted = value.trim().toLowerCase()
    return columns.find((one) => one.name.toLowerCase() === wanted)?.name ?? null
  }
  const listed = columns.map((one) => one.name).join(', ')
  const x = named(r.x)
  if (!x) problems.push(`"x" has to be one of the columns: ${listed}. It was "${typeof r.x === 'string' ? r.x.slice(0, 60) : 'missing'}".`)
  const wantedY = (Array.isArray(r.y) ? r.y : [r.y]).filter((one) => one !== undefined && one !== null).slice(0, 4)
  const y: string[] = []
  for (const one of wantedY) {
    const found = named(one)
    if (!found) problems.push(`"y" names "${typeof one === 'string' ? one.slice(0, 60) : '?'}", which is not one of the columns: ${listed}.`)
    else if (!y.includes(found) && found !== x) y.push(found)
  }
  if (wantedY.length === 0) problems.push('"y" has to name at least one column to draw.')
  else if (y.length === 0 && problems.length === 0) problems.push('"y" has to name a column other than the one along the bottom.')
  const kind = typeof r.kind === 'string' ? r.kind.trim().toLowerCase() : ''
  const chosen = (CHART_KINDS as readonly string[]).includes(kind) ? (kind as ChartPlan['kind']) : 'line'
  return { plan: problems.length === 0 && x ? { x, y, kind: chosen } : null, problems }
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
/** How long the whole walk for a quick question may take, every key and model together. */
const QUICK_DEADLINE_MS = 7_000
/** What a request that the person stopped comes back as. One sentence, the same everywhere, so a caller can tell. */
export const STOPPED = 'Stopped.'
const MAX_TOKENS = 6000
/** Characters of the conversation handed over as material. Past this the request itself would not fit. */
const CONTEXT_LIMIT = 14_000

/** What the model is told when it is handed something that exists and asked to change it. */
export function reviseInstructions(kind: 'document' | 'diagram' | 'code', language = ''): string {
  const shape =
    kind === 'code'
      ? `{"code": the WHOLE revised ${language} file as text, with no Markdown fence around it}`
      : kind === 'document'
      ? `{"markdown": the WHOLE revised document, written as Markdown with headings, paragraphs, lists and tables}`
      : `{"nodes": the WHOLE revised list of {"id", "label", "shape"} (shape is one of step, decision, start, end), "edges": the WHOLE revised list of {"from", "to", "label"} joining node ids}`
  return `You revise ONE existing ${kind === 'document' ? 'document' : kind === 'code' ? `${language} file` : 'flowchart'} that Orbis keeps. Answer with ONE JSON object and nothing else:
${shape}

Rules:
- Make the change the person asked for and keep everything else exactly as it is${kind === 'diagram' ? ', with the same ids' : ', character for character'}.${kind === 'code' ? ' Orbis keeps the file and never runs it, so do not say it was tested.' : ''}
- Give back the whole thing. Not a description of the change, and not only the part that changed.
- Never invent real-world figures, statistics, prices, names of real people, or sources. Where a real figure is wanted and you do not have it, write a clearly marked placeholder such as "(fill in)".
- Never include a password, an API key or a token, even as an example.${kind === 'diagram' ? '\n- Never give positions; Orbis lays the flowchart out. Label the branches of a decision ("yes", "no").' : ''}`
}

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
  "edges": for a diagram only -- a list of {"from", "to", "label"} joining node ids; label the branches of a decision ("yes", "no"),
  "language": for code only -- one of: ${LANGUAGES.map((one) => one.id).join(', ')},
  "code": for code only -- the whole file as text, with no Markdown fence around it
}

Rules:
- Choose "table" for anything that is rows and columns: a tracker, a log, a register, a schedule, a list of records. Choose "document" for prose: a report, a letter, a plan, notes, a guide. Choose "diagram" for a flow, a process, steps with decisions, an org chart: boxes and arrows. Never give positions; Orbis lays a diagram out. Choose "code" when the person asks for a script, a program, a query, a web page's source or a settings file: one complete file in one language. Orbis keeps code and never runs it, so do not say it was tested.
- Never invent real-world figures, statistics, prices, names of real people, or sources. If the person wants a real figure that you do not have, write a clearly marked placeholder such as "(fill in)" rather than a number.
- For a table, leave "rows" empty unless the person asked for examples or sample data. Example rows must be obviously illustrative.
- Write dates as YYYY-MM-DD.
- Never include a password, an API key or a token, even as an example.
- Write the document or the columns completely. Do not describe what you would write; write it.`
}

/** The planner's own warning about rows a model wrote. Dropped when the rows turn out to be the person's figures. */
const EXAMPLE_ROWS_WARNING = /example rows? (was|were) written by a model/

/**
 * How many of the numbers in a table's rows are in what the person gave.
 *
 * "Use these revenues: 1200, 1800, 1500" and a model that writes those into rows has copied, not invented -- and a
 * card that calls the person's own figures "examples, not records of anything real" is wrong about the one thing it
 * exists to be right about. A number is theirs only if it is in their words or their material, digit for digit
 * (thousands separators aside). Anything else stays labelled as a model's.
 */
export function figuresGiven(rows: readonly (readonly unknown[])[], given: string): { numbers: number; found: number } {
  const said = new Set<number>()
  for (const match of given.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''))
    if (Number.isFinite(value)) said.add(value)
  }
  let numbers = 0
  let found = 0
  for (const row of rows) {
    for (const cell of row) {
      const text = typeof cell === 'number' ? String(cell) : typeof cell === 'string' ? cell.trim() : ''
      if (!/^-?\d[\d,]*(?:\.\d+)?$/.test(text)) continue
      numbers += 1
      if (said.has(Math.abs(Number(text.replace(/,/g, ''))))) found += 1
    }
  }
  return { numbers, found }
}

export class ArtifactGeneration {
  private readonly o: GenerationOptions
  private sequence = 0
  /** The key that last answered a quick question, per service, so refused keys are not walked past every time. */
  private readonly goodKey: Record<'groq' | 'mistral', number> = { groq: 0, mistral: 0 }

  constructor(options: GenerationOptions) {
    this.o = options
  }

  /**
   * `context` is material from the conversation the request leans on -- "make a report from this" -- handed to the
   * model as material and nothing more. `signal` stops it: a stopped request comes back as `failed: STOPPED`.
   */
  async generate(request: string, options: { context?: string; signal?: AbortSignal; kind?: ArtifactKindId } = {}): Promise<GenerateOutcome> {
    const asked = String(request ?? '').trim().slice(0, PLAN_LIMITS.request)
    const attempts: GenerateOutcome['attempts'] = []
    if (asked === '') return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: 'Say what you want made.' }], attempts, failed: null }

    const material = (options.context ?? '').trim().slice(0, CONTEXT_LIMIT)
    // When what kind of thing it is has already been settled ("a spreadsheet"), the model is told, and held to it below.
    const settled = options.kind ? `\n\nIt has to be a ${options.kind}: answer with "kind": "${options.kind}".` : ''
    const base = material === '' ? `${asked}${settled}` : `${asked}${settled}

Material from the conversation, to make it from. Use what is here; do not add facts or figures that are not, and write each number as it is there: never add a currency sign or a unit to a number that has none.
<<<
${material}
>>>`
    let complaint: string | null = null
    let lastProblems: Problem[] = []
    for (let round = 0; round < 2; round++) {
      const user =
        complaint === null
          ? base
          : `${base}

The last answer did not work. What was wrong:
${complaint}

Answer again, fixing those. Everything else about the format is the same.`
      const answer = await (this.o.ask ? this.o.ask(instructions(), user) : this.askJson(instructions(), user, options.signal))
      if ('failed' in answer) {
        attempts.push({ said: '(nothing came back)', problems: [answer.failed] })
        return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: answer.failed }], attempts, failed: answer.failed }
      }

      const read = readProposal(answer.json)
      // The kind that was settled on is not the model's to change.
      if (read.proposal && options.kind && read.proposal.intent.kind !== options.kind) {
        read.problems.push({ severity: 'error', message: `"kind" has to be "${options.kind}"; it was "${read.proposal.intent.kind}".` })
        read.proposal = null
      }
      lastProblems = read.problems
      attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: read.problems.map((p) => `${p.severity}: ${p.message}`) })

      if (read.proposal && buildable(read.problems)) {
        const made = this.materialise(read.proposal, asked, `${asked}\n${material}`)
        if ('error' in made) {
          lastProblems = [...read.problems, { severity: 'error', message: made.error }]
          attempts[attempts.length - 1].problems.push(`error: ${made.error}`)
          complaint = `- ${made.error}`
          continue
        }
        // Rows copied out of what the person gave are not examples, and are not called examples a second time.
        const warnings = read.problems.filter((p) => p.severity === 'warning' && !(made.copied && EXAMPLE_ROWS_WARNING.test(p.message))).map((p) => p.message)
        return { body: made.body, intent: read.proposal.intent, notes: [...made.notes, ...warnings], problems: read.problems, attempts, failed: null }
      }

      const errors = read.problems.filter((p) => p.severity === 'error')
      if (!errors.length) break
      complaint = errors.map((p) => `- ${p.message}`).join('\n')
    }

    return { body: null, intent: null, notes: [], problems: lastProblems, attempts, failed: null }
  }

  /**
   * An existing document or flowchart, revised by an instruction.
   *
   * The model is handed the whole thing and gives the whole thing back; what comes back goes through the same
   * validator and the same builders as something made from nothing, so a revision cannot be a different kind of
   * object from an original. The kind and the title are Orbis's, not the model's: it is asked to change the content,
   * and an answer that tries to turn a document into a table is read as a document or refused.
   */
  async revise(kind: 'document' | 'diagram' | 'code', title: string, current: string, request: string, language = '', signal?: AbortSignal): Promise<GenerateOutcome> {
    const asked = request.trim().slice(0, 2000)
    const attempts: GenerateOutcome['attempts'] = []
    if (asked === '') return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: 'Say what you want changed.' }], attempts, failed: null }
    const system = reviseInstructions(kind, languageById(language)?.name ?? language)
    const base = `The ${kind === 'document' ? 'document' : kind === 'code' ? 'file' : 'flowchart'} as it is now:
<<<
${current}
>>>

The change asked for: ${asked}`
    let complaint: string | null = null
    let lastProblems: Problem[] = []
    for (let round = 0; round < 2; round++) {
      const user =
        complaint === null
          ? base
          : `${base}

The last answer did not work. What was wrong:
${complaint}

Answer again, fixing those. Everything else about the format is the same.`
      const answer = await (this.o.ask ? this.o.ask(system, user) : this.askJson(system, user, signal))
      if ('failed' in answer) {
        attempts.push({ said: '(nothing came back)', problems: [answer.failed] })
        return { body: null, intent: null, notes: [], problems: [{ severity: 'error', message: answer.failed }], attempts, failed: answer.failed }
      }
      // Only the content is taken from the answer. What it is and what it is called were decided before the model was asked.
      const content = kind === 'document' ? { markdown: answer.json.markdown } : kind === 'code' ? { language, code: answer.json.code } : { nodes: answer.json.nodes, edges: answer.json.edges }
      const read = readProposal({ ...content, kind, title, purpose: asked })
      lastProblems = read.problems
      attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: read.problems.map((p) => `${p.severity}: ${p.message}`) })
      if (read.proposal && buildable(read.problems)) {
        const made = this.materialise(read.proposal, asked)
        if (!('error' in made)) return { body: made.body, intent: read.proposal.intent, notes: made.notes, problems: read.problems, attempts, failed: null }
        lastProblems = [...read.problems, { severity: 'error', message: made.error }]
        attempts[attempts.length - 1].problems.push(`error: ${made.error}`)
        complaint = `- ${made.error}`
        continue
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
  async planSteps(request: string, columns: readonly Pick<Column, 'name' | 'type'>[], check: (steps: TransformStep[]) => string | null, signal?: AbortSignal): Promise<StepsOutcome> {
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
      const answer = await (this.o.ask ? this.o.ask(system, user) : this.askJson(system, user, signal))
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

  /**
   * Which columns to draw, from a sentence.
   *
   * The model is shown the column names and types and none of the numbers, and names an x column, the columns to draw
   * and how. `check` is the service trying exactly that against the real table, so a column that is not there or has
   * no numbers in it is argued with once, like any other fault. Nothing a model says here becomes a number on a chart:
   * it chooses which of the table's own columns are drawn.
   */
  async planChart(request: string, columns: readonly Pick<Column, 'name' | 'type'>[], check: (plan: ChartPlan) => string | null, signal?: AbortSignal): Promise<ChartOutcome> {
    const asked = request.trim().slice(0, 2000)
    const attempts: ChartOutcome['attempts'] = []
    const system = chartInstructions(columns)
    let complaint: string | null = null
    let lastProblems: string[] = []
    for (let round = 0; round < 2; round++) {
      const base = asked === '' ? 'Draw the chart that shows this table best.' : asked
      const user = complaint === null ? base : `${base}\n\nThe last answer did not work. What was wrong:\n${complaint}\n\nAnswer again, fixing those. Everything else about the format is the same.`
      const answer = await (this.o.ask ? this.o.ask(system, user) : this.askJson(system, user, signal, 600))
      if ('failed' in answer) {
        attempts.push({ said: '(nothing came back)', problems: [answer.failed] })
        return { plan: null, problems: [answer.failed], attempts, failed: answer.failed }
      }
      const cannot = typeof answer.json.cannot === 'string' ? answer.json.cannot.trim().slice(0, 300) : ''
      if (cannot !== '' && typeof answer.json.x !== 'string') {
        attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: [cannot] })
        return { plan: null, problems: [`That chart cannot be drawn from this table: ${cannot}`], attempts, failed: null }
      }
      const read = readChartPlan(answer.json, columns)
      const engine = read.plan ? check(read.plan) : null
      lastProblems = engine ? [engine] : read.problems
      attempts.push({ said: JSON.stringify(answer.json).slice(0, 300), problems: lastProblems })
      if (read.plan && lastProblems.length === 0) return { plan: read.plan, problems: [], attempts, failed: null }
      complaint = lastProblems.map((one) => `- ${one}`).join('\n')
    }
    return { plan: null, problems: lastProblems, attempts, failed: null }
  }

  /** The checked proposal, built with the deterministic code a pasted artifact goes through. */
  private materialise(
    proposal: Exclude<ReturnType<typeof readProposal>['proposal'], null>,
    asked: string,
    given = asked
  ): { body: ArtifactBody; notes: string[]; copied?: boolean } | { error: string } {
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
      // Whose numbers are in the rows: the person's own, written out, or a model's, made up as examples. Decided by
      // looking, not by asking the model: a number counts as theirs only if it is in what they gave.
      const figures = figuresGiven(proposal.table.rows, given)
      const copied = figures.numbers > 0 && figures.found === figures.numbers
      if (copied) notes.push('The rows were written out by a model from what you gave. Every number in them is one you gave; check that each is in the right place.')
      else if (figures.found > 0) notes.push(`${figures.found} of the ${figures.numbers} numbers in the rows are ones you gave. The rest were written by a model: treat them as examples, not records.`)
      else if (proposal.table.rows.length > 0) notes.push('The rows are examples written by a model. They are not records of anything real.')
      return { body: { kind: 'table', table }, notes, copied }
    }
    if (proposal.diagram) {
      const diagram = flowToArtifact({ title: proposal.intent.title, nodes: proposal.diagram.nodes, edges: proposal.diagram.edges })
      if (diagram.objects.length === 0) return { error: 'The diagram came back with no boxes.' }
      return {
        body: { kind: 'diagram', diagram },
        notes: ['The boxes and arrows were chosen by a model from your request; where they sit was worked out by Orbis.']
      }
    }
    if (proposal.code) {
      // Where the language has a reader, a file that does not read is sent back once, like any other fault.
      const syntax = checkSyntax(proposal.code.language, proposal.code.source, compileJavaScript)
      if (syntax.checked && !syntax.wellFormed) return { error: syntax.message }
      return {
        body: { kind: 'code', code: { language: proposal.code.language, source: proposal.code.source } },
        notes: ['Written by a model from your request. Orbis has not run it and cannot say that it works: read it before you run it.', syntax.message]
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
   * One short question with one short JSON answer, quickly: which kind of request is this message?
   *
   * Its own walk, not `askJson`. That one starts with the largest model and gives each attempt a minute and a half,
   * which is right for writing a report and wrong for a question asked before every reply. This one asks the small
   * models, tells them not to deliberate, and has ONE deadline for the whole walk -- a classification that has not
   * come back in a few seconds is not coming back in time to be useful, and the reply should not wait on it. The key
   * that last answered is tried first, so a run of refused keys is paid for once and not on every message.
   *
   * `{ failed }` here never reaches a person. The caller treats it as "could not tell" and carries on with an
   * ordinary reply.
   */
  async askQuick(system: string, user: string, signal?: AbortSignal): Promise<Asked> {
    if (this.o.ask) return this.o.ask(system, user)
    if (signal?.aborted) return { failed: STOPPED }
    const groq = await this.o.apiKeys()
    const mistral = this.o.mistralKeys?.() ?? []
    const ladder: { provider: 'groq' | 'mistral'; model: string }[] = [
      ...(groq.length ? [{ provider: 'groq' as const, model: 'openai/gpt-oss-20b' }] : []),
      ...(mistral.length ? [{ provider: 'mistral' as const, model: 'ministral-8b-2512' }, { provider: 'mistral' as const, model: 'ministral-3b-2512' }] : [])
    ]
    if (!ladder.length) return { failed: 'Orion is not set up on this computer.' }
    const deadline = AbortSignal.timeout(QUICK_DEADLINE_MS)
    const both = signal ? AbortSignal.any([deadline, signal]) : deadline
    let last = 'Orion could not be reached.'
    for (const choice of ladder) {
      const keys = choice.provider === 'groq' ? groq : mistral
      const start = this.goodKey[choice.provider] % keys.length
      // At most four keys per model: past that the deadline is the limit anyway, and a fifth refused key says nothing new.
      for (let i = 0; i < Math.min(keys.length, 4); i++) {
        const at = (start + i) % keys.length
        let res: Response
        try {
          res = await this.o.fetchFn(`${PROVIDERS[choice.provider].baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${keys[at]}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: choice.model,
              ...(choice.provider === 'groq' ? { max_completion_tokens: 700, reasoning_effort: 'low' } : { max_tokens: 700 }),
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            }),
            signal: both
          })
        } catch {
          if (signal?.aborted) return { failed: STOPPED }
          if (deadline.aborted) return { failed: 'Orion took too long to say what was being asked for.' }
          continue
        }
        if (!res.ok) {
          last = `Orion could not answer (it returned ${res.status}).`
          continue
        }
        try {
          const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
          const parsed: unknown = JSON.parse(stripFences(String(payload.choices?.[0]?.message?.content ?? '')))
          if (parsed && typeof parsed === 'object') {
            this.goodKey[choice.provider] = at
            return { json: parsed as Record<string, unknown> }
          }
        } catch {
          // Not JSON: the next key or model may do better, within the same deadline.
        }
        last = 'Orion answered, but not with something Orbis could read.'
      }
    }
    return { failed: last }
  }

  /**
   * One request for one JSON answer, with the real reason when there is none.
   *
   * Walks the provider ladder for ordinary text, best model first, and every key for each; a key that is refused or
   * busy is skipped rather than retried. A model is sent only to its own service, with its own keys -- a Groq key at
   * Mistral's address is not a slow key, it is an authentication failure dressed as unreliability.
   */
  private async askJson(system: string, user: string, signal?: AbortSignal, maxTokens = MAX_TOKENS): Promise<Asked> {
    if (signal?.aborted) return { failed: STOPPED }
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
              ...(choice.provider === 'groq' ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
              temperature: 0.4,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: user }
              ]
            }),
            signal: signal ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS)
          })
        } catch (err) {
          // Stopped by the person: not a fault of the service, and not something to try the next key or model for.
          if (signal?.aborted) return { failed: STOPPED }
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
