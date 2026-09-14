import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, FileText, Files, Mic, Plus, Send, Square, Upload, X } from 'lucide-react'
import type { Attachment } from '../../../shared/types'
import { MODELS, modelLabel } from '../../../shared/models'
import { useDismiss } from '../lib/useDismiss'
import { useVoiceInput } from '../hooks/useVoiceInput'
import type { NoticeKind } from '../App'

const QUICK_PROMPTS = [
  { label: 'Summarize a document', text: 'Summarize the attached document in five bullet points.' },
  { label: 'Explain code', text: 'Explain what this code does, step by step:\n\n' },
  { label: 'Plan a project', text: 'Help me plan a project. Ask me clarifying questions first.' },
  { label: 'Compare options', text: 'Compare these options in a table with pros and cons: ' },
  { label: 'Draft an email', text: 'Draft a concise, friendly email about: ' },
  { label: 'Debug an error', text: 'Help me debug this error:\n\n' }
]

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
  const { isRecording, isTranscribing, startRecording, stopRecording } = useVoiceInput()
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

  const canSend = !streaming && (text.trim() !== '' || attachments.length > 0)

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
    if (props.onSend(text, attachments)) {
      setText('')
      setAttachments([])
      const composer = document.querySelector('.composer') as HTMLElement | null
      if (composer) {
        composer.classList.add('submitted')
        setTimeout(() => {
          composer.classList.remove('submitted')
        }, 600)
      }
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

      <form
        className={`composer${streaming ? ' busy' : ''}`}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
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
                onClick={() => setAttachMenuOpen((o) => !o)}
              >
                <Plus size={16} />
              </button>
              {attachMenuOpen && (
                <div className="popover glass attach-menu" role="menu">
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

          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            placeholder="Message Orbis"
            onChange={(e) => setText(e.target.value)}
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
              } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape' && streaming) {
                e.preventDefault()
                props.onStop()
              }
            }}
          />

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

            {streaming ? (
              <button type="button" className="send-btn stop" title="Stop generating (Esc)" onClick={props.onStop}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className={`send-btn${canSend ? ' ready' : ''}`} title="Send (Enter)" disabled={!canSend}>
                <Send size={14} />
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
