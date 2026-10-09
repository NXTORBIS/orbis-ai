import { declareAll, isParameterProblem, type Parameter, type ParameterSet } from './parameters.ts'
import type { ActionDeclaration, NativeAppManifest } from './manifest.ts'
import { CATEGORIES } from '../compute/chemistry.table.ts'
import { FLAME_TESTS } from '../compute/chemistry.solutions.ts'
import { FUNCTIONAL_GROUPS } from '../compute/chemistry.organic.ts'

/**
 * The Phase 6 Native Apps: chemistry.
 *
 * ## Five laboratories over engines Orbis mostly already had
 *
 * `chemistry.ts` could parse a formula, balance an equation and convert moles; `reactions.ts` could do
 * thermochemistry, equilibrium, rate laws, Arrhenius, cell potentials and electrolysis. None of it was reachable
 * from a conversation. What is new underneath is the complete 118-element table and the solutions engine — pH,
 * dilution, the gas law, and a titration curve that is solved rather than drawn.
 *
 * ## Every option list is read from its engine
 *
 * The element categories come from the table and the flame tests from the solutions engine, so a filter cannot
 * offer a category no element has and the flame tab cannot offer an ion the engine has never heard of.
 *
 * Pure.
 */

const RECOMPUTE: readonly ActionDeclaration[] = [
  { id: 'run', summary: 'Work it out with the current values', takes: [], idempotent: true, destructive: false },
  { id: 'reset', summary: 'Go back to the starting values', takes: [], idempotent: true, destructive: false }
]

type Declared = Omit<Parameter, 'value'> & { value?: Parameter['value'] }

// ---------------------------------------------------------------- the periodic table

const TABLE: readonly Declared[] = [
  {
    id: 'search',
    name: 'Find',
    kind: 'text',
    initial: '',
    about: 'A name, a symbol or an atomic number. What does not match is dimmed rather than removed, so the shape of the table never changes under you.',
    group: 'The table'
  },
  {
    id: 'category',
    name: 'Only show',
    kind: 'choice',
    initial: 'all',
    about: 'One family of elements, coloured the way the legend is.',
    options: [{ id: 'all', label: 'every element' }, ...CATEGORIES.map((one) => ({ id: one, label: one }))],
    group: 'The table'
  }
]

// ---------------------------------------------------------------- the calculator

