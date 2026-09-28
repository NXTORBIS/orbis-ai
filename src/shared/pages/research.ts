/**
 * Research: questions, sources, claims, evidence, and what can be said about how well supported anything is.
 *
 * The distinction the whole thing rests on is between a **claim** and the **evidence** for it. They are separate
 * objects joined by a link that records which source the evidence came from and whether that source was actually
 * read. Collapsing them -- storing a claim with a "source" field and calling it cited -- is how a research tool ends
 * up full of assertions attributed to papers nobody opened.
 *
 * ## A source has an access state
 *
 * Discovered, accessed, read, and unavailable are different. A URL somebody found in a search result is not a source
 * they read, and evidence cannot come from a source in the first state -- `link` refuses it.
 *
 * ## Contradiction is a finding
 *
 * Where two pieces of evidence point opposite ways, both are kept and the conflict is reported. Nothing here decides
 * which source is right, because nothing here knows.
 */

export interface ResearchError {
  error: string
  message: string
}

export const isResearchError = (value: unknown): value is ResearchError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): ResearchError => ({ error, message })

export const RESEARCH_LIMITS: Readonly<Record<'sources' | 'claims' | 'evidence' | 'questions' | 'excerptLength', number>> = Object.freeze({
  sources: 10_000,
  claims: 20_000,
  evidence: 100_000,
  questions: 1_000,
  excerptLength: 4_000
})

// ---------------------------------------------------------------- sources

export type SourceKind = 'article' | 'paper' | 'book' | 'report' | 'dataset' | 'documentation' | 'news' | 'web' | 'interview' | 'page' | 'note'

/** How far Orbis actually got with this source. Nothing is assumed; every state has to be set by something real. */
export type Access = 'discovered' | 'accessed' | 'parsed' | 'read' | 'unavailable' | 'paywalled' | 'failed'

export interface Source {
  id: string
  kind: SourceKind
  /** Never invented. An unknown title is an empty string, not "Untitled". */
  title: string
  authors: string[]
  publisher: string
  year: string
  url: string
  /** When Orbis actually reached it. Empty where it did not. */
  accessedAt: string
  access: Access
  /** How this source came to be here, which is different from what it says. */
  foundVia: string
  tags: string[]
  notes: string
}

export interface SourceCheck {
  complete: boolean
  missing: string[]
  usable: boolean
  describe: string
}

/**
 * What a source is missing, and whether evidence may be drawn from it.
 *
 * A source that was only discovered cannot support evidence. That is the check that stops a search result becoming a
 * citation: somebody has to have opened it.
 */
export function checkSource(one: Source): SourceCheck {
  const missing: string[] = []
  if (one.title.trim() === '') missing.push('title')
  if (one.authors.length === 0) missing.push('author')
  if (one.year.trim() === '') missing.push('year')
  if ((one.kind === 'web' || one.kind === 'news') && one.url.trim() === '') missing.push('url')
  if (one.access === 'read' && one.accessedAt.trim() === '') missing.push('the date it was read')

  const usable = one.access === 'read' || one.access === 'parsed'
  return {
    complete: missing.length === 0,
    missing,
    usable,
    describe: usable
      ? missing.length === 0
        ? 'This source has been read and its details are complete.'
        : `This source has been read. Its ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not recorded, so a citation from it will be incomplete rather than wrong.`
      : one.access === 'discovered'
        ? 'This source was found but has not been opened. Nothing can be cited from it until somebody reads it: a search result is not a source.'
        : `This source could not be used: it is ${one.access}. Anything that needs it is unsupported rather than supported by something unavailable.`
  }
}

// ---------------------------------------------------------------- claims and evidence

export type ClaimStatus = 'unexamined' | 'supported' | 'contested' | 'contradicted' | 'unsupported' | 'asserted'

