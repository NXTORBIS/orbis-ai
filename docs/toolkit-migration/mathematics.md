# Mathematics laboratories: 9 laboratories, 47 features in total

Source of truth: the Native Apps catalogue in `src/shared/native/catalogue.ts` (domain `mathematics`, lines 482-626). Each laboratory's screen is in `src/renderer/src/components/PagesView.tsx`, `PageTools.tsx`, `PageLabs.tsx` or `ScienceLabs.tsx`, reached through `src/renderer/src/components/native/surfaces.tsx`. The parameters a laboratory can be set with are declared in `src/shared/native/catalogue.ts` (lines 288-413). The main process catalogue is `allApps` in `src/main/native/service.ts`.

Line numbers below are for the screen file unless another file is named.

---

## 1. Unit Converter

- Id: `unit-converter`
- Catalogue entry: `src/shared/native/catalogue.ts`, line 482. Parameters at line 288.
- Screen: `src/renderer/src/components/PagesView.tsx`, `UnitConverterPage`, line 699.

Features:

1. **Convert an amount** - type a number and two units, and see the amount in the new unit. (lines 723-748)
2. **Explain a refused conversion** - if the two units measure different kinds of thing, it says why instead of guessing. (lines 733-735, 820)
3. **Mark exact conversions** - shows "exact by definition" only when both units are exact by definition. (lines 816-817)
4. **Suggest target units** - offers the units that could work for the "from" unit, as clickable buttons. (lines 763-774, 822-830)
5. **Edit the amount and units** - three text boxes for amount, from-unit and to-unit. (lines 795-808)
6. **Save a conversion** - keeps the conversion in the Page's saved work. (lines 755-760, 836-842)

---

## 2. Equation Solver

- Id: `equation-solver`
- Catalogue entry: line 500. Parameters at line 294.
- Screen: `PagesView.tsx`, `EquationSolverPage`, line 849.

Features:

1. **Solve an equation** - type an equation and get its answers. (lines 863-874, 882-894)
2. **Check each answer** - a table shows each answer, how sure it is, and how far it is off when put back into the equation. (lines 907-929)
3. **Show answers with no real value** - states the two complex answers when there is no real one. (lines 931-939)
4. **Show the working** - a "How it got there" panel lists each step. (lines 947-956)
5. **Mark repeated answers** - an answer that counts twice is labelled "(twice)". (lines 919-921)
6. **Solve several equations together** - separate equations with semicolons and they are solved as a system. The screen sends the text unchanged, so this depends on the solver engine; the parameter description states it (`src/shared/native/catalogue.ts`, line 300).
7. **Save an equation** - (lines 960-970)

---

## 3. Calculus Laboratory

- Id: `calculus-lab`
- Catalogue entry: line 516. Parameters at line 305.
- Screen: `PagesView.tsx`, `CalculusLabPage`, line 977.

Features:

1. **Simplify an expression** - rewrites it in a tidier form. (lines 1008-1009, 1070-1076)
2. **Differentiate** - works out the derivative with respect to a chosen letter. (lines 1011-1018, 1077-1084)
3. **Refuse functions with no derivative rule** - abs, sign, floor, ceil and round are refused by name rather than given a wrong answer. (lines 1012-1015, 1095-1098)
4. **Find the value at a point** - evaluates the expression, or its derivative, at a chosen value. (lines 1034-1040, 1085-1092)
5. **Draw the function and its derivative together** - two curves on one picture, over a range around the chosen point. (lines 1020-1032, 1054)
6. **Save an expression** - (lines 1099-1109)

---

## 4. Function Plotter

- Id: `function-plotter`
- Catalogue entry: line 533. Parameters at line 222.
- Screen: `src/renderer/src/components/PageTools.tsx`, `FunctionPlotterPage`, line 305.

Features:

