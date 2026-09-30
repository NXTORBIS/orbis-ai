/**
 * Driving an open Page: what it exposes, what it refuses, and what a model is told about it.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ACTIONS,
  ACTION_ASSUMPTIONS,
  ACTION_NAMES,
  NOISY_EVENTS,
  QUIET_EVENTS,
  carriesPageData,
  checkAction,
  contextForModel,
  describeAction,
  filterEvents,
  isActionError,
  isReadOnly,
  mayRetry,
  nothingSelected,
  resolveThis,
  supports,
  surfaceOf,
  waitingFor,
  type PageContext,
  type PageEvent,
  type Selection
} from './actions.ts'
import type { PageSpec } from './spec.ts'

const ok = <T>(value: T, label: string): Exclude<T, { error: unknown }> => {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    assert.fail(`${label} was refused: ${String((value as { message?: unknown }).message)}`)
  }
  return value as Exclude<T, { error: unknown }>
}

/** A Page with an input, a button step, a table and a single value. The common shape. */
const fullSpec: PageSpec = {
  specVersion: 1,
  title: 'Rainfall runoff',
  purpose: 'Work out peak flow from rainfall over a catchment.',
  inputs: [
    { name: 'rainfall', kind: 'quantity', label: 'Rainfall', unit: 'mm' },
    { name: 'area', kind: 'quantity', label: 'Catchment area', unit: 'km2' }
  ],
  steps: [
    { name: 'runoff', operation: 'water.runoff', arguments: {}, when: 'button' },
    { name: 'peak', operation: 'water.peak-flow', arguments: {}, when: 'change' }
  ],
  outputs: [
    { name: 'summary', label: 'Summary', display: 'value', step: 'peak' },
    { name: 'results', label: 'Results', display: 'table', step: 'runoff' }
  ],
  sections: [{ title: 'Inputs', members: ['rainfall', 'area'] }],
  notes: ['Assumes a single storm and no snowmelt.'],
  keywords: ['rainfall', 'runoff']
}

/** A Page with nothing but a computed value: no inputs, no button, no table. */
const bareSpec: PageSpec = {
  specVersion: 1,
  title: 'Gravity',
  purpose: 'State the standard acceleration due to gravity.',
  inputs: [],
  steps: [{ name: 'g', operation: 'constants.get', arguments: {}, when: 'change' }],
  outputs: [{ name: 'value', label: 'g', display: 'value', step: 'g' }],
  sections: [],
  notes: [],
  keywords: []
}

const contextFor = (
  spec: PageSpec,
  parts: { selection?: Selection; running?: string[]; failing?: boolean } = {}
): PageContext => ({
  pageId: 'page_aaaaaaaaaaaa',
  title: spec.title,
  surface: surfaceOf(spec),
  selection: parts.selection ?? nothingSelected,
  running: parts.running ?? [],
  failing: parts.failing ?? false
})

// ---------------------------------------------------------------- the action table

describe('the action table', () => {
  it('names every action by family and verb', () => {
    for (const name of ACTION_NAMES) {
      assert.match(name, /^[a-z]+\.[a-z-]+$/, name)
      assert.equal(ACTIONS[name].name, name, `${name} disagrees with its key`)
    }
  })

  it('never asks for confirmation on something that only reads', () => {
    for (const name of ACTION_NAMES) {
      if (ACTIONS[name].effect !== 'read') continue
      assert.equal(ACTIONS[name].confirm, false, `${name} reads and still asks`)
      assert.equal(ACTIONS[name].retry, 'idempotent', `${name} reads and is not safe to retry`)
      assert.ok(isReadOnly(name))
    }
  })

  it('asks before anything that destroys or leaves the Page', () => {
    for (const name of ACTION_NAMES) {
      const definition = ACTIONS[name]
      if (definition.effect !== 'destroy' && definition.effect !== 'emit') continue
      assert.equal(definition.confirm, true, `${name} ${definition.effect}s without asking`)
    }
  })

  it('never marks something repeatable as automatically retryable', () => {
    for (const name of ACTION_NAMES) {
      if (ACTIONS[name].retry === 'repeatable') assert.equal(mayRetry(ACTIONS[name]), false, name)
    }
  })

  it('gives every action a summary someone could read', () => {
    for (const name of ACTION_NAMES) {
      assert.ok(ACTIONS[name].summary.length > 15, name)
      assert.match(ACTIONS[name].summary, /\.$/, `${name} summary is not a sentence`)
    }
  })

  it('gives every choice argument its options', () => {
    for (const name of ACTION_NAMES) {
      for (const [argument, shape] of Object.entries(ACTIONS[name].arguments)) {
        if (shape.kind !== 'choice') continue
        assert.ok((shape.options?.length ?? 0) > 0, `${name}.${argument} is a choice with no options`)
      }
    }
  })
})

