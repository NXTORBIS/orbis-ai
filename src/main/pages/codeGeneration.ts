import { buildable, checkCode, filesFor, MAX_CODE_BYTES, MAX_STYLE_BYTES } from '../../shared/pages/codePage.ts'
import type { CodeProblem, CodeSpec, PageFile } from '../../shared/pages/codePage.ts'
import { catalogueForPrompt } from './generationCatalogue.ts'

/**
 * Building a Page out of code.
 *
 * The specification route and this one answer different questions, and both are kept. A specification builds a
 * calculator whose every number comes from an engine Orbis tested before the Page existed -- verified all the way
 * down, and capped at what the catalogue covers. This route can build anything that is a web page, and nothing here
 * checks that what it shows is right.
 *
 * The same ladder as the other route, for the same reason: ask once, argue once with a specific complaint, then stop.
 * A third attempt with no new information is the same coin flipped again.
 *
 * ## The Page computes for itself
 *
 * This was briefly got backwards, and the mistake is worth recording because it is the natural one. The instructions
 * told the model to prefer Orbis's own tested calculations over writing the mathematics -- which is right for the
 * specification route and wrong here, because it drags this route back under the 236-operation ceiling it exists to
 * escape. A generated converter duly asked Orbis to perform an *addition*, was refused, and showed nothing.
 *
 * So: the Page writes its own logic. `orbis.request` remains available for something genuinely hard that Orbis
 * already does well, and the catalogue is still supplied so a name that is used is a name that exists -- but it is
 * the exception, and a Page is expected to work without it.
 *
 * The model never writes a path, never writes a script tag, and never writes the part that says the Page has started.
 * It writes a body, a style and a script; `filesFor` puts them inside a shell that Orbis owns. That is what makes
 * "generated code" a bounded thing rather than a free hand with the file system.
 */

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/** The model built for this: 256,000 tokens of context, and fill-in for the repair round. */
export const CODE_MODEL = 'codestral-2508'

export const CODE_INSTRUCTIONS = `You write Orbis Pages as code. A Page is one web page: some markup, some style, and some JavaScript.

Answer with a single JSON object and nothing else. It has exactly these keys:

{
  "title": "short, at most 80 characters",
  "purpose": "one sentence saying what the Page is for",
  "body": "<the markup that goes inside <body>>",
  "style": "<CSS>",
  "script": "<JavaScript>",
  "notes": ["what this does not account for"]
}

The rules, all of which are checked before the Page is built:

- No <script> tag anywhere in "body", and no onclick="" or any other inline handler. They are blocked by this Page's content policy, so a Page using them loads and then silently does nothing. Put every line of JavaScript in "script" and add listeners there.
- No <iframe>, <object> or <embed>, and no <link rel="stylesheet">. Put the style in "style".
- No fetch, XMLHttpRequest, WebSocket or EventSource. A Page does not open its own connections.
- No eval, no new Function, no importScripts.
- No localStorage, sessionStorage or indexedDB.
- No window.open, no document.write.
- "script" is at most ${MAX_CODE_BYTES} characters and "style" at most ${MAX_STYLE_BYTES}.
- Write at least one note, honestly, about what the Page approximates or leaves out.

What a Page may do:

- Anything that is drawing, laying out, animating or responding to a person: canvas, SVG, CSS, requestAnimationFrame, pointer and keyboard events, form controls.
- Work out whatever the Page needs in the script itself. That is the point of this kind of Page: the mathematics, the simulation, the drawing, the rules of a game, all of it is yours to write. Do not look for a built-in way to do something you can simply write.
- There is one exception, and it is rarely the right answer: await orbis.request(operation, payload) asks Orbis to run one of its own tested calculations. Reach for it only for something genuinely hard that is on the list at the end of these instructions -- a physical simulation, a statistical fit, a unit conversion with real units. Never for arithmetic you could write in a line. A name that is not on that list is refused, and a Page that asks for one shows nothing.
- The elements in "body" exist before "script" runs, so it is safe to look them up at the top.

Write for a dark background. Orbis sets a readable default; style what you need on top of it.`

/**
 * The instructions, with the list of calculations a Page may actually name.
 *
 * Built rather than written out, because the catalogue is the same one the specification route uses and the two must
 * not drift: a Page told about an operation that does not exist asks for it, is refused, and shows nothing -- which
 * is exactly what happened to a converter that opened, looked right, and computed nothing.
 */
