# Chess World

Chess inside Orbis: playing the engine, your own games, studying them, openings, endgames, training, and
tournaments being broadcast. This file says what exists, where it lives, and what has and has not been verified. It
is kept to what the code actually does.

Read off the tree at commit `5373cf82` plus the uncommitted work beside it. **The census below is a snapshot taken
at 14:45 on 2026-10-16**, while the chess work was still landing — nineteen files changed in the two minutes before
it was taken — so the file list and the counts have a time on them. The shape, the rules and the limitations are
what matter and they are stable; the way to redo the census is at the bottom.

## Where it is registered

- Screen: `src/renderer/src/components/chess/ChessView.tsx`, opened from the launcher (capability `chess` in
  `src/shared/commandCenter.ts`, feature id `chess` in `App.tsx`, loaded lazily).
- Window to main: 21 `chess:*` channels, written down in `docs/ipc-mapping.md`, which has a test keeping it
  matching the code. They are reachable from the window as `window.api.chessXxx` (`src/shared/types.ts`,
  `src/preload/index.ts`). Eight more go the other way; see below.
- Per-profile data: `personal/chess-games.json`. Registered as the `chess` category in
  `src/shared/portable/registry.ts`, so games travel with a profile export.
- The engine, which is not part of Orbis's own download, lives outside the application folder, under
  `<userData>/chess` (`chessHome` in `src/main/chess/ipc.ts`, wired that way in `src/main/index.ts`).

## How it is laid out, and why

Three jobs are kept apart on purpose: knowing the rules of chess, knowing what a game is, and knowing how to talk to
an engine. The module that does one does not do the others, and there is exactly one of each.

Almost everything is plain shared code in `src/shared/chess` with no Electron in it, which is what lets it be tested
with `node --test` and what would let it survive the move to the Chromium shell. `src/main/chess` holds the four
things that cannot be: the store, the channels, the engine process and the live provider. `src/renderer` holds the
screens.

### Knowing the game

| Concern | File | What it owns |
|---|---|---|
| The rules | `rules.ts` | The only opinion on legality in the application. Legal moves, playing one, promotion, check, the end of a game, notation for the position it belongs to, reading and building a FEN. Wraps chess.js (1.4.0, BSD-2-Clause). Ten other modules import it; none of them decides for itself what is legal. |
| What a game is | `model.ts` | `StoredGame` and its metadata, moves as moves, variation trees, the fingerprint that recognises the same game twice, and `SESSION_RIGHTS` — what may be done in a session, decided by the kind of session rather than by which screen you are on. |
| Which game, which position | `variants.ts` | Two refusals of the same kind. A `[Variant "Chess960"]` game is recorded and never read as ordinary chess, because that would be silently wrong in a game somebody kept; the registry says in four yes-or-no answers what Orbis can really do with each variant, and for everything but standard chess it is nothing. And the position editor's draft — placing, erasing, moving a piece with no regard for the rules — then telling a position that is not chess apart from one that is legal but could not have arisen from a game: the first refused, the second accepted without argument, because a composed study is unreachable almost by definition. |
| Engine scores | `evaluation.ts` | `Score` is centipawns, a mate, or nothing — never a mate flattened into a number. Stored White-positive; `fromEngine` turns the engine's point of view round once, at the edge. Move classes and their thresholds. |
| Reading an engine | `uci.ts` | Text in, facts out. `parseInfo`, `parseLine`, `goCommand`, and `LineReader`, which turns pipe reads into whole lines — a read from a pipe is not a line, and feeding the parser a fragment is how an evaluation goes missing. |
| Games as files | `pgn.ts` | `readPgn` / `writePgn`. Reading problems and playing problems are kept apart: a file can be perfectly formed and hold a move that cannot be played, and the person is told which it was. |
| Clocks | `clock.ts` | Time is measured, never counted. The state holds what each side had as at a stamp, and the time left now is worked out from the difference, every time it is asked. A window that stops redrawing for four seconds comes back to a clock four seconds further on, because the clock was never the thing counting. `now` is an argument and is meant to be monotonic — the wall clock can be set backwards by an hour and hand somebody an hour. |

### Playing

