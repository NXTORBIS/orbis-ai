/**
 * Engineering materials: what they are made of, what they can take, and where each number came from.
 *
 * The shared material database for Orbis Pages. Every property carries a source and a condition, because a
 * material property without those is a number pretending to be a fact.
 *
 * ## Why every property has a condition attached
 *
 * Steel's yield strength at 20 °C and at 600 °C differ by more than half. Aluminium creeps at temperatures where
 * steel does not notice. A modulus measured along the grain of timber is twenty times the one across it. So a
 * property here is not a number — it is a number, a unit, a condition it was measured under, and where it was
 * published. A Page that shows only the number is showing the least useful quarter of what it was given.
 *
 * ## What this database refuses to do
 *
 * It refuses to invent. A material with no published fatigue data returns nothing for fatigue rather than a
 * plausible-looking figure, because a fabricated allowable is worse than a missing one: the missing one stops
 * somebody, and the fabricated one does not.
 *
 * It also refuses to be a design code. These are typical published values for named grades, not the characteristic
 * or factored values a standard would require, and nothing here has a partial safety factor already applied.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * yield        vs  ultimate strength  -- where it stops springing back against where it breaks
 * stiffness    vs  strength           -- how much it bends against how much it takes; unrelated properties
 * density      vs  specific weight    -- mass per volume against force per volume
 * typical      vs  minimum specified  -- what a sample gave against what a supplier guarantees
 * isotropic    vs  directional        -- one number against a different number along each axis
 * ```
 *
 * Pure. No network, no clock, no storage.
 */

export interface MaterialError {
  error: 'unknown-material' | 'unknown-property' | 'no-data' | 'invalid-argument' | 'outside-range'
  message: string
}

export const isMaterialError = (value: unknown): value is MaterialError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: MaterialError['error'], message: string): MaterialError => ({ error, message })

// ---------------------------------------------------------------- the shape of a property

/**
 * One measured property, with everything needed to know whether it applies.
 *
 * `condition` is not documentation. It is the answer to "does this number apply to my problem", and a Page that
 * hides it has turned a conditional measurement into an unconditional claim.
 */
export interface Property {
  value: number
  unit: string
  /** What it was measured at, or under. Empty only when the property genuinely does not depend on anything. */
  condition: string
  source: string
  /** Typical published value, a specified minimum, or a range midpoint — they are different guarantees. */
  kind: 'typical' | 'minimum-specified' | 'range-midpoint' | 'nominal'
  /** Present when the source gave a spread rather than a single figure. */
  range?: { low: number; high: number }
}

const property = (one: Property): Property => Object.freeze(one)

export type MaterialClass =
  | 'metal'
  | 'polymer'
  | 'ceramic'
  | 'composite'
  | 'construction'
  | 'timber'
  | 'fluid'

export const MATERIAL_CLASSES: readonly MaterialClass[] = Object.freeze([
  'metal',
  'polymer',
  'ceramic',
  'composite',
  'construction',
  'timber',
  'fluid'
])

/** The property names this database uses. A Page asking for anything else gets a refusal naming these. */
export type PropertyName =
  | 'density'
  | 'youngsModulus'
  | 'shearModulus'
  | 'poissonRatio'
  | 'yieldStrength'
  | 'ultimateStrength'
  | 'compressiveStrength'
  | 'thermalConductivity'
  | 'specificHeat'
  | 'thermalExpansion'
  | 'electricalResistivity'
  | 'meltingPoint'
  | 'fatigueLimit'
  | 'fractureToughness'

export const PROPERTY_NAMES: readonly PropertyName[] = Object.freeze([
  'density',
  'youngsModulus',
  'shearModulus',
  'poissonRatio',
  'yieldStrength',
  'ultimateStrength',
  'compressiveStrength',
  'thermalConductivity',
  'specificHeat',
  'thermalExpansion',
  'electricalResistivity',
  'meltingPoint',
  'fatigueLimit',
  'fractureToughness'
])

export const PROPERTY_FACTS: Readonly<
  Record<PropertyName, { label: string; unit: string; describe: string }>
