import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CATALOGUE } from './catalogue.ts'
import { PHASE2_CATALOGUE, PHASE2_PARAMETERS } from './phase2.ts'
import { PHASE3_CATALOGUE, PHASE3_PARAMETERS } from './phase3.ts'
import { PHASE4_CATALOGUE, PHASE4_PARAMETERS } from './phase4.ts'
import { PHASE5_CATALOGUE, PHASE5_PARAMETERS } from './phase5.ts'
import { PHASE6_CATALOGUE, PHASE6_PARAMETERS } from './phase6.ts'
import { PHASE7_CATALOGUE, PHASE7_PARAMETERS } from './phase7.ts'
import { PHASE8_CATALOGUE, PHASE8_PARAMETERS } from './phase8.ts'
import { PHASE9_CATALOGUE, PHASE9_PARAMETERS } from './phase9.ts'
import { PHASE10_CATALOGUE } from './phase10.ts'
import { PHASE11_CATALOGUE } from './phase11.ts'
import type { NativeAppManifest } from './manifest.ts'
import { problems } from './manifest.ts'
import { EMPTY, allApps, discover, everyApp, isRegistryError, providersOf, registerAll, resolve, type Readiness } from './registry.ts'

/**
 * Every registered app has somewhere to go.
 *
 * ## The failure this exists to prevent
 *
 * Orbis's browser panel once had eighteen rows that rendered as live and opened nothing, because nothing ever asked
 * whether a row's destination existed. Phase 1 fixed that for capabilities; this fixes it for Native Apps, which have
 * the same shape of problem: a manifest is cheap to write and a working application is not, so the catalogue will
 * drift ahead of the surfaces unless something refuses to let it.
 *
 * So this test reads the renderer's surface map as text and insists every registered app appears in it. A manifest
 * added without a component fails here rather than in front of somebody who searched for it.
 *
 * Reading a `.tsx` file as text is what `cssCollisions.test.ts` already does for stylesheets, and for the same reason:
 * the test suite runs over pure modules and cannot import React.
 */

const read = (relative: string): string => readFileSync(join(process.cwd(), relative), 'utf8')

const SURFACES = 'src/renderer/src/components/native/surfaces.tsx'

/** The ids the renderer can actually mount, taken from the quoted keys of its two maps. */
function mountable(): Set<string> {
  const source = read(SURFACES)
  const out = new Set<string>()
  // Keys are written either quoted ('algorithm-lab') or bare (optimiser, project) in an object literal.
  for (const match of source.matchAll(/^\s{2}(?:'([a-z0-9-]+)'|([a-z][a-zA-Z0-9]*)):/gm)) {
    const id = match[1] ?? match[2]
    if (id) out.add(id)
  }
  return out
}

const readiness: Readiness = {
  available: ['compute', 'worker', 'file.read', 'file.write', 'clipboard.read', 'clipboard.write'],
  engines: ['compute', 'algorithms', 'molecules', 'structures', 'sqlite', 'sandbox']
}