| Concern | File | What it owns |
|---|---|---|
| A game against the engine | `arena.ts` | The session: who has which colour, whose turn it is, when the engine must think, how the game ends. It plays no moves and talks to no engine; it says what the engine should be asked and judges the answer. The engine is asked once per turn — a screen that asks again on every redraw gets two searches for one position, and that is how a program plays two moves in a row. |
| What the opponent says | `commentary.ts` | A remark may only say what `rules.ts` or a real engine evaluation established. There is no third source and no pattern matching that names a tactic: nothing there can see a fork, so nothing says "fork". Every remark carries the facts it leaned on. With nothing to go on it stays quiet, and silence is used often. |

### Looking at a game

| Concern | File | What it owns |
|---|---|---|
| Studying | `analysis.ts` | A session over one game: walking it, branching off it, promoting a branch, deleting one and putting it back, notes keyed to the position rather than to a row in a list, and a game report — the graph, the critical moments, the missed mates, with the stretches nothing searched left as holes. The game record is never edited by looking at it. |
| Openings | `openings.ts`, `openingsData.ts` | Naming the position from a dataset, exploring what the dataset knows from here, and whether two move orders have really transposed — which means the same position by `positionKey`, so two boards differing in castling rights are never merged. The dataset counts nothing, so no popularity is shown and none is invented. |
| A repertoire | `repertoire.ts` | The lines you decided to play, and whether you remember them. The rule: it knows what you intended and nothing else. A legal move that is not in your book is **off book**, said without judgement; it is only called a mistake when an engine score comes with it, and then `evaluation.ts` does the naming from real numbers. |
| Endgames | `endgames.ts`, `endgamesData.ts` | Exhaustive search over `legalMoves` that settles mate in n, a forced promotion in n and a forced draw in n — and refuses to settle "White wins" or "technique", because that needs a tablebase and inventing the answer would be worse than saying so. A node budget, and `complete: false` when it runs out, so a false means "not proved" and never "not true". The endings themselves are positions set up for Orbis by hand to put one idea plainly; each entry's `provenance` says exactly that, and none is presented as a historical diagram. |
| Finding a position | `positionSearch.ts` | "Have I had this before, and where." Exact means the same position for the purpose of what is legal now — `positionKey` — and exactly one rule is allowed to call itself exact. The looser rules (same pieces whoever is to move, same pawn skeleton) each carry their own `ignores` list in plain words, and the list travels with the result. |
| Famous games | `famous.ts`, `famousData.ts` | Fifteen games that were really played. The moves of a game are facts and nobody owns them; what people own is the writing about them, so the collection is moves typed in as data with every word of commentary written for Orbis. That reasoning is in the file so nobody later pastes in a page of annotations and assumes it is fine, and the collection is deliberately small because a thousand-game one would have come from a database somebody compiled. |
| The library | `library.ts` | Finding one game among thousands: folded text search so "Nielsen" finds "Nielsøn", filters counted off the games that are really there, sorting where unknown sorts last in both directions, a partial date treated as the interval it is, paging, collections, and duplicate comparison that says which of three things two records are and never merges anything by itself. |

### What the record shows

| Concern | File | What it owns |
|---|---|---|
| Weaknesses | `coach.ts` | A profile built only from counted observations. Every weakness carries `evidence` and `because` as required fields; where there is not enough evidence it produces a **refusal** naming how many observations exist and how many are needed. No rating estimate — a rating is a result of games against rated opponents, and Orbis has none — and no psychology. Plus a study plan the person can reorder, rename and dismiss. |
| Progress | `progress.ts` | Counts, success rates and completion rates kept as three different things, because one number standing in for three is the usual dishonesty of a progress screen. A game is counted and never rated: you can lose a well played game. Every rate carries both its numbers and a `firm` flag, and a rate with no denominator is null, never zero. Every measure states its range. `ACCURACY_FORMULA` is both the definition and the string shown, so the number and the sentence cannot drift. |
| Goals and streaks | `challenges.ts` | Every goal counts activities that exist, so there is no challenge for a feature that is not there. Five streak rules, shown on screen: a sitting counts only when something was produced, two records of one sitting are one sitting, it counts on the day it happened, a future-stamped sitting is ignored, and a record written later cannot repair that day's streak. |
| Puzzle difficulty | `puzzleRating.ts` | Mostly, when a rating cannot be given. A puzzle with no rating cannot move a person's rating, and `rateAttempt` says so rather than quietly skipping. Below a stated number of attempts a person has a working number and not a rating, and `standingOf` returns `meansAnything: false`. |

