/**
 * The knowledge and experiment workbench a Page can reach: concept graphs, experiment designs and reproduction.
 *
 * Same contract as every bridge before it. A Page sends data, never code. There is no `eval` and no `new Function`
 * on any path reachable from here, and every number a Page shows came back through this door from an engine that
 * computed it — none of it is produced by a language model and none of it is hardcoded.
 *
 * ## Why where a claim came from is a field and not a guess
 *
 * Every concept and every relation carries a provenance: authored, imported, from a source, suggested by a model,
 * accepted from a model, or derived. Those are six different states and the engine keeps them apart, so a Page can
 * show which parts of a graph somebody asserted and which parts a model proposed. This door reads that field and
 * never fills it in — a concept arriving with no provenance is refused rather than quietly marked as authored,
 * because "somebody said this" is exactly the claim that must not be manufactured.
 *
 * ## Why the design check runs before anything else
 *
 * `experiment.check-design` answers the questions that cannot be fixed afterwards. A hypothesis written after the
 * result is not a prediction; a missing control cannot be added retrospectively; a hypothesis nothing could refute
 * is not a hypothesis. Offering that check is more useful than any analysis run later, which is why it is here and
 * why its verdict travels under `sound` rather than being spread over the call's own `ok`.
 *
 * ## Why reproduction is a verdict with five values
 *
 * "Did it reproduce" is not a yes or no. The engine distinguishes reproduced, numerically equivalent, different,
 * not reproducible, and inputs differ — and the last two are the interesting ones, because they say the question
 * could not be asked rather than that the answer was no. Every comparison comes back per measurement, so a single
 * disagreeing figure is findable instead of buried in a summary.
 *
 * ## The operations that refuse rather than default
 *
 * `concept.layout` refuses a hierarchical layout of a graph with a cycle, because there is no top. `run.compare`
 * refuses to call a run reproduced when its record is missing what would be needed to repeat it. `graph.paths`
 * caps its search depth and says so rather than walking a large graph forever. Nothing here invents an uncertainty,
 * a strength or a provenance that was not supplied.
 */

import {
  CONCEPT_ASSUMPTIONS,
  CONCEPT_LIMITS,
  analyse,
  checkGraph,
  findCycle,
  fromOutline,
  fromStatements,
  isConceptError,
  layout,
  neighbourhood,
  pathsBetween,
  type Concept,
  type ConceptGraph,
  type ConceptKind,
  type ConceptStatus,
  type LayoutKind,
  type Provenance,
  type Relation,
  type RelationKind
} from '../../shared/pages/concepts.ts'
import {
  EXPERIMENT_ASSUMPTIONS,
  EXPERIMENT_LIMITS,
  checkDesign,
  checkRecord,
  checkVariables,
  compareRuns,
  concludeFrom,
  hypothesis,
  isExperimentError,
  recordOutcome,
  reviseHypothesis,
  summariseRepeats,
  type Experiment,
  type Hypothesis,
  type Measurement,
  type Role,
  type Run,
  type Tolerance,
  type Variable
} from '../../shared/pages/experiments.ts'
import { BadInput, Reader } from './engines.ts'

/**
 * Every operation this bridge answers, and the capability each one needs.
 *
 * Two, because mapping what is known and running an experiment are separate things a Page might want one of.
 */
export const KNOWLEDGE_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  // ---- concept graphs
  'concept.check': 'computation.concepts',
  'concept.analyse': 'computation.concepts',
  'concept.cycle': 'computation.concepts',
  'concept.paths': 'computation.concepts',
  'concept.neighbourhood': 'computation.concepts',
  'concept.layout': 'computation.concepts',
  'concept.from-outline': 'computation.concepts',
  'concept.from-statements': 'computation.concepts',
  'concept.vocabulary': 'computation.concepts',

  // ---- experiments
  'experiment.check-variables': 'computation.experiments',
  'experiment.check-design': 'computation.experiments',
  'experiment.hypothesis': 'computation.experiments',
  'experiment.record-outcome': 'computation.experiments',
  'experiment.revise-hypothesis': 'computation.experiments',
  'experiment.conclude': 'computation.experiments',
  'run.check-record': 'computation.experiments',
  'run.compare': 'computation.experiments',
  'run.repeats': 'computation.experiments',
  'experiment.vocabulary': 'computation.experiments',

  // ---- provenance
  'knowledge.assumptions': 'computation.concepts'
})

