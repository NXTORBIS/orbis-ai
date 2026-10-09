# J.A.R.V.I.S. (mark32.base44.app) — the map

Extracted from the running app and its bundle (`/assets/index-Cq4xpWPF.js`, 1,182,108 bytes). Everything here is read
from the site itself, not inferred.

## The shell

- **Sidebar, top level:** Overview `/`, Studios `/studios`, Jarvis AI `/ai`, Productivity `/productivity`,
  Knowledge `/knowledge`, Tools `/tools`, Insights `/insights`, Workspace `/workspace`, Communities `/communities`,
  Support `/support`.
- **SYSTEM group:** Memory Map `/memory-map`, Files `/files`, Settings `/settings`.
- **Top bar:** Search (⌘K, "Search everything…"), XP & level badge (`/xp`, shows "10 XP"), Open Browser,
  Notifications, **Voice Mode — Premium feature**, Toggle theme, account chip ("Nishanth S · Free plan").
- Sidebar can collapse ("COLLAPSE").

## Overview page (`/`)

- "COMMAND CENTER — Good evening, Commander. All systems operational. Your notes, tasks, and memory are
  synchronized. Ask $JARVIS anything — or dictate with voice."
- Primary buttons: **Talk to JARVIS**, **New note**.
- A J.A.R.V.I.S. ring/HUD animation with degree ticks (000–330) and a scrolling binary band spelling `JARVIS`.
- **DAILY TRANSMISSION** — a rotating quote with attribution (e.g. Henry Ford).
- **Ask bar:** "Ask Jarvis (Enter) or search the web (Shift+Enter)…" — one box, two destinations.
- **Quick add bar:** "Quick add — try 'task: review roadmap', 'remind me to call Aris', or paste a link" → natural
  language into tasks/reminders/links.
- **Counters:** Notes, Open tasks, Reminders, Saved links.
- **QUICK MEET** — "Generate a Google Meet link instantly, then copy or share it."
- **Network Speed Test** — real-time bandwidth: a 0–150 Mbps dial, Down/Up/Ping, "Run Test".
- **AI BRAIN STATUS** — "Neural core nominal · context synced".
- **WELCOME ABOARD** — empty-vault state with **Load demo data** and **Take the tour**.
- Panels: RECENT UPDATES, RECENTLY UPDATED, UPCOMING REMINDERS.

## Every studio has the same twelve-tab shell

`/studios/<slug>` plus sub-routes:

`workspace · projects · ai-assistant · tools · templates · history · analytics · import · export · widgets · settings`

The studio landing shows **Dashboard**, a stat strip (**Tools / Templates / Projects / Sessions**), **Quick Actions**,
and **All tools**. Mathematics for example reports `4 Tools · 12 Templates · 0 Projects · 0 Sessions`.

