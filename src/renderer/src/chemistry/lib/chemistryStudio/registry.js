// Canonical registry of all Chemistry Studio modules — used for navigation
// grouping and cross-module search. V1–V17 are the original modules; V13–V16
// and V18–V25 are the advanced/applied/data studios.
import {
  Atom, Beaker, FlaskConical, Calculator, Leaf, Globe, Microscope,
  Thermometer, Activity, Zap, Waves, Dna, Boxes, Link as LinkIcon, Cpu,
  Database, Factory, CloudRain, Radiation, Telescope, Layers, Sparkles,
  Eye, FlaskRound, BookOpen, Scale,
} from 'lucide-react';

export const MODULES = [
  // Core Chemistry
  { id: 'periodic', name: 'Periodic Table', route: '/chemistry', group: 'Core', icon: Atom, v: 'V1', desc: 'Interactive periodic table with element details.', keywords: ['element','table','atomic','symbol'] },
  { id: 'combine', name: 'Combination Engine', route: '/chemistry/combine', group: 'Core', icon: Beaker, v: 'V2', desc: 'Combine elements to discover compounds.', keywords: ['compound','combine','synthesis'] },
  { id: 'molecules', name: 'Molecular Studio', route: '/chemistry/molecules', group: 'Core', icon: Atom, v: 'V5', desc: 'Build and visualize molecules.', keywords: ['molecule','structure','3d','build'] },
  { id: 'organic', name: 'Organic', route: '/chemistry/organic', group: 'Core', icon: Leaf, v: 'V7', desc: 'Organic chemistry explorer.', keywords: ['organic','carbon','functional group'] },
  { id: 'inorganic', name: 'Inorganic', route: '/chemistry/inorganic', group: 'Core', icon: Globe, v: 'V8', desc: 'Inorganic chemistry explorer.', keywords: ['inorganic','metal','salt'] },
  // Simulation
  { id: 'reactions', name: 'Reaction Lab', route: '/chemistry/reactions', group: 'Simulation', icon: FlaskConical, v: 'V4', desc: 'Balance and explore chemical reactions.', keywords: ['reaction','balance','equation','redox'] },
  { id: 'lab', name: 'Virtual Lab', route: '/chemistry/lab', group: 'Simulation', icon: Microscope, v: 'V10', desc: 'Virtual chemistry experiments.', keywords: ['experiment','virtual','lab'] },
  { id: 'physical', name: 'Physical Chemistry', route: '/chemistry/physical', group: 'Simulation', icon: Thermometer, v: 'V11', desc: 'Thermodynamics, equilibrium, phase & colligative properties.', keywords: ['thermodynamics','enthalpy','entropy','gibbs','equilibrium','phase','colligative','clausius'] },
  { id: 'kinetics', name: 'Chemical Kinetics', route: '/chemistry/kinetics', group: 'Simulation', icon: Activity, v: 'V12', desc: 'Time-dependent reaction rates & Arrhenius analysis.', keywords: ['kinetics','rate','arrhenius','order','consecutive','parallel','catalytic'] },
  { id: 'electrochem', name: 'Electrochemistry', route: '/chemistry/electrochemistry', group: 'Simulation', icon: Zap, v: 'V17', desc: 'Galvanic cells, Nernst equation, electrolysis & corrosion.', keywords: ['electrochemistry','nernst','galvanic','cell','electrolysis','corrosion','battery','faraday'] },
  // Advanced
  { id: 'quantum', name: 'Quantum Chemistry', route: '/chemistry/quantum', group: 'Advanced', icon: Atom, v: 'V9', desc: 'Quantum-mechanical chemistry.', keywords: ['quantum','orbital','schrodinger'] },
  { id: 'spectroscopy', name: 'Spectroscopy', route: '/chemistry/spectroscopy', group: 'Advanced', icon: Waves, v: 'V13', desc: 'IR, UV-Vis, NMR, Raman & mass spectrometry.', keywords: ['spectroscopy','ir','uv','nmr','raman','mass','spectrum'] },
  { id: 'biochem', name: 'Biochemistry', route: '/chemistry/biochemistry', group: 'Advanced', icon: Dna, v: 'V14', desc: 'Amino acids, proteins, enzymes & nucleic acids.', keywords: ['biochemistry','amino acid','protein','enzyme','dna','rna'] },
  { id: 'materials', name: 'Materials Chemistry', route: '/chemistry/materials', group: 'Advanced', icon: Boxes, v: 'V15', desc: 'Crystal structures, defects & electronic properties.', keywords: ['materials','crystal','lattice','band gap','defect'] },
  { id: 'polymer', name: 'Polymer Chemistry', route: '/chemistry/polymer', group: 'Advanced', icon: LinkIcon, v: 'V16', desc: 'Monomers, polymerization & chain properties.', keywords: ['polymer','monomer','chain','crosslink'] },
  { id: 'analytical', name: 'Analytical Chemistry', route: '/chemistry/analytical', group: 'Advanced', icon: Scale, v: 'V18', desc: 'Titration, chromatography, gravimetry & calibration.', keywords: ['analytical','titration','chromatography','gravimetric','calibration','regression'] },
  // Applied
  { id: 'engineering', name: 'Chemical Engineering', route: '/chemistry/engineering', group: 'Applied', icon: Factory, v: 'V20', desc: 'Mass/energy balance, reactors & separations.', keywords: ['engineering','reactor','cstr','pfr','distillation','mass balance'] },
  { id: 'environmental', name: 'Environmental Chemistry', route: '/chemistry/environmental', group: 'Applied', icon: CloudRain, v: 'V21', desc: 'Atmosphere, water, pollution & cycles.', keywords: ['environment','acid rain','greenhouse','carbon cycle'] },
  { id: 'nuclear', name: 'Nuclear Chemistry', route: '/chemistry/nuclear', group: 'Applied', icon: Radiation, v: 'V22', desc: 'Radioactive decay, decay chains & nuclear energy.', keywords: ['nuclear','radioactive','decay','half life','fission','fusion'] },
  { id: 'astro', name: 'Astrochemistry', route: '/chemistry/astro', group: 'Applied', icon: Telescope, v: 'V23', desc: 'Chemistry in space — molecular clouds & atmospheres.', keywords: ['astro','interstellar','comet','prebiotic'] },
  { id: 'surface', name: 'Surface Chemistry', route: '/chemistry/surface', group: 'Applied', icon: Layers, v: 'V24', desc: 'Adsorption, Langmuir isotherm & catalytic surfaces.', keywords: ['surface','adsorption','langmuir','contact angle'] },
  // Data & Research
  { id: 'datalab', name: 'Chemical Data Lab', route: '/chemistry/data', group: 'Data & Research', icon: Database, v: 'V19', desc: 'Import, analyze & fit experimental data.', keywords: ['data','csv','regression','fit','statistics'] },
  { id: 'visualization', name: 'Chemical Visualization', route: '/chemistry/visualization', group: 'Data & Research', icon: Eye, v: 'V26', desc: '3D molecules, orbitals & energy landscapes.', keywords: ['visualization','3d','orbital','density'] },
  { id: 'research', name: 'Research Workspace', route: '/chemistry/research', group: 'Data & Research', icon: FlaskRound, v: 'V27', desc: 'Design, run & save chemistry experiments.', keywords: ['research','experiment','hypothesis','design'] },
  { id: 'frontier', name: 'Frontier Chemistry', route: '/chemistry/frontier', group: 'Data & Research', icon: Sparkles, v: 'V25', desc: 'Open problems & advanced research topics.', keywords: ['frontier','open problem','catalysis','co2','photosynthesis'] },
  // Tools
  { id: 'calc', name: 'Calculator', route: '/chemistry/calculator', group: 'Tools', icon: Calculator, v: 'V6', desc: 'Chemistry calculators.', keywords: ['calculator','molar mass','stoichiometry'] },
];

export const GROUPS = ['Core', 'Simulation', 'Advanced', 'Applied', 'Data & Research', 'Tools'];

export function searchModules(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return MODULES.filter((m) =>
    m.name.toLowerCase().includes(s) ||
    m.desc.toLowerCase().includes(s) ||
    m.group.toLowerCase().includes(s) ||
    m.keywords.some((k) => k.includes(s))
  );
}