export interface Claim {
  id: string
  text: string
  /** Which question this bears on. A claim with none is a claim nobody asked for. */
  questionId: string | null
  /** Set by `assessClaim` from the evidence, never typed in. */
  status: ClaimStatus
  /** Whether the person is asserting this themselves rather than reporting a source. Kept distinct. */
  ownAssertion: boolean
  tags: string[]
}

export type Direction = 'supports' | 'contradicts' | 'qualifies' | 'background'

export interface Evidence {
  id: string
  claimId: string
  sourceId: string
  direction: Direction
  /** The actual words. Evidence with no excerpt is a claim about a source rather than evidence from it. */
  excerpt: string
  /** Where in the source, so somebody can check. */
  locator: string
  /** Somebody's judgement of how directly this bears on the claim. Never computed. */
  strength: 'direct' | 'indirect' | 'weak'
  notes: string
}

/**
 * Evidence linked to a claim, with the checks that make the link mean something.
 *
 * Three refusals, each catching a different way a research record goes wrong: citing a source nobody opened, evidence
 * with no excerpt, and linking to a claim that is not there.
 */
export function link(
  evidence: Omit<Evidence, 'id'>,
  id: string,
  sources: readonly Source[],
  claims: readonly Claim[]
): Evidence | ResearchError {
  const source = sources.find((one) => one.id === evidence.sourceId)
  if (!source) return fail('not-found', `There is no source with the id "${evidence.sourceId}".`)
  if (!claims.some((one) => one.id === evidence.claimId)) {
    return fail('not-found', `There is no claim with the id "${evidence.claimId}".`)
  }

  const check = checkSource(source)
  if (!check.usable) {
    return fail(
      'source-not-read',
      `"${source.title || source.url || source.id}" is ${source.access}, so nothing can be cited from it. ${check.describe}`
    )
  }
  if (evidence.excerpt.trim() === '') {
    return fail(
      'no-excerpt',
      'Evidence needs the words it came from. Without an excerpt this is a claim about what a source says rather than evidence from it, and nobody can check it.'
    )
  }
  if (evidence.excerpt.length > RESEARCH_LIMITS.excerptLength) {
    return fail('too-long', `An excerpt is at most ${RESEARCH_LIMITS.excerptLength} characters. Quote the part that bears on the claim.`)
  }

  return { ...evidence, id }
}

export interface ClaimAssessment {
  claimId: string
  status: ClaimStatus
  supporting: number
  contradicting: number
  qualifying: number
  /** Sources that support it, which matters more than how many pieces of evidence there are. */
  supportingSources: string[]
  contradictingSources: string[]
  /** True where all the support comes from one source, which is weaker than the count suggests. */
  singleSource: boolean
  describe: string
}

/**
 * A claim's status, from the evidence rather than from a judgement.
 *
 * Counted by *source* rather than by piece of evidence. Three quotations from one paper are one source agreeing with
 * itself, and a count of evidence would make that look like three independent confirmations -- which is the exact
 * shape of a literature that seems settled and is not.
 */