// ---------------------------------------------------------------- surfaces

describe('what a Page exposes', () => {
  it('offers table actions only where there is a table', () => {
    assert.ok(surfaceOf(fullSpec).actions.includes('output.sort'))
    assert.equal(surfaceOf(bareSpec).actions.includes('output.sort'), false)
  })

  it('offers a run button only where a step waits to be pressed', () => {
    assert.ok(surfaceOf(fullSpec).actions.includes('step.run'))
    assert.equal(surfaceOf(bareSpec).actions.includes('step.run'), false)
  })

  it('offers input actions only where there are inputs', () => {
    assert.ok(surfaceOf(fullSpec).actions.includes('input.set'))
    assert.equal(surfaceOf(bareSpec).actions.includes('input.set'), false)
  })

  it('offers reset only where there is something to reset', () => {
    assert.equal(surfaceOf(bareSpec).actions.includes('page.reset'), false)
  })

  it('always lets a Page describe itself', () => {
    for (const spec of [fullSpec, bareSpec]) {
      assert.ok(surfaceOf(spec).actions.includes('page.describe'), spec.title)
      assert.ok(surfaceOf(spec).actions.includes('page.state'), spec.title)
    }
  })

  it('lists only real tables as tables', () => {
    assert.deepEqual(surfaceOf(fullSpec).tables, ['results'])
  })

  it('separates steps that wait from steps that recompute', () => {
    assert.deepEqual(surfaceOf(fullSpec).manualSteps, ['runoff'])
  })

  it('exposes nothing that is not in the action table', () => {
    for (const spec of [fullSpec, bareSpec]) {
      for (const name of surfaceOf(spec).actions) {
        assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, name), name)
      }
    }
  })
})

describe('answering whether a Page can do something', () => {
  it('says yes with the summary', () => {
    const answer = supports(fullSpec, 'output.sort')
    assert.equal(answer.supported, true)
    assert.match(answer.why, /Sort a table/)
  })

  it('says no and why for a Page with no table', () => {
    const answer = supports(bareSpec, 'output.sort')
    assert.equal(answer.supported, false)
    assert.match(answer.why, /no tables/)
  })

  it('says no for a Page whose steps all recompute', () => {
    const answer = supports(bareSpec, 'step.run')
    assert.equal(answer.supported, false)
    assert.match(answer.why, /recompute/)
  })

  it('says no for an action that does not exist rather than inventing one', () => {
    const answer = supports(fullSpec, 'output.animate')
    assert.equal(answer.supported, false)
    assert.match(answer.why, /no action called/)
  })
})

// ---------------------------------------------------------------- context

describe('resolving "this"', () => {
  it('prefers the selected cell', () => {
    const resolved = ok(
      resolveThis(contextFor(fullSpec, { selection: { kind: 'cell', owner: 'results', column: 'flow', row: 3 } })),
      'cell'
    )
    assert.equal(resolved.target, 'results')
    assert.equal(resolved.kind, 'cell')
    assert.match(resolved.note, /row 4/)
  })

  it('reports a row by its human number, not its index', () => {
    const resolved = ok(
      resolveThis(contextFor(fullSpec, { selection: { kind: 'row', owner: 'results', row: 0 } })),
      'row'
    )
    assert.match(resolved.note, /row 1/)
  })

  it('takes the only result when nothing is selected', () => {
    const resolved = ok(resolveThis(contextFor(bareSpec)), 'single output')
    assert.equal(resolved.target, 'value')
    assert.match(resolved.note, /one result/)
  })

  it('refuses to guess between several results', () => {
    const result = resolveThis(contextFor(fullSpec))
    assert.ok(isActionError(result))
    assert.equal(result.error, 'ambiguous')
    assert.match(result.remedy as string, /summary/)
  })
})

// ---------------------------------------------------------------- checking a request

