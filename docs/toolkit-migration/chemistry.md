# Chemistry: 2 laboratories, 116 features

Scope: the two chemistry laboratories in the live catalogue (`allApps` in `src/shared/native/registry.ts`, fed by `src/main/native/service.ts:208`). Seven older chemistry laboratories were retired and are left out of the count; they are listed at the end for reference. Line numbers are from the files as they stand now. Where a feature is a sub-tool of a studio module, the line is the start of that tool's own component.

---

## Laboratory 1: Chemistry Studio

- **Id:** `chemistry-studio`
- **Declared in:** `src/shared/native/phase10.ts` (catalogue entry at line 92; capabilities at lines 116-119; parameters at lines 8-48)
- **Mounted by:** `src/renderer/src/components/native/ChemistryStudio.tsx` (component at line 20)
- **Pages:** `src/renderer/src/chemistry/StudioPage.jsx` (routes at lines 21-54)
- **Hub page:** `src/renderer/src/chemistry/ChemistryStudio.jsx` (main component at line 47)

### Studio hub (the front page)

1. **Interactive periodic table:** a full grid of the elements that opens each element's own page. (`src/renderer/src/chemistry/ChemistryStudio.jsx:204`)
2. **Featured element:** shows one element picked for the day. (`ChemistryStudio.jsx:225`)
3. **Daily chemistry fact:** one short fact shown on the front page. (`ChemistryStudio.jsx:246`)
4. **Formula of the day:** one formula with a short explanation. (`ChemistryStudio.jsx:252`)
5. **Reaction of the day:** one reaction shown for study. (`ChemistryStudio.jsx:261`)
6. **Today's quiz:** a short chemistry question on the front page. (`ChemistryStudio.jsx:269`)
7. **Favorites and recently viewed:** keeps the elements and items a person has opened. (`ChemistryStudio.jsx:292`)
8. **AI chemistry assistant:** a chat panel for chemistry questions inside the studio. (`ChemistryStudio.jsx:321`)

### Module 1: Periodic Table (`periodic`, route `/chemistry`)

9. **Element table grid:** the periodic table itself. (`ChemistryStudio.jsx:204`)
10. **Element detail page:** one element's properties, shown on its own page. (`src/renderer/src/chemistry/ElementDetail.jsx:65`)
11. **Ask AI about an element:** buttons that send the element to the AI for an explanation. (`ElementDetail.jsx:42`)

### Module 2: Combination Engine (`combine`, route `/chemistry/combine`)

12. **Choose elements to combine:** pick elements from the table to build a set. (`src/renderer/src/chemistry/CombinationEngine.jsx:56`, picker at line 147)
13. **Feasibility notes:** warnings about whether the chosen elements can really combine. (`CombinationEngine.jsx:213`)
14. **Predicted compounds:** the compounds the chosen elements can form, each with a card. (`CombinationEngine.jsx:15` for the card, list at line 220)
15. **Balanced synthesis equations:** the balanced equation for making each predicted compound. (`CombinationEngine.jsx:229`)
16. **AI analysis of a combination:** an explanation of the chosen combination from the AI. (`CombinationEngine.jsx:244`)

### Module 3: Molecular Studio (`molecules`, route `/chemistry/molecules`)

17. **Type a formula:** enter any formula and see the molecule drawn. (`src/renderer/src/chemistry/MolecularStudio.jsx:12`, input at line 33)
18. **Quick formula picks:** one-tap buttons for common formulas. (`MolecularStudio.jsx:37`)
19. **Molecule gallery:** a set of ready molecules to open. (`MolecularStudio.jsx:93`)

### Module 4: Organic (`organic`, route `/chemistry/organic`)

20. **Functional group list:** the list of organic families to browse. (`src/renderer/src/chemistry/OrganicExplorer.jsx:9`)
21. **Functional group detail:** the chosen family's formula, name and typical reactions. (`OrganicExplorer.jsx:29`)

### Module 5: Inorganic (`inorganic`, route `/chemistry/inorganic`)

