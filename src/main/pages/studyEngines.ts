/**
 * Uncertainty, parameter studies, documents and file formats, reachable from a Page.
 *
 * Same contract as `engines.ts`: data in, data out, and where an engine wants a model the Page sends an expression as
 * text which the AST interpreter compiles. Nothing here accepts a function from a Page, and nothing here reaches the
 * filesystem -- `interchange.*` reads bytes the Page already holds and says what they are.
 *
 * ## Constraints arrive as expressions, not predicates
 *
 * `study.cases` prunes cases against constraints, and a constraint is a boolean function. A Page sends it as an
 * expression over the parameter names, compiled here. A constraint that fails to compile is refused rather than
 * treated as always true, because a constraint silently satisfied is worse than no constraint: the cases it should
 * have removed are in the results looking legitimate.
 */

import {
  checkAssumptions,
  checkDistribution,
  compareMethods,
  globalSensitivity,
  isUncertaintyError,
  propagateByMonteCarlo,
  propagateFirstOrder,
  setCorrelation,
  uncertaintyBudget,
  uncertainQuantity,
  type CorrelationSet,
  type Distribution,
  type UncertainQuantity
} from '../../shared/compute/uncertainty.ts'
import {
  estimateSize,
  fingerprintOf,
  findTarget,
  generateCases,
  isStudyError,
  localSensitivity,
  parameter,
  responseSurface,
  robustness,
  runStudy,
  tornado,
  type Constraint,
  type Parameter,
  type ParameterType,
  type ParameterValue,
  type StudyRun,
  type SweepStrategy,
  type ValueSpec
} from '../../shared/compute/study.ts'
import {
  analyse as analyseDocument,
  checkCitations,
  diffDocuments,
  emptyDocument,
  formatCitation,
  fromHtml,
  fromMarkdown,
  isDocumentError,
  numbering,
  outlineOf,
  resolveReferences,
  resolveVariables,
  search as searchDocument,
  toMarkdown,
  transformText,
  validateAgainst,
  variablesUsed,
  wrapLines,
  type Block,
  type CitationStyle,
  type DocumentSchema,
  type Source,
  type StructuredDocument,
  type Transform
} from '../../shared/compute/document.ts'
import {
  checkArchive,
  checkMapping,
  decodeText,
  detectFormat,
  findDuplicates,
  flattenJson,
  hashOf,
  isInterchangeError,
  LOCALES,
  lossFor,
  readDateIn,
  readJson,
  readNumberIn,
  readXml,
  suggestMapping,
  xmlToRows,
  type ArchiveEntry,
  type FieldTarget,
  type FormatId,
  type LocaleConvention
} from '../../shared/compute/interchange.ts'
import {
  evaluateExpression,
  isEvaluateError,
  isParseError,
  parseExpression,
  sizeOf,
  type Expression
} from '../../shared/compute/expression.ts'
import { BadInput, Reader } from './engines.ts'

export const STUDY_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'uncertainty.distribution': 'computation.measurement',
  'uncertainty.propagate': 'computation.measurement',
  'uncertainty.montecarlo': 'computation.measurement',
  'uncertainty.sensitivity': 'computation.measurement',
  'uncertainty.budget': 'computation.measurement',
  'uncertainty.compare': 'computation.measurement',

  'study.size': 'computation.simulate',
  'study.cases': 'computation.simulate',
  'study.run': 'computation.simulate',
  'study.sensitivity': 'computation.simulate',
  'study.tornado': 'computation.simulate',
  'study.target': 'computation.simulate',
  'study.surface': 'computation.simulate',
  'study.robustness': 'computation.simulate',

  'document.outline': 'computation.document',
  'document.references': 'computation.document',
  'document.citation': 'computation.document',
  'document.read': 'computation.document',
  'document.write': 'computation.document',
  'document.search': 'computation.document',
  'document.analyse': 'computation.document',
  'document.validate': 'computation.document',
  'document.variables': 'computation.document',
  'document.diff': 'computation.document',
  'document.text': 'computation.document',

  'interchange.detect': 'computation.interchange',
  'interchange.decode': 'computation.interchange',
  'interchange.locale': 'computation.interchange',
  'interchange.json': 'computation.interchange',
  'interchange.xml': 'computation.interchange',
  'interchange.mapping': 'computation.interchange',
  'interchange.duplicates': 'computation.interchange',
  'interchange.loss': 'computation.interchange',
  'interchange.archive': 'computation.interchange'
})