describe('checking a request', () => {
  it('accepts a well-formed sort', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), {
        action: 'output.sort',
        target: 'results',
        arguments: { by: 'flow', direction: 'descending' }
      }),
      'sort'
    )
    assert.equal(checked.arguments.by, 'flow')
    assert.equal(checked.arguments.direction, 'descending')
    assert.equal(checked.needsConfirmation, false)
    assert.match(checked.describes, /Sort results by flow, descending/)
  })

  it('fills in an optional choice from the definition rather than guessing', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), {
        action: 'output.sort',
        target: 'results',
        arguments: { by: 'flow' }
      }),
      'default direction'
    )
    assert.equal(checked.arguments.direction, 'ascending')
  })

  it('refuses an action that does not exist and says what does', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.animate',
      target: 'results',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.equal(result.error, 'unknown-action')
    assert.match(result.remedy as string, /output.sort/)
  })

  it('refuses an action the Page cannot perform', () => {
    const result = checkAction(bareSpec, contextFor(bareSpec), {
      action: 'output.sort',
      target: 'value',
      arguments: { by: 'x' }
    })
    assert.ok(isActionError(result))
    assert.equal(result.error, 'not-permitted')
  })

  it('refuses sorting something that is not a table', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.sort',
      target: 'summary',
      arguments: { by: 'flow' }
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /not a table/)
    assert.match(result.remedy as string, /results/)
  })

  it('refuses a target the Page does not have and lists what it has', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.read',
      target: 'nonsense',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.equal(result.error, 'no-target')
    assert.match(result.remedy as string, /summary/)
  })

  it('refuses a missing target rather than picking one', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.read',
      target: null,
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.equal(result.error, 'no-target')
  })

  it('refuses a target on a Page-wide action', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'page.reset',
      target: 'rainfall',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /whole Page/)
  })

  it('refuses a required argument that is missing', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.sort',
      target: 'results',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /needs "by"/)
  })

  it('refuses an argument it does not take and lists the ones it does', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.sort',
      target: 'results',
      arguments: { by: 'flow', colour: 'red' }
    })
    assert.ok(isActionError(result))
    assert.match(result.remedy as string, /by, direction/)
  })

  it('refuses a choice outside its options', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.sort',
      target: 'results',
      arguments: { by: 'flow', direction: 'sideways' }
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /ascending, descending/)
  })

  it('refuses an export format it does not produce', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'output.export',
      target: 'results',
      arguments: { format: 'xlsx' }
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /csv, json, markdown/)
  })

  it('refuses running a step that recomputes on its own', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'step.run',
      target: 'peak',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /nothing to run/)
    assert.match(result.remedy as string, /runoff/)
  })

  it('refuses running a step that is already running', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec, { running: ['runoff'] }), {
      action: 'step.run',
      target: 'runoff',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.equal(result.error, 'not-ready')
  })

  it('refuses cancelling a step that is not running', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'step.cancel',
      target: 'runoff',
      arguments: {}
    })
    assert.ok(isActionError(result))
    assert.match(result.message, /nothing to cancel/)
  })

  it('allows cancelling a step that is running', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec, { running: ['runoff'] }), {
        action: 'step.cancel',
        target: 'runoff',
        arguments: {}
      }),
      'cancel'
    )
    assert.match(checked.describes, /Stop runoff/)
  })

  it('marks an export as needing confirmation', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), {
        action: 'output.export',
        target: 'results',
        arguments: { format: 'csv' }
      }),
      'export'
    )
    assert.equal(checked.needsConfirmation, true)
    assert.match(checked.describes, /csv file/)
  })

  it('warns in plain words that a reset loses typed-in work', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), { action: 'page.reset', target: null, arguments: {} }),
      'reset'
    )
    assert.equal(checked.needsConfirmation, true)
    assert.match(checked.describes, /will be lost/)
  })

  it('coerces a number sent as text and refuses one that is not a number', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), {
        action: 'input.set',
        target: 'rainfall',
        arguments: { value: 42 }
      }),
      'number as text'
    )
    assert.equal(checked.arguments.value, '42')
    const bad = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'input.set',
      target: 'rainfall',
      arguments: { value: { nested: true } }
    })
    assert.ok(isActionError(bad))
  })

  it('refuses an argument longer than the cap', () => {
    const result = checkAction(fullSpec, contextFor(fullSpec), {
      action: 'input.set',
      target: 'rainfall',
      arguments: { value: 'x'.repeat(5000) }
    })
    assert.ok(isActionError(result))
  })

  it('never returns a request naming an action outside the table', () => {
    const checked = ok(
      checkAction(fullSpec, contextFor(fullSpec), {
        action: 'output.read',
        target: 'summary',
        arguments: {}
      }),
      'read'
    )
    assert.ok(Object.prototype.hasOwnProperty.call(ACTIONS, checked.request.action))
  })
})

describe('describing an action', () => {
  it('describes each one in words about the Page, not the code', () => {
    const cases: [string, string | null, Record<string, unknown>, RegExp][] = [
      ['input.set', 'rainfall', { value: '30' }, /Set rainfall to 30/],
      ['output.filter', 'results', { column: 'flow', comparison: 'above', value: '5' }, /flow above 5/],
      ['output.to-note', 'results', {}, /into Notes/],
      ['step.run', 'runoff', {}, /Run runoff/]
    ]
    for (const [name, target, args, pattern] of cases) {
      assert.match(describeAction(ACTIONS[name], target, args), pattern, name)
    }
  })

  it('falls back to the summary for an action with no special wording', () => {
    assert.match(describeAction(ACTIONS['output.read'], 'summary', {}), /summary/)
  })
})

// ---------------------------------------------------------------- events

