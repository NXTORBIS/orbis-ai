import type { GameCategory, GameId, GameInfo, OfflineGamesPrefs } from '../../../shared/offlineGames.ts'
import { DEFAULT_PREFS, GAMES } from '../../../shared/offlineGames.ts'
import type { GameSort } from '../../../shared/games/kept.ts'
import type { GameState } from '../../../shared/games/reported.ts'
import type { ControlDeclaration, SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What the games let Orbis read, set and do, as data.
 *
 * Three screens, and they are not all in the same place: the preferences are in Orbis settings, and the catalogue and
 * a game being played are in the arcade, which lives on the page a failed load shows. So they are three declarations
 * rather than one, each a function of the screen that holds it -- which is also what lets all three be driven in
 * `src/main/browserControl/moduleSurfaces.test.ts` with no window at all.
 *
 * ## The preferences are one set of values in two places
 *
 * `OfflineGamesPrefs` is the library's own record, kept in the profile. Orbis settings draws it and so does the
 * arcade, through the same `setPref`. So the same control appears under `settings/games` and under the arcade, reading
 * and writing the same thing -- which is right, because they are the same switch, and a second copy of the value is
 * what would be wrong.
 *
 * ## Which preferences take effect now, and which take effect next time
 *
 * Sound and music are handed to the running game at once. Difficulty, reduced motion and high contrast are read when
 * a game starts, so changing them while one is running changes the next one. Each control says which it is, because
 * "I turned the difficulty down and nothing happened" is otherwise indistinguishable from a broken switch.
 *
 * ## Nothing here is a game's own insides
 *
 * The shared engine gives every game pause, resume and restart, and every game reports a score, a status and its own
 * few numbers. That is what is declared. A game's own rules -- the board, the pieces, the wave -- are the game's, and
 * there are thirty-two of them being added to.
 */

/** Which game somebody means, by id or by the name on the card. Never a guess between two. */
export function whichGame(asked: string): GameInfo {
  const want = String(asked ?? '').trim().toLowerCase()
  if (!want) throw new Error('Say which game.')
  const exact = GAMES.filter((one) => one.id.toLowerCase() === want || one.name.toLowerCase() === want)
  const near = exact.length ? exact : GAMES.filter((one) => one.name.toLowerCase().includes(want) || one.id.toLowerCase().includes(want))
  if (near.length === 0) throw new Error(`There is no game called “${asked}”.`)
  if (near.length > 1) throw new Error(`“${asked}” could be ${near.map((one) => one.name).join(' or ')}. Say which one.`)
  return near[0]
}

/** Every name a game answers to, for a parameter's list of allowed values. */
const GAME_NAMES: string[] = [...new Set(GAMES.flatMap((one) => [one.id, one.name]))]

/** What a screen that draws the games' preferences has to hand over. */
export interface GamePrefsScreen {
  /**
   * The preferences as they are kept.
   *
   * Throws until the profile has answered. Both screens that draw these wait for it rather than showing the defaults,
   * for the reason they both say: a preference drawn before it is known is one somebody may change by accident.
   */
  prefs(): OfflineGamesPrefs
  /** The same `setPref` the fields on screen call. */
  setPref<K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]): void
  /** The hour a day is taken to begin. Kept with the whole record rather than with the preferences. */
  dayStartHour(): number
  setDayStartHour(hour: number): void
  /** Set when the record could not be read, which means nothing may be written over it. */
  refused(): string | null
}

