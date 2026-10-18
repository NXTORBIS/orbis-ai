# Making things: laboratory inventory

3 laboratories, 33 features in total (Document Studio 12, Builder Studio 15, Flowchart 6).

Source of the subject: `src/shared/native/catalogue.ts` holds the three apps whose `domain` is `creative` (lines 991-1061). The subject name "Making things" is set in `src/renderer/src/components/labs/LabsView.tsx:53`. Nothing else in `src/` uses the `creative` domain.

Note on the catalogue's `can` names (`composeDocument`, `buildPage`, `drawFlowchart`, `editDiagram`): none of these names is dispatched anywhere in the code. The lab is reached through the surface map in `src/renderer/src/components/native/surfaces.tsx`, and the features below are the ones the engine calls actually perform.

---

## 1. Document Studio

- Id: `document-studio`
- Catalogue entry: `src/shared/native/catalogue.ts:991-1005`
- Page definition: `src/main/pages/builtins.ts:554-580`
- Lab screen: `src/renderer/src/components/PageLabs.tsx:443-497` (`DocumentStudioPage`)
- Surface mapping: `src/renderer/src/components/native/surfaces.tsx:286`
- Engine calls: `src/main/pages/studyEngines.ts:699-768`
- Shared document code: `src/shared/compute/document.ts`

Features:

1. **Read Markdown into a structured document.** Turns plain Markdown text into headings, paragraphs, lists and tables that the rest of the tools can work on. Implemented at `src/main/pages/studyEngines.ts:714-720` and `src/shared/compute/document.ts:542` (`fromMarkdown`). Shown on screen as the Markdown box.
2. **Read HTML safely.** Takes pasted HTML, keeps only an allow-list of tags, drops everything else and reports what it dropped. Nothing from the page runs. Implemented at `src/main/pages/studyEngines.ts:714-720`, `src/shared/compute/document.ts:1223` (`fromHtml`), and `src/shared/compute/document.ts:1403` (`safeHref`, which refuses unsafe links).
3. **Outline with computed numbers.** Lists the headings in order with numbers such as 1, 1.1, 2, worked out from the structure so that moving a section renumbers the rest. Shown on screen as "Outline". Implemented at `src/main/pages/studyEngines.ts:699-703`, `src/shared/compute/document.ts:252` (`outlineOf`), `:322` (`assignSections`) and `:347` (`numbering`).
4. **Cross-reference check.** Finds references to a heading or figure whose target is missing, so they fail visibly instead of showing a question mark. Implemented at `src/main/pages/studyEngines.ts:704-706` and `src/shared/compute/document.ts:371` (`resolveReferences`).
5. **Citations in four styles.** Formats a list of sources as APA, MLA, Chicago or IEEE, and can check that the citations in a document match a source list. Implemented at `src/main/pages/studyEngines.ts:707-713`, `src/shared/compute/document.ts:445` (`formatCitation`) and `:496` (`checkCitations`).
6. **Write back to Markdown.** Turns the structured document back into Markdown text. Implemented at `src/main/pages/studyEngines.ts:721-722` and `src/shared/compute/document.ts:1013` (`toMarkdown`).
7. **Search the document.** Finds text anywhere in the document, with options for upper and lower case, whole words and regular expressions, and a result limit. Implemented at `src/main/pages/studyEngines.ts:724-734` and `src/shared/compute/document.ts:1471` (`search`).
8. **Word count and reading time.** Counts the words and gives an estimate of minutes to read, at a rate the person can set. Shown on screen as "N words" and "About N minutes". Implemented at `src/main/pages/studyEngines.ts:735-737` and `src/shared/compute/document.ts:1820` (`analyse`).
9. **Check against a document rule set (schema).** Tests whether the document has the sections and references a given rule set requires, and says which requirements fail. Implemented at `src/main/pages/studyEngines.ts:738-744` and `src/shared/compute/document.ts:1749` (`validateAgainst`). Not shown on the lab screen; reachable by engine call only.
10. **Template fields.** Lists the placeholders used in a document and fills them from values given, reporting any that stay unfilled. Implemented at `src/main/pages/studyEngines.ts:745-758`, `src/shared/compute/document.ts:1664` (`variablesUsed`) and `:1688` (`resolveVariables`). Not shown on the lab screen; reachable by engine call only.
11. **Compare two documents.** Lists each block as added, removed, changed, moved or unchanged, so a moved paragraph is not reported as a deletion and a re-add. Implemented at `src/main/pages/studyEngines.ts:759-761` and `src/shared/compute/document.ts:2016` (`diffDocuments`). Not shown on the lab screen; reachable by engine call only.
12. **Text tools.** Changes the case of a text (upper, lower, title and similar) and wraps long lines to a set width. Implemented at `src/main/pages/studyEngines.ts:762-768`, `src/shared/compute/document.ts:1590` (`transformText`) and `:1632` (`wrapLines`). Not shown on the lab screen; reachable by engine call only.

