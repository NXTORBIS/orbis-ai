import { lazy, Suspense, type ComponentType } from 'react'
import { LabBoundary } from './LabBoundary'
import type { NoticeKind } from '../../lib/notices'

/**
 * Which component a Native App mounts.
 *
 * ## Nothing here is new UI
 *
 * Every component in this map already exists and already works — the thirty-seven laboratories under
 * `PagesView` / `PageTools` / `PageLabs` / `ScienceLabs` / `PhysicsLabs`. The native layer's whole claim is that
 * registering an app costs a manifest and a line here, not a rebuild, and this file is where that claim is either
 * true or it isn't.
 *
 * ## Loaded when first opened, not at startup
 *
 * Every entry is `lazy`. Pulling four thousand lines of laboratory into the first paint of the chat would make the
 * platform cost something before anybody used it, and the point of a lazy map is that a conversation with no apps in
 * it loads none of them. This is what §252 asks for, and it matters far more once Phase 2 adds a compiler.
 *
 * ## An unknown id renders a refusal, never a blank
 *
 * `surfaceFor` returns null and the host says so. A missing component is a programming error, and an empty card is the
 * version of that error nobody notices.
 */

/** The live instance, as a Phase 2 application receives it. Values, what to show, and the definitions to render. */
export interface LiveInstance {
  id: string
  appId: string
  generation: number
  phase: string
  values: Readonly<Record<string, string | number | boolean | readonly number[]>>
  shown: readonly string[]
  described: Readonly<Record<string, string>>
  definitions: readonly {
    id: string
    name: string
    kind: string
    about: string
    unit?: string
    least?: number
    most?: number
    step?: number
    places?: number
    options?: readonly { id: string; label: string }[]
    group?: string
    derived: boolean
  }[]
  domain: Readonly<Record<string, unknown>>
}

export interface SurfaceProps {
  pageId: string
  onNotify(message: string, kind?: NoticeKind): void
  /**
   * The live instance, for an application whose controls are declared parameters.
   *
   * Absent for the adopted Pages, which keep their own inputs — which is why it is optional rather than required.
   */
  instance?: LiveInstance
  /**
   * Sets parameters through the runtime, returning any refusals by parameter id.
   *
   * Going through the runtime is the point: it checks the range, the unit and the dimension, and a value it refuses
   * never reaches the engine.
   */
  onConfigure?(values: Record<string, unknown>): Promise<Readonly<Record<string, string>> | null>
  /**
   * Starting values, for the apps wired to the parameter system.
   *
   * Passed as text because every one of these laboratories keeps its inputs as text in its own state — which is
   * correct for a field somebody types in, and means wiring one costs a default rather than a rewrite. An app that
   * ignores this is simply not configurable from a sentence, which its manifest says.
   */
  initial?: Readonly<Record<string, string>>
}

type Surface = ComponentType<SurfaceProps>

const fromPages = (name: 'UnitConverterPage' | 'EquationSolverPage' | 'CalculusLabPage'): Surface =>
  lazy(async () => {
    const held = await import('../PagesView')
    return { default: held[name] as Surface }
  })

const fromTools = (name: 'FunctionPlotterPage' | 'StatisticsLabPage' | 'DataExplorerPage' | 'MeasurementLabPage' | 'OptimiserPage' | 'SimulationLabPage'): Surface =>
  lazy(async () => {
    const held = await import('../PageTools')
    return { default: held[name] as Surface }
  })

const fromLabs = (slug: string): Surface =>
  lazy(async () => {
    const held = await import('../PageLabs')
    const found = Object.prototype.hasOwnProperty.call(held.LAB_PAGES, slug) ? (held.LAB_PAGES[slug] as Surface) : null
    if (!found) throw new Error(`There is no laboratory called "${slug}".`)
    return { default: found }
  })

/**
 * The Phase 2 applications: built here rather than adopted, each with its own engine.
 *
 * Separate from the adopted Pages below only for readability — the map is one object, and `surfaceFor` does not know
 * or care which half an app came from.
 */
