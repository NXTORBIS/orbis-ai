# Study laboratories: every laboratory and feature

Summary: 10 laboratories, 38 features in total.

Scope: the 10 entries whose catalogue domain is `study` in `src/shared/native/catalogue.ts`. Each feature below is something a person can see or do on the laboratory's screen. Where the calculation engine has a further operation that no screen calls yet, it is listed under "Engine only, no screen" and is not counted as a feature.

How each laboratory is wired:
- Catalogue entry: `src/shared/native/catalogue.ts`
- Screen mapping: `src/renderer/src/components/native/surfaces.tsx` (lines 275 to 298)
- Screen component: `src/renderer/src/components/PageLabs.tsx`, `ScienceLabs.tsx`, or `PageTools.tsx`
- Calculation engine: `src/main/pages/studyEngines.ts`, `reasoningEngines.ts`, `scienceEngines.ts`, or `engines.ts`

---

## 1. Measurement Lab

- Id: `measurement-lab`
- Screen file: `src/renderer/src/components/PageTools.tsx` (component `MeasurementLabPage`, starts line 776)
- Catalogue: `src/shared/native/catalogue.ts` line 716
- Engine: `src/main/pages/engines.ts` (`measurement.combine` line 788, `measurement.repeated` line 805, `measurement.agree` line 820)

1. Combine two measurements. Type each value, its plus-or-minus uncertainty and its unit, and see the combined result with its uncertainty worked out. (PageTools.tsx 859 for the first measurement; second measurement follows the same row; engine engines.ts 788)
2. Choose how to combine them. Four buttons: add, subtract, multiply, divide. (PageTools.tsx 860-864)
3. Work out one measurement from repeated readings. Type a list of readings and a unit to get the average and how much they spread. (PageTools.tsx 883-896; engine engines.ts 805)
4. Check whether two measurements agree. Shows a plain verdict beneath the combined result when both measure the same kind of thing. (PageTools.tsx 799-818 runs the check; text shown from the result at about line 880; engine engines.ts 820)
5. Save this measurement. Keeps the current values as a saved page. (PageTools.tsx 919)

## 2. Uncertainty Lab

- Id: `uncertainty-lab`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `UncertaintyLabPage`, lines 332-384)
- Catalogue: `src/shared/native/catalogue.ts` line 728; its parameter list is at line 352
- Engine: `src/main/pages/studyEngines.ts` (`uncertainty.compare`, lines 603-615)

1. Enter the formula and the inputs. Write the formula over the input names and give each input a value and an uncertainty. (PageLabs.tsx 333-334, inputs box 337)
2. Linear result. Shows the answer and its uncertainty using the simple method, which estimates the spread from how fast the formula changes. (PageLabs.tsx 359-361; engine studyEngines.ts 603-615)
3. Sampled result. Shows the answer and its uncertainty using 20,000 random draws, fixed to seed 1 so it can be repeated. (PageLabs.tsx 364-366; call at line 339)
4. Agreement verdict and differences. Says whether the two methods agree, and lists where they differ. (PageLabs.tsx 357 for the verdict, 369 for the list)

## 3. Significant Figures

- Id: `significant-figures`
- Screen file: `src/renderer/src/components/ScienceLabs.tsx` (component `SignificantFiguresPage`, lines 340-441)
- Catalogue: `src/shared/native/catalogue.ts` line 741
- Engine: `src/main/pages/scienceEngines.ts` (`precision.read` line 687, `precision.write` line 699, `precision.combine` line 709, `precision.represent` line 730)

1. Count the significant figures in a written number. Type a number as somebody wrote it and see how many digits it claims, or that it does not say. (ScienceLabs.tsx 349, result 371-376)
2. Combine two numbers to the precision they earned. Pick add, subtract, multiply, divide or power. Shows the rounded answer and the unrounded one. (Operation choice 381-391; call at 350-353; result 398-405)
3. Write a number to a chosen count of figures. Pick plain, scientific or engineering notation. (Inputs and notation choice 410-420; call at 355-357; result 424-431)
4. Warn when a decimal cannot be stored exactly. Shows a note when the number is not exact in binary. (ScienceLabs.tsx 360 for the check, note shown at the end of the component)

## 4. Constants Library

- Id: `constants-library`
- Screen file: `src/renderer/src/components/ScienceLabs.tsx` (component `ConstantsLibraryPage`, lines 443-520)
- Catalogue: `src/shared/native/catalogue.ts` line 755
- Engine: `src/main/pages/scienceEngines.ts` (`constants.search` line 752, `constants.get` line 755, `constants.compare` line 772)

1. Search for a constant. Type a name or a keyword such as "planck" or "gravitational". (ScienceLabs.tsx 449)
2. Pick a constant from the results. Up to 18 shown as buttons. (ScienceLabs.tsx 466-478 chip list; empty message at 485)
3. See the full entry. Symbol, value, unit, uncertainty, the source, the published text, and what it is defined as. (Call 450; result 488-505)
4. Compare your own measurement with it. Type a measurement and its uncertainty and see whether they are consistent. (Inputs and call 451-456; result 517-520)

## 5. Constraint Checker