/** The controls every screen that draws the games' preferences offers, built once from the record's own shape. */
function prefControls(screen: GamePrefsScreen): Record<string, ControlDeclaration> {
  const prefs = (): OfflineGamesPrefs => screen.prefs()
  /*
   * Nothing may be written over a record that could not be read.
   *
   * The arcade already shows the refusal and keeps working on what it has; a write that went ahead would put a
   * default over somebody's scores. Said as the sentence rather than a bare false, so a caller knows what it means.
   */
  const settable = (): true | string => screen.refused() ?? true
  const flag = (name: string, key: 'sound' | 'music' | 'highContrast' | 'showScore' | 'showHighScore' | 'autoRetry', description: string): ControlDeclaration => ({
    name,
    spec: { type: 'boolean', description },
    get: () => prefs()[key],
    set: (on) => screen.setPref(key, on === true),
    writable: settable,
    default: DEFAULT_PREFS[key]
  })

  return {
    difficulty: {
      name: 'Difficulty',
      about: 'How hard every game is. Read when a game starts, so this changes the next game rather than the one being played.',
      spec: { type: 'string', description: 'How hard every game is.', enum: ['easy', 'normal', 'hard'] },
      get: () => prefs().difficulty,
      set: (value) => screen.setPref('difficulty', String(value) as OfflineGamesPrefs['difficulty']),
      writable: settable,
      default: DEFAULT_PREFS.difficulty
    },
    sound: flag('Sound effects', 'sound', 'Whether games make their short sounds. Handed to a running game at once.'),
    music: flag('Background music', 'music', 'Whether a game plays its slow background pattern. Handed to a running game at once.'),
    reducedMotion: {
      name: 'Reduced motion',
      about: 'Follow the computer’s own setting, or override it. Read when a game starts.',
      spec: { type: 'string', description: 'Whether games hold still: follow the system, always, or never.', enum: ['system', 'on', 'off'] },
      get: () => prefs().reducedMotion,
      set: (value) => screen.setPref('reducedMotion', String(value) as OfflineGamesPrefs['reducedMotion']),
      writable: settable,
      default: DEFAULT_PREFS.reducedMotion
    },
    highContrast: flag('High contrast', 'highContrast', 'Whether games use the strong palette. Read when a game starts.'),
    /*
     * Named without the word "playing", and that is not a style choice.
     *
     * A path segment is matched against every word of a control's name, so two controls called "… while playing" meant
     * that asking for `games/play` was ambiguous between them and the `play` action was never reached. A name that
     * swallows another thing's name is a real fault, not an inelegance.
     */
    showScore: flag('Show the score during a game', 'showScore', 'Whether the score is in the bar above the game.'),
    showHighScore: flag('Show the best score during a game', 'showHighScore', 'Whether your best is in the bar above the game.'),
    autoRetry: flag('Reload the page when the connection returns', 'autoRetry', 'Whether a failed page reloads itself once the network is back.'),
    behavior: {
      name: 'When a page cannot load',
      spec: { type: 'string', description: 'What a failed page shows.', enum: ['error-page', 'ask', 'auto-launch'] },
      get: () => prefs().behavior,
      set: (value) => screen.setPref('behavior', String(value) as OfflineGamesPrefs['behavior']),
      writable: settable,
      default: DEFAULT_PREFS.behavior
    },
    launchGame: {
      name: 'Game to start',
      spec: { type: 'string', description: 'Which game starts by itself: the day’s game, your default, the last one you played, or any of them.', enum: ['daily', 'default', 'last', 'random'] },
      get: () => prefs().launchGame,
      set: (value) => screen.setPref('launchGame', String(value) as OfflineGamesPrefs['launchGame']),
      writable: settable,
      default: DEFAULT_PREFS.launchGame
    },
    defaultGame: {
      name: 'Default game',
      /*
       * By id, and only by id.
       *
       * The names on the cards are in the catalogue's own state, and the "play" action takes either -- but a control
       * cannot. A setter that turned "Fusion 2048" into `number-puzzle` would be read back as `number-puzzle`, which
       * is not what was asked for, so the write would be reported as carried out and unconfirmed. The honest shape for
       * a value that is stored as an id is a list of ids.
       */
      about: 'The one "my default game" means, by its id. The names on the cards are in the catalogue’s own state.',
      // The real catalogue, so this cannot name a game that does not exist -- and grows by itself as games are added.
      spec: { type: 'string', description: 'Which game is the default, by its id.', enum: GAMES.map((one) => one.id) },
      get: () => prefs().defaultGame,
      set: (value) => screen.setPref('defaultGame', String(value) as GameId),
      writable: settable,
      default: DEFAULT_PREFS.defaultGame
    },
    dayStartHour: {
      name: 'My day starts at',
      about: 'The hour a day begins, in whole hours. It decides what counts as a run of days, so somebody who plays at one in the morning will want it moved.',
      spec: { type: 'integer', description: 'The hour a day begins, 0 for midnight.', min: 0, max: 23 },
      get: () => screen.dayStartHour(),
      set: (value) => screen.setDayStartHour(Number(value)),
      writable: settable,
      default: 0
    }
  }
}