/** What crosses the boundary, as opposed to what the engines will compute. */
export const KNOWLEDGE_LIMITS = Object.freeze({
  concepts: CONCEPT_LIMITS.nodes,
  relations: CONCEPT_LIMITS.edges,
  variables: EXPERIMENT_LIMITS.variables,
  measurements: EXPERIMENT_LIMITS.measurements,
  hypotheses: EXPERIMENT_LIMITS.hypotheses,
  outlineLength: 100_000,
  properties: 64,
  tags: 64,
  pathDepth: 6
})

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

/**
 * Whether a field was actually given, treating an explicit `null` as absent.
 *
 * `read.has` answers "is the key there", and for these engines that is the wrong question. Every one of them uses
 * `null` to mean "nobody supplied this" -- no deadline, no seed, no stated uncertainty, no rated strength -- so a
 * Page that reads an object out of this door and sends it back sends those nulls with it. Checking only for the
 * key's presence then rejects the bridge's own output, which is exactly what happened: a hypothesis came back with
 * `outcome: null` and was refused for not being text.
 *
 * So absent and explicitly-null are the same thing here, and the distinction the engines care about -- null against
 * a real value -- is preserved either way.
 */
const given = (read: Reader, key: string): boolean => read.has(key) && read.raw(key) !== null

function choice<T extends string>(read: Reader, key: string, allowed: readonly T[], fallback?: T): T {
  if (!read.has(key)) {
    if (fallback !== undefined) return fallback
    throw new BadInput(`"${key}" has to be one of: ${allowed.join(', ')}.`)
  }
  const value = read.text(key, 64)
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadInput(`"${value}" is not one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

const CONCEPT_KINDS: readonly ConceptKind[] = [
  'concept',
  'entity',
  'process',
  'event',
  'claim',
  'evidence',
  'variable',
  'rule',
  'question',
  'hypothesis',
  'note',
  'group'
]
const CONCEPT_STATUSES: readonly ConceptStatus[] = [
  'draft',
  'confirmed',
  'question',
  'hypothesis',
  'verified',
  'rejected',
  'deprecated'
]
const PROVENANCES: readonly Provenance[] = [
  'authored',
  'imported',
  'from-source',
  'model-suggested',
  'model-accepted',
  'derived'
]
const RELATION_KINDS: readonly RelationKind[] = [
  'contains',
  'part-of',
  'depends-on',
  'causes',
  'influences',
  'instance-of',
  'contradicts',
  'supports',
  'precedes',
  'requires',
  'produces',
  'transforms-into',
  'similar-to',
  'associated-with',
  'references'
]
const RELATION_STATUSES = ['proposed', 'tested', 'supported', 'rejected'] as const
const LAYOUT_KINDS: readonly LayoutKind[] = ['hierarchical', 'radial', 'grid', 'manual']
const ROLES: readonly Role[] = ['independent', 'dependent', 'controlled', 'derived', 'nuisance']
const RUN_STATUSES = ['complete', 'partial', 'failed', 'cancelled'] as const
const DETERMINISMS = ['deterministic', 'seeded', 'non-deterministic'] as const
const HYPOTHESIS_STATES = ['stated', 'tested', 'superseded'] as const
const OUTCOMES = ['supported', 'not-supported', 'inconclusive'] as const

/** A string map, for properties and hashes. Values are text only, so nothing structured hides in one. */
function textMap(read: Reader, key: string): Record<string, string> {
  if (!read.has(key)) return {}
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object of text values.`)
  }
  const out: Record<string, string> = Object.create(null)
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length > KNOWLEDGE_LIMITS.properties) {
    throw new BadInput(`"${key}" has more than the ${KNOWLEDGE_LIMITS.properties} entries allowed.`)
  }
  for (const [name, value] of entries) {
    if (typeof value !== 'string') throw new BadInput(`"${key}.${name}" has to be text.`)
    if (value.length > 1000) throw new BadInput(`"${key}.${name}" is too long.`)
    out[name] = value
  }
  return out
}

/** A number map, for the settings a run used. */
function numberMap(read: Reader, key: string): Record<string, number> {
  if (!read.has(key)) return {}
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object of numbers.`)
  }
  const out: Record<string, number> = Object.create(null)
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new BadInput(`"${key}.${name}" has to be a finite number.`)
    }
    out[name] = value
  }
  return out
}

/**
 * A nested object argument, read by name.
 *
 * Taking the reader is deliberate: it makes the operation invisible to the generation catalogue, whose flat
 * signature model has no way to say "this argument is a whole hypothesis". An operation offered there with only its
 * text arguments visible would pass the argument check and then be refused here for the object it never sent.
 */
function objectAt(read: Reader, key: string): Record<string, unknown> {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an object.`)
  }
  return raw as Record<string, unknown>
}

