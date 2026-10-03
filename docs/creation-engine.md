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
| Project | Several named text files kept together, one of them named as the file it starts at | A sentence, a zip you open, its own stored form pasted | A zip archive |
| Picture | A PNG, JPEG, GIF, WebP or BMP, kept exactly as its file is | A file you open, or a picture made in the chat | The file it is, unchanged |
| Sound | An MP3, WAV, Ogg, FLAC, M4A or AAC, kept exactly as it is | A file you open | The file it is, unchanged |
| Video | An MP4, WebM or QuickTime file, kept exactly as it is | A file you open | The file it is, unchanged |

A table also saves as a **calendar file** (`.ics`) from its own column of dates, and as **Excel with live formulas** when
it has a column Orbis computed. Anything can be attached to a **mail draft** (`.eml`) or copied into a folder a cloud
program keeps in step.

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
| "Make a dashboard from this table" | `artifact.dashboard`: the figures computed, the breakdown grouped, and two or three charts drawn and placed as figures. It says which columns it could not use and why. Only when the word "dashboard" is said; otherwise a table asked about gets the write-up |
| "Email me the report", "email this to sam@example.com" | A mail draft file with the artifact attached, written into Downloads and read back. Orbis sends nothing: the addresses come from your own message and nowhere else, and opening and sending it is yours |
| "Put these dates in my calendar" | A calendar file from the table's own dates, written and read back event by event. Orbis has no calendar connection and will never know whether you added them |
| "Save it to OneDrive" | A copy into that folder on this computer, read back and checked. The cloud program uploads it; Orbis has no account there |
| "Run it", "show me the page working" | `artifact.run` on a project: one web page in Orbis's sandbox. Never on a code file, and never on this computer |
| "Put that in Excel", "turn this into a Word document" | The reply kept as it stands: a table in it is read, not rewritten |
| "What was the highest month?" | An ordinary reply, with the artifact's contents and Orbis's own sums put in front of the question |

**Download** on a card writes into the Downloads folder (`artifact.download`) under a name that replaces nothing, and
says "saved" only after the file was read back. **Save as…** is the dialog. **Open the file** and **Show in folder**
(`artifact.reveal`) work only for a file Orbis itself wrote in this session -- and a code file is never opened, only
shown in its folder, because for a script "open" means "run". That is refused in the service, not just left off the
card. A card never fetches a picture from an address written in a document.

Progress shown while it works is what is really happening (`ARTIFACT_STATUS`), Stop stops it, and a request that is
stopped or fails part-way leaves nothing new behind: whatever it had already made is removed again. (A change that had
already been kept as a new version stays; the version before it is still there.)

**Answering again.** Regenerate, Resend and editing the question send the cards of the reply being replaced
(`ChatRequest.replaced`). `ArtifactChat.undo` puts things back first: something that reply made is removed (only if
the library says it was made in this conversation), and something it changed is restored to the version before the
change (only if nothing has changed it since). So "sort it" answered again sorts the table once, not twice.

**A picture attached to the message** leaves the whole message to the ordinary reply: Orbis does not read a picture
into a table or a document, and will not make "a spreadsheet from this photo" out of nothing. **A scanned PDF
attached** to a message comes back as one sentence saying what it would take -- how many pages, that reading them
means sending the pictures to Mistral -- and nothing is sent. Attaching a file is not asking for it to be sent
anywhere, so the yes is given on the Create screen, where the question and the button are in front of you.

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
10. **What is kept is what was written.** The Markdown a document is stored as has to read back as the same document:
    text that would read back as something else (`*args*` in a table cell) is written with its markers escaped, a bar
    in a cell is written `\|`, and a code block's fence is longer than any fence inside it.
11. **A claim about whose data it is is counted, not assumed.** Rows are called "what you gave" only when every number
    and every word in them is in the request or the material; otherwise the card says how many were.

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

Deriving also: `artifact.dashboard` (a table → a document of computed figures, a breakdown and two or three charts,
each a chart of its own that the page points at)

Showing: `artifact.run` (a project that is one web page, in the Pages sandbox. Nothing is run on this computer)

Saving: `artifact.export` (a dialog) · `artifact.download` (the Downloads folder, no dialog) · `artifact.reveal` ·
`artifact.emailDraft` (a mail draft file with the artifact attached) · `artifact.cloudFolders` (the folders a cloud
program keeps in step) · `artifact.saveToCloud` (a copy into one of them)

`artifact.read` and `artifact.update` also take a `path`, for one file of a project. `artifact.export` takes
`liveFormulas` and `totalsRow` for a workbook. `artifact.import` takes `readScanned`, which is the person's yes to
sending a scanned PDF's page pictures to be read. Thirty-three operations, one channel, one frozen map.

## Where things live

