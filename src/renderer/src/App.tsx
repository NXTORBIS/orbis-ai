import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Attachment, ChatMessage, ChatMode, ChatRequest, Conversation, Settings, SettingsUpdate, StreamEvent } from '../../shared/types'
import { DEFAULT_MODEL, modelLabel } from '../../shared/models'
import { modeInfo, newChatMode } from '../../shared/modes'
import { DEFAULT_PERSONA } from '../../shared/personas'
import { copyText, newId, titleFromMessage } from './lib/utils'
import BrowserPanel from './components/BrowserPanel'
import ChatHeader from './components/ChatHeader'
import ChatView from './components/ChatView'
import CursorGlow from './components/CursorGlow'
import HistoryDrawer from './components/HistoryDrawer'
import HudBackground from './components/HudBackground'
import NavRail from './components/NavRail'
import { ActivityPanel, ShortcutsModal, ToastStack } from './components/Overlays'
import SettingsModal from './components/SettingsModal'
import SystemBar from './components/SystemBar'

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
  mode: ChatMode
  model: string
  persona: string
}

const COUNTDOWN = /Retrying in \d+s/

export default function App(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftChat>({ mode: 'auto', model: DEFAULT_MODEL, persona: DEFAULT_PERSONA })
  const [loaded, setLoaded] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyFocus, setHistoryFocus] = useState(0)
  const [activityOpen, setActivityOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false)
  const [quickPromptsOpen, setQuickPromptsOpen] = useState(false)
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
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
    if (conversation) void window.api.saveConversation(conversation)
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

  useEffect(() => {
    void Promise.all([window.api.getSettings(), window.api.listConversations()]).then(([s, list]) => {
      setSettings(s)
      setDraft({ ...newChatMode(s.defaultModel), persona: DEFAULT_PERSONA })
      commitConversations(list)
      setLoaded(true)
    })
  }, [commitConversations])

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
            if (!COUNTDOWN.test(event.message)) {
              logActivity(event.message, 'warn')
            } else if (!countdownLogged) {
              countdownLogged = true
              logActivity('All models are rate-limited. Waiting for the per-minute limit to reset.', 'warn')
            }
            break
          case 'done':
            finish(event.truncated ? { error: 'This reply hit the length limit and was cut off.' } : undefined)
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
        conversationId,
        model: conversation.model,
        persona: conversation.persona,
        reasoningEffort: modeInfo(conversation.mode).reasoningEffort,
        messages: history
      }
      window.api.sendChat(request).catch((err: unknown) => {
        finish({ error: err instanceof Error ? err.message : String(err) })
      })
    },
    [commitStreams, flushDeltas, logActivity, persist, queueDelta, updateConversation]
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

  const changeMode = useCallback(
    (mode: ChatMode, model?: string) => {
      const apply = (current: { model: string }): { mode: ChatMode; model: string } => ({ mode, model: model ?? modeInfo(mode).model ?? current.model })
      if (!activeId) return setDraft((d) => ({ ...d, ...apply(d) }))
      updateConversation(activeId, (c) => ({ ...c, ...apply(c) }))
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
        const fast = modeInfo('fast')
        window.api
          .sendChat({
            requestId,
            model: fast.model ?? DEFAULT_MODEL,
            persona: DEFAULT_PERSONA,
            reasoningEffort: fast.reasoningEffort,
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

  const newChat = useCallback(() => {
    setActiveId(null)
    setDraft({ ...newChatMode(settings?.defaultModel ?? DEFAULT_MODEL), persona: DEFAULT_PERSONA })
  }, [settings?.defaultModel])

  const updateSettings = useCallback(async (update: SettingsUpdate) => {
    const next = await window.api.updateSettings(update)
    setSettings(next)
    return next
  }, [])

  const openSearch = useCallback(() => {
    setHistoryOpen(true)
    setHistoryFocus((n) => n + 1)
  }, [])

  const toggleActivity = useCallback(() => {
    setActivityOpen((open) => !open)
    setUnread(0)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      if (e.shiftKey && key === 'o') {
        e.preventDefault()
        newChat()
      } else if (key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (key === 'b') {
        e.preventDefault()
        setHistoryOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [newChat])

  const active = activeId ? conversations.find((c) => c.id === activeId) : undefined
  const current: DraftChat = active ? { mode: active.mode, model: active.model, persona: active.persona } : draft
  const recent = useMemo(() => [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3), [conversations])

  return (
    <div className={`hud${effects ? ' effects' : ''}`}>
      <HudBackground animated={effects} />
      <SystemBar
        dark={dark}
        unread={unread}
        onToggleHistory={() => setHistoryOpen((open) => !open)}
        onNewChat={newChat}
        onSearch={openSearch}
        onQuickPrompts={() => setQuickPromptsOpen((open) => !open)}
        onUnavailable={(feature) => notify(`${feature} is coming soon.`)}
        onToggleActivity={toggleActivity}
        onToggleTheme={() => void updateSettings({ theme: dark ? 'light' : 'dark' })}
      />

      <div className="hud-body">
        <NavRail
          recent={recent}
          activeId={activeId}
          streams={streams}
          onNewChat={newChat}
          onSearch={openSearch}
          onAssistants={() => setPersonaMenuOpen(true)}
          onSelect={setActiveId}
          onSettings={() => setSettingsOpen(true)}
          onHelp={() => setShortcutsOpen(true)}
          onBrowser={() => setBrowserOpen((b) => !b)}
        />

        {historyOpen && (
          <HistoryDrawer
            conversations={conversations}
            activeId={activeId}
            streams={streams}
            focusToken={historyFocus}
            onClose={() => setHistoryOpen(false)}
            onNewChat={() => {
              newChat()
              setHistoryOpen(false)
            }}
            onSelect={(id) => {
              setActiveId(id)
              setHistoryOpen(false)
            }}
            onRename={renameConversation}
            onDelete={deleteConversation}
          />
        )}

        <main className="stage">
          <button className="top-chevron" title={headerCollapsed ? 'Show header' : 'Hide header'} onClick={() => setHeaderCollapsed((c) => !c)}>
            <ChevronDown size={14} className={headerCollapsed ? 'flipped' : undefined} />
          </button>
          {!headerCollapsed && (
            <ChatHeader
              title={active?.title ?? 'New chat'}
              hasConversation={Boolean(active)}
              persona={current.persona}
              personaMenuOpen={personaMenuOpen}
              thinking={Boolean(active && streams[active.id])}
              userInitial={settings?.userName.trim().charAt(0).toUpperCase() || 'U'}
              onPersonaMenuChange={setPersonaMenuOpen}
              onPersonaChange={changePersona}
              onRename={(title) => active && renameConversation(active.id, title)}
              onShare={() => active && shareConversation(active.id)}
              onDelete={() => active && deleteConversation(active.id)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          )}
          <ChatView
            key={activeId ?? 'new'}
            conversation={active}
            stream={active ? streams[active.id] : undefined}
            settings={settings}
            loaded={loaded}
            mode={current.mode}
            model={current.model}
            quickPromptsOpen={quickPromptsOpen}
            onQuickPromptsChange={setQuickPromptsOpen}
            onModeChange={changeMode}
            onSend={send}
            onStop={() => active && stop(active.id)}
            onRegenerate={(messageId) => active && regenerate(active.id, messageId)}
            onEdit={(messageId, text) => active && editMessage(active.id, messageId, text)}
            onResend={(messageId) => active && resendFrom(active.id, messageId)}
            onFeedback={(messageId, feedback) => active && setFeedback(active.id, messageId, feedback)}
            onNotify={notify}
            onImprovePrompt={improvePrompt}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        </main>

        <button className="edge-handle" title="Activity" onClick={toggleActivity}>
          <span />
        </button>
        {activityOpen && <ActivityPanel items={notices} onClear={() => setNotices([])} onClose={() => setActivityOpen(false)} />}
      </div>

      {effects && <CursorGlow />}
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))} />
      {settingsOpen && settings && <SettingsModal settings={settings} onUpdate={updateSettings} onClose={() => setSettingsOpen(false)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
      {browserOpen && <BrowserPanel onClose={() => setBrowserOpen(false)} />}
    </div>
  )
}