function conceptFrom(row: Record<string, unknown>): Concept {
  const read = new Reader(row)
  const positionRaw = given(read, 'position') ? read.raw('position') : null
  let position = { x: 0, y: 0 }
  if (positionRaw !== null && typeof positionRaw === 'object' && !Array.isArray(positionRaw)) {
    const entry = new Reader(positionRaw as Record<string, unknown>)
    position = { x: entry.number('x'), y: entry.number('y') }
  }
  return {
    id: read.text('id', 80),
    kind: choice<ConceptKind>(read, 'kind', CONCEPT_KINDS, 'concept'),
    title: read.text('title', 300),
    description: given(read, 'description') ? read.text('description', 4000) : '',
    properties: textMap(read, 'properties'),
    tags: given(read, 'tags') ? read.strings('tags', KNOWLEDGE_LIMITS.tags) : [],
    status: choice<ConceptStatus>(read, 'status', CONCEPT_STATUSES, 'draft'),
    // Required with no fallback. Defaulting it would turn a model's suggestion into somebody's assertion, which is
    // the one field in this graph that must never be manufactured.
    provenance: choice<Provenance>(read, 'provenance', PROVENANCES),
    evidence: given(read, 'evidence') ? read.strings('evidence', KNOWLEDGE_LIMITS.concepts) : [],
    parent: given(read, 'parent') ? read.text('parent', 80) : null,
    collapsed: given(read, 'collapsed') ? read.boolean('collapsed') : false,
    position
  }
}

function relationFrom(row: Record<string, unknown>): Relation {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    from: read.text('from', 80),
    to: read.text('to', 80),
    kind: choice<RelationKind>(read, 'kind', RELATION_KINDS),
    label: given(read, 'label') ? read.text('label', 300) : '',
    // Null rather than a default: a strength is somebody's judgement, and a relation nobody rated is not a weak one.
    strength: given(read, 'strength') ? read.number('strength') : null,
    conditions: given(read, 'conditions') ? read.text('conditions', 1000) : '',
    provenance: choice<Provenance>(read, 'provenance', PROVENANCES),
    status: choice(read, 'status', RELATION_STATUSES, 'proposed'),
    evidence: given(read, 'evidence') ? read.strings('evidence', KNOWLEDGE_LIMITS.concepts) : []
  }
}

function graphFrom(read: Reader, key = 'graph'): ConceptGraph {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a graph object.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    id: entry.text('id', 80),
    title: entry.text('title', 300),
    concepts: given(entry, 'concepts') ? entry.list('concepts', KNOWLEDGE_LIMITS.concepts).map(conceptFrom) : [],
    relations: given(entry, 'relations') ? entry.list('relations', KNOWLEDGE_LIMITS.relations).map(relationFrom) : []
  }
}

function variableFrom(row: Record<string, unknown>): Variable {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    name: read.text('name', 200),
    role: choice<Role>(read, 'role', ROLES),
    unit: given(read, 'unit') ? read.text('unit', 40) : '',
    values: given(read, 'values') ? read.numbers('values', 4000) : [],
    from: given(read, 'from') ? read.strings('from', KNOWLEDGE_LIMITS.variables) : [],
    describe: given(read, 'describe') ? read.text('describe', 1000) : ''
  }
}

function hypothesisFrom(row: Record<string, unknown>): Hypothesis {
  const read = new Reader(row)
  return {
    id: read.text('id', 80),
    statement: read.text('statement', 2000),
    predicts: read.text('predicts', 2000),
    refutedBy: read.text('refutedBy', 2000),
    state: choice(read, 'state', HYPOTHESIS_STATES, 'stated'),
    outcome: given(read, 'outcome') ? choice(read, 'outcome', OUTCOMES) : null,
    supersedes: given(read, 'supersedes') ? read.text('supersedes', 80) : null,
    // A date the Page supplies as text, never read from a clock here: an experiment record has to say when it was
    // stated, and a stamp invented at read time would make an unreproducible record look complete.
    statedAt: read.text('statedAt', 40)
  }
}

function measurementFrom(row: Record<string, unknown>): Measurement {
  const read = new Reader(row)
  return {
    variableId: read.text('variableId', 80),
    value: read.number('value'),
    unit: given(read, 'unit') ? read.text('unit', 40) : '',
    // Null rather than zero. A measurement with no stated uncertainty is not a perfect one.
    uncertainty: given(read, 'uncertainty') ? read.number('uncertainty') : null,
    repeat: given(read, 'repeat') ? read.number('repeat') : 1
  }
}

