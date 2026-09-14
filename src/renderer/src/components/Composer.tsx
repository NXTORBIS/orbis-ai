import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Brain,
  ChevronDown,
  FileText,
  Files,
  Gauge,
  Mic,
  Plus,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  X,
  Zap
} from 'lucide-react'
import type { Attachment, ChatMode } from '../../../shared/types'
import { MODELS, modelLabel } from '../../../shared/models'
import { MODES } from '../../../shared/modes'
import { useDismiss } from '../lib/useDismiss'
import type { NoticeKind } from '../App'

const MODE_ICONS: Record<ChatMode, LucideIcon> = {
  auto: Sparkles,
  fast: Zap,
  advanced: Gauge,
  reasoning: Brain,
  custom: SlidersHorizontal
}

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
  { name: 'models', label: 'Models', description: 'List all models' },
  { name: 'modes', label: 'Modes', description: 'List all chat modes' }
]

interface Props {
  streaming: boolean
  mode: ChatMode
  model: string
  quickPromptsOpen: boolean
  onQuickPromptsChange(open: boolean): void
  onModeChange(mode: ChatMode, model?: string): void
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
  const { streaming, mode, model } = props
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [modelsOpen, setModelsOpen] = useState(false)
  const [attachMenuOpen, setAttachMenuOpen] = useState(false)
  const [commandsOpen, setCommandsOpen] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<typeof SLASH_COMMANDS>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const commandsRef = useRef<HTMLDivElement>(null)
  useDismiss(menuRef, menuOpen, () => {
    setMenuOpen(false)
    setModelsOpen(false)
  })
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
      case 'modes':
        props.onNotify(`Available modes:\n${MODES.map((m) => `• ${m.label}`).join('\n')}`)
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


  const ModeIcon = MODE_ICONS[mode]
  const currentModeLabel = mode === 'custom' ? modelLabel(model) : (MODES.find((m) => m.id === mode)?.label ?? 'Auto')

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
              <FileText size={13} />
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

        <div className="composer-row">
          <div className="composer-tools">
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
                      props.onNotify('Image upload is coming soon.')
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
            placeholder="Ask anything (type / for commands)"
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

          <div className="composer-tools">
            <button type="button" className="tool-btn" title="Voice input" onClick={() => props.onNotify('Voice input is coming soon.')}>
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

        {/* Model selector - bottom right, subtle */}
        <div className="popover-anchor mode-selector-corner" ref={menuRef}>
          <button
            type="button"
            className="mode-pill-subtle"
            title="Choose a model"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ModeIcon size={11} />
            <ChevronDown size={10} />
          </button>
          {menuOpen && (
            <div className="popover glass mode-menu" role="menu">
              {MODES.map((m) => {
                const Icon = MODE_ICONS[m.id]
                const selected = m.id === mode
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`menu-item mode-item${selected ? ' selected' : ''}`}
                    onClick={() => {
                      if (m.id === 'custom') return setModelsOpen((o) => !o)
                      props.onModeChange(m.id)
                      setMenuOpen(false)
                    }}
                  >
                    <Icon size={15} />
                    <span className="menu-text">
                      <b>{m.label}</b>
                      <small>{m.id === 'custom' && selected ? modelLabel(model) : m.description}</small>
                    </span>
                    {selected && <span className="mode-dot" />}
                  </button>
                )
              })}
              {modelsOpen && (
                <div className="mode-models">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className={`menu-item${mode === 'custom' && m.id === model ? ' selected' : ''}`}
                      onClick={() => {
                        props.onModeChange('custom', m.id)
                        setMenuOpen(false)
                        setModelsOpen(false)
                      }}
                    >
                      <span className="menu-text">
                        <b>{m.label}</b>
                        <small>{m.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      <p className="disclaimer">AI can make mistakes. Check important info.</p>
    </div>
  )
}
