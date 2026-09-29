/**
 * The electromagnetic constants, taken from the registry rather than typed again.
 *
 * Every number in the electromagnetism, circuits, optics and acoustics engines that is a physical constant comes
 * through here, and everything here comes out of `constants.ts` — the same CODATA entries, with the same
 * provenance and the same uncertainties, resolved once at module load.
 *
 * ## Why this file exists at all
 *
 * The alternative is `const EPSILON_0 = 8.854e-12` at the top of five engines. That is five places to be wrong in,
 * five different truncations of the same number, and no way for a Page to answer "where did this come from". A
 * value used in a calculation and a value shown in a provenance panel have to be the same value, and the only way
 * to guarantee that is for there to be one of them.
 *
 * ## The derived ones are derived, not measured
 *
 * Coulomb's constant is `1/(4πε₀)` and the speed of light in a medium is `c/n`. Neither is an independent
 * measurement and neither is listed as one: they are computed here from the registry entries they depend on, so
 * that updating ε₀ updates k without anybody having to remember to.
 *
 * Pure. No network, no clock, no storage.
 */

import { constantById, isConstantError, type Constant } from './constants.ts'

/**
 * Pull a constant out of the registry, or fail loudly at load time.
 *
 * A missing id here is a bug in Orbis, not something a Page can cause, so it throws rather than returning an error
 * shape — the alternative is every engine carrying a null check for a value that is either always there or never.
 */
function required(id: string): Constant {
  const found = constantById(id)
  if (isConstantError(found)) {
    throw new Error(`The constants registry has no "${id}", which the electromagnetism engines depend on.`)
  }
  return found
}

const EPSILON = required('vacuum-permittivity')
const MU = required('vacuum-permeability')
const LIGHT = required('speed-of-light')
const CHARGE = required('elementary-charge')
const ELECTRON = required('electron-mass')
const PROTON = required('proton-mass')
const NEUTRON = required('neutron-mass')
const PLANCK = required('planck')
const REDUCED = required('reduced-planck')
const BOLTZMANN = required('boltzmann')
const AVOGADRO = required('avogadro')
const GAS = required('gas-constant')
const STEFAN = required('stefan-boltzmann')
const ATOMIC_MASS = required('atomic-mass')
const RYDBERG = required('rydberg')
const BOHR_RADIUS = required('bohr-radius')
const FINE_STRUCTURE = required('fine-structure')
const FARADAY = required('faraday')
const ATMOSPHERE = required('standard-atmosphere')
const GRAVITY = required('standard-gravity')
const ABSOLUTE_ZERO = required('absolute-zero-celsius')

/** F/m. */
export const VACUUM_PERMITTIVITY = EPSILON.value
/** N/A². */
export const VACUUM_PERMEABILITY = MU.value
/** m/s, exact by definition. */
export const SPEED_OF_LIGHT = LIGHT.value
/** Coulombs, exact by definition. */
export const ELEMENTARY_CHARGE = CHARGE.value
/** kg. */
export const ELECTRON_MASS = ELECTRON.value
/** kg. */
export const PROTON_MASS = PROTON.value
/** kg. */
export const NEUTRON_MASS = NEUTRON.value
/** J·s, exact by definition. */
export const PLANCK_CONSTANT = PLANCK.value
/** J·s. */
export const REDUCED_PLANCK = REDUCED.value
/** J/K, exact by definition. */
export const BOLTZMANN_CONSTANT = BOLTZMANN.value
/** per mole, exact by definition. */
export const AVOGADRO_CONSTANT = AVOGADRO.value
/** J/(mol·K). */
export const GAS_CONSTANT = GAS.value
/** W/(m²·K⁴). */
export const STEFAN_BOLTZMANN = STEFAN.value
/** kg. One unified atomic mass unit. */
export const ATOMIC_MASS_UNIT = ATOMIC_MASS.value
/** per metre. */
export const RYDBERG_CONSTANT = RYDBERG.value
/** metres. */
export const BOHR_RADIUS_VALUE = BOHR_RADIUS.value
/** Dimensionless. */
export const FINE_STRUCTURE_CONSTANT = FINE_STRUCTURE.value
/** C/mol. */
export const FARADAY_CONSTANT = FARADAY.value
/** Pascals, exact by definition. */
export const STANDARD_ATMOSPHERE = ATMOSPHERE.value
/** m/s², agreed rather than measured. */
export const STANDARD_GRAVITY = GRAVITY.value
/** Degrees Celsius. */
export const ABSOLUTE_ZERO_CELSIUS = ABSOLUTE_ZERO.value