export const STUDY_LIMITS: Readonly<Record<'inputs' | 'parameters' | 'blocks' | 'bytes' | 'sources' | 'entries' | 'columns', number>> =
  Object.freeze({
    inputs: 64,
    parameters: 64,
    blocks: 20_000,
    /** Bytes in one payload a Page hands the decoder, as an array of byte values. */
    bytes: 8 * 1024 * 1024,
    sources: 2000,
    entries: 20_000,
    columns: 512
  })

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- shared readers

/** A model sent as an expression over named inputs. Parsed once; the names are bound per call. */
function modelOver(read: Reader, names: readonly string[], key = 'model'): (values: readonly number[]) => number {
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadInput(`"${name}" is not a usable variable name.`)
  }
  const tree = parseExpression(read.text(key))
  if (isParseError(tree)) throw new BadInput(tree.message)
  if (sizeOf(tree) > 4000) throw new BadInput('That model is too large to work with.')

  return (values: readonly number[]): number => {
    const scope: Record<string, number> = Object.create(null)
    for (let i = 0; i < names.length; i += 1) scope[names[i] as string] = values[i] as number
    const value = evaluateExpression(tree, { ...scope })
    return isEvaluateError(value) ? Number.NaN : value
  }
}

type Comparison = 'less' | 'less-or-equal' | 'greater' | 'greater-or-equal' | 'equals' | 'not-equals'

/**
 * A constraint: two arithmetic expressions and a comparison between them.
 *
 * The comparison sits here rather than inside the expression because the shared expression language has no
 * comparison operators, and that is on purpose -- it exists so a Page can send a model and cannot send code, and
 * every operator added to it is added for every engine that compiles one. `x + y < 10` arrives as
 * `{left: 'x + y', comparison: 'less', right: '10'}`, which is also clearer about what is being compared.
 */
function predicateOver(
  left: Expression,
  comparison: Comparison,
  right: Expression,
  names: readonly string[],
  tolerance: number
): (values: Record<string, ParameterValue>) => boolean {
  return (values: Record<string, ParameterValue>): boolean => {
    const scope: Record<string, number> = Object.create(null)
    for (const name of names) {
      const held = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined
      if (typeof held === 'number') scope[name] = held
      else if (typeof held === 'boolean') scope[name] = held ? 1 : 0
      else scope[name] = Number.NaN
    }
    const bound = { ...scope }
    const a = evaluateExpression(left, bound)
    const b = evaluateExpression(right, bound)
    // A constraint that cannot be worked out removes the case rather than keeping it. Keeping it would mean a case
    // nobody checked sitting in the results looking checked.
    if (isEvaluateError(a) || isEvaluateError(b) || !Number.isFinite(a) || !Number.isFinite(b)) return false

    switch (comparison) {
      case 'less':
        return a < b
      case 'less-or-equal':
        return a <= b
      case 'greater':
        return a > b
      case 'greater-or-equal':
        return a >= b
      // Compared within a tolerance, because a swept value of 0.30000000000000004 is the value the sweep produced
      // and an exact test would drop the case somebody asked for.
      case 'equals':
        return Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b))
      case 'not-equals':
        return Math.abs(a - b) > tolerance * Math.max(1, Math.abs(a), Math.abs(b))
    }
  }
}