const CALCULATOR: readonly Declared[] = [
  {
    id: 'formula',
    name: 'Formula',
    kind: 'text',
    initial: 'H2SO4',
    about: 'Written the ordinary way, with brackets if you need them: Ca(OH)2, CuSO4·5H2O.',
    group: 'What it is'
  },
  { id: 'grams', name: 'Mass', kind: 'number', initial: 10, about: 'In grams. Leave it at zero to go the other way, from moles.', unit: 'g', least: 0, most: 1_000_000, group: 'Amount' },
  { id: 'moles', name: 'Amount', kind: 'number', initial: 0.5, about: 'In moles.', unit: 'mol', least: 0, most: 1_000_000, group: 'Amount' },
  { id: 'litres', name: 'Volume', kind: 'number', initial: 2, about: 'Of solution, in litres — measured after dissolving, not before.', unit: 'L', least: 0.000001, most: 10_000, group: 'Amount' },
  {
    id: 'concentration',
    name: 'Concentration',
    kind: 'number',
    initial: 0.1,
    about: 'For the pH tab, in mol/L.',
    unit: 'mol/L',
    least: 0.0000000001,
    most: 20,
    group: 'Acid or base'
  },
  {
    id: 'acidKind',
    name: 'What it is',
    kind: 'choice',
    initial: 'strong-acid',
    about: 'A strong one is fully dissociated; a weak one needs its constant and is solved from the quadratic.',
    options: [
      { id: 'strong-acid', label: 'a strong acid — fully dissociated' },
      { id: 'weak-acid', label: 'a weak acid — needs its Ka' },
      { id: 'strong-base', label: 'a strong base' },
      { id: 'weak-base', label: 'a weak base — needs its Kb' }
    ],
    group: 'Acid or base'
  },
  { id: 'k', name: 'Ka or Kb', kind: 'number', initial: 0.000018, about: 'The dissociation constant. Acetic acid is 1.8e-5; ammonia is 1.8e-5 as a base.', least: 1e-14, most: 1, group: 'Acid or base' },
  { id: 'pressure', name: 'Pressure', kind: 'number', initial: 101325, about: 'In pascals. One atmosphere is 101,325 Pa.', unit: 'Pa', least: 1, most: 100_000_000, group: 'Gas' },
  { id: 'volume', name: 'Volume', kind: 'number', initial: 0.0224, about: 'In cubic metres. A litre is 0.001 m³.', unit: 'm^3', least: 0.0000001, most: 1000, group: 'Gas' },
  { id: 'temperature', name: 'Temperature', kind: 'number', initial: 273.15, about: 'In kelvin, because the gas law needs an absolute temperature. 25°C is 298.15 K.', unit: 'K', least: 0.1, most: 10_000, group: 'Gas' },
  { id: 'c1', name: 'Starting concentration', kind: 'number', initial: 1, about: 'Before the dilution.', unit: 'mol/L', least: 0, most: 1000, group: 'Dilution' },
  { id: 'v1', name: 'Starting volume', kind: 'number', initial: 0.1, about: 'How much of the concentrated solution you take.', unit: 'L', least: 0, most: 1000, group: 'Dilution' },
  { id: 'c2', name: 'Wanted concentration', kind: 'number', initial: 0.25, about: 'After the dilution. The final volume is worked out from it.', unit: 'mol/L', least: 0, most: 1000, group: 'Dilution' }
]

// ---------------------------------------------------------------- reactions

const REACTION: readonly Declared[] = [
  {
    id: 'equation',
    name: 'Equation',
    kind: 'text',
    initial: 'H2 + O2 -> H2O',
    about: 'Unbalanced is fine — that is the point. Use -> or = between the sides.',
    group: 'The reaction'
  },
  {
    id: 'reactants',
    name: 'What goes in',
    kind: 'text',
    initial: 'H2, 0, 130.7\nO2, 0, 205.2',
    about: 'One per line: formula, formation enthalpy in kJ/mol, entropy in J/(mol·K). An element in its standard state has a formation enthalpy of exactly zero, which is the convention everything else is measured against.',
    group: 'Energy'
  },
  {
    id: 'products',
    name: 'What comes out',
    kind: 'text',
    initial: 'H2O, -285.8, 69.9',
    about: 'The same three figures per line. These are liquid water; steam is −241.8.',
    group: 'Energy'
  },
  { id: 'temperature', name: 'Temperature', kind: 'number', initial: 298.15, about: 'In kelvin. 298.15 K is 25°C, the standard condition everything is tabulated at.', unit: 'K', least: 1, most: 6000, group: 'Energy' },
  { id: 'constant', name: 'Equilibrium constant', kind: 'number', initial: 4, about: 'K. Greater than one means the products are favoured.', least: 0.000000001, most: 1_000_000_000, group: 'How far' },
  {
    id: 'order',
    name: 'Order',
    kind: 'choice',
    initial: '1',
    about: 'How the rate depends on concentration. Fractional orders happen and are refused here, because their integrated forms differ.',
    options: [
      { id: '0', label: 'zero — the rate does not depend on how much is left' },
      { id: '1', label: 'first — the rate is proportional to what is left' },
      { id: '2', label: 'second — proportional to the square of what is left' }
    ],
    group: 'How fast'
  },
  { id: 'rateConstant', name: 'Rate constant k', kind: 'number', initial: 0.1, about: 'Its units depend on the order, which is why they are shown beside the answer.', least: 0.0000001, most: 1000, group: 'How fast' },
  { id: 'initialConcentration', name: 'Starting concentration', kind: 'number', initial: 1, about: 'In mol/L.', unit: 'mol/L', least: 0.0001, most: 100, group: 'How fast' },
  { id: 'duration', name: 'Run for', kind: 'number', initial: 50, about: 'How long to follow it, in seconds.', unit: 's', least: 0.1, most: 100_000, group: 'How fast' },
  { id: 'activationEnergy', name: 'Activation energy', kind: 'number', initial: 50, about: 'In kJ/mol. The hill the reaction has to get over.', unit: 'kJ/mol', least: 0, most: 1000, group: 'With temperature' },
  { id: 'preExponential', name: 'Pre-exponential factor', kind: 'number', initial: 10_000_000_000, about: 'A, in the same units as k. Roughly how often the molecules collide the right way round.', least: 1, most: 1e20, group: 'With temperature' }
]

