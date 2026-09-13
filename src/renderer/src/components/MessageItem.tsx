import { memo, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Ellipsis, FileText, Pencil, RefreshCw, Sparkles, ThumbsDown, ThumbsUp, Type, Upload, Volume2, VolumeX } from 'lucide-react'
import type { ChatMessage } from '../../../shared/types'
import { modelLabel } from '../../../shared/models'
import { copyText, formatDuration } from '../lib/utils'
import { useDismiss } from '../lib/useDismiss'
import type { NoticeKind } from '../App'
import Markdown from './Markdown'
import { OrbisMark } from './Brand'
import { ThinkingOrb, ThinkingText } from './Thinking'

interface Props {
  message: ChatMessage
  assistantName: string
  userName: string
  /** This message is the one currently being generated. */
  streaming: boolean
  status?: string
  canRegenerate: boolean
  canEdit: boolean
  onRegenerate(messageId: string): void
  onEdit(messageId: string, text: string): void
  /** Re-send a user message as-is, replacing the replies after it. */
  onResend(messageId: string): void
  onFeedback(messageId: string, feedback: 'up' | 'down' | undefined): void
  onNotify(text: string, kind?: NoticeKind): void
}

const formatTime = (ts: number): string => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

function MessageItem(props: Props): React.JSX.Element {
  const { message, streaming, status } = props
  return message.role === 'user' ? <UserMessage {...props} /> : streaming && !message.content ? <PendingReply status={status} reasoning={message.reasoning} /> : <AssistantMessage {...props} />
}

function UserMessage({ message, userName, canEdit, onEdit, onResend, onNotify }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = (): void => {
    if (!draft.trim()) return
    setEditing(false)
    onEdit(message.id, draft)
  }

  const share = (): void => {
    void copyText(`**${userName}** · ${formatTime(message.createdAt)}\n\n${message.content}`).then(() => onNotify('Message copied with attribution.'))
  }

  return (
    <div className="msg user">
      <div className="msg-body">
        <div className="msg-meta">
          <time>{formatTime(message.createdAt)}</time>
          <span className="msg-name">{userName}</span>
        </div>
        {editing ? (
          <div className="edit-panel glass">
            <textarea
              value={draft}
              autoFocus
              rows={Math.min(12, draft.split('\n').length + 1)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  setEditing(false)
                }
              }}
            />
            <div className="edit-actions">
              <button className="text-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="primary-btn" onClick={submit} disabled={!draft.trim()}>
                Send
              </button>
            </div>
          </div>
        ) : (
          message.content && <div className="user-bubble">{message.content}</div>
        )}
        {message.attachments && message.attachments.length > 0 && (
          <div className="attachment-row end">
            {message.attachments.map((a, i) => (
              <span key={`${a.name}-${i}`} className="attachment-chip glass">
                <FileText size={13} />
                <span className="truncate">{a.name}</span>
              </span>
            ))}
          </div>
        )}
        {!editing && (
          <div className="msg-actions">
            {message.content && <CopyButton text={message.content} />}
            {canEdit && (
              <button
                className="icon-btn small"
                title="Edit message"
                onClick={() => {
                  setDraft(message.content)
                  setEditing(true)
                }}
              >
                <Pencil size={14} />
              </button>
            )}
            {canEdit && (
              <button className="icon-btn small" title="Resend for a new reply" onClick={() => onResend(message.id)}>
                <RefreshCw size={14} />
              </button>
            )}
            {message.content && (
              <button className="icon-btn small" title="Share" onClick={share}>
                <Upload size={14} />
              </button>
            )}
            {message.content && <MoreMenu getText={() => message.content} onNotify={onNotify} alignRight />}
          </div>
        )}
      </div>
      <div className="avatar user-avatar">{userName.trim().charAt(0).toUpperCase() || 'U'}</div>
    </div>
  )
}

function PendingReply({ status, reasoning }: { status?: string; reasoning?: string }): React.JSX.Element {
  return (
    <div className="msg assistant pending">
      <ThinkingOrb />
      <div className="msg-body">
        <ThinkingText />
        {status && <div className="stream-status">{status}</div>}
        {reasoning && <Reasoning text={reasoning} active />}
      </div>
    </div>
  )
}