> = Object.freeze({
  density: { label: 'Density', unit: 'kg/m^3', describe: 'Mass per unit volume.' },
  youngsModulus: {
    label: "Young's modulus",
    unit: 'Pa',
    describe: 'How stiff it is: stress divided by strain while it still springs back. Nothing to do with strength.'
  },
  shearModulus: { label: 'Shear modulus', unit: 'Pa', describe: 'Stiffness against twisting rather than stretching.' },
  poissonRatio: {
    label: "Poisson's ratio",
    unit: '',
    describe: 'How much it thins sideways when you stretch it. Dimensionless, and for ordinary materials between 0 and 0.5.'
  },
  yieldStrength: {
    label: 'Yield strength',
    unit: 'Pa',
    describe: 'Where it stops springing back. Past this the deformation stays.'
  },
  ultimateStrength: {
    label: 'Ultimate tensile strength',
    unit: 'Pa',
    describe: 'The highest stress it carries before it breaks. Always at or above yield.'
  },
  compressiveStrength: {
    label: 'Compressive strength',
    unit: 'Pa',
    describe: 'How much squeezing it takes. For concrete and brick this is the number that matters; for steel it is roughly the tensile one.'
  },
  thermalConductivity: { label: 'Thermal conductivity', unit: 'W/(m*K)', describe: 'How readily heat passes through.' },
  specificHeat: { label: 'Specific heat capacity', unit: 'J/(kg*K)', describe: 'Energy to raise one kilogram by one kelvin.' },
  thermalExpansion: {
    label: 'Coefficient of thermal expansion',
    unit: '1/K',
    describe: 'Fractional length change per kelvin. Small numbers with large consequences over long spans.'
  },
  electricalResistivity: { label: 'Electrical resistivity', unit: 'ohm*m', describe: 'How strongly it resists current.' },
  meltingPoint: { label: 'Melting point', unit: 'K', describe: 'Where it becomes liquid. Alloys melt over a range rather than at a point.' },
  fatigueLimit: {
    label: 'Fatigue limit',
    unit: 'Pa',
    describe:
      'The stress amplitude it survives indefinitely under repeated loading. Steels have one; aluminium alloys do not, and their quoted figure is at a stated number of cycles instead.'
  },
  fractureToughness: {
    label: 'Fracture toughness',
    unit: 'Pa*m^0.5',
    describe: 'How large a crack it tolerates before the crack runs. The property that decides whether a flaw matters.'
  }
})

export interface Material {
  id: string
  name: string
  materialClass: MaterialClass
  /** A one-line description of what it is and what it is for. */
  describe: string
  /** Not every material has every property. Missing means no published value, not zero. */
  properties: Readonly<Partial<Record<PropertyName, Property>>>
  /** What a Page should say beside a number from this material. */
  notes: readonly string[]
}

const material = (one: Material): Material => Object.freeze(one)

const ROOM = 'At 20 C'

// ---------------------------------------------------------------- the database

/**
 * The materials this engine knows.
 *
 * Typical published values for named grades, from engineering handbooks. They are starting points for analysis, not
 * the characteristic values a design code specifies and not a substitute for a supplier's certificate.
 */
