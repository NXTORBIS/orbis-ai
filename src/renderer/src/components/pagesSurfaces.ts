import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What Orbis Pages lets Orbis do, as data.
 *
 * Three levels, because Pages really is three things: the library, the studio that builds one, and a Page that is
 * open. The third is the one that matters here -- a Page with no reachable parameters is a Page the assistant can
 * only put on screen, and opening something is the first step of the job rather than the job.
 *
 * As with Settings and Markets, these are plain functions of the screen's own state and handlers so the whole chain
 * can be driven in a test with no window. Nothing below computes anything: a Page's numbers come back from
 * `pages:compute` in the main process, and these declarations only set the inputs that call is made with and report
 * what came back.
 */

// ---------------------------------------------------------------- the library

export const PAGES_SCREENS = ['library', 'studio', 'page', 'write'] as const

/**
 * The Pages whose own tool says what can be done on it.
 *
 * A list rather than something worked out, for the same reason Settings and Markets keep one: whether a Page is
 * somewhere to go is not a property of the Page, it is whether the component inside it registers. A slug named here
 * whose component registers nothing would have Orbis open it, find nothing, and be unable to tell that from a fault.
 * Add to this in the same change as the `useSurface` call in the Page.
 */
export const CONTROLLABLE_PAGES: Record<string, string> = {
  'unit-converter': 'Unit Converter',
  'function-plotter': 'Function Plotter'
}

/** What the Pages library has to hand over. */
export interface PagesScreen {
  /** Which of the four screens is showing. */
  screen(): string
  search(): string
  setSearch(text: string): void
  /** The chosen subject, as its path, or null for everything. */
  subject(): string | null
  setSubject(path: string | null): void
  /** Every subject there is, flattened, with the path each one is chosen by. */
  subjects(): readonly { path: string; name: string; total: number }[]
  /** The Pages in this library: what each is called, its address, and whether it is marked. */
  pages(): readonly { pageId: string; slug: string; title: string; url: string; favourite: boolean }[]
  /** Pages the register knows about that this profile cannot open, and why. */
  unavailable(): readonly { title: string }[]
  /** Pages whose manifest could not be read. Unreadable is not missing, so these are counted separately. */
  problems(): readonly { slug: string; message: string }[]
  /** True until the first answer. A count taken now would be a 0 nobody measured. */
  loading(): boolean
  /** Opens a Page by address. Resolves with what opened, or throws with the register's own sentence. */
  open(address: string): Promise<{ title: string; url: string; slug: string }>
  setFavourite(address: string, on: boolean): Promise<void>
  /**
   * Shows one of the four screens.
   *
   * Throws for `page`, because a Page cannot be opened without being named: the sentence says to use `open` with an
   * address instead, which is more use than a screen that silently stays where it was.
   */
  setScreen(id: string): void
  close(): void
}

/**
 * The Pages library.
 *
 * The subject list and the search box are the two things that decide what is on screen, so they are controls; opening
 * a Page is an action because it takes an address, and an address cannot be put in a route that was never given one.
 */
