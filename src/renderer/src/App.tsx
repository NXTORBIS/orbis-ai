import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Attachment, ChatMessage, ChatRequest, Conversation, Settings, SettingsUpdate, StreamEvent } from '../../shared/types'
import { IMAGE_GEN_STATUS } from '../../shared/types'
import { DEFAULT_MODEL, isKnownModel, modelLabel } from '../../shared/models'
import { DEFAULT_PERSONA } from '../../shared/personas'
import { copyText, newId, titleFromMessage } from './lib/utils'
import BrowserPanel from './components/BrowserPanel'
import ChatHeader from './components/ChatHeader'
import ChatView from './components/ChatView'
import CursorGlow from './components/CursorGlow'
import ImagesView from './components/ImagesView'
import HudBackground from './components/HudBackground'
import Sidebar from './components/Sidebar'
import { ActivityPanel, ShortcutsModal, ToastStack } from './components/Overlays'
import SettingsModal from './components/SettingsModal'
import WelcomeExperience from './components/WelcomeExperience'
import SystemBar from './components/SystemBar'
import ImageEditor from './components/ImageEditor'
import { ImageEditorContext, collectImages, imageMarkdown } from './lib/imageEditor'
import type { EditableImage, GalleryImage } from './lib/imageEditor'

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
        patchAssistant((m) => ({
          ...m,
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
              setStatus(`${modelLabel(conversation.model)} was busy, so ${modelLabel(event.model)} is answering.`)
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
          case 'done':
            finish()
            break
          case 'error':
            finish({ error: event.message })
            logActivity(event.message, 'error')
            break
          case 'aborted':
            finish()
            break
        }
      })

      const request: ChatRequest = {
        requestId,
        model: conversation.model,
        persona: conversation.persona,
        messages: history,
        webSearch
      }
      window.api.sendChat(request).catch((err: unknown) => {
        finish({ error: err instanceof Error ? err.message : String(err) })
      })
    },
    [commitStreams, flushDeltas, logActivity, persist, queueDelta, updateConversation, webSearch]
  )

  const send = useCallback(
    (text: string, attachments: Attachment[]): boolean => {
      const content = text.trim()
      if (!content && attachments.length === 0) return false
      const existing = activeId ? conversationsRef.current.find((c) => c.id === activeId) : undefined
      if (existing && streamsRef.current[existing.id]) return false

      const now = Date.now()
      const conversation: Conversation = existing ?? {
        id: newId(),
        title: titleFromMessage(content || attachments[0].name),
        ...draft,
        messages: [],
        createdAt: now,
        updatedAt: now
      }
      const userMessage: ChatMessage = { id: newId(), role: 'user', content, createdAt: now, ...(attachments.length ? { attachments } : {}) }
      const history = [...conversation.messages, userMessage]
      const updated = { ...conversation, messages: history, updatedAt: now }
      commitConversations(existing ? conversationsRef.current.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...conversationsRef.current])
      setActiveId(updated.id)
      persist(updated.id)
      startGeneration(updated, history)
      return true
    },
    [activeId, commitConversations, draft, persist, startGeneration]
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
      stop(id)
      commitConversations(conversationsRef.current.filter((c) => c.id !== id))
      setActiveId((current) => (current === id ? null : current))
      void window.api.deleteConversation(id)
    },
    [commitConversations, stop]
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
    commitConversations(conversationsRef.current.filter((c) => !c.incognito || c.id === activeId))
  }, [activeId, commitConversations])

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
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [newChat, toggleIncognito, toggleSidebar, welcome])

  const active = activeId ? conversations.find((c) => c.id === activeId) : undefined
  const current: DraftChat = active ? { model: active.model, persona: active.persona, incognito: Boolean(active.incognito) } : draft
  const savedConversations = useMemo(() => conversations.filter((c) => !c.incognito), [conversations])
  const galleryImages = useMemo(() => collectImages(savedConversations), [savedConversations])

  return (
    <ImageEditorContext.Provider value={openImageEditor}>
    <div className={`hud${effects ? ' effects' : ''}${welcome === 'leaving' ? ' hud-entering' : ''}`} inert={welcome === 'open'}>
      <HudBackground animated={effects} />
      <SystemBar
        dark={dark}
        unread={unread}
        onToggleHistory={toggleSidebar}
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

      <div className="hud-body">
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
          onToggleCollapsed={toggleSidebar}
          onNewChat={newChat}
          onIncognito={toggleIncognito}
          onSearch={openSearch}
          onImages={() => setImagesOpen((open) => !open)}
          onAssistants={() => setPersonaMenuOpen(true)}
          onBrowser={() => setBrowserOpen((b) => !b)}
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

        {browserOpen && <BrowserPanel onClose={() => setBrowserOpen(false)} onEditScreenshot={editScreenshot} onNotify={notify} />}

        <button className="edge-handle" title="Activity" onClick={toggleActivity}>
          <span />
        </button>
        {activityOpen && <ActivityPanel items={notices} onClear={() => setNotices([])} onClose={() => setActivityOpen(false)} />}
      </div>

      {effects && <CursorGlow />}
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
        onRetryLoad={load}
        onComplete={completeWelcome}
        onEnter={enterFromWelcome}
        onFinished={finishWelcome}
      />
    )}    </ImageEditorContext.Provider>
  )
}