- Id: `constraint-checker`
- Screen file: `src/renderer/src/components/ScienceLabs.tsx` (component `ConstraintCheckerPage`, starts line 665)
- Catalogue: `src/shared/native/catalogue.ts` line 769
- Engine: `src/main/pages/scienceEngines.ts` (`constraints.check` line 887, `constraints.feasible` line 893)

1. Check values against rules. Type the rules and the values as JSON; bad JSON is reported in plain words. (ScienceLabs.tsx 666-678; call 680-686)
2. See which rules hold and which fail. Counts of satisfied, violated, not checkable and malformed rules, with a headline. (ScienceLabs.tsx 732-738)
3. See which limits are at their edge. Each rule is listed, and one at its limit is marked "at its limit". (ScienceLabs.tsx 741-748)
4. Spot rules that cannot all hold together. Lists the conflicts between the rules before any values are tried. (Call 688-690; conflict list 718-727)

## 6. Parameter Study

- Id: `parameter-study`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `ParameterStudyPage`, lines 386-441)
- Catalogue: `src/shared/native/catalogue.ts` line 921
- Engine: `src/main/pages/studyEngines.ts` (`study.size` line 617, `study.run` line 627)

1. Set the formula and the parameters to sweep. The formula is written over the parameter names; the parameters and the sweep plan are JSON. (PageLabs.tsx 387-398)
2. See how many cases the sweep will make before running it. (Call 395; result 416-418)
3. Run the sweep and see the outcome. Shows how many cases finished, how many failed, and how many were removed by the constraints. (Call 400; result 423-435)

## 7. Scenario Lab

- Id: `scenario-lab`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `ScenarioLabPage`, lines 586-627)
- Catalogue: `src/shared/native/catalogue.ts` line 938
- Engine: `src/main/pages/reasoningEngines.ts` (`scenario.resolve` line 670)

1. Describe the baseline and the scenarios. Write the starting values and each scenario as a set of changes, JSON. (PageLabs.tsx 589-603; call 594)
2. See what each scenario changes from the baseline. Lists each changed value, what it was, what it became, and any step it passes through. (PageLabs.tsx 611-616)
3. See changes that could not be applied. Refused changes are listed with the reason instead of being dropped. (PageLabs.tsx 616)

## 8. Problem Workspace

- Id: `problem-workspace`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `ProblemWorkspacePage`, lines 546-584)
- Catalogue: `src/shared/native/catalogue.ts` line 966
- Engine: `src/main/pages/reasoningEngines.ts` (`workspace.assumptions` line 645, `workspace.report` line 660)

1. Lay out the problem as linked parts. Assumptions, calculations and results, joined by links, entered as JSON. (PageLabs.tsx 547-553)
2. See what rests on what. Lists each assumption a result depends on. (Call 554; list 573)
3. Read the report. Sections are built from the workspace, and a list says what the report does not establish. (Call 559; sections 574-577; caveats 578)

## 9. Explain It Yourself

- Id: `explain-it-yourself`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `ExplainYourselfPage`, lines 629-693)
- Catalogue: `src/shared/native/catalogue.ts` line 979
- Engine: `src/main/pages/reasoningEngines.ts` (`learning.analyse` line 722, `learning.hint` line 729)

1. Write your explanation and see which key concepts it covers. Each concept is marked mentioned or not, and essential ones are marked. (PageLabs.tsx 634-647; call 639; list 666-668)
2. Spot a likely wrong belief. Flags a misconception the explanation could lead to, with the reason. (PageLabs.tsx 669-672)
3. Get a hint at a chosen level, from 1 to 6. The hint gets more direct as the level rises. (Hint level input 677-686; call 644; text 687)
4. Get a follow-up question. Shows one question after the analysis. (PageLabs.tsx 675 area, question shown after the result)

## 10. Project

- Id: `project`
- Screen file: `src/renderer/src/components/PageLabs.tsx` (component `ProjectPage`, lines 747-811)
- Catalogue: `src/shared/native/catalogue.ts` line 1021
- Engine: `src/main/pages/reasoningEngines.ts` (`project.check` line 793, `project.order` line 798)

1. Check that a graph of pages holds together. Shows whether the project will run or not, from a headline. (Call 755; headline 778)
2. See what is wrong, split into blocking problems and things worth a look. (Call 755; list 781)
3. See outputs nothing uses, and connections that lose information in a conversion. (PageLabs.tsx 785 and 791)
4. See the run order in steps. Pages that can run together are grouped. (Call 760; list 799-802)

---

## Engine only, no screen

These operations exist in the engine but no control on the laboratory's screen calls them. They are not counted above.

- Uncertainty Lab: `uncertainty.propagate`, `uncertainty.montecarlo`, `uncertainty.sensitivity`, `uncertainty.budget`, `uncertainty.distribution` (`src/main/pages/studyEngines.ts` lines 558-602).
- Parameter Study: `study.sensitivity` (line 641), `study.tornado` (649), `study.target` (665), `study.surface` (681), `study.robustness` (688). The catalogue says it can show which inputs the answer depends on, but no screen does that yet.
- Scenario Lab: `scenario.check` and `scenario.matrix` (`reasoningEngines.ts` lines 670 and onward).
- Problem Workspace: `workspace.impact`, `workspace.staleness`, `workspace.approaches` (`reasoningEngines.ts` lines 648-659).
- Project: `runProject` in `src/shared/pages/lab.ts` line 767. The screen checks and orders the project but has no run button.
