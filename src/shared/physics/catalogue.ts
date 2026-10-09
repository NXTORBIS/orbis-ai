import { CLASSICAL } from './classical.ts'
import { FIELDS } from './fields.ts'
import { THERMAL } from './thermal.ts'
import { COSMIC } from './cosmic.ts'
import { MANY_BODY } from './manybody.ts'
import { QEC } from './qec.ts'
import { WAVES } from './waves.ts'
import { CIRCUITS } from './circuits.ts'
import { QUANTUM } from './quantum.ts'
import { MATTER } from './matter.ts'
import { UNIVERSE } from './universe.ts'
import { fail, type Simulation, type SimulationError } from './simulation.ts'

/**
 * Every physics simulation Orbis has, and the sections they sit in.
 *
 * ## The sections are the shape of the subject, not of the code
 *
 * They are named the way a physics course names them, and a section is listed only when something in it actually
 * runs. There is no "coming soon" here: a section nobody has built is a section that is not shown, because a list
 * of locked rows is a worse answer than a shorter list.
 *
 * ## Adding one is three lines
 *
 * Write the simulation, add it to its section's array, and it appears — in the laboratory, in the search, and in
 * the guard that checks every one of them runs. Nothing else has to be told.
 */

export interface Section {
  id: string
  name: string
  /** What the section is about, in a sentence somebody would actually say. */
  about: string
}

export const SECTIONS: readonly Section[] = Object.freeze([
  { id: 'classical', name: 'Classical Mechanics', about: 'Motion, forces, energy and the oscillations that come out of them.' },
  { id: 'em', name: 'Electromagnetism', about: 'Fields, charges and the force that moves them.' },
  { id: 'waves', name: 'Waves and Optics', about: 'Waves adding up, and what that produces.' },
  { id: 'thermo', name: 'Thermodynamics', about: 'Heat, gases and the statistics underneath them.' },
  { id: 'quantum', name: 'Quantum Mechanics', about: 'Wavefunctions, energy levels and measurement.' },
  { id: 'astro', name: 'Astrophysics', about: 'Orbits, stars and gravity on a large scale.' },
  { id: 'nuclear', name: 'Nuclear and Particle', about: 'Decay, binding energy and what things are made of.' },
  { id: 'condensed', name: 'Condensed Matter', about: 'Many particles together, and what they do that one cannot.' },
  { id: 'fluid', name: 'Fluids', about: 'Flow, pressure and turbulence.' },
  { id: 'comp', name: 'Computational Physics', about: 'The methods that make the rest of it possible, and where they go wrong.' }
])

export const SIMULATIONS: readonly Simulation[] = Object.freeze([...CLASSICAL, ...FIELDS, ...THERMAL, ...COSMIC, ...MANY_BODY, ...QEC, ...WAVES, ...CIRCUITS, ...QUANTUM, ...MATTER, ...UNIVERSE])

export const simulationFor = (id: string): Simulation | null => SIMULATIONS.find((one) => one.id === id) ?? null

/** The sections that actually have something in them, with their simulations. */
export function sections(): readonly { section: Section; simulations: readonly Simulation[] }[] {
  return SECTIONS.map((section) => ({
    section,
    simulations: SIMULATIONS.filter((one) => one.section === section.id)
  })).filter((one) => one.simulations.length > 0)
}

/** Search by name, section or what it is about. */
export function search(query: string): readonly Simulation[] {
  const asked = query.trim().toLowerCase()
  if (asked === '') return SIMULATIONS
  const words = asked.split(/\s+/)
  return SIMULATIONS.filter((one) => {
    const haystack = `${one.name} ${one.about} ${one.section} ${one.id}`.toLowerCase()
    return words.every((two) => haystack.includes(two))
  })
}

/** A simulation by id, or a refusal naming what there is. */
export function mustFind(id: string): Simulation | SimulationError {
  const found = simulationFor(id)
  if (found) return found
  return fail('unknown', `There is no simulation called "${id}".`, `Try one of: ${SIMULATIONS.slice(0, 5).map((one) => one.id).join(', ')}.`)
}

export const COUNTS = Object.freeze({
  simulations: SIMULATIONS.length,
  sections: sections().length
})