| | |
| --- | --- |
| `src/shared/artifacts/` | Pure, no Electron: kinds, the record model, naming, the secret gate, verification, the proposal validator, analysis, table steps, templates, table extraction, languages, the chart and diagram drawing, flowchart layout |
| `src/main/artifacts/service.ts` | Every operation. Knows nothing about windows or dialogs |
| `src/main/artifacts/store.ts` | `<profile>/artifacts/<id>/current/` and `versions/<versionId>/`, staged then renamed. A rename refused because the folder is busy is tried again; reads wait for writes |
| `src/main/artifacts/attaching.ts` | An Excel, Word or PDF file attached to a chat message, read into the rows or words it holds |
| `src/shared/compute/document.ts` | The Markdown reader and writer every document goes through. Emphasis is read in one pass: a marker is judged by the run it stands in, an ending pairs with the nearest beginning, and a beginning with no ending goes back as the characters it is |
| `src/main/artifacts/generation.ts` | Asking Orion: make, revise, plan table steps, choose a chart's columns, the quick question the chat asks |
| `src/main/artifacts/chat.ts` | The chat's side: decide what a message asks for, do it with the service, answer with a sentence and cards |
| `src/shared/artifacts/chatIntent.ts` | Pure: the check before the model, what the model is told, and the reader of its answer |
| `src/main/artifacts/office.ts` | Excel, Word and slides, written and read back. A workbook's live formulas |
| `src/shared/artifacts/formula.ts` | The Excel formula printer and the evaluator that proves each one before it is written |
| `src/main/artifacts/dashboard.ts` | A table's figures, its breakdown and which charts to draw. (Not `src/shared/dashboards.ts`, which is the browser start page's widget arrangements and is unrelated) |
| `src/shared/artifacts/media.ts`, `src/main/artifacts/media.ts` | A picture, a sound and a video: every header reader, the words, and the door the engine knocks on |
| `src/shared/artifacts/project.ts`, `src/main/artifacts/running.ts` | A project's files and paths; splitting one page into the three the sandbox serves, and the zip |
| `src/main/artifacts/scanned.ts` | A scanned PDF's page pictures, and reading them with the person's yes |
| `src/shared/artifacts/calendar.ts`, `src/main/artifacts/sharing.ts` | A calendar file; a mail draft and the cloud folders on this computer |
| `src/main/artifacts/searching.ts` | The "Made in Orbis" group in the browser's search page, from records only |
| `src/main/artifacts/importing.ts` | Reading files in |
| `src/main/artifacts/ipc.ts` | The only Electron file: the two dialogs, the print window (PDF) and the drawing window (PNG) |
| `src/renderer/src/components/CreateView.tsx`, `CreateChange.tsx` | The screen |
| `src/renderer/src/components/ArtifactCard.tsx` | The card in the conversation |

It reuses, and never duplicates: the table engine (`compute/data.ts`), the expression engine, the document model
(`compute/document.ts`), the plot engine, the format registry (`compute/interchange.ts`), the ZIP reader, the Pages
diagram model, and the provider ladder.

## Built since this was written

- **A table is edited cell by cell on the Create screen.** Click a cell and type; Enter and Tab move on, Escape puts
  it back. A row can be taken out or put back, rows can be added, and a long table is walked a screenful at a time.
  Nothing is saved until "Save changes", and then it is one change, one new version, with the reason written down.
  A table that moved on underneath is refused as out of date rather than quietly overwritten.
- **PowerPoint decks are read.** Slide order from the deck's own relationships, titles from the title placeholder or
  the first single-line shape, bullets with their depth, tables as tables, speaker notes as quoted text. It says in
  the document that pictures and charts were not read.
- **A picture, a sound and a video are kinds.** They are the one place where the body is not the artifact: there is
  nothing to write a JPEG out of, so the stored file *is* the artifact and the record beside it is what is known
  about it -- the format, the size, the length, where it came from -- read out of the file's own header and never by
  decoding it. Nothing is re-encoded, resized, converted, played or sent anywhere, and the kind's own words say so.
  The saved copy is the same bytes under the extension the bytes earned, so a file called `holiday.png` whose bytes
  are a JPEG is refused with both facts rather than kept under the wrong name. A picture under 512 KB shows on the
  card as a bounded `data:` URL, exactly as a drawing does; a larger one, and every sound and video, says in words
  why there is no picture and no player. A picture cannot be pasted, revised by sentence, put into a document, or
  searched as text.
- **A project: several named text files kept together.** One of them is named as the file it starts at. Kept as one
  stored text form so the secret gate still reads every file's own source with its own line numbers, and read back
  file for file. It saves as a zip whose every entry is inflated and compared character for character. One file is
  changed by its path as one new version, and the version list says what happened to which file. Every path is
  refused rather than tidied -- absolute, a drive letter, a backslash, a step up, a hidden file, too deep -- because
  a repaired path is a file at an address nothing else refers to.
- **A project that is one web page can be shown, in a sandbox, never on this computer.** `artifact.run` hands three
  files to the same sandbox the generated Pages use: no network, no files, no Node, no saved passwords, an opaque
  origin, and no grants. Anything else is refused by name with the reason -- a Python project, a project of several
  pages, a file that uses `import`, a page that reaches for `fetch` or browser storage or an address outside itself.
  Orbis cannot interrupt a page that loops for ever once it has started, and says so before it starts. A code file
  is still never run, and "Open the file" is still refused for code and now for a project too.
