/**
 * Types for the ported physics studio.
 *
 * The 230 simulations, their shared UI and the registry came across from the original studio as JavaScript and are
 * kept that way deliberately: rewriting them into strict TypeScript would mean editing every one of them, which is
 * the opposite of reusing them. This declares the shape of the few things Orbis's own code touches, so the rest of
 * the app stays strictly typed while the ported tree stays as it is.
 */

declare module '*/physics/lib/registry.js' {
  import type { ComponentType } from 'react'

  export interface PhysicsTopic {
    id: string
    name: string
    status: string
    /** The simulation itself. Each owns its own loop, canvas, parameters and transport. */
    component: ComponentType<Record<string, unknown>>
    /** Set when the original linked out to a full page rather than mounting inline. */
    to: string | null
    desc: string
    section: string
    sectionName: string
  }

  export interface PhysicsSection {
    id: string
    name: string
    /** The colour the original gives this section, kept so the sections stay recognisable. */
    accent: string
    topics: PhysicsTopic[]
  }

  export const SECTIONS: PhysicsSection[]
  export const ALL_TOPICS: PhysicsTopic[]
  export const LIVE_COUNT: number
  export const TOTAL_COUNT: number
}

declare module '*/physics/lib/topicExplanations.js' {
  export const TOPIC_EXPLANATIONS: Record<string, unknown>
  const fallback: unknown
  export default fallback
}

declare module '*.jsx' {
  import type { ComponentType } from 'react'
  const component: ComponentType<Record<string, unknown>>
  export default component
}
