# Football (Orbis Arena)

Football scores, fixtures, tables and analysis inside Orbis. Open it with `/football`, the command palette (Arena → Football) or the
capability list. Like F1 it is a normal Orbis feature (`football`, in the **Arena** category), not a separate app.

## What each tab does

| Tab | What it shows | Data |
| --- | --- | --- |
| Now | Matches live now, those starting within two days, results from the last two days; follow teams; a "Just changed" list (kick-off, goal, half-time, full-time, score correction) built by comparing successive answers | TheSportsDB live feed + current rounds of the German leagues |
| Fixtures | A competition's season by round | Per competition |
| Table | The provider's table, or one calculated here from results | Per competition |
| Teams | Form, home/away record, clean sheets, head to head | Season fixture list |
| Analytics | Result split, goals by minute band, top scorers, an experimental outcome model with its test | Season fixture list |
| Sources | Per-provider requests/failures/rate limits, and what each competition really supplies | — |

Clicking a match opens a detail panel: score, status, goals with scorer and minute, whether the goal list backs up the score, pin.

## The providers, as measured (2026-10-15)

* **OpenLigaDB** (`api.openligadb.de`): community-run and open, no key. 1. Bundesliga, 2. Bundesliga, 3. Liga, DFB-Pokal. Fixtures, a table,
  and goal lists with scorer, minute, penalty/own-goal flags. **No live flag**: a match is "finished" or not. Orbis shows an unfinished match
  that kicked off within 165 minutes as *probably under way (inferred)* and shows no minute. A community-edited feed also holds mistakes:
  entries whose running score did not move are marked, and a goal list that does not add up is said to be incomplete or in conflict.
* **TheSportsDB** with its public test key: **reported** live status and minute (in a probe: 17 matches, MLS, Copa AUF, Caribbean Cup…),
  tables for all listed leagues, fixtures **capped at about 5 per request** on this key, and no goal list. It is a test key; heavy use would
  need the provider's own plan, which Orbis does not require.
* **Rejected / reference only**: ESPN's undocumented site API (no licence, no documentation); football-data.org (its free tier needs a key a
  person must register — the keyless request returned no matches); Sportmonks / API-Football (paid or key-gated).

Not supplied by any listed source, so not shown anywhere: lineups, formations, shot maps, expected goals, tracking, commentary, injuries,
minutes played (hence no per-90 figures), match statistics (possession etc.).

## Honest states

* A match is `live` with a **reported** or **inferred** basis; a clock is never counted up locally. A match with no result recorded long after
  kick-off is "Result not recorded yet", not live.
* A score before kick-off is `–`, not 0:0. Missing numbers are `null`, never 0.
* An answer is fresh, cached, or **stale** (provider unreachable: the last good answer, with its own time).
* A late answer cannot reopen a finished match or move it back a period unless the provider's own update time is newer.
* The same fixture from both providers is one row only when both team names are equal after normalising; otherwise it stays two rows.

## Calculations

* **Calculated table**: finished matches only, points then goal difference then goals for. Head-to-head and other tie-breaks are *not*
  applied. For the 2025/26 Bundesliga it reproduces the provider's table exactly (306 matches, checked).
* **Goal timing**: the provider's minutes in 15-minute bands; "90+" covers added and extra time together; goals with no minute are left out and counted.
* **Outcome model (experimental)**: independent-Poisson goals with attack/defence strengths from *earlier* matches only. It is walk-forward
  tested on the season and compared (Brier score) with "always use the season's home/draw/away rates"; probabilities are shown only if it
  beat that baseline (2025/26 Bundesliga: 276 predictions, 0.604 vs 0.656). It is not advice and not a guarantee.

## Caching and limits

`src/main/football/service.ts`: one request per address at a time; a spacing between requests per provider (250/600 ms); 429/Retry-After
honoured; answers cached (live 30–60 s, current season 5 min, past seasons 12 h); a failed refresh returns the last good answer marked stale;
an answer with nothing usable is not cached.

## Privacy

Follows are kept in this profile's own folder. Nothing is sent anywhere but the two providers' read requests.

## Following, notifications and reminders

What a profile follows (teams, pinned matches, reminders, alert switches, saved views) is one file per Orbis profile
(`football-follows.json`), written by the main process. A background monitor (`src/main/football/monitor.ts`) asks the providers about once
a minute **only when something is followed, pinned or reminded**, and publishes to Orbis's one notification place (category *Football*,
which can be switched off in Settings → Notifications): goal, kick-off, full-time, and "starting soon" reminders (5/15/30/60 min).
The first sight of a match says nothing, each event is said once, a postponed or cancelled match cancels its reminder, and a moved kick-off
is followed. It can only say what a provider reports, when it reports it. Saved views restore competition, season and tab. Clicking a top
scorer lists their goals (minute, penalty, match).

## What TheSportsDB's public key adds

Measured 2026-10-15: lineup, timeline, statistics and squads are available through the same key, **cut to the first few entries** (five
lineup players, five timeline items, five statistics, ten squad members). They are shown for TheSportsDB matches and teams, marked
partial, and no pitch is drawn from them: with five of twenty-two players and no formation there is nothing to place.

* **Match detail**: timeline (goals, cards, substitutions with who went off), statistic bars (a bar only when both numbers exist and are not
  both zero), lineup as returned.
* **Teams**: club profile (stadium, capacity, founded, description) and the first ten of the squad, for TheSportsDB teams.
* OpenLigaDB matches say plainly that they have the score and goals only.

## Views and settings (added after the first slice)

* **Now**: filter by status (live, upcoming, finished), order (reported-live first, kick-off, competition), times in a chosen zone,
  compact rows, reduced motion, an opening scene (skippable, can be turned off), and a short **recently opened** list. A score that changes
  while a row is on screen is highlighted briefly (not when it first appears, and not with reduced motion or the system's own setting).
* **Fixtures**: by round, or a **calendar** of the viewer's own days (not the provider's UTC day).
* **Match detail**: a deterministic account of the match from its recorded score and goals (no emotion, tactics or "turning points"),
  goals plotted by minute, a **replay** that steps through the recorded goals (review of the record, never changes the real score), and
  the returned lineup on a **pitch drawn from position names** (labelled an arrangement, not where anyone stood).
* **Teams**: form over the last 5 or 10, points per match over a rolling window, head to head including the previous three seasons, the
  same team across the last six seasons' tables.
* **Analytics**: factual statements (highest-scoring match, biggest margin, unbeaten and winning runs, home-win share), each with what it
  was counted from, and a "how these numbers are made" note.
* Where you were (tab, competition, season) is remembered per profile.

## Known limits / not built

* A goal during a watched live match has not happened while verifying; the change path is tested with recorded sequences, and the
  monitor was seen making its own requests with no screen open.
* Not available from any listed source, so not shown: complete lineups and formations, shot maps, expected goals, tracking, commentary,
  injuries, minutes played, assists in aggregate, possession in OpenLigaDB matches. No tactical pitch exists because no positional data does.
* TheSportsDB lists are capped by its key (fixtures about 5 per request); Teams and Analytics for those leagues use that partial list and say so.
* The "inferred" live state for OpenLigaDB means a goal there is seen only when the community edits the match.

## Where the code is

```
src/shared/football/    types, leagues, normalisers, status/score/change logic, table, form, h2h, timing, model
src/main/football/      provider service (cache, dedupe, limits) and IPC
src/renderer/src/components/football/   the screens
```

Tests: `src/shared/football/football.test.ts`, `src/main/football/service.test.ts`.