/**
 * Coulomb's constant, N·m²/C².
 *
 * Derived from ε₀ rather than listed separately, so there is one permittivity in Orbis and not two that drift.
 */
export const COULOMB_CONSTANT = 1 / (4 * Math.PI * VACUUM_PERMITTIVITY)

/** eV in joules. Numerically the elementary charge, which is why it is defined here and not measured again. */
export const ELECTRON_VOLT = ELEMENTARY_CHARGE

/** Ohms. The impedance of free space, √(μ₀/ε₀). */
export const IMPEDANCE_OF_FREE_SPACE = Math.sqrt(VACUUM_PERMEABILITY / VACUUM_PERMITTIVITY)

/** Pascals. The reference sound pressure for dB SPL in air, by convention rather than by measurement. */
export const REFERENCE_SOUND_PRESSURE = 20e-6

/** W/m². The reference sound intensity for dB, by convention. */
export const REFERENCE_SOUND_INTENSITY = 1e-12

/**
 * Where each value came from, so a Page can show provenance without reaching into the registry itself.
 *
 * The derived entries name what they are derived from instead of a source, because attributing `1/(4πε₀)` to
 * CODATA would be attributing an arithmetic step to a measurement campaign.
 */
export interface ConstantUse {
  symbol: string
  name: string
  value: number
  unit: string
  source: string
  uncertainty: number
  derivedFrom: string | null
}

const use = (one: Constant): ConstantUse => ({
  symbol: one.symbol,
  name: one.name,
  value: one.value,
  unit: one.unit,
  source: one.source,
  uncertainty: one.uncertainty,
  derivedFrom: one.definedBy
})

export const EM_CONSTANT_PROVENANCE: readonly ConstantUse[] = Object.freeze([
  use(EPSILON),
  use(MU),
  use(LIGHT),
  use(CHARGE),
  use(ELECTRON),
  use(PROTON),
  use(NEUTRON),
  use(PLANCK),
  use(REDUCED),
  use(BOLTZMANN),
  use(AVOGADRO),
  use(GAS),
  use(STEFAN),
  use(ATOMIC_MASS),
  use(RYDBERG),
  use(BOHR_RADIUS),
  use(FINE_STRUCTURE),
  use(FARADAY),
  Object.freeze({
    symbol: 'k',
    name: "Coulomb's constant",
    value: COULOMB_CONSTANT,
    unit: 'N*m^2/C^2',
    source: 'Derived',
    uncertainty: 0,
    derivedFrom: '1/(4*pi*epsilon_0)'
  }),
  Object.freeze({
    symbol: 'Z₀',
    name: 'Impedance of free space',
    value: IMPEDANCE_OF_FREE_SPACE,
    unit: 'ohm',
    source: 'Derived',
    uncertainty: 0,
    derivedFrom: 'sqrt(mu_0/epsilon_0)'
  }),
  Object.freeze({
    symbol: 'p₀',
    name: 'Reference sound pressure',
    value: REFERENCE_SOUND_PRESSURE,
    unit: 'Pa',
    source: 'Convention (ISO 1683)',
    uncertainty: 0,
    derivedFrom: null
  }),
  Object.freeze({
    symbol: 'I₀',
    name: 'Reference sound intensity',
    value: REFERENCE_SOUND_INTENSITY,
    unit: 'W/m^2',
    source: 'Convention (ISO 1683)',
    uncertainty: 0,
    derivedFrom: null
  })
])
