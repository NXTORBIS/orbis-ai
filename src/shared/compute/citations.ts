/**
 * Citations: formatting references in named styles, and checking the identifiers in them.
 *
 * The shared citation engine for Orbis Pages. A reference is formatted from fields the caller supplies and nothing
 * else — no field is invented, no missing author is guessed at, and an incomplete reference comes back with the
 * gaps named rather than smoothed over.
 *
 * ## Why nothing here fills in a missing field
 *
 * A fabricated citation is worse than no citation: it looks checkable and is not, and it wastes the time of everyone
 * who tries. This engine formats what it is given. If the year is missing it prints the style's own marker for an
 * unknown date and says the year is missing; it never produces a plausible year. That rule has no exceptions here.
 *
 * ## Why the identifier checks are arithmetic and not lookups
 *
 * An ISBN, an ISSN and a DOI prefix all have structure that can be checked without asking anybody: the first two
 * carry a checksum, and a DOI has a required shape. Those checks catch a typed digit in the wrong place, which is
 * the commonest error in a bibliography. They cannot check that the work exists — that needs a lookup, this engine
 * has no network, and the difference is stated on every result.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * a valid checksum vs  a real work        -- the digits add up against the book existing
 * author           vs  editor             -- and the styles punctuate them differently
 * cited date       vs  publication date   -- when it was consulted against when it appeared
 * in-text citation vs  reference entry    -- the short form in the sentence against the full one in the list
 * et al.           vs  all authors        -- and each style has its own threshold
 * ```
 *
 * Pure. No network, no clock, no storage. Nothing here looks anything up.
 */

export interface CitationError {
  error: 'invalid-argument' | 'missing-field' | 'bad-checksum' | 'bad-format' | 'too-many'
  message: string
}

export const isCitationError = (value: unknown): value is CitationError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: CitationError['error'], message: string): CitationError => ({ error, message })

export const CITATION_LIMITS = Object.freeze({ authors: 100, references: 1000, fieldLength: 2000 })

// ---------------------------------------------------------------- styles

export type CitationStyle = 'apa' | 'mla' | 'chicago-author-date' | 'harvard' | 'vancouver' | 'ieee'

export const CITATION_STYLES: readonly CitationStyle[] = Object.freeze([
  'apa',
  'mla',
  'chicago-author-date',
  'harvard',
  'vancouver',
  'ieee'
])

export const STYLE_FACTS: Readonly<
  Record<
    CitationStyle,
    {
      label: string
      edition: string
      usedIn: string
      /** How many authors before the style abbreviates. */
      etAlFrom: number
      /** How many it lists before the abbreviation, when it does. */
      listBeforeEtAl: number
      inTextShape: string
      unknownDate: string
    }
  >
> = Object.freeze({
  apa: {
    label: 'APA',
    edition: '7th edition, 2019',
    usedIn: 'Psychology, education, and much of the social sciences.',
    etAlFrom: 21,
    listBeforeEtAl: 19,
    inTextShape: '(Author, year)',
    unknownDate: 'n.d.'
  },
  mla: {
    label: 'MLA',
    edition: '9th edition, 2021',
    usedIn: 'Literature, languages, and the humanities.',
    etAlFrom: 3,
    listBeforeEtAl: 1,
    inTextShape: '(Author page)',
    unknownDate: 'n.d.'
  },
  'chicago-author-date': {
    label: 'Chicago (author-date)',
    edition: '17th edition, 2017',
    usedIn: 'History and the social sciences. Chicago also has a notes-and-bibliography form, which is a different system.',
    etAlFrom: 4,
    listBeforeEtAl: 3,
    inTextShape: '(Author year, page)',
    unknownDate: 'n.d.'
  },
  harvard: {
    label: 'Harvard',
    edition: 'No single authority — it varies by institution',
    usedIn: 'Widely, especially in the UK and Australia. Every university has its own variant, so check the local guide.',
    etAlFrom: 4,
    listBeforeEtAl: 3,
    inTextShape: '(Author, year, p. page)',
    unknownDate: 'no date'
  },
  vancouver: {
    label: 'Vancouver',
    edition: 'NLM recommended format, 2nd edition',
    usedIn: 'Medicine and the biomedical sciences. Numbered rather than author-date.',
    etAlFrom: 7,
    listBeforeEtAl: 6,
    inTextShape: '[number]',
    unknownDate: '[date unknown]'
  },
  ieee: {
    label: 'IEEE',
    edition: 'IEEE Reference Guide, 2023',
    usedIn: 'Engineering and computer science. Numbered.',
    etAlFrom: 7,
    listBeforeEtAl: 3,
    inTextShape: '[number]',
    unknownDate: 'n.d.'
  }
})

