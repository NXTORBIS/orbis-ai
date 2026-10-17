import type { AppearanceConfig, ExperienceConfig } from '../../../shared/experience'
import { defaultConfig, diffConfig } from '../../../shared/experience.ts'
import { BUILT_IN_PRESETS, applyPreset } from '../../../shared/presets.ts'
import { BUILT_IN_THEMES } from '../../../shared/themes.ts'
import type { SurfaceDeclaration } from '../lib/surfaces/registry.ts'

/**
 * What the Appearance section of Settings and the Customize centre inside it let Orbis do.
 *
 * Two screens, one idea: how Orbis looks. Light or dark and whether Orbis moves are saved the moment they are
 * changed, through the ordinary settings service. Everything in Customize is shown first and kept when Apply is
 * pressed -- a draft, exactly as it is for a person choosing a colour -- so every control here changes what is on
 * screen and `apply` is what makes it last. That is said in each control's own words rather than left to be
 * discovered, and `apply` is checked by reading the stored configuration back.
 *
 * Here rather than inside the two components for the usual reason: a declaration written inside a component can only
 * be checked by drawing it, and there is no browser in the test suite.
 */

/** The accent colours the Customize screen offers, with the Orbis cyan first. One list, drawn and declared from here. */
export const ACCENTS: readonly string[] = Object.freeze(['', '#3fd8ff', '#3ee58a', '#ffbe4d', '#ff4d6d', '#a78bfa', '#f472b6', '#60a5fa'])

/**
 * What "Orbis's own" is called when a chooser has to name it.
 *
 * The accent and the theme are both stored as "nothing" when Orbis's own is in use ('' and null), and nothing is not
 * a value a chooser can offer: a write of null is refused before it reaches a screen, and an empty string reads as a
 * mistake. So both choosers have a value for it, with the same name in both, and each one's `about` says so.
 */
export const ORBIS_OWN = 'orbis'

/** What the Appearance section has to hand over. Both of these are saved as soon as they are set. */
export interface AppearanceScreen {
  /** The three the segmented control on screen offers: system, light, dark. */
  themes: readonly string[]
  theme(): string
  setTheme(theme: string): void
  effects(): boolean
  setEffects(on: boolean): void
  /** Which way the window is really painted at this moment, asked of the window rather than worked out again here. */
  showing(): string
}

/**
 * Settings → Appearance: light or dark, and how much of Orbis moves.
 *
 * Both go through the settings service every other setting goes through, so a change here is saved, is sent to every
 * window, and shows in Settings itself straight away. Nothing is stored twice.
 */
export function appearanceSurface(screen: AppearanceScreen): SurfaceDeclaration {
  return {
    id: 'appearance',
    parent: 'settings',
    name: 'Appearance',
    about: 'Light or dark, how much of Orbis moves, and the Customize centre for everything else about how it looks.',
    kind: 'page',
    keywords: ['appearance', 'theme', 'dark', 'light', 'dark mode', 'light mode', 'colour', 'color', 'effects', 'motion', 'animation', 'look'],
    controls: {
      theme: {
        name: 'Theme',
        about: 'Light, dark, or whatever this computer is set to. Saved as soon as it is set.',
        spec: { type: 'string', description: 'Whether Orbis is light, dark, or follows the computer.', enum: [...screen.themes] },
        get: () => screen.theme(),
        set: (value) => screen.setTheme(String(value)),
        default: 'system'
      },
      effects: {
        name: 'Visual effects',
        about: 'The particles, the moving outline on the message box, the orb and the greeting. Off means less movement.',
        spec: { type: 'boolean', description: 'Whether Orbis animates its background and its orb.' },
        get: () => screen.effects(),
        set: (on) => screen.setEffects(on === true),
        default: true
      }
    },
    /*
     * The Customize centre is inside this section and is loaded when the section opens.
     *
     * Declared as reachable because opening this section really does register it -- after the moment it takes to load,
     * which is why `reach` is `always` rather than something to press: there is nothing to press, only to wait for.
     */
    possibleChildren: [{ id: 'customize', name: 'Customize', kind: 'panel', reach: { kind: 'always' } }],
    state: () => ({
      values: {
        theme: screen.theme(),
        // What is on screen can differ from what was chosen: "system" follows the computer, and a theme with light
        // surroundings turns on the light Orbis already has.
        showing: screen.showing(),
        effects: screen.effects()
      }
    })
  }
}