22. **Trend chooser:** switch the chart between electronegativity, atomic radius, melting point and boiling point. (`src/renderer/src/chemistry/InorganicExplorer.jsx:10-13` for the four trends, selector at line 17)
23. **Inorganic family detail:** one family of inorganic compounds, with its trend. (`InorganicExplorer.jsx:43`)

### Module 6: Reaction Lab (`reactions`, route `/chemistry/reactions`)

24. **Filter by reaction type:** narrow the list to one kind of reaction. (`src/renderer/src/chemistry/ReactionLab.jsx:30-32`)
25. **Reaction list:** pick any reaction from the list. (`ReactionLab.jsx:37`)
26. **Reaction detail:** the chosen reaction's name and explanation. (`ReactionLab.jsx:51`)
27. **Run the reaction:** animate the chosen reaction. (`ReactionLab.jsx:59`)

### Module 7: Virtual Lab (`lab`, route `/chemistry/lab`)

28. **Titration experiment:** add base drop by drop and watch the curve and the end point. (`src/renderer/src/chemistry/VirtualLab.jsx:32`)
29. **Flame test:** choose a metal and see the flame colour it gives. (`VirtualLab.jsx:75`)

### Module 8: Physical Chemistry (`physical`, route `/chemistry/physical`)

30. **Thermodynamics:** energy, entropy and free energy for a reaction. (`src/renderer/src/chemistry/studios/PhysicalChemistry.jsx:52`)
31. **Equilibrium:** how far a reaction goes at a chosen temperature. (`PhysicalChemistry.jsx:93`)
32. **Phase changes:** vapour pressure and boiling for a liquid. (`PhysicalChemistry.jsx:137`)
33. **Colligative properties:** how dissolved particles raise the boiling point and create osmotic pressure. (`PhysicalChemistry.jsx:165`)
34. **Chemical potential:** how a substance's potential changes with its amount. (`PhysicalChemistry.jsx:208`)

### Module 9: Chemical Kinetics (`kinetics`, route `/chemistry/kinetics`)

35. **Basic kinetics:** follow a concentration over time for one-step reactions. (`src/renderer/src/chemistry/studios/KineticsStudio.jsx:71`)
36. **Reaction networks:** consecutive, parallel and reversible reactions, chosen from a list. (`KineticsStudio.jsx:128-130`)
37. **Advanced networks:** more complex reaction schemes. (`KineticsStudio.jsx:133`)
38. **Arrhenius analysis:** how the rate changes with temperature. (`KineticsStudio.jsx:182`)

### Module 10: Electrochemistry (`electrochem`, route `/chemistry/electrochemistry`)

39. **Galvanic cell:** build a battery from two electrodes and read its voltage. (`src/renderer/src/chemistry/studios/ElectrochemistryStudio.jsx:67`)
40. **Nernst equation:** correct the voltage for non-standard concentrations. (`ElectrochemistryStudio.jsx:104`)
41. **Electrolysis:** how much metal a current deposits over time. (`ElectrochemistryStudio.jsx:146`)
42. **Corrosion:** which metal corrodes when two are joined. (`ElectrochemistryStudio.jsx:172`)

### Module 11: Quantum Chemistry (`quantum`, route `/chemistry/quantum`)

43. **Electron configuration:** choose an element and see how its electrons fill the shells. (`src/renderer/src/chemistry/QuantumChemistry.jsx:31`, element slider at line 32, builder at line 7)
44. **Orbital boxes:** the orbitals of each sub-shell drawn as boxes. (`QuantumChemistry.jsx:20`)

### Module 12: Spectroscopy (`spectroscopy`, route `/chemistry/spectroscopy`)

45. **IR (vibrations):** the infrared peak positions for common bonds. (`src/renderer/src/chemistry/studios/SpectroscopyStudio.jsx:48`)
46. **UV-Vis (electronic):** the absorption of light by a sample, using Beer-Lambert. (`SpectroscopyStudio.jsx:93`)
47. **NMR (nuclear):** the NMR frequency for a chosen nucleus. (`SpectroscopyStudio.jsx:144`)
48. **Mass spectrometry:** the fragment peaks of a molecule. (`SpectroscopyStudio.jsx:182`)