export function assessClaim(claim: Claim, evidence: readonly Evidence[]): ClaimAssessment {
  const mine = evidence.filter((one) => one.claimId === claim.id)
  const supporting = mine.filter((one) => one.direction === 'supports')
  const contradicting = mine.filter((one) => one.direction === 'contradicts')
  const qualifying = mine.filter((one) => one.direction === 'qualifies')

  const supportingSources = [...new Set(supporting.map((one) => one.sourceId))]
  const contradictingSources = [...new Set(contradicting.map((one) => one.sourceId))]

  const status: ClaimStatus =
    claim.ownAssertion && mine.length === 0
      ? 'asserted'
      : mine.length === 0
        ? 'unsupported'
        : contradictingSources.length > 0 && supportingSources.length > 0
          ? 'contested'
          : contradictingSources.length > 0
            ? 'contradicted'
            : 'supported'

  const singleSource = supportingSources.length === 1 && supporting.length > 1

  let describe: string
  switch (status) {
    case 'asserted':
      describe = 'This is stated by the person rather than taken from a source. It is recorded as an assertion, which is not the same as being unsupported.'
      break
    case 'unsupported':
      describe = 'Nothing supports this yet. That is a gap in the research, not a judgement about whether it is true.'
      break
    case 'contested':
      describe = `${supportingSources.length} source${supportingSources.length === 1 ? '' : 's'} support this and ${contradictingSources.length} contradict it. Both are kept; nothing here decides between them.`
      break
    case 'contradicted':
      describe = `${contradictingSources.length} source${contradictingSources.length === 1 ? '' : 's'} contradict this and nothing supports it.`
      break
    case 'supported':
      describe = singleSource
        ? `${supporting.length} pieces of evidence support this, all from one source. That is one source agreeing with itself, not ${supporting.length} independent confirmations.`
        : `${supportingSources.length} source${supportingSources.length === 1 ? '' : 's'} support this.`
      break
  }
  if (qualifying.length > 0) {
    describe += ` ${qualifying.length} piece${qualifying.length === 1 ? '' : 's'} of evidence qualify it rather than supporting or contradicting it.`
  }

  return {
    claimId: claim.id,
    status,
    supporting: supporting.length,
    contradicting: contradicting.length,
    qualifying: qualifying.length,
    supportingSources,
    contradictingSources,
    singleSource,
    describe
  }
}

// ---------------------------------------------------------------- questions and scope

export interface Question {
  id: string
  text: string
  parent: string | null
  /** Answered when a claim bearing on it is supported. Derived, never set by hand. */
  answered: boolean
  notes: string
}

export interface Scope {
  topic: string
  from: string
  to: string
  regions: string[]
  sourceKinds: SourceKind[]
  languages: string[]
  excluded: string[]
  describe: string
}

export interface ScopeCheck {
  inScope: boolean
  reasons: string[]
  describe: string
}

/**
 * Whether a source falls inside the stated scope.
 *
 * Out of scope is not the same as bad. A paper from outside the date range may be the most relevant thing found, and
 * this reports the mismatch rather than excluding it -- the decision about what to do belongs to the person.
 */
export function checkScope(source: Source, scope: Scope): ScopeCheck {
  const reasons: string[] = []

  if (scope.from !== '' && source.year !== '' && source.year < scope.from) {
    reasons.push(`published in ${source.year}, before the ${scope.from} the scope starts at`)
  }
  if (scope.to !== '' && source.year !== '' && source.year > scope.to) {
    reasons.push(`published in ${source.year}, after the ${scope.to} the scope ends at`)
  }
  if (scope.sourceKinds.length > 0 && !scope.sourceKinds.includes(source.kind)) {
    reasons.push(`a ${source.kind}, and the scope covers ${scope.sourceKinds.join(', ')}`)
  }
  for (const excluded of scope.excluded) {
    if (excluded !== '' && `${source.title} ${source.notes}`.toLowerCase().includes(excluded.toLowerCase())) {
      reasons.push(`mentions "${excluded}", which the scope excludes`)
    }
  }

  return {
    inScope: reasons.length === 0,
    reasons,
    describe:
      reasons.length === 0
        ? 'This source is inside the scope as stated.'
        : `This source is outside the scope: it is ${reasons.join('; ')}. That is a mismatch to decide about, not a reason it is wrong -- the most relevant thing found is sometimes outside the scope somebody set at the start.`
  }
}

// ---------------------------------------------------------------- gaps and contradictions

export type GapKind = 'unanswered-question' | 'unsupported-claim' | 'single-source' | 'contested' | 'incomplete-source' | 'unread-source' | 'uncited-source'

export interface Gap {
  kind: GapKind
  about: string
  describe: string
  /** Something specific to do. Never "do more research". */
  suggestion: string
}