/** What the Customize centre has to hand over. */
export interface CustomizeScreen {
  /** Inside Settings → Appearance, or standing on its own. It is the same screen either way. */
  embedded: boolean
  /** The parts of Customize, as its own navigation lists them. */
  categories: readonly { id: string; label: string }[]
  /** The sections that have a "Reset this" button, as the screen has them. */
  resettable: readonly { id: string; label: string }[]
  /** The accent swatches on screen. */
  accents: readonly string[]
  category(): string
  openCategory(id: string): void
  /**
   * What is on screen: everything that has been chosen, kept or not.
   *
   * Throws while the stored configuration is still being read, on purpose -- a control whose getter throws reports
   * "could not be read", which is the truth, where answering with Orbis's own defaults would report somebody's
   * personalisation as absent because a file was slow.
   */
  draft(): ExperienceConfig
  /** What is really stored, so the screen can say how much is being shown and not yet kept. */
  saved(): ExperienceConfig
  /** Shows a whole configuration without keeping it. The handler every swatch, slider and switch on this screen calls. */
  change(next: ExperienceConfig): void
  /** The same, for one part of the appearance. */
  changeAppearance(patch: Partial<AppearanceConfig>): void
  /** Keeps what is being shown. */
  apply(): Promise<void>
  /** Throws away what is being shown and puts back what is stored. */
  cancel(): void
  resetSection(id: string): Promise<void>
  /** Keeps how Orbis looks now as a preset of your own. */
  savePreset(): void
  /** What is really stored, asked of Orbis again, for checking that Apply kept it. */
  check(): Promise<ExperienceConfig>
}

/**
 * The Customize centre: the palette, the spacing, the start page, accessibility, performance and privacy.
 *
 * Every control below sets the draft -- which is what the screen's own control does -- so a change shows at once and
 * lasts once `apply` has run. Reading one tells you what is on screen; `state` says how much of that is not yet kept,
 * and `apply` is confirmed against the stored configuration rather than against this screen.
 */