### Module 13: Biochemistry (`biochem`, route `/chemistry/biochemistry`)

49. **Amino acids and pI:** the charge and isoelectric point of each amino acid. (`src/renderer/src/chemistry/studios/BiochemistryStudio.jsx:40`)
50. **Enzyme kinetics:** Michaelis-Menten rate curve for an enzyme. (`BiochemistryStudio.jsx:112`)
51. **DNA and nucleic acids:** the melting temperature of a DNA strand. (`BiochemistryStudio.jsx:152`)
52. **Protein stability:** how a protein's stability changes with conditions. (`BiochemistryStudio.jsx:202`)

### Module 14: Materials Chemistry (`materials`, route `/chemistry/materials`)

53. **Crystal and Bragg diffraction:** the angles at which a crystal reflects X-rays. (`src/renderer/src/chemistry/studios/MaterialsStudio.jsx:35`)
54. **Band gap and optics:** the band gap of a material from its absorption edge. (`MaterialsStudio.jsx:80`)
55. **Point defects:** how many vacancies a crystal holds at a temperature. (`MaterialsStudio.jsx:124`)
56. **XRD d-spacing:** the spacing between crystal planes from the diffraction pattern. (`MaterialsStudio.jsx:164`)

### Module 15: Polymer Chemistry (`polymer`, route `/chemistry/polymer`)

57. **Molecular weight and spread:** the average weight and polydispersity of a polymer. (`src/renderer/src/chemistry/studios/PolymerStudio.jsx:31`)
58. **Polymerization kinetics:** how the chain grows as the reaction proceeds. (`PolymerStudio.jsx:74`)
59. **Chain dimensions:** the size of a polymer coil. (`PolymerStudio.jsx:112`)
60. **Crosslink density:** the stiffness of a crosslinked network. (`PolymerStudio.jsx:151`)

### Module 16: Analytical Chemistry (`analytical`, route `/chemistry/analytical`)

61. **Titration:** the titration curve and the equivalence volume. (`src/renderer/src/chemistry/studios/AnalyticalStudio.jsx:31`)
62. **Chromatography:** the resolution between two peaks. (`AnalyticalStudio.jsx:91`)
63. **Gravimetric analysis:** the percent of analyte from a precipitate's mass. (`AnalyticalStudio.jsx:136`)
64. **Calibration line:** a least-squares fit from standards to an unknown. (`AnalyticalStudio.jsx:162`)

### Module 17: Chemical Engineering (`engineering`, route `/chemistry/engineering`)

65. **Reactor design:** the volume needed for a CSTR or PFR. (`src/renderer/src/chemistry/studios/EngineeringStudio.jsx:31`)
66. **Mass balance:** the flows in and out of a unit. (`EngineeringStudio.jsx:79`)
67. **Energy balance:** the heat in and out of a unit. (`EngineeringStudio.jsx:106`)
68. **Distillation:** the stages of a distillation column. (`EngineeringStudio.jsx:147`)

### Module 18: Environmental Chemistry (`environmental`, route `/chemistry/environmental`)

69. **Atmosphere:** pressure falling with height. (`src/renderer/src/chemistry/studios/EnvironmentalStudio.jsx:30`)
70. **Acid rain:** the pH of rain from its acid content. (`EnvironmentalStudio.jsx:68`)
71. **Greenhouse forcing:** the warming from a rise in CO2. (`EnvironmentalStudio.jsx:118`)
72. **Carbon cycle:** how carbon is shared between air, ocean, land and fossil fuels. (`EnvironmentalStudio.jsx:156`)

### Module 19: Nuclear Chemistry (`nuclear`, route `/chemistry/nuclear`)

