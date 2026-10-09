/**
 * The Chemistry Studio inside Orbis: the user's own hub, with their own pages behind it.
 *
 * Their site reached each module by URL. Orbis has no URLs, so this holds the route in state through the port's
 * own router shim and renders whichever of their pages that route names. Nothing inside their pages is changed —
 * the hub's tiles call `navigate('/chemistry/kinetics')` exactly as they did, and this is what answers.
 *
 * Every page is loaded only when it is opened. Twenty-six studios eagerly imported would pull their whole
 * element table, formula set and chart library into the first paint of a studio showing none of them.
 *
 * A route their own registry marks as not finished says so plainly rather than rendering an empty frame. That is
 * their judgement, not mine: `soon: true` is in their registry.
 */
import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Hourglass } from 'lucide-react'
import { Routed, useWhere, useNavigate } from './ui/router.jsx'
import { MODULES } from './lib/chemistryStudio/registry.js'
import { base44 } from './api/base44Client.js'
import './chemistry.css'

const Hub = lazy(() => import('./ChemistryStudio.jsx'))

/** Where a kept experiment goes. The same store the ported tree already uses for its records. */
const experimentStore = base44.entities.ExperimentRecord

/** Their page for each route, by the route string their own registry uses. */
const PAGES = {
  '/chemistry/combine': lazy(() => import('./CombinationEngine.jsx')),
  '/chemistry/molecules': lazy(() => import('./MolecularStudio.jsx')),
  '/chemistry/organic': lazy(() => import('./OrganicExplorer.jsx')),
  '/chemistry/inorganic': lazy(() => import('./InorganicExplorer.jsx')),
  '/chemistry/reactions': lazy(() => import('./ReactionLab.jsx')),
  '/chemistry/lab': lazy(() => import('./VirtualLab.jsx')),
  '/chemistry/physical': lazy(() => import('./studios/PhysicalChemistry.jsx')),
  '/chemistry/kinetics': lazy(() => import('./studios/KineticsStudio.jsx')),
  '/chemistry/electrochemistry': lazy(() => import('./studios/ElectrochemistryStudio.jsx')),
  '/chemistry/quantum': lazy(() => import('./QuantumChemistry.jsx')),
  '/chemistry/spectroscopy': lazy(() => import('./studios/SpectroscopyStudio.jsx')),
  '/chemistry/biochemistry': lazy(() => import('./studios/BiochemistryStudio.jsx')),
  '/chemistry/materials': lazy(() => import('./studios/MaterialsStudio.jsx')),
  '/chemistry/polymer': lazy(() => import('./studios/PolymerStudio.jsx')),
  '/chemistry/analytical': lazy(() => import('./studios/AnalyticalStudio.jsx')),
  '/chemistry/engineering': lazy(() => import('./studios/EngineeringStudio.jsx')),
  '/chemistry/environmental': lazy(() => import('./studios/EnvironmentalStudio.jsx')),
  '/chemistry/nuclear': lazy(() => import('./studios/NuclearStudio.jsx')),
  '/chemistry/astro': lazy(() => import('./studios/AstrochemistryStudio.jsx')),
  '/chemistry/surface': lazy(() => import('./studios/SurfaceStudio.jsx')),
  '/chemistry/data': lazy(() => import('./studios/DataLabStudio.jsx')),
  '/chemistry/frontier': lazy(() => import('./studios/FrontierStudio.jsx')),
  '/chemistry/calculator': lazy(() => import('./ChemistryCalculator.jsx')),
  '/chemistry/formulas': lazy(() => import('./FormulaVault.jsx')),
  // V26 and V27. Their registry listed both and marked them unfinished; these are them.
  '/chemistry/visualization': lazy(() => import('./studios/VisualizationStudio.jsx')),
  '/chemistry/research': lazy(() => import('./studios/ResearchStudio.jsx'))
}

/**
 * The engines the two new studios compute from, handed in rather than imported by them.
 *
 * Those two files are plain JavaScript like the rest of the ported tree, and the engines are Orbis's own
 * TypeScript with their own tests. Passing them keeps the computation somewhere it can be checked without a
 * screen -- which is where the three real errors in it were caught.
 */
