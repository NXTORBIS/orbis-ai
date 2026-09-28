/**
 * The box an untrusted Page runs inside.
 *
 * Everything in `capabilities.ts` decides *whether* a Page may do something. This file is about the Page not being able
 * to do it anyway. A Page's code arrived from a template, an import, or a generator -- nobody has read it, and the
 * authorisation layer is worth nothing if the code can simply reach past it.
 *
 * ## What this file is, and what it is not
 *
 * It is the **policy and the broker**: the exact runtime settings a Page frame must have, the content security policy
 * derived from what the Page was actually granted, and the validation every message crossing out of the box goes
 * through. It is pure, so all of it can be tested without an Electron window, and a weakening of the policy fails a test
 * rather than shipping quietly.
 *
 * It is **not a defence against a Chromium exploit**. A renderer sandbox contains code that plays by the web platform's
 * rules. Code that breaks the renderer itself is outside what any policy here can reach, and the answer to that is
 * keeping the browser engine patched, not a cleverer flag list. That limit is stated in `SANDBOX_ASSUMPTIONS` rather
 * than implied, because a security boundary people misjudge the extent of is worse than one they understand.
 *
 * ## The rules that do not bend
 *
 * - **No Node, no context sharing, ever.** Not configurable, not weakenable per Page. `checkRuntimePolicy` refuses any
 *   settings object that relaxes them, so a future edit that sets `nodeIntegration: true` for one "trusted" Page fails a
 *   test instead of opening a hole for all of them.
 * - **Identity is bound to the channel, never read from the message.** A Page says what it wants done; it never says who
 *   it is. `readMessage` has no field for it. This is the difference between a permission system and a suggestion.
 * - **The CSP is built from grants, not from the manifest.** A Page that was denied the network gets a policy with no
 *   network in it, whatever its manifest asked for.
 * - **Default deny, everywhere.** An unrecognised message shape, an unknown operation, an origin that will not parse:
 *   all refused. There is no path here where "I could not tell" becomes "go ahead".
 * - **Nothing is unbounded.** Message size, in-flight count, rate, and run time all have ceilings, because a Page that
 *   cannot reach anything can still sit in a loop sending messages.
 *
 * Pure. No network, no clock, no storage: `now` is always passed in.
 */

import {
  CAPABILITIES,
  capabilityById,
  originScope,
  type OriginScope,
  type PageTrust
} from './capabilities.ts'
import { isPageId, type PageId } from './identity.ts'

// ---------------------------------------------------------------- limits

export const SANDBOX_LIMITS = Object.freeze({
  /** A single message from a Page, once serialised. Beyond this it is refused unread. */
  messageBytes: 256 * 1024,
  /** Requests a Page may have outstanding at once. */
  inFlight: 8,
  /** Requests per window, after which the Page is throttled. */
  messagesPerWindow: 120,
  windowMs: 10_000,
  /** How long one compute call may run before it is abandoned. */
  operationMs: 15_000,
  /** How long a Page may take to say it is ready before it is treated as broken. */
  startupMs: 10_000,
  /** Nested frames a Page may create. Zero: a Page does not get to host a frame of its own. */
  childFrames: 0,
  /** The longest an operation name may be. Anything longer is not a name, it is an attack on a log line. */
  operationLength: 64
})

// ---------------------------------------------------------------- the runtime policy

/**
 * The settings a Page frame runs with.
 *
 * Named after Electron's `webPreferences` because that is where these land, but kept as a plain object so the policy can
 * be decided and tested with no Electron in the process.
 */
export interface RuntimePolicy {
  /** Node's API inside the Page. Always false. */
  nodeIntegration: false
  /** Separate JavaScript worlds for the Page and the bridge. Always true. */
  contextIsolation: true
  /** The OS-level renderer sandbox. Always true. */
  sandbox: true
  /** Reading arbitrary files through the DOM. Always false. */
  webSecurity: true
  /** `remote`-style direct main-process access. Always false. */
  enableRemoteModule: false
  /** Navigating the frame anywhere at all. A Page is one document; it does not browse. */
  allowNavigation: false
  /** Opening windows. A Page cannot. */
  allowPopups: false
  /** Running `eval` and `new Function`. Refused by the CSP too; this is the belt to that's braces. */
  allowEval: false
  /** Web workers, which stay inside the same policy. Allowed, because the alternative is a Page freezing its own frame. */
  allowWorkers: boolean
  /** WebAssembly. Allowed only where the Page was granted it, because it needs a CSP relaxation. */
  allowWebAssembly: boolean
  /** Spell check, devtools and other conveniences that reach outside the frame. */
  allowDevTools: boolean
  /** The preload bridge, which is the only path out. */
  preload: 'page-bridge'
}

