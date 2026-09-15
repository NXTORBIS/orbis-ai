import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, ChatMessage, ChatRequest, Conversation, Settings, SettingsUpdate, StreamEvent } from '../../shared/types'
import { IMAGE_GEN_STATUS } from '../../shared/types'
import { DEFAULT_MODEL, MODELS, isKnownModel, modelLabel } from '../../shared/models'
import { automationActive, automationProgress } from '../../shared/automation'
import { DEFAULT_PERSONA } from '../../shared/personas'
import { copyText, newId, titleFromMessage } from './lib/utils'
import BrowserPanel from './components/BrowserPanel'
import ChatHeader from './components/ChatHeader'
import ChatView from './components/ChatView'
import ImagesView from './components/ImagesView'
import HudBackground from './components/HudBackground'
import Sidebar from './components/Sidebar'
import { ActivityPanel, ShortcutsModal, ToastStack } from './components/Overlays'
import SettingsModal from './components/SettingsModal'
import WelcomeExperience from './components/WelcomeExperience'
import UrlBar from './components/UrlBar'
import BrowserSizeControl from './components/BrowserSizeControl'
import { OPEN_URL_EVENT } from './lib/openInBrowser'
import type { OpenUrlDetail } from './lib/openInBrowser'
import { clampBrowserSize, loadBrowserSize, resolveBrowserSize, saveBrowserSize } from './lib/browserSize'
import type { Bounds, BrowserMode, BrowserSizePref } from './lib/browserSize'
import type { BrowserOrbProps } from './components/BrowserOrb'
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
  persona: string
}