function distributionOf(raw: unknown, where: string): Distribution {
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`${where} has to be a distribution.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const kind = entry.choice('kind', ['exact', 'uniform', 'normal', 'lognormal', 'triangular', 'discrete', 'empirical'] as const, 'exact')
  switch (kind) {
    case 'exact':
      return { kind, value: entry.number('value') }
    case 'uniform':
      return { kind, low: entry.number('low'), high: entry.number('high') }
    case 'normal':
      return { kind, mean: entry.number('mean'), standardDeviation: entry.number('standardDeviation') }
    case 'lognormal':
      return { kind, logMean: entry.number('logMean'), logStandardDeviation: entry.number('logStandardDeviation') }
    case 'triangular':
      return { kind, low: entry.number('low'), peak: entry.number('peak'), high: entry.number('high') }
    case 'discrete':
      return {
        kind,
        outcomes: entry.list('outcomes', 10_000).map((one) => {
          const outcome = new Reader(one)
          return { value: outcome.number('value'), weight: outcome.number('weight'), label: outcome.optionalText('label', '', 200) }
        })
      }
    case 'empirical':
      return { kind, values: entry.numbers('values', 100_000) }
  }
}

function quantityOf(raw: unknown, where: string): UncertainQuantity {
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`${where} has to be a quantity.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const one = uncertainQuantity(entry.text('id', 200), entry.number('value'), entry.optionalText('unit', '', 200), {
    label: entry.optionalText('label', '', 200),
    uncertainty: entry.has('uncertainty')
      ? {
          value: Math.abs(entry.number('uncertainty')),
          kind: entry.choice('uncertaintyKind', ['standard', 'expanded', 'bound'] as const, 'standard'),
          coverageFactor: entry.optionalNumber('coverageFactor', 1),
          source: entry.choice('uncertaintySource', ['instrument', 'repeated', 'stated', 'propagated', 'estimated', 'none'] as const, 'stated')
        }
      : undefined,
    distribution: entry.has('distribution') ? distributionOf(entry.raw('distribution'), `${where}'s distribution`) : undefined,
    provenance: entry.choice('provenance', ['measured', 'simulated', 'derived', 'imported', 'assumed', 'unknown'] as const, 'unknown'),
    sources: entry.has('sources')
      ? entry.list('sources', 200).map((source) => {
          const it = new Reader(source)
          return {
            id: it.text('id', 200),
            component: it.choice('component', ['instrument', 'repeatability', 'calibration', 'environment', 'method', 'stated', 'other'] as const, 'other'),
            standard: Math.abs(it.number('standard')),
            systematic: it.boolean('systematic', false),
            describe: it.optionalText('describe', '', 400)
          }
        })
      : undefined,
    bounds: entry.has('low') || entry.has('high')
      ? { low: entry.has('low') ? entry.number('low') : null, high: entry.has('high') ? entry.number('high') : null }
      : undefined,
    note: entry.optionalText('note', '', 400)
  })
  if (isUncertaintyError(one)) throw new BadInput(one.message)
  return one
}

function quantitiesOf(read: Reader, key = 'inputs'): UncertainQuantity[] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of quantities.`)
  if (raw.length > STUDY_LIMITS.inputs) throw new BadInput(`"${key}" has more than the ${STUDY_LIMITS.inputs} quantities allowed.`)
  return raw.map((one, i) => quantityOf(one, `"${key}" at position ${i + 1}`))
}

function correlationsOf(read: Reader, quantities: readonly UncertainQuantity[]): CorrelationSet | undefined {
  if (!read.has('correlations')) return undefined
  const ids = new Set(quantities.map((one) => one.id))
  let set: CorrelationSet = { pairs: {} } as CorrelationSet
  for (const entry of read.list('correlations', 4096)) {
    const it = new Reader(entry)
    const a = it.text('a', 200)
    const b = it.text('b', 200)
    if (!ids.has(a) || !ids.has(b)) throw new BadInput(`A correlation names "${ids.has(a) ? b : a}", which is not one of the inputs.`)
    const next = setCorrelation(set, a, b, it.number('value'))
    if (isUncertaintyError(next)) throw new BadInput(next.message)
    set = next
  }
  return set
}

function parameterOf(raw: unknown, where: string): Parameter {
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`${where} has to be a parameter.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const type = entry.choice('type', ['number', 'integer', 'boolean', 'category', 'quantity'] as const, 'number') as ParameterType
  const value: ParameterValue =
    type === 'category' ? entry.text('value', 400) : type === 'boolean' ? entry.boolean('value') : entry.number('value')
  const one = parameter(entry.text('id', 200), type, value, {
    name: entry.optionalText('name', '', 200),
    unit: entry.optionalText('unit', '', 200),
    bounds: entry.has('low') || entry.has('high')
      ? {
          low: entry.has('low') ? entry.number('low') : null,
          high: entry.has('high') ? entry.number('high') : null,
          exclusiveLow: entry.boolean('exclusiveLow', false),
          exclusiveHigh: entry.boolean('exclusiveHigh', false)
        }
      : undefined,
    categories: entry.has('categories') ? entry.strings('categories', 10_000) : undefined,
    distribution: entry.has('distribution') ? distributionOf(entry.raw('distribution'), `${where}'s distribution`) : undefined,
    locked: entry.boolean('locked', false)
  })
  if (isStudyError(one)) throw new BadInput(one.message)
  return one
}

