# ORBIS CHESS WORLD

## MASTER BUILD SPECIFICATION

### Sections 001–100 | Product, Architecture, Interface, Chess Engine, AI Arena, Learning and Live Chess

**Instructions to the implementation agent:** Implement ORBIS Chess World inside the existing ORBIS desktop application. Inspect the repository before modifying it. Reuse existing infrastructure wherever practical. Do not replace working functionality with mockups, create fake data, or change unrelated parts of ORBIS. Every feature must be connected to a real implementation and tested. Online multiplayer is deferred to a future release.

---

# PART I — PRODUCT FOUNDATION

## SECTION 001 — Product identity and purpose

ORBIS Chess World is a complete chess environment integrated into ORBIS. It combines chess playing, structured education, engine analysis, tactical training, opening preparation, endgame study, live-game viewing, and personal improvement in one cohesive experience. It must serve complete beginners, casual players, serious students, club players, and advanced tournament competitors without forcing every user through the same workflow.

The product must connect its capabilities meaningfully. A user should be able to play Stockfish, save the game, analyse its critical moments, identify a recurring tactical weakness, and open a related lesson or puzzle set. A user watching a live game should be able to inspect an earlier position without losing the live position, save an available game record, and analyse it after completion.

**Acceptance criteria:** The product provides a unified chess environment whose major modules share compatible game data, settings, storage, and engine services.

## SECTION 002 — Preserve the existing ORBIS application

ORBIS Chess World is an additive feature, not permission to rebuild the existing application. Before changing code, inspect the existing navigation system, layout, component library, application entry points, desktop integration, keyboard shortcuts, storage services, Orion integration, and packaging process.

Do not replace the ORBIS dashboard, redesign unrelated screens, change existing shortcuts, remove browser functionality, modify Orion behaviour, or introduce a competing application shell. Use existing extension points and design conventions where suitable. Any necessary shared-code changes must be minimal, justified, and regression-tested.

**Acceptance criteria:** Existing ORBIS and Orion functionality continues working as before, and Chess World can be opened without disrupting unrelated modules.

## SECTION 003 — Inspect the actual repository

Do not assume the project uses a particular framework or directory structure. Inspect the repository and identify its frontend framework, programming language, desktop runtime, process boundaries, routing, state management, persistence, dependency management, test infrastructure, and build pipeline.

Locate existing profile management, local file access, logging, settings, notifications, and AI integration interfaces. Identify reusable components before creating alternatives. Document the relevant files, implementation constraints, security boundaries, and proposed integration points before making extensive modifications.

**Acceptance criteria:** Implementation decisions reflect the actual repository, and no nonexistent API, file, service, or component is treated as already available.

## SECTION 004 — Maintain an implementation ledger

Maintain a checklist for all specification requirements. Record whether each requirement is unimplemented, in progress, implemented, tested, blocked, or deferred. For implemented requirements, identify the relevant files and the tests or evidence demonstrating correct behaviour.

Distinguish interface completion from functional completion. A button that displays a placeholder message is not a completed feature. A panel that shows hardcoded engine evaluations is not engine integration. A live-game card populated with invented games is not a live-game system.

**Acceptance criteria:** Implementation progress is auditable, and completion claims are supported by real code and tests.

## SECTION 005 — Define the initial release

The initial release includes local Stockfish play, chess rules, the AI Arena, Chess Academy, puzzles, opening exploration, game analysis, variation exploration, endgame training, local game storage, progress tracking, and live-game viewing through accessible providers.

Online player-versus-player multiplayer is explicitly deferred. Do not build multiplayer rooms, matchmaking, player-to-player sessions, or a multiplayer database as prerequisites. External live broadcasts remain in scope because watching public games is different from hosting games between ORBIS users.

**Acceptance criteria:** The application supports the initial feature set without requiring multiplayer infrastructure.

## SECTION 006 — Prohibit fake functionality

All production functionality must operate on real data. Engine evaluations must come from an actual engine search; puzzles must have validated solutions; game history must come from saved games; and live-game displays must come from genuine provider data.

Fixtures may be used for automated tests or a clearly labelled demonstration environment. They must never be silently substituted for unavailable production services. If a provider disconnects, the interface must show that the feed is stale or unavailable rather than continue presenting old moves as current.

**Acceptance criteria:** Production interfaces clearly distinguish live, cached, historical, demonstration, and unavailable data.

## SECTION 007 — Adopt local-first privacy

Personal chess data remains on the device by default. This includes game history, private PGNs, analysis reports, annotations, opening repertoires, saved positions, lesson progress, puzzle history, and preferences.

Accessing a public tournament feed must not upload the user's private archive. Do not introduce cloud synchronisation or cloud database storage merely to support public live-game viewing. If a future capability requires transmitting personal data, disclose what is sent, why it is necessary, and how the user can control it.

**Acceptance criteria:** Core chess functionality works without a cloud account or remote personal-data database.

## SECTION 008 — Respect ORBIS profile isolation

Use ORBIS's existing local profile architecture. Each profile must have separate game history, saved positions, annotations, learning progress, engine preferences, and personal repertoires.

Switching profiles must not reveal another profile's data. Do not create a parallel profile mechanism inside Chess World. Respect the existing application's rules for profile deletion, migration, backup, and recovery.

**Acceptance criteria:** Automated tests using multiple profiles demonstrate that private chess data remains isolated.

## SECTION 009 — Implement in dependency order

Build the system in a sequence that reduces rework: repository integration, chess rules, board rendering, local storage, Stockfish execution, game lifecycle, Analysis Studio, learning and puzzle infrastructure, openings and endgames, and finally the live-data aggregation experience.

Advanced features must use the established core rather than implementing their own incompatible chess-state logic. Each phase must reach a usable and testable state before dependent features are built on top of it.

**Acceptance criteria:** The product develops incrementally, and new modules reuse reliable underlying services.

## SECTION 010 — Define quality standards

Evaluate Chess World for correctness, usability, accessibility, performance, reliability, privacy, maintainability, and compatibility with existing ORBIS features.

Measure actual engine startup time, board responsiveness, cancellation latency, live-feed update delay, persistence reliability, and resource usage under documented test conditions. Do not invent benchmarks or claim universal sub-second live updates when provider publication delays make them impossible.

**Acceptance criteria:** The project has measurable quality targets, repeatable tests, and documented limitations.

---

# PART II — ARCHITECTURE AND CORE SERVICES

## SECTION 011 — Establish module boundaries

Separate the interface from chess rules, engine management, game sessions, persistence, live-data providers, analysis orchestration, lessons, puzzles, openings, and progress tracking.

A chessboard component must not independently spawn engine processes, issue arbitrary database queries, and implement provider-specific network requests. Instead, it should call appropriately scoped services with defined inputs and outputs.

Do not overengineer the system with unnecessary layers. Create abstractions when they support testability, shared behaviour, provider independence, or clear ownership.

**Acceptance criteria:** Major responsibilities are separated, and changing one provider does not require rewriting unrelated chess components.

## SECTION 012 — Register Chess World through ORBIS

Integrate Chess World into the existing navigation and module-registration system. Do not create a second application shell or replace the main ORBIS router.

Opening Chess World should initialise only the services necessary for its initial view. Missing optional assets, an unavailable network, or an uninstalled engine must not prevent the rest of ORBIS from starting.

**Acceptance criteria:** Chess World opens through the established ORBIS navigation without disrupting existing navigation behaviour.

## SECTION 013 — Manage shared services

Create or extend a service registry only if ORBIS does not already have a suitable mechanism. Shared services should include chess rules, engine management, game sessions, storage, analysis, live-data management, and progress tracking.

Define ownership and lifecycle rules for each service. Prevent multiple screens from creating redundant Stockfish processes or duplicate subscriptions. Allow test implementations to replace external providers and engine processes without changing production business logic.

**Acceptance criteria:** Services are reusable, testable, and correctly disposed of when no longer needed.

## SECTION 014 — Define strongly typed domain models

Use the project's existing language and type system to define models for games, moves, positions, engine searches, variations, puzzles, lessons, opening lines, live events, and analysis reports.

Represent missing information explicitly. A feed without clock data must not be assigned a fictional clock. A player without a published rating must not receive an invented rating. External data must be validated before being accepted into the internal model.

**Acceptance criteria:** Invalid or incompatible data is detected before it corrupts application state or persisted records.

## SECTION 015 — Standardise error handling

Handle illegal moves, invalid FEN, malformed PGN, engine crashes, storage failures, network disconnections, provider rate limits, incomplete records, and unsupported formats through controlled error paths.

Present useful explanations without exposing filesystem internals, tokens, or other sensitive information. Recover automatically from transient errors where safe. Preserve the user's work when an operation fails, and never silently replace corrupted data with an empty game.

**Acceptance criteria:** Expected failures produce actionable messages and do not crash the application or destroy user data.

## SECTION 016 — Keep expensive operations off the UI thread

Engine searches, bulk PGN imports, large archive queries, and multi-position analysis must not freeze the interface. Use the appropriate worker, process, or background-task mechanism already supported by ORBIS.

Provide progress indicators for long operations and cancellation where appropriate. Limit concurrent tasks and ensure that UI updates are delivered through the framework's safe execution mechanism.

**Acceptance criteria:** The board remains responsive during analysis and large imports, and resource usage remains controlled.

## SECTION 017 — Handle application lifecycle correctly

Release engine processes, subscriptions, file handles, and background workers when their owners are closed. Profile switching must stop or safely transfer active tasks according to ORBIS's established lifecycle rules.

Persist completed operations safely before shutdown when possible. If the application exits during analysis, retain the last valid saved game and mark unfinished analysis as incomplete rather than presenting it as final.

**Acceptance criteria:** Repeatedly opening and closing Chess World does not accumulate abandoned processes or duplicate background connections.

## SECTION 018 — Integrate notifications conservatively

Reuse the existing ORBIS notification system when available. Appropriate notifications include completed requested analyses, engine installation failures, selected-game completion, and optional study reminders.

Do not notify users for every move in every watched game. Let users disable optional reminders and control their frequency. Chess notifications must not alter unrelated notification behaviour in ORBIS.

**Acceptance criteria:** Notifications are useful, configurable, and consistent with the host application.

## SECTION 019 — Create a unified game-session manager

Implement a service that manages active chess sessions independently of the screen currently displaying them. A session should track the game identifier, initial position, current position, move history, players, time control, status, and source where applicable.

Support AI games, imported games, analysis sessions, puzzles, and live broadcasts through suitable session types without pretending that they all have identical rules. A live broadcast, for example, must not accept user moves as if it were a locally controlled game.

**Acceptance criteria:** Sessions can be reopened and navigated without losing state, and each session type enforces its permitted operations.

## SECTION 020 — Establish versioned local persistence

Use the existing ORBIS storage mechanism where appropriate. Define versioned schemas for games, annotations, progress, preferences, and saved analysis.

Provide safe migration paths when the schema changes. Handle missing fields, invalid records, interrupted writes, and duplicate imports. Store timestamps consistently and distinguish source-provided timestamps from local receipt times.

**Acceptance criteria:** Existing records remain readable across supported upgrades, and migrations are tested against representative older data.

---

# PART III — VISUAL IDENTITY AND GLOBAL UI

## SECTION 021 — Establish the visual design language

The Chess World interface should feel premium, modern, and futuristic without sacrificing chessboard readability. Use a dark charcoal foundation, restrained blue or cyan accents, carefully selected typography, clear visual hierarchy, and subtle depth.

Avoid excessive neon, heavy blur, constantly glowing borders, or animations that compete with the board. The visual language must feel related to ORBIS while allowing Chess World to have a distinct identity.

**Acceptance criteria:** Screens use consistent colours, spacing, typography, controls, and interaction feedback without changing the host application's global design.

## SECTION 022 — Create a dedicated Chess World workspace

Use the existing ORBIS module framework to provide a coherent Chess World workspace. Its internal navigation should expose Home, Play, Learn, Analyse, Live Chess, Library, Challenges, Progress, and Settings.

Do not place every available feature on one crowded screen. Organise advanced capabilities under logical subpages and allow users to move between related tasks without losing their current game or analysis state.

**Acceptance criteria:** Major modules are discoverable, navigation is consistent, and users can return to active work.

## SECTION 023 — Design the global header

The Chess World header should contain its product identity, contextual page title, search access, and appropriate profile or settings controls. Add quick actions only where they improve common workflows.

Keep the header visually compact. It must not consume excessive vertical space on smaller desktop windows or interfere with existing ORBIS window controls.

**Acceptance criteria:** The header remains legible and functional at supported window sizes.

## SECTION 024 — Design internal navigation states

Show which Chess World section is active. Preserve the navigation hierarchy when users enter subpages, such as Analysis Studio's Variation Explorer.

Where appropriate, provide breadcrumbs or a back action that returns users to the correct prior context. Navigation must not discard unsaved annotations or active analysis without warning.

**Acceptance criteria:** Users can navigate predictably, and destructive navigation never silently loses work.

## SECTION 025 — Implement global search

Provide a search interface that can locate relevant items in the user's local chess library, including saved games, player names in stored records, opening names, annotations, positions, and lessons.

Live-player and tournament searches should use supported external providers and be clearly distinguished from local results. Search must not imply that a player is currently playing when the available data does not establish that fact.

Support keyboard navigation and meaningful empty states. Do not return invented results when a source is unavailable.

**Acceptance criteria:** Search results identify their source and open the corresponding real game, lesson, or saved item.

## SECTION 026 — Create reusable interface components

Build reusable components for game cards, player identity, chessboards, move lists, evaluation displays, loading states, empty states, error panels, filters, dialogs, and confirmation prompts.

Components should have consistent behaviour and clear contracts. Avoid duplicating slightly different implementations across Play, Analysis Studio, and Live Chess.

**Acceptance criteria:** Shared components remain visually consistent and are covered by focused tests where practical.

## SECTION 027 — Support resizable and collapsible panels

Chess workspaces often need a large board beside secondary information. Allow appropriate panels—such as move lists, engine lines, annotations, and commentary—to be resized or collapsed.

Persist useful layout preferences within the user's ORBIS profile. Enforce sensible minimum sizes so that important controls do not become unusable.

**Acceptance criteria:** Users can customise supported workspace layouts without hiding essential controls permanently.

## SECTION 028 — Implement coherent loading and empty states

Every data-dependent view must define what happens while data is loading, when no records exist, and when a request fails.

Use progress indicators for real work and skeleton layouts only when they improve perceived continuity. Avoid indefinite spinners. Offer meaningful next steps, such as importing a PGN when the local library is empty.

**Acceptance criteria:** Every major screen has explicit loading, empty, error, and populated states.

## SECTION 029 — Make animation functional and restrained

Use animations for piece movement, panel transitions, evaluation changes, and state feedback when they improve understanding. Animations must not block input or create the impression that an unreceived live move has already arrived.

Respect reduced-motion preferences and allow users to reduce decorative animation. Board interactions should remain responsive even when visual transitions are disabled.

**Acceptance criteria:** Animations enhance clarity and can be disabled or reduced without breaking functionality.

## SECTION 030 — Establish responsive desktop behaviour

Design primarily for ORBIS's desktop environment while adapting to different window sizes. When horizontal space decreases, collapse secondary panels before shrinking the board to an unusable size.

Ensure dialogs, menus, move lists, and settings remain accessible at supported dimensions. Avoid assuming a single monitor resolution or permanently fixed panel width.

**Acceptance criteria:** Core chess workflows remain usable across the application's supported desktop window sizes.

---

# PART IV — CHESSBOARD AND RULES

## SECTION 031 — Implement the interactive chessboard

Create a polished, accurate chessboard with selectable pieces, legal-move interaction, move animations, last-move highlighting, check indication, board flipping, and configurable visual themes.

The board must represent the authoritative position supplied by the chess-state service. It must not independently decide that an illegal move is valid or maintain an unrelated position history.

Allow users to interact through supported mouse and keyboard controls. Clearly distinguish selected squares, legal destinations, the previous move, and the current check state without making the board visually confusing.

**Acceptance criteria:** Board interactions match the authoritative chess state and remain consistent after undo, redo, import, and position navigation.

## SECTION 032 — Implement correct chess rules

Use a maintained chess-rules library compatible with the project's runtime, such as `chess.js` if it fits the repository. Verify library compatibility, API behaviour, licence, and packaging implications before integration.

The rules layer must handle legal movement, captures, check, checkmate, stalemate, castling, en passant, promotion, insufficient material, and relevant draw conditions. Do not reimplement the full rules engine in UI components.

**Acceptance criteria:** Rules are tested against representative legal and illegal positions, including special moves and terminal states.

## SECTION 033 — Validate every move

Before applying a move to an authoritative local game session, validate it against the current position. Reject invalid moves without corrupting the board, history, clock, or engine state.

For promotions, require a valid promotion piece and present a clear selection interface when the user reaches the promotion square. For castling and en passant, use the rules engine's actual position state rather than visual assumptions.

**Acceptance criteria:** Illegal moves are rejected consistently, and valid special moves are recorded correctly.

## SECTION 034 — Support FEN positions

Implement reliable FEN import and export for position setup, analysis, puzzles, opening exploration, and game navigation.

Validate incoming FEN. When it is malformed or unsupported, explain the problem and preserve the user's existing session. Where the rules library normalises FEN output, document and test the chosen representation.

Do not treat FEN as a complete substitute for full game history when repetition or move-history-dependent conditions matter.

**Acceptance criteria:** Valid FEN positions can be loaded, displayed, analysed, and exported without losing the position's supported state.

## SECTION 035 — Support PGN import and export

Implement PGN import and export for game sharing, archives, analysis, and opening repertoires. Support standard headers, move notation, comments, variations where supported, and game results.

Malformed PGN must produce actionable errors. Large imports should run in the background and show progress. Duplicate handling should be based on a documented policy rather than silently deleting games that merely look similar.

**Acceptance criteria:** Representative PGN files round-trip correctly, and import failures do not damage existing records.

## SECTION 036 — Track move history and navigation

Maintain a reliable move history with access to the initial position, current position, and intermediate positions. Users should be able to navigate backward and forward without changing the saved game unexpectedly.

For analysis sessions, distinguish the original game line from exploratory variations. For live games, distinguish historical navigation from the newest received position.

**Acceptance criteria:** Position navigation always corresponds to the correct move and preserves the appropriate session state.

## SECTION 037 — Add legal-move visualisation

When a piece is selected, show legal destinations where this behaviour is enabled. Support configuration to hide legal-move indicators for users who prefer a cleaner board.

Indicators must come from the rules engine. Do not show destinations that are geometrically possible but illegal because they expose the king or violate another chess rule.

**Acceptance criteria:** Every displayed legal destination is valid for the current position.

## SECTION 038 — Support move notation and annotations

Display standard algebraic notation and allow annotations in relevant study and analysis workflows. Keep engine-generated suggestions separate from user-written comments and provider-supplied commentary.

Annotations should be associated with stable game positions or moves so they remain correctly attached when users navigate the game. If the main line changes, avoid silently attaching comments to the wrong move.

**Acceptance criteria:** Notation and annotations remain consistent during navigation, editing, and export.

## SECTION 039 — Implement draw and resignation controls

Support valid draw claims and agreed-draw recording where appropriate to the local game model. Provide resignation and game-ending confirmation controls suitable for the current game type.

Do not treat a draw offer as automatically accepted. Do not allow a live broadcast viewer to resign or change the externally recorded game.

**Acceptance criteria:** Game-ending controls reflect the session type and correctly update game status and results.

## SECTION 040 — Create a position editor

Provide an editor for constructing custom chess positions. Users should be able to place pieces, remove pieces, choose the side to move, configure castling rights and en-passant information where supported, and validate the resulting position.

Warn when a position is illegal or unsuitable for a particular training mode. Do not automatically convert an invalid position into a different position without telling the user.

**Acceptance criteria:** Valid custom positions can be saved as FEN and used in supported training and analysis workflows.

---

# PART V — STOCKFISH ENGINE INFRASTRUCTURE

## SECTION 041 — Use local Stockfish as the primary engine

Stockfish must be the primary engine for AI opponents and chess analysis. Use an official, appropriate build compatible with the target operating system and hardware architecture.

Do not assume every user has the same CPU features. Select a supported build and provide a safe fallback if the preferred binary cannot run. Verify the engine's identity and version through its actual executable output.

**Acceptance criteria:** ORBIS can launch a compatible local Stockfish build and obtain genuine engine responses.

## SECTION 042 — Establish the engine acquisition and installation flow

Determine whether Stockfish can be bundled under the applicable distribution model or should be downloaded through an explicit installation flow. Consider installer size, update requirements, supported architectures, and licensing obligations.

If a download is required, show its progress, validate the downloaded artifact as appropriate, handle interruption, and report failures. Do not execute an unverified downloaded binary.

Users must not be left with a nonfunctional AI Arena because the engine is missing. Offer a clear installation or repair path.

**Acceptance criteria:** Engine setup is reproducible, reports its actual state, and safely handles failed downloads or installation.

## SECTION 043 — Integrate Stockfish through UCI

Communicate with Stockfish through the Universal Chess Interface protocol. Implement a process manager that sends valid commands and parses engine responses according to the protocol.

Handle engine initialisation, readiness, position setup, search requests, search cancellation, and shutdown. Do not parse output by assuming that messages always arrive as complete individual chunks; process streams safely.

**Acceptance criteria:** The engine manager can execute repeatable searches and recover from malformed, unexpected, or interrupted process output.

## SECTION 044 — Build a reusable engine manager

All Chess World features must access Stockfish through a shared engine-management service. The service should coordinate process startup, search allocation, engine configuration, cancellation, process health, and result delivery.

Avoid launching a new engine for every button click. Reuse the process where safe, while ensuring concurrent requests cannot accidentally overwrite one another's search state.

**Acceptance criteria:** Multiple features can request analysis without creating unmanaged processes or mixing unrelated results.

## SECTION 045 — Manage engine resources

Expose appropriate search controls such as time limits, node limits, and supported engine settings. Establish sensible defaults based on the device and user preferences.

Avoid running unlimited searches in the background. Give active user requests appropriate priority, cancel abandoned work, and limit concurrent analyses to prevent excessive CPU usage.

**Acceptance criteria:** Engine resource use is controlled, measurable, and responsive to user cancellation.

## SECTION 046 — Parse engine evaluations correctly

Interpret Stockfish output using its documented UCI fields. Distinguish centipawn evaluations from mate scores, and account for which side is to move and which perspective the interface displays.

Never show a mate score as an ordinary centipawn value. Do not display an evaluation from an old position as if it belongs to the current board.

**Acceptance criteria:** Evaluation signs, units, mate indicators, and associated positions are tested for correctness.

## SECTION 047 — Display principal variations

Show one or more engine principal variations when available. Convert UCI move notation into understandable chess notation against the correct position, and verify that displayed moves form a legal sequence.

Allow users to explore a variation without silently replacing the main game. Make it clear when a line is partial because a search has not completed or was cancelled.

**Acceptance criteria:** Displayed variations are legal, correctly associated with their source position, and labelled according to their actual completion state.

## SECTION 048 — Support search progress and cancellation

Display appropriate search progress, including depth, nodes, elapsed time, and other supported information. Do not assume all engine builds emit identical optional fields.

When the user cancels a search, send the appropriate stop command and handle the engine's completion response. Prevent late results from an abandoned request from overwriting a newer analysis.

**Acceptance criteria:** Search status is accurate, cancellation is reliable, and results are associated with the correct request identifier.

## SECTION 049 — Provide engine diagnostics and recovery

Detect engine startup failure, premature process exit, invalid responses, and repeated timeouts. Capture useful diagnostic information without exposing private file paths unnecessarily.

Offer recovery options such as restarting the engine or checking the configured binary. Preserve the user's game and analysis state if the engine crashes.

**Acceptance criteria:** Engine failure does not crash ORBIS, and the user receives a clear explanation and recovery path.

## SECTION 050 — Meet Stockfish licensing obligations

Review the applicable Stockfish licence and distribution requirements before bundling, modifying, or redistributing its executable. Include required licence notices and source-code or corresponding-source availability as applicable.

Also verify the licences of the chess-rules library, board components, tablebases, opening databases, fonts, icons, and other bundled assets. Do not assume that a publicly downloadable resource is automatically unrestricted for redistribution.

**Acceptance criteria:** Distribution packaging and documentation comply with the licences of all included components.

---

# PART VI — AI ARENA

## SECTION 051 — Create a complete AI game setup screen

Provide a setup flow for starting a new game against Stockfish. Allow users to choose colours, difficulty, time control, starting position, board orientation, assistance settings, and commentary preferences.

Offer a clear standard-game default so beginners can start quickly. Advanced settings should remain available without overwhelming the initial setup.

Validate incompatible options and explain their effects before starting the game.

**Acceptance criteria:** A selected configuration is applied to the actual game session, clock, and engine behaviour.

## SECTION 052 — Implement meaningful difficulty settings

Provide user-facing difficulty levels from beginner-friendly to maximum available engine strength. Map those labels to tested engine configurations instead of claiming exact human ratings without evidence.

Calibrate strength using actual games or suitable benchmarks. Account for search limits and engine settings that may affect consistency. Explain that the labels are approximate when precise rating calibration is unavailable.

**Acceptance criteria:** Difficulty settings produce measurably different behaviour where intended, and their limitations are documented.

## SECTION 053 — Support chess time controls

Implement appropriate time controls, including untimed games and commonly used bullet, blitz, rapid, and classical formats. Store the initial clock settings and increments with the game record.

Clock updates must use a reliable time source rather than depend solely on the frequency of visual rendering. Pause, resume, and game-ending behaviour must be consistent with the selected mode.

**Acceptance criteria:** Clocks count down correctly, increments are applied appropriately, and timeout results are handled consistently.

## SECTION 054 — Build the AI game board layout

Give the board the dominant visual position. Display player information, clocks, move history, and contextual controls without overcrowding the screen.

Place secondary information such as commentary and engine evaluation in panels that can be collapsed or resized. On narrower windows, prioritise the board and essential controls.

**Acceptance criteria:** The game remains playable across supported window sizes without important controls being clipped or obscured.

## SECTION 055 — Implement complete game lifecycle management

Support game creation, active play, resignation, draw outcomes, checkmate, stalemate, timeout where applicable, and completed-game review.

Prevent additional moves after a terminal state. Store the final result and preserve the move history. Offer actions to analyse, save, export, or start another game.

**Acceptance criteria:** Every valid game-ending condition leads to a consistent terminal state and a recoverable game record.

## SECTION 056 — Implement AI move generation

When it is Stockfish's turn, submit the correct position and search request through the engine manager. Apply the returned move only after verifying that it is legal in the current game state.

Handle engine cancellation, position changes, and unexpected output without applying stale moves. The engine must never make two moves for the same turn because of duplicate events.

**Acceptance criteria:** AI moves are legal, correspond to the latest position, and are applied exactly once.

## SECTION 057 — Add configurable AI commentary

Offer commentary styles such as Friendly Coach, Grandmaster, Witty Rival, Tactical Maniac, Silent Assassin, and Custom Rival. These styles should change the tone and frequency of explanations, not falsify the engine's strength or secretly alter legal-move rules.

Commentary should be triggered by meaningful game events and remain optional. Avoid generating repetitive remarks after every ordinary move.

**Acceptance criteria:** Commentary settings persist, and generated comments do not contradict the underlying board or analysis.

## SECTION 058 — Ground chess explanations in evidence

When explaining a tactic or position, use actual board state and, where necessary, Stockfish analysis. A natural-language model may explain a verified engine line, but it must not invent candidate moves, claim unsupported forced mates, or fabricate tactical consequences.

Separate factual engine output from explanatory interpretation. When the engine has not searched enough to establish a conclusion, communicate uncertainty rather than presenting a guess as proven.

**Acceptance criteria:** Explanations are traceable to a real position and validated lines.

## SECTION 059 — Implement configurable hints

Offer assistance levels ranging from no help through strategic hints, threat identification, candidate moves, best-move suggestions, and full principal variations.

Hints must correspond to the current position and should not reveal more information than the user selected. In training modes, record whether the user requested a hint when measuring independent performance.

**Acceptance criteria:** Hints are position-specific, respect the selected assistance level, and never display stale analysis.

## SECTION 060 — Provide post-game review

When a game ends, offer a summary with the result, game length, important moments, and an option to open Analysis Studio.

If the user requests a detailed review, perform real engine analysis rather than estimating accuracy from superficial move counts. Make clear whether the review is complete or still processing.

**Acceptance criteria:** The post-game summary reflects the saved game, and detailed analysis uses the actual engine pipeline.

---

# PART VII — CHESS ACADEMY

## SECTION 061 — Create a structured learning environment

The Chess Academy must provide a progression from absolute beginner to advanced chess study. Organise lessons by prerequisite knowledge and demonstrated mastery rather than presenting an unstructured list of articles.

Users should be able to continue a course, revisit completed lessons, practise difficult topics, and review mistakes. Advanced users should be able to access relevant content without repeatedly completing beginner lessons.

**Acceptance criteria:** Lessons have defined objectives, prerequisites where necessary, interactive content, and persistent progress.

## SECTION 062 — Teach absolute beginners

Begin with the board, coordinates, piece names, legal movement, captures, checks, checkmate, and stalemate. Continue with castling, en passant, promotion, and basic checkmate patterns.

Use an interactive board and guided exercises. Explain each concept in accessible language, with optional deeper explanations for users who want them.

**Acceptance criteria:** A beginner can practise and demonstrate the foundational rules without needing to leave the lesson.

## SECTION 063 — Teach opening principles

Explain centre control, development, king safety, piece activity, and common opening mistakes. Demonstrate principles through positions and moves rather than relying solely on written descriptions.

Distinguish general principles from absolute rules. Explain that opening decisions depend on the position and that a superficially unusual move is not automatically losing.

**Acceptance criteria:** Each lesson includes positions where users can apply and test the concept.

## SECTION 064 — Teach tactical patterns

Create interactive lessons for forks, pins, skewers, discovered attacks, double attacks, deflection, decoys, interference, clearance, removing the defender, and other verified tactical motifs.

Each lesson should explain the pattern, show a correct example, offer a guided exercise, and provide independent practice. Ensure the board state and solution are valid before presenting the exercise.

**Acceptance criteria:** Tactical lessons use legal positions and validated solutions, with feedback tied to the user's actual move.

## SECTION 065 — Teach positional strategy

Cover weak squares, pawn structure, open files, outposts, piece activity, king safety, space, exchanges, and long-term planning.

Use concrete positions to show how strategic advantages develop. Avoid treating every engine preference as an easily explained strategic certainty; where a concept is subtle, present the underlying evidence and alternatives.

**Acceptance criteria:** Lessons explain strategic concepts through real positions and meaningful decisions.

## SECTION 066 — Teach calculation and candidate moves

Train users to identify forcing moves, calculate legal variations, compare candidate moves, and evaluate resulting positions.

Exercises should encourage users to think before revealing engine recommendations. Allow users to record candidate lines and then compare them with validated analysis.

**Acceptance criteria:** Calculation exercises distinguish the user's submitted line from the reference solution and provide useful feedback.

## SECTION 067 — Teach defensive play

Include defensive resources such as counterplay, exchanges that reduce danger, perpetual-check opportunities, fortresses where appropriate, and defensive tactical moves.

Do not assume that the side with a material deficit is necessarily losing or that an apparent attack is forced. Use engine-verified examples and explain the relevant position features.

**Acceptance criteria:** Defensive lessons demonstrate valid resources and explain why alternative defensive attempts fail where evidence supports that conclusion.

## SECTION 068 — Build lesson assessments

Assess whether users can apply the lesson through interactive questions and board positions. Use more than passive completion tracking.

Provide feedback for incorrect answers and allow retries. Track performance separately from whether the user viewed the lesson.

**Acceptance criteria:** Lesson completion depends on the defined learning requirements rather than merely opening the page.

## SECTION 069 — Implement spaced repetition

Schedule review exercises based on previous performance and the importance of the concept. Repeated mistakes should lead to additional practice, while consistently mastered concepts can be reviewed less frequently.

Store review history locally and make scheduling behaviour predictable. Provide a way to inspect or adjust study recommendations without forcing the user into an inflexible programme.

**Acceptance criteria:** Review scheduling uses real recorded performance and survives application restarts.

## SECTION 070 — Create a personalised learning path

Recommend lessons based on actual game mistakes, puzzle performance, completed lessons, and the user's stated goals.

Explain why a recommendation appears. For example, repeated failures to recognise knight forks may suggest a tactical review. Do not claim to have detected a weakness when insufficient evidence exists.

**Acceptance criteria:** Recommendations are derived from available records and can be dismissed or adjusted.

---

# PART VIII — PUZZLE UNIVERSE

## SECTION 071 — Build a complete puzzle workspace

Provide tactical puzzles, mating exercises, defensive challenges, strategic positions, and endgame puzzles in a dedicated environment.

Support daily challenges, themed practice, rating progression, timed sessions, and personalised review. All puzzles must originate from a validated source or a generation pipeline that verifies the position and solution.

**Acceptance criteria:** Users can complete real puzzles, receive meaningful feedback, and review their previous attempts.

## SECTION 072 — Validate every puzzle position

Before a puzzle is presented, validate its FEN, legal position state, side to move, intended objective, and solution line.

For imported or generated puzzles, verify that the intended solution is legal and consistent with the puzzle's stated goal. Reject malformed or ambiguous positions rather than silently displaying them.

**Acceptance criteria:** Invalid puzzles are excluded from production play and recorded for debugging where appropriate.

## SECTION 073 — Support multiple tactical objectives

Include forks, pins, skewers, mating attacks, discovered attacks, deflections, defensive resources, and quiet tactical moves.

Classify puzzles by theme only when the classification is supported by the source or a validated annotation process. Allow users to practise a selected theme or a mixed set.

**Acceptance criteria:** Puzzle filters produce relevant, real puzzles and do not rely on fabricated metadata.

## SECTION 074 — Implement puzzle move validation

Validate each user move against the puzzle's accepted solution tree or other defined objective. Where multiple equivalent moves are correct, accept them when the verified solution permits them.

If a move is incorrect, explain the result at an appropriate level and allow the configured retry behaviour. Do not reveal the entire solution immediately unless the user requests it.

**Acceptance criteria:** Correct alternatives are handled deliberately, and feedback matches the actual puzzle position.

## SECTION 075 — Create adaptive puzzle difficulty

Adjust puzzle selection based on recorded performance, response time where appropriate, and puzzle rating. Avoid changing the rating arbitrarily after every attempt.

Make the rating model and its limitations clear. If the application lacks enough history to calibrate difficulty, begin with a reasonable default and gather real performance data.

**Acceptance criteria:** Difficulty changes are based on recorded outcomes and remain consistent across sessions.

## SECTION 076 — Track puzzle performance

Store attempts, results, time taken when relevant, hints requested, themes, and rating changes. Use this information to identify recurring weaknesses and recommend review exercises.

Keep the statistics profile-specific and allow users to inspect their progress. Do not infer a skill level from a single puzzle.

**Acceptance criteria:** Puzzle history is persistent, accurate, and derived from actual attempts.

## SECTION 077 — Provide puzzle explanations

After a solution, explain the tactical idea and show the relevant continuation. Use legal moves and, where needed, engine verification to establish the line.

Distinguish a forced sequence from an illustrative variation. If several lines are acceptable, explain why the submitted move satisfies the puzzle's objective.

**Acceptance criteria:** Explanations match the validated position and solution.

## SECTION 078 — Generate puzzles from saved games

Allow the application to identify candidate tactical moments in games the user owns or is permitted to analyse. Use engine analysis to find plausible opportunities, then validate the resulting position and solution before creating a puzzle.

Do not label every engine evaluation swing as a useful puzzle. Filter out ambiguous, trivial, malformed, or poorly explained positions.

