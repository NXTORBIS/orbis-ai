import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileText, Files, ListPlus, Mic, Paperclip, Pencil, Play, Plus, Send, Square, Upload, X } from 'lucide-react'
import { MAX_QUEUED_MESSAGES } from '../lib/messageQueue'
import type { ChatQueue, QueuedMessage } from '../lib/messageQueue'
import type { Attachment } from '../../../shared/types'
import { MODELS, modelLabel } from '../../../shared/models'
import { useDismiss } from '../lib/useDismiss'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { clearComposerStart, peekComposerStart, rememberComposerStart } from '../lib/composerGlide'
import type { NoticeKind } from '../App'

const QUICK_PROMPTS = [
  { label: 'Summarize a document', text: 'Summarize the attached document in five bullet points.' },
  { label: 'Explain code', text: 'Explain what this code does, step by step:\n\n' },
  { label: 'Plan a project', text: 'Help me plan a project. Ask me clarifying questions first.' },
  { label: 'Compare options', text: 'Compare these options in a table with pros and cons: ' },
  { label: 'Draft an email', text: 'Draft a concise, friendly email about: ' },
  { label: 'Debug an error', text: 'Help me debug this error:\n\n' }
]

const PLACEHOLDER_HINTS = [
  'Message Orbis',
  'Ask Orbis anything…',
  'Draw a neon city at night…',
  'Summarize an article for me…',
  'Plan a productive week…',
  'Explain a tricky bit of code…'
]

/** Types, holds and erases placeholder hints in turn; shows the plain first hint when inactive. */
function useTypewriterPlaceholder(active: boolean): string {
  const [shown, setShown] = useState(PLACEHOLDER_HINTS[0])
  useEffect(() => {
    setShown(PLACEHOLDER_HINTS[0])
    if (!active) return
    let hint = 0
    let length = PLACEHOLDER_HINTS[0].length
    let deleting = false
    let timer = 0
    const tick = (): void => {
      const full = PLACEHOLDER_HINTS[hint]
      if (!deleting && length >= full.length) {
        deleting = true
        timer = window.setTimeout(tick, 2400)
        return
      }
      if (deleting && length <= 0) {
        deleting = false
        hint = (hint + 1) % PLACEHOLDER_HINTS.length
        timer = window.setTimeout(tick, 380)
        return
      }
      length += deleting ? -1 : 1
      setShown(PLACEHOLDER_HINTS[hint].slice(0, length))
      timer = window.setTimeout(tick, deleting ? 26 : 48 + Math.random() * 45)
    }
    timer = window.setTimeout(tick, 2400)
    return () => window.clearTimeout(timer)
  }, [active])
  return shown
}

const SLASH_COMMANDS = [
  { name: 'help', label: 'Help', description: 'Show available commands' },
  { name: 'new', label: 'New Chat', description: 'Start a new conversation' },
  { name: 'clear', label: 'Clear', description: 'Clear all messages' },
  { name: 'search', label: 'Search', description: 'Search conversations' },
  { name: 'settings', label: 'Settings', description: 'Open settings' },
  { name: 'models', label: 'Models', description: 'List all models' }
]

interface Props {
  streaming: boolean
  model: string
  /** Likely next message for the latest reply, shown as ghost text. */
  prediction?: string
  /** Completes the message being typed from the chat's context; resolves to the full message or null. */
  onCompleteDraft?(draft: string): Promise<string | null>
  /** Changes whenever the chat context changes, so cached completions are refreshed. */
  draftContextKey?: string
  /** Orbis's Visual effects setting; the animated placeholder follows it. */
  effects: boolean
  /** Messages waiting to be sent after the current reply. */
  queue?: ChatQueue
  onRemoveQueued(itemId: string): void
  onClearQueue(): void
  onResumeQueue(): void
  quickPromptsOpen: boolean
  onQuickPromptsChange(open: boolean): void
  onModelChange(model: string): void
  /** Returns false when nothing was sent, so the draft is kept. */
  onSend(text: string, attachments: Attachment[]): boolean
  onStop(): void
  onNotify(text: string, kind?: NoticeKind): void
  onImprovePrompt(text: string): Promise<string | null>
  onNewChat?(): void
  onSearch?(): void
  onSettings?(): void
}

