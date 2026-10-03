import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, ChatMessage, ChatRequest, Conversation, Settings, SettingsUpdate, StreamEvent } from '../../shared/types'
import { isRefusal } from '../../shared/account'
import { IMAGE_GEN_STATUS, isArtifactStatus } from '../../shared/types'
import { themeBase } from '../../shared/themes'
import { DEFAULT_MODEL, MODELS, isKnownModel, modelLabel } from '../../shared/models'
import { AUTO_MODEL } from '../../shared/modelRoute'
import { automationActive } from '../../shared/automation'
import { PUSH_TO_TALK_EVENT } from '../../shared/voiceInput'
import { copyText, newId, titleFromMessage } from './lib/utils'
import ChatHeader from './components/ChatHeader'
import ChatView from './components/ChatView'
import BrowserView from './components/BrowserView'
import MarketStrip from './components/MarketStrip'
import ImagesView from './components/ImagesView'
import { useExperience } from './lib/experience'
import HudBackground from './components/HudBackground'
import Sidebar from './components/Sidebar'
import UnfinishedRuns from './components/UnfinishedRuns'
import type { FeatureId } from './components/Sidebar'
import { DEFAULT_SETTINGS_SECTION, type SettingsSectionId } from '../../shared/settingsSections'
import { destinationFor } from '../../shared/notificationRoute'
import { dropBranch, parkTail, switchToBranch } from '../../shared/conversationBranch'
// Orbis's own screens. Each was finished and unreachable: nothing imported them, so no amount of looking would have
// found them. They are loaded lazily because only one is ever open and most sessions open none.
// Lazy like the rest: the chart and its indicators are a large bundle for a screen most sessions never open.
const MarketsView = lazy(() => import('./components/MarketsView'))
const PulsarSetup = lazy(() => import('./components/PulsarSetup'))
const WhiteboardView = lazy(() => import('./components/WhiteboardView'))
const PagesView = lazy(() => import('./components/PagesView'))
const CreateView = lazy(() => import('./components/CreateView'))
const ClipboardView = lazy(() => import('./components/ClipboardView'))
const WorkspacesView = lazy(() => import('./components/WorkspacesView'))
const SchedulesView = lazy(() => import('./components/SchedulesView'))
import { ActivityPanel, ShortcutsModal, ToastStack } from './components/Overlays'
import SettingsModal from './components/SettingsModal'
import WelcomeExperience from './components/WelcomeExperience'
import UrlBar from './components/UrlBar'
import ControlPrompts from './components/ControlPrompts'
import { useControlRendered } from './lib/browserControl'
import { OPEN_URL_EVENT } from './lib/openInBrowser'
import { OPEN_ARTIFACT_EVENT, artifactChanged, openArtifact, type OpenArtifactDetail } from './lib/artifactEvents'
import type { OpenUrlDetail } from './lib/openInBrowser'
import SystemBar from './components/SystemBar'
import ImageEditor from './components/ImageEditor'
import { ImageEditorContext, collectImages, imageMarkdown } from './lib/imageEditor'
import type { EditableImage, GalleryImage } from './lib/imageEditor'
import { MAX_QUEUED_MESSAGES } from './lib/messageQueue'
import type { ChatQueue } from './lib/messageQueue'

export interface StreamState {
  requestId: string
  messageId: string
  /** Rate-limit / fallback notices from the main process. */
  status?: string
}

export type NoticeKind = 'info' | 'warn' | 'error'

export interface Notice {
  id: string
  text: string
  kind: NoticeKind
  at: number
}

interface PendingDelta {
  conversationId: string
  content: string
  reasoning: string
  reasoningMs?: number
}

interface DraftChat {
  incognito: boolean
  model: string
}