Present in the shared code but not reachable from any engine call, so left out of the feature list: moving, inserting and removing blocks (`document.ts:1908`, `:1929`, `:1946`, `:1967`) and find-and-replace (`document.ts:1520`, `replaceAll`).

---

## 2. Builder Studio

- Id: `builder-studio`
- Catalogue entry: `src/shared/native/catalogue.ts:1006-1019`
- Page definition: `src/main/pages/builtins.ts:711-737`
- Lab screen: `src/renderer/src/components/PageLabs.tsx:695-745` (`BuilderStudioPage`)
- Surface mapping: `src/renderer/src/components/native/surfaces.tsx:291`
- Engine calls: `src/main/pages/reasoningEngines.ts:747-790`
- Shared builder code: `src/shared/pages/builders.ts`

Features:

1. **Check a diagram for problems.** Reads an artifact (a list of boxes, connectors, layers and groups) and reports what would stop it working, and what is only worth a look. Shown on screen as "What was found". Implemented at `src/main/pages/reasoningEngines.ts:747-755` and `src/shared/pages/builders.ts:172` (`validate`); group-loop detection at `:252` (`findGroupCycle`).
2. **Flowchart rules.** Requires one start, at least one end when the flow should finish, a decision with two labelled ways out, and no box that cannot be reached from the start. Implemented at `src/shared/pages/builders.ts:690-712`, with the shared checks at `:653` (`oneEntry`) and `:662` (`unreachable`).
3. **Mind map rules.** Requires one root and flags any branch with two parents, which would make it a graph instead. Implemented at `src/shared/pages/builders.ts:713-740` (two-parent check at `:733`).
4. **Timeline rules.** Checks the timeline's own structure. Implemented at `src/shared/pages/builders.ts:741-766`.
5. **Form rules.** Checks the form's fields. Implemented at `src/shared/pages/builders.ts:767-797`.
6. **Checklist rules.** Flags an item ticked while something it waits on is not ticked. Implemented at `src/shared/pages/builders.ts:798-819` (message at `:811`).
7. **Decision tree rules.** Checks the tree's branches. Implemented at `src/shared/pages/builders.ts:820-844`.
8. **Table rules.** Flags a table with rows and no columns, and a column with no name. Implemented at `src/shared/pages/builders.ts:845-870` (`:858`, `:865`).
9. **Calculator rules.** Flags a calculator that works nothing out. Implemented at `src/shared/pages/builders.ts:871-893` (`:879`).
10. **Select objects.** Picks objects by id and expands a group to everything inside it, reporting any id it cannot find. Implemented at `src/main/pages/reasoningEngines.ts:756-758` and `src/shared/pages/builders.ts:282` (`resolveSelection`); group expansion at `:319` (`topGroupOf`).
11. **Line objects up.** Aligns the selected objects to the left, right, top, bottom or either centre. Implemented at `src/main/pages/reasoningEngines.ts:759-773` and `src/shared/pages/builders.ts:338` (`align`).
12. **Spread objects evenly.** Spaces the selected objects out evenly across the horizontal or vertical axis. Implemented at `src/main/pages/reasoningEngines.ts:762-766` and `src/shared/pages/builders.ts:380` (`distribute`).
13. **Route a connector around objects.** Draws the line between two boxes at right angles and reports any object the line passes through. Implemented at `src/main/pages/reasoningEngines.ts:774-781`, `src/shared/pages/builders.ts:427` (`routeConnector`) and `:455` (`crossedBy`).
14. **Check what a behaviour does.** Checks that each action attached to an object refers to something that exists, and that a compute action has an expression. Implemented at `src/main/pages/reasoningEngines.ts:782-789` and `src/shared/pages/builders.ts:501` (`checkBehaviour`).
15. **Find loops between bindings.** Reports if the bindings between behaviours form a cycle. Implemented at `src/main/pages/reasoningEngines.ts:782-789` and `src/shared/pages/builders.ts:563` (`bindingCycle`).