export interface PolicyProblem {
  field: string
  message: string
}

/** The settings every Page gets, whatever it is and whoever made it. */
export const BASE_RUNTIME_POLICY: Readonly<RuntimePolicy> = Object.freeze({
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  enableRemoteModule: false,
  allowNavigation: false,
  allowPopups: false,
  allowEval: false,
  allowWorkers: true,
  allowWebAssembly: false,
  allowDevTools: false,
  preload: 'page-bridge'
})

export interface RuntimePolicyInput {
  trust: PageTrust
  /** The capabilities actually granted. Not what the manifest asked for. */
  granted: readonly string[]
  /** True when the user has opened the Page's own developer tools deliberately. */
  developerMode?: boolean
}

/**
 * The policy for one Page.
 *
 * Only two things vary, and both only ever loosen from a base that is already closed: WebAssembly, which needs a CSP
 * relaxation and so has to be earned, and developer tools, which the user turns on for themselves. Everything else is
 * the same for a built-in Page and one that arrived in an import five seconds ago -- because a trust level is a guess,
 * and a guess is not a thing to hang a sandbox on.
 */
export function runtimePolicyFor(input: RuntimePolicyInput): RuntimePolicy {
  const granted = new Set(input.granted)
  return {
    ...BASE_RUNTIME_POLICY,
    allowWebAssembly: granted.has('computation.wasm'),
    // Developer tools are the user's own choice on their own machine, and never something a Page's trust level buys.
    allowDevTools: input.developerMode === true
  }
}

/**
 * Whether a settings object is at least as closed as the base policy.
 *
 * This exists so that a weakening is a failing test rather than a quiet regression. Everything that could open a hole is
 * checked against the base explicitly, rather than trusting that the object came from `runtimePolicyFor`.
 */
export function checkRuntimePolicy(policy: Partial<RuntimePolicy>): PolicyProblem[] {
  const problems: PolicyProblem[] = []
  const mustBe = <K extends keyof RuntimePolicy>(field: K, value: RuntimePolicy[K], why: string): void => {
    if (policy[field] !== value) problems.push({ field: String(field), message: why })
  }

  mustBe('nodeIntegration', false, 'A Page must never have Node’s API. With it, every other setting here is decoration.')
  mustBe('contextIsolation', true, 'Without context isolation the Page and the bridge share a JavaScript world, and the Page can rewrite the bridge.')
  mustBe('sandbox', true, 'The renderer sandbox is what stops a compromised Page reaching the operating system.')
  mustBe('webSecurity', true, 'Turning off web security lets the Page read any file and any origin it can name.')
  mustBe('enableRemoteModule', false, 'The remote module hands the Page the main process directly.')
  mustBe('allowNavigation', false, 'A Page is one document. Letting it navigate lets it replace itself with something else entirely.')
  mustBe('allowPopups', false, 'A window opened from a Page is outside the Page’s policy.')
  mustBe('allowEval', false, 'Allowing eval means the Page’s code is whatever it decides at runtime, which nothing can review.')
  mustBe('preload', 'page-bridge', 'The Page must load the bridge preload and no other, because the bridge is the only path out.')

  if (policy.allowDevTools === true && policy.sandbox !== true) {
    problems.push({ field: 'allowDevTools', message: 'Developer tools are only ever opened on a sandboxed frame.' })
  }
  return problems
}

// ---------------------------------------------------------------- the content security policy

export interface ContentPolicyInput {
  granted: readonly string[]
  /** The origins the Page was granted, already scoped. Anything not here cannot be reached. */
  networkOrigins?: readonly OriginScope[]
  /** The internal origin the Page's own files are served from. */
  selfOrigin: string
}

export interface ContentPolicy {
  /** The header value, ready to serve. */
  header: string
  directives: Readonly<Record<string, readonly string[]>>
  notes: readonly string[]
}

