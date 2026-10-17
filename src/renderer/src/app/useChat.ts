/**
 * The conversation pipeline.
 *
 * Everything that touches messages — creating, sending, streaming, stopping, regenerating, editing, branching,
 * queuing, quiz, decision, native apps, visual arrivals, feedback, sharing — lives here. App.tsx calls this hook
 * once and passes the returned values down as props, exactly as before; no component below App changes at all.
 *
 * The hook takes the handful of things it cannot own: navigation (`go`), settings, and notification functions.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  Attachment,
  ChatMessage,
  ChatRequest,
  Conversation,
  Settings,
  StreamEvent,
  VisualArrival
} from '../../../shared/types'
import type { ChatDecision, ChatQuiz } from '../../../shared/types'
import { IMAGE_GEN_STATUS, isArtifactStatus } from '../../../shared/types'
import { DEFAULT_MODEL, isKnownModel, modelLabel } from '../../../shared/models'
import { AUTO_MODEL } from '../../../shared/modelRoute'
import { automationActive } from '../../../shared/automation'
import { copyText, newId, titleFromMessage } from '../lib/utils'
import { quizWanted, NOTHING_TO_GO_ON } from '../../../shared/quiz/ask'
import { readMessage, type Detail as ChooseDetail, type Reading as ChooseReading } from '../../../shared/choose/detect'
import { isAnswered, isHandedBack, wasKept, whyNot, type Answered as ChooseAnswer } from '../../../shared/choose/reply'
import type { Change as ChooseChange } from '../../../shared/choose/update'
import { dropBranch, parkTail, switchToBranch } from '../../../shared/conversationBranch'
import { imageMarkdown } from '../lib/imageEditor'
import { artifactChanged } from '../lib/artifactEvents'
import { MAX_QUEUED_MESSAGES } from '../lib/messageQueue'
import type { ChatQueue } from '../lib/messageQueue'
import type { NoticeKind, StreamState } from '../lib/notices'
import type { Intent as NavIntent } from '../../../shared/navigation'

const COUNTDOWN = /Retrying in \d+s/

interface PendingDelta {
  conversationId: string
  content: string
  reasoning: string
  reasoningMs?: number
}

interface DraftChat {
  model: string
  incognito: boolean
}

export interface ChatDeps {
  notify: (text: string, kind?: NoticeKind) => void
  logActivity: (text: string, kind: NoticeKind) => void
  go: (intent: NavIntent) => void
  /** Whether web search is on for the next message. */
  webSearch: boolean
  /** Current settings, for the user/assistant names and default model. Null until loaded. */
  settings: Settings | null
}

export interface ChatHandle {
  conversations: Conversation[]
  streams: Record<string, StreamState>
  activeId: string | null
  setActiveId: React.Dispatch<React.SetStateAction<string | null>>
  draft: DraftChat
  active: Conversation | undefined
  current: DraftChat
  queues: Record<string, ChatQueue>

  // Conversation CRUD
  send: (text: string, attachments: Attachment[], skipControlCheck?: boolean, browserTask?: boolean) => boolean
  sendRef: React.MutableRefObject<(text: string, attachments: Attachment[], skipControlCheck?: boolean, browserTask?: boolean) => boolean>
  stop: (conversationId: string) => void
  regenerate: (conversationId: string, messageId: string) => void
  editMessage: (conversationId: string, messageId: string, text: string) => void
  resendFrom: (conversationId: string, messageId: string) => void
  useBranch: (conversationId: string, branchId: string) => void
  forgetBranch: (conversationId: string, branchId: string) => void
  deleteConversation: (id: string) => void
  renameConversation: (id: string, title: string) => void
  archiveConversation: (id: string, archived: boolean) => void
  shareConversation: (id: string) => void
  setFeedback: (id: string, messageId: string, feedback: 'up' | 'down' | undefined) => void
  changeModel: (model: string) => void
  clearConversation: (id: string) => void
  newChat: () => void
  startChat: (incognito: boolean) => void
  toggleIncognito: () => void
  improvePrompt: (text: string) => Promise<string | null>