**Acceptance criteria:** Generated puzzles are linked to their source game and are validated before appearing in the user's puzzle collection.

## SECTION 079 — Implement daily challenges and streaks

Provide a daily puzzle experience with a stable challenge for the relevant local date. Avoid changing the puzzle repeatedly when the user restarts the application.

Streaks must reflect actual completed challenges and respect the user's local date rules. Explain what counts as a successful completion.

**Acceptance criteria:** Daily challenges and streaks are persistent and cannot be accidentally duplicated by refreshing the interface.

## SECTION 080 — Build puzzle review and revision

Let users revisit failed puzzles, save difficult positions, and practise previously missed tactical themes. Provide filters for recent mistakes, recurring themes, difficulty, and saved exercises.

The review system should prioritise useful learning rather than simply presenting the same puzzle indefinitely.

**Acceptance criteria:** Review sessions use the user's real history and preserve the relationship between a puzzle and its original solution.

---

# PART IX — LIVE CHESS DATA AND REAL-TIME BROADCASTS

## SECTION 081 — Define the live-game system's purpose

Live Chess must discover, display, and follow actual games made available by supported chess platforms and authorised tournament feeds. It must not generate fictional games or claim universal access to every game being played worldwide.

The feature is a spectator and study environment. Online multiplayer between ORBIS users is deferred. Users may watch games, inspect positions, and analyse available records, but the live board must not accept moves that modify the externally broadcast game.

**Acceptance criteria:** Live Chess uses genuine accessible data and clearly distinguishes watching from playing.

## SECTION 082 — Establish the Lichess connector

Use the documented Lichess API to discover available broadcasts and retrieve the records or streams provided for those broadcasts.

Investigate the current documented interfaces for broadcast listings, round information, game records, and live PGN streaming. Do not invent endpoint paths or assume that every game on Lichess is accessible through a single public feed.

Handle missing rounds, unavailable games, deleted broadcasts, and provider errors without crashing the live dashboard.

**Acceptance criteria:** The connector can discover actual available broadcasts and retrieve their game information using documented interfaces.

## SECTION 083 — Implement Chess.com access only through supported interfaces

Investigate the currently documented Chess.com interfaces and permitted event-broadcast access mechanisms before implementing the connector.

Do not assume that the public player-data API exposes every live game or that ordinary website pages are authorised substitutes for a documented feed. Respect applicable terms, rate limits, authentication requirements, and restrictions.

If a required live-data interface is unavailable or requires permission, report the limitation and continue using supported providers.

**Acceptance criteria:** The connector uses a verified, permitted interface and does not rely on invented or prohibited access methods.

## SECTION 084 — Support authorised tournament feeds

Provide an extensible connector interface for organisers or providers that publish live PGN, electronic-board data, or another documented chess-game format.

A provider may supply data through a streaming endpoint, periodically updated file, or another supported mechanism. The connector must understand the source's update model and attribution requirements.

Do not treat every tournament website as an authorised source merely because its board is publicly visible in a browser.

**Acceptance criteria:** New permitted providers can be integrated without rewriting the live board or the game-session model.

## SECTION 085 — Build a provider-independent live-data manager

Create a live-data manager that coordinates provider connectors, game discovery, update subscriptions, caching, and reconnection.

Each connector should convert its source-specific information into a common internal representation while preserving important provider metadata. Failures in one provider must not prevent healthy providers from supplying games.

The manager must distinguish discovery refreshes from active-game subscriptions so that ORBIS does not maintain unnecessary connections to every game.

**Acceptance criteria:** Multiple supported sources can feed the same Live Chess interface without becoming tightly coupled to it.

## SECTION 086 — Make live updates streaming-first

Use a documented streaming API, WebSocket, server-sent event stream, or equivalent persistent update mechanism when the provider offers a suitable interface.

Where streaming is unavailable, use appropriately rate-limited HTTP polling or a provider's documented live PGN update mechanism. Do not create an artificial WebSocket wrapper and claim it makes a slow source real-time.

**Acceptance criteria:** Each provider uses the fastest suitable permitted update mechanism available to ORBIS.

## SECTION 087 — Target low-latency board updates

The performance objective is to display each received move promptly, aiming for sub-second application-side processing when the provider, network, and device permit it.

Measure separate timestamps for source-provided update time, local receipt time, and board-render completion when those measurements are available. Do not describe a move as instant if the provider published it several seconds after it was played.

Avoid unnecessary full-page reloads, expensive component remounts, and repeated parsing of unchanged game records.

**Acceptance criteria:** Live updates are measured, board rendering is efficient, and displayed freshness accurately reflects available timing information.

## SECTION 088 — Recover from missed moves and disconnections

Handle dropped connections, interrupted streams, duplicate messages, out-of-order events, and application sleep or network changes.

After reconnection, obtain the latest authoritative game state or replay the required missing updates using the provider's documented mechanism. Validate move sequences before applying them.

Do not append the same move twice or assume that a reconnect automatically resumes from the correct position.

**Acceptance criteria:** The board returns to the correct source position after simulated interruptions and repeated messages.

## SECTION 089 — Build the Live Chess dashboard

Display actual available live games in a searchable dashboard. Each card should show the available player names, event, round, game status, source, current position when available, and a watch action.

Show ratings and clocks only when the source supplies them or when a clearly documented data source provides them. Provide filters for event, player, provider, and status when the required metadata exists.

When no broadcasts are available, show an honest empty state and allow the user to retry or inspect other supported sources.

**Acceptance criteria:** Dashboard cards open genuine games and never invent players, ratings, clocks, or game states.

## SECTION 090 — Implement live-player search

Allow users to search for players such as Gukesh or Magnus Carlsen across the supported and accessible game listings.

The search should identify the provider and indicate whether the result is live, delayed, completed, or historical. Do not infer that a player is currently competing merely because a historical game exists.

Support name variations and provider-specific identifiers where the data allows them, while avoiding unreliable identity matching between different players with similar names.

**Acceptance criteria:** Search results are traceable to real records and accurately represent their availability and status.

## SECTION 091 — Implement tournament exploration

Provide tournament listings based on the information actually published by connected providers. Opening a tournament should reveal its available rounds and games, organised by board or pairing when those details exist.

Allow users to switch between games without repeatedly returning to the main dashboard. Display tournament dates, round information, and status only when known.

**Acceptance criteria:** Tournament navigation reflects actual provider data and handles missing or incomplete event metadata gracefully.

## SECTION 092 — Create the live-game viewing interface

The live board should prominently display the board, player names, move list, event details, and available clocks. Include the provider name, connection state, and a visible last-update indicator.

Provide a control to return to the latest position after the user navigates backward. Make it clear when the displayed board is historical rather than current.

**Acceptance criteria:** Users can watch a game, inspect previous moves, and return to the latest received position without losing synchronisation.

## SECTION 093 — Display source freshness and broadcast delay

Distinguish active updates from delayed broadcasts, stale cached records, and unavailable feeds. Use source timestamps when trustworthy and available; otherwise, use local receipt times while clearly labelling what they represent.

Do not calculate a precise live delay when the source does not provide enough information to establish it. If updates stop unexpectedly, show a stale-feed indicator after a configurable threshold appropriate to that provider.

**Acceptance criteria:** The interface never implies that an old position is current when the system knows the feed is stale.

## SECTION 094 — Handle clocks and tournament metadata accurately

Display clock values, round numbers, board identifiers, ratings, and results only when the source provides them or a verified compatible data source supplies them.

Do not attempt to reconstruct an official clock from move arrival intervals. Network delays and broadcast batching make that unreliable.

If clock information is missing, preserve the board layout gracefully without displaying a fictional zero or countdown.

**Acceptance criteria:** Displayed metadata is traceable to its source and is clearly marked when unavailable.

## SECTION 095 — Archive completed live games

When a provider supplies a completed game record, make it available in the user's local chess archive according to their storage preferences.

Store the source, retrieval time, game metadata, available PGN, and relevant provenance information. Handle duplicate retrievals without creating an unlimited collection of identical records.

If the source only provides a partial game or does not permit local retention, respect that limitation and explain the available options.

**Acceptance criteria:** Available completed games can be revisited locally without misrepresenting incomplete or restricted records.

## SECTION 096 — Connect live games to Analysis Studio

Allow users to analyse available positions from live games without modifying the underlying broadcast. Users should be able to analyse the current position, investigate an earlier move, or open a completed PGN in Analysis Studio.

When a live game continues updating, keep the analysis position independent from the live-follow position. Users must not lose a variation or have their board unexpectedly jump forward while they are studying a line.

**Acceptance criteria:** Live viewing and analysis can coexist without corrupting the game or disrupting the user's study session.

## SECTION 097 — Manage live-feed resources efficiently

Do not subscribe to every game at maximum update frequency when the user only wants to browse the event list.

Refresh discovery metadata according to documented provider limits and use active subscriptions for selected games where possible. Share connections only when the provider's protocol and implementation make that safe.

Stop unnecessary polling and subscriptions when the user leaves the feature, while respecting any explicitly enabled background-watch behaviour.

**Acceptance criteria:** Live-data resource use scales sensibly and respects provider limits.

## SECTION 098 — Respect source licensing, terms, and attribution

Before integrating a provider, verify its API documentation, permitted usage, rate limits, authentication requirements, data retention rules, and attribution requirements.

Do not assume that publicly accessible game data can be redistributed without restriction. Preserve source identifiers and provide attribution when required.

If a provider's restrictions conflict with the desired feature, use another permitted source or document the limitation instead of bypassing access controls.

**Acceptance criteria:** Each connector has documented source requirements and follows the provider's applicable terms.

## SECTION 099 — Build a unified live-game record model

Normalise provider data into a common record containing a stable internal identifier, provider identifier, source name, player metadata, event metadata, game status, available move history, current position, timestamps, and optional clock information.

Preserve source-specific metadata when it is necessary for recovery, attribution, or later retrieval. Represent unknown values explicitly and validate incoming positions and moves.

**Acceptance criteria:** Games from different providers can be rendered by the same UI without losing source provenance or inventing missing information.

## SECTION 100 — Define the initial end-to-end acceptance test

The first complete milestone must demonstrate a genuine local AI game and a genuine live broadcast workflow within ORBIS.

For the AI workflow, start Stockfish, play legal moves, finish a game, save the record locally, and reopen it in Analysis Studio. For the live workflow, discover a real supported broadcast, receive new data through its documented update mechanism, update the board without manual refresh, handle a temporary interruption, and recover the correct position.

If a provider or network is unavailable during testing, record that limitation and test the failure path. Do not substitute a fake live game and mark the real-data requirement complete.

**Acceptance criteria:** The milestone demonstrates working chess rules, real local engine execution, persistent game storage, actual live-data ingestion, automatic board updates, and safe recovery without changing unrelated ORBIS functionality.

---

## END OF PART 1 — SECTIONS 001–100

**Continuation requirement:** The next part begins at **SECTION 101**. Preserve all earlier requirements and numbering. Continue with deeper implementation specifications for Analysis Studio, variation trees, engine analysis, opening databases, repertoires, endgame training, game libraries, and supporting workflows.

# ORBIS CHESS WORLD

## MASTER BUILD SPECIFICATION

### PART 2 — SECTIONS 101–200

### Analysis Studio, Variation Explorer, Opening Lab, Endgame Lab, Chess Library, Personal Coach, Training Intelligence and Data Integrity

---

# PART X — ANALYSIS STUDIO: PRODUCT DESIGN AND ARCHITECTURE

## SECTION 101 — Establish Analysis Studio as the central analysis workspace

Analysis Studio must be the primary environment for understanding chess games and positions. It must support games played against Stockfish, imported PGNs, completed live broadcasts, user-created positions, saved studies, and games obtained from other permitted sources. Do not restrict analysis to famous players, professional tournaments, or games with published ratings. Every valid game that the system can process should be eligible for analysis.

The implementation must distinguish between the original game, the current navigation position, the active exploratory variation, and any engine-generated candidate lines. These are related but separate concepts. Moving backward through a game must not accidentally overwrite the original game, and testing an alternative move must not silently replace the official move history.

Provide an obvious entry point into Analysis Studio from completed games, the local library, live-game archives, puzzle positions, the position editor, and imported PGNs. The experience must remain useful when no engine is installed, although engine-dependent features must be visibly unavailable until Stockfish is configured.

**Acceptance criteria:** Users can open any supported game or position in Analysis Studio, navigate its moves, create variations, request engine analysis, save annotations, and export the appropriate record without changing the source game unintentionally.

## SECTION 102 — Define the Analysis Studio workspace layout

Use a board-centred desktop layout with a large chessboard as the primary visual element. Position the move list beside the board, with engine analysis, evaluation history, annotations, and analysis controls organised into secondary panels. The exact arrangement should adapt to ORBIS's existing layout system rather than introducing a separate window-management framework.

At minimum, the workspace must provide access to the board, move navigation, engine evaluation, principal variations, game metadata, and annotations. Secondary information must be collapsible so users can prioritise board visibility. Provide a compact layout for narrower windows and a more expansive layout for users who prefer simultaneous access to multiple analysis panels.

Avoid presenting every advanced option at once. The initial view should expose common actions—Analyse, Back, Forward, Save, and Export—while advanced search parameters and engine configuration remain accessible through contextual controls.

**Acceptance criteria:** The workspace remains usable at supported desktop dimensions, preserves the selected layout within the active profile, and never hides an essential action behind a permanently inaccessible panel.

## SECTION 103 — Create a dedicated analysis session model

Represent each analysis session with an identifier, source reference, source game metadata, original move sequence, current navigation position, active variation, annotation state, engine-search state, and persistence state. A session should also record whether it is attached to a local game, imported record, completed broadcast, live game, or custom position.

Do not store every UI interaction as if it were a chess move. Opening a panel, changing the evaluation orientation, or selecting a move must not alter the underlying game. Exploratory moves must belong to a variation tree associated with the relevant parent position.

The session model must support safe recovery after navigation, temporary engine failure, application restart, and profile switching. If the user has unsaved annotations or a variation, the application must either persist them automatically or clearly identify the unsaved state.

**Acceptance criteria:** Session state can be reconstructed from saved data, and source-game moves remain distinguishable from exploratory analysis.

## SECTION 104 — Implement precise position navigation

Provide navigation to the beginning of the game, the previous move, the next move, and the end of the available main line. Users must also be able to select individual moves directly from the move list.

Every navigation action must derive the displayed position from a consistent game state. Do not rely on the visual board alone as the source of truth. The move list, board, side-to-move indicator, evaluation, and current annotation must all refer to the same position.

When a user reaches the end of a game, disable or appropriately reinterpret the forward control rather than creating a move implicitly. If a selected variation ends before the main line, show that the user is at the end of that variation and offer a clear route back to the parent position.

**Acceptance criteria:** Random-access navigation, backward and forward traversal, and switching between variations all produce the correct board position and metadata.

## SECTION 105 — Separate source history from analysis history

Analysis Studio must preserve the imported or completed game's original moves independently from new moves entered during analysis. The original line must remain recoverable even after the user explores alternatives.

Use an explicit variation tree or equivalent data structure. Each variation node should identify its parent position, the move played from that position, the resulting position, and any associated comments or engine information. Avoid representing variations as unrelated strings that become detached from their board positions.

The UI must visually distinguish the main line from side variations without making the move list unreadable. When users choose to promote a variation to the main line, require a clear operation with an appropriate undo or recovery mechanism.

**Acceptance criteria:** Users can explore, compare, rename where supported, promote, and delete variations without accidentally destroying the original source game.

## SECTION 106 — Design the engine-analysis control panel

Provide an analysis panel with clear controls for starting, pausing where supported, stopping, and configuring a search. Expose practical settings such as time or node limits, search depth where appropriate, the number of displayed lines, and supported engine options.

Show the current search status, the position being analysed, elapsed time, and available search progress. Do not imply that a search has finished when it has merely reached an intermediate depth. A stopped search must be labelled as incomplete unless the relevant completion conditions have genuinely been satisfied.

Persist appropriate preferences in the user's profile, but do not silently apply an aggressive search configuration that can overwhelm lower-powered devices. Provide sensible defaults and a way to restore them.

**Acceptance criteria:** Search controls reflect actual engine state, user settings are applied to real searches, and incomplete results are never presented as fully completed analysis.

## SECTION 107 — Support analysis of any valid supported game

Allow analysis of amateur games, school games, club games, professional games, and the user's own games, provided the record can be parsed and the position can be reconstructed. Do not require external player ratings, tournament metadata, or a famous-player identity.

For games with incomplete metadata, analyse the move sequence and retain the fields that are known. If a PGN lacks a player name or result, use an explicit unknown or unavailable representation rather than inventing information.

If the move sequence becomes illegal at a particular ply, report the position and move where parsing failed. Where the library supports partial recovery, offer to analyse the valid prefix without pretending the rest of the game was processed.

**Acceptance criteria:** Valid games are not excluded merely because their players are unknown, and malformed records receive precise, recoverable error messages.

## SECTION 108 — Implement analysis profiles

Provide practical analysis profiles such as Quick Review, Balanced Analysis, Deep Analysis, and Custom. Each profile must map to explicit engine settings and resource limits, not merely change a label or animation.

Quick Review should prioritise speed and an overview of the game. Balanced Analysis should provide a useful set of candidate moves and key moments. Deep Analysis may allocate more time and computation to selected positions, while Custom allows the user to control supported parameters.

Clearly communicate that analysis depth and quality depend on hardware, position complexity, and search budget. Do not promise a universally correct evaluation merely because a search reaches a specified depth.

**Acceptance criteria:** Each profile produces a measurable difference in engine configuration and resource consumption, and the active profile is recorded with the analysis where useful.

## SECTION 109 — Support whole-game analysis jobs

Provide a workflow for analysing an entire game rather than requiring the user to request each position manually. The job should process positions according to a configurable strategy, collect engine information, and identify candidate moments for review.

Use bounded resource allocation and allow the user to cancel the job. Persist completed portions so that an interrupted analysis can resume where appropriate. Clearly distinguish an analysis that has finished every requested position from one that stopped early.

Avoid blindly spending identical computation on every ply. The implementation may use a quick first pass followed by deeper searches on selected positions, but the selection method must be documented and must not conceal skipped positions.

**Acceptance criteria:** Whole-game analysis reports its scope, progress, completion status, and any positions that were skipped or analysed only superficially.

## SECTION 110 — Generate a useful analysis report

Produce a structured report containing the game result, key moments, significant tactical opportunities, important mistakes, engine-supported alternatives, and recommended study topics where evidence is available.

The report must distinguish engine findings from natural-language explanations. If the engine's evaluation changes substantially, explain the before-and-after position and show the relevant continuation when available. Do not assert that a move was a blunder solely because a natural-language model dislikes its appearance.

Allow users to reopen the report and navigate directly to the associated move. Support saving the report locally and exporting a suitable representation where implemented.

**Acceptance criteria:** Every reported key moment links to a real position and reproducible engine result, and users can move from the report to the relevant board state.

---

# PART XI — ENGINE EVALUATION, MOVE CLASSIFICATION AND GAME INSIGHT

## SECTION 111 — Define the evaluation perspective consistently

Choose and document a single internal convention for representing engine evaluations, including whether scores are stored from White's perspective or the side-to-move perspective. Convert values only at well-defined boundaries.

The interface must make it clear which side is favoured. If the evaluation bar uses White's perspective, the numerical display, variation comparison, graph, and report must follow the same convention. A perspective change must update all dependent displays together.

Handle centipawn scores and mate scores as separate types. Do not treat a mate score as a normal centipawn value or apply ordinary centipawn arithmetic to it without a defined conversion policy.

**Acceptance criteria:** Evaluation signs and displays remain consistent when changing sides, flipping the board, navigating moves, or comparing variations.

## SECTION 112 — Build an accurate evaluation bar

Display a vertical or horizontal evaluation bar that communicates the relative advantage indicated by the current engine result. Use a stable visual convention and a readable numerical score.

The bar must update only when a valid result arrives for the current position and analysis request. If a search is pending, the interface may retain the previous result only if it clearly identifies that result as belonging to an earlier search or position.

Provide a preference to hide the bar. The bar must not obscure the board or become the only way users can understand the numerical evaluation.

**Acceptance criteria:** The evaluation bar reflects the correct position and perspective and never presents a stale score as a new result.

## SECTION 113 — Display centipawn and mate evaluations

Format centipawn scores consistently, including a sign and an agreed precision. Format mate scores as mate information rather than converting them into a misleading large decimal.

If the engine reports a mate distance, communicate what that distance represents according to the engine's output convention. Avoid asserting that a displayed mate distance guarantees the same practical outcome when the underlying search is incomplete or the opponent has alternatives outside the displayed line.

When evaluations are unavailable, show an explicit unavailable state rather than zero, because zero suggests an evaluated equal position.

**Acceptance criteria:** Evaluation formatting is type-safe, understandable, and consistent throughout Chess World.

## SECTION 114 — Implement meaningful move classification

Provide move categories such as best move, excellent move, good move, inaccuracy, mistake, blunder, and missed opportunity where a defined classification system supports them.

Classification must be derived from documented engine-analysis rules, such as evaluation changes and tactical context. Thresholds should account for the difference between ordinary centipawn changes and mate-related results. The system must avoid presenting classification as an absolute truth independent of search depth.

Allow classification settings to be adjusted only through clearly defined options. If the analysis is too shallow or incomplete for a reliable category, use an uncertain or unclassified state rather than inventing precision.

**Acceptance criteria:** Move categories are reproducible from recorded engine data and documented classification rules.

## SECTION 115 — Compare the played move with engine alternatives

For each analysed move, identify the position before the move, the move actually played, the resulting position, and the relevant engine recommendation. Compare evaluations using a consistent perspective and account for the engine's search configuration.

The UI should show what the move changed and offer a way to explore the suggested alternative. If the best move is a sequence involving a forced tactical response, display enough of the principal variation to explain the idea.

Do not automatically claim that a move loses a certain amount of material unless the line demonstrates that result. Prefer evidence-based explanations such as a lost tactical opportunity, weakened king safety, or missed forced continuation when supported by the analysis.

**Acceptance criteria:** Move comparisons link to legal engine lines and provide a transparent explanation of how the recommendation was obtained.

## SECTION 116 — Detect candidate critical moments

Identify positions worth reviewing using evidence such as large evaluation changes, tactical swings, missed forced wins, important defensive decisions, or changes in the best candidate line.

Do not label every numerical fluctuation as a critical moment. Use configurable thresholds and consider whether the relevant search is sufficiently complete. Where the game is complex or the result uncertain, mark the moment for further analysis rather than claiming certainty.

Store the position identifier, move number, evaluation context, reason for selection, and the analysis configuration that produced the finding.

**Acceptance criteria:** Critical moments are navigable, traceable to their source data, and useful for prioritising human review.

## SECTION 117 — Analyse missed opportunities

Where engine evidence supports a stronger move than the one played, provide a missed-opportunity view. It should show the actual move, the alternative, the resulting positions, and the key continuation where available.

Differentiate a missed win from a missed tactic, an inferior positional choice, and an ordinary engine preference. Avoid describing a small positional difference as a forced win.

When the analysis is incomplete, state that the opportunity is provisional and allow a deeper search of the relevant position.

**Acceptance criteria:** Missed-opportunity reports reflect the actual engine result and do not overstate the certainty or significance of a recommendation.

## SECTION 118 — Analyse defensive mistakes

Detect positions in which the played move allows a significant improvement for the opponent or misses an important defensive resource. Use the engine's actual evaluation and candidate lines to establish the comparison.

Present the threat and the defensive idea in a way that helps the user understand the position. Do not assume that every attacked piece must move or that a visually natural defence is objectively best.

Provide a direct link to the original position and allow users to explore the defensive alternative on a separate variation.

**Acceptance criteria:** Defensive-mistake analysis identifies the relevant threat or alternative and preserves the original game line.

## SECTION 119 — Build an evaluation graph

Display evaluation changes across the game with a clear horizontal move axis and vertical evaluation axis. Use a representation that handles mate scores and large evaluation ranges without rendering ordinary position changes unreadable.

Each graph point must correspond to a known position and its associated analysis result. Selecting a point should navigate to that position and update the board, move list, and relevant analysis details together.

Allow users to distinguish incomplete analysis from completed results. If some positions have not been analysed, display gaps or another honest indicator rather than interpolating fabricated evaluations.

**Acceptance criteria:** Graph navigation is synchronised with the game, and displayed points originate from actual recorded analysis results.

## SECTION 120 — Create a post-game performance summary

Summarise the game using supported measurements such as analysed move classifications, major evaluation swings, tactical opportunities, and the themes identified in the review.

Do not reduce chess strength to one unexplained accuracy percentage. If an accuracy metric is implemented, define its formula, document its limitations, and distinguish it from an official rating.

Offer specific next steps based on observed errors, such as reviewing a particular tactical pattern or practising an endgame encountered in the game. Recommendations must be derived from recorded positions rather than generic filler.

**Acceptance criteria:** Performance summaries are reproducible, transparent, and linked to actual review material.

---

# PART XII — VARIATION EXPLORER

## SECTION 121 — Create a full variation-tree workspace

Variation Explorer must allow users to explore alternative moves from any valid position without altering the source game. Users should be able to branch from the main line, create further branches, navigate between them, and compare their resulting positions.

Represent the analysis as a tree of positions and moves, not as a flat collection of disconnected notation strings. Each node must retain the information necessary to reconstruct its board state and identify its parent.

The interface should show the current branch and its relationship to the main line. Keep branch navigation readable when a position has many candidate continuations.

**Acceptance criteria:** Users can create and traverse nested variations while the original game remains unchanged.

## SECTION 122 — Create a variation from any position

When the user selects a move or position, provide a clear action to begin a new variation. A legal move entered into the board should be added to the currently selected branch.

The application must identify the branch's parent position and preserve the original move sequence. If the user attempts an illegal move, reject it without changing the branch.

Provide an obvious way to return to the parent position and resume the main line. If the user starts typing from a historical position, do not silently append the move to the end of the game.

**Acceptance criteria:** Variation creation always starts from the intended position and produces a valid, navigable branch.

## SECTION 123 — Display candidate variations from Stockfish

Allow users to request multiple candidate lines from Stockfish where supported by the engine configuration. Display the available lines with their evaluations and search context.

Candidate lines must be tied to the exact position and request that generated them. If the user navigates elsewhere, do not continue presenting the previous position's candidates as if they apply to the new one.

Allow a candidate line to be opened in the variation tree. Importing a line must validate its moves and avoid duplicating an identical branch unnecessarily.

**Acceptance criteria:** Candidate lines are real engine results and can be explored without corrupting existing variations.

## SECTION 124 — Compare candidate moves

Provide a comparison view for selected candidate moves. Show the initial position, the candidate moves, the available evaluation information, and meaningful continuations for each alternative.

Ensure that scores are interpreted from the same perspective and are sufficiently comparable. When searches use different resource budgets, display that context so users understand the limitation.

The comparison should help users inspect strategic and tactical differences without declaring one move definitively superior when the evidence is incomplete.

**Acceptance criteria:** Candidate comparisons use consistent evaluation semantics and preserve the underlying search metadata.

## SECTION 125 — Promote a variation to the main line

Allow users to promote a selected branch when they intentionally want to adopt it as the primary line in a saved analysis or study. This operation must be distinct from simply viewing the branch.

Before changing a saved main line, preserve enough information to recover the previous version. Keep annotations attached to their correct positions and report any conflicts where metadata cannot be mapped safely.

For imported games, preserve the original source record or require an explicit save-as operation rather than silently overwriting it.

**Acceptance criteria:** Main-line promotion is deliberate, reversible where supported, and does not destroy the original imported game.

## SECTION 126 — Rename and organise variations

Allow descriptive labels for important branches, such as “King-side attack,” “Defensive resource,” or “Alternative endgame.” Labels must be optional and should not replace the actual move sequence.

Support useful sorting or organisation where a study contains many branches. Do not impose an artificial limit on the number of variations without a documented performance reason.

**Acceptance criteria:** Variation labels persist locally and remain associated with the correct branch after reopening the study.

## SECTION 127 — Annotate branches and positions

Allow notes on positions, individual moves, and branches. An annotation should be stored with a stable reference to the relevant node rather than a fragile move-list index alone.

Support basic formatting and clear separation between personal comments, engine-generated explanations, and imported PGN comments. Provide editing, deletion, and recovery behaviour consistent with ORBIS's existing data-handling conventions.

**Acceptance criteria:** Annotations remain correctly attached after navigation, branch edits, and supported import/export operations.

## SECTION 128 — Compare end positions

Allow users to compare the resulting positions of two selected variations. Display the relevant board states and associated evaluation information when available.

Comparison should include side to move and other relevant position state, not just the placement of pieces. Positions that look identical but differ in castling rights, en-passant availability, or move-history-dependent context must not be treated as fully equivalent without appropriate validation.

**Acceptance criteria:** Position comparisons account for supported chess-state information and make differences understandable.

## SECTION 129 — Export a study with variations

Provide export of saved studies in a suitable PGN representation where the format supports the stored variations and annotations. Preserve move ordering, branch relationships, and comments as accurately as the selected format permits.

If some application-specific metadata cannot be represented in PGN, retain it in a separate supported local format or explain what will be omitted. Do not claim lossless export if data will be discarded.

**Acceptance criteria:** Exported studies reopen with their supported variations and annotations intact, and any format limitations are disclosed.

## SECTION 130 — Maintain variation-tree integrity

Validate branch edits against the relevant parent position. Prevent circular references, orphaned nodes, and branches that contain illegal moves. Ensure deleting a branch does not accidentally delete a shared or independently referenced source game.

Implement appropriate integrity checks when loading saved studies. If corrupted branches are found, recover unaffected branches where safe and identify the damaged portion.

**Acceptance criteria:** Saved variation trees remain structurally valid through editing, persistence, export, and recovery.

---

# PART XIII — OPENING LAB

## SECTION 131 — Define the Opening Lab's scope

Opening Lab must help users learn, explore, compare, and practise chess openings. It should connect opening names and move sequences with actual board positions, available reference data, engine analysis, and personal repertoires.

The module must not depend on an invented opening database. Choose a lawful and technically suitable source or use an included dataset whose licence permits the intended distribution. Make the provenance of bundled or downloaded opening data clear.

Opening information should remain useful without an internet connection once the relevant data has been made available locally.

**Acceptance criteria:** Users can explore genuine opening lines and distinguish sourced opening statistics from engine recommendations.

## SECTION 132 — Identify opening positions and names

Implement opening recognition using a verified opening dataset or a maintained library with suitable coverage. Match the relevant move sequence or position against the selected source's identification rules.

An opening name should not be fabricated simply because a position resembles a familiar structure. If the dataset cannot identify the position confidently, show an unknown or broader classification.

Store the source and version of opening metadata where needed so results can be reproduced after database updates.

**Acceptance criteria:** Opening names and classifications are derived from a real, versioned source and gracefully handle positions outside its coverage.

## SECTION 133 — Build the opening explorer

Provide an interactive board alongside a list of available next moves, their move counts or statistics when available, and relevant opening information.

Selecting a move should update the board and explorer data together. Users should be able to move backward, follow a line, and inspect alternative continuations without losing the selected repertoire context.

If the selected database lacks a move or position, state that the data is unavailable. Do not display fabricated popularity percentages or imply complete coverage.

**Acceptance criteria:** Explorer results are tied to the displayed position and reflect the selected dataset's actual contents.

## SECTION 134 — Show opening statistics with provenance

When a dataset provides game counts, results, or move popularity, display those statistics with appropriate context. Identify whether the information comes from a local database, a permitted remote provider, or a particular imported collection.

Explain relevant limitations, such as sample size, date range, player population, and filtering where known. Do not mix statistics from incompatible datasets without explaining the difference.

**Acceptance criteria:** Every displayed opening statistic has an identifiable source and a clear interpretation.

## SECTION 135 — Integrate engine evaluation with opening data

Allow users to inspect Stockfish's evaluation of a selected opening position or continuation. Keep engine evaluation separate from empirical opening statistics.

A move may be popular in a database without being the engine's preferred move. The interface must make this distinction clear and avoid implying that popularity proves objective quality.

Provide a way to compare the reference move, popular alternatives, and engine recommendations where the required data exists.

**Acceptance criteria:** Opening statistics and engine evaluations are presented as different kinds of evidence and are not conflated.

## SECTION 136 — Build personal opening repertoires

Allow users to create separate repertoires for playing White and Black, organise lines, and save preferred responses. Repertoires must be local to the current ORBIS profile and must support editing without modifying a bundled reference database.

A repertoire line should contain its move sequence, relevant position references, optional annotations, and the user's intended response to an opponent's move. Where a repertoire branches, preserve the relationship between each response and its triggering position.

**Acceptance criteria:** Users can create, edit, save, and reopen personal repertoires independently of external opening data.

## SECTION 137 — Support repertoire import and export

Support importing and exporting repertoires through suitable chess formats, including PGN where appropriate. Validate all imported lines and provide a preview of the number of lines, metadata, and detected errors.

Allow the user to choose how imported content interacts with existing repertoires. Avoid silently replacing a repertoire with the same name or deleting existing lines because an import contains duplicates.

**Acceptance criteria:** Repertoire transfers preserve supported data and provide safe duplicate and conflict handling.

## SECTION 138 — Teach opening plans and ideas

Opening lessons should explain plans, typical piece placement, pawn structures, common tactical motifs, and strategic objectives rather than asking users to memorise long sequences without context.

Use verified example positions and provide interactive questions. Where an opening has several legitimate plans, present alternatives instead of treating one move order as universally mandatory.

Link explanations to the actual repertoire line or opening position that demonstrates the idea.

**Acceptance criteria:** Opening study includes practical, position-based learning and verified examples.

## SECTION 139 — Implement repertoire recall training

Provide a mode in which users reconstruct their selected opening lines from memory. Ask for the expected move at the current position and compare it against the saved repertoire.

Define how transpositions and equivalent lines are handled. When a user's move is outside the repertoire, distinguish between an unrecognised move and an objectively poor move; these are not the same thing.

Track recall performance and identify positions where the user repeatedly forgets the intended continuation.

**Acceptance criteria:** Recall exercises are generated from real repertoire data and report learning performance separately from engine evaluation.

## SECTION 140 — Detect and explain transpositions

Where the system supports transposition detection, identify when different move orders reach an equivalent chess position under the chosen comparison rules.

Do not rely on piece placement alone when castling rights, en-passant availability, side to move, or other relevant state differs. Explain the relationship between the two move orders and retain their separate repertoire paths when they serve different practical purposes.

**Acceptance criteria:** Transposition detection uses an appropriate position identity model and does not merge materially different positions.

---

# PART XIV — ENDGAME LAB

## SECTION 141 — Define Endgame Lab's training objectives

Endgame Lab must teach practical and theoretical endgames through interactive positions, guided examples, independent exercises, and engine-supported feedback.

Cover king-and-pawn endings, opposition, pawn promotion, rook endgames, minor-piece endings, queen endgames, mating techniques, defensive fortresses where supported, and other important endgame themes.

Organise content by prerequisite knowledge and practical difficulty. Do not label an ending as a forced win or draw without an adequate source or verified analysis.

**Acceptance criteria:** Users can study real endgame positions and practise specific techniques through validated exercises.

## SECTION 142 — Build an endgame position catalogue

Store endgame exercises with their positions, objective, permitted solution logic, difficulty, source provenance, and explanatory material.

Validate the position and ensure the objective is meaningful. If a position has multiple winning methods or drawing resources, account for those possibilities rather than accepting only one arbitrary line.

Provide filtering by material configuration, theme, side to move, and difficulty when the underlying data supports those categories.

**Acceptance criteria:** The catalogue contains valid, traceable positions with clearly defined objectives.

## SECTION 143 — Teach king-and-pawn endings

