import { CATALOGUE } from './catalogue.ts'
import { PHASE2_CATALOGUE } from './phase2.ts'
import { PHASE3_CATALOGUE } from './phase3.ts'
import { PHASE4_CATALOGUE } from './phase4.ts'
import { PHASE5_CATALOGUE } from './phase5.ts'
import { PHASE6_CATALOGUE } from './phase6.ts'
import { PHASE7_CATALOGUE } from './phase7.ts'
import { PHASE8_CATALOGUE } from './phase8.ts'
import { PHASE9_CATALOGUE } from './phase9.ts'
import { PHASE10_CATALOGUE } from './phase10.ts'
import { PHASE11_CATALOGUE } from './phase11.ts'
import { PHASE12_CATALOGUE } from './phase12.ts'
import type { NativeAppManifest } from './manifest.ts'

/**
 * Every laboratory Orbis ships, in one list.
 *
 * The native service joins the phase catalogues itself to build its registry, and anything else that needs to
 * know what exists was left to repeat that list — which is how a list ends up missing a phase and nobody
 * notices. This is the one place the join is written down.
 *
 * Retired laboratories are included. A course lesson may point at one that has been superseded, and that still
 * opens: retirement takes an app out of the catalogue and the search, not out of existence.
 */
export const EVERY_APP: readonly NativeAppManifest[] = Object.freeze([
  ...CATALOGUE,
  ...PHASE2_CATALOGUE,
  ...PHASE3_CATALOGUE,
  ...PHASE4_CATALOGUE,
  ...PHASE5_CATALOGUE,
  ...PHASE6_CATALOGUE,
  ...PHASE7_CATALOGUE,
  ...PHASE8_CATALOGUE,
  ...PHASE9_CATALOGUE,
  ...PHASE10_CATALOGUE,
  ...PHASE11_CATALOGUE,
  ...PHASE12_CATALOGUE
])

/** The ids, for anything that only needs to ask "is this a real laboratory?". */
export const EVERY_APP_ID: ReadonlySet<string> = Object.freeze(new Set(EVERY_APP.map((one) => one.id)))
