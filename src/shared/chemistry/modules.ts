/**
 * The Chemistry Studio's modules, without the pages themselves.
 *
 * Their own registry pairs every module with a lucide icon, which makes it a renderer file. The main process
 * needs the same list so Orion can open a module by name, and it cannot import React. So this is that list with
 * the icons left out.
 *
 * ## It is generated, and guarded
 *
 * Written from their registry rather than by hand, and `modules.test.ts` checks the two still agree — a module
 * added to the studio and missing here would be one Orion could not open, which is exactly the kind of gap
 * nobody notices until somebody asks for it.
 */

export interface ChemistryModuleRow {
  id: string
  name: string
  /** The route their own hub navigates to. */
  route: string
  group: string
  /** Their own version label, V1 to V27. */
  v: string
  /** What it covers, in their own words. */
  desc: string
  keywords: readonly string[]
  /** True where their registry says the module is not finished. Nothing pretends otherwise. */
  soon: boolean
}

export const CHEMISTRY_MODULES: readonly ChemistryModuleRow[] = Object.freeze([
  Object.freeze({
    id: 'periodic',
    name: 'Periodic Table',
    route: '/chemistry',
    group: 'Core',
    v: 'V1',
    desc: 'Interactive periodic table with element details.',
    keywords: Object.freeze(['element', 'table', 'atomic', 'symbol']),
    soon: false
  }),
  Object.freeze({
    id: 'combine',
    name: 'Combination Engine',
    route: '/chemistry/combine',
    group: 'Core',
    v: 'V2',
    desc: 'Combine elements to discover compounds.',
    keywords: Object.freeze(['compound', 'combine', 'synthesis']),
    soon: false
  }),
  Object.freeze({
    id: 'molecules',
    name: 'Molecular Studio',
    route: '/chemistry/molecules',
    group: 'Core',
    v: 'V5',
    desc: 'Build and visualize molecules.',
    keywords: Object.freeze(['molecule', 'structure', '3d', 'build']),
    soon: false
  }),
  Object.freeze({
    id: 'organic',
    name: 'Organic',
    route: '/chemistry/organic',
    group: 'Core',
    v: 'V7',
    desc: 'Organic chemistry explorer.',
    keywords: Object.freeze(['organic', 'carbon', 'functional group']),
    soon: false
  }),
  Object.freeze({
    id: 'inorganic',
    name: 'Inorganic',
    route: '/chemistry/inorganic',
    group: 'Core',
    v: 'V8',
    desc: 'Inorganic chemistry explorer.',
    keywords: Object.freeze(['inorganic', 'metal', 'salt']),
    soon: false
  }),
  Object.freeze({
    id: 'reactions',
    name: 'Reaction Lab',
    route: '/chemistry/reactions',
    group: 'Simulation',
    v: 'V4',
    desc: 'Balance and explore chemical reactions.',
    keywords: Object.freeze(['reaction', 'balance', 'equation', 'redox']),
    soon: false
  }),
  Object.freeze({
    id: 'lab',
    name: 'Virtual Lab',
    route: '/chemistry/lab',
    group: 'Simulation',
    v: 'V10',
    desc: 'Virtual chemistry experiments.',
    keywords: Object.freeze(['experiment', 'virtual', 'lab']),
    soon: false
  }),
  Object.freeze({
    id: 'physical',
    name: 'Physical Chemistry',
    route: '/chemistry/physical',
    group: 'Simulation',
    v: 'V11',
    desc: 'Thermodynamics, equilibrium, phase & colligative properties.',
    keywords: Object.freeze(['thermodynamics', 'enthalpy', 'entropy', 'gibbs', 'equilibrium', 'phase', 'colligative', 'clausius']),
    soon: false
  }),
  Object.freeze({
    id: 'kinetics',
    name: 'Chemical Kinetics',
    route: '/chemistry/kinetics',
    group: 'Simulation',
    v: 'V12',
    desc: 'Time-dependent reaction rates & Arrhenius analysis.',
    keywords: Object.freeze(['kinetics', 'rate', 'arrhenius', 'order', 'consecutive', 'parallel', 'catalytic']),
    soon: false
  }),
  Object.freeze({
    id: 'electrochem',
    name: 'Electrochemistry',
    route: '/chemistry/electrochemistry',
    group: 'Simulation',
    v: 'V17',
    desc: 'Galvanic cells, Nernst equation, electrolysis & corrosion.',
    keywords: Object.freeze(['electrochemistry', 'nernst', 'galvanic', 'cell', 'electrolysis', 'corrosion', 'battery', 'faraday']),
    soon: false
  }),
  Object.freeze({
    id: 'quantum',
    name: 'Quantum Chemistry',
    route: '/chemistry/quantum',
    group: 'Advanced',
    v: 'V9',
    desc: 'Quantum-mechanical chemistry.',
    keywords: Object.freeze(['quantum', 'orbital', 'schrodinger']),
    soon: false
  }),
  Object.freeze({
    id: 'spectroscopy',
    name: 'Spectroscopy',
    route: '/chemistry/spectroscopy',
    group: 'Advanced',
    v: 'V13',
    desc: 'IR, UV-Vis, NMR, Raman & mass spectrometry.',
    keywords: Object.freeze(['spectroscopy', 'ir', 'uv', 'nmr', 'raman', 'mass', 'spectrum']),
    soon: false
  }),
  Object.freeze({
    id: 'biochem',
    name: 'Biochemistry',
    route: '/chemistry/biochemistry',
    group: 'Advanced',
    v: 'V14',
    desc: 'Amino acids, proteins, enzymes & nucleic acids.',
    keywords: Object.freeze(['biochemistry', 'amino acid', 'protein', 'enzyme', 'dna', 'rna']),
    soon: false
  }),
  Object.freeze({
    id: 'materials',
    name: 'Materials Chemistry',
    route: '/chemistry/materials',
    group: 'Advanced',
    v: 'V15',
    desc: 'Crystal structures, defects & electronic properties.',
    keywords: Object.freeze(['materials', 'crystal', 'lattice', 'band gap', 'defect']),
    soon: false
  }),
  Object.freeze({
    id: 'polymer',
    name: 'Polymer Chemistry',
    route: '/chemistry/polymer',
    group: 'Advanced',
    v: 'V16',
    desc: 'Monomers, polymerization & chain properties.',
    keywords: Object.freeze(['polymer', 'monomer', 'chain', 'crosslink']),
    soon: false
  }),
  Object.freeze({
    id: 'analytical',
    name: 'Analytical Chemistry',
    route: '/chemistry/analytical',
    group: 'Advanced',
    v: 'V18',
    desc: 'Titration, chromatography, gravimetry & calibration.',
    keywords: Object.freeze(['analytical', 'titration', 'chromatography', 'gravimetric', 'calibration', 'regression']),
    soon: false
  }),
  Object.freeze({
    id: 'engineering',
    name: 'Chemical Engineering',
    route: '/chemistry/engineering',
    group: 'Applied',
    v: 'V20',
    desc: 'Mass/energy balance, reactors & separations.',
    keywords: Object.freeze(['engineering', 'reactor', 'cstr', 'pfr', 'distillation', 'mass balance']),
    soon: false
  }),
  Object.freeze({
    id: 'environmental',
    name: 'Environmental Chemistry',
    route: '/chemistry/environmental',
    group: 'Applied',
    v: 'V21',
    desc: 'Atmosphere, water, pollution & cycles.',
    keywords: Object.freeze(['environment', 'acid rain', 'greenhouse', 'carbon cycle']),
    soon: false
  }),
  Object.freeze({
    id: 'nuclear',
    name: 'Nuclear Chemistry',
    route: '/chemistry/nuclear',
    group: 'Applied',
    v: 'V22',
    desc: 'Radioactive decay, decay chains & nuclear energy.',
    keywords: Object.freeze(['nuclear', 'radioactive', 'decay', 'half life', 'fission', 'fusion']),
    soon: false
  }),
  Object.freeze({
    id: 'astro',
    name: 'Astrochemistry',
    route: '/chemistry/astro',
    group: 'Applied',
    v: 'V23',
    desc: 'Chemistry in space — molecular clouds & atmospheres.',
    keywords: Object.freeze(['astro', 'interstellar', 'comet', 'prebiotic']),
    soon: false
  }),
  Object.freeze({
    id: 'surface',
    name: 'Surface Chemistry',
    route: '/chemistry/surface',
    group: 'Applied',
    v: 'V24',
    desc: 'Adsorption, Langmuir isotherm & catalytic surfaces.',
    keywords: Object.freeze(['surface', 'adsorption', 'langmuir', 'contact angle']),
    soon: false
  }),
  Object.freeze({
    id: 'datalab',
    name: 'Chemical Data Lab',
    route: '/chemistry/data',
    group: 'Data & Research',
    v: 'V19',
    desc: 'Import, analyze & fit experimental data.',
    keywords: Object.freeze(['data', 'csv', 'regression', 'fit', 'statistics']),
    soon: false
  }),
  Object.freeze({
    id: 'visualization',
    name: 'Chemical Visualization',
    route: '/chemistry/visualization',
    group: 'Data & Research',
    v: 'V26',
    desc: '3D molecules, orbitals & energy landscapes.',
    keywords: Object.freeze(['visualization', '3d', 'orbital', 'density']),
    soon: false
  }),
  Object.freeze({
    id: 'research',
    name: 'Research Workspace',
    route: '/chemistry/research',
    group: 'Data & Research',
    v: 'V27',
    desc: 'Design, run & save chemistry experiments.',
    keywords: Object.freeze(['research', 'experiment', 'hypothesis', 'design']),
    soon: false
  }),
  Object.freeze({
    id: 'frontier',
    name: 'Frontier Chemistry',
    route: '/chemistry/frontier',
    group: 'Data & Research',
    v: 'V25',
    desc: 'Open problems & advanced research topics.',
    keywords: Object.freeze(['frontier', 'open problem', 'catalysis', 'co2', 'photosynthesis']),
    soon: false
  }),
  Object.freeze({
    id: 'calc',
    name: 'Calculator',
    route: '/chemistry/calculator',
    group: 'Tools',
    v: 'V6',
    desc: 'Chemistry calculators.',
    keywords: Object.freeze(['calculator', 'molar mass', 'stoichiometry']),
    soon: false
  }),
])