/**
 * What the research is missing.
 *
 * Every gap is a specific thing with a specific next step. "More research is needed" is the least useful sentence a
 * research tool can produce; "this claim rests on one source, and the question it bears on has no other evidence" is
 * something somebody can act on this afternoon.
 */
export function findGaps(
  questions: readonly Question[],
  claims: readonly Claim[],
  evidence: readonly Evidence[],
  sources: readonly Source[]
): Gap[] {
  const gaps: Gap[] = []
  const assessments = new Map(claims.map((one) => [one.id, assessClaim(one, evidence)]))

  for (const question of questions) {
    const bearing = claims.filter((one) => one.questionId === question.id)
    if (bearing.length === 0) {
      gaps.push({
        kind: 'unanswered-question',
        about: question.id,
        describe: `"${question.text}" has no claim bearing on it at all.`,
        suggestion: 'Either find something that bears on it, or record that it turned out not to be answerable from the sources available.'
      })
      continue
    }
    if (!bearing.some((one) => assessments.get(one.id)?.status === 'supported')) {
      gaps.push({
        kind: 'unanswered-question',
        about: question.id,
        describe: `"${question.text}" has ${bearing.length} claim${bearing.length === 1 ? '' : 's'} bearing on it and none of them is supported.`,
        suggestion: `Find evidence for one of: ${bearing.map((one) => one.text.slice(0, 60)).join('; ')}.`
      })
    }
  }

  for (const claim of claims) {
    const assessment = assessments.get(claim.id) as ClaimAssessment
    if (assessment.status === 'unsupported') {
      gaps.push({
        kind: 'unsupported-claim',
        about: claim.id,
        describe: `"${claim.text}" has nothing supporting it.`,
        suggestion: 'Find a source for it, mark it as your own assertion, or remove it.'
      })
    }
    if (assessment.singleSource) {
      gaps.push({
        kind: 'single-source',
        about: claim.id,
        describe: `"${claim.text}" rests entirely on ${assessment.supportingSources[0]}.`,
        suggestion: 'Find a second, independent source. One source agreeing with itself several times is still one source.'
      })
    }
    if (assessment.status === 'contested') {
      gaps.push({
        kind: 'contested',
        about: claim.id,
        describe: `"${claim.text}" is supported by ${assessment.supportingSources.length} source${assessment.supportingSources.length === 1 ? '' : 's'} and contradicted by ${assessment.contradictingSources.length}.`,
        suggestion: 'Look at what the two sets of sources actually measured. A contradiction is often two different questions answered correctly.'
      })
    }
  }

  const cited = new Set(evidence.map((one) => one.sourceId))
  for (const source of sources) {
    const check = checkSource(source)
    if (source.access === 'discovered') {
      gaps.push({
        kind: 'unread-source',
        about: source.id,
        describe: `"${source.title || source.url}" was found and has not been opened.`,
        suggestion: 'Read it or mark it as not worth reading. A list of unopened sources is a list of unfinished work, not a bibliography.'
      })
      continue
    }
    if (!check.complete && cited.has(source.id)) {
      gaps.push({
        kind: 'incomplete-source',
        about: source.id,
        describe: `"${source.title || source.url}" is cited and its ${check.missing.join(', ')} ${check.missing.length === 1 ? 'is' : 'are'} not recorded.`,
        suggestion: `Fill in the ${check.missing.join(', ')}. A citation cannot be completed later from memory.`
      })
    }
    if (check.usable && !cited.has(source.id)) {
      gaps.push({
        kind: 'uncited-source',
        about: source.id,
        describe: `"${source.title || source.url}" was read and nothing cites it.`,
        suggestion: 'Either take something from it or record why it turned out not to be relevant. Both are results.'
      })
    }
  }

  return gaps
}

export interface Contradiction {
  claimId: string
  claimText: string
  supporting: { sourceId: string; excerpt: string; locator: string }[]
  contradicting: { sourceId: string; excerpt: string; locator: string }[]
  describe: string
}