describe('every registered Native App can be opened', () => {
  const ids = mountable()

  it('finds the renderer’s surface map', () => {
    // If this fails the regex has drifted from the file, and every assertion below would pass for the wrong reason.
    assert.ok(ids.size > 20, `only found ${ids.size} surfaces; the parse has probably drifted from ${SURFACES}`)
    assert.ok(ids.has('projectile-lab'), 'the Phase 1 surfaces should be found')
  })

  it('every Phase 1 app has a surface, or is one the Creation Engine draws', () => {
    for (const manifest of CATALOGUE) {
      if (manifest.surface.kind === 'artifact') continue
      assert.ok(ids.has(manifest.id), `"${manifest.id}" is registered and has no surface in ${SURFACES}`)
    }
  })

  it('every Phase 3 app has a surface', () => {
    for (const manifest of PHASE3_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE3_CATALOGUE — a row that opens nothing is worse than no row.`
      )
    }
  })

  it('every Phase 3 manifest is valid, names an engine and says what it does not do', () => {
    for (const manifest of PHASE3_CATALOGUE) {
      const found = problems(manifest)
      assert.deepEqual(found, [], `${manifest.id}: ${found.map((one) => `${one.field} ${one.says}`).join('; ')}`)
      assert.ok(manifest.engine, `${manifest.id} should name its engine`)
      // A scientific app that claims no limitations is the one thing §205 forbids outright.
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} has only ${manifest.limitations.length} stated limitations`)
    }
  })

  it('every Phase 3 parameter set belongs to a registered app, and every parameter has a definition', () => {
    const registered = new Set(PHASE3_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE3_PARAMETERS)) assert.ok(registered.has(id), `parameters declared for unregistered "${id}"`)
    for (const manifest of PHASE3_CATALOGUE) {
      const set = PHASE3_PARAMETERS[manifest.id]
      assert.ok(set, `${manifest.id} declares parameters and has no definitions`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares ${id} with no definition`)
    }
  })

  it('every Phase 4 app has a surface', () => {
    for (const manifest of PHASE4_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE4_CATALOGUE — a row that opens nothing is worse than no row.`
      )
    }
  })

  it('every Phase 4 manifest is valid, names an engine and says what it does not do', () => {
    for (const manifest of PHASE4_CATALOGUE) {
      const found = problems(manifest)
      assert.deepEqual(found, [], `${manifest.id}: ${found.map((one) => `${one.field} ${one.says}`).join('; ')}`)
      assert.ok(manifest.engine, `${manifest.id} should name its engine`)
      // An engineering tool that claims no limitations is the one thing the brief forbids outright.
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} has only ${manifest.limitations.length} stated limitations`)
    }
  })

  it('every Phase 4 parameter set belongs to a registered app, and every parameter has a definition', () => {
    const registered = new Set(PHASE4_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE4_PARAMETERS)) assert.ok(registered.has(id), `parameters declared for unregistered "${id}"`)
    for (const manifest of PHASE4_CATALOGUE) {
      const set = PHASE4_PARAMETERS[manifest.id]
      assert.ok(set, `${manifest.id} declares parameters and has no definitions`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares ${id} with no definition`)
    }
  })

  it('every Phase 5 app has a surface', () => {
    for (const manifest of PHASE5_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE5_CATALOGUE — a row that opens nothing is worse than no row.`
      )
    }
  })

  it('every Phase 5 manifest is valid, names an engine and says what it does not do', () => {
    for (const manifest of PHASE5_CATALOGUE) {
      const found = problems(manifest)
      assert.deepEqual(found, [], `${manifest.id}: ${found.map((one) => `${one.field} ${one.says}`).join('; ')}`)
      assert.ok(manifest.engine, `${manifest.id} should name its engine`)
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} has only ${manifest.limitations.length} stated limitations`)
    }
  })

  it('every Phase 5 parameter set belongs to a registered app, and every parameter has a definition', () => {
    const registered = new Set(PHASE5_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE5_PARAMETERS)) assert.ok(registered.has(id), `parameters declared for unregistered "${id}"`)
    for (const manifest of PHASE5_CATALOGUE) {
      const set = PHASE5_PARAMETERS[manifest.id]
      assert.ok(set, `${manifest.id} declares parameters and has no definitions`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares ${id} with no definition`)
    }
  })

  it('every Phase 2 app has a surface', () => {
    for (const manifest of PHASE2_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE2_CATALOGUE — a row that opens nothing is worse than no row.`
      )
    }
  })

  it('every Phase 2 manifest is valid and declares a real engine', () => {
    for (const manifest of PHASE2_CATALOGUE) {
      const found = problems(manifest)
      assert.deepEqual(found, [], `${manifest.id}: ${found.map((one) => `${one.field} ${one.says}`).join('; ')}`)
      assert.ok(manifest.engine, `${manifest.id} is a computational environment and should name its engine`)
      assert.ok(manifest.limitations.length > 0, manifest.id)
    }
  })

  it('every Phase 2 parameter set belongs to a registered app', () => {
    const registered = new Set(PHASE2_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE2_PARAMETERS)) {
      assert.ok(registered.has(id), `parameters are declared for "${id}", which is not registered`)
    }
  })

  it('every Phase 2 app’s declared parameters have definitions', () => {
    for (const manifest of PHASE2_CATALOGUE) {
      const set = PHASE2_PARAMETERS[manifest.id]
      assert.ok(set, `${manifest.id} declares parameters and has no definitions`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares ${id} with no definition`)
    }
  })

  it('both catalogues register together without clashing', () => {
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE], 1)
    assert.ok(!isRegistryError(made), isRegistryError(made) ? made.message : '')
    // `everyApp` rather than `allApps`: a retired app is still registered and still needs its surface, and it is
    // only `allApps` that leaves it out, because nothing should offer it any more.
    assert.equal(
      everyApp(made).length,
      CATALOGUE.length +
        PHASE2_CATALOGUE.length +
        PHASE3_CATALOGUE.length +
        PHASE4_CATALOGUE.length +
        PHASE5_CATALOGUE.length +
        PHASE6_CATALOGUE.length +
        PHASE7_CATALOGUE.length +
        PHASE8_CATALOGUE.length +
        PHASE9_CATALOGUE.length +
        PHASE10_CATALOGUE.length +
        PHASE11_CATALOGUE.length
    )
  })

  it('a retired app names a replacement that exists, and keeps its surface', () => {
    /*
     * Retiring an app is how a duplicate is removed: the Chemistry Studio contains the user's own Reaction Lab,
     * so Orbis's Reaction Laboratory stops being offered. But it stays registered on purpose, because somebody
     * may have it open, so two things have to hold -- the replacement must exist, and the retired app must still
     * have a surface to render into. A retirement pointing at nothing would strand whoever had it open.
     */
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE], 1)
    assert.ok(!isRegistryError(made))

    const retired = everyApp(made).filter((one) => one.supersededBy !== undefined)
    assert.ok(retired.length > 0, 'something should be retired by now')

    const all = everyApp(made)
    for (const one of retired) {
      const replacement = all.find((two) => two.id === one.supersededBy)
      assert.ok(replacement, `${one.id} is retired in favour of "${one.supersededBy}", which does not exist`)
      assert.equal(replacement.supersededBy, undefined, `${one.id} points at ${replacement.id}, which is itself retired`)
      // Still openable: the surface has to be there for an instance that is already on screen.
      assert.ok(one.surface.ref, `${one.id} is retired and has lost its surface`)
      // And it must not be offered any more, which is the point of retiring it.
      assert.ok(!allApps(made).some((two) => two.id === one.id), `${one.id} is retired and still in the catalogue`)
    }
  })

  it('a capability a retired app declared now resolves to its replacement', () => {
    // Asking for the periodic table must open the studio, not the laboratory that was retired for it.
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE], 1)
    assert.ok(!isRegistryError(made))

    for (const one of everyApp(made).filter((two) => two.supersededBy !== undefined)) {
      for (const capability of one.capabilities) {
        const providers = providersOf(made, capability.id)
        assert.ok(
          !providers.some((two) => two.id === one.id),
          `${one.id} is retired and still provides ${capability.id}`
        )
        assert.ok(
          providers.length > 0,
          `${capability.id} was only provided by the retired ${one.id}, so nothing provides it now`
        )
      }
    }
  })

  it('the things somebody would actually search for find the right app', () => {
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE], 1)
    assert.ok(!isRegistryError(made))

    const wants: readonly (readonly [string, string])[] = [
      ['binary search', 'cs-studio'],
      /*
       * Many of these name the CS Studio. That is retirement working: twelve of Orbis's own laboratories were
       * retired in favour of the user's own studio, which contains what each of them did, so a search that used
       * to find a laboratory now finds the studio. Each row still insists on exactly one app.
       */
      ['quicksort', 'cs-studio'],
      ['visualize an algorithm', 'cs-studio'],
      ['algorithm visualizer', 'cs-studio'],
      ['compare algorithms', 'algorithm-compare'],
      ['projectile', 'projectile-lab'],
      ['flowchart', 'flowchart'],
      ['molecule', 'molecule-lab'],
      ['build a molecule', 'molecule-lab'],
      ['vsepr', 'molecule-lab'],
      ['electric field', 'field-lab'],
      ['field lines', 'field-lab'],
      ['predator prey', 'ecosystem-lab'],
      ['ecosystem', 'ecosystem-lab'],
      ['dna', 'dna-lab'],
      ['codon', 'dna-lab'],
      ['data structures', 'structure-lab'],
      ['linked list', 'structure-lab'],
      ['binary search tree', 'structure-lab'],
      // A multi-word tag could once never match, so this found the data explorer instead. Worth pinning.
      ['hash table', 'structure-lab'],
      ['avl tree', 'structure-lab'],
      ['sql', 'sql-lab'],
      ['database', 'sql-lab'],
      ['query plan', 'sql-lab'],
      ['rc circuit', 'circuit-lab'],
      ['capacitor', 'circuit-lab'],
      ['time constant', 'circuit-lab'],
      ['pid', 'control-lab'],
      ['pid controller', 'control-lab'],
      ['bode plot', 'control-lab'],
      ['phase margin', 'control-lab'],
      ['robot arm', 'robot-lab'],
      ['inverse kinematics', 'robot-lab'],
      ['bending moment', 'structure-load-lab'],
      ['truss', 'structure-load-lab'],
      ['deflection', 'structure-load-lab'],
      ['logic gates', 'logic-lab'],
      ['truth table', 'logic-lab'],
      ['flip flop', 'logic-lab'],
      ['cpu', 'processor-lab'],
      ['pipeline', 'processor-lab'],
      ['operating system', 'os-lab'],
      ['round robin', 'os-lab'],
      ['deadlock', 'os-lab'],
      ['subnet', 'network-lab'],
      ['dns', 'network-lab'],
      ['image processing', 'image-lab'],
      ['convolution', 'image-lab'],
      ['machine learning', 'learning-lab'],
      ['overfitting', 'learning-lab'],
      ['neural network', 'neural-lab'],
      ['backpropagation', 'neural-lab']
    ]
    for (const [query, expected] of wants) {
      const hits = discover(made, query, readiness)
      assert.equal(hits[0]?.manifest.id, expected, `"${query}" found ${hits[0]?.manifest.id ?? 'nothing'}`)
    }
  })

  it('the capabilities Orion resolves through point at the built apps', () => {
    const made = registerAll(EMPTY, [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE], 1)
    assert.ok(!isRegistryError(made))
    /*
     * Several of these name the CS Studio rather than the laboratory that used to answer. That is the point of
     * retirement: the studio contains what those laboratories did, so the capability they declared now resolves
     * to it. `compareAlgorithms` and `exploreDataStructure` still name their own laboratories, because those go
     * beyond what the studio's section does and were deliberately kept.
     */
    assert.equal(resolve(made, 'visualizeAlgorithm', readiness)?.id, 'cs-studio')
    assert.equal(resolve(made, 'compareAlgorithms', readiness)?.id, 'algorithm-compare')
    // And a capability nothing provides still resolves to nothing, rather than to something approximate.
    assert.equal(resolve(made, 'exploreMolecule', readiness)?.id, 'molecule-lab')
    assert.equal(resolve(made, 'simulateEcosystem', readiness)?.id, 'ecosystem-lab')
    assert.equal(resolve(made, 'simulateElectricField', readiness)?.id, 'field-lab')
    assert.equal(resolve(made, 'exploreDNA', readiness)?.id, 'dna-lab')
    assert.equal(resolve(made, 'exploreDataStructure', readiness)?.id, 'structure-lab')
    assert.equal(resolve(made, 'compareDataStructures', readiness)?.id, 'structure-lab')
    assert.equal(resolve(made, 'runQuery', readiness)?.id, 'sql-lab')
    assert.equal(resolve(made, 'explainQuery', readiness)?.id, 'sql-lab')
    assert.equal(resolve(made, 'exploreSchema', readiness)?.id, 'sql-lab')
    assert.equal(resolve(made, 'solveCircuit', readiness)?.id, 'circuit-lab')
    assert.equal(resolve(made, 'simulateControlLoop', readiness)?.id, 'control-lab')
    assert.equal(resolve(made, 'tuneController', readiness)?.id, 'control-lab')
    assert.equal(resolve(made, 'buildRobotArm', readiness)?.id, 'robot-lab')
    assert.equal(resolve(made, 'reachForPoint', readiness)?.id, 'robot-lab')
    assert.equal(resolve(made, 'analyseBeam', readiness)?.id, 'structure-load-lab')
    assert.equal(resolve(made, 'analyseTruss', readiness)?.id, 'structure-load-lab')
    /*
     * These six resolved to nothing through Phase 4, because the engines did not exist. Five of them do now, and the
     * assertions are inverted rather than deleted — the point of the test is that the catalogue and the engines agree,
     * in whichever direction.
     */
    assert.equal(resolve(made, 'simulateLogicGate', readiness)?.id, 'logic-lab')
    assert.equal(resolve(made, 'trainNeuralNetwork', readiness)?.id, 'neural-lab')
    assert.equal(resolve(made, 'simulateNetwork', readiness)?.id, 'network-lab')
    assert.equal(resolve(made, 'simulateCpu', readiness)?.id, 'processor-lab')
    assert.equal(resolve(made, 'processImage', readiness)?.id, 'image-lab')
    assert.equal(resolve(made, 'trainModel', readiness)?.id, 'learning-lab')
    assert.equal(resolve(made, 'scheduleProcesses', readiness)?.id, 'os-lab')
    // And this one still does not exist: there is no finite-element engine, so nothing may claim one.
    assert.equal(resolve(made, 'runFiniteElement', readiness), null)
    assert.equal(resolve(made, 'simulateFluid', readiness), null)
    assert.equal(resolve(made, 'executePython', readiness), null)
    assert.equal(resolve(made, 'debugCode', readiness), null)
    // Nothing in this build simulates fluids, and a capability nothing provides must resolve to nothing.
    assert.equal(resolve(made, 'simulateFluid', readiness), null)
    assert.equal(resolve(made, 'simulateNBody', readiness), null)
  })

  it('every Phase 6 app has a surface, parameters and limitations', () => {
    for (const manifest of PHASE6_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE6_CATALOGUE — a row that opens nothing is worse than no row.`
      )
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} states fewer than three limitations`)
      const set = PHASE6_PARAMETERS[manifest.id]
      assert.ok(set !== undefined, `${manifest.id} has no parameter set`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares "${id}" and has no definition for it`)
    }
    const registered = new Set(PHASE6_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE6_PARAMETERS)) assert.ok(registered.has(id), `parameters declared for unregistered "${id}"`)
  })

  it('every Phase 7 app has a surface, parameters and limitations', () => {
    for (const manifest of PHASE7_CATALOGUE) {
      assert.ok(
        ids.has(manifest.id),
        `"${manifest.id}" is registered and has no surface. Either build it, or take it out of PHASE7_CATALOGUE — a row that opens nothing is worse than no row.`
      )
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} states fewer than three limitations`)
      const set = PHASE7_PARAMETERS[manifest.id]
      assert.ok(set !== undefined, `${manifest.id} has no parameter set`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares "${id}" and has no definition for it`)
    }
    const registered = new Set(PHASE7_CATALOGUE.map((one) => one.id))
    for (const id of Object.keys(PHASE7_PARAMETERS)) assert.ok(registered.has(id), `parameters declared for unregistered "${id}"`)
  })

  it('every Phase 8 app has a surface, parameters and limitations', () => {
    for (const manifest of PHASE8_CATALOGUE) {
      assert.ok(ids.has(manifest.id), `"${manifest.id}" is registered and has no surface.`)
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} states fewer than three limitations`)
      const set = PHASE8_PARAMETERS[manifest.id]
      assert.ok(set !== undefined, `${manifest.id} has no parameter set`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares "${id}" and has no definition for it`)
    }
  })

  it('every Phase 9 app has a surface, parameters and limitations', () => {
    for (const manifest of PHASE9_CATALOGUE) {
      assert.ok(ids.has(manifest.id), `"${manifest.id}" is registered and has no surface.`)
      assert.ok(manifest.limitations.length >= 3, `${manifest.id} states fewer than three limitations`)
      const set = PHASE9_PARAMETERS[manifest.id]
      assert.ok(set !== undefined, `${manifest.id} has no parameter set`)
      for (const id of manifest.parameters) assert.ok(set[id], `${manifest.id} declares "${id}" and has no definition for it`)
    }
  })

  it('the Playground never claims to run code on this machine', () => {
    // The whole safety story of the Playground is that nothing executes locally. A permission or a capability
    // that implied otherwise would be the one change worth catching automatically.
    for (const manifest of PHASE9_CATALOGUE) {
      const words = `${manifest.summary} ${manifest.capabilities.map((one) => one.summary).join(' ')}`.toLowerCase()
      assert.ok(!/\b(shell|subprocess|local(ly)?|on your (machine|computer)|command line)\b/.test(words), `${manifest.id} implies running code locally: ${words}`)
      // Only what sending code somewhere else actually needs. AppPermission has no 'shell' to ask for, which is
      // the type system already saying this — but a later permission that did allow it would land here first.
      const allowed = new Set(['compute', 'network'])
      for (const permission of manifest.permissions) {
        assert.ok(allowed.has(permission), `${manifest.id} asks for "${permission}", which running code elsewhere does not need`)
      }
      assert.ok(manifest.limitations.some((one) => /never.*run on this machine|nothing is ever run/i.test(one)), `${manifest.id} does not say that nothing runs locally`)
    }
  })

  it('claims no language or tool Orbis has not got', () => {
    /*
     * Orbis ships no Python, C, C++ or Java runtime, no debugger protocol and no profiler, so nothing may imply one.
     *
     * The Code Playground is the single exception on language names, and only on those: it names languages because
     * it sends the code to a sandbox somewhere else, never because it runs one here. That exception is narrow on
     * purpose — the tooling words below stay forbidden for it too, and the test after this one checks that it
     * cannot start claiming to run anything on this machine.
     */
    const general = [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE]
    const said = (apps: readonly NativeAppManifest[]): string =>
      apps.flatMap((one) => [one.summary, ...one.capabilities.map((two) => `${two.id} ${two.summary}`), ...one.tags]).join(' ').toLowerCase()

    const RUNTIMES = ['python', 'c++', ' java ']
    const TOOLS = ['debugger', 'breakpoint', 'profiler', 'terminal']

    for (const forbidden of [...RUNTIMES, ...TOOLS]) {
      assert.ok(!said(general).includes(forbidden), `the catalogue mentions "${forbidden.trim()}", which Orbis cannot actually do`)
    }
    // The Playground may name languages. It may not claim a debugger, a profiler or a terminal.
    for (const forbidden of TOOLS) {
      assert.ok(!said(PHASE9_CATALOGUE).includes(forbidden), `the Playground mentions "${forbidden}", which it has not got`)
    }
  })

  /**
   * Every app's surface kind is one the card will actually draw.
   *
   * The card used to mount a screen only for `kind: 'page'`. Every laboratory built for this platform declares
   * `kind: 'native'`, so four phases of them -- algorithms, molecules, ecosystems, circuits, control, robotics,
   * structures, logic, processors, scheduling, networks, images, machine learning, neural networks -- opened to the
   * sentence "this app is registered and its screen is not part of this build", with the component sitting in
   * `surfaces.tsx` and the engine sitting behind it, both working, neither reachable.
   *
   * Nothing caught it because every other check asked the runtime, and the runtime was right. This asks the one
   * question that was never asked: is there a kind here that the thing drawing these has no branch for?
   */
  it('declares only surface kinds the conversation card knows how to draw', () => {
    const all = [...CATALOGUE, ...PHASE2_CATALOGUE, ...PHASE3_CATALOGUE, ...PHASE4_CATALOGUE, ...PHASE5_CATALOGUE, ...PHASE6_CATALOGUE, ...PHASE7_CATALOGUE, ...PHASE8_CATALOGUE, ...PHASE9_CATALOGUE, ...PHASE10_CATALOGUE, ...PHASE11_CATALOGUE]
    // The branches in `NativeAppCard`. A new kind means a new branch there, in the same commit.
    const DRAWN = new Set(['page', 'native', 'artifact'])
    const strange = all.filter((one) => !DRAWN.has(one.surface.kind)).map((one) => `${one.id}: ${one.surface.kind}`)
    assert.deepEqual(
      strange,
      [],
      `these declare a surface kind nothing draws, so they would open on an apology:\n  ${strange.join('\n  ')}`
    )
  })
})