Only feature 1 is on the lab screen. Features 2 to 15 are reachable by engine call only. Present in the shared code but not reachable from any engine call, so left out: version upgrade of an artifact (`builders.ts:612`, `migrate`), grid snapping (`builders.ts:408`, `snap`) and the binding diagram (`builders.ts:552`, `bindingGraph`).

---

## 3. Flowchart

- Id: `flowchart`
- Catalogue entry: `src/shared/native/catalogue.ts:1040-1061`
- Surface: the Creation Engine's diagram kind, `src/shared/visual/kinds.ts:62` ("Open it as a flowchart")
- Diagram view: `src/renderer/src/components/CreateView.tsx:1022` (plot or diagram shown as an opened item) and `src/renderer/src/components/ArtifactCard.tsx`
- Generation and revision: `src/main/artifacts/generation.ts`
- Layout: `src/shared/artifacts/diagram.ts`

This laboratory has no component under `src/renderer/src/components/native/` of its own. Its work is done by the Creation Engine.

Features:

1. **Draw a flowchart from a description.** The model proposes boxes (step, decision, start, end) and labelled arrows, and Orbis turns them into an editable flowchart. The model never gives positions. Implemented at `src/main/artifacts/generation.ts:694-698`, with the instructions at `:174-175` and `:183`.
2. **Place the boxes automatically.** Each box goes one step past the furthest box that points at it, so the flow reads in one direction. Implemented at `src/shared/artifacts/diagram.ts:48` (`levelsOf`) and `:97` (`flowToArtifact`).
3. **Draw loop-backs as loops.** An arrow that goes back to an earlier step, such as "no, try again", is left out of the placing step so the earlier box does not get pushed to the wrong side. Implemented at `src/shared/artifacts/diagram.ts:55-68`.
4. **Choose across or down by size.** Flows of up to five levels run across the page; longer ones run down it. Implemented at `src/shared/artifacts/diagram.ts:89` (`ACROSS_UP_TO`) and `:103`.
5. **Change a flowchart by describing the change.** Sends the current flowchart and the requested change back to the model, which must keep the same ids and leave the rest as it is. Implemented at `src/main/artifacts/generation.ts:525` (`revise`) and `:133-150` (`reviseInstructions`).
6. **Check a flowchart's rules.** The flowchart rules in feature 2 of Builder Studio (one start, labelled decision exits, nothing unreachable) apply to every flowchart. Implemented at `src/shared/pages/builders.ts:690-712`.

Open question for the lab owner: the three `can` names in the catalogue (`drawFlowchart`, `editDiagram`) are not matched by any dispatcher, so the lab is only reached through the Creation Engine.

---

## Totals

- Laboratories: 3
- Features: 12 (Document Studio) + 15 (Builder Studio) + 6 (Flowchart) = 33
