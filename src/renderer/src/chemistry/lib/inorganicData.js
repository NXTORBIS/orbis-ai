/*
 * The families of inorganic compound the Inorganic Explorer lists.
 *
 * NOT the user's own file — their `src/lib/inorganicData.js` is not in any extracted archive. Written from the
 * four fields their explorer reads off each entry: `id`, `name`, `examples`, `desc` and `note`.
 *
 * Every formula and every statement here is standard inorganic chemistry, checked rather than filled in to make
 * the list look longer. Where a family has a real exception worth knowing, the note says it: a list that only
 * states the rule teaches the rule as if it had none.
 */

export const INORGANIC_FAMILIES = [
  {
    id: 'oxides',
    name: 'Oxides',
    examples: 'Na₂O · MgO · Al₂O₃ · CO₂ · SO₃',
    desc: 'A metal or non-metal bonded to oxygen. Across a period the oxides go from basic through amphoteric to acidic, which is the clearest single trend in the whole table.',
    note: 'Al₂O₃ is the amphoteric one in period 3 — it reacts with both acid and alkali, so it sits exactly on the turn from basic to acidic.'
  },
  {
    id: 'hydroxides',
    name: 'Hydroxides',
    examples: 'NaOH · Ca(OH)₂ · Al(OH)₃ · Fe(OH)₃',
    desc: 'A metal with the OH⁻ ion. Group 1 hydroxides are strongly alkaline and dissolve freely; going down group 2 they get more soluble and more alkaline.',
    note: 'Solubility runs the opposite way for group 2 sulfates, so "down the group, more soluble" is a fact about hydroxides, not a rule for everything.'
  },
  {
    id: 'acids',
    name: 'Acids',
    examples: 'HCl · H₂SO₄ · HNO₃ · H₃PO₄ · CH₃COOH',
    desc: 'Proton donors. Strength is about how completely the acid gives up its proton in water, not about how concentrated it is.',
    note: 'Concentrated and strong are different things: concentrated ethanoic acid is still a weak acid, and dilute hydrochloric acid is still a strong one.'
  },
  {
    id: 'salts',
    name: 'Salts',
    examples: 'NaCl · KNO₃ · CuSO₄ · CaCO₃ · NH₄Cl',
    desc: 'What is left when an acid’s proton is replaced by a metal or an ammonium ion. Most are ionic solids with high melting points.',
    note: 'A salt is not automatically neutral. NH₄Cl dissolves to give an acidic solution and Na₂CO₃ an alkaline one, because the ions themselves react with water.'
  },
  {
    id: 'halides',
    name: 'Halides',
    examples: 'NaCl · KBr · AgI · CCl₄ · PCl₅',
    desc: 'A halogen bonded to anything else. Ionic with reactive metals, covalent with non-metals, and the change is gradual rather than sharp.',
    note: 'Silver halides darken in light, which is what photographic film was built on, and is why AgBr is kept in the dark.'
  },
  {
    id: 'carbonates',
    name: 'Carbonates and bicarbonates',
    examples: 'CaCO₃ · Na₂CO₃ · NaHCO₃ · MgCO₃',
    desc: 'The CO₃²⁻ and HCO₃⁻ ions with a metal. All of them fizz with acid, giving carbon dioxide, which is the standard test.',
    note: 'Thermal stability increases down group 2: MgCO₃ decomposes well below 600 °C, BaCO₃ needs over 1300 °C.'
  },
  {
    id: 'coordination',
    name: 'Coordination compounds',
    examples: '[Cu(NH₃)₄]²⁺ · [Fe(CN)₆]³⁻ · [Ag(NH₃)₂]⁺',
    desc: 'A central metal ion surrounded by ligands that donate electron pairs to it. The geometry and the colour both follow from how the ligands split the metal’s d orbitals.',
    note: 'The colour is the light that is not absorbed. [Cu(H₂O)₆]²⁺ is pale blue and [Cu(NH₃)₄]²⁺ deep blue because ammonia splits the d orbitals further apart than water.'
  },
  {
    id: 'peroxides',
    name: 'Peroxides and superoxides',
    examples: 'H₂O₂ · Na₂O₂ · KO₂ · BaO₂',
    desc: 'Oxygen bonded to oxygen, so the oxidation state is −1 rather than the usual −2, and −½ in a superoxide.',
    note: 'This is the usual exception to "oxygen is always −2". Assuming −2 in H₂O₂ gives hydrogen an impossible oxidation state.'
  },
  {
    id: 'nitrides-carbides',
    name: 'Nitrides and carbides',
    examples: 'Li₃N · Mg₃N₂ · CaC₂ · SiC · Fe₃C',
    desc: 'Nitrogen or carbon as the more electronegative partner. Ionic ones hydrolyse in water; the covalent network ones are among the hardest materials known.',
    note: 'CaC₂ with water gives ethyne, which is how carbide lamps worked. SiC, with the same kind of formula, does not react with water at all.'
  },
  {
    id: 'interhalogens',
    name: 'Interhalogen compounds',
    examples: 'ClF · BrF₃ · IF₅ · ICl',
    desc: 'Two different halogens bonded together. The larger, less electronegative halogen takes the central position and the positive oxidation state.',
    note: 'The shapes follow VSEPR with lone pairs on the central atom: BrF₃ is T-shaped, not trigonal planar.'
  }
];

export function getFamily(id) {
  return INORGANIC_FAMILIES.find((one) => one.id === id) ?? INORGANIC_FAMILIES[0];
}
