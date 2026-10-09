import {
  LIMITS,
  checkRequest,
  isExecutionError,
  languageFor,
  predictionPrompt,
  readPrediction,
  resultFrom,
  submissionFor,
  type ExecutionError,
  type Judge0Reply,
  type RunResult
} from '../../shared/cs/execution.ts'

/**
 * Running code, and saying honestly where the answer came from.
 *
 * ## Two routes, never confused for one another
 *
 * The first is Judge0, which really compiles and really runs the code in a sandbox somewhere else. The second is
 * Orion, which reads the code and says what it thinks would happen. These produce answers that look identical on
 * a screen and are not remotely the same thing, so every result carries an `origin` of `'ran'` or `'predicted'`
 * and the laboratory shows it. A predicted result never reports a running time or a memory figure, because
 * nothing ran and inventing those would be the easiest possible lie.
 *
 * ## Nothing is ever executed on this machine
 *
 * Not in a subprocess, not in a shell, not in a worker. The code goes to a remote sandbox or it goes to a model
 * that reads it. That is a hard rule and it is why there is no third route.
 *
 * ## Why Orion is a fallback rather than the plan
 *
 * Because a model guessing at output is wrong often enough to matter, and silently so. It is here for the case
 * where no sandbox is configured or the sandbox is down — which otherwise means the laboratory simply does not
 * work — and it says loudly that it guessed.
 */

export interface ExecutionSettings {
  /** Where the sandbox lives. Empty means there is not one, and only Orion is available. */
  url: string
  /** The key, if the instance wants one. Never leaves the main process. */
  key: string
  /** The header the instance expects the key in. RapidAPI wants one name, a self-hosted instance another. */
  keyHeader: string
}

export interface ExecutionDependencies {
  settings(): Promise<ExecutionSettings>
  /** Asks Orion. Returns the raw reply, or null when Orion is not available either. */
  ask(prompt: string): Promise<string | null>
  /** Injected so a test can drive this without a network. */
  fetch?: typeof globalThis.fetch
  now?: () => number
}

export interface RunRequest {
  language: string
  source: string
  stdin: string
  /** Skip the sandbox entirely and ask Orion. For comparing the two deliberately. */
  predictOnly?: boolean
}

export interface ReadyReport {
  /** Whether a sandbox is configured at all. */
  sandbox: boolean
  /** Whether Orion can be asked. */
  orion: boolean
  /** What will happen if Run is pressed, in words. */
  says: string
}

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

export class ExecutionService {
  private readonly deps: ExecutionDependencies
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number

  constructor(deps: ExecutionDependencies) {
    this.deps = deps
    this.fetch = deps.fetch ?? globalThis.fetch.bind(globalThis)
    this.now = deps.now ?? (() => Date.now())
  }

  /** What is available, so the laboratory can say so before anybody presses Run. */
  async ready(): Promise<ReadyReport> {
    const settings = await this.deps.settings()
    const sandbox = settings.url.trim() !== ''
    // Asking Orion a trivial question to test it would cost a request every time the lab opens, so this reports
    // what is configured rather than what is reachable, and a failure at run time says so then.
    const orion = true
    return {
      sandbox,
      orion,
      says: sandbox
        ? 'Code is compiled and run in a sandbox, and the result is what actually happened.'
        : 'Orion will read the code and say what it would print. That is how this works by default: nothing to set up, and any language rather than a fixed list. It is a reading rather than a run, so it says so and never reports a running time.'
    }
  }