### Training and the Academy

| Concern | File | What it owns |
|---|---|---|
| Exercises | `exercise.ts` | What a puzzle or task is, and whether it is real. `newExercise` always stamps unverified; `validateExercise` recomputes the answer from the position rather than believing the record. The solution is a tree, so a second mate in one is not marked wrong. |
| One attempt | `attempt.ts` | The states an attempt can be in, and what a move proves. An illegal move and a legal move that misses the point are different answers and never share a message. Hints are recorded separately from the solve. |
| When it comes back | `spaced.ts` | Turns an attempt into a grade for the scheduler Orbis already has (`src/shared/compute/learning.ts`). There is no second spaced-repetition implementation. An answer reached with the move shown is a lapse, not a pass. |
| Calculation | `calculation.ts` | A whole line typed out from the head, walked move by move against the position reached. A notation fault and a chess fault are reported as different things. |
| Blindfold | `blindfold.ts` | Questions whose answers are read out of the position, piece tracking through a line (en passant takes a pawn that is not on the landing square, castling moves two pieces, a promoted pawn keeps its identity), and marking a remembered board with the partial-credit rule written down. |
| Puzzles | `puzzles.ts`, `puzzleGen.ts` | What a puzzle is on top of an exercise: a theme, a difficulty and a provenance. A theme is never a bare string but a claim carrying its evidence, because a trainer that files a puzzle under *fork* on a model's word will build a session of forks containing no forks. `puzzleGen.ts` makes puzzles out of your own games, and a moment in a game is a suggestion rather than a puzzle until it survives five checks: a real swing between two searches that both reached depth and neither of them a bound, a clearly better move that existed, not trivial, not ambiguous, and a solution the rules confirm rather than the engine asserting it. |
| What a training screen may show | `trainingView.ts` | Hiding the board is a rule, not a style. A blindfold trainer that draws the board and hides it with CSS has not hidden it — the position is then in the document, the accessibility tree, a tooltip, a screenshot and the move list — so one function decides whether a board may be on screen and nothing else is allowed an opinion. |
| Lessons | `lessons.ts` | A lesson is data, not a React file. Reading is recorded and never moves the completion: a lesson is finished when its tasks have been demonstrated. Every task is an `Exercise`, judged by the same judge as a puzzle. |
| The curriculum | `curriculum.ts` | Seventeen lessons and their tasks, as data. Not one position was written from memory and left alone: the mate puzzles came out of an exhaustive search over the real rules, the material lines were built by enumerating every reply, and `curriculum.test.ts` re-derives all of it on every run. It is deliberately small, and the two things cut are stated rather than filled — nothing asks for the "best" move, because best is an engine's opinion and this layer has no engine. |
| The way through | `academyPath.ts` | What is open, what is next, what is due, and what a kept record may claim. Skipping is not finishing: a lesson can be marked already known, which credits its concepts for unlocking what follows and never makes the lesson complete. |

### The machinery