Create interactive exercises for opposition, key squares, triangulation where appropriate, the square of the pawn, outside passed pawns, and promotion races.

Show how king position, tempo, and move order affect the outcome. Use legal examples and explain when a rule of thumb does not apply because of the specific position.

Allow the user to attempt the solution before revealing guidance.

**Acceptance criteria:** Exercises correctly validate the relevant endgame concepts and provide position-specific explanations.

## SECTION 144 — Teach rook endgames

Provide lessons and exercises for important rook-endgame ideas, including active rooks, cutting off the king, checking from the side where appropriate, passed-pawn support, and established theoretical positions.

Use engine verification and suitable reference material to avoid teaching a simplified rule that fails in the example shown. Distinguish general principles from positions with a known theoretical result.

**Acceptance criteria:** Rook-endgame exercises use verified positions and explain the strategic or tactical reason behind the recommended play.

## SECTION 145 — Teach basic mating techniques

Include fundamental mating methods such as king and queen versus king, king and rook versus king, and other supported basic endings.

Provide guided move-by-move practice with legal-move validation. When a training method expects a specific technique, explain the objective and avoid marking a different valid mating route as incorrect unless the exercise explicitly requires a particular method.

**Acceptance criteria:** Users can practise basic mating techniques with accurate move validation and understandable feedback.

## SECTION 146 — Integrate tablebase support where feasible

Investigate suitable endgame tablebase integration for positions within supported material limits. Determine whether tablebases should be bundled, downloaded, or accessed through a permitted external service, taking account of storage size, licensing, performance, and availability.

Tablebase results must be used only when the position and relevant state are supported by the selected tablebase. Clearly distinguish a proven tablebase result from a heuristic engine evaluation.

**Acceptance criteria:** Tablebase conclusions are presented only for supported positions, and unavailable coverage does not produce invented certainty.

## SECTION 147 — Display theoretical results correctly

Where a tablebase or verified source supplies a result, show whether the position is won, drawn, or lost from the relevant perspective. Where available, display distance-related information using the source's actual convention.

Do not describe an ordinary Stockfish evaluation as a mathematically proven result. If tablebase coverage is missing, present the engine result and its limitations instead.

**Acceptance criteria:** The UI clearly distinguishes proven theoretical information from search-based engine estimates.

## SECTION 148 — Build practical endgame drills

Allow users to practise converting an advantage, defending a difficult ending, promoting a pawn, or holding a draw. Exercises should have a defined objective and termination condition.

Where the opponent is controlled by Stockfish, configure its role and search settings deliberately. Do not assume that a training opponent's mistakes prove the user's technique is correct; evaluate the resulting position and objective separately.

**Acceptance criteria:** Drills track objective completion, validate moves, and distinguish success from merely reaching the end of a game.

## SECTION 149 — Review endgame mistakes from user games

When analysing a saved game, identify relevant endgame positions and offer them as study exercises if the analysis supports a useful lesson.

Retain the original position and game reference. Allow the user to practise from that position independently of the original game and later compare the played continuation with the training result.

**Acceptance criteria:** Extracted endgame exercises remain linked to their source games and use valid positions.

## SECTION 150 — Connect Endgame Lab with personal study plans

Use the user's real performance in endgame exercises and analysed games to recommend relevant practice. Explain why the exercise is recommended and allow the user to save it to a study plan.

Avoid claiming that the user has a specific weakness based on insufficient evidence. Recommendations should be adjustable and must not overwrite the user's manually selected learning goals.

**Acceptance criteria:** Endgame recommendations are explainable, evidence-based, and stored within the correct local profile.

---

# PART XV — GAME LIBRARY AND PERSONAL CHESS ARCHIVE

## SECTION 151 — Build a complete local game library

Provide a central library for games played in ORBIS, imported PGNs, saved studies, and completed live broadcasts that can lawfully be retained.

The library must support browsing, sorting, filtering, searching, opening a game, and launching analysis. It should identify the source and status of each record and avoid presenting incomplete broadcast data as a complete game.

Use the existing ORBIS storage architecture where appropriate. Do not create a remote personal-game database as a shortcut for implementing search or backup.

**Acceptance criteria:** Users can manage their available chess records locally and open each supported record in the correct workflow.

## SECTION 152 — Define a robust game-record schema

Represent a saved game with a stable identifier, profile association, source type, player names where known, result where known, move sequence, starting position, timestamps, and supported metadata.

Keep optional fields genuinely optional. Store source-provided dates separately from local import or retrieval timestamps where necessary. Version the schema so future upgrades can add fields without breaking existing records.

Do not rely solely on a filename as the record's identity.

**Acceptance criteria:** Game records remain uniquely identifiable and readable after application updates and file renaming.

## SECTION 153 — Support library filtering and sorting

Provide filters for date, source, result, player, event, opening, and other metadata where available. Allow sorting by useful fields such as date, player, or most recently analysed.

When metadata is missing, make the record's unknown state clear and avoid silently assigning it to an incorrect category. Filters must be applied to actual stored data rather than a hardcoded sample list.

**Acceptance criteria:** Filtered results accurately reflect the local archive and behave predictably when metadata is incomplete.

## SECTION 154 — Implement local PGN import

Allow users to import PGN files through an explicit file-selection flow. Validate the selected file, parse its games, show an import preview, and report any errors.

For multi-game files, allow users to understand how many games were successfully parsed and how many failed. Preserve the original source file unless the user explicitly requests a separate file operation. Large imports must not block the interface.

**Acceptance criteria:** PGN import handles multiple games, reports failures precisely, and never silently discards valid records.

## SECTION 155 — Implement PGN export

Allow export of individual games and selected groups of games in PGN where their content can be represented by the format.

Include supported metadata, moves, comments, and variations. If the user exports an analysis containing additional application-specific data that PGN cannot preserve, explain the limitation and offer an appropriate complementary export when available.

Use safe file-writing practices and avoid overwriting existing files without an appropriate confirmation.

**Acceptance criteria:** Exported files contain the selected records and can be reopened by compatible chess software.

## SECTION 156 — Handle duplicate game imports

Detect likely duplicates using a documented comparison method that considers the move sequence, starting position, and available metadata. Identical move sequences may exist as separate intentional records, so do not merge solely because two records look similar without considering the import context.

Offer a clear duplicate policy, such as keeping both, skipping recognised duplicates, or reviewing possible matches. Preserve user annotations when resolving duplicates.

**Acceptance criteria:** Duplicate detection is transparent and cannot silently erase a user's annotated or intentionally separate record.

## SECTION 157 — Support game tagging and collections

Allow users to tag games and organise them into collections such as training games, tournament preparation, favourite classics, school practice, and endgame examples.

Tags and collections must remain local to the current profile and be searchable. A game may belong to multiple collections without requiring duplicate copies of its move history.

Provide rename, remove, and bulk-management operations with predictable behaviour.

**Acceptance criteria:** Collections organise existing records without creating inconsistent duplicate game data.

## SECTION 158 — Store analysis reports alongside games

Associate analysis reports with the source game and the analysis configuration that generated them. Users should be able to reopen an earlier report without assuming it represents the results of a newer search.

If a report is outdated because the engine version, settings, or analysed positions have changed, label it appropriately. Allow users to rerun analysis while preserving earlier results when practical.

**Acceptance criteria:** Reports retain their provenance and are not silently presented as current after their source conditions change.

## SECTION 159 — Preserve provenance and attribution

For imported and externally sourced games, retain available source information, retrieval timestamps, event identifiers, and attribution requirements.

Do not invent an original source URL or claim that an imported game came from a tournament provider when that relationship cannot be established. If provenance is unknown, record it as unknown.

Respect retention and redistribution restrictions associated with external data sources.

**Acceptance criteria:** Records preserve verifiable provenance and comply with applicable source requirements.

## SECTION 160 — Build backup and recovery for chess data

Integrate chess data with ORBIS's supported backup and profile-export mechanisms where possible. If Chess World requires a dedicated export format, document its contents and ensure it can be imported into a compatible profile.

Backups should preserve games, annotations, repertoires, saved positions, progress, and relevant settings. Validate imported backup files before applying them and provide a safe recovery path when a backup is incomplete.

**Acceptance criteria:** Users can recover supported chess data without depending on a cloud account, and invalid backups do not corrupt their existing library.

---

# PART XVI — PERSONAL CHESS COACH

## SECTION 161 — Define the Personal Chess Coach's responsibilities

The Personal Chess Coach should turn real game and training evidence into understandable study guidance. It may explain engine findings, identify recurring mistakes, recommend lessons, and create a practical training plan.

It must not replace Stockfish as the source of engine evaluations or claim to have analysed games it has not processed. Natural-language explanations must be grounded in the actual position, move history, and available analysis results.

The coach should adapt its language to the user's selected level, from simple explanations for beginners to detailed tactical and strategic discussion for advanced users.

**Acceptance criteria:** Coaching recommendations are traceable to real user records or explicitly labelled general educational guidance.

## SECTION 162 — Provide a contextual coach panel

Make coaching available from Analysis Studio, AI Arena, puzzles, opening study, and endgame training. The panel should understand which game or exercise the user is currently viewing and provide relevant actions.

When the user asks about a move, pass the correct position and necessary context to the explanation layer. Do not send an unrelated board position or stale engine line merely because it was the last one cached.

Users must be able to close or minimise the panel without losing their current work.

**Acceptance criteria:** Coach responses refer to the active context and do not interrupt normal board interaction.

## SECTION 163 — Explain moves in accessible language

Provide explanations that can describe a move's tactical purpose, strategic idea, threat, or defensive resource. Beginner mode should define unfamiliar terminology and explain the most important consequence first.

Advanced mode may discuss candidate moves, pawn structures, initiative, calculation, and positional trade-offs. Where a line depends on a precise tactical sequence, show the actual continuation instead of relying on vague language.

If the engine result does not establish a clear explanation, communicate uncertainty and offer deeper analysis.

**Acceptance criteria:** Explanations match the board and the selected difficulty level, with no unsupported tactical claims.

## SECTION 164 — Build an evidence-backed weakness profile

Track recurring patterns across analysed games and completed training sessions. Possible categories include missed tactics, king safety, opening recall, calculation errors, and endgame technique.

Each identified weakness must have supporting evidence, such as several relevant mistakes or repeated failures in a defined exercise category. Show the number and type of observations when useful.

Avoid presenting the profile as a psychological assessment or a precise estimate of overall playing strength. Allow users to inspect the evidence and dismiss recommendations they do not find useful.

**Acceptance criteria:** Weakness labels are derived from recorded evidence and can be explained to the user.

## SECTION 165 — Generate practical study plans

Allow users to choose a goal, such as improving tactics, learning a specific opening, preparing for an event, or strengthening endgames. Create a manageable plan based on available study material and the user's recorded performance.

Each recommendation should identify its purpose and expected activity, such as completing a lesson, solving a puzzle set, or analysing a selected position. Users must be able to edit the plan, reorder activities, and remove recommendations.

Do not claim guaranteed rating improvement or promise results unsupported by evidence.

**Acceptance criteria:** Study plans consist of real available activities and can be customised and resumed.

## SECTION 166 — Review progress over time

Display progress based on completed lessons, puzzle outcomes, analysis sessions, study consistency, and other recorded measurements. Make the measurement period clear and distinguish activity counts from demonstrated mastery.

Avoid comparing unrelated metrics as if they were equivalent. For example, completing more puzzles does not automatically mean a player has become stronger. Use trends cautiously and explain what the data can and cannot establish.

**Acceptance criteria:** Progress reports use real local records, clearly defined metrics, and consistent time ranges.

## SECTION 167 — Create game-specific coaching summaries

After a reviewed game, summarise a small number of meaningful lessons based on the actual mistakes and opportunities identified by the analysis pipeline.

Each lesson should link to the relevant position and provide a practical follow-up activity where possible. Avoid producing an overwhelming list of every small evaluation change.

Allow users to save useful lessons to their personal study collection.

**Acceptance criteria:** Game-specific summaries are grounded in the reviewed game and link directly to relevant study material.

## SECTION 168 — Offer adjustable coaching tone and detail

Provide controls for explanation depth and tone, including concise, beginner-friendly, analytical, and coach-like styles. If humorous commentary is supported, make it optional and avoid insulting the user.

Tone settings must not alter the underlying chess facts. The coach should remain honest about engine uncertainty, missing source data, and the limitations of a quick search.

**Acceptance criteria:** Presentation settings change the style of explanations without changing their factual basis.

## SECTION 169 — Protect personal study information

Keep private games, annotations, and learning history local by default. If an optional external AI provider is used for natural-language explanations, clearly disclose what position or personal data is transmitted.

Do not upload a complete archive merely to explain one move. Send the minimum context required for the requested operation and provide a local or non-networked fallback where feasible.

**Acceptance criteria:** Coaching respects ORBIS's local-first architecture and does not silently transmit personal chess records.

## SECTION 170 — Handle unavailable coaching capabilities

If an optional language model is unavailable, users should still be able to access board data, engine evaluations, legal variations, and other non-generative functionality.

Show an explicit status when a natural-language explanation cannot be produced. Do not substitute fabricated text or make it appear that an AI analysis occurred.

**Acceptance criteria:** Coach outages affect only dependent capabilities and never invalidate the underlying chess session or engine results.

---

# PART XVII — CHALLENGES, GOALS AND PROGRESS

## SECTION 171 — Build a configurable challenge system

Provide challenges that encourage users to practise specific chess skills, complete lessons, solve puzzles, analyse games, or study a repertoire.

Every challenge must have a precise completion rule and refer to an activity the application actually supports. Avoid vague tasks such as “become a better player” unless they are translated into measurable activities.

Users should be able to inspect challenge progress and understand what remains to be completed.

**Acceptance criteria:** Challenges have valid objectives, accurate progress tracking, and meaningful completion feedback.

## SECTION 172 — Implement daily and weekly goals

Allow users to set goals such as solving a chosen number of puzzles, studying for a defined duration, or completing a lesson. Support daily and weekly periods with consistent date-boundary rules.

Do not count an abandoned or failed activity as completed unless the goal explicitly measures participation rather than success. Make it clear whether time spent with a paused screen counts toward study duration.

**Acceptance criteria:** Goal progress is calculated from real events and follows documented time-period rules.

## SECTION 173 — Add achievement tracking

Create achievements for meaningful milestones, such as completing a learning module, solving a set of puzzles, finishing a repertoire review, or analysing a first game.

Achievement requirements must be explicit and verifiable. Avoid awarding achievements from test fixtures or unverified activity. Provide a history of unlocked achievements and ensure they remain associated with the correct local profile.

**Acceptance criteria:** Achievements unlock only when their defined conditions are satisfied.

## SECTION 174 — Implement optional experience points

If an experience-point system is included, award points for defined learning activities and display how each award was calculated. Avoid awarding excessive points for repetitive actions that do not represent meaningful progress.

XP must not affect chess legality, engine strength, or objective evaluation. Users should be able to understand whether the points measure activity, learning consistency, or another explicitly defined metric.

**Acceptance criteria:** XP awards follow transparent rules and persist correctly without being confused with chess skill ratings.

## SECTION 175 — Track study consistency

Provide an optional study calendar or equivalent view showing completed learning activities over time. Distinguish days with meaningful study from days on which the application was merely open.

Let users configure reminders and avoid shaming language when they miss a day. Streaks should follow clearly documented rules and should not be manipulated by repeatedly reopening the same completed activity.

**Acceptance criteria:** Study-consistency information is accurate, optional, and based on recorded activities.

## SECTION 176 — Support personal milestones

Allow users to define milestones, such as completing an opening repertoire, finishing a lesson sequence, or reviewing a selected set of games.

Milestones should link to the relevant local content and update when that content is completed. If the underlying material is deleted or becomes unavailable, handle the milestone without silently marking it complete.

**Acceptance criteria:** Personal milestones remain connected to real activities and update predictably.

## SECTION 177 — Provide challenge recommendations

Recommend challenges based on the user's goals and recorded activity. Explain why each challenge is relevant, such as reinforcing a tactical theme repeatedly missed in recent games.

Do not recommend unavailable content or claim that a user needs a lesson without supporting evidence. Provide a way to dismiss or adjust recommendations.

**Acceptance criteria:** Recommendations are actionable, grounded in available data, and configurable.

## SECTION 178 — Make progress metrics interpretable

Every progress chart must identify what is measured, the relevant time range, and the source of its values. Distinguish counts, success rates, completion rates, and engine-derived measurements.

Avoid charts that imply causal relationships from simple correlations. If a metric is based on incomplete records, indicate the limitation.

**Acceptance criteria:** Users can interpret every displayed metric without needing to guess what it represents.

## SECTION 179 — Support progress export

Where practical, allow users to export progress summaries and study plans in a suitable local file format. Include enough context for the exported values to be meaningful outside the application.

Do not include private game data in a summary export unless it is required by the user's explicit selection. Validate file-writing operations and respect profile boundaries.

**Acceptance criteria:** Exported progress records accurately represent the selected data and disclose any omitted fields.

## SECTION 180 — Keep gamification optional

Provide a way to reduce or disable XP displays, streaks, achievement notifications, and other motivational features without disabling chess functionality.

Do not use manipulative notifications or make users feel compelled to maintain a streak. Core learning, analysis, and play must remain available regardless of whether gamification is enabled.

**Acceptance criteria:** Disabling gamification removes its optional interface elements without breaking lessons, puzzles, or progress records.

---

# PART XVIII — POSITION SEARCH, REFERENCE DATA AND RESEARCH TOOLS

## SECTION 181 — Implement position-based searching where feasible

Allow users to find matching positions within their local archive when a suitable indexing method is available. Search must consider the relevant chess-state information and should distinguish exact position matching from looser structural similarity.

For large libraries, use an index or background process rather than reparsing every PGN on every keystroke. Make search progress visible when an operation is expensive.

**Acceptance criteria:** Position search returns records matching the selected search mode and does not freeze the interface for large archives.

## SECTION 182 — Define exact and structural position matching

Exact matching should account for the state required by the chosen definition, including side to move and relevant castling and en-passant rights. Structural matching may intentionally ignore some state, but its rules must be documented.

Do not describe structurally similar positions as identical when their legal moves or tactical outcomes differ. Present the match type in the search interface.

**Acceptance criteria:** Results identify whether a match is exact or structural and follow a tested comparison policy.

## SECTION 183 — Build a local reference-data manager

Provide a service for managing optional local opening datasets, game collections, tablebases, and other supported chess reference material.

The manager should record source, version, storage location, licence information where relevant, and installation status. It must not assume that a file exists simply because a preference points to its path.

**Acceptance criteria:** Reference datasets can be inspected, validated, updated where supported, and safely removed without damaging unrelated profile data.

## SECTION 184 — Handle large datasets efficiently

Do not load an entire large opening database or game archive into the UI process if a queryable or indexed representation is more suitable.

Use incremental loading, pagination, database indexes, or background workers as appropriate to the repository's architecture. Provide cancellation and progress feedback for expensive imports or indexing jobs.

**Acceptance criteria:** Large datasets remain usable without excessive memory use or blocking normal board interactions.

## SECTION 185 — Show reference-data availability clearly

When a feature depends on optional data, identify whether that data is installed, incomplete, outdated, or unavailable. Explain what functionality remains available without it.

Do not silently switch to an unrelated source or present sample records as the user's installed database. Offer installation or configuration guidance when supported.

**Acceptance criteria:** The user can distinguish missing optional data from a broken application feature.

## SECTION 186 — Implement source-aware data updates

When updating reference datasets, validate the downloaded or imported data before replacing a working version. Preserve the old version until the new version has passed appropriate integrity checks.

Handle interrupted updates and storage exhaustion safely. Record the version and retrieval date so that users can understand which data informed a result.

**Acceptance criteria:** Failed updates leave a usable previous dataset whenever possible and never silently corrupt the reference-data installation.

## SECTION 187 — Respect data and database licences

Review the terms governing opening collections, game databases, tablebases, and other reference material before including or distributing them.

Maintain required notices and attribution. Do not assume that individual chess moves, database packaging, associated annotations, and software code all share the same licensing status.

**Acceptance criteria:** Each distributed dataset has documented provenance and a reviewed licence compatible with its intended use.

## SECTION 188 — Integrate reference data with analysis

Where supported, allow users to compare a position with opening reference information, historical games, or tablebase results alongside Stockfish analysis.

Label each source clearly and avoid merging unrelated evidence into one unexplained score. Historical popularity is not proof of objective correctness, and engine evaluations are not substitutes for verified tablebase results.

**Acceptance criteria:** Combined views preserve the distinction between empirical data, engine estimates, and proven theoretical information.

## SECTION 189 — Provide source-specific failure handling

If a remote database is unavailable, retain access to installed local data and show which online results could not be retrieved. If a local dataset is corrupted, isolate the failure and provide a recovery path.

Do not treat a timeout as evidence that a position has no matching games. Distinguish a valid empty result from an unsuccessful query.

**Acceptance criteria:** Search and reference tools report the difference between no results, incomplete results, and failed retrieval.

## SECTION 190 — Create reference-data diagnostics

Provide diagnostics that identify the installed dataset versions, available storage, index status, and recent update failures. Keep the display understandable to ordinary users while making enough detail available for troubleshooting.

Do not expose credentials or sensitive local paths unnecessarily. Diagnostics must not require uploading personal game data.

**Acceptance criteria:** Users can diagnose common reference-data problems locally and safely.

---

# PART XIX — DATA INTEGRITY, SECURITY AND PRIVACY

## SECTION 191 — Validate all imported chess data

Treat imported PGNs, FEN positions, database files, and externally supplied game events as untrusted input. Validate formats, enforce reasonable size limits, and handle malformed content without crashing.

Do not execute code contained in a file or treat external metadata as trusted application configuration. For large files, use streaming or bounded parsing where appropriate to reduce memory-exhaustion risks.

**Acceptance criteria:** Malformed and oversized inputs are rejected or handled safely without compromising the application.

## SECTION 192 — Protect local file operations

Use ORBIS's established filesystem abstraction or secure file-handling mechanism. Validate selected paths and avoid constructing paths by blindly concatenating untrusted filenames.

When exporting or importing files, handle permission errors, nonexistent directories, symbolic-link considerations where relevant, and overwriting safely. Do not allow a chess file to overwrite application executables or unrelated data because its filename contains traversal sequences.

**Acceptance criteria:** File operations remain within their intended scope and handle common filesystem failures safely.

## SECTION 193 — Isolate engine processes appropriately

Launch Stockfish through the application's controlled process manager and pass validated arguments. Avoid constructing shell commands from user-controlled strings.

Restrict engine configuration to supported options and handle engine output as data rather than executable instructions. Ensure process termination and resource limits follow the desktop platform's supported mechanisms.

**Acceptance criteria:** Engine execution is controlled, validated, and protected against accidental command injection or abandoned processes.

## SECTION 194 — Protect secrets and provider credentials

If an optional provider requires credentials, use the project's established secure configuration mechanism. Never embed private service-role keys or administrative secrets in the client bundle.

Public API credentials should be treated according to the provider's security model and must not be confused with secret credentials. Avoid logging access tokens or including them in exported game records.

**Acceptance criteria:** Credentials are stored and transmitted according to their intended security classification, with no private administrative secrets exposed to the UI.

## SECTION 195 — Maintain local profile boundaries

Every read and write of private chess data must resolve through the correct ORBIS profile context. Do not trust a client-supplied profile identifier without verifying it against the active application's profile-management rules.

On profile switching, cancel or safely complete operations that belong to the previous profile. Ensure delayed background results cannot be written into the newly active profile accidentally.

**Acceptance criteria:** Profile-switching tests show no cross-profile leakage or misdirected persistence.

## SECTION 196 — Avoid unnecessary data transmission

Public game retrieval should send only the requests required to obtain the selected provider's data. Local analysis must remain local unless the user explicitly chooses a remote capability.

Do not upload game archives, analysis histories, or personal annotations for telemetry. If optional diagnostics are introduced in the future, make the data collection transparent and controllable.

**Acceptance criteria:** Network requests are limited to defined capabilities, and private chess data is not transmitted unexpectedly.

## SECTION 197 — Provide transparent storage management

Show users where Chess World stores its local data through an appropriate settings or storage-information interface. Explain the categories of stored content and provide safe controls for clearing selected caches or removing selected records.

Distinguish disposable provider caches from valuable saved games, studies, and annotations. Clearing a cache must not delete the user's archive unless the user explicitly selects that action.

**Acceptance criteria:** Users can understand and manage chess storage without accidentally deleting valuable records.

## SECTION 198 — Recover from interrupted writes

Use atomic writes, transactions, or the existing ORBIS persistence guarantees where appropriate. A partially written game or settings record must not replace a valid previous version.

For multi-record operations such as bulk import, define whether successful records are committed incrementally or as a transaction. Communicate partial success and retain enough information to recover or retry safely.

**Acceptance criteria:** Simulated interruption and storage failures do not leave the entire chess library unusable.

## SECTION 199 — Preserve data during upgrades

Version stored schemas and provide tested migrations for games, studies, repertoires, puzzle progress, and preferences. Do not delete old records merely because a newer feature uses additional fields.

Before destructive migrations, preserve a recoverable representation when practical. If migration fails, report the problem and retain the original data rather than repeatedly applying an unsafe migration.

**Acceptance criteria:** Upgrade tests demonstrate that existing chess records remain readable and that failed migrations can be recovered.

## SECTION 200 — Establish the second milestone acceptance gate

Before proceeding to the next major implementation stage, verify that Analysis Studio, Variation Explorer, Opening Lab, Endgame Lab, the local game library, and the Personal Chess Coach can operate on genuine supported chess data.

Test a saved Stockfish game, an imported PGN, a valid FEN position, a nested variation tree, a local repertoire, an endgame exercise, and a completed live-game record when a supported source provides one. Verify that annotations persist, evaluations correspond to the correct positions, exports are valid, and profile data remains isolated.

Run tests for malformed input, engine failure, interrupted writes, missing reference data, and provider unavailability. Record any deferred features explicitly. Do not claim the milestone is complete if critical data integrity or chess-correctness tests are failing.

**Acceptance criteria:** The second milestone demonstrates working analysis, variation handling, opening and endgame study, local archiving, evidence-backed coaching, reliable persistence, and safe error handling without breaking existing ORBIS functionality.

---

# END OF PART 2 — SECTIONS 101–200

## CONTINUATION RULES

The next document must begin at **SECTION 201** and continue sequentially. Do not renumber or replace earlier sections.

The next part should expand the remaining product areas, including advanced training modes, calculation and blindfold practice, famous-game study, custom chess environments, optional 3D presentation, accessibility, settings, keyboard shortcuts, search integration, performance engineering, automated testing, packaging, and release readiness.

All previously established constraints remain active:

* ORBIS Chess World is an integrated feature inside the existing ORBIS desktop application.
* Existing ORBIS and Orion behaviour, layout, and shortcuts must not be broken or unnecessarily redesigned.
* Stockfish runs locally as the primary chess engine.
* Live-game data must come from genuine supported providers and update promptly through their documented streaming or refresh mechanisms.
* Local-first storage remains the default for personal chess data.
* Online multiplayer is deferred.
* Engine evaluations, puzzles, game records, and live updates must not be fabricated.
* Optional external services must respect privacy, provider terms, and licensing.
* Every claimed implementation must be backed by functioning code and meaningful tests.

# ORBIS CHESS WORLD

## MASTER BUILD SPECIFICATION

### PART 3 — SECTIONS 201–300

### Advanced Training Systems, Calculation Gym, Blindfold Chess, Famous Games, Custom Positions, Chess Variants, Optional 3D Universe, Accessibility, Personalisation, Search Integration, Notifications, and Cross-Module Workflows

---

# PART XX — ADVANCED TRAINING SYSTEM ARCHITECTURE

## SECTION 201 — Establish a unified training engine

Implement a shared training infrastructure that powers tactical exercises, calculation training, blindfold practice, opening recall, endgame drills, strategic exercises, and future training modules. Do not build each training mode as an isolated feature with its own incompatible progress system, timer implementation, move validator, and persistence logic.

The shared infrastructure must define how a training activity is identified, loaded, started, paused, resumed, completed, abandoned, scored, and saved. Each training mode may provide its own presentation and validation rules, but it must use consistent lifecycle contracts.

Define a training-session model containing, at minimum:

* A stable session identifier.
* The active ORBIS profile identifier.
* The training mode and exercise identifier.
* The exercise's source and provenance where applicable.
* The starting position and relevant chess-state information.
* The current position and accepted move history.
* The objective and success conditions.
* The session's start, pause, resume, and completion timestamps.
* The number of attempts and relevant hints.
* The validation outcome.
* The completion status.
* The associated engine-analysis or reference-data identifiers when applicable.
* The final performance summary.
* The persistence status.

The system must distinguish between an exercise definition and an individual attempt. Attempting the same puzzle repeatedly must not overwrite its source definition or erase earlier attempts.

**Acceptance criteria:** All implemented training modes use the shared session infrastructure, while retaining mode-specific rules, scoring, and presentation.

## SECTION 202 — Define a formal exercise contract

Every exercise must provide a machine-readable definition of what the user is expected to accomplish. The definition should identify the starting position, side to move, objective, allowed moves or solution constraints, completion condition, failure condition, and any supported hints.

Where an exercise requires a particular sequence, define the expected continuation and the permitted alternatives. Where multiple moves achieve the objective, the validator must recognise valid alternatives instead of relying on one hardcoded move string.

For engine-generated exercises, record the engine configuration and validation evidence. For curated exercises, record the source and verification status. Do not allow a language model's unsupported description to serve as the only evidence that an exercise is correct.

Reject malformed exercise definitions before they enter the active training queue.

**Acceptance criteria:** Every exercise can be loaded, validated, scored, and completed according to explicit rules rather than ad hoc UI conditions.

## SECTION 203 — Separate move legality from exercise correctness

A legal chess move is not automatically a correct training answer. The move-validation layer must first determine whether the move is legal under the chess rules. The exercise evaluator must then determine whether the legal move satisfies the exercise objective.

For example, an exercise may require finding a forced mate, saving a drawn position, winning material, or reaching a designated endgame. A legal move that fails to achieve the objective should receive appropriate feedback without being incorrectly described as illegal.

Conversely, a move that matches an expected solution string must still be checked against the actual position before it is accepted.

**Acceptance criteria:** Every training answer passes both the chess-legality check and the applicable objective-validation rules.

## SECTION 204 — Support multiple correct solutions

Training exercises must be able to define multiple acceptable solutions where the position permits them. The system should support equivalent move orders, transpositions, alternative tactical solutions, and different defensive resources when they achieve the required objective.

Do not assume that every puzzle has exactly one correct first move. When the exercise has several valid answers, feedback should recognise them consistently.

Where the exercise intentionally teaches a specific technique, distinguish the instructional objective from the broader chess objective. Make that restriction clear in the exercise instructions.

**Acceptance criteria:** Alternative valid solutions are accepted when permitted by the exercise definition, and any deliberately restricted solution set is explicit.

## SECTION 205 — Implement the training lifecycle state machine

Use an explicit state machine rather than scattered Boolean flags to control training sessions.

Define states such as:

* Ready.
* Loading.
* Active.
* Paused.
* Validating.
* Awaiting opponent response.
* Awaiting feedback.
* Completed.
* Failed.
* Abandoned.
* Interrupted.
* Recoverable error.

Specify permitted transitions and prevent invalid transitions. For example, a completed session must not resume as if it were still active, and a paused timer must not continue accumulating active time.

The interface must reflect the current state. Background engine results or delayed callbacks must not move a session into the wrong state after the user has switched exercises.

**Acceptance criteria:** Automated state-transition tests cover normal completion, pausing, abandonment, interruption, and recovery from errors.

## SECTION 206 — Build an adaptive exercise queue

Allow users to create training sessions from multiple exercise categories. A queue may contain puzzles, opening recall, calculation drills, endgame exercises, and other compatible modes.

The queue manager must identify each exercise's required capabilities and avoid loading an activity that the current session cannot support. When switching modes, preserve the previous attempt and correctly initialise the new one.

Support manual queues and optional automatically generated queues. The automatic queue must be built from real available content and the user's selected filters.

**Acceptance criteria:** Mixed training queues progress reliably between compatible exercises without losing session state or loading fabricated entries.

## SECTION 207 — Implement difficulty normalisation

Different exercise sources may use different rating scales. Do not treat their numerical ratings as directly comparable without a defined conversion method.

Store source-native difficulty separately from any ORBIS-normalised estimate. Record the method used for normalisation and avoid presenting an estimated difficulty as an official rating.

Where reliable conversion is impossible, group exercises into broad difficulty bands using documented rules.

**Acceptance criteria:** Difficulty filtering is consistent within a source and transparent when comparing exercises from different sources.

## SECTION 208 — Provide controlled training hints

Design a hint system that can reveal information progressively without immediately exposing the complete solution.

Depending on the exercise, hint levels may include identifying the relevant tactical theme, pointing to a target square, highlighting candidate pieces, revealing a forcing move, or displaying a continuation.

Hints must be generated from verified exercise data, actual engine output, or a reliable rule-based explanation. Do not invent a tactical motif simply to fill a hint level.

Record hint usage separately from correctness so users can distinguish independent solutions from assisted solutions.

**Acceptance criteria:** Hints are relevant to the active exercise, progressively informative, and traceable to valid solution evidence.

## SECTION 209 — Provide training feedback after every attempt

Feedback should identify what happened, why the answer was accepted or rejected, and what the user can do next.

For a correct answer, explain the tactical or strategic idea when reliable evidence exists. For an incorrect answer, show the resulting position and offer an appropriate retry, hint, or solution-review option.

Avoid humiliating language, misleading certainty, or arbitrary penalties. Do not mark a failed attempt as successful because the user reached a visually similar position.

**Acceptance criteria:** Every completed attempt produces feedback consistent with its actual validation result.

## SECTION 210 — Preserve interrupted training sessions

If ORBIS closes unexpectedly, a profile is switched, or a training module encounters an error, preserve recoverable session information where appropriate.

On reopening, explain whether the session can resume exactly, resume from the last checkpoint, or must restart. Do not fabricate elapsed time or count unrecorded moves as completed.

For timed challenges, preserve the authoritative elapsed-time state and apply a documented policy for time spent while the application was closed.

**Acceptance criteria:** Interrupted sessions recover predictably, and saved progress accurately reflects the last confirmed state.

---

# PART XXI — CALCULATION GYM

## SECTION 211 — Establish Calculation Gym as a dedicated training environment

Create Calculation Gym as a specialised environment for developing the ability to calculate variations before moving pieces on the board.

The central rule is that the user must be able to explore a line mentally or through the permitted calculation interface before committing an answer. Do not turn every exercise into an ordinary tactical puzzle where the user simply tries moves until the application reveals the solution.

Provide several training formats, including forcing-line calculation, candidate-move comparison, defensive calculation, quiet-move discovery, and evaluation of resulting positions.

The system must clearly communicate which aids are permitted in each mode. Some exercises may allow a written variation tree, while strict mental-calculation challenges may prohibit moving pieces or viewing engine recommendations until submission.

**Acceptance criteria:** Calculation Gym offers genuine calculation-oriented exercises with distinct, enforceable rules.

## SECTION 212 — Build a candidate-move identification stage

Before calculating a position, optionally ask the user to identify plausible candidate moves. The interface may support selecting pieces, marking destination squares, or entering moves through a controlled notation field.

Candidate selection must use legal-move validation. If the user identifies several candidates, store the selection separately from the final chosen line.

The system should evaluate candidate quality according to the exercise objective and available verified analysis. It must not reject a reasonable candidate merely because it is absent from an incomplete engine principal-variation list.

**Acceptance criteria:** Candidate selection is recorded independently, and evaluation uses explicit criteria rather than a single hardcoded list.