  /**
   * Run some code.
   *
   * Tries the sandbox first when there is one. Falls back to Orion when there is not, or when the sandbox fails —
   * and the reason for falling back is carried through to the result rather than swallowed.
   */
  async run(request: RunRequest): Promise<RunResult | ExecutionError> {
    const language = languageFor(request.language)
    if (!language) {
      return {
        error: 'unsupported-language',
        message: `There is no language called "${request.language}" here.`,
        fix: 'Pick one from the list — this has twenty of them.'
      }
    }
    const bad = checkRequest(request.language, request.source, request.stdin)
    if (bad) return bad

    if (request.predictOnly === true) {
      return this.predict(language.id, request.source, request.stdin, 'You asked Orion rather than the sandbox.')
    }

    const settings = await this.deps.settings()
    if (settings.url.trim() === '') {
      return this.predict(
        language.id,
        request.source,
        request.stdin,
        'This is Orion reading the code rather than running it.'
      )
    }

    const ran = await this.viaSandbox(settings, language.id, request.source, request.stdin)
    if (!isExecutionError(ran)) return ran

    // The sandbox was there and did not work. Say which failure it was, then fall back rather than give nothing.
    return this.predict(language.id, request.source, request.stdin, `The sandbox did not answer: ${ran.message} This is Orion reading the code instead.`)
  }

  private async predict(language: string, source: string, stdin: string, why: string): Promise<RunResult | ExecutionError> {
    const found = languageFor(language)
    if (!found) return { error: 'unsupported-language', message: `No language called "${language}".`, fix: 'Pick one from the list.' }
    let reply: string | null = null
    try {
      reply = await this.deps.ask(predictionPrompt(found, source, stdin))
    } catch {
      reply = null
    }
    if (reply === null || reply.trim() === '') {
      return {
        error: 'unavailable',
        message: 'Neither the sandbox nor Orion could run this.',
        fix: 'Add an Orion key in Settings and it can read the code and say what it would do. A Judge0 address is optional and makes it a real run instead.'
      }
    }
    return readPrediction(found.id, reply, why)
  }

  private async viaSandbox(
    settings: ExecutionSettings,
    language: string,
    source: string,
    stdin: string
  ): Promise<RunResult | ExecutionError> {
    const found = languageFor(language)
    if (!found) return { error: 'unsupported-language', message: 'Unknown language.', fix: 'Pick one from the list.' }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.key.trim() !== '') headers[settings.keyHeader || 'X-Auth-Token'] = settings.key.trim()

    const root = settings.url.trim().replace(/\/+$/, '')
    let token: string
    try {
      // base64_encoded so source with any bytes in it survives the journey intact.
      const created = await this.fetch(`${root}/submissions?base64_encoded=true&wait=false`, {
        method: 'POST',
        headers,
        body: JSON.stringify(submissionFor(found, source, stdin, base64))
      })
      if (!created.ok) {
        return {
          error: 'unavailable',
          message: `The sandbox answered ${created.status}.`,
          fix: created.status === 401 || created.status === 403
            ? 'That usually means the key is missing or wrong. Check it in Settings.'
            : 'Check the address in Settings, and that the instance is running.'
        }
      }
      const body = (await created.json()) as { token?: string }
      if (typeof body?.token !== 'string' || body.token === '') {
        return { error: 'unavailable', message: 'The sandbox accepted the code but gave no token back.', fix: 'That is not a Judge0 instance, or it is a version this does not understand.' }
      }
      token = body.token
    } catch (error) {
      return {
        error: 'unavailable',
        message: `Could not reach the sandbox: ${error instanceof Error ? error.message : String(error)}`,
        fix: 'Check the address in Settings and that this machine can reach it.'
      }
    }

    // Poll. Judge0 queues work, so the answer is rarely ready on the first ask.
    const started = this.now()
    for (let attempt = 0; attempt < LIMITS.polls; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, LIMITS.pollMs))
      try {
        const got = await this.fetch(`${root}/submissions/${encodeURIComponent(token)}?base64_encoded=false`, { headers })
        if (!got.ok) continue
        const reply = (await got.json()) as Judge0Reply
        // Status 1 is in queue and 2 is processing; anything above means it has finished one way or another.
        const id = Number(reply?.status?.id ?? 0)
        if (id > 2) return resultFrom(reply, found.id)
      } catch {
        // A single failed poll is not a failed run. Keep asking until the budget runs out.
      }
    }

    return {
      error: 'timeout',
      message: `The sandbox did not finish within ${Math.round((this.now() - started) / 1000)} seconds.`,
      fix: 'It may be busy. Try again, or check the instance is not overloaded.'
    }
  }
}
