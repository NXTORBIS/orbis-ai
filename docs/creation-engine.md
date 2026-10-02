# The Creation Engine

What Orbis can make, keep and save, how it is built, and the rules every part of it follows. This is the map; the
code comments are the detail.

## What it is

One place where a person makes something and Orbis keeps it: the **Create** screen (wordmark menu → Create, or type
`/create` in the chat box). Everything made is an **artifact**: it has a kind, a title, versions, and a copy on disk
that was read back and checked before anything said it was kept.

| Kind | What it is | Comes from | Saves as |
| --- | --- | --- | --- |
| Table | Rows and columns with a type (and a unit) per column | Pasted text, a file (CSV, TSV, JSON, Excel), a sentence, a template, a table taken out of a document, a join | CSV, Excel, TSV, JSON, NDJSON, Markdown, text |
| Document | Headings, paragraphs, lists, tables, figures | Pasted Markdown, a file (Markdown, HTML, text, Word, PDF), a sentence, a template, a chat reply | Markdown, HTML, PDF, Word, slides, text |
| Chart | Numbers drawn against numbers | The columns of a table. Never written by a model | SVG, PNG |
| Diagram | A flowchart: boxes and arrows | A sentence. Orion names the boxes and arrows; Orbis lays them out | SVG, PNG |
| Code | One source file in a named language | Pasted text, a source file, a sentence, a code block in a chat reply | Its language's own extension |

## The division of labour

Orion decides *what* and writes *words*. Engines do everything that has a right answer.

- A table's numbers are never written by a model. A sentence like "only HQ, biggest first, add solar ÷ consumption"
  becomes a list of steps; the model is shown the column names and types and none of the data; the table engine runs
  the steps and says what each one did.
- A chart is drawn from a table's own columns. A proposal for a chart from a model is refused and pointed at the table.
- A flowchart's positions are worked out by the layout, never proposed.
- Code is kept and never run. Where a language has a reader (JSON, XML, JavaScript by compiling) the file is checked;
  for every other language the note says it was not checked.

## The rules

1. **`src/shared/artifacts/kinds.ts` is the only answer to "what can Orbis create".** A format is listed only when a
   tested writer exists whose output is read back and verified.
2. **Nothing is reported as made or saved until the file has been read back from disk and checked.** The checks are
   named and shown: size, hash, and what the format itself can prove (a workbook re-opened and compared, a PDF's
   pages counted, a PNG decoded and found not to be one flat colour, the pictures inside a Word file counted).
3. **Content does not cross to the interface.** A record and a bounded preview do.
4. **Nothing is replaced.** Every change is a new version; the one before is kept and can be restored.
5. **The secret gate runs at write time.** Text that looks like it holds a key or a password is stopped and shown,
   and only the person who was shown it can say "write it anyway".
6. **Save and open dialogs run in the main process.** A path never arrives from the interface.
7. **One door.** One IPC channel, `creation:run`, and a frozen map of operations. An operation not in the map cannot
   run.
8. **A model's answer is read by a deny-by-default validator**, argued with once when it is wrong, and then the same
   deterministic builders run that pasted text goes through. Every artifact a model had a hand in says so in its notes.
9. **What a format leaves out is said**, in plain words, before and after saving.

## Operations (`creation:run`)

`artifact.kinds` · `artifact.languages` · `artifact.templates`

Making: `artifact.create` (pasted text) · `artifact.generate` (a sentence) · `artifact.fromTemplate` ·
`artifact.import` (a file the person opens)

Looking: `artifact.list` · `artifact.search` · `artifact.read` · `artifact.versions`

Changing: `artifact.update` (replace with new text) · `artifact.restore` · `artifact.rename` · `artifact.duplicate` ·
`artifact.remove` · `artifact.revise` (a document, flowchart or code file, by instruction) ·
`artifact.transform` (a table, by steps or by a sentence) · `artifact.join` (two tables)

Deriving: `artifact.analyse` (a table → a computed report) · `artifact.chart` (a table → a chart) ·
`artifact.extractTable` (a document → one of its tables) · `artifact.place` (a chart or diagram → a figure in a
document)

Saving: `artifact.export`

The Orb reaches the same service through five capabilities: `artifact.make`, `artifact.list`, `artifact.change`,
`artifact.chart`, `artifact.revise`.

## Where things live

| | |
| --- | --- |
| `src/shared/artifacts/` | Pure, no Electron: kinds, the record model, naming, the secret gate, verification, the proposal validator, analysis, table steps, templates, table extraction, languages, the chart and diagram drawing, flowchart layout |
| `src/main/artifacts/service.ts` | Every operation. Knows nothing about windows or dialogs |
| `src/main/artifacts/store.ts` | `<profile>/artifacts/<id>/current/` and `versions/<versionId>/`, staged then renamed |
| `src/main/artifacts/generation.ts` | Asking Orion: make, revise, plan table steps |
| `src/main/artifacts/office.ts` | Excel, Word and slides, written and read back |
| `src/main/artifacts/importing.ts` | Reading files in |
| `src/main/artifacts/ipc.ts` | The only Electron file: the two dialogs, the print window (PDF) and the drawing window (PNG) |
| `src/main/artifacts/capabilities.ts` | The Orb's way in |
| `src/renderer/src/components/CreateView.tsx`, `CreateChange.tsx` | The screen |

It reuses, and never duplicates: the table engine (`compute/data.ts`), the expression engine, the document model
(`compute/document.ts`), the plot engine, the format registry (`compute/interchange.ts`), the ZIP reader, the Pages
diagram model, and the provider ladder.

## Not built

Said plainly so nobody assumes otherwise:

- Editing a table cell by cell on the screen (a table is changed by steps, a sentence, or by replacing it).
- Images, audio and video as kinds. Orbis's existing image generation and image editor are separate from Create.
- Projects of several code files, running code, websites. One file at a time, never run.
- Reading PowerPoint decks or handwriting; text recognition in scanned PDFs (a scanned PDF has no text to read).
- Dashboards, formulas that live in a cell, charts beyond line, bar, scatter, area and step.
- Cloud storage, email, calendar and sharing links. Everything is local files.
- Orbis Search does not list artifacts; the Create screen's own search does.