| Concern | File | What it owns |
|---|---|---|
| A person's games | `src/main/chess/store.ts` | Per-profile storage, import, export, search. Moves read off disk are replayed rather than trusted. A record that cannot be read is left alone, not replaced with an empty game. |
| The window's way in | `src/main/chess/ipc.ts` | The only chess file that knows about Electron. Every channel takes `unknown` and checks it. |
| The engine | `engine.ts` | The UCI conversation: one search at a time, commands that never interleave, a result that always names its request and position, and `ready` only after a real handshake. |
| Getting the engine | `install.ts` | Resolving an upstream release, choosing an asset by what the release really offers, hashing the download against the release's digest, unpacking the executable and the licence, recording what was installed. |
| A game played elsewhere | `src/shared/chess/live.ts` | The normalised live record, and `reconcileSnapshot`, which is why a feed that re-sends a 56-move game does not add 56 moves again. Freshness and clocks say where their value came from: received, or worked out here. |
| What a screen may say about one | `liveView.ts` | `live.ts` is the authority on what a broadcast game is; this is the authority on what the screen may say. The split exists because the two fail differently: ingestion fails by believing a provider, a screen fails by believing itself — showing a worked-out clock as a reading, or a position that stopped arriving as the current one. |
| Lichess broadcasts | `src/main/chess/live/lichess.ts` | The one live source there is. Five documented endpoints, one request at a time, snapshots labelled as snapshots, a 429 that waits. |
| Following live chess | `live/manager.ts` | Listing what is on is not following it: only `follow()` opens a connection. Old subscriptions cannot speak, and a burst of sixty games is reported as one change. |
| Reference data | `reference.ts` | Whether a dataset is really here. A dataset is present because something looked, not because a setting says where it would be: the one piece of evidence that is only a path can never produce "present", it produces "nobody has looked", with the path shown. Written against the real failure — a database reporting "Tablebase: installed" from a set preference, then answering endgame questions out of guesswork while somebody believes they are reading perfect play. |
| Settings and the keyboard | `settings.ts` | Every field says **where its value lands**, because a settings screen is the easiest place in a program to ship a control that does nothing. A field whose value goes nowhere is `stored` with a `waitingFor`, and the screen prints a statement instead of drawing a switch. A stored file is read field by field, so one bad number costs one preference and not the file, and every fallback is reported. Plus the keyboard: the chords Chess World claims, the chords the rest of Orbis claims, the keys the board answers, and a check that no two claim the same key in the same place. |
| The screen | `ChessView.tsx`, `chess.css` | Play, Study, Library and Live over one board. |
| The board | `Board.tsx`, `board.css` | Draws the position it is given and asks for moves; decides nothing about chess. Mouse or keyboard: arrows walk the squares, Enter picks up and puts down, Escape lets go. Pieces are the standard characters, so no image files and nothing licensed. |

## From the board to the disk

A move the person makes goes one way, and every step is somebody's job alone:

1. `Board.tsx` asks `destinationsFrom(fen, square)` which squares it may offer. It offers those and no others, so a
   square that would leave the king in check is never on screen.
2. The person drops a piece. `Board.tsx` calls `applyMove` for that exact position. If it comes back null nothing
   happens — the board does not decide to allow it anyway.
3. `ChessView.tsx` adds the move to the open game and sends the whole line over `chess:save-moves`. The whole line,
   not a move, so a game cannot end up half saved.
4. `ipc.ts` checks the shape of what arrived and asks the store to save it.
5. `store.ts` writes the game to the profile's file and recomputes the fingerprint, so the fingerprint always names
   what is really there.

Reading a game back is the same chain in reverse, with one more check: `normalizeGame` replays the stored notation
through `buildMoves` instead of believing it. A file edited by hand cannot put an illegal game back.

## Where games live, and whose they are

One file per profile: `<userData>/<profile>/personal/chess-games.json`, built by
`personalFile(userData, profileId, 'chess-games.json')`. The store holds a `Collection`, which normalises every
record on the way in and caps the file at 20,000 games.

Switching profile calls `chessStore.useProfile(id)` — `ChessStore` is in the `personalStores` list in
`src/main/index.ts`, which is what makes the switch happen for every personal store at once rather than for the ones
somebody remembered. Nothing in the store reads a path that was not built from the current profile id, so two people
on one computer never see each other's games. On quit, `quitFlush` has three chess entries: the games are flushed,
the engine is told to stop, and any broadcast being followed is let go.

**Games are the only thing stored.** There is one store and it holds games. Settings, repertoires, exercises,
attempts, review cards, annotations, study plans, goals, streaks and Academy progress are all modelled — several of
them with careful field-by-field readers so that one bad value costs one preference rather than the file — and none
of them is written anywhere yet.

What is not known is left out. A game with no date has no date; it does not get today's. A player with no name has
no name, and a row is named by its event, or by how many moves it has, rather than by "Unknown vs Unknown".

## The channels

Twenty-one, all registered in `src/main/chess/ipc.ts` and listed in `docs/ipc-mapping.md`.

