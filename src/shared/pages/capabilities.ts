/**
 * What a Page is allowed to do.
 *
 * The authorisation layer for Orbis Pages. A Page is code, and code that arrived from a template, an import or a
 * generator is code nobody has read -- so the question "may this Page reach the network / the filesystem / the camera /
 * another Page's data" has to have an answer that does not depend on the Page behaving well.
 *
 * Three ideas, kept apart on purpose:
 *
 * ```
 * capability   something the runtime can do at all
 * declaration  what a Page's manifest says it needs
 * grant        what this Page, in this profile, has actually been permitted
 * ```
 *
 * A declaration is a request, never a permission. This is the distinction that gets collapsed in most permission systems,
 * and collapsing it means a Page can widen its own access by editing its own manifest.
 *
 * ## The rules that do not bend
 *
 * - **Deny by default.** A capability with no decision is denied. There is no branch here that treats "unknown" as "fine".
 * - **Risk comes from the registry, not the Page.** A manifest cannot describe `filesystem.write` as low risk. The
 *   classification lives in `CAPABILITIES` and a Page's opinion about it is not read.
 * - **Unavailable is not denied.** A machine with no camera and a Page forbidden the camera are different states, and
 *   showing one as the other sends people to the wrong setting.
 * - **Fail closed.** Every path that cannot reach a decision returns a denial. That includes a malformed grant, a scope
 *   that cannot be parsed, a dependency that cannot be resolved, and a capability id that is not in the registry.
 * - **Scope is matched structurally.** Origins are compared host-by-host and path scopes segment-by-segment. A prefix
 *   comparison on a URL is how `https://api.example.com.evil.test` gets treated as `api.example.com`.
 *
 * Pure. No network, no clock, no storage: `now` is always passed in, so every expiry test is deterministic.
 */

// ---------------------------------------------------------------- the registry

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** Risk order, for comparisons. Never for arithmetic. */
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export const atLeastAsRisky = (a: RiskLevel, b: RiskLevel): boolean => RISK_ORDER[a] >= RISK_ORDER[b]

export type CapabilityCategory =
  | 'computation'
  | 'storage'
  | 'network'
  | 'filesystem'
  | 'clipboard'
  | 'device'
  | 'browser'
  | 'page'
  | 'orion'
  | 'workspace'
  | 'system'

/** When the user has to be asked. Per capability, because asking about arithmetic trains people to click Allow. */
export type ConsentPolicy =
  /** Granted by policy, no prompt. Only ever for capabilities that cannot reach anything outside the Page. */
  | 'automatic'
  /** Ask once, remember the answer. */
  | 'prompt-first-use'
  /** Ask every time. For the ones where a standing grant is itself the risk. */
  | 'prompt-every-time'
  /** Never available to a Page, whatever anybody grants. */
  | 'never'

/** What a scope means for a capability, which decides how it is matched. */
export type ScopeKind =
  /** All or nothing. */
  | 'none'
  /** A web origin: scheme, host, port. */
  | 'origin'
  /** A path the user chose. */
  | 'path'
  /** Another Page, by id. */
  | 'page'

export interface CapabilityDefinition {
  /** Stable. Saved grants refer to it, so it may never be reused for something else. */
  id: string
  name: string
  description: string
  category: CapabilityCategory
  /** Authoritative. A manifest claiming otherwise is ignored. */
  risk: RiskLevel
  consent: ConsentPolicy
  scope: ScopeKind
  /**
   * Capabilities that must also be granted.
   *
   * A dependency is not a shortcut: being granted the dependent does not grant the dependency, and being granted the
   * dependency does not grant the dependent. Both are checked.
   */
  requires?: string[]
  /** What a Page has to say to justify it, for the prompt. Absent when no prompt is ever shown. */
  reasonRequired?: boolean
}

const capability = (definition: CapabilityDefinition): CapabilityDefinition => Object.freeze(definition)

/**
 * Every capability a Page may ask for.
 *
 * A capability not in this table does not exist, and asking for one is an error rather than a wildcard. Nothing is listed
 * here that the runtime cannot actually do -- a registry entry is a promise, and a promise the runtime cannot keep is
 * worse than a missing feature, because a Page will declare it and a prompt will offer it.
 */