// ---------------------------------------------------------------- electrochemistry

const HALF_CELL_OPTIONS = [
  { id: 'li', label: 'Li⁺ + e⁻ → Li  (−3.04 V)' },
  { id: 'zn', label: 'Zn²⁺ + 2e⁻ → Zn  (−0.76 V)' },
  { id: 'fe', label: 'Fe²⁺ + 2e⁻ → Fe  (−0.44 V)' },
  { id: 'ni', label: 'Ni²⁺ + 2e⁻ → Ni  (−0.25 V)' },
  { id: 'pb', label: 'Pb²⁺ + 2e⁻ → Pb  (−0.13 V)' },
  { id: 'h', label: '2H⁺ + 2e⁻ → H₂  (0 V, the reference)' },
  { id: 'cu', label: 'Cu²⁺ + 2e⁻ → Cu  (+0.34 V)' },
  { id: 'ag', label: 'Ag⁺ + e⁻ → Ag  (+0.80 V)' },
  { id: 'cl', label: 'Cl₂ + 2e⁻ → 2Cl⁻  (+1.36 V)' },
  { id: 'f', label: 'F₂ + 2e⁻ → 2F⁻  (+2.87 V)' }
]

const ELECTRO: readonly Declared[] = [
  { id: 'cathode', name: 'Cathode', kind: 'choice', initial: 'cu', about: 'Where reduction happens. Tabulated as a reduction, like every potential in the table.', options: HALF_CELL_OPTIONS, group: 'The cell' },
  { id: 'anode', name: 'Anode', kind: 'choice', initial: 'zn', about: 'Where oxidation happens. It is not reversed by hand — subtracting its reduction potential is what reverses it.', options: HALF_CELL_OPTIONS, group: 'The cell' },
  { id: 'electrons', name: 'Electrons transferred', kind: 'integer', initial: 2, about: 'n in the balanced cell reaction. It scales ΔG but not the voltage.', least: 1, most: 8, group: 'The cell' },
  {
    id: 'reactionQuotient',
    name: 'Reaction quotient Q',
    kind: 'number',
    initial: 1,
    about: 'Products over reactants as they actually are. Q = 1 is standard conditions, where the Nernst correction is zero.',
    least: 0.000000001,
    most: 1_000_000_000,
    group: 'Nernst'
  },
  { id: 'temperature', name: 'Temperature', kind: 'number', initial: 298.15, about: 'In kelvin. The 0.0592/n shortcut is only true at 298 K.', unit: 'K', least: 100, most: 2000, group: 'Nernst' },
  { id: 'current', name: 'Current', kind: 'number', initial: 2, about: 'In amps.', unit: 'A', least: 0.0001, most: 10_000, group: 'Electrolysis' },
  { id: 'seconds', name: 'For', kind: 'number', initial: 3600, about: 'In seconds. An hour is 3,600.', unit: 's', least: 0.1, most: 1_000_000, group: 'Electrolysis' },
  { id: 'molarMass', name: 'Molar mass of the product', kind: 'number', initial: 63.546, about: 'In g/mol. Copper is 63.546.', unit: 'g/mol', least: 0.1, most: 400, group: 'Electrolysis' }
]