function AssistantMessage(props: Props): React.JSX.Element {
  const { message, streaming, status } = props
  const cardRef = useRef<HTMLDivElement>(null)

  const plainText = (): string => cardRef.current?.querySelector('.markdown')?.textContent ?? message.content

  const share = (): void => {
    void copyText(`**${props.assistantName}** · ${formatTime(message.createdAt)}\n\n${message.content}`).then(() =>
      props.onNotify('Reply copied with attribution.')
    )
  }

  return (
    <div className="msg assistant">
      <div className="avatar assistant-avatar">
        <OrbisMark size={20} />
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-name">{props.assistantName}</span>
          <Sparkles size={11} className="meta-icon" />
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className="msg-card glass" ref={cardRef}>
          {message.reasoning && <Reasoning text={message.reasoning} durationMs={message.reasoningMs} />}
          {streaming && status && <div className="stream-status">{status}</div>}
          {message.content && <Markdown text={message.content} />}
          {streaming && <span className="stream-caret" />}
          {message.error && <div className="message-error">{message.error}</div>}
        </div>
        {!streaming && (
          <div className="msg-actions">
            {message.content && <CopyButton text={message.content} />}
            <button
              className={`icon-btn small${message.feedback === 'up' ? ' on' : ''}`}
              title="Good response"
              onClick={() => props.onFeedback(message.id, message.feedback === 'up' ? undefined : 'up')}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              className={`icon-btn small${message.feedback === 'down' ? ' on' : ''}`}
              title="Bad response"
              onClick={() => props.onFeedback(message.id, message.feedback === 'down' ? undefined : 'down')}
            >
              <ThumbsDown size={14} />
            </button>
            {props.canRegenerate && (
              <button className="icon-btn small" title="Regenerate" onClick={() => props.onRegenerate(message.id)}>
                <RefreshCw size={14} />
              </button>
            )}
            {message.content && (
              <button className="icon-btn small" title="Share" onClick={share}>
                <Upload size={14} />
              </button>
            )}
            {message.content && <MoreMenu getText={plainText} onNotify={props.onNotify} />}
            {message.model && <span className="model-tag">{modelLabel(message.model)}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/** "More" menu shared by user and assistant messages: read aloud and copy as plain text. */
function MoreMenu({ getText, onNotify, alignRight = false }: { getText(): string; onNotify(text: string, kind?: NoticeKind): void; alignRight?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismiss(rootRef, open, () => setOpen(false))

  useEffect(() => () => void (speaking && speechSynthesis.cancel()), [speaking])

  const toggleSpeech = (): void => {
    setOpen(false)
    if (speaking) {
      speechSynthesis.cancel()
      setSpeaking(false)
      return
    }
    const utterance = new SpeechSynthesisUtterance(getText())
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)
    speechSynthesis.cancel()
    speechSynthesis.speak(utterance)
    setSpeaking(true)
  }

  return (
    <div className="popover-anchor" ref={rootRef}>
      <button className={`icon-btn small${speaking ? ' on' : ''}`} title="More" onClick={() => setOpen((o) => !o)}>
        <Ellipsis size={14} />
      </button>
      {open && (
        <div className={`popover glass up${alignRight ? ' align-right' : ''}`} role="menu">
          <button className="menu-item" onClick={toggleSpeech}>
            {speaking ? <VolumeX size={14} /> : <Volume2 size={14} />}
            {speaking ? 'Stop reading' : 'Read aloud'}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false)
              void copyText(getText()).then(() => onNotify('Copied as plain text.'))
            }}
          >
            <Type size={14} />
            Copy as plain text
          </button>
        </div>
      )}
    </div>
  )
}

function Reasoning({ text, active = false, durationMs }: { text: string; active?: boolean; durationMs?: number }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const label = active ? 'Reasoning' : durationMs ? `Thought for ${formatDuration(durationMs)}` : 'Thoughts'
  return (
    <div className={`reasoning${open ? ' open' : ''}`}>
      <button className="reasoning-toggle" onClick={() => setOpen((o) => !o)}>
        {label}
        <ChevronDown size={13} />
      </button>
      {open && <div className="reasoning-body">{text}</div>}
    </div>
  )
}

function CopyButton({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="icon-btn small"
      title={copied ? 'Copied' : 'Copy'}
      onClick={() =>
        void copyText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

// Callbacks resolve the conversation by id, so only data props decide re-rendering.
export default memo(
  MessageItem,
  (a, b) =>
    a.message === b.message &&
    a.streaming === b.streaming &&
    a.status === b.status &&
    a.canRegenerate === b.canRegenerate &&
    a.canEdit === b.canEdit &&
    a.assistantName === b.assistantName &&
    a.userName === b.userName
)