/** The games' preferences where they sit in Orbis settings. */
export function gameSettingsSurface(screen: GamePrefsScreen): SurfaceDeclaration {
  return {
    id: 'games',
    parent: 'settings',
    name: 'Games',
    about: 'The games Orbis offers when a page cannot load: how hard they are, whether they make a sound, and which one starts.',
    kind: 'page',
    keywords: ['games', 'arcade', 'offline games', 'mini games', 'difficulty', 'sound', 'high score'],
    controls: prefControls(screen),
    actions: {},
    state: () => ({
      values: {
        games: GAMES.length,
        difficulty: screen.prefs().difficulty,
        sound: screen.prefs().sound,
        // Said rather than hidden: while this is set nothing is being kept, and the screen shows it too.
        notBeingKept: screen.refused()
      }
    })
  }
}

// ---------------------------------------------------------------- the arcade itself

/** What the arcade shell has to hand over. */
export interface ArcadeScreen extends GamePrefsScreen {
  /** Which of the arcade's four screens is showing. */
  view(): string
  setView(id: string): void
  views: readonly string[]
  favourites(): readonly GameId[]
  setFavourite(id: GameId, on: boolean): void
  /** The games with something saved to carry on from. */
  unfinished(): readonly GameId[]
  /** Your best for one game, or undefined when it has never been played. */
  best(id: GameId): number | undefined
  /** Today's game, worked out on this computer. */
  daily(): GameId
  /** Opens a game. The same thing pressing its card does. */
  play(id: GameId, resume?: boolean): void
  /** Which game is open, or null when none is. */
  playing(): GameId | null
}

/**
 * The arcade.
 *
 * The shell rather than the catalogue, because the shell is the part that is always there: the catalogue is one of its
 * four screens and a game being played is another, and both come and go. So starting a game, starring one and the
 * preferences are here, and the search box and the filters are on the catalogue inside it.
 *
 * The preferences appear here as well as in Orbis settings on purpose: they are the same switches, and somebody in the
 * arcade asking to turn the sound off should not be sent to Settings for it.
 */