/** An origin scope written the way a CSP source list wants it. */
function cspSourceFor(scope: OriginScope): string {
  // A subdomain scope covers subdomains only, so `*.example.com` is exactly right and the apex is deliberately absent.
  const host = scope.subdomains ? `*.${scope.host}` : scope.host
  const port = scope.port === null ? '' : `:${scope.port}`
  return `${scope.scheme}://${host}${port}`
}

/**
 * The content security policy for one Page, built from what it was granted.
 *
 * Everything starts at `'none'` and is opened only by a grant. That direction matters: a policy assembled by removing
 * things from a permissive default leaves whatever nobody remembered to remove, and what nobody remembered to remove is
 * exactly where the hole is.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` never appear. A Page that needs generated code does not get to have it; that is
 * the cost of running code nobody read, and it is a cost worth paying.
 */
export function contentPolicyFor(input: ContentPolicyInput): ContentPolicy {
  const granted = new Set(input.granted)
  const self = input.selfOrigin
  const notes: string[] = []

  const connect: string[] = []
  const image: string[] = [self, 'data:']
  const media: string[] = [self]
  const font: string[] = [self]

  const origins = input.networkOrigins ?? []
  if (granted.has('network.fetch') || granted.has('network.stream')) {
    if (origins.length === 0) {
      // Granted the capability but scoped to nothing: the honest policy is still no network.
      notes.push(
        'The Page may use the network but has no origin it is allowed to reach, so the policy still permits none. A network grant without a scope reaches nothing.'
      )
    }
    for (const scope of origins) connect.push(cspSourceFor(scope))
  } else if (origins.length > 0) {
    notes.push('Origins were supplied but the Page has no network capability, so they were ignored rather than applied.')
  }

  if (granted.has('network.fetch')) {
    // Anything the Page may fetch it may also display. A separate image permission would be a distinction without a
    // difference, since a Page that can fetch an image can draw it into a canvas regardless.
    for (const scope of origins) image.push(cspSourceFor(scope))
  }

  const script: string[] = [self]
  if (granted.has('computation.wasm')) {
    // The one relaxation WebAssembly needs. It does not permit eval of JavaScript.
    script.push("'wasm-unsafe-eval'")
    notes.push("WebAssembly is permitted, which needs 'wasm-unsafe-eval'. That allows compiling WebAssembly and nothing else; JavaScript eval stays blocked.")
  }

  const directives: Record<string, string[]> = {
    'default-src': ["'none'"],
    'script-src': script,
    'style-src': [self],
    'img-src': image,
    'font-src': font,
    'media-src': media,
    'connect-src': connect.length > 0 ? connect : ["'none'"],
    // A Page does not get to host a frame, be hosted in one, or open a window.
    'frame-src': ["'none'"],
    'child-src': ["'none'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'none'"],
    'base-uri': ["'none'"],
    // Workers stay inside the Page's own origin, so they inherit this policy rather than escaping it.
    'worker-src': [self],
    'manifest-src': ["'none'"],
    'sandbox': ['allow-scripts']
  }

  if (connect.length === 0) {
    notes.push('The Page cannot reach any network origin. Every request it makes will be refused by the browser itself, not only by the capability check.')
  }
  notes.push("Inline script and eval are not permitted for any Page, at any trust level. A Page that wants to generate code cannot.")

  const header = Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')

  return { header, directives: Object.freeze(directives), notes: Object.freeze(notes) }
}

// ---------------------------------------------------------------- messages out of the box

/**
 * A request from a Page.
 *
 * Note what is missing: there is no page id, no capability, and no trust level. A Page says what it wants done and
 * nothing about who it is or what it is allowed. Those are attached on the trusted side, from the channel the message
 * arrived on.
 */
export interface PageRequest {
  /** The Page's own correlation id, echoed back. Opaque to us. */
  id: string
  operation: string
  /** Whatever the operation takes. Validated by the operation, not here. */
  payload: unknown
}

export interface MessageProblem {
  error:
    | 'too-large'
    | 'malformed'
    | 'unknown-operation'
    | 'rate-limited'
    | 'too-many-in-flight'
    | 'not-ready'
    | 'stopped'
  message: string
}

export const isMessageProblem = (value: unknown): value is MessageProblem =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const OPERATION_PATTERN = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/