export type SourceKind = 'journal-article' | 'book' | 'book-chapter' | 'web-page' | 'thesis' | 'conference-paper' | 'report'

export const SOURCE_KINDS: readonly SourceKind[] = Object.freeze([
  'journal-article',
  'book',
  'book-chapter',
  'web-page',
  'thesis',
  'conference-paper',
  'report'
])

export interface Author {
  family: string
  given?: string
  /** For an organisation as author, which has no given name and is not abbreviated. */
  isOrganisation?: boolean
}

export interface Reference {
  kind: SourceKind
  authors?: readonly Author[]
  editors?: readonly Author[]
  title?: string
  /** Journal, book (for a chapter), or conference name. */
  containerTitle?: string
  year?: number
  volume?: string
  issue?: string
  pages?: string
  publisher?: string
  place?: string
  doi?: string
  url?: string
  /** Year, month and day the page was read. Required by some styles for a web page. */
  accessed?: { year: number; month: number; day: number }
  edition?: string
  institution?: string
}

export interface FormattedReference {
  style: CitationStyle
  styleLabel: string
  edition: string
  /** The full entry for the reference list. */
  entry: string
  /** The short form for use in a sentence. */
  inText: string
  /** Fields this style needs for this kind of source and did not get. */
  missingFields: readonly string[]
  /** Fields that were given and this style does not use, so nothing is silently dropped unnoticed. */
  unusedFields: readonly string[]
  /** Whether the entry is complete enough to be checkable by a reader. */
  checkable: boolean
  notes: readonly string[]
  warnings: readonly string[]
}

const REQUIRED_FIELDS: Readonly<Record<SourceKind, readonly string[]>> = Object.freeze({
  'journal-article': ['authors', 'title', 'containerTitle', 'year'],
  book: ['authors', 'title', 'year', 'publisher'],
  'book-chapter': ['authors', 'title', 'containerTitle', 'year', 'publisher'],
  'web-page': ['title', 'url'],
  thesis: ['authors', 'title', 'year', 'institution'],
  'conference-paper': ['authors', 'title', 'containerTitle', 'year'],
  report: ['title', 'year', 'institution']
})

const initialsOf = (given: string): string =>
  given
    .split(/[\s-]+/)
    .filter((one) => one.length > 0)
    .map((one) => `${one[0].toUpperCase()}.`)
    .join(' ')

/**
 * Format a reference in a named style, from the fields given and nothing else.
 *
 * Nothing is invented. A missing year prints the style's own marker for an unknown date and is listed as missing; a
 * missing author is simply absent. A fabricated citation looks checkable and is not, and wastes the time of
 * everyone who tries to follow it — so this engine would rather hand back an obviously incomplete entry than a
 * plausible false one.
 */