/** Every claim where sources disagree, with both sides' words side by side. Nothing is resolved. */
export function contradictions(claims: readonly Claim[], evidence: readonly Evidence[]): Contradiction[] {
  const out: Contradiction[] = []

  for (const claim of claims) {
    const mine = evidence.filter((one) => one.claimId === claim.id)
    const supporting = mine.filter((one) => one.direction === 'supports')
    const contradicting = mine.filter((one) => one.direction === 'contradicts')
    if (supporting.length === 0 || contradicting.length === 0) continue

    out.push({
      claimId: claim.id,
      claimText: claim.text,
      supporting: supporting.map((one) => ({ sourceId: one.sourceId, excerpt: one.excerpt, locator: one.locator })),
      contradicting: contradicting.map((one) => ({ sourceId: one.sourceId, excerpt: one.excerpt, locator: one.locator })),
      describe: `Sources disagree about "${claim.text}". Both sides are shown with the words they came from; nothing here decides which is right, because nothing here knows.`
    })
  }

  return out
}

// ---------------------------------------------------------------- findings

export interface Finding {
  id: string
  statement: string
  /** The claims this rests on. A finding with none is an opinion. */
  claimIds: string[]
  /** Set from the claims, never typed in. */
  support: 'well-supported' | 'supported' | 'mixed' | 'weak' | 'unsupported'
  limitations: string[]
  describe: string
}

/**
 * A finding's support, derived from the claims it rests on.
 *
 * The weakest link decides. A finding resting on four well-supported claims and one contested one is mixed, not
 * well-supported -- because the conclusion needs all five, and averaging their support would hide the one that might
 * not hold.
 */
export function assessFinding(
  finding: Omit<Finding, 'support' | 'describe'>,
  claims: readonly Claim[],
  evidence: readonly Evidence[]
): Finding | ResearchError {
  if (finding.claimIds.length === 0) {
    return fail(
      'no-claims',
      `"${finding.statement}" rests on no claim. A finding is a conclusion from claims that have evidence; without any, it is an opinion and should be recorded as one.`
    )
  }

  const byId = new Map(claims.map((one) => [one.id, one]))
  const assessments: ClaimAssessment[] = []
  for (const id of finding.claimIds) {
    const claim = byId.get(id)
    if (!claim) return fail('not-found', `"${finding.statement}" rests on claim "${id}", which is not in the project.`)
    assessments.push(assessClaim(claim, evidence))
  }

  const statuses = assessments.map((one) => one.status)
  const support: Finding['support'] = statuses.includes('unsupported')
    ? 'unsupported'
    : statuses.includes('contradicted')
      ? 'weak'
      : statuses.includes('contested')
        ? 'mixed'
        : assessments.some((one) => one.singleSource || one.supportingSources.length < 2)
          ? 'supported'
          : 'well-supported'

  // Ordered worst-first and searched in that order. The earlier shape of this compared a status against
  // `statuses.find(...) ?? ''`, which parses as `(a === b) ?? ''` -- a boolean, so the fallback was unreachable and the
  // "weakest" claim was whichever happened to match the first non-supported status in the list rather than the worst.
  const severity: readonly ClaimStatus[] = ['contradicted', 'unsupported', 'contested', 'asserted', 'unexamined']
  const worstStatus = severity.find((one) => statuses.includes(one))
  const weakest = worstStatus === undefined ? undefined : assessments.find((one) => one.status === worstStatus)
  const limitations = [...finding.limitations]
  if (support !== 'well-supported' && weakest) {
    limitations.push(`It rests on "${byId.get(weakest.claimId)?.text}", which is ${weakest.status}.`)
  }

  return {
    ...finding,
    support,
    limitations,
    describe:
      support === 'well-supported'
        ? `Every claim this rests on is supported by more than one source.`
        : support === 'unsupported'
          ? `This rests on at least one claim with nothing behind it, so the conclusion does not follow yet.`
          : `The weakest of the ${finding.claimIds.length} claims this rests on is ${weakest?.status ?? 'weaker than the others'}. A conclusion needs all of them, so the weakest one decides -- averaging would hide it.`
  }
}