const ENGINES = {
  visualization: () =>
    Promise.all([
      import('../../../shared/chemistry/orbitals'),
      import('../../../shared/chemistry/landscape'),
      import('../../../shared/chemistry/molecule'),
      import('../../../shared/chemistry/geometry'),
      import('../../../shared/chemistry/smiles')
    ]).then(([orbitals, landscape, molecule, geometry, smiles]) => ({
      ...orbitals,
      ...landscape,
      ...molecule,
      ...geometry,
      ...smiles
    })),
  research: () =>
    Promise.all([
      import('../../../shared/chemistry/orbitals'),
      import('../../../shared/chemistry/landscape'),
      import('../../../shared/chemistry/experiments')
    ]).then(([orbitals, landscape, experiments]) => ({ ...orbitals, ...landscape, ...experiments }))
}

/** One element's own page, reached from the periodic table. The atomic number is the last segment. */
const ElementDetail = lazy(() => import('./ElementDetail.jsx'))

function NotYet({ route }) {
  const module = MODULES.find((one) => one.route === route)
  const navigate = useNavigate()
  return (
    <div className="jx-wrap">
      <div className="jx">
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Hourglass className="h-8 w-8 text-cyan-j" />
          <div className="font-display text-lg font-bold">{module?.name ?? 'Not here yet'}</div>
          <p className="max-w-md text-sm text-muted-foreground">
            {module?.desc
              ? `${module.desc} This one is not built yet, so there is nothing to show — rather than an empty screen pretending otherwise.`
              : 'There is nothing behind this yet.'}
          </p>
          <button
            type="button"
            onClick={() => navigate('/chemistry')}
            className="mt-1 flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-xs transition hover:border-border"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All modules
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Loads the engines a studio needs, then renders it.
 *
 * They are loaded on demand rather than with the page, because nothing else in the studio needs them and the
 * orbital and landscape engines are only read when one of these two screens is open.
 */
function WithEngines({ which, Page }) {
  const [engine, setEngine] = useState(null)
  const [refused, setRefused] = useState(null)

  useEffect(() => {
    let alive = true
    ENGINES[which]()
      .then((held) => {
        if (alive) setEngine(held)
      })
      .catch((error) => {
        if (alive) setRefused(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [which])

  if (refused !== null) {
    return (
      <p className="py-20 text-center text-sm text-muted-foreground">
        The engines this studio computes from could not be loaded: {refused}
      </p>
    )
  }
  if (engine === null) return <p className="py-20 text-center text-sm text-muted-foreground">Opening…</p>

  /*
   * The Research Workspace also saves what it found, through the same store the rest of the ported tree uses.
   * Handed in the same way, so the page does not reach for a backend itself.
   */
  const store = which === 'research' ? experimentStore : undefined
  return <Page engine={engine} store={store} />
}

function Showing() {
  const here = useWhere()
  const navigate = useNavigate()
  const route = here?.at ?? '/chemistry'

  /*
   * The path decides which page, never the query.
   *
   * Their element page links to `/chemistry/combine?focus=H` to pre-select an element. Matching the whole string
   * meant that link found no page and showed the "not built yet" screen -- for a module that is built, from a
   * link that works.
   */
  const path = route.split('?')[0]

  const What = useMemo(() => {
    if (path === '/chemistry') return Hub
    if (/^\/chemistry\/element\/\d+$/.test(path)) return ElementDetail
    return PAGES[path] ?? null
  }, [path])

  return (
    <div className="ch-studio">
      {/* One way back, in one place, so every one of their pages gets it without being edited. */}
      {path !== '/chemistry' && (
        <button
          type="button"
          onClick={() => navigate('/chemistry')}
          className="ch-back"
          aria-label="Back to all chemistry modules"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All modules
        </button>
      )}
      <Suspense
        fallback={
          <div className="jx-wrap">
            <div className="jx">
              <div className="py-20 text-center text-sm text-muted-foreground">Opening…</div>
            </div>
          </div>
        }
      >
        {What ? (
          <div className="jx-wrap">
            <div className="jx">
              {/* The two studios that compute from Orbis's own engines get them; the rest need nothing. */}
              {path === '/chemistry/visualization' || path === '/chemistry/research' ? (
                <WithEngines which={path === '/chemistry/research' ? 'research' : 'visualization'} Page={What} />
              ) : (
                <What />
              )}
            </div>
          </div>
        ) : (
          <NotYet route={path} />
        )}
      </Suspense>
    </div>
  )
}

export default function ChemistryStudioPage() {
  return (
    <Routed start="/chemistry">
      <Showing />
    </Routed>
  )
}