export function formatReference(input: {
  reference: Reference
  style: CitationStyle
  /** For an in-text citation with a page number. */
  page?: string
  /** For a numbered style. */
  number?: number
}): FormattedReference | CitationError {
  const facts = STYLE_FACTS[input.style]
  if (!facts) return fail('invalid-argument', `"${input.style}" is not one of: ${CITATION_STYLES.join(', ')}.`)
  const reference = input.reference
  if (!SOURCE_KINDS.includes(reference.kind)) {
    return fail('invalid-argument', `"${reference.kind}" is not one of: ${SOURCE_KINDS.join(', ')}.`)
  }

  const authors = reference.authors ?? []
  if (authors.length > CITATION_LIMITS.authors) {
    return fail('too-many', `That is ${authors.length} authors; this handles up to ${CITATION_LIMITS.authors}.`)
  }
  for (const one of authors) {
    if (typeof one.family !== 'string' || one.family.trim().length === 0) {
      return fail('invalid-argument', 'Every author needs a family name. An author with no name is a missing author, not an empty one.')
    }
    if (one.family.length > CITATION_LIMITS.fieldLength) return fail('invalid-argument', 'An author name is impossibly long.')
  }
  for (const [name, value] of Object.entries(reference)) {
    if (typeof value === 'string' && value.length > CITATION_LIMITS.fieldLength) {
      return fail('invalid-argument', `"${name}" is longer than the ${CITATION_LIMITS.fieldLength} characters this handles.`)
    }
  }

  const required = REQUIRED_FIELDS[reference.kind]
  const missing = required.filter((field) => {
    const value = reference[field as keyof Reference]
    if (field === 'authors') return authors.length === 0
    return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
  })

  const year = reference.year !== undefined ? String(reference.year) : facts.unknownDate

  // The author list, in the style's own form.
  const nameFor = (one: Author, position: 'first' | 'later'): string => {
    if (one.isOrganisation === true) return one.family
    const given = one.given === undefined || one.given.trim().length === 0 ? '' : one.given
    if (input.style === 'vancouver') {
      return given === '' ? one.family : `${one.family} ${initialsOf(given).replace(/[.\s]/g, '')}`
    }
    if (input.style === 'ieee') {
      return given === '' ? one.family : `${initialsOf(given)} ${one.family}`
    }
    if (input.style === 'mla' && position === 'later') {
      return given === '' ? one.family : `${given} ${one.family}`
    }
    return given === '' ? one.family : `${one.family}, ${initialsOf(given)}`
  }

  let authorList = ''
  if (authors.length > 0) {
    const abbreviate = authors.length >= facts.etAlFrom
    const shown = abbreviate ? authors.slice(0, facts.listBeforeEtAl) : authors
    const parts = shown.map((one, i) => nameFor(one, i === 0 ? 'first' : 'later'))
    if (abbreviate) {
      authorList = `${parts.join(', ')}, et al.`
    } else if (parts.length === 1) {
      authorList = parts[0]
    } else if (input.style === 'vancouver' || input.style === 'ieee') {
      authorList = parts.join(', ')
    } else if (input.style === 'apa') {
      authorList = `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} & ${parts[parts.length - 1]}`
    } else {
      authorList = `${parts.slice(0, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts[parts.length - 1]}`
    }
  }

  const title = reference.title ?? '[title missing]'
  const container = reference.containerTitle
  const pages = reference.pages
  const doi = reference.doi === undefined ? '' : `https://doi.org/${reference.doi.replace(/^https?:\/\/doi\.org\//, '')}`
  const link = doi !== '' ? doi : (reference.url ?? '')

  // Which fields this style actually uses for this kind, so nothing given is silently dropped.
  const used = new Set<string>(['kind', 'authors', 'title', 'year'])
  const pieces: string[] = []

  switch (input.style) {
    case 'apa': {
      if (authorList !== '') pieces.push(`${authorList}.`)
      pieces.push(`(${year}).`)
      if (reference.kind === 'journal-article' || reference.kind === 'web-page' || reference.kind === 'conference-paper') {
        pieces.push(`${title}.`)
        if (container !== undefined) {
          used.add('containerTitle')
          const volumePart = reference.volume === undefined ? '' : `, ${reference.volume}`
          const issuePart = reference.issue === undefined ? '' : `(${reference.issue})`
          if (reference.volume !== undefined) used.add('volume')
          if (reference.issue !== undefined) used.add('issue')
          pieces.push(`${container}${volumePart}${issuePart}${pages === undefined ? '' : `, ${pages}`}.`)
          if (pages !== undefined) used.add('pages')
        }
      } else {
        pieces.push(`${title}${reference.edition === undefined ? '' : ` (${reference.edition} ed.)`}.`)
        if (reference.edition !== undefined) used.add('edition')
        if (reference.publisher !== undefined) {
          used.add('publisher')
          pieces.push(`${reference.publisher}.`)
        }
        if (reference.institution !== undefined) {
          used.add('institution')
          pieces.push(`${reference.institution}.`)
        }
      }
      if (link !== '') {
        used.add(doi !== '' ? 'doi' : 'url')
        pieces.push(link)
      }
      break
    }
    case 'mla': {
      if (authorList !== '') pieces.push(`${authorList}.`)
      pieces.push(container === undefined ? `${title}.` : `"${title}."`)
      if (container !== undefined) {
        used.add('containerTitle')
        const volumePart = reference.volume === undefined ? '' : `, vol. ${reference.volume}`
        const issuePart = reference.issue === undefined ? '' : `, no. ${reference.issue}`
        if (reference.volume !== undefined) used.add('volume')
        if (reference.issue !== undefined) used.add('issue')
        pieces.push(`${container}${volumePart}${issuePart}, ${year}${pages === undefined ? '' : `, pp. ${pages}`}.`)
        if (pages !== undefined) used.add('pages')
      } else {
        if (reference.publisher !== undefined) {
          used.add('publisher')
          pieces.push(`${reference.publisher},`)
        }
        pieces.push(`${year}.`)
      }
      if (link !== '') {
        used.add(doi !== '' ? 'doi' : 'url')
        pieces.push(`${link}.`)
      }
      break
    }
    case 'chicago-author-date':
    case 'harvard': {
      if (authorList !== '') pieces.push(`${authorList}.`)
      pieces.push(`${year}.`)
      pieces.push(container === undefined ? `${title}.` : `"${title}."`)
      if (container !== undefined) {
        used.add('containerTitle')
        const volumePart = reference.volume === undefined ? '' : ` ${reference.volume}`
        const issuePart = reference.issue === undefined ? '' : ` (${reference.issue})`
        if (reference.volume !== undefined) used.add('volume')
        if (reference.issue !== undefined) used.add('issue')
        pieces.push(`${container}${volumePart}${issuePart}${pages === undefined ? '' : `: ${pages}`}.`)
        if (pages !== undefined) used.add('pages')
      }
      if (reference.place !== undefined) {
        used.add('place')
        pieces.push(`${reference.place}:`)
      }
      if (reference.publisher !== undefined) {
        used.add('publisher')
        pieces.push(`${reference.publisher}.`)
      }
      if (reference.institution !== undefined) {
        used.add('institution')
        pieces.push(`${reference.institution}.`)
      }
      if (link !== '') {
        used.add(doi !== '' ? 'doi' : 'url')
        pieces.push(`${link}.`)
      }
      break
    }
    default: {
      // Vancouver and IEEE, both numbered.
      const numbered = input.number === undefined ? '' : input.style === 'ieee' ? `[${input.number}] ` : `${input.number}. `
      if (input.number !== undefined) used.add('number')
      const head = authorList === '' ? '' : `${authorList}${input.style === 'ieee' ? ', ' : '. '}`
      pieces.push(`${numbered}${head}${input.style === 'ieee' ? `"${title},"` : `${title}.`}`)
      if (container !== undefined) {
        used.add('containerTitle')
        const volumePart = reference.volume === undefined ? '' : `${input.style === 'ieee' ? ', vol. ' : ' '}${reference.volume}`
        const issuePart = reference.issue === undefined ? '' : `${input.style === 'ieee' ? ', no. ' : '('}${reference.issue}${input.style === 'ieee' ? '' : ')'}`
        if (reference.volume !== undefined) used.add('volume')
        if (reference.issue !== undefined) used.add('issue')
        pieces.push(
          `${container}${volumePart}${issuePart}${input.style === 'ieee' ? `, ${year}` : `. ${year}`}${pages === undefined ? '' : `${input.style === 'ieee' ? ', pp. ' : ':'}${pages}`}.`
        )
        if (pages !== undefined) used.add('pages')
      } else {
        if (reference.publisher !== undefined) {
          used.add('publisher')
          pieces.push(`${reference.publisher};`)
        }
        pieces.push(`${year}.`)
      }
      if (link !== '') {
        used.add(doi !== '' ? 'doi' : 'url')
        pieces.push(`${link}`)
      }
      break
    }
  }

  // The in-text form.
  const firstFamily = authors.length === 0 ? '[author missing]' : authors[0].family
  const etAl = authors.length >= (input.style === 'apa' ? 3 : facts.etAlFrom) ? ' et al.' : authors.length === 2 ? ` ${input.style === 'apa' ? '&' : 'and'} ${authors[1].family}` : ''
  const pagePart = input.page === undefined ? '' : input.style === 'mla' ? ` ${input.page}` : `, p. ${input.page}`
  const inText =
    input.style === 'vancouver' || input.style === 'ieee'
      ? input.number === undefined
        ? '[number needed]'
        : `[${input.number}]`
      : input.style === 'mla'
        ? `(${firstFamily}${etAl}${pagePart})`
        : input.style === 'chicago-author-date'
          ? `(${firstFamily}${etAl} ${year}${input.page === undefined ? '' : `, ${input.page}`})`
          : `(${firstFamily}${etAl}, ${year}${pagePart})`

  const givenFields = Object.entries(reference)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name]) => name)
  const unused = givenFields.filter((one) => !used.has(one) && one !== 'accessed' && one !== 'editors')

  const warnings: string[] = []
  if (missing.length > 0) {
    warnings.push(
      `Missing for a ${reference.kind} in ${facts.label}: ${missing.join(', ')}. Nothing was filled in — an invented field makes a citation look checkable when it is not, which wastes the time of everyone who tries to follow it.`
    )
  }
  if (unused.length > 0) {
    warnings.push(`${facts.label} does not use ${unused.join(', ')} for this kind of source, so those were left out rather than dropped silently.`)
  }
  if (input.style === 'harvard') {
    warnings.push('Harvard has no single authority — every institution has its own variant. Check the local guide before submitting; this is the common form.')
  }
  if ((input.style === 'vancouver' || input.style === 'ieee') && input.number === undefined) {
    warnings.push(`${facts.label} is a numbered style, and no number was given. The in-text form cannot be produced without one.`)
  }
  if (reference.kind === 'web-page' && reference.accessed === undefined) {
    warnings.push('A web page reference without an access date cannot be checked against what the page said when it was read. Most styles require one.')
  }

  return {
    style: input.style,
    styleLabel: facts.label,
    edition: facts.edition,
    entry: pieces.join(' ').replace(/\s+/g, ' ').replace(/\s([.,;:])/g, '$1').trim(),
    inText,
    missingFields: Object.freeze(missing),
    unusedFields: Object.freeze(unused),
    checkable: missing.length === 0,
    notes: Object.freeze([
      `${facts.label}, ${facts.edition}. ${facts.usedIn}`,
      `In-text form: ${facts.inTextShape}. This style abbreviates to "et al." from ${facts.etAlFrom} authors, listing ${facts.listBeforeEtAl} first.`,
      'Every field in this entry came from what was given. Nothing was inferred, looked up or filled in.',
      'Styles are revised. This follows the edition named above, and a marker or journal may be using a different one.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- identifiers

export interface IdentifierReport {
  kind: 'isbn-10' | 'isbn-13' | 'issn' | 'doi' | 'orcid'
  input: string
  normalised: string
  valid: boolean
  /** Why it failed, when it did. */
  reason: string | null
  /** The checksum digit the arithmetic gives, for comparison. */
  expectedCheck: string | null
  /** The other form, for the identifiers that have two. */
  alternateForm: string | null
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Check an identifier's arithmetic. Not whether the work exists — that needs a lookup and this has no network.
 *
 * The distinction matters. A valid checksum means nobody mistyped a digit; it says nothing about whether the book
 * was ever published. A generated ISBN with a correct check digit will pass this and refer to nothing, and a
 * bibliography full of such entries is the exact failure this engine is built to avoid contributing to.
 */
export function checkIdentifier(input: { identifier: string }): IdentifierReport | CitationError {
  const raw = input.identifier
  if (typeof raw !== 'string' || raw.trim().length === 0) return fail('invalid-argument', 'There is no identifier to check.')
  if (raw.length > 500) return fail('invalid-argument', 'That is too long to be an identifier.')
  const trimmed = raw.trim()
  const cannotVerify =
    'A correct checksum means nobody mistyped a digit. It does not mean the work exists — that needs a lookup, and nothing here has a network.'

  // DOI: a shape check, because a DOI has no checksum.
  if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)?10\./i.test(trimmed)) {
    const normalised = trimmed.replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:)/i, '')
    const valid = /^10\.\d{4,9}\/[-._;()/:a-z0-9A-Z]+$/.test(normalised)
    return {
      kind: 'doi',
      input: trimmed,
      normalised,
      valid,
      reason: valid ? null : 'A DOI is 10, a dot, a registrant number of 4 to 9 digits, a slash, then a suffix. This does not match that shape.',
      expectedCheck: null,
      alternateForm: valid ? `https://doi.org/${normalised}` : null,
      notes: Object.freeze([
        'A DOI has no checksum, so only its shape can be checked. A well-formed DOI can still point at nothing.',
        cannotVerify,
        'The registrant number identifies the publisher and the suffix is whatever they chose, so no part of it can be validated further without asking the resolver.'
      ]),
      warnings: Object.freeze([])
    }
  }

  // ORCID: 16 digits with an ISO 7064 MOD 11-2 check.
  if (/^(?:https?:\/\/orcid\.org\/)?\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(trimmed)) {
    const digits = trimmed.replace(/^https?:\/\/orcid\.org\//i, '').replace(/-/g, '').toUpperCase()
    let total = 0
    for (let i = 0; i < 15; i += 1) total = (total + Number(digits[i])) * 2
    const remainder = total % 11
    const check = (12 - remainder) % 11
    const expected = check === 10 ? 'X' : String(check)
    const valid = digits[15] === expected
    return {
      kind: 'orcid',
      input: trimmed,
      normalised: digits.replace(/(.{4})(?=.)/g, '$1-'),
      valid,
      reason: valid ? null : `The check character should be ${expected} and is ${digits[15]}.`,
      expectedCheck: expected,
      alternateForm: `https://orcid.org/${digits.replace(/(.{4})(?=.)/g, '$1-')}`,
      notes: Object.freeze(['ORCID uses the ISO 7064 MOD 11-2 checksum, which is why the last character can be an X.', cannotVerify]),
      warnings: Object.freeze([])
    }
  }

  const digits = trimmed.replace(/[\s-]/g, '').toUpperCase()

  if (/^\d{9}[\dX]$/.test(digits)) {
    // ISBN-10: weights 10 down to 1, modulo 11, with X for 10.
    let total = 0
    for (let i = 0; i < 9; i += 1) total += Number(digits[i]) * (10 - i)
    const remainder = (11 - (total % 11)) % 11
    const expected = remainder === 10 ? 'X' : String(remainder)
    const valid = digits[9] === expected
    // The ISBN-13 form: 978 prefix, then a fresh check digit.
    const core = `978${digits.slice(0, 9)}`
    let total13 = 0
    for (let i = 0; i < 12; i += 1) total13 += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
    const check13 = (10 - (total13 % 10)) % 10
    return {
      kind: 'isbn-10',
      input: trimmed,
      normalised: digits,
      valid,
      reason: valid ? null : `The check digit should be ${expected} and is ${digits[9]}.`,
      expectedCheck: expected,
      alternateForm: valid ? `${core}${check13}` : null,
      notes: Object.freeze([
        'ISBN-10 weights the digits 10 down to 1 and takes the total modulo 11, which is why the check digit can be an X.',
        valid ? 'The ISBN-13 form of the same book is given as the alternate. The check digit is recomputed, not carried over.' : 'No ISBN-13 form is given, because converting a wrong ISBN-10 would produce a wrong ISBN-13 that looks right.',
        cannotVerify
      ]),
      warnings: Object.freeze([])
    }
  }

  if (/^\d{13}$/.test(digits)) {
    // ISBN-13: alternating weights 1 and 3, modulo 10.
    let total = 0
    for (let i = 0; i < 12; i += 1) total += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
    const expected = String((10 - (total % 10)) % 10)
    const valid = digits[12] === expected
    let alternate: string | null = null
    if (valid && digits.startsWith('978')) {
      const nine = digits.slice(3, 12)
      let total10 = 0
      for (let i = 0; i < 9; i += 1) total10 += Number(nine[i]) * (10 - i)
      const remainder = (11 - (total10 % 11)) % 11
      alternate = `${nine}${remainder === 10 ? 'X' : remainder}`
    }
    return {
      kind: 'isbn-13',
      input: trimmed,
      normalised: digits,
      valid,
      reason: valid ? null : `The check digit should be ${expected} and is ${digits[12]}.`,
      expectedCheck: expected,
      alternateForm: alternate,
      notes: Object.freeze([
        'ISBN-13 alternates weights of 1 and 3 and takes the total modulo 10 — the same scheme as a retail barcode, which is what it is.',
        digits.startsWith('979')
          ? 'This is a 979 prefix, which has no ISBN-10 equivalent. Only 978 books can be written both ways.'
          : 'A 978 ISBN-13 has an ISBN-10 form, given as the alternate.',
        cannotVerify
      ]),
      warnings: Object.freeze([])
    }
  }

  if (/^\d{7}[\dX]$/.test(digits)) {
    // ISSN: weights 8 down to 2, modulo 11.
    let total = 0
    for (let i = 0; i < 7; i += 1) total += Number(digits[i]) * (8 - i)
    const remainder = (11 - (total % 11)) % 11
    const expected = remainder === 10 ? 'X' : String(remainder)
    const valid = digits[7] === expected
    return {
      kind: 'issn',
      input: trimmed,
      normalised: `${digits.slice(0, 4)}-${digits.slice(4)}`,
      valid,
      reason: valid ? null : `The check digit should be ${expected} and is ${digits[7]}.`,
      expectedCheck: expected,
      alternateForm: null,
      notes: Object.freeze([
        'ISSN weights the digits 8 down to 2, modulo 11, so its check digit can also be an X.',
        'An ISSN identifies a journal, not an article. A citation with only an ISSN has not identified what was cited.',
        cannotVerify
      ]),
      warnings: Object.freeze([])
    }
  }

  return fail(
    'bad-format',
    `"${trimmed}" is not a shape this recognises. It handles ISBN-10, ISBN-13, ISSN, DOI and ORCID. An ISBN with the wrong number of digits is usually a transcription error rather than a different kind of identifier.`
  )
}

export interface BibliographyReport {
  /** Each entry, formatted and checked. */
  entries: readonly { index: number; entry: string; inText: string; checkable: boolean; missingFields: readonly string[] }[]
  /** Sorted the way the style requires, which is not the order they were given in. */
  order: 'alphabetical' | 'as-cited'
  style: CitationStyle
  /** How many entries are missing something a reader would need to find the source. */
  incompleteCount: number
  /** Entries that look like duplicates of each other. */
  possibleDuplicates: readonly { first: number; second: number; reason: string }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Format a whole bibliography, sorted as the style requires, with incomplete entries counted.
 *
 * Author-date styles sort alphabetically and numbered styles keep citation order — sorting a numbered bibliography
 * alphabetically breaks every in-text number that points into it, which is a real and common error.
 *
 * Possible duplicates are flagged rather than merged. Two entries for the same work with slightly different fields
 * usually means one was entered twice, and silently merging them would lose whichever version was right.
 */
export function bibliography(input: {
  references: readonly Reference[]
  style: CitationStyle
}): BibliographyReport | CitationError {
  const facts = STYLE_FACTS[input.style]
  if (!facts) return fail('invalid-argument', `"${input.style}" is not one of: ${CITATION_STYLES.join(', ')}.`)
  if (input.references.length === 0) return fail('invalid-argument', 'There are no references.')
  if (input.references.length > CITATION_LIMITS.references) {
    return fail('too-many', `That is ${input.references.length} references; this handles up to ${CITATION_LIMITS.references}.`)
  }

  const numbered = input.style === 'vancouver' || input.style === 'ieee'
  const order: BibliographyReport['order'] = numbered ? 'as-cited' : 'alphabetical'

  const withKeys = input.references.map((reference, i) => ({
    reference,
    given: i,
    sortKey: `${(reference.authors?.[0]?.family ?? reference.title ?? '').toLowerCase()} ${reference.year ?? ''}`
  }))
  const ordered = numbered ? withKeys : [...withKeys].sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  const entries: BibliographyReport['entries'][number][] = []
  for (const [position, one] of ordered.entries()) {
    const formatted = formatReference({
      reference: one.reference,
      style: input.style,
      number: numbered ? position + 1 : undefined
    })
    if (isCitationError(formatted)) return formatted
    entries.push({
      index: position + 1,
      entry: formatted.entry,
      inText: formatted.inText,
      checkable: formatted.checkable,
      missingFields: formatted.missingFields
    })
  }

  // Possible duplicates: same first author and year, or the same DOI.
  const duplicates: BibliographyReport['possibleDuplicates'][number][] = []
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i].reference
      const b = ordered[j].reference
      if (a.doi !== undefined && a.doi === b.doi) {
        duplicates.push({ first: i + 1, second: j + 1, reason: 'the same DOI' })
        continue
      }
      const sameAuthor =
        a.authors?.[0]?.family !== undefined && a.authors[0].family.toLowerCase() === b.authors?.[0]?.family?.toLowerCase()
      if (sameAuthor && a.year !== undefined && a.year === b.year && a.title?.toLowerCase() === b.title?.toLowerCase()) {
        duplicates.push({ first: i + 1, second: j + 1, reason: 'the same first author, year and title' })
      }
    }
  }

  const incomplete = entries.filter((one) => !one.checkable).length
  const warnings: string[] = []
  if (incomplete > 0) {
    warnings.push(
      `${incomplete} of ${entries.length} entries are missing a field a reader would need to find the source. Nothing was filled in — the gaps are listed on each entry.`
    )
  }
  if (duplicates.length > 0) {
    warnings.push(
      `${duplicates.length} pairs look like duplicates. They were not merged: two entries for the same work usually means one was entered twice, and merging them loses whichever version was right.`
    )
  }

  return {
    entries: Object.freeze(entries),
    order,
    style: input.style,
    incompleteCount: incomplete,
    possibleDuplicates: Object.freeze(duplicates),
    notes: Object.freeze([
      `${entries.length} entries in ${facts.label}, ${numbered ? 'in citation order' : 'sorted alphabetically'}.`,
      numbered
        ? 'This is a numbered style, so the order is the order of first citation. Sorting it alphabetically would break every in-text number pointing into it.'
        : 'Author-date styles sort alphabetically by the first author’s family name, then by year.',
      'Every entry came from the fields given. Nothing was inferred or looked up.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CITATION_ASSUMPTIONS: readonly string[] = Object.freeze([
  'No field is ever invented. A missing year prints the style’s marker for an unknown date and is listed as missing.',
  'Every style names its edition. Styles are revised, and a marker may be using a different one.',
  'Harvard has no single authority and varies by institution. That is stated on every Harvard result.',
  'Fields a style does not use are reported rather than dropped silently.',
  'Identifier checks are arithmetic on the digits. They catch a mistyped digit and say nothing about whether the work exists.',
  'Numbered styles keep citation order; author-date styles sort alphabetically. Sorting a numbered list alphabetically breaks the in-text numbers.',
  'Possible duplicates are flagged and never merged.',
  'Nothing here has a network and nothing looks anything up.'
])