The studio index groups studios under: **Sciences, Learning, Creative, Productivity, Tools & Systems, Games**, and
has its own scoped search ("Searches available studios only — separate from the global ⌘K search. Press Enter to open
the top match.").

## The 28 studios, with every tool

### Sciences

**Chemistry Studio** (`chemistry`, #10b981) — "Atoms, bonds & reactions". Explore the periodic table, molecules,
reactions and a virtual lab. *9 tools*
- Periodic Table → `/chemistry` — Browse all elements
- Combination Engine → `/chemistry/combine` — Combine elements
- Reaction Lab → `/chemistry/reactions` — Balance reactions
- Molecular Studio → `/chemistry/molecules` — Build molecules
- Chemistry Calculator → `/chemistry/calculator` — Moles & masses
- Organic Explorer → `/chemistry/organic` — Organic compounds
- Inorganic Explorer → `/chemistry/inorganic` — Inorganic compounds
- Quantum Chemistry → `/chemistry/quantum` — Quantum models
- Virtual Lab → `/chemistry/lab` — Run experiments

**Mathematics Studio** (`mathematics`, #8b5cf6) — "Numbers, logic & proof". *4 tools*
- Trigonometry Suite → `/trigonometry` — Angles, identities & graphs
- Calculator → `/calculator` — Advanced calculator
- Formula Vault → `/formula-vault` — Formula reference
- Unit Converter → `/converter` — Convert units

**Physics Studio** (`physics`, #06b6d4) — "Forces, energy & motion". *"Interactive simulations across classical,
quantum, computational, astrophysics and research physics — real numerical models, not canned animation."* *4 tools*
- Physics Studio (Suite) → `/physics` — All physics simulators
- Quantum Many-Body Simulator → `/quantum-simulator` — Heisenberg spin-chain ED
- QEC & Fault-Tolerant Decoding → `/qec-lab` — Stabilizer codes & decoders
- Formula Vault → `/formula-vault` — Physics formulas

**Biology Studio** (`biology`, #84cc16) — "Life, cells & systems". *1 tool*
- Formula Vault → `/formula-vault` — Biology formulas

**Engineering Studio** (`engineering`, #f97316) — "Build & integrate". *3 tools*
- Developer Centre → `/developer` — API & tooling
- Coding Assistant → `/coding` — Pair programmer
- Automation → `/automation` — Automate tasks

**Laboratory Studio** (`laboratory`, #16a34a) — "Experiment & observe". *3 tools*
- Virtual Lab → `/chemistry/lab`, Reaction Lab → `/chemistry/reactions`, Formula Vault → `/formula-vault`

**Geography Studio** (`geography`, #0d9488) — "Places & planets". *2 tools*
- Browser → `/browser`, Search → `/search`

**Astronomy Studio** (`astronomy`, #8b5cf6) — "Stars & cosmos". *2 tools*
- Deep Research → `/research`, Browser → `/browser`

### Learning

**Learning Studio** (`learning`, #3b82f6) — "Study smarter, retain more". *5 tools*
- Flashcards → `/flashcards` — Spaced repetition decks
- Quiz Generator → `/quiz` — Auto-make quizzes
- Study Hub → `/study` — Organize study sets
- Academy → `/academy` — Guided courses
- Formula Vault → `/formula-vault` — Key formulas

**Language Studio** (`language`, #ec4899) — "Translate & define". *3 tools*
- Language Translator → `/academy/translate/language`, Dictionary → `/academy/dictionary`, Writing Assistant → `/writing`

**Writing Studio** (`writing`, #f97316) — "Draft, edit & publish". *4 tools*
- Writing Assistant → `/writing`, Notes → `/notes`, Journal → `/journal`, Prompt Library → `/prompts`

**Research Studio** (`research`, #14b8a6) — "Investigate & cite". *4 tools*
- Deep Research → `/research` — AI deep dives
- Browser → `/browser` — In-app browsing
- Knowledge Base → `/knowledge`, Links → `/links`

**Knowledge Studio** (`knowledge`, #2563eb) — "Learn & reference". *5 tools*
- Knowledge Base → `/knowledge`, Study Hub → `/study`, Academy → `/academy`, Memory Map → `/memory`, Search → `/search`

**Classroom Studio** (`classroom`, #0ea5e9) — "Teach, learn & join". *"Create classrooms, manage assignments,
question banks, discussions, attendance and analytics — or join a class with a code."* *1 tool*
- Classroom Hub → `/classroom` — Browse, join & create

### Creative

**Notes Studio** (`notes`, #a855f7) — "Capture & connect". Notes → `/notes`, Memory Map → `/memory`, Journal → `/journal`

**Creative Studio** (`creative`, #f43f5e) — "Design & imagine". Whiteboard → `/academy/whiteboard`,
AI Vision → `/vision` (generate images), Prompt Library → `/prompts`

**Media Studio** (`media`, #d946ef) — "Sound, sight & motion". Focus Music → `/focus-music`, Widgets → `/widgets`

### Productivity

**Computer Science Studio** (`computer-science`, #6366f1) — "Code, practice & simulate". *"A complete environment to
learn, program, practice DSA, and run interactive CS laboratories."* *5 tools*
- Studio Overview → `/cs`, Problems → `/cs/problems` (LeetCode-style practice), Playground → `/cs/playground`,
  Learn → `/cs/learn`, Laboratories → `/cs/labs`

**Typing Studio** (`typing`, #f59e0b) — Typing Studio → `/typing` — speed & accuracy trainer

**Finance Studio** (`finance`, #22c55e) — Analytics → `/analytics`, Calculator → `/calculator`

**Productivity Studio** (`productivity`, #eab308) — *6 tools*
- Tasks → `/tasks`, Goals → `/goals`, Habits → `/habits`, Reminders → `/reminders`, Focus Suite → `/focus`,
  Focus Music → `/focus-music`

**Communication Studio** (`communication`, #06b6d4) — Messages → `/communications`, Contacts → `/contacts`, Team → `/team`

### Tools & Systems

**Health Studio** (`health`, #ef4444) — Habits → `/habits`, Reminders → `/reminders`

**Security Studio** (`security`, #64748b) — Password Vault → `/vault`

**Utility Studio** (`utility`, #0ea5e9) — Calculator, Unit Converter, Focus Suite, Focus Music, Widgets

**Data Studio** (`data`, #0891b2) — Analytics → `/analytics`, Memory Map → `/memory`, Knowledge Base → `/knowledge`

### Games

**Chess Studio** (`chess`, #eab308) — *"Play against AI opponents from 100 to 3200 Elo or a friend, with full FIDE
rules, move history, and an AI coach."* → `/chess`

**Games Studio** (`games`, #a855f7) — Games Studio → `/games`, Games Centre → `/games-centre`,
Hand Cricket → `/games/hand-cricket`, Leaderboards → `/games/leaderboards`

## Every route in the application (170)

```
/a/:slug                          /academy                        /academy/course/:slug
/academy/dictionary               /academy/lesson/:id             /academy/translate/code
/academy/translate/language       /academy/whiteboard             /agents
/ai                               /ai-customize                   /ai-hub
/ai-models                        /algorithm-lab                  /analytics
/automation                       /browser                        /calculator
/calendar                         /chemistry                      /chemistry/analytical
/chemistry/astro                  /chemistry/biochemistry         /chemistry/calculator
/chemistry/combine                /chemistry/data                 /chemistry/electrochemistry
/chemistry/element/:atomicNumber  /chemistry/engineering          /chemistry/environmental
/chemistry/frontier               /chemistry/inorganic            /chemistry/kinetics
/chemistry/lab                    /chemistry/materials            /chemistry/molecules
/chemistry/nuclear                /chemistry/organic              /chemistry/physical
/chemistry/polymer                /chemistry/quantum              /chemistry/reactions
/chemistry/spectroscopy           /chemistry/surface              /chess
/chess/achievements               /chess/analysis                 /chess/archive
/chess/custom                     /chess/engine                   /chess/hub
/chess/multiplayer                /chess/openings                 /chess/play
/chess/puzzles                    /chess/statistics               /classroom
/classroom/:id                    /classroom/:id/elections/:eid   /classroom/:id/polls/:pollId
/click-lab                        /coding                         /communications
/communities                      /communities/:id                /contacts
/converter                        /cs                             /cs/ai-ml
/cs/architecture                  /cs/compilers                   /cs/contests
/cs/cybersecurity                 /cs/daily                       /cs/data-science
/cs/databases                     /cs/distributed                 /cs/graphics
/cs/labs                          /cs/learn                       /cs/networks
/cs/os                            /cs/playground                  /cs/problem/:slug
/cs/problems                      /cs/progress                    /cs/projects
/cs/software-engineering          /cs/theory                      /developer
/digital-logic-lab                /electronics-lab                /exams
/exams/:id                        /exams/:id/take                 /exams/new
/files                            /flashcards                     /focus
/focus-music                      /forgot-password                /formula-vault
/games                            /games-centre                   /games-centre/:gameId
/games/category/:categoryId       /games/favorites                /games/game/:gameId
/games/hand-cricket               /games/history                  /games/leaderboards
/games/play/:gameId               /games/search                   /goals
/habits                           /help                           /infinite-drive
/insights                         /integrations                   /jarvis
/journal                          /knowledge                      /landing
/links                            /login                          /marketplace
/memory                           /memory-map                     /notebooks
/notebooks/:notebookId            /notes                          /notifications
/onboarding                       /physics                        /pricing
/productivity                     /profile                        /projects
/projects/:id                     /prompts                        /qec-lab
/quantum-simulator                /quiz                           /register
/reminders                        /research                       /reset-password
/scratchpad                       /search                         /settings
/setup-username                   /shortcuts                      /studios
/studios/:studioSlug              /study                          /support
/tasks                            /team                           /toolkit
/tools                            /trigonometry                   /typing
/vault                            /vision                         /voice
/widgets                          /workspace                      /writing
/xp
```

Note the routes that are **not** reachable from any studio tile and so are only reachable directly or from inside a
tool: `/algorithm-lab`, `/digital-logic-lab`, `/electronics-lab`, `/click-lab`, `/infinite-drive`, `/qec-lab`,
`/quantum-simulator`, `/exams/*`, `/notebooks/*`, `/toolkit`, `/marketplace`, `/integrations`, `/agents`, `/prompts`,
`/ai-models`, `/ai-customize`, `/ai-hub`, `/scratchpad`, `/shortcuts`, `/profile`, `/pricing`, `/xp`, `/help`.
