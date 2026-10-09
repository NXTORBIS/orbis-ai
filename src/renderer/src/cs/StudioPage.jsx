/**
 * The Computer Science Studio inside Orbis: the user's own shell, with their own pages behind it.
 *
 * Their studio is a rail of twenty-four sections and an `<Outlet />`, reached by URL on their site. Orbis has no
 * URLs, so the port's own router holds the route in state and this says which page belongs to each one. Nothing
 * inside their pages is changed — every rail entry still calls `NavLink` exactly as it did.
 *
 * Every page is loaded only when it is opened. Twenty-four sections eagerly imported would pull ninety
 * algorithms, a problem bank and fourteen laboratories into the first paint of a screen showing none of them.
 */
import React, { Suspense, lazy, useMemo } from 'react'
import { Routed } from './ui/router.jsx'
import { XpProvider } from './lib/XpContext.jsx'
import '../physics/physics.css'
import './cs.css'

const Shell = lazy(() => import('./CSStudio.jsx'))

/**
 * Their page for each route.
 *
 * Four of their rail entries point at two pages — "Programming & Development" at `/cs/playground` and
 * "Achievements" at `/cs/progress`. Those get screens of their own below, so the rail stops offering the same
 * thing twice under different names.
 */
const PAGES = {
  '/cs': lazy(() => import('./Overview.jsx')),
  '/cs/learn': lazy(() => import('./Learn.jsx')),
  '/cs/problems': lazy(() => import('./Problems.jsx')),
  '/cs/daily': lazy(() => import('./DailyChallenge.jsx')),
  '/cs/playground': lazy(() => import('./Playground.jsx')),
  '/cs/labs': lazy(() => import('./Labs.jsx')),
  '/cs/progress': lazy(() => import('./Progress.jsx')),

  // The fourteen laboratories, all of them built.
  '/cs/contests': lazy(() => import('./labs/ContestsLab.jsx')),
  '/cs/architecture': lazy(() => import('./labs/ArchitectureLab.jsx')),
  '/cs/os': lazy(() => import('./labs/OSLab.jsx')),
  '/cs/networks': lazy(() => import('./labs/NetworksLab.jsx')),
  /*
   * Databases points at Orbis's own laboratory rather than theirs.
   *
   * Their section fetches a WebAssembly SQL engine from a CDN the moment it opens, so it does not work offline
   * and sends a request out to use it. Orbis's runs the query in the application against a real database, shows
   * the schema and explains the plan. One subject, one place, and the better of the two.
   */
  '/cs/databases': lazy(() => import('./Elsewhere.jsx')),
  '/cs/compilers': lazy(() => import('./labs/CompilersLab.jsx')),
  '/cs/theory': lazy(() => import('./labs/TheoryLab.jsx')),
  '/cs/cybersecurity': lazy(() => import('./labs/CybersecurityLab.jsx')),
  '/cs/ai-ml': lazy(() => import('./labs/AILab.jsx')),
  '/cs/data-science': lazy(() => import('./labs/DataScienceLab.jsx')),
  '/cs/graphics': lazy(() => import('./labs/GraphicsLab.jsx')),
  '/cs/distributed': lazy(() => import('./labs/DistributedLab.jsx')),
  '/cs/software-engineering': lazy(() => import('./labs/SoftwareEngineeringLab.jsx')),
  '/cs/projects': lazy(() => import('./labs/ProjectsLab.jsx')),

  // Algorithms & DSA is a page of its own on their site, at its own address.
  '/algorithm-lab': lazy(() => import('./AlgorithmLab.jsx')),

  /*
   * Digital Logic is the one section with no page in this port.
   *
   * Their rail pointed at a separate page that was deliberately left out, and Orbis has its own Digital Logic
   * Laboratory which does more. So the entry says where the real one is and opens it, rather than being dead or
   * being a thinner copy.
   */
  '/digital-logic-lab': lazy(() => import('./Elsewhere.jsx')),

  // One problem, opened from the list. Their route is /cs/problem/:slug.
  '/cs/problem': lazy(() => import('./ProblemDetail.jsx'))
}

function Waiting() {
  return (
    <div className="flex h-full items-center justify-center p-10 text-sm text-muted-foreground">Opening…</div>
  )
}

/**
 * Which page a route names.
 *
 * A problem's address carries its slug, so the lookup is by the path without it — otherwise every problem would
 * be a route nobody had registered.
 */
function pageFor(route) {
  const path = String(route ?? '').split('?')[0]
  if (PAGES[path]) return PAGES[path]
  if (/^\/cs\/problem\//.test(path)) return PAGES['/cs/problem']
  return null
}

export default function CSStudioPage() {
  const pages = useMemo(() => {
    // The router asks for a map; `*` answers for anything that is not one of theirs.
    const out = { ...PAGES }
    out['*'] = function NotThere() {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
          <div className="font-display text-base font-semibold">Nothing here yet</div>
          <p className="max-w-md text-sm text-muted-foreground">
            This section of the studio has no screen behind it. Rather than show an empty frame, it says so.
          </p>
        </div>
      )
    }
    return out
  }, [])

  return (
    <div className="jx-wrap">
      <div className="jx cs-studio">
        {/* XP wraps the whole studio, because the rail, the overview and every problem page read from it. */}
        <XpProvider>
          <Routed start="/cs" pages={pages} resolve={pageFor}>
            <Suspense fallback={<Waiting />}>
              <Shell />
            </Suspense>
          </Routed>
        </XpProvider>
      </div>
    </div>
  )
}

export { pageFor, PAGES }