function parametersOf(read: Reader, key = 'parameters'): Parameter[] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of parameters.`)
  if (raw.length > STUDY_LIMITS.parameters) throw new BadInput(`"${key}" has more than the ${STUDY_LIMITS.parameters} parameters allowed.`)
  return raw.map((one, i) => parameterOf(one, `"${key}" at position ${i + 1}`))
}

function valueSpecOf(raw: unknown, where: string): ValueSpec {
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`${where} has to be a set of values.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const kind = entry.choice('kind', ['list', 'step', 'count', 'log', 'categories'] as const, 'count')
  switch (kind) {
    case 'list': {
      const values = entry.raw('values')
      if (!Array.isArray(values)) throw new BadInput(`${where} needs a list of values.`)
      if (values.length > 100_000) throw new BadInput(`${where} has more values than are allowed.`)
      return {
        kind,
        values: values.map((one) => {
          if (typeof one === 'number' || typeof one === 'string' || typeof one === 'boolean') return one
          throw new BadInput(`${where} holds something that is not a number, text or true/false.`)
        })
      }
    }
    case 'step':
      return { kind, start: entry.number('start'), stop: entry.number('stop'), step: entry.number('step') }
    case 'count':
    case 'log':
      return { kind, start: entry.number('start'), stop: entry.number('stop'), count: Math.round(entry.number('count')) }
    case 'categories':
      return { kind }
  }
}

function strategyOf(read: Reader): SweepStrategy {
  const raw = read.raw('strategy')
  if (typeof raw !== 'object' || raw === null) throw new BadInput('"strategy" has to say how the study sweeps.')
  const entry = new Reader(raw as Record<string, unknown>)
  const kind = entry.choice('kind', ['one-at-a-time', 'grid', 'random', 'latin-hypercube'] as const, 'grid')
  if (kind === 'one-at-a-time' || kind === 'grid') {
    return {
      kind,
      sweeps: entry.list('sweeps', STUDY_LIMITS.parameters).map((one) => {
        const it = new Reader(one)
        return { parameterId: it.text('parameterId', 200), spec: valueSpecOf(it.raw('spec'), 'a sweep') }
      })
    }
  }
  return {
    kind,
    parameterIds: entry.strings('parameterIds', STUDY_LIMITS.parameters),
    count: Math.round(entry.number('count')),
    seed: Math.round(entry.optionalNumber('seed', 1))
  }
}

function constraintsOf(read: Reader, names: readonly string[]): Constraint[] {
  if (!read.has('constraints')) return []
  return read.list('constraints', 200).map((one) => {
    const entry = new Reader(one)
    const side = (key: string): Expression => {
      const tree = parseExpression(entry.text(key))
      // Refused rather than treated as always true: a constraint that never removes anything leaves the cases it
      // should have removed in the results, looking checked.
      if (isParseError(tree)) throw new BadInput(`A constraint could not be read: ${tree.message}`)
      if (sizeOf(tree) > 2000) throw new BadInput('That constraint is too large to work with.')
      return tree
    }
    return {
      id: entry.text('id', 200),
      describe: entry.optionalText('describe', '', 400),
      holds: predicateOver(
        side('left'),
        entry.choice('comparison', ['less', 'less-or-equal', 'greater', 'greater-or-equal', 'equals', 'not-equals'] as const, 'less'),
        side('right'),
        names,
        entry.optionalNumber('tolerance', 1e-9)
      )
    }
  })
}

