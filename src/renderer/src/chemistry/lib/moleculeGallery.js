/*
 * The molecules the Molecular Studio draws in its gallery.
 *
 * NOT the user's own file — their `src/lib/moleculeGallery.js` is not in any extracted archive. Written from how
 * their studio draws each one: `{ name, formula, atoms: [{sym, x, y, color}], bonds: [{a, b, o}] }`, where a and
 * b are indices into atoms and o is the bond order, inside a 240×180 box.
 *
 * The geometry is the real shape, not a tidy diagram: water is bent near 104.5°, ammonia is pyramidal, methane
 * is drawn as the usual two-in-plane-two-wedged projection of a tetrahedron, benzene is a regular hexagon with
 * alternating orders, and carbon dioxide is straight. A molecule drawn with the wrong angle teaches the wrong
 * shape, which is the one thing a gallery like this is for.
 */

// The usual CPK-ish colours, so the same element is the same colour in every picture.
const C = { H: '#f1f5f9', C: '#94a3b8', N: '#60a5fa', O: '#f87171', S: '#fbbf24', Cl: '#4ade80' };

/** Places an atom, rounding so the SVG coordinates stay readable. */
const at = (sym, x, y) => ({ sym, x: Math.round(x), y: Math.round(y), color: C[sym] ?? '#cbd5e1' });

// A bond length that looks right at this scale.
const L = 42;
const mid = { x: 120, y: 90 };

/** Polar placement from a centre, with 0° pointing right and angles measured anticlockwise. */
const from = (sym, cx, cy, deg, len = L) =>
  at(sym, cx + len * Math.cos((deg * Math.PI) / 180), cy - len * Math.sin((deg * Math.PI) / 180));