describe('events', () => {
  const events: PageEvent[] = [
    { kind: 'input.changed', pageId: 'page_a', subject: 'rainfall', detail: {} },
    { kind: 'step.started', pageId: 'page_a', subject: 'runoff', detail: {} },
    { kind: 'step.finished', pageId: 'page_a', subject: 'runoff', detail: { ms: 12 } },
    { kind: 'step.finished', pageId: 'page_b', subject: 'runoff', detail: { ms: 9 } },
    { kind: 'selection.changed', pageId: 'page_a', subject: 'results', detail: {} }
  ]

  it('keeps keystrokes out of the quiet set', () => {
    for (const noisy of NOISY_EVENTS) {
      assert.equal(QUIET_EVENTS.includes(noisy), false, `${noisy} is in the quiet set`)
    }
  })

  it('filters by kind', () => {
    const kept = filterEvents(events, { kinds: ['step.finished'], subjects: [], pageId: '' })
    assert.equal(kept.length, 2)
  })

  it('filters by Page, so another Page\'s result cannot arrive', () => {
    const kept = filterEvents(events, { kinds: ['step.finished'], subjects: [], pageId: 'page_a' })
    assert.equal(kept.length, 1)
    assert.equal(kept[0].pageId, 'page_a')
  })

  it('filters by subject', () => {
    const kept = filterEvents(events, {
      kinds: ['input.changed', 'selection.changed'],
      subjects: ['rainfall'],
      pageId: 'page_a'
    })
    assert.equal(kept.length, 1)
    assert.equal(kept[0].subject, 'rainfall')
  })

  it('builds a filter for a workflow waiting on one step', () => {
    const filter = waitingFor('page_a', 'runoff')
    const kept = filterEvents(events, filter)
    assert.equal(kept.length, 1)
    assert.equal(kept[0].kind, 'step.finished')
    // And it would also catch a failure, so a workflow cannot wait forever on a step that broke.
    assert.ok(filter.kinds.includes('step.failed'))
  })

  it('drops an event about a step on the wrong Page even with the right name', () => {
    const kept = filterEvents(events, waitingFor('page_b', 'runoff'))
    assert.equal(kept.length, 1)
    assert.equal(kept[0].pageId, 'page_b')
  })
})

// ---------------------------------------------------------------- what a model is told

describe('the context sent to a model', () => {
  it('carries the Page shape and its stated limits', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec))
    assert.equal(sent.title, 'Rainfall runoff')
    assert.equal(sent.inputs.length, 2)
    assert.equal(sent.outputs.length, 2)
    assert.deepEqual([...sent.limits], ['Assumes a single storm and no snowmelt.'])
  })

  it('says which steps wait to be run', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec))
    assert.equal(sent.steps.find((one) => one.name === 'runoff')?.waits, true)
    assert.equal(sent.steps.find((one) => one.name === 'peak')?.waits, false)
  })

  it('lists only the actions this Page has', () => {
    const sent = contextForModel(bareSpec, contextFor(bareSpec))
    assert.equal(
      sent.actions.some((one) => one.name === 'output.sort'),
      false
    )
  })

  it('flags which actions would need confirmation', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec))
    assert.equal(sent.actions.find((one) => one.name === 'output.export')?.confirm, true)
    assert.equal(sent.actions.find((one) => one.name === 'output.read')?.confirm, false)
  })

  it('reports the selection in words', () => {
    const sent = contextForModel(
      fullSpec,
      contextFor(fullSpec, { selection: { kind: 'column', owner: 'results', column: 'flow' } })
    )
    assert.match(sent.selection, /flow column/)
  })

  it('says nothing is selected rather than failing', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec))
    assert.equal(sent.selection, 'nothing is selected')
  })

  it('carries no Page data', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec))
    assert.equal(carriesPageData(sent), false)
    // Nothing a person typed can be in there, because no value is ever read into it.
    assert.doesNotMatch(JSON.stringify(sent), /\d{3,}/)
  })

  it('names the running steps, so an answer can say the Page is busy', () => {
    const sent = contextForModel(fullSpec, contextFor(fullSpec, { running: ['runoff'] }))
    assert.deepEqual([...sent.running], ['runoff'])
  })
})

describe('provenance', () => {
  it('states its assumptions', () => {
    assert.ok(ACTION_ASSUMPTIONS.length >= 10)
    assert.ok(ACTION_ASSUMPTIONS.some((one) => /Nothing here evaluates anything/.test(one)))
    assert.ok(ACTION_ASSUMPTIONS.some((one) => /set of actions is closed/.test(one)))
    assert.ok(ACTION_ASSUMPTIONS.some((one) => /not its values/.test(one)))
  })

  it('has no way to evaluate anything', () => {
    // The claim in the header, kept true by a test rather than by discipline.
    const source = ACTION_ASSUMPTIONS.join(' ')
    assert.ok(source.includes('no path by which its output becomes code'))
  })
})
