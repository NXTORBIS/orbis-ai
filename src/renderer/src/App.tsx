import { chatHtml, chatMarkdown } from '../../shared/chatExport'
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNotices } from './app/useNotices'
import { useChat } from './app/useChat'
import CommandPalette from './components/CommandPalette'
import { DEFAULT_AVATAR } from '../../shared/avatars'
import { ASK_EVENT } from './components/native/AskBar'
import type { ChatMessage, Settings, SettingsUpdate } from '../../shared/types'
import { isRefusal } from '../../shared/account'
import { themeBase } from '../../shared/themes'
import { MODELS } from '../../shared/models'
import { PUSH_TO_TALK_EVENT } from '../../shared/voiceInput'
import { copyText, newId } from './lib/utils'
import ChatHeader from './components/ChatHeader'
import ContextChip from './components/ContextChip'
import ChatView from './components/ChatView'
import BrowserView from './components/BrowserView'
import MarketStrip from './components/MarketStrip'
import ImagesAndFilesView from './components/ImagesAndFilesView'
import ChanceView from './components/ChanceView'
import { useExperience } from './lib/experience'
import HudBackground from './components/HudBackground'
import Sidebar from './components/Sidebar'
import UnfinishedRuns from './components/UnfinishedRuns'
import type { FeatureId } from './components/Sidebar'
import { featureGroupsFor } from './lib/features'
import { useFeatureVisibility } from './lib/useFeatureVisibility'
import { describeVisibility, factsFor, featureState, isVisible } from '../../shared/featureVisibility'
import { INITIAL_NAV, featureOf, navReducer, showingBrowser, showingImages } from '../../shared/navigation'
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from '../../shared/settingsSections'
import { destinationFor } from '../../shared/notificationRoute'
import { watchingGroup } from '../../shared/watching'
// Orbis's own screens. Each was finished and unreachable: nothing imported them, so no amount of looking would have
// found them. They are loaded lazily because only one is ever open and most sessions open none.
// Lazy like the rest: the chart and its indicators are a large bundle for a screen most sessions never open.
const MarketsView = lazy(() => import('./components/MarketsView'))
const PulsarSetup = lazy(() => import('./components/PulsarSetup'))
const WhiteboardView = lazy(() => import('./components/WhiteboardView'))
const ChessView = lazy(() => import('./components/chess/ChessView'))
const NeurovaView = lazy(() => import('./components/NeurovaView'))
const StudentView = lazy(() => import('./components/student/StudentView'))
const PagesView = lazy(() => import('./components/PagesView'))
const CreateView = lazy(() => import('./components/CreateView'))
const ClipboardView = lazy(() => import('./components/ClipboardView'))
const CoursesView = lazy(() => import('./components/courses/CoursesView'))
const ToolkitView = lazy(() => import('./components/toolkit/ToolkitView'))
const EyeView = lazy(() => import('./components/eye/EyeView'))
/*
 * The Arcade.
 *
 * Lazily loaded like the rest of the screens, and the games inside it are each a chunk of their own again, so
 * opening the window costs nothing and opening the Arcade costs the catalogue rather than thirty-two games.
 */
const OfflineGames = lazy(() => import('./components/OfflineGames'))
const CosmosView = lazy(() => import('./components/cosmos/CosmosView'))
import { setArenaReturn, withTransition } from './lib/motion'
const ArenaView = lazy(() => import('./components/arena/ArenaView'))
const F1View = lazy(() => import('./components/f1/F1View'))
const FootballView = lazy(() => import('./components/football/FootballView'))
const LabsView = lazy(() => import('./components/labs/LabsView'))
const WorkspacesView = lazy(() => import('./components/WorkspacesView'))
const SchedulesView = lazy(() => import('./components/SchedulesView'))
const MeetingView = lazy(() => import('./components/MeetingView'))
import { ActivityPanel, ShortcutsModal, ToastStack } from './components/Overlays'
import ShellSurfacePoints from './components/ShellSurfacePoints'
import SettingsModal from './components/SettingsModal'
import WelcomeExperience from './components/WelcomeExperience'
import UrlBar from './components/UrlBar'
import ControlPrompts from './components/ControlPrompts'
import { useControlRendered } from './lib/browserControl'
import { useSurfaceBridge } from './lib/surfaces'
import { OPEN_URL_EVENT } from './lib/openInBrowser'
import { OPEN_ARTIFACT_EVENT, artifactChanged, openArtifact, type OpenArtifactDetail } from './lib/artifactEvents'
import type { OpenUrlDetail } from './lib/openInBrowser'
import SystemBar from './components/SystemBar'
import ImageEditor from './components/ImageEditor'
import { ImageEditorContext, collectImages, imageMarkdown } from './lib/imageEditor'
import type { EditableImage, GalleryImage } from './lib/imageEditor'