| Channel | What it does |
|---|---|
| `chess:games` | Every game in this profile, newest change first. |
| `chess:game` | One game by id. |
| `chess:search` | Searches names, event, site, opening, ECO, date and tags — all of them things actually stored. |
| `chess:create` | A new game record from a source and an optional start position, which is checked before it is accepted. |
| `chess:save-moves` | The game's whole line as it now stands, plus metadata. |
| `chess:update` | Metadata, tags, favourite. |
| `chess:remove` | Deletes one game. |
| `chess:import-pgn` | Opens a file picker, reads the file, reports what happened to every game in it. |
| `chess:import-pgn-text` | The same from text already in hand — a paste, a drop, a file picked elsewhere. |
| `chess:export-pgn` | One game or many, to a file the person names. |
| `chess:to-pgn` | One game written out without saving it, for copying. |
| `chess:live-events` | What a provider is carrying. A plain request: nothing is connected to. |
| `chess:live-games` | The games in one event, before anybody is following anything. |
| `chess:live-follow` | Opens the one subscription there is. |
| `chess:live-unfollow` | Closes it. |
| `chess:live-state` | Every game being held, each with its freshness worked out as at now, plus the connection's health. |
| `chess:live-save` | Keeps a broadcast game as the person's own, with a `broadcast` source naming the provider, the game and when it was retrieved. |
| `chess:engine-status` | What the engine is, where it came from, and what it is doing. |
| `chess:engine-install` | Starts the install and returns immediately; progress arrives on a push channel. |
| `chess:analyse` | Asks about a position. The position is checked first. Returns the request id. |
| `chess:stop-analysis` | Stops one search, or whatever is running. |

Eight go the other way, main to window, and **seven of them have a listener** in `src/preload/index.ts`:
`onChessAnalysis`, `onChessAnalysisFailed`, `onChessEngineProgress`, `onChessEngineChanged`, `onChessGamesChanged`,
`onChessLiveChanged`, `onChessLiveDiagnostic`.

The eighth, **`chess:engine-failed`, has no listener**. It is the one that reports that setting the engine up
failed — `ipc.ts` sends it when the install rejects — so an install that fails is, today, silent in the window:
`onChessEngineChanged` fires on success and nothing fires on failure. `docs/ipc-mapping.md` and its test cover
registered channels, not push channels, which is why the map does not show this.

Every channel takes `unknown` and checks it. Strings are length-capped, numbers are clamped, and an analysis request
with no limit at all is given one, because a search with no limit would run until something stopped it.

## Three outside pieces, and what each one costs

| What | Licence | Bundled? |
|---|---|---|
| chess.js 1.4.0 — the rules | BSD-2-Clause | Yes, an ordinary dependency. |
| Stockfish — the engine | GPL-3.0-or-later | **No.** Fetched from upstream's release on request. |
| lichess-org/chess-openings — 3,865 named positions | CC0-1.0 (public domain dedication) | Yes, as `openingsData.ts`. |

The opening dataset's provenance is recorded in the file it lives in: the repository, the commit
(`a6189a30dc273ccb21fc2536a9a2fefd5592a67a`, dated 2026-10-06), the date it was fetched, the entry count, and the
licence checked against the repository rather than assumed — shipping data nobody may ship is not a thing that can
be fixed later. The file is generated, and the generator plays every line through `rules.ts`, so a line in it is a
line Orbis can really reach. It carries no statistics at all and says so in a field, which is why the explorer
reports that the dataset counts nothing instead of ordering continuations by a number it would have had to invent.

The famous games take the same care from the other direction: moves are facts and nobody owns them, writing about
moves is owned, so the games are moves as data with every word of commentary written for Orbis, and the reasoning is
in `famous.ts` rather than in somebody's head.

## The engine: why nothing is bundled

Chess World analyses with Stockfish. Stockfish is GPL-3.0, Orbis does not ship GPL code, and so **no engine binary
is in this repository or in the Orbis installer**. It is fetched from upstream's own GitHub release, on request,
into the person's own app-data folder — the same shape as the image engine and the music engines, for the same kind
of reason.

What that means for the person, and what the screen says:

- Until they ask for it, there is no engine. The Play tab says so plainly, says Stockfish is a separate free program
  under its own licence, and offers to fetch it. It does not offer an opponent that cannot play.
- Everything that does not need an engine still works with no engine: setting up a board, playing both sides,
  bringing games in, looking through them, exporting them.
- The download is verified before it is run. GitHub gives every release asset a `sha256:` digest; the download is
  hashed as it arrives and compared. A release with no digest — older Stockfish tags have none — is **refused**
  rather than executed, unless the caller explicitly accepts an unverified download, and then `verified: false` is
  recorded and stays visible in the status. "It works" never quietly means "we ran whatever arrived".