export const codeInstructions = (): string => `${CODE_INSTRUCTIONS}

The calculations Orbis can run, for the rare case one is genuinely wanted. A Page is expected to work without any of
them, and most should.
${catalogueForPrompt()}`

export interface CodeGenerationOptions {
  apiKeys(): Promise<string[]>
  mistralKeys?(): string[]
  fetchFn: FetchFn
  ask(
    system: string,
    user: string,
    apiKeys: string[],
    fetchFn: FetchFn,
    timeoutMs: number,
    options: { maxTokens?: number; model?: string; mistralKeys?: string[] }
  ): Promise<Record<string, unknown> | null>
}

export interface CodeOutcome {
  /** The files to serve, when there are some. */
  files: PageFile[] | null
  spec: CodeSpec | null
  problems: CodeProblem[]
  /** Each attempt's complaint, so a failure can be read rather than guessed at. */
  attempts: { said: string; problems: string[] }[]
}

/** What came back, reduced to the shape a Page is built from. Nothing here trusts a field without looking at it. */
function readSpec(raw: Record<string, unknown> | null): Partial<CodeSpec> | null {
  if (!raw || typeof raw !== 'object') return null
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    title: text(raw.title).slice(0, 200),
    purpose: text(raw.purpose).slice(0, 400),
    body: text(raw.body),
    style: text(raw.style),
    script: text(raw.script),
    notes: Array.isArray(raw.notes) ? raw.notes.filter((n): n is string => typeof n === 'string').slice(0, 8) : []
  }
}

export class CodeGeneration {
  private readonly o: CodeGenerationOptions

  constructor(options: CodeGenerationOptions) {
    this.o = options
  }

  /**
   * A Page's files for a request, or the reasons there are none.
   *
   * Asked once, then once more with the complaint. The second attempt is given what was wrong rather than being asked
   * again from nothing, because the failures here are specific -- "the body contains a script tag", "no fetch" -- and
   * a specific complaint is something a model can act on.
   */
  async build(request: string): Promise<CodeOutcome> {
    const attempts: CodeOutcome['attempts'] = []
    let complaint: string | null = null

    for (let round = 0; round < 2; round++) {
      const raw = await this.askOnce(request, complaint)
      if (raw === null) {
        /*
         * Nothing came back, so there is nothing to argue with.
         *
         * A complaint is what makes the second attempt worth making: it is given something specific that was wrong.
         * An empty answer offers nothing to be specific about, so asking again unchanged is the same coin flipped --
         * and it is also what happens when there is no key, where retrying is certain to fail identically.
         */
        attempts.push({ said: '(nothing came back)', problems: ['the model returned nothing'] })
        break
      }
      const spec = readSpec(raw)
      const problems = checkCode(spec)
      attempts.push({ said: JSON.stringify(raw).slice(0, 300), problems: problems.map((p) => `${p.severity}: ${p.message}`) })

      if (spec && buildable(problems)) {
        const whole: CodeSpec = {
          title: spec.title ?? 'Page',
          purpose: spec.purpose ?? '',
          body: spec.body ?? '',
          style: spec.style ?? '',
          script: spec.script ?? '',
          notes: spec.notes ?? []
        }
        return { files: filesFor(whole), spec: whole, problems, attempts }
      }

      const errors = problems.filter((p) => p.severity === 'error')
      if (!errors.length) {
        // Nothing came back at all, and there is nothing specific to complain about. Asking again unchanged would be
        // the same coin flipped.
        break
      }
      complaint = errors.map((p) => `- ${p.message}`).join('\n')
    }

    return { files: null, spec: null, problems: checkCode(null), attempts }
  }

  /** One request to the model. Null when there is no key for the service this model belongs to. */
  private async askOnce(request: string, complaint: string | null): Promise<Record<string, unknown> | null> {
    const keys = await this.o.apiKeys()
    const mistralKeys = this.o.mistralKeys?.() ?? []
    // Codestral is Mistral's. Without a key for it there is no code route at all, and saying so beats a failed request.
    if (!mistralKeys.length) return null

    const user =
      complaint === null
        ? request
        : `${request}

The last attempt did not work. What was wrong:
${complaint}

Write it again, fixing those. Everything else about the format is the same.`

    return this.o.ask(codeInstructions(), user, keys, this.o.fetchFn, 90_000, {
      maxTokens: 8000,
      model: CODE_MODEL,
      mistralKeys
    })
  }
}
