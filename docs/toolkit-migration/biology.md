# Biology laboratories: 2 laboratories, 31 features in total

Source of truth: the native catalogue in `src/shared/native/phase3.ts` (the only entries whose `domain` is `'biology'`, lines 398-490; the domain list itself is in `src/shared/native/manifest.ts` lines 45-64). The main process reads that catalogue through `src/main/native/service.ts` (`allApps`, line 244). Each laboratory's on-screen component is in `src/renderer/src/components/native/`, and the computing is done by `src/renderer/src/components/native/science.worker.ts`.

Line numbers below are from the files as they stand in this checkout.

---

## 1. Population Laboratory

- **Id:** `ecosystem-lab`
- **Catalogue entry:** `src/shared/native/phase3.ts`, lines 398-428
- **Component:** `src/renderer/src/components/native/EcosystemLab.tsx`
- **Computing:** `src/renderer/src/components/native/science.worker.ts`, lines 79-119
- **Settings declared:** `src/shared/native/phase3.ts`, lines 104-216

Features:

1. **Predator and prey model (Lotka-Volterra).** Runs two linked populations, prey and predators, and shows how they rise and fall together.
   - Implemented: `science.worker.ts` 104-113 (the equations); `phase3.ts` 105-117 (the model choice); `EcosystemLab.tsx` 54, 91.
2. **Logistic growth with a carrying capacity.** Runs one population that grows quickly at first, then levels off at the largest number the environment supports.
   - Implemented: `science.worker.ts` 94-98; capacity setting `phase3.ts` 179-189.
3. **Exponential growth, unlimited.** Runs one population that doubles on a fixed rhythm with no limit, to show what a carrying capacity prevents.
   - Implemented: `science.worker.ts` 99-102; `EcosystemLab.tsx` 195-205.
4. **Population over time chart.** Draws both populations (or the single one) against time as lines.
   - Implemented: `EcosystemLab.tsx` 226-264 (`TimeSeries`), shown from 116-122.
5. **Predators against prey plot (phase plot).** Plots one population against the other, so a repeating cycle appears as a closed loop, and solver drift appears as a spiral.
   - Implemented: `EcosystemLab.tsx` 267-295 (`PhasePlot`), shown from 136-147.
6. **Measured figures panel.** Reports the lowest, highest and final value of each population, the solver used, and how the run finished.
   - Implemented: `EcosystemLab.tsx` 69-82 (calculation), 151-183 (display).
7. **Solver choice (Euler, Runge-Kutta 4, adaptive).** Picks the method used to step the model forward. Euler drifts most at a coarse step; Runge-Kutta 4 is the accurate default.
   - Implemented: `phase3.ts` 204-215 (choice); `science.worker.ts` 83 (accepted methods).
8. **Run finish warning.** Says plainly when the solver diverged, could not progress, or hit its step limit, so an artefact is not read as a result.
   - Implemented: `EcosystemLab.tsx` 40-46 (wording), 84 (test), 105-112 (display).
9. **Near-extinction note.** Warns when a population falls below one, because the equations carry on with a fraction of an animal.
   - Implemented: `EcosystemLab.tsx` 86, 176-181.
10. **"What this model is not" panel.** Lists the assumptions of the chosen model (no space, no age, no other species, unlimited prey growth without predators).
    - Implemented: `EcosystemLab.tsx` 185-209.
11. **Starting population inputs.** Sets how many prey, and how many predators, the run begins with.
    - Implemented: `phase3.ts` 118-130.
12. **Growth and death rate inputs.** Sets the prey birth rate, the rate at which predators meet and eat prey, the predator death rate, and how much food becomes new predators.
    - Implemented: `phase3.ts` 131-177; used in `science.worker.ts` 104-107.
13. **Run length and timestep inputs.** Sets how long the model runs and how large each solver step is.
    - Implemented: `phase3.ts` 190-202; `science.worker.ts` 81-82.

Features in this laboratory: 13.

---

## 2. DNA Laboratory

- **Id:** `dna-lab`
- **Catalogue entry:** `src/shared/native/phase3.ts`, lines 460-490
- **Component:** `src/renderer/src/components/native/DnaLab.tsx`
- **Computing:** `src/renderer/src/components/native/science.worker.ts`, lines 186-202 (the sequence reader and translator it calls are not re-read here)
- **Settings declared:** `src/shared/native/phase3.ts`, lines 277-335

Features:

1. **Sequence reader (composition and GC content).** Counts each base A, T, G and C, and reports the GC percentage, the sequence length and the melting temperature.
   - Implemented: `science.worker.ts` 186-192 (reading and refusal of non-ACGT text); `DnaLab.tsx` 123-127 (header) and 257-276 (figures panel).
2. **Melting temperature.** Estimates the temperature at which the two strands separate, and says which method was used.
   - Implemented: `DnaLab.tsx` 125, 271-274 (display); the value itself is returned by the engine.
3. **Reverse complement (the other strand).** Shows the partner strand, read in the direction it is read, and notes when the sequence is its own reverse complement.
   - Implemented: `DnaLab.tsx` 278-287.
4. **Ambiguity code report.** Lists any non-standard letters (for example N or R) found in the sequence and what each means.
   - Implemented: `DnaLab.tsx` 289-304. Sequence entry rule: `phase3.ts` 277-285.
5. **Reading frame choice (1, 2 or 3).** Chooses which of the three forward frames is translated.
   - Implemented: `phase3.ts` 286-296 (setting); `DnaLab.tsx` 90 (read), 197 (heading).
6. **Codon-by-codon translation.** Splits the chosen frame into three-letter codons and shows the amino acid each one codes for, with stop codons marked.
   - Implemented: `DnaLab.tsx` 195-211.
7. **Protein output.** Shows the chain of amino acids the frame produces, with stops marked.
   - Implemented: `DnaLab.tsx` 213-221.
8. **Start and stop check.** Says whether the frame begins with a start codon and ends with a stop, so a wrong frame is suspected.
   - Implemented: `DnaLab.tsx` 223-229.
9. **Longest open stretch finder.** Finds the longest run from a start to a stop in the frame and reports its length and where it sits.
   - Implemented: calculated in the engine and shown at `DnaLab.tsx` 226-228 and 186-190.
10. **Strand map (where each reading frame sits).** Draws the three forward frames as bars along the whole sequence, so the frame with the long run is visible at a glance.
    - Implemented: `DnaLab.tsx` 157-193 (uses `Gantt` from `./Draw`).
11. **Other frames comparison.** For each frame not chosen, gives the number of stops and the longest run without one, with a caution that this is a hint, not a result.
    - Implemented: `DnaLab.tsx` 236-253.
12. **Substitution mutation.** Swaps one base at a chosen position for another and shows which codon changed.
    - Implemented: `DnaLab.tsx` 60-83 (`mutate`, substitution branch 78-82); controls `phase3.ts` 297-321 and 322-334.
13. **Insertion mutation.** Adds one base at a chosen position, which shifts every later codon.
    - Implemented: `DnaLab.tsx` 72-77; choice `phase3.ts` 322-334.
14. **Deletion mutation.** Removes one base, which shifts every later codon.
    - Implemented: `DnaLab.tsx` 66-71; choice `phase3.ts` 322-334.
15. **Mutated sequence view.** Re-reads the changed sequence and labels the view as mutated, with a sentence saying what changed.
    - Implemented: `DnaLab.tsx` 102-104 (second read), 117-122 (label), 142-146 (sentence).
16. **Mutation position and base inputs.** Sets the position to change (zero leaves the sequence alone) and the base to put there.
    - Implemented: `phase3.ts` 297-321.
17. **"What this does not model" panel.** Lists the limits: standard code only, no promoter, no splicing, no regulation, and no judgement of whether a change matters to an organism.
    - Implemented: `DnaLab.tsx` 306-314.
18. **Sequence input.** Lets the person type or paste a sequence, which is the basis for every other feature here.
    - Implemented: `phase3.ts` 277-285; `DnaLab.tsx` 89.

Features in this laboratory: 18.

Total across both laboratories: 13 + 18 = **31** features.

---

## Notes

- **Possible mismatch in the DNA Laboratory:** the file's header comment (`DnaLab.tsx` 18-22) says both the original and the mutated proteins are shown side by side. The code shows only the protein for the current sequence and labels which one it is (`DnaLab.tsx` 110-117). Feature 15 describes what the code does.
- **Not counted as laboratories:** the biology-flavoured items in the Jarvis toolkit (for example `src/renderer/src/features/jarvis/components/toolkit/engines/DnaReplicationLab.jsx`, `CellCycleLab.jsx`, `DnaAssemblyLab.jsx`, and the `wave7/food.js`, `wave8/pharma.js`, `wave14/mushroom.js`, `wave15/pest.js` files) are not in the native catalogue and their domain is not `'biology'` there. They are outside this inventory and were not inventoried.