function runFrom(read: Reader, key: string): Run {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be a run object.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  const recordRaw = given(entry, 'record') ? entry.raw('record') : null
  const record =
    recordRaw !== null && typeof recordRaw === 'object' && !Array.isArray(recordRaw)
      ? new Reader(recordRaw as Record<string, unknown>)
      : new Reader({})
  const externalRaw = given(record, 'externalData') ? record.list('externalData', 200).map((one) => {
        const source = new Reader(one)
        return { source: source.text('source', 600), retrievedAt: source.text('retrievedAt', 40) }
      })
    : []
  return {
    id: entry.text('id', 80),
    experimentId: entry.text('experimentId', 80),
    settings: numberMap(entry, 'settings'),
    measurements: given(entry, 'measurements') ? entry.list('measurements', KNOWLEDGE_LIMITS.measurements).map(measurementFrom)
      : [],
    status: choice(entry, 'status', RUN_STATUSES, 'complete'),
    error: given(entry, 'error') ? entry.text('error', 2000) : '',
    record: {
      experimentVersion: given(record, 'experimentVersion') ? record.number('experimentVersion') : 0,
      engineVersions: textMap(record, 'engineVersions'),
      // Null rather than zero: no seed and seed zero are different, and only one of them can be repeated.
      seed: given(record, 'seed') ? record.number('seed') : null,
      determinism: choice(record, 'determinism', DETERMINISMS, 'deterministic'),
      datasetHashes: textMap(record, 'datasetHashes'),
      externalData: externalRaw
    },
    ranAt: given(entry, 'ranAt') ? entry.text('ranAt', 40) : ''
  }
}

function experimentFrom(read: Reader, key = 'experiment'): Experiment {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput(`"${key}" has to be an experiment object.`)
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return {
    id: entry.text('id', 80),
    title: entry.text('title', 300),
    objective: given(entry, 'objective') ? entry.text('objective', 2000) : '',
    question: given(entry, 'question') ? entry.text('question', 2000) : '',
    hypotheses: given(entry, 'hypotheses') ? entry.list('hypotheses', KNOWLEDGE_LIMITS.hypotheses).map(hypothesisFrom)
      : [],
    variables: given(entry, 'variables') ? entry.list('variables', KNOWLEDGE_LIMITS.variables).map(variableFrom) : [],
    method: given(entry, 'method') ? entry.text('method', 8000) : '',
    assumptions: given(entry, 'assumptions') ? entry.strings('assumptions', 200) : [],
    version: given(entry, 'version') ? entry.number('version') : 1
  }
}

function toleranceFrom(read: Reader): Tolerance {
  if (!read.has('tolerance')) return { absolute: 1e-12, relative: 1e-9 }
  const raw = read.raw('tolerance')
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadInput('"tolerance" has to be an object with "absolute" and "relative".')
  }
  const entry = new Reader(raw as Record<string, unknown>)
  return { absolute: entry.number('absolute'), relative: entry.number('relative') }
}