1. **Plot y = f(x)** - draws an ordinary function over a range. (lines 338-342, 421)
2. **Plot a parametric curve** - enter x(t) and y(t) and it draws the pair. (lines 348-350, 401-406)
3. **Plot a polar curve** - enter r(theta) and it draws the curve. (lines 343-347)
4. **Choose the plot kind** - three tabs: y = f(x), parametric, polar. (lines 381-394)
5. **Set the range** - From and To boxes. (lines 408-417)
6. **Report the work done** - says how many points were worked out, and that the curve was cut where it jumped instead of joined across. (lines 423-429)
7. **Save a plot** - (lines 432-442)

---

## 5. Algebra Lab

- Id: `algebra-lab`
- Catalogue entry: line 554. Parameters at line 311.
- Screen: `src/renderer/src/components/PageLabs.tsx`, `AlgebraLabPage`, line 83.

Features:

1. **Find the roots of a polynomial** - give the coefficients, lowest power first, and get the exact and numeric roots. (lines 87-91, 104-120)
2. **Warn when not every root was found** - (lines 113-117)
3. **Turn a decimal into an exact fraction** - a repeating decimal becomes the fraction it really is. (lines 92, 122-133)

---

## 6. Matrix Lab

- Id: `matrix-lab`
- Catalogue entry: line 568. Parameters at line 323.
- Screen: `PageLabs.tsx`, `MatrixLabPage`, line 140.

Features:

1. **Solve a set of linear equations** - gives a unique answer, infinitely many, or no solution, and says which. (lines 153-157, 186-198)
2. **Report the rank and the solution space** - (lines 158-162, 199-204)
3. **Draw a two-by-two system as two lines** - the crossing point is the answer. (lines 183-185; drawing at `PageLabs.tsx` line 901)
4. **Enter the matrix** - one row per line, values separated by spaces. (lines 140-151, 168-171)

---

## 7. Geometry Lab (triangles)

- Id: `geometry-lab`
- Catalogue entry: line 585. Parameters at line 335.
- Screen: `PageLabs.tsx`, `GeometryLabPage`, line 217.

Features:

1. **Say what kind of triangle it is** - (lines 227-231, 252-256)
2. **Area and perimeter** - (line 256)
3. **Side lengths** - (lines 257-261)
4. **Name the angles** - a recognised exact angle is named as that value (lines 263-265)
5. **Draw the triangle** - the picture moves as the three points are changed. (line 251; drawing at `PageLabs.tsx` line 854)

---

## 8. Number Lab

- Id: `number-lab`
- Catalogue entry: line 598. Parameters at line 341.
- Screen: `PageLabs.tsx`, `NumberLabPage`, line 282.

Features:

1. **Test whether a number is prime** - works with very large whole numbers. (lines 285, 297-308)
2. **Warn about probable primes** - says a result is probable, not proven, for very large numbers. (lines 301-306)
3. **Factorise a number** - breaks it into prime factors. (lines 286, 309-320)
4. **Warn about an incomplete factorisation** - says what is left over rather than calling it prime. (lines 313-318)

---

## 9. Coordinate Lab

- Id: `coordinate-lab`
- Catalogue entry: line 614. Parameters at line 413.
- Screen: `src/renderer/src/components/ScienceLabs.tsx`, `CoordinateLabPage`, line 527.

Features:

1. **Convert a point to spherical coordinates** - radius, polar angle and azimuth. (lines 540-544, 593-608)
2. **Convert a point to cylindrical coordinates** - radius from the z axis, azimuth and height. (lines 545-549, 610-625)
3. **Choose the angle convention** - physics or mathematics; the two swap the meaning of the angles. (lines 582-590)
4. **Choose degrees or radians** - (lines 566-578)
5. **Rotate a point about an axis** - enter an axis and an angle, and see the new point. (lines 550-562, 627-643)

---

## Discrepancy found while reading (not fixed)

- The Coordinate Lab convention option is `maths` in the catalogue (`src/shared/native/catalogue.ts`, line 423) but `mathematics` on the screen (`src/renderer/src/components/ScienceLabs.tsx`, line 587). A parameter set to `mathematics` would not match the declared option.