export const MOLECULES = [
  {
    name: 'Water',
    formula: 'H2O',
    // 104.5° between the two O–H bonds, drawn symmetrically about the vertical.
    atoms: [at('O', mid.x, mid.y - 12), from('H', mid.x, mid.y - 12, -37.75), from('H', mid.x, mid.y - 12, -142.25)],
    bonds: [{ a: 0, b: 1, o: 1 }, { a: 0, b: 2, o: 1 }]
  },
  {
    name: 'Carbon dioxide',
    formula: 'CO2',
    // Linear, 180°.
    atoms: [at('C', mid.x, mid.y), from('O', mid.x, mid.y, 0, 46), from('O', mid.x, mid.y, 180, 46)],
    bonds: [{ a: 0, b: 1, o: 2 }, { a: 0, b: 2, o: 2 }]
  },
  {
    name: 'Ammonia',
    formula: 'NH3',
    // Pyramidal: one bond up, two spread below, which is how a trigonal pyramid projects.
    atoms: [at('N', mid.x, mid.y - 6), from('H', mid.x, mid.y - 6, -90), from('H', mid.x, mid.y - 6, -20), from('H', mid.x, mid.y - 6, -160)],
    bonds: [{ a: 0, b: 1, o: 1 }, { a: 0, b: 2, o: 1 }, { a: 0, b: 3, o: 1 }]
  },
  {
    name: 'Methane',
    formula: 'CH4',
    // The standard projection of a tetrahedron: two in the plane, two out of it.
    atoms: [
      at('C', mid.x, mid.y),
      from('H', mid.x, mid.y, 90),
      from('H', mid.x, mid.y, -90),
      from('H', mid.x, mid.y, 160),
      from('H', mid.x, mid.y, 20)
    ],
    bonds: [{ a: 0, b: 1, o: 1 }, { a: 0, b: 2, o: 1 }, { a: 0, b: 3, o: 1 }, { a: 0, b: 4, o: 1 }]
  },
  {
    name: 'Ethene',
    formula: 'C2H4',
    // Planar, 120° at each carbon, with the double bond between them.
    atoms: [
      at('C', mid.x - 22, mid.y),
      at('C', mid.x + 22, mid.y),
      from('H', mid.x - 22, mid.y, 150, 36),
      from('H', mid.x - 22, mid.y, -150, 36),
      from('H', mid.x + 22, mid.y, 30, 36),
      from('H', mid.x + 22, mid.y, -30, 36)
    ],
    bonds: [
      { a: 0, b: 1, o: 2 },
      { a: 0, b: 2, o: 1 },
      { a: 0, b: 3, o: 1 },
      { a: 1, b: 4, o: 1 },
      { a: 1, b: 5, o: 1 }
    ]
  },
  {
    name: 'Benzene',
    formula: 'C6H6',
    /*
     * A regular hexagon. The orders alternate because that is the Kekulé picture the formula implies, and the
     * studio draws a double bond as a thicker line; the real molecule has all six bonds the same length, which
     * is why the ring is drawn regular rather than with long and short sides.
     */
    atoms: [
      ...Array.from({ length: 6 }, (_, i) => from('C', mid.x, mid.y, 90 - i * 60, 34)),
      ...Array.from({ length: 6 }, (_, i) => from('H', mid.x, mid.y, 90 - i * 60, 62))
    ],
    bonds: [
      ...Array.from({ length: 6 }, (_, i) => ({ a: i, b: (i + 1) % 6, o: i % 2 === 0 ? 2 : 1 })),
      ...Array.from({ length: 6 }, (_, i) => ({ a: i, b: 6 + i, o: 1 }))
    ]
  },
  {
    name: 'Hydrogen chloride',
    formula: 'HCl',
    atoms: [at('H', mid.x - 24, mid.y), at('Cl', mid.x + 24, mid.y)],
    bonds: [{ a: 0, b: 1, o: 1 }]
  },
  {
    name: 'Hydrogen sulfide',
    formula: 'H2S',
    // Bent like water but tighter, about 92°, because sulfur's bonding pair repulsion is weaker.
    atoms: [at('S', mid.x, mid.y - 12), from('H', mid.x, mid.y - 12, -44), from('H', mid.x, mid.y - 12, -136)],
    bonds: [{ a: 0, b: 1, o: 1 }, { a: 0, b: 2, o: 1 }]
  },
  {
    name: 'Nitrogen',
    formula: 'N2',
    atoms: [at('N', mid.x - 22, mid.y), at('N', mid.x + 22, mid.y)],
    // Triple in reality; the studio draws anything above order 1 as a thick line, so 2 is the thickest it shows.
    bonds: [{ a: 0, b: 1, o: 2 }]
  },
  {
    name: 'Oxygen',
    formula: 'O2',
    atoms: [at('O', mid.x - 22, mid.y), at('O', mid.x + 22, mid.y)],
    bonds: [{ a: 0, b: 1, o: 2 }]
  },
  {
    name: 'Ethanol',
    formula: 'C2H6O',
    atoms: [
      at('C', mid.x - 44, mid.y + 8),
      at('C', mid.x - 4, mid.y - 10),
      at('O', mid.x + 36, mid.y + 8),
      from('H', mid.x + 36, mid.y + 8, -20, 32),
      from('H', mid.x - 44, mid.y + 8, 150, 32),
      from('H', mid.x - 44, mid.y + 8, -120, 32),
      from('H', mid.x - 44, mid.y + 8, 100, 32)
    ],
    bonds: [
      { a: 0, b: 1, o: 1 },
      { a: 1, b: 2, o: 1 },
      { a: 2, b: 3, o: 1 },
      { a: 0, b: 4, o: 1 },
      { a: 0, b: 5, o: 1 },
      { a: 0, b: 6, o: 1 }
    ]
  },
  {
    name: 'Sulfur dioxide',
    formula: 'SO2',
    // Bent, about 119°, because of the lone pair on sulfur — not linear like CO₂.
    atoms: [at('S', mid.x, mid.y - 10), from('O', mid.x, mid.y - 10, -30.5, 44), from('O', mid.x, mid.y - 10, -149.5, 44)],
    bonds: [{ a: 0, b: 1, o: 2 }, { a: 0, b: 2, o: 2 }]
  }
];

export function getMolecule(formula) {
  return MOLECULES.find((one) => one.formula === formula) ?? null;
}
