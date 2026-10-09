# J.A.R.V.I.S. (mark32.base44.app) — what it is, in one page

Extracted from the live site while signed in, plus its JavaScript bundle. Five documents sit beside this one:

1. `01-routes-and-studios.md` — the shell, all 170 routes, all 28 studios with every tool
2. `02-command-index.md` — the 116-entry ⌘K index with breadcrumbs and keywords
3. `03-algorithm-lab.md` — the 84-algorithm visualiser, in full
4. `04-digital-logic-and-electronics.md` — the breadboard simulator and its 42 parts
5. `05-physics-studio.md` — **all 245 physics simulators across 15 areas**
6. `06-computer-science-and-games.md` — the CS studio (24 sections) and 47 games
7. `07-settings-and-personalisation.md` — 12 personalities, the audio engine, the cursor system, every shortcut
8. `08-chemistry-ai-and-the-rest.md` — chemistry's 27 modules, the AI Hub, academy, classroom, communities

## The shape of it

| | JARVIS |
| --- | --- |
| Top-level sections | 10 + a SYSTEM group |
| Routes | **170** |
| Studios | **28**, every one with the same 12-tab shell |
| Physics simulators | **245** |
| Algorithms visualised | **84** |
| Games | **47** in 8 categories |
| Chemistry modules | **27**, versioned V1–V27 |
| Breadboard components | **42** |
| Command-index entries | **116** |
| Assistant personalities | **12** |
| Keyboard shortcuts | ~40, all rebindable |

## The seven ideas worth stealing

1. **One shell per studio.** Every studio has Dashboard · Workspace · Projects · AI Assistant · Tools · Templates ·
   History · Analytics · Import · Export · Widgets · Settings. A studio is not a page, it is a *place* with its own
   projects, its own history, its own import/export and its own assistant. Orbis's labs are single screens.

2. **Breadth as a first-class claim, with honesty about it.** The physics studio says "245 topics · all open" and
   "every live topic runs genuine computation, not canned animation"; the CS labs page splits **Available** from
   **On roadmap** on the same screen. It never hides what is not built — it lists it.

3. **The command index is the product's map.** 116 entries, each with a breadcrumb and keywords, and it indexes
   *query-string* destinations — a settings tab, a file section, a task filter — as results in their own right.

4. **Gamification throughout.** XP per action, levels with names ("Lvl 1 · Initiate"), streaks, certificates,
   achievements, leaderboards, acceptance rates on problems. It gives the whole thing a spine.

5. **Personality and sound as settings.** Twelve named assistants, five voice characters, four sound themes, six
   audio channels, and the rule written on the page: *"most interactions stay silent."*

6. ~~**A real construction environment.** The Digital Logic Lab is a 30-column breadboard with power rails, wiring,
   74HC-series ICs, an oscilloscope with four channels, a logic analyser and a multimeter.~~
   **Not wanted** — the owner has ruled the breadboard out. Do not propose it again.

7. **The algorithm visualiser's transport bar.** Step back, skip five, jump to end, 0.1×–128×, a live variables
   panel, the source code beside the run, and a complexity card with use cases and trade-offs.

## Where Orbis is already ahead

Every one of the twelve labs JARVIS lists as **"Coming soon · On roadmap"** — computer architecture, OS scheduling
and paging, networks, databases with schema diagrams and query plans, compilers, theory of computation,
cybersecurity, AI/ML, data science, graphics, distributed systems, software engineering — **Orbis has built**.

Both products hit the same wall in the same place: JARVIS's code editor says **"Python — execution unavailable"**,
and Orbis does not execute generated code either.