export function pagesSurface(screen: PagesScreen): SurfaceDeclaration {
  /** Lazily: called while the declaration is built it would run before the first answer is in. */
  const loaded = (): true | string => (screen.loading() ? 'The library has not finished loading.' : true)

  return {
    id: 'pages',
    parent: null,
    name: 'Pages',
    about: 'The library of Orbis Pages: a tool with its own address, and the studio that builds one.',
    kind: 'module',
    keywords: ['pages', 'library', 'tools', 'calculators', 'labs'],
    controls: {
      /*
       * None of the names on this screen repeat the word "Pages", and it is not a style choice.
       *
       * A path segment matches on "every word you said is the start of a word in it", so a control called "Search
       * Pages" answers to the segment `page` -- and `pages/page` would resolve to the search box instead of saying a
       * Page has to be named first. The module's own word goes in `about`.
       */
      search: {
        name: 'Search',
        about: 'Asks the register, so the order is the real ranking rather than this screen filtering what it has.',
        spec: { type: 'string', description: 'What to look for. Empty shows the chosen subject again.' },
        get: () => screen.search(),
        set: (value) => screen.setSearch(String(value ?? '')),
        default: ''
      },
      screen: {
        name: 'Screen',
        about: 'Which of the four Pages screens is showing: the library, the studio, an open Page, or writing one as code.',
        /*
         * A control rather than two actions, for a reason worth keeping.
         *
         * A route to the studio is `{ control: 'screen', value: 'studio' }`, which is one step a walk can take. As
         * actions called "Open the studio" they also made `pages/studio` resolve to the *action* -- a path matched
         * forgivingly found the words "the studio" in its name -- so a walk was told it had already arrived.
         */
        spec: { type: 'string', description: 'Which of the four Pages screens is showing.', enum: [...PAGES_SCREENS] },
        get: () => screen.screen(),
        set: (value) => screen.setScreen(String(value)),
        default: 'library'
      },
      subject: {
        name: 'Subject',
        about: 'Which subject the list is narrowed to. Empty means everything.',
        spec: { type: 'string', description: 'The subject path, as the list shows it: “maths.calculus”. Empty for everything.', enum: ['', ...screen.subjects().map((one) => one.path)] },
        get: () => screen.subject() ?? '',
        writable: loaded,
        // Searching ignores the subject, which the heading on screen says too -- so this is set and left alone.
        set: (value) => screen.setSubject(String(value ?? '') === '' ? null : String(value)),
        default: ''
      }
    },
    actions: {
      open: {
        name: 'Open',
        about: 'Opens a Page by its address. The register decides whether this profile may have it.',
        params: { address: { type: 'string', description: 'The Page’s address, as the library shows it: “orbis://pages/unit-converter”. A slug or a title is matched too.', required: true } },
        unavailable: () => {
          const why = loaded()
          return why === true ? null : why
        },
        run: async (params) => screen.open(String(params.address)),
        // Asked of the screen afterwards: what is open is the proof, not that the call returned.
        verify: (data) => {
          const opened = data as { title: string; url: string }
          return screen.screen() === 'page' ? { done: true, detail: `${opened.title} is open at ${opened.url}.` } : { done: false, detail: `${opened.title} did not come up on screen.` }
        }
      },
      favourite: {
        name: 'Mark',
        about: 'The same star on the card. Marked Pages come first in the library.',
        params: {
          address: { type: 'string', description: 'Which Page, by address, slug or title.', required: true },
          on: { type: 'boolean', description: 'Marked, or not.', required: true }
        },
        run: async (params) => {
          await screen.setFavourite(String(params.address), params.on === true)
          return { address: String(params.address), on: params.on === true }
        },
        verify: (data) => {
          const { address, on } = data as { address: string; on: boolean }
          const found = screen.pages().find((one) => one.url === address || one.slug === address || one.title === address)
          if (!found) return { done: false, detail: `no Page called “${address}” is in the library now.` }
          return found.favourite === on ? { done: true, detail: `${found.title} is ${on ? 'marked' : 'not marked'}.` } : { done: false, detail: `${found.title} is ${found.favourite ? 'marked' : 'not marked'}.` }
        }
      },
      close: {
        name: 'Close',
        about: 'Closes Pages and goes back to where you were.',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: [
      { id: 'studio', name: 'Studio', kind: 'page' as const, reach: { kind: 'control' as const, control: 'screen', value: 'studio' } },
      {
        id: 'page',
        name: 'The open Page',
        kind: 'page' as const,
        // An address has to be named, and a route cannot carry one it was never given. So it is said, with the way in.
        reach: { kind: 'manual' as const, how: 'a Page has to be named first. Do pages/open with its address, slug or title.' }
      }
    ],
    state: () => ({
      activity: screen.loading() ? 'running' : 'idle',
      values: {
        screen: screen.screen(),
        // Nothing counted while loading: a 0 here would read as an empty library.
        pages: screen.loading() ? 'not loaded yet' : screen.pages().length,
        subjects: screen.loading() ? 'not loaded yet' : screen.subjects().length,
        subject: screen.subject() ?? 'everything',
        searching: screen.search().trim() !== '',
        // Two different kinds of absence, kept apart: not allowed here, and could not be read at all.
        notAvailableHere: screen.unavailable().length,
        couldNotBeRead: screen.problems().length
      }
    })
  }
}

// ---------------------------------------------------------------- the studio

/** What the studio has to hand over. */
export interface PageStudioScreen {
  tab(): string
  setTab(id: string): void
  /** The sections the studio has, as it lists them itself. */
  tabs: readonly { id: string; label: string }[]
  back(): void
}

/** The studio: which of its sections is open, and the way back. */
export function pageStudioSurface(screen: PageStudioScreen): SurfaceDeclaration {
  return {
    id: 'studio',
    parent: 'pages',
    name: 'Studio',
    about: 'Describing a Page, building one by hand, sending one Page’s answer to another, and finding out why one misbehaves.',
    kind: 'page',
    keywords: ['studio', 'build', 'describe', 'compose', 'package', 'diagnostics'],
    controls: {
      section: {
        name: 'Section',
        about: 'Which part of the studio is open.',
        // The studio's own list, so a section added there is settable in the same change.
        spec: { type: 'string', description: 'Which part of the studio is open.', enum: screen.tabs.map((one) => one.id) },
        get: () => screen.tab(),
        set: (value) => screen.setTab(String(value))
      }
    },
    actions: {
      back: {
        name: 'Back to the library',
        run: () => {
          screen.back()
          return { left: true }
        }
      }
    },
    state: () => ({ values: { section: screen.tab(), sections: screen.tabs.length } })
  }
}

// ---------------------------------------------------------------- a Page that is open

/** What the frame around an open Page has to hand over. */
export interface OpenPageScreen {
  page(): { pageId: string; slug: string; title: string; url: string; categories: readonly string[]; limitations: readonly string[] }
  /**
   * What this Page is allowed to reach, as the main process answered.
   *
   * Throws until the answer is in: a Page reported as asking for nothing because a question is in flight is a Page
   * described as safer than anybody knows it to be.
   */
  permissions(): readonly { capabilityId: string; name: string; outcome: string; risk: string }[]
  showingPermissions(): boolean
  setShowingPermissions(on: boolean): void
  back(): void
  close(): void
}

/**
 * The frame a Page sits in: what it is, what it may reach, and what it says it cannot do.
 *
 * The parameters of the Page itself are on the surface the Page registers inside this one, because they belong to the
 * Page rather than to the frame -- and because a Page with no component of its own has none.
 */
export function openPageSurface(screen: OpenPageScreen): SurfaceDeclaration {
  return {
    id: 'page',
    parent: 'pages',
    name: 'The open Page',
    about: 'The Page that is open: its address, what it may reach, and what it will not do.',
    kind: 'page',
    keywords: ['page', 'open page', 'tool'],
    controls: {
      whatItCanDo: {
        name: 'What it can do',
        about: 'Whether the panel listing what this Page may reach is open.',
        spec: { type: 'boolean', description: 'Whether the permissions panel is open.' },
        get: () => screen.showingPermissions(),
        set: (on) => screen.setShowingPermissions(on === true),
        default: false
      },
      permissions: {
        name: 'What it may reach',
        spec: { type: 'array', description: 'Every capability this Page asked for, and whether it was allowed.' },
        // Throws until the answer is in, so the reading is reported as missing rather than as "it asks for nothing".
        get: () => screen.permissions().map((one) => ({ capability: one.capabilityId, name: one.name, outcome: one.outcome, risk: one.risk }))
      }
    },
    actions: {
      back: {
        name: 'Back to the library',
        run: () => {
          screen.back()
          return { left: true }
        }
      },
      close: {
        name: 'Close',
        run: () => {
          screen.close()
          return { closed: true }
        }
      }
    },
    possibleChildren: Object.prototype.hasOwnProperty.call(CONTROLLABLE_PAGES, screen.page().slug)
      ? [{ id: screen.page().slug, name: CONTROLLABLE_PAGES[screen.page().slug], kind: 'tool' as const, reach: { kind: 'always' as const } }]
      : [],
    state: () => {
      const page = screen.page()
      let permissions: unknown = 'not answered yet'
      try {
        permissions = screen.permissions().length
      } catch {
        // Left as the sentence above. A Page described as asking for nothing because an answer is in flight is worse
        // than one that says it does not know yet.
      }
      return {
        values: {
          title: page.title,
          address: page.url,
          slug: page.slug,
          subjects: [...page.categories],
          asksFor: permissions,
          willNotDo: page.limitations.length
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the Unit Converter

/** What the Unit Converter has to hand over. */
export interface UnitConverterScreen {
  amount(): string
  setAmount(text: string): void
  from(): string
  setFrom(text: string): void
  to(): string
  setTo(text: string): void
  /** Runs the conversion through the engine. The same call every change on screen makes. */
  convert(): Promise<void>
  /** What came back: null when the last attempt did not convert. */
  answer(): { display: string; dimension: string; exact: boolean } | null
  /** The engine's own sentence when it refused, empty otherwise. */
  problem(): string
  /** The units this one could honestly be converted to, as the engine listed them. */
  options(): readonly { id: string; symbol: string; name: string }[]
  save(): Promise<boolean>
}

/**
 * The Unit Converter: three parameters and the engine behind them.
 *
 * The small Page that shows what "down to the parameter" means. Every value is text on screen rather than a number,
 * because that is what the boxes hold -- an amount being typed goes through "1", "1.", "1.2", and a Page that threw
 * away the middle of that would be a Page that cannot be typed into.
 */
export function unitConverterSurface(screen: UnitConverterScreen): SurfaceDeclaration {
  return {
    id: 'unit-converter',
    parent: 'pages/page',
    name: 'Unit Converter',
    about: 'Converts an amount between two units, where the two measure the same kind of thing.',
    kind: 'tool',
    keywords: ['units', 'convert', 'conversion', 'measurement'],
    controls: {
      amount: {
        name: 'Amount',
        spec: { type: 'string', description: 'How much of the unit below. A number, as it would be typed.' },
        get: () => screen.amount(),
        set: (value) => screen.setAmount(String(value ?? ''))
      },
      from: {
        name: 'From',
        spec: { type: 'string', description: 'The unit to convert from, as it is written: “km/h”, “kg”, “°C”.' },
        get: () => screen.from(),
        set: (value) => screen.setFrom(String(value ?? ''))
      },
      to: {
        name: 'To',
        spec: { type: 'string', description: 'The unit to convert to. It has to measure the same kind of thing.' },
        get: () => screen.to(),
        set: (value) => screen.setTo(String(value ?? ''))
      },
      /*
       * Read-only: what this unit could go to, as the engine says rather than as anything here guesses.
       *
       * Not called `canConvertTo`: a path is matched forgivingly and every control is tried before any action, so an
       * id with "convert" inside it shadowed the `convert` action completely -- `.../convert` resolved to this and
       * came back "that is a control, not something that can be done".
       */
      otherUnits: {
        name: 'Units this could go to',
        spec: { type: 'array', description: 'The units the engine says the “from” unit can be converted to.' },
        get: () => screen.options().map((one) => one.symbol || one.id)
      }
    },
    actions: {
      convert: {
        name: 'Convert',
        about: 'Asks the engine again. The Page also does this whenever one of the three above changes.',
        effects: ['read'],
        run: async () => {
          await screen.convert()
          return { amount: screen.amount(), from: screen.from(), to: screen.to() }
        },
        /*
         * The engine's own answer, read after the fact.
         *
         * A refusal is reported as a refusal with the engine's sentence -- "cannot convert a pressure to a length" is
         * the useful part, and reporting it as a success with no answer would be the one thing this must not do.
         */
        verify: () => {
          const got = screen.answer()
          if (got) return { done: true, detail: `${screen.amount()} ${screen.from()} is ${got.display}${got.exact ? ', exact by definition' : ''}.` }
          return { done: false, detail: screen.problem() || 'nothing came back and nothing said why.' }
        }
      },
      save: {
        name: 'Save this conversion',
        about: 'Keeps it in this Page’s own saved work, so it can be opened again.',
        run: async () => ({ saved: await screen.save() }),
        verify: (data) => {
          const { saved } = data as { saved: boolean }
          return saved ? { done: true, detail: 'It is in this Page’s saved work.' } : { done: false, detail: 'it could not be saved.' }
        }
      }
    },
    state: () => {
      const got = screen.answer()
      return {
        activity: screen.problem() !== '' ? 'failed' : got ? 'finished' : 'idle',
        detail: screen.problem() || undefined,
        values: {
          asked: `${screen.amount()} ${screen.from()} to ${screen.to()}`,
          // Never a number standing in for an answer that did not come: the engine refused, or it answered.
          answer: got ? got.display : 'no answer',
          measures: got ? got.dimension : 'not known',
          exactByDefinition: got ? got.exact : 'not known'
        }
      }
    }
  }
}

// ---------------------------------------------------------------- the Function Plotter

export const PLOT_KINDS = ['function', 'parametric', 'polar'] as const

/** What the Function Plotter has to hand over. */
export interface FunctionPlotterScreen {
  kind(): string
  setKind(id: string): void
  expression(): string
  setExpression(text: string): void
  second(): string
  setSecond(text: string): void
  from(): string
  setFrom(text: string): void
  to(): string
  setTo(text: string): void
  /** Plots again with whatever is set. The same thing the Page does on every change. */
  again(): void
  busy(): boolean
  /** How many points the engine evaluated, and in how many pieces the curve was drawn. Null when nothing is plotted. */
  result(): { evaluations: number; pieces: number } | null
  problem(): string
}

/**
 * The Function Plotter: what to draw, and over what range.
 *
 * `second` is only a parameter in the parametric mode, and says so rather than sitting there greyed out with no
 * reason. The curve is sampled by the engine, so what comes back is a count of evaluations and the number of pieces
 * it was drawn in -- the pieces matter, because a curve cut where it jumps is a different drawing from one joined
 * across the jump.
 */
export function functionPlotterSurface(screen: FunctionPlotterScreen): SurfaceDeclaration {
  const onlyParametric = (): true | string => (screen.kind() === 'parametric' ? true : 'Only a parametric plot has a second expression. Set kind to parametric first.')

  return {
    id: 'function-plotter',
    parent: 'pages/page',
    name: 'Function Plotter',
    about: 'Draws y = f(x), a parametric pair, or a polar curve, sampled where the curve bends.',
    kind: 'tool',
    keywords: ['plot', 'graph', 'function', 'curve', 'polar', 'parametric'],
    controls: {
      kind: {
        name: 'What to plot',
        spec: { type: 'string', description: 'A function of x, a parametric pair, or a polar curve.', enum: [...PLOT_KINDS] },
        get: () => screen.kind(),
        set: (value) => screen.setKind(String(value)),
        default: 'function'
      },
      expression: {
        name: 'Expression',
        about: 'y = f(x), or x(t) for a parametric plot, or r(theta) for a polar one.',
        spec: { type: 'string', description: 'The expression to draw, in the engine’s own notation: “sin(x) / x”.' },
        get: () => screen.expression(),
        set: (value) => screen.setExpression(String(value ?? ''))
      },
      second: {
        name: 'Second expression',
        about: 'y(t), for a parametric plot.',
        spec: { type: 'string', description: 'The second expression, y(t). Parametric plots only.' },
        get: () => screen.second(),
        writable: onlyParametric,
        set: (value) => screen.setSecond(String(value ?? ''))
      },
      from: {
        name: 'From',
        spec: { type: 'string', description: 'The low end of the range, as a number would be typed.' },
        get: () => screen.from(),
        set: (value) => screen.setFrom(String(value ?? ''))
      },
      to: {
        name: 'To',
        spec: { type: 'string', description: 'The high end of the range.' },
        get: () => screen.to(),
        set: (value) => screen.setTo(String(value ?? ''))
      }
    },
    actions: {
      redraw: {
        name: 'Draw it again',
        about: 'Samples the curve again. The Page also does this whenever anything above changes.',
        effects: ['read'],
        unavailable: () => (screen.busy() ? 'It is still sampling.' : null),
        run: () => {
          screen.again()
          return { kind: screen.kind(), expression: screen.expression() }
        },
        verify: async () => {
          // The redraw is asked for and happens on the next draw, so the answer is waited for rather than read at once.
          for (let i = 0; i < 60 && screen.busy(); i++) await new Promise((resolve) => setTimeout(resolve, 25))
          const got = screen.result()
          if (!got) return { done: false, detail: screen.problem() || 'nothing came back and nothing said why.' }
          return { done: true, detail: `Drawn from ${got.evaluations} evaluations${got.pieces > 1 ? `, in ${got.pieces} pieces because the curve jumped` : ''}.` }
        }
      }
    },
    state: () => {
      const got = screen.result()
      return {
        activity: screen.busy() ? 'running' : screen.problem() !== '' ? 'failed' : got ? 'finished' : 'idle',
        detail: screen.problem() || undefined,
        values: {
          plotting: screen.kind(),
          expression: screen.expression(),
          ...(screen.kind() === 'parametric' ? { second: screen.second() } : {}),
          range: `${screen.from()} to ${screen.to()}`,
          // Not 0 when nothing has been sampled: 0 evaluations reads as a curve that could not be drawn.
          evaluations: got ? got.evaluations : 'nothing plotted',
          pieces: got ? got.pieces : 'nothing plotted'
        }
      }
    }
  }
}