const BUILT: Readonly<Record<string, Surface>> = Object.freeze({
  'algorithm-lab': lazy(async () => {
    const held = await import('./AlgorithmLab')
    return { default: held.default as unknown as Surface }
  }),
  'algorithm-compare': lazy(async () => {
    const held = await import('./AlgorithmCompare')
    return { default: held.default as unknown as Surface }
  }),
  'molecule-lab': lazy(async () => {
    const held = await import('./MoleculeLab')
    return { default: held.default as unknown as Surface }
  }),
  'field-lab': lazy(async () => {
    const held = await import('./FieldLab')
    return { default: held.default as unknown as Surface }
  }),
  'ecosystem-lab': lazy(async () => {
    const held = await import('./EcosystemLab')
    return { default: held.default as unknown as Surface }
  }),
  'dna-lab': lazy(async () => {
    const held = await import('./DnaLab')
    return { default: held.default as unknown as Surface }
  }),
  'structure-lab': lazy(async () => {
    const held = await import('./StructureLab')
    return { default: held.default as unknown as Surface }
  }),
  'sql-lab': lazy(async () => {
    const held = await import('./SqlLab')
    return { default: held.default as unknown as Surface }
  }),
  'circuit-lab': lazy(async () => {
    const held = await import('./CircuitLab')
    return { default: held.default as unknown as Surface }
  }),
  'control-lab': lazy(async () => {
    const held = await import('./ControlLab')
    return { default: held.default as unknown as Surface }
  }),
  'robot-lab': lazy(async () => {
    const held = await import('./RobotLab')
    return { default: held.default as unknown as Surface }
  }),
  'structure-load-lab': lazy(async () => {
    const held = await import('./StructureLoadLab')
    return { default: held.default as unknown as Surface }
  }),
  'organic-lab': lazy(async () => {
    const held = await import('./OrganicLab')
    return { default: held.default as unknown as Surface }
  }),
  'combination-engine': lazy(async () => {
    const held = await import('./CombinationLab')
    return { default: held.default as unknown as Surface }
  }),
  'molecular-studio': lazy(async () => {
    const held = await import('./MolecularStudioLab')
    return { default: held.default as unknown as Surface }
  }),
  'physics-studio': lazy(async () => {
    const held = await import('./PhysicsStudio')
    return { default: held.default as unknown as Surface }
  }),
  'chemistry-studio': lazy(async () => {
    const held = await import('./ChemistryStudio')
    return { default: held.default as unknown as Surface }
  }),
  'cs-studio': lazy(async () => {
    const held = await import('./CSStudio')
    return { default: held.default as unknown as Surface }
  }),
  'quantum-studio': lazy(async () => {
    const held = await import('./QuantumStudio')
    return { default: held.default as unknown as Surface }
  }),
  'code-playground': lazy(async () => {
    const held = await import('./CodePlaygroundLab')
    return { default: held.default as unknown as Surface }
  }),
  'compiler-lab': lazy(async () => {
    const held = await import('./CompilerLab')
    return { default: held.default as unknown as Surface }
  }),
  'automata-lab': lazy(async () => {
    const held = await import('./AutomataLab')
    return { default: held.default as unknown as Surface }
  }),
  'crypto-lab': lazy(async () => {
    const held = await import('./CryptoLab')
    return { default: held.default as unknown as Surface }
  }),
  'graphics-lab': lazy(async () => {
    const held = await import('./GraphicsLab')
    return { default: held.default as unknown as Surface }
  }),
  'consensus-lab': lazy(async () => {
    const held = await import('./ConsensusLab')
    return { default: held.default as unknown as Surface }
  }),
  'periodic-table': lazy(async () => {
    const held = await import('./PeriodicTableLab')
    return { default: held.default as unknown as Surface }
  }),
  'chem-calculator': lazy(async () => {
    const held = await import('./ChemCalculatorLab')
    return { default: held.default as unknown as Surface }
  }),
  'reaction-lab': lazy(async () => {
    const held = await import('./ReactionsLab')
    return { default: held.default as unknown as Surface }
  }),
  'electro-lab': lazy(async () => {
    const held = await import('./ElectroLab')
    return { default: held.default as unknown as Surface }
  }),
  'titration-lab': lazy(async () => {
    const held = await import('./TitrationLab')
    return { default: held.default as unknown as Surface }
  }),
  'logic-lab': lazy(async () => {
    const held = await import('./LogicLab')
    return { default: held.default as unknown as Surface }
  }),
  'processor-lab': lazy(async () => {
    const held = await import('./ProcessorLab')
    return { default: held.default as unknown as Surface }
  }),
  'os-lab': lazy(async () => {
    const held = await import('./OsLab')
    return { default: held.default as unknown as Surface }
  }),
  'network-lab': lazy(async () => {
    const held = await import('./NetworkLab')
    return { default: held.default as unknown as Surface }
  }),
  'image-lab': lazy(async () => {
    const held = await import('./ImageLab')
    return { default: held.default as unknown as Surface }
  }),
  'learning-lab': lazy(async () => {
    const held = await import('./LearningLab')
    return { default: held.default as unknown as Surface }
  }),
  'neural-lab': lazy(async () => {
    const held = await import('./NeuralLab')
    return { default: held.default as unknown as Surface }
  })
})