// ---------------------------------------------------------------- the virtual laboratory

const TITRATION: readonly Declared[] = [
  { id: 'acidMolarity', name: 'Acid concentration', kind: 'number', initial: 0.1, about: 'In mol/L.', unit: 'mol/L', least: 0.0001, most: 10, group: 'Titration' },
  { id: 'acidVolume', name: 'Acid volume', kind: 'number', initial: 25, about: 'In millilitres — what is in the flask.', unit: 'mL', least: 0.1, most: 1000, group: 'Titration' },
  { id: 'baseMolarity', name: 'Alkali concentration', kind: 'number', initial: 0.1, about: 'In mol/L — what is in the burette.', unit: 'mol/L', least: 0.0001, most: 10, group: 'Titration' },
  {
    id: 'weak',
    name: 'The acid is weak',
    kind: 'boolean',
    initial: false,
    about: 'A weak acid gives a buffer region and an equivalence point above pH 7. Turn it on to see the difference.',
    group: 'Titration'
  },
  { id: 'ka', name: 'Ka', kind: 'number', initial: 0.000018, about: 'Only used when the acid is weak. Acetic acid is 1.8e-5, which makes its pKa 4.74.', least: 1e-14, most: 1, group: 'Titration' },
  {
    id: 'flameFor',
    name: 'Flame test',
    kind: 'choice',
    initial: 'Na',
    about: 'Which ion to look at in the flame-test tab.',
    options: FLAME_TESTS.map((one) => ({ id: one.symbol, label: `${one.ion} — ${one.colour}` })),
    group: 'Flame tests'
  }
]

// ---------------------------------------------------------------- organic chemistry

const ORGANIC: readonly Declared[] = [
  {
    id: 'group',
    name: 'Family',
    kind: 'choice',
    initial: 'alcohol',
    about: 'Which functional group to look at. All fourteen are shown whichever is picked; this one is the one named and built into a series.',
    // Read from the engine, so a family cannot be offered that the engine has no entry for.
    options: FUNCTIONAL_GROUPS.map((one) => ({ id: one.id, label: one.name + ' \u2014 ' + one.group })),
    group: 'The family'
  },
  {
    id: 'carbons',
    name: 'Carbons in the chain',
    kind: 'number',
    initial: 4,
    about: 'How long the main chain is. One to twelve, because that is as far as the stems go.',
    least: 1,
    most: 12,
    step: 1,
    group: 'Naming'
  },
  {
    id: 'position',
    name: 'Group on carbon',
    kind: 'number',
    initial: 2,
    about: 'Which carbon the group sits on. Ask for one past the middle and it is renumbered from the other end, with the rule that did it said on screen.',
    least: 1,
    most: 12,
    step: 1,
    group: 'Naming'
  },
  {
    id: 'upTo',
    name: 'Series length',
    kind: 'number',
    initial: 8,
    about: 'How many members of the homologous series to build.',
    least: 2,
    most: 12,
    step: 1,
    group: 'Naming'
  }
]

// ---------------------------------------------------------------- combining elements

const COMBINE: readonly Declared[] = [
  {
    id: 'elements',
    name: 'Elements',
    kind: 'text',
    initial: 'H, O',
    about: 'Two to four symbols, separated by commas or spaces: H O, or Na Cl, or Ca C O.',
    group: 'What to combine'
  }
]

// ---------------------------------------------------------------- a formula taken apart

const MOLECULAR: readonly Declared[] = [
  {
    id: 'formula',
    name: 'Formula',
    kind: 'text',
    initial: 'H2O',
    about: 'Any formula, with brackets and hydrates if you need them: Ca3(PO4)2, CuSO4\u00b75H2O.',
    group: 'The molecule'
  }
]

