import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The migration map, kept honest.
 *
 * `docs/ipc-mapping.md` says what every way the Orbis interface asks the application for something becomes in
 * Chromium. A map like that is worth nothing the moment it stops matching the code, and over a migration this long it
 * would stop within days. So it is checked: every channel in the code must be in the map, and every channel in the map
 * must still exist in the code.
 *
 * When this fails, the fix is to write down what the new channel becomes — not to delete the test.
 */

const ROOT = join(import.meta.dirname, '..')
const MAP = join(ROOT, '..', 'docs', 'ipc-mapping.md')

async function* typescriptFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* typescriptFiles(path)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path
  }
}

/**
 * Every channel the main process answers.
 *
 * Two ways of registering one, because there are two in the code. Most call `ipcMain.handle` directly. The larger
 * modules -- personal data, workflows, personalisation, tab locking -- define a local `handle` that checks the sender
 * first and then calls `ipcMain.handle` with the channel it was given, so the channel name never appears next to
 * `ipcMain` at all.
 *
 * Looking for only the first kind is what let a third of the boundary go undocumented while this test passed. A helper
 * called with a literal that has a colon in it is a channel; that is specific enough to find them and narrow enough not
 * to catch anything else.
 */
async function channelsInCode(): Promise<string[]> {
  const found = new Set<string>()
  for await (const file of typescriptFiles(join(ROOT, 'main'))) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) found.add(match[1])
    for (const match of source.matchAll(/(?:^|[^.\w])handle\(\s*'([a-z][a-zA-Z0-9-]*:[a-zA-Z0-9:_-]+)'/g)) found.add(match[1])
  }
  return [...found].sort()
}

/** Every channel named in the map, which writes them as `code` spans. */
async function channelsInMap(): Promise<Set<string>> {
  const text = await readFile(MAP, 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/`([a-z@][a-zA-Z0-9@/:-]*:[a-zA-Z0-9/-]+)`/g)) found.add(match[1])
  // The adblocker's own page-side channels are written with a slash rather than a colon.
  for (const match of text.matchAll(/`(@ghostery\/adblocker\/[a-z-]+)`/g)) found.add(match[1])
  return found
}

test('every way the interface asks for something is written down in the migration map', async () => {
  const code = await channelsInCode()
  const map = await channelsInMap()
  const missing = code.filter((channel) => !map.has(channel))
  assert.deepEqual(
    missing,
    [],
    `these exist in the code but not in docs/ipc-mapping.md. Say what each becomes in Chromium:\n  ${missing.join('\n  ')}`
  )
})

test('the map does not describe channels that no longer exist', async () => {
  const code = new Set(await channelsInCode())
  const map = await channelsInMap()
  // Only the ones that look like our own channels. The map also names Chromium classes, which are written the C++
  // way with a double colon — `content::WebContents` is not a channel.
  const ours = [...map].filter((name) => !name.includes('::') && /^(?:@ghostery|[a-z-]+:)/.test(name))
  const gone = ours.filter((channel) => !code.has(channel))
  assert.deepEqual(gone, [], `the map describes channels the code no longer has; remove them:\n  ${gone.join('\n  ')}`)
})

