# J.A.R.V.I.S. — Chemistry, the AI Hub, and the remaining sections

## Chemistry Studio (`/chemistry`) — 27 numbered modules

> "Interactive periodic table · compound engine · AI chemistry lab"

The modules are **versioned** (V1–V27) and grouped:

| Group | Modules |
| --- | --- |
| **CORE** | Periodic Table (V1) · Combination Engine (V2) · Molecular Studio (V5) · Organic (V7) · Inorganic (V8) |
| **SIMULATION** | Reaction Lab (V4) · Virtual Lab (V10) · Physical Chemistry (V11) · Chemical Kinetics (V12) · Electrochemistry (V17) |
| **ADVANCED** | Quantum Chemistry (V9) · Spectroscopy (V13) · Biochemistry (V14) · Materials Chemistry (V15) · Polymer Chemistry (V16) · Analytical Chemistry (V18) |
| **APPLIED** | Chemical Engineering (V20) · Environmental Chemistry (V21) · Nuclear Chemistry (V22) · Astrochemistry (V23) · Surface Chemistry (V24) |
| **DATA & RESEARCH** | Chemical Data Lab (V19) · Chemical Visualization (V26 · soon) · Research Workspace (V27 · soon) · Frontier Chemistry (V25) |
| **TOOLS** | Calculator (V6) |

(Routes: `/chemistry/{combine,reactions,molecules,calculator,organic,inorganic,quantum,lab,physical,kinetics,
electrochemistry,spectroscopy,biochemistry,materials,polymer,analytical,engineering,environmental,nuclear,astro,
surface,data,frontier}` and `/chemistry/element/:atomicNumber`.)

**The landing page itself** carries, besides the module grid:
- **Interactive periodic table** — all 118 elements laid out properly, with the lanthanide (57–71) and actinide
  (89–103) rows pulled out, a zoom control (100%) and **Filters**.
- **Featured element** — e.g. "45 Rh Rhodium — One of rarest and most expensive metals. [Explore]"
- **Daily chemistry fact** — "Carbon forms more known compounds than all other elements combined — over 10 million."
- **Formula of the day** — "Hydrochloric Acid · HCl · Stomach acid and strong laboratory acid. Molar mass:
  36.46 g/mol"
- **Reaction of the day** — "Neutralization · HCl + NaOH → NaCl + H₂O"
- **Today's quiz** — a multiple-choice question
- **Favorites & recently viewed** — "Star elements or open them to see them here."
- **AI chemistry assistant**

## The AI Hub (`/ai`)

> "What do you want to do? — Choose a mode or just start typing — the AI Hub adapts to your task."

**Nine task modes** (plus **General AI**): Deep Research (web sources) · Analyze an Image (upload, diagrams, OCR) ·
Write Something · Debug Code · Analyze Data (CSV & spreadsheet insights) · Study a Topic (interactive tutoring &
quizzes) · Summarize a Document · Search the Web · Solve a Problem (step-by-step maths).

**Tools menu** (ten, selectable per message): Web Search · Vision · File Analysis · Data Analysis · Code ·
Summarizer · Writing · Study · Math · Science. Plus an **Auto** router.

**Composer:** Attach file · Tools · "Ask anything…" · **Voice input** · Auto (model picker).
**Chat shell:** **Context** · **Workspaces** · New chat · **Customize tabs**.

Related AI routes: `/jarvis` (chat) · `/voice` (Voice Mode, marked **Premium**) · `/writing` · `/coding` ·
`/research` · `/vision` · `/ai-models` · `/agents` · `/prompts` · `/ai-customize` · `/ai-hub`.

## Dev Academy (`/academy`, served at `/knowledge?tab=academy`)

> "Master programming. From zero to job-ready."

- **Gamification strip:** TOTAL XP · level badge (**"Lvl 1 · Initiate"**) · **STREAK (days active, 🔥)** ·
  LESSONS completed · **CERTS earned**, with a level progress bar (`LEVEL 1 — INITIATE · 0 / 0 XP`).
- **Recent courses** — "Continue where you left off", with visit count and last-opened time.
- **Dev tools:** Code Translator (convert between languages) · Language Translator · Dictionary (AI word lookup) ·
  Whiteboard (draw & diagram).
- **Courses** with sorts (Default · A–Z · Z–A · Most progress · Least progress), status filters (All · Not started ·
  In progress · Completed) and **16 category filters**: AI/ML · Backend · Career · Cloud · Cyber · Data · Databases ·
  Design · DevOps · Game · Mobile · Professional · Software Engineering · Systems · Web · Web3.

## Classroom (`/classroom`)

> "Collaborative classrooms — **polls, elections, governance**." · **Join with code** · **Create classroom**.
Routes: `/classroom/:id`, `/classroom/:id/polls/:pollId`, `/classroom/:id/elections/:electionId`.
The studio blurb adds: assignments, question banks, discussions, attendance and analytics.

## Communities (`/communities`)

"JARVIS Communities" with **Create**, a **DISCOVER** browser and category filters: All · Technology · Programming ·
Computer Science · Mathematics · Science · Education · Gaming, plus **Trending / Popular / New**.
Route `/communities/:id`.

## Tools (`/tools`) — the Calculator Suite

> "Nine calculators in one — from basic arithmetic to graphing, finance, and statistics."

**Basic · Scientific · Programmer · Graphing · Geometry · Statistics · Financial · Percentage · Constants**, with
memory keys (**MC MR M− M+**), a **DEG/RAD** switch, `AC`, `⌫`, `%`, and a **HISTORY** panel.

## Insights (`/insights`)

"ANALYTICS — Your productivity at a glance." Counters (Total items · Tasks · Projects · Goals), a **content
breakdown** bar chart across Notes / Tasks / Projects / Goals / Habits / Journal, and a **distribution** chart.

## Everything else, by route

- **Productivity:** `/notes` `/scratchpad` `/tasks` `/calendar` `/projects` `/projects/:id` `/goals` `/habits`
  `/journal` `/reminders` `/focus` `/focus-music`
- **Knowledge:** `/knowledge` `/study` `/flashcards` `/quiz` `/formula-vault` `/links` `/files` `/memory`
  `/memory-map` `/notebooks` `/notebooks/:notebookId` `/search` `/browser`
- **Workspace:** `/workspace` `/team` `/contacts` `/communications` `/vault` `/marketplace` `/integrations`
  `/developer` `/automation` `/analytics`
- **Account & system:** `/profile` `/settings` `/notifications` `/help` `/support` `/shortcuts` `/onboarding`
  `/pricing` `/xp` `/toolkit` `/infinite-drive` `/exams` `/exams/new` `/exams/:id` `/exams/:id/take` `/click-lab`
- **Auth:** `/login` `/register` `/forgot-password` `/reset-password` `/setup-username` `/landing` `/a/:slug`
