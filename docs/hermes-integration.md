# Hermes → Orbis: audit, compatibility matrix and build order

What Orbis takes from Hermes Agent, what it does its own way, and what it leaves. Written from a reading of the
Hermes source and documentation (NousResearch/hermes-agent, MIT) and a full audit of the Orbis codebase, 2026-09-17.

## What "Hermes" and "Galaxy" actually are

- **Hermes Agent** is `NousResearch/hermes-agent` (MIT): a Python agent with a terminal UI and an Electron desktop app.
- **"Hermes Agentic OS"** is not a Nous project. It is the name a YouTuber gives his own dashboard built around
  Hermes; there is no repository or licence to take anything from.
- **Galaxy does not exist in any Hermes project.** The nearest real thing is the desktop app's **Star Map** (Memory
  Graph / Learning Journey): skills and memory entries only, laid out on a radial timeline with d3-force on a canvas,
  filterable by All / Used / Learned, with edit and delete. Orbis's Galaxy therefore takes the Star Map's good ideas —
  built from existing data rather than stored twice, a timeline, filters, editing from the map — and is otherwise
  Orbis's own design. Nothing about it should be described as "what Hermes does".

## What Orbis already has, and must not rebuild

Workflows (versioned, per profile, schedules, triggers, checkpoints, an Orion step, drafting from plain language); one
Browser Control Layer with per-capability confirmation policies; four ways of running things (chat router, browser
agent, plan runs, step-by-step runs); profiles; the secrets vault; personalisation; bookmarks, history and downloads;
voice (Groq Whisper); vision models; image generation; learned skills (uncommitted at audit time).

What it did not have: any memory, any search index, any graph, projects, saved Orion Search sessions or step runs,
notifications, a per-request model router, use of the feedback it collects, or per-profile notes, tasks, whiteboards,
workspaces, conversations and settings. Node's built-in SQLite with FTS5 is available in Orbis's Electron (Node 24.19),
so the local index needs no new dependency.

## Compatibility matrix