function documentOf(read: Reader, key = 'document'): StructuredDocument {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`"${key}" has to be a document.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const blocks = entry.raw('blocks')
  if (!Array.isArray(blocks)) throw new BadInput(`"${key}" needs a list of blocks.`)
  if (blocks.length > STUDY_LIMITS.blocks) throw new BadInput(`"${key}" has more than the ${STUDY_LIMITS.blocks} blocks allowed.`)
  const variables: Record<string, string> = Object.create(null)
  const raw2 = entry.raw('variables')
  if (raw2 !== undefined) {
    if (typeof raw2 !== 'object' || raw2 === null || Array.isArray(raw2)) throw new BadInput('A document\u2019s variables are a set of named strings.')
    for (const [name, held] of Object.entries(raw2 as Record<string, unknown>)) {
      if (typeof held !== 'string') throw new BadInput(`The variable "${name}" has to be text.`)
      variables[name] = held
    }
  }
  return {
    id: entry.optionalText('id', 'document', 200),
    // The blocks are the document's own model. They arrive as they were handed out by `document.read`, so they are
    // passed through rather than rebuilt field by field; the engines validate what they use.
    blocks: blocks as Block[],
    metadata: (entry.raw('metadata') ?? emptyDocument('document').metadata) as StructuredDocument['metadata'],
    variables: { ...variables }
  }
}

function sourcesOf(read: Reader, key = 'sources'): Source[] {
  if (!read.has(key)) return []
  return read.list(key, STUDY_LIMITS.sources) as unknown as Source[]
}

function bytesOf(read: Reader, key = 'bytes'): Uint8Array {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of byte values.`)
  if (raw.length > STUDY_LIMITS.bytes) throw new BadInput(`"${key}" is larger than the ${STUDY_LIMITS.bytes} bytes allowed.`)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    const one = raw[i]
    if (typeof one !== 'number' || !Number.isInteger(one) || one < 0 || one > 255) {
      throw new BadInput(`"${key}" has something at position ${i + 1} that is not a byte.`)
    }
    out[i] = one
  }
  return out
}

function localeOf(read: Reader): LocaleConvention {
  const id = read.optionalText('locale', 'en-GB', 32)
  if (!Object.prototype.hasOwnProperty.call(LOCALES, id)) {
    throw new BadInput(`Orbis has no locale convention called "${id}". It knows ${Object.keys(LOCALES).join(', ')}.`)
  }
  return LOCALES[id] as LocaleConvention
}

/**
 * A model over named parameters, returning named outputs.
 *
 * One expression per output, so a study can look at several answers from one set of parameters without the Page
 * sending the same sweep three times.
 */
function namedModel(read: Reader, parameters: readonly Parameter[]): (values: Record<string, ParameterValue>) => Record<string, number> {
  const names = parameters.map((one) => one.id)
  for (const name of names) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadInput(`"${name}" is not a usable parameter id for a model.`)
  }

  const outputs: { name: string; tree: Expression }[] = []
  if (read.has('outputs')) {
    for (const one of read.list('outputs', 64)) {
      const entry = new Reader(one)
      const tree = parseExpression(entry.text('expression'))
      if (isParseError(tree)) throw new BadInput(tree.message)
      if (sizeOf(tree) > 4000) throw new BadInput('That model is too large to work with.')
      outputs.push({ name: entry.text('name', 200), tree })
    }
  } else {
    const tree = parseExpression(read.text('model'))
    if (isParseError(tree)) throw new BadInput(tree.message)
    if (sizeOf(tree) > 4000) throw new BadInput('That model is too large to work with.')
    outputs.push({ name: read.optionalText('output', 'value', 200), tree })
  }
  if (outputs.length === 0) throw new BadInput('A study needs at least one output to look at.')

  return (values: Record<string, ParameterValue>): Record<string, number> => {
    const scope: Record<string, number> = Object.create(null)
    for (const name of names) {
      const held = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined
      scope[name] = typeof held === 'number' ? held : typeof held === 'boolean' ? (held ? 1 : 0) : Number.NaN
    }
    const bound = { ...scope }
    const out: Record<string, number> = Object.create(null)
    for (const one of outputs) {
      const value = evaluateExpression(one.tree, bound)
      out[one.name] = isEvaluateError(value) ? Number.NaN : value
    }
    return { ...out }
  }
}

/** A run handed back by `study.run`, for the operations that read results rather than compute them. */
function runFrom(read: Reader): StudyRun {
  const raw = read.raw('run')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"run" has to be a study run, as study.run gave it back.')
  const entry = new Reader(raw as Record<string, unknown>)
  const results = entry.raw('results')
  if (!Array.isArray(results)) throw new BadInput('That run has no results in it.')
  if (results.length > 200_000) throw new BadInput('That run has more results than can be read in one request.')
  return raw as unknown as StudyRun
}