- **A scanned PDF is read, if you say so.** A scan is one photograph per page stored inside the PDF, so Orbis lifts
  those pictures out as they are and says how many it found. Reading the words means a model: the pictures would go
  to Mistral, the service whose key is in your settings, so Orbis asks first, names the number of pages, and sends
  nothing unless you say yes. What comes back is a document with a heading per page and a note at the top saying the
  words were read from pictures by a model and may be wrong. A page the model could not read says so and is left
  empty. With nothing set up that can read a picture there is no offer at all, only the plain reason.
- **A workbook can carry live formulas.** The columns Orbis computed and a row of totals are written as real Excel
  formulas with the numbers Orbis already worked out cached beside them, and each one is proved against that number
  before it is written. Anything Excel would answer differently -- `%`, `round` of a negative half, `atan2`'s
  argument order, `cbrt`, `hypot`, `e` -- is written as numbers with the reason said. The read-back looks for exactly
  those cells in the file.
- **A dashboard.** A table turned into a document of computed figures, a breakdown by category, and two or three
  charts, each a real chart artifact the page points at. Every number on it is the data engine's. It is a document,
  so there is no grid and nothing side by side, and its figures are of one version and say so: they do not follow
  the table.
- **A mail draft, a calendar file, and a folder a cloud program watches.** Orbis sends no mail and uploads nothing.
  It writes an `.eml` with the artifact attached, for you to open and send yourself; an `.ics` from a table's own
  column of dates, read back event by event; and a copy into a synced folder on this computer, which that program
  then uploads. Addresses come from your own message and never from a file's contents. There is no account, no
  token, no sharing link, and no way for Orbis to know what happened after it handed the file over.
- **Orbis Search lists what you have made.** A "Made in Orbis" group above the web results, from records only -- a
  title, what the thing is, when it changed, and one sentence Orbis itself kept about it. Never a slice of an
  artifact's content, because that slice has not been past the secret gate a second time. It honours the same
  setting the address bar honours before drawing on anything personal, it is not there when Orbis is not running,
  and pressing a row brings the window forward with that artifact open on the Create screen.

## Not built

Said plainly so nobody assumes otherwise:

- No thumbnail for a large picture, no player for a sound or a video, no transcoding, no re-encoding, no resizing,
  no picture as a figure in a document. There is no protocol that serves a stored artifact's bytes to the window, and
  adding one is a change to rule 3 rather than a detail.
- Nothing is decoded: no "what is in this picture", no transcription of a sound, no counting a video's frames. A
  video's size and length come only from what its container declares, and a WebM written as it was recorded usually
  declares no length -- it says so rather than scanning every cluster.
- A project of more than one web page, and anything that is not a web page, is not run. Python, shell, SQL and
  everything else: nothing in Orbis runs them, sandboxed or not. An endless loop cannot be stopped from inside;
  closing the page is the way out. A project holds text files only, so a picture in one is a broken image.
- A scan stored as JPEG 2000, a CCITT fax, JBIG2 or raw pixels is counted and named, not read: there is no decoder
  for any of them. No PDF page is rendered, so a scan drawn from vector content has nothing to lift. A locked PDF is
  refused. At most twenty pages are read in one go. There is no local text recognition and nothing installed can do
  it, so reading a scan always means sending the pictures somewhere. Handwriting is the same path with worse
  accuracy and the same notes.
- A formula in ONE cell, a formula that reads another row or another sheet, and a computed column that stays live
  through a group or a join. Above 20,000 rows the computed columns are written as numbers with the reason said. The
  proof is against Orbis's own model of Excel, not against Excel: everything where the two are known to differ is
  refused rather than emitted.
- Charts beyond line, bar, scatter, area, step and pie (asked for a histogram or a heat map, the reply says so and
  says what was drawn instead). A dashboard has no layout: it is one block after another, and nothing on it follows
  its table.
- No cloud account, no OAuth, no token, no upload by Orbis, no sharing link, no reading a mailbox or a calendar, no
  repeating events, reminders, attendees or time-zone rules in a calendar file, and no Bcc on a draft. Cloud folders
  are found the Windows way -- environment variables, a drive letter, the user's own folder -- so on macOS and Linux
  the list is empty and the button is simply not there. Box, pCloud, Nextcloud and MEGA are not covered.
- A generated picture is not kept as an artifact by itself. Pressing Save on one now writes a real file that is read
  back and checked, but there is no "keep this picture" that files it in the library, because nobody asked for one.
- In the chat: a picture cannot be read into a table or a document; the check before the model knows English words
  only; a long document is at most ten parts.
- A `.ppt`, a `.mkv`, AVI, AIFF, WMA, HEIC, AVIF, TIFF and ICO are refused by name. A real `.eml` has not been
  opened in Outlook or Thunderbird, and a real `.ics` has not been imported into a calendar program: both are
  correct against their specifications and against Orbis's own readers, which is not the same thing.
