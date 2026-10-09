// Searchable trigonometry formula database. Pure data + helpers, no JSX.

export const FORMULA_CATEGORIES = [
  'Basic Ratios', 'Reciprocal', 'Quotient', 'Pythagorean', 'Negative Angles',
  'Allied Angles', 'Periodicity', 'Compound Angles', 'Double Angle', 'Triple Angle',
  'Half Angle', 'Power Reduction', 'Product-to-Sum', 'Sum-to-Product',
  'Inverse Trigonometry', 'Triangle', 'Equations', 'Inequalities',
];

// Each entry: { id, category, name, formula, meaning, use, example }
export const FORMULAS = [
  // Basic Ratios
  { id: 'b1', category: 'Basic Ratios', name: 'sin θ', formula: 'sin θ = opposite / hypotenuse', meaning: 'Ratio of the side opposite the angle to the hypotenuse.', use: 'Right-triangle problems and unit-circle y-coordinate.', example: 'In a 3-4-5 triangle, sin = 3/5 = 0.6.' },
  { id: 'b2', category: 'Basic Ratios', name: 'cos θ', formula: 'cos θ = adjacent / hypotenuse', meaning: 'Ratio of the adjacent side to the hypotenuse.', use: 'Right-triangle problems and unit-circle x-coordinate.', example: 'In a 3-4-5 triangle, cos = 4/5 = 0.8.' },
  { id: 'b3', category: 'Basic Ratios', name: 'tan θ', formula: 'tan θ = opposite / adjacent', meaning: 'Ratio of the opposite side to the adjacent side.', use: 'Slope, angles of elevation, right triangles.', example: 'In a 3-4-5 triangle, tan = 3/4 = 0.75.' },
  { id: 'b4', category: 'Basic Ratios', name: 'cosec θ', formula: 'cosec θ = hypotenuse / opposite', meaning: 'Reciprocal of sine.', use: 'When sin is known and you need the reciprocal ratio.', example: 'If sin θ = 1/2, then cosec θ = 2.' },
  { id: 'b5', category: 'Basic Ratios', name: 'sec θ', formula: 'sec θ = hypotenuse / adjacent', meaning: 'Reciprocal of cosine.', use: 'When cos is known and you need the reciprocal ratio.', example: 'If cos θ = √3/2, then sec θ = 2/√3.' },
  { id: 'b6', category: 'Basic Ratios', name: 'cot θ', formula: 'cot θ = adjacent / opposite', meaning: 'Reciprocal of tangent.', use: 'When tan is known and you need the reciprocal ratio.', example: 'If tan θ = 1, then cot θ = 1.' },

  // Reciprocal
  { id: 'r1', category: 'Reciprocal', name: 'sin ↔ cosec', formula: 'sin θ = 1/cosec θ,  cosec θ = 1/sin θ', meaning: 'Sine and cosecant are reciprocals.', use: 'Convert between sin and cosec.', example: 'sin 30° = 1/2 ⇒ cosec 30° = 2.' },
  { id: 'r2', category: 'Reciprocal', name: 'cos ↔ sec', formula: 'cos θ = 1/sec θ,  sec θ = 1/cos θ', meaning: 'Cosine and secant are reciprocals.', use: 'Convert between cos and sec.', example: 'cos 60° = 1/2 ⇒ sec 60° = 2.' },
  { id: 'r3', category: 'Reciprocal', name: 'tan ↔ cot', formula: 'tan θ = 1/cot θ,  cot θ = 1/tan θ', meaning: 'Tangent and cotangent are reciprocals.', use: 'Convert between tan and cot.', example: 'tan 45° = 1 ⇒ cot 45° = 1.' },

  // Quotient
  { id: 'q1', category: 'Quotient', name: 'tan as quotient', formula: 'tan θ = sin θ / cos θ', meaning: 'Tangent is sine divided by cosine.', use: 'Simplify expressions; undefined when cos θ = 0.', example: 'tan 90° is undefined since cos 90° = 0.' },
  { id: 'q2', category: 'Quotient', name: 'cot as quotient', formula: 'cot θ = cos θ / sin θ', meaning: 'Cotangent is cosine divided by sine.', use: 'Simplify expressions; undefined when sin θ = 0.', example: 'cot 0° is undefined since sin 0° = 0.' },

  // Pythagorean
  { id: 'p1', category: 'Pythagorean', name: 'Pythagorean identity', formula: 'sin²θ + cos²θ = 1', meaning: 'The fundamental identity from the unit circle (x² + y² = 1).', use: 'Convert between sin and cos; simplify.', example: 'If sin θ = 3/5, cos θ = ±4/5.' },
  { id: 'p2', category: 'Pythagorean', name: 'Secant identity', formula: '1 + tan²θ = sec²θ', meaning: 'Divide the Pythagorean identity by cos²θ.', use: 'Convert between tan and sec.', example: 'If tan θ = 2, sec²θ = 5 ⇒ sec θ = ±√5.' },
  { id: 'p3', category: 'Pythagorean', name: 'Cosecant identity', formula: '1 + cot²θ = cosec²θ', meaning: 'Divide the Pythagorean identity by sin²θ.', use: 'Convert between cot and cosec.', example: 'If cot θ = 1, cosec²θ = 2 ⇒ cosec θ = ±√2.' },
  { id: 'p4', category: 'Pythagorean', name: 'Rearranged forms', formula: 'sin²θ = 1 − cos²θ,  cos²θ = 1 − sin²θ', meaning: 'Solve for one squared ratio in terms of the other.', use: 'Sign depends on quadrant.', example: 'cos²θ = 1 − (1/2)² = 3/4.' },

  // Negative Angles
  { id: 'n1', category: 'Negative Angles', name: 'sin(−θ)', formula: 'sin(−θ) = −sin θ', meaning: 'Sine is an odd function.', use: 'Simplify negative angle expressions.', example: 'sin(−30°) = −1/2.' },
  { id: 'n2', category: 'Negative Angles', name: 'cos(−θ)', formula: 'cos(−θ) = cos θ', meaning: 'Cosine is an even function.', use: 'Simplify negative angle expressions.', example: 'cos(−60°) = 1/2.' },
  { id: 'n3', category: 'Negative Angles', name: 'tan(−θ)', formula: 'tan(−θ) = −tan θ', meaning: 'Tangent is an odd function.', use: 'Simplify negative angle expressions.', example: 'tan(−45°) = −1.' },
  { id: 'n4', category: 'Negative Angles', name: 'Reciprocal negatives', formula: 'cosec(−θ)=−cosecθ, sec(−θ)=secθ, cot(−θ)=−cotθ', meaning: 'cosec/cot odd, sec even — follow their reciprocals.', use: 'Extend odd/even behaviour to all six ratios.', example: 'sec(−60°) = 2.' },

  // Allied Angles
  { id: 'a1', category: 'Allied Angles', name: '90° − θ', formula: 'sin(90°−θ)=cosθ, cos(90°−θ)=sinθ, tan(90°−θ)=cotθ', meaning: 'Co-function identities (complementary angles).', use: 'Convert between ratio pairs.', example: 'sin 60° = cos 30° = √3/2.' },
  { id: 'a2', category: 'Allied Angles', name: '90° + θ', formula: 'sin(90°+θ)=cosθ, cos(90°+θ)=−sinθ, tan(90°+θ)=−cotθ', meaning: 'Second-quadrant shift with sign changes for cos/tan.', use: 'Reduce angles > 90°.', example: 'cos 120° = cos(90°+30°) = −sin 30° = −1/2.' },
  { id: 'a3', category: 'Allied Angles', name: '180° − θ', formula: 'sin(180°−θ)=sinθ, cos(180°−θ)=−cosθ, tan(180°−θ)=−tanθ', meaning: 'Second quadrant: sin stays, cos/tan flip sign.', use: 'Reference-angle sign logic.', example: 'sin 150° = sin 30° = 1/2.' },
  { id: 'a4', category: 'Allied Angles', name: '180° + θ', formula: 'sin(180°+θ)=−sinθ, cos(180°+θ)=−cosθ, tan(180°+θ)=tanθ', meaning: 'Third quadrant: sin/cos flip, tan stays.', use: 'Reduce angles in QIII.', example: 'tan 210° = tan 30° = 1/√3.' },
  { id: 'a5', category: 'Allied Angles', name: '270° − θ', formula: 'sin(270°−θ)=−cosθ, cos(270°−θ)=−sinθ, tan(270°−θ)=cotθ', meaning: 'Third/fourth quadrant shift.', use: 'Reduce angles near 270°.', example: 'cos 240° = cos(270°−30°) = −sin 30° = −1/2.' },
  { id: 'a6', category: 'Allied Angles', name: '270° + θ', formula: 'sin(270°+θ)=−cosθ, cos(270°+θ)=sinθ, tan(270°+θ)=−cotθ', meaning: 'Fourth quadrant shift.', use: 'Reduce angles > 270°.', example: 'sin 300° = sin(270°+30°) = −cos 30° = −√3/2.' },
  { id: 'a7', category: 'Allied Angles', name: '360° − θ', formula: 'sin(360°−θ)=−sinθ, cos(360°−θ)=cosθ, tan(360°−θ)=−tanθ', meaning: 'Fourth quadrant (negative angle equivalent).', use: 'Relate θ and −θ.', example: 'cos 330° = cos 30° = √3/2.' },
  { id: 'a8', category: 'Allied Angles', name: '360° + θ', formula: 'sin(360°+θ)=sinθ, cos(360°+θ)=cosθ, tan(360°+θ)=tanθ', meaning: 'Full rotation returns to the same position.', use: 'Coterminal angles.', example: 'sin 390° = sin 30° = 1/2.' },

  // Periodicity
  { id: 'pe1', category: 'Periodicity', name: 'sin/cos period', formula: 'sin(θ + 2nπ) = sin θ,  cos(θ + 2nπ) = cos θ', meaning: 'Sine and cosine repeat every 2π (360°).', use: 'General solutions of equations.', example: 'sin 750° = sin(30° + 2·360°) = sin 30°.' },
  { id: 'pe2', category: 'Periodicity', name: 'tan/cot period', formula: 'tan(θ + nπ) = tan θ,  cot(θ + nπ) = cot θ', meaning: 'Tangent and cotangent repeat every π (180°).', use: 'General solutions for tan equations.', example: 'tan 210° = tan 30°.' },
  { id: 'pe3', category: 'Periodicity', name: 'sec/cosec period', formula: 'sec(θ + 2nπ) = sec θ,  cosec(θ + 2nπ) = cosec θ', meaning: 'Reciprocals inherit the 2π period.', use: 'Periodic behaviour of reciprocal ratios.', example: 'sec 390° = sec 30°.' },

  // Compound Angles
  { id: 'c1', category: 'Compound Angles', name: 'sin(A + B)', formula: 'sin(A + B) = sin A cos B + cos A sin B', meaning: 'Sine of a sum of two angles.', use: 'Derive values for 15°, 75°, etc.', example: 'sin 75° = sin(45°+30°) = (√6+√2)/4.' },
  { id: 'c2', category: 'Compound Angles', name: 'sin(A − B)', formula: 'sin(A − B) = sin A cos B − cos A sin B', meaning: 'Sine of a difference.', use: 'Simplify difference expressions.', example: 'sin 15° = sin(45°−30°) = (√6−√2)/4.' },
  { id: 'c3', category: 'Compound Angles', name: 'cos(A + B)', formula: 'cos(A + B) = cos A cos B − sin A sin B', meaning: 'Cosine of a sum.', use: 'Combine cosine products.', example: 'cos 75° = cos(45°+30°) = (√6−√2)/4.' },
  { id: 'c4', category: 'Compound Angles', name: 'cos(A − B)', formula: 'cos(A − B) = cos A cos B + sin A sin B', meaning: 'Cosine of a difference.', use: 'Combine cosine products.', example: 'cos 15° = (√6+√2)/4.' },
  { id: 'c5', category: 'Compound Angles', name: 'tan(A + B)', formula: 'tan(A + B) = (tan A + tan B) / (1 − tan A tan B)', meaning: 'Tangent of a sum.', use: 'Combine tangents; undefined if denominator 0.', example: 'tan(45°+45°) = tan 90° (undefined).' },
  { id: 'c6', category: 'Compound Angles', name: 'tan(A − B)', formula: 'tan(A − B) = (tan A − tan B) / (1 + tan A tan B)', meaning: 'Tangent of a difference.', use: 'Combine tangents.', example: 'tan(60°−45°) = tan 15° = 2 − √3.' },

  // Double Angle
  { id: 'd1', category: 'Double Angle', name: 'sin 2A', formula: 'sin 2A = 2 sin A cos A', meaning: 'Double-angle sine.', use: 'Simplify or solve equations with 2A.', example: 'sin 60° = 2 sin 30° cos 30° = √3/2.' },
  { id: 'd2', category: 'Double Angle', name: 'cos 2A (form 1)', formula: 'cos 2A = cos²A − sin²A', meaning: 'Double-angle cosine, difference of squares.', use: 'Express cos 2A via sin/cos.', example: 'cos 60° = cos²30° − sin²30° = 1/2.' },
  { id: 'd3', category: 'Double Angle', name: 'cos 2A (form 2)', formula: 'cos 2A = 2cos²A − 1', meaning: 'Double-angle cosine in terms of cos only.', use: 'When only cos is known.', example: 'cos 60° = 2(3/4) − 1 = 1/2.' },
  { id: 'd4', category: 'Double Angle', name: 'cos 2A (form 3)', formula: 'cos 2A = 1 − 2sin²A', meaning: 'Double-angle cosine in terms of sin only.', use: 'When only sin is known.', example: 'cos 60° = 1 − 2(1/4) = 1/2.' },
  { id: 'd5', category: 'Double Angle', name: 'tan 2A', formula: 'tan 2A = 2 tan A / (1 − tan²A)', meaning: 'Double-angle tangent.', use: 'Combine tangent; undefined if 1 − tan²A = 0.', example: 'tan 60° = 2 tan 30°/(1 − 1/3) = √3.' },

  // Triple Angle
  { id: 't1', category: 'Triple Angle', name: 'sin 3A', formula: 'sin 3A = 3 sin A − 4 sin³A', meaning: 'Triple-angle sine.', use: 'Cubic in sin A.', example: 'sin 90° = 3(1/2) − 4(1/8) = 1 (for A=30°).' },
  { id: 't2', category: 'Triple Angle', name: 'cos 3A', formula: 'cos 3A = 4 cos³A − 3 cos A', meaning: 'Triple-angle cosine.', use: 'Cubic in cos A.', example: 'cos 90° = 4(√3/2)³ − 3(√3/2) = 0 (for A=30°).' },
  { id: 't3', category: 'Triple Angle', name: 'tan 3A', formula: 'tan 3A = (3 tan A − tan³A) / (1 − 3 tan²A)', meaning: 'Triple-angle tangent.', use: 'Combine triple tangent.', example: 'tan 90° undefined (for A=30°, denominator 0).' },

  // Half Angle
  { id: 'h1', category: 'Half Angle', name: 'sin(A/2)', formula: 'sin(A/2) = ±√((1 − cos A)/2)', meaning: 'Half-angle sine; sign by quadrant of A/2.', use: 'Find half-angle values.', example: 'sin 15° = √((1 − cos 30°)/2) = (√6−√2)/4.' },
  { id: 'h2', category: 'Half Angle', name: 'cos(A/2)', formula: 'cos(A/2) = ±√((1 + cos A)/2)', meaning: 'Half-angle cosine; sign by quadrant of A/2.', use: 'Find half-angle values.', example: 'cos 15° = √((1 + cos 30°)/2) = (√6+√2)/4.' },
  { id: 'h3', category: 'Half Angle', name: 'tan(A/2) — root form', formula: 'tan(A/2) = ±√((1 − cos A)/(1 + cos A))', meaning: 'Half-angle tangent as a root.', use: 'When sin/cos both known.', example: 'tan 22.5° = √2 − 1.' },
  { id: 'h4', category: 'Half Angle', name: 'tan(A/2) — sin form', formula: 'tan(A/2) = sin A / (1 + cos A)', meaning: 'Half-angle tangent without a root.', use: 'Avoids sign ambiguity.', example: 'tan 15° = sin 30°/(1+cos 30°) = 2 − √3.' },
  { id: 'h5', category: 'Half Angle', name: 'tan(A/2) — alt form', formula: 'tan(A/2) = (1 − cos A) / sin A', meaning: 'Alternative root-free form.', use: 'Equivalent to the sin form.', example: 'tan 15° = (1−cos 30°)/sin 30° = 2 − √3.' },

  // Power Reduction
  { id: 'pr1', category: 'Power Reduction', name: 'sin²A', formula: 'sin²A = (1 − cos 2A) / 2', meaning: 'Reduce the power of sine using cos 2A.', use: 'Integrate or simplify powers.', example: 'sin²30° = (1 − cos 60°)/2 = 1/4.' },
  { id: 'pr2', category: 'Power Reduction', name: 'cos²A', formula: 'cos²A = (1 + cos 2A) / 2', meaning: 'Reduce the power of cosine using cos 2A.', use: 'Integrate or simplify powers.', example: 'cos²30° = (1 + cos 60°)/2 = 3/4.' },
  { id: 'pr3', category: 'Power Reduction', name: 'tan²A', formula: 'tan²A = (1 − cos 2A) / (1 + cos 2A)', meaning: 'Reduce the power of tangent.', use: 'Express tan² via cos 2A.', example: 'tan²45° = 1.' },

  // Product-to-Sum
  { id: 'ps1', category: 'Product-to-Sum', name: '2 sin A cos B', formula: '2 sin A cos B = sin(A+B) + sin(A−B)', meaning: 'Product of sin and cos → sum of sines.', use: 'Simplify products.', example: '2 sin 75° cos 15° = sin 90° + sin 60°.' },
  { id: 'ps2', category: 'Product-to-Sum', name: '2 cos A sin B', formula: '2 cos A sin B = sin(A+B) − sin(A−B)', meaning: 'Product of cos and sin → difference of sines.', use: 'Simplify products.', example: 'Used in integration of products.' },
  { id: 'ps3', category: 'Product-to-Sum', name: '2 cos A cos B', formula: '2 cos A cos B = cos(A+B) + cos(A−B)', meaning: 'Product of cosines → sum of cosines.', use: 'Simplify products.', example: '2 cos 45° cos 15° = cos 60° + cos 30°.' },
  { id: 'ps4', category: 'Product-to-Sum', name: '2 sin A sin B', formula: '2 sin A sin B = cos(A−B) − cos(A+B)', meaning: 'Product of sines → difference of cosines.', use: 'Simplify products.', example: '2 sin 45° sin 15° = cos 30° − cos 60°.' },

  // Sum-to-Product
  { id: 'sp1', category: 'Sum-to-Product', name: 'sin A + sin B', formula: 'sin A + sin B = 2 sin((A+B)/2) cos((A−B)/2)', meaning: 'Sum of sines → product.', use: 'Factor sums of sines.', example: 'sin 75° + sin 15° = 2 sin 45° cos 30°.' },
  { id: 'sp2', category: 'Sum-to-Product', name: 'sin A − sin B', formula: 'sin A − sin B = 2 cos((A+B)/2) sin((A−B)/2)', meaning: 'Difference of sines → product.', use: 'Factor differences of sines.', example: 'sin 75° − sin 15° = 2 cos 45° sin 30°.' },
  { id: 'sp3', category: 'Sum-to-Product', name: 'cos A + cos B', formula: 'cos A + cos B = 2 cos((A+B)/2) cos((A−B)/2)', meaning: 'Sum of cosines → product.', use: 'Factor sums of cosines.', example: 'cos 75° + cos 15° = 2 cos 45° cos 30°.' },
  { id: 'sp4', category: 'Sum-to-Product', name: 'cos A − cos B', formula: 'cos A − cos B = −2 sin((A+B)/2) sin((A−B)/2)', meaning: 'Difference of cosines → product.', use: 'Factor differences of cosines.', example: 'cos 75° − cos 15° = −2 sin 45° sin 30°.' },

  // Inverse Trigonometry
  { id: 'i1', category: 'Inverse Trigonometry', name: 'Complementary inverse', formula: 'sin⁻¹x + cos⁻¹x = π/2', meaning: 'Sine and cosine inverses are complementary.', use: 'Convert between sin⁻¹ and cos⁻¹.', example: 'If sin⁻¹x = π/6, then cos⁻¹x = π/3.' },
  { id: 'i2', category: 'Inverse Trigonometry', name: 'tan/cot complementary', formula: 'tan⁻¹x + cot⁻¹x = π/2', meaning: 'Tangent and cotangent inverses are complementary.', use: 'Convert between tan⁻¹ and cot⁻¹.', example: 'tan⁻¹(1) + cot⁻¹(1) = π/2.' },
  { id: 'i3', category: 'Inverse Trigonometry', name: 'Negative argument', formula: 'sin⁻¹(−x) = −sin⁻¹x,  tan⁻¹(−x) = −tan⁻¹x', meaning: 'sin⁻¹ and tan⁻¹ are odd; cos⁻¹(−x) = π − cos⁻¹x.', use: 'Handle negative inputs to inverse functions.', example: 'cos⁻¹(−1/2) = π − π/3 = 2π/3.' },
  { id: 'i4', category: 'Inverse Trigonometry', name: 'Double tan⁻¹', formula: '2 tan⁻¹x = tan⁻¹(2x / (1 − x²)),  |x| < 1', meaning: 'Combines two equal tan⁻¹ terms.', use: 'Simplify 2 tan⁻¹ expressions.', example: '2 tan⁻¹(1/3) = tan⁻¹(3/4).' },
  { id: 'i5', category: 'Inverse Trigonometry', name: 'tan⁻¹ sum', formula: 'tan⁻¹x + tan⁻¹y = tan⁻¹((x+y)/(1−xy)),  xy < 1', meaning: 'Sum of two arctangents.', use: 'Combine arctangent terms.', example: 'tan⁻¹(1/2)+tan⁻¹(1/3)=tan⁻¹(1).' },

  // Triangle
  { id: 'tr1', category: 'Triangle', name: 'Sine rule', formula: 'a/sin A = b/sin B = c/sin C', meaning: 'Side lengths are proportional to sines of opposite angles.', use: 'Non-right triangles with known angle-side pairs.', example: 'Given A, B and side a, find b = a sin B / sin A.' },
  { id: 'tr2', category: 'Triangle', name: 'Cosine rule', formula: 'a² = b² + c² − 2bc cos A', meaning: 'Generalised Pythagoras for any triangle.', use: 'Find a side from two sides and the included angle.', example: 'a² = 4² + 5² − 2·4·5·cos 60° = 21 ⇒ a = √21.' },
  { id: 'tr3', category: 'Triangle', name: 'Area (SAS)', formula: 'Area = ½ bc sin A', meaning: 'Area from two sides and the included angle.', use: 'Triangle area without height.', example: 'Area = ½·4·5·sin 60° = 5√3.' },
  { id: 'tr4', category: 'Triangle', name: 'Heron formula', formula: 'Area = √(s(s−a)(s−b)(s−c)),  s = (a+b+c)/2', meaning: 'Area from three sides.', use: 'When all three sides are known.', example: 'Sides 3,4,5 → s=6 → Area=6.' },

  // Equations
  { id: 'e1', category: 'Equations', name: 'sin x = a', formula: 'x = nπ + (−1)ⁿ sin⁻¹a,  n ∈ ℤ', meaning: 'General solution for sine.', use: 'All solutions of sin x = a.', example: 'sin x = 1/2 ⇒ x = nπ + (−1)ⁿ π/6.' },
  { id: 'e2', category: 'Equations', name: 'cos x = a', formula: 'x = 2nπ ± cos⁻¹a,  n ∈ ℤ', meaning: 'General solution for cosine.', use: 'All solutions of cos x = a.', example: 'cos x = 1/2 ⇒ x = 2nπ ± π/3.' },
  { id: 'e3', category: 'Equations', name: 'tan x = a', formula: 'x = nπ + tan⁻¹a,  n ∈ ℤ', meaning: 'General solution for tangent (period π).', use: 'All solutions of tan x = a.', example: 'tan x = 1 ⇒ x = nπ + π/4.' },

  // Inequalities
  { id: 'in1', category: 'Inequalities', name: 'sin x > a', formula: 'Solve on unit circle: arcs where y > a', meaning: 'Visualise the horizontal line y = a on the unit circle.', use: 'Read off the arcs where sine exceeds a.', example: 'sin x > 1/2 ⇒ x ∈ (π/6, 5π/6) + 2nπ.' },
  { id: 'in2', category: 'Inequalities', name: 'cos x > a', formula: 'Solve on unit circle: arcs where x > a', meaning: 'Visualise the vertical line x = a on the unit circle.', use: 'Read off the arcs where cosine exceeds a.', example: 'cos x > 1/2 ⇒ x ∈ (−π/3, π/3) + 2nπ.' },
  { id: 'in3', category: 'Inequalities', name: 'tan x > a', formula: 'Solve on tangent period: (tan⁻¹a, π/2) + nπ', meaning: 'Tangent is increasing on each branch.', use: 'Account for asymptotes at π/2 + nπ.', example: 'tan x > 1 ⇒ x ∈ (π/4, π/2) + nπ.' },
];

export const searchFormulas = (query, category = 'all') => {
  let list = FORMULAS;
  if (category && category !== 'all') list = list.filter((f) => f.category === category);
  if (query) {
    const q = query.toLowerCase().trim();
    list = list.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.formula.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.meaning.toLowerCase().includes(q),
    );
  }
  return list;
};