## SECTION 213 — Implement multi-ply calculation exercises

A calculation exercise should allow the user to enter a line containing several alternating moves. The application must validate each move against the position resulting from the previous move.

When the exercise specifies an opponent response, the response may be determined by a verified solution line, a selected defensive branch, or a defined engine-backed response policy.

The user must be able to inspect the line before submission without accidentally changing the source position. Provide a clear way to revise a move or return to the start of the calculation.

**Acceptance criteria:** Multi-ply lines are legally validated, correctly replayed, and preserved separately from the source game.

## SECTION 214 — Distinguish forced and practical variations

Not every position has one forced continuation. Calculation Gym must distinguish forced tactical sequences from positions with several playable alternatives.

For forced sequences, the exercise may require the user to find the relevant line within documented acceptance rules. For practical positions, evaluate the selected move and resulting plan against the stated objective.

Do not describe an engine's first-choice line as the only legal or strategically acceptable continuation unless the evidence supports that claim.

**Acceptance criteria:** Exercise instructions and grading accurately reflect whether a position has a forced solution or multiple acceptable approaches.

## SECTION 215 — Add a hidden-board calculation mode

Provide an optional mode that hides the board after the initial position has been studied. The user must then calculate using the displayed exercise rules and any permitted notation or mental aids.

Offer configurable preparation time and a controlled way to reveal the board after submission. Do not reveal the hidden position through tooltips, accessibility labels that violate the mode, or automatically displayed variation previews.

Accessibility alternatives should remain available where necessary, but must be clearly separated from strict-mode scoring.

**Acceptance criteria:** Hidden-board mode genuinely restricts visual access to the position while preserving the user's ability to submit and review an answer.

## SECTION 216 — Implement line reconstruction

After the user finishes calculating, allow them to reconstruct the line on a board or in notation.

Validate the reconstructed line and compare it with the accepted solution set. Where equivalent continuations exist, recognise them if they satisfy the exercise's objective.

If the user recalls the correct idea but makes a notation error, distinguish input-format errors from incorrect chess calculation.

**Acceptance criteria:** Reconstruction results reflect actual move sequences and separate notation mistakes from chess mistakes.

## SECTION 217 — Measure calculation performance responsibly

Track useful measurements such as line length completed, candidate selection quality, tactical accuracy, use of hints, and time spent.

Do not treat longer lines as automatically better. A short forced sequence may be more demanding than a longer obvious continuation. Do not claim to measure a user's precise visualisation ability from a small number of exercises.

Present performance as descriptive training evidence, not a clinical or psychometric assessment.

**Acceptance criteria:** Calculation reports use defined metrics and clearly state their limitations.

## SECTION 218 — Generate calculation exercises from verified games

Allow users to create exercises from positions in their own saved games or imported games. The generation pipeline must identify a relevant position, validate its move sequence, and establish a reliable exercise objective.

If Stockfish is used to select candidate solutions, record the engine version, settings, and verification status. The pipeline must account for multiple acceptable continuations and avoid treating an incomplete search as definitive.

Generated exercises should remain editable and traceable to their source game.

**Acceptance criteria:** Game-derived calculation exercises use valid positions and verifiable solution criteria.

## SECTION 219 — Add calculation review and comparison

After submission, display the user's line alongside one or more verified alternatives. Highlight meaningful differences in move choice, tactical consequences, and resulting evaluation.

Do not penalise the user solely because the chosen line differs from the displayed principal variation. Apply the exercise's actual acceptance criteria and disclose uncertainty when the search is incomplete.

Allow the user to save useful positions to a personal study collection.

**Acceptance criteria:** Review explains the difference between the submitted line and supported alternatives without overstating engine certainty.

## SECTION 220 — Integrate Calculation Gym with the training system

Register Calculation Gym through the shared training lifecycle and progress infrastructure defined in Sections 201–210.

Persist session history, settings, exercise references, and recoverable attempts. Ensure that the calculation mode's stricter interaction rules remain active when sessions are resumed.

Allow the Personal Chess Coach to recommend calculation exercises based on real evidence from analysed games and prior attempts.

**Acceptance criteria:** Calculation Gym uses shared storage and progress tracking while maintaining its unique calculation rules.

---

# PART XXII — BLINDFOLD CHESS AND VISUALISATION

## SECTION 221 — Define blindfold training modes

Provide blindfold training that develops the ability to maintain a mental representation of a chess position without continuously viewing the board.

Support progressive levels, such as:

1. Remembering piece locations.
2. Identifying legal moves from a named square.
3. Tracking one or more moves.
4. Reconstructing a position after a short sequence.
5. Playing a complete game with the board hidden.
6. Solving tactical exercises without a visible board.

Each level must have explicit interaction rules and measurable objectives. Do not label a mode as blindfold if the full board remains visible throughout the challenge.

**Acceptance criteria:** Every blindfold mode enforces its stated visibility rules and uses a defined evaluation method.

## SECTION 222 — Build a board-memory exercise

Display a valid chess position for a configurable duration and then hide the board. Ask the user to reconstruct specified information, such as the piece on a square, the number of pieces of a colour, or the location of a selected piece.

Generate questions from the actual starting position. Ensure that every question has a known answer and that the question-generation logic does not produce contradictory conditions.

Allow users to configure exposure duration and difficulty without presenting the setting as a standardised measure of memory ability.

**Acceptance criteria:** Questions are generated from verified board state and scored against the correct answers.

## SECTION 223 — Implement square-and-piece tracking

Create exercises in which users track the movement of a selected piece or several pieces through a move sequence. The application must validate the sequence and derive the final positions from the real chess state.

If a piece is captured, the exercise must account for its removal. If a promotion occurs, the resulting piece type must be handled correctly.

Do not assume that a piece remains on the board simply because its original square is still stored in the exercise metadata.

**Acceptance criteria:** Tracking answers remain correct across captures, promotions, and other legal state changes.

## SECTION 224 — Support spoken square input where available

Where ORBIS's existing voice facilities support it, allow users to answer using square names or move notation. Keep typed input available as a reliable fallback.

Voice recognition must normalise common spoken forms while avoiding ambiguous interpretations. If an answer could refer to multiple squares or moves, ask the user to clarify rather than silently choosing one.

Do not assume that the voice service is always available or send audio to an external service without the applicable disclosure and permission.

**Acceptance criteria:** Voice input is optional, validated, and functionally equivalent to the corresponding supported typed input.

## SECTION 225 — Implement a full blindfold-game mode

Allow users to play against local Stockfish while the board is hidden, with configurable options for move entry and position announcements.

The move-entry interface must validate the intended move against the current position. When notation is ambiguous, require clarification. Do not apply a move based solely on a guess.

Provide a controlled way to reveal the board temporarily if the selected mode permits it. Record such assistance separately from unassisted play.

**Acceptance criteria:** Blindfold games use the same authoritative chess state and legal-move validation as normal games.

## SECTION 226 — Create progressive visualisation difficulty

Introduce difficulty progression through meaningful changes, such as longer move sequences, reduced initial viewing time, more complex positions, or multiple tracked pieces.

Avoid changing several difficulty dimensions unpredictably at once. Show the user which parameters changed and allow manual adjustment.

Use recorded performance to recommend a suitable level, but let users override the recommendation.

**Acceptance criteria:** Difficulty changes are explainable, reproducible, and based on actual exercise parameters.

## SECTION 227 — Validate visualisation exercises against a reference position

Store the reference position or sequence used by each exercise. When the user reconstructs a board, compare the result against the reference according to the exercise's defined scoring policy.

For exact reconstruction, validate all relevant piece placements and state. For partial exercises, grade only the requested information.

Do not mark a partially correct reconstruction as entirely correct unless the exercise explicitly uses that completion rule.

**Acceptance criteria:** Visualisation scores correspond to the actual exercise objective and reference state.

## SECTION 228 — Provide visualisation feedback

Show the correct board after submission and explain which squares or pieces were remembered incorrectly. In sequence-tracking exercises, reveal the move sequence and identify where the user's reconstructed state diverged.

Allow users to retry or review without overwriting the original attempt record.

**Acceptance criteria:** Feedback identifies the actual discrepancy and supports learning from the attempt.

## SECTION 229 — Integrate blindfold training with personal progress

Track completed exercises, accuracy, assistance usage, difficulty settings, and other meaningful measures. Avoid presenting these values as a definitive rating of mental imagery ability.

Offer recommendations based on observed performance, such as practising shorter sequences or tracking fewer pieces.

**Acceptance criteria:** Blindfold progress remains local, transparent, and connected to the actual training history.

## SECTION 230 — Protect strict-mode integrity and accessibility

Define which interface elements are allowed in each blindfold mode. Ensure that hidden positions are not inadvertently revealed through visible previews, animation trails, move-list text, or automatic board thumbnails.

Where assistive technology requires additional information, offer an appropriate accessible mode and label it separately from strict blindfold scoring.

**Acceptance criteria:** Strict-mode restrictions are enforced consistently, and accessible alternatives remain available without misleading users about the mode.

---

# PART XXIII — FAMOUS GAMES AND HISTORICAL CHESS

## SECTION 231 — Establish the Famous Games collection

Create a curated learning collection of historically significant chess games. It should help users explore the moves, tactical ideas, strategic plans, opening choices, and historical context of each game.

Do not assume that every famous game is freely distributable in every database representation. Review the source, licensing conditions, attribution requirements, and the status of associated annotations before bundling material.

The feature must remain usable offline for games included in the local collection.

**Acceptance criteria:** Curated games have valid move sequences, documented provenance, and appropriate distribution rights.

## SECTION 232 — Build game-specific historical metadata

Store available metadata such as player names, event, date, round, result, opening, and source attribution. Keep unknown fields empty or explicitly unavailable.

Historical descriptions must be supported by reliable sources. Do not invent quotations, tournament details, player motivations, or anecdotes to make a game more engaging.

Where multiple sources disagree, record the uncertainty or omit the disputed detail.

**Acceptance criteria:** Historical metadata is traceable and does not contain fabricated facts.

## SECTION 233 — Provide interactive game playback

Allow users to step through the complete game, jump to a move, pause playback, and inspect the position at each stage.

Playback must follow the stored move sequence and validate it against the chess rules. It must not use pre-rendered board snapshots as the only source of truth.

Allow users to flip the board and adjust playback speed without changing the game record.

**Acceptance criteria:** Historical games can be replayed accurately, and playback controls remain synchronised with the move list.

## SECTION 234 — Explain important moves

For selected historical positions, provide verified explanations of tactical combinations, strategic decisions, defensive resources, and mistakes where evidence supports them.

Keep original historical annotations separate from modern engine analysis. If Stockfish identifies a stronger alternative to a celebrated move, label it as modern engine analysis rather than attributing it to the historical player.

**Acceptance criteria:** Users can distinguish original annotations, modern engine findings, and newly generated explanations.

## SECTION 235 — Add a historical game timeline

Provide an optional chronological browsing view for curated games. Users may filter by period, player, event, or other available metadata.

The timeline must be derived from the collection's actual records. Games with incomplete or uncertain dates should not be assigned invented exact dates merely to fill the display.

**Acceptance criteria:** Timeline entries correspond to real curated records and handle incomplete dates transparently.

## SECTION 236 — Support famous-game comparison

Allow users to compare selected games or positions, including their opening sequences, tactical themes, and engine-supported differences.

Avoid ranking historical players solely by a modern engine evaluation of one game. Historical context, time controls, source quality, and engine limitations must be considered before making broader claims.

**Acceptance criteria:** Comparisons remain focused on supported game evidence and avoid unsupported historical rankings.

## SECTION 237 — Create guided historical lessons

Allow curated games to be converted into guided lessons in which the user predicts important moves before the continuation is revealed.

Each question must define its objective and accepted answer criteria. If several moves are strategically valid, feedback must account for that fact.

The lesson should preserve the original game and keep the user's attempts separate from the historical move sequence.

**Acceptance criteria:** Guided lessons use validated positions and never overwrite the source game.

## SECTION 238 — Add a historical source inspector

Provide a compact source-information panel showing the provenance of each game and the status of associated annotations or metadata.

Where the collection contains imported material, distinguish original-source claims from information added by ORBIS.

**Acceptance criteria:** Users can inspect the provenance of a curated game without disrupting playback or analysis.

## SECTION 239 — Allow local collection expansion

Provide an import workflow for users who want to add their own historical-game collections. Validate the imported games and retain source metadata when available.

Do not automatically promote every imported game into the curated official collection. Let users organise imported records separately or choose to include them in personal collections.

**Acceptance criteria:** Personal imports remain distinct from the curated collection unless the user deliberately organises them together.

## SECTION 240 — Connect historical games to modern analysis

Allow a historical game to open in Analysis Studio with its original move sequence preserved. Users should be able to explore engine alternatives, annotate the game, and save a personal study copy.

The system must distinguish the original historical record from the user's analysis version. Repeated analysis must not rewrite the source game or replace its original annotations silently.

**Acceptance criteria:** Historical games integrate with Analysis Studio while preserving the integrity and provenance of the source record.

---

# PART XXIV — CUSTOM POSITIONS AND POSITION EDITOR

## SECTION 241 — Build a complete position editor

Provide an interactive editor for constructing custom chess positions. Users must be able to place pieces, remove pieces, change piece colours, clear the board, and start from a standard position.

The editor must use the application's authoritative chess-state model. Visual placement alone is insufficient because the resulting position also depends on side to move, castling rights, en-passant availability, and other relevant state.

Provide a preview mode that allows the user to inspect the resulting position before saving or beginning analysis.

**Acceptance criteria:** Custom positions can be created, validated, saved, and opened in compatible Chess World modules.

## SECTION 242 — Implement piece-placement controls

Allow users to select a piece and place it on a square, replace an existing piece, or remove a piece. Provide clear visual feedback about the currently selected tool.

The editor must support all standard chess piece types and both colours. It must not create duplicate pieces or invalid internal references because a user repeatedly clicks the same square.

Provide undo and redo for supported editing operations.

**Acceptance criteria:** Piece-placement actions modify the intended square and maintain a consistent internal board representation.

## SECTION 243 — Configure side to move and position state

Allow the user to set which side moves next. Where supported, provide controls for castling rights and en-passant state, with clear explanations of their effects.

Do not infer castling rights merely because a king and rook appear on their original squares. Castling availability depends on the actual position state and the relevant move history.

The editor must validate state fields before saving or exporting a FEN.

**Acceptance criteria:** Position-state settings are explicit and produce valid, correctly interpreted chess positions.

## SECTION 244 — Validate custom positions

Validate structural and rule-related requirements before a custom position enters a training or analysis workflow. Detect obvious issues such as missing kings, duplicate kings, impossible piece counts, invalid side-to-move information, and malformed special-move state.

Some composed chess positions may intentionally represent analysis setups rather than reachable game positions. The application should distinguish structural validity from historical reachability and provide appropriate warnings instead of rejecting every unusual composition automatically.

**Acceptance criteria:** Validation reports the specific issue and distinguishes invalid data from unusual but intentionally composed positions.

## SECTION 245 — Support FEN import and export

Provide a text field for importing FEN positions and a way to copy or export the current position as FEN.

Validate imported FEN before applying it. If parsing fails, preserve the user's current board and show a useful error identifying the malformed field where possible.

Explain that FEN represents a position state, not a complete game history. Do not imply that a FEN alone can reconstruct all historical moves or every repetition-related fact.

**Acceptance criteria:** Valid FEN strings round-trip correctly within the supported rules, and invalid input does not destroy the current position.

## SECTION 246 — Support custom-position saving

Allow users to save a custom position with a name, optional description, tags, and source notes. Store the position and its relevant state in the active local profile.

Prevent an empty or whitespace-only title from creating an unusable record. If a title conflicts with an existing item, preserve both records through a unique identifier and offer a clear naming option.

**Acceptance criteria:** Saved positions can be searched, reopened, renamed, and deleted without affecting unrelated records.

## SECTION 247 — Launch analysis from a custom position

Allow a validated custom position to be sent to Stockfish for analysis. Clearly identify that the analysis begins from a custom position rather than from the start of a complete game.

If the user creates moves from the position, store them in an associated study or variation tree. Do not invent earlier moves or a game result.

**Acceptance criteria:** Custom-position analysis begins from the correct state and creates a valid, separately identifiable analysis record.

## SECTION 248 — Generate training exercises from custom positions

Allow a user to designate an objective for a custom position, such as finding the best move, holding a draw, finding a forced mate, or practising a specific defensive technique.

The exercise generator must verify that the requested objective is meaningful for the position. If the engine cannot establish a reliable solution within the configured budget, mark the exercise as unverified or ask the user to define a manual solution.

**Acceptance criteria:** Custom exercises have explicit objectives and are not presented as verified when the supporting analysis is insufficient.

## SECTION 249 — Protect custom-position data during editing

Keep an existing saved position unchanged until the user explicitly saves the modifications. Offer save, discard, and cancel options when navigating away from unsaved changes.

For edits that would make the position invalid, explain the issue and preserve the last valid saved version.

**Acceptance criteria:** Accidental navigation, invalid edits, and interrupted saves do not silently destroy the previous saved position.

## SECTION 250 — Integrate the position editor across Chess World

Provide consistent actions for opening a position in Analysis Studio, starting a compatible training exercise, creating a study, or exporting the position.

Use the shared navigation and persistence mechanisms instead of implementing independent copies of the editor for each module.

**Acceptance criteria:** Custom positions can move between supported modules without losing their state, source metadata, or profile association.

---

# PART XXV — CHESS VARIANTS AND CUSTOM RULE SETS

## SECTION 251 — Define strict separation between standard chess and variants

Standard chess must remain the default ruleset. Any variant must be explicitly selected and visibly identified so users do not accidentally play a nonstandard game under standard-chess assumptions.

The application must track the selected ruleset throughout the game, engine configuration, save operation, export, and analysis. Do not interpret variant positions using standard-chess legality rules if the variant changes those rules.

**Acceptance criteria:** Standard chess behaviour remains unchanged, and every supported variant is clearly separated from standard games.

## SECTION 252 — Establish a variant capability registry

Represent supported variants through a capability registry that records their rules implementation, notation support, engine compatibility, import/export support, and available training features.

Do not assume that every chess library or engine supports every variant. If a capability is unavailable, disable the corresponding action with an explanation.

The registry should make it possible to add a new variant without rewriting unrelated standard-chess modules.

**Acceptance criteria:** Variant availability is determined by verified capabilities rather than hardcoded UI assumptions.

## SECTION 253 — Support a carefully scoped first variant

If a variant is included in the initial Chess World release, select one with suitable library support and clearly defined rules. For example, Chess960 may be considered if the board setup, castling rules, notation, and engine support are implemented correctly.

Do not include a variant merely to increase the number of menu entries. A smaller number of genuinely working variants is preferable to a large list of nonfunctional modes.

**Acceptance criteria:** Every released variant can be played, saved, reopened, and validated under its own rules.

## SECTION 254 — Validate variant-specific moves

Use a rules implementation that explicitly supports the selected variant. Verify legal moves, special rules, game termination, notation, and position serialization.

Where an engine is used, confirm that its selected mode matches the variant. Do not feed a variant position to a standard-chess engine and present the result as authoritative variant analysis.

**Acceptance criteria:** Variant games use matching rules and engine capabilities throughout the complete workflow.

## SECTION 255 — Preserve variant identity in saved games

Store the variant identifier with every nonstandard game, position, study, and analysis session. On reopening, initialise the correct ruleset before parsing the stored moves.

If a file format or external application does not support the selected variant, explain the limitation before exporting. Never silently convert a variant game into standard chess.

**Acceptance criteria:** Variant identity survives persistence and export wherever the target format supports it.

## SECTION 256 — Add variant-specific instructions

Provide concise explanations of the rules that differ from standard chess. Display these instructions before the first game and make them available during play.

The explanations must correspond to the actual implemented rules. Do not describe a feature as supported if the underlying move validator or engine does not enforce it.

**Acceptance criteria:** Users can understand the selected variant and receive accurate explanations of its rules.

## SECTION 257 — Keep variant ratings separate

If variant-specific performance ratings are implemented, maintain separate rating histories for each supported variant and distinguish them from any standard-chess rating.

Do not infer an official rating from local play unless the rating system and its limitations are explicitly documented. Training scores and achievement points must not be labelled as official ratings.

**Acceptance criteria:** Variant progress cannot accidentally alter standard-chess statistics or be misrepresented as an official rating.

## SECTION 258 — Support variant-aware imports

When importing a game file, detect the variant from reliable format metadata or explicit user selection. Validate the move sequence using the appropriate ruleset.

If the variant cannot be determined reliably, ask the user rather than guessing. If the application lacks support for the detected variant, retain the source file and report the limitation.

**Acceptance criteria:** Variant imports use correct rules or fail safely without corrupting the source record.

## SECTION 259 — Design future variant extension points

Keep ruleset-specific behaviour behind documented interfaces so future variants can introduce different starting positions, legal-move rules, termination conditions, notation, and engine capabilities.

Do not overgeneralise the standard-chess code into a complex universal framework without a demonstrated need. The architecture should be extensible but still straightforward to test.

**Acceptance criteria:** Adding a supported variant does not require modifying unrelated standard-chess behaviour or bypassing existing validation.

## SECTION 260 — Establish variant release gates

Before releasing a variant, run dedicated tests for starting positions, legal moves, special rules, game endings, persistence, imports, exports, and engine integration where applicable.

Test edge cases specific to that variant rather than relying solely on standard-chess regression tests.

**Acceptance criteria:** A variant is available only after its own functional and regression tests pass.

---

# PART XXVI — OPTIONAL 3D CHESS UNIVERSE

## SECTION 261 — Treat 3D chess as an optional presentation mode

Provide an optional 3D board or chess environment without replacing the standard 2D board. The 3D experience must use the same authoritative game state and move-validation layer as the normal interface.

The 3D mode must not create a separate source of truth or introduce a different rules implementation merely because pieces are rendered differently.

Users must be able to return to the 2D board without losing the current game, variation, analysis session, or selected position.

**Acceptance criteria:** The 2D and 3D views remain synchronised with the same underlying chess session.

## SECTION 262 — Define the rendering technology boundary

Inspect the existing ORBIS desktop architecture and select a rendering approach compatible with its supported runtime. Reuse existing graphics infrastructure where appropriate.

Keep 3D rendering separate from core chess rules, storage, engine execution, and live-feed processing. A graphics failure must not terminate Stockfish or corrupt a saved game.

**Acceptance criteria:** Rendering components have a clear boundary and can fail or be disabled without breaking core chess functionality.

## SECTION 263 — Build a readable 3D chessboard

Design a board with clearly distinguishable squares, pieces, coordinates, selection indicators, and move highlights. Use materials and lighting that preserve piece recognition instead of prioritising decorative effects.

Provide sensible camera defaults and prevent lighting, reflections, or depth effects from obscuring legal-move indicators.

The board must remain readable at supported window sizes and display scales.

**Acceptance criteria:** Players can identify pieces, squares, and relevant move information reliably in the 3D view.

## SECTION 264 — Implement camera controls

Support intuitive camera rotation, zoom, and orientation reset. Use input controls that do not conflict with existing ORBIS shortcuts or normal window interaction.

Provide a way to restore the default view if the user loses track of the board orientation. Camera changes must not alter the chess position or trigger unintended moves.

**Acceptance criteria:** Camera interaction is predictable and independent of chess-state manipulation.

## SECTION 265 — Implement 3D piece selection and movement

Allow users to select pieces and choose destination squares through a consistent interaction model. Map rendered coordinates to the underlying logical board squares using a well-tested conversion function.

Before applying a move, validate it against the authoritative chess rules engine. If the user selects an illegal destination, show appropriate feedback without modifying the position.

**Acceptance criteria:** 3D input maps to the correct logical squares and cannot bypass move validation.

## SECTION 266 — Synchronise 2D and 3D views

When the user moves a piece in one view, update the other view from the same authoritative state. Synchronise side to move, captured pieces, promotion, castling, en-passant state, highlights, and navigation.

Avoid implementing separate move histories for the two visualisations. Use a shared session model and publish state changes through the existing application event system where suitable.

**Acceptance criteria:** Switching between 2D and 3D preserves the exact game position and analysis context.

## SECTION 267 — Add optional visual themes

Allow users to select from a limited set of tested board and piece themes. Themes must preserve adequate contrast and distinguishability.

Do not bundle unlicensed artwork or assume that publicly accessible 3D assets are free to redistribute. Record asset provenance and licence conditions.

**Acceptance criteria:** Themes can be changed without affecting gameplay, accessibility, or the underlying game state.

## SECTION 268 — Add optional move animations

Provide configurable movement and capture animations that communicate actions without slowing normal play. Animations should be interruptible when the user navigates rapidly or changes views.

Do not delay engine state updates or legal-move validation until an animation finishes. The logical move should be committed according to the application’s game-state rules, with rendering following the resulting state.

**Acceptance criteria:** Animation timing cannot cause duplicate moves, stale positions, or inconsistent board state.

## SECTION 269 — Enforce adaptive rendering performance

Measure rendering performance on representative supported devices. Use level-of-detail reductions, simpler materials, reduced effects, or a switch to 2D when the 3D experience cannot sustain an acceptable frame rate.

Avoid consuming excessive CPU or GPU resources while the 3D view is hidden or the application is idle.

**Acceptance criteria:** Performance degradation does not break gameplay, and the user can return to a lightweight view.

## SECTION 270 — Provide graceful 3D fallback

If the graphics context fails, the device lacks required support, or rendering resources cannot be allocated, show a clear message and offer the 2D board.

Preserve the current position, variation tree, engine search state where recoverable, and unsaved annotations.

**Acceptance criteria:** A 3D failure leaves the underlying chess session recoverable and does not prevent continued play in 2D.

---

# PART XXVII — ACCESSIBILITY AND INPUT SYSTEM

## SECTION 271 — Establish accessibility requirements for the board

Design the chessboard so that squares and pieces can be identified through supported assistive technologies. Provide meaningful labels and state descriptions where the desktop framework permits them.

Selection, legal-move highlighting, check status, and move completion must not rely on colour alone. Ensure that essential feedback is available through text or another distinguishable signal.

**Acceptance criteria:** The board communicates its relevant state through more than colour and supports the application's available accessibility APIs.

## SECTION 272 — Implement keyboard-based move entry

Allow users to navigate squares using the keyboard and select a piece and destination without requiring a mouse.

Define predictable focus movement and ensure that keyboard focus remains visible. The input method must respect legal-move validation and must not trigger unrelated ORBIS shortcuts unexpectedly.

Provide an escape or cancellation action for incomplete move entry.

**Acceptance criteria:** A user can select and move a piece through keyboard controls alone in supported standard-chess workflows.

## SECTION 273 — Implement accessible move announcements

Where supported, announce relevant board and game-state changes to assistive technology. Examples include the selected piece, legal destination, move played, check, checkmate, promotion prompt, and engine-analysis completion.

Avoid announcing every animation frame or every low-level rendering update. Announcements should be concise, timely, and useful.

**Acceptance criteria:** Announcements reflect meaningful state changes without producing excessive repetitive output.

## SECTION 274 — Support coordinate and notation preferences

Allow users to configure coordinate visibility and supported notation preferences. Any notation setting must be applied consistently to the board, move list, exported content where relevant, and training interface.

Do not confuse notation preferences with the internal representation of moves. The internal game model must remain independent of the selected display format.

**Acceptance criteria:** Notation changes affect presentation while preserving the underlying game record.

## SECTION 275 — Provide colour-vision-friendly themes

Offer board themes that remain distinguishable for users with different colour-vision needs. Include contrast between light and dark squares, readable move highlights, and clear selected-square indicators.

Do not encode the difference between legal, illegal, previous, and candidate moves using colour alone. Use shape, border, iconography, or text where suitable.

**Acceptance criteria:** Essential board states remain distinguishable under supported colour and contrast themes.

## SECTION 276 — Support reduced motion

Respect applicable operating-system reduced-motion preferences where available and provide an in-app setting where appropriate.

Reduce nonessential animations, camera transitions, particle effects, and decorative movement without removing necessary feedback about a chess move.

**Acceptance criteria:** Reduced-motion mode disables or simplifies decorative motion while preserving functional state feedback.

## SECTION 277 — Support text scaling and layout adaptation

Ensure that controls, labels, move lists, and settings remain usable when system text scaling or application zoom changes.

Prevent critical actions from being clipped or permanently hidden. Long player names, opening names, and annotations must wrap or truncate predictably with access to the full value.

**Acceptance criteria:** Supported scaling settings do not make essential chess controls inaccessible.

## SECTION 278 — Define a consistent keyboard-shortcut registry

Register Chess World shortcuts through a central mechanism that can detect conflicts with existing ORBIS and Orion shortcuts.

Use context-sensitive activation where appropriate. A shortcut intended for the chessboard must not trigger while the user is typing in an unrelated text field unless the behaviour is explicitly intended.

Do not silently reassign existing global shortcuts to Chess World.

**Acceptance criteria:** Chess World shortcuts are discoverable, conflict-checked, and compatible with existing ORBIS behaviour.

## SECTION 279 — Provide customisable shortcuts safely

Allow users to customise supported Chess World shortcuts and restore defaults. Detect conflicts and explain which action already uses the selected combination.

Persist shortcut preferences within the appropriate local profile. Validate shortcut definitions when loading them so corrupted settings cannot disable unrelated keyboard input.

**Acceptance criteria:** Custom shortcuts can be edited and restored without breaking existing global shortcut handling.

## SECTION 280 — Conduct accessibility regression testing

Test keyboard navigation, focus handling, board announcements, colour contrast, reduced motion, text scaling, and shortcut conflicts.

Accessibility tests must be part of the release process rather than a final visual review. When the desktop framework limits a particular capability, document the limitation and implement the best supported alternative.

**Acceptance criteria:** Accessibility regressions are identified through repeatable tests and reviewed before release.

---

# PART XXVIII — PERSONALISATION, SETTINGS AND USER CONTROL

## SECTION 281 — Build a unified Chess World settings system

Provide a central settings interface for board appearance, notation, sound, animation, analysis defaults, training preferences, storage information, and supported engine options.

Group settings by purpose and provide descriptions for options whose effects are not obvious. Avoid exposing every internal engine parameter to beginners by default.

Settings must affect real application behaviour. Do not include switches that merely change their visual state without changing the underlying feature.

**Acceptance criteria:** Every released setting is connected to a verified behaviour and persists correctly where appropriate.

## SECTION 282 — Separate global and session-specific settings

Distinguish preferences that apply throughout Chess World from settings that belong to a particular game, training session, or analysis job.

For example, the preferred board theme may be global, while a deep-analysis budget may be specific to a particular job. Make this distinction clear in the UI.

Changing a session-specific setting must not unexpectedly alter unrelated saved sessions.

**Acceptance criteria:** Settings have explicit scopes and produce predictable effects.

## SECTION 283 — Define settings precedence

Where global preferences, session overrides, and engine defaults interact, define a documented precedence order.

The application should resolve the effective value before starting the operation and display the active configuration when it materially affects the result.

Do not silently override a user's explicit session setting with a global preference after the session has started.

**Acceptance criteria:** Effective settings can be determined consistently and are applied to the intended operation.

## SECTION 284 — Provide safe defaults and reset controls

Choose defaults that make Chess World usable on a wide range of supported devices. Provide a way to restore default settings without deleting saved games, studies, or personal training progress.

Resetting one settings category must not reset unrelated categories unless the user explicitly requests a complete reset.

**Acceptance criteria:** Reset operations affect only the selected settings scope and preserve valuable personal data.

## SECTION 285 — Persist board and layout preferences

Persist supported board orientation, board theme, coordinate visibility, panel layout, notation preferences, and other relevant presentation choices within the active profile.

Validate stored values when loading them. If a preference is invalid after an application update, fall back to a safe default and report the issue only when useful.

**Acceptance criteria:** Valid preferences survive application restarts, and invalid settings do not prevent Chess World from opening.

## SECTION 286 — Add sound preferences

Where sound effects are implemented, provide separate controls for move sounds, capture sounds, notifications, and other supported audio categories.

Respect mute settings and avoid playing repeated sounds for internal state updates that are not visible moves. Ensure that audio failure does not block game logic.

**Acceptance criteria:** Sound settings affect the appropriate audio events without altering gameplay.

## SECTION 287 — Provide analysis resource controls

Allow users to choose reasonable limits for local engine analysis, including supported time or node budgets and concurrency settings.

Explain that deeper analysis may consume more CPU, power, and time. Avoid starting several heavy searches simultaneously without a defined resource policy.

**Acceptance criteria:** Resource settings control actual engine work and remain within documented operational limits.

## SECTION 288 — Provide engine installation and health information

Display the status of the configured Stockfish engine, including whether the executable is available, the version where discoverable, and whether a basic readiness check succeeds.

If the engine is missing or incompatible, provide a clear recovery path consistent with the application's distribution and licensing model.

Do not display a successful engine status based solely on a saved path. Verify that the executable can actually be started and responds appropriately.

**Acceptance criteria:** Engine status reflects a genuine health check rather than the presence of a configuration entry alone.

## SECTION 289 — Explain storage use

Provide a storage summary for saved games, studies, analysis results, imported datasets, and disposable caches where measurable.

Use actual storage measurements or clearly labelled estimates. Do not invent exact storage figures or classify personal records as disposable cache data.

**Acceptance criteria:** Storage information corresponds to real files or clearly disclosed estimates.

## SECTION 290 — Implement profile-aware settings recovery

When switching ORBIS profiles, load the new profile's Chess World settings and data. Ensure that profile-specific preferences do not leak into another profile unless a particular setting is explicitly defined as application-wide.

If settings are corrupted, restore safe defaults without deleting game history. Record recoverable diagnostics through the existing local logging mechanism.

**Acceptance criteria:** Profile switching and settings recovery preserve isolation and do not destroy saved chess records.

---

# PART XXIX — SEARCH, COMMAND PALETTE AND CROSS-MODULE INTEGRATION

## SECTION 291 — Integrate Chess World with ORBIS search

Where the existing ORBIS search or command interface supports module discovery, allow users to find Chess World games, saved positions, studies, repertoires, and training content.

Search results must be drawn from actual accessible records. The system must not expose another local profile's private chess data merely because a query matches a title.

Provide clear result categories so a game, an opening line, a puzzle, and a settings action are not confused with one another.

**Acceptance criteria:** Chess World search integrates with existing ORBIS discovery mechanisms without compromising profile boundaries.

## SECTION 292 — Register Chess World commands

Where the existing command palette or natural-language command infrastructure permits, register useful Chess World actions, such as opening the library, creating a study, opening Analysis Studio, or launching a training mode.

Commands must resolve to actual supported actions. If a command requires a game or position, ask for the missing information rather than selecting an arbitrary record.

Do not replace or intercept unrelated ORBIS commands.

**Acceptance criteria:** Registered commands execute the intended Chess World action and preserve existing global command behaviour.

## SECTION 293 — Support contextual navigation

Provide links between related records and modules. For example, a critical moment in a report may open a particular game position, and a puzzle created from a game may link back to its source.

Contextual navigation should pass stable record identifiers and required state rather than relying on the current visual panel alone.

**Acceptance criteria:** Cross-module navigation opens the intended record and position reliably.

## SECTION 294 — Preserve navigation history

Where compatible with the existing ORBIS navigation model, preserve a history of recently opened chess games, positions, and studies.

Allow users to return to a previous context without unintentionally resetting a running game or discarding unsaved annotations.

Do not record every minor board interaction as a separate navigation entry.

**Acceptance criteria:** Navigation history is useful, profile-aware, and does not interfere with active sessions.

## SECTION 295 — Implement safe cross-module actions

When another ORBIS module requests a chess operation, validate the requested action and its inputs through the normal Chess World service layer.