export const CAPABILITIES: Record<string, CapabilityDefinition> = {
  // ---- computation. Local, deterministic, reaches nothing. The only automatic grants.
  'computation.arithmetic': capability({
    id: 'computation.arithmetic',
    name: 'Arithmetic',
    description: 'Work out sums, solve equations and evaluate expressions on this computer.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.units': capability({
    id: 'computation.units',
    name: 'Units and conversions',
    description: 'Convert between units and check that a calculation is dimensionally sound.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.statistics': capability({
    id: 'computation.statistics',
    name: 'Statistics',
    description: 'Summarise and analyse numbers on this computer.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.plot': capability({
    id: 'computation.plot',
    name: 'Draw graphs',
    description: 'Sample a function and work out the points, axes and ticks needed to draw it.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.data': capability({
    id: 'computation.data',
    name: 'Work with tables',
    description: 'Read, sort, filter, join and summarise tables of data held inside this Page.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.optimise': capability({
    id: 'computation.optimise',
    name: 'Find the best value',
    description: 'Search for the best settings of something, subject to constraints.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.simulate': capability({
    id: 'computation.simulate',
    name: 'Run simulations',
    description: 'Run a model forward in time, repeatedly or across a range of settings.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.measurement': capability({
    id: 'computation.measurement',
    name: 'Measurements and uncertainty',
    description: 'Combine measurements and work out how their uncertainties carry through.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.mathematics': capability({
    id: 'computation.mathematics',
    name: 'Mathematics',
    description: 'Work with algebra, matrices, calculus, geometry and whole numbers on this computer.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.document': capability({
    id: 'computation.document',
    name: 'Structured documents',
    description: 'Build, read and check documents, their outlines, references and citations inside this Page.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.interchange': capability({
    id: 'computation.interchange',
    name: 'Read and write file formats',
    description: 'Detect, decode and convert between file formats, and check what a conversion would lose. Reads only what the Page already holds.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.reasoning': capability({
    id: 'computation.reasoning',
    name: 'Structure a piece of work',
    description: 'Track assumptions, scenarios, plans, comparisons and what rests on what, and work out what has gone out of date.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.science': capability({
    id: 'computation.science',
    name: 'Scientific calculation',
    description:
      'Signals and spectra, interpolation and curve fitting, significant figures, physical constants, coordinate frames and constraint checking.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.physics': capability({
    id: 'computation.physics',
    name: 'Physics simulation',
    description:
      'Run real physical models: motion and projectiles, springs and pendulums, collisions, gravity and orbits, rotation and rolling, and waves.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.electromagnetism': capability({
    id: 'computation.electromagnetism',
    name: 'Electricity, light and sound',
    description:
      'Solve real circuits, map electric and magnetic fields, trace rays through lenses and mirrors, and work out interference, resonance and loudness.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.engineering': capability({
    id: 'computation.engineering',
    name: 'Engineering workshop',
    description:
      'Size beams and columns, solve trusses and pipe networks, work out heat flow through walls and exchangers, tune a control loop, and drive a robot arm.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.earth': capability({
    id: 'computation.earth',
    name: 'Earth, weather and land',
    description:
      'Measure distances and areas on the real Earth, work out where the sun is, follow humidity and air quality, trace where rain goes, read earthquakes and rock, and work out what a crop needs.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.humanities': capability({
    id: 'computation.humanities',
    name: 'Dates, texts and references',
    description:
      'Convert dates between calendars and count the days between them, measure how hard a text is to read, format references in a named style, and work out survey reliability, agreement and inequality.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.studio': capability({
    id: 'computation.studio',
    name: 'Study, music, colour and plans',
    description:
      'Work out when to review and how much is remembered, build scales and chords and work out delay times, check colour contrast and build palettes, do timecode and file-size arithmetic, and estimate work with its critical path.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),
  'computation.wasm': capability({
    id: 'computation.wasm',
    name: 'Compiled code',
    description: 'Run compiled WebAssembly inside this Page, for calculations too slow in ordinary script.',
    category: 'computation',
    // Not automatic like the rest of computation: WebAssembly needs the content security policy loosened, and code
    // nobody can read is code nobody can review. It stays local and reaches nothing, hence medium rather than high.
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'none',
    reasonRequired: true
  }),
  'computation.worker': capability({
    id: 'computation.worker',
    name: 'Background calculation',
    description: 'Run a long calculation without freezing the Page.',
    category: 'computation',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),

  // ---- the Page's own storage. Automatic, because the alternative is a Page that cannot remember anything.
  'storage.page': capability({
    id: 'storage.page',
    name: 'Save your work in this Page',
    description: 'Keep this Page’s own projects and settings on this computer.',
    category: 'storage',
    risk: 'low',
    consent: 'automatic',
    scope: 'none'
  }),

  // ---- clipboard. Writing is a user action; reading is taking something.
  'clipboard.write': capability({
    id: 'clipboard.write',
    name: 'Copy to the clipboard',
    description: 'Put a result on the clipboard when you ask it to.',
    category: 'clipboard',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'none'
  }),
  'clipboard.read': capability({
    id: 'clipboard.read',
    name: 'Read the clipboard',
    description: 'Read whatever is currently on the clipboard.',
    category: 'clipboard',
    risk: 'high',
    // Every time: a standing grant to read the clipboard reads everything copied afterwards, including a password.
    consent: 'prompt-every-time',
    scope: 'none',
    reasonRequired: true
  }),

  // ---- network. Scoped to an origin, never open.
  'network.fetch': capability({
    id: 'network.fetch',
    name: 'Reach the internet',
    description: 'Ask a named service for data.',
    category: 'network',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'origin',
    reasonRequired: true
  }),
  'network.stream': capability({
    id: 'network.stream',
    name: 'Keep a connection open',
    description: 'Hold a live connection to a named service for continuing data.',
    category: 'network',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'origin',
    requires: ['network.fetch'],
    reasonRequired: true
  }),

  // ---- files. Only what the user picked.
  'files.import': capability({
    id: 'files.import',
    name: 'Open a file you choose',
    description: 'Read a file you pick, and nothing else.',
    category: 'filesystem',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'path',
    reasonRequired: true
  }),
  'files.export': capability({
    id: 'files.export',
    name: 'Save a file where you choose',
    description: 'Write a result to a file you pick.',
    category: 'filesystem',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'path',
    reasonRequired: true
  }),

  // ---- devices.
  'device.camera': capability({
    id: 'device.camera',
    name: 'Use the camera',
    description: 'See through the camera while the Page is open.',
    category: 'device',
    risk: 'high',
    consent: 'prompt-every-time',
    scope: 'none',
    reasonRequired: true
  }),
  'device.microphone': capability({
    id: 'device.microphone',
    name: 'Use the microphone',
    description: 'Listen through the microphone while the Page is open.',
    category: 'device',
    risk: 'high',
    consent: 'prompt-every-time',
    scope: 'none',
    reasonRequired: true
  }),
  'device.location': capability({
    id: 'device.location',
    name: 'Use your location',
    description: 'Find out where you are.',
    category: 'device',
    risk: 'high',
    consent: 'prompt-every-time',
    scope: 'none',
    reasonRequired: true
  }),

  // ---- the browser. Reading and acting are separate privileges.
  'browser.read-page': capability({
    id: 'browser.read-page',
    name: 'Read the current web page',
    description: 'See what is on the web page you are looking at.',
    category: 'browser',
    risk: 'high',
    consent: 'prompt-first-use',
    scope: 'none',
    reasonRequired: true
  }),
  'browser.navigate': capability({
    id: 'browser.navigate',
    name: 'Open web pages',
    description: 'Send the browser to an address.',
    category: 'browser',
    risk: 'high',
    consent: 'prompt-first-use',
    scope: 'origin',
    reasonRequired: true
  }),
  'browser.control': capability({
    id: 'browser.control',
    name: 'Act in the browser',
    description: 'Click, type and submit on a web page on your behalf.',
    category: 'browser',
    risk: 'critical',
    consent: 'prompt-every-time',
    scope: 'origin',
    // Acting requires seeing. Declared explicitly rather than implied, so both appear in the review.
    requires: ['browser.read-page'],
    reasonRequired: true
  }),

  // ---- other Pages.
  'page.open': capability({
    id: 'page.open',
    name: 'Open another Page',
    description: 'Send you to another Orbis Page.',
    category: 'page',
    risk: 'low',
    consent: 'prompt-first-use',
    scope: 'page'
  }),
  'page.send': capability({
    id: 'page.send',
    name: 'Send data to another Page',
    description: 'Hand a result to a named Page.',
    category: 'page',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'page',
    reasonRequired: true
  }),

  // ---- Orion.
  'orion.explain': capability({
    id: 'orion.explain',
    name: 'Ask Orion to explain',
    description: 'Send a result to Orion and show the explanation.',
    category: 'orion',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'none',
    reasonRequired: true
  }),

  // ---- workspace surfaces that already have their own storage.
  'workspace.notes': capability({
    id: 'workspace.notes',
    name: 'Save to Notes',
    description: 'Write a result into your notes.',
    category: 'workspace',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'none'
  }),
  'workspace.whiteboard': capability({
    id: 'workspace.whiteboard',
    name: 'Send to the Whiteboard',
    description: 'Put a result on the whiteboard.',
    category: 'workspace',
    risk: 'medium',
    consent: 'prompt-first-use',
    scope: 'none'
  })
}

/**
 * Capabilities that exist as names so a refusal can be specific, and are never granted to anything.
 *
 * A Page asking for one gets a denial that says what it asked for, rather than "unknown capability" -- which would read
 * like a version problem and send somebody looking for an upgrade.
 */
export const FORBIDDEN_CAPABILITIES: Record<string, CapabilityDefinition> = {
  'system.execute': capability({
    id: 'system.execute',
    name: 'Run a program',
    description: 'Start a program on this computer.',
    category: 'system',
    risk: 'critical',
    consent: 'never',
    scope: 'none'
  }),
  'system.filesystem': capability({
    id: 'system.filesystem',
    name: 'Read anywhere on this computer',
    description: 'Read files without being given one.',
    category: 'system',
    risk: 'critical',
    consent: 'never',
    scope: 'none'
  }),
  'system.secrets': capability({
    id: 'system.secrets',
    name: 'Read the Secrets Vault',
    description: 'Read saved passwords, keys and secure notes.',
    category: 'system',
    risk: 'critical',
    consent: 'never',
    scope: 'none'
  }),
  'system.credentials': capability({
    id: 'system.credentials',
    name: 'Read browser sign-ins',
    description: 'Read browser passwords, cookies and authentication tokens.',
    category: 'system',
    risk: 'critical',
    consent: 'never',
    scope: 'none'
  })
}

/** The definition of a capability, or null when there is no such thing. Forbidden ones resolve, so refusals can be specific. */
export function capabilityById(id: string): CapabilityDefinition | null {
  // Read with `hasOwnProperty` rather than by indexing. `CAPABILITIES['constructor']` on a plain object returns the Object
  // constructor, which is truthy -- so plain indexing would answer "yes, that is a capability" for a name nobody defined.
  // A capability id arrives from a manifest, so it is somebody else's text and is treated that way.
  if (typeof id !== 'string' || id === '') return null
  if (Object.prototype.hasOwnProperty.call(CAPABILITIES, id)) return CAPABILITIES[id]
  if (Object.prototype.hasOwnProperty.call(FORBIDDEN_CAPABILITIES, id)) return FORBIDDEN_CAPABILITIES[id]
  return null
}

export const isGrantableCapability = (id: string): boolean => Object.prototype.hasOwnProperty.call(CAPABILITIES, id)

/** Every capability a Page may legitimately declare, for a picker or documentation. */
export const grantableCapabilities = (): CapabilityDefinition[] => Object.values(CAPABILITIES)

// ---------------------------------------------------------------- trust

/**
 * How much is known about where a Page came from.
 *
 * Trust changes the *default*, never the ceiling. A system Page still cannot have `system.secrets`, because that is
 * `consent: 'never'`, and no amount of trust moves it.
 */
export type PageTrust =
  /** Shipped with Orbis. */
  | 'system'
  /** Made by the person using Orbis, in this profile. */
  | 'user'
  /** Generated by Orion. Treated as user-made code that nobody has read, which is what it is. */
  | 'generated'
  /** Came from a file. Nothing is known about it. */
  | 'imported'
  | 'unknown'

/** The most risk a given trust level may reach without an explicit prompt. */
const TRUST_CEILING: Record<PageTrust, RiskLevel> = {
  system: 'high',
  user: 'medium',
  generated: 'low',
  imported: 'low',
  unknown: 'low'
}

// ---------------------------------------------------------------- scopes

export interface OriginScope {
  kind: 'origin'
  /** `https`. Never `http` unless the host is a loopback address. */
  scheme: string
  host: string
  /** Null means the scheme's default. */
  port: number | null
  /** Whether subdomains of `host` are included. */
  subdomains: boolean
}

export interface PathScope {
  kind: 'path'
  /** Already resolved and separator-normalised by the caller, which is the only place that can do it safely. */
  path: string
  /** Whether everything under the path is included, or only the path itself. */
  recursive: boolean
}

export interface PageScope {
  kind: 'page'
  pageId: string
}

export interface NoScope {
  kind: 'none'
}

export type Scope = OriginScope | PathScope | PageScope | NoScope

export const NO_SCOPE: NoScope = Object.freeze({ kind: 'none' })

/**
 * An origin scope from a URL.
 *
 * Refuses everything that is not plainly a web origin: no credentials in the URL, no wildcard host except a single
 * leading `*.`, and no plain HTTP outside loopback. A scope that cannot be read is null, and null is denied.
 */
export function originScope(input: string): OriginScope | null {
  const text = String(input ?? '').trim()
  if (text === '' || text.length > 512) return null

  let subdomains = false
  let toParse = text
  // A single leading `*.` is the only wildcard allowed, and it is stripped before the URL parser sees it.
  const wildcard = /^(https?:\/\/)\*\./i.exec(text)
  if (wildcard) {
    subdomains = true
    toParse = `${wildcard[1]}${text.slice(wildcard[0].length)}`
  }

  let url: URL
  try {
    url = new URL(toParse)
  } catch {
    return null
  }

  const scheme = url.protocol.replace(':', '').toLowerCase()
  if (scheme !== 'https' && scheme !== 'http') return null
  // Credentials in a scope would be a credential in a saved grant.
  if (url.username !== '' || url.password !== '') return null

  const host = url.hostname.toLowerCase()
  if (host === '' || host.includes('*')) return null

  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  // Plain HTTP to anywhere but this computer is a scope that leaks whatever travels over it.
  if (scheme === 'http' && !loopback) return null
  // A wildcard over a loopback host means nothing, and a wildcard over a public suffix means everything.
  if (subdomains && (loopback || !host.includes('.'))) return null

  const port = url.port === '' ? null : Number(url.port)
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null

  return { kind: 'origin', scheme, host, port, subdomains }
}

const defaultPort = (scheme: string): number => (scheme === 'https' ? 443 : 80)

/**
 * Whether a granted origin scope covers a requested one.
 *
 * Compared host label by host label. A prefix comparison would let `api.example.com.evil.test` pass a grant for
 * `api.example.com`, which is the bug this function exists to not have.
 *
 * ## A wildcard means subdomains, and not the domain itself
 *
 * `*.example.com` covers `api.example.com` and does **not** cover `example.com`. That is narrower than most people expect
 * and it is the deliberate reading: the apex is usually the sensitive host -- the account pages, the session cookie --
 * while the subdomains are the CDN and the API. A grant for the parts should not quietly include the whole.
 *
 * Somebody who wants both holds two scopes. That is one more click and one fewer way to be surprised.
 */
export function originScopeCovers(granted: OriginScope, requested: OriginScope): boolean {
  if (granted.scheme !== requested.scheme) return false
  const grantedPort = granted.port ?? defaultPort(granted.scheme)
  const requestedPort = requested.port ?? defaultPort(requested.scheme)
  if (grantedPort !== requestedPort) return false
  // Whole labels either way: `.example.com` matches `api.example.com` and never `notexample.com`.
  if (granted.subdomains) return requested.host.endsWith(`.${granted.host}`)
  return granted.host === requested.host
}

/** Whether a granted path scope covers a requested one, compared segment by segment. */
export function pathScopeCovers(granted: PathScope, requested: PathScope): boolean {
  const split = (path: string): string[] => path.split('/').filter((part) => part !== '')
  const grantedParts = split(granted.path)
  const requestedParts = split(requested.path)
  // A relative part anywhere means the path was never resolved, and an unresolved path cannot be authorised.
  if ([...grantedParts, ...requestedParts].some((part) => part === '.' || part === '..')) return false
  if (grantedParts.length === requestedParts.length) {
    return grantedParts.every((part, i) => part === requestedParts[i])
  }
  if (!granted.recursive) return false
  if (requestedParts.length < grantedParts.length) return false
  // Whole segments, so `/home/ana/docs` does not cover `/home/ana/documents-private`.
  return grantedParts.every((part, i) => part === requestedParts[i])
}

/** Whether a granted scope covers a requested one, whatever kind they are. Mismatched kinds never match. */
export function scopeCovers(granted: Scope, requested: Scope): boolean {
  if (granted.kind !== requested.kind) return false
  switch (granted.kind) {
    case 'none':
      return true
    case 'origin':
      return originScopeCovers(granted, requested as OriginScope)
    case 'path':
      return pathScopeCovers(granted, requested as PathScope)
    case 'page':
      return granted.pageId === (requested as PageScope).pageId
  }
}

/** A scope written out, for a prompt and for a permission list. */
export function describeScope(scope: Scope): string {
  switch (scope.kind) {
    case 'none':
      return ''
    case 'origin': {
      const port = scope.port === null ? '' : `:${scope.port}`
      return `${scope.subdomains ? '*.' : ''}${scope.host}${port}`
    }
    case 'path':
      return scope.recursive ? `${scope.path} and everything in it` : scope.path
    case 'page':
      return scope.pageId
  }
}

// ---------------------------------------------------------------- grants

export type GrantState = 'active' | 'revoked' | 'expired'

export interface PermissionGrant {
  pageId: string
  capabilityId: string
  scope: Scope
  grantedAt: number
  /** Null for a standing grant. A number for one that lapses. */
  expiresAt: number | null
  /** Who decided. `system` for a policy default, `user` for an answered prompt. */
  source: 'system' | 'user'
  /**
   * The version of the Page the grant was given to.
   *
   * A grant belongs to the code that asked for it. Page code that changed is code nobody has agreed to, which is why an
   * update re-opens the question rather than inheriting the answer.
   */
  pageVersion: string
  state: GrantState
}

/** Whether a grant is usable now. Anything malformed is not, because a malformed grant cannot be trusted to be narrow. */
export function grantIsLive(grant: PermissionGrant, now: number): boolean {
  if (!grant || typeof grant !== 'object') return false
  if (grant.state !== 'active') return false
  if (typeof grant.grantedAt !== 'number' || !Number.isFinite(grant.grantedAt)) return false
  if (grant.grantedAt > now) return false
  if (grant.expiresAt !== null) {
    if (typeof grant.expiresAt !== 'number' || !Number.isFinite(grant.expiresAt)) return false
    if (grant.expiresAt <= now) return false
  }
  if (!isGrantableCapability(grant.capabilityId)) return false
  return true
}

// ---------------------------------------------------------------- decisions

export type Outcome = 'allow' | 'deny' | 'prompt' | 'unavailable'

export type DenialReason =
  | 'unknown-capability'
  | 'forbidden-capability'
  | 'not-declared'
  | 'blocked-by-policy'
  | 'trust-too-low'
  | 'dependency-missing'
  | 'scope-not-granted'
  | 'scope-unreadable'
  | 'grant-expired'
  | 'grant-revoked'
  | 'page-version-changed'
  | 'no-grant'

export interface Decision {
  outcome: Outcome
  capabilityId: string
  /** The rule that decided, so a denial can be explained without reading the source. */
  reason: DenialReason | 'granted' | 'automatic' | 'needs-user' | 'not-available-here'
  /** A sentence for a person. */
  message: string
  /** The risk the registry assigns, never what the Page claimed. */
  risk: RiskLevel | null
  /** The scope the decision applies to. */
  scope: Scope
  /** Capabilities that must be decided first, when that is what blocked it. */
  blockedBy: string[]
}

export interface DecideInput {
  capabilityId: string
  /** What the Page is asking to reach. Omitted for unscoped capabilities. */
  scope?: Scope
  pageId: string
  pageVersion: string
  trust: PageTrust
  /** What the Page's manifest declared. A request, not a permission. */
  declared: readonly string[]
  /** Every grant this Page has. */
  grants: readonly PermissionGrant[]
  /**
   * Capability ids the environment cannot provide -- no camera, no microphone, network switched off.
   *
   * Kept apart from denial so the two can be reported differently.
   */
  unavailable?: readonly string[]
  /** Capability ids a higher-level policy forbids for this profile. Outranks every grant. */
  blocked?: readonly string[]
  now: number
}

const deny = (capabilityId: string, reason: DenialReason, message: string, risk: RiskLevel | null, scope: Scope, blockedBy: string[] = []): Decision => ({
  outcome: 'deny',
  capabilityId,
  reason,
  message,
  risk,
  scope,
  blockedBy
})

/**
 * Whether a Page may use a capability, right now, for this scope.
 *
 * The single place the question is answered. Every caller -- the Page API, an Orion-initiated action, a workflow step, a
 * voice command -- goes through here, because a second implementation is a second set of rules and one of them will be
 * the wrong one.
 *
 * The order below is the precedence, and it is deliberate: a policy block outranks a user grant, because a user cannot
 * consent their way past a rule set for the profile.
 */
export function decide(input: DecideInput): Decision {
  const { capabilityId, pageId, pageVersion, trust, declared, grants, now } = input
  const scope: Scope = input.scope ?? NO_SCOPE

  // 1. Is it a thing at all? Deny-by-default starts here: an unrecognised name is never a wildcard.
  const definition = capabilityById(capabilityId)
  if (!definition) {
    return deny(capabilityId, 'unknown-capability', `Orbis has no capability called "${capabilityId}".`, null, scope)
  }

  // 2. Some capabilities exist only so that refusing them can be specific.
  if (definition.consent === 'never' || !isGrantableCapability(capabilityId)) {
    return deny(
      capabilityId,
      'forbidden-capability',
      `Pages are never given "${definition.name}". Nothing can grant it.`,
      definition.risk,
      scope
    )
  }

  // 3. Profile or system policy, which outranks everything a user could answer.
  if (input.blocked?.includes(capabilityId)) {
    return deny(capabilityId, 'blocked-by-policy', `"${definition.name}" is switched off for this profile.`, definition.risk, scope)
  }

  // 4. Declared? An undeclared capability is one the Page did not say it needed, so nobody reviewed it.
  if (!declared.includes(capabilityId)) {
    return deny(
      capabilityId,
      'not-declared',
      `This Page did not ask for "${definition.name}", so it cannot use it.`,
      definition.risk,
      scope
    )
  }

  // 5. Can the machine even do it? Reported apart from denial, so the message points at the right thing.
  if (input.unavailable?.includes(capabilityId)) {
    return {
      outcome: 'unavailable',
      capabilityId,
      reason: 'not-available-here',
      message: `"${definition.name}" is not available on this computer.`,
      risk: definition.risk,
      scope,
      blockedBy: []
    }
  }

  // 6. Scope has to be readable before it can be matched. An unreadable scope is denied, never widened.
  if (definition.scope !== 'none' && scope.kind !== definition.scope) {
    return deny(
      capabilityId,
      'scope-unreadable',
      `"${definition.name}" needs to be asked for with a specific ${definition.scope}.`,
      definition.risk,
      scope
    )
  }

  // 7. Dependencies. Checked recursively, and a cycle is treated as unmet rather than followed.
  const missing = unmetDependencies(definition, input, new Set([capabilityId]))
  if (missing.length > 0) {
    return deny(
      capabilityId,
      'dependency-missing',
      `"${definition.name}" also needs ${missing.map((id) => capabilityById(id)?.name ?? id).join(', ')}.`,
      definition.risk,
      scope,
      missing
    )
  }

  // 8. An existing grant. This is the only path to `allow` for anything that is not automatic.
  const relevant = grants.filter((grant) => grant.pageId === pageId && grant.capabilityId === capabilityId)
  const live = relevant.filter((grant) => grantIsLive(grant, now))

  for (const grant of live) {
    // A grant belongs to the version that asked for it.
    if (grant.pageVersion !== pageVersion) continue
    if (!scopeCovers(grant.scope, scope)) continue
    // Ask-every-time means a standing grant is not enough on its own; the prompt is the point.
    if (definition.consent === 'prompt-every-time') continue
    return {
      outcome: 'allow',
      capabilityId,
      reason: 'granted',
      message: `Allowed${describeScope(scope) === '' ? '' : ` for ${describeScope(scope)}`}.`,
      risk: definition.risk,
      scope,
      blockedBy: []
    }
  }

  // 9. Why there was no usable grant, specifically -- so "denied" is never the whole answer.
  if (relevant.length > 0 && live.length === 0) {
    const revoked = relevant.some((grant) => grant.state === 'revoked')
    return deny(
      capabilityId,
      revoked ? 'grant-revoked' : 'grant-expired',
      revoked
        ? `Permission for "${definition.name}" was withdrawn.`
        : `Permission for "${definition.name}" has lapsed.`,
      definition.risk,
      scope
    )
  }
  if (live.length > 0 && live.every((grant) => grant.pageVersion !== pageVersion)) {
    return deny(
      capabilityId,
      'page-version-changed',
      `This Page has changed since "${definition.name}" was allowed, so it needs asking again.`,
      definition.risk,
      scope
    )
  }
  if (live.length > 0 && definition.consent !== 'prompt-every-time') {
    return deny(
      capabilityId,
      'scope-not-granted',
      `"${definition.name}" is allowed, but not for ${describeScope(scope) || 'this'}.`,
      definition.risk,
      scope
    )
  }

  // 10. No grant. Automatic if the capability reaches nothing and the trust level permits it; otherwise ask.
  if (definition.consent === 'automatic' && !atLeastAsRisky(definition.risk, 'medium')) {
    if (atLeastAsRisky(definition.risk, nextRisk(TRUST_CEILING[trust]))) {
      return deny(
        capabilityId,
        'trust-too-low',
        `"${definition.name}" is not given automatically to a Page from this source.`,
        definition.risk,
        scope
      )
    }
    return {
      outcome: 'allow',
      capabilityId,
      reason: 'automatic',
      message: `"${definition.name}" happens entirely on this computer and needs no permission.`,
      risk: definition.risk,
      scope,
      blockedBy: []
    }
  }

  // A prompt is only worth showing if the answer could be yes.
  if (atLeastAsRisky(definition.risk, nextRisk(TRUST_CEILING[trust])) && trust !== 'system' && trust !== 'user') {
    return deny(
      capabilityId,
      'trust-too-low',
      `"${definition.name}" is too far-reaching for a Page that came from outside Orbis.`,
      definition.risk,
      scope
    )
  }

  return {
    outcome: 'prompt',
    capabilityId,
    reason: 'needs-user',
    message: `This Page wants to ${definition.description.replace(/\.$/, '')}.`,
    risk: definition.risk,
    scope,
    blockedBy: []
  }
}

/** One step up the risk ladder, so a ceiling can be compared against. `critical` has nothing above it. */
const nextRisk = (level: RiskLevel): RiskLevel => {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical']
  return order[Math.min(order.length - 1, RISK_ORDER[level] + 1)]
}

/**
 * Dependencies a capability needs that are not themselves allowed.
 *
 * Recursive, with a visited set: a registry mistake that made two capabilities depend on each other should produce a
 * denial, not a stack overflow.
 */
function unmetDependencies(definition: CapabilityDefinition, input: DecideInput, seen: Set<string>): string[] {
  const missing: string[] = []
  for (const required of definition.requires ?? []) {
    if (seen.has(required)) {
      // A cycle. Unmet by definition -- nothing can be established first.
      missing.push(required)
      continue
    }
    const nested = decide({ ...input, capabilityId: required, scope: NO_SCOPE_FOR(required, input) })
    if (nested.outcome !== 'allow') missing.push(required)
  }
  return missing
}

/**
 * The scope to check a dependency against.
 *
 * A dependency shares the request's scope when it is scoped the same way, and otherwise has none. Passing the wrong kind
 * of scope down would make the dependency fail as unreadable and hide the real reason.
 */
function NO_SCOPE_FOR(capabilityId: string, input: DecideInput): Scope {
  const definition = capabilityById(capabilityId)
  if (!definition) return NO_SCOPE
  if (definition.scope === 'none') return NO_SCOPE
  const requested = input.scope ?? NO_SCOPE
  return requested.kind === definition.scope ? requested : NO_SCOPE
}

// ---------------------------------------------------------------- handles

/**
 * Permission, once, turned into something that can be handed to the code doing the work.
 *
 * A handle is not authority on its own: it is checked against the grants every time it is used, so revoking a permission
 * invalidates every handle already issued without having to find them. That is the difference between a permission system
 * and a permission screen.
 */
export interface CapabilityHandle {
  readonly capabilityId: string
  readonly pageId: string
  readonly pageVersion: string
  readonly scope: Scope
  readonly issuedAt: number
  readonly expiresAt: number
  /** Unguessable. A handle that can be constructed is not a handle. */
  readonly nonce: string
}

/** The longest a handle stays usable without being re-checked. */
export const HANDLE_LIFETIME_MS = 5 * 60_000

export function issueHandle(decision: Decision, input: DecideInput, nonce: string): CapabilityHandle | null {
  if (decision.outcome !== 'allow') return null
  if (typeof nonce !== 'string' || nonce.length < 16) return null
  return Object.freeze({
    capabilityId: decision.capabilityId,
    pageId: input.pageId,
    pageVersion: input.pageVersion,
    scope: decision.scope,
    issuedAt: input.now,
    expiresAt: input.now + HANDLE_LIFETIME_MS,
    nonce
  })
}

/**
 * Whether a handle is still worth anything.
 *
 * Re-decides rather than trusting the handle, because the answer can have changed since it was issued -- that is the
 * whole point of checking.
 */
export function handleIsValid(handle: CapabilityHandle, input: Omit<DecideInput, 'capabilityId' | 'scope'>): boolean {
  if (!handle || typeof handle !== 'object') return false
  if (handle.pageId !== input.pageId) return false
  if (handle.pageVersion !== input.pageVersion) return false
  if (handle.expiresAt <= input.now) return false
  const again = decide({ ...input, capabilityId: handle.capabilityId, scope: handle.scope })
  return again.outcome === 'allow'
}

// ---------------------------------------------------------------- declarations and review

export interface DeclarationProblem {
  capabilityId: string
  error: 'unknown' | 'forbidden' | 'missing-dependency' | 'missing-reason' | 'duplicate'
  message: string
}

/**
 * Whether a set of declared capabilities is one a Page may have.
 *
 * Run when a Page is installed, updated or imported -- before anything of it executes. A declaration that names something
 * unknown is refused rather than ignored, because ignoring it means the Page runs believing it has something it does not.
 */
export function checkDeclarations(
  declared: readonly string[],
  reasons: Readonly<Record<string, string>> = {}
): DeclarationProblem[] {
  const problems: DeclarationProblem[] = []
  const seen = new Set<string>()

  for (const id of declared) {
    if (seen.has(id)) {
      problems.push({ capabilityId: id, error: 'duplicate', message: `"${id}" is declared more than once.` })
      continue
    }
    seen.add(id)

    const definition = capabilityById(id)
    if (!definition) {
      problems.push({ capabilityId: id, error: 'unknown', message: `Orbis has no capability called "${id}".` })
      continue
    }
    if (!isGrantableCapability(id) || definition.consent === 'never') {
      problems.push({ capabilityId: id, error: 'forbidden', message: `"${definition.name}" is never available to a Page.` })
      continue
    }
    if (definition.reasonRequired === true) {
      // Same reason as `capabilityById`: an inherited property must not look like a supplied reason.
      const reason = Object.prototype.hasOwnProperty.call(reasons, id) ? reasons[id] : undefined
      if (typeof reason !== 'string' || reason.trim().length < 8) {
        problems.push({
          capabilityId: id,
          error: 'missing-reason',
          message: `"${definition.name}" has to say what it is for before it can be offered.`
        })
      }
    }
  }

  // Dependencies have to be declared too, so the review shows everything rather than only the headline.
  for (const id of seen) {
    const definition = capabilityById(id)
    for (const required of definition?.requires ?? []) {
      if (!seen.has(required)) {
        problems.push({
          capabilityId: id,
          error: 'missing-dependency',
          message: `"${definition?.name ?? id}" needs "${capabilityById(required)?.name ?? required}", which is not declared.`
        })
      }
    }
  }

  return problems
}

export interface CapabilityChange {
  added: string[]
  removed: string[]
  /** Whether the change is one a person has to look at before the new version runs. */
  needsReview: boolean
  /** The riskiest thing added, which is what makes the review necessary. */
  highestAdded: RiskLevel | null
  describe: string
}

/**
 * What changed between two versions of a Page's declarations.
 *
 * A new version that asks for more is a new version nobody has agreed to. Detecting that is what stops an update being a
 * way to acquire permissions quietly -- the single most likely route to privilege escalation in a system like this.
 */
export function capabilityChanges(before: readonly string[], after: readonly string[]): CapabilityChange {
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  let highest: RiskLevel | null = null
  for (const id of added) {
    const risk = capabilityById(id)?.risk
    if (!risk) {
      // An unknown addition is treated as the worst case. Guessing downwards here would be guessing in the wrong
      // direction.
      highest = 'critical'
      continue
    }
    if (highest === null || atLeastAsRisky(risk, highest)) highest = risk
  }
  const needsReview = added.length > 0 && highest !== null && atLeastAsRisky(highest, 'medium')
  const describe =
    added.length === 0
      ? removed.length === 0
        ? 'This update asks for nothing new.'
        : `This update gives up ${removed.length} permission${removed.length === 1 ? '' : 's'}.`
      : `This update asks for ${added.map((id) => capabilityById(id)?.name ?? id).join(', ')}.`
  return { added, removed, needsReview, highestAdded: highest, describe }
}

/**
 * Everything a Page may do, as a permission list.
 *
 * Built from the decisions rather than from the declarations, so what is shown is what is true. A list built from the
 * manifest would show what the Page asked for, which is a different thing and the one people misread.
 */
export function permissionSummary(input: Omit<DecideInput, 'capabilityId' | 'scope'>): {
  capabilityId: string
  name: string
  risk: RiskLevel
  outcome: Outcome
  scope: string
  message: string
}[] {
  return input.declared
    .map((capabilityId) => {
      const definition = capabilityById(capabilityId)
      const grant = input.grants.find(
        (one) => one.pageId === input.pageId && one.capabilityId === capabilityId && grantIsLive(one, input.now)
      )
      const decision = decide({ ...input, capabilityId, scope: grant?.scope ?? NO_SCOPE })
      return {
        capabilityId,
        name: definition?.name ?? capabilityId,
        risk: definition?.risk ?? 'critical',
        outcome: decision.outcome,
        scope: describeScope(grant?.scope ?? NO_SCOPE),
        message: decision.message
      }
    })
    .sort((a, b) => RISK_ORDER[b.risk] - RISK_ORDER[a.risk])
}