- The licence travels with the binary. Upstream's archive carries `Copying.txt` beside the executable, and that is
  the file kept in the installed folder — not a copy written from somewhere else. The install record names the
  archive it came from, so the matching source is one address away.
- Only the executable and the licence are unpacked. The rest of the archive is about 100 MB of source and wiki that
  nothing reads.
- Windows only. Every other platform's asset is a tar, and this installer reads ZIPs. On those platforms the status
  says so, and a binary the person installed themselves can be pointed at instead.
- No instruction-set guesswork. Node cannot see whether this processor has AVX2, so the preference is the universal
  build, then the baseline build that runs anywhere. Never `-avx2` on a hunch.

Where it goes: `<userData>/chess`, holding the executable, the licence and `installed.json`.
`ORBIS_CHESS_ENGINE_HOME` overrides it, and with neither it falls back to `%APPDATA%/Orbis/chess/engine`.

Four rules the running engine keeps, each because of the way it fails otherwise:

- **A result belongs to a position.** Every update carries its request id and the FEN it was calculated in. An
  analysis board moves on while the engine is still thinking; an update from a search that is no longer the running
  one is dropped, not relabelled. `acceptUpdate` in `analysis.ts` checks both again at the receiving end.
- **A bound is not an evaluation.** `lowerbound` and `upperbound` mean the engine stopped looking once it knew the
  score was past a window. It is passed on marked as a bound and never recorded as a settled score.
- **A line is only shown if it can be played.** The engine's variation is coordinates; it is converted through
  `rules.ts` against the position it was calculated in, and if any move does not fit, the readable line is dropped
  and the coordinates kept. The fault stays visible instead of being papered over.
- **"Ready" is something that happened.** A binary on disk is not an engine. The state reaches `ready` only after
  `uci` was answered with `uciok`, the options were read, the ones Orbis sets were accepted, and `isready` came back
  `readyok`. The name in the status is what the engine said about itself in this process, not a version parsed out
  of a filename.

## The live-data position

There is one live source, Lichess broadcasts, and it is a real one: every endpoint in
`src/main/chess/live/lichess.ts` was read out of the published OpenAPI document and confirmed against the running
service. Nothing scrapes. If a response stops looking like the documented schema the adapter says so and stops,
because a provider that has quietly changed shape otherwise looks exactly like a provider having a bad afternoon,
for as long as nobody checks. No credentials are needed: the broadcast endpoints are public.

Four facts about that feed shape the code: the stream re-sends whole games (so everything arriving is a snapshot,
and is labelled one); only one request at a time is allowed; there is no heartbeat, because a classical player is
entitled to think for twenty minutes; and a 429 means wait at least a minute.

It is wired as far as the window's door. `src/main/index.ts` builds a `LiveChessManager`, registers the Lichess
provider with Electron's `net.fetch`, and six `chess:live-*` channels reach it; a followed game can be kept as the
person's own. **The mounted screen does not call any of them.** The Live tab still says following broadcasts is
being built and that nothing will be shown there until it comes from a real broadcast, which is the honest state: an
empty tab is honest, and a list of tournaments that were not fetched would not be.

## Known limitations

True as at the snapshot, in the order they would bite somebody.

1. **The screen is the old one.** `src/renderer/src/components/chess` holds sixty TypeScript files and twelve
   stylesheets, in ten folders — academy, analysis, coach, editor, library, live, openings, search, settings and a
   three-dimensional board. `ChessView.tsx`, the file the launcher opens, is the original four-tab view with eight
   imports, and not one of them is any of those. Every panel, sheet, studio, editor, explorer and settings screen
   written for Chess World is reachable by nothing. This is the single biggest gap between what is built and what a
   person can do, and almost every limitation below is a consequence of it.
2. **A failed engine install is silent.** `chess:engine-failed` is sent and nothing listens. See the channel
   section.
3. **Nothing but games is stored.** One store, for games. Settings, repertoires, exercises, attempts, review cards,
   annotations, plans, goals and Academy progress live for as long as the function call that made them.
4. **A variation cannot be kept.** `analysis.ts` builds and edits trees properly and `StoredGame` has no field to
   put one in, so a game explored and annotated goes back to the store as its own line again. `pgn.ts` reads
   bracketed variations and deliberately drops them for the same reason.
