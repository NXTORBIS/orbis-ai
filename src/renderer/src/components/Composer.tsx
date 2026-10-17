import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useChatPrediction } from '../lib/useChatPrediction'
import { Check, FileText, Files, ListPlus, Mic, Paperclip, Pencil, Play, Plus, Send, Square, Upload, X } from 'lucide-react'
import { MAX_QUEUED_MESSAGES } from '../lib/messageQueue'
import { SLASH_COMMANDS, slashCommandsFor } from '../lib/commands'
import { featureState, type VisibilityChoice } from '../../../shared/featureVisibility'
import type { ChatQueue, QueuedMessage } from '../lib/messageQueue'
import type { Attachment } from '../../../shared/types'
import { pictureSrc } from '../../../shared/attachments'
import { CHAT_MODELS, modelLabel } from '../../../shared/models'
import { PUSH_TO_TALK_EVENT } from '../../../shared/voiceInput'
import { useDismiss } from '../lib/useDismiss'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { clearComposerStart, peekComposerStart, rememberComposerStart } from '../lib/composerGlide'
import type { NoticeKind } from '../lib/notices'

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


interface Props {
  streaming: boolean
  model: string
  /** Likely next message for the latest reply, shown as ghost text. */
  prediction?: string
  /** Completes the message being typed from the chat's context; resolves to the full message or null. */
  onCompleteDraft?(draft: string): Promise<string | null>
  /** Changes whenever the chat context changes, so cached completions are refreshed. */
  draftContextKey?: string
  /**
   * Told whether there is anything of the person's own in the box.
   *
   * This is what takes the chips out from under the last reply the moment somebody starts writing. They were there
   * to answer "what now?", and somebody who is typing has answered it.
   */
  onDraftStarted?(started: boolean): void
  /** Orbis's Visual effects setting; the animated placeholder follows it. */
  effects: boolean
  /**
   * Which features this person has showing, so the "/" menu offers nothing that is switched off.
   *
   * Handed in rather than read here. The window reads the choice once and every part of it asks the same copy;
   * a second reader is how two halves of Orbis end up disagreeing about which features exist.
   *
   * Null while Orbis is still reading the file. That answers the essentials only, which is the safe direction: a
   * menu briefly short is a menu, and a menu offering a screen that is switched off is a broken promise.
   */
  visibility: VisibilityChoice | null
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
  /** Runs a slash command such as "/clear" or "/rename Trip ideas". */
  onCommand(name: string, args: string): void
  /**
   * An app opened from Search Labs.
   *
   * The composer does not open it itself: the conversation owns the reference, because a card has to belong to a
   * message for the chat to find it again after a restart.
   */
  onOpenApp?(appId: string): void
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
  const voice = useVoiceInput('chat')

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
      setText((current) => {
      const next = current.trim() ? `${current.trimEnd()}\n\n${detail}` : detail
      predictor.changed(next, 'pasted')
      return next
    })
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    window.addEventListener('orbis:compose', onCompose)
    return () => window.removeEventListener('orbis:compose', onCompose)
  }, [])

  /**
   * The commands this person really has, which is not every command Orbis has.
   *
   * Several slash commands are a door onto one of the optional screens, and a door onto a screen somebody has
   * switched off is the clutter they were trying to get rid of -- in the one place they cannot avoid looking at,
   * the box they type in. So the menu is built from `slashCommandsFor`, which asks `isVisible` about each one.
   */
  const commands = useMemo(() => slashCommandsFor(props.visibility), [props.visibility])

  // The "/" menu lists matching commands until the command is typed out and followed by a space.
  useEffect(() => {
    const typed = /^\/(\S*)$/.exec(text)
    if (typed) {
      const query = typed[1].toLowerCase()
      const filtered = commands.filter((cmd) => cmd.name.startsWith(query))
      setFilteredCommands(filtered)
      setCommandsOpen(filtered.length > 0)
      setSelectedCommandIndex(0)
    } else {
      setCommandsOpen(false)
      setFilteredCommands([])
    }
  }, [text, commands])

  // While Orbis is replying, sending adds the message to the queue instead.
  const canSend = text.trim() !== '' || attachments.length > 0

  const editQueued = (item: QueuedMessage): void => {
    props.onRemoveQueued(item.id)
    setText((current) => {
      const next = current.trim() ? `${current.trimEnd()}\n\n${item.text}` : item.text
      predictor.changed(next, 'pasted')
      return next
    })
    if (item.attachments.length) setAttachments((current) => [...current, ...item.attachments].slice(0, 10))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const [caretAtEnd, setCaretAtEnd] = useState(true)

  /*
   * What Orbis thinks comes next, and when it stops being true.
   *
   * One state, in `shared/chatPrediction.ts`, which is plain functions and tested without a screen. Three things
   * used to be wrong here and are now impossible by construction: an answer asked for text that has since changed
   * could still be shown (it fitted, so it looked valid); the faded text stayed on screen while the next guess was
   * fetched; and a taken guess, still sitting in its props, continued the longer text it had just made and could be
   * taken again.
   */
  const guessing = Boolean(streaming) || attachments.length > 0
  const predictor = useChatPrediction({
    draft: text,
    replyPrediction: props.prediction,
    complete: props.onCompleteDraft,
    contextKey: `${props.draftContextKey ?? ''}:${model}`,
    suspended: guessing
  })

  /** Sets the box and tells the guess about it in one place, so no change can slip past it. */
  const changeText = (next: string, reason: 'typed' | 'pasted' | 'cleared' = 'typed'): void => {
    setText(next)
    predictor.changed(next, reason)
  }

  /*
   * Telling the conversation that there is a draft.
   *
   * This is what takes the chips out from under the last reply the moment somebody starts writing. It is sent from
   * here because this is the only place that knows what is in the box, and it is sent on the change itself rather
   * than from an effect, so the chips go on the first character instead of a frame later.
   */
  const draftStartedRef = useRef(false)
  useEffect(() => {
    const started = text !== ''
    if (started === draftStartedRef.current) return
    draftStartedRef.current = started
    props.onDraftStarted?.(started)
  }, [text, props.onDraftStarted])
  // The box going away is the end of the draft as far as anything else is concerned.
  useEffect(
    () => () => {
      if (draftStartedRef.current) props.onDraftStarted?.(false)
    },
    []
  )

  const ghostRest = commandsOpen || !caretAtEnd ? '' : predictor.ghost
  const placeholder = useTypewriterPlaceholder(props.effects && text === '' && !ghostRest)

  /** Takes the guess. One press, one acceptance: the guess is gone before this returns. */
  const acceptPrediction = (): void => {
    const full = predictor.accept()
    if (full === null) return
    setText(full)
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      // At the end of the whole thing, never inside what was just filled in.
      el.setSelectionRange(full.length, full.length)
    })
  }

  /** Runs a slash command, or fills it in when it still needs text after it. */
  const executeCommand = (commandName: string, args = ''): void => {
    const command = SLASH_COMMANDS.find((c) => c.name === commandName)
    if (!command) return
    setCommandsOpen(false)

    /*
     * Typed out in full, for a screen that is switched off.
     *
     * Looked up in the whole list rather than the shortened one on purpose. The command still exists and somebody
     * has clearly just used it, so the worst thing to do is send "/chess" to Orion as a sentence, and the second
     * worst is to do nothing at all. It says what is true, in `featureVisibility`'s own words -- which already
     * include where the switch is -- and keeps what was typed so nothing is lost.
     */
    if (command.feature !== undefined) {
      const state = featureState(command.feature, props.visibility)
      if (!state.visible) {
        props.onNotify(state.hiddenBecause ?? `${command.name} is not available right now.`, 'warn')
        return
      }
    }

    if (command.args && !command.argsOptional && !args.trim()) {
      changeText(`/${command.name} `)
      requestAnimationFrame(() => textareaRef.current?.focus())
      return
    }
    changeText('')
    if (command.name === 'models') return openModelMenu()
    props.onCommand(command.name, args.trim())
  }

  const submit = (): void => {
    if (commandsOpen && filteredCommands.length > 0) {
      executeCommand(filteredCommands[selectedCommandIndex].name)
      return
    }
    // A command typed out with its text ("/rename Trip ideas", "/model max") runs instead of being sent.
    const typed = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim())
    if (typed && SLASH_COMMANDS.some((c) => c.name === typed[1].toLowerCase())) {
      executeCommand(typed[1].toLowerCase(), typed[2] ?? '')
      return
    }

    if (!canSend) return
    const form = formRef.current
    // Only the centred composer of an empty chat glides; once docked at the bottom it stays put.
    if (form?.closest('.stage-content')?.querySelector('.empty-state')) rememberComposerStart(form.getBoundingClientRect())
    if (props.onSend(text, attachments)) {
      setText('')
      // Sent: nothing of the old guess survives, and an answer still on its way cannot land in the empty box.
      predictor.reset('submitted')
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
    // An Excel, Word or PDF file was read for the chat: what was read, and what could not be, in Orbis's own words.
    for (const note of picked.notes ?? []) props.onNotify(note, / was not attached/.test(note) ? 'warn' : 'info')
  }

  const attachImages = async (): Promise<void> => {
    const picked = await window.api.pickImages()
    if (picked.attachments.length) setAttachments((current) => [...current, ...picked.attachments].slice(0, 10))
    if (picked.skipped.length) props.onNotify(`Skipped ${picked.skipped.join(', ')}: not an image or larger than 200 KB.`, 'warn')
  }

  /**
   * The chat microphone.
   *
   * What comes back goes into this box and no other. The service knows which input started the session, so words
   * spoken into the browser's assistant can never arrive here.
   */
  const toggleVoiceInput = async (): Promise<void> => {
    const spoken = await voice.toggle()
    if (spoken) {
      setText((current) => {
        // Dictated text is not typed text, but it is still the person's: the old guess is about something else now.
        const next = current ? `${current} ${spoken}` : spoken
        predictor.changed(next, 'pasted')
        return next
      })
      requestAnimationFrame(() => textareaRef.current?.focus())
    } else if (voice.error) {
      props.onNotify(voice.error, 'warn')
    }
  }

  // Push-to-talk (Ctrl+Shift+M): the same toggle above, just started and stopped by the shortcut instead of a click.
  // Only listened for while chat is the surface it is speaking for — App.tsx decides that from what is on screen.
  useEffect(() => {
    const onPushToTalk = (e: Event): void => {
      const detail = (e as CustomEvent<{ phase: 'start' | 'stop'; target: string }>).detail
      if (detail?.target !== 'chat') return
      if (detail.phase === 'start' && !voice.recording) void toggleVoiceInput()
      else if (detail.phase === 'stop' && voice.recording) void toggleVoiceInput()
    }
    window.addEventListener(PUSH_TO_TALK_EVENT, onPushToTalk)
    return () => window.removeEventListener(PUSH_TO_TALK_EVENT, onPushToTalk)
  }, [voice.recording])


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
                changeText(p.text, 'pasted')
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
                <img src={pictureSrc(a)} alt={a.name} style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'cover' }} />
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
            aria-description={ghostRest ? `Suggested ending: ${ghostRest}. Press Tab to use it, Escape to dismiss it.` : undefined}
            onChange={(e) => changeText(e.target.value)}
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
                } else if (e.key === 'Tab' && !e.shiftKey) {
                  e.preventDefault()
                  executeCommand(filteredCommands[selectedCommandIndex].name)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  setCommandsOpen(false)
                }
              } else if (ghostRest && e.key === 'Tab' && !e.shiftKey && !e.repeat) {
                // Not on a held key: one physical press, one acceptance.
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
                predictor.dismiss()
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
              </button>
              {menuOpen && (
                <div className={`popover glass mode-menu${menuPlacement.down ? ' down' : ''}`} style={{ maxHeight: menuPlacement.maxHeight }} role="menu">
                  {CHAT_MODELS.map((m) => {
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

            {/*
              * One button, which is whichever one is useful.
              *
              * With nothing typed there is nothing to send, so the button speaks instead. Start typing and it becomes
              * Send. While Orbis is replying it becomes Stop, and if something is also typed it becomes Add to queue.
              *
              * Two buttons sat here before — a microphone and a send — and one of them was always dead. A disabled
              * control that never becomes useful until you type is the sort of thing that reads as broken, and it cost
              * a slot in a row that is already crowded.
              *
              * The recording and transcribing states stay on the same button, so the thing you pressed is the thing
              * that changes.
              */}
            {streaming ? (
              <>
                {canSend && (
                  <button
                    type="submit"
                    className="send-btn ready queue"
                    title="Add to queue (Enter)"
                    aria-label="Add to queue"
                  >
                    <ListPlus size={15} />
                  </button>
                )}
                <button
                  type="button"
                  className="send-btn stop"
                  title="Stop generating (Esc)"
                  aria-label="Stop generating"
                  onClick={props.onStop}
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </>
            ) : canSend ? (
              <button type="submit" className="send-btn ready" title="Send (Enter)" aria-label="Send">
                <Send size={14} />
              </button>
            ) : (
              <button
                type="button"
                className={`send-btn speak${voice.recording ? ' recording' : ''}${voice.transcribing ? ' transcribing' : ''}`}
                title={
                  !voice.available
                    ? 'Speaking needs a voice model. Settings has the download.'
                    : voice.recording
                      ? `Stop recording (${Math.round(voice.recordingMs / 1000)}s)`
                      : voice.transcribing
                        ? 'Writing down what you said…'
                        : 'Speak instead of typing'
                }
                aria-label={voice.recording ? 'Stop recording' : voice.transcribing ? 'Writing down what you said' : 'Speak instead of typing'}
                aria-pressed={voice.recording}
                onClick={() => void toggleVoiceInput()}
                disabled={voice.transcribing || !voice.available}
              >
                <Mic size={15} />
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
                  <span className="cmd-name">
                    /{cmd.name}
                    {cmd.args && <span className="cmd-args"> {cmd.args}</span>}
                  </span>
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