Do not allow a shortcut or external module to bypass move validation, profile isolation, or file-operation safeguards.

If a cross-module request is unsupported, return a clear error and leave the active chess state unchanged.

**Acceptance criteria:** Cross-module calls use the same validation and persistence rules as direct Chess World interactions.

## SECTION 296 — Connect chess records with local files

Where ORBIS Files integration is available, allow supported game records, PGNs, FEN files, and exported studies to be opened or saved through the established file-management workflow.

Preserve file provenance where available and distinguish an external file from an internal database record. Editing a game inside Chess World must not silently overwrite the source file.

**Acceptance criteria:** File integration preserves source records and uses existing ORBIS file-management safeguards.

## SECTION 297 — Connect chess learning to ORBIS Courses where appropriate

If the existing ORBIS Courses system supports cross-module lessons, expose appropriate chess learning activities through its established integration mechanism.

Reuse the existing course infrastructure instead of creating a second unrelated course-management system. Do not modify the existing course engine or completion rules merely to support chess.

**Acceptance criteria:** Chess learning can be surfaced through supported course integrations without breaking existing ORBIS Courses behaviour.

## SECTION 298 — Support local reminders and notifications

Allow users to schedule optional reminders for study sessions or unfinished training activities through ORBIS's established notification mechanism.

Respect the user's settings, quiet periods where supported, and profile context. Do not create repeated notifications merely because a session is saved but incomplete.

**Acceptance criteria:** Reminders are optional, correctly scheduled, and connected to real training activities.

## SECTION 299 — Define integration contracts and failure behaviour

Document the interfaces between Chess World and ORBIS navigation, search, profiles, files, notifications, courses, and other participating modules.

Every integration must define its inputs, outputs, permissions, failure states, and ownership of persisted data. Avoid circular dependencies in which two modules require each other to initialise.

If a connected module is unavailable, Chess World should continue to provide its independent functionality.

**Acceptance criteria:** Integration failures remain contained, and Chess World can operate when optional connected modules are disabled.

## SECTION 300 — Establish the third milestone acceptance gate

Before proceeding, verify that the advanced training system, Calculation Gym, Blindfold Chess, historical-game learning, custom positions, selected variants, optional 3D mode, accessibility controls, settings, search integration, and cross-module workflows work to the extent that they are included in the current release.

Run end-to-end tests covering:

1. Starting and completing a training session.
2. Recovering an interrupted exercise.
3. Entering and validating a multi-ply calculation line.
4. Reconstructing a blindfold exercise.
5. Replaying a verified historical game.
6. Creating, saving, reopening, and exporting a custom position.
7. Playing and saving a supported variant, if included.
8. Switching between 2D and 3D without changing the underlying position, if 3D is included.
9. Completing keyboard-only board interaction.
10. Changing settings and confirming that they affect actual behaviour.
11. Switching local profiles without exposing another profile's data.
12. Invoking Chess World through supported ORBIS search or command mechanisms.
13. Handling unavailable optional modules without crashing the core application.
14. Confirming that all existing ORBIS and Orion shortcuts and workflows still behave as before.

Do not mark an optional feature complete merely because its settings or entry point exists. Every released capability must be functional, appropriately tested, and accurately described.

**Acceptance criteria:** The third milestone demonstrates coherent training workflows, safe custom-position handling, accessible controls, reliable settings, and working ORBIS integration without regressions to the existing application.

---

# END OF PART 3 — SECTIONS 201–300

## REQUIRED CONTINUATION

The next part must begin at **SECTION 301** and continue sequentially without restarting or renumbering earlier sections.

Part 4 should expand the engineering and operational foundations in substantially greater depth, including:

* Detailed Stockfish process lifecycle and UCI protocol handling.
* Engine discovery, installation, version checks, configuration, cancellation, and recovery.
* Multi-search scheduling, CPU and memory budgeting, and stale-result prevention.
* Chess rules integration and extensive edge-case testing.
* Live broadcast ingestion, event sequencing, clock updates, reconnect logic, and provider-specific adapters.
* Live-game discovery, tournament navigation, source freshness, and honest availability states.
* PGN/FEN parser robustness, database migrations, indexing, and backup recovery.
* UI responsiveness, concurrency, background jobs, logging, diagnostics, and performance testing.
* Security boundaries, privacy guarantees, licensing review, and packaging.
* Release gates and end-to-end validation.

All earlier decisions remain in force: ORBIS Chess World is an additive feature inside the existing ORBIS desktop application; Stockfish runs locally as the primary engine; supported live-game feeds must use genuine provider data; personal chess data remains local by default; online multiplayer is deferred; and the implementation must preserve existing ORBIS and Orion behaviour.

The coding agent must inspect the actual repository and current application architecture before implementing changes, reuse suitable existing components, avoid dummy functionality, and verify each feature through meaningful tests.

# ORBIS CHESS WORLD

## MASTER BUILD SPECIFICATION

### PART 4 — SECTIONS 301–400

### Stockfish Runtime Engineering, UCI Protocol, Engine Scheduling, Chess Rules Integrity, Live Broadcast Infrastructure, Provider Adapters, Real-Time Synchronisation, Clock Reconstruction, and Recovery Engineering

---

# PART XXX — ENGINE INFRASTRUCTURE: SYSTEM ARCHITECTURE

## SECTION 301 — Establish Stockfish as the authoritative local analysis engine

Implement Stockfish as ORBIS Chess World's primary local chess engine. It must perform genuine chess analysis on the user's device. Do not substitute an external language model, a hardcoded evaluation table, a remote evaluation API, or fabricated candidate moves for actual Stockfish output.

Before implementation, inspect the existing ORBIS repository to determine its desktop runtime, process-management capabilities, filesystem abstraction, security boundaries, and packaging pipeline. Select the engine integration approach that fits the actual architecture rather than assuming a particular framework.

Stockfish must remain a separate computational component behind a well-defined engine service. The user interface should request analysis through that service and must not communicate directly with operating-system processes.

Define explicit interfaces for engine discovery, initialisation, readiness, configuration, position submission, search execution, result delivery, cancellation, shutdown, and recovery. Other Chess World modules must depend on these interfaces rather than implementing their own Stockfish launch logic.

**Acceptance criteria:** Stockfish performs genuine local analysis, engine communication is centralised, and no analysis feature silently substitutes fabricated or remote results.

## SECTION 302 — Inspect and document the existing repository before integration

Before modifying files, inspect the current repository structure, application entry points, process architecture, renderer boundaries, dependency management, build scripts, testing framework, and release packaging.

Identify where native processes are permitted to run and whether the application already has a controlled service layer for subprocesses. Examine existing conventions for configuration, logging, error reporting, asynchronous tasks, and local data storage.

Create a concise implementation map identifying the files and modules that will be reused, extended, or newly introduced. The map must explain how the engine service will connect to the existing Chess World architecture.

Do not create duplicate infrastructure if ORBIS already provides a suitable process manager or background-job system. Do not modify unrelated application components merely to make the integration easier.

**Acceptance criteria:** The implementation plan reflects the actual repository, identifies the relevant integration points, and establishes that existing ORBIS functionality will be preserved.

## SECTION 303 — Define a versioned engine-service contract

Create a typed service contract for all engine operations. Requests and responses must contain enough information to identify the engine instance, analysis request, position, operation state, and relevant configuration.

A search request should include a unique request identifier, a validated position or move history, applicable search limits, the requested number of principal variations, and any supported resource preferences.

A result should identify its originating request and contain the available evaluation, principal variation, search progress, completion status, and engine metadata. Do not assume that every field is available in every response.

Version the contract if its structure is expected to evolve. Validate incoming and outgoing messages so malformed results cannot corrupt application state.

**Acceptance criteria:** All engine-dependent modules use a consistent, validated contract, and every result can be associated with the request that generated it.

## SECTION 304 — Separate engine management from chess-session management

The engine service manages executable processes and engine protocol state. The chess-session service manages games, positions, variations, annotations, and navigation. These responsibilities must remain separate.

Opening a different game should update the chess session and issue a suitable engine request; it should not require every UI component to restart or directly manipulate the engine process.

Likewise, an engine restart must not destroy the active game, erase variations, or reset the user's current position.

**Acceptance criteria:** Engine lifecycle changes and chess-session changes can occur independently without losing saved or recoverable chess state.

## SECTION 305 — Define the engine lifecycle state machine

Implement an explicit lifecycle state machine. At minimum, distinguish:

* Undiscovered.
* Discovered.
* Validating.
* Starting.
* Handshaking.
* Initialising.
* Ready.
* Searching.
* Stopping search.
* Restarting.
* Shutting down.
* Unavailable.
* Failed.

Specify valid transitions and the events that trigger them. For example, a process that exists but has not completed the UCI handshake must not be marked Ready.

Every transition should be observable through structured diagnostics. Repeated requests to start an already-running engine must not create duplicate unmanaged processes.

**Acceptance criteria:** Lifecycle tests demonstrate valid transitions, rejection of invalid transitions, and recovery from process-start and protocol failures.

## SECTION 306 — Establish process ownership and isolation

Create a dedicated process manager responsible for launching and supervising Stockfish. It must retain the process handle, standard-input stream, standard-output stream, standard-error stream where available, and process identifier.

The manager must prevent accidental process duplication and must know which engine instance owns each active search.

If the engine exits unexpectedly, mark its requests as failed or interrupted and notify dependent services. Do not leave the interface displaying an indefinitely running search.

**Acceptance criteria:** Every launched engine process has a clear owner, lifecycle, and shutdown path.

## SECTION 307 — Select compatible engine binaries

Determine which Stockfish binaries are appropriate for the supported operating systems and CPU architectures. Use legitimate distributions and follow the engine's applicable licensing and redistribution requirements.

Where multiple binaries are available, choose a compatible build using reliable platform and CPU-capability detection. If safe detection is unavailable, prefer a compatible fallback over a potentially unsupported binary.

Do not assume that a binary compiled for one architecture can run on another. Do not execute an arbitrary executable found in a user-selected directory without validating that it is an intended engine candidate.

**Acceptance criteria:** Engine selection uses validated platform compatibility and has a documented fallback strategy.

## SECTION 308 — Define engine installation and distribution policy

Decide whether Stockfish is bundled with ORBIS, distributed as a separately installed component, or configured through a supported user-selected executable.

Evaluate installer size, update responsibilities, licensing, platform support, and offline operation before choosing the distribution model.

If the engine is downloaded separately, verify the download source and integrity using an appropriate trusted mechanism. A checksum proves consistency with the expected file but does not independently prove the authenticity of an untrusted source.

If the user must install Stockfish manually, provide accurate instructions and a clear engine-unavailable state.

**Acceptance criteria:** The distribution strategy is documented, compliant with applicable licensing, and supports reliable engine discovery.

## SECTION 309 — Keep engine configuration local

Store the selected engine path, supported engine options, preferred search limits, and related settings using ORBIS's established local configuration mechanism.

Validate stored paths and option values whenever the configuration is loaded. A missing executable or invalid option must not prevent Chess World from opening.

Do not store private user-game information in an engine configuration file. Keep configuration separate from saved games and analysis reports.

**Acceptance criteria:** Engine configuration survives restarts, handles invalid values safely, and remains isolated within the appropriate ORBIS profile where applicable.

## SECTION 310 — Establish engine startup acceptance tests

Create automated tests for engine discovery, binary validation, process launch, UCI handshake, option configuration, readiness confirmation, search execution, result parsing, cancellation, and shutdown.

Where a test environment does not have the actual binary available, use a clearly identified test double only for protocol and lifecycle tests. Actual integration tests must run against a genuine supported Stockfish build.

Do not use a test double to claim that real engine analysis has been validated.

**Acceptance criteria:** Test reports distinguish simulated protocol tests from genuine Stockfish integration tests.

---

# PART XXXI — UCI PROTOCOL IMPLEMENTATION

## SECTION 311 — Implement a dedicated UCI communication layer

Implement a protocol layer for communicating with Stockfish through its Universal Chess Interface (UCI). This layer must be responsible for serialising commands, reading responses, parsing protocol messages, and enforcing lifecycle rules.

Do not scatter UCI string construction and parsing across the UI, game controller, and analysis panels.

The implementation should be based on the actual UCI protocol supported by the selected engine version. Handle ordinary informational messages, readiness responses, search results, and engine termination according to their documented semantics.

**Acceptance criteria:** UCI communication is implemented in one testable component and is independent of presentation logic.

## SECTION 312 — Implement the UCI initialisation handshake

On engine startup, send the required UCI initialisation command and wait for the expected identification response.

Then configure supported engine options, send the readiness-check command, and wait for the corresponding readiness response before accepting analysis requests.

Apply explicit timeouts to handshake operations. If the engine does not respond, capture useful diagnostics and enter a recoverable failure state.

Do not assume that a process is ready simply because it has started successfully.

**Acceptance criteria:** Analysis requests are accepted only after the engine has completed the required initialisation and readiness sequence.

## SECTION 313 — Parse engine identity and capabilities

Capture the engine's reported name, version information where available, and advertised options. Store this information as engine metadata.

Use advertised capabilities to determine which options can be configured. Do not assume that an option exists merely because another engine or an earlier version supports it.

If the engine does not provide a particular piece of metadata, represent it as unavailable rather than inventing a version string.

**Acceptance criteria:** Engine configuration and diagnostics reflect actual reported capabilities.

## SECTION 314 — Implement safe command serialisation

Create a command queue or equivalent controlled writer so UCI commands are sent in a valid order.

Prevent unrelated asynchronous tasks from writing overlapping or partially interleaved commands to the engine's input stream.

Validate all values inserted into commands, including search limits and supported option values. Do not concatenate arbitrary user input into protocol commands.

**Acceptance criteria:** Concurrent requests cannot corrupt command framing or send invalid protocol sequences.

## SECTION 315 — Implement robust standard-output parsing

Read engine output incrementally rather than assuming that one operating-system read corresponds to one complete line.

Handle partial lines, multiple lines arriving together, variable line lengths within configured limits, and stream closure. Parse complete messages only after identifying their boundaries.

Malformed or unexpected output must be recorded safely and must not crash the renderer or terminate unrelated application services.

**Acceptance criteria:** The parser correctly handles fragmented output, batched output, and malformed messages in automated tests.

## SECTION 316 — Handle standard-error output and process diagnostics

Where the operating system exposes a separate standard-error stream, drain it continuously to avoid pipe blockage.

Capture useful diagnostic output while limiting the size and retention period of logs. Avoid treating standard-error text as a valid UCI result unless the protocol explicitly provides the information through the expected channel.

**Acceptance criteria:** Engine diagnostics can be collected without blocking process output or mixing diagnostic text into evaluation results.

## SECTION 317 — Parse UCI informational messages

Handle common `info` messages, including available search depth, selective depth where reported, current evaluation, principal variations, nodes searched, nodes per second, elapsed search time, and hash-table usage where available.

Every field is optional unless the protocol or selected operation guarantees otherwise. A message containing a depth but no evaluation must not be interpreted as an evaluation of zero.

Support fields arriving in different valid orders. Treat unrecognised fields according to a forward-compatible parsing policy.

**Acceptance criteria:** Partial and differently ordered informational messages are parsed correctly without fabricated defaults.

## SECTION 318 — Handle the `bestmove` response correctly

Treat the `bestmove` message as the engine's final move response for the applicable search, subject to the actual UCI operation and its result.

Parse the reported move against the correct position and variant. Handle the possibility of a null or absent legal move where appropriate, such as a terminal position or an engine-specific response.

Do not assume that the move is suitable for the currently displayed position if the originating request has become stale.

**Acceptance criteria:** Final move responses are validated against their originating position and are applied only in the intended context.

## SECTION 319 — Implement readiness barriers

Use readiness barriers when configuration changes require the engine to finish processing earlier commands before the next operation proceeds.

Track which readiness request is outstanding and avoid interpreting an unrelated or delayed response as confirmation for a different operation.

Where the protocol does not provide a unique response identifier, enforce a controlled command sequence that prevents ambiguous overlapping barriers.

**Acceptance criteria:** Engine configuration and search startup occur in a deterministic order.

## SECTION 320 — Build protocol conformance tests

Create test cases for initialisation, readiness, supported and unsupported options, search progress, multiple principal variations, cancellation, terminal positions, malformed output, process exit, and restart.

Include protocol messages with missing optional fields and unexpected but harmless informational output.

Run these tests against the actual supported Stockfish version in integration testing and maintain separate unit tests for parsing edge cases.

**Acceptance criteria:** Protocol behaviour is verified through automated tests and genuine engine integration.

---

# PART XXXII — SEARCH EXECUTION AND RESOURCE MANAGEMENT

## SECTION 321 — Define the search-request lifecycle

Each search must progress through explicit states, such as queued, starting, running, stopping, completed, cancelled, interrupted, or failed.

Record the originating session, position identity, engine instance, search limits, start time, and completion status.

A result may update the UI only if it belongs to a valid active request or is deliberately stored as historical analysis.

**Acceptance criteria:** Search state is explicit and every result is associated with a known request.

## SECTION 322 — Support time-limited searches

Allow searches to run for a configured time budget where supported by the UCI protocol. Validate the requested duration and enforce sensible operational limits.

The displayed elapsed time must be measured using a monotonic clock where available. Wall-clock changes must not cause the timer to jump backward or forward unexpectedly.

When the budget expires, handle the engine's normal completion behaviour and collect the final available result.

**Acceptance criteria:** Time-limited searches finish predictably and report elapsed time consistently.

## SECTION 323 — Support node-limited searches

Where supported, allow users to specify a node budget. Validate the requested value and record the effective limit.

Do not interpret a node-limited search as equivalent to a time-limited search. Hardware speed, engine version, and position complexity can produce different elapsed times and analysis depths.

**Acceptance criteria:** Node-limited requests use the appropriate engine command and report their actual completion condition.

## SECTION 324 — Support depth-limited searches responsibly

Where supported, allow users to configure a search depth. Explain that depth does not represent a fixed amount of time or a universal guarantee of evaluation quality.

Protect the application from unreasonable values that could create prolonged computation or resource exhaustion. Provide safe defaults and document any supported upper limits.

**Acceptance criteria:** Depth settings affect real searches and are constrained by a documented resource policy.

## SECTION 325 — Implement multi-principal-variation searches

Configure the engine to return multiple principal variations where supported. Validate the requested number of lines against supported options and sensible resource limits.

The UI must not assume that the engine always returns the requested number of distinct lines. Some positions may produce fewer meaningful lines or incomplete output.

When displaying several lines, associate each with its own evaluation and continuation and avoid mixing information from different positions.

**Acceptance criteria:** Multiple candidate lines are displayed only when supported by actual engine output.

## SECTION 326 — Implement a search scheduler

Create a scheduler that controls engine work across Analysis Studio, the AI Arena, puzzles, training, and background analysis.

The scheduler must know which requests are interactive, which are user-triggered batch jobs, and which are low-priority background tasks. It should prevent a large whole-game analysis from making an active game unresponsive.

Define a fair and predictable scheduling policy. Where one engine instance cannot safely serve simultaneous searches, queue or cancel work rather than interleaving incompatible commands.

**Acceptance criteria:** Search scheduling protects interactive responsiveness and maintains clear ownership of each engine operation.

## SECTION 327 — Prevent stale results from changing the active board

Assign a unique identifier and position fingerprint to each search request. When a result arrives, compare it with the originating request and the current UI context.

If the user has navigated to another position, the old result may still be saved against its original analysis record, but it must not replace the evaluation displayed for the new position.

Do not rely solely on comparing move numbers because different variations can have the same ply count.

**Acceptance criteria:** Rapid navigation and overlapping requests cannot display one position's engine result as another position's evaluation.

## SECTION 328 — Implement reliable search cancellation

When a user cancels a search, send the appropriate UCI stop command and wait for the engine's expected completion response.

Do not assume that cancellation has completed immediately after sending the command. Maintain the stopping state until the engine has reached a safe protocol boundary or the process must be recovered.

If a timeout occurs, follow the documented recovery strategy rather than starting another search on an engine whose state is unknown.

**Acceptance criteria:** Cancelled searches release resources safely and cannot contaminate subsequent searches.

## SECTION 329 — Define search replacement behaviour

When a new request supersedes an existing request, determine whether the existing search should be cancelled, allowed to finish, or retained as a background job.

For interactive position navigation, stale searches should normally be cancelled or deprioritised where safe. For a batch-analysis job, previously completed positions must remain preserved.

Do not silently discard valuable completed results merely because the user opened another panel.

**Acceptance criteria:** Search replacement follows an explicit policy and preserves useful historical results.

## SECTION 330 — Establish search-resource acceptance tests

Test time limits, node limits, depth settings, multi-line searches, cancellation, request replacement, stale-result handling, and concurrent module requests.

Measure responsiveness while a long analysis job runs. Confirm that stopping one search does not accidentally stop a different engine instance's operation.

**Acceptance criteria:** Search controls are reliable, resource use is bounded, and UI state remains correct during concurrent activity.

---

# PART XXXIII — ENGINE OPTIONS, HASH MEMORY AND HARDWARE ADAPTATION

## SECTION 331 — Configure supported engine options dynamically

Read the engine's advertised options and generate the supported configuration interface from that information where practical.

Validate option types, permitted ranges, defaults, and special values. Avoid exposing options that are unsafe, unsupported, or inappropriate for the intended user.

Retain a clear distinction between engine-reported defaults and ORBIS's chosen user defaults.

**Acceptance criteria:** Engine configuration reflects the active engine's actual capabilities and rejects invalid values.

## SECTION 332 — Manage hash-table memory

Where the engine exposes a hash-size option, allow the user to configure it within a documented memory budget.

Do not automatically allocate a large hash table merely because the computer has substantial physical memory. Consider other ORBIS processes, operating-system needs, and user-selected resource limits.

If the requested size is unavailable or rejected, report the effective configuration accurately.

**Acceptance criteria:** Hash allocation respects the configured budget and does not silently claim a memory setting that was not applied.

## SECTION 333 — Configure thread count safely

Where supported, allow users to choose the engine's thread count. Provide a sensible default that balances analysis performance with desktop responsiveness.

Avoid assigning every logical CPU thread to Stockfish while the user is browsing, playing media, or running other ORBIS tasks. Allow the user to change the setting deliberately.

**Acceptance criteria:** Thread settings are applied to actual engine configuration and follow the application's resource policy.

## SECTION 334 — Handle CPU capability detection conservatively

If the application selects among engine builds, use a reliable compatibility-detection method suitable for the supported platforms.

Do not infer instruction-set support solely from an operating-system name or a broad CPU family label. If detection fails, use a compatible fallback rather than attempting a build that may crash or fail to start.

**Acceptance criteria:** Binary selection is based on validated compatibility and has a safe fallback path.

## SECTION 335 — Support an engine resource profile

Provide resource profiles such as Balanced, Performance, and Battery-Friendly where the platform and application architecture make them meaningful.

Each profile must define measurable settings such as thread allocation, search concurrency, or background-job priority. Do not claim to control power consumption precisely unless the application can measure or enforce it.

**Acceptance criteria:** Resource profiles alter actual settings and explain their intended trade-offs.

## SECTION 336 — Prevent resource contention with other ORBIS modules

Integrate engine scheduling with existing ORBIS background-work conventions where available. Avoid allowing Stockfish, indexing, media playback, and other background jobs to compete without coordination.

Where a global resource manager does not exist, implement the smallest suitable Chess World-specific mechanism without redesigning unrelated modules.

**Acceptance criteria:** Heavy chess analysis does not create avoidable starvation of other essential application functions.

## SECTION 337 — Handle memory pressure

Monitor engine and application failures that may indicate resource exhaustion. When practical, reduce background workload or offer the user a lower-resource profile.

Do not abruptly reduce an active search's settings without communicating the change. If the engine must be restarted with different options, preserve the session and record the interruption.

**Acceptance criteria:** Memory pressure produces a controlled degradation or recoverable failure rather than silent corruption.

## SECTION 338 — Implement bounded background analysis

Whole-game analysis and other batch jobs must use bounded queues and explicit concurrency limits.

Do not create an unbounded task for every position in a large game. Use incremental processing, checkpoints, cancellation, and backpressure.

If the user queues more work than can reasonably be completed, display the queue status and allow cancellation or reordering where supported.

**Acceptance criteria:** Batch workloads remain bounded in memory and can be paused, cancelled, or resumed safely.

## SECTION 339 — Expose actual engine resource status

Where measurements are available, display current search status, elapsed time, nodes searched, effective thread configuration, and other supported metrics.

Do not invent CPU utilisation, memory usage, or estimated completion time. If a measurement is unavailable, omit it or label it as an estimate.

**Acceptance criteria:** Resource indicators originate from genuine process or engine data and identify estimates honestly.

## SECTION 340 — Test resource behaviour across representative hardware

Test on representative supported configurations, including lower-resource devices and systems with differing CPU architectures.

Measure startup reliability, analysis responsiveness, memory use, cancellation latency, and coexistence with normal ORBIS activity.

Use measured results to establish sensible defaults. Do not promise identical performance on every machine.

**Acceptance criteria:** Resource defaults are evidence-based and the engine remains usable on the declared supported hardware.

---

# PART XXXIV — CHESS RULES ENGINE AND POSITION INTEGRITY

## SECTION 341 — Establish one authoritative chess-state implementation

Use one maintained, tested chess rules implementation as the authority for legal moves, position transitions, game termination, notation validation, and supported position serialization.

Inspect the existing repository for an appropriate dependency before introducing another library. If the current implementation is inadequate, document why a replacement or adapter is necessary.

Do not maintain separate independent legality implementations for the 2D board, 3D board, training modes, and engine service.

**Acceptance criteria:** All standard-chess interactions use a shared authoritative rules implementation.

## SECTION 342 — Separate rendered board state from logical position state

The rendered board is a visual representation, not the authoritative game state. Store piece placement and all required chess-state fields in the logical position model.

The model must support legal move generation, move application, move reversal or reconstruction where appropriate, and conversion to supported formats.

UI animations may temporarily display a transition, but the underlying move state must remain deterministic.

**Acceptance criteria:** Board rendering can be rebuilt entirely from logical state without losing chess information.

## SECTION 343 — Validate all user-entered moves

Before applying a move, verify that it is legal in the current position under the active ruleset.

Reject illegal moves without mutating the position, move history, clocks, annotations, or persisted game state. Provide clear feedback appropriate to the input method.

**Acceptance criteria:** Every move accepted into a standard-chess game passes the authoritative legality check.

## SECTION 344 — Implement promotion correctly

Support promotion to the permitted piece types, including queen, rook, bishop, and knight under standard chess rules.

When promotion is required, present an explicit choice or apply a clearly documented default only in contexts where that behaviour is intended. Do not automatically promote to a queen in every training context.

Ensure that notation, captured-piece handling, engine position state, move history, and export all reflect the selected promoted piece.

**Acceptance criteria:** Promotion is handled consistently across gameplay, analysis, training, persistence, and export.

## SECTION 345 — Validate castling rights and moves

Castling must obey the rules for king and rook movement, occupied squares, check, attacked transit squares, and the relevant castling rights.

Do not infer castling availability solely from the current locations of the king and rooks. Historical movement can affect the rights even if the pieces return to their original squares.

Test both sides, both colours, and positions in which castling is prohibited for different reasons.

**Acceptance criteria:** Castling legality matches the active rules implementation across the required edge cases.

## SECTION 346 — Implement en-passant state correctly

Maintain the state required to determine whether an en-passant capture is available. Clear or update it correctly after each move according to the rules.

Ensure that position serialization, move generation, repetition handling where supported, and engine input all agree on the en-passant state.

**Acceptance criteria:** En-passant availability is accurate and cannot be inferred incorrectly from piece placement alone.

## SECTION 347 — Handle check and checkmate accurately

Use the authoritative rules implementation to determine check, checkmate, and legal responses.

The UI may highlight check or display a checkmate message, but those indicators must be derived from actual game state rather than visual heuristics.

**Acceptance criteria:** Check and checkmate status is correct after every accepted move and when loading saved positions.

## SECTION 348 — Handle stalemate and draw conditions

Support the standard draw conditions implemented by the selected rules library, including stalemate, insufficient material, and relevant move-count and repetition rules.

Distinguish automatic draw conditions from situations in which a draw claim may be available under the applicable rules.

Do not treat a visually equal position as a draw unless the rules or an explicitly defined analysis feature supports that conclusion.

**Acceptance criteria:** Draw detection follows the active ruleset and correctly distinguishes automatic endings from claimable conditions.

## SECTION 349 — Maintain move history and position identity

Store a reliable move history for every game and study. Where the application needs to identify positions, use a position-identity mechanism that accounts for the relevant chess-state fields.

Do not identify positions solely by piece placement or move number. Different move histories can reach equivalent positions, while visually similar positions can have different legal options.

**Acceptance criteria:** Position identity is consistent across navigation, analysis caching, repetition tracking, and variation handling.

## SECTION 350 — Create a chess-rules regression suite

Build automated tests for opening positions, legal and illegal moves, promotion, castling, en passant, check, checkmate, stalemate, draw conditions, notation parsing, and position serialization.

Use known test positions and reference cases from appropriately licensed or public test material. Include regression tests for every discovered rules bug.

**Acceptance criteria:** Chess-rules changes cannot be released without passing the core legality and position-integrity test suite.

---

# PART XXXV — LIVE CHESS DATA: INGESTION ARCHITECTURE

## SECTION 351 — Separate live-game data from local gameplay

Live Chess data must use a dedicated ingestion and normalisation service. It must not reuse the local gameplay controller as if a remote broadcast were a game the user is playing.

The ingestion service should retrieve events, parse source-specific records, validate available game state, and publish normalised updates to the live-game presentation layer.

Live-game navigation, clocks, and move histories must remain read-only unless the provider explicitly supports a permitted interaction. Online multiplayer remains outside the initial release scope.

**Acceptance criteria:** Live-game ingestion is independent of local game control and cannot accidentally modify a user's active Stockfish game.

## SECTION 352 — Define the live-data provider interface

Create a provider interface with explicit operations for discovering games, retrieving event metadata, subscribing to updates where supported, refreshing a game record, and closing subscriptions.

Each provider adapter must declare its supported capabilities, authentication requirements, update mechanism, rate limits where documented, and data-retention restrictions.

The normalised interface should allow the UI to work with multiple providers without assuming that every provider offers identical metadata or real-time functionality.

**Acceptance criteria:** Provider-specific behaviour is isolated behind documented interfaces, and unsupported capabilities are represented explicitly.

## SECTION 353 — Implement provider-specific adapters

Build individual adapters for supported providers rather than one generic scraper that assumes all websites share the same structure.

Investigate documented interfaces such as Lichess broadcasts and supported Chess.com data interfaces. Include other sources only where their data access, terms, and technical capabilities have been verified.

Do not assume that every public tournament page exposes a stable API. If a source has no suitable supported interface, omit it or use a permitted alternative.

**Acceptance criteria:** Each adapter is based on verified source capabilities and can fail independently of other providers.

## SECTION 354 — Use documented streaming mechanisms where available

When a provider offers an appropriate documented streaming, server-sent events, WebSocket, or equivalent update mechanism, use it according to the provider's requirements.

Do not introduce an unnecessary relay server merely because the UI needs updates. Determine whether the desktop application can connect safely and directly or whether the provider's documented architecture requires another component.

A persistent connection must have explicit connection state, cancellation, timeout, and reconnection behaviour.

**Acceptance criteria:** Streaming is used only where supported and is managed through a well-defined lifecycle.

## SECTION 355 — Use responsible polling as a fallback

If a provider does not expose a suitable streaming interface, use documented refresh mechanisms or polling within its permitted request limits.

Choose a refresh interval based on the provider's publication frequency, rate limits, and actual game-update needs. Use backoff when requests fail and avoid multiplying requests unnecessarily when many games are visible.

Do not describe polling as instantaneous. The UI should communicate that update speed depends on the provider and network.

**Acceptance criteria:** Polling respects provider limits and adapts responsibly to errors and update frequency.

## SECTION 356 — Normalise live-game metadata

Convert provider-specific records into a common internal representation containing available fields such as game identifier, event identifier, tournament name, player names, ratings where supplied, current position, move sequence, result, clock data, source timestamp, and retrieval timestamp.

Every field must remain optional where providers do not supply it. Preserve the original provider identity and source record reference.

Do not fabricate missing player ratings, tournament names, game results, or clocks.

**Acceptance criteria:** Normalised records preserve genuine source data and accurately represent missing fields.

## SECTION 357 — Preserve provider event identity

Assign stable local references to provider events and games. Use provider identifiers where reliable and retain the provider name as part of the identity.

Do not rely solely on player names or event titles to identify a game, because these may be duplicated, changed, or missing.

If an identifier changes or becomes unavailable, use a documented reconciliation method and avoid silently merging unrelated games.

**Acceptance criteria:** Games remain distinguishable across refreshes and provider-specific metadata changes.

## SECTION 358 — Validate incoming live-game records

Validate incoming records before publishing them to the UI. Check required structural fields, move syntax, position consistency where reconstructable, timestamp validity, and plausible state transitions.

A record that cannot be fully reconstructed may still provide useful event information, but the UI must clearly identify the unavailable or invalid portion.

Do not replace a valid previously received position with a malformed update without an explicit recovery decision.

**Acceptance criteria:** Invalid feed events are isolated, diagnosed, and prevented from corrupting the active live-game state.

## SECTION 359 — Maintain a source-freshness model

Track when the provider says an update occurred, when ORBIS received it, and when the UI processed it, where those timestamps are available.

Use a monotonic local clock for measuring elapsed processing time. Handle missing, delayed, or inconsistent provider timestamps explicitly.

Display the difference between source delay and application processing delay where useful. Do not claim that a feed is live merely because the local polling loop runs frequently.

**Acceptance criteria:** Freshness information is based on actual timestamps and distinguishes provider delay from local processing delay.

## SECTION 360 — Establish live-ingestion acceptance tests

Create tests for provider discovery, metadata normalisation, valid and invalid moves, duplicate events, delayed updates, out-of-order events, source outages, and rate-limit responses.

Use deterministic recorded fixtures for unit tests, but clearly label them as test fixtures. Genuine provider integration tests must be performed separately and must not claim that a simulated feed proves current provider availability.

**Acceptance criteria:** Live-ingestion tests cover both normal operation and failure conditions, with simulated and real-provider tests reported separately.

---

# PART XXXVI — LIVE-GAME EVENT ORDERING AND SYNCHRONISATION

## SECTION 361 — Define a canonical live-game state model

Represent each live game with a stable source identifier, normalised move history, current position, available clocks, result state, last confirmed source event, freshness status, and subscription state.

Keep the source's raw event information where appropriate for diagnostics and reconciliation, subject to retention rules.

Do not let the displayed board become the authoritative record independently of the normalised game state.

**Acceptance criteria:** Live-game UI can be reconstructed from the normalised state and validated source events.

## SECTION 362 — Handle duplicate update events

Providers may resend the same event after reconnecting or retrying. Detect duplicates using reliable event identifiers, move sequence information, or a carefully defined fallback.

A duplicate move event must not be appended twice or advance a move counter incorrectly. Duplicate metadata updates should not trigger unnecessary board animations or repeated notifications.

**Acceptance criteria:** Replaying the same provider event does not corrupt the move history or produce duplicate user-visible actions.

## SECTION 363 — Handle out-of-order events

If an event arrives with an older sequence number or inconsistent state, do not blindly apply it after a newer confirmed update.

Use provider sequence information where available. Otherwise, compare the received record with the current validated move history and determine whether it can be reconciled safely.

If ordering cannot be established, request a fresh authoritative snapshot or mark the state as requiring reconciliation.

**Acceptance criteria:** Out-of-order events cannot silently roll back a valid game state.

## SECTION 364 — Reconcile missed moves after disconnection