73. **Radioactive decay:** how much of a sample is left after a time. (`src/renderer/src/chemistry/studios/NuclearStudio.jsx:31`)
74. **Decay chains:** the daughters produced as a chain of decays runs. (`NuclearStudio.jsx:73`)
75. **Fission energy:** the energy released when uranium or plutonium splits. (`NuclearStudio.jsx:122`)
76. **Fusion energy:** the energy released by a chosen fusion reaction. (`NuclearStudio.jsx:152`)

### Module 20: Astrochemistry (`astro`, route `/chemistry/astro`)

77. **Molecular clouds:** the Jeans mass needed for a cloud to collapse. (`src/renderer/src/chemistry/studios/AstrochemistryStudio.jsx:36`)
78. **Reaction rates at low temperature:** reaction speed in cold space. (`AstrochemistryStudio.jsx:83`)
79. **Atmospheric escape:** whether a gas can escape a planet. (`AstrochemistryStudio.jsx:122`)
80. **Prebiotic inventory:** the molecules found in space that matter for life. (`AstrochemistryStudio.jsx:173`)

### Module 21: Surface Chemistry (`surface`, route `/chemistry/surface`)

81. **Langmuir isotherm:** how much gas sticks to a surface at a pressure. (`src/renderer/src/chemistry/studios/SurfaceStudio.jsx:31`)
82. **BET surface area:** the surface area of a solid from gas uptake. (`SurfaceStudio.jsx:68`)
83. **Contact angle:** how a liquid wets a surface. (`SurfaceStudio.jsx:108`)
84. **Catalysis turnover:** how many reactions per site per second. (`SurfaceStudio.jsx:149`)

### Module 22: Chemical Data Lab (`datalab`, route `/chemistry/data`)

85. **Statistics and fit:** mean and spread of a set of measurements. (`src/renderer/src/chemistry/studios/DataLabStudio.jsx:31`)
86. **Linear regression:** the best straight line through data. (`DataLabStudio.jsx:68`)
87. **Error propagation:** how the error of a result follows from its inputs. (`DataLabStudio.jsx:124`)
88. **Outlier detection:** flags points that sit far from the rest. (`DataLabStudio.jsx:159`)

### Module 23: Frontier Chemistry (`frontier`, route `/chemistry/frontier`)

89. **CO2 reduction:** the energy and products of turning CO2 into fuel. (`src/renderer/src/chemistry/studios/FrontierStudio.jsx:31`)
90. **Artificial photosynthesis:** the efficiency of storing sunlight as chemistry. (`FrontierStudio.jsx:74`)
91. **Catalysis challenges:** the rate of a catalyst against its energy barrier. (`FrontierStudio.jsx:114`)
92. **Open problems:** a list of unsolved chemistry questions. (`FrontierStudio.jsx:171`)

### Module 24: Research Workspace (`research`, route `/chemistry/research`)

93. **Design and run an experiment:** pick a measurement and run it. (`src/renderer/src/chemistry/studios/ResearchStudio.jsx:138`)
94. **Measurement: bond energy as the bond stretches:** (`ResearchStudio.jsx:61`)
95. **Measurement: reaction barrier as the energy change varies:** (`ResearchStudio.jsx:86`)
96. **Measurement: orbital size as the nuclear charge rises:** (`ResearchStudio.jsx:102`)
97. **Measurement: node count as the shell number rises:** (`ResearchStudio.jsx:119`)
98. **What was found and saved work:** the results view and the store of saved experiments. The tabs are named at `ResearchStudio.jsx:20`; the view code for these two tabs was not traced further.

### Module 25: Chemical Visualization (`visualization`, route `/chemistry/visualization`)

99. **Molecules in 3D:** a molecule drawn in three dimensions. (`src/renderer/src/chemistry/studios/VisualizationStudio.jsx:66`)
100. **Orbitals:** the shapes of hydrogen-like orbitals. (`VisualizationStudio.jsx:409`)
101. **Bond energy:** how the energy of a bond changes as it stretches. (`VisualizationStudio.jsx:525`)
102. **Reaction path:** a one-step or two-step reaction path with an intermediate. (`VisualizationStudio.jsx:588`)
103. **Energy surface:** the energy landscape of a reaction. (`VisualizationStudio.jsx:665`)