// ---------------------------------------------------------------- health

export interface ResearchHealth {
  questions: { total: number; answered: number }
  sources: { total: number; read: number; unread: number; unavailable: number }
  claims: Record<ClaimStatus, number>
  gaps: number
  contradictions: number
  /** Every figure here is a count of real records; none is a score. */
  describe: string
  notes: string[]
}

/** The state of the research, counted. Nothing here rates it; it says what is there. */
export function health(
  questions: readonly Question[],
  claims: readonly Claim[],
  evidence: readonly Evidence[],
  sources: readonly Source[]
): ResearchHealth {
  const byStatus: Record<ClaimStatus, number> = { unexamined: 0, supported: 0, contested: 0, contradicted: 0, unsupported: 0, asserted: 0 }
  const assessments = claims.map((one) => assessClaim(one, evidence))
  for (const one of assessments) byStatus[one.status] += 1

  const answered = questions.filter((question) =>
    claims.some((claim) => claim.questionId === question.id && assessments.find((one) => one.claimId === claim.id)?.status === 'supported')
  ).length

  const read = sources.filter((one) => one.access === 'read' || one.access === 'parsed').length
  const unread = sources.filter((one) => one.access === 'discovered').length
  const unavailable = sources.filter((one) => one.access === 'unavailable' || one.access === 'paywalled' || one.access === 'failed').length

  const gaps = findGaps(questions, claims, evidence, sources)
  const conflicts = contradictions(claims, evidence)

  const notes: string[] = []
  if (unread > 0) {
    notes.push(`${unread} of ${sources.length} sources have been found but not opened. Nothing can be cited from them.`)
  }
  if (unavailable > 0) {
    notes.push(`${unavailable} source${unavailable === 1 ? ' could' : 's could'} not be reached. Anything that would have rested on ${unavailable === 1 ? 'it' : 'them'} is unsupported rather than supported by something unavailable.`)
  }
  if (byStatus.asserted > 0) {
    notes.push(`${byStatus.asserted} claim${byStatus.asserted === 1 ? ' is' : 's are'} your own assertion rather than taken from a source. That is recorded and is not the same as being unsupported.`)
  }
  if (conflicts.length > 0) {
    notes.push(`${conflicts.length} claim${conflicts.length === 1 ? ' has' : 's have'} sources disagreeing. Both sides are kept.`)
  }

  return {
    questions: { total: questions.length, answered },
    sources: { total: sources.length, read, unread, unavailable },
    claims: byStatus,
    gaps: gaps.length,
    contradictions: conflicts.length,
    describe: `${answered} of ${questions.length} question${questions.length === 1 ? '' : 's'} have a supported claim bearing on them. ${read} of ${sources.length} sources have been read. ${byStatus.supported} of ${claims.length} claims are supported.`,
    notes
  }
}

/** The assumptions the Page rests on, for a screen that wants to show them rather than have them inferred. */
export const RESEARCH_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A claim and the evidence for it are separate records joined by a link that says which source and where.',
  'A source that was found but not opened cannot support evidence. A search result is not a source.',
  'Evidence needs the words it came from, or it is a claim about a source rather than evidence from it.',
  'Support is counted by source, not by quotation. One source agreeing with itself is one source.',
  'A contradiction is reported with both sides in their own words, and is never resolved by the tool.',
  'A claim with nothing behind it is a gap in the research, not a judgement about whether it is true.',
  'Your own assertion is recorded as one, which is different from being unsupported.',
  'A finding takes its support from the weakest claim it rests on, because a conclusion needs all of them.',
  'Nothing is invented: a missing title is a missing title, not "Untitled".'
])