/**
 * A raw message turned into a request, or refused.
 *
 * Everything about the message is treated as hostile: the size before parsing, the shape after, and the operation name
 * against a pattern rather than against a blocklist. A blocklist answers "is this one of the bad ones"; a pattern
 * answers "is this one of the ones I recognise at all", and only the second is safe against a name nobody thought of.
 */
export function readMessage(raw: unknown, knownOperations: ReadonlySet<string>): PageRequest | MessageProblem {
  // Sized before anything else, because parsing is itself work a Page should not be able to demand without limit.
  let size = 0
  try {
    size = JSON.stringify(raw)?.length ?? Number.POSITIVE_INFINITY
  } catch {
    return { error: 'malformed', message: 'That message could not be read at all. It may contain a cycle or something that is not data.' }
  }
  if (size > SANDBOX_LIMITS.messageBytes) {
    return { error: 'too-large', message: `A message may be at most ${SANDBOX_LIMITS.messageBytes} bytes; that one was ${size}.` }
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'malformed', message: 'A request has to be an object.' }
  }
  const record = raw as Record<string, unknown>

  const id = record.id
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) {
    return { error: 'malformed', message: 'A request needs an id: a string of up to 128 characters.' }
  }
  const operation = record.operation
  if (typeof operation !== 'string' || operation.length === 0 || operation.length > SANDBOX_LIMITS.operationLength) {
    return { error: 'malformed', message: 'A request needs an operation name.' }
  }
  if (!OPERATION_PATTERN.test(operation)) {
    // Refused for not matching the shape of a name, before any lookup. A name that cannot be written cannot be spoofed.
    return { error: 'malformed', message: `"${operation}" is not shaped like an operation name.` }
  }
  // A Set lookup, so nothing here can walk up a prototype chain the way a plain object's key lookup would.
  if (!knownOperations.has(operation)) {
    return { error: 'unknown-operation', message: `There is no operation called "${operation}".` }
  }

  // Anything a Page might use to claim an identity is dropped rather than carried forward.
  return { id, operation, payload: record.payload }
}

// ---------------------------------------------------------------- the box itself

export type SandboxState =
  /** Created, not yet reported ready. Nothing is accepted. */
  | 'starting'
  /** Running normally. */
  | 'ready'
  /** Over its message budget. Recovers when the window rolls over. */
  | 'throttled'
  /** Stopped, by the user or by a fault. Nothing more is accepted, ever. */
  | 'stopped'

export interface SandboxFault {
  at: number
  kind: 'startup-timeout' | 'operation-timeout' | 'crashed' | 'policy-violation' | 'over-budget'
  detail: string
}

/**
 * One Page's box: its identity, its policy, and everything it has been up to.
 *
 * Immutable. Every transition returns a new one, so a caller cannot hold a reference from before a revocation and act on
 * it -- which is the same reason grants are re-checked on use rather than cached.
 */
export interface Sandbox {
  readonly pageId: PageId
  readonly profileId: string
  readonly state: SandboxState
  readonly policy: Readonly<RuntimePolicy>
  readonly content: ContentPolicy
  readonly startedAt: number
  /** Timestamps of recent messages, for the rate window. Trimmed as it goes. */
  readonly recent: readonly number[]
  readonly inFlight: readonly string[]
  readonly faults: readonly SandboxFault[]
  readonly served: number
}

export interface CreateSandboxInput {
  pageId: PageId
  profileId: string
  trust: PageTrust
  granted: readonly string[]
  selfOrigin: string
  networkOrigins?: readonly string[]
  developerMode?: boolean
  now: number
}

export interface SandboxProblem {
  error: 'invalid-page' | 'invalid-profile' | 'invalid-origin' | 'policy-refused'
  message: string
}

export const isSandboxProblem = (value: unknown): value is SandboxProblem =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

/**
 * A box for a Page.
 *
 * Origins that will not parse are dropped rather than passed through as text. A CSP source list is not a place to put
 * something whose shape was never checked: one malformed entry can change how a browser reads the rest of the list.
 */