### Module 26: Calculator (`calc`, route `/chemistry/calculator`)

104. **Molar mass:** the mass of one mole of a formula. (`src/renderer/src/chemistry/ChemistryCalculator.jsx:41`)
105. **Moles:** convert between mass and moles. (`ChemistryCalculator.jsx:52`)
106. **Molarity:** concentration of a solution. (`ChemistryCalculator.jsx:68`)
107. **pH:** the pH of an acid or base. (`ChemistryCalculator.jsx:82`)
108. **Gas law:** the missing quantity in PV = nRT. (`ChemistryCalculator.jsx:94`)
109. **Dilution:** how much stock and water make a wanted concentration. (`ChemistryCalculator.jsx:113`)
110. **Percent composition:** the share of mass each element carries. (`ChemistryCalculator.jsx:132`)

**Studio total: 8 hub features and 101 module features, 109 in all.**

---

## Laboratory 2: Chemistry Calculator (native)

- **Id:** `chem-calculator`
- **Declared in:** `src/shared/native/phase6.ts` (catalogue entry at line 353; capabilities at lines 365-368; parameters at lines 56-103)
- **Component:** `src/renderer/src/components/native/ChemCalculatorLab.tsx` (component at line 53; tab state at line 56)

111. **Molar mass and composition:** the mass of a formula and what it is made of by mass. (`ChemCalculatorLab.tsx:161`)
112. **Percent composition:** the share of mass each element carries. (`ChemCalculatorLab.tsx:183`)
113. **Moles:** convert between mass and moles. (`ChemCalculatorLab.tsx:217`)
114. **Molarity:** concentration from moles and volume. (`ChemCalculatorLab.tsx:224`)
115. **pH:** the pH of an acid or base, with a scale that shows where it sits. (`ChemCalculatorLab.tsx:244`)
116. **Gas law:** the missing quantity in PV = nRT. (`ChemCalculatorLab.tsx:265`)
117. **Dilution:** how much stock and water make a wanted concentration. (`ChemCalculatorLab.tsx:272`)

Note: the native calculator has seven features, and the studio's Calculator module (items 104-110) is a separate page with its own code. Both are counted, because both are reachable.

---

## Not in the catalogue: retired chemistry laboratories

These are still on disk but are marked `supersededBy: 'chemistry-studio'`, so `allApps` leaves them out (`src/shared/native/registry.ts:166-170`). They are not counted above. Their declared features are in `src/shared/native/phase6.ts`.

- **Periodic Table** (`periodic-table`, `src/renderer/src/components/native/PeriodicTableLab.tsx`): browse elements; describe an element (`phase6.ts:329-330`).
- **Reaction Laboratory** (`reaction-lab`, `ReactionsLab.tsx`): balance an equation; reaction energy; equilibrium; rate law; temperature dependence (`phase6.ts:401-405`).
- **Electrochemistry Laboratory** (`electro-lab`, `ElectroLab.tsx`): cell voltage; Nernst correction; electrolysis (`phase6.ts:440-442`).
- **Titration Laboratory** (`titration-lab`, `TitrationLab.tsx`): titration curve; indicator choice; flame test (`phase6.ts:477-479`).
- **Organic Laboratory** (`organic-lab`, `OrganicLab.tsx`): functional groups; name a chain; build a series (`phase6.ts:516-518`).
- **Combination Laboratory** (`combination-engine`, `CombinationLab.tsx`): combine elements; predict by valence; write synthesis (`phase6.ts:555-557`).
- **Molecular Laboratory** (`molecular-studio`, `MolecularStudioLab.tsx`): weigh a formula; composition; empirical formula (`phase6.ts:593-595`).

Retired features: 22 (not counted). Component-level line numbers for these were not traced.

---

## Summary

- Laboratories in the catalogue: **2** (Chemistry Studio, Chemistry Calculator).
- Features in total: **116** (109 in the Studio, 7 in the native Calculator).