  // Queue
  removeQueued: (conversationId: string, itemId: string) => void
  clearQueue: (conversationId: string) => void
  resumeQueue: (conversationId: string) => void

  // Quiz
  setQuiz: (conversationId: string, messageId: string, next: ChatQuiz) => void
  addReply: (conversationId: string, content: string, extra?: { quiz?: ChatQuiz; decision?: ChatDecision }) => void

  // Decision
  changeDecision: (decisionId: string, changes: ChooseChange[]) => void
  explainDecision: (decisionId: string, of: ChooseDetail) => void
  keepDecision: (decisionId: string) => void

  // Native apps
  openNativeApp: (appId: string) => void

  // Browser confirmation / automation
  answerBrowserConfirmation: (messageId: string, confirmationId: string, approved: boolean) => void
  controlAutomation: (messageId: string, action: 'pause' | 'stop') => void

  // Loading
  loadConversations: (settings: Settings) => void
  persist: (id: string) => void

  // Low-level — used by App for togglePin and addImageToChat
  updateConversation: (id: string, fn: (c: Conversation) => Conversation) => void
  /** Ref-backed conversations, for checking state in callbacks without re-closing. */
  conversationsRef: React.MutableRefObject<Conversation[]>
  streamsRef: React.MutableRefObject<Record<string, StreamState>>
}

