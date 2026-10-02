# The Creation Engine

What Orbis can make, keep and save, how it is built, and the rules every part of it follows. This is the map; the
code comments are the detail.

## What it is

A person asks for something **in the chat**, in their own words, and Orbis makes it, keeps it, and shows it as a card
under the reply. The **Create** screen (wordmark menu → Create, `/create`, or "Open" on a card) is the same library
with every tool laid out. Everything made is an **artifact**: it has a kind, a title, versions, and a copy on disk
that was read back and checked before anything said it was kept.

| Kind | What it is | Comes from | Saves as |
| --- | --- | --- | --- |
| Table | Rows and columns with a type (and a unit) per column | Pasted text, a file (CSV, TSV, JSON, Excel), a sentence, a template, a table taken out of a document, a join | CSV, Excel, TSV, JSON, NDJSON, Markdown, text |
| Document | Headings, paragraphs, lists, tables, figures | Pasted Markdown, a file (Markdown, HTML, text, Word, PDF), a sentence, a template, a chat reply | Markdown, HTML, PDF, Word, slides, text |
| Chart | Numbers drawn against numbers: lines, bars, points, areas, steps, or a pie of one column's shares | The columns of a table. Never written by a model | SVG, PNG |
| Diagram | A flowchart: boxes and arrows | A sentence. Orion names the boxes and arrows; Orbis lays them out | SVG, PNG |
| Code | One source file in a named language | Pasted text, a source file, a sentence, a code block in a chat reply | Its language's own extension |

## In the chat

`src/main/artifacts/chat.ts` sits in `chat:send`, beside the question "is this a picture or a browser task?".

1. **A cheap check** (`mightBeAboutArtifacts`) spares the model call for messages that plainly are not requests. It
   never decides that something *is* one.
2. **A small fast model is asked what the message wants** -- make, change, chart, export, keep, ask, or none -- and is
   shown the artifacts of this conversation by handle (`A1`, `A2`), never by id. Unsure means none: an ordinary reply.
3. **The answer is read deny-by-default** (`readChatIntent`). A format counts only when the message itself says it; the
   previous reply is material only when the message reaches for it; code is never handed over as another kind of file.
4. **The same service the Create screen uses does the work.** Nothing in the chat builds a file.
5. **The reply is a sentence and a card.** The message keeps only a pointer (`ChatMessage.artifacts`); the card
   (`ArtifactCard.tsx`) reads the artifact when it is drawn, so it shows what is kept now. A card whose artifact has
   since changed says which version it was; one whose artifact was removed says so.

| Said in the chat | What happens |
| --- | --- |
| "Make a spreadsheet of..." / "I need something to track..." | `artifact.generate`, held to the kind that was asked for |
| "Sort it", "add a total", "only the ones over 100" | `artifact.transform` from the sentence: a new version |
| "Make it shorter", "add a step" | `artifact.revise`: a new version |
| "Chart it", "a pie chart of spend", "make the chart a bar chart" | `artifact.chart`; the kind the person named is the kind drawn, or the reason it cannot be is said; a chart there already is redrawn as its next version |
| "A detailed report on...", "a 10-page guide to..." | An outline first, then each part written on its own (`generateLong`), with "Written 3 of 8 parts" shown as it happens. A part that fails means nothing is kept |
| A message with an Excel, Word or PDF file attached | The file is read by the same readers the Create screen uses (`attaching.ts`) and attached as its rows or its words. "Chart the attached file" keeps it as a table first |
| "Write a report about this table" | `artifact.analyse` (every figure computed) with a chart placed in it |
| "Export it as PDF", "give me the Excel" | The card's Download writes it; a table asked for as PDF is put into a document first |
| "Put that in Excel", "turn this into a Word document" | The reply kept as it stands: a table in it is read, not rewritten |
| "What was the highest month?" | An ordinary reply, with the artifact's contents and Orbis's own sums put in front of the question |

**Download** on a card writes into the Downloads folder (`artifact.download`) under a name that replaces nothing, and
says "saved" only after the file was read back. **Save as…** is the dialog. **Open the file** and **Show in folder**
(`artifact.reveal`) work only for a file Orbis itself wrote in this session.

Progress shown while it works is what is really happening (`ARTIFACT_STATUS`), Stop stops it, and a stopped request
makes nothing.

The Orb does not make or change artifacts. It is for the browser; making things belongs to the chat.

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

Deriving also: `artifact.asDocument` (a table, chart, diagram or code file put into a document, so it can leave as
PDF, Word or slides)

Saving: `artifact.export` (a dialog) · `artifact.download` (the Downloads folder, no dialog) · `artifact.reveal`

## Where things live

| | |
| --- | --- |
| `src/shared/artifacts/` | Pure, no Electron: kinds, the record model, naming, the secret gate, verification, the proposal validator, analysis, table steps, templates, table extraction, languages, the chart and diagram drawing, flowchart layout |
| `src/main/artifacts/service.ts` | Every operation. Knows nothing about windows or dialogs |
| `src/main/artifacts/store.ts` | `<profile>/artifacts/<id>/current/` and `versions/<versionId>/`, staged then renamed. A rename refused because the folder is busy is tried again; reads wait for writes |
| `src/main/artifacts/generation.ts` | Asking Orion: make, revise, plan table steps, choose a chart's columns, the quick question the chat asks |
| `src/main/artifacts/chat.ts` | The chat's side: decide what a message asks for, do it with the service, answer with a sentence and cards |
| `src/shared/artifacts/chatIntent.ts` | Pure: the check before the model, what the model is told, and the reader of its answer |
| `src/main/artifacts/office.ts` | Excel, Word and slides, written and read back |
| `src/main/artifacts/importing.ts` | Reading files in |
| `src/main/artifacts/ipc.ts` | The only Electron file: the two dialogs, the print window (PDF) and the drawing window (PNG) |
| `src/renderer/src/components/CreateView.tsx`, `CreateChange.tsx` | The screen |
| `src/renderer/src/components/ArtifactCard.tsx` | The card in the conversation |

It reuses, and never duplicates: the table engine (`compute/data.ts`), the expression engine, the document model
(`compute/document.ts`), the plot engine, the format registry (`compute/interchange.ts`), the ZIP reader, the Pages
diagram model, and the provider ladder.

## Not built

Said plainly so nobody assumes otherwise:

- Editing a table cell by cell on the screen (a table is changed by steps, a sentence, or by replacing it).
- Images, audio and video as kinds. Orbis's existing image generation and image editor are separate from Create.
- Projects of several code files, running code, websites. One file at a time, never run.
- Reading PowerPoint decks or handwriting; text recognition in scanned PDFs (a scanned PDF has no text to read).
- Dashboards, formulas that live in a cell, charts beyond line, bar, scatter, area, step and pie (asked for a
  histogram or a heat map, the reply says so and says what was drawn instead).
- Cloud storage, email, calendar and sharing links. Everything is local files.
- Orbis Search does not list artifacts; the Create screen's own search does.
- In the chat: a picture cannot be read into a table or a document; PowerPoint files are not read; the check before
  the model knows English words only; a long document is at most ten parts.