/**
 * App id to component.
 *
 * The ids are the Page slugs, deliberately: the Pages registry already owns that identity across installs and
 * profiles, so there is one name for an app rather than two that can disagree.
 */
const SURFACES: Readonly<Record<string, Surface>> = Object.freeze({
  ...BUILT,
  // Defined inside PagesView
  'unit-converter': fromPages('UnitConverterPage'),
  'equation-solver': fromPages('EquationSolverPage'),
  'calculus-lab': fromPages('CalculusLabPage'),

  // Defined in PageTools
  'function-plotter': fromTools('FunctionPlotterPage'),
  'statistics-lab': fromTools('StatisticsLabPage'),
  'data-explorer': fromTools('DataExplorerPage'),
  'measurement-lab': fromTools('MeasurementLabPage'),
  optimiser: fromTools('OptimiserPage'),
  'simulation-lab': fromTools('SimulationLabPage'),

  // The rest come through the one map PageLabs already keeps.
  'algebra-lab': fromLabs('algebra-lab'),
  'matrix-lab': fromLabs('matrix-lab'),
  'geometry-lab': fromLabs('geometry-lab'),
  'number-lab': fromLabs('number-lab'),
  'uncertainty-lab': fromLabs('uncertainty-lab'),
  'parameter-study': fromLabs('parameter-study'),
  'document-studio': fromLabs('document-studio'),
  'data-importer': fromLabs('data-importer'),
  'problem-workspace': fromLabs('problem-workspace'),
  'scenario-lab': fromLabs('scenario-lab'),
  'explain-it-yourself': fromLabs('explain-it-yourself'),
  'builder-studio': fromLabs('builder-studio'),
  project: fromLabs('project'),
  'signal-lab': fromLabs('signal-lab'),
  'curve-fitter': fromLabs('curve-fitter'),
  'significant-figures': fromLabs('significant-figures'),
  'constants-library': fromLabs('constants-library'),
  'coordinate-lab': fromLabs('coordinate-lab'),
  'constraint-checker': fromLabs('constraint-checker'),
  'motion-lab': fromLabs('motion-lab'),
  'projectile-lab': fromLabs('projectile-lab'),
  'oscillator-lab': fromLabs('oscillator-lab'),
  'pendulum-lab': fromLabs('pendulum-lab'),
  'collision-lab': fromLabs('collision-lab'),
  'orbit-lab': fromLabs('orbit-lab'),
  'rotation-lab': fromLabs('rotation-lab'),
  'wave-lab': fromLabs('wave-lab'),
  'integrator-lab': fromLabs('integrator-lab')
})

export const surfaceFor = (appId: string): Surface | null =>
  Object.prototype.hasOwnProperty.call(SURFACES, appId) ? SURFACES[appId] : null

export const hasSurface = (appId: string): boolean => Object.prototype.hasOwnProperty.call(SURFACES, appId)

/**
 * A surface mounted, with a loading state while its code arrives.
 *
 * The `Suspense` boundary is here rather than around the whole card so the card's own header stays on screen while the
 * laboratory loads — a card that disappears and comes back looks like a bug.
 */
export function Surface({ appId, props }: { appId: string; props: SurfaceProps }): React.JSX.Element {
  const Found = surfaceFor(appId)
  if (!Found) {
    return (
      <p className="na-missing">
        This app is registered and its screen is not part of this build. Nothing has been lost — anything it saved is
        still in your experiments.
      </p>
    )
  }
  /*
   * Inside a boundary, because a laboratory that throws used to take the window with it.
   *
   * React unmounts the whole tree when a render throws, so one undefined field in one of fifty laboratories left a
   * blank Orbis. Now it leaves a card that says which one stopped.
   */
  return (
    <LabBoundary name={appId}>
      <Suspense fallback={<div className="na-loading" aria-label="Loading" />}>
        <Found {...props} />
      </Suspense>
    </LabBoundary>
  )
}