export function useChat(deps: ChatDeps): ChatHandle {
  const { notify, logActivity, go, webSearch, settings } = deps

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [streams, setStreams] = useState<Record<string, StreamState>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftChat>({ model: DEFAULT_MODEL, incognito: false })

  const conversationsRef = useRef<Conversation[]>([])
  const streamsRef = useRef<Record<string, StreamState>>({})
  const pendingRef = useRef(new Map<string, PendingDelta>())
  const frameRef = useRef<number | null>(null)

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

  // Profile switch: reload conversations
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

  // ---------- Deltas (one animation-frame flush instead of one per token) ----------

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

  // ---------- Queue ----------

  const [queues, setQueues] = useState<Record<string, ChatQueue>>({})
  const queuesRef = useRef<Record<string, ChatQueue>>({})
  const commitQueues = useCallback((fn: (q: Record<string, ChatQueue>) => Record<string, ChatQueue>) => {
    queuesRef.current = fn(queuesRef.current)
    setQueues(queuesRef.current)
  }, [])

  const settleQueueRef = useRef<(conversationId: string, outcome: 'done' | 'stopped' | 'error') => void>(() => undefined)

  // ---------- Automations ----------

  const [, setAutomations] = useState<Record<string, NonNullable<ChatMessage['automation']>>>({})

  // ---------- Suggestions ----------

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
        // No suggestions this time.
      }
    },
    [persist, updateConversation]
  )

  // ---------- Generation ----------

  const startGeneration = useCallback(
    (conversation: Conversation, history: ChatMessage[]) => {
      const conversationId = conversation.id
      const requestId = newId()
      const assistant: ChatMessage = { id: newId(), role: 'assistant', content: '', model: conversation.model, createdAt: Date.now() }
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
              setStatus(undefined)
            } else {
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
          case 'replace':
            // Anything still queued belongs to the text being replaced; it must land first or it would overwrite this.
            flushDeltas()
            patchAssistant((m) => ({ ...m, content: event.content, model: event.model ?? m.model }))
            break
          case 'artifact': {
            const { artifact } = event
            patchAssistant((m) => ({
              ...m,
              artifacts: [...(m.artifacts ?? []).filter((one) => one.ref.versionId !== artifact.ref.versionId || one.action !== artifact.action), artifact].slice(-12)
            }))
            artifactChanged(artifact.ref.artifactId)
            break
          }
          case 'app': {
            const { app } = event
            patchAssistant((m) => ({
              ...m,
              apps: [...(m.apps ?? []).filter((one) => one.instanceId !== app.instanceId), app].slice(-6)
            }))
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
        conversationId,
        incognito: Boolean(conversation.incognito),
        ...(replaced.length ? { replaced } : {})
      }
      window.api.sendChat(request).catch((err: unknown) => {
        finish({ error: err instanceof Error ? err.message : String(err) })
        settleQueueRef.current(conversationId, 'error')
      })
    },
    [commitStreams, flushDeltas, logActivity, persist, queueDelta, requestSuggestions, updateConversation, webSearch]
  )

  // ---------- Title ----------

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

  // ---------- Automation messages ----------

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

  // ---------- Send ----------

  const sendRef = useRef<(text: string, attachments: Attachment[], skipControlCheck?: boolean, browserTask?: boolean) => boolean>(() => false)

  const send = useCallback(
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

      const wantsQuiz = attachments.length === 0 && !browserTask ? quizWanted(content) : null
      if (wantsQuiz !== null && wantsQuiz.kind === 'card') {
        void offerQuiz(updated.id, wantsQuiz, conversation.messages)
        return true
      }

      const deciding =
        attachments.length === 0 && !browserTask
          ? readMessage(content, { hasOpen: conversation.messages.some((one) => one.decision !== undefined) })
          : ({ want: 'nothing' } as ChooseReading)
      if (deciding.want !== 'nothing') {
        void offerDecision(updated, history, content, deciding)
        return true
      }

      startGeneration(updated, history)
      if (!existing && content) void autoTitle(updated.id, content, updated.title)
      return true
    },
    // offerQuiz and offerDecision deliberately omitted — declared below, reached only when a message is actually sent
    [activeId, autoTitle, commitConversations, commitQueues, draft, handleAutomationMessage, notify, persist, startGeneration]
  )
  sendRef.current = send

  // ---------- Reply helpers ----------

  const addReply = useCallback(
    (conversationId: string, content: string, extra?: { quiz?: ChatQuiz; decision?: ChatDecision }) => {
      const message: ChatMessage = {
        id: newId(),
        role: 'assistant',
        content,
        createdAt: Date.now(),
        ...(extra?.quiz ? { quiz: extra.quiz } : {}),
        ...(extra?.decision ? { decision: extra.decision } : {})
      }
      updateConversation(conversationId, (c) => ({ ...c, messages: [...c.messages, message], updatedAt: Date.now() }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  const addVerdict = useCallback(
    (conversationId: string, answer: ChooseAnswer, extra: Partial<ChatDecision> = {}): void => {
      if (answer.stale === true) return
      addReply(conversationId, '', {
        decision: {
          verdict: answer.verdict,
          ...(answer.applied ? { applied: [...answer.applied] } : {}),
          ...(answer.refused ? { refused: [...answer.refused] } : {}),
          ...(answer.scenario ? { scenario: answer.scenario } : {}),
          ...(answer.difference ? { difference: answer.difference } : {}),
          ...extra
        }
      })
    },
    [addReply]
  )

  // ---------- Quiz ----------

  const offerQuiz = useCallback(
    async (conversationId: string, want: NonNullable<ReturnType<typeof quizWanted>>, before: ChatMessage[]) => {
      const lastReply = [...before].reverse().find((one) => one.role === 'assistant' && one.content.trim().length > 40)
      const source = want.pointsBack ? (lastReply?.content ?? '') : ''
      if (want.about === '' && source === '') {
        addReply(conversationId, NOTHING_TO_GO_ON)
        return
      }
      const made = (await window.api
        .writeQuiz({
          about: want.about,
          count: want.count,
          difficulty: want.difficulty,
          ...(source === '' ? {} : { source }),
          from: want.about === '' ? 'what we were just talking about' : want.about
        })
        .catch((error: unknown) => ({ problem: 'The quiz could not be written.', fix: error instanceof Error ? error.message : String(error), failed: 'threw' }))) as
        | { quiz?: ChatQuiz['quiz'] }
        | { problem: string; fix: string }

      if (!('quiz' in made) || made.quiz === undefined) {
        const why = 'problem' in made ? `${made.problem} ${made.fix}`.trim() : 'The quiz could not be written.'
        addReply(conversationId, why)
        return
      }
      addReply(conversationId, '', { quiz: { quiz: made.quiz, answers: [] } })
    },
    [addReply]
  )

  // ---------- Decision ----------

  const offerDecision = useCallback(
    async (conversation: Conversation, history: ChatMessage[], content: string, reading: ChooseReading): Promise<void> => {
      const conversationId = conversation.id
      const ordinary = (): void => startGeneration(conversation, history)

      if (reading.want === 'unsure') {
        addReply(conversationId, reading.ask)
        return
      }

      const ask = async (op: string, payload: Record<string, unknown>): Promise<unknown> =>
        window.api.choose(op, { conversationId, message: content, ...payload }).catch((error: unknown) => ({
          problem: 'That could not be worked out.',
          fix: error instanceof Error ? error.message : String(error),
          failed: 'threw'
        }))

      const said = history
        .filter((one) => one.role === 'user')
        .map((one) => one.content)
        .join('\n')
      const before = history
        .slice(-9, -1)
        .map((one) => `${one.role === 'user' ? 'They' : 'Orbis'}: ${one.content}`)
        .filter((one) => one.trim() !== '')

      const start = async (justDecide = false): Promise<void> => {
        const answer = await ask('start', {
          said,
          before,
          sort: reading.want === 'new' ? reading.sort : 'other',
          named: reading.want === 'new' ? [...reading.named] : [],
          ...(justDecide ? { justDecide: true } : {})
        })
        if (isAnswered(answer)) {
          addVerdict(conversationId, answer)
          return
        }
        if (isHandedBack(answer) || (reading.want === 'new' && reading.sure === 'probable')) {
          ordinary()
          return
        }
        addReply(conversationId, whyNot(answer))
      }

      if (reading.want === 'new') {
        await start()
        return
      }

      if (reading.want === 'just-decide') {
        const answer = await ask('just-decide', {})
        if (isAnswered(answer)) addVerdict(conversationId, answer)
        else ordinary()
        return
      }

      if (reading.want === 'detail') {
        const answer = await ask('explain', { of: reading.of })
        if (isAnswered(answer)) addVerdict(conversationId, answer, { showDetail: reading.of === 'everything' })
        else ordinary()
        return
      }

      if (reading.want === 'save') {
        const answer = await ask('keep', {})
        if (wasKept(answer)) {
          addReply(conversationId, `Kept, as "${answer.title}". Ask for it again any time.`)
        } else if (isHandedBack(answer) || isAnswered(answer)) {
          ordinary()
        } else {
          addReply(conversationId, whyNot(answer))
        }
        return
      }

      if (reading.want === 'what-if') {
        const answer = await ask('what-if', {})
        if (isAnswered(answer)) addVerdict(conversationId, answer)
        else if (isHandedBack(answer)) ordinary()
        else addReply(conversationId, whyNot(answer))
        return
      }

      // A follow-up.
      const answer = await ask('change', {})
      if (isAnswered(answer)) {
        addVerdict(conversationId, answer)
        return
      }
      if (isHandedBack(answer)) {
        await start()
        return
      }
      ordinary()
    },
    [addReply, addVerdict, startGeneration]
  )

  const changeDecision = useCallback(
    (decisionId: string, changes: ChooseChange[]): void => {
      const conversationId = activeId
      if (!conversationId || changes.length === 0) return
      void (async () => {
        const answer: unknown = await window.api.choose('adjust', { conversationId, decisionId, changes }).catch(() => null)
        if (answer && isAnswered(answer)) addVerdict(conversationId, answer)
        else if (answer && !isHandedBack(answer)) notify(whyNot(answer), 'warn')
      })()
    },
    [activeId, addVerdict, notify]
  )

  const explainDecision = useCallback(
    (decisionId: string, of: ChooseDetail): void => {
      const conversationId = activeId
      if (!conversationId) return
      void (async () => {
        const answer: unknown = await window.api.choose('explain', { conversationId, decisionId, of, message: '' }).catch(() => null)
        if (answer && isAnswered(answer)) addVerdict(conversationId, answer, { showDetail: of === 'everything' })
        else if (answer && !isHandedBack(answer)) notify(whyNot(answer), 'warn')
      })()
    },
    [activeId, addVerdict, notify]
  )

  const keepDecision = useCallback(
    (decisionId: string): void => {
      const conversationId = activeId
      if (!conversationId) return
      void (async () => {
        const answer: unknown = await window.api.choose('keep', { conversationId, decisionId }).catch(() => null)
        if (wasKept(answer)) notify(`Kept, as “${answer.title}”.`)
        else notify(whyNot(answer), 'warn')
      })()
    },
    [activeId, notify]
  )

  // ---------- Quiz state ----------

  const setQuiz = useCallback(
    (conversationId: string, messageId: string, next: ChatQuiz) => {
      updateConversation(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, quiz: next } : m))
      }))
      persist(conversationId)
    },
    [persist, updateConversation]
  )

  // ---------- Native apps ----------

  const openNativeApp = useCallback(
    (appId: string) => {
      void (async () => {
        const existing = activeId ? conversationsRef.current.find((c) => c.id === activeId) : undefined
        const now = Date.now()
        const conversation: Conversation =
          existing ?? { id: newId(), title: 'Labs', ...draft, messages: [], createdAt: now, updatedAt: now }

        const made = (await window.api
          .native('open', { appId, conversationId: conversation.id })
          .catch(() => null)) as { ok?: boolean; says?: string; reused?: boolean; instance?: { id: string; appVersion: number } } | null

        if (!made?.ok || !made.instance) {
          notify(made?.says ?? 'That app could not be opened.', 'warn')
          return
        }
        if (made.reused) {
          notify(made.says ?? 'It is already open in this conversation.')
          return
        }

        const message: ChatMessage = {
          id: newId(),
          role: 'assistant',
          content: '',
          createdAt: now,
          apps: [
            {
              appId,
              instanceId: made.instance.id,
              act: 'opened',
              appVersion: made.instance.appVersion,
              did: [],
              openedAt: 'expanded'
            }
          ]
        }
        const updated = { ...conversation, messages: [...conversation.messages, message], updatedAt: now }
        commitConversations(existing ? conversationsRef.current.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...conversationsRef.current])
        setActiveId(updated.id)
        persist(updated.id)
      })()
    },
    [activeId, commitConversations, draft, notify, persist]
  )

  // ---------- Visual Search arrival ----------

  const visualArrived = useCallback(
    (arrival: VisualArrival) => {
      go({ kind: 'chat' })
      if (arrival.what === 'lab') {
        if (arrival.appId) openNativeApp(arrival.appId)
        return
      }
      const image = typeof arrival.image === 'string' ? arrival.image : ''
      const now = Date.now()
      const existing = activeId ? conversationsRef.current.find((c) => c.id === activeId) : undefined
      const conversation: Conversation =
        existing ?? { id: newId(), title: arrival.title || 'From the screen', ...draft, messages: [], createdAt: now, updatedAt: now }

      const where = arrival.page?.title || arrival.page?.url || ''
      const question = (arrival.question ?? '').trim() || 'What is this?'
      const asked: ChatMessage = {
        id: newId(),
        role: 'user',
        content: where ? `${question}\n\n(selected on ${where})` : question,
        createdAt: now,
        ...(image ? { attachments: [{ name: 'selection.png', content: image, type: 'image' as const, mimeType: 'image/png' }] } : {})
      }
      const messages: ChatMessage[] = [asked]
      const answer = (arrival.answer ?? '').trim()
      if (answer !== '') messages.push({ id: newId(), role: 'assistant', content: answer, createdAt: now + 1 })

      const updated = { ...conversation, messages: [...conversation.messages, ...messages], updatedAt: now + 2 }
      commitConversations(existing ? conversationsRef.current.map((c) => (c.id === updated.id ? updated : c)) : [updated, ...conversationsRef.current])
      setActiveId(updated.id)
      persist(updated.id)
      notify('Brought over from the browser.')
    },
    [activeId, commitConversations, draft, go, notify, openNativeApp, persist]
  )

  useEffect(() => window.api.onVisualArrived(visualArrived), [visualArrived])

  // ---------- Queue runner ----------

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

  // ---------- Simple operations ----------

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

  const forgetBranch = useCallback(
    (conversationId: string, branchId: string) => {
      const conversation = conversationsRef.current.find((c) => c.id === conversationId)
      if (!conversation) return
      updateConversation(conversationId, (c) => ({ ...c, branches: dropBranch(conversation, branchId).branches }))
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

  const changeModel = useCallback(
    (model: string) => {
      if (!activeId) return setDraft((d) => ({ ...d, model }))
      updateConversation(activeId, (c) => ({ ...c, model }))
      persist(activeId)
    },
    [activeId, persist, updateConversation]
  )

  const clearConversation = useCallback(
    (id: string) => {
      stop(id)
      clearQueue(id)
      updateConversation(id, (c) => ({ ...c, messages: [], branches: undefined, updatedAt: Date.now() }))
      persist(id)
    },
    [clearQueue, persist, stop, updateConversation]
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
      go({ kind: 'chat' })
      const preferred = settings?.defaultModel ?? DEFAULT_MODEL
      setDraft({ model: isKnownModel(preferred) ? preferred : DEFAULT_MODEL, incognito })
    },
    [go, settings?.defaultModel]
  )

  const newChat = useCallback(() => startChat(false), [startChat])

  const toggleIncognito = useCallback(() => {
    const on = !(activeId ? conversationsRef.current.find((c) => c.id === activeId)?.incognito : draft.incognito)
    startChat(on)
    notify(on ? "Incognito chat on. It won't be saved or shown in your history." : 'Incognito chat off.')
  }, [activeId, draft.incognito, notify, startChat])

  // Incognito chats only exist while open
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

  // Browser confirmations
  const answerBrowserConfirmation = useCallback((messageId: string, confirmationId: string, approved: boolean) => {
    const stream = Object.values(streamsRef.current).find((s) => s.messageId === messageId)
    if (stream) void window.api.answerBrowserConfirmation(stream.requestId, confirmationId, approved)
  }, [])

  const controlAutomation = useCallback((messageId: string, action: 'pause' | 'stop') => {
    const stream = Object.values(streamsRef.current).find((s) => s.messageId === messageId)
    if (stream) void window.api.controlAutomation(stream.requestId, action)
  }, [])

  // ---------- Load conversations ----------

  const loadConversations = useCallback(
    (settings: Settings) => {
      void window.api.listConversations().then((list) => {
        commitConversations(list)
        setDraft((d) => ({ ...d, model: isKnownModel(settings.defaultModel) ? settings.defaultModel : DEFAULT_MODEL }))
      })
    },
    [commitConversations]
  )

  // ---------- Computed ----------

  const active = activeId ? conversations.find((c) => c.id === activeId) : undefined
  const current: DraftChat = active ? { model: active.model, incognito: Boolean(active.incognito) } : draft

  return {
    conversations,
    streams,
    activeId,
    setActiveId,
    draft,
    active,
    current,
    queues,
    send,
    sendRef,
    stop,
    regenerate,
    editMessage,
    resendFrom,
    useBranch,
    forgetBranch,
    deleteConversation,
    renameConversation,
    archiveConversation,
    shareConversation,
    setFeedback,
    changeModel,
    clearConversation,
    newChat,
    startChat,
    toggleIncognito,
    improvePrompt,
    removeQueued,
    clearQueue,
    resumeQueue,
    setQuiz,
    addReply,
    changeDecision,
    explainDecision,
    keepDecision,
    openNativeApp,
    answerBrowserConfirmation,
    controlAutomation,
    loadConversations,
    persist,
    updateConversation,
    conversationsRef,
    streamsRef
  }
}