export function arcadeSurface(screen: ArcadeScreen): SurfaceDeclaration {
  return {
    id: 'games',
    parent: null,
    name: 'Games',
    about: 'The games Orbis offers while a page will not load: the whole catalogue, what you have played, and your scores.',
    kind: 'module',
    keywords: ['games', 'arcade', 'mini games', 'offline games', 'play', 'high score', 'leaderboard'],
    controls: {
      view: {
        name: 'Screen',
        about: 'Which of the arcade’s screens is showing: the page that says what went wrong, the question, the catalogue, or a game.',
        spec: { type: 'string', description: 'Which of the arcade’s screens is showing.', enum: [...screen.views] },
        get: () => screen.view(),
        // A game cannot be opened by naming this screen -- there would be no game to open -- so that is said rather
        // than quietly showing an empty one.
        set: (value) => {
          if (String(value) === 'game' && screen.playing() === null) throw new Error('No game is open, so there is nothing to show. Use the “play” action and say which game.')
          screen.setView(String(value))
        },
        default: 'page'
      },
      ...prefControls(screen)
    },
    actions: {
      play: {
        name: 'Play a game',
        about: 'Starts one game, by its id or the name on its card.',
        params: {
          game: { type: 'string', description: 'Which game: its id, or the name on its card.', required: true, enum: GAME_NAMES },
          carryOn: { type: 'boolean', description: 'Pick up a saved game rather than starting a new one. Only some games can be carried on.' }
        },
        run: (params) => {
          const game = whichGame(String(params.game))
          const resume = params.carryOn === true
          if (resume && !game.continuable) throw new Error(`${game.name} cannot be carried on: it does not save a game in progress.`)
          if (resume && !screen.unfinished().includes(game.id)) throw new Error(`There is no saved ${game.name} to carry on from.`)
          screen.play(game.id, resume)
          return { gameId: game.id, name: game.name, carriedOn: resume }
        },
        /*
         * Asked of the screen again, and a "not yet" is said as that.
         *
         * Opening a game is three changes -- the screen changes, the window draws, and the game's own code is fetched
         * -- so a screen that has not redrawn is not a game that failed to open, and must not be reported as one.
         */
        verify: (data) => {
          const said = data as { gameId: GameId; name: string }
          const now = screen.playing()
          if (now === said.gameId) return { done: true, detail: `${said.name} is open.` }
          return { done: false, detail: now === null ? 'the arcade has not redrawn yet. The game turns up as games/current.' : `${now} is open instead.` }
        }
      },
      playTodays: {
        name: 'Play the game of the day',
        about: 'The same game for the whole day on this computer, worked out here and sent nowhere.',
        run: () => {
          const id = screen.daily()
          screen.play(id)
          return { gameId: id }
        },
        verify: (data) => {
          const id = (data as { gameId: GameId }).gameId
          if (screen.playing() === id) return { done: true, detail: `${whichGame(id).name} is open.` }
          return { done: false, detail: 'the arcade has not redrawn yet. The game turns up as games/current.' }
        }
      },
      favourite: {
        name: 'Star a game',
        params: {
          game: { type: 'string', description: 'Which game: its id, or the name on its card.', required: true, enum: GAME_NAMES },
          starred: { type: 'boolean', description: 'True to star it, false to take the star off. Defaults to starring.' }
        },
        run: (params) => {
          const game = whichGame(String(params.game))
          const on = params.starred !== false
          screen.setFavourite(game.id, on)
          return { gameId: game.id, name: game.name, starred: on }
        },
        verify: (data) => {
          const said = data as { gameId: GameId; name: string; starred: boolean }
          const is = screen.favourites().includes(said.gameId)
          return { done: is === said.starred, detail: is ? `${said.name} is starred.` : `${said.name} is not starred.` }
        }
      }
    },
    possibleChildren: [
      // The catalogue really is reached by setting the screen, so this one can be walked to.
      { id: 'catalogue', name: 'The catalogue', kind: 'page', reach: { kind: 'control', control: 'view', value: 'library' } },
      {
        id: 'current',
        name: 'The game on screen',
        kind: 'tool',
        reach: { kind: 'manual', how: 'say which game. Use the “play” action on Games, whose list of allowed values is the whole catalogue.' }
      }
    ],
    state: () => ({
      activity: screen.playing() ? 'running' : 'idle',
      values: {
        screen: screen.view(),
        games: GAMES.length,
        starred: screen.favourites().length,
        canBeCarriedOn: [...screen.unfinished()],
        playedAtAll: GAMES.filter((one) => screen.best(one.id) !== undefined).length,
        gameOfTheDay: screen.daily(),
        playing: screen.playing(),
        notBeingKept: screen.refused()
      }
    })
  }
}

// ---------------------------------------------------------------- the catalogue

/** What the catalogue has to hand over. */
export interface CatalogueScreen {
  search(): string
  setSearch(text: string): void
  category(): GameCategory | 'all' | 'favorites'
  setCategory(id: string): void
  /** The categories the strip really draws, so one added to the catalogue is askable in the same change. */
  categories: readonly { id: string; label: string }[]
  sort(): GameSort
  setSort(id: string): void
  sorts: readonly { id: string; label: string }[]
  favouritesFirst(): boolean
  setFavouritesFirst(on: boolean): void
  boardsOpen(): boolean
  setBoardsOpen(on: boolean): void
  /** The games the search, the category and the ordering have left, in the order they are drawn. */
  shown(): readonly GameInfo[]
}