export function customizeSurface(screen: CustomizeScreen): SurfaceDeclaration {
  const draft = (): ExperienceConfig => screen.draft()
  const unkept = (): number => diffConfig(screen.saved(), draft()).length
  /**
   * The person's own themes and presets, left out while they cannot be read.
   *
   * A spec is part of the declaration, and a declaration is put together on every draw -- before anything has been
   * checked and possibly before this screen has read what is stored. A getter that throws in here takes the WHOLE
   * screen out of the register rather than one control out of the answer, so what is asked for in here is asked for
   * carefully: Orbis's own are always there, and yours are added as soon as they can be read.
   */
  const alsoMine = <T,>(read: () => T[]): T[] => {
    try {
      return read()
    } catch {
      return []
    }
  }
  /** Everything in the chooser of themes: Orbis's own colours, the themes Orbis offers, and the person's own. */
  const themeChoices = (): string[] => [ORBIS_OWN, ...BUILT_IN_THEMES.map((one) => one.id), ...alsoMine(() => draft().themes.map((one) => one.id))]
  const presetChoices = (): string[] => [...BUILT_IN_PRESETS.map((one) => one.id), ...alsoMine(() => draft().presets.map((one) => one.id))]
  /** A sentence, said once, on every control that only shows a change until Apply keeps it. */
  const shownUntilKept = 'Shown straight away; run apply to keep it.'

  return {
    id: 'customize',
    parent: screen.embedded ? 'settings/appearance' : null,
    name: 'Customize',
    /*
     * Said here because it is the one thing somebody reading this screen has to know.
     *
     * Every control below changes what is on screen and nothing else until `apply` runs -- which is exactly what the
     * swatches and sliders on it do for a person. The look itself can also be changed without a screen at all, saved
     * at once, with the `experience.appearance` capability; and putting the whole of it back is
     * `experience.restoreOriginal`, which is not offered twice here.
     */
    about: 'Everything optional about how Orbis looks: the preset, the colours, the spacing, the start page, accessibility, performance and privacy. A change is shown as it is made and is kept when apply runs. The look alone can also be set without this screen, and saved at once, with the experience.appearance capability.',
    kind: screen.embedded ? 'panel' : 'module',
    keywords: ['customize', 'customise', 'personalise', 'personalize', 'appearance', 'accent', 'spacing', 'density', 'preset', 'theme', 'wallpaper', 'accessibility', 'performance', 'privacy', 'start page', 'new tab'],
    controls: {
      category: {
        name: 'Section',
        about: 'Which part of Customize is on screen. Everything here can be set whichever part is showing.',
        spec: { type: 'string', description: 'Which part of Customize is on screen.', enum: screen.categories.map((one) => one.id) },
        get: () => screen.category(),
        set: (value) => screen.openCategory(String(value))
      },

      // ---------------------------------------------------------------- the look
      preset: {
        name: 'Preset',
        about: `A whole look at once: the palette, how solid the panels are, how tight the layout is and how much Orbis moves. ${shownUntilKept}`,
        spec: { type: 'string', description: 'Which preset to wear.', enum: presetChoices() },
        // Nothing is worn until one is chosen, and that is not the same as wearing the Orbis preset: the appearance
        // below simply stands on its own. So the value is nothing, and the default is a default of nothing.
        get: () => draft().activePresetId,
        set: (value) => {
          const id = String(value)
          const found = [...BUILT_IN_PRESETS, ...draft().presets].find((one) => one.id === id)
          if (!found) throw new Error(`There is no preset called “${id}”.`)
          // Exactly what pressing the preset on screen does.
          screen.change({ ...applyPreset(draft(), found), activePresetId: found.id })
        },
        default: null
      },
      colours: {
        name: 'Colours',
        about: `Which theme paints Orbis: one of Orbis's own, one of yours, or “${ORBIS_OWN}” for the colours Orbis has always used. ${shownUntilKept}`,
        spec: { type: 'string', description: 'The theme Orbis is painted with.', enum: themeChoices() },
        get: () => draft().themeId ?? ORBIS_OWN,
        set: (value) => screen.change({ ...draft(), themeId: String(value) === ORBIS_OWN ? null : String(value) }),
        default: ORBIS_OWN
      },
      accent: {
        name: 'Accent colour',
        about: `The colour Orbis picks things out in. “${ORBIS_OWN}” is the cyan it has always used. ${shownUntilKept}`,
        // The swatches the screen offers, and only those: the stored shape takes any #rrggbb, but a colour that is
        // not on screen would leave the row of swatches showing none of them as chosen.
        spec: { type: 'string', description: 'One of the accent colours on screen.', enum: screen.accents.map((one) => one || ORBIS_OWN) },
        get: () => draft().appearance.accent || ORBIS_OWN,
        set: (value) => screen.changeAppearance({ accent: String(value) === ORBIS_OWN ? '' : String(value) }),
        default: ORBIS_OWN
      },
      density: {
        name: 'Spacing',
        about: `How tight everything is drawn. ${shownUntilKept}`,
        spec: { type: 'string', description: 'How much room things are given.', enum: ['comfortable', 'cosy', 'compact'] },
        get: () => draft().appearance.density,
        set: (value) => screen.changeAppearance({ density: String(value) as AppearanceConfig['density'] }),
        default: 'comfortable'
      },
      fontScale: {
        name: 'Text and controls',
        about: `How large text and controls are drawn, as a factor: 1 is Orbis's own size. ${shownUntilKept}`,
        // The range is the stored shape's own (`normalizeConfig`), which is also the range of the slider on screen.
        spec: { type: 'number', description: 'How large text and controls are, from 0.85 to 1.4.', min: 0.85, max: 1.4 },
        get: () => draft().appearance.fontScale,
        set: (value) => screen.changeAppearance({ fontScale: Number(value) }),
        default: 1
      },
      cornerRadius: {
        name: 'Corner rounding',
        about: `How round corners are, in pixels. 0 keeps Orbis's own. The slider moves in twos. ${shownUntilKept}`,
        spec: { type: 'number', description: 'Corner rounding in pixels, from 0 to 24.', min: 0, max: 24 },
        get: () => draft().appearance.cornerRadius,
        set: (value) => screen.changeAppearance({ cornerRadius: Number(value) }),
        default: 0
      },
      transparency: {
        name: 'Panel see-through',
        about: `How see-through panels are, as a factor of Orbis's own: 1 is unchanged, higher is clearer. ${shownUntilKept}`,
        spec: { type: 'number', description: 'How see-through panels are, from 0.5 to 1.5.', min: 0.5, max: 1.5 },
        get: () => draft().appearance.transparency,
        set: (value) => screen.changeAppearance({ transparency: Number(value) }),
        default: 1
      },
      blur: {
        name: 'Background blur',
        about: `How much what is behind a panel is blurred, as a factor of Orbis's own. ${shownUntilKept}`,
        spec: { type: 'number', description: 'Background blur, from 0 to 2.', min: 0, max: 2 },
        get: () => draft().appearance.blur,
        set: (value) => screen.changeAppearance({ blur: Number(value) }),
        default: 1
      },
      movement: {
        name: 'Movement',
        about: `Whether Orbis keeps movement to a minimum. “system” follows what this computer asks for. ${shownUntilKept}`,
        spec: { type: 'string', description: 'How much Orbis moves.', enum: ['system', 'on', 'off'] },
        get: () => draft().appearance.reducedMotion,
        set: (value) => screen.changeAppearance({ reducedMotion: String(value) as AppearanceConfig['reducedMotion'] }),
        default: 'system'
      },

      // ---------------------------------------------------------------- the browser's start page
      greeting: {
        name: 'Greeting on a new tab',
        about: `Whether an empty tab says hello. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether a new tab greets you.' },
        get: () => draft().newTab.greeting,
        set: (on) => screen.change({ ...draft(), newTab: { ...draft().newTab, greeting: on === true } }),
        default: true
      },
      shortcuts: {
        name: 'Shortcuts on a new tab',
        about: `Whether an empty tab shows the shortcuts row. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether a new tab shows shortcuts.' },
        get: () => draft().newTab.shortcuts,
        set: (on) => screen.change({ ...draft(), newTab: { ...draft().newTab, shortcuts: on === true } }),
        default: true
      },
      widgets: {
        name: 'Widgets on a new tab',
        about: `Whether the widgets you have chosen are shown on an empty tab. Which widgets those are is chosen on the start page itself, not here. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether a new tab shows your widgets.' },
        get: () => draft().newTab.widgets,
        set: (on) => screen.change({ ...draft(), newTab: { ...draft().newTab, widgets: on === true } }),
        default: false
      },

      // ---------------------------------------------------------------- accessibility
      highContrast: {
        name: 'High contrast',
        about: `Stronger text and edges. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether text and edges are drawn more strongly.' },
        get: () => draft().accessibility.highContrast,
        set: (on) => screen.change({ ...draft(), accessibility: { ...draft().accessibility, highContrast: on === true } }),
        default: false
      },
      largerText: {
        name: 'Larger text',
        about: `Text at least 115% of its usual size, whatever the slider above says. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether text is kept at least 115%.' },
        get: () => draft().accessibility.largerText,
        set: (on) => screen.change({ ...draft(), accessibility: { ...draft().accessibility, largerText: on === true } }),
        default: false
      },
      alwaysShowFocus: {
        name: 'Always show focus',
        about: `Shows where the keyboard is, even while the mouse is being used. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether the focus ring is always drawn.' },
        get: () => draft().accessibility.alwaysShowFocus,
        set: (on) => screen.change({ ...draft(), accessibility: { ...draft().accessibility, alwaysShowFocus: on === true } }),
        default: false
      },

      // ---------------------------------------------------------------- performance
      performance: {
        name: 'Performance mode',
        about: `What Orbis spends effort on. Maximum performance and battery saver also keep movement to a minimum. ${shownUntilKept}`,
        spec: { type: 'string', description: 'What Orbis spends effort on.', enum: ['balanced', 'performance', 'visual', 'battery'] },
        get: () => draft().performance.mode,
        set: (value) => screen.change({ ...draft(), performance: { ...draft().performance, mode: String(value) as ExperienceConfig['performance']['mode'] } }),
        default: 'balanced'
      },
      suspendIdleWidgets: {
        name: 'Rest unused widgets',
        about: `Widgets that have not been looked at stop doing work. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether widgets nobody is looking at stop working.' },
        get: () => draft().performance.suspendIdleWidgets,
        set: (on) => screen.change({ ...draft(), performance: { ...draft().performance, suspendIdleWidgets: on === true } }),
        default: true
      },
      dataSaver: {
        name: 'Data saver',
        about: `Anything fetched from the internet is refreshed less often. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether remote things refresh less often.' },
        get: () => draft().performance.dataSaver,
        set: (on) => screen.change({ ...draft(), performance: { ...draft().performance, dataSaver: on === true } }),
        default: false
      },

      // ---------------------------------------------------------------- privacy
      doNotPersonalize: {
        name: 'Do not personalise',
        about: `Nothing about how you use Orbis is learnt or kept. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether Orbis learns nothing from how it is used.' },
        get: () => draft().privacy.doNotPersonalize,
        set: (on) => screen.change({ ...draft(), privacy: { ...draft().privacy, doNotPersonalize: on === true } }),
        default: false
      },
      keepOutOfPrivate: {
        name: 'Keep personalisation out of private tabs',
        about: `What you have personalised does not follow you into a private tab. ${shownUntilKept}`,
        spec: { type: 'boolean', description: 'Whether personalisation stays out of private tabs.' },
        get: () => draft().privacy.keepOutOfPrivate,
        set: (on) => screen.change({ ...draft(), privacy: { ...draft().privacy, keepOutOfPrivate: on === true } }),
        default: true
      },
      keepUsageDays: {
        name: 'Keep usage information for',
        /*
         * The four the chooser offers, as text.
         *
         * Stored as a number of days, and the stored shape would take any number from 0 to 365 -- but the chooser on
         * screen has four options, and a number that is not one of them leaves it showing nothing at all. So these
         * four, said as what they are, and a read of this control answers with the one that is chosen.
         */
        about: `How long Orbis keeps information about how it is used: 0 days means it keeps none. ${shownUntilKept}`,
        spec: { type: 'string', description: 'How many days usage information is kept: 0, 7, 30 or 365.', enum: ['0', '7', '30', '365'] },
        get: () => String(draft().privacy.keepUsageDays),
        set: (value) => screen.change({ ...draft(), privacy: { ...draft().privacy, keepUsageDays: Number(value) } }),
        default: '30'
      }
    },
    actions: {
      apply: {
        name: 'Keep these changes',
        about: 'Saves what is being shown, and keeps what it was before so it can be put back.',
        unavailable: () => (unkept() === 0 ? 'Nothing has been changed, so there is nothing to keep.' : null),
        run: () => screen.apply(),
        /*
         * Asked of the stored configuration, not of this screen.
         *
         * Saving goes through the main process, which reads what it is given back through its own rules -- so a value
         * it would not accept comes back as a difference here and is reported, rather than this screen saying it kept
         * something that was never stored.
         */
        verify: async () => {
          const stored = await screen.check()
          const left = diffConfig(stored, screen.draft())
          return {
            done: left.length === 0,
            detail: left.length === 0 ? 'What is on screen is what is now stored.' : `${left.length} did not keep: ${left.map((one) => one.path).join(', ')}.`
          }
        }
      },
      cancel: {
        name: 'Throw these changes away',
        about: 'Puts back what is stored, losing anything chosen and not kept.',
        unavailable: () => (unkept() === 0 ? 'Nothing has been changed, so there is nothing to throw away.' : null),
        run: () => {
          screen.cancel()
          return { cancelled: true }
        },
        verify: () => ({ done: unkept() === 0, detail: unkept() === 0 ? 'What is on screen is what is stored.' : `${unkept()} are still being shown.` })
      },
      /*
       * `resetPart`, not `reset`.
       *
       * A path is matched forgivingly, down to a substring, and "reset" is inside "preset" -- which is a control on
       * this very screen. So an action called `reset` could never be reached: the chooser of presets answered to the
       * word first. Two words, and the name on screen says what it does.
       */
      resetPart: {
        name: 'Put one part back to how Orbis has it',
        about: 'Throws away what you personalised in one part of Customize, and saves that.',
        params: { section: { type: 'string', description: 'Which part to put back.', required: true, enum: screen.resettable.map((one) => one.id) } },
        // It really removes what somebody chose, and it saves at once -- so it is asked about first.
        effects: ['write', 'delete'],
        confirmation: 'always',
        run: async (params) => {
          const id = String(params.section)
          await screen.resetSection(id)
          return { section: id }
        },
        /*
         * Asked of what is stored, against Orbis's own defaults -- which is the question "is it back?".
         *
         * Not against this screen: resetting saves and then redraws, and a check that read the screen would be
         * reading it a moment before it had caught up.
         */
        verify: async (data) => {
          const section = (data as { section: string }).section
          const stored = await screen.check()
          const left = diffConfig(stored, defaultConfig()).filter((one) => one.path.startsWith(section))
          const label = screen.resettable.find((one) => one.id === section)?.label ?? section
          return { done: left.length === 0, detail: left.length === 0 ? `${label} is back to how Orbis has it.` : `${label} is still personalised: ${left.map((one) => one.path).join(', ')}.` }
        }
      },
      savePreset: {
        name: 'Keep how Orbis looks now as a preset',
        about: 'Makes a preset of your own from what is on screen, called “My preset”. Run apply afterwards to keep it.',
        run: () => {
          const before = draft().presets.length
          screen.savePreset()
          return { before }
        },
        verify: (data) => {
          const before = (data as { before: number }).before
          const now = draft().presets.length
          return { done: now > before, detail: now > before ? `There are ${now} presets of your own now. Run apply to keep it.` : 'No preset was added.' }
        }
      }
    },
    state: () => {
      const left = diffConfig(screen.saved(), draft())
      return {
        // A screen with changes nobody has kept is not doing anything -- it is waiting for somebody. Said in words
        // rather than as a measurement: there is nothing here to be a fraction of.
        activity: 'idle',
        ...(left.length ? { detail: `${left.length} change${left.length === 1 ? '' : 's'} being shown and not yet kept. Run apply to keep them.` } : {}),
        values: {
          section: screen.category(),
          unkept: left.length,
          changing: left.map((one) => one.path).slice(0, 12),
          wearing: draft().activePresetId ?? 'nothing',
          colours: draft().themeId ?? ORBIS_OWN,
          myThemes: draft().themes.length,
          myPresets: draft().presets.length,
          wallpapers: draft().wallpapers.length
        }
      }
    }
  }
}