export function createSandbox(input: CreateSandboxInput): Sandbox | SandboxProblem {
  if (!isPageId(input.pageId)) {
    return { error: 'invalid-page', message: 'That is not a page id.' }
  }
  if (typeof input.profileId !== 'string' || input.profileId.length === 0 || input.profileId.length > 128) {
    return { error: 'invalid-profile', message: 'A sandbox belongs to a profile, and that is not one.' }
  }
  if (typeof input.selfOrigin !== 'string' || !/^[a-z][a-z0-9+.-]*:\/\/[^\s'";]+$/.test(input.selfOrigin)) {
    // Characters that could end a CSP directive early are refused outright rather than escaped.
    return { error: 'invalid-origin', message: 'The Page’s own origin is not a usable origin.' }
  }

  const scopes: OriginScope[] = []
  for (const text of input.networkOrigins ?? []) {
    const scope = originScope(text)
    // A scope that will not parse is not a scope. Dropping it is the fail-closed answer; keeping the text is not.
    if (scope !== null) scopes.push(scope)
  }

  // Only capabilities the registry knows survive. An id that is not in it cannot open anything in the policy below.
  const granted = input.granted.filter((one) => capabilityById(one) !== null && Object.prototype.hasOwnProperty.call(CAPABILITIES, one))

  const policy = runtimePolicyFor({ trust: input.trust, granted, developerMode: input.developerMode })
  const problems = checkRuntimePolicy(policy)
  if (problems.length > 0) {
    // Cannot happen from `runtimePolicyFor` as written, and is checked anyway: a sandbox that fails its own policy
    // check must not start, whatever produced the settings.
    return { error: 'policy-refused', message: `The runtime policy for this Page is not safe to run: ${problems[0].message}` }
  }

  return Object.freeze({
    pageId: input.pageId,
    profileId: input.profileId,
    state: 'starting' as const,
    policy: Object.freeze(policy),
    content: contentPolicyFor({ granted, networkOrigins: scopes, selfOrigin: input.selfOrigin }),
    startedAt: input.now,
    recent: Object.freeze([]),
    inFlight: Object.freeze([]),
    faults: Object.freeze([]),
    served: 0
  })
}

/** The Page has said it is up. Only meaningful once. */
export function markReady(sandbox: Sandbox): Sandbox {
  if (sandbox.state !== 'starting') return sandbox
  return Object.freeze({ ...sandbox, state: 'ready' as const })
}

/** The box, stopped. A stopped box never restarts; the caller makes a new one. */
export function stopSandbox(sandbox: Sandbox, fault?: Omit<SandboxFault, 'at'>, now = 0): Sandbox {
  return Object.freeze({
    ...sandbox,
    state: 'stopped' as const,
    inFlight: Object.freeze([]),
    faults: Object.freeze(fault ? [...sandbox.faults, { ...fault, at: now }] : [...sandbox.faults])
  })
}

/** Whether the Page took too long to start. */
export const startupExpired = (sandbox: Sandbox, now: number): boolean =>
  sandbox.state === 'starting' && now - sandbox.startedAt > SANDBOX_LIMITS.startupMs

export interface AdmitResult {
  sandbox: Sandbox
  request: PageRequest
}

/**
 * A message admitted, or refused with a reason.
 *
 * The order of the checks is deliberate: state, then rate, then in-flight, then shape. A stopped box does not spend
 * effort parsing, and a Page flooding the channel is throttled before its messages are read rather than after.
 */
export function admit(
  sandbox: Sandbox,
  raw: unknown,
  knownOperations: ReadonlySet<string>,
  now: number
): AdmitResult | MessageProblem {
  if (sandbox.state === 'stopped') {
    return { error: 'stopped', message: 'This Page has been stopped and is not accepting anything further.' }
  }
  if (sandbox.state === 'starting') {
    return { error: 'not-ready', message: 'This Page has not finished starting.' }
  }

  // The rate window, trimmed as it is read rather than on a timer.
  const recent = sandbox.recent.filter((at) => now - at < SANDBOX_LIMITS.windowMs)
  if (recent.length >= SANDBOX_LIMITS.messagesPerWindow) {
    return {
      error: 'rate-limited',
      message: `This Page has sent ${recent.length} requests in the last ${SANDBOX_LIMITS.windowMs / 1000} seconds, which is its limit. A Page that can reach nothing can still sit in a loop.`
    }
  }
  if (sandbox.inFlight.length >= SANDBOX_LIMITS.inFlight) {
    return {
      error: 'too-many-in-flight',
      message: `This Page already has ${sandbox.inFlight.length} requests outstanding, which is its limit.`
    }
  }

  const request = readMessage(raw, knownOperations)
  if (isMessageProblem(request)) return request
  // A repeated id would make two answers indistinguishable to the Page, so it is refused rather than silently reused.
  if (sandbox.inFlight.includes(request.id)) {
    return { error: 'malformed', message: `Request id "${request.id}" is already outstanding.` }
  }

  return {
    sandbox: Object.freeze({
      ...sandbox,
      state: 'ready' as const,
      recent: Object.freeze([...recent, now]),
      inFlight: Object.freeze([...sandbox.inFlight, request.id])
    }),
    request
  }
}

/** A request finished, whether it succeeded or not. */
export function settle(sandbox: Sandbox, id: string): Sandbox {
  if (!sandbox.inFlight.includes(id)) return sandbox
  return Object.freeze({
    ...sandbox,
    inFlight: Object.freeze(sandbox.inFlight.filter((one) => one !== id)),
    served: sandbox.served + 1
  })
}

/** A fault recorded without stopping the box. */
export function recordFault(sandbox: Sandbox, fault: Omit<SandboxFault, 'at'>, now: number): Sandbox {
  return Object.freeze({ ...sandbox, faults: Object.freeze([...sandbox.faults, { ...fault, at: now }]) })
}

export interface SandboxHealth {
  state: SandboxState
  /** How much of the rate window is used, from 0 to 1. */
  load: number
  inFlight: number
  served: number
  faults: number
  /** Plain sentences, for a Page's own diagnostics panel. */
  describe: readonly string[]
}

/** What the box is doing, in words a person can act on. */
export function sandboxHealth(sandbox: Sandbox, now: number): SandboxHealth {
  const recent = sandbox.recent.filter((at) => now - at < SANDBOX_LIMITS.windowMs)
  const load = recent.length / SANDBOX_LIMITS.messagesPerWindow
  const describe: string[] = []

  switch (sandbox.state) {
    case 'starting':
      describe.push(
        startupExpired(sandbox, now)
          ? 'This Page has not started within the time allowed, which usually means its code failed before it ran.'
          : 'This Page is still starting.'
      )
      break
    case 'ready':
      describe.push('Running normally.')
      break
    case 'throttled':
      describe.push('This Page is sending more requests than it is allowed and is being slowed down.')
      break
    case 'stopped':
      describe.push('This Page has been stopped.')
      break
  }

  if (load > 0.8 && sandbox.state === 'ready') {
    describe.push(`It has used ${Math.round(load * 100)}% of its request budget for the last ${SANDBOX_LIMITS.windowMs / 1000} seconds.`)
  }
  if (sandbox.inFlight.length > 0) {
    describe.push(`${sandbox.inFlight.length} request${sandbox.inFlight.length === 1 ? '' : 's'} outstanding.`)
  }
  for (const fault of sandbox.faults.slice(-3)) describe.push(fault.detail)

  return {
    state: sandbox.state,
    load: Math.min(1, load),
    inFlight: sandbox.inFlight.length,
    served: sandbox.served,
    faults: sandbox.faults.length,
    describe: Object.freeze(describe)
  }
}

/** What the box does and does not protect against, for the Page's own permissions panel. */
export const SANDBOX_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A Page runs with no access to Node, no shared JavaScript world with the bridge, and the operating system sandbox on. None of that is configurable per Page.',
  'A Page never states its own identity. What it is and what it may do are attached on the trusted side, from the channel its message arrived on.',
  'The content security policy is built from what the Page was granted, not from what its manifest asked for.',
  'Inline script and eval are refused for every Page at every trust level. A Page cannot generate and run code.',
  'A network capability with no granted origin reaches nothing. The policy permits no origin rather than all of them.',
  'Message size, request rate, outstanding requests and run time are all capped. A Page that can reach nothing can still waste a machine.',
  'This contains code that follows the web platform’s rules. It is not a defence against an exploit of the browser engine itself, and nothing in a flag list can be. Keeping the engine patched is what covers that.',
  'A stopped Page never restarts. Anything that goes wrong badly enough to stop it needs a fresh box, not a resumed one.'
])