export const PHASE6_PARAMETERS: Readonly<Record<string, ParameterSet>> = Object.freeze(
  (() => {
    const out: Record<string, ParameterSet> = {}
    const sets: readonly (readonly [string, readonly Declared[]])[] = [
      ['periodic-table', TABLE],
      ['chem-calculator', CALCULATOR],
      ['reaction-lab', REACTION],
      ['electro-lab', ELECTRO],
      ['titration-lab', TITRATION],
      ['organic-lab', ORGANIC],
      ['combination-engine', COMBINE],
      ['molecular-studio', MOLECULAR]
    ]
    for (const [id, list] of sets) {
      const made = declareAll(list)
      if (Array.isArray(made)) {
        const first = made.find(isParameterProblem)
        throw new Error(`Parameters for "${id}" are not valid: ${first ? `${first.id} — ${first.says}` : 'unknown problem'}`)
      }
      out[id] = made
    }
    return out
  })()
)

const app = (
  one: Omit<NativeAppManifest, 'version' | 'aliases'> & { version?: number; aliases?: readonly string[] }
): NativeAppManifest => ({ version: 1, aliases: [], ...one })

export const PHASE6_CATALOGUE: readonly NativeAppManifest[] = Object.freeze([
  app({
    id: 'periodic-table',
    name: 'Periodic Table',
    summary: 'Every element where the table puts it, with what IUPAC publishes about it.',
    domain: 'chemistry',
    icon: 'grid-3x3',
    aliases: ['periodic table', 'elements', 'element', 'atomic number', 'atomic weight'],
    tags: [
      'periodic table', 'element', 'elements', 'atomic number', 'atomic weight', 'atomic mass', 'group', 'period',
      'electronegativity', 'electron configuration', 'oxidation state', 'valence', 'alkali metal', 'noble gas',
      'halogen', 'transition metal', 'lanthanide', 'actinide', 'metalloid', 'symbol'
    ],
    capabilities: [
      { id: 'browseElements', summary: 'show the periodic table and let an element be looked up by name, symbol or number' },
      { id: 'describeElement', summary: 'report an element’s weight, group, configuration and oxidation states' }
    ],
    surface: { kind: 'native', ref: 'PeriodicTableLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['periodic-table']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'Melting points, densities, discovery dates and prices are not here. Each is a measurement with conditions attached that this would have to state and cannot.',
      'Fourteen elements have no single atomic weight, because their isotopic composition varies between sources. The conventional value is shown and the note says so.',
      'Everything from meitnerium upwards has never been reacted, so its oxidation states are blank and its configuration is predicted rather than measured.',
      'There are no isotopes here beyond the note on each weight — no half-lives, no decay modes, no nuclide chart.'
    ],
    // Retired: the studio has the periodic table with every element, and its own element pages.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'chem-calculator',
    name: 'Chemistry Calculator',
    summary: 'Molar mass, moles, concentration, pH, the gas law and dilution, each with its units and its caveat.',
    domain: 'chemistry',
    icon: 'calculator',
    aliases: ['chemistry calculator', 'molar mass', 'molecular weight', 'moles', 'molarity', 'ph', 'gas law', 'dilution'],
    tags: [
      'molar mass', 'molecular weight', 'formula mass', 'moles', 'mole', 'molarity', 'concentration', 'solution',
      'ph', 'poh', 'acid', 'base', 'ka', 'kb', 'gas law', 'ideal gas', 'pv=nrt', 'dilution', 'percent composition',
      'composition by mass', 'avogadro'
    ],
    capabilities: [
      { id: 'molarMass', summary: 'work out a molar mass and what the compound is made of by mass' },
      { id: 'solutionConcentration', summary: 'convert between moles, volume and concentration, and dilute' },
      { id: 'calculatePh', summary: 'find the pH of a strong or weak acid or base, solved rather than approximated' },
      { id: 'gasLaw', summary: 'use PV = nRT to find whichever quantity is missing' }
    ],
    surface: { kind: 'native', ref: 'ChemCalculatorLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['chem-calculator']),
    actions: RECOMPUTE,
    accepts: ['text', 'numbers'],
    produces: ['numbers', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'Every constant is for 25°C and dilute solution. Nothing corrects for temperature or ionic strength.',
      'Activity is taken as equal to concentration, which is the usual school approximation and is wrong in concentrated solution.',
      'The ideal gas law assumes the molecules have no volume and do not attract each other, so it fails at high pressure and low temperature.',
      'A polyprotic acid is treated by its first dissociation only; the second and third are not stepped through.'
    ]
  }),
  app({
    id: 'reaction-lab',
    name: 'Reaction Laboratory',
    summary: 'Balance a reaction, then find out whether it releases energy, how far it goes and how fast.',
    domain: 'chemistry',
    icon: 'flask-conical',
    aliases: ['reaction', 'balance equation', 'enthalpy', 'equilibrium', 'rate law', 'arrhenius', 'kinetics'],
    tags: [
      'reaction', 'balance', 'balancing', 'equation', 'stoichiometry', 'enthalpy', 'entropy', 'gibbs', 'spontaneous',
      'exothermic', 'endothermic', 'hess', 'equilibrium', 'le chatelier', 'rate law', 'order', 'half-life',
      'arrhenius', 'activation energy', 'kinetics', 'rate constant'
    ],
    capabilities: [
      { id: 'balanceReaction', summary: 'balance an equation by conservation of atoms, solved as simultaneous equations' },
      { id: 'reactionEnergy', summary: 'find ΔH, ΔS and ΔG, and the temperature at which the sign of ΔG flips' },
      { id: 'reactionEquilibrium', summary: 'find where a reversible reaction settles from its equilibrium constant' },
      { id: 'reactionRate', summary: 'follow a concentration down under a zero, first or second order rate law' },
      { id: 'temperatureDependence', summary: 'plot ln k against 1/T and read the activation energy off the slope' }
    ],
    surface: { kind: 'native', ref: 'ReactionsLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['reaction-lab']),
    actions: RECOMPUTE,
    accepts: ['text', 'numbers'],
    produces: ['series', 'table', 'numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'Formation enthalpies and entropies are given to it, not looked up. A wrong figure in gives a confident wrong answer out, which is why the source of each is worth stating.',
      'ΔH and ΔS are taken as constant with temperature. Over a few hundred kelvin that is a good approximation and over a thousand it is not.',
      'The rate laws are the integrated forms for order 0, 1 and 2. Fractional and mixed orders occur in real chemistry and are refused rather than approximated.',
      'Equilibrium is solved for ideal behaviour at one temperature. No activity coefficients, no pressure effects on a gas-phase equilibrium.'
    ],
    // Retired: the studio has Reaction Lab among its modules.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'electro-lab',
    name: 'Electrochemistry Laboratory',
    summary: 'Build a cell from two half-reactions, correct it with Nernst, and plate metal with Faraday.',
    domain: 'chemistry',
    icon: 'battery-charging',
    aliases: ['electrochemistry', 'galvanic cell', 'voltaic cell', 'nernst', 'electrolysis', 'faraday', 'half cell'],
    tags: [
      'electrochemistry', 'galvanic', 'voltaic', 'cell', 'half cell', 'half reaction', 'cathode', 'anode',
      'reduction', 'oxidation', 'redox', 'standard potential', 'emf', 'nernst', 'reaction quotient', 'electrolysis',
      'faraday', 'plating', 'salt bridge', 'battery'
    ],
    capabilities: [
      { id: 'cellVoltage', summary: 'find the voltage of a cell built from two tabulated half-reactions' },
      { id: 'nernstCorrection', summary: 'correct a cell voltage away from standard conditions' },
      { id: 'runElectrolysis', summary: 'find how much metal a current deposits in a given time' }
    ],
    surface: { kind: 'native', ref: 'ElectroLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['electro-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['numbers'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'The ten half-cells are the ones it ships with. You cannot add your own couple here.',
      'Standard potentials are tabulated at 25°C against the standard hydrogen electrode. They are measurements, not calculations.',
      'Nothing here models the cell actually running: no internal resistance, no overpotential, no concentration polarisation, no current drawn.',
      'Electrolysis assumes every electron does the intended job. A real cell loses some to side reactions, which is what current efficiency means.'
    ],
    // Retired: the studio has Electrochemistry among its modules.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'titration-lab',
    name: 'Virtual Laboratory',
    summary: 'Run an acid–base titration point by point, and see what each metal ion colours a flame.',
    domain: 'chemistry',
    icon: 'test-tube',
    aliases: ['titration', 'virtual lab', 'flame test', 'indicator', 'equivalence point', 'buffer'],
    tags: [
      'titration', 'titrate', 'burette', 'equivalence point', 'end point', 'indicator', 'phenolphthalein',
      'methyl orange', 'buffer', 'pka', 'neutralisation', 'acid', 'base', 'strong', 'weak', 'flame test',
      'emission', 'sodium', 'potassium', 'copper', 'virtual lab', 'experiment'
    ],
    capabilities: [
      { id: 'runTitration', summary: 'compute an acid–base titration curve and find its equivalence point' },
      { id: 'chooseIndicator', summary: 'pick the indicator whose range straddles the equivalence pH' },
      { id: 'flameTest', summary: 'show what a metal ion colours a flame and which emission line does it' }
    ],
    surface: { kind: 'native', ref: 'TitrationLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['titration-lab']),
    actions: RECOMPUTE,
    accepts: ['numbers'],
    produces: ['series', 'table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'A monoprotic acid against a strong base. Polyprotic acids give two or three equivalence points and are not stepped through.',
      'The flame tests are a table of what each ion looks like, not a spectrum. Nothing here disperses light or reads an intensity.',
      'Activity is taken as concentration, so the curve is right in dilute solution and drifts in concentrated.',
      'A real end point is read by eye against a colour chart and carries an error this does not model.'
    ],
    // Retired: the studio has Virtual Lab among its modules.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'organic-lab',
    name: 'Organic Explorer',
    summary: 'The fourteen functional groups, what each one does, and how an IUPAC name is built piece by piece.',
    domain: 'chemistry',
    icon: 'hexagon',
    aliases: ['organic', 'functional groups', 'iupac', 'naming', 'homologous series'],
    tags: [
      'organic', 'organic chemistry', 'functional group', 'iupac', 'iupac name', 'naming', 'nomenclature',
      'alkane', 'alkene', 'alkyne', 'alcohol', 'aldehyde', 'ketone', 'carboxylic acid', 'ester', 'ether',
      'amine', 'amide', 'aromatic', 'benzene', 'haloalkane', 'nitro', 'homologous series', 'isomer',
      'substitution', 'addition', 'hydrocarbon', 'name this compound', 'what is this called',
      'how do you name an organic compound'
    ],
    capabilities: [
      { id: 'showFunctionalGroups', summary: 'list the fourteen families with their formula, suffix, reactions and test' },
      { id: 'nameChain', summary: 'build the IUPAC name of a straight chain and show which rule put each piece there' },
      { id: 'buildSeries', summary: 'build a homologous series and show the constant CH2 step' }
    ],
    surface: { kind: 'native', ref: 'OrganicLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['organic-lab']),
    actions: RECOMPUTE,
    accepts: ['text', 'numbers'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'Straight chains with one functional group. Branches, rings, two groups on one chain and any stereochemistry are refused by name rather than half-answered.',
      'Aromatics, esters and ethers are described in full and not named, because their names are not built from a chain length.',
      'No structure is drawn and no isomer is listed \u2014 this names a chain, it does not draw one.',
      'The suffix seniority order is stated as a rule and not applied, because only one group is handled at a time.',
      'Twelve carbons is the limit, which is where the stems this knows run out.'
    ],
    // Retired: the studio has Organic among its modules.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'combination-engine',
    name: 'Combination Engine',
    summary: 'Pick elements and see which compounds they actually make, with the equation that makes each one.',
    domain: 'chemistry',
    icon: 'git-merge',
    aliases: ['combine elements', 'what do these make', 'compound predictor', 'synthesis'],
    tags: [
      'combine', 'combination', 'compound', 'predict', 'what do they make', 'synthesis', 'bond type',
      'ionic', 'covalent', 'valence', 'valency', 'oxidation state', 'formula', 'equation', 'react',
      'elements together', 'binary compound', 'what do these elements make', 'what do hydrogen and oxygen make',
      'what compound do they form', 'combine two elements'
    ],
    capabilities: [
      { id: 'combineElements', summary: 'find the named compounds a set of elements makes' },
      { id: 'predictByValence', summary: 'offer the formula the valences balance to, labelled as arithmetic rather than fact' },
      { id: 'writeSynthesis', summary: 'write the balanced equation that makes each compound from its elements' }
    ],
    surface: { kind: 'native', ref: 'CombinationLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['combination-engine']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'The named compounds come from a table of about seventy-five. Finding nothing means it is not in that table, not that no such compound exists \u2014 and the card says so.',
      'A formula that balances by valence is shown separately, unnamed, and is never claimed to exist.',
      'Three or more elements give only the named compounds, because the formulas that balance across three elements are mostly not real compounds.',
      'No thermodynamics: nothing here says whether a reaction would actually go, only what the product would be if it did.',
      'Reaction conditions, yields and rates are outside it entirely.'
    ],
    // Retired: the studio has Combination Engine among its modules.
    supersededBy: 'chemistry-studio'
  }),
  app({
    id: 'molecular-studio',
    name: 'Molecular Studio',
    summary: 'A formula taken apart: what it weighs, how many atoms, and how the mass is shared between the elements.',
    domain: 'chemistry',
    icon: 'atom',
    aliases: ['molar mass', 'molecular weight', 'formula mass', 'percent composition', 'molecule weight'],
    tags: [
      'molar mass', 'molecular mass', 'molecular weight', 'formula mass', 'relative formula mass',
      'percent composition', 'composition by mass', 'empirical formula', 'atoms', 'formula unit',
      'how much does it weigh', 'g/mol', 'take apart a formula', 'hydrate'
    ],
    capabilities: [
      { id: 'weighFormula', summary: 'parse a formula and give its molar mass with the uncertainty the atomic weights carry' },
      { id: 'composition', summary: 'show the share of the mass each element carries, against its share of the atoms' },
      { id: 'empiricalFormula', summary: 'reduce a formula to its simplest whole-number ratio' }
    ],
    surface: { kind: 'native', ref: 'MolecularStudioLab' },
    opensAt: 'expanded',
    largest: 'workspace',
    whenHidden: 'continue',
    parameters: Object.keys(PHASE6_PARAMETERS['molecular-studio']),
    actions: RECOMPUTE,
    accepts: ['text'],
    produces: ['table'],
    permissions: ['compute'],
    persists: true,
    engine: 'chemistry',
    limitations: [
      'A formula is weighed, not drawn. There is no structure, no bond and no shape here \u2014 the Molecule Viewer is where those are.',
      'Standard atomic weights, so the mass is right for ordinary terrestrial material and wrong for an isotopically enriched sample.',
      'The gallery is the same table of about seventy-five compounds the Combination Engine uses, not a database of everything.',
      'Going the other way \u2014 composition back to a formula \u2014 is not here; that needs a molar mass as well, and is a different calculation.'
    ],
    // Retired: the studio has Molecular Studio among its modules.
    supersededBy: 'chemistry-studio'
  })
])

export const PHASE6_BY_ID: Readonly<Record<string, NativeAppManifest>> = Object.freeze(
  Object.fromEntries(PHASE6_CATALOGUE.map((one) => [one.id, one]))
)