export const CHEMISTRY_GROUPS: readonly string[] = Object.freeze(['Core', 'Simulation', 'Advanced', 'Applied', 'Data & Research', 'Tools'])

/** The ones that actually have a page behind them. */
export const CHEMISTRY_BUILT: readonly ChemistryModuleRow[] = Object.freeze(
  CHEMISTRY_MODULES.filter((one) => !one.soon)
)

/**
 * Which module somebody meant.
 *
 * Returns the one match, the several it could be, or null. Several is never narrowed down by guessing: a word
 * like "chemistry" matches most of them, and picking one would open the wrong studio with no sign that it had.
 */
export function findChemistryModule(
  asked: string
): ChemistryModuleRow | readonly ChemistryModuleRow[] | null {
  const tidy = (text: string): string => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const want = tidy(asked)
  if (want === '') return null

  const byId = CHEMISTRY_MODULES.filter((one) => one.id === want.replace(/ /g, ''))
  if (byId.length === 1) return byId[0]

  const exact = CHEMISTRY_MODULES.filter((one) => tidy(one.name) === want)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return Object.freeze(exact)

  const inName = CHEMISTRY_MODULES.filter((one) => tidy(one.name).includes(want))
  if (inName.length === 1) return inName[0]

  const byWord = CHEMISTRY_MODULES.filter((one) => one.keywords.some((k) => tidy(k) === want))
  if (byWord.length === 1) return byWord[0]

  const loose = [...new Set([...inName, ...byWord, ...CHEMISTRY_MODULES.filter((one) => tidy(one.desc).includes(want))])]
  if (loose.length === 1) return loose[0]
  return loose.length > 1 ? Object.freeze(loose) : null
}

/** The counts, so nothing has to state them twice and get one of them wrong. */
export const CHEMISTRY_COUNTS = Object.freeze({
  modules: CHEMISTRY_MODULES.length,
  built: CHEMISTRY_BUILT.length,
  groups: CHEMISTRY_GROUPS.length
})