Decisions: **IMPLEMENT** (new in Orbis) · **IMPROVE** (Orbis has it; make it better) · **ADAPT** (the idea, Orbis's way)
· **INTEGRATE** (already equivalent; connect it) · **DEFER** · **REJECT**. Every row is free and local unless it says
otherwise.

### Agent

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Single tool-calling agent loop | Four separate runners | Agent core over the existing runners: one task model, one list of running tasks, no fifth executor | Neutral | **ADAPT** |
| Context compression (head / summarised middle / tail, cheap helper model) | None; long chats and sessions are sent whole | Chat and Orion Search, with a small Groq model | Less data sent per request | **IMPLEMENT** |
| Checkpoints and resume | Workflows only | Step runs and Orion Search sessions persisted and resumable | Neutral | **IMPROVE** |
| Isolated subagents, parallel work | None | Bounded parallel research branches (at most 3) | Neutral | **ADAPT** |
| Background process list (poll, wait, kill) | Workflow runs only | Agent task list: pause, resume, stop | Neutral | **INTEGRATE** |
| Batch trajectory generation (model training) | — | — | Not a user feature | **REJECT** |

### Memory

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Bounded MEMORY.md, injected at session start, error when full so it consolidates | None | Per-profile memory the person can see, edit and delete; capacity-bounded; only relevant entries sent | Never secrets; secret-shaped text refused | **IMPLEMENT** |
| USER.md profile | Custom instructions only | "About me" section of memory, per profile, edited by the person, additions proposed not assumed | Visible, no inference of sensitive traits | **IMPLEMENT** |
| Write approval for memory | — | Orion proposes, the person approves (setting) | Keeps the person in control | **IMPLEMENT** |
| session_search: SQLite FTS5 over past sessions | None | One local index per profile over memory, chats, Orion Search sessions, notes, tasks, skills, runs | Local only | **IMPLEMENT** |
| Memory notifications ("memory saved") | — | In-app notice | — | **IMPLEMENT** |
| Honcho and other cloud memory providers | — | — | Cloud user modelling, paid | **REJECT** |

### Skills

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Agent-created skills with write approval | Learned skills (workflows + metadata), save-offer bug | Fix and ship; proposals always approved | Secrets redacted | **IMPROVE** |
| Background review proposing skills from repeated work | — | Proposal after repeated successful runs of the same kind | Approval required | **ADAPT** |
| Staged loading (list → view → reference) | Planner sees capabilities only | Planner sees skill names first, full skill only when chosen | Fewer tokens sent | **IMPLEMENT** |
| Conditional activation (`requires_toolsets`) | — | Skill declares required capabilities; unavailable ones explained | — | **IMPLEMENT** |
| agentskills.io SKILL.md format | Orbis JSON export | Import/export of the metadata where it maps cleanly | Imports untrusted and off | **ADAPT** |
| Skill security scanner (exfiltration, injection, destructive) | Import checks for secrets and unknown capabilities | Extended to injection text and outbound destinations | Stronger | **IMPROVE** |
| Trust tiers | untrusted / approved / verified | Kept | — | **INTEGRATE** |
| Remote skill hubs (skills.sh, ClawHub, LobeHub…) | — | — | Remote untrusted instructions | **DEFER** |

### Tools and capabilities

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Toolsets switched on and off | Capability registry, no switches | Per-domain switches in the registry; the agent only sees what is on | Smaller attack surface | **IMPLEMENT** |
| Web search, browser, vision, image generation tools | Present | Registered for the agent core | — | **INTEGRATE** |
| Terminal, file writes, `execute_code` | None | — | Unrestricted OS access | **REJECT** |
| Reading files the person picks | Image picking only | Scoped read of explicitly chosen files | Explicit only | **DEFER** |
| Text-to-speech | None | — | — | **DEFER** |
| Home Assistant | — | — | Unrelated | **REJECT** |
| MCP client (connect external servers) | None | Optional, permissioned, later | External code | **DEFER** |
| MCP server (expose the agent) | None | Expose Orbis browser control to local agents, after the agent core | Local only, permissioned | **DEFER** |

### Scheduling and automation

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Natural-language cron | Workflow schedules (once/daily/weekly/monthly) | "every Friday" mapped onto existing schedules; missed runs caught up at start | — | **IMPROVE** |
| Results delivered to messaging apps | — | Orbis notifications instead | Third-party delivery | **REJECT** |
| Notifications | None | OS notifications for finished scheduled runs, monitored changes | Local | **IMPLEMENT** |
| Monitoring for changes | — | Scheduled workflow comparing page text with the last run | — | **IMPLEMENT** |

### Security

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Approval modes and a hard blocklist | Per-capability confirmation; **step runs auto-approve everything** | Step runs ask like workflows; risk comes from capability metadata; a never-allowed list | Closes a real gap | **ADAPT** (first) |
| Prompt-injection scanning of context | Web content passed as data in places | One rule: page text, tool output and imports are data, labelled and never obeyed | Stronger | **IMPLEMENT** |
| SSRF blocking | Widget feeds only | Agent fetches too | Stronger | **INTEGRATE** |
| Stripping secrets from child processes, credential filtering | Vault isolated | Kept; agent never reads the vault | — | **INTEGRATE** |
| Messaging DM pairing and allowlists | — | — | No gateways | **REJECT** |

### Personalisation, profiles, interface

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Isolated profiles | Profiles; much data still global | Notes, tasks, whiteboards, workspaces, conversations per profile | Closes cross-profile leakage | **IMPROVE** |
| Honcho dialectic user modelling | — | — | Cloud modelling | **REJECT** |
| Command palette entry points | Ctrl+K exists | Galaxy, memory and skills reachable from it | — | **INTEGRATE** |
| Messaging gateways (Telegram, WhatsApp, Slack…) | — | — | Browser data through third parties | **REJECT** |
| OpenClaw migration | — | — | Unrelated | **REJECT** |
| Artifact / file gallery | — | — | — | **DEFER** |

### Star Map → Galaxy

| Hermes feature | Orbis today | Target | Privacy / security | Decision |
| --- | --- | --- | --- | --- |
| Map built from existing data, not stored twice | No graph | Galaxy reads memory, skills, workflows and runs, Orion Search sessions and sources, notes, tasks, projects, whiteboards, bookmarks and saved pages through the local index | Per profile; deleted things disappear | **ADAPT** |
| Nodes: skills and memories only | — | All real Orbis entity types above | — | **ADAPT** (extended) |
| Edges from skill–memory links | — | Only from real data: note saved from page, run of workflow, skill built on workflow, session used source, member of project, created from, plus links the person makes; anything inferred is labelled with where it came from | No invented relationships | **ADAPT** |
| Radial timeline, play and scrub | — | Timeline filter and date range | — | **IMPLEMENT** |
| Filters (All / Used / Learned) | — | By type, project, date, and text search | — | **IMPLEMENT** |
| Edit and delete from the map | — | Open, rename, delete, link, unlink, send to whiteboard, make a note, ask Orion about the selection | Only selected nodes sent to Orion | **IMPLEMENT** |
| d3-force on a canvas, pre-rendered glows, paused when hidden | — | d3-force (ISC) on canvas, focus-and-expand rather than rendering everything | — | **IMPLEMENT** |
| Shareable layout codes | — | — | — | **DEFER** |

### Orbis gaps the brief asks for that Hermes does not have

| Capability | Decision |
| --- | --- |
| Projects (goal, linked research, notes, tasks, skills, workflows) — built by extending Workspaces, not a new store | **IMPLEMENT** |
| Per-request model routing ("Auto") across Orion models | **IMPLEMENT** |
| Research planning, query decomposition, source records, cross-checking, claims | **IMPROVE** Orion Search |
| Using the thumbs up/down Orbis already records | **IMPROVE** |

## Build order

Each stage ships working, tested and committed before the next begins.

0. **Loose ends and safety.** Learned skills save offer fixed and committed; step runs ask before consequential actions;
   the unfinished image sharpening switched off.
1. **Foundations.** Per-profile notes, tasks, whiteboards, workspaces and conversations, with the existing data kept in
   the default profile; the local SQLite index per profile.
2. **Memory.** Store, "About me", approval, capacity, retrieval into chat, Settings and in-chat controls.
3. **Agent core.** Task model and list, persisted step runs, capability switches, context routing, model routing,
   compression.
4. **Orion Search.** Saved sessions and recall, research planning, source records, bounded parallel branches,
   checkpoints.
5. **Projects.** Workspaces extended with a goal and linked items.
6. **Skills.** Staged loading, required capabilities, scanner, repeated-work proposals.
7. **Scheduling.** Natural-language schedules, missed runs, notifications, change monitoring.
8. **Galaxy.**
9. **Security, performance and regression pass; the matrix revisited.**
