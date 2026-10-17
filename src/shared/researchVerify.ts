import { traceClaims, unsupported, type Supported } from './researchProvenance.ts'

/**
 * The second look at a research answer: when claims cite a source that does not say them, ask once for a rewrite
 * that only says what the sources say -- and take it only if it is plainly better.
 *
 * Two rules decide everything here. A rewrite is a model's guess at fixing a model's guess, so it is **never trusted
 * on its own word**: it has to have fewer unsupported claims than the draft by the same measure the warning on screen
 * uses, cite only sources that exist, and bring in no figure that neither the draft nor a source contained. And the
 * draft is the default: when the rewrite is not clearly better, nothing changes.
 */

export interface VerifySource {
  n: number
  excerpt: string
  title?: string
  url?: string
}

const CITATION = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/g

/** Every source number a text cites, in order of first use. */
export function citedNumbers(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(CITATION)) {
    for (const part of match[1].split(',')) {
      const n = Number(part.trim())
      if (Number.isFinite(n) && !out.includes(n)) out.push(n)
    }
  }
  return out
}

/** The cited claims in a text that their source does not appear to say. */
export function unsupportedClaims(text: string, sources: readonly VerifySource[]): Supported[] {
  return unsupported(traceClaims(text, sources))
}

/** Whether the second look is worth a model call: there is at least one claim whose source does not carry it. */
export function needsRevision(draft: string, sources: readonly VerifySource[]): boolean {
  return sources.length > 0 && unsupportedClaims(draft, sources).length > 0
}

/** About how much source text may go to the model. Input limits are tight (6000 tokens on some models). */
const SOURCE_BUDGET = 9000
const DRAFT_BUDGET = 9000

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)

export interface RevisionPrompt {
  system: string
  user: string
}

export const REVISION_SYSTEM =
  'You are a careful editor checking an answer against its sources. You follow the instructions exactly and write only the revised answer, with no preface and no commentary.'

export function buildRevisionPrompt(input: {
  question: string
  draft: string
  sources: readonly VerifySource[]
  claims: readonly Supported[]
}): RevisionPrompt {
  const wanted = new Set<number>([...citedNumbers(input.draft), ...input.claims.map((c) => c.n)])
  const used = input.sources.filter((s) => wanted.has(s.n))
  const each = used.length ? Math.max(800, Math.floor(SOURCE_BUDGET / used.length)) : SOURCE_BUDGET
  const sourceText = used
    .map((s) => `[${s.n}]${s.title ? ` ${s.title}` : ''}${s.url ? ` (${s.url})` : ''}\n${clip(s.excerpt.trim(), each)}`)
    .join('\n\n')
  const flagged = input.claims
    .slice(0, 12)
    .map((c) => `- [${c.n}] ${clip(c.claim, 240)}`)
    .join('\n')

  const user = [
    'Rewrite the DRAFT ANSWER so that every factual claim is supported by the source it cites.',
    '',
    'Rules:',
    '1. Keep a claim only if the cited source text below says it. If a claim is not supported, remove it, or soften it to what the source does say.',
    '2. Do not add any new facts, figures, names, dates or sources. Use only what the draft and the sources already contain.',
    '3. Keep citations in the form [n], and only use numbers that appear in the SOURCES list. Do not renumber.',
    '4. Keep the same language, tone, structure and formatting as the draft. Change as little as you can.',
    '5. Reply with the revised answer only.',
    '',
    'These claims could not be found in the source they cite:',
    flagged || '(none listed)',
    '',
    `QUESTION:\n${clip(input.question.trim(), 600)}`,
    '',
    `SOURCES:\n${sourceText}`,
    '',
    `DRAFT ANSWER:\n${clip(input.draft.trim(), DRAFT_BUDGET)}`
  ].join('\n')
  return { system: REVISION_SYSTEM, user }
}

/** The figures in a text, without the citation marks and list numbers that are not claims. */
function figuresIn(text: string): string[] {
  const bare = text.replace(CITATION, ' ').replace(/^\s*\d{1,2}[.)]\s/gm, ' ')
  return (bare.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((f) => f.replace(/,/g, '').replace(/\.$/, ''))
}

export interface Acceptance {
  accept: boolean
  /** Plain words, for a log line. */
  reason: string
  before: number
  after: number
}

/**
 * Whether the rewrite replaces the draft.
 *
 * Every condition must hold, because each one catches a different way a rewrite goes wrong: an empty or gutted answer
 * "fixes" every claim by deleting them; an invented source number is a new unsupported claim the check cannot see; a
 * new figure is a new fact; and "no better" is simply no reason to swap.
 */
export function acceptRevision(input: { draft: string; revision: string; sources: readonly VerifySource[] }): Acceptance {
  const before = unsupportedClaims(input.draft, input.sources).length
  const revision = input.revision.trim()
  const no = (reason: string, after = before): Acceptance => ({ accept: false, reason, before, after })

  if (!revision) return no('the rewrite was empty')
  if (revision === input.draft.trim()) return no('the rewrite changed nothing')
  if (/^```/.test(revision) && !/^```/.test(input.draft.trim())) return no('the rewrite is wrapped as code')

  // A rewrite that keeps under a fifth of the draft has not fixed it, it has removed it.
  if (revision.length < input.draft.trim().length * 0.2) return no('the rewrite dropped most of the answer')

  const known = new Set(input.sources.map((s) => s.n))
  const invented = citedNumbers(revision).filter((n) => !known.has(n))
  if (invented.length) return no(`the rewrite cites source ${invented[0]}, which does not exist`)

  const allowed = new Set([...figuresIn(input.draft), ...input.sources.flatMap((s) => figuresIn(s.excerpt))])
  const added = figuresIn(revision).filter((f) => !allowed.has(f))
  if (added.length) return no(`the rewrite brought in a figure (${added[0]}) that nothing it was given contains`)

  const after = unsupportedClaims(revision, input.sources).length
  if (after >= before) return no('the rewrite is not better supported than the draft', after)
  return { accept: true, reason: 'fewer claims cite a source that does not say them', before, after }
}