5. **The endgame catalogue is unchecked.** `endgamesData.ts` is designed to be recomputed by `verifyEntry` on
   every run — the position legal and reachable, the stated side to move, the objective not already met, the written
   line playable, and "in n" proved to be exactly n — and there is no test that runs it. The famous games have the
   equivalent guard and it exists: `famous.test.ts` replays all fifteen through `rules.ts`.
6. **Five settings fields go nowhere yet.** `settings.ts` has thirty fields; twenty-three are wired to something,
   two are sized by the engine itself and shown as a statement, and five are `stored` with a `waitingFor` naming
   what will read them. That is a deliberate, visible gap rather than five dead switches — the screen prints a
   statement for them — but they are still five preferences that do nothing.
7. **The declared types are narrower than the real ones.** `chessEngineStatus` is declared in `src/shared/types.ts`
   as `{ state, detail, name?, version? }`; `EngineStatus` in `engine.ts` returns considerably more and calls the
   release tag `installedVersion`, not `version`. The six live channels and three of the push listeners are declared
   as `unknown`.
8. **`SESSION_RIGHTS` is kept only where nobody can reach.** The table saying a watched game cannot take your moves
   and a puzzle does not resign is in `model.ts`. `analysis/AnalysisStudio.tsx` reads it and `live/LiveViewer.tsx`
   defers to it, and neither is mounted; the screen that is mounted mentions it in a comment and then decides for
   itself.
9. **Search over the stored games is substring only.** `chess:search` matches text. `library.ts` and
   `positionSearch.ts` can do far more — filters, ranges, sorting, duplicates, finding a position across your games
   — over games they are handed, and nothing hands them any.
10. **Variants are recorded, not played.** `variants.ts` says so in four yes-or-no answers per variant, and the
    answer for everything except standard chess is no.
11. **Not one line of this has been seen running.** There is no screenshot and no runtime check over the debugging
    port, of the board, the move list, the library or the engine panel. No test has run the real Stockfish binary.

## What is verified and what is not

At the snapshot: thirty test files in `src/shared/chess` and four under `src/main/chess`, against thirty-eight
shared modules — a little over a thousand cases in all. Every one of them runs with `node --test` and none needs
Electron or a network. One was failing; see below. The totals move as work lands; what matters is which kind of
claim each one supports.

| File | What it proves |
|---|---|
| `rules.test.ts` | Legal moves from the opening, an illegal move changing nothing, castling from the rights rather than the look of the board, en passant from the square in the position, mate, stalemate, insufficient material, check without the game ending, repetition decided by the history, a broken FEN refused with the part that is wrong named, an engine line converted only while it stays legal, and a position built by hand. |
| `curriculum.test.ts` | **The strongest guard in the folder.** It re-derives every authored position from the rules on every run: every mate task mates in exactly the number of moves it claims, every task is solvable by playing its own answer, every task says where it came from, nothing claims an engine opinion, and the concept graph is sound with every lesson reachable in order. Several positions came out of that process different from how they were first written. |
| `openings.test.ts` | That every one of the 3,865 dataset lines really plays and names its own position; "not in the dataset" given plainly; an explorer that counts what it knows nothing about rather than hiding it; transposition by `positionKey`, so two boards differing in castling rights are never merged. |
| `library.test.ts` | Folded search over accented names, a partial date as an interval, unknown sorting last in both directions, filters and their descriptions, paging by cursor, collections, and duplicate comparison that says which of three things two records are. |
| `variants.test.ts` | The variant registry's refusals, the editor draft, a FEN read field by field, and a position that is not chess told apart from one that is legal but unreachable. |
| `analysis.test.ts` | The study session: branching, promoting, deleting and restoring a line, notes that stay on the move they were written about, the holes left where nothing was searched, and an update refused unless it names both its request and its position. |
| `exercise.test.ts`, `attempt.test.ts`, `calculation.test.ts`, `spaced.test.ts`, `blindfold.test.ts` | The training layer: an exercise is a claim until checked, legality and correctness answered as two questions, a notation fault told apart from a chess fault, a hinted answer graded as a lapse, and the three blindfold traps. |
| `repertoire.test.ts` | Off book said without judgement, and a move called a mistake only when an engine score comes with it. |
| `settings.test.ts` | That every field says what it does and where it lands; that a field claiming to go nowhere really has no other route; that one bad value costs one preference and not the file; that the engine is asked with exactly the one limit chosen; that a mate is never turned into a number of pawns; and that no key is claimed twice in the same place — checked by reading `Board.tsx` and `ipc.ts` as text, so the shortcut map cannot drift from the code it describes. |
| `live.test.ts`, `lichess.test.ts`, `manager.test.ts` | A snapshot re-sent is not progress; moves replayed before they are believed; a correction reported as a correction; clocks that say whether they were received or worked out here; an embargoed broadcast never called live; the five documented endpoints; a 429 arriving with the wrong content type; a schema change reported as a schema change; listing without connecting; an old subscription unable to speak after a switch. |
| `engine.test.ts`, `install.test.ts` | The whole UCI conversation against a scripted stand-in process — handshake, option clamping, one search at a time, a cancelled search unfinished until its `bestmove` arrives, a process that dies mid-search failing the request with its exit code — and the install: an asset chosen from what a release really offers, a digest mismatch refused, a release with no digest refused unless explicitly accepted. |