const COUNTDOWN = /Retrying in \d+s/

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftChat>({ model: DEFAULT_MODEL, persona: DEFAULT_PERSONA, incognito: false })
  const [loaded, setLoaded] = useState(false)
  /** The Orbis startup screen, shown on every launch; 'leaving' while it hands over to the main interface. */
  const [welcome, setWelcome] = useState<'closed' | 'open' | 'leaving'>('open')
  /** No valid name is saved, so startup continues into the name step. Set once, when settings load. */
  const [needsName, setNeedsName] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('orbis.sidebarCollapsed') === '1'
    } catch {
      return false
    }
  })
  const [imagesOpen, setImagesOpen] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [searchToken, setSearchToken] = useState(0)
  const [activityOpen, setActivityOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  /** A chat request waiting for the browser to hand over the tab Orbis should control. */
  const [browserTarget, setBrowserTarget] = useState<string | null>(null)
  /** Chat requests currently operating the browser. */
  const [browserAgents, setBrowserAgents] = useState<string[]>([])
  /** The browser's active page, sent with chat requests so "click the first result" has context. */
  const browserPageRef = useRef<{ url: string; title: string } | null>(null)
  /** The same page, as state, for the URL bar. */
  const [browserPage, setBrowserPageState] = useState<{ url: string; title: string } | null>(null)
  /** An address typed in the URL bar, waiting for the browser to open it. */
  const [browserNavigation, setBrowserNavigation] = useState<(OpenUrlDetail & { id: number }) | null>(null)
  /** Back at the chat with the browser still open: its tabs, pages and orb stay as they were. */
  const [browserHidden, setBrowserHidden] = useState(false)
  /** The browser's active page is loading, shown in the URL bar. */
  const [browserLoading, setBrowserLoading] = useState(false)
  const [browserMode, setBrowserMode] = useState<BrowserMode>('full')
  const [browserPref, setBrowserPref] = useState<BrowserSizePref>(loadBrowserSize)
  const [browserWindow, setBrowserWindow] = useState<Bounds>({ width: 1200, height: 800 })
  /** The content area below the header, which the browser fills or opens a window in. */
  const [hudBounds, setHudBounds] = useState<Bounds>({ width: window.innerWidth, height: window.innerHeight - 90 })
  const browserStateRef = useRef({ open: browserOpen, pref: browserPref, bounds: hudBounds })
  browserStateRef.current = { open: browserOpen, pref: browserPref, bounds: hudBounds }
  const hudObserver = useRef<ResizeObserver | null>(null)
  const hudBodyRef = useCallback((body: HTMLDivElement | null) => {
    hudObserver.current?.disconnect()
    hudObserver.current = null
    if (!body) return
    const measure = (): void => setHudBounds({ width: body.clientWidth, height: body.clientHeight })
    measure()
    hudObserver.current = new ResizeObserver(measure)
    hudObserver.current.observe(body)
  }, [])

  /** Shows the browser the way a size preference asks: a full page, or a window of that size. */
  const applyBrowserSize = useCallback((pref: BrowserSizePref) => {
    setBrowserMode(pref.preset === 'full' ? 'full' : 'window')
    setBrowserWindow(resolveBrowserSize(pref, browserStateRef.current.bounds))
  }, [])

  /** Opens the browser at the preferred size; an already open browser keeps its size and is brought back into view. */
  const openBrowser = useCallback(() => {
    if (!browserStateRef.current.open) applyBrowserSize(browserStateRef.current.pref)
    setBrowserOpen(true)
    setBrowserHidden(false)
  }, [applyBrowserSize])

  /** Sidebar and /browser: open it, or switch between the browser and the chat without closing it. */
  const toggleBrowser = useCallback(() => {
    if (!browserStateRef.current.open) return openBrowser()
    setBrowserHidden((isHidden) => !isHidden)
  }, [openBrowser])

  const changeBrowserPref = useCallback(
    (pref: BrowserSizePref) => {
      setBrowserPref(pref)
      saveBrowserSize(pref)
      if (browserStateRef.current.open) applyBrowserSize(pref)
    },
    [applyBrowserSize]
  )

  /** Dragging the window's corner; the size it ends at becomes the remembered custom size. */
  const resizeBrowserWindow = useCallback((width: number, height: number, final: boolean) => {
    const size = clampBrowserSize(width, height, browserStateRef.current.bounds)
    setBrowserWindow(size)
    if (final) {
      const pref: BrowserSizePref = { preset: 'custom', ...size }
      setBrowserPref(pref)
      saveBrowserSize(pref)
    }
  }, [])
  /** Latest state of each running browser automation, by chat request, for the browser banner. */
  const [automations, setAutomations] = useState<Record<string, NonNullable<ChatMessage['automation']>>>({})
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false)
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

  const logActivity = useCallback((text: string, kind: NoticeKind) => {
    setNotices((current) => [...current.slice(-49), { id: newId(), text, kind, at: Date.now() }])
    if (!activityOpenRef.current) setUnread((n) => n + 1)
  }, [])

  const load = useCallback(() => {
    Promise.all([window.api.getSettings(), window.api.listConversations()]).then(
      ([s, list]) => {
        setSettings(s)
        setDraft((d) => ({ ...d, model: isKnownModel(s.defaultModel) ? s.defaultModel : DEFAULT_MODEL, persona: DEFAULT_PERSONA }))
        commitConversations(list)
        // A blank saved name means setup never really finished.
        setNeedsName(!s.welcomeCompleted || !s.userName.trim())
        setLoadError(false)
        setLoaded(true)
      },
      () => setLoadError(true)
    )
  }, [commitConversations])

  useEffect(load, [load])

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const dark = settings ? settings.theme === 'dark' || (settings.theme === 'system' && systemDark) : true
  const effects = settings?.effects !== false

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])

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
        setBrowserAgents((agents) => (agents.includes(requestId) ? agents.filter((a) => a !== requestId) : agents))
        setBrowserTarget((pending) => (pending === requestId ? null : pending))
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
            if (event.model === conversation.model) {
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
            if (event.message === IMAGE_GEN_STATUS) break
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
          case 'browser-target':
            openBrowser()
            setBrowserTarget(requestId)
            setBrowserAgents((agents) => (agents.includes(requestId) ? agents : [...agents, requestId]))
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
        persona: conversation.persona,
        messages: history,
        webSearch,
        browser: browserPageRef.current ?? undefined
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

  const regenerate = useCallback(
    (conversationId: string, messageId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation || streamsRef.current[conversationId]) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      const history = conversation.messages.slice(0, index)
      if (index < 1 || history[history.length - 1].role !== 'user') return
      startGeneration(conversation, history)
    },
    [startGeneration]
  )

  const editMessage = useCallback(
    (conversationId: string, messageId: string, text: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      const content = text.trim()
      if (!conversation || !content || streamsRef.current[conversationId]) return
      const index = conversation.messages.findIndex((m) => m.id === messageId)
      if (index < 0) return
      const history = [...conversation.messages.slice(0, index), { ...conversation.messages[index], content, createdAt: Date.now() }]
      updateConversation(conversationId, (c) => ({ ...c, messages: history, updatedAt: Date.now() }))
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

  const changePersona = useCallback(
    (persona: string) => {
      if (!activeId) return setDraft((d) => ({ ...d, persona }))
      updateConversation(activeId, (c) => ({ ...c, persona }))
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
            persona: DEFAULT_PERSONA,
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
      setDraft({ model: isKnownModel(preferred) ? preferred : DEFAULT_MODEL, persona: DEFAULT_PERSONA, incognito })
    },
    [settings?.defaultModel]
  )

  const newChat = useCallback(() => startChat(false), [startChat])

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

  const completeWelcome = useCallback(
    async (name: string) => {
      const next = await updateSettings({ userName: name, welcomeCompleted: true })
      if (!next.welcomeCompleted || !next.userName.trim()) throw new Error('Setup was not saved')
    },
    [updateSettings]
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

  const editScreenshot = useCallback(
    (src: string, title: string) => setEditing({ conversationId: activeId, image: { src, prompt: title }, tool: 'markup' }),
    [activeId]
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

  const provideBrowserTarget = useCallback((requestId: string, webContentsId: number | null) => {
    setBrowserTarget((pending) => (pending === requestId ? null : pending))
    void window.api.provideBrowserTarget(requestId, webContentsId)
  }, [])

  const closeBrowser = useCallback(() => {
    setBrowserOpen(false)
    setBrowserHidden(false)
    setBrowserLoading(false)
    browserPageRef.current = null
    setBrowserPageState(null)
    if (browserTarget) provideBrowserTarget(browserTarget, null)
  }, [browserTarget, provideBrowserTarget])

  const stopBrowserAgents = useCallback(() => {
    // Automations stop with their progress saved; a single task simply ends.
    for (const requestId of browserAgents) void (automations[requestId] ? window.api.controlAutomation(requestId, 'stop') : window.api.abortChat(requestId))
  }, [automations, browserAgents])

  const pauseBrowserAgents = useCallback(() => {
    for (const requestId of browserAgents) if (automations[requestId]) void window.api.controlAutomation(requestId, 'pause')
  }, [automations, browserAgents])

  const controlAutomation = useCallback((messageId: string, action: 'pause' | 'stop') => {
    const stream = Object.values(streamsRef.current).find((s) => s.messageId === messageId)
    if (stream) void window.api.controlAutomation(stream.requestId, action)
  }, [])

  const setBrowserPage = useCallback((page: { url: string; title: string } | null) => {
    browserPageRef.current = page
    setBrowserPageState((current) => (current?.url === page?.url && current?.title === page?.title ? current : page))
  }, [])

  /**
   * From the URL bar, links and research sources: open the browser at the preferred size (a full page unless changed)
   * and load the address there, in a new tab when asked.
   */
  const openInBrowser = useCallback(
    (input: string, options?: Omit<OpenUrlDetail, 'url'>) => {
      openBrowser()
      setBrowserNavigation({ url: input, id: Date.now(), ...options })
    },
    [openBrowser]
  )

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const { url, newTab, more } = (e as CustomEvent<OpenUrlDetail>).detail ?? {}
      if (url) openInBrowser(url, { newTab, more })
    }
    window.addEventListener(OPEN_URL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_URL_EVENT, onOpen)
  }, [openInBrowser])

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
        case 'images':
          return setImagesOpen(true)
        case 'browser':
          return toggleBrowser()
        case 'theme':
          void updateSettings({ theme: dark ? 'light' : 'dark' })
          return
        case 'assistant':
          return setPersonaMenuOpen(true)
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
        setSettingsOpen(true)
      } else if (key === 'b') {
        e.preventDefault()
        toggleSidebar()
      } else if (key === 'k' && !e.shiftKey && !e.altKey) {
        // Unused until now; web pages keep their own Ctrl+K (it only reaches the Orbis window).
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [newChat, openSearch, toggleIncognito, toggleSidebar, welcome])

  const active = activeId ? conversations.find((c) => c.id === activeId) : undefined
  const current: DraftChat = active ? { model: active.model, persona: active.persona, incognito: Boolean(active.incognito) } : draft

  // The floating browser assistant follows the current chat's latest reply: its steps, progress, approvals and summary.
  const orbReply = active ? [...active.messages].reverse().find((m) => m.role === 'assistant') : undefined
  const orbStream = active ? streams[active.id] : undefined
  // A reply belongs to the browser when it did browser work or answers a request made from the orb (even with no actions).
  const orbAsked = Boolean(orbReply && active?.messages[active.messages.indexOf(orbReply) - 1]?.browserTask)
  const orbProps: BrowserOrbProps = {
    working: Boolean(orbStream && orbReply && orbStream.messageId === orbReply.id),
    status: orbStream?.status,
    automation: orbReply?.automation,
    steps: orbReply?.steps ?? [],
    confirmation: orbReply?.confirmation,
    summary:
      orbReply && (orbReply.steps?.length || orbReply.automation || orbAsked)
        ? (orbReply.error ?? orbReply.content).replace(/[#*_`>|]+/g, ' ').replace(/\s+/g, ' ').trim() || undefined
        : undefined,
    onPrompt: (text) => {
      send(text, [], false, true)
    },
    onPause: () => {
      if (orbReply) controlAutomation(orbReply.id, 'pause')
    },
    onStop: () => {
      if (!active || !orbReply) return
      if (automationActive(orbReply.automation)) controlAutomation(orbReply.id, 'stop')
      else stop(active.id)
    },
    onResume: () => {
      send('Continue', [], true, true)
    },
    onAnswer: (confirmationId, approved) => {
      if (orbReply) answerBrowserConfirmation(orbReply.id, confirmationId, approved)
    }
  }
  const savedConversations = useMemo(() => conversations.filter((c) => !c.incognito), [conversations])
  const researchTopics = useMemo(
    () =>
      savedConversations.flatMap((c) =>
        c.messages.flatMap((m) => (m.research && !m.research.reused && m.research.question.trim() ? [{ question: m.research.question.trim(), at: m.research.retrievedAt }] : []))
      ),
    [savedConversations]
  )
  const galleryImages = useMemo(() => collectImages(savedConversations), [savedConversations])

  return (
    <ImageEditorContext.Provider value={openImageEditor}>
    <div
      className={`hud${effects ? ' effects' : ''}${welcome === 'leaving' ? ' hud-entering' : ''}${browserOpen && !browserHidden && browserMode === 'full' ? ' browser-full' : ''}`}
      inert={welcome === 'open'}
    >
      <HudBackground animated={effects} />
      <UrlBar
        url={browserPage?.url ?? ''}
        title={browserPage?.title ?? ''}
        onNavigate={openInBrowser}
        research={researchTopics}
        incognito={current.incognito}
        searchSuggestions={settings?.searchSuggestions !== false}
        personalizedSuggestions={settings?.personalizedSuggestions !== false}
        askModel={current.model}
        askPersona={current.persona}
        onNotify={notify}
        loading={browserOpen && browserLoading}
        browserHidden={browserOpen && browserHidden}
        onShowBrowser={() => setBrowserHidden(false)}
        sizeControl={<BrowserSizeControl pref={browserPref} bounds={hudBounds} onChange={changeBrowserPref} />}
      />
      <SystemBar
        dark={dark}
        unread={unread}
        onToggleHistory={toggleSidebar}
        sidebarCollapsed={sidebarCollapsed}
        onNewChat={newChat}
        onSearch={openSearch}
        onQuickPrompts={() => setQuickPromptsOpen((open) => !open)}
        webSearch={webSearch}
        onToggleWebSearch={() => {
          notify(webSearch ? 'Web search off.' : 'Web search on. Replies will use live results.')
          setWebSearch(!webSearch)
        }}
        onToggleActivity={toggleActivity}
        onToggleTheme={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
      >
        <ChatHeader
          title={active?.title ?? 'New chat'}
          hasConversation={Boolean(active)}
          persona={current.persona}
          personaMenuOpen={personaMenuOpen}
          thinking={Boolean(active && streams[active.id])}
          userInitial={settings?.userName.trim().charAt(0).toUpperCase() || 'U'}
          incognito={current.incognito}
          onToggleIncognito={toggleIncognito}
          onPersonaMenuChange={setPersonaMenuOpen}
          onPersonaChange={changePersona}
          onRename={(title) => active && renameConversation(active.id, title)}
          onShare={() => active && shareConversation(active.id)}
          onDelete={() => active && deleteConversation(active.id)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </SystemBar>

      <div className="hud-body" ref={hudBodyRef}>
        <Sidebar
          collapsed={sidebarCollapsed}
          conversations={savedConversations}
          activeId={activeId}
          incognito={current.incognito}
          streams={streams}
          imageCount={galleryImages.length}
          imagesOpen={imagesOpen}
          searchToken={searchToken}
          userName={settings?.userName ?? 'You'}
          userTitle={settings?.userTitle ?? ''}
          onNewChat={newChat}
          onIncognito={toggleIncognito}
          onSearch={openSearch}
          onImages={() => setImagesOpen((open) => !open)}
          onAssistants={() => setPersonaMenuOpen(true)}
          onBrowser={toggleBrowser}
          onSelect={selectChat}
          onRename={renameConversation}
          onDelete={deleteConversation}
          onTogglePin={togglePin}
          onSettings={() => setSettingsOpen(true)}
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
            onOpenSettings={() => setSettingsOpen(true)}
            onNewChat={newChat}
            onSearch={openSearch}
          />
          {imagesOpen && (
            <ImagesView images={galleryImages} onClose={() => setImagesOpen(false)} onOpenChat={selectChat} onEdit={editGalleryImage} onNotify={notify} />
          )}
        </main>

        {browserOpen && (
          <BrowserPanel
            onClose={closeBrowser}
            onEditScreenshot={editScreenshot}
            onNotify={notify}
            agentRequest={browserTarget}
            onAgentTarget={provideBrowserTarget}
            agentActive={browserAgents.length > 0}
            onStopAgent={stopBrowserAgents}
            agentStatus={(() => {
              const running = browserAgents.map((id) => automations[id]).find(automationActive)
              return running ? automationProgress(running) : undefined
            })()}
            onPauseAgent={browserAgents.some((id) => automationActive(automations[id])) ? pauseBrowserAgents : undefined}
            onPageChange={setBrowserPage}
            navigation={browserNavigation}
            orb={orbProps}
            mode={browserMode}
            onModeChange={setBrowserMode}
            // Large, Medium and Small follow the space the window has now (the header shows again when leaving full
            // page, and the app window can be resized); a custom or dragged size keeps its pixels, fitted to the space.
            windowSize={
              browserPref.preset === 'large' || browserPref.preset === 'medium' || browserPref.preset === 'small'
                ? resolveBrowserSize(browserPref, hudBounds)
                : clampBrowserSize(browserWindow.width, browserWindow.height, hudBounds)
            }
            onWindowResize={resizeBrowserWindow}
            hidden={browserHidden}
            onBackToChat={() => setBrowserHidden(true)}
            onLoadingChange={setBrowserLoading}
          />
        )}

        <button className="edge-handle" title="Activity" onClick={toggleActivity}>
          <span />
        </button>
        {activityOpen && <ActivityPanel items={notices} onClear={() => setNotices([])} onClose={() => setActivityOpen(false)} />}
      </div>

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
      {settingsOpen && settings && <SettingsModal settings={settings} onUpdate={updateSettings} onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
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
        ready={loaded}
        needsName={needsName}
        loadError={loadError}
        effects={effects}
        onRetryLoad={load}
        onComplete={completeWelcome}
        onEnter={enterFromWelcome}
        onFinished={finishWelcome}
      />
    )}    </ImageEditorContext.Provider>
  )
}
