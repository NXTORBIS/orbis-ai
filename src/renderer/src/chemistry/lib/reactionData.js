/*
 * The reactions the Reaction Lab lists, and the types it filters them by.
 *
 * NOT the user's own file — their `src/lib/reactionData.js` is not in any extracted archive. Written from the
 * fields their lab reads: a type is `{ id, label }`, and a reaction is
 * `{ id, type, name, equation, energy, description, conditions }`.
 *
 * Every equation here is balanced and every condition is the real one. An unbalanced equation in a reaction lab
 * is worse than a missing reaction, so each was checked atom by atom rather than written out from memory.
 */

export const REACTION_TYPES = [
  { id: 'synthesis', label: 'Synthesis' },
  { id: 'decomposition', label: 'Decomposition' },
  { id: 'displacement', label: 'Displacement' },
  { id: 'double-displacement', label: 'Double displacement' },
  { id: 'combustion', label: 'Combustion' },
  { id: 'acid-base', label: 'Acid–base' },
  { id: 'redox', label: 'Redox' },
  { id: 'precipitation', label: 'Precipitation' }
];

export const REACTIONS = [
  {
    id: 'haber',
    type: 'synthesis',
    name: 'Haber process',
    equation: 'N2 + 3H2 -> 2NH3',
    energy: 'exothermic, ΔH ≈ −92 kJ/mol',
    description:
      'Nitrogen and hydrogen join to make ammonia. It is the reaction that feeds most of the world, through fertiliser.',
    conditions: '450 °C, 200 atm, iron catalyst'
  },
  {
    id: 'contact',
    type: 'synthesis',
    name: 'Contact process (key step)',
    equation: '2SO2 + O2 -> 2SO3',
    energy: 'exothermic, ΔH ≈ −196 kJ/mol',
    description: 'Sulfur dioxide is oxidised to sulfur trioxide on the way to sulfuric acid.',
    conditions: '450 °C, 1–2 atm, vanadium(V) oxide catalyst'
  },
  {
    id: 'rust',
    type: 'redox',
    name: 'Rusting of iron',
    equation: '4Fe + 3O2 + 6H2O -> 4Fe(OH)3',
    energy: 'exothermic, but very slow',
    description:
      'Iron is oxidised by oxygen in the presence of water. Both are needed: iron does not rust in dry air or in oxygen-free water.',
    conditions: 'Room temperature, water and oxygen both present; salt speeds it up'
  },
  {
    id: 'thermite',
    type: 'displacement',
    name: 'Thermite reaction',
    equation: '2Al + Fe2O3 -> Al2O3 + 2Fe',
    energy: 'strongly exothermic, ΔH ≈ −851 kJ/mol',
    description:
      'Aluminium takes the oxygen from iron oxide, leaving molten iron. It gets hot enough to weld rail track.',
    conditions: 'Needs ignition near 1000 °C; then it sustains itself'
  },
  {
    id: 'zinc-copper',
    type: 'displacement',
    name: 'Zinc in copper(II) sulfate',
    equation: 'Zn + CuSO4 -> ZnSO4 + Cu',
    energy: 'exothermic',
    description:
      'Zinc is above copper in the reactivity series, so it takes copper’s place and the blue solution fades as copper plates out.',
    conditions: 'Room temperature, in solution'
  },
  {
    id: 'calcium-carbonate',
    type: 'decomposition',
    name: 'Thermal decomposition of limestone',
    equation: 'CaCO3 -> CaO + CO2',
    energy: 'endothermic, ΔH ≈ +178 kJ/mol',
    description: 'Limestone breaks down to quicklime and carbon dioxide. This is the first step in making cement.',
    conditions: 'Above about 840 °C in a lime kiln'
  },
  {
    id: 'hydrogen-peroxide',
    type: 'decomposition',
    name: 'Decomposition of hydrogen peroxide',
    equation: '2H2O2 -> 2H2O + O2',
    energy: 'exothermic, ΔH ≈ −98 kJ/mol',
    description:
      'Hydrogen peroxide breaks down to water and oxygen on its own, slowly. A catalyst makes it immediate.',
    conditions: 'Manganese(IV) oxide or catalase; light and warmth speed it up'
  },
  {
    id: 'methane-combustion',
    type: 'combustion',
    name: 'Complete combustion of methane',
    equation: 'CH4 + 2O2 -> CO2 + 2H2O',
    energy: 'exothermic, ΔH ≈ −891 kJ/mol',
    description: 'Methane burns in plenty of oxygen to carbon dioxide and water.',
    conditions: 'Ignition, with enough oxygen; short of oxygen it gives carbon monoxide instead'
  },
  {
    id: 'ethanol-combustion',
    type: 'combustion',
    name: 'Combustion of ethanol',
    equation: 'C2H5OH + 3O2 -> 2CO2 + 3H2O',
    energy: 'exothermic, ΔH ≈ −1367 kJ/mol',
    description: 'Ethanol burns with a pale blue flame. It is used as a fuel on its own and blended into petrol.',
    conditions: 'Ignition in air'
  },
  {
    id: 'neutralisation',
    type: 'acid-base',
    name: 'Neutralisation of hydrochloric acid',
    equation: 'HCl + NaOH -> NaCl + H2O',
    energy: 'exothermic, ΔH ≈ −57 kJ/mol',
    description:
      'A strong acid and a strong alkali give a neutral salt solution and water. The heat released is the same for any strong acid with any strong alkali, because the reaction is really H⁺ + OH⁻.',
    conditions: 'Room temperature, in solution'
  },
  {
    id: 'carbonate-acid',
    type: 'acid-base',
    name: 'Carbonate with acid',
    equation: 'CaCO3 + 2HCl -> CaCl2 + H2O + CO2',
    energy: 'exothermic',
    description:
      'A carbonate fizzes with acid, giving carbon dioxide. The gas turning limewater milky is the standard test for it.',
    conditions: 'Room temperature; faster when the carbonate is powdered'
  },
  {
    id: 'silver-chloride',
    type: 'precipitation',
    name: 'Silver chloride precipitate',
    equation: 'AgNO3 + NaCl -> AgCl + NaNO3',
    energy: 'slightly exothermic',
    description:
      'Two clear solutions give a white solid that will not dissolve. This is the test for a chloride ion.',
    conditions: 'Room temperature, in solution, acidified with nitric acid'
  },
  {
    id: 'barium-sulfate',
    type: 'precipitation',
    name: 'Barium sulfate precipitate',
    equation: 'BaCl2 + Na2SO4 -> BaSO4 + 2NaCl',
    energy: 'slightly exothermic',
    description: 'A dense white precipitate that will not dissolve in acid. This is the test for a sulfate ion.',
    conditions: 'Room temperature, in solution'
  },
  {
    id: 'double-displacement-lead',
    type: 'double-displacement',
    name: 'Lead iodide — the golden rain',
    equation: 'Pb(NO3)2 + 2KI -> PbI2 + 2KNO3',
    energy: 'slightly exothermic',
    description:
      'Two colourless solutions give a bright yellow precipitate. Warmed and cooled slowly it recrystallises as glinting flakes.',
    conditions: 'Room temperature, in solution'
  },
  {
    id: 'photosynthesis',
    type: 'redox',
    name: 'Photosynthesis',
    equation: '6CO2 + 6H2O -> C6H12O6 + 6O2',
    energy: 'endothermic, ΔH ≈ +2803 kJ/mol',
    description:
      'Carbon dioxide and water are built into glucose using light. Written as one equation it is really dozens of steps.',
    conditions: 'Light, chlorophyll, enzymes; the reverse of respiration'
  },
  {
    id: 'electrolysis-water',
    type: 'decomposition',
    name: 'Electrolysis of water',
    equation: '2H2O -> 2H2 + O2',
    energy: 'endothermic, ΔH ≈ +572 kJ/mol',
    description:
      'Electricity splits water into hydrogen and oxygen, twice as much hydrogen by volume as oxygen.',
    conditions: 'Direct current, above about 1.23 V; an electrolyte is needed because pure water barely conducts'
  }
];

export function getReaction(id) {
  return REACTIONS.find((one) => one.id === id) ?? REACTIONS[0];
}