export const MATERIALS: readonly Material[] = Object.freeze([
  material({
    id: 'steel-mild',
    name: 'Mild steel (AISI 1018)',
    materialClass: 'metal',
    describe: 'Low-carbon structural steel. Cheap, weldable, ductile, and rusts without protection.',
    properties: Object.freeze({
      density: property({ value: 7870, unit: 'kg/m^3', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 205e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      shearModulus: property({ value: 80e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.29, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      yieldStrength: property({
        value: 370e6,
        unit: 'Pa',
        condition: 'At 20 C, cold-drawn',
        source: 'ASM Metals Handbook',
        kind: 'typical',
        range: { low: 250e6, high: 400e6 }
      }),
      ultimateStrength: property({
        value: 440e6,
        unit: 'Pa',
        condition: 'At 20 C, cold-drawn',
        source: 'ASM Metals Handbook',
        kind: 'typical'
      }),
      thermalConductivity: property({ value: 51.9, unit: 'W/(m*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      specificHeat: property({ value: 486, unit: 'J/(kg*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 11.5e-6, unit: '1/K', condition: '20-100 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      electricalResistivity: property({ value: 1.59e-7, unit: 'ohm*m', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      meltingPoint: property({ value: 1723, unit: 'K', condition: 'Solidus', source: 'ASM Metals Handbook', kind: 'nominal' }),
      fatigueLimit: property({
        value: 210e6,
        unit: 'Pa',
        condition: 'Fully reversed bending, polished specimen',
        source: 'Shigley, Mechanical Engineering Design',
        kind: 'typical'
      })
    }),
    notes: Object.freeze([
      'Steel has a genuine fatigue limit: below it the part survives indefinitely. Aluminium does not, which is why the two cannot be compared on fatigue with one number each.',
      'The quoted fatigue limit is for a polished laboratory specimen. A real surface finish, size and stress concentration all reduce it.'
    ])
  }),
  material({
    id: 'steel-stainless-304',
    name: 'Stainless steel 304',
    materialClass: 'metal',
    describe: 'Austenitic stainless. Corrosion-resistant, non-magnetic as annealed, and work-hardens readily.',
    properties: Object.freeze({
      density: property({ value: 8000, unit: 'kg/m^3', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 193e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      shearModulus: property({ value: 77e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.29, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      yieldStrength: property({ value: 215e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'minimum-specified' }),
      ultimateStrength: property({ value: 505e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'minimum-specified' }),
      thermalConductivity: property({ value: 16.2, unit: 'W/(m*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      specificHeat: property({ value: 500, unit: 'J/(kg*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 17.3e-6, unit: '1/K', condition: '0-100 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      electricalResistivity: property({ value: 7.2e-7, unit: 'ohm*m', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      meltingPoint: property({ value: 1673, unit: 'K', condition: 'Solidus', source: 'ASM Metals Handbook', kind: 'nominal' })
    }),
    notes: Object.freeze([
      'Conducts heat about a third as well as mild steel, which is why stainless pans have copper or aluminium bases.',
      'It expands half again as much as mild steel for the same temperature rise — a real problem in mixed assemblies.'
    ])
  }),
  material({
    id: 'aluminium-6061-t6',
    name: 'Aluminium 6061-T6',
    materialClass: 'metal',
    describe: 'The general-purpose structural aluminium. Light, weldable, corrosion-resistant, heat-treated to T6.',
    properties: Object.freeze({
      density: property({ value: 2700, unit: 'kg/m^3', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 68.9e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      shearModulus: property({ value: 26e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.33, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      yieldStrength: property({ value: 276e6, unit: 'Pa', condition: 'T6 temper, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      ultimateStrength: property({ value: 310e6, unit: 'Pa', condition: 'T6 temper, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalConductivity: property({ value: 167, unit: 'W/(m*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      specificHeat: property({ value: 896, unit: 'J/(kg*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 23.6e-6, unit: '1/K', condition: '20-100 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      electricalResistivity: property({ value: 3.99e-8, unit: 'ohm*m', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      meltingPoint: property({ value: 855, unit: 'K', condition: 'Solidus', source: 'ASM Metals Handbook', kind: 'nominal' }),
      fatigueLimit: property({
        value: 96.5e6,
        unit: 'Pa',
        condition: 'At 5x10^8 cycles, fully reversed',
        source: 'ASM Metals Handbook',
        kind: 'typical'
      })
    }),
    notes: Object.freeze([
      'Aluminium has no true fatigue limit. The figure here is the strength at a stated number of cycles, not a stress it survives for ever — the distinction matters for anything that runs a long time.',
      'A third the stiffness of steel and a third the density, so an aluminium beam of the same mass is stiffer than a steel one of the same shape only because it can be made thicker.',
      'Welding 6061-T6 softens the heat-affected zone back toward the annealed strength. The as-welded joint is not a T6 joint.'
    ])
  }),
  material({
    id: 'titanium-ti6al4v',
    name: 'Titanium Ti-6Al-4V',
    materialClass: 'metal',
    describe: 'The workhorse titanium alloy. High strength-to-weight, corrosion-resistant, expensive and hard to machine.',
    properties: Object.freeze({
      density: property({ value: 4430, unit: 'kg/m^3', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 113.8e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      shearModulus: property({ value: 44e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.342, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      yieldStrength: property({ value: 880e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      ultimateStrength: property({ value: 950e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalConductivity: property({ value: 6.7, unit: 'W/(m*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      specificHeat: property({ value: 526, unit: 'J/(kg*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 8.6e-6, unit: '1/K', condition: '20-100 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      meltingPoint: property({ value: 1877, unit: 'K', condition: 'Solidus', source: 'ASM Metals Handbook', kind: 'nominal' })
    }),
    notes: Object.freeze([
      'Conducts heat very poorly for a metal, which is exactly why it is hard to machine: the cutting heat stays in the tool.'
    ])
  }),
  material({
    id: 'copper',
    name: 'Copper (annealed)',
    materialClass: 'metal',
    describe: 'The electrical conductor of choice. Soft, ductile, and second only to silver for conductivity.',
    properties: Object.freeze({
      density: property({ value: 8960, unit: 'kg/m^3', condition: ROOM, source: 'CRC Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 117e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      shearModulus: property({ value: 45e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.34, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      yieldStrength: property({ value: 70e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      ultimateStrength: property({ value: 220e6, unit: 'Pa', condition: 'Annealed, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalConductivity: property({ value: 401, unit: 'W/(m*K)', condition: ROOM, source: 'CRC Handbook', kind: 'typical' }),
      specificHeat: property({ value: 385, unit: 'J/(kg*K)', condition: ROOM, source: 'CRC Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 16.5e-6, unit: '1/K', condition: '20-100 C', source: 'CRC Handbook', kind: 'typical' }),
      electricalResistivity: property({ value: 1.68e-8, unit: 'ohm*m', condition: ROOM, source: 'CRC Handbook', kind: 'typical' }),
      meltingPoint: property({ value: 1358, unit: 'K', condition: 'Melting point', source: 'CRC Handbook', kind: 'nominal' })
    }),
    notes: Object.freeze([
      'Annealed copper is soft. Work-hardening raises the yield several times over, which is why drawn wire is stiffer than the same copper cast.'
    ])
  }),
  material({
    id: 'cast-iron-grey',
    name: 'Grey cast iron (ASTM A48 Class 30)',
    materialClass: 'metal',
    describe: 'Cheap, castable, damps vibration well, and is far stronger in compression than in tension.',
    properties: Object.freeze({
      density: property({ value: 7150, unit: 'kg/m^3', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      youngsModulus: property({ value: 100e9, unit: 'Pa', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      poissonRatio: property({ value: 0.26, unit: '', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      ultimateStrength: property({ value: 214e6, unit: 'Pa', condition: 'Tension, 20 C', source: 'ASTM A48', kind: 'minimum-specified' }),
      compressiveStrength: property({ value: 752e6, unit: 'Pa', condition: 'Compression, 20 C', source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalConductivity: property({ value: 46, unit: 'W/(m*K)', condition: ROOM, source: 'ASM Metals Handbook', kind: 'typical' }),
      thermalExpansion: property({ value: 10.8e-6, unit: '1/K', condition: '20-100 C', source: 'ASM Metals Handbook', kind: 'typical' })
    }),
    notes: Object.freeze([
      'No yield strength is listed because grey iron barely has one: it is brittle and breaks with almost no permanent stretch. Using an ultimate strength where a yield belongs is wrong here in a way it is not for steel.',
      'It takes about three and a half times more in compression than in tension. A design that treats the two as equal will be badly wrong one way or the other.'
    ])
  }),
  material({
    id: 'concrete-c30',
    name: 'Concrete C30/37',
    materialClass: 'construction',
    describe: 'Ordinary structural concrete. Strong in compression, negligible in tension, which is why it is reinforced.',
    properties: Object.freeze({
      density: property({ value: 2400, unit: 'kg/m^3', condition: 'Normal weight, reinforced', source: 'Eurocode 2', kind: 'nominal' }),
      youngsModulus: property({ value: 33e9, unit: 'Pa', condition: 'Secant modulus at 28 days', source: 'Eurocode 2', kind: 'typical' }),
      poissonRatio: property({ value: 0.2, unit: '', condition: 'Uncracked', source: 'Eurocode 2', kind: 'nominal' }),
      compressiveStrength: property({
        value: 30e6,
        unit: 'Pa',
        condition: 'Characteristic cylinder strength at 28 days',
        source: 'Eurocode 2',
        kind: 'minimum-specified'
      }),
      ultimateStrength: property({
        value: 2.9e6,
        unit: 'Pa',
        condition: 'Mean axial tensile strength at 28 days',
        source: 'Eurocode 2',
        kind: 'typical'
      }),
      thermalConductivity: property({ value: 1.7, unit: 'W/(m*K)', condition: ROOM, source: 'CIBSE Guide A', kind: 'typical' }),
      specificHeat: property({ value: 880, unit: 'J/(kg*K)', condition: ROOM, source: 'CIBSE Guide A', kind: 'typical' }),
      thermalExpansion: property({ value: 10e-6, unit: '1/K', condition: 'Normal weight', source: 'Eurocode 2', kind: 'nominal' })
    }),
    notes: Object.freeze([
      'Tensile strength is about a tenth of compressive. Structural design normally assumes concrete carries no tension at all, and the steel carries it instead.',
      'The 30 in C30/37 is the characteristic cylinder strength in MPa and the 37 is the cube strength. They describe the same concrete tested two ways.',
      'These are characteristic values. A design code then divides by a partial safety factor; nothing here has had that applied.'
    ])
  }),
  material({
    id: 'timber-softwood-c24',
    name: 'Structural softwood C24',
    materialClass: 'timber',
    describe: 'Graded construction softwood. Strong along the grain, weak across it, and the difference is enormous.',
    properties: Object.freeze({
      density: property({ value: 420, unit: 'kg/m^3', condition: 'Mean, 12% moisture', source: 'EN 338', kind: 'typical' }),
      youngsModulus: property({
        value: 11e9,
        unit: 'Pa',
        condition: 'Mean, parallel to grain, 12% moisture',
        source: 'EN 338',
        kind: 'typical'
      }),
      yieldStrength: property({
        value: 24e6,
        unit: 'Pa',
        condition: 'Characteristic bending strength, parallel to grain',
        source: 'EN 338',
        kind: 'minimum-specified'
      }),
      compressiveStrength: property({
        value: 21e6,
        unit: 'Pa',
        condition: 'Characteristic, parallel to grain',
        source: 'EN 338',
        kind: 'minimum-specified'
      }),
      thermalConductivity: property({ value: 0.13, unit: 'W/(m*K)', condition: 'Across grain, 12% moisture', source: 'CIBSE Guide A', kind: 'typical' })
    }),
    notes: Object.freeze([
      'Every strength here is along the grain. Across the grain timber is roughly a twentieth as strong, and a Page that applies one number in both directions is wrong by that factor.',
      'Strength and stiffness fall as moisture content rises. These are at 12%, which is dry indoor service.',
      'Timber creeps under sustained load. A deflection calculated from the instantaneous modulus understates what the beam does over years.'
    ])
  }),
  material({
    id: 'abs',
    name: 'ABS plastic',
    materialClass: 'polymer',
    describe: 'Tough general-purpose thermoplastic. Easy to machine and print, softens well below boiling water.',
    properties: Object.freeze({
      density: property({ value: 1050, unit: 'kg/m^3', condition: ROOM, source: 'MatWeb typical', kind: 'typical' }),
      youngsModulus: property({ value: 2.3e9, unit: 'Pa', condition: ROOM, source: 'MatWeb typical', kind: 'typical' }),
      poissonRatio: property({ value: 0.35, unit: '', condition: ROOM, source: 'MatWeb typical', kind: 'typical' }),
      yieldStrength: property({ value: 43e6, unit: 'Pa', condition: 'Tensile yield, 20 C', source: 'MatWeb typical', kind: 'typical' }),
      thermalConductivity: property({ value: 0.17, unit: 'W/(m*K)', condition: ROOM, source: 'MatWeb typical', kind: 'typical' }),
      thermalExpansion: property({ value: 90e-6, unit: '1/K', condition: '20-100 C', source: 'MatWeb typical', kind: 'typical' })
    }),
    notes: Object.freeze([
      'It expands about eight times as much as steel per degree. In a mixed assembly that is usually what fails first.',
      'Polymer properties depend strongly on temperature, loading rate and moisture. A single room-temperature figure is a much rougher guide than the equivalent for a metal.'
    ])
  }),
  material({
    id: 'cfrp-unidirectional',
    name: 'Carbon fibre / epoxy (unidirectional)',
    materialClass: 'composite',
    describe: 'Very stiff and strong along the fibres, and ordinary across them. Directional by construction.',
    properties: Object.freeze({
      density: property({ value: 1600, unit: 'kg/m^3', condition: '60% fibre volume fraction', source: 'Composite handbook typical', kind: 'typical' }),
      youngsModulus: property({
        value: 135e9,
        unit: 'Pa',
        condition: 'Along fibres, 60% fibre volume fraction',
        source: 'Composite handbook typical',
        kind: 'typical'
      }),
      ultimateStrength: property({
        value: 1500e6,
        unit: 'Pa',
        condition: 'Tension along fibres, 60% fibre volume fraction',
        source: 'Composite handbook typical',
        kind: 'typical'
      })
    }),
    notes: Object.freeze([
      'These are along the fibres only. Across them the modulus is around 10 GPa and the strength around 50 MPa — an order of magnitude and more apart.',
      'A single number for a composite is meaningless without a direction and a layup. Treat these as the best case, not the property.'
    ])
  }),
  material({
    id: 'alumina',
    name: 'Alumina (99.5% Al2O3)',
    materialClass: 'ceramic',
    describe: 'Engineering ceramic. Very hard and stiff, excellent insulator, and brittle.',
    properties: Object.freeze({
      density: property({ value: 3890, unit: 'kg/m^3', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      youngsModulus: property({ value: 375e9, unit: 'Pa', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      poissonRatio: property({ value: 0.22, unit: '', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      compressiveStrength: property({ value: 2600e6, unit: 'Pa', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      ultimateStrength: property({ value: 260e6, unit: 'Pa', condition: 'Flexural, 20 C', source: 'Ceramic handbook typical', kind: 'typical' }),
      thermalConductivity: property({ value: 35, unit: 'W/(m*K)', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      thermalExpansion: property({ value: 8.1e-6, unit: '1/K', condition: '20-1000 C', source: 'Ceramic handbook typical', kind: 'typical' }),
      electricalResistivity: property({ value: 1e14, unit: 'ohm*m', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' }),
      fractureToughness: property({ value: 4e6, unit: 'Pa*m^0.5', condition: ROOM, source: 'Ceramic handbook typical', kind: 'typical' })
    }),
    notes: Object.freeze([
      'Ten times stronger in compression than in bending. Ceramics fail from flaws in tension, so the tensile figure scales with the size of the part and the quality of its surface.',
      'The fracture toughness is roughly a fiftieth of steel. That single number is why ceramics chip rather than dent.'
    ])
  })
])

// ---------------------------------------------------------------- lookup

export function materialById(id: string): Material | MaterialError {
  const wanted = id.trim().toLowerCase()
  const found =
    MATERIALS.find((one) => one.id === wanted) ??
    MATERIALS.find((one) => one.name.toLowerCase() === wanted) ??
    MATERIALS.find((one) => one.name.toLowerCase().includes(wanted) || one.id.includes(wanted))
  if (found) return found
  return fail(
    'unknown-material',
    `There is no material called "${id}" in the library. Give the properties directly, or pick one of: ${MATERIALS.map((one) => one.id).join(', ')}.`
  )
}

export function materialsOfClass(materialClass: MaterialClass): readonly Material[] {
  return Object.freeze(MATERIALS.filter((one) => one.materialClass === materialClass))
}

export interface PropertyLookup {
  material: string
  materialName: string
  propertyName: PropertyName
  label: string
  describe: string
  value: number
  unit: string
  condition: string
  source: string
  kind: Property['kind']
  range: { low: number; high: number } | null
  notes: readonly string[]
}

/**
 * One property of one material, with the condition and the source it came from.
 *
 * A missing property comes back as a refusal naming what the material does have, rather than as zero or as a
 * plausible value for a similar material. The whole point of a provenance-carrying database is that it can say "I
 * do not know" — and it has to actually say it.
 */
export function propertyOf(materialId: string, propertyName: string): PropertyLookup | MaterialError {
  const found = materialById(materialId)
  if (isMaterialError(found)) return found
  if (!PROPERTY_NAMES.includes(propertyName as PropertyName)) {
    return fail('unknown-property', `"${propertyName}" is not a property this database holds. It holds: ${PROPERTY_NAMES.join(', ')}.`)
  }
  const name = propertyName as PropertyName
  const value = found.properties[name]
  if (!value) {
    const has = Object.keys(found.properties).join(', ')
    return fail(
      'no-data',
      `${found.name} has no published ${PROPERTY_FACTS[name].label.toLowerCase()} in this library. It has: ${has}. A number invented to fill the gap would be worse than this refusal.`
    )
  }
  return {
    material: found.id,
    materialName: found.name,
    propertyName: name,
    label: PROPERTY_FACTS[name].label,
    describe: PROPERTY_FACTS[name].describe,
    value: value.value,
    unit: value.unit,
    condition: value.condition,
    source: value.source,
    kind: value.kind,
    range: value.range ?? null,
    notes: found.notes
  }
}

export interface ComparisonRow {
  material: string
  materialName: string
  value: number | null
  unit: string
  condition: string | null
  source: string | null
}

export interface ComparisonReport {
  propertyName: PropertyName
  label: string
  unit: string
  rows: readonly ComparisonRow[]
  /** Only the materials that actually had the property, ordered largest first. */
  ranked: readonly ComparisonRow[]
  missing: readonly string[]
  notes: readonly string[]
}

/** Compare one property across materials, with the ones that have no value listed rather than dropped. */
export function compareProperty(materialIds: readonly string[], propertyName: string): ComparisonReport | MaterialError {
  if (materialIds.length === 0) return fail('invalid-argument', 'There are no materials to compare.')
  if (materialIds.length > 32) return fail('invalid-argument', 'That is more than the 32 materials this compares at once.')
  if (!PROPERTY_NAMES.includes(propertyName as PropertyName)) {
    return fail('unknown-property', `"${propertyName}" is not a property this database holds. It holds: ${PROPERTY_NAMES.join(', ')}.`)
  }
  const name = propertyName as PropertyName

  const rows: ComparisonRow[] = []
  const missing: string[] = []
  for (const id of materialIds) {
    const found = materialById(id)
    if (isMaterialError(found)) return found
    const value = found.properties[name]
    if (!value) {
      missing.push(found.name)
      rows.push({ material: found.id, materialName: found.name, value: null, unit: PROPERTY_FACTS[name].unit, condition: null, source: null })
      continue
    }
    rows.push({
      material: found.id,
      materialName: found.name,
      value: value.value,
      unit: value.unit,
      condition: value.condition,
      source: value.source
    })
  }

  const withValues = rows.filter((one) => one.value !== null)
  const notes: string[] = [PROPERTY_FACTS[name].describe]
  if (missing.length > 0) {
    notes.push(
      `${missing.join(' and ')} ${missing.length === 1 ? 'has' : 'have'} no published value for this property here, and ${missing.length === 1 ? 'is' : 'are'} listed as blank rather than as zero.`
    )
  }
  const conditions = new Set(withValues.map((one) => one.condition))
  if (conditions.size > 1) {
    notes.push('These were not all measured under the same conditions. Compare the condition column before comparing the numbers.')
  }

  return {
    propertyName: name,
    label: PROPERTY_FACTS[name].label,
    unit: PROPERTY_FACTS[name].unit,
    rows: Object.freeze(rows),
    ranked: Object.freeze([...withValues].sort((a, b) => (b.value as number) - (a.value as number))),
    missing: Object.freeze(missing),
    notes: Object.freeze(notes)
  }
}

// ---------------------------------------------------------------- derived relationships

export interface ElasticReport {
  youngsModulus: number
  shearModulus: number
  bulkModulus: number
  poissonRatio: number
  /** Which two were given and which were worked out from them. */
  given: readonly string[]
  derived: readonly string[]
  notes: readonly string[]
}

/**
 * The elastic constants, from any two of them.
 *
 * An isotropic material has exactly two independent elastic constants. Giving three over-specifies it, and a set
 * that does not satisfy `G = E/(2(1+v))` describes no real material — so three are refused rather than two of them
 * silently preferred.
 */
export function elasticConstants(input: {
  youngsModulus?: number
  shearModulus?: number
  bulkModulus?: number
  poissonRatio?: number
}): ElasticReport | MaterialError {
  const given = (['youngsModulus', 'shearModulus', 'bulkModulus', 'poissonRatio'] as const).filter(
    (one) => input[one] !== undefined
  )
  if (given.length < 2) {
    return fail(
      'invalid-argument',
      'An isotropic material has two independent elastic constants. Give any two and the rest follow; one leaves it undetermined.'
    )
  }
  if (given.length > 2) {
    return fail(
      'invalid-argument',
      `Give exactly two. ${given.length} over-specifies it, and a set that does not satisfy G = E/(2(1+v)) describes no real material — silently discarding one would answer a question nobody asked.`
    )
  }
  for (const name of given) {
    const value = input[name] as number
    if (!Number.isFinite(value)) return fail('invalid-argument', `"${name}" has to be a finite number.`)
    if (name !== 'poissonRatio' && value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (input.poissonRatio !== undefined && (input.poissonRatio <= -1 || input.poissonRatio >= 0.5)) {
    return fail(
      'outside-range',
      "Poisson's ratio has to lie between -1 and 0.5. Above 0.5 the material would gain volume when compressed, which nothing does."
    )
  }

  let e = input.youngsModulus
  let g = input.shearModulus
  let k = input.bulkModulus
  let v = input.poissonRatio

  if (e !== undefined && v !== undefined) {
    g = e / (2 * (1 + v))
    k = e / (3 * (1 - 2 * v))
  } else if (e !== undefined && g !== undefined) {
    v = e / (2 * g) - 1
    k = e / (3 * (1 - 2 * v))
  } else if (e !== undefined && k !== undefined) {
    v = (3 * k - e) / (6 * k)
    g = e / (2 * (1 + v))
  } else if (g !== undefined && v !== undefined) {
    e = 2 * g * (1 + v)
    k = e / (3 * (1 - 2 * v))
  } else if (k !== undefined && v !== undefined) {
    e = 3 * k * (1 - 2 * v)
    g = e / (2 * (1 + v))
  } else if (g !== undefined && k !== undefined) {
    e = (9 * k * g) / (3 * k + g)
    v = (3 * k - 2 * g) / (2 * (3 * k + g))
  }

  if (e === undefined || g === undefined || k === undefined || v === undefined) {
    return fail('invalid-argument', 'That pair of constants is not one this can work from.')
  }
  if (!Number.isFinite(e) || !Number.isFinite(g) || !Number.isFinite(k) || !Number.isFinite(v)) {
    return fail('invalid-argument', 'That combination gives a value that is not finite; check the inputs are physically possible.')
  }
  if (v <= -1 || v >= 0.5) {
    return fail(
      'outside-range',
      `Those constants imply a Poisson's ratio of ${v.toFixed(4)}, which is outside the range any ordinary material occupies. One of the inputs is wrong.`
    )
  }

  const derived = (['youngsModulus', 'shearModulus', 'bulkModulus', 'poissonRatio'] as const).filter(
    (one) => !given.includes(one)
  )
  return {
    youngsModulus: e,
    shearModulus: g,
    bulkModulus: k,
    poissonRatio: v,
    given,
    derived,
    notes: Object.freeze([
      'An isotropic material has two independent elastic constants. Everything else is arithmetic on those two.',
      "As Poisson's ratio approaches 0.5 the bulk modulus goes to infinity — the material becomes incompressible, which is what rubber nearly is."
    ])
  }
}

export interface MixtureReport {
  /** Along the fibres: the stiff direction, where the two phases strain together. */
  alongFibres: number
  /** Across them: the compliant direction, where the two phases carry the same stress. */
  acrossFibres: number
  fibreFraction: number
  matrixFraction: number
  ratio: number
  notes: readonly string[]
}

/**
 * The rule of mixtures for a fibre composite, both ways round.
 *
 * Along the fibres the phases strain together, so the moduli add in proportion. Across them the phases carry the
 * same stress, so the compliances add — and the answer is dominated by the soft one. Both are returned because a
 * composite quoted with one number has been quoted with the flattering one.
 */
export function ruleOfMixtures(input: {
  fibreModulus: number
  matrixModulus: number
  fibreVolumeFraction: number
}): MixtureReport | MaterialError {
  const { fibreModulus, matrixModulus, fibreVolumeFraction: vf } = input
  for (const [name, value] of Object.entries({ fibreModulus, matrixModulus })) {
    if (!Number.isFinite(value) || value <= 0) return fail('invalid-argument', `"${name}" has to be greater than zero.`)
  }
  if (!Number.isFinite(vf) || vf < 0 || vf > 1) {
    return fail('outside-range', 'The fibre volume fraction is a fraction, so it runs from 0 to 1.')
  }
  const vm = 1 - vf
  const along = fibreModulus * vf + matrixModulus * vm
  const across = 1 / (vf / fibreModulus + vm / matrixModulus)
  return {
    alongFibres: along,
    acrossFibres: across,
    fibreFraction: vf,
    matrixFraction: vm,
    ratio: across === 0 ? Number.POSITIVE_INFINITY : along / across,
    notes: Object.freeze([
      `Along the fibres it is ${(along / across).toFixed(1)} times stiffer than across them. Quoting one modulus for a composite hides that entirely.`,
      'The across-fibre value is dominated by the matrix however much fibre there is, because the load has to pass through the soft phase either way.',
      'This is the upper and lower bound. A real laminate with fibres in several directions sits between them.'
    ])
  }
}

/** Everything a Page should be able to show about what this database is standing on. */
export const MATERIAL_ASSUMPTIONS: readonly string[] = Object.freeze([
  'These are typical published values for named grades, not a supplier certificate and not a design code.',
  'No partial safety factor has been applied to anything here. A design standard applies its own.',
  'Every property carries the condition it was measured under. A value quoted outside that condition is not the same value.',
  'Composites and timber are directional. A single number for them is the value along one axis, and the other axes differ by an order of magnitude.',
  'A missing property means no published value in this library, not zero and not "about the same as something similar".'
])