When a subscription resumes after a network interruption, the provider may deliver a snapshot or a sequence of missed updates.

Reconcile the received information with the last confirmed state. Append only the missing valid moves, or replace the reconstructed state from a verified snapshot when necessary.

If the source has changed the record or corrected an earlier move, identify the discrepancy and follow a documented correction policy rather than assuming that all differences are new moves.

**Acceptance criteria:** Reconnection restores the current supported source state without duplicating moves or fabricating missing events.

## SECTION 365 — Distinguish snapshots from incremental events

A snapshot describes the source's state at a particular point, while an incremental event describes a change. Model these operations separately.

Do not append a full snapshot's entire move history as though every move were newly played. Compare it with the current state and apply a reconciliation procedure.

**Acceptance criteria:** Snapshot ingestion and incremental event ingestion have distinct, tested semantics.

## SECTION 366 — Implement live-update sequencing

Maintain the order of incoming events within each game stream. If the provider exposes a sequence number or event version, validate it before applying updates.

When no sequence number exists, use a combination of source timestamps, move history, and state comparison, while acknowledging ambiguity where necessary.

**Acceptance criteria:** Each game maintains a coherent update order, with explicit recovery for ambiguous sequences.

## SECTION 367 — Prevent stale subscriptions from overwriting newer state

When the user switches games or refreshes a subscription, assign a new subscription generation or equivalent token.

Any delayed callback from an obsolete subscription must be prevented from updating the current game view. It may be logged or reconciled separately if still useful.

**Acceptance criteria:** Late events from old subscriptions cannot overwrite the currently selected game's state.

## SECTION 368 — Implement backpressure for high-frequency updates

If the provider produces updates faster than the UI can render them, avoid building an unbounded queue of redundant visual updates.

Preserve every move required to reconstruct the game, but coalesce replaceable metadata updates and defer nonessential rendering work.

The UI should remain responsive when monitoring many games or receiving a burst of events after reconnection.

**Acceptance criteria:** High-frequency feeds do not create unbounded memory growth or freeze the interface.

## SECTION 369 — Maintain source correction history

If a provider corrects or revises a game record, preserve enough information to understand the change where permitted and useful.

Distinguish a source correction from a normal move. Update the current state only after validation and ensure that any previously generated analysis is marked outdated if its underlying position has changed.

**Acceptance criteria:** Source corrections are reconciled transparently and invalidate dependent results when appropriate.

## SECTION 370 — Test live-state synchronisation comprehensively

Test normal move progression, duplicate events, missing events, out-of-order events, snapshot reconciliation, source corrections, game switching, and delayed callbacks.

Verify that the displayed board, move list, player-to-move indicator, clock state, and source-freshness status refer to the same canonical live-game state.

**Acceptance criteria:** Synchronisation tests demonstrate correct recovery from common event-delivery failures.

---

# PART XXXVII — LIVE CLOCKS AND GAME STATUS

## SECTION 371 — Model clock data explicitly

Represent clock information as source-provided data with a timestamp and a documented interpretation. Do not treat a clock display as a static string if the provider supplies a usable clock value and timestamp.

Store the available time control and increment information where provided. Do not infer a time control merely from the apparent rate at which a clock decreases.

**Acceptance criteria:** Clock data remains traceable to the source and contains the context needed for correct display.

## SECTION 372 — Separate received clock values from displayed countdowns

When a provider supplies a timestamped clock value, the UI may estimate a continuously changing display using the elapsed time since that timestamp, but only if the source's clock semantics are known.

Mark such a value as a local display estimate where appropriate. When a new authoritative update arrives, reconcile the estimate with the new source value.

Do not pretend that a locally estimated countdown is an authoritative clock reading from the tournament.

**Acceptance criteria:** Clock displays distinguish received values from locally extrapolated values.

## SECTION 373 — Handle missing clock information

Some feeds may publish moves without reliable clock values. In such cases, display the clock as unavailable or omit it according to the layout.

Do not initialise both players' clocks to arbitrary values merely to make the board appear complete.

**Acceptance criteria:** Missing clock data is represented honestly without preventing game playback or analysis.

## SECTION 374 — Validate clock transitions

When the source provides sufficient information, check that clock updates are structurally valid and associated with the correct player and position.

Do not reject a source record solely because a clock increased: increments, corrections, and provider-specific semantics may explain the change.

If the clock behaviour appears inconsistent and cannot be reconciled, mark it uncertain rather than displaying false precision.

**Acceptance criteria:** Clock validation accounts for known time-control behaviour and flags unresolved inconsistencies.

## SECTION 375 — Model live-game status

Represent supported statuses such as scheduled, not started, in progress, completed, abandoned, unavailable, and unknown, subject to the provider's actual data.

Do not infer that a game is completed merely because the feed temporarily stopped updating. A disconnected or stale game is not necessarily over.

**Acceptance criteria:** Status indicators reflect provider evidence and distinguish termination from connectivity problems.

## SECTION 376 — Handle result corrections

If the provider revises a result, update the displayed record according to a documented reconciliation policy.

Preserve the source result and update timestamp where appropriate. If the new result conflicts with the current move record, mark the record as inconsistent until a reliable state can be established.

**Acceptance criteria:** Result changes are handled explicitly and do not silently corrupt archived games.

## SECTION 377 — Identify stale games

Use source timestamps, update intervals, provider status, and connection state to identify potentially stale games.

Choose stale thresholds appropriate to the provider and its expected publication frequency. Do not apply one universal timeout to every source.

A stale indicator must explain that the displayed position may no longer be current. It must not automatically label the game abandoned.

**Acceptance criteria:** Staleness is determined through documented, provider-aware rules.

## SECTION 378 — Display live status and freshness clearly

Present a clear visual distinction between a live-updating game, a completed game, a stale record, and an unavailable feed.

Avoid decorative animations that imply active updates when no new source data is arriving. A live indicator must be connected to the actual subscription or refresh state.

**Acceptance criteria:** Users can distinguish active data delivery from cached playback or stale information.

## SECTION 379 — Synchronise clocks and board updates

When a new move and clock update belong to the same provider event or snapshot, apply them as a coherent state transition where possible.

Avoid showing the new board with the previous player's clock state for a prolonged period. If the source publishes the components separately, use a documented reconciliation strategy.

**Acceptance criteria:** Board, clock, and move indicators remain consistent to the extent permitted by the source.

## SECTION 380 — Establish clock and status acceptance tests

Test timestamp drift, missing clocks, increments, clock corrections, stale feeds, result revisions, completed games, and disconnections.

Use recorded test cases for deterministic validation and separately verify actual provider behaviour during integration testing.

**Acceptance criteria:** Clock and status displays remain honest and consistent across supported source conditions.

---

# PART XXXVIII — LIVE-GAME DISCOVERY AND NAVIGATION

## SECTION 381 — Build a provider-aware live-game discovery service

Create a service that discovers games from supported providers and exposes the available records through a common interface.

Discovery must use real provider data and respect documented access rules. The service must not populate the dashboard with fabricated tournament names, player pairings, ratings, or game statuses.

If no supported source currently provides games, display a genuine empty or unavailable state rather than manufactured content.

**Acceptance criteria:** Every discoverable live game originates from a real supported data source.

## SECTION 382 — Distinguish events, rounds, and individual games

Represent tournaments or broadcast events, rounds or stages where supplied, and individual games as distinct entities.

Allow users to navigate from an event to its available rounds and games without assuming every provider has the same hierarchy.

Do not invent a round structure for sources that expose only individual games.

**Acceptance criteria:** Discovery navigation reflects the source's actual data structure.

## SECTION 383 — Provide live-game filtering

Where the source supplies suitable metadata, allow filtering by event, player, result status, round, and other useful fields.

Filters must be based on actual metadata. Missing ratings or player names must not be replaced with guessed values.

The UI should make clear when a filter is unavailable because the source does not provide the necessary field.

**Acceptance criteria:** Filters produce accurate results and gracefully handle incomplete provider metadata.

## SECTION 384 — Implement game search

Allow users to search discovered or archived games using available player names, event names, provider identifiers, and other supported metadata.

Use a local index where useful, and query remote providers only through their documented search or discovery capabilities.

Do not imply that a search covers every chess game played online or every tournament in progress.

**Acceptance criteria:** Search scope is clear and results correspond to actual available records.

## SECTION 385 — Build a live-game detail view

The detail view should display the selected game's board, move list, available clocks, player information, event metadata, source status, and analysis actions.

Show unavailable fields honestly. The layout should remain useful when a provider offers only a minimal move stream.

**Acceptance criteria:** The detail view works with both rich and minimal source records without fabricated metadata.

## SECTION 386 — Support multiple monitored games

Allow users to browse multiple available games and choose which ones to open or monitor.

Apply reasonable subscription and polling limits so the application does not create excessive network activity merely because many games are visible.

When switching between games, preserve each game's state and prevent callbacks from the previous selection from modifying the current view.

**Acceptance criteria:** Multi-game monitoring remains resource-bounded and game-state isolated.

## SECTION 387 — Implement live-game favourites

Allow users to mark games, players, or events as favourites where the relevant entity exists in the provider's data model.

Persist favourites locally and make it clear that they are personal ORBIS preferences rather than subscriptions controlled by the source provider.

If a provider removes a game from discovery, retain the favourite reference with an unavailable status rather than inventing a current record.

**Acceptance criteria:** Favourites persist locally and handle source disappearance gracefully.

## SECTION 388 — Open completed live games in Analysis Studio

When a supported provider makes a completed game record available, provide an action to open it in Analysis Studio.

Validate the received move sequence and retain source metadata. If the record is incomplete or malformed, explain the limitation and offer supported partial recovery where safe.

Do not assume that every live game will remain available indefinitely from its original provider.

**Acceptance criteria:** Completed games can be analysed when valid records are available, with their source provenance preserved.

## SECTION 389 — Preserve local game archives independently of discovery

Where permitted by the source's terms, allow users to save completed game records locally. Store the retrieved move sequence, available metadata, source identifier, and retrieval timestamp.

Do not rely on the provider's future availability as the only way to reopen a record the user has legitimately saved.

Respect any restrictions on long-term storage or redistribution.

**Acceptance criteria:** Permitted saved records remain accessible locally and retain their provenance.

## SECTION 390 — Establish live-discovery acceptance tests

Test empty discovery, active events, multiple rounds, incomplete metadata, favourites, search, multiple monitored games, completed-game handoff, and source disappearance.

Verify that the application never invents games to fill a dashboard and does not claim universal provider coverage.

**Acceptance criteria:** Live discovery presents genuine available data and handles missing or unavailable sources honestly.

---

# PART XXXIX — NETWORK RECOVERY, RATE LIMITING AND OBSERVABILITY

## SECTION 391 — Implement bounded reconnect behaviour

For persistent provider connections, implement a reconnection strategy with appropriate delays, maximum retry policies, and cancellation.

Use exponential backoff or another documented strategy suited to the provider's requirements. Add jitter where appropriate to avoid synchronised reconnection bursts.

Do not retry indefinitely at a high frequency when the provider is unavailable or has rejected access.

**Acceptance criteria:** Reconnection is controlled, cancellable, and respectful of provider availability and rate limits.

## SECTION 392 — Handle rate-limit responses

Recognise documented rate-limit responses and provider guidance. Reduce request frequency and honour any supplied retry information where applicable.

Do not repeatedly retry a rate-limited request as though it were a transient network timeout.

Expose a useful status to the user and retain previously received data with an appropriate freshness indicator.

**Acceptance criteria:** Rate limiting triggers a controlled response rather than an aggressive retry loop.

## SECTION 393 — Define network timeout policies

Set explicit connection, response, and inactivity timeouts appropriate to each provider's documented interface.

Distinguish a slow response from a rejected request, a closed subscription, and a valid empty result.

When a timeout occurs, preserve useful cached information and report the source as delayed or unavailable as appropriate.

**Acceptance criteria:** Network operations terminate or recover within documented limits and produce meaningful error states.

## SECTION 394 — Prevent request storms

Deduplicate equivalent requests and share compatible discovery work among interested UI components.

When several visible games require updates, schedule requests according to provider limits instead of launching one uncontrolled polling loop per component.

Cancel unnecessary requests when the relevant view is closed, while retaining operations required for explicitly configured background monitoring.

**Acceptance criteria:** Network traffic remains bounded as the number of visible games and UI components increases.

## SECTION 395 — Define live-data caching policy

Cache provider responses only as permitted by the source's terms and the user's selected preferences.

Distinguish transient transport cache, normalised live state, and user-saved game records. These categories have different retention and deletion rules.

A cache must not be treated as authoritative current data after it becomes stale.

**Acceptance criteria:** Caching follows explicit retention rules and cannot make stale information appear current.

## SECTION 396 — Add structured provider diagnostics

Record useful operational information such as provider identifier, request type, response category, latency, retry count, last successful update, and parsing failure category.

Avoid logging authentication secrets, unnecessary personal information, or complete private game annotations.

Diagnostics should help distinguish source outages, network failures, parsing errors, and application bugs.

**Acceptance criteria:** Provider failures can be investigated from local diagnostics without exposing sensitive data.

## SECTION 397 — Implement per-provider circuit breaking

Where a provider repeatedly fails, temporarily reduce or stop requests according to a documented circuit-breaker policy.

Allow the service to recover after an appropriate interval or an explicit retry action. Do not allow one failing provider to block all other live-game sources.

The circuit breaker must distinguish temporary transport failure from a permanent configuration or permission error.

**Acceptance criteria:** Repeated provider failures are contained and other supported providers remain usable.

## SECTION 398 — Handle provider schema changes safely

Validate responses against the expected data model and tolerate unrelated additional fields where appropriate.

If a required field changes or disappears, stop processing the affected record rather than interpreting it incorrectly. Report a structured parsing error and retain previously validated data when safe.

Do not automatically scrape unrelated page elements as a silent fallback if a documented interface changes.

**Acceptance criteria:** Provider schema changes result in controlled degradation and actionable diagnostics.

## SECTION 399 — Monitor end-to-end update latency

Measure the available stages of live-data delivery, including source timestamp when supplied, local receipt, parsing, normalisation, state application, and UI update.

Report latency components only when the necessary timestamps exist. Account for clock differences between the provider and local machine rather than subtracting unrelated wall-clock values without qualification.

Use measurements to identify application processing delays and unnecessary queueing. Do not promise that every source will deliver moves instantaneously.

**Acceptance criteria:** Latency measurements distinguish measurable local processing time from uncertain or source-dependent delay.

## SECTION 400 — Establish the fourth milestone acceptance gate

Before proceeding, verify the complete engine and live-data foundations using genuine supported components.

### Engine verification

1. Discover and validate a supported Stockfish executable.
2. Complete the UCI handshake.
3. Read engine identity and supported options.
4. Configure the engine safely.
5. Analyse a valid position.
6. Parse genuine evaluations and principal variations.
7. Handle missing optional fields.
8. Cancel a search and recover the engine to a safe state.
9. Prevent stale results from updating the wrong position.
10. Shut down and restart the engine without losing the chess session.

### Chess-rules verification

11. Validate ordinary legal and illegal moves.
12. Test promotion, castling, and en passant.
13. Test checkmate, stalemate, and supported draw conditions.
14. Verify FEN and PGN processing.
15. Confirm that variations preserve the correct parent position and move history.

### Live-data verification

16. Discover games from a genuine supported provider.
17. Validate incoming records.
18. Apply incremental updates without duplicating moves.
19. Recover after a disconnected feed.
20. Reconcile missed or out-of-order events.
21. Display source freshness accurately.
22. Handle missing or unreliable clocks.
23. Respect provider rate limits.
24. Open a valid completed game in Analysis Studio.
25. Preserve source provenance and comply with applicable retention requirements.

### Operational verification

26. Test malformed engine output and unexpected process termination.
27. Test network outages, timeouts, rate limits, and provider schema changes.
28. Confirm that one provider's failure does not disable unrelated sources.
29. Measure engine responsiveness during background analysis.
30. Confirm that all personal chess records remain within the correct local ORBIS profile.
31. Verify that no unsupported online multiplayer functionality has been introduced.
32. Run regression tests against existing ORBIS and Orion behaviour.

The milestone is complete only when these behaviours are implemented and verified. A working-looking board, a mock engine response, a static tournament list, or a simulated stream does not constitute a successful integration.

**Acceptance criteria:** ORBIS Chess World has a reliable local Stockfish service, a tested chess-state implementation, and a resilient live-data ingestion foundation that uses genuine supported sources.

---

# END OF PART 4 — SECTIONS 301–400

## REQUIRED CONTINUATION

The next part must begin at **SECTION 401** and continue sequentially.

Part 5 should go deeper into the remaining production engineering work:

* PGN parsing and export edge cases.
* FEN, SAN, UCI move notation, and variant-aware serialization.
* Local database schema, indexing, transactions, and migrations.
* Analysis-result caching and cache invalidation.
* Game archive integrity and duplicate resolution.
* Profile isolation and secure local persistence.
* Background jobs, worker isolation, concurrency, and cancellation.
* Renderer responsiveness and memory management.
* Logging, diagnostics, error reporting, and support workflows.
* Automated tests, end-to-end testing, release gates, packaging, and upgrade safety.

All prior requirements remain active. ORBIS Chess World must be an additive feature inside the existing ORBIS desktop application. Stockfish remains the primary local engine; live-game updates must use genuine supported provider data; personal chess data stays local by default; online multiplayer remains deferred; and no fabricated games, engine results, or feed updates may be presented as genuine.

The implementation agent must inspect the actual repository, reuse appropriate infrastructure, avoid placeholders and dummy functionality, and verify every released capability with meaningful tests.

# ORBIS CHESS WORLD

## MASTER BUILD SPECIFICATION — PART 5 OF 5

### SECTIONS 401–500: FINAL IMPLEMENTATION, DATA INTEGRITY, PERFORMANCE, TESTING, RELEASE ENGINEERING, AND PRODUCTION ACCEPTANCE

---

# MANDATORY EXECUTION DIRECTIVE

You are continuing the implementation of **ORBIS Chess World**, an extensive, integrated chess environment inside the existing ORBIS desktop application.

This is the final segment of the five-part master specification. It contains Sections 401–500 and must be implemented in continuity with Sections 001–400.

**Do not interpret this final part as permission to rush, simplify, replace, or skip previously specified features.** The goal is a complete, coherent, dependable chess environment whose components work together as a real product.

Before making changes:

1. Inspect the existing repository and the implementation produced by Sections 001–400.
2. Identify which requirements are already implemented, partially implemented, missing, broken, or implemented differently from the specification.
3. Read the relevant application entry points, navigation, state management, storage services, profile management, chess rules, engine integration, live-game services, UI components, tests, and build configuration.
4. Identify existing ORBIS conventions and reuse them wherever appropriate.
5. Preserve all working functionality. Make additive, targeted changes instead of replacing entire systems unnecessarily.
6. Create a requirement-to-implementation map so every section below can be traced to actual code and tests.
7. Implement real functionality. Do not substitute mock games, fabricated engine evaluations, fake progress, static result screens, decorative controls, or simulated successful operations for unfinished functionality.
8. Add automated tests alongside implementation rather than postponing all testing until the end.
9. Run the actual available checks, resolve failures, and report anything that remains incomplete honestly.
10. Do not claim that a requirement is complete merely because a corresponding UI component exists.

The 100 sections below are mandatory engineering requirements. They are not suggestions to ignore when inconvenient.

If the repository already contains a suitable implementation, validate it and improve it where necessary. Do not duplicate an existing service simply to satisfy a section.

If a requirement conflicts with the current repository's established architecture, investigate the conflict and choose the smallest safe architectural change that preserves ORBIS compatibility. Document the decision.

---

# PART I — PGN, FEN, NOTATION, AND CHESS-DATA CORRECTNESS

## SECTION 401 — Production-Grade PGN Import and Parsing

Implement or harden a proper Portable Game Notation (PGN) import pipeline.

PGN must be treated as structured chess data, not as ordinary text that can be split on spaces and interpreted with a collection of fragile regular expressions.

The parser must support, as applicable:

* Standard PGN tag pairs.
* Event, site, date, round, white player, black player, result, and player-rating metadata.
* Additional valid tag pairs.
* Standard algebraic notation.
* Move numbers and move-number variations.
* Comments before, between, and after moves.
* Brace-delimited comments.
* Semicolon-delimited line comments.
* Parenthesised variations.
* Nested variations where supported by the chosen parser.
* Game termination markers.
* Check and checkmate suffixes.
* Annotation symbols.
* Null or unavailable metadata where valid.
* Multiple games in a single file.
* UTF-8 text and ordinary text-file line endings.
* Empty games and metadata-only records where the parser and import policy permit them.

Use a maintained parser or a well-tested implementation compatible with the repository's chess-rules library. Do not build a second chess notation engine unnecessarily.

The importer must distinguish syntactic parsing from legal-move validation.

A file can be syntactically readable while containing illegal moves. It must not be silently accepted as a completely valid game in that case.

For each imported game, produce a structured record containing:

* Parsed metadata.
* The starting position.
* The ordered mainline.
* Optional variation trees.
* Comments and annotations.
* Move numbers and side-to-move information.
* Game termination information.
* Validation status.
* Import warnings and errors.
* Source-file identity.
* Import timestamp.
* A stable internal identifier.

**Acceptance criteria:**

A valid multi-game PGN imports every game correctly. An invalid game produces a useful error identifying the affected game and, when available, the move or position responsible. One malformed game must not corrupt previously imported games.

## SECTION 402 — PGN Error Recovery and Partial-Import Policy

Implement a deliberate policy for malformed PGN files.

The system must distinguish at least:

1. A file that cannot be decoded or read.
2. A file that contains no recognisable game records.
3. A file with malformed metadata.
4. A file with syntactically invalid move notation.
5. A file with an illegal move.
6. A file containing a valid game followed by a malformed game.
7. A file containing truncated data.
8. A file with a recoverable annotation or comment issue.
9. A file with an unsupported notation extension.
10. A file that exceeds configured resource limits.

When possible, recover valid games without concealing the existence of invalid records.

Present an import summary showing the number of successfully imported games, skipped games, warnings, and errors.

For partial imports, provide an appropriate choice between importing valid games and cancelling the import. Do not silently discard invalid records.

The parser must never attempt unbounded recovery by repeatedly rescanning a large file or indefinitely retrying the same malformed token.

Record diagnostic information without logging private file contents unnecessarily.

**Acceptance criteria:** A multi-game file with a valid first game and an invalid second game preserves the valid game's parsed data and accurately reports the second game's failure.

## SECTION 403 — PGN Export Fidelity

Implement reliable PGN export from the application's canonical game representation.

Export must preserve all supported information, including:

* Player names and ratings.
* Event metadata.
* Date and round.
* Result.
* Custom tags.
* Starting position when supported by the source game.
* Mainline moves.
* Comments.
* Annotations.
* Variations.
* Promotion moves.
* Castling notation.
* Check and checkmate notation.
* Game termination markers.

Escape tag values correctly. Handle quotation marks, backslashes, unusual names, and non-ASCII text according to PGN requirements.

Use a stable, readable line-wrapping policy.

Export must not mutate the underlying game or change its current position in the UI.

Provide clear policies for unavailable metadata and unsupported annotation types. Never invent a player name, tournament, rating, date, or result merely to fill an export field.

If a game was imported with a nonstandard starting position, preserve the required starting-position information so the exported move sequence remains interpretable.

**Acceptance criteria:** Importing a supported PGN, exporting it, and importing the export again must preserve the legal mainline, result, supported metadata, and supported annotations.

## SECTION 404 — FEN Validation and Position Reconstruction

Implement a robust Forsyth–Edwards Notation (FEN) service using the project's canonical chess-rules implementation.

Validate:

* Board dimensions and rank encoding.
* Piece symbols.
* Rank lengths.
* Exactly one king per side where required by the rules library's validation policy.
* Active colour.
* Castling rights.
* En-passant target representation.
* Halfmove clock.
* Fullmove number.
* General syntactic validity.
* Position-level legality where the selected library can determine it.

Do not assume that syntactically valid FEN necessarily represents a reachable or legally sensible chess position.

The application must clearly distinguish:

* Invalid FEN syntax.
* Syntactically valid but illegal positions.
* Positions that are structurally acceptable but have unusual or unverifiable history.
* Valid positions suitable for the requested operation.

Provide useful errors instead of a generic "Invalid FEN" message wherever practical.

Allow valid positions to be reconstructed without requiring an entire PGN game.

**Acceptance criteria:** Known valid positions reconstruct exactly, and malformed rank encodings, invalid piece symbols, and invalid field counts are rejected.

## SECTION 405 — SAN, UCI, and Internal Move Representation

Establish one canonical internal representation for chess moves.

The application must not rely on display notation as its primary move identity.

A move should be represented by the information required by the chosen rules library, including origin square, destination square, and promotion piece when applicable.

Convert between:

* Internal move representation.
* Standard Algebraic Notation (SAN).
* UCI move notation.
* Human-readable move labels.

The conversion layer must correctly handle:

* Ambiguous piece moves.
* Disambiguation by file or rank.
* Captures.
* Check.
* Checkmate.
* Castling.
* Promotions.
* En passant.
* Move-number formatting.
* Position-dependent notation.

Never convert moves using assumptions that are valid only in the initial chess position.

SAN is position-dependent. The same coordinate move can require different notation in different positions.

Validate every incoming engine move against the position for which it was requested.

**Acceptance criteria:** SAN and UCI conversion tests pass for representative opening, tactical, castling, en-passant, promotion, and checkmate positions.

## SECTION 406 — Chess Variants and Unsupported-Position Policy

Define the precise scope of supported chess variants.

Standard chess must remain the primary, fully supported ruleset unless another variant has been deliberately implemented and tested.

Do not allow a UI label to imply that Chess960, Chess960 castling, three-check, atomic chess, crazyhouse, or other variants are supported merely because an imported file mentions them.

When a PGN, FEN, or game source indicates a variant:

1. Identify the variant when possible.
2. Determine whether the rules engine supports it.
3. Determine whether the configured Stockfish binary and protocol support it.
4. Verify that analysis and move generation use the same ruleset.
5. Disable incompatible operations when necessary.
6. Explain the limitation to the user.
7. Preserve the original source data when safe and useful.

If a variant is unsupported, do not reinterpret its moves as standard chess.

Do not let variant-specific castling rules, piece movement, promotion, or position semantics leak into ordinary chess logic.

**Acceptance criteria:** Unsupported variant records are identified explicitly and never silently analysed as ordinary standard-chess games.

## SECTION 407 — Notation Round-Trip and Canonical Data Tests

Create a dedicated notation regression suite.

Include fixtures covering:

* Short opening games.
* Long games.
* Checkmates.
* Stalemates.
* Threefold-repetition claims and automatic draw cases as applicable.
* Fifty-move-rule claims and automatic draw cases as applicable.
* Promotions.
* En passant.
* Castling.
* Ambiguous moves.
* Imported custom starting positions.
* Games with nested variations.
* Comments containing punctuation.
* Unicode player names.
* Missing metadata.
* Malformed PGN.
* Unsupported variants.
* Large multi-game archives.

Where notation round-trips are tested, compare canonical chess positions and move semantics rather than requiring every parser to reproduce identical whitespace.

Use known legal positions and independently verified fixtures.

Do not create a test that merely checks whether a parser returned a non-null object.

**Acceptance criteria:** The suite detects incorrect move order, lost promotions, lost starting positions, corrupted comments, and invalid position transitions.

## SECTION 408 — File Size, Encoding, and Resource Limits

Protect PGN, FEN, and import services against malformed or excessively large inputs.

Define configurable limits for:

* File size.
* Number of games.
* Number of moves per game.
* Variation count or nesting depth.
* Comment length.
* Total parsed nodes.
* Parsing time where practical.
* Maximum in-memory representation size.

Choose defaults appropriate to real chess archives and allow legitimate large files to be handled through streaming or bounded batches.

Do not impose arbitrary limits so low that normal tournament databases become unusable.

Detect unsupported encodings and malformed byte sequences. Use safe decoding policies and explain when data may have been replaced or rejected.

Perform large-file parsing off the UI thread.

Provide progress updates when an import is long enough to justify them, and make cancellation responsive.

**Acceptance criteria:** A large supported archive imports without freezing the interface or exceeding configured resource limits. A deliberately oversized file is rejected or processed in bounded batches.

## SECTION 409 — Import Preview and Transactional Commit

Separate the preview stage from the permanent import stage.

Before committing, present relevant information such as:

* Source filename.
* File type.
* Number of detected games.
* Number of valid and invalid games.
* Duplicate count or estimate when available.
* Destination library.
* Existing records that may be affected.
* Any relevant warnings.

The user must understand whether the operation adds new games, updates matching records, skips duplicates, or creates separate copies.

Use a transaction or staged-commit design appropriate to the selected database.

If an import fails midway, avoid leaving partially written records that appear complete.

Cancellation must stop new work and clean up temporary state. It must not delete unrelated existing records.

For very large imports, commit in controlled batches while maintaining a clear import-job status and recovery policy.

**Acceptance criteria:** A failed import can be retried without duplicating successfully committed games or damaging unrelated records.

## SECTION 410 — Notation and Import Completion Gate

Before proceeding to the remaining sections, verify the complete import/export path.

Required tests:

1. Import a valid single-game PGN.
2. Import a valid multi-game PGN.
3. Import a PGN containing comments and variations.
4. Import a PGN beginning from a custom FEN.
5. Import a file containing one valid and one invalid game.
6. Export a game and reimport it.
7. Open a FEN directly in Analysis Studio.
8. Reject an unsupported variant without silently changing its rules.
9. Cancel a large import.
10. Restart the application after an import and confirm that committed data remains valid.

Record failures and resolve them before marking the notation subsystem complete.

---

# PART II — LOCAL DATABASE, SCHEMA, TRANSACTIONS, AND MIGRATIONS

## SECTION 411 — Define the Canonical Local Chess Data Model

Design one coherent canonical data model for Chess World.

Reuse an existing database technology already established in ORBIS when it satisfies the requirements. Do not introduce a second database engine without a concrete architectural justification.

The model should cover the entities that are genuinely needed, such as:

* Local chess profiles or profile references.
* Games.
* Game metadata.
* Game moves.
* Variation trees.
* Game annotations.
* Analysis sessions.
* Engine configurations.
* Analysis results.
* Evaluation samples.
* Opening references.
* Opening repertoire entries.
* Puzzle records.
* Puzzle attempts.
* Academy lessons.
* Academy progress.
* Spaced-repetition state.
* Training sessions.
* User-created positions.
* Live-game snapshots.
* Live-game event records where useful.
* Favourite games and players.
* Import jobs.
* Export jobs.
* Background-job state where persistence is required.
* Schema version.
* Data provenance and source attribution.

Do not create a separate table for every UI component. Model durable domain concepts rather than screen layouts.

Keep derived values separate from authoritative records when they can be recalculated.

Document primary keys, relationships, uniqueness constraints, deletion behaviour, and profile ownership.

**Acceptance criteria:** Each persistent chess feature has a defined ownership and storage path. No feature creates unstructured duplicate state in several unrelated locations.

## SECTION 412 — Database Indexing and Query Design

Identify actual query patterns before adding indexes.

Typical query patterns include:

* Recent games.
* Games filtered by player.
* Games filtered by event or date.
* Games by result.
* Games with a specific starting position.
* Favourites.
* Opening repertoire entries.
* Puzzle history.
* Academy progress.
* Analysis sessions for a game.
* Analysis cache lookups.
* Live-game history.
* Search by player or event name.

Add indexes that materially improve these queries without creating unnecessary write overhead.

Use appropriate composite indexes for common multi-column filters.

Avoid storing large PGN documents, entire engine logs, and repeated analysis payloads in every row if a normalized or separately stored representation is more appropriate.

Inspect actual query plans when performance is uncertain.

Do not add full-text search infrastructure solely because a search box exists. Start with a suitable local search implementation and expand when justified.

**Acceptance criteria:** Common library and progress queries remain responsive with a realistically sized local dataset, and the database has no obvious unbounded full-table scans in frequently used paths without justification.

## SECTION 413 — Transaction Boundaries and Atomic Updates

Define explicit transaction boundaries for multi-record operations.

Examples include:

* Importing a game and its moves.
* Committing an analysis session and its results.
* Saving a repertoire entry and associated metadata.
* Updating puzzle progress and rating.
* Recording an academy assessment.
* Deleting a game and its owned analysis records.
* Applying a schema migration.
* Replacing a cached analysis record.

Use the database's supported transaction mechanism.

Do not simulate atomicity by issuing a sequence of unrelated writes and hoping they all succeed.

Ensure that transaction scopes are short enough to avoid unnecessarily blocking the UI or unrelated work.

Handle transaction failures, disk-full errors, lock contention, and process interruption.

**Acceptance criteria:** Injected write failures do not leave a game without required metadata or an analysis session marked complete without its corresponding committed result.

## SECTION 414 — Database Migration Framework

Implement a versioned schema migration system.

Every migration must:

* Have a unique version.
* Be ordered deterministically.
* Be applied only when required.
* Complete successfully before the application uses the affected schema.
* Be safe to retry according to its documented semantics.
* Record the resulting schema version.
* Report failures clearly.
* Avoid silently dropping user data.

Test migrations against representative older schemas and realistic existing data.

Do not rely on deleting the database and creating a fresh one as a migration strategy.

When a migration is destructive or changes data meaning, provide a safe transformation and appropriate backup or rollback strategy.

Keep migrations small and reviewable.

**Acceptance criteria:** A database created under a supported previous version upgrades to the new schema while preserving existing games, analysis, preferences, and learning progress.

## SECTION 415 — Backup, Restore, and Recovery

Implement a local backup and restore workflow for Chess World data.

The backup must include the durable data needed to restore the user's chess environment, according to the chosen storage architecture.

Document whether it includes:

* Games and PGN.
* User annotations.
* Analysis results.
* Repertoire data.
* Puzzle progress.
* Academy progress.
* Preferences.
* Imported source metadata.
* User-created positions.
* Any user-generated training records.

Do not assume that an ordinary file copy of an actively written database is always a valid backup.

Use the database's supported backup API or another reliable snapshot method.

Validate a backup before reporting success.

Restore must:

1. Identify the selected backup.
2. Validate its structure and version.
3. Detect incompatible or corrupted data.
4. Explain the replacement or merge policy.
5. Protect existing data through a recovery copy or equivalent strategy.
6. Perform the restore safely.
7. Verify the restored database.
8. Report what was restored and what could not be restored.

Do not overwrite an existing library without clear user intent.

**Acceptance criteria:** A user can back up a populated local chess profile, restore it into a clean compatible profile, and recover the supported data correctly.

## SECTION 416 — Crash Recovery and Database Integrity Checks

Implement recovery handling for interrupted writes, unexpected shutdowns, and suspected corruption.

On startup, perform only the integrity checks justified by the database technology and expected startup cost.

Use lightweight checks during normal launches and more comprehensive checks through a diagnostic or recovery workflow when appropriate.

If corruption is detected:

* Stop risky writes.
* Preserve the original database for investigation.
* Attempt supported recovery only when safe.
* Offer restoration from a valid backup.
* Avoid repeatedly launching into a destructive recovery loop.
* Record useful diagnostics without exposing private content unnecessarily.

Never automatically delete a corrupted database and create a fresh one while claiming the user's data was preserved.

Document the recovery outcomes and any data that could not be recovered.

**Acceptance criteria:** Simulated corruption or interrupted-write scenarios lead to a controlled recovery path rather than silent data loss.

## SECTION 417 — Data Provenance and Source Attribution

Store the provenance of imported and externally sourced chess data.

Where relevant, track:

* Source provider.
* Source game or broadcast identifier.
* Import method.
* Original filename.
* Source URL or provider reference when appropriate.
* Retrieval timestamp.
* Source timestamp when available.
* Licensing or attribution information required by the source.
* Whether the record was user-edited.
* Whether a value was observed, inferred, or derived.
* Whether the data was subsequently corrected.

Avoid recording sensitive filesystem paths or network information unless necessary.

Do not treat a derived value as an original source fact.

For example, an application-computed evaluation must not be labelled as a provider-supplied evaluation.

**Acceptance criteria:** A user or support workflow can distinguish imported game data, live-provider metadata, local annotations, and engine-generated analysis.

## SECTION 418 — Efficient Retention and Storage Management

Implement reasonable retention controls for large derived datasets.

Potentially large data includes:

* Engine principal variations.
* Position evaluations.
* Analysis progress logs.
* Temporary import files.
* Downloaded source records.
* Live-game snapshots.
* Diagnostic logs.
* Puzzle-generation intermediates.

Do not delete the user's original PGN, saved games, annotations, or learning history merely because an analysis cache has grown.

Distinguish authoritative user data from regenerable data.

Provide storage usage information where useful.

If a cleanup operation is offered, explain what will be removed and whether it can be regenerated.

Do not run expensive cleanup operations on every UI render or every application launch.

**Acceptance criteria:** Cache cleanup reduces disposable storage without deleting user-owned chess records or making the application inconsistent.

## SECTION 419 — Database Concurrency and Locking

Audit all database access paths, including the UI, engine workers, live-data services, import jobs, and analysis jobs.

Use a documented concurrency model appropriate to the database technology.

Prevent:

* Concurrent migrations.
* Duplicate writes from repeated event delivery.
* Analysis results being attached to the wrong game.
* Lost progress updates.
* Writes from a deleted profile.
* Conflicting edits to the same annotation or repertoire entry.
* Long-running operations that block unrelated reads unnecessarily.

Use serialized write queues or short transactions where appropriate.

If optimistic concurrency is used, detect conflicts rather than silently overwriting newer data.

Do not share a database connection across threads or processes unless the database driver explicitly supports that usage.

**Acceptance criteria:** Parallel analysis, live-game updates, and library browsing do not corrupt or inconsistently overwrite shared records.

## SECTION 420 — Persistence and Migration Acceptance Gate

Test the persistence layer with:

1. A fresh database.
2. An existing database requiring migration.
3. A populated library.
4. Interrupted import.
5. Interrupted analysis.
6. Database-lock contention.
7. Disk-full or simulated write failure.
8. Backup and restore.
9. Corrupted backup.
10. Profile switching.
11. Application restart.
12. Cache cleanup.
13. A large number of games.
14. Deletion of a game with associated derived data.
15. Recovery after a forced process termination.

Do not mark persistence complete until the results demonstrate that durable data survives normal failures and that recovery behaviour is understandable.

---

# PART III — ANALYSIS CACHING AND ENGINE-RESULT INTEGRITY

## SECTION 421 — Canonical Analysis Cache Keys

Implement a deterministic analysis-cache key.

A cache key must identify the actual analysis request, not merely the displayed game title or current move number.

Include all parameters that materially affect the result, as applicable:

* Canonical position identity.
* Side to move.
* Castling rights.
* En-passant state.
* Relevant move counters.
* Chess variant.
* Engine identity and version.
* Engine configuration.
* Search depth or node limit.
* Time limit.
* Multi-variation setting.
* Relevant tablebase settings.
* Search parameters that affect reproducibility or interpretation.

Distinguish position-only analysis from full-game analysis.

If a position is identical but the request has different search constraints, do not present a shallow result as though it were a deeper analysis.

If engine version changes, invalidate or segregate cache entries where the change makes old results unsuitable for the requested operation.

**Acceptance criteria:** Two equivalent requests can reuse compatible results, while materially different requests cannot accidentally share an incompatible result.

## SECTION 422 — Position Identity and History-Sensitive Rules

Define precisely how positions are identified for caching.

A chessboard diagram alone is not always sufficient to establish complete position equivalence.

Consider:

* Piece placement.
* Side to move.
* Castling rights.
* En-passant rights.
* Halfmove clock when relevant to the requested rule or analysis.
* Repetition history where the operation depends on repetition.
* Variant-specific state where supported.

Use a canonical position representation or a well-defined position hash.

Do not use a hash of display text that changes with whitespace or move-number formatting.

When the engine's search is position-based but the application's draw adjudication depends on game history, keep those concepts separate.

Document exactly which context is included in each cache key.

**Acceptance criteria:** Positions with different castling rights or other materially relevant state are not treated as identical merely because the visible pieces occupy the same squares.

## SECTION 423 — Cache Validation and Provenance

Store enough metadata to determine whether a cached result is usable.

Record, where available:

* Engine name.
* Engine version.
* Engine build or binary identity.
* Variant.
* Search limits.
* Search parameters.
* Position identity.
* Principal variation.
* Evaluation type.
* Reported depth.
* Selective depth where available.
* Nodes searched.
* Search duration.
* Completion status.
* Creation timestamp.
* Cache schema version.

Differentiate completed searches from partial searches and interrupted searches.

A cancelled search may yield useful partial information, but it must not be displayed as a completed analysis without clear labelling.

Never fabricate missing depth, node count, or completion information.

**Acceptance criteria:** The interface can explain why a cached result was reused and can distinguish it from a newly completed engine search.

## SECTION 424 — Cache Invalidation Rules

Implement explicit invalidation and versioning rules.

Invalidate or segregate cached analysis when:

* The position changes.
* A required search limit changes.
* A materially relevant engine option changes.
* The engine binary changes.
* The variant changes.
* The cache schema changes.
* The requested output requires data not stored in the cache.
* A previously incomplete record is mistaken for a completed result.

Do not invalidate all user data when only engine analysis has become stale.

Prefer versioned cache keys and bounded cleanup to fragile global cache-clearing logic.

If an existing cache entry is incompatible, run a new search or clearly explain why the requested result cannot be reused.

**Acceptance criteria:** Changing the engine's relevant configuration cannot silently display an incompatible old evaluation as the new result.

## SECTION 425 — Shared Position Cache and Reuse Policy

Where beneficial, reuse analysis for identical positions across games without mixing the ownership of the games themselves.

For example, a position reached in two different games may be eligible for position-analysis reuse, while game-specific comments, player information, and move history remain separate.

Use a position cache that is independent from the canonical game record.

Define which cached fields are position-specific and which require full game context.

Avoid creating duplicate large evaluation trees for every game when a shared result can be referenced safely.

Do not reuse history-sensitive conclusions when the required history is unavailable.

**Acceptance criteria:** Repeated compatible position analysis can avoid redundant computation without attaching one game's annotations or metadata to another game.

## SECTION 426 — Analysis Result Normalisation

Normalise engine results into a documented internal model.

Store the raw engine fields required for diagnostics separately from the presentation model where appropriate.

Represent scores with an explicit type, such as:

* Centipawn evaluation.
* Mate-distance evaluation.
* Unavailable evaluation.
* Incomplete evaluation.

Define a single evaluation convention for the UI, including which side a positive score favours.

Convert score orientation carefully when displaying evaluations from the side-to-move perspective versus a fixed player perspective.

Never treat a mate score as an ordinary centipawn score.

Do not compare incompatible scores as though they shared the same unit.

Preserve principal variations as ordered legal move sequences when validation is available.

**Acceptance criteria:** Switching between White's perspective and Black's perspective changes the displayed sign and interpretation correctly without corrupting the underlying engine result.

## SECTION 427 — Analysis Cache Resource Limits

Bound cache growth.

Define policies for:

* Maximum cache size.
* Maximum entry size.
* Old-entry expiration.
* Least-recently-used or another justified eviction strategy.
* Pinned or user-favourited analysis.
* Incomplete-result retention.
* Cache rebuilding after upgrades.

Never delete authoritative user data to satisfy an analysis-cache limit.

Do not allow a single unusually deep search to create an unbounded stored variation tree.

Where analysis output is large, use compression or structured storage if supported and justified.

**Acceptance criteria:** Cache limits are enforced deterministically, and eviction does not delete games, annotations, or training progress.

## SECTION 428 — Analysis Cache Observability

Provide internal diagnostics for cache behaviour.

Measure:

* Cache hits.
* Cache misses.
* Incompatible-entry rejections.
* Evictions.
* Cache read failures.
* Cache write failures.
* Average lookup latency.
* Stored-data size.
* Reanalysis frequency.

Expose appropriate information through developer diagnostics, not necessarily through the default user interface.

Avoid collecting unnecessary personal data.

Use metrics to verify that caching materially improves performance rather than adding complexity without measurable benefit.

**Acceptance criteria:** A developer can determine whether an analysis request was newly computed, reused, rejected as stale, or failed during persistence.

## SECTION 429 — Analysis Cancellation and Cache Safety

Handle cancellation without allowing stale or partially written results to masquerade as completed analysis.

Every search request should have a unique identifier and a clear lifecycle.

When a request is cancelled:

* Stop or terminate the underlying search according to the engine service contract.
* Reject late messages belonging to obsolete requests.
* Preserve useful partial results only if the cache model supports them.
* Mark partial results accurately.
* Avoid overwriting a newer completed result with an older partial result.
* Release resources.
* Record the cancellation reason.

Do not assume that cancelling a frontend promise automatically cancels the engine process.

**Acceptance criteria:** Rapidly changing positions, closing an analysis panel, or starting a replacement search never causes a previous search to overwrite the current position's analysis.

## SECTION 430 — Analysis Cache Acceptance Gate

Test:

1. Repeated identical requests.
2. Requests with different search limits.
3. Engine version changes.
4. Engine option changes.
5. Different castling rights.
6. Different side to move.
7. Mate-score handling.
8. Perspective conversion.
9. Partial search cancellation.
10. Cache eviction.
11. Cache corruption.
12. Profile separation.
13. Application restart.
14. Concurrent requests for the same position.
15. Concurrent requests for different positions.

The cache must improve performance while preserving the integrity and provenance of genuine engine results.

---

# PART IV — ARCHIVE INTEGRITY, DUPLICATES, AND LIBRARY OPERATIONS

## SECTION 431 — Stable Game Identity

Create a stable identity strategy for stored games.

Do not identify games solely by:

* Player names.
* Event names.
* Dates.
* File paths.
* Move counts.
* Result.
* A single provider identifier that may be missing or reused.

Use provider identifiers when reliable and scoped to the relevant provider.

For imported games, calculate a canonical content fingerprint using a documented representation of the game.

Consider the initial position, legal move sequence, variant, and relevant metadata.

Separate game identity from the identity of an import event. The same game may be imported multiple times through different files or providers.

**Acceptance criteria:** Reimporting the same game can be recognised without confusing it with another game played by the same players on the same date.

## SECTION 432 — Duplicate Detection and Resolution

Implement duplicate detection as a controlled workflow.

Distinguish:

1. Exact content duplicates.
2. Same game with different metadata.
3. Same game with different comments or annotations.
4. Same game represented by different PGN formatting.
5. Games that share a move prefix but are not identical.
6. Games from different sources that have the same moves but distinct provenance.
7. Different games that happen to share players, date, and result.

Offer explicit policies such as skip, keep both, or merge supported metadata.

Do not merge annotations or player details destructively without a defined conflict policy.

If two records differ in user-created annotations, preserve both sets where possible or ask the user to resolve the conflict.

Never assume that two games with identical move sequences necessarily represent the same real-world event.

**Acceptance criteria:** Duplicate handling prevents unnecessary copies while preserving meaningful source differences and user-owned annotations.

## SECTION 433 — Library Search and Filtering

Implement efficient local search across the game library.

Support the fields that are actually stored, such as:

* Player names.
* Event.
* Site.
* Date.
* Result.
* Round.
* Opening classification.
* Source provider.
* Favourites.
* Game tags.
* User annotations where appropriate.

Support combinations of filters without resetting unrelated filters unexpectedly.

Define whether text search is case-insensitive, accent-insensitive, or otherwise normalised.

Preserve Unicode names.

Handle empty search queries, no results, and large result sets.

Use pagination or virtualised lists where necessary.

Do not load thousands of full PGN documents merely to render a list of game titles.

**Acceptance criteria:** Filtering a large library returns accurate results and does not block the main interface.

## SECTION 434 — Library Sorting and Pagination

Provide predictable sorting by relevant fields, such as:

* Date.
* White player.
* Black player.
* Event.
* Result.
* Import time.
* Last analysed.
* Favourite status where suitable.

Use stable secondary sorting when primary sort values are equal.

Define how missing dates and unknown metadata are sorted.

Ensure pagination remains stable when records are added or deleted.

Avoid duplicate or skipped rows when the underlying dataset changes during browsing.

**Acceptance criteria:** Moving between pages or changing sort order does not show duplicated games or lose records unexpectedly.

## SECTION 435 — Game Editing and Metadata Integrity

Allow supported game metadata and user annotations to be edited without corrupting the underlying move sequence.

Clearly distinguish editable user metadata from authoritative source metadata.

For example, a user may add a display label or correct a player name, but the original source value should remain recoverable where appropriate.

When an edit affects a cache key or derived classification, invalidate only the dependent data.

Do not automatically modify engine-generated scores merely because a player name changes.

Use an explicit save model appropriate to the existing UI.

Handle concurrent edits or stale editor state safely.

**Acceptance criteria:** Editing metadata preserves legal moves, annotations, source provenance, and unrelated analysis results.

## SECTION 436 — Safe Game Deletion and Undo

Implement safe deletion for games and associated user data.

Before deleting a game, identify what will happen to:

* The canonical game record.
* User annotations.
* Associated analysis.
* Evaluation graphs.
* Source provenance.
* Favourites.
* Training references.
* Repertoire references.
* Cached position analysis shared with other games.

Do not delete shared position cache entries merely because one game is deleted.

Where feasible, support an undo window or recoverable soft deletion.

If permanent deletion is used, explain it clearly.

Ensure that a failed deletion cannot leave visible references to nonexistent records.

**Acceptance criteria:** Deleting one game does not accidentally remove another game's analysis or shared position data.

## SECTION 437 — Bulk Library Operations

Support efficient bulk operations where useful.

Potential operations include:

* Export selected games.
* Add or remove tags.
* Add or remove favourites.
* Reclassify games.
* Delete selected games.
* Reanalyse selected games.
* Move records between supported local collections.

For each bulk operation:

1. Validate the selection.
2. Show a clear summary when the action is consequential.
3. Use batching.
4. Report progress.
5. Support cancellation where practical.
6. Record partial completion accurately.
7. Avoid duplicate work.
8. Recover from failures.
9. Preserve profile isolation.

Do not run hundreds of engine searches simultaneously just because the user selected hundreds of games.

**Acceptance criteria:** Bulk operations remain responsive and provide an accurate summary of completed, skipped, failed, and cancelled items.

## SECTION 438 — Archive Integrity Verification

Create an integrity checker for stored games.

Validate:

* Required record relationships.
* Move legality from the stored starting position.
* Move-sequence consistency.
* Result consistency where determinable.
* PGN/FEN consistency where both representations are stored.
* Referenced analysis-session ownership.
* Annotation references.
* Source metadata structure.
* Duplicate identifiers.
* Missing required fields.

Do not automatically "repair" uncertain data by guessing the intended move sequence.

Classify findings as errors, warnings, or recoverable inconsistencies.

Offer safe repairs only when the correction is deterministic and reversible.

Keep a diagnostic record of any applied repair.

**Acceptance criteria:** The integrity checker detects intentionally introduced inconsistencies and does not silently rewrite valid game data.

## SECTION 439 — Large Archive Performance

Test library performance using realistic large datasets, not just a handful of sample games.

Include:

* Thousands of games.
* Many games from the same player.
* Missing metadata.
* Long PGN comments.
* Large analysis histories.
* Many favourites.
* Multiple imported sources.
* Duplicate-heavy archives.

Optimise database queries, indexing, pagination, and object construction based on measurements.

Use virtualisation for large rendered lists when needed.

Keep heavy parsing and classification work off the UI thread.

Do not reduce correctness to improve a benchmark.

**Acceptance criteria:** The library remains usable with a large local dataset and does not repeatedly parse every stored game during ordinary navigation.

## SECTION 440 — Archive Acceptance Gate

Verify that:

* Import and reimport behave predictably.
* Duplicate detection does not destroy valid records.
* Search and sorting return correct results.
* Editing metadata preserves moves.
* Deletion respects shared dependencies.
* Bulk operations recover from failure.
* Integrity checks identify corruption.
* Large archives remain responsive.
* Exported records remain valid.
* Profile switching keeps libraries separate.

Do not mark the library complete until these tests pass.

---

# PART V — LOCAL PROFILE ISOLATION, PRIVACY, AND SECURE PERSISTENCE

## SECTION 441 — Integrate with ORBIS Profile Ownership

Integrate Chess World persistence with the existing ORBIS local-profile system.

Inspect how ORBIS currently identifies a profile, resolves its data directory, switches profiles, and manages application shutdown.

Do not invent a second profile system if the existing one can provide reliable ownership.

Every chess record must belong to the correct local profile or to an explicitly shared application resource that contains no user-specific information.

The following must remain isolated between local profiles:

* Game libraries.
* Imported PGNs.
* Personal annotations.
* Engine preferences where profile-specific.
* Saved positions.
* Analysis history.
* Repertoire entries.
* Puzzle progress.
* Academy progress.
* Personal training plans.
* Favourites.
* User-created challenges.
* Local backup preferences.
* Private diagnostics where they contain profile data.

Switching profiles must switch the active chess context rather than copying data between profiles.

**Acceptance criteria:** Two local ORBIS profiles can use Chess World independently on the same device without seeing one another's private chess records.

## SECTION 442 — Resolve Profile Paths Safely

Use the established ORBIS path-resolution service where available.

Do not construct storage paths from unsanitised profile names.

Use stable internal profile identifiers rather than relying on a display name as a directory identity.

Ensure that path handling is correct across supported operating systems.

Prevent path traversal and accidental writes outside the intended profile data directory.

Handle renamed profiles without losing the association with existing chess data.

If the active profile cannot be resolved safely, do not silently write to the application's global directory.

**Acceptance criteria:** Profile renaming, switching, and unusual profile labels cannot redirect chess writes into another profile's storage.

## SECTION 443 — Profile-Switch Lifecycle

Define a deterministic profile-switch lifecycle.

When a profile switch begins:

1. Stop accepting new profile-specific actions.
2. Cancel or safely finish in-flight database writes.
3. Cancel analysis jobs owned by the old profile where required.
4. Detach live-game subscriptions that should not continue.
5. Flush pending writes.
6. Dispose profile-specific services.
7. Resolve the new profile.
8. Open and validate the new profile's data store.
9. Reconstruct profile-scoped services.
10. Refresh the UI from the new profile's data.

Do not allow a late asynchronous response from the old profile to update the new profile's UI.

Do not keep private old-profile content visible during a partially completed switch.

Define what happens if switching fails halfway through.

**Acceptance criteria:** Repeated rapid profile switching does not mix game lists, analysis results, puzzle progress, or user settings.

## SECTION 444 — Local-First Privacy Boundary

Chess World must remain local-first.

Do not introduce a cloud database, automatic personal-data upload, cloud profile synchronisation, or external analytics upload for chess records without a separately approved product decision.

Do not transmit:

* Personal PGNs.
* Personal annotations.
* Repertoire data.
* Puzzle history.
* Academy progress.
* Private analysis.
* Local profile identifiers.
* Local filesystem paths.

A user-initiated connection to a live-game provider may transmit the requests required to retrieve the selected public data. That is distinct from uploading the user's private chess library.

Document network behaviour for each external service.

Keep optional remote services disabled when not configured or not needed.

Do not treat local storage as automatically encrypted or secure merely because it is local.

**Acceptance criteria:** Normal chess usage does not silently upload the user's local chess library or private training data.

## SECTION 445 — Secure Handling of Imported Content

Treat PGN files, downloaded archives, provider responses, and other imported content as untrusted input.

Validate input before passing it into:

* Database queries.
* UI rendering.
* File paths.
* Engine command construction.
* External links.
* HTML or Markdown rendering.
* Logging.
* Export operations.

Do not interpolate untrusted text directly into SQL statements.

Use parameterised queries.

Escape or safely render comments and metadata so imported text cannot inject executable HTML or script into the application.

Do not execute imported files.

Do not interpret PGN comments as commands.

If a user opens an external URL from imported metadata, use a safe link-opening policy and do not automatically navigate without clear user action.

**Acceptance criteria:** Maliciously crafted comments, tags, player names, and event names remain data and cannot execute code or corrupt application state.

## SECTION 446 — Engine Process and Binary Trust

Review how the application locates and launches Stockfish.

Validate that the configured engine executable resolves to an expected file within an approved installation or user-selected location.

Do not execute an arbitrary path obtained from PGN metadata or live-provider content.

Use argument-safe process APIs rather than constructing shell commands from untrusted strings.

Restrict writable configuration to expected engine options.

Handle missing, invalid, or incompatible binaries gracefully.

Where feasible, record engine version and binary identity for diagnostics and cache validity.

Do not promise cryptographic verification unless the application actually verifies a trusted signature or checksum against a trusted reference.

**Acceptance criteria:** Imported content cannot influence the executable path or inject shell commands into engine startup.

## SECTION 447 — External Provider and Network Security

Apply secure network handling to live-game and external-data integrations.

Use supported HTTPS endpoints where required and available.

Validate response structure, content type, status codes, and reasonable payload sizes.

Set timeouts and cancellation.

Avoid logging authentication tokens or other credentials.

If provider credentials are required for an explicitly supported integration, store them using an appropriate secure mechanism rather than plaintext application logs or ordinary configuration files.

Respect provider permissions, licensing, attribution, and rate limits.

Do not scrape restricted interfaces or bypass access controls.

Do not trust remote clocks, ratings, game results, or player identifiers without validating their types and context.

**Acceptance criteria:** Invalid, oversized, delayed, or malformed network responses are rejected or handled safely without crashing Chess World.

## SECTION 448 — Privacy-Conscious Diagnostics

Implement diagnostic logging with a clear data-minimisation policy.

Useful events may include:

* Engine startup failure.
* Search cancellation.
* PGN parse failure.
* Database migration failure.
* Live-feed disconnection.
* Cache corruption.
* Profile-switch failure.
* Export failure.
* Recovery actions.

Do not log complete PGNs, private comments, entire local paths, credentials, or unnecessary player information by default.

Use stable, non-sensitive event identifiers where practical.

Provide an explicit way to collect a local diagnostic report when needed.

Before including private information in an exportable report, disclose what will be included and provide appropriate redaction.

Do not silently upload diagnostics.

**Acceptance criteria:** A diagnostic report helps identify technical failures without automatically exporting the user's private chess library.

## SECTION 449 — Data Portability and Deletion

Support user-controlled data export and deletion.

The user must be able to export supported personal chess records into durable formats where appropriate, particularly PGN for games and suitable structured formats for application-specific progress and annotations.

Document which data cannot be represented in standard PGN.

Deletion must cover the intended scope and explain what is being deleted.

Distinguish deletion of:

* One game.
* One analysis session.
* One training record.
* One local Chess World collection.
* All Chess World data belonging to the active profile.

Do not delete the entire ORBIS profile or unrelated browser data when the user requests deletion of Chess World data.

Do not claim that deleted data is unrecoverable if backups, filesystem snapshots, or other copies may remain.

**Acceptance criteria:** Chess World data can be exported and selectively deleted without damaging unrelated ORBIS functionality or other local profiles.

## SECTION 450 — Security and Profile-Isolation Acceptance Gate

Run tests covering:

1. Two independent local profiles.
2. Rapid profile switching.
3. Malformed PGN comments and metadata.
4. Path traversal attempts.
5. Unsafe engine executable paths.
6. Malformed provider responses.
7. Oversized network payloads.
8. Database query injection attempts.
9. Diagnostic redaction.
10. Selective deletion.
11. Backup restoration into the correct profile.
12. Late asynchronous responses from a previous profile.

Document the security boundary and any remaining limitations. Never claim complete security based solely on passing a small set of tests.

---

# PART VI — BACKGROUND JOBS, WORKERS, AND CONCURRENCY

## SECTION 451 — Central Background-Job Model

Implement a shared background-job abstraction where multiple Chess World subsystems need consistent lifecycle management.

A job may represent:

* PGN import.
* PGN export.
* Full-game analysis.
* Position analysis.
* Bulk reanalysis.
* Opening classification.
* Puzzle validation.
* Archive integrity checking.
* Database backup.
* Database restoration.
* Large-library indexing.
* Live-game recovery.

The job model should support, where appropriate:

* Unique identifier.
* Job type.
* Owning profile.
* Current status.
* Start time.
* Progress.
* Cancellation request.
* Completion time.
* Result summary.
* Error information.
* Resource requirements.
* Priority.
* Retry policy.
* User-visible description.

Do not create a generic job framework that obscures simple operations with unnecessary abstraction.

Use it where lifecycle, progress, cancellation, or resource scheduling genuinely benefit from standardisation.

**Acceptance criteria:** Long-running operations have a consistent lifecycle and cannot become invisible, untracked work after their UI closes.

## SECTION 452 — Worker Isolation and UI Responsiveness

Move expensive computation away from the renderer's main thread.

Tasks that may require workers include:

* Large PGN parsing.
* Archive indexing.
* Move classification.
* Engine-result normalisation.
* Evaluation graph preparation.
* Large import/export operations.
* Integrity checking.
* Bulk data transformations.

Choose the appropriate execution model for the existing technology stack: worker threads, web workers, utility processes, background processes, or other established mechanisms.

Do not move tiny operations into separate processes without justification.

Keep worker messages structured and bounded.

Avoid serialising enormous game objects for every progress update.

**Acceptance criteria:** Expensive chess operations do not cause obvious UI freezing, unresponsive buttons, or delayed keyboard input.

## SECTION 453 — Cancellation Propagation

Implement cancellation as an end-to-end contract.

If a user cancels an operation, cancellation must propagate to the component doing the actual work.

Examples:

* Cancelling an import stops reading or parsing additional input.
* Cancelling an engine search sends the appropriate stop command or terminates the process according to the engine service contract.
* Cancelling an export stops producing additional output and cleans temporary files.
* Cancelling a bulk job stops scheduling additional items.
* Cancelling an integrity scan stops further checks safely.
* Cancelling a network request aborts it when supported.

Do not mark a job as cancelled while its underlying process continues indefinitely.

If a job cannot stop immediately, expose an appropriate stopping state.

Use cancellation tokens, abort signals, or the project's established equivalent.

**Acceptance criteria:** Cancellation reliably stops future work, releases resources, and leaves the relevant records in a valid state.

## SECTION 454 — Job Scheduling and Resource Arbitration

Coordinate background tasks to avoid resource contention.

For example:

* An active game should receive appropriate engine resources.
* A large archive analysis should not spawn an uncontrolled number of Stockfish processes.
* A database migration must not compete with ordinary writes to the same schema.
* Backup should use a consistent snapshot.
* UI-triggered position analysis should not be trapped behind hundreds of low-priority jobs.
* Live-game updates should continue to be processed while nonessential analysis runs.

Implement explicit concurrency limits and priorities.

Allow the user to stop or pause supported bulk operations.

Define behaviour when the computer is under heavy CPU or memory pressure.

Do not assume that the system can run every requested engine search simultaneously.

**Acceptance criteria:** Heavy background work does not starve interactive analysis or make the overall application unusable.

## SECTION 455 — Job State Persistence and Recovery

Persist job state only where recovery genuinely benefits the user.

On restart, classify jobs as:

* Completed.
* Failed.
* Cancelled.
* Interrupted.
* Recoverable.
* Requires user action.

Do not resume a job blindly if its inputs have changed or its saved state is insufficient.

For example, a partially written PGN export may need to be restarted, while a completed import batch may only need to continue with unprocessed records.

An interrupted engine search should not be represented as a completed search.

Avoid persisting huge transient progress messages unnecessarily.

**Acceptance criteria:** After a forced restart, the application reports interrupted work accurately and can safely resume supported jobs without duplicating or corrupting data.

## SECTION 456 — Retry Policy and Idempotency

Define retry behaviour for each retryable job.

Retries should be limited and should use backoff where appropriate.

Do not automatically retry permanent failures indefinitely.

Before retrying a write operation, determine whether the previous attempt may already have committed.

Use idempotency keys or deterministic record identities where appropriate.

For network requests, respect provider rate limits and retry guidance.

For engine searches, a retry should create a new identifiable request rather than allowing old results to leak into the new request.

**Acceptance criteria:** Retrying failed jobs does not create duplicate games, duplicate progress entries, or contradictory completed-analysis records.

## SECTION 457 — Worker Communication Contracts

Define typed or otherwise strongly validated message contracts between the UI and background services.

Messages should identify:

* Job or request ID.
* Message type.
* Owning profile where relevant.
* Payload version where compatibility matters.
* Payload size expectations.
* Error state where applicable.

Validate incoming messages rather than trusting their shape.

Do not use arbitrary executable strings as worker commands.

Avoid flooding the UI with per-node engine output when a throttled progress update is sufficient.

Preserve critical messages such as search completion and fatal errors.

**Acceptance criteria:** Unexpected, stale, or malformed worker messages cannot corrupt active UI state or cause unbounded message processing.

## SECTION 458 — Resource Cleanup and Process Ownership

Ensure that every background process, worker, timer, stream, file handle, database connection, and event subscription has a defined owner and disposal path.

When a component closes:

* Remove its event listeners.
* Cancel owned jobs where appropriate.
* Stop timers.
* Release subscriptions.
* Close temporary files.
* Dispose worker resources.
* Prevent late callbacks from mutating disposed state.

Do not terminate a shared worker simply because one consumer closes unless the worker's ownership model requires it.

Track engine process lifetime independently from the lifecycle of a single UI panel.

**Acceptance criteria:** Repeatedly opening and closing Chess World views does not steadily increase process count, timer count, or memory usage.

## SECTION 459 — Concurrency and Race-Condition Testing

Create deterministic tests for races that are likely to occur in a real desktop application.

Test scenarios include:

* Rapid position changes.
* Multiple analysis requests.
* Profile switching during analysis.
* Closing the window during import.
* Cancelling a job during a database transaction.
* Restarting during export.
* Duplicate live events.
* Concurrent writes to puzzle progress.
* Two imports of the same file.
* Cache writes finishing out of order.
* An old worker reporting progress after a new job starts.

Use controlled promises, fake timers, test workers, or process fixtures where suitable.

Avoid tests that depend on arbitrary sleep durations when deterministic synchronization is possible.

**Acceptance criteria:** Tests reproduce relevant race conditions reliably and verify the resulting state, not merely the absence of an exception.

## SECTION 460 — Background-Work Acceptance Gate

Demonstrate that:

* Long jobs run outside the UI's critical path.
* Cancellation propagates.
* Resource limits are enforced.
* Retry behaviour is bounded.
* Worker messages are validated.
* Interrupted jobs are reported correctly.
* Shared resources are disposed safely.
* Profile ownership is respected.
* Concurrent operations preserve data integrity.
* Interactive chess functions remain responsive under realistic load.

---

# PART VII — RENDERER PERFORMANCE, MEMORY, AND ACCESSIBILITY

## SECTION 461 — Renderer Performance Baseline

Measure the performance of the actual integrated Chess World UI.

Record representative timings for:

* Opening Chess World.
* Opening the chessboard.
* Loading a saved game.
* Navigating between moves.
* Displaying engine analysis.
* Opening a large game library.
* Searching and filtering.
* Opening Analysis Studio.
* Switching between training modules.
* Displaying a live game.
* Switching local profiles.

Use repeatable test conditions.

Separate application startup cost, route activation cost, database query time, engine search time, and rendering time.

Do not attribute a slow engine search to UI rendering or attribute a slow database query to network latency without evidence.

Set reasonable budgets based on measurements and the existing ORBIS architecture.

**Acceptance criteria:** The project has a measurable baseline and can identify the major sources of UI delay.

## SECTION 462 — Chessboard Rendering Efficiency

Optimise board rendering without compromising chess interaction or accessibility.

Avoid rebuilding the entire board unnecessarily for every engine-information update.

Separate high-frequency data such as evaluation progress from structural board state.

Use stable component identities where supported by the framework.

Avoid unnecessary expensive effects, repeated layout measurements, and excessive animation work.

Ensure that:

* Legal-move highlights update correctly.
* Selection state remains correct.
* Promotion dialogs remain functional.
* Drag-and-drop works.
* Keyboard navigation remains usable.
* Coordinate labels remain aligned.
* Orientation changes do not corrupt the position.
* The board remains correct at supported window sizes.

Do not sacrifice correctness to achieve a benchmark.

**Acceptance criteria:** Frequent engine updates do not make ordinary board interactions visibly sluggish.

## SECTION 463 — Virtualisation for Large Collections

Use virtualised lists or equivalent rendering strategies for collections that can grow substantially.

Potential candidates include:

* Game libraries.
* Analysis move lists.
* Evaluation samples.
* Puzzle collections.
* Opening trees.
* Engine principal variations.
* Live-game directories.
* Academy lesson catalogues.
* Import histories.

Virtualisation must preserve selection, keyboard navigation, scroll position, and accessibility as far as the framework permits.

Do not virtualise tiny fixed lists unnecessarily.

Ensure that item heights and dynamic content do not cause major scroll jumps.

**Acceptance criteria:** Scrolling through a large collection does not mount and retain thousands of unnecessary UI elements.

## SECTION 464 — Memory Ownership and Leak Prevention

Audit long-lived objects and memory-heavy features.

Look for:

* Unreleased engine output buffers.
* Accumulated event listeners.
* Repeated subscriptions.
* Large PGN strings retained after import.
* Duplicate board histories.
* Stale analysis trees.
* Worker references retained after completion.
* Unbounded caches.
* Repeated copies of large game records.
* Unreleased image or diagram resources.

Use memory profiling tools available in the development environment.

Set explicit bounds for in-memory histories and streaming buffers.

Do not clear useful application state indiscriminately as a workaround for leaks.

**Acceptance criteria:** Repeatedly opening games, running analysis, switching modules, and returning to the library does not produce unbounded memory growth.

## SECTION 465 — Efficient Evaluation Graphs and Analysis Views

Optimise evaluation graph generation and rendering.

Avoid recomputing the entire graph when one new evaluation point arrives.

Use incremental updates where appropriate.

Handle:

* Centipawn scores.
* Mate scores.
* Missing evaluations.
* Interrupted analysis.
* Large game lengths.
* Perspective changes.
* Move selection.
* Critical-moment markers.
* Navigation between variations.

Define how mate scores are represented visually so they do not distort a graph as if they were ordinary numeric evaluations.

Ensure graph interactions map to the correct move and position.

Do not fabricate intermediate evaluations to make the graph look smoother.

**Acceptance criteria:** Evaluation graphs remain aligned with the correct game positions and render accurately for long games.

## SECTION 466 — Animation and Reduced-Motion Behaviour

Review Chess World animations for performance and accessibility.

Animations must not block critical actions or make rapid chess navigation difficult.

Support reduced-motion preferences where available through ORBIS or the operating system.

Ensure that:

* Board transitions can be reduced or disabled where appropriate.
* Dialogs remain usable without elaborate transitions.
* Loading indicators communicate real work.
* Animation state cannot leave the interface permanently obscured.
* Rapid navigation does not queue an unbounded number of animations.

Use the existing ORBIS visual system and animation conventions.

Do not redesign unrelated application surfaces to make Chess World appear more distinctive.

**Acceptance criteria:** Chess World remains usable with reduced motion and under conditions where animation performance is limited.

## SECTION 467 — Keyboard and Screen-Reader Accessibility

Make core chess workflows accessible beyond mouse-only interaction.

Where appropriate, provide:

* Keyboard-accessible navigation.
* Focus indicators.
* Accessible button names.
* Descriptive labels for controls.
* Screen-reader announcements for important state changes.
* Keyboard-accessible promotion selection.
* Accessible dialogs.
* Alternative move-list navigation.
* Text descriptions for board positions.
* Accessible status indicators for live-game freshness and analysis progress.

Do not announce every engine update to a screen reader at a rate that makes the interface unusable.

Use appropriate live-region behaviour and concise announcements.

Provide an accessible representation of the board that communicates piece, square, selection, and relevant move information.

**Acceptance criteria:** Core operations can be completed using supported keyboard and assistive-technology workflows without relying exclusively on colour or drag-and-drop.

## SECTION 468 — Responsive Layout and Window Constraints

Test Chess World at different window sizes and display scales.

Ensure that the application handles:

* Narrow windows.
* Wide windows.
* High-DPI displays.
* Different operating-system scaling settings.
* Resized windows during an active game.
* Open side panels.
* Analysis layouts.
* Split-pane library views.
* Keyboard focus during layout changes.

Use responsive layouts appropriate to the desktop product.

Do not allow essential controls to disappear permanently below an inaccessible region.

Avoid forcing users into a single fixed resolution.

**Acceptance criteria:** The board, navigation, analysis controls, and critical dialogs remain usable across supported window sizes.

## SECTION 469 — Performance Regression Benchmarks

Add repeatable performance checks for the most important operations.

Where reliable automated timing is possible, record:

* Time to parse a representative PGN.
* Time to open a stored game.
* Database query latency.
* Library rendering time.
* Move-navigation responsiveness.
* Memory use after repeated navigation.
* Worker startup overhead.
* Cache lookup latency.
* Evaluation graph rendering cost.

Use broad, stable thresholds appropriate to the CI environment.

Avoid brittle tests that fail solely because a shared CI machine is temporarily busy.

Use profiling and trend comparison for expensive operations that cannot be measured reliably with a strict unit-test threshold.

**Acceptance criteria:** Significant performance regressions can be detected during development rather than discovered only after release.

## SECTION 470 — Renderer and Accessibility Acceptance Gate

Verify:

1. Board interactions under frequent engine updates.
2. Large game-library scrolling.
3. Large PGN viewing.
4. Evaluation graph accuracy.
5. Memory stability during repeated navigation.
6. Reduced-motion behaviour.
7. Keyboard navigation.
8. Accessible dialog behaviour.
9. High-DPI rendering.
10. Narrow-window usability.
11. Profile switching.
12. Performance under simultaneous analysis and live updates.

---

# PART VIII — LOGGING, DIAGNOSTICS, AND SUPPORT WORKFLOWS

## SECTION 471 — Structured Chess World Logging

Use structured logging for important subsystem events.

Each event should include relevant fields such as:

* Timestamp.
* Subsystem.
* Event type.
* Severity.
* Request or job identifier.
* Profile-safe identifier where necessary.
* Engine request identifier where relevant.
* Provider identifier where relevant.
* Error category.
* Duration.
* Retry count where applicable.

Use the logging infrastructure already established in ORBIS when possible.

Avoid inconsistent ad hoc console messages scattered across components.

Do not write enormous unbounded logs from engine output.

Keep raw engine protocol logging behind an explicit diagnostic setting and apply privacy-conscious handling.

**Acceptance criteria:** Developers can correlate an import, analysis request, or live-feed failure across relevant services using structured events.

## SECTION 472 — Error Taxonomy and User-Facing Messages

Create a consistent error taxonomy.

Examples include:

* Invalid chess position.
* Invalid PGN.
* Unsupported variant.
* Engine unavailable.
* Engine protocol failure.
* Analysis cancelled.
* Storage unavailable.
* Database corruption.
* Migration failure.
* Import conflict.
* Export failure.
* Live-feed unavailable.
* Provider rate limit.
* Network timeout.
* Stale live data.
* Unsupported source.
* Resource limit reached.
* Profile switch failure.

User-facing messages must explain what happened and what action is possible.

Do not expose raw stack traces as the primary user experience.

Do not show the same generic error for unrelated failures if the user needs different recovery actions.

Preserve technical details in local diagnostics where appropriate.

**Acceptance criteria:** Common failures produce actionable explanations without hiding the underlying technical cause from diagnostics.

## SECTION 473 — Diagnostic Snapshot

Provide a local diagnostic snapshot that can be generated on demand.

It may include:

* ORBIS and Chess World versions.
* Operating-system version.
* Relevant subsystem status.
* Database schema version.
* Engine identity and availability.
* Last error summaries.
* Cache statistics.
* Job status.
* Live-provider connection status.
* Resource usage estimates.
* Migration status.
* Enabled feature flags.
* Recent redacted error events.

Do not include complete PGNs, private annotations, credentials, or personal file contents by default.

Explain the snapshot's contents before any user-initiated sharing.

Provide redaction controls where useful.

**Acceptance criteria:** The diagnostic snapshot is sufficient to investigate many technical issues while minimising unnecessary personal information.

## SECTION 474 — Engine Diagnostics

Provide a way to inspect engine health and configuration.

The diagnostic view should distinguish:

* Engine binary found.
* Binary executable.
* Engine process started.
* UCI handshake successful.
* Engine ready.
* Required options accepted.
* Search started.
* Search completed.
* Search cancelled.
* Search failed.
* Engine process exited unexpectedly.

Display the detected engine identity and relevant configuration.

Do not label an engine "ready" merely because its executable exists.

Do not report a successful search unless a valid search result was received and accepted for the current request.

**Acceptance criteria:** An unavailable, incompatible, or malfunctioning engine is identified accurately, and the diagnostic view helps isolate the failure stage.

## SECTION 475 — Live-Feed Diagnostics

Provide internal diagnostics for live-game ingestion.

Track, where the provider exposes the required information:

* Connection status.
* Subscription status.
* Last successful message.
* Last source timestamp.
* Last local receipt timestamp.
* Processing latency.
* Sequence gaps.
* Reconnection attempts.
* Rate-limit responses.
* Parsing failures.
* Snapshot-recovery attempts.
* Current staleness.
* Provider-specific warnings.

Do not assume every provider offers sequence numbers or source timestamps.

When fields are unavailable, mark them unavailable rather than inventing them.

Distinguish source publication delay from local application processing delay.

**Acceptance criteria:** A developer can determine whether a stale game is caused by a provider delay, network interruption, parsing failure, or local processing backlog when sufficient evidence exists.

## SECTION 476 — Support Bundle and Export Policy

Implement an optional support bundle built from redacted diagnostics.

The bundle may contain relevant logs, subsystem statuses, and environment information.

Before generating or sharing it:

* Show the categories of data included.
* Allow the user to review or redact sensitive fields.
* Exclude credentials and tokens.
* Exclude full private PGNs by default.
* Avoid including unrelated ORBIS profile content.
* Use a clear destination path.
* Report completion or failure accurately.

Creating a bundle must not automatically upload it.

If a sharing destination is later implemented, require a separate explicit user action and follow the approved privacy model.

**Acceptance criteria:** A user can produce a local support bundle without unknowingly exporting their entire chess library.

## SECTION 477 — Operational Health Dashboard

Create a developer-oriented internal health view where appropriate.

It should summarise subsystem states such as:

* Database.
* Chess rules service.
* Engine service.
* Background-job scheduler.
* Analysis cache.
* Live-data providers.
* PGN import/export.
* Local profile ownership.
* Diagnostics.
* Storage availability.

Do not add a cluttered technical dashboard to the default Chess World landing page if it would harm the intended user experience.

Keep advanced diagnostics discoverable through an appropriate settings or troubleshooting route.

Display actionable states, not merely green indicators.

**Acceptance criteria:** The developer can see which major subsystems are operational and which have degraded or failed.

## SECTION 478 — Recovery Instructions

Provide appropriate recovery instructions for common failures.

Examples:

* Install or select a supported engine binary.
* Retry an interrupted import.
* Restore a known-good backup.
* Reconnect to a supported live-game source.
* Check provider availability.
* Rebuild a disposable analysis cache.
* Repair or migrate the local database.
* Restart a failed background job.
* Export recoverable data before attempting repair.

Do not instruct users to delete their profile directory as the default solution to a problem.

Do not suggest deleting all application data when a targeted cache rebuild would suffice.

Recovery steps must match the actual implementation and must not promise that data can always be recovered.

**Acceptance criteria:** Recovery instructions are technically accurate, narrowly targeted, and consistent with the app's real recovery capabilities.

## SECTION 479 — Observability Without Excessive Overhead

Ensure that diagnostics do not become a performance problem.

Use bounded logs, controlled sampling for repetitive events, and suitable retention.

Do not synchronously write a large diagnostic entry for every engine node or every live-game update.

Preserve critical errors while controlling repetitive informational messages.

Measure the overhead of diagnostic collection.

Ensure that disabling optional verbose logging does not disable essential error reporting.

**Acceptance criteria:** Normal use remains responsive with diagnostics enabled, and log storage remains bounded.

## SECTION 480 — Diagnostics Acceptance Gate

Verify that:

* Engine failures can be diagnosed.
* Import errors identify useful context.
* Database errors are recorded safely.
* Live-feed staleness is observable.
* Job failures can be correlated.
* Diagnostic reports are redacted.
* Support bundles exclude private chess data by default.
* Logs are bounded.
* Recovery guidance is accurate.
* Diagnostic failures do not crash the core application.

---

# PART IX — COMPREHENSIVE TESTING AND REGRESSION PREVENTION

## SECTION 481 — Requirement Traceability Matrix

Create a final traceability matrix for all 500 sections.

Each requirement must be classified as one of:

* Implemented and verified.
* Implemented but not fully verified.
* Partially implemented.
* Not implemented.
* Blocked by a documented dependency.
* Not applicable, with an explicit technical justification.

For each section, identify:

* The relevant implementation location.
* The test or verification method.
* The observed result.
* Any known limitation.
* The remaining work, if any.

Do not mark a requirement implemented simply because a file or component with a matching name exists.

The matrix must distinguish the presence of a UI control from the existence of a functioning backend workflow.

If an earlier requirement is absent, return to the relevant subsystem and implement or explicitly report the gap.

**Acceptance criteria:** The project can identify exactly which requirements have been delivered and which remain unfinished.

## SECTION 482 — Unit-Test Coverage

Create or complete unit tests for critical pure logic.

Include:

* Chess notation conversion.
* Position validation.
* Move validation.
* Game identity.
* PGN normalisation.
* FEN canonicalisation.
* Analysis-cache keys.
* Evaluation orientation.
* Mate-score representation.
* Duplicate detection.
* Import validation.
* Metadata normalisation.
* Job-state transitions.
* Retry policies.
* Resource-limit calculations.
* Live-event deduplication.
* Staleness calculations.
* Migration-version selection.

Use fixtures derived from valid, independently verified cases.

Test boundary conditions and invalid inputs.

Do not chase a high coverage percentage by testing trivial getters while leaving core rules and failure paths untested.

**Acceptance criteria:** Critical domain logic has meaningful tests that detect incorrect behaviour rather than simply increasing coverage statistics.

## SECTION 483 — Integration-Test Coverage

Test complete service interactions.

Required examples include:

* PGN parser to canonical game model.
* Canonical game model to database.
* Database to library UI.
* FEN input to Analysis Studio.
* Analysis request to Stockfish and back.
* Engine output to evaluation graph.
* Live provider response to canonical live-game state.
* Live-game state to visible board.
* Puzzle attempt to validated progress record.
* Academy assessment to persisted completion.
* Backup to restore.
* Profile switch to profile-specific storage.
* Cache lookup to result reuse.
* Cancellation to resource cleanup.

Use real local components where practical.

Mock only external dependencies or nondeterministic systems that are appropriately isolated.

Do not mock the very component whose correctness the test is intended to verify.

**Acceptance criteria:** Integration tests demonstrate that actual data flows through the system and reaches the expected persisted or rendered result.

## SECTION 484 — End-to-End User Journeys

Implement end-to-end tests for the highest-value user journeys.

At minimum:

**Journey A — Play against Stockfish**

1. Open Chess World.
2. Start a game.
3. Select a difficulty or engine profile.
4. Make a legal move.
5. Receive a genuine engine response.
6. Verify the move is legal.
7. Complete or resign the game.
8. Verify the result is recorded correctly.
9. Reopen the saved game.

**Journey B — Analyse a PGN**

1. Import a valid PGN.
2. Open the game in Analysis Studio.
3. Request engine analysis.
4. Verify genuine engine output.
5. Navigate between moves.
6. Inspect the evaluation graph.
7. Save supported annotations.
8. Export the game.
9. Reimport the export.

**Journey C — Follow a live game**

1. Open the live-game dashboard.
2. Select an actually available supported game.
3. Receive or retrieve game updates.
4. Verify legal state transitions.
5. Show correct source freshness.
6. Handle a temporary disconnection.
7. Recover using the provider's supported mechanism.
8. Open the completed game for analysis when the required data is available.

**Journey D — Preserve profile isolation**

1. Open one local profile.
2. Import a private game.
3. Add annotations and analysis.
4. Switch to another profile.
5. Verify the private records are absent there.
6. Create separate records in the second profile.
7. Switch back.
8. Verify the first profile's data remains intact.

**Journey E — Learn and train**

1. Start an academy lesson.
2. Complete its actual interaction or assessment.
3. Submit an answer.
4. Validate the answer using the implemented rules.
5. Persist the result.
6. Reopen the module.
7. Verify that progress is restored accurately.

**Acceptance criteria:** These journeys succeed through the real integrated application rather than through isolated demo screens.

## SECTION 485 — Failure-Injection Testing

Deliberately introduce controlled failures.

Test:

* Missing Stockfish binary.
* Invalid engine configuration.
* Engine process crash.
* Malformed UCI output.
* Invalid PGN.
* Corrupted database.
* Failed migration.
* Insufficient storage.
* Interrupted export.
* Failed backup.
* Invalid restore file.
* Network timeout.
* Provider rate limiting.
* Duplicate live events.
* Out-of-order live events.
* Stale asynchronous results.
* Profile switch during active work.
* Worker termination.
* Unexpected application shutdown.

For each case, verify:

1. The failure is detected.
2. The failure is represented accurately.
3. User data remains protected.
4. Resources are released.
5. Retry or recovery is available when appropriate.
6. The UI does not falsely report success.
7. Diagnostics contain useful information.
8. Unrelated functionality remains usable.

**Acceptance criteria:** Failure handling is demonstrated through tests rather than assumed from defensive-looking code.

## SECTION 486 — Regression Protection for Existing ORBIS

Audit all changes against the existing ORBIS application.

Chess World must be additive.

Do not remove or replace:

* Existing browser functionality.
* Orion functionality.
* Existing navigation.
* Existing keyboard shortcuts.
* Existing account/profile handling.
* Existing application settings.
* Existing local data.
* Existing downloads.
* Existing tabs and browser state.
* Existing themes and customisation.
* Existing background services.

Reuse existing shared components only when their behaviour remains compatible.

Run the existing test suite and any available application smoke tests.

Review modified global styles, shared stores, navigation definitions, and application entry points for unintended side effects.

Do not fix unrelated application behaviour by changing it during the Chess World implementation unless that change is required and explicitly justified.

**Acceptance criteria:** Existing ORBIS workflows continue to operate as they did before Chess World was added.

## SECTION 487 — Test Data and Fixture Integrity

Maintain a deliberate test-data strategy.

Separate:

* Small unit-test fixtures.
* Integration-test fixtures.
* Performance datasets.
* Manually verified regression games.
* Malformed-input fixtures.
* Provider response fixtures.
* Engine protocol fixtures.

Do not ship test-only games as the user's personal library.

Do not mix fake provider responses with real live-game records.

Clearly label any demonstration data used in development.

Ensure that fixture licensing and attribution are compatible with the project's use.

Use synthetic player names or suitable public fixtures where possible.

Never fabricate a game and then present it as an authentic historical or live game.

**Acceptance criteria:** Test fixtures are reproducible, clearly identified, and isolated from the production user's library.

## SECTION 488 — Automated Quality Gates

Configure the project's available automated checks.

Depending on the existing stack, these may include:

* Formatting.
* Linting.
* Type checking.
* Unit tests.
* Integration tests.
* Build validation.
* Dependency auditing.
* Package verification.
* Migration tests.
* Desktop startup smoke tests.
* Critical end-to-end journeys.

Reuse the existing CI and build conventions.

Do not introduce a new CI service merely to create an appearance of maturity.

Define which checks are mandatory before release and which are informational.

A failed mandatory check must not be reported as a successful release gate.

If an existing failure is unrelated, identify it precisely and determine whether it is pre-existing before deciding how to handle it.

**Acceptance criteria:** The project has repeatable automated checks and an explicit policy for handling failures.

## SECTION 489 — Manual Acceptance and Usability Review

Perform a manual review of the actual desktop application.

Check:

* First entry into Chess World.
* Navigation between modules.
* Board usability.
* Game creation.
* Engine selection.
* Analysis controls.
* PGN import/export.
* Live-game discovery.
* Library browsing.
* Puzzle interaction.
* Academy progression.
* Error messages.
* Loading states.
* Empty states.
* Cancellation.
* Profile switching.
* Settings persistence.
* Window resizing.
* Keyboard navigation.
* Reduced-motion behaviour.
* Recovery after restart.

Do not evaluate only screenshots or isolated components.

Use the real application with the real backend and local persistence.

Inspect the console and relevant logs for uncaught errors.

Record any issues that remain.

**Acceptance criteria:** The feature has been exercised as an integrated desktop product, not merely reviewed as source code.

## SECTION 490 — Final Testing Acceptance Gate

Before declaring the testing phase complete:

1. Run all available required checks.
2. Fix regressions caused by the new implementation.
3. Re-run the checks after fixes.
4. Verify the most important user journeys.
5. Verify local data persistence.
6. Verify engine-result authenticity.
7. Verify live-feed failure handling.
8. Verify profile isolation.
9. Verify packaging and startup.
10. Produce a concise but evidence-based test report.

Do not report tests as passing when they were not run.

Do not claim universal correctness based on a small sample of positions.

---

# PART X — RELEASE ENGINEERING, PACKAGING, AND FINAL ACCEPTANCE

## SECTION 491 — Production Build and Packaging Integration

Integrate Chess World into the existing ORBIS production build.

Inspect the current desktop framework, packaging pipeline, resource layout, native dependencies, and supported operating systems.

Ensure that:

* Chess World assets are included.
* Required services are bundled correctly.
* Database migrations are included.
* Default configuration is valid.
* Engine integration is available in supported configurations.
* Required worker scripts are packaged.
* Resource paths work outside development mode.
* Runtime permissions are appropriate.
* Existing ORBIS resources remain intact.

Do not rely on development-only absolute paths.

Do not assume that a source file being present in the repository means it will be included in the packaged application.

**Acceptance criteria:** The packaged application can access the files and services required for Chess World without relying on the developer's repository layout.

## SECTION 492 — Stockfish Distribution and Licensing

Treat Stockfish as a separately governed dependency with its own distribution requirements.

Determine whether the engine is:

* Downloaded or installed separately.
* Bundled with ORBIS.
* Supplied through an existing application dependency mechanism.
* Selected from a supported local installation.

Do not silently choose a distribution model without inspecting the current architecture and applicable licensing requirements.

Verify the engine's applicable license obligations, version attribution, source-availability requirements when applicable, and any redistribution conditions.

Include required notices and corresponding source or source-access information as required by the applicable license.

Do not claim licensing compliance without verifying the actual binary and distribution arrangement.

Ensure that the application remains functional and explains the missing-engine state if Stockfish is not available.

**Acceptance criteria:** The engine distribution model is documented, operational, and reviewed for applicable licensing obligations.

## SECTION 493 — Third-Party Dependency Governance

Review the dependencies introduced or updated for Chess World.

For each material dependency, determine:

* Why it is needed.
* Whether an existing ORBIS dependency already provides the capability.
* Maintenance status.
* License.
* Security considerations.
* Bundle-size impact.
* Native runtime requirements.
* Upgrade implications.
* Whether the dependency is optional or mandatory.

Avoid adding multiple libraries that solve the same problem.

Pin or constrain versions according to the repository's established dependency-management policy.

Do not automatically upgrade unrelated dependencies as part of Chess World integration.

Run appropriate vulnerability checks where available.

Document any unavoidable unsupported or vulnerable dependency and its mitigation.

**Acceptance criteria:** The release does not acquire unexplained dependencies or avoidable licensing and maintenance risks.

## SECTION 494 — Upgrade Safety and Backward Compatibility

Test upgrades from representative existing ORBIS installations.

The upgrade must not:

* Delete existing user data.
* Reset unrelated settings.
* Replace local profiles.
* Remove existing browser state.
* Break existing shortcuts.
* Overwrite user-created files.
* Reinitialise the application as though it were a fresh installation.

Migrate Chess World data only when required.

Preserve compatibility with supported earlier Chess World schema versions.

If an older installation cannot be upgraded automatically, explain the issue and offer a safe recovery path.

Do not treat reinstalling ORBIS as a normal migration mechanism.

**Acceptance criteria:** An existing supported ORBIS installation can be upgraded without losing its existing application state or unrelated user data.

## SECTION 495 — First-Run Experience and Feature Discovery

Integrate Chess World into ORBIS's established navigation and visual system.

The entry point must be discoverable without overwhelming the existing interface.

On first entry, communicate the main available activities, such as:

* Play against a local engine.
* Analyse a game.
* Import a PGN.
* Solve puzzles.
* Learn chess.
* Explore openings.
* Follow supported live games.
* Review saved games.

Only present actions that are actually implemented and available in the current installation.

If Stockfish is missing, show an appropriate engine setup or availability state rather than a fake playable AI opponent.

If live providers are unavailable, explain the limitation without fabricating a live-game list.

Use the existing ORBIS design conventions, typography, motion, and navigation patterns.

Do not redesign unrelated ORBIS surfaces.

**Acceptance criteria:** A new user can discover genuine Chess World capabilities and understand the prerequisites for unavailable features.

## SECTION 496 — Release Configuration and Feature Readiness

Create a deliberate release-readiness configuration.

Where appropriate, distinguish between:

* Fully available features.
* Features requiring an installed engine.
* Features requiring a supported external provider.
* Features available only for compatible data.
* Experimental capabilities.
* Features intentionally deferred.

Do not expose internal development flags as confusing user-facing settings.

Do not advertise a feature as complete merely because a route exists.

Do not silently enable unsupported variants or incomplete integrations.

The release configuration must not disable core existing ORBIS functionality.

Document any feature that remains deferred and why.

**Acceptance criteria:** The released application exposes a truthful, internally consistent set of capabilities.

## SECTION 497 — Release Notes and User Documentation

Prepare accurate documentation for the delivered Chess World functionality.

Cover, where relevant:

* Core capabilities.
* Engine requirements.
* PGN import and export.
* FEN support.
* Local storage and profile isolation.
* Backup and restore.
* Analysis behaviour.
* Live-data provider limitations.
* Privacy and network behaviour.
* Troubleshooting.
* Unsupported formats or variants.
* Known limitations.

Document real behaviour rather than intended future behaviour.

Do not claim that every online game is available or that every live feed updates instantly.

Explain that live-data availability and freshness depend on the supported provider, source publication behaviour, network, and device.

Distinguish local Stockfish analysis from remote provider information and any optional AI-generated explanation.

Do not state that AI commentary is engine truth. Engine-derived results must remain distinguishable from generated prose.

**Acceptance criteria:** Documentation reflects the implemented product and does not promise functionality that is missing or unverified.

## SECTION 498 — Final Product Audit and Defect Triage

Perform a comprehensive final audit against Sections 001–500.

For every major subsystem, determine:

* Whether the implementation exists.
* Whether it is integrated into the real application.
* Whether its core path works.
* Whether data is persisted correctly.
* Whether error states are handled.
* Whether resource cleanup is correct.
* Whether profile ownership is enforced.
* Whether tests exist.
* Whether those tests pass.
* Whether the functionality is available in the packaged build.

Classify defects by severity and impact.

**Release-blocking defects include, at minimum:**

* Existing ORBIS functionality broken by Chess World.
* Private chess data leaking across local profiles.
* Fabricated Stockfish evaluations presented as genuine.
* Illegal moves silently accepted as valid.
* Silent loss of user data during import, migration, or upgrade.
* Corruption of saved games or annotations.
* Unbounded engine-process creation.
* Unsafe execution of imported content.
* Major crash loops.
* Core workflows that cannot complete despite being presented as available.
* Critical licensing obligations left unaddressed.

Resolve release-blocking defects before declaring the release ready.

Do not hide a defect by removing its UI while leaving related state or data handling broken.

Do not silently downgrade requirements to make the acceptance checklist pass.

**Acceptance criteria:** The final audit identifies remaining gaps honestly and prevents release-blocking defects from being treated as minor polish issues.

## SECTION 499 — Complete End-to-End Release Verification

Build and verify the final integrated ORBIS application using the repository's actual release process.

Perform the following sequence where supported:

1. Start from the current existing ORBIS installation.
2. Apply the changes without deleting unrelated user data.
3. Build the production application.
4. Package the application using the established pipeline.
5. Launch the packaged build.
6. Open Chess World.
7. Verify the chessboard and legal move handling.
8. Start a real local Stockfish game when the engine is available.
9. Import a real valid PGN fixture.
10. Analyse a real game using the local engine.
11. Save and reopen the analysis.
12. Export the game.
13. Verify the exported PGN.
14. Open a valid FEN.
15. Browse the local game library.
16. Test a supported live-data source when available.
17. Test a provider-unavailable state.
18. Test profile switching.
19. Verify profile data remains isolated.
20. Verify settings persist across restart.
21. Verify backup and restore.
22. Verify cancellation of a long-running job.
23. Review diagnostic output.
24. Verify the application can launch without development-only services.
25. Re-run relevant regression tests.

For any unavailable external service, distinguish an integration test using a controlled fixture from a real-provider verification.

A fixture can prove that the adapter handles known responses. It cannot prove that the external provider is currently available.

Likewise, a successful development launch does not prove that the packaged build works.

Record the tested operating system, build configuration, engine version where available, and relevant environmental limitations.

**Acceptance criteria:** The final release candidate has been built and exercised through real integrated workflows, with remaining gaps explicitly documented.

## SECTION 500 — FINAL MASTER ACCEPTANCE, DELIVERY, AND NON-NEGOTIABLE COMPLETION STANDARD

This is the final acceptance section for ORBIS Chess World.

The objective is not merely to produce 500 sections of code, a large collection of components, or an impressive landing page.

The objective is to deliver a genuinely functioning chess environment integrated into ORBIS, with reliable chess logic, real local engine analysis, dependable persistence, useful training tools, supported live-game integration, and a maintainable architecture.

### A. Core product acceptance

Verify that the delivered implementation provides the applicable, previously specified capabilities:

* Integrated Chess World navigation.
* A functional interactive chessboard.
* Legal move generation and validation.
* Correct handling of special chess moves.
* Local Stockfish integration.
* Real engine search and analysis.
* Engine difficulty and search configuration.
* Analysis of saved games and custom positions.
* PGN import and export.
* FEN reconstruction.
* SAN and UCI conversion.
* Game library and local archives.
* Analysis Studio.
* Evaluation graphs.
* Principal variations.
* Move classifications where supported by implemented logic.
* Puzzle interaction and validation.
* Academy lessons and persisted progress.
* Opening and repertoire tools.
* Endgame and training features that have actually been implemented.
* Supported live-game discovery and updates.
* Reconnection and stale-data handling.
* Local backups and restoration.
* Local-profile isolation.
* Diagnostics and recovery workflows.
* Accessible, responsive, and performant UI.
* Reliable production packaging.

This list does not authorise falsely marking unimplemented advanced features as complete. Every capability must be assessed against the real implementation.

### B. Chess correctness acceptance

Demonstrate that:

1. Every accepted move is legal under the active ruleset.
2. Castling obeys the relevant legality conditions.
3. En passant uses the correct position state.
4. Promotions preserve the selected piece.
5. Checkmate and stalemate are correctly detected.
6. Draw rules are handled according to the rules library and the applicable claim or automatic-draw semantics.
7. PGN and FEN imports are validated.
8. Engine moves are validated against the requested position.
9. Live-game updates cannot silently produce an illegal canonical position.
10. Unsupported variants are not misinterpreted as standard chess.

Do not implement a second, contradictory chess-rules engine in the UI.

### C. Engine authenticity acceptance

Demonstrate that:

* Stockfish is genuinely launched and communicates through the intended protocol.
* Engine readiness is confirmed before search.
* Search results belong to the correct request and position.
* Evaluation scores are correctly represented.
* Mate scores are not confused with centipawn scores.
* Stale search output is rejected.
* Cancellation is honoured.
* Missing or malfunctioning engines are reported honestly.
* Cached results retain their provenance.
* No fabricated score, principal variation, best move, depth, or node count is presented as genuine engine output.

If an engine result cannot be verified, do not present it as verified.

### D. Live-data acceptance

Demonstrate that:

* Every supported provider has a documented adapter.
* Only actually available provider capabilities are exposed.
* Responses are validated.
* Events are deduplicated.
* Out-of-order updates are handled.
* Missed updates are recovered through supported mechanisms.
* Stale data is clearly indicated.
* Source timestamps and local receipt times are distinguished where available.
* Provider failure does not create imaginary games or moves.
* Network retries respect rate limits.
* Completed games can be archived when valid data is available.
* Archived games can be opened for analysis.

Do not promise universal coverage of every tournament, board, player, or online game.

### E. Data-integrity acceptance

Demonstrate that:

* Local games survive application restarts.
* User annotations survive application restarts.
* Analysis results are persisted accurately.
* Imports do not silently corrupt existing records.
* Duplicate resolution preserves meaningful differences.
* Database migrations preserve supported older data.
* Backup and restore work.
* Interrupted jobs recover safely.
* Deletion respects ownership and dependencies.
* Profile switching does not expose data across profiles.
* Cache cleanup does not delete authoritative user data.
* Data export preserves the supported information.

### F. Existing-application acceptance

Verify that:

* ORBIS remains the host application.
* Chess World is an integrated feature, not an unrelated replacement application.
* Existing browser functionality remains available.
* Existing Orion functionality remains available.
* Existing shortcuts remain intact.
* Existing navigation remains compatible.
* Existing local profiles remain intact.
* Existing user data is preserved.
* Existing settings are not reset.
* Existing build and packaging conventions are respected.
* No unrelated UI or behaviour has been changed unnecessarily.

### G. Quality acceptance

Verify that:

* Core logic has meaningful unit tests.
* Cross-service workflows have integration tests.
* Critical user journeys have end-to-end coverage.
* Failure paths are tested.
* Race conditions are tested.
* Performance has been measured.
* Memory and resource ownership have been reviewed.
* Accessibility has been checked.
* Diagnostics are privacy-conscious.
* Dependencies and licenses have been reviewed.
* Production packaging has been tested.
* Release documentation is accurate.

A test that merely confirms that a component renders is not sufficient evidence that the underlying feature works.

### H. Required final engineering deliverables

Produce the following real artifacts in the repository, adapting paths to existing conventions:

1. **Implementation traceability report** — mapping Sections 001–500 to actual implementation and verification.
2. **Architecture summary** — describing the major services, data flow, ownership boundaries, and integration points.
3. **Database and migration documentation** — identifying the schema, migration process, and recovery approach.
4. **Engine integration documentation** — explaining Stockfish discovery, lifecycle, protocol, configuration, and troubleshooting.
5. **Live-provider documentation** — identifying supported sources, capabilities, freshness limitations, and recovery behaviour.
6. **Local-data and privacy documentation** — explaining profile isolation, network behaviour, backups, exports, and deletion.
7. **Testing report** — listing the actual checks executed and their results.
8. **Known-issues report** — identifying unresolved limitations and their severity.
9. **Release-readiness report** — recording build, packaging, smoke-test, and acceptance results.
10. **User-facing documentation** — explaining the capabilities that are genuinely available.

Do not generate reports that claim successful tests without executing them.

Do not create documentation that describes a hypothetical architecture different from the code.

### I. Final implementation procedure

Follow this order:

**Step 1 — Inspect.** Audit the existing repository and all previous implementation work.

**Step 2 — Map.** Connect every requirement to the relevant subsystem, existing code, or missing implementation.

**Step 3 — Prioritise.** Fix correctness, persistence, security, and integration problems before cosmetic issues.

**Step 4 — Implement.** Complete the missing functionality with minimal disruption to existing ORBIS behaviour.

**Step 5 — Verify continuously.** Run focused tests after each meaningful change.

**Step 6 — Integrate.** Verify that components work together through the actual application.

**Step 7 — Stress and recover.** Test large datasets, concurrency, cancellation, resource pressure, and failure recovery.

**Step 8 — Package.** Build and test the actual production application.

**Step 9 — Audit.** Review all 500 requirements and identify unverified or incomplete items.

**Step 10 — Report.** Deliver a factual implementation summary, test results, known limitations, and release status.

### J. Mandatory rules for the coding agent

The following rules apply throughout the implementation:

1. Do not replace the entire ORBIS application.
2. Do not redesign unrelated ORBIS interfaces.
3. Do not remove existing working features to make room for Chess World.
4. Do not fabricate chess data.
5. Do not fabricate Stockfish output.
6. Do not claim a live source is working when it has not been verified.
7. Do not silently ignore malformed input.
8. Do not hide failed operations behind success notifications.
9. Do not upload personal chess data to a cloud service.
10. Do not mix local profile data.
11. Do not introduce unbounded background work.
12. Do not leave event listeners, workers, or processes running without an owner.
13. Do not create decorative controls that have no implemented behaviour.
14. Do not use dummy data as a substitute for production functionality.
15. Do not delete existing user data to simplify migrations or testing.
16. Do not suppress test failures without understanding their cause.
17. Do not claim a release is complete when release-blocking issues remain.
18. Do not mark all 500 requirements complete automatically.
19. Do not duplicate existing services without a clear reason.
20. Do not stop at the visual implementation when the required backend workflow is missing.

### K. Final completion report format

At completion, provide a concise but evidence-based report containing:

**1. Implementation status**

* Fully implemented and verified.
* Implemented but partially verified.
* Partially implemented.
* Not implemented.
* Blocked.

**2. Major subsystems**

* Chess rules and board.
* Stockfish integration.
* Analysis Studio.
* PGN/FEN.
* Local persistence.
* Game library.
* Training and academy.
* Live-game integration.
* Profile isolation.
* Background jobs.
* Performance and accessibility.
* Diagnostics.
* Packaging.

**3. Verification results**

* Build.
* Type checking.
* Linting.
* Unit tests.
* Integration tests.
* End-to-end tests.
* Existing ORBIS regression tests.
* Production-package smoke test.

For each item, report the actual outcome and any limitations.

**4. Data safety**

* Migration result.
* Backup/restore result.
* Profile-isolation result.
* Import/export result.

**5. Known limitations**
List every important unresolved issue without disguising it as completed work.

**6. Release recommendation**
Choose one:

* **Ready for release:** all release-blocking requirements are implemented and verified.
* **Ready for limited testing:** the core works, but identified nontrivial limitations remain.
* **Not ready for release:** one or more release-blocking issues remain.

Justify the recommendation with evidence.

### FINAL NON-NEGOTIABLE ACCEPTANCE RULE

**ORBIS Chess World is complete only when the implemented product—not merely the specification—satisfies its applicable requirements, passes the relevant verification, preserves existing ORBIS functionality, and reports remaining limitations honestly.**

The size of the codebase, the number of screens, the number of sections completed, and the visual sophistication of the interface are not substitutes for correctness.

Prioritise real functionality, legal chess, authentic engine analysis, reliable local data, clear failure handling, maintainability, and safe integration.

**End of Master Build Specification — Sections 401–500.**
do it fully in one go!