**The stand-in is not the engine.** `engine.test.ts` drives a scripted process that speaks UCI. It proves this code
handles the protocol, the queue and the failures correctly. It does not prove anything about Stockfish, and no test
in the repository has ever run the real binary — that needs a download, and the download is deliberately not part of
the build.

**What has no test of its own**, at the snapshot: `model.ts`, `evaluation.ts`, `uci.ts` and `pgn.ts` — the first
three exercised through `engine.test.ts`, the fourth through `lichess.test.ts`, none of them directly;
`endgames.ts` with `endgamesData.ts`; `puzzles.ts` and `puzzleGen.ts`; `src/main/chess/store.ts` and
`src/main/chess/ipc.ts`; and every React file. `famousData.ts` and `openingsData.ts` have no file of their own but
are recomputed by `famous.test.ts` and `openings.test.ts`.

Three of those matter more than the rest, because each is built out of refusals, and a refusal that is never
exercised is a refusal nobody has seen made: `puzzleGen.ts` (the five checks a moment in a game must survive before
it is a puzzle), `endgames.ts` with `endgamesData.ts` (every claim in the catalogue is designed to be recomputed by
`verifyEntry` and nothing runs it), and `src/main/chess/store.ts` (the only store there is, and the one place where
"unreadable is not missing" has to hold for a person's own games).

**One test was failing** when this was read: `trainingView.test.ts`, three of seventy cases and then one, the last
being "a promoted pawn is still the piece that started on its square" — the piece-identity rule `blindfold.ts` is
built around. It was being worked on at the time. A failing guard is not a verified rule, so sections 211-230 are
recorded in the ledger as unverified rather than verified.

## Running the tests

```
node --test src/shared/chess/*.test.ts src/main/chess/*.test.ts src/main/chess/live/*.test.ts
```

`scripts/testFiles.mjs` is the list `npm test` runs, and `src/shared/testSuite.test.ts` checks that list against
what is on disk in both directions. At the snapshot several chess test files had not been added to it, so that guard
fails and names them — which is exactly what it is for.

## Redoing the census

Nothing in this file should be taken on trust once the tree has moved. The way it was compiled:

1. Every file under `src/shared/chess`, `src/main/chess` and `src/renderer/src/components/chess`, read by header
   and export list.
2. For each module: whether a `.test.ts` sits beside it, and which files anywhere in `src` import it — the second
   is what decides whether a person can reach it, and it is the question this build keeps answering "nobody".
3. Every test file run on its own with `node --test`, with the per-file pass and fail counts recorded.
4. The chess entries in `src/shared/commandCenter.ts`, `src/shared/portable/registry.ts`, `src/shared/types.ts`,
   `src/preload/index.ts`, `docs/ipc-mapping.md` and `src/main/index.ts`, and the `handle(` and `send(` sites in
   `src/main/chess/ipc.ts`, which is where the channel tables above come from.

## The ledger

`docs/chess-world-ledger.md` traces the specification's sections against the code, section by section, and says for
each whether it is implemented and verified, implemented and unverified, partial, not implemented, or not
applicable, with the counts at the end.
