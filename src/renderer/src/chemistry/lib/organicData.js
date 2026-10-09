export const FUNCTIONAL_GROUPS = [
  { id: 'alkane', name: 'Alkane', suffix: '-ane', general: 'CₙH₂ₙ₊₂', example: 'CH₄ Methane', description: 'Saturated hydrocarbons with only single C–C and C–H bonds.', reactions: ['Combustion', 'Halogenation (free radical substitution)'] },
  { id: 'alkene', name: 'Alkene', suffix: '-ene', general: 'CₙH₂ₙ', example: 'C₂H₄ Ethene', description: 'Unsaturated hydrocarbons with at least one C=C double bond.', reactions: ['Addition of H₂ / halogen / HX', 'Hydration', 'Polymerization'] },
  { id: 'alkyne', name: 'Alkyne', suffix: '-yne', general: 'CₙH₂ₙ₋₂', example: 'C₂H₂ Ethyne', description: 'Hydrocarbons containing a C≡C triple bond.', reactions: ['Addition', 'Terminal alkyne acidity'] },
  { id: 'alcohol', name: 'Alcohol', suffix: '-ol', general: 'R–OH', example: 'C₂H₅OH Ethanol', description: 'Compounds with a hydroxyl (–OH) group bonded to carbon.', reactions: ['Oxidation', 'Dehydration', 'Esterification'] },
  { id: 'aldehyde', name: 'Aldehyde', suffix: '-al', general: 'R–CHO', example: 'CH₃CHO Ethanal', description: 'Carbonyl group (C=O) with at least one H attached.', reactions: ['Oxidation to acid', 'Reduction to alcohol', 'Nucleophilic addition'] },
  { id: 'ketone', name: 'Ketone', suffix: '-one', general: 'R–CO–R′', example: 'CH₃COCH₃ Propanone', description: 'Carbonyl with two carbon substituents.', reactions: ['Reduction', 'Nucleophilic addition'] },
  { id: 'carboxylic', name: 'Carboxylic Acid', suffix: '-oic acid', general: 'R–COOH', example: 'CH₃COOH Ethanoic acid', description: 'Contains the carboxyl –COOH group; weak acids.', reactions: ['Esterification', 'Neutralization', 'Reduction'] },
  { id: 'ester', name: 'Ester', suffix: '-oate', general: 'R–COO–R′', example: 'CH₃COOC₂H₅ Ethyl ethanoate', description: 'Formed from acid + alcohol; often fragrant.', reactions: ['Hydrolysis (acid / base)'] },
  { id: 'ether', name: 'Ether', suffix: '-oxy', general: 'R–O–R′', example: 'C₂H₅OC₂H₅ Diethyl ether', description: 'Oxygen bridging two carbon groups.', reactions: ['Cleavage with strong acids'] },
  { id: 'amine', name: 'Amine', suffix: '-amine', general: 'R–NH₂', example: 'CH₃NH₂ Methylamine', description: 'Derivatives of ammonia; basic.', reactions: ['Reaction with acids', 'Diazotization (aromatic)'] },
  { id: 'amide', name: 'Amide', suffix: '-amide', general: 'R–CONH₂', example: 'CH₃CONH₂ Ethanamide', description: 'Acyl group bonded to nitrogen.', reactions: ['Hydrolysis', 'Hofmann rearrangement'] },
  { id: 'aromatic', name: 'Aromatic', suffix: 'benzene', general: 'C₆H₆', example: 'C₆H₆ Benzene', description: 'Planar ring with delocalized π electrons (Hückel 4n+2).', reactions: ['Electrophilic substitution', 'Friedel–Crafts'] },
  { id: 'haloalkane', name: 'Haloalkane', suffix: '-halide', general: 'R–X', example: 'CH₃Cl Chloromethane', description: 'Alkyl group bonded to a halogen.', reactions: ['Nucleophilic substitution (SN1 / SN2)', 'Elimination (E1 / E2)'] },
  { id: 'nitro', name: 'Nitro', suffix: 'nitro-', general: 'R–NO₂', example: 'C₆H₅NO₂ Nitrobenzene', description: 'Contains the –NO₂ group.', reactions: ['Reduction to amine'] },
];

export const IUPAC_RULES = [
  'Find the longest carbon chain (parent) and number it, giving the lowest set of locants to substituents.',
  'Name substituents alphabetically; use di-, tri- for multiples.',
  'Identify the principal functional group — it determines the suffix and gets the lowest possible number.',
  'For alkenes / alkynes, indicate the position of the multiple bond (e.g., but-2-ene).',
  'Cyclic compounds use the prefix cyclo- (e.g., cyclohexane).',
];