/** The catalogue: the search box, the categories, the ordering and the score boards. */
export function catalogueSurface(screen: CatalogueScreen): SurfaceDeclaration {
  return {
    id: 'catalogue',
    parent: 'games',
    name: 'The catalogue',
    about: 'Every game, searched, filtered and ordered.',
    kind: 'page',
    keywords: ['catalogue', 'library', 'all games', 'search games', 'categories', 'scores'],
    controls: {
      search: {
        name: 'Search games',
        spec: { type: 'string', description: 'Words to look for in a game’s name, what it is, or its categories. Empty shows them all.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      },
      category: {
        name: 'Category',
        spec: { type: 'string', description: 'Which kind of game to show.', enum: screen.categories.map((one) => one.id) },
        get: () => screen.category(),
        set: (value) => screen.setCategory(String(value)),
        default: 'all'
      },
      order: {
        name: 'Order',
        spec: { type: 'string', description: 'How the games are ordered.', enum: screen.sorts.map((one) => one.id) },
        get: () => screen.sort(),
        set: (value) => screen.setSort(String(value)),
        default: 'name'
      },
      favouritesFirst: {
        name: 'Favourites first',
        spec: { type: 'boolean', description: 'Whether starred games are pinned above the rest.' },
        get: () => screen.favouritesFirst(),
        set: (on) => screen.setFavouritesFirst(on === true),
        default: true
      },
      scoresOpen: {
        name: 'Your scores',
        spec: { type: 'boolean', description: 'Whether the score boards are open.' },
        get: () => screen.boardsOpen(),
        set: (on) => screen.setBoardsOpen(on === true),
        default: false
      }
    },
    actions: {},
    state: () => ({
      values: {
        games: GAMES.length,
        showing: screen.shown().length,
        shown: screen.shown().slice(0, 40).map((one) => one.name),
        searching: screen.search().trim().length > 0,
        category: screen.category(),
        order: screen.sort()
      }
    })
  }
}

// ---------------------------------------------------------------- a game being played

/**
 * What the screen a game is played on has to hand over.
 *
 * Only the three preferences that matter while a game is running, rather than the whole set: the rest are on the
 * catalogue and in Orbis settings, and offering them twice on a screen that does not draw them would be describing
 * something that is not there.
 */
export interface PlayingScreen {
  /** Throws until the profile has answered. */
  prefs(): OfflineGamesPrefs
  setPref<K extends keyof OfflineGamesPrefs>(key: K, value: OfflineGamesPrefs[K]): void
  /** Set when the record could not be read, which means nothing may be written over it. */
  refused(): string | null
  game(): GameInfo
  /** What the game last reported about itself. Null until it has reported anything. */
  reported(): GameState | null
  /** True while the game's own code is still being fetched. */
  loading(): boolean
  /** Your best for this game, or undefined when it has never been played. */
  best(): number | undefined
  pause(): void
  resume(): void
  restart(): void
  exit(): void
}

/**
 * A game while it is being played.
 *
 * Everything here comes from the shared engine every game is built on -- pause, resume, restart, and the status, score
 * and few numbers each game reports. Nothing reaches into a particular game.
 */
export function playingSurface(screen: PlayingScreen): SurfaceDeclaration {
  const status = (): GameState['status'] => {
    if (screen.loading()) throw new Error(`${screen.game().name} is still loading.`)
    return screen.reported()?.status ?? 'ready'
  }
  /**
   * Whether the game has reached the status that was asked for, in its own words.
   *
   * A game says what it is doing on its next step, so the honest answers are three rather than two: it is there, it is
   * not there yet, or it has not said anything at all. Reported as "not yet" rather than as a refusal, because a
   * refusal invites a caller to press pause a second time.
   */
  const said = (now: GameState | null, wanted: GameState['status']): { done: boolean; detail: string } => {
    if (!now) return { done: false, detail: 'the game has not reported anything yet.' }
    if (now.status === wanted) return { done: true, detail: `The game says it is ${now.status}.` }
    return { done: false, detail: `the game still says it is ${now.status}, so its next step has not happened yet.` }
  }

  return {
    /*
     * `current`, not `play`, and none of its words may begin with "play".
     *
     * Surfaces are matched before actions, so a screen called `play` would swallow the `play` action on its own
     * parent: asking Orbis to play a game would land on the screen a game is already being played on, which cannot be
     * done and would be reported as "that is a screen". The same goes for the words in its name and keywords.
     */
    id: 'current',
    parent: 'games',
    name: 'The game on screen',
    about: 'Pause, carry on, start again, and what the game says about itself.',
    kind: 'tool',
    keywords: ['this game', 'current game', 'pause', 'resume', 'restart', 'score'],
    controls: {
      sound: {
        name: 'Sound effects',
        about: 'Handed to the game at once.',
        spec: { type: 'boolean', description: 'Whether the game makes its short sounds.' },
        get: () => screen.prefs().sound,
        set: (on) => screen.setPref('sound', on === true),
        writable: () => screen.refused() ?? true,
        default: DEFAULT_PREFS.sound
      },
      music: {
        name: 'Background music',
        about: 'Handed to the game at once, and only heard while it is actually running.',
        spec: { type: 'boolean', description: 'Whether the game plays its slow background pattern.' },
        get: () => screen.prefs().music,
        set: (on) => screen.setPref('music', on === true),
        writable: () => screen.refused() ?? true,
        default: DEFAULT_PREFS.music
      },
      difficulty: {
        name: 'Difficulty',
        about: 'Read when a game starts, so this takes effect on the next game or after Start again.',
        spec: { type: 'string', description: 'How hard every game is.', enum: ['easy', 'normal', 'hard'] },
        get: () => screen.prefs().difficulty,
        set: (value) => screen.setPref('difficulty', String(value) as OfflineGamesPrefs['difficulty']),
        writable: () => screen.refused() ?? true,
        default: DEFAULT_PREFS.difficulty
      }
    },
    actions: {
      pause: {
        name: 'Pause',
        unavailable: () => {
          const now = status()
          return now === 'running' ? null : now === 'paused' ? 'It is already paused.' : now === 'over' ? 'The game is over.' : 'The game has not started yet.'
        },
        run: () => {
          screen.pause()
          return { asked: 'pause' }
        },
        /*
         * The game's own status, which is the only thing that really knows.
         *
         * A game reports itself on its next step, so "still running" right afterwards means the step has not happened
         * yet rather than that the pause was ignored -- and the words say which.
         */
        verify: () => said(screen.reported(), 'paused')
      },
      resume: {
        name: 'Carry on',
        unavailable: () => (status() === 'paused' ? null : 'The game is not paused.'),
        run: () => {
          screen.resume()
          return { asked: 'resume' }
        },
        verify: () => said(screen.reported(), 'running')
      },
      restart: {
        name: 'Start again',
        about: 'Throws away the round being played and starts a new one. A finished round has already been recorded.',
        unavailable: () => (screen.loading() ? `${screen.game().name} is still loading.` : null),
        run: () => {
          screen.restart()
          return { asked: 'restart' }
        },
        verify: () => {
          const now = screen.reported()
          return { done: now !== null && now.status !== 'over', detail: now ? `The game says it is ${now.status} with a score of ${now.score}.` : 'The game has not reported anything yet.' }
        }
      },
      exit: {
        name: 'Back to the games',
        run: () => {
          screen.exit()
          return { closed: true }
        }
      }
    },
    state: () => {
      const game = screen.game()
      const now = screen.reported()
      if (screen.loading()) return { activity: 'running', detail: `${game.name} is loading.` }
      return {
        activity: now?.status === 'running' ? 'running' : now?.status === 'paused' ? 'paused' : now?.status === 'over' ? 'finished' : 'idle',
        detail: `${game.name} — ${now?.status ?? 'ready'}`,
        values: {
          game: game.name,
          controls: game.controls,
          status: now?.status ?? 'ready',
          score: now?.score ?? null,
          best: screen.best() ?? null,
          level: now?.level ?? null,
          lives: now?.lives ?? null,
          secondsPlayed: now ? Math.round(now.elapsedMs / 1000) : null,
          // How hard it has become, which the engine really measures: 1 is the starting difficulty.
          hardness: now?.difficulty ?? null,
          ...Object.fromEntries((now?.hud ?? []).map((one) => [one.label, one.value]))
        }
        /*
         * No `progress`.
         *
         * Nothing measures how far through a game is, and most of these have no end to be far through. A 0 here would
         * read as "just started" about a round that may be nearly over.
         */
      }
    }
  }
}