/** A text transform, as the tagged object the engine takes. */
function transformOf(read: Reader): Transform {
  const kind = read.choice(
    'transform',
    ['upper', 'lower', 'title', 'sentence', 'trim-whitespace', 'collapse-spaces', 'sort-lines', 'deduplicate-lines'] as const,
    'trim-whitespace'
  )
  if (kind === 'sort-lines') {
    return { kind: 'sort-lines', descending: read.boolean('descending', false) }
  }
  return { kind }
}

// ---------------------------------------------------------------- dispatch

export function runStudyOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- uncertainty
    case 'uncertainty.distribution':
      return settle(checkDistribution(distributionOf(read.raw('distribution'), '"distribution"')), isUncertaintyError)

    case 'uncertainty.propagate': {
      const inputs = quantitiesOf(read)
      const model = modelOver(read, inputs.map((one) => one.id))
      const result = propagateFirstOrder(inputs, model, { level: read.optionalNumber('level', 0.95) })
      if (isUncertaintyError(result)) return { ok: false, ...result }
      return { ok: true, ...result, assumptions: checkAssumptions(inputs, model, result) }
    }

    case 'uncertainty.montecarlo': {
      const inputs = quantitiesOf(read)
      return settle(
        propagateByMonteCarlo(inputs, modelOver(read, inputs.map((one) => one.id)), {
          samples: Math.round(read.optionalNumber('samples', 20_000)),
          seed: Math.round(read.optionalNumber('seed', 1)),
          level: read.optionalNumber('level', 0.95),
          correlations: correlationsOf(read, inputs),
          memory: read.choice('memory', ['all', 'aggregate'] as const, 'aggregate')
        }),
        isUncertaintyError
      )
    }

    case 'uncertainty.sensitivity': {
      const inputs = quantitiesOf(read)
      return settle(
        globalSensitivity(inputs, modelOver(read, inputs.map((one) => one.id)), {
          samples: Math.round(read.optionalNumber('samples', 2000)),
          seed: Math.round(read.optionalNumber('seed', 1))
        }),
        isUncertaintyError
      )
    }

    case 'uncertainty.budget': {
      const inputs = quantitiesOf(read)
      const sensitivities = read.list('sensitivities', STUDY_LIMITS.inputs).map((one) => {
        const entry = new Reader(one)
        return { id: entry.text('id', 200), derivative: entry.number('derivative'), contribution: entry.optionalNumber('contribution', 0), share: entry.optionalNumber('share', 0) }
      })
      return settle(uncertaintyBudget(inputs, sensitivities as never, read.optionalNumber('level', 0.95)), isUncertaintyError)
    }

    case 'uncertainty.compare': {
      const inputs = quantitiesOf(read)
      return settle(
        compareMethods(inputs, modelOver(read, inputs.map((one) => one.id)), {
          samples: Math.round(read.optionalNumber('samples', 20_000)),
          seed: Math.round(read.optionalNumber('seed', 1)),
          level: read.optionalNumber('level', 0.95),
          memory: 'aggregate'
        }),
        isUncertaintyError
      )
    }

    // ---------------------------------------------------------------- studies
    case 'study.size': {
      const result = estimateSize(parametersOf(read), strategyOf(read))
      return isStudyError(result) ? { ok: false, ...result } : { ok: true, cases: result }
    }

    case 'study.cases': {
      const parameters = parametersOf(read)
      return settle(generateCases(parameters, strategyOf(read), constraintsOf(read, parameters.map((one) => one.id))), isStudyError)
    }

    case 'study.run': {
      const parameters = parametersOf(read)
      const cases = generateCases(parameters, strategyOf(read), constraintsOf(read, parameters.map((one) => one.id)))
      if (isStudyError(cases)) return { ok: false, ...cases }
      const run = runStudy(cases.cases, namedModel(read, parameters), fingerprintOf(read.optionalText('modelVersion', '1', 64), parameters), {
        policy: read.choice('policy', ['stop', 'continue', 'skip-rest'] as const, 'continue')
      })
      return {
        ok: true,
        ...run,
        generated: { requested: cases.requested, excluded: cases.excluded, strategy: cases.strategy, notes: cases.notes }
      }
    }

    case 'study.sensitivity': {
      const parameters = parametersOf(read)
      const result = localSensitivity(parameters, read.text('output', 200), namedModel(read, parameters), {
        relativeStep: read.optionalNumber('relativeStep', 0.01)
      })
      return isStudyError(result) ? { ok: false, ...result } : { ok: true, sensitivities: result }
    }

    case 'study.tornado': {
      const parameters = parametersOf(read)
      return settle(
        tornado(
          parameters,
          read.list('ranges', STUDY_LIMITS.parameters).map((one) => {
            const entry = new Reader(one)
            return { parameterId: entry.text('parameterId', 200), low: entry.number('low'), high: entry.number('high') }
          }),
          read.text('output', 200),
          namedModel(read, parameters)
        ),
        isStudyError
      )
    }

    case 'study.target': {
      const parameters = parametersOf(read)
      return settle(
        findTarget(
          parameters,
          read.text('parameterId', 200),
          read.text('output', 200),
          read.number('target'),
          { low: read.number('low'), high: read.number('high') },
          namedModel(read, parameters),
          { tolerance: read.has('tolerance') ? read.number('tolerance') : undefined }
        ),
        isStudyError
      )
    }

    case 'study.surface': {
      // Built from a run rather than from a model: a surface over cases that were never run would be a picture of
      // values nobody computed.
      const run = runFrom(read)
      return settle(responseSurface(run.results, read.text('xParameter', 200), read.text('yParameter', 200), read.text('output', 200)), isStudyError)
    }

    case 'study.robustness':
      return settle(
        robustness(runFrom(read), read.text('output', 200), {
          baseline: read.has('baseline') ? read.number('baseline') : undefined,
          band: read.has('band') ? read.number('band') : undefined,
          higherIsBetter: read.boolean('higherIsBetter', true)
        }),
        isStudyError
      )

    // ---------------------------------------------------------------- documents
    case 'document.outline': {
      const document = documentOf(read)
      return { ok: true, outline: outlineOf(document), numbering: numbering(document) }
    }

    case 'document.references':
      return { ok: true, ...resolveReferences(documentOf(read)) }

    case 'document.citation': {
      const style = read.choice('style', ['apa', 'mla', 'chicago', 'ieee'] as const, 'apa') as CitationStyle
      const sources = sourcesOf(read)
      if (read.has('document')) return { ok: true, ...checkCitations(documentOf(read), sources) }
      return { ok: true, citations: sources.map((one, i) => formatCitation(one, style, i + 1)) }
    }

    case 'document.read': {
      const from = read.choice('from', ['markdown', 'html'] as const, 'markdown')
      const source = read.text('source', 4 * 1024 * 1024)
      const result = from === 'markdown' ? fromMarkdown(source) : fromHtml(source)
      return isDocumentError(result) ? { ok: false, ...result } : { ok: true, ...(result as object) }
    }

    case 'document.write':
      return { ok: true, markdown: toMarkdown(documentOf(read)) }

    case 'document.search':
      return settle(
        searchDocument(documentOf(read), read.text('query', 2000), {
          caseSensitive: read.boolean('caseSensitive', false),
          wholeWord: read.boolean('wholeWord', false),
          regex: read.boolean('regex', false),
          limit: read.has('limit') ? Math.round(read.number('limit')) : undefined
        }),
        isDocumentError
      )

    case 'document.analyse':
      return { ok: true, ...analyseDocument(documentOf(read), read.optionalNumber('wordsPerMinute', 220)) }

    case 'document.validate': {
      // The engine's own `ok` means "the document satisfies the schema", which is not the envelope's "the request
      // ran". Renamed rather than spread over the top of it, which would have answered the wrong question.
      const { ok: satisfied, ...rest } = validateAgainst(documentOf(read), (read.raw('schema') ?? {}) as DocumentSchema, sourcesOf(read))
      return { ok: true, satisfied, ...rest }
    }

    case 'document.variables': {
      const document = documentOf(read)
      if (!read.has('values')) return { ok: true, used: variablesUsed(document) }
      const raw = read.raw('values')
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"values" has to be a set of named strings.')
      const values: Record<string, string> = Object.create(null)
      for (const [name, held] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof held !== 'string') throw new BadInput(`The value for "${name}" has to be text.`)
        if (held.length > 4000) throw new BadInput(`The value for "${name}" is too long.`)
        values[name] = held
      }
      return { ok: true, ...resolveVariables(document, { ...values }) }
    }

    case 'document.diff':
      return { ok: true, ...diffDocuments(documentOf(read, 'before'), documentOf(read, 'after')) }

    case 'document.text': {
      const source = read.text('source', 4 * 1024 * 1024)
      if (read.has('columns')) return { ok: true, text: wrapLines(source, Math.round(read.number('columns'))) }
      return { ok: true, text: transformText(source, transformOf(read)) }
    }

    // ---------------------------------------------------------------- interchange
    case 'interchange.detect':
      return {
        ok: true,
        ...detectFormat(read.optionalText('name', '', 1000), read.optionalText('mediaType', '', 200), read.optionalText('sample', '', 65_536))
      }

    case 'interchange.decode':
      return settle(decodeText(bytesOf(read)), isInterchangeError)

    case 'interchange.locale': {
      const locale = localeOf(read)
      const what = read.choice('what', ['number', 'date'] as const, 'number')
      if (what === 'number') {
        const value = readNumberIn(read.text('source', 200), locale)
        return { ok: true, value, read: value !== null, locale: locale.id }
      }
      const reading = readDateIn(read.text('source', 200), locale)
      return { ok: true, reading, read: reading !== null, locale: locale.id }
    }

    case 'interchange.json': {
      const reading = readJson(read.text('source', 8 * 1024 * 1024))
      if (isInterchangeError(reading)) return { ok: false, ...reading }
      if (!read.boolean('flatten', false)) return { ...reading, ok: true }
      return {
        ...reading,
        ok: true,
        flattened: flattenJson(reading.value, {
          separator: read.optionalText('separator', '.', 8),
          maxDepth: Math.round(read.optionalNumber('maxDepth', 8))
        })
      }
    }

    case 'interchange.xml': {
      const root = readXml(read.text('source', 8 * 1024 * 1024))
      if (isInterchangeError(root)) return { ok: false, ...root }
      return read.boolean('asRows', false) ? { ...xmlToRows(root), ok: true, root } : { ok: true, root }
    }

    case 'interchange.mapping': {
      const columns = read.strings('columns', STUDY_LIMITS.columns)
      const fields = read.list('fields', STUDY_LIMITS.columns) as unknown as FieldTarget[]
      if (!read.has('mapping')) return { ok: true, suggestions: suggestMapping(columns, fields) }
      const raw = read.raw('mapping')
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"mapping" has to be a set of field-to-column names.')
      const mapping: Record<string, string | null> = Object.create(null)
      for (const [field, column] of Object.entries(raw as Record<string, unknown>)) {
        if (column !== null && typeof column !== 'string') throw new BadInput(`The mapping for "${field}" has to be a column name or null.`)
        mapping[field] = column
      }
      const { ok: usable, ...rest } = checkMapping(columns, fields, { ...mapping } as never)
      return { ok: true, usable, ...rest }
    }

    case 'interchange.duplicates': {
      const files = read.list('files', STUDY_LIMITS.entries).map((one) => {
        const entry = new Reader(one)
        return { name: entry.text('name', 1000), hash: entry.has('bytes') ? hashOf(bytesOf(entry, 'bytes')) : entry.text('hash', 128), size: entry.optionalNumber('size', 0) }
      })
      return { ok: true, duplicates: findDuplicates(files as never), files: files.map((one) => ({ name: one.name, hash: one.hash })) }
    }

    case 'interchange.loss': {
      const raw = read.raw('carries')
      if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
        throw new BadInput('"carries" has to say what the data holds, as a set of true/false flags.')
      }
      const carries: Record<string, boolean> = Object.create(null)
      for (const [name, held] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
        if (typeof held !== 'boolean') throw new BadInput(`"${name}" has to be true or false.`)
        carries[name] = held
      }
      return settle(lossFor(read.text('format', 64) as FormatId, { ...carries } as never), isInterchangeError)
    }

    case 'interchange.archive': {
      const entries = read.list('entries', STUDY_LIMITS.entries).map((one) => {
        const entry = new Reader(one)
        return {
          path: entry.text('path', 4000),
          size: entry.optionalNumber('size', 0),
          compressedSize: entry.optionalNumber('compressedSize', 0),
          directory: entry.boolean('directory', false)
        }
      })
      return { ok: true, ...checkArchive(entries as unknown as ArchiveEntry[]) }
    }
  }

  // Reached only when an operation is in this file's capability map and has no case here, which is ours to fix.
  throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
}