const COUNTDOWN = /Retrying in \d+s/

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftChat>({ model: DEFAULT_MODEL, incognito: false })
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
  const [imagesOpen, setImagesOpen] = useState(false)
  /** Which of Orbis's own screens is open, or null for the chat. Only ever one. */
  const [feature, setFeature] = useState<FeatureId | null>(null)
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
      setImagesOpen(false)
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
  const settingsOpen = settingsAt !== null
  const setSettingsOpen = (open: boolean | SettingsSectionId): void =>
    setSettingsAt(open === false ? null : open === true ? DEFAULT_SETTINGS_SECTION : open)
  /**
   * Opening the browser.
   *
   * It fills the content area, always. It used to be a window that could be docked, shrunk to a preset or dragged to
   * a size, which meant five ways to be looking at a browser and four of them worse than the fifth.
   */
  // Orbis's browser is Chromium. Its window sits inside this window, over the browser view (the old full-page mode): opening the
  // browser shows the view, "Return to chat" hides it and Chromium keeps running with its tabs.
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserHidden, setBrowserHidden] = useState(false)
  /**
   * Whether the browser is running at all, which is not whether it is in front.
   *
   * As its own window it goes on running while the chat is being used -- that is what lets coming back to it keep
   * every tab. The chat says so while it is true and says nothing when it is not.
   */
  const [browserRunning, setBrowserRunning] = useState(false)
  const browserLive = useRef({ open: false, hidden: false })
  browserLive.current = { open: browserOpen, hidden: browserHidden }
  const notifyRef = useRef<(text: string, kind?: NoticeKind) => void>(() => undefined)
  const openChromium = useCallback((input: string, options?: { newTab?: boolean; more?: string[] }) => {
    setBrowserOpen(true)
    setBrowserHidden(false)
    void window.api.chromiumOpen(input, options).then((result) => {
      if (!result.ok) notifyRef.current(result.detail, 'error')
    })
  }, [])
  const openBrowser = useCallback(() => openChromium(''), [openChromium])
  /** Sidebar and /browser: show the browser, or go back to the chat when it is already showing. */
  const toggleBrowser = useCallback(() => {
    const { open, hidden } = browserLive.current
    if (open && !hidden) {
      setBrowserHidden(true)
      // The browser is its own window now, so hiding it is this process's job and not something the renderer can do
      // by collapsing a view. Without this there was no way back to the chat except through the browser's own toolbar.
      void window.api.chromiumReturnToChat()
    }
    else if (open) {
      setBrowserHidden(false)
      void window.api.chromiumOpen('', { newTab: false })
    } else openChromium('')
  }, [openChromium])
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
  useEffect(() => {
    return window.api.onNotificationOpen((what) => {
      const where = destinationFor(what.event, what.subject)
      switch (where.kind) {
        case 'feature':
          setImagesOpen(false)
          setSettingsAt(null)
          setFeature(where.id as FeatureId)
          if (where.id === 'create' && where.focus) setCreateOpenAt({ artifactId: where.focus, token: Date.now() })
          return
        case 'settings':
          setSettingsAt(where.section)
          return
        case 'chat':
          setImagesOpen(false)
          setSettingsAt(null)
          setFeature(null)
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
      setBrowserOpen(true)
      setBrowserHidden(false)
    })
    const offHide = window.api.onChromiumHide(() => setBrowserHidden(true))
    const offRunning = window.api.onChromiumRunning((running) => setBrowserRunning(running))
    const offClosed = window.api.onChromiumClosed(() => {
      setBrowserOpen(false)
      setBrowserHidden(false)
    })
    return () => {
      offShow()
      offHide()
      offRunning()
      offClosed()
    }
  }, [])

  /** Which model and mode the user is on, read when a task starts rather than captured before there is one. */
  const currentRef = useRef<DraftChat>({ model: DEFAULT_MODEL, incognito: false })


  /** Latest state of each running browser automation, by chat request, for the browser banner. */
  const [, setAutomations] = useState<Record<string, NonNullable<ChatMessage['automation']>>>({})
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  /** Shown when a microphone is pressed and Pulsar has no model yet. Raised by the voice service, not by a button. */
  const [pulsarSetup, setPulsarSetup] = useState(false)

  useEffect(() => {
    const open = (): void => setPulsarSetup(true)
    window.addEventListener('orbis:pulsar-needed', open)
    return () => window.removeEventListener('orbis:pulsar-needed', open)
  }, [])
  const [quickPromptsOpen, setQuickPromptsOpen] = useState(false)
  const [notices, setNotices] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)
  const [toasts, setToasts] = useState<Notice[]>([])
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  // Refs mirror state synchronously so stream callbacks never read stale data.
  const conversationsRef = useRef<Conversation[]>([])
  const streamsRef = useRef<Record<string, StreamState>>({})
  const pendingRef = useRef(new Map<string, PendingDelta>())
  const frameRef = useRef<number | null>(null)
  const activityOpenRef = useRef(false)

  useEffect(() => {
    activityOpenRef.current = activityOpen
  }, [activityOpen])

  const commitConversations = useCallback((next: Conversation[]) => {
    conversationsRef.current = next
    setConversations(next)
  }, [])

  const commitStreams = useCallback((fn: (s: Record<string, StreamState>) => Record<string, StreamState>) => {
    streamsRef.current = fn(streamsRef.current)
    setStreams(streamsRef.current)
  }, [])

  const updateConversation = useCallback(
    (id: string, fn: (c: Conversation) => Conversation) => {
      commitConversations(conversationsRef.current.map((c) => (c.id === id ? fn(c) : c)))
    },
    [commitConversations]
  )

  const persist = useCallback((id: string) => {
    const conversation = conversationsRef.current.find((c) => c.id === id)
    if (conversation && !conversation.incognito) void window.api.saveConversation(conversation)
  }, [])

  const notify = useCallback((text: string, kind: NoticeKind = 'info') => {
    const toast = { id: newId(), text, kind, at: Date.now() }
    setToasts((current) => [...current.slice(-3), toast])
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== toast.id)), kind === 'info' ? 3000 : 5000)
  }, [])
  notifyRef.current = notify

  const logActivity = useCallback((text: string, kind: NoticeKind) => {
    setNotices((current) => [...current.slice(-49), { id: newId(), text, kind, at: Date.now() }])
    if (!activityOpenRef.current) setUnread((n) => n + 1)
  }, [])

  // Another profile's conversations: the list is read again, and a chat from the old profile is never left open.
  useEffect(
    () =>
      window.api.onConversationsReload(() => {
        void window.api.listConversations().then((list) => {
          commitConversations(list)
          setActiveId((current) => (current && list.some((c) => c.id === current) ? current : null))
        })
      }),
    [commitConversations]
  )

  const load = useCallback(() => {
    Promise.all([window.api.getSettings(), window.api.listConversations()]).then(
      ([s, list]) => {
        setSettings(s)
        setDraft((d) => ({ ...d, model: isKnownModel(s.defaultModel) ? s.defaultModel : DEFAULT_MODEL }))
        commitConversations(list)
        // A blank saved name means setup never really finished.
        setNeedsName(!s.welcomeCompleted || !s.userName.trim())
        // Asked separately, because an account's password is not a setting: it lives with the profile, and the answer
        // comes from the process that holds it.
        void window.api
          .accountStatus()
          .then((status) => {
            if (!isRefusal(status)) setNeedsUnlock(status.hasPassword && !status.unlocked)
          })
          // A refusal or a failure leaves `needsUnlock` false, which is the state an account with no password is in.
          // That is the right way to fail: an account that cannot be asked about is not one this can lock somebody out
          // of, and the main process refuses every protected operation on its own anyway.
          .finally(() => setAccountChecked(true))
        setLoadError(false)
        setLoaded(true)
      },
      () => setLoadError(true)
    )
  }, [commitConversations])

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
        setFeature('pages')
        setImagesOpen(false)
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

  /** Applies buffered stream text once per animation frame instead of once per token. */
  const flushDeltas = useCallback(() => {
    frameRef.current = null
    const pending = pendingRef.current
    if (!pending.size) return
    pendingRef.current = new Map()
    let next = conversationsRef.current
    for (const [messageId, d] of pending) {
      next = next.map((c) =>
        c.id !== d.conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id !== messageId
                  ? m
                  : {
                      ...m,
                      content: m.content + d.content,
                      reasoning: d.reasoning ? (m.reasoning ?? '') + d.reasoning : m.reasoning,
                      reasoningMs: m.reasoningMs ?? d.reasoningMs
                    }
              )
            }
      )
    }
    commitConversations(next)
  }, [commitConversations])

  const queueDelta = useCallback(
    (conversationId: string, messageId: string, content: string, reasoning: string, reasoningMs?: number) => {
      const entry = pendingRef.current.get(messageId) ?? { conversationId, content: '', reasoning: '' }
      entry.content += content
      entry.reasoning += reasoning
      if (reasoningMs !== undefined) entry.reasoningMs = reasoningMs
      pendingRef.current.set(messageId, entry)
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(flushDeltas)
    },
    [flushDeltas]
  )

  const [queues, setQueues] = useState<Record<string, ChatQueue>>({})
  const queuesRef = useRef<Record<string, ChatQueue>>({})
  const commitQueues = useCallback((fn: (q: Record<string, ChatQueue>) => Record<string, ChatQueue>) => {
    queuesRef.current = fn(queuesRef.current)
    setQueues(queuesRef.current)
  }, [])
  // Assigned once the queue runner exists below; startGeneration reports each finished reply through it.
  const settleQueueRef = useRef<(conversationId: string, outcome: 'done' | 'stopped' | 'error') => void>(() => undefined)

  // Suggestions are optional extras: fetched after a reply completes and silently skipped on any failure.
  const requestSuggestions = useCallback(
    async (conversationId: string, messageId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      const index = conversation ? conversation.messages.findIndex((m) => m.id === messageId) : -1
      if (!conversation || index < 0) return
      const reply = conversation.messages[index]
      if (reply.error || !reply.content.trim()) return
      const recent = conversation.messages.slice(Math.max(0, index - 5), index + 1).map((m) => ({ role: m.role, content: m.content }))
      try {
        const result = await window.api.suggestFollowups(recent)
        if (!result.followups.length && !result.next) return
        updateConversation(conversationId, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.id === messageId ? { ...m, suggestions: result.followups, prediction: result.next ?? undefined } : m))
        }))
        persist(conversationId)
      } catch {
        // No suggestions this time; the chat works the same without them.
      }
    },
    [persist, updateConversation]
  )

  const startGeneration = useCallback(
    (conversation: Conversation, history: ChatMessage[]) => {
      const conversationId = conversation.id
      const requestId = newId()
      const assistant: ChatMessage = { id: newId(), role: 'assistant', content: '', model: conversation.model, createdAt: Date.now() }
      // The replies this answer takes the place of, when it takes the place of any: their cards go with them, so
      // what those replies made or changed is undone before the question is answered again.
      const replaced = conversation.messages
        .slice(history.length)
        .flatMap((m) => (m.role === 'assistant' ? (m.artifacts ?? []) : []))
        .filter((one) => one.action !== 'shown')
        .map((one) => ({ artifactId: one.ref.artifactId, versionId: one.ref.versionId, version: one.ref.version, action: one.action }))
      updateConversation(conversationId, (c) => ({ ...c, messages: [...history, assistant] }))
      commitStreams((s) => ({ ...s, [conversationId]: { requestId, messageId: assistant.id } }))

      const patchAssistant = (fn: (m: ChatMessage) => ChatMessage): void =>
        updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === assistant.id ? fn(m) : m)) }))
      const setStatus = (status: string | undefined): void =>
        commitStreams((s) => (s[conversationId] ? { ...s, [conversationId]: { ...s[conversationId], status } } : s))

      let thinkStart: number | null = null
      let answered = false
      let finished = false
      let countdownLogged = false

      const finish = (patch?: Partial<ChatMessage>): void => {
        if (finished) return
        finished = true
        unsubscribe()
        flushDeltas()
        setAutomations(({ [requestId]: _ended, ...rest }) => rest)
        patchAssistant((m) => ({
          ...m,
          confirmation: undefined,
          ...patch,
          reasoningMs: m.reasoningMs ?? (thinkStart !== null && m.reasoning ? Date.now() - thinkStart : undefined)
        }))
        commitStreams(({ [conversationId]: _done, ...rest }) => rest)
        persist(conversationId)
      }

      const unsubscribe = window.api.onChatEvent(requestId, (event: StreamEvent) => {
        switch (event.type) {
          case 'start':
            patchAssistant((m) => ({ ...m, model: event.model }))
            if (event.model === conversation.model || conversation.model === AUTO_MODEL) {
              // Auto choosing a model is not a model failing; the reply's own label says which one answered.
              setStatus(undefined)
            } else {
              // The preceding status event already logged the switch.
              setStatus(`${modelLabel(conversation.model)} couldn't take this one, so ${modelLabel(event.model)} is answering.`)
            }
            break
          case 'delta': {
            const now = Date.now()
            let reasoningMs: number | undefined
            if (event.reasoning && thinkStart === null) thinkStart = now
            if (event.content && !answered) {
              answered = true
              if (thinkStart !== null) reasoningMs = now - thinkStart
            }
            queueDelta(conversationId, assistant.id, event.content ?? '', event.reasoning ?? '', reasoningMs)
            break
          }
          case 'status':
            setStatus(event.message)
            // What Orbis is doing right now is progress, not a warning: it is shown beside the reply and not logged.
            if (event.message === IMAGE_GEN_STATUS || isArtifactStatus(event.message)) break
            if (!COUNTDOWN.test(event.message)) {
              logActivity(event.message, 'warn')
            } else if (!countdownLogged) {
              countdownLogged = true
              logActivity('All models are rate-limited. Waiting for the per-minute limit to reset.', 'warn')
            }
            break
          case 'image':
            queueDelta(conversationId, assistant.id, imageMarkdown({ src: event.url, prompt: event.prompt, seed: event.seed }), '', undefined)
            break
          case 'step':
            patchAssistant((m) => {
              const steps = m.steps ?? []
              const known = steps.some((s) => s.id === event.step.id)
              // Long automations keep only their most recent steps; progress lives in the automation state.
              return { ...m, steps: known ? steps.map((s) => (s.id === event.step.id ? event.step : s)) : [...steps, event.step].slice(-200) }
            })
            break
          case 'automation':
            patchAssistant((m) => ({ ...m, automation: event.automation }))
            setAutomations((all) => ({ ...all, [requestId]: event.automation }))
            break
          case 'confirm':
            patchAssistant((m) => ({ ...m, confirmation: event.confirmation }))
            break
          case 'confirm-done':
            patchAssistant((m) => (m.confirmation?.id === event.id ? { ...m, confirmation: undefined } : m))
            break
          case 'research':
            patchAssistant((m) => ({ ...m, research: event.research }))
            break
          case 'artifact': {
            // Only a pointer is kept on the message; the card reads the artifact itself. The same version shown
            // twice in one reply is one card.
            const { artifact } = event
            patchAssistant((m) => ({
              ...m,
              artifacts: [...(m.artifacts ?? []).filter((one) => one.ref.versionId !== artifact.ref.versionId || one.action !== artifact.action), artifact].slice(-12)
            }))
            // Cards higher up that show the same thing read it again, and say they are no longer the newest.
            artifactChanged(artifact.ref.artifactId)
            break
          }
          case 'done':
            finish()
            void requestSuggestions(conversationId, assistant.id)
            settleQueueRef.current(conversationId, 'done')
            break
          case 'error':
            finish({ error: event.message })
            logActivity(event.message, 'error')
            settleQueueRef.current(conversationId, 'error')
            break
          case 'aborted':
            finish()
            settleQueueRef.current(conversationId, 'stopped')
            break
        }
      })

      const request: ChatRequest = {
        requestId,
        model: conversation.model,
        messages: history,
        webSearch,
        // So what is made in this chat remembers the chat, and "add a chart to it" can find what "it" is.
        conversationId,
        incognito: Boolean(conversation.incognito),
        // Regenerate, Resend, or the question edited: the replies being replaced, and what they made or changed.
        ...(replaced.length ? { replaced } : {})
      }
      window.api.sendChat(request).catch((err: unknown) => {
        finish({ error: err instanceof Error ? err.message : String(err) })
        settleQueueRef.current(conversationId, 'error')
      })
    },
    [commitStreams, flushDeltas, logActivity, persist, queueDelta, requestSuggestions, updateConversation, webSearch]
  )

  // The quick title from the first message shows immediately; the AI title replaces it unless the user renamed the chat first.
  const autoTitle = useCallback(
    async (conversationId: string, prompt: string, quickTitle: string) => {
      try {
        const title = await window.api.generateTitle(prompt)
        const conversation = conversationsRef.current.find((c) => c.id === conversationId)
        if (!title || !conversation || conversation.title !== quickTitle) return
        updateConversation(conversationId, (c) => ({ ...c, title }))
        persist(conversationId)
      } catch {
        // The quick title stays.
      }
    },
    [persist, updateConversation]
  )

  /** While an automation runs, a message can stop, pause or steer it; anything else waits in the queue. */
  const handleAutomationMessage = useCallback(
    async (conversationId: string, requestId: string, objective: string, text: string) => {
      const action = await window.api.classifyAutomationMessage(text, objective).catch(() => 'other' as const)
      if (action === 'stop' || action === 'pause') {
        notify(action === 'pause' ? 'Pausing the automation…' : 'Stopping the automation…')
        void window.api.controlAutomation(requestId, action)
        return
      }
      if (action === 'resume') return notify('The automation is already running.')
      if (action === 'steer') {
        notify('Got it. Orbis will take that into account from its next step.')
        void window.api.steerAutomation(requestId, text)
        return
      }
      const queue = queuesRef.current[conversationId]
      if ((queue?.items.length ?? 0) >= MAX_QUEUED_MESSAGES) {
        return notify(`Up to ${MAX_QUEUED_MESSAGES} messages can wait in the queue. Remove one or stop the automation.`, 'warn')
      }
      commitQueues((q) => ({
        ...q,
        [conversationId]: { paused: queue?.paused ?? false, items: [...(queue?.items ?? []), { id: newId(), text, attachments: [] }] }
      }))
      notify('Your message will be sent when the automation finishes or you stop it.')
    },
    [commitQueues, notify]
  )

  const sendRef = useRef<(text: string, attachments: Attachment[], skipControlCheck?: boolean, browserTask?: boolean) => boolean>(() => false)

  const send = useCallback(
    /** `browserTask` marks a message from the browser's floating assistant, which always acts on the page. */
    (text: string, attachments: Attachment[], skipControlCheck = false, browserTask = false): boolean => {
      const content = text.trim()
      if (!content && attachments.length === 0) return false
      const existing = activeId ? conversationsRef.current.find((c) => c.id === activeId) : undefined
      const running = existing ? streamsRef.current[existing.id] : undefined
      const automation = running && existing?.messages.find((m) => m.id === running.messageId)?.automation
      if (existing && running && automation && automationActive(automation) && attachments.length === 0) {
        void handleAutomationMessage(existing.id, running.requestId, automation.objective, content)
        return true
      }
      // "Stop" just after an automation ended would otherwise reach the chat model, which might claim it stopped something.
      const ended = !running && existing ? [...existing.messages].reverse().find((m) => m.role === 'assistant')?.automation : undefined
      if (!skipControlCheck && existing && ended && !automationActive(ended) && attachments.length === 0 && content.length <= 60) {
        window.api
          .classifyAutomationMessage(content, ended.objective)
          .then((action) => {
            if (action === 'stop' || action === 'pause') {
              notify(ended.status === 'completed' ? 'That automation has already finished.' : "Nothing is running right now, so there's nothing to stop.")
            } else {
              sendRef.current(content, attachments, true, browserTask)
            }
          })
          .catch(() => sendRef.current(content, attachments, true, browserTask))
        return true
      }
      if (existing && streamsRef.current[existing.id]) {
        // Orbis is still replying: queue the message to go out after the reply (and any earlier queued ones).
        const queue = queuesRef.current[existing.id]
        if ((queue?.items.length ?? 0) >= MAX_QUEUED_MESSAGES) {
          notify(`Up to ${MAX_QUEUED_MESSAGES} messages can wait in the queue. Remove one or let Orbis catch up.`, 'warn')
          return false
        }
        commitQueues((q) => ({
          ...q,
          [existing.id]: { paused: queue?.paused ?? false, items: [...(queue?.items ?? []), { id: newId(), text: content, attachments }] }
        }))
        return true
      }

      const now = Date.now()
      const conversation: Conversation = existing ?? {
        id: newId(),
        title: titleFromMessage(content || attachments[0].name),
        ...draft,
        messages: [],
        createdAt: now,
        updatedAt: now
      }
      const userMessage: ChatMessage = {
        id: newId(),
        role: 'user',
        content,
        createdAt: now,
        ...(attachments.length ? { attachments } : {}),
        ...(browserTask ? { browserTask: true } : {})
      }
      const history = [...conversation.messages, userMessage]
      const updated = { ...conversation, messages: history, updatedAt: now }
      commitConversations(existing ? conversationsRef.current.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...conversationsRef.current])
      setActiveId(updated.id)
      persist(updated.id)
      startGeneration(updated, history)
      if (!existing && content) void autoTitle(updated.id, content, updated.title)
      return true
    },
    [activeId, autoTitle, commitConversations, commitQueues, draft, handleAutomationMessage, notify, persist, startGeneration]
  )
  sendRef.current = send

  /** Sends a message into an existing chat that isn't replying; used to run queued messages. */
  const pushUserMessage = useCallback(
    (conversationId: string, content: string, attachments: Attachment[]): boolean => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation || streamsRef.current[conversationId]) return false
      const now = Date.now()
      const userMessage: ChatMessage = { id: newId(), role: 'user', content, createdAt: now, ...(attachments.length ? { attachments } : {}) }
      const history = [...conversation.messages, userMessage]
      const updated = { ...conversation, messages: history, updatedAt: now }
      commitConversations(conversationsRef.current.map((c) => (c.id === updated.id ? updated : c)))
      persist(updated.id)
      startGeneration(updated, history)
      return true
    },
    [commitConversations, persist, startGeneration]
  )

  const runNextQueued = useCallback(
    (conversationId: string) => {
      const queue = queuesRef.current[conversationId]
      if (!queue || queue.paused || !queue.items.length || streamsRef.current[conversationId]) return
      const [next, ...rest] = queue.items
      commitQueues(({ [conversationId]: _sent, ...others }) => (rest.length ? { ...others, [conversationId]: { ...queue, items: rest } } : others))
      pushUserMessage(conversationId, next.text, next.attachments)
    },
    [commitQueues, pushUserMessage]
  )

  useEffect(() => {
    settleQueueRef.current = (conversationId, outcome) => {
      const queue = queuesRef.current[conversationId]
      if (!queue?.items.length) return
      if (outcome !== 'done') {
        commitQueues((q) => ({ ...q, [conversationId]: { ...queue, paused: true } }))
        return
      }
      // A short beat lets the finished reply settle on screen before the next message goes out.
      window.setTimeout(() => runNextQueued(conversationId), 450)
    }
  }, [commitQueues, runNextQueued])

  const removeQueued = useCallback(
    (conversationId: string, itemId: string) => {
      commitQueues((q) => {
        const queue = q[conversationId]
        if (!queue) return q
        const items = queue.items.filter((item) => item.id !== itemId)
        const { [conversationId]: _old, ...others } = q
        return items.length ? { ...others, [conversationId]: { ...queue, items } } : others
      })
    },
    [commitQueues]
  )

  const clearQueue = useCallback((conversationId: string) => commitQueues(({ [conversationId]: _cleared, ...others }) => others), [commitQueues])

  const resumeQueue = useCallback(
    (conversationId: string) => {
      const queue = queuesRef.current[conversationId]
      if (!queue) return
      commitQueues((q) => ({ ...q, [conversationId]: { ...queue, paused: false } }))
      runNextQueued(conversationId)
    },
    [commitQueues, runNextQueued]
  )

  const stop = useCallback((conversationId: string) => {
    const stream = streamsRef.current[conversationId]
    if (stream) void window.api.abortChat(stream.requestId)
  }, [])

  /**
   * Asking for a different answer.
   *
   * The answer being replaced is parked rather than dropped, so a worse second try is one press away from the first
   * one again. Nothing here throws anything away.
   */
  const regenerate = useCallback(
    (conversationId: string, messageId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation || streamsRef.current[conversationId]) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      const history = conversation.messages.slice(0, index)
      if (index < 1 || history[history.length - 1].role !== 'user') return
      const parked = parkTail(conversation, index, Date.now(), newId())
      updateConversation(conversationId, (c) => ({ ...c, messages: parked.messages, branches: parked.branches, updatedAt: Date.now() }))
      startGeneration(conversation, history)
    },
    [startGeneration, updateConversation]
  )

  const editMessage = useCallback(
    (conversationId: string, messageId: string, text: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      const content = text.trim()
      if (!conversation || !content || streamsRef.current[conversationId]) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      if (index < 0) return
      const history = [...conversation.messages.slice(0, index), { ...conversation.messages[index], content, createdAt: Date.now() }]
      // What followed the message being changed is parked, not deleted: the old wording and everything it led to can
      // be returned to. This used to cut the conversation at this point and lose the rest for good.
      const parked = parkTail(conversation, index, Date.now(), newId())
      updateConversation(conversationId, (c) => ({ ...c, messages: history, branches: parked.branches, updatedAt: Date.now() }))
      startGeneration(conversation, history)
    },
    [startGeneration, updateConversation]
  )

  const resendFrom = useCallback(
    (conversationId: string, messageId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation || streamsRef.current[conversationId]) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      if (index < 0 || conversation.messages[index].role !== 'user') return
      updateConversation(conversationId, (c) => ({ ...c, updatedAt: Date.now() }))
      startGeneration(conversation, conversation.messages.slice(0, index + 1))
    },
    [startGeneration, updateConversation]
  )

  /** Goes back to an answer that was moved away from, parking the one being left in its place. */
  const useBranch = useCallback(
    (conversationId: string, branchId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation || streamsRef.current[conversationId]) return
      const moved = switchToBranch(conversation, branchId, Date.now(), newId())
      updateConversation(conversationId, (c) => ({ ...c, messages: moved.messages, branches: moved.branches, updatedAt: Date.now() }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  /** Throws one away on purpose. The only move here that loses anything, and it is only ever asked for. */
  const forgetBranch = useCallback(
    (conversationId: string, branchId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation) return
      updateConversation(conversationId, (c) => ({ ...c, branches: dropBranch(conversation, branchId).branches }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  /** Out of the list, still there. Archiving is the alternative to deleting something you may want back. */
  const archiveConversation = useCallback(
    (conversationId: string, archived: boolean) => {
      updateConversation(conversationId, (c) => ({ ...c, archived, updatedAt: Date.now() }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  const setFeedback = useCallback(
    (conversationId: string, messageId: string, feedback: 'up' | 'down' | undefined) => {
      updateConversation(conversationId, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)) }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  const deleteConversation = useCallback(
    (id: string) => {
      clearQueue(id)
      stop(id)
      commitConversations(conversationsRef.current.filter((c) => c.id !== id))
      setActiveId((current) => (current === id ? null : current))
      void window.api.deleteConversation(id)
    },
    [clearQueue, commitConversations, stop]
  )

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      updateConversation(id, (c) => ({ ...c, title: trimmed }))
      persist(id)
    },
    [persist, updateConversation]
  )

  const changeModel = useCallback(
    (model: string) => {
      if (!activeId) return setDraft((d) => ({ ...d, model }))
      updateConversation(activeId, (c) => ({ ...c, model }))
      persist(activeId)
    },
    [activeId, persist, updateConversation]
  )

  const improvePrompt = useCallback(
    (text: string): Promise<string | null> => {
      return new Promise((resolve) => {
        const requestId = newId()
        let output = ''
        const unsubscribe = window.api.onChatEvent(requestId, (event) => {
          if (event.type === 'delta' && event.content) {
            output += event.content
          } else if (event.type === 'done' || event.type === 'aborted') {
            unsubscribe()
            resolve(output.trim() || null)
          } else if (event.type === 'error') {
            unsubscribe()
            notify(`Couldn't improve the prompt: ${event.message}`, 'error')
            resolve(null)
          }
        })
        window.api
          .sendChat({
            requestId,
            model: DEFAULT_MODEL,
            reasoningEffort: 'low',
            images: false,
            messages: [
              {
                id: newId(),
                role: 'user',
                createdAt: Date.now(),
                content:
                  "Rewrite the prompt below so it is clearer and more specific, keeping the user's intent and language. " +
                  `Reply with only the rewritten prompt, with no preamble or quotes.\n\n<prompt>\n${text}\n</prompt>`
              }
            ]
          })
          .catch((err: unknown) => {
            unsubscribe()
            notify(String(err), 'error')
            resolve(null)
          })
      })
    },
    [notify]
  )

  const shareConversation = useCallback(
    (id: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === id)
      if (!conversation || !settings) return
      const body = conversation.messages
        .filter((m) => m.content || m.attachments?.length)
        .map((m) => {
          const who = m.role === 'user' ? settings.userName : settings.assistantName
          const files = m.attachments?.length ? `\n\n_Attached: ${m.attachments.map((a) => a.name).join(', ')}_` : ''
          return `**${who}**\n\n${m.content}${files}`
        })
        .join('\n\n---\n\n')
      void copyText(`# ${conversation.title}\n\n${body}\n`).then(() => notify('Chat copied as Markdown.'))
    },
    [notify, settings]
  )

  const startChat = useCallback(
    (incognito: boolean) => {
      setActiveId(null)
      setImagesOpen(false)
      const preferred = settings?.defaultModel ?? DEFAULT_MODEL
      setDraft({ model: isKnownModel(preferred) ? preferred : DEFAULT_MODEL, incognito })
    },
    [settings?.defaultModel]
  )

  const newChat = useCallback(() => startChat(false), [startChat])

  const closeFeature = useCallback(() => setFeature(null), [])
  // Whichever way a screen was left -- its own back button, the menu, another screen opened over it -- something may
  // have been changed or removed on it: cards in the chat read again.
  useEffect(() => {
    artifactChanged()
  }, [feature])

  const toggleIncognito = useCallback(() => {
    const on = !(activeId ? conversationsRef.current.find((c) => c.id === activeId)?.incognito : draft.incognito)
    startChat(on)
    notify(on ? "Incognito chat on. It won't be saved or shown in your history." : 'Incognito chat off.')
  }, [activeId, draft.incognito, notify, startChat])

  // Incognito chats only exist while open, so leaving one discards it (and stops its reply).
  useEffect(() => {
    const stale = conversationsRef.current.filter((c) => c.incognito && c.id !== activeId)
    if (!stale.length) return
    for (const c of stale) {
      const stream = streamsRef.current[c.id]
      if (stream) void window.api.abortChat(stream.requestId)
    }
    commitQueues((q) => Object.fromEntries(Object.entries(q).filter(([id]) => !stale.some((c) => c.id === id))))
    commitConversations(conversationsRef.current.filter((c) => !c.incognito || c.id === activeId))
  }, [activeId, commitConversations, commitQueues])

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
    async (name: string, password: string) => {
      const next = await updateSettings({ userName: name, welcomeCompleted: true })
      if (!next.welcomeCompleted || !next.userName.trim()) throw new Error('Setup was not saved')

      const made = await window.api.accountCreate(password, name)
      if (isRefusal(made)) throw new Error(made.message ?? 'The password could not be saved.')
      if (!made.hasPassword) throw new Error('The password could not be saved.')
    },
    [updateSettings]
  )

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
    setImagesOpen(false)
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

  const toggleActivity = useCallback(() => {
    setActivityOpen((open) => !open)
    setUnread(0)
  }, [])

  const answerBrowserConfirmation = useCallback((messageId: string, confirmationId: string, approved: boolean) => {
    const stream = Object.values(streamsRef.current).find((s) => s.messageId === messageId)
    if (stream) void window.api.answerBrowserConfirmation(stream.requestId, confirmationId, approved)
  }, [])

  const controlAutomation = useCallback((messageId: string, action: 'pause' | 'stop') => {
    const stream = Object.values(streamsRef.current).find((s) => s.messageId === messageId)
    if (stream) void window.api.controlAutomation(stream.requestId, action)
  }, [])

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
      setImagesOpen(false)
      setCreateOpenAt({ artifactId, token: Date.now() })
      setFeature('create')
    }
    window.addEventListener(OPEN_ARTIFACT_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_ARTIFACT_EVENT, onOpen)
  }, [])

  // The browser's search page asking for one of these: the same route a card's "Open" takes, so one screen switch.
  useEffect(() => window.api.onOpenArtifact((artifactId) => openArtifact(artifactId)), [])

  useControlRendered()

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

  /** Empties a chat but keeps it (title, model and assistant) so the conversation can start over in place. */
  const clearConversation = useCallback(
    (id: string) => {
      clearQueue(id)
      stop(id)
      updateConversation(id, (c) => ({ ...c, messages: [], updatedAt: Date.now() }))
      persist(id)
    },
    [clearQueue, persist, stop, updateConversation]
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
          return newChat()
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
          notify(webSearch ? 'Web search off.' : 'Web search on. Replies will use live results.')
          return setWebSearch(!webSearch)
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
          setImagesOpen(false)
          if (args.trim() !== '') setCreateAsked({ text: args.trim(), token: Date.now() })
          return setFeature('create')
        case 'images':
          return setImagesOpen(true)
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
      newChat,
      notify,
      openSearch,
      regenerate,
      renameConversation,
      send,
      shareConversation,
      stop,
      toggleBrowser,
      toggleIncognito,
      updateSettings,
      webSearch
    ]
  )

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (welcome !== 'closed' || (!e.ctrlKey && !e.metaKey)) return
      const key = e.key.toLowerCase()
      if (e.shiftKey && key === 'o') {
        e.preventDefault()
        newChat()
      } else if (e.shiftKey && key === 'n') {
        e.preventDefault()
        toggleIncognito()
      } else if (key === ',') {
        e.preventDefault()
        // Named rather than left to the default, so that whichever section Settings happens to open at first can
        // change without quietly changing where this shortcut lands.
        setSettingsAt('account')
      } else if (key === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (key === 'e' && !e.shiftKey && !e.altKey) {
        // Ctrl+E: straight to the address bar, from anywhere in Orbis (inside the browser the shortcut table does it).
        e.preventDefault()
        window.dispatchEvent(new Event('orbis:focus-url'))
      } else if (key === 'k' && !e.shiftKey && !e.altKey) {
        // Unused until now; web pages keep their own Ctrl+K (it only reaches the Orbis window).
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [newChat, openSearch, toggleIncognito, toggleSidebar, welcome])

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

  const active = activeId ? conversations.find((c) => c.id === activeId) : undefined
  const current: DraftChat = active ? { model: active.model, incognito: Boolean(active.incognito) } : draft
  currentRef.current = current

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
  /** The browser is on screen: it takes the whole window below the address bar, so none of the chat's own bars are shown. */
  const browserShowing = browserOpen && !browserHidden && !settingsOpen && !shortcutsOpen

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
        <div className="url-strip" />
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
      {!browserShowing && (
        <SystemBar
          browserRunning={browserRunning}
          onShowBrowser={() => openChromium('', { newTab: false })}
          dark={dark}
          unread={unread}
          onToggleHistory={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
          webSearch={webSearch}
          onToggleWebSearch={() => {
            notify(webSearch ? 'Web search off.' : 'Web search on. Replies will use live results.')
            setWebSearch(!webSearch)
          }}
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
            onRename={(title) => active && renameConversation(active.id, title)}
            onShare={() => active && shareConversation(active.id)}
            onDelete={() => active && deleteConversation(active.id)}
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
          feature={feature}
          onFeature={(id) => {
            setImagesOpen(false)
            setFeature((current) => (current === id ? null : id))
          }}
          searchToken={searchToken}
          userName={settings?.userName ?? 'You'}
          userTitle={settings?.userTitle ?? ''}
          onNewChat={newChat}
          onIncognito={toggleIncognito}
          onSearch={openSearch}
          onImages={() => setImagesOpen((open) => !open)}
          onBrowser={toggleBrowser}
          onSelect={selectChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
          onTogglePin={togglePin}
          onSettings={(section) => setSettingsAt(section ?? DEFAULT_SETTINGS_SECTION)}
          onHelp={() => setShortcutsOpen(true)}
        />

        <main className="stage">
          <ChatView
            key={activeId ?? 'new'}
            conversation={active}
            stream={active ? streams[active.id] : undefined}
            settings={settings}
            loaded={loaded}
            model={current.model}
            incognito={current.incognito}
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
            onNotify={notify}
            onImprovePrompt={improvePrompt}
            onNewChat={newChat}
            onSearch={openSearch}
            onUseBranch={(branchId) => active && useBranch(active.id, branchId)}
            onForgetBranch={(branchId) => active && forgetBranch(active.id, branchId)}
          />
          {imagesOpen && (
            <ImagesView images={galleryImages} onClose={() => setImagesOpen(false)} onOpenChat={selectChat} onEdit={editGalleryImage} onNotify={notify} />
          )}
          {feature && (
            <Suspense fallback={<div className="feature-loading" role="status">Opening…</div>}>
              {feature === 'pages' && <PagesView onClose={closeFeature} onNotify={notify} landOn={scheduledPage} />}
              {feature === 'markets' && <MarketsView onClose={closeFeature} onNotify={notify} />}
              {feature === 'whiteboard' && <WhiteboardView onClose={closeFeature} onNotify={notify} />}
              {feature === 'clipboard' && <ClipboardView onClose={closeFeature} onNotify={notify} />}
              {feature === 'workspaces' && <WorkspacesView onClose={closeFeature} onNotify={notify} />}
              {feature === 'schedules' && <SchedulesView onClose={closeFeature} onNotify={notify} />}
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
      <MarketStrip suppressed={welcome !== 'closed' || browserShowing} />

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
      <ControlPrompts />
      {settingsAt && settings && (
        <SettingsModal settings={settings} section={settingsAt} onUpdate={updateSettings} onClose={() => setSettingsAt(null)} />
      )}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
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
        onUnlock={unlockAccount}
        onEnter={enterFromWelcome}
        onFinished={finishWelcome}
      />
    )}    </ImageEditorContext.Provider>
  )
}