export default function Composer(props: Props): React.JSX.Element {
  const { streaming, model } = props
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<typeof SLASH_COMMANDS>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const commandsRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [trail, setTrail] = useState<number | null>(null)
  const { isRecording, isTranscribing, startRecording, stopRecording } = useVoiceInput()

  // The first message swaps the centred composer for one docked at the bottom; glide from the old spot to the new one.
  useLayoutEffect(() => {
    const form = formRef.current
    const from = peekComposerStart()
    if (!form || !from) return
    const to = form.getBoundingClientRect()
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top - to.top
    // Follows Orbis's own Visual effects setting; Windows reports reduced motion whenever its animation effects are off.
    const effectsOff = !document.querySelector('.hud.effects')
    if (effectsOff || Math.abs(dy) < 24) {
      clearComposerStart()
      return
    }
    setTrail(Math.round(Math.abs(dy)))
    const glide = form.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: 'translate(0, 8px) scale(0.996)', boxShadow: '0 0 34px rgba(63, 216, 255, 0.3)', offset: 0.84 },
        { transform: 'translate(0, 0)' }
      ],
      // Gentle ease in and out so the descent reads as a slow glide rather than a snap.
      { duration: 1600, easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)' }
    )
    let landTimer = 0
    glide.addEventListener('finish', () => {
      clearComposerStart()
      setTrail(null)
      form.classList.add('landed')
      landTimer = window.setTimeout(() => form.classList.remove('landed'), 900)
    })
    return () => {
      glide.cancel()
      window.clearTimeout(landTimer)
    }
  }, [])
  useDismiss(menuRef, menuOpen, () => setMenuOpen(false))
  useDismiss(attachMenuRef, attachMenuOpen, () => {
    setAttachMenuOpen(false)
  })
  useDismiss(commandsRef, commandsOpen, () => {
    setCommandsOpen(false)
  })

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [text])

  useEffect(() => textareaRef.current?.focus(), [])

  // Other panels (e.g. the browser's element picker) hand text to the message box this way.
  useEffect(() => {
    const onCompose = (e: Event): void => {
      const detail = (e as CustomEvent<unknown>).detail
      if (typeof detail !== 'string' || !detail) return
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${detail}` : detail))
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    window.addEventListener('orbis:compose', onCompose)
    return () => window.removeEventListener('orbis:compose', onCompose)
  }, [])

  // Detect and filter slash commands
  useEffect(() => {
    const lines = text.split('\n')
    const firstLine = lines[0]
    if (firstLine.startsWith('/')) {
      const query = firstLine.slice(1).toLowerCase()
      const filtered = SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(query))
      setFilteredCommands(filtered)
      setCommandsOpen(filtered.length > 0)
      setSelectedCommandIndex(0)
    } else {
      setCommandsOpen(false)
      setFilteredCommands([])
    }
  }, [text])

  // While Orbis is replying, sending adds the message to the queue instead.
  const canSend = text.trim() !== '' || attachments.length > 0

  const editQueued = (item: QueuedMessage): void => {
    props.onRemoveQueued(item.id)
    setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${item.text}` : item.text))
    if (item.attachments.length) setAttachments((current) => [...current, ...item.attachments].slice(0, 10))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const [dismissedPrediction, setDismissedPrediction] = useState<string | null>(null)
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  const extendsText = (candidate: string | null | undefined, typed: string): candidate is string =>
    !!candidate && candidate.length > typed.length && candidate.toLowerCase().startsWith(typed.toLowerCase())

  // Live completion of what's being typed: fetched once typing pauses, applied whenever it arrives if it still fits.
  const [liveCompletion, setLiveCompletion] = useState<string | null>(null)
  const textRef = useRef(text)
  textRef.current = text
  const liveRef = useRef(liveCompletion)
  liveRef.current = liveCompletion
  const completeDraftRef = useRef(props.onCompleteDraft)
  completeDraftRef.current = props.onCompleteDraft
  const completionCache = useRef(new Map<string, string | null>())
  useEffect(() => completionCache.current.clear(), [props.draftContextKey])
  useEffect(() => {
    const draft = text
    if (!completeDraftRef.current || draft.trim().length < 3 || draft.length > 600 || draft.startsWith('/') || draft.includes('\n')) return
    if (extendsText(liveRef.current, draft)) return
    const cached = completionCache.current.get(draft)
    if (cached !== undefined) {
      setLiveCompletion(cached)
      return
    }
    const timer = window.setTimeout(() => {
      if (extendsText(liveRef.current, textRef.current)) return
      completeDraftRef.current?.(draft)
        .then((full) => {
          completionCache.current.set(draft, full)
          if (extendsText(full, textRef.current)) setLiveCompletion(full)
        })
        .catch(() => undefined)
    }, 450)
    return () => window.clearTimeout(timer)
  }, [text])

  const replyPrediction = props.prediction && !streaming && attachments.length === 0 ? props.prediction : undefined
  // Ghost text continues whatever the user has typed: the reply's prediction while it still matches, otherwise the live completion.
  const prediction = [replyPrediction, text.trim() ? liveCompletion : null].find(
    (candidate): candidate is string => extendsText(candidate, text) && candidate !== dismissedPrediction
  )
  const ghostRest = prediction && !commandsOpen && caretAtEnd ? prediction.slice(text.length) : ''
  const placeholder = useTypewriterPlaceholder(props.effects && text === '' && !ghostRest)

  const acceptPrediction = (): void => {
    if (!prediction) return
    // Keep the user's own characters and append the rest, so the result is ordinary editable text.
    const full = text + prediction.slice(text.length)
    setText(full)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(full.length, full.length)
    })
  }

  const executeCommand = (commandName: string): void => {
    setText('')
    setCommandsOpen(false)

    switch (commandName) {
      case 'help':
        props.onNotify(`Available commands:\n${SLASH_COMMANDS.map((c) => `/${c.name} - ${c.description}`).join('\n')}`)
        break
      case 'new':
        props.onNewChat?.()
        break
      case 'clear':
        // This would need to be implemented in the parent component
        props.onNotify('Chat cleared', 'info')
        break
      case 'search':
        props.onSearch?.()
        break
      case 'settings':
        props.onSettings?.()
        break
      case 'models':
        props.onNotify(`Available ORION models:\n${MODELS.map((m) => `• ${m.label}`).join('\n')}`)
        break
    }
  }

  const submit = (): void => {
    if (commandsOpen && filteredCommands.length > 0) {
      executeCommand(filteredCommands[selectedCommandIndex].name)
      return
    }

    if (!canSend) return
    const form = formRef.current
    // Only the centred composer of an empty chat glides; once docked at the bottom it stays put.
    if (form?.closest('.stage-content')?.querySelector('.empty-state')) rememberComposerStart(form.getBoundingClientRect())
    if (props.onSend(text, attachments)) {
      setText('')
      setAttachments([])
    } else {
      clearComposerStart()
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const composer = document.querySelector('.composer') as HTMLElement | null
      if (!composer) return
      if (streaming) {
        composer.classList.add('thinking')
      } else {
        composer.classList.remove('thinking')
      }
    }, 0)
    return () => clearTimeout(timer)
  }, [streaming])

  const attach = async (): Promise<void> => {
    const picked = await window.api.pickTextFiles()
    if (picked.attachments.length) setAttachments((current) => [...current, ...picked.attachments].slice(0, 10))
    if (picked.skipped.length) props.onNotify(`Skipped ${picked.skipped.join(', ')}: not a text file or larger than 200 KB.`, 'warn')
  }

  const attachImages = async (): Promise<void> => {
    const picked = await window.api.pickImages()
    if (picked.attachments.length) setAttachments((current) => [...current, ...picked.attachments].slice(0, 10))
    if (picked.skipped.length) props.onNotify(`Skipped ${picked.skipped.join(', ')}: not an image or larger than 200 KB.`, 'warn')
  }

  const toggleVoiceInput = async (): Promise<void> => {
    if (isRecording) {
      const transcribedText = await stopRecording()
      if (transcribedText) {
        setText((current) => (current ? `${current} ${transcribedText}` : transcribedText))
      } else {
        props.onNotify('Transcription failed. Please try again.', 'warn')
      }
    } else {
      try {
        await startRecording()
      } catch (err) {
        props.onNotify('Microphone access denied.', 'warn')
      }
    }
  }


  const currentModelLabel = modelLabel(model)

  const [menuPlacement, setMenuPlacement] = useState({ down: false, maxHeight: 320 })
  const [attachPlacement, setAttachPlacement] = useState({ down: false, offset: 0 })

  // Offsets are measured from the + button to the composer's edge, so the menu clears the whole composer.
  const openAttachMenu = (): void => {
    const anchor = attachMenuRef.current?.getBoundingClientRect()
    const composer = attachMenuRef.current?.closest('.composer')?.getBoundingClientRect()
    if (anchor && composer) {
      const top = (document.querySelector('.system-bar')?.getBoundingClientRect().bottom ?? 0) + 12
      const down = composer.top - 10 - top < 110
      setAttachPlacement({ down, offset: Math.round(down ? composer.bottom - anchor.top + 10 : anchor.bottom - composer.top + 10) })
    }
    setAttachMenuOpen(true)
  }

  // The composer sits mid-screen in an empty chat, so open the menu toward whichever side has room.
  const openModelMenu = (): void => {
    const rect = menuRef.current?.getBoundingClientRect()
    if (rect) {
      const top = (document.querySelector('.chat-header')?.getBoundingClientRect().bottom ?? 0) + 12
      const above = rect.top - 12 - top
      const below = window.innerHeight - rect.bottom - 24
      const down = above < 300 && below > above
      setMenuPlacement({ down, maxHeight: Math.round(Math.max(160, Math.min(440, down ? below : above))) })
    }
    setMenuOpen(true)
  }

  return (
    <div className="composer-dock">
      {props.quickPromptsOpen && (
        <div className="quick-prompts">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.label}
              className="quick-prompt glass"
              onClick={() => {
                setText(p.text)
                props.onQuickPromptsChange(false)
                textareaRef.current?.focus()
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachment-row">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`} className="attachment-chip glass">
              {a.type === 'image' ? (
                <img src={`data:${a.mimeType || 'image/jpeg'};base64,${a.content}`} alt={a.name} style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
              ) : (
                <FileText size={13} />
              )}
              <span className="truncate">{a.name}</span>
              <button title="Remove" onClick={() => setAttachments((current) => current.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {props.queue && props.queue.items.length > 0 && (
        <div className="queue-panel" aria-label="Queued messages">
          <div className="queue-head">
            <span className={`hud-label${props.queue.paused ? ' paused' : ''}`}>
              {props.queue.paused ? 'Queue paused' : 'Up next'} · {props.queue.items.length}/{MAX_QUEUED_MESSAGES}
            </span>
            <div className="queue-head-actions">
              {props.queue.paused && !streaming && (
                <button type="button" className="queue-btn primary" onClick={props.onResumeQueue}>
                  <Play size={11} />
                  Resume
                </button>
              )}
              <button type="button" className="queue-btn" onClick={props.onClearQueue}>
                Clear
              </button>
            </div>
          </div>
          <ol className="queue-list">
            {props.queue.items.map((item, index) => (
              <li key={item.id} className={`queue-item${index === 0 ? ' next' : ''}`}>
                <span className="queue-index">{index + 1}</span>
                <span className="queue-text truncate" title={item.text}>
                  {item.text || item.attachments.map((a) => a.name).join(', ')}
                </span>
                {item.attachments.length > 0 && (
                  <span className="queue-attach" title={item.attachments.map((a) => a.name).join(', ')}>
                    <Paperclip size={12} />
                    {item.attachments.length}
                  </span>
                )}
                <button type="button" className="icon-btn small" title="Edit" aria-label="Edit queued message" onClick={() => editQueued(item)}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="icon-btn small" title="Remove" aria-label="Remove queued message" onClick={() => props.onRemoveQueued(item.id)}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <form
        ref={formRef}
        className={`composer${streaming ? ' busy' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {trail !== null && <span className="composer-trail" style={{ height: trail }} aria-hidden="true" />}
        <svg className="composer-beam" aria-hidden="true">
          <rect className="beam-tail" x="0" y="0" width="100%" height="100%" rx="22" ry="22" pathLength={100} />
          <rect className="beam-head" x="0" y="0" width="100%" height="100%" rx="22" ry="22" pathLength={100} />
        </svg>

        <div className="composer-input-wrapper">
          <div className="composer-tools left-tools">
            <div className="popover-anchor" ref={attachMenuRef}>
              <button
                type="button"
                className="tool-btn plus-btn"
                title="Attach files"
                onClick={() => (attachMenuOpen ? setAttachMenuOpen(false) : openAttachMenu())}
              >
                <Plus size={16} />
              </button>
              {attachMenuOpen && (
                <div
                  className={`popover glass attach-menu${attachPlacement.down ? ' down' : ''}`}
                  style={attachPlacement.down ? { top: attachPlacement.offset } : { bottom: attachPlacement.offset }}
                  role="menu"
                >
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      void attach()
                      setAttachMenuOpen(false)
                    }}
                  >
                    <Files size={15} />
                    <span>Attach Files</span>
                  </button>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={() => {
                      void attachImages()
                      setAttachMenuOpen(false)
                    }}
                  >
                    <Upload size={15} />
                    <span>Upload Image</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="composer-field">
          {ghostRest && (
            <div className="composer-ghost" aria-hidden="true">
              <span>{text}</span>
              <span className="ghost-rest">{ghostRest}</span>
              <kbd>Tab</kbd>
            </div>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder={ghostRest ? '' : placeholder}
            aria-label="Message Orbis"
            aria-description={ghostRest ? `Suggestion: ${prediction}. Press Tab to use it.` : undefined}
            onChange={(e) => setText(e.target.value)}
            onSelect={(e) => {
              const el = e.currentTarget
              setCaretAtEnd(el.selectionStart === el.value.length && el.selectionEnd === el.value.length)
            }}
            onKeyDown={(e) => {
              if (commandsOpen && filteredCommands.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSelectedCommandIndex((i) => (i + 1) % filteredCommands.length)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSelectedCommandIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length)
                } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCommandsOpen(false)
                }
              } else if (ghostRest && e.key === 'Tab' && !e.shiftKey) {
                e.preventDefault()
                acceptPrediction()
              } else if (ghostRest && text === '' && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                // An empty Enter would send nothing, so it fills in the prediction instead.
                e.preventDefault()
                acceptPrediction()
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape' && ghostRest) {
                e.preventDefault()
                setDismissedPrediction(prediction ?? null)
              } else if (e.key === 'Escape' && streaming) {
                e.preventDefault()
                props.onStop()
              }
            }}
          />
          </div>

          <div className="composer-tools right-tools">
            <div className="popover-anchor mode-selector-corner" ref={menuRef}>
              <button
                type="button"
                className="mode-pill-subtle"
                title="Choose a model"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => (menuOpen ? setMenuOpen(false) : openModelMenu())}
              >
                <span className="model-label">{currentModelLabel}</span>
                <ChevronDown size={11} />
              </button>
              {menuOpen && (
                <div className={`popover glass mode-menu${menuPlacement.down ? ' down' : ''}`} style={{ maxHeight: menuPlacement.maxHeight }} role="menu">
                  {MODELS.map((m) => {
                    const selected = m.id === model
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={`menu-item mode-item model-item${selected ? ' selected' : ''}`}
                        onClick={() => {
                          props.onModelChange(m.id)
                          setMenuOpen(false)
                        }}
                      >
                        <span className="menu-text">
                          <b>{m.label}</b>
                          <small>{m.description}</small>
                        </span>
                        {selected && <Check size={15} className="model-check" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <button
              type="button"
              className={`tool-btn${isRecording ? ' recording' : ''}${isTranscribing ? ' transcribing' : ''}`}
              title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Start voice input'}
              onClick={() => void toggleVoiceInput()}
              disabled={isTranscribing}
            >
              <Mic size={16} />
            </button>

            {(!streaming || canSend) && (
              <button
                type="submit"
                className={`send-btn${canSend ? ' ready' : ''}${streaming ? ' queue' : ''}`}
                title={streaming ? 'Add to queue (Enter)' : 'Send (Enter)'}
                aria-label={streaming ? 'Add to queue' : 'Send'}
                disabled={!canSend}
              >
                {streaming ? <ListPlus size={15} /> : <Send size={14} />}
              </button>
            )}
            {streaming && (
              <button type="button" className="send-btn stop" title="Stop generating (Esc)" aria-label="Stop" onClick={props.onStop}>
                <Square size={12} fill="currentColor" />
              </button>
            )}
          </div>
        </div>

        {commandsOpen && filteredCommands.length > 0 && (
          <div className="slash-commands glass" ref={commandsRef} role="listbox">
            {filteredCommands.map((cmd, idx) => (
              <button
                key={cmd.name}
                type="button"
                className={`slash-command${idx === selectedCommandIndex ? ' selected' : ''}`}
                onClick={() => {
                  executeCommand(cmd.name)
                }}
                role="option"
                aria-selected={idx === selectedCommandIndex}
              >
                <div className="cmd-info">
                  <span className="cmd-name">/{cmd.name}</span>
                  <span className="cmd-desc">{cmd.description}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </form>

      <p className="disclaimer">AI can make mistakes. Check important info.</p>
    </div>
  )
}