export function runKnowledgeOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- concept graphs
    case 'concept.check': {
      // Under named fields. The check carries its own `ok` meaning "this graph is sound", and spreading it would
      // overwrite the `ok` that means "this call worked".
      const checked = checkGraph(graphFrom(read))
      return { ok: true, sound: checked.ok, problems: checked.problems, notes: checked.notes }
    }

    case 'concept.analyse':
      return { ok: true, ...analyse(graphFrom(read)) }

    case 'concept.cycle': {
      const found = findCycle(graphFrom(read), choice<RelationKind>(read, 'kind', RELATION_KINDS))
      return { ok: true, cycle: found, hasCycle: found !== null }
    }

    case 'concept.paths': {
      const found = pathsBetween(
        graphFrom(read),
        read.text('from', 80),
        read.text('to', 80),
        given(read, 'maxLength') ? read.number('maxLength') : KNOWLEDGE_LIMITS.pathDepth
      )
      return isConceptError(found) ? { ok: false, ...found } : { ok: true, paths: found }
    }

    case 'concept.neighbourhood':
      return settle(
        neighbourhood(
          graphFrom(read),
          read.text('centre', 80),
          given(read, 'steps') ? read.number('steps') : 2
        ),
        isConceptError
      )

    case 'concept.layout':
      return settle(
        layout(graphFrom(read), choice<LayoutKind>(read, 'kind', LAYOUT_KINDS), {
          spacing: given(read, 'spacing') ? read.number('spacing') : undefined
        }),
        isConceptError
      )

    case 'concept.from-outline':
      return settle(
        fromOutline(read.text('source', KNOWLEDGE_LIMITS.outlineLength), given(read, 'idPrefix') ? read.text('idPrefix', 20) : 'c'),
        isConceptError
      )

    case 'concept.from-statements':
      return settle(
        fromStatements(read.text('source', KNOWLEDGE_LIMITS.outlineLength), given(read, 'idPrefix') ? read.text('idPrefix', 20) : 's'),
        isConceptError
      )

    case 'concept.vocabulary':
      return {
        ok: true,
        conceptKinds: CONCEPT_KINDS,
        statuses: CONCEPT_STATUSES,
        provenances: PROVENANCES,
        relationKinds: RELATION_KINDS,
        relationStatuses: RELATION_STATUSES,
        layouts: LAYOUT_KINDS,
        provenanceNote:
          'Provenance is required on every concept and relation. It is not defaulted, because turning a model\'s suggestion into somebody\'s assertion is the one mistake this graph cannot recover from.'
      }

    // ---------------------------------------------------------------- experiments
    case 'experiment.check-variables': {
      // Named fields again: the check's `ok` means "these variables describe an experiment", not "the call worked".
      const checked = checkVariables(read.list('variables', KNOWLEDGE_LIMITS.variables).map(variableFrom))
      return { ok: true, sound: checked.ok, problems: checked.problems, notes: checked.notes }
    }

    case 'experiment.check-design': {
      const checked = checkDesign(experimentFrom(read))
      return { ok: true, sound: checked.ok, problems: checked.problems, notes: checked.notes, describe: checked.describe }
    }

    case 'experiment.hypothesis':
      return settle(
        hypothesis(
          read.text('id', 80),
          read.text('statement', 2000),
          read.text('predicts', 2000),
          read.text('refutedBy', 2000),
          read.text('statedAt', 40)
        ),
        isExperimentError
      )

    case 'experiment.record-outcome':
      return settle(
        recordOutcome(hypothesisFrom(objectAt(read, 'hypothesis')), choice(read, 'outcome', OUTCOMES)),
        isExperimentError
      )

    case 'experiment.revise-hypothesis': {
      return settle(
        reviseHypothesis(
          hypothesisFrom(objectAt(read, 'original')),
          read.text('id', 80),
          read.text('statement', 2000),
          read.text('predicts', 2000),
          read.text('refutedBy', 2000),
          read.text('statedAt', 40)
        ),
        isExperimentError
      )
    }

    case 'experiment.conclude': {
      // A conclusion is drawn about one hypothesis, from what was observed and from the two checks that say whether
      // the question could be asked at all. `predictionHeld` is null where the observation does not settle it, and
      // that is a third state rather than a false -- an inconclusive run is not a refutation.
      const one = hypothesisFrom(objectAt(read, 'hypothesis'))
      const experiment = experimentFrom(read)
      const design = checkDesign(experiment)
      const record = checkRecord(runFrom(read, 'run'))
      return {
        ok: true,
        ...concludeFrom(
          one,
          read.text('observed', 4000),
          given(read, 'predictionHeld') ? read.boolean('predictionHeld') : null,
          design,
          record,
          given(read, 'repeats') ? read.number('repeats') : 1
        ),
        designSound: design.ok,
        recordComplete: record.complete
      }
    }

    case 'run.check-record':
      return { ok: true, ...checkRecord(runFrom(read, 'run')) }

    case 'run.compare':
      return { ok: true, ...compareRuns(runFrom(read, 'original'), runFrom(read, 'repeated'), toleranceFrom(read)) }

    case 'run.repeats':
      return settle(
        summariseRepeats(
          read.text('variableId', 80),
          read.list('measurements', KNOWLEDGE_LIMITS.measurements).map(measurementFrom)
        ),
        isExperimentError
      )

    case 'experiment.vocabulary':
      return {
        ok: true,
        roles: ROLES,
        runStatuses: RUN_STATUSES,
        determinisms: DETERMINISMS,
        hypothesisStates: HYPOTHESIS_STATES,
        outcomes: OUTCOMES,
        verdictNote:
          'Reproduction is a verdict with five values, not a yes or no. "Not reproducible" and "inputs differ" mean the question could not be asked, which is different from the answer being no.'
      }

    // ---------------------------------------------------------------- provenance
    case 'knowledge.assumptions':
      return { ok: true, concepts: CONCEPT_ASSUMPTIONS, experiments: EXPERIMENT_ASSUMPTIONS }

    default:
      throw new BadInput(`"${operation}" is not a knowledge operation.`)
  }
}
