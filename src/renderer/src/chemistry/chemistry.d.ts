/**
 * Types for the ported chemistry studio.
 *
 * The user's twenty-six modules, their hub, their periodic table and their shared parts came across from the
 * original studio as JavaScript and are kept that way deliberately: rewriting them into strict TypeScript would
 * mean editing every one of them, which is the opposite of reusing them. This declares the shape of the few
 * things Orbis's own code touches, so the rest of the app stays strictly typed while the ported tree stays as it
 * is.
 */

declare module '*/chemistryStudio/registry.js' {
  import type { ComponentType } from 'react'

  export interface ChemistryModule {
    id: string
    name: string
    /** The route their own hub navigates to. */
    route: string
    group: string
    icon: ComponentType<Record<string, unknown>>
    /** Their own version label, V1 to V27. */
    v: string
    desc: string
    keywords: string[]
    /** Set where their registry says the module is not finished. */
    soon?: boolean
  }

  export const MODULES: ChemistryModule[]
  export const GROUPS: string[]
  export function searchModules(query: string): ChemistryModule[]
}

declare module '*/chemistry/StudioPage.jsx' {
  const StudioPage: () => React.JSX.Element
  export default StudioPage
}

declare module '*/chemistry/ui/router.jsx' {
  export function Routed(props: { start?: string; children?: React.ReactNode }): React.JSX.Element
  export function useWhere(): { at: string; navigate: (to: string | number) => void; deep: boolean } | null
  export function useNavigate(): (to: string | number) => void
  export function useLocation(): { pathname: string; search: string; hash: string; state: unknown }
  export function useParams(): Record<string, string>
  export function Link(props: { to: string; children?: React.ReactNode; className?: string }): React.JSX.Element
}

declare module '*/chemistry/lib/elementsData.js' {
  export interface ChemistryElement {
    atomic_number: number
    symbol: string
    name: string
    atomic_mass: number
    category: string
    group: number
    period: number
    block: string
    phase: string
    [more: string]: unknown
  }

  export const ELEMENTS: unknown[]
  export const ELEMENT_MAP: Record<number, ChemistryElement>
  export const ALL_ELEMENTS: ChemistryElement[]
  export function getElement(z: number): ChemistryElement | null
  export function getElementBySymbol(symbol: string): ChemistryElement | undefined
}

declare module '*/chemistry/lib/chemistryCategories.js' {
  export interface ChemistryCategory {
    id: string
    label: string
    color: string
    glow: string
  }

  export const CATEGORIES: ChemistryCategory[]
  export function getCategory(id: string): ChemistryCategory
}

declare module '*/chemistry/lib/chemistry/units.js' {
  export const CONSTANTS: Record<string, number>
  export function fmtSci(value: number, digits?: number): string
  export function fmtUnits(value: number, unit: string, digits?: number): string
  export function toKelvin(celsius: number): number
  export function toCelsius(kelvin: number): number
}