test('the boundary is a known size, so the migration can be estimated rather than guessed', async () => {
  const code = await channelsInCode()
  assert.ok(code.length > 50, 'the boundary should be substantial; if this drops sharply, something was deleted by accident')
  // A ceiling as well as a floor: the boundary should shrink as the migration goes, never grow by accident.
  // Raised deliberately for the specialized search provider, the reading list and saved pages, the browser sidebar,
  // asking the system which browser opens links, and the secrets vault. Each is written down in the map above.
  // 130 → 137: seven channels for goals worked through one step at a time (start, read, pause, resume, stop, skip,
  // and telling Orbis a challenge has been dealt with).
  // 137 → 139: weather and news for the new tab's widgets.
  // 139 → 135: Google sign-in removed. Orbis keeps everything locally and has no account.
  // 135 → 149: learned skills (saved from step-by-step runs, reused through the workflow engine).
  // 149 → 156: memory, kept per profile on this computer.
  // 156 → 162: saved Orion Search sessions.
  // 162 → 167: Galaxy.
  // 167 → 169: switching kinds of browser action off for Orion.
  // 169 → 174: local Pulsar speech to text — cancelling a transcription, reading this machine's hardware, and
  // managing model files (status, download, cancel a download, delete, verify) — replacing the single Groq call
  // voice:transcribe used to make on its own.
  // 174 → 176: opening Chromium, the browser Orbis now uses (whether it is installed, and open it).
  // 176 → 131: the Electron in-app browser's channels (extensions, permissions and devices, the session ad blocker, the library's
  // reading list, saved pages, pictures and download bookkeeping, pop-out windows) were removed with it.
  // 131 → 137: the password on the account — reading its state, setting one, opening it, closing it, checking one
  // without opening, and changing it. Six because each is a different question with a different answer; folding them
  // into one channel with a verb would mean one handler deciding which of six security rules applied.
  // 137 → 158: Tab Lock. Twenty-one, for the same reason: what is protected, the tab passwords, when a tab locks, which
  // sites are protected automatically, and locking and unlocking.
  // 158 → 239: none of these are new. Eighty-one channels for notes, tasks, clipboard history, whiteboards, workspaces,
  // profiles and personalisation were always there; they are registered through each module's own sender-checking
  // `handle` helper, so the channel name never appears beside `ipcMain` and this count never saw them. The count now
  // looks for both ways. The jump is the measurement being corrected, not the boundary growing.
  // 239 → 260: the workflow engine's channels, invisible for the same reason.
  // 260 → 263: Profile Lock — what it is, saving it, and locking Orbis now. Three, because reading a policy, writing one
  // and acting on one are three different things with three different answers.
  // 263 → 265: the security activity log — reading it and clearing it. There is deliberately no channel that writes one.
  // 265 → 274: Markets — reading the ticker's state, saving it, its groups, and searching for an instrument to put on it.
  // The strip itself adds none of these: it is a browser page and reads through the helper instead.
  // 274 → 275: the Markets master switch, which is a different question from whether the ticker is showing.
  // 275 → 292: the Markets page itself -- opening a market and releasing it, its prices, candles and depth, the trade
  // tape, the discovery snapshot behind movers and the heatmap, and watchlists. Seventeen because each is a different
  // question with a different answer and a different cost: a tape is not a price, and a question about every market is not
  // a question about one.
  // 292 → 300: the screener (running one, and saving, listing and deleting a screen) and alerts (reading them with
  // what has fired, saving one, deleting one, and clearing the history). Eight, because running a screen and saving
  // its definition are different things -- the definition is durable and the rows it returned were true for a moment.
  // 300 → 306: paper trading and the portfolio over it -- reading it, starting and closing an account, its
  // simulation settings, placing an order and cancelling one. Six, and every one of them is a simulation: there is
  // no credential in this process that could reach an exchange.
  // 306 → 313: strategies (list, save, remove) and backtesting (run one, sweep a parameter, read the recorded runs
  // and clear them). Seven, because saving rules and running them are different things: the rules are durable and
  // a run is a fact about rules and candles that can be produced again.
  // 313 → 316: crypto news from publishers' own feeds, and remembering where Markets was left. Three, and none of
  // them is a new engine: the news goes through the feed reader the new tab already uses, and the layout goes in
  // the profile's own markets file rather than a second workspace system.
  // 316 → 320: the display currency -- reading it, choosing one, going back to automatic, and the chooser's own
  // options. Four, and none of them is a second FX engine: one provider, one cache, one answer that every surface
  // formats from.
  // 320 → 333: the Markets experience layer. Five for how Markets should behave (the profile, a patch, one
  // hand-set override, a reset, and reading a sentence as a request without acting on it), three for the glossary
  // (one definition, a surface's terms, and remembering that one has been read), and five for the first-launch
  // questions (the record, the draft, applying it, skipping it, and running it again). The questions themselves are
  // not a channel: the window imports the same schema the validation reads. Thirteen, and none of them is a second
  // settings system, a second profile identity or a second market feed -- the answers land in the same per-profile
  // markets file, and every level reads the same data through the same gateway.
  // 333 → 339: derivatives and the analysed tape. Five for perpetual and dated futures -- one answer per contract, funding
  // history, open-interest history, positioning, and the contract list -- and one for the tape's own analysis, beside the
  // channel that answers with the prints alone so a tape refreshing twice a second does not pay for a calculation it is
  // not showing. The futures data comes from a second provider registered into the same engine, not a second engine.
  // 339 → 341: following a market's depth stream, opened and closed. Two rather than a flag on the read, because the
  // subscription is the heaviest one a venue offers and its lifetime has to be explicit: the engine refcounts it, and the
  // last panel to close releases it. Reading the book stays on `markets:book`, which now answers with whether what it is
  // showing is provably continuous.
  // 341 → 366: the rest of the Markets surface. Three for favourites and what was recently opened, four for chart
  // annotations, four for the panel layout, three for workflow triggers, two for simulated leverage, one for comparing
  // markets and two for telling a strategy that worked from one that was fitted. Twenty-five, and every one of them
  // lands in the same per-profile markets file: no second persistence layer, no second workflow engine, no second
  // market feed.
  // 390 → 392: `pages:participants` and `pages:send`, which make page-to-page composition reachable. The engine
  // existed and nothing could call it, so the feature was designed and absent rather than built.
  //
  // 389 → 390: `pages:answer`, the call that stops Orion producing a number it could have computed. It routes a
  // question onto an engine when it maps exactly and says "answer this normally" when it does not.
  //
  // 383 → 389: the rest of the Pages platform. Packaging (export and inspect), diagnostics, the accessibility audit,
  // the builder's check, and the search module. Six, and every one of them is a call into something pure: the deciding
  // is in `shared/pages`, so these are adapters rather than logic and they move as adapters.
  //
  // 366 → 383: Orbis Pages. Seventeen, and the shape is the point rather than the count -- one channel for the register,
  // three for finding a Page, two for resolving and opening an address, four for permissions, three for a Page's own saved
  // work, one for diagnostics, and exactly one for computation. That last one matters: `pages:compute` is the only route
  // from a Page to an engine, so a capability check in front of it is a capability check in front of all of them. A second
  // door would be a second place to forget.
  //
  // 392 → 410: candlestick pattern intelligence. Eighteen, and the split is the point rather than the number. Two are
  // the library, which is compiled in and answers from memory. Two examine — one a market, one a candle the user
  // picked. Two are the switches. Four are alert rules and muting, and they write rules only: the firing goes out
  // through the notification path Orbis already has, so there is no second alert engine and no second delivery. Two
  // separate deciding what should fire from recording whether it was delivered, because a firing is never stored as
  // delivered until something confirms it. Four are history and the measurements over it, and two of those refuse to
  // name a winner between two sets. One scans, one digests, one reports health, one reads the other timeframes.
  //
  // 410 → 421: moving a profile to another machine. Eleven, and each is a step a person can stop at. One describes what
  // exists and what cannot travel. One says whether a selection needs a password, which is a question worth answering
  // before the password box appears. One estimates the space, before doing the work rather than after running out.
  // One exports and one imports, and those two are the only ones that touch the profile. One inspects a package
  // without opening it, which is the whole reason the manifest is unencrypted. One cancels whichever is running. Two
  // are crash recovery: whether an import was interrupted, and clearing that once the person has been told. Two
  // run the file dialogs, which is deliberate: the dialog runs in this process so the package is written where the
  // person pointed rather than wherever a renderer asked for.
  //
  // The password crosses on the export and import channels and nothing derived from it comes back on any of them.
  //
  // 421 → 432: Pages that did not exist yet. Eleven, and the count is the shape of the feature rather than an accident.
  // One builds, and building keeps nothing -- so one keeps and one throws away, because a model writing a calculator
  // is something somebody should look at before it joins their library. One builds an existing Page again, which adds
  // a version rather than replacing one. One reads the history, and two choose which version opens, because going
  // back has to be publishing the version that already worked rather than asking for it to be written a third time.
  // One deletes a Page and its history. One lists what has been built recently, including what failed, because a
  // feature that only shows its successes is one nobody can debug. One serves the document a generated Page opens as.
  //
  // Nothing here grants anything. What a generated Page is allowed to do is computed from the calculations it uses,
  // in the compiler, and travels in its manifest like every other Page's -- there is no channel that could widen it.
  //
  // 428 → 433: applications, which are several Pages composed into one thing with routes and shared state. Five, and
  // again the count is the shape of the feature. One lists them with their navigation and anything wrong with them,
  // because a caller that has to ask a second question to learn whether the first answer is usable will sometimes
  // not ask. One reads a single one back, for editing and for export. One saves, and it rebuilds what arrives
  // through the application module's own constructors rather than trusting it -- so a hand-edited payload is refused
  // with a reason instead of stored and broken on the next read. One deletes. One answers which Page a route opens,
  // and it checks that Page is installed in this profile, because an application may name one that has since gone
  // and handing back its id would give the caller an address that opens nothing.
  //
  // None of these widens what anything may do either. An application refers to Pages by id; what each Page is
  // allowed to do stays in that Page's own manifest, and composing Pages cannot add up to more than the sum.
  //
  // 433 → 434: editing a generated Page without writing it again. One channel, and it earns its place by being the
  // difference between a change and a regeneration: asking for a different label used to hand the whole
  // specification back to a model, which could return a different calculation with it. This applies a named edit to
  // the specification that exists and produces a draft, so the version people open is untouched until somebody
  // publishes it.
  //
  // 434 → 439: the Lab. Five, for a graph of engine calls: one to run it, one to say what a run would do without
  // doing it, and three for what has gone stale, what would have to run again, and how the graph is faring. The run
  // channel is the one that matters -- it authorises every operation in the graph against the Page's grants before
  // any node runs, because the runtime evaluates synchronously and a permission check inside that loop is
  // impossible. Nothing here widens what a Page may do: a node reaches the same dispatch pages:compute reaches.
  //
  // 439 → 441: the market strip along the bottom of the Orbis window. One to read what it draws, one for its on/off.
  // Neither could reuse an existing channel: `markets:state` returns the whole of Markets, and the strip is on screen
  // on every page, so moving a rail would mean re-reading watchlists, alerts, screens and strategies twice a second;
  // and `markets:quotes` releases every subscription it was not handed, so the strip and a watchlist sharing it would
  // take each other's prices away. Which markets the strip shows is decided in shared code, not here.
  //
  // 441 → 450: the pages this person has read. Two for what is stored and its settings, three for finding a page
  // again, four for deleting -- one page, a site, a window of time, or all of it. The deletion channels are four
  // rather than one because "forget this site" and "delete the last hour" are different requests and a feature that
  // records what you read has to answer both of them plainly.
  //
  // 450 → 451: returning to the chat from the chat's own side, now that the browser is a separate window rather than
  // a view inside this one. The browser's toolbar could always do it; the sidebar could not, because hiding a window
  // this process owns is not something the renderer can do by collapsing a view.
  // 452 → 464: schedules. Twelve, and most of them are about not promising anything. Three read a phrase or a rule
  // without saving it, so what Orbis understood is shown back before a schedule exists; two answer what Orbis cannot
  // do, in one place, because there is no Orbis server and nothing runs with this computer off. None of them carries
  // a command: a schedule names something Orbis already does, and gains no permission by being scheduled.
  // 464 → 466: what this computer can be woken from, and hibernating it. The first reads and changes nothing; the
  // second is the one action that turns "my computer was off" into something Orbis can do anything about, because a
  // hibernated computer can be woken for a schedule and a switched-off one cannot.
  // 466 → 467: what is coming, across every schedule at once.
  // 467 → 472: Pages written as code -- build, open, health, close, and where on screen they go.
  // 472 → 473: making things. One door for every artifact operation -- what can be made, make it, list, read, save
  // it where you choose, remove -- the way `pages:compute` is one door for every calculation. One channel means one
  // place the sender is checked and one place an operation is refused; the save dialog runs on this side of it.
  assert.ok(code.length <= 473, `the boundary has grown to ${code.length} channels. New ones are fine, but they are new work — check that is intended.`)
})