export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loaded, setLoaded] = useState(false)
  /** The Orbis startup screen, shown on every launch; 'leaving' while it hands over to the main interface. */
  const [welcome, setWelcome] = useState<'closed' | 'open' | 'leaving'>('open')
  /** No valid name is saved, so startup continues into the name step. Set once, when settings load. */
  const [needsName, setNeedsName] = useState(false)
  /**
   * This profile has an account password and it has not been given yet.
   *
   * Read from the main process at startup, never from anything a window stores: whether an account is open is the main
   * process's answer, and a window that could decide it for itself would be the lock.
   */
  const [needsUnlock, setNeedsUnlock] = useState(false)
  /**
   * Whether the account has been asked about yet.
   *
   * Startup must not decide to let anyone in before this is true. Without it, a profile with a password could be entered
   * simply because reading the settings finished first -- the lock would appear a moment later, over an interface that
   * had already been handed over. So this gates readiness, exactly as loading the settings does.
   */
  const [accountChecked, setAccountChecked] = useState(false)
  /** Why Orbis locked itself, so the unlock screen can say so. Null when this is an ordinary start. */
  const [lockedReason, setLockedReason] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('orbis.sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })
  /**
   * What is on screen, and whether the browser is running. One reducer, in `shared/navigation.ts`.
   *
   * This was four independent pieces of state -- the open screen, the image gallery, whether Chromium had started
   * and whether it was in front -- so every place that opened something had to remember to close the other three.
   * The places that forgot were the bug: a notification opening a screen left the browser covering it, and the
   * sidebar opening a screen left it mounted behind the browser.
   *
   * The names below are kept, because sixty-odd lines read them. They are derived from one value now, so "two
   * screens at once" is no longer something to remember; it is a sentence that cannot be said.
   */
  const [nav, go] = useReducer(navReducer, INITIAL_NAV)
  const imagesOpen = showingImages(nav)
  const feature: FeatureId | null = featureOf(nav)
  /** What was typed after /create, handed to the Create screen. The token makes the same words asked twice two requests. */
  const [createAsked, setCreateAsked] = useState<{ text: string; token: number } | null>(null)
  /** Which kept artifact a card in the conversation asked the Create screen to open. The token makes a second press a second request. */
  const [createOpenAt, setCreateOpenAt] = useState<{ artifactId: string; token: number } | null>(null)
  /** Everything the user has personalised, applied to the window; an untouched Orbis is left exactly as it is. */
  const experience = useExperience()

  /**
   * Opens one of Orbis's own panels -- from a widget, say. These live in the browser's sidebar now.
   *
   * This used to ask for a capability called `sidebar.open`, which does not exist and never has: the call was
   * refused, the refusal was swallowed by a catch, and the button did nothing at all. It goes through `surface.open`
   * now, which is the real capability for the browser's own pages, at the panel's own address with the view as the
   * place within it -- so the panel opens where it was asked to open, and a failure is said rather than swallowed.
   */
  const openOrbisView = useCallback(
    (name: string): void => {
      go({ kind: 'chat' })
      void window.api
        .executeControl({ capability: 'surface.open', params: { name: 'orbis panel', at: `#${name}` }, target: {}, source: 'user' })
        .then((result) => {
          if (!result.ok) notifyRef.current(result.error?.message ?? 'That could not be opened.', 'error')
        })
        .catch(() => notifyRef.current('That could not be opened.', 'error'))
    },
    []
  )
  const [webSearch, setWebSearch] = useState(false)
  const [searchToken, setSearchToken] = useState(0)
  const [activityOpen, setActivityOpen] = useState(false)
  /**
   * Which section of Settings is open, or null for closed.
   *
   * A section rather than a boolean, so every way in can land somewhere meaningful. All five used to open the same
   * scroll at the top and leave you to find what you came for.
   */
  const [settingsAt, setSettingsAt] = useState<SettingsSectionId | null>(null)
  const [filesTool, setFilesTool] = useState<string | undefined>(undefined)
  const [chanceOpen, setChanceOpen] = useState(false)
  const settingsOpen = settingsAt !== null
  const setSettingsOpen = (open: boolean | SettingsSectionId): void =>
    setSettingsAt(open === false ? null : open === true ? DEFAULT_SETTINGS_SECTION : open)
  /** Settings moved to another section: remembered here so this window knows where it is. */
  const rememberSection = useCallback((section: SettingsSectionId): void => setSettingsAt(section), [])
  /**
   * Opening the browser.
   *
   * It fills the content area, always. It used to be a window that could be docked, shrunk to a preset or dragged to
   * a size, which meant five ways to be looking at a browser and four of them worse than the fifth.
   */
  // Orbis's browser is Chromium. Its window sits inside this window, over the browser view (the old full-page mode): opening the
  // browser shows the view, "Return to chat" hides it and Chromium keeps running with its tabs.
  const browserOpen = nav.browserLaunched
  const browserHidden = nav.surface.kind !== 'browser'
  /**
   * Whether the browser is running at all, which is not whether it is in front.
   *
   * As its own window it goes on running while the chat is being used -- that is what lets coming back to it keep
   * every tab. The chat says so while it is true and says nothing when it is not.
   */
  const [browserRunning, setBrowserRunning] = useState(false)
  // Read inside callbacks that must not be rebuilt every time the screen changes.
  const navLive = useRef(nav)
  navLive.current = nav
  const openChromium = useCallback((input: string, options?: { newTab?: boolean; more?: string[] }) => {
    go({ kind: 'browser' })
    void window.api.chromiumOpen(input, options).then((result) => {
      if (!result.ok) notifyRef.current(result.detail, 'error')
    })
  }, [])
  const openBrowser = useCallback(() => openChromium(''), [openChromium])
  /** Sidebar and /browser: show the browser, or go back to the chat when it is already showing. */
  const toggleBrowser = useCallback(() => {
    const open = navLive.current.browserLaunched
    const hidden = !showingBrowser(navLive.current)
    if (open && !hidden) {
      go({ kind: 'browserDismissed' })
      // The browser is its own window now, so hiding it is this process's job and not something the renderer can do
      // by collapsing a view. Without this there was no way back to the chat except through the browser's own toolbar.
      void window.api.chromiumReturnToChat()
    }
    else if (open) {
      go({ kind: 'browser' })
      void window.api.chromiumOpen('', { newTab: false })
    } else openChromium('')
  }, [openChromium])
  /**
   * Which features this person has showing.
   *
   * One of these for the window, handed down to the sidebar and the box of everything, and asked by everything that
   * opens a screen. Nothing keeps its own list: the launcher, the palette, the slash commands, the chords and Orion
   * all ask `isVisible` in `shared/featureVisibility.ts`, because the last time two parts of Orbis each kept their
   * own idea of which features existed they drifted nine features apart and neither side could tell.
   */
  const visibility = useFeatureVisibility()
  /** The latest choice, for the callbacks below: they are asked at the moment somebody presses something. */
  const choiceLive = useRef(visibility.choice)
  choiceLive.current = visibility.choice

  /**
   * Shows one screen, whatever is showing now. This is what Orbis's own control layer sets.
   *
   * One function for the whole switch, because there is one thing on screen (`shared/navigation.ts`) and because
   * leaving the browser is not something a view can do by collapsing itself: Chromium is a window of its own
   * parented into this one, so the main process has to be told. This is what the window's own surface sets, so
   * "open Markets" and "back to the chat" go exactly the way the sidebar goes.
   *
   * A screen somebody has switched off **throws, with the reason in words**. That is the honest answer and the one
   * rule four is about: the control layer reports it as hidden -- something that exists, is switched off and can be
   * switched on -- rather than as missing, and never as having worked. Silence here would be Orion telling somebody
   * it had opened Markets while they looked at a conversation.
   *
   * It waits for the saved choice rather than reading whatever has arrived, because a question asked a frame after
   * the window opened must not be answered out of a file that had not been read yet.
   */
  const showScreen = useCallback(
    async (what: string): Promise<void> => {
      if (what === 'browser') return openChromium('', { newTab: false })
      if (what !== 'chat' && what !== 'images') {
        const state = featureState(what, await visibility.settled())
        if (!state.visible) throw new Error(state.hiddenBecause ?? describeVisibility(what, choiceLive.current))
      }
      if (showingBrowser(navLive.current)) void window.api.chromiumReturnToChat()
      if (what === 'chat') return go({ kind: 'chat' })
      if (what === 'images') return go({ kind: 'images' })
      go({ kind: 'feature', id: what as FeatureId })
    },
    [openChromium, visibility]
  )
  /**
   * Pressing a notification.
   *
   * Orbis brings the window forward and then has to arrive somewhere. Until now it arrived nowhere: the message
   * saying which notification had been pressed had no listener at all, so the window came up on whatever screen
   * happened to be open and the button looked like it had worked.
   *
   * Where each one goes is decided in one table, from the event name and the ids, so nothing a notification says can
   * steer the window; and an event with no real screen behind it says so rather than pretending.
   */
  /**
   * Tells Orbis what is on screen, so it does not announce something you are already looking at.
   *
   * The rule that holds those notifications back was written and tested long ago, but nothing ever sent this, so it
   * never once ran: a download finishing while the downloads list was open still raised a notification about it.
   */
  /*
   * A question asked from inside a lesson.
   *
   * The lesson has already had its context assembled in the main process, with the course material fenced, so
   * all that arrives here is a finished prompt. The alternative -- threading a send function down through four
   * screens -- would have been four more props for one feature.
   */
  /*
   * A lab opened full page covers the conversation, so its own ask bar announces what was typed and this sends it.
   *
   * The alternative was threading `send` down through the message list, the message, the card and into the bar —
   * four components that have no other reason to know how a message is sent. One listener here is the smaller
   * coupling, and it is the shell's job to send things.
   */
  useEffect(() => {
    const onAsk = (event: Event): void => {
      const asked = (event as CustomEvent<{ text?: string }>).detail?.text
      if (typeof asked !== 'string' || asked.trim() === '') return
      send(asked.trim(), [])
    }
    window.addEventListener(ASK_EVENT, onAsk)
    return () => window.removeEventListener(ASK_EVENT, onAsk)
  })

  useEffect(() => {
    const onAsk = (event: Event): void => {
      const detail = (event as CustomEvent<{ prompt?: string }>).detail
      if (!detail?.prompt) return
      closeFeature()
      sendRef.current(detail.prompt, [])
    }
    window.addEventListener('orbis:ask-orion', onAsk)
    return () => window.removeEventListener('orbis:ask-orion', onAsk)
  }, [])

  useEffect(() => {
    void window.api.notificationWatching(watchingGroup(feature))
  }, [feature])

  /**
   * Tells Orbis whether this computer asks for less movement.
   *
   * Only a window can read that setting, so the main process was guessing -- and guessing false -- which left the
   * browser's own pages animating for somebody who had asked them not to.
   */
  useEffect(() => {
    const asks = window.matchMedia('(prefers-reduced-motion: reduce)')
    const tell = (): void => {
      void window.api.systemWantsStillness(asks.matches).catch(() => undefined)
    }
    tell()
    asks.addEventListener('change', tell)
    return () => asks.removeEventListener('change', tell)
  }, [])

  useEffect(() => {
    return window.api.onNotificationOpen((what) => {
      const where = destinationFor(what.event, what.subject)
      switch (where.kind) {
        case 'feature':
          // Through the one guard, so a notification about a screen somebody switched off says so rather than
          // bringing the window forward onto whatever happened to be open and looking as though it had worked.
          void openFeature(where.id as FeatureId, () => {
            if (where.id === 'create' && where.focus) setCreateOpenAt({ artifactId: where.focus, token: Date.now() })
          })
          return
        case 'settings':
          setSettingsAt(where.section)
          return
        case 'chat':
          setSettingsAt(null)
          go({ kind: 'chat' })
          if (where.conversationId) setActiveId(where.conversationId)
          return
        case 'browser':
          setSettingsAt(null)
          openBrowser()
          return
        case 'activity':
          setActivityOpen(true)
          return
        default:
          // Nothing to go to. Saying so is the point: the alternative is a window that comes forward and lies.
          notifyRef.current('That has already finished; there is nothing left to open.', 'info')
      }
    })
  }, [openBrowser])

  useEffect(() => {
    const offShow = window.api.onChromiumShow(() => {
      go({ kind: 'browserShown' })
    })
    const offHide = window.api.onChromiumHide(() => go({ kind: 'browserDismissed' }))
    const offRunning = window.api.onChromiumRunning((running) => setBrowserRunning(running))
    const offClosed = window.api.onChromiumClosed(() => {
      go({ kind: 'browserGone' })
    })
    return () => {
      offShow()
      offHide()
      offRunning()
      offClosed()
    }
  }, [])



  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /**
   * Everything Orbis can do, from one box.
   *
   * Nine of the window's eleven screens had exactly one way in -- a flat dropdown on the wordmark -- and no
   * keyboard route at all. This is the keyboard route, and it reads the same registry the browser's Command
   * Centre does, so the two cannot offer different things.
   */
  const [paletteOpen, setPaletteOpen] = useState(false)
  /** Shown when a microphone is pressed and Pulsar has no model yet. Raised by the voice service, not by a button. */
  const [pulsarSetup, setPulsarSetup] = useState(false)

  useEffect(() => {
    const open = (): void => setPulsarSetup(true)
    window.addEventListener('orbis:pulsar-needed', open)
    return () => window.removeEventListener('orbis:pulsar-needed', open)
  }, [])
  const [quickPromptsOpen, setQuickPromptsOpen] = useState(false)

  // ---------- Hooks ----------
  const { notices, setNotices, unread, setUnread, toasts, setToasts, notify, logActivity, notifyRef, activityOpenRef } = useNotices()

  /**
   * Opens one of Orbis's own screens, if this person has it switched on.
   *
   * **Every route into a screen goes through here**: the sidebar menu, the box of everything, the slash commands, the
   * keyboard chords, a pressed notification, a schedule, a card in the conversation. One function, because the rule
   * has to be the same whichever way somebody arrived, and because an advertised route that quietly does nothing is a
   * fault this repository has shipped before.
   *
   * A screen that is switched off is **said out loud**, with what to do about it. Never a silent failure and never a
   * claim that it opened: Orbis says it is switched off, says everything it had is still there, and names the way to
   * turn it on -- Ctrl+K, which really does turn it on, rather than a settings page that may not exist yet.
   *
   * It waits for the saved choice rather than reading whatever has arrived. A notification pressed a frame after the
   * window opened must not be told a screen is off because the file had not been read yet.
   */
  const openFeature = useCallback(
    async (id: FeatureId, then?: () => void): Promise<boolean> => {
      const state = featureState(id, await visibility.settled())
      if (!state.visible) {
        notify(`${state.hiddenBecause ?? describeVisibility(id, choiceLive.current)} Press Ctrl+K and type its name to turn it back on.`, 'warn')
        return false
      }
      setSettingsAt(null)
      go({ kind: 'feature', id })
      then?.()
      return true
    },
    [notify, visibility]
  )

  /**
   * Switching a screen on from the box of everything, and going straight to it.
   *
   * The whole point of being able to find a hidden screen: somebody types "chess", sees that it is off, presses
   * Enter, and is in Chess World. A refused save is reported in those words and nothing is opened, because a screen
   * shown as on when the file could not be written is the one failure worth more than all the others.
   */
  const turnFeatureOn = useCallback(
    async (id: FeatureId): Promise<void> => {
      const answer = await visibility.set(id, true)
      if (answer.refused !== null) return notify(answer.refused, 'error')
      for (const note of answer.notes) notify(note, 'warn')
      const state = featureState(id, answer.choice)
      if (!state.visible) return notify(state.hiddenBecause ?? describeVisibility(id, answer.choice), 'warn')
      setSettingsAt(null)
      go({ kind: 'feature', id })
      notify(`${factsFor(id)?.label ?? id} is back in your menu.`)
    },
    [notify, visibility]
  )
  const chat = useChat({ notify, logActivity, go, webSearch, settings })
  const {
    conversations, streams, activeId, setActiveId, active, current, queues,
    send, sendRef, stop, regenerate, editMessage, resendFrom, useBranch, forgetBranch,
    deleteConversation, renameConversation, archiveConversation, shareConversation,
    setFeedback, changeModel, clearConversation, newChat, toggleIncognito,
    improvePrompt, removeQueued, clearQueue, resumeQueue, setQuiz, addReply,
    changeDecision, explainDecision, keepDecision, openNativeApp,
    answerBrowserConfirmation, controlAutomation, persist, updateConversation,
    conversationsRef, streamsRef
  } = chat

  /*
   * What the window's own surface reads, kept in refs.
   *
   * A getter is asked at the moment somebody wants to know -- including the moment just after something has been
   * done, before React has drawn anything. `navLive` above is already a ref for exactly that reason, and the chat
   * hook keeps `conversationsRef` and `streamsRef` for it too; these are the same thing for the two other values the
   * surface reads. Without them, what Orbis is told happened would be read from a copy taken before it changed.
   */
  /*
   * How many times a fresh chat has been asked for.
   *
   * "New chat" on an unsaved, empty chat used to do nothing you could see: there is no chat to leave, so the active
   * id stays null, the chat screen keeps the same key, and whatever had been typed in the message box sat there
   * word for word. Counting the requests gives the screen a new key every time, so the box is empty and the chat
   * really is new.
   */
  const [chatEpoch, setChatEpoch] = useState(0)

  const activeLive = useRef(activeId)
  activeLive.current = activeId
  /** Starting a chat from a button or a shortcut: the one that also clears a typed draft. */
  const freshChat = useCallback(() => {
    setChatEpoch((n) => n + 1)
    newChat()
  }, [newChat])
  const noticesLive = useRef(notices)
  noticesLive.current = notices

  // Opened from an Arena card, a screen folds back into that card; opened from anywhere else it returns to the chat.
  const fromArena = useRef<'football' | 'f1' | null>(null)
  const closeFeature = useCallback(() => {
    const from = fromArena.current
    if (from) {
      fromArena.current = null
      setArenaReturn(from)
      withTransition(() => go({ kind: 'feature', id: 'arena' }))
    } else go({ kind: 'chat' })
  }, [])
  useEffect(() => { artifactChanged() }, [feature])

  /**
   * The laboratories open in the conversation now, by app id.
   *
   * Read out of the refs rather than this render, and stable, because what asks for it is the Laboratories screen's
   * own surface: it checks after opening one whether the card really turned up, which is a moment later and in a
   * render that has not happened yet. A copy taken when the screen drew would answer about the conversation as it
   * was before.
   */
  const labsOpenHere = useCallback((): readonly string[] => {
    const id = activeLive.current
    const conversation = id ? conversationsRef.current.find((one) => one.id === id) : undefined
    if (!conversation) return []
    return [...new Set(conversation.messages.flatMap((one) => (one.apps ?? []).map((two) => two.appId)))]
  }, [conversationsRef])

  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)


  /*
   * Loaded once, and again only when asked.
   *
   * `chat` is a new object on every render, so depending on it made this effect run after every render: each time it
   * read the conversations back from disk and replaced what was in memory -- which is exactly the reply that was
   * still streaming in. The function itself is stable, and that is all this needs.
   */
  const { loadConversations } = chat
  const load = useCallback(() => {
    window.api.getSettings().then(
      (s) => {
        setSettings(s)
        loadConversations(s)
        setNeedsName(!s.welcomeCompleted || !s.userName.trim())
        void window.api
          .accountStatus()
          .then((status) => {
            if (!isRefusal(status)) setNeedsUnlock(status.hasPassword && !status.unlocked)
          })
          .finally(() => setAccountChecked(true))
        setLoadError(false)
        setLoaded(true)
      },
      () => setLoadError(true)
    )
  }, [loadConversations])

  useEffect(load, [load])
  // Settings changed through the Browser Control Layer show up straight away.
  useEffect(() => window.api.onSettingsChanged(setSettings), [])

  /**
   * A schedule asked for one of Orbis's own Pages.
   *
   * Pages are hosted in this window, so this is where one actually opens. The address arrives already resolved, so
   * nothing here decides whether the Page exists.
   */
  const [scheduledPage, setScheduledPage] = useState<string | null>(null)
  useEffect(
    () =>
      window.api.onScheduleOpenPage((url) => {
        setScheduledPage(url)
        void openFeature('pages')
      }),
    []
  )

  // "Open browser on launch": checked once, when settings first arrive and the welcome screen is out of the way, so
  // switching the setting on later doesn't pop the browser open mid-session.
  const launchChecked = useRef(false)
  useEffect(() => {
    if (launchChecked.current || !settings || welcome === 'open') return
    launchChecked.current = true
    /**
     * Only when the browser is not already running.
     *
     * With the browser as its own window this setting is answered before any window is made, so by the time this runs
     * it has already happened. Opening again would take focus back off the browser the person asked to land in.
     */
    if (settings.openBrowserOnLaunch && !browserRunning) openBrowser()
  }, [settings, welcome, openBrowser, browserRunning])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const dark = settings ? settings.theme === 'dark' || (settings.theme === 'system' && systemDark) : true

  const effects = settings?.effects !== false

  // A theme that expects light surroundings turns on the light Orbis already has, and then refines it; with no theme,
  // the user's own light-or-dark choice stands exactly as before.
  const experienceBase = themeBase(experience.config.themeId, experience.config.themes)
  useEffect(() => {
    document.documentElement.dataset.theme = experienceBase ?? (dark ? 'dark' : 'light')
  }, [dark, experienceBase])

  const updateSettings = useCallback(async (update: SettingsUpdate) => {
    const next = await window.api.updateSettings(update)
    setSettings(next)
    return next
  }, [])

  /**
   * Finishing account creation: the name and the password, in that order.
   *
   * The password first would leave a protected account with no name if the name then failed to save; the name first
   * leaves at worst a named account with no password, which is exactly the state every account made before passwords
   * existed is already in -- and which Orbis already knows how to offer a password to. So the order is the one whose
   * failure is recoverable.
   *
   * Throwing is what tells the welcome screen to keep what was typed and say it did not work.
   */
  const completeWelcome = useCallback(
    async (name: string, password: string, avatar: string) => {
      const next = await updateSettings({ userName: name, userAvatar: avatar, welcomeCompleted: true })
      if (!next.welcomeCompleted || !next.userName.trim()) throw new Error('Setup was not saved')

      const made = await window.api.accountCreate(password, name)
      if (isRefusal(made)) throw new Error(made.message ?? 'The password could not be saved.')
      if (!made.hasPassword) throw new Error('The password could not be saved.')
    },
    [updateSettings]
  )

  /**
   * Keeping what the first run was told about which features to show.
   *
   * The answer from the main process is what was really stored, so a refusal is passed back as itself rather than
   * turned into a success. Nothing here decides anything: the rules live in `shared/featureVisibility.ts`.
   */
  const chooseWelcomeFeatures = useCallback(async (features: readonly string[]): Promise<{ refused: string | null }> => {
    const said = await window.api.chooseVisibleFeatures(features)
    return { refused: said.refused }
  }, [])

  /**
   * Giving the password to the account.
   *
   * Nothing is decided here. The answer -- right, wrong, or too soon -- comes from the main process, and this only turns
   * it into a sentence and stops asking once it is open.
   */
  const unlockAccount = useCallback(
    async (password: string): Promise<{ ok: true } | { ok: false; why: string; waitMs: number }> => {
      const said = await window.api.accountUnlock(password)
      if (isRefusal(said)) {
        const seconds = Math.ceil((said.waitMs ?? 0) / 1000)
        const why =
          said.error === 'cooling-down'
            ? `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`
            : (said.message ?? 'That password is not right.')
        return { ok: false, why, waitMs: said.waitMs ?? 0 }
      }
      if (!said.unlocked) return { ok: false, why: 'That password is not right.', waitMs: 0 }
      setNeedsUnlock(false)
      setLockedReason(null)
      return { ok: true }
    },
    []
  )

  /**
   * Orbis locked itself while it was open.
   *
   * The same screen as at startup, reopened -- there is one unlock screen and one authentication, which is what stops
   * this becoming a second security system with its own way of being wrong. The reason travels with it so the screen can
   * say why it appeared rather than looking like a fault.
   *
   * `accountChecked` is set as well: the startup check may never have run in a session that locked before it finished,
   * and without it the screen would wait for a check that is no longer coming.
   */
  useEffect(
    () =>
      window.api.onAccountLocked((event) => {
        setLockedReason(event?.reason ?? 'manual')
        setNeedsUnlock(true)
        setAccountChecked(true)
        setWelcome('open')
      }),
    []
  )

  const enterFromWelcome = useCallback(() => {
    setWelcome('leaving')
    setLoaded(true)
  }, [])

  const finishWelcome = useCallback(() => {
    setWelcome('closed')
    setLoadError(false)
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus())
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('orbis.sidebarCollapsed', sidebarCollapsed ? '1' : '0')
    } catch {
      // Storage can be unavailable; the sidebar just won't remember its state.
    }
  }, [sidebarCollapsed])

  const toggleSidebar = useCallback(() => setSidebarCollapsed((collapsed) => !collapsed), [])

  const openSearch = useCallback(() => {
    setSidebarCollapsed(false)
    setSearchToken((n) => n + 1)
  }, [])

  const selectChat = useCallback((id: string) => {
    setActiveId(id)
    go({ kind: 'chat' })
  }, [])

  const togglePin = useCallback(
    (id: string) => {
      updateConversation(id, (c) => ({ ...c, pinned: !c.pinned }))
      persist(id)
    },
    [persist, updateConversation]
  )

  const editGalleryImage = useCallback((image: GalleryImage) => {
    setEditing({ conversationId: image.conversationId, image: { src: image.src, prompt: image.prompt, seed: image.seed, alpha: image.alpha } })
  }, [])

  useEffect(() => {
    activityOpenRef.current = activityOpen
  }, [activityOpen, activityOpenRef])

  const toggleActivity = useCallback(() => {
    setActivityOpen((open) => !open)
    setUnread(0)
  }, [])

  /**
   * Web search on or off, and saying so.
   *
   * One handler rather than the same two lines in three places: the button on the strip, the `/web` command and the
   * conversation's own surface. They were two copies before this, which is how a switch comes to say one thing in
   * one place and another somewhere else.
   */
  const toggleWebSearch = useCallback(() => {
    notify(webSearch ? 'Web search off.' : 'Web search on. Replies will use live results.')
    setWebSearch(!webSearch)
  }, [notify, webSearch])



  /** From the URL bar, links and research sources: show the address in the Orbis browser, in a new tab when asked. */
  const openInBrowser = useCallback((input: string, options?: Omit<OpenUrlDetail, 'url'>) => openChromium(input, { newTab: options?.newTab, more: options?.more }), [openChromium])

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const { url, newTab, more } = (e as CustomEvent<OpenUrlDetail>).detail ?? {}
      if (url) openInBrowser(url, { newTab, more })
    }
    window.addEventListener(OPEN_URL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_URL_EVENT, onOpen)
  }, [openInBrowser])

  // "Open" on a card in the conversation: the Create screen, with that artifact open on it.
  useEffect(() => {
    const onOpen = (e: Event): void => {
      const artifactId = (e as CustomEvent<OpenArtifactDetail>).detail?.artifactId
      if (typeof artifactId !== 'string' || artifactId === '') return
      setCreateOpenAt({ artifactId, token: Date.now() })
      void openFeature('create')
    }
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen)
  }, [])

  // The browser's search page asking for one of these: the same route a card's "Open" takes, so one screen switch.
  useEffect(() => window.api.onOpenArtifact((artifactId) => openArtifact(artifactId)), [])

  useControlRendered()
  // Answers questions about what is on screen even while no screen has registered, so "nothing is registered" comes
  // back as that rather than as the window not answering at all.
  useSurfaceBridge()

  const [editing, setEditing] = useState<{ conversationId: string | null; image: EditableImage; tool?: 'markup' } | null>(null)
  const openImageEditor = useCallback((image: EditableImage) => setEditing({ conversationId: activeId, image }), [activeId])

  const addImageToChat = useCallback(
    (conversationId: string | null, image: EditableImage): boolean => {
      const conversation = conversationId ? conversationsRef.current.find((c) => c.id === conversationId) : undefined
      if (!conversation) {
        notify(conversationId ? "That chat no longer exists, so the image can't be added. Download it instead." : 'Open or start a chat to add this image, or download it instead.', 'warn')
        return false
      }
      if (streamsRef.current[conversation.id]) {
        notify('Wait for the current reply to finish, then save the image.', 'warn')
        return false
      }
      const now = Date.now()
      const message: ChatMessage = { id: newId(), role: 'assistant', content: imageMarkdown(image), model: conversation.model, createdAt: now }
      updateConversation(conversation.id, (c) => ({ ...c, messages: [...c.messages, message], updatedAt: now }))
      persist(conversation.id)
      return true
    },
    [notify, persist, updateConversation]
  )

  /** Slash commands from the message box, e.g. "/clear" or "/model max". */
  const runCommand = useCallback(
    (name: string, args: string) => {
      const conversation = activeId ? conversationsRef.current.find((c) => c.id === activeId) : undefined
      const lastReply = conversation && [...conversation.messages].reverse().find((m) => m.role === 'assistant' && m.content.trim())
      const busy = Boolean(conversation && streamsRef.current[conversation.id])
      const needChat = (): void => notify('Start a chat first.', 'warn')
      const shortName = (label: string): string => label.toLowerCase().replace(/^orion\s+/, '')

      switch (name) {
        case 'new':
          return freshChat()
        case 'clear':
          if (!conversation || conversation.messages.length === 0) return notify('This chat is already empty.')
          clearConversation(conversation.id)
          return notify('Chat cleared.')
        case 'imagine':
          send(`/imagine ${args}`, [])
          return
        case 'browse':
          send(`/browse ${args}`, [])
          return
        case 'web':
          return toggleWebSearch()
        case 'model': {
          const wanted = shortName(args.trim())
          const model = MODELS.find((m) => shortName(m.label) === wanted || m.id.toLowerCase() === wanted) ?? MODELS.find((m) => shortName(m.label).startsWith(wanted))
          if (!model) return notify(`There's no model called "${args}". Try ${MODELS.map((m) => shortName(m.label)).join(', ')}.`, 'warn')
          changeModel(model.id)
          return notify(`Switched to ${model.label}.`)
        }
        case 'regenerate':
          if (!conversation || !lastReply) return notify('There is no reply to regenerate yet.', 'warn')
          if (busy) return notify('Wait for the current reply to finish first.', 'warn')
          return regenerate(conversation.id, lastReply.id)
        case 'stop':
          if (!conversation || !busy) return notify("Orbis isn't replying right now.")
          return stop(conversation.id)
        case 'copy':
          if (!lastReply) return notify('There is no reply to copy yet.', 'warn')
          void copyText(lastReply.content).then(() => notify('Last reply copied.'))
          return
        case 'summarize':
          if (!conversation?.messages.length) return notify('There is nothing to summarize yet.', 'warn')
          send('Summarize our conversation so far in a few short bullet points.', [])
          return
        case 'translate':
          if (!lastReply) return notify('There is no reply to translate yet.', 'warn')
          send(`Translate your last reply into ${args}.`, [])
          return
        case 'rename':
          if (!conversation) return needChat()
          renameConversation(conversation.id, args)
          return notify(`Chat renamed to "${args.trim()}".`)
        case 'share':
          if (!conversation) return needChat()
          return shareConversation(conversation.id)
        case 'delete':
          if (!conversation) return needChat()
          deleteConversation(conversation.id)
          return notify('Chat deleted.')
        case 'incognito':
          return toggleIncognito()
        case 'search':
          return openSearch()
        case 'create':
          // Opens the Create screen; with words after it, hands them over to be made straight away.
          if (args.trim() !== '') setCreateAsked({ text: args.trim(), token: Date.now() })
          return void openFeature('create')
        case 'images':
          return go({ kind: 'images' })
        case 'study':
          return void openFeature('student')
        case 'courses':
          return void openFeature('courses')
        case 'toolkit':
          return void openFeature('toolkit')
        case 'eye':
          return void openFeature('eye')
        case 'cosmos':
          return void openFeature('cosmos')
        case 'arcade':
          return void openFeature('arcade')
        case 'arena':
          return void openFeature('arena')
        case 'f1':
          return void openFeature('f1')
        case 'football':
          return void openFeature('football')
        case 'focus': {
          /*
           * `/focus` opens Student; `/focus 25` starts twenty-five minutes there and then.
           *
           * A number is the only thing this takes. Anything else opens the screen rather than guessing, because a
           * session started by mistake is somebody's twenty-five minutes.
           */
          void openFeature('student')
          const minutes = Number(args.trim())
          if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 600) {
            void window.api
              .student('start-focus', { minutes: Math.round(minutes), title: 'Focus' })
              .then((out) => {
                const said = out as { ok?: boolean; why?: string } | null
                if (said && said.ok === false) notify(said.why ?? 'That session could not be started.', 'warn')
              })
              .catch(() => notify('That session could not be started.', 'warn'))
          }
          return
        }
        case 'browser':
          return toggleBrowser()
        case 'theme':
          void updateSettings({ theme: dark ? 'light' : 'dark' })
          return
        case 'settings':
          return setSettingsOpen(true)
        case 'shortcuts':
        case 'help':
          return setShortcutsOpen(true)
      }
    },
    [
      activeId,
      changeModel,
      clearConversation,
      dark,
      deleteConversation,
      freshChat,
      notify,
      openSearch,
      regenerate,
      renameConversation,
      send,
      shareConversation,
      stop,
      toggleBrowser,
      toggleIncognito,
      toggleWebSearch,
      updateSettings
    ]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (welcome !== 'closed' || (!e.ctrlKey && !e.metaKey)) return
      const key = e.key.toLowerCase()
      if (e.shiftKey && key === 'o') {
        e.preventDefault()
        freshChat()
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault()
        toggleIncognito()
      } else if (key === ',') {
        e.preventDefault()
        // Named rather than left to the default, so that whichever section Settings happens to open at first can
        // change without quietly changing where this shortcut lands.
        setSettingsAt('account')
      } else if (e.shiftKey && key === 'b') {
        /*
         * The browser, which the sidebar has been advertising this chord for all along without anything registering
         * it. Worse than nothing: `Ctrl+B` below had no shift guard, so pressing what the label said opened the
         * *sidebar*. A label that does the wrong thing is harder to recover from than one that does nothing.
         */
        e.preventDefault()
        toggleBrowser()
      } else if (key === 'b' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        toggleSidebar()
      } else if (key === 'e' && !e.shiftKey && !e.altKey) {
        // Ctrl+E: straight to the address bar, from anywhere in Orbis (inside the browser the shortcut table does it).
        e.preventDefault()
        window.dispatchEvent(new Event('orbis:focus-url'))
      } else if (key === 'k' && !e.shiftKey && !e.altKey) {
        // Everything Orbis can do. Web pages keep their own Ctrl+K: this only reaches the Orbis window.
        e.preventDefault()
        setPaletteOpen(true)
      } else if (e.shiftKey && key === 'f') {
        // The chat search, which Ctrl+K used to be. Moved rather than dropped: it is a different question --
        // "where did I say that" is about this conversation, not about what Orbis can do.
        e.preventDefault()
        openSearch()
      } else if (e.shiftKey && key === 'u') {
        // Student. Ctrl+Shift+F is the browser's find-on-page, so study gets a chord pages do not use.
        // Through the guard: an advertised chord that silently does nothing is worse than no chord at all, so with
        // Student switched off this says that and says how to turn it on.
        e.preventDefault()
        void openFeature('student')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [freshChat, openSearch, toggleBrowser, toggleIncognito, toggleSidebar, welcome])

  /**
   * The native menu, and a question handed in from outside the chat.
   *
   * All three arrive from the main process and all three used to arrive nowhere: `File > New Chat` and
   * `Help > About Orbis` sent a message the window never listened for, so both menu items did nothing at all, and a
   * page asking Orion a question handed it to `chat:ask`, which had no other end. Placed here rather than with the
   * other listeners near the top of this file because it needs the chat hook, which is set up further down.
   */
  useEffect(() => {
    const offNewChat = window.api.onMenuNewChat(() => {
      closeFeature()
      freshChat()
    })
    const offAbout = window.api.onMenuAbout(() => setSettingsOpen('about'))
    const offAsk = window.api.onChatAsk((text) => {
      const asked = text.trim()
      if (asked === '') return
      closeFeature()
      sendRef.current(asked, [])
    })
    return () => {
      offNewChat()
      offAbout()
      offAsk()
    }
  }, [closeFeature, freshChat])

  /*
   * Escape closes whatever screen is open, handled once, here.
   *
   * It was handled nowhere. Five of the ten screens — Pages, Clipboard, Workspaces, Schedules and Notes — had no
   * keyboard way out at all, and the other five each claimed Escape for something of their own, so there was no rule
   * anybody could learn. Pressing it did one of six different things depending on where you happened to be.
   *
   * The rule now: Escape means "out of this". A screen that wants it for something else keeps it by calling
   * `preventDefault`, which is what clearing a search box, cancelling a rename, dropping a selection and stepping
   * back through a course all do. This runs last and does nothing if any of them claimed it.
   *
   * The three guards below are what stop it being annoying rather than useful:
   *  - a popover, menu or modal is open, so Escape belongs to that;
   *  - the keyboard is in a text field with something in it, where Escape usually means "undo what I typed";
   *  - the welcome screen is up, which owns the whole window.
   */
  useEffect(() => {
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (welcome !== 'closed') return
      if (feature === null && !imagesOpen) return

      // Something layered on top owns the key.
      // Unquoted attribute selectors on purpose. The accessibility guard scans for a quoted role attribute and
      // reads one inside a string as a tag with no name; unquoted is valid CSS and says the same thing.
      if (document.querySelector('.popover, .modal, [role=dialog], [role=menu], .na-labs') !== null) return

      const focused = document.activeElement as HTMLElement | null
      if (focused !== null) {
        const tag = focused.tagName
        const typing =
          tag === 'TEXTAREA' ||
          (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button', 'submit'].includes((focused as HTMLInputElement).type)) ||
          focused.isContentEditable
        // Only when there is something to clear: an empty box has nothing to undo, so Escape may still mean "out".
        if (typing && String((focused as HTMLInputElement).value ?? focused.textContent ?? '').length > 0) return
      }

      event.preventDefault()
      go({ kind: 'escape' })
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [feature, imagesOpen, welcome])

  // Push-to-talk: hold Ctrl+Shift+M, speak, let go. Not a new transcription engine — it starts and stops the exact
  // session the chat or Browser Orion microphone button would, and hands the words back to whichever of them it
  // spoke for. Which one that is follows what is actually on screen, the same way Ctrl+E already does for the
  // address bar. A held key repeats its keydown many times a second; the ref below is what makes that one press.
  const pushToTalk = useRef<{ held: boolean; target: 'chat' | 'browser-orion' } | null>(null)
  useEffect(() => {
    const start = (e: KeyboardEvent): void => {
      if (welcome !== 'closed' || !e.ctrlKey || !e.shiftKey || e.key.toLowerCase() !== 'm' || pushToTalk.current) return
      e.preventDefault()
      const target = 'chat'
      pushToTalk.current = { held: true, target }
      window.dispatchEvent(new CustomEvent(PUSH_TO_TALK_EVENT, { detail: { phase: 'start', target } }))
    }
    const stop = (e: KeyboardEvent): void => {
      // Either key going up ends it — holding one and releasing the other should not leave it recording.
      if (!pushToTalk.current || (e.key.toLowerCase() !== 'm' && e.key !== 'Control' && e.key !== 'Shift')) return
      const { target } = pushToTalk.current
      pushToTalk.current = null
      window.dispatchEvent(new CustomEvent(PUSH_TO_TALK_EVENT, { detail: { phase: 'stop', target } }))
    }
    // Losing focus mid-hold (Alt-Tab, say) must not leave the microphone open with nothing to release it.
    const release = (): void => {
      if (!pushToTalk.current) return
      const { target } = pushToTalk.current
      pushToTalk.current = null
      window.dispatchEvent(new CustomEvent(PUSH_TO_TALK_EVENT, { detail: { phase: 'stop', target } }))
    }
    window.addEventListener('keydown', start)
    window.addEventListener('keyup', stop)
    window.addEventListener('blur', release)
    return () => {
      window.removeEventListener('keydown', start)
      window.removeEventListener('keyup', stop)
      window.removeEventListener('blur', release)
    }
  }, [welcome])


  // The floating browser assistant follows the current chat's latest reply: its steps, progress, approvals and summary.
  /**
   * What the browser's assistant is doing, which is its own affair.
   *
   * It used to put what somebody typed into it straight into the open Orbis Chat conversation, so asking the browser
   * to summarise a page left a chat called "Summarize This Page" in the sidebar. The browser assistant and the chat
   * are different places to be, and a question asked in one does not belong to the other.
   *
   * This is a standalone request: no conversation is made, nothing is written to the chat store, and the steps,
   * confirmations and automation state come back on the request itself.
   */
  const savedConversations = useMemo(() => conversations.filter((c) => !c.incognito), [conversations])
  const researchTopics = useMemo(
    () =>
      savedConversations.flatMap((c) =>
        c.messages.flatMap((m) => (m.research && !m.research.reused && m.research.question.trim() ? [{ question: m.research.question.trim(), at: m.research.retrievedAt }] : []))
      ),
    [savedConversations]
  )
  const galleryImages = useMemo(() => collectImages(savedConversations), [savedConversations])
  /**
   * The menu, as this person chose it. Empty categories are already gone, so no heading is left over nothing.
   *
   * Recomputed only when the saved choice changes, which is when somebody moves a switch.
   */
  const featureMenu = useMemo(() => featureGroupsFor(visibility.choice), [visibility.choice])
  /** Chance is the one core surface that is a choice, and it is not one of the screens above. */
  const chanceShown = isVisible('chance', visibility.choice)
  /** The price strip goes with Markets: hiding Markets and still watching Markets is not hiding Markets. */
  const marketsShown = isVisible('markets', visibility.choice)
  /** The browser is on screen: it takes the whole window below the address bar, so none of the chat's own bars are shown. */
  // Settings and the shortcut sheet draw over everything, the browser included: they belong to this window, and a
  // native Chromium window on top of them would hide them outright rather than sit behind the dimming.
  const browserShowing = showingBrowser(nav) && !settingsOpen && !shortcutsOpen

  return (
    <ImageEditorContext.Provider value={openImageEditor}>
    <div
      className={`hud${effects ? ' effects' : ''}${welcome === 'leaving' ? ' hud-entering' : ''}`}
      inert={welcome === 'open'}
    >
      <HudBackground animated={effects} />
      {/* The browser has an address bar of its own, so this row drops its one. The way back to the chat moved onto the
          browser's own toolbar, beside that address bar, where the eye already is; this stays as the window's title
          bar, 36px either way, with the Windows buttons drawn over its right end. */}
      {browserShowing ? (
        /*
          The browser's own window carries the address bar, so this row has none -- but it was left completely
          blank, a 36px band of nothing, and the only sign that pressing Browser had done anything was a separate
          Chromium window somebody could easily miss. It says where you are now, and offers the way back.
        */
        <div className="url-strip">
          <span className="url-strip-where">Browser is open in its own window</span>
          <button type="button" className="text-btn" onClick={toggleBrowser}>
            Return to chat
          </button>
        </div>
      ) : (
        <UrlBar
          onNavigate={openInBrowser}
          research={researchTopics}
          incognito={current.incognito}
          searchSuggestions={settings?.searchSuggestions !== false}
          personalizedSuggestions={settings?.personalizedSuggestions !== false}
          askModel={current.model}
          onNotify={notify}
          onOpenWorkflows={() => openOrbisView('workflows')}
        />
      )}
      {/* The strip belongs to the chat. Files, Chance and the feature screens bring their own header and their own way back. */}
      {!browserShowing && !imagesOpen && !chanceOpen && !feature && (
        <SystemBar
          browserRunning={browserRunning}
          onShowBrowser={() => openChromium('', { newTab: false })}
          dark={dark}
          unread={unread}
          onToggleHistory={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
          webSearch={webSearch}
          onToggleWebSearch={toggleWebSearch}
          onToggleActivity={toggleActivity}
          onToggleTheme={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
        >
          <ChatHeader
            conversationId={active?.id ?? null}
            onNotify={notify}
            title={active?.title ?? 'New chat'}
            hasConversation={Boolean(active)}
            thinking={Boolean(active && streams[active.id])}
            incognito={current.incognito}
            onToggleIncognito={toggleIncognito}
            // Search Labs moved here from the composer, so the header is what opens a Native App now.
            onOpenApp={openNativeApp}
            onRename={(title) => active && renameConversation(active.id, title)}
            onShare={() => active && shareConversation(active.id)}
            onExport={(kind) => {
              if (!active || !settings) return
              const names = { user: settings.userName, assistant: settings.assistantName }
              const msgs = active.messages.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments?.map((a) => ({ name: a.name })) }))
              const text = kind === 'md' ? chatMarkdown(active.title, msgs, names) : chatHtml(active.title, msgs, names, new Date().toLocaleString())
              void window.api.exportChat(kind, active.title, text).then((r) => notify(r.ok ? `Saved to ${r.path}` : r.message ?? 'That could not be saved.', r.ok ? undefined : 'error'))
            }}
            onDelete={() => active && deleteConversation(active.id)}
          />
          {/*
            * What Orbis has worked out you are doing.
            *
            * The whole visible surface of Ambient Intelligence, and absent far more often than present: it draws
            * nothing at all unless Orbis is confident enough to be useful.
            */}
          <ContextChip
            onAsk={(about) => {
              // Straight into the chat, the same way every other part of Orbis asks Orion something.
              closeFeature()
              sendRef.current(`What should I know about ${about}?`, [])
            }}
          />
        </SystemBar>
      )}

      <div className="hud-body">
        <Sidebar
          onArchive={archiveConversation}
          onNotify={notify}
          collapsed={sidebarCollapsed}
          conversations={savedConversations}
          activeId={activeId}
          incognito={current.incognito}
          streams={streams}
          imageCount={galleryImages.length}
          imagesOpen={imagesOpen}
          chanceOpen={chanceOpen}
          features={featureMenu}
          chanceShown={chanceShown}
          // Chance is a choice, so the row is not there when it is off -- and this says so anyway, because a
          // notification or a schedule can ask for it without going past the menu.
          onChance={() => {
            if (!chanceShown) return notify(`${describeVisibility('chance', visibility.choice)} Press Ctrl+K and type its name to turn it back on.`, 'warn')
            setChanceOpen((open) => !open)
          }}
          feature={feature}
          // Pressing the row you are already on still folds it away; anything else goes through the one guard.
          onFeature={(id) => (id === feature ? go({ kind: 'toggleFeature', id }) : void openFeature(id))}
          searchToken={searchToken}
          userName={settings?.userName ?? 'You'}
          userAvatar={settings?.userAvatar ?? DEFAULT_AVATAR}
          userTitle={settings?.userTitle ?? ''}
          onNewChat={freshChat}
          onIncognito={toggleIncognito}
          onSearch={openSearch}
          onImages={() => { setChanceOpen(false); setFilesTool(undefined); go({ kind: 'toggleImages' }) }}
          onBrowser={toggleBrowser}
          browserOpen={browserShowing}
          onSelect={selectChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
          onTogglePin={togglePin}
          onSettings={(section) => setSettingsAt(section ?? DEFAULT_SETTINGS_SECTION)}
          onHelp={() => setShortcutsOpen(true)}
        />

        <main className="stage">
          <ChatView
            key={`${activeId ?? 'new'}:${chatEpoch}`}
            conversation={active}
            stream={active ? streams[active.id] : undefined}
            settings={settings}
            loaded={loaded}
            model={current.model}
            incognito={current.incognito}
            visibility={visibility.choice}
            quickPromptsOpen={quickPromptsOpen}
            onQuickPromptsChange={setQuickPromptsOpen}
            onModelChange={changeModel}
            onSend={send}
            onCommand={runCommand}
            onBrowserConfirm={answerBrowserConfirmation}
            onAutomationControl={controlAutomation}
            queue={active ? queues[active.id] : undefined}
            onRemoveQueued={(itemId) => active && removeQueued(active.id, itemId)}
            onClearQueue={() => active && clearQueue(active.id)}
            onResumeQueue={() => active && resumeQueue(active.id)}
            onStop={() => active && stop(active.id)}
            onRegenerate={(messageId) => active && regenerate(active.id, messageId)}
            onEdit={(messageId, text) => active && editMessage(active.id, messageId, text)}
            onResend={(messageId) => active && resendFrom(active.id, messageId)}
            onFeedback={(messageId, feedback) => active && setFeedback(active.id, messageId, feedback)}
            onDecisionChange={changeDecision}
            onDecisionExplain={explainDecision}
            onDecisionKeep={keepDecision}
            onQuizChange={(messageId, next) => active && setQuiz(active.id, messageId, next)}
            onQuizRetry={(next) => active && addReply(active.id, '', { quiz: next })}
            onNotify={notify}
            onImprovePrompt={improvePrompt}
            onNewChat={freshChat}
            onSearch={openSearch}
            onOpenApp={openNativeApp}
            onUseBranch={(branchId) => active && useBranch(active.id, branchId)}
            onForgetBranch={(branchId) => active && forgetBranch(active.id, branchId)}
          />
          {imagesOpen && (
            <ImagesAndFilesView images={galleryImages} openTool={filesTool} onClose={() => { setFilesTool(undefined); go({ kind: 'chat' }) }} onOpenChat={selectChat} onEdit={editGalleryImage} onNotify={notify} />
          )}
          {feature && (
            <Suspense fallback={<div className="feature-loading" role="status">Opening…</div>}>
              {feature === 'pages' && <PagesView onClose={closeFeature} onNotify={notify} landOn={scheduledPage} />}
              {feature === 'markets' && <MarketsView onClose={closeFeature} onNotify={notify} />}
              {feature === 'whiteboard' && <WhiteboardView onClose={closeFeature} onNotify={notify} />}
              {feature === 'chess' && <ChessView onClose={closeFeature} onNotify={notify} />}
              {feature === 'neurova' && <NeurovaView onClose={closeFeature} onNotify={notify} />}
              {/*
                * Orbis Student.
                *
                * Handed the three things it cannot do itself: a way to say something, a way to open a page in the
                * browser, and a way to put a question to Orion. Everything else it owns.
                */}
              {feature === 'student' && (
                <StudentView
                  onClose={closeFeature}
                  onNotify={notify}
                  onOpenUrl={(url) => openChromium(url, { newTab: true })}
                  onOpenOrion={(prompt) => {
                    closeFeature()
                    sendRef.current(prompt, [])
                  }}
                />
              )}
              {feature === 'labs' && <LabsView onClose={closeFeature} onNotify={notify} onOpenApp={openNativeApp} openInConversation={labsOpenHere} />}
              {feature === 'courses' && <CoursesView onClose={closeFeature} onNotify={notify} onOpenApp={openNativeApp} />}
              {feature === 'toolkit' && <ToolkitView onClose={closeFeature} />}
              {feature === 'eye' && <EyeView onClose={closeFeature} />}
              {feature === 'cosmos' && <CosmosView onClose={closeFeature} />}
              {feature === 'arcade' && <OfflineGames onClose={closeFeature} />}
              {feature === 'arena' && (
                <ArenaView
                  onClose={closeFeature}
                  onOpen={(id) => {
                    fromArena.current = id
                    void openFeature(id)
                  }}
                />
              )}
              {feature === 'f1' && <F1View onClose={closeFeature} />}
              {feature === 'football' && <FootballView onClose={closeFeature} />}
              {feature === 'clipboard' && <ClipboardView onClose={closeFeature} onNotify={notify} />}
              {feature === 'workspaces' && <WorkspacesView onClose={closeFeature} onNotify={notify} />}
              {feature === 'schedules' && <SchedulesView onClose={closeFeature} onNotify={notify} />}
              {feature === 'notes' && <MeetingView onClose={closeFeature} onNotify={notify} />}
              {feature === 'create' && <CreateView onClose={closeFeature} onNotify={notify} asked={createAsked} openAt={createOpenAt} />}
            </Suspense>
          )}
        </main>


        <button className="edge-handle" title="Activity" onClick={toggleActivity}>
          <span />
        </button>
        {/* What Orbis was partway through when it last closed. Shows nothing when there is nothing. */}
        <UnfinishedRuns onOpen={selectChat} />
        {activityOpen && <ActivityPanel items={notices} onClear={() => setNotices([])} onClose={() => setActivityOpen(false)} />}
        {/* Outside .stage on purpose: the browser fills everything below the title bar, sidebar included. */}
        {browserOpen && <BrowserView hidden={!browserShowing} />}
      </div>

      {/*
        The market strip, outside the screen switch on purpose.

        It is a band that belongs to the window rather than to Markets, so it stays put through a conversation, a Page,
        Notes, Settings and the browser -- which is the whole point of it. A price is something to keep in the corner of
        your eye while doing something else, and a strip you have to open Markets to see is one you will never look at.

        Not during startup or behind a lock: a ticker animating over a lock screen would be both a waste and a leak.

        And not while the browser fills the window, because the browser draws its own band along its own bottom edge --
        the same strip, from the same setting, a few pixels lower. Two of them stacked would be one too many, and the
        browser's is the one that belongs to what is on screen.
      */}
      {/*
        And not when Markets is switched off. The strip IS Markets, a few pixels high: leaving it along the bottom of
        somebody who took Markets out of their menu would be the "never claim a thing is on when it is off" rule
        broken in the most visible place in the window.
      */}
      <MarketStrip suppressed={welcome !== 'closed' || browserShowing || !marketsShown} />

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
      <ControlPrompts />
      {/*
        What the window itself lets Orbis do, and what the conversation lets Orbis do while the conversation is the
        thing in front of somebody. Draws nothing: every value below is read from what this component already holds,
        and every setter is the handler one of its own buttons already calls.

        The conversation is handed over only while it is what is on screen. It stays mounted behind a module, so
        registering it regardless would tell Orbis the conversation was in front while Chess World covered it.
      */}
      <ShellSurfacePoints
        shell={{
          nav: () => navLive.current,
          show: showScreen,
          browserRunning: () => browserRunning,
          sidebar: () => !sidebarCollapsed,
          setSidebar: (open) => setSidebarCollapsed(!open),
          settings: () => settingsAt,
          openSettings: (section) => setSettingsAt(section === null ? null : (section as SettingsSectionId)),
          activity: () => activityOpen,
          setActivity: (open) => {
            setActivityOpen(open)
            if (open) setUnread(0)
          },
          activityCount: () => ({ total: noticesLive.current.length, unread }),
          clearActivity: () => setNotices([]),
          palette: () => paletteOpen,
          setPalette: setPaletteOpen,
          shortcuts: () => shortcutsOpen,
          setShortcuts: setShortcutsOpen,
          back: () => go({ kind: 'escape' }),
          chats: () => savedConversations.length
        }}
        chat={
          feature === null && !imagesOpen && !browserShowing
            ? {
                model: () => current.model,
                setModel: changeModel,
                incognito: () => current.incognito,
                // The switch starts a new unsaved chat rather than taking a value, so this asks for it only when it
                // would really change something -- the same thing pressing it twice would do.
                setIncognito: (on) => {
                  if (on !== current.incognito) toggleIncognito()
                },
                webSearch: () => webSearch,
                setWebSearch: (on) => {
                  if (on !== webSearch) toggleWebSearch()
                },
                // From the list the window really holds, not from what was drawn: an action is checked the moment it
                // has run.
                open: () => {
                  const id = activeLive.current
                  const one = id ? conversationsRef.current.find((c) => c.id === id) : undefined
                  return one ? { id: one.id, title: one.title, messages: one.messages.length, replying: Boolean(streamsRef.current[one.id]) } : null
                },
                covered: () => settingsOpen || shortcutsOpen || chanceOpen || paletteOpen || editing !== null,
                newChat: freshChat,
                rename: (title) => {
                  const id = activeLive.current
                  if (id) renameConversation(id, title)
                },
                clear: () => {
                  const id = activeLive.current
                  if (id) clearConversation(id)
                },
                stop: () => {
                  const id = activeLive.current
                  if (id) stop(id)
                },
                find: openSearch,
                chats: () => savedConversations.length
              }
            : null
        }
      />
      {settingsAt && settings && (
        <SettingsModal
          settings={settings}
          // The window's own copy, so the Features section and the menu down the side cannot disagree about what is on.
          visibility={visibility}
          section={settingsAt}
          onUpdate={updateSettings}
          // Which section is showing, kept here as well, so the window and the dialog cannot hold two different
          // answers to "where in Settings are we" -- and so what Orbis reads from the window is the real one.
          onSection={rememberSection}
          onClose={() => setSettingsAt(null)}
          onOpenFiles={(tool) => { setSettingsAt(null); setFilesTool(tool); go({ kind: 'images' }) }}
        />
      )}
      {chanceOpen && chanceShown && <ChanceView onClose={() => setChanceOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal visibility={visibility.choice} onClose={() => setShortcutsOpen(false)} />}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        // One surface at a time, and through the one guard: a screen opened from here replaces whatever was
        // showing rather than landing on top of the image gallery or behind the browser.
        onFeature={(id) => void openFeature(id)}
        onBrowser={() => go({ kind: 'browser' })}
        // Found something that is switched off: turn it on and go there, in one press. This is the whole route by
        // which somebody discovers a screen they did not pick, so it has to really switch it on rather than send
        // them off to look for a settings page.
        onTurnOn={(id) => void turnFeatureOn(id)}
        visibility={visibility.choice}
        // `window: true`: this IS the window, so every screen it has is reachable from here. Without it the
        // palette read every capability's `needs` -- which describe what the BROWSER side requires -- and offered
        // "Whiteboard -- Orbis is not running" to somebody looking at Orbis.
        // `task` is whether Orion could act in the browser, which from here means the same as the browser being
        // open: with it closed there is nothing to act in, and with it open the browser's own panel decides.
        ready={{ window: true, browser: browserOpen, task: browserOpen, helper: browserOpen, key: true, page: browserOpen && !browserHidden }}
      />
      {/*
        Offered the first time a microphone is pressed with no model installed. Raised by the voice service rather
        than by any one microphone, because there are four of them and each would otherwise need to know about this.
      */}
      {pulsarSetup && (
        <Suspense fallback={null}>
          <PulsarSetup onClose={() => setPulsarSetup(false)} onReady={() => setPulsarSetup(false)} onNotify={notify} />
        </Suspense>
      )}
      {editing && (
        <ImageEditor
          key={editing.image.src.slice(-64)}
          image={editing.image}
          onClose={() => setEditing(null)}
          onSave={(image) => addImageToChat(editing.conversationId, image)}
          onNotify={notify}
          initialTool={editing.tool}
        />
      )}
    </div>
    {welcome !== 'closed' && (
      <WelcomeExperience
        ready={loaded && accountChecked}
        needsName={needsName}
        loadError={loadError}
        effects={effects}
        onRetryLoad={load}
        needsUnlock={needsUnlock}
        lockedReason={lockedReason}
        onComplete={completeWelcome}
        onChooseFeatures={chooseWelcomeFeatures}
        onUnlock={unlockAccount}
        onEnter={enterFromWelcome}
        onFinished={finishWelcome}
      />
    )}    </ImageEditorContext.Provider>
  